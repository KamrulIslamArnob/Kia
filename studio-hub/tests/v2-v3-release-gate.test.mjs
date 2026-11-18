import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createStudioHttpServer } from "../server.mjs";
import { PROJECTS_DIR, readCurrentProjectSlug, setCurrentProjectSlug } from "../lib.mjs";

const requireFromEngine = createRequire(
  new URL("../../packages/engine/package.json", import.meta.url),
);
const puppeteer = requireFromEngine("puppeteer-core");

function walkForChromeBinary(dir, targetNames, depth = 0) {
  if (depth > 5 || !dir || !fs.existsSync(dir)) return [];
  const found = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && targetNames.has(entry.name.toLowerCase())) {
      found.push(full);
    } else if (entry.isDirectory()) {
      found.push(...walkForChromeBinary(full, targetNames, depth + 1));
    }
  }
  return found;
}

function findChromeExecutable() {
  if (process.env.CHROME_HEADLESS_SHELL && fs.existsSync(process.env.CHROME_HEADLESS_SHELL)) {
    return process.env.CHROME_HEADLESS_SHELL;
  }
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  const cacheRoot = path.join(userProfile, ".cache", "hyperframes", "chrome");
  const targetNames =
    process.platform === "win32"
      ? new Set(["chrome-headless-shell.exe", "chrome.exe"])
      : new Set(["chrome-headless-shell", "google-chrome", "chromium"]);
  const matches = walkForChromeBinary(cacheRoot, targetNames);
  if (matches.length > 0) {
    matches.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
    return matches[0];
  }
  const winFallbacks = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const candidate of winFallbacks) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Minimal valid 1x1 white PNG data URL for regional canvas mask smoke test
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";

test("Studio Hub V2 + Wave 4 V3 Production Release Gate (Server + Headless Chromium)", async (t) => {
  const originalActiveSlug = readCurrentProjectSlug();
  const smokeSlug = `v2-qa-smoke-${Date.now().toString(36)}`;
  const smokeDir = path.join(PROJECTS_DIR, smokeSlug);

  const server = createStudioHttpServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  let browser = null;

  t.after(async () => {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }
    await new Promise((resolve) => server.close(() => resolve()));
    if (originalActiveSlug && fs.existsSync(path.join(PROJECTS_DIR, originalActiveSlug))) {
      setCurrentProjectSlug(originalActiveSlug);
    }
    if (fs.existsSync(smokeDir)) {
      fs.rmSync(smokeDir, { recursive: true, force: true });
    }
  });

  async function requestJson(urlPath, options = {}) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method: options.method || "GET",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  // 1. Create isolated project & verify V2 + V3 HTTP API wiring through server.mjs
  const created = await requestJson("/api/projects", {
    method: "POST",
    body: {
      slug: smokeSlug,
      title: "V2 Release Smoke Reel",
      aspectRatio: "9:16",
      durationSeconds: 18,
      language: "Bengali",
      instructions:
        "Highlight 5 winter vegetable seed packets with bold hook and free delivery CTA.",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.ok, true);

  // V2 Skills discovery & selection (including Wave 5 rea-video skill)
  const skillsGet = await requestJson(`/api/skills?slug=${encodeURIComponent(smokeSlug)}`);
  assert.equal(skillsGet.status, 200);
  assert.equal(skillsGet.json.ok, true);
  assert.ok(Array.isArray(skillsGet.json.skills) && skillsGet.json.skills.length >= 5);
  assert.ok(
    skillsGet.json.skills.some((s) => s.id === "rea-video"),
    "Expected .agents/skills/rea-video to be dynamically discovered by GET /api/skills",
  );

  const chosenSkills = ["motion-doctrine", "oversized-cursor", "captions-overlay"].filter((id) =>
    skillsGet.json.skills.some((s) => s.id === id),
  );
  assert.ok(chosenSkills.length >= 2, "Expected core workspace skills to be discovered locally");

  const skillsSet = await requestJson(`/api/projects/${smokeSlug}/skills`, {
    method: "POST",
    body: { selectedSkills: chosenSkills },
  });
  assert.equal(skillsSet.status, 200);
  assert.equal(skillsSet.json.ok, true);
  assert.deepEqual(skillsSet.json.selectedSkills, chosenSkills);
  assert.equal(skillsSet.json.directives?.stagingHints?.includeOversizedCursor, true);

  // Storyboard generate wired with selectedSkills & compiledSkillDirectives
  const sbGen = await requestJson(`/api/projects/${smokeSlug}/storyboard/generate`, {
    method: "POST",
    body: { targetScenes: 4, selectedSkills: chosenSkills },
  });
  assert.equal(sbGen.status, 200);
  assert.equal(sbGen.json.ok, true);
  assert.equal(sbGen.json.storyboard.frames.length, 4);
  assert.deepEqual(sbGen.json.selectedSkills, chosenSkills);
  assert.ok(
    sbGen.json.storyboard.frames.some((f) => f.layout === "spotlight-cursor-zoom"),
    "Expected oversized-cursor skill directive to stage at least one spotlight-cursor-zoom shot",
  );

  // V2 Whole-Video Quality Rating
  const ratingRes = await requestJson(`/api/projects/${smokeSlug}/rating`, {
    method: "POST",
    body: {},
  });
  assert.equal(ratingRes.status, 200);
  assert.equal(ratingRes.json.ok, true);
  assert.equal(typeof ratingRes.json.rating.overallScore, "number");
  assert.ok(ratingRes.json.rating.overallScore >= 0 && ratingRes.json.rating.overallScore <= 100);
  assert.ok(ratingRes.json.rating.categories?.skillAlignment);

  // V2 Draw-on-Frame Regional Regeneration (200 OK + v2 PNG rendered)
  const regionRes = await requestJson(
    `/api/projects/${smokeSlug}/storyboard/frames/frame_01/regenerate-region`,
    {
      method: "POST",
      body: {
        maskDataUrl: TINY_PNG_DATA_URL,
        compositeDataUrl: TINY_PNG_DATA_URL,
        strokes: [
          {
            tool: "brush",
            size: 24,
            color: "#E03E3E",
            points: [
              { x: 180, y: 160 },
              { x: 640, y: 220 },
            ],
          },
        ],
        prompt: 'Update top badge to "WINTER OFFER"',
        enqueueAiInpaint: false,
      },
    },
  );
  assert.equal(regionRes.status, 200);
  assert.equal(regionRes.json.ok, true);
  assert.equal(regionRes.json.frame.currentVersion, 2);

  // V2 Saved Frames Vault (POST, GET, DELETE -> 200 OK)
  const saveBookmark = await requestJson(`/api/projects/${smokeSlug}/saved-frames`, {
    method: "POST",
    body: { frameId: "frame_01", version: 2, label: "Hero Seed Offer v2" },
  });
  assert.equal(saveBookmark.status, 200);
  assert.equal(saveBookmark.json.ok, true);
  const savedId = saveBookmark.json.savedFrame.id;
  assert.ok(savedId);

  const listBookmarks = await requestJson(`/api/projects/${smokeSlug}/saved-frames`);
  assert.equal(listBookmarks.status, 200);
  assert.equal(listBookmarks.json.savedFrames.length, 1);

  // V3 Voices, Whiteboard, Ad Analytics & PM Insights -> 200 OK
  const voicesRes = await requestJson("/api/voices?lang=Bengali");
  assert.equal(voicesRes.status, 200);
  assert.equal(voicesRes.json.ok, true);
  assert.equal(voicesRes.json.voices.length, 4);

  const wbSave = await requestJson(`/api/projects/${smokeSlug}/whiteboard`, {
    method: "POST",
    body: {
      nodes: [
        { id: "n1", type: "note", x: 40, y: 60, title: "Hook note", promptText: "Fast punch-in" },
        { id: "s1", type: "scene", x: 380, y: 60, title: "Scene 01" },
      ],
      edges: [{ id: "e1", from: "n1", to: "s1" }],
    },
  });
  assert.equal(wbSave.status, 200);
  assert.equal(wbSave.json.ok, true);

  const adAnalyticsRes = await requestJson(`/api/projects/${smokeSlug}/ad-analytics`, {
    method: "POST",
    body: {},
  });
  assert.equal(adAnalyticsRes.status, 200);
  assert.equal(adAnalyticsRes.json.ok, true);
  assert.equal(typeof adAnalyticsRes.json.analytics.thumbstopHookScore, "number");
  assert.equal(adAnalyticsRes.json.analytics.hookVariants.length, 3);

  const pmInsightsRes = await requestJson("/api/pm-insights");
  assert.equal(pmInsightsRes.status, 200);
  assert.equal(pmInsightsRes.json.ok, true);

  // Wave 6 V4 routes & 12-archetype Pro catalog through live server.mjs
  const catalogRes = await requestJson("/api/catalog/presets");
  assert.equal(catalogRes.status, 200);
  assert.ok(catalogRes.json.archetypes.length >= 12);
  assert.ok(catalogRes.json.archetypes.some((a) => a.id === "depth-text-behind-speaker"));
  assert.ok(catalogRes.json.archetypes.some((a) => a.id === "hook-scroll-stopper"));

  const beatRes = await requestJson(`/api/projects/${smokeSlug}/beat-quantize`, {
    method: "POST",
    body: { fps: 30 },
  });
  assert.equal(beatRes.status, 200);
  assert.equal(beatRes.json.ok, true);

  const reframeRes = await requestJson(`/api/projects/${smokeSlug}/smart-reframe`, {
    method: "POST",
    body: { targetAspect: "16:9" },
  });
  assert.equal(reframeRes.status, 200);
  assert.equal(reframeRes.json.ok, true);

  const subsRes = await requestJson(`/api/projects/${smokeSlug}/subtitles-export`, {
    method: "POST",
    body: { formats: ["srt", "vtt", "ass"] },
  });
  assert.equal(subsRes.status, 200);
  assert.equal(subsRes.json.ok, true);

  const bundleRes = await requestJson("/api/skill-bundles/export", {
    method: "POST",
    body: { slug: smokeSlug, skillIds: ["motion-doctrine"] },
  });
  assert.equal(bundleRes.status, 200);
  assert.equal(bundleRes.json.ok, true);

  // 2. Real Headless Chromium Smoke Test of Bundled React 19 UI
  const chromeExe = findChromeExecutable();
  assert.ok(chromeExe, "Expected chrome-headless-shell or Chrome binary to be installed locally");

  browser = await puppeteer.launch({
    executablePath: chromeExe,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });

  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!text.includes("favicon.ico")) {
        consoleErrors.push(text);
      }
    }
  });

  await page.goto(`${baseUrl}/#step-1`, { waitUntil: "networkidle2", timeout: 25000 });
  await page.waitForSelector("#studio-root h1", { timeout: 10000 });

  // Verify White Mode default & #FBFBFA canvas background
  const initialThemeAndStep = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    bg: getComputedStyle(document.body).backgroundColor,
    h1: document.querySelector("#studio-root h1")?.textContent?.trim() || "",
    bodyText: document.body.innerText,
  }));
  assert.equal(initialThemeAndStep.theme, "light");
  assert.equal(initialThemeAndStep.bg, "rgb(251, 251, 250)");
  assert.match(initialThemeAndStep.h1, /Raw footage/i);
  assert.match(initialThemeAndStep.bodyText, /Scene whiteboard/i);

  // Navigate Step 2 -> Step 3 -> Step 4 -> Step 5 and verify every view + Wave 4 & rea-video cards mount cleanly
  await page.evaluate(() => {
    window.location.hash = "#step-2";
  });
  await page.waitForFunction(
    () => /Inspiration/i.test(document.querySelector("#studio-root h1")?.textContent || ""),
    { timeout: 8000 },
  );
  const step2Text = await page.evaluate(() => document.body.innerText);
  assert.match(step2Text, /Deep animation & style breakdown/i);

  // Step 3: Brand, Skills selector & Wave 4 VoiceAndLipSyncCard
  await page.evaluate(() => {
    window.location.hash = "#step-3";
  });
  await page.waitForFunction(
    () => /Brand/i.test(document.querySelector("#studio-root h1")?.textContent || ""),
    { timeout: 8000 },
  );
  const step3Text = await page.evaluate(() => document.body.innerText);
  assert.match(step3Text, /Use original video voice/i);
  assert.match(step3Text, /Generate AI voice/i);
  assert.match(step3Text, /motion-doctrine|local skills/i);

  // Step 4: Design frames, Rating badge, Ad analytics toggle, Whiteboard mode & Draw-on-Frame modal
  await page.evaluate(() => {
    window.location.hash = "#step-4";
  });
  await page.waitForFunction(
    () => /Design frames/i.test(document.querySelector("#studio-root h1")?.textContent || ""),
    { timeout: 8000 },
  );
  await page.waitForFunction(() => document.querySelectorAll(".scene-card").length === 4, {
    timeout: 10000,
  });

  // Open Draw-on-Frame Canvas Editor modal on Scene 01
  await page.evaluate(() => {
    const editBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      /Edit \/ Draw on frame/i.test(b.textContent || ""),
    );
    editBtn?.click();
  });
  await page.waitForSelector("canvas", { timeout: 8000 });
  const canvasModalState = await page.evaluate(() => ({
    hasCanvas: Boolean(document.querySelector("canvas")),
    text: document.body.innerText,
  }));
  assert.equal(canvasModalState.hasCanvas, true);
  assert.match(canvasModalState.text, /Brush mask/i);
  assert.match(canvasModalState.text, /Motion arrow/i);

  // Close Draw-on-Frame modal via Escape or Close button, then toggle Ad Analytics in Step 4
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const adBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      /Ad analytics/i.test(b.textContent || ""),
    );
    adBtn?.click();
  });
  await page.waitForFunction(
    () => /3s Hook score|Hook score|Retention/i.test(document.body.innerText),
    { timeout: 8000 },
  );

  // Step 5: Export settings, 5-stage Compilation Checklist, Master Video Player & AdAnalyticsPanel
  await page.evaluate(() => {
    window.location.hash = "#step-5";
  });
  await page.waitForFunction(
    () => /Generate video/i.test(document.querySelector("#studio-root h1")?.textContent || ""),
    { timeout: 8000 },
  );
  const step5State = await page.evaluate(() => {
    const proBelt = document.querySelector("details.pro-tools-belt");
    const wasCollapsedByDefault = proBelt ? proBelt.open === false : false;
    if (proBelt) proBelt.open = true;
    return {
      hasProBelt: Boolean(proBelt),
      wasCollapsedByDefault,
      text: document.body.innerText,
    };
  });
  assert.equal(step5State.hasProBelt, true);
  assert.equal(step5State.wasCollapsedByDefault, true);
  assert.match(step5State.text, /Compilation checklist/i);
  assert.match(step5State.text, /Master video player/i);
  assert.match(step5State.text, /TikTok|Instagram Reels/i);
  assert.match(step5State.text, /Generate 3 cover thumbnails/i);
  assert.match(step5State.text, /Export subtitle files/i);

  // Clean up bookmark via DELETE endpoint -> 200 OK
  const delBookmark = await requestJson(
    `/api/projects/${smokeSlug}/saved-frames/${encodeURIComponent(savedId)}`,
    { method: "DELETE" },
  );
  assert.equal(delBookmark.status, 200);
  assert.equal(delBookmark.json.savedFrames.length, 0);

  // Zero runtime errors & zero console errors in Headless Chromium
  assert.deepEqual(pageErrors, [], `Unexpected page errors: ${pageErrors.join(" | ")}`);
  assert.deepEqual(consoleErrors, [], `Unexpected console errors: ${consoleErrors.join(" | ")}`);
});

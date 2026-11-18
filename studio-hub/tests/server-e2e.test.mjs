import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

import {
  CURRENT_PROJECT_FILE,
  PROJECTS_DIR,
  ROOT_DIR,
  runCommand,
  setCurrentProjectSlug,
} from "../lib.mjs";
import { PROVIDER_SETTINGS_FILE } from "../agent-bridge.mjs";
import { bootstrapServer, createStudioHttpServer, decorateStoryboardForUi } from "../server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CREW_STATE_FILE = path.join(ROOT_DIR, ".hyperframes", "agent-crew-state.json");

function snapshotFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function restoreFile(filePath, content) {
  if (content === null) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
}

async function requestJson(baseUrl, routePath, { method = "GET", body, headers = {} } = {}) {
  const opts = {
    method,
    headers: { ...headers },
  };
  if (body !== undefined) {
    if (Buffer.isBuffer(body) || typeof body === "string") {
      opts.body = body;
    } else {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(`${baseUrl}${routePath}`, opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { rawText: text };
  }
  return { status: res.status, headers: res.headers, data: json };
}

function openSseCollector(baseUrl) {
  const events = [];
  let buffer = "";
  let req = null;

  const ready = new Promise((resolve, reject) => {
    req = http.get(`${baseUrl}/api/events`, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        let sepIdx = buffer.indexOf("\n\n");
        while (sepIdx !== -1) {
          const block = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          sepIdx = buffer.indexOf("\n\n");

          if (!block.trim() || block.startsWith(":")) continue;
          let eventName = "message";
          let dataLine = "";
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith("event:")) {
              eventName = line.slice("event:".length).trim();
            } else if (line.startsWith("data:")) {
              dataLine += line.slice("data:".length).trim();
            }
          }
          let parsed = dataLine;
          try {
            parsed = JSON.parse(dataLine);
          } catch {
            // Keep raw string
          }
          const evt = { event: eventName, data: parsed };
          events.push(evt);
          if (eventName === "connected") {
            resolve(evt);
          }
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
  });

  return {
    events,
    ready,
    async waitForEvent(predicate, timeoutMs = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const match = events.find(predicate);
        if (match) return match;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error(
        `Timed out waiting for SSE event. Received: ${events.map((e) => e.event).join(", ")}`,
      );
    },
    close() {
      try {
        req?.destroy();
      } catch {
        // Ignore close errors
      }
    },
  };
}

async function generateSyntheticFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const rawVideoPath = path.join(dir, "sample_raw.mp4");
  const inspVideoPath = path.join(dir, "sample_insp.mp4");
  const logoPngPath = path.join(dir, "brand_logo.png");
  const brandDocPath = path.join(dir, "brand_guide.md");

  // 2.4s 2-scene synthetic raw video (emerald 1.2s -> gold 1.2s) for scene-cut detection
  const rawCmd = await runCommand(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=#1E824C:s=360x640:r=24:d=1.2",
      "-f",
      "lavfi",
      "-i",
      "color=c=#F1C40F:s=360x640:r=24:d=1.2",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map",
      "[v]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      rawVideoPath,
    ],
    { shell: false },
  );
  assert.equal(rawCmd.code, 0, `ffmpeg raw video fixture failed: ${rawCmd.stderr}`);

  // 1.8s fast-cut inspiration video
  const inspCmd = await runCommand(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=#0F172A:s=360x640:r=24:d=0.9",
      "-f",
      "lavfi",
      "-i",
      "color=c=#2ECC71:s=360x640:r=24:d=0.9",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map",
      "[v]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      inspVideoPath,
    ],
    { shell: false },
  );
  assert.equal(inspCmd.code, 0, `ffmpeg insp video fixture failed: ${inspCmd.stderr}`);

  // Synthetic brand logo PNG
  const logoCmd = await runCommand(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", "color=c=#1E824C:s=128x128:d=0.1", "-frames:v", "1", logoPngPath],
    { shell: false },
  );
  assert.equal(logoCmd.code, 0, `ffmpeg logo fixture failed: ${logoCmd.stderr}`);

  fs.writeFileSync(
    brandDocPath,
    [
      "# Acme Cinema Brand Guidelines",
      "Heading Font: Space Grotesk",
      "Body Font: Inter",
      "Brand Palette: #1E824C #2ECC71 #F1C40F #0A1612",
      "Tone: Bold, cinematic, editorial confidence.",
    ].join("\n"),
    "utf8",
  );

  return { rawVideoPath, inspVideoPath, logoPngPath, brandDocPath };
}

test("Studio Hub Server E2E — Full 20-Route Integration, SSE, Pro Catalog, Storyboard & Async Video Compiler", async (t) => {
  const origCurrentProj = snapshotFile(CURRENT_PROJECT_FILE);
  const origProviderSettings = snapshotFile(PROVIDER_SETTINGS_FILE);
  const origCrewState = snapshotFile(CREW_STATE_FILE);

  const tempExtDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-hub-e2e-"));
  const testSlug = `e2e-studio-${Date.now().toString(36)}`;
  const testProjectDir = path.join(PROJECTS_DIR, testSlug);

  const server = createStudioHttpServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const addr = server.address();
  assert.ok(addr && typeof addr === "object" && addr.port > 0);
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const sse = openSseCollector(baseUrl);

  t.after(async () => {
    sse.close();
    await new Promise((resolve) => server.close(() => resolve()));
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tempExtDir)) {
      fs.rmSync(tempExtDir, { recursive: true, force: true });
    }
    restoreFile(PROVIDER_SETTINGS_FILE, origProviderSettings);
    restoreFile(CREW_STATE_FILE, origCrewState);
    const currentNow = snapshotFile(CURRENT_PROJECT_FILE);
    if (!currentNow || currentNow.includes(testSlug)) {
      restoreFile(CURRENT_PROJECT_FILE, origCurrentProj);
    }
    if (
      !fs.existsSync(CURRENT_PROJECT_FILE) &&
      fs.existsSync(path.join(PROJECTS_DIR, "krishop-promo"))
    ) {
      setCurrentProjectSlug("krishop-promo");
    }
  });

  // 1. Static UI & decorateStoryboardForUi unit sanity
  const htmlRes = await fetch(`${baseUrl}/`);
  assert.equal(htmlRes.status, 200);
  const htmlText = await htmlRes.text();
  assert.match(htmlText, /Video Studio|Director Studio/i);

  const decoratedSample = decorateStoryboardForUi("demo-slug", {
    slug: "demo-slug",
    frames: [
      {
        id: "frame_01",
        designFramePath: ".studio/frames/design/frame_01_v1.png",
        hudFramePath: ".studio/frames/design/frame_01_v1_hud.png",
        keyframes: { start: ".studio/frames/raw/scene_01_start.png" },
        history: [{ version: 1, designFramePath: ".studio/frames/design/frame_01_v1.png" }],
      },
    ],
  });
  assert.equal(
    decoratedSample.frames[0].currentDesignImage,
    "/media/demo-slug/.studio/frames/design/frame_01_v1.png",
  );
  assert.equal(
    decoratedSample.frames[0].currentBlueprintImage,
    "/media/demo-slug/.studio/frames/design/frame_01_v1_hud.png",
  );
  assert.equal(
    decoratedSample.frames[0].history[0].image,
    "/media/demo-slug/.studio/frames/design/frame_01_v1.png",
  );

  // 2. SSE connection + internal notify webhook
  const connectedEvt = await sse.ready;
  assert.equal(connectedEvt.event, "connected");
  assert.ok(connectedEvt.data.providerSettings);

  const notifyRes = await requestJson(baseUrl, "/api/internal/notify", {
    method: "POST",
    body: { type: "agent-status", payload: { message: "Crew online" } },
  });
  assert.equal(notifyRes.status, 200);
  assert.equal(notifyRes.data.ok, true);
  await sse.waitForEvent((e) => e.event === "agent-status" && e.data?.message === "Crew online");

  // 3. System Status & $0 Subscription Guard
  const statusRes = await requestJson(baseUrl, "/api/status");
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.data.providerSettings.zeroCostGuard, true);
  assert.equal(statusRes.data.agentCrew.agents.length, 6);
  assert.equal(statusRes.data.crew.agents.length, 6);

  const getProvRes = await requestJson(baseUrl, "/api/provider-settings");
  assert.equal(getProvRes.status, 200);
  assert.equal(getProvRes.data.providerSettings.model, "gemini-4-carbon-high");

  const paidAttempt = await requestJson(baseUrl, "/api/provider-settings", {
    method: "POST",
    body: { providerMode: "openai-paid-api", zeroCostGuard: true },
  });
  assert.ok(paidAttempt.status === 403 || paidAttempt.status === 400);
  assert.equal(paidAttempt.data.ok, false);

  const validProvUpdate = await requestJson(baseUrl, "/api/provider-settings", {
    method: "POST",
    body: { allowFreeTierApiKey: true, zeroCostGuard: true },
  });
  assert.equal(validProvUpdate.status, 200);
  assert.equal(validProvUpdate.data.providerSettings.allowFreeTierApiKey, true);

  // 4. Pro Routes Delegation (/api/catalog/presets)
  const catalogRes = await requestJson(baseUrl, "/api/catalog/presets");
  assert.equal(catalogRes.status, 200);
  assert.equal(catalogRes.data.ok, true);
  assert.ok(
    Array.isArray(catalogRes.data.cameraBodies) && catalogRes.data.cameraBodies.length >= 6,
  );
  assert.ok(
    Array.isArray(catalogRes.data.cameraPresets) && catalogRes.data.cameraPresets.length >= 20,
  );
  assert.ok(Array.isArray(catalogRes.data.colorLooks) && catalogRes.data.colorLooks.length >= 10);
  assert.ok(
    Array.isArray(catalogRes.data.captionStyles) && catalogRes.data.captionStyles.length >= 6,
  );
  assert.ok(Array.isArray(catalogRes.data.sfxCatalog) && catalogRes.data.sfxCatalog.length >= 12);
  assert.ok(Array.isArray(catalogRes.data.archetypes) && catalogRes.data.archetypes.length >= 8);

  // 5. Project Creation, Activation, Brief, Folder Scan/Import, Upload & Reference Links
  const createRes = await requestJson(baseUrl, "/api/projects", {
    method: "POST",
    body: {
      slug: testSlug,
      title: "E2E Director Cinema Test",
      aspectRatio: "9:16",
      durationSeconds: 12,
      language: "English",
      instructions: "High-contrast product launch promo",
    },
  });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.data.project.slug, testSlug);

  const listProjRes = await requestJson(baseUrl, "/api/projects");
  assert.equal(listProjRes.status, 200);
  assert.ok(listProjRes.data.projects.some((p) => p.slug === testSlug));

  const actRes = await requestJson(baseUrl, `/api/projects/${testSlug}/activate`, {
    method: "POST",
  });
  assert.equal(actRes.status, 200);
  assert.equal(actRes.data.activeProject, testSlug);

  const briefRes = await requestJson(baseUrl, `/api/projects/${testSlug}/brief`, {
    method: "POST",
    body: {
      title: "E2E Director Cinema Pro",
      instructions: "Heading Font: Space Grotesk. Fast kinetic transitions.",
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#F1C40F",
        background: "#0A1612",
      },
    },
  });
  assert.equal(briefRes.status, 200);
  assert.equal(briefRes.data.project.title, "E2E Director Cinema Pro");
  assert.match(briefRes.data.aiReadyPrompt, /E2E Director Cinema Pro/);

  const fixtures = await generateSyntheticFixtures(tempExtDir);

  const scanRes = await requestJson(baseUrl, `/api/projects/${testSlug}/scan-folder`, {
    method: "POST",
    body: { folderPath: tempExtDir, recursive: true },
  });
  assert.equal(scanRes.status, 200);
  assert.equal(scanRes.data.ok, true);
  assert.ok(scanRes.data.totalFiles >= 4);
  assert.equal(scanRes.data.counts.video, 2);

  const importRes = await requestJson(baseUrl, `/api/projects/${testSlug}/import-folder`, {
    method: "POST",
    body: {
      folderPath: tempExtDir,
      category: "auto",
      selectedFiles: ["sample_raw.mp4", "brand_logo.png", "brand_guide.md"],
      recursive: true,
    },
  });
  assert.equal(importRes.status, 200);
  assert.equal(importRes.data.importedCount, 3);
  assert.ok(fs.existsSync(fixtures.rawVideoPath), "External source file must remain untouched");

  // Binary upload of inspiration video
  const inspBuffer = fs.readFileSync(fixtures.inspVideoPath);
  const uploadRes = await requestJson(
    baseUrl,
    `/api/projects/${testSlug}/upload?category=inspiration&filename=insp_reel.mp4`,
    {
      method: "POST",
      body: inspBuffer,
      headers: { "Content-Type": "application/octet-stream" },
    },
  );
  assert.equal(uploadRes.status, 200);
  assert.equal(uploadRes.data.category, "inspiration");

  // Reference link add & delete
  const refUrlRes = await requestJson(baseUrl, `/api/projects/${testSlug}/ingest-url`, {
    method: "POST",
    body: {
      url: "https://example.com/higgsfield-ref",
      category: "inspiration",
      download: false,
      title: "Higgsfield Ref",
    },
  });
  assert.equal(refUrlRes.status, 200);
  assert.equal(refUrlRes.data.project.referenceLinks.length, 1);

  const delRefRes = await requestJson(baseUrl, `/api/projects/${testSlug}/reference-link`, {
    method: "DELETE",
    body: { url: "https://example.com/higgsfield-ref" },
  });
  assert.equal(delRefRes.status, 200);
  assert.equal(delRefRes.data.project.referenceLinks.length, 0);

  // 6. Media Intelligence Routes (analyze-raw, analyze-inspiration, extract-brand)
  const rawAnRes = await requestJson(baseUrl, `/api/projects/${testSlug}/analyze-raw`, {
    method: "POST",
    body: { targetScenes: 2 },
  });
  assert.equal(rawAnRes.status, 200);
  assert.equal(rawAnRes.data.ok, true);
  assert.ok(Array.isArray(rawAnRes.data.analysis.scenes));
  assert.ok(rawAnRes.data.analysis.scenes.length >= 1);
  const firstKfRel = rawAnRes.data.analysis.scenes[0].keyframes.start;
  assert.ok(
    !path.isAbsolute(firstKfRel) && firstKfRel.includes(".studio/frames/raw/"),
    `Expected project-relative POSIX keyframe path, got: ${firstKfRel}`,
  );
  assert.ok(fs.existsSync(path.join(testProjectDir, ".studio", "raw-analysis.json")));

  // Verify /media/:slug/... serves extracted PNG with HTTP 200 & Range 206
  const mediaUrl = rawAnRes.data.analysis.scenes[0].keyframeUrls.start;
  assert.ok(mediaUrl.startsWith(`/media/${testSlug}/`));
  const imgGet = await fetch(`${baseUrl}${mediaUrl}`);
  assert.equal(imgGet.status, 200);
  assert.equal(imgGet.headers.get("content-type"), "image/png");

  const imgRange = await fetch(`${baseUrl}${mediaUrl}`, {
    headers: { Range: "bytes=0-7" },
  });
  assert.equal(imgRange.status, 206);
  const pngHeader = Buffer.from(await imgRange.arrayBuffer());
  assert.equal(pngHeader.length, 8);

  const inspAnRes = await requestJson(baseUrl, `/api/projects/${testSlug}/analyze-inspiration`, {
    method: "POST",
    body: {},
  });
  assert.equal(inspAnRes.status, 200);
  assert.ok(inspAnRes.data.inspirationProfile.pacing);
  assert.ok(Array.isArray(inspAnRes.data.inspirationProfile.styleFrames));
  assert.ok(inspAnRes.data.project.inspirationProfile);

  const brandExRes = await requestJson(baseUrl, `/api/projects/${testSlug}/extract-brand`, {
    method: "POST",
    body: {},
  });
  assert.equal(brandExRes.status, 200);
  assert.equal(brandExRes.data.extracted.fonts.heading, "Space Grotesk");
  assert.ok(Array.isArray(brandExRes.data.project.brandKit.extractedPalette));

  // 7. Storyboard Generate (including auto analyze-raw when cache missing), Inspect, Update, Regenerate, Revert & Approve-All
  const rawCacheFile = path.join(testProjectDir, ".studio", "raw-analysis.json");
  fs.unlinkSync(rawCacheFile);
  assert.equal(fs.existsSync(rawCacheFile), false);

  const sbGenRes = await requestJson(baseUrl, `/api/projects/${testSlug}/storyboard/generate`, {
    method: "POST",
    body: {
      targetScenes: 2,
      globalPrompt: "crash zoom device showcase",
      preserveLocked: true,
    },
  });
  assert.equal(sbGenRes.status, 200);
  assert.ok(fs.existsSync(rawCacheFile), "storyboard/generate should auto-run analyze-raw");
  assert.equal(sbGenRes.data.storyboard.frames.length, 2);
  const f1 = sbGenRes.data.storyboard.frames[0];
  assert.ok(f1.designFrameUrl.startsWith(`/media/${testSlug}/`));
  assert.ok(f1.hudFrameUrl.startsWith(`/media/${testSlug}/`));
  assert.equal(f1.currentDesignImage, f1.designFrameUrl);
  assert.equal(f1.currentBlueprintImage, f1.hudFrameUrl);

  await sse.waitForEvent(
    (e) => e.event === "storyboard_updated" || e.event === "storyboard-updated",
  );

  // GET /api/projects/:slug & GET /api/projects/:slug/storyboard
  const projDetailRes = await requestJson(baseUrl, `/api/projects/${testSlug}`);
  assert.equal(projDetailRes.status, 200);
  assert.equal(projDetailRes.data.storyboard.frames.length, 2);
  assert.equal(projDetailRes.data.motionPresets.length, 8);
  assert.equal(projDetailRes.data.layoutArchetypes.length, 6);
  assert.ok(Array.isArray(projDetailRes.data.tickets));
  assert.equal(projDetailRes.data.agentCrew.agents.length, 6);

  const getSbRes = await requestJson(baseUrl, `/api/projects/${testSlug}/storyboard`);
  assert.equal(getSbRes.status, 200);
  assert.equal(getSbRes.data.storyboard.frames.length, 2);

  // Regenerate frame_01 -> v2
  const regenRes = await requestJson(
    baseUrl,
    `/api/projects/${testSlug}/storyboard/frames/frame_01/regenerate`,
    {
      method: "POST",
      body: {
        prompt: "spotlight cursor 2x faster",
        motionPreset: "spotlight-cursor-follow",
      },
    },
  );
  assert.equal(regenRes.status, 200);
  assert.equal(regenRes.data.frame.currentVersion, 2);
  assert.ok(regenRes.data.frame.currentDesignImage.startsWith(`/media/${testSlug}/`));

  // PATCH frame_01 adjustments + revertToVersion 1
  const patchRes = await requestJson(
    baseUrl,
    `/api/projects/${testSlug}/storyboard/frames/frame_01`,
    {
      method: "PATCH",
      body: {
        title: "Updated Hook Shot",
        staging: { headline: "Zero-Touch Launch" },
      },
    },
  );
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.data.frame.staging.headline, "Zero-Touch Launch");

  const revertRes = await requestJson(
    baseUrl,
    `/api/projects/${testSlug}/storyboard/frames/frame_01`,
    {
      method: "PATCH",
      body: { revertToVersion: 1 },
    },
  );
  assert.equal(revertRes.status, 200);
  assert.equal(revertRes.data.frame.currentVersion, 1);

  // Approve & lock all shots
  const approveAllRes = await requestJson(
    baseUrl,
    `/api/projects/${testSlug}/storyboard/approve-all`,
    {
      method: "POST",
      body: { locked: true, approved: true },
    },
  );
  assert.equal(approveAllRes.status, 200);
  assert.equal(approveAllRes.data.storyboard.lockedCount, 2);
  assert.ok(approveAllRes.data.storyboard.frames.every((f) => f.locked && f.approved));

  // 8. Agent Queue Dispatch + $0 Guard Enforcement
  const paidTicketRes = await requestJson(baseUrl, `/api/projects/${testSlug}/agent-queue`, {
    method: "POST",
    body: { type: "ai_storyboard_direct", payload: { forcePaidApi: true } },
  });
  assert.ok(paidTicketRes.status === 403 || paidTicketRes.status === 400);

  const ticketRes = await requestJson(baseUrl, `/api/projects/${testSlug}/agent-queue`, {
    method: "POST",
    body: {
      type: "ai_storyboard_direct",
      payload: { prompt: "Refine camera pacing", targetScenes: 2 },
    },
  });
  assert.equal(ticketRes.status, 200);
  assert.equal(ticketRes.data.ticket.type, "ai_storyboard_direct");
  assert.equal(ticketRes.data.tickets.length, 1);

  const getQueueRes = await requestJson(baseUrl, `/api/projects/${testSlug}/agent-queue`);
  assert.equal(getQueueRes.status, 200);
  assert.equal(getQueueRes.data.tickets.length, 1);

  // 9. Pro Project Route via server.mjs (preview-sfx)
  const sfxRes = await requestJson(baseUrl, `/api/projects/${testSlug}/preview-sfx`, {
    method: "POST",
    body: { sfxId: "ui-pop" },
  });
  assert.equal(sfxRes.status, 200);
  assert.equal(sfxRes.data.ok, true);

  // 10. Async Video Compilation Job (HTTP 202 + Job Polling + Lint & Headless Check Gate)
  const compileStartRes = await requestJson(baseUrl, `/api/projects/${testSlug}/generate-video`, {
    method: "POST",
    body: {
      resolution: "720p",
      aspectRatio: "9:16",
      fps: 24,
      quality: "draft",
      captionsMode: "kinetic",
      includeVoiceover: false,
      includeBgm: false,
      renderVideo: false,
    },
  });
  assert.equal(compileStartRes.status, 202);
  assert.equal(compileStartRes.data.ok, true);
  const jobId = compileStartRes.data.job.id;
  assert.ok(jobId);

  let finalJob = null;
  const pollDeadline = Date.now() + 45000;
  while (Date.now() < pollDeadline) {
    const jobRes = await requestJson(baseUrl, `/api/jobs/${jobId}`);
    assert.equal(jobRes.status, 200);
    if (jobRes.data.job.status !== "running") {
      finalJob = jobRes.data.job;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(finalJob, "Compilation job did not complete within 45s");
  assert.equal(
    finalJob.status,
    "done",
    `Expected compile job done, got ${finalJob.status}: ${finalJob.output}`,
  );
  assert.equal(finalJob.exitCode, 0);

  // 11. CLI Ingest --status verification
  const cliStatus = await runCommand(
    "node",
    ["studio-hub/cli-ingest.mjs", "--status", "--project", testSlug],
    { cwd: ROOT_DIR, shell: false },
  );
  assert.equal(cliStatus.code, 0, `cli-ingest --status failed: ${cliStatus.stderr}`);
  const cliParsed = JSON.parse(cliStatus.stdout);
  assert.equal(cliParsed.activeProject, testSlug);

  // 12. File Deletion & Path Traversal Guard
  const badDelRes = await requestJson(baseUrl, `/api/projects/${testSlug}/file`, {
    method: "DELETE",
    body: { relPath: "../outside.txt" },
  });
  assert.equal(badDelRes.status, 400);

  const okDelRes = await requestJson(baseUrl, `/api/projects/${testSlug}/file`, {
    method: "DELETE",
    body: { relPath: "inbox/inspiration/insp_reel.mp4" },
  });
  assert.equal(okDelRes.status, 200);
});

test("bootstrapServer binds cleanly to dynamic port 0 and shuts down without leaking timers", async () => {
  const boot = await bootstrapServer({
    port: 0,
    host: "127.0.0.1",
    enableDropWatcher: false,
    syncOnStart: false,
  });
  try {
    assert.ok(boot.port > 0);
    const res = await requestJson(`http://127.0.0.1:${boot.port}`, "/api/provider-settings");
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
  } finally {
    await new Promise((resolve) => boot.server.close(() => resolve()));
  }
});

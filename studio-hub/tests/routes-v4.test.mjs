import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { handleV4Routes } from "../routes-v4.mjs";

const TINY_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function createTempV4Project(t, slug = "v4-demo") {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-routes-v4-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const projectDir = path.join(tmpRoot, slug);
  const subdirs = [
    "assets/images",
    "assets/clips",
    "assets/audio",
    "output/thumbnails",
    ".studio/frames/raw",
    ".studio/frames/design",
    ".studio/variants",
    "skills/custom-motion",
  ];
  for (const rel of subdirs) {
    fs.mkdirSync(path.join(projectDir, rel), { recursive: true });
  }

  // Seed a real 1x1 PNG keyframe and design frame so subject-matte & thumbnails have real local files
  fs.writeFileSync(path.join(projectDir, ".studio/frames/raw/scene_01_peak.png"), TINY_PNG_BYTES);
  fs.writeFileSync(path.join(projectDir, ".studio/frames/design/frame_01_v1.png"), TINY_PNG_BYTES);
  fs.writeFileSync(
    path.join(projectDir, "skills/custom-motion/SKILL.md"),
    "---\nname: custom-motion\ndescription: Custom motion pack\n---\n\n- Snap cuts on 30fps grid\n",
    "utf8",
  );

  const brief = {
    slug,
    title: "Krishop Winter Launch",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 12,
    language: "Bengali",
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#FACC15",
      background: "#0A1410",
    },
  };
  fs.writeFileSync(
    path.join(projectDir, "PROJECT_BRIEF.json"),
    JSON.stringify(brief, null, 2) + "\n",
    "utf8",
  );

  const storyboard = {
    schemaVersion: 1,
    slug,
    title: brief.title,
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    frames: [
      {
        id: "frame_01",
        index: 1,
        sceneId: "scene_01",
        title: "Winter Seed Offer",
        layout: "device-3d-showcase",
        motionPreset: "crash-zoom-in",
        durationSeconds: 4.137,
        rawTimeRange: [0.04, 4.177],
        locked: false,
        designFramePath: ".studio/frames/design/frame_01_v1.png",
        hudFramePath: ".studio/frames/design/frame_01_v1.png",
        keyframes: {
          start: ".studio/frames/raw/scene_01_peak.png",
          peak: ".studio/frames/raw/scene_01_peak.png",
          end: ".studio/frames/raw/scene_01_peak.png",
        },
        cameraMotion: { focusX: 50, focusY: 36, fromScale: 1.0, toScale: 1.4 },
        staging: {
          headline: "কৃষপ ঝড়ো অফার",
          subheadline: "Free wholesale seed delivery",
          badgeText: "WINTER DEAL",
          captionText: "কৃষপ থেকে সরাসরি বীজ অর্ডার করুন",
        },
        audioSpec: {
          voiceoverText: "কৃষপ থেকে সরাসরি বীজ অর্ডার করুন",
        },
      },
      {
        id: "frame_02",
        index: 2,
        sceneId: "scene_02",
        title: "Express Checkout",
        layout: "kinetic-statement-card",
        motionPreset: "editorial-kinetic-card",
        durationSeconds: 3.829,
        rawTimeRange: [4.177, 8.006],
        locked: true,
        designFramePath: ".studio/frames/design/frame_01_v1.png",
        hudFramePath: ".studio/frames/design/frame_01_v1.png",
        keyframes: {
          start: ".studio/frames/raw/scene_01_peak.png",
          peak: ".studio/frames/raw/scene_01_peak.png",
          end: ".studio/frames/raw/scene_01_peak.png",
        },
        cameraMotion: { focusX: 50, focusY: 48, fromScale: 1.0, toScale: 1.15 },
        staging: {
          headline: "Order Now",
          subheadline: "100% Free Delivery",
          badgeText: "CTA",
          captionText: "Order today for free wholesale delivery.",
        },
        audioSpec: {
          voiceoverText: "Order today for free wholesale delivery.",
        },
      },
    ],
  };
  fs.writeFileSync(
    path.join(projectDir, "STORYBOARD.json"),
    JSON.stringify(storyboard, null, 2) + "\n",
    "utf8",
  );

  return { tmpRoot, projectDir, slug, brief, storyboard };
}

async function startEphemeralV4Server(t, depsFactory) {
  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const deps = typeof depsFactory === "function" ? depsFactory() : depsFactory;
    const handled = await handleV4Routes(req, res, urlObj, deps);
    if (!handled && !res.headersSent) {
      res.writeHead(418, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, passthrough: true, path: urlObj.pathname }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function sendHttpJson(baseUrl, method, urlPath, body) {
  const headers = {};
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: payload,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

test("routes-v4 — non-matching routes return false without touching res, and wrong HTTP methods return 405", async (t) => {
  const { tmpRoot, slug } = createTempV4Project(t);

  const rawReq = Readable.from([]);
  rawReq.method = "GET";
  rawReq.url = "/api/status";
  rawReq.headers = { host: "127.0.0.1" };
  let touched = false;
  const mockRes = {
    headersSent: false,
    writeHead() {
      touched = true;
    },
    write() {
      touched = true;
    },
    end() {
      touched = true;
    },
  };
  const directHandled = await handleV4Routes(
    rawReq,
    mockRes,
    new URL("http://127.0.0.1/api/status"),
    { projectsDir: tmpRoot },
  );
  assert.equal(directHandled, false);
  assert.equal(touched, false);

  const { baseUrl } = await startEphemeralV4Server(t, { projectsDir: tmpRoot });

  for (const [method, route] of [
    ["GET", "/api/status"],
    ["GET", "/api/skills"],
    ["POST", `/api/projects/${slug}/rating`],
    ["POST", `/api/projects/${slug}/voice-sync`],
  ]) {
    const res = await sendHttpJson(baseUrl, method, route, method === "GET" ? undefined : {});
    assert.equal(res.status, 418, `Expected ${method} ${route} to fall through`);
    assert.equal(res.json.passthrough, true);
  }

  for (const [method, route] of [
    ["GET", `/api/projects/${slug}/beat-quantize`],
    ["GET", `/api/projects/${slug}/subject-matte`],
    ["DELETE", `/api/projects/${slug}/smart-reframe`],
    ["GET", `/api/projects/${slug}/subtitles-export`],
    ["GET", `/api/projects/${slug}/thumbnails-generate`],
    ["DELETE", `/api/projects/${slug}/localized-variants`],
    ["GET", "/api/skill-bundles/export"],
    ["GET", "/api/skill-bundles/import"],
  ]) {
    const res = await sendHttpJson(baseUrl, method, route);
    assert.equal(res.status, 405, `Expected 405 for ${method} ${route}`);
    assert.equal(res.json.ok, false);
  }
});

test("Storyboard Pro Tools: POST /beat-quantize, POST /subject-matte, and POST /smart-reframe", async (t) => {
  const { tmpRoot, slug } = createTempV4Project(t);
  const sseEvents = [];
  let matteCalledArgs = null;

  const { baseUrl } = await startEphemeralV4Server(t, {
    projectsDir: tmpRoot,
    broadcastEvent(event, payload) {
      sseEvents.push({ event, payload });
    },
    beatQuantizer: {
      async quantizeStoryboardToBeats({ slug: s, storyboard, fps, maxSnapSec }) {
        assert.equal(s, slug);
        assert.equal(fps, 30);
        assert.equal(maxSnapSec, 0.35);
        const nextFrames = storyboard.frames.map((f) =>
          f.locked ? f : { ...f, durationSeconds: 4.1333 },
        );
        return {
          snappedCount: 1,
          bpm: 128,
          beats: [0.5, 1.0, 4.1333],
          storyboard: { ...storyboard, frames: nextFrames },
        };
      },
    },
    subjectMatte: {
      async extractSubjectForegroundMatte(args) {
        matteCalledArgs = args;
        return {
          matteRelPath: "assets/images/matte_scene_01_peak.png",
          width: 1080,
          height: 1920,
          method: "opencv-grabcut",
        };
      },
    },
    smartReframe: {
      REFRAME_TARGETS: {
        "9:16": { width: 1080, height: 1920 },
        "16:9": { width: 1920, height: 1080 },
        "1:1": { width: 1080, height: 1080 },
        "4:5": { width: 1080, height: 1350 },
      },
      async computeSmartReframePlan({ storyboard, targetAspect }) {
        const dims =
          targetAspect === "16:9"
            ? { width: 1920, height: 1080 }
            : targetAspect === "1:1"
              ? { width: 1080, height: 1080 }
              : { width: 1080, height: 1920 };
        return {
          targetAspect,
          ...dims,
          shots: storyboard.frames.map((f) => ({
            frameId: f.id,
            focusX: f.cameraMotion?.focusX ?? 50,
            focusY: 28,
            scale: 1.18,
            ...dims,
          })),
        };
      },
    },
  });

  // 1. POST /beat-quantize
  const beatRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/beat-quantize`, {});
  assert.equal(beatRes.status, 200);
  assert.equal(beatRes.json.ok, true);
  assert.equal(beatRes.json.snappedCount, 1);
  assert.equal(beatRes.json.bpm, 128);
  assert.equal(
    beatRes.json.storyboard.frames[0].designFrameUrl,
    `/media/${slug}/.studio/frames/design/frame_01_v1.png`,
  );
  assert.ok(sseEvents.some((e) => e.event === "storyboard_updated"));

  // 2. POST /subject-matte (zero-arg auto-picks hero/raw keyframe PNG in project!)
  const matteRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/subject-matte`, {});
  assert.equal(matteRes.status, 200);
  assert.equal(matteRes.json.ok, true);
  assert.ok(matteCalledArgs.imagePath.endsWith("scene_01_peak.png"));
  assert.equal(matteRes.json.matteUrl, `/media/${slug}/assets/images/matte_scene_01_peak.png`);
  assert.equal(matteRes.json.url, `/media/${slug}/assets/images/matte_scene_01_peak.png`);

  // 3. POST /smart-reframe (returns primary targetAspect plan + multi-format 9:16, 16:9, 1:1 previews)
  const reframeRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/smart-reframe`, {
    targetAspect: "16:9",
  });
  assert.equal(reframeRes.status, 200);
  assert.equal(reframeRes.json.ok, true);
  assert.equal(reframeRes.json.targetAspect, "16:9");
  assert.equal(reframeRes.json.plan.width, 1920);
  assert.equal(reframeRes.json.plan.shots.length, 2);
  assert.ok(reframeRes.json.formats["9:16"]);
  assert.ok(reframeRes.json.formats["16:9"]);
  assert.ok(reframeRes.json.formats["1:1"]);
});

test("Export Pro Tools: POST /subtitles-export, POST /thumbnails-generate, and POST /localized-variants", async (t) => {
  const { tmpRoot, slug } = createTempV4Project(t);

  const { baseUrl } = await startEphemeralV4Server(t, {
    projectsDir: tmpRoot,
    subtitleExporter: {
      async writeProjectSubtitles({ slug: s, formats }) {
        assert.equal(s, slug);
        return {
          files: formats.map((fmt) => ({
            format: fmt,
            relPath: `output/${slug}_subtitles.${fmt}`,
            cueCount: 2,
          })),
        };
      },
    },
    thumbnailAbGen: {
      async generateThumbnailAbVariants({ slug: s }) {
        assert.equal(s, slug);
        return {
          variants: [
            { id: "A", label: "Hook Close-up", relPath: "output/thumbnails/variant_a_hook.png" },
            { id: "B", label: "Editorial Split", relPath: "output/thumbnails/variant_b_split.png" },
            {
              id: "C",
              label: "Product Spotlight",
              relPath: "output/thumbnails/variant_c_spotlight.png",
            },
          ],
        };
      },
    },
    localBatchRunner: {
      async buildLocalizedAdVariantsPlan({ slug: s, languages }) {
        assert.equal(s, slug);
        return {
          variants: languages.map((lang) => ({
            language: lang,
            code: lang.toLowerCase().slice(0, 2),
            relPath: `.studio/variants/variant_${lang.toLowerCase()}.json`,
            shotCount: 2,
          })),
        };
      },
    },
  });

  // 4. POST /subtitles-export -> /media/:slug/output/... URLs for .srt, .vtt, .ass
  const subRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/subtitles-export`, {});
  assert.equal(subRes.status, 200);
  assert.equal(subRes.json.ok, true);
  assert.equal(subRes.json.files.length, 3);
  assert.equal(subRes.json.urls.srt, `/media/${slug}/output/${slug}_subtitles.srt`);
  assert.equal(subRes.json.urls.vtt, `/media/${slug}/output/${slug}_subtitles.vtt`);
  assert.equal(subRes.json.urls.ass, `/media/${slug}/output/${slug}_subtitles.ass`);
  assert.equal(subRes.json.srtUrl, `/media/${slug}/output/${slug}_subtitles.srt`);

  // 5. POST /thumbnails-generate -> /media/:slug/output/thumbnails/... URLs
  const thumbRes = await sendHttpJson(
    baseUrl,
    "POST",
    `/api/projects/${slug}/thumbnails-generate`,
    {},
  );
  assert.equal(thumbRes.status, 200);
  assert.equal(thumbRes.json.ok, true);
  assert.equal(thumbRes.json.thumbnails.length, 3);
  assert.equal(
    thumbRes.json.thumbnails[0].url,
    `/media/${slug}/output/thumbnails/variant_a_hook.png`,
  );
  assert.equal(
    thumbRes.json.variants[2].imageUrl,
    `/media/${slug}/output/thumbnails/variant_c_spotlight.png`,
  );

  // 6. POST /localized-variants
  const locRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/localized-variants`, {
    languages: ["Bengali", "English", "Hindi"],
  });
  assert.equal(locRes.status, 200);
  assert.equal(locRes.json.ok, true);
  assert.equal(locRes.json.variants.length, 3);
  assert.equal(locRes.json.variants[0].url, `/media/${slug}/.studio/variants/variant_bengali.json`);
});

test("Portable Skill Bundles: POST /api/skill-bundles/export and POST /api/skill-bundles/import", async (t) => {
  const { tmpRoot, slug } = createTempV4Project(t);

  const { baseUrl } = await startEphemeralV4Server(t, {
    projectsDir: tmpRoot,
    skillBundles: {
      async exportSkillBundle({ skillIds, slug: s }) {
        return {
          schemaVersion: 1,
          format: "studioskills-v1",
          slug: s,
          skills: skillIds.map((id) => ({
            id,
            name: id,
            skillMd: `---\nname: ${id}\n---\n# ${id}\n`,
            references: {},
          })),
        };
      },
      async importSkillBundle({ bundleDataOrPath, targetScope, slug: s }) {
        const list = bundleDataOrPath.skills || [];
        return {
          targetScope,
          slug: s,
          importedSkills: list.map((item) => ({
            id: item.id,
            name: item.name || item.id,
            installed: true,
          })),
        };
      },
    },
  });

  const exportRes = await sendHttpJson(baseUrl, "POST", "/api/skill-bundles/export", {
    skillIds: ["motion-doctrine", "seam-craft"],
    slug,
  });
  assert.equal(exportRes.status, 200);
  assert.equal(exportRes.json.ok, true);
  assert.equal(exportRes.json.bundle.skills.length, 2);

  const importRes = await sendHttpJson(baseUrl, "POST", "/api/skill-bundles/import", {
    bundleDataOrPath: exportRes.json.bundle,
    targetScope: "project",
    slug,
  });
  assert.equal(importRes.status, 200);
  assert.equal(importRes.json.ok, true);
  assert.equal(importRes.json.importedSkills.length, 2);
  assert.equal(importRes.json.importedSkills[0].id, "motion-doctrine");
});

test("Graceful DI fallbacks work end-to-end when peer Wave 6 modules are unavailable", async (t) => {
  const { tmpRoot, projectDir, slug } = createTempV4Project(t);

  const { baseUrl } = await startEphemeralV4Server(t, {
    projectsDir: tmpRoot,
    async importModule(specifier) {
      throw new Error(`Simulated unavailable module: ${specifier}`);
    },
  });

  // Fallback beat-quantize snaps unlocked shot durations to 1/30s frame grid
  const beatRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/beat-quantize`, {
    fps: 30,
  });
  assert.equal(beatRes.status, 200);
  assert.equal(beatRes.json.ok, true);
  assert.ok(beatRes.json.snappedCount >= 1);

  // Fallback smart-reframe computes multi-aspect crop geometry
  const reframeRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/smart-reframe`, {});
  assert.equal(reframeRes.status, 200);
  assert.equal(reframeRes.json.ok, true);
  assert.equal(reframeRes.json.formats["16:9"].width, 1920);
  assert.equal(reframeRes.json.formats["1:1"].height, 1080);

  // Fallback subtitles-export writes UTF-8 Bengali/English .srt, .vtt, .ass files into output/
  const subRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/subtitles-export`, {});
  assert.equal(subRes.status, 200);
  assert.equal(subRes.json.ok, true);
  assert.ok(subRes.json.urls.srt.startsWith(`/media/${slug}/output/`));
  const srtOnDisk = fs.readFileSync(
    path.join(projectDir, subRes.json.files.find((f) => f.format === "srt").relPath),
    "utf8",
  );
  assert.ok(srtOnDisk.includes("কৃষপ"), "Fallback SRT must preserve Bengali UTF-8 script");

  // Fallback thumbnails-generate writes 3 cover PNGs into output/thumbnails/
  const thumbRes = await sendHttpJson(
    baseUrl,
    "POST",
    `/api/projects/${slug}/thumbnails-generate`,
    {},
  );
  assert.equal(thumbRes.status, 200);
  assert.equal(thumbRes.json.thumbnails.length, 3);
  assert.ok(
    fs.existsSync(path.join(projectDir, thumbRes.json.thumbnails[0].relPath)),
    "Fallback thumbnail PNG must exist on disk",
  );

  // Fallback localized-variants writes Bengali/English/Hindi plans in .studio/variants/
  const locRes = await sendHttpJson(
    baseUrl,
    "POST",
    `/api/projects/${slug}/localized-variants`,
    {},
  );
  assert.equal(locRes.status, 200);
  assert.equal(locRes.json.variants.length, 3);

  // Fallback subject-matte produces assets/images/matte_*.png
  const matteRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/subject-matte`, {});
  assert.equal(matteRes.status, 200);
  assert.ok(matteRes.json.matteUrl.startsWith(`/media/${slug}/assets/images/matte_`));

  // Fallback skill-bundles export & import round-trip inside isolated temp project
  const expRes = await sendHttpJson(baseUrl, "POST", "/api/skill-bundles/export", {
    skillIds: ["custom-motion"],
    slug,
  });
  assert.equal(expRes.status, 200);
  assert.equal(expRes.json.bundle.skills[0].id, "custom-motion");

  const impRes = await sendHttpJson(baseUrl, "POST", "/api/skill-bundles/import", {
    bundleDataOrPath: {
      skills: [
        {
          id: "imported-pro-skill",
          name: "imported-pro-skill",
          skillMd: "---\nname: imported-pro-skill\n---\n- Crisp cuts\n",
        },
      ],
    },
    targetScope: "project",
    slug,
  });
  assert.equal(impRes.status, 200);
  assert.equal(impRes.json.importedSkills[0].id, "imported-pro-skill");
  assert.ok(
    fs.existsSync(path.join(projectDir, "skills/imported-pro-skill/SKILL.md")),
    "Fallback bundle import must materialize SKILL.md inside project skills dir",
  );
});

test("Path-traversal rejection, invalid inputs, missing project 404, and lazy import verification across all V4 routes", async (t) => {
  const { tmpRoot, slug } = createTempV4Project(t);
  const importedSpecifiers = [];

  const { baseUrl } = await startEphemeralV4Server(t, {
    projectsDir: tmpRoot,
    async importModule(specifier) {
      importedSpecifiers.push(specifier);
      if (specifier === "./beat-quantizer.mjs") {
        return {
          quantizeStoryboardToBeats: async ({ storyboard }) => ({ snappedCount: 0, storyboard }),
        };
      }
      if (specifier === "./subject-matte.mjs") {
        return {
          extractSubjectForegroundMatte: async () => ({
            matteRelPath: "assets/images/matte_lazy.png",
          }),
        };
      }
      if (specifier === "./smart-reframe.mjs") {
        return {
          computeSmartReframePlan: async ({ targetAspect }) => ({
            targetAspect,
            width: 1920,
            height: 1080,
            shots: [],
          }),
        };
      }
      if (specifier === "./subtitle-exporter.mjs") {
        return {
          writeProjectSubtitles: async () => ({
            files: [{ format: "srt", relPath: "output/lazy.srt" }],
          }),
        };
      }
      if (specifier === "./thumbnail-ab-gen.mjs") {
        return {
          generateThumbnailAbVariants: async () => ({
            variants: [{ id: "A", relPath: "output/thumbnails/variant_a_hook.png" }],
          }),
        };
      }
      if (specifier === "./local-batch-runner.mjs") {
        return {
          buildLocalizedAdVariantsPlan: async () => ({
            variants: [{ language: "Bengali", relPath: ".studio/variants/variant_bn.json" }],
          }),
        };
      }
      if (specifier === "./skill-bundles.mjs") {
        return {
          exportSkillBundle: async () => ({ skills: [] }),
          importSkillBundle: async () => ({ importedSkills: [] }),
        };
      }
      throw new Error(`Unexpected specifier: ${specifier}`);
    },
  });

  const traversalCases = [
    ["POST", "/api/projects/..%2Fescape/beat-quantize", {}],
    ["POST", `/api/projects/${slug}/beat-quantize`, { audioPath: "../../etc/passwd" }],
    ["POST", `/api/projects/${slug}/subject-matte`, { imagePath: "../../secret.png" }],
    ["POST", `/api/projects/${slug}/subject-matte`, { outRelPath: "../outside.png" }],
    ["POST", `/api/projects/${slug}/smart-reframe`, { targetAspect: "invalid-aspect" }],
    ["POST", `/api/projects/${slug}/subtitles-export`, { formats: ["../evil"] }],
    ["POST", `/api/projects/${slug}/localized-variants`, { languages: ["../evil"] }],
    ["POST", "/api/skill-bundles/export", { skillIds: ["../evil"] }],
    [
      "POST",
      "/api/skill-bundles/export",
      { skillIds: ["safe-id"], outFilePath: "../../evil.json" },
    ],
    [
      "POST",
      "/api/skill-bundles/export",
      { skillIds: ["safe-id"], outFilePath: "C:\\Windows\\System32\\evil.json" },
    ],
    ["POST", "/api/skill-bundles/import", { bundleDataOrPath: "../../etc/passwd" }],
    ["POST", "/api/skill-bundles/import", { bundleDataOrPath: "C:\\Windows\\win.ini" }],
    [
      "POST",
      "/api/skill-bundles/import",
      { bundleDataOrPath: { skills: [{ id: "../evil", skillMd: "# x" }] } },
    ],
    [
      "POST",
      "/api/skill-bundles/import",
      {
        bundleDataOrPath: {
          skills: [
            {
              id: "safe-skill",
              skillMd: "# x",
              references: { "../../escape.md": "bad" },
            },
          ],
        },
      },
    ],
  ];

  for (const [method, urlPath, body] of traversalCases) {
    const res = await sendHttpJson(baseUrl, method, urlPath, body);
    assert.equal(res.status, 400, `Expected 400 rejection for ${method} ${urlPath}`);
    assert.equal(res.json.ok, false);
  }

  // Missing project -> 404
  const missingRes = await sendHttpJson(
    baseUrl,
    "POST",
    "/api/projects/missing-v4-project/beat-quantize",
    {},
  );
  assert.equal(missingRes.status, 404);
  assert.equal(missingRes.json.ok, false);

  // Trigger all 7 lazy module imports
  await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/beat-quantize`, {});
  await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/subject-matte`, {});
  await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/smart-reframe`, {});
  await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/subtitles-export`, {});
  await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/thumbnails-generate`, {});
  await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/localized-variants`, {});
  await sendHttpJson(baseUrl, "POST", "/api/skill-bundles/export", {
    skillIds: ["motion-doctrine"],
  });
  await sendHttpJson(baseUrl, "POST", "/api/skill-bundles/import", {
    bundleDataOrPath: { skills: [] },
  });

  for (const expectedSpec of [
    "./beat-quantizer.mjs",
    "./subject-matte.mjs",
    "./smart-reframe.mjs",
    "./subtitle-exporter.mjs",
    "./thumbnail-ab-gen.mjs",
    "./local-batch-runner.mjs",
    "./skill-bundles.mjs",
  ]) {
    assert.ok(importedSpecifiers.includes(expectedSpec), `Expected lazy import of ${expectedSpec}`);
  }
});

test("Zero-mock live HTTP integration against real Wave 6 specialist modules in temp projectsDir", async (t) => {
  const { tmpRoot, slug } = createTempV4Project(t);
  const { baseUrl } = await startEphemeralV4Server(t, { projectsDir: tmpRoot });

  // 1. Live skill-bundles export of real workspace skill "motion-doctrine"
  const bundleRes = await sendHttpJson(baseUrl, "POST", "/api/skill-bundles/export", {
    skillIds: ["motion-doctrine"],
  });
  assert.equal(bundleRes.status, 200);
  assert.equal(bundleRes.json.ok, true);
  assert.equal(bundleRes.json.bundle.skills[0].id, "motion-doctrine");

  // 2. Live smart-reframe against real smart-reframe.mjs
  const reframeRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/smart-reframe`, {
    targetAspect: "16:9",
  });
  assert.equal(reframeRes.status, 200);
  assert.equal(reframeRes.json.plan.width, 1920);
  assert.equal(reframeRes.json.plan.height, 1080);

  // 3. Live subtitles-export against real subtitle-exporter.mjs
  const subRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/subtitles-export`, {
    formats: ["srt", "vtt", "ass"],
  });
  assert.equal(subRes.status, 200);
  assert.equal(subRes.json.files.length, 3);
  assert.ok(subRes.json.urls.srt.startsWith(`/media/${slug}/output/`));

  // 4. Live beat-quantize against real beat-quantizer.mjs
  const beatRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/beat-quantize`, {
    fps: 30,
  });
  assert.equal(beatRes.status, 200);
  assert.equal(beatRes.json.ok, true);
  assert.equal(beatRes.json.storyboard.frames[1].locked, true);

  // 5. Live localized-variants against real local-batch-runner.mjs
  const locRes = await sendHttpJson(baseUrl, "POST", `/api/projects/${slug}/localized-variants`, {
    languages: ["Bengali", "English", "Hindi"],
  });
  assert.equal(locRes.status, 200);
  assert.equal(locRes.json.variants.length, 3);
});

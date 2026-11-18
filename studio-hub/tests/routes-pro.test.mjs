import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  CURRENT_PROJECT_FILE,
  PROJECTS_DIR,
  ROOT_DIR,
  ensureProjectDirs,
  getToolEnv,
  runCommand,
  syncProjectManifest,
} from "../lib.mjs";
import { PROVIDER_SETTINGS_FILE, listAgentTasks } from "../agent-bridge.mjs";
import { FALLBACK_CATALOG, handleProRoutes } from "../routes-pro.mjs";

const CREW_STATE_FILE = path.join(ROOT_DIR, ".hyperframes", "agent-crew-state.json");

function snapshotOptionalFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

function restoreOptionalFile(filePath, snapshot) {
  if (snapshot === null) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, snapshot);
  }
}

async function invokeProRoute({ method = "GET", urlPath = "/", body = undefined, deps = {} }) {
  const rawPayload =
    body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const req = Readable.from(rawPayload ? [Buffer.from(rawPayload, "utf8")] : []);
  req.method = method;
  req.url = urlPath;
  req.headers = {
    host: "localhost:4400",
    ...(rawPayload ? { "content-type": "application/json" } : {}),
  };

  let statusCode = null;
  let headers = {};
  const chunks = [];
  let ended = false;

  const res = {
    headersSent: false,
    writeHead(code, hdrs = {}) {
      statusCode = code;
      headers = { ...hdrs };
      this.headersSent = true;
    },
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    end(chunk) {
      if (chunk !== undefined) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      ended = true;
      this.headersSent = true;
    },
  };

  const urlObj = new URL(urlPath, "http://localhost:4400");
  const handled = await handleProRoutes(req, res, urlObj, deps);
  const text = Buffer.concat(chunks).toString("utf8");
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return { handled, statusCode, headers, text, json, ended };
}

function createIsolatedProject(baseProjectsDir, slug = "pro-unit-proj") {
  const projectDir = path.join(baseProjectsDir, slug);
  const subdirs = [
    "assets/audio",
    "assets/clips",
    "assets/images",
    "compositions",
    ".studio/frames/raw",
    ".studio/frames/design",
    ".studio/agent-queue",
  ];
  for (const rel of subdirs) {
    fs.mkdirSync(path.join(projectDir, rel), { recursive: true });
  }
  const brief = {
    slug,
    title: "Pro Unit Project",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 12,
    language: "English",
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#F1C40F",
      background: "#0A1612",
    },
    brandKit: {
      logoRelPath: "assets/images/logo.png",
      guidelinesText: "High-contrast cinema botanical identity.",
      fonts: { heading: "Inter", body: "Inter" },
      tone: "Confident & Modern",
      extractedPalette: ["#1E824C", "#F1C40F"],
    },
  };
  fs.writeFileSync(
    path.join(projectDir, "PROJECT_BRIEF.json"),
    JSON.stringify(brief, null, 2) + "\n",
    "utf8",
  );
  return { slug, projectDir, brief };
}

test("routes-pro — non-pro routes return false without touching response, method/slug guards work", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-routes-pro-guard-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  createIsolatedProject(tmpRoot, "demo-app");

  const deps = { projectsDir: tmpRoot, syncManifest: false };

  const nonProRoot = await invokeProRoute({ method: "GET", urlPath: "/api/status", deps });
  assert.equal(nonProRoot.handled, false);
  assert.equal(nonProRoot.ended, false);

  const nonProProj = await invokeProRoute({
    method: "POST",
    urlPath: "/api/projects/demo-app/brief",
    body: { title: "Updated" },
    deps,
  });
  assert.equal(nonProProj.handled, false);
  assert.equal(nonProProj.ended, false);

  const wrongMethodCatalog = await invokeProRoute({
    method: "POST",
    urlPath: "/api/catalog/presets",
    body: {},
    deps,
  });
  assert.equal(wrongMethodCatalog.handled, true);
  assert.equal(wrongMethodCatalog.statusCode, 405);
  assert.equal(wrongMethodCatalog.json.ok, false);

  const invalidSlug = await invokeProRoute({
    method: "POST",
    urlPath: "/api/projects/..%2Fescape/preview-sfx",
    body: { sfxId: "ui-pop" },
    deps,
  });
  assert.equal(invalidSlug.handled, true);
  assert.equal(invalidSlug.statusCode, 400);
  assert.equal(invalidSlug.json.ok, false);

  const missingProject = await invokeProRoute({
    method: "POST",
    urlPath: "/api/projects/ghost-project/preview-sfx",
    body: { sfxId: "ui-pop" },
    deps,
  });
  assert.equal(missingProject.handled, true);
  assert.equal(missingProject.statusCode, 404);
  assert.equal(missingProject.json.ok, false);
});

test("GET /api/catalog/presets — graceful fallback when peer modules are missing and full merge when present", async () => {
  const brokenImporter = async (specifier) => {
    throw new Error(`Simulated mid-write module error for ${specifier}`);
  };

  const fallbackRes = await invokeProRoute({
    method: "GET",
    urlPath: "/api/catalog/presets",
    deps: { importModule: brokenImporter },
  });

  assert.equal(fallbackRes.handled, true);
  assert.equal(fallbackRes.statusCode, 200);
  assert.equal(fallbackRes.json.ok, true);
  assert.ok(
    Array.isArray(fallbackRes.json.cameraBodies) && fallbackRes.json.cameraBodies.length >= 6,
  );
  assert.ok(Array.isArray(fallbackRes.json.lenses) && fallbackRes.json.lenses.length >= 5);
  assert.ok(Array.isArray(fallbackRes.json.apertures) && fallbackRes.json.apertures.length >= 4);
  assert.ok(
    Array.isArray(fallbackRes.json.cameraPresets) && fallbackRes.json.cameraPresets.length >= 8,
  );
  assert.ok(Array.isArray(fallbackRes.json.colorLooks) && fallbackRes.json.colorLooks.length >= 10);
  assert.ok(
    Array.isArray(fallbackRes.json.captionStyles) && fallbackRes.json.captionStyles.length >= 6,
  );
  assert.ok(Array.isArray(fallbackRes.json.sfxCatalog) && fallbackRes.json.sfxCatalog.length >= 12);
  assert.ok(Array.isArray(fallbackRes.json.archetypes) && fallbackRes.json.archetypes.length >= 8);
  assert.ok(Array.isArray(FALLBACK_CATALOG.sfxCatalog));

  // Verify injected peer modules (supporting both Array and Object-map export styles)
  const injectedRes = await invokeProRoute({
    method: "GET",
    urlPath: "/api/catalog/presets",
    deps: {
      cameraRigs: {
        CAMERA_BODIES: { "kodak-35mm": { label: "Kodak 35mm", grain: 0.18 } },
        LENS_FOCAL_LENGTHS: [{ id: "50mm", perspectivePx: 1400 }],
        APERTURE_STOPS: [{ id: "f/1.4", blurBg: true }],
        DOP_CAMERA_PRESETS: [{ id: "crash-zoom-in", name: "Crash Zoom In" }],
      },
      colorGrade: {
        COLOR_LOOKS: [{ id: "teal-orange-cinema", name: "Teal & Orange" }],
      },
      captionsEngine: {
        CAPTION_STYLES: { "kinetic-gold-pop": { name: "Kinetic Gold Pop" } },
      },
      soundEngine: {
        SFX_CATALOG: [{ id: "cinema-whoosh", name: "Cinema Whoosh" }],
      },
      archetypePacks: [
        { ARCHETYPES: [{ id: "device-3d-showcase", name: "Device 3D Showcase" }] },
        { ARCHETYPES: [{ id: "before-after-wipe", name: "Before After Wipe" }] },
      ],
    },
  });

  assert.equal(injectedRes.statusCode, 200);
  assert.equal(injectedRes.json.cameraBodies[0].id, "kodak-35mm");
  assert.equal(injectedRes.json.lenses[0].id, "50mm");
  assert.equal(injectedRes.json.apertures[0].id, "f/1.4");
  assert.equal(injectedRes.json.cameraPresets[0].id, "crash-zoom-in");
  assert.equal(injectedRes.json.colorLooks[0].id, "teal-orange-cinema");
  assert.equal(injectedRes.json.captionStyles[0].id, "kinetic-gold-pop");
  assert.equal(injectedRes.json.sfxCatalog[0].id, "cinema-whoosh");
  assert.deepEqual(
    injectedRes.json.archetypes.map((a) => a.id),
    ["device-3d-showcase", "before-after-wipe"],
  );

  // Live workspace call with zero mocks
  const liveRes = await invokeProRoute({ method: "GET", urlPath: "/api/catalog/presets" });
  assert.equal(liveRes.statusCode, 200);
  assert.equal(liveRes.json.ok, true);
  assert.ok(liveRes.json.sfxCatalog.length >= 1);
});

test("POST /api/projects/:slug/preview-sfx — validates sfxId, synthesizes assets/audio/sfx_<sfxId>.mp3 & returns URL", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-routes-pro-sfx-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  const { slug, projectDir } = createIsolatedProject(tmpRoot, "sfx-proj");

  // Validation errors
  const missingId = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/preview-sfx`,
    body: {},
    deps: { projectsDir: tmpRoot, syncManifest: false },
  });
  assert.equal(missingId.statusCode, 400);

  const traversalId = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/preview-sfx`,
    body: { sfxId: "../hack" },
    deps: { projectsDir: tmpRoot, syncManifest: false },
  });
  assert.equal(traversalId.statusCode, 400);

  const unknownId = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/preview-sfx`,
    body: { sfxId: "non-existent-laser-999" },
    deps: { projectsDir: tmpRoot, syncManifest: false },
  });
  assert.equal(unknownId.statusCode, 400);

  // Dependency-injected soundEngine
  let calledWith = null;
  const diRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/preview-sfx`,
    body: { sfxId: "ui-pop" },
    deps: {
      projectsDir: tmpRoot,
      syncManifest: false,
      soundEngine: {
        SFX_CATALOG: [{ id: "ui-pop", name: "UI Pop" }],
        async synthesizeSfx({ sfxId, outPath }) {
          calledWith = { sfxId, outPath };
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, Buffer.from("ID3-mock-mp3-payload"));
          return { ok: true, outPath };
        },
      },
    },
  });

  assert.equal(diRes.statusCode, 200);
  assert.equal(diRes.json.ok, true);
  assert.equal(diRes.json.sfxId, "ui-pop");
  assert.equal(diRes.json.relPath, "assets/audio/sfx_ui-pop.mp3");
  assert.equal(diRes.json.url, `/media/${slug}/assets/audio/sfx_ui-pop.mp3`);
  assert.ok(calledWith.outPath.endsWith(path.join("assets", "audio", "sfx_ui-pop.mp3")));
  assert.ok(fs.existsSync(path.join(projectDir, "assets", "audio", "sfx_ui-pop.mp3")));

  // Fallback synthesis via real FFmpeg when sound-engine.mjs is unavailable
  const fallbackSfxRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/preview-sfx`,
    body: { sfxId: "glass-ping" },
    deps: {
      projectsDir: tmpRoot,
      syncManifest: false,
      importModule: async () => {
        throw new Error("sound-engine not written yet");
      },
    },
  });
  assert.equal(fallbackSfxRes.statusCode, 200);
  assert.equal(fallbackSfxRes.json.relPath, "assets/audio/sfx_glass-ping.mp3");
  const realMp3Path = path.join(projectDir, "assets", "audio", "sfx_glass-ping.mp3");
  assert.ok(fs.existsSync(realMp3Path));
  assert.ok(fs.statSync(realMp3Path).size > 100);
});

test("POST /api/projects/:slug/color-grade — grades both clips and keyframe images & blocks path traversal", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-routes-pro-grade-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  const { slug, projectDir } = createIsolatedProject(tmpRoot, "grade-proj");

  // Create real tiny synthetic PNG and MP4 fixtures using FFmpeg
  const rawImgPath = path.join(projectDir, ".studio", "frames", "raw", "scene_01_peak.png");
  const rawVidPath = path.join(projectDir, "assets", "clips", "shot_01.mp4");

  const imgCmd = await runCommand(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", "color=c=#1E824C:s=160x90:d=0.1", "-frames:v", "1", rawImgPath],
    { env: getToolEnv(), shell: false },
  );
  assert.equal(imgCmd.code, 0, imgCmd.stderr);

  const vidCmd = await runCommand(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=#2563EB:s=160x90:d=0.4:r=15",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      rawVidPath,
    ],
    { env: getToolEnv(), shell: false },
  );
  assert.equal(vidCmd.code, 0, vidCmd.stderr);

  // Path traversal blocked
  const traversalRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/color-grade`,
    body: { relPath: "../../package.json", lookId: "clean-commercial" },
    deps: { projectsDir: tmpRoot, syncManifest: false },
  });
  assert.ok(traversalRes.statusCode === 400 || traversalRes.statusCode === 403);

  // Unknown lookId blocked
  const badLookRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/color-grade`,
    body: { relPath: "assets/clips/shot_01.mp4", lookId: "non-existent-look" },
    deps: { projectsDir: tmpRoot, syncManifest: false },
  });
  assert.equal(badLookRes.statusCode, 400);

  // Missing input file -> 404
  const missingFileRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/color-grade`,
    body: { relPath: "assets/clips/missing.mp4", lookId: "clean-commercial" },
    deps: { projectsDir: tmpRoot, syncManifest: false },
  });
  assert.equal(missingFileRes.statusCode, 404);

  // Grade video clip via DI colorGrade
  let videoGradeCall = null;
  const vidGradeRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/color-grade`,
    body: { relPath: "assets/clips/shot_01.mp4", lookId: "kodak-2383-warm", fps: 24 },
    deps: {
      projectsDir: tmpRoot,
      syncManifest: false,
      colorGrade: {
        COLOR_LOOKS: [{ id: "kodak-2383-warm", name: "Kodak 2383 Warm" }],
        async applyColorLookToVideo({ inputPath, outputPath, lookId, fps }) {
          videoGradeCall = { inputPath, outputPath, lookId, fps };
          fs.copyFileSync(inputPath, outputPath);
          return { ok: true, outputPath, lookId };
        },
        async applyColorLookToImage() {
          throw new Error("Should not call image grader for mp4");
        },
      },
    },
  });

  assert.equal(vidGradeRes.statusCode, 200);
  assert.equal(vidGradeRes.json.ok, true);
  assert.equal(vidGradeRes.json.mediaType, "video");
  assert.equal(vidGradeRes.json.lookId, "kodak-2383-warm");
  assert.equal(videoGradeCall.fps, 24);
  assert.ok(vidGradeRes.json.outputRelPath.startsWith("assets/clips/"));
  assert.ok(fs.existsSync(path.join(projectDir, vidGradeRes.json.outputRelPath)));

  // Grade keyframe image with built-in FFmpeg fallback (when color-grade.mjs isn't loaded)
  const imgGradeRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/color-grade`,
    body: { relPath: ".studio/frames/raw/scene_01_peak.png", lookId: "emerald-vibrant" },
    deps: {
      projectsDir: tmpRoot,
      syncManifest: false,
      importModule: async () => {
        throw new Error("color-grade still writing");
      },
    },
  });

  assert.equal(imgGradeRes.statusCode, 200);
  assert.equal(imgGradeRes.json.ok, true);
  assert.equal(imgGradeRes.json.mediaType, "image");
  assert.equal(imgGradeRes.json.lookId, "emerald-vibrant");
  const gradedImgAbs = path.join(projectDir, imgGradeRes.json.outputRelPath);
  assert.ok(fs.existsSync(gradedImgAbs));
  assert.ok(fs.statSync(gradedImgAbs).size > 100);
});

test("POST /api/projects/:slug/captions/generate — aligns script, writes compositions/captions-track.html & passes hyperframes lint", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-routes-pro-caps-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  const { slug, projectDir } = createIsolatedProject(tmpRoot, "caps-proj");

  // Missing scriptText on empty project -> 400
  const emptyRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/captions/generate`,
    body: {},
    deps: { projectsDir: tmpRoot, syncManifest: false },
  });
  assert.equal(emptyRes.statusCode, 400);

  // DI captionsEngine call
  let alignArgs = null;
  let renderArgs = null;
  const diRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/captions/generate`,
    body: {
      scriptText: "Order farm fresh produce in thirty seconds.",
      durationSeconds: 6,
      styleId: "kinetic-gold-pop",
    },
    deps: {
      projectsDir: tmpRoot,
      syncManifest: false,
      captionsEngine: {
        CAPTION_STYLES: [{ id: "kinetic-gold-pop", name: "Kinetic Gold Pop" }],
        alignScriptToWordTimings(args) {
          alignArgs = args;
          return {
            phrases: [
              {
                index: 0,
                text: "Order farm fresh produce",
                highlightWord: "fresh",
                start: 0,
                end: 3,
                words: [{ word: "Order", start: 0, end: 0.7 }],
              },
              {
                index: 1,
                text: "in thirty seconds.",
                highlightWord: "seconds.",
                start: 3,
                end: 6,
                words: [{ word: "in", start: 3, end: 4 }],
              },
            ],
          };
        },
        renderCaptionsSubComposition(args) {
          renderArgs = args;
          return `<template id="${args.compositionId}-template"><div data-composition-id="${args.compositionId}" data-width="${args.width}" data-height="${args.height}" data-duration="${args.totalDuration}"></div></template>`;
        },
      },
    },
  });

  assert.equal(diRes.statusCode, 200);
  assert.equal(diRes.json.ok, true);
  assert.equal(diRes.json.relPath, "compositions/captions-track.html");
  assert.equal(diRes.json.phraseCount, 2);
  assert.equal(alignArgs.durationSeconds, 6);
  assert.equal(renderArgs.styleId, "kinetic-gold-pop");
  assert.ok(fs.existsSync(path.join(projectDir, "compositions", "captions-track.html")));

  // Storyboard fallback script + lint-clean fallback composition check
  fs.writeFileSync(
    path.join(projectDir, "STORYBOARD.json"),
    JSON.stringify(
      {
        slug,
        totalDurationSeconds: 8,
        frames: [
          {
            id: "frame_01",
            durationSeconds: 4,
            audioSpec: { voiceoverText: "তাজা বাজার এখন আপনার হাতের মুঠোয়।" },
          },
          {
            id: "frame_02",
            durationSeconds: 4,
            audioSpec: { voiceoverText: "Fast doorstep delivery every morning." },
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const sbCapsRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${slug}/captions/generate`,
    body: { styleId: "bengali-emerald-card" },
    deps: {
      projectsDir: tmpRoot,
      syncManifest: false,
      importModule: async () => {
        throw new Error("captions-engine still writing");
      },
    },
  });
  assert.equal(sbCapsRes.statusCode, 200);
  assert.ok(sbCapsRes.json.phraseCount >= 2);

  const trackPath = path.join(projectDir, "compositions", "captions-track.html");
  const trackHtml = fs.readFileSync(trackPath, "utf8");
  assert.match(trackHtml, /<template id="captions-track-template">/);

  // Verify HyperFrames lint passes 0 errors when mounting compositions/captions-track.html
  const indexHtmlPath = path.join(projectDir, "index.html");
  const hostIndexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;800&display=block" rel="stylesheet" />
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="8" data-width="1080" data-height="1920" data-fps="30">
      <div
        id="captions-overlay"
        class="clip"
        data-composition-id="captions-track"
        data-composition-src="compositions/captions-track.html"
        data-start="0"
        data-duration="8"
        data-width="1080"
        data-height="1920"
      ></div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>`;
  fs.writeFileSync(indexHtmlPath, hostIndexHtml, "utf8");
  const lintCheck = await runCommand("npx", ["hyperframes", "lint", projectDir], {
    cwd: ROOT_DIR,
    env: getToolEnv(),
  });
  assert.equal(
    lintCheck.code,
    0,
    `hyperframes lint failed: ${lintCheck.stdout}\n${lintCheck.stderr}`,
  );
});

test("POST /api/projects/:slug/google-multimodal-plan & live HTTP server — generates plan JSON and optionally enqueues $0 tickets", async (t) => {
  const prevCurrentProject = snapshotOptionalFile(CURRENT_PROJECT_FILE);
  const prevProviderSettings = snapshotOptionalFile(PROVIDER_SETTINGS_FILE);
  const prevCrewState = snapshotOptionalFile(CREW_STATE_FILE);

  const realSlug = "tmp-routes-pro-e2e";
  const realProjectDir = path.join(PROJECTS_DIR, realSlug);

  t.after(() => {
    if (fs.existsSync(realProjectDir)) {
      fs.rmSync(realProjectDir, { recursive: true, force: true });
    }
    restoreOptionalFile(CURRENT_PROJECT_FILE, prevCurrentProject);
    restoreOptionalFile(PROVIDER_SETTINGS_FILE, prevProviderSettings);
    restoreOptionalFile(CREW_STATE_FILE, prevCrewState);
  });

  ensureProjectDirs(realSlug);
  await syncProjectManifest(realSlug, {
    title: "Routes Pro Multimodal Test",
    aspectRatio: "9:16",
  });

  const storyboard = {
    schemaVersion: 1,
    slug: realSlug,
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    frames: [
      {
        id: "frame_01",
        index: 1,
        title: "Hero Reveal",
        layout: "device-3d-showcase",
        motionPreset: "crash-zoom-in",
        durationSeconds: 4,
        locked: false,
        staging: { headline: "Instant Groceries" },
        audioSpec: { voiceoverText: "Get fresh produce delivered fast." },
      },
      {
        id: "frame_02",
        index: 2,
        title: "Locked Outro",
        layout: "kinetic-statement-card",
        motionPreset: "editorial-kinetic-card",
        durationSeconds: 4,
        locked: true,
        staging: { headline: "Download Today" },
        audioSpec: { voiceoverText: "Download the app today." },
      },
    ],
  };
  fs.writeFileSync(
    path.join(realProjectDir, "STORYBOARD.json"),
    JSON.stringify(storyboard, null, 2) + "\n",
    "utf8",
  );

  // 1. Plan generation WITHOUT ticket enqueueing
  const planOnlyRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${realSlug}/google-multimodal-plan`,
    body: { enqueueTickets: false },
  });
  assert.equal(planOnlyRes.statusCode, 200);
  assert.equal(planOnlyRes.json.ok, true);
  assert.equal(planOnlyRes.json.planRelPath, ".studio/google-multimodal-plan.json");
  assert.equal(planOnlyRes.json.ticketsEnqueued, 0);

  const savedPlanPath = path.join(realProjectDir, ".studio", "google-multimodal-plan.json");
  assert.ok(fs.existsSync(savedPlanPath));
  const savedPlan = JSON.parse(fs.readFileSync(savedPlanPath, "utf8"));
  assert.equal(savedPlan.costMode, "subscription-zero-dollar");
  assert.equal(listAgentTasks(realSlug).length, 0);

  // 2. Plan generation WITH ticket enqueueing (unlocked shots only by default)
  const enqueueRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${realSlug}/google-multimodal-plan`,
    body: { enqueueTickets: true },
  });
  assert.equal(enqueueRes.statusCode, 200);
  assert.equal(enqueueRes.json.ticketsEnqueued, 2);
  const pendingTickets = listAgentTasks(realSlug, { status: "pending" });
  assert.equal(pendingTickets.length, 2);
  assert.deepEqual(pendingTickets.map((tkt) => tkt.type).sort(), [
    "ai_generate_image_plate",
    "ai_google_flow_video",
  ]);
  assert.ok(pendingTickets.every((tkt) => tkt.payload.frameId === "frame_01"));

  // 3. Verify zeroCostGuard blocks forcePaidApi ticket enqueueing
  const paidBlockedRes = await invokeProRoute({
    method: "POST",
    urlPath: `/api/projects/${realSlug}/google-multimodal-plan`,
    body: { enqueueTickets: true, forcePaidApi: true },
  });
  assert.ok(paidBlockedRes.statusCode === 400 || paidBlockedRes.statusCode === 403);
  assert.match(paidBlockedRes.json.error, /zeroCostGuard/i);

  // 4. Verify real HTTP server wiring end-to-end
  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const handled = await handleProRoutes(req, res, urlObj);
    if (!handled) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, fallback: true }));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const httpCatalog = await fetch(`${baseUrl}/api/catalog/presets`);
  assert.equal(httpCatalog.status, 200);
  const catalogData = await httpCatalog.json();
  assert.equal(catalogData.ok, true);
  assert.ok(Array.isArray(catalogData.cameraPresets));

  const httpLiveSfx = await fetch(`${baseUrl}/api/projects/${realSlug}/preview-sfx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sfxId: "ui-pop" }),
  });
  assert.equal(httpLiveSfx.status, 200);
  const liveSfxData = await httpLiveSfx.json();
  assert.equal(liveSfxData.relPath, "assets/audio/sfx_ui-pop.mp3");
  assert.equal(liveSfxData.url, `/media/${realSlug}/assets/audio/sfx_ui-pop.mp3`);
  assert.ok(fs.existsSync(path.join(realProjectDir, "assets", "audio", "sfx_ui-pop.mp3")));

  const httpLiveCaps = await fetch(`${baseUrl}/api/projects/${realSlug}/captions/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scriptText: "Instant studio captions aligned to every beat.",
      durationSeconds: 5,
      styleId: "kinetic-gold-pop",
    }),
  });
  assert.equal(httpLiveCaps.status, 200);
  const liveCapsData = await httpLiveCaps.json();
  assert.equal(liveCapsData.relPath, "compositions/captions-track.html");
  assert.ok(fs.existsSync(path.join(realProjectDir, "compositions", "captions-track.html")));

  const httpFallback = await fetch(`${baseUrl}/api/status`);
  assert.equal(httpFallback.status, 404);
  const fallbackData = await httpFallback.json();
  assert.equal(fallbackData.fallback, true);
});

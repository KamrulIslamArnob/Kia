import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { getToolEnv, runCommand } from "../lib.mjs";
import { FALLBACK_PM_INSIGHTS, FALLBACK_VOICE_CATALOG, handleV3Routes } from "../routes-v3.mjs";

async function invokeV3Route({ method = "GET", urlPath = "/", body = undefined, deps = {} }) {
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
  const handled = await handleV3Routes(req, res, urlObj, deps);
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

function createIsolatedV3Project(baseProjectsDir, slug = "v3-unit-proj") {
  const projectDir = path.join(baseProjectsDir, slug);
  const subdirs = [
    "inbox/raw-video",
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
    title: "V3 Studio Demo",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 12,
    language: "Bengali",
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#F1C40F",
      background: "#0A1612",
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
    title: "V3 Studio Demo",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    frames: [
      {
        id: "frame_01",
        index: 1,
        sceneId: "scene_01",
        title: "Fresh Morning Harvest",
        layout: "device-3d-showcase",
        motionPreset: "crash-zoom-in",
        durationSeconds: 3.0,
        speedFactor: 1,
        sourceClip: "assets/clips/shot_01.mp4",
        designFramePath: ".studio/frames/design/frame_01_v1.png",
        hudFramePath: ".studio/frames/design/frame_01_v1_hud.png",
        keyframes: {
          start: ".studio/frames/raw/scene_01_start.png",
          peak: ".studio/frames/raw/scene_01_peak.png",
          end: ".studio/frames/raw/scene_01_end.png",
        },
        staging: {
          headline: "Fresh Groceries in 15 Min",
          subheadline: "Farm to doorstep with zero middlemen.",
          badgeText: "FAST DELIVERY",
          captionText: "তাজা সবজি এখন ১৫ মিনিটে আপনার বাসায়।",
        },
        audioSpec: {
          voiceoverText: "তাজা সবজি এখন ১৫ মিনিটে আপনার বাসায়।",
          sfx: ["ui-pop"],
        },
        locked: false,
        approved: false,
        currentVersion: 1,
        history: [],
      },
      {
        id: "frame_02",
        index: 2,
        sceneId: "scene_02",
        title: "Express Checkout",
        layout: "kinetic-statement-card",
        motionPreset: "hero-lockoff",
        durationSeconds: 6.5,
        speedFactor: 1,
        sourceClip: null,
        designFramePath: ".studio/frames/design/frame_02_v1.png",
        hudFramePath: ".studio/frames/design/frame_02_v1_hud.png",
        keyframes: { start: null, peak: null, end: null },
        staging: {
          headline: "Tap Once to Order Today",
          subheadline: "Free delivery on your first basket.",
          badgeText: "ORDER NOW",
        },
        audioSpec: {
          voiceoverText: "আজই অর্ডার করুন এবং ফ্রি ডেলিভারি পান।",
          sfx: ["confetti-chime"],
        },
        locked: false,
        approved: false,
        currentVersion: 1,
        history: [],
      },
    ],
  };
  fs.writeFileSync(
    path.join(projectDir, "STORYBOARD.json"),
    JSON.stringify(storyboard, null, 2) + "\n",
    "utf8",
  );

  return { slug, projectDir, brief, storyboard };
}

test("routes-v3 — non-V3 routes return false untouched, method & slug guards reject invalid inputs", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-routes-v3-guard-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  createIsolatedV3Project(tmpRoot, "demo-v3");

  const deps = { projectsDir: tmpRoot, syncManifest: false, disableBroadcast: true };

  for (const nonV3Path of [
    "/api/status",
    "/api/catalog/presets",
    "/api/skills",
    "/api/projects/demo-v3/brief",
    "/api/projects/demo-v3/rating",
  ]) {
    const passRes = await invokeV3Route({ method: "GET", urlPath: nonV3Path, deps });
    assert.equal(passRes.handled, false, `Expected ${nonV3Path} to pass through unhandled`);
    assert.equal(passRes.ended, false);
  }

  const wrongMethodVoices = await invokeV3Route({
    method: "POST",
    urlPath: "/api/voices",
    body: {},
    deps,
  });
  assert.equal(wrongMethodVoices.handled, true);
  assert.equal(wrongMethodVoices.statusCode, 405);

  const wrongMethodInsights = await invokeV3Route({
    method: "POST",
    urlPath: "/api/pm-insights",
    body: {},
    deps,
  });
  assert.equal(wrongMethodInsights.handled, true);
  assert.equal(wrongMethodInsights.statusCode, 405);

  const traversalSlug = await invokeV3Route({
    method: "GET",
    urlPath: "/api/projects/..%2Fsecret/whiteboard",
    deps,
  });
  assert.equal(traversalSlug.handled, true);
  assert.equal(traversalSlug.statusCode, 400);

  const missingProject = await invokeV3Route({
    method: "GET",
    urlPath: "/api/projects/missing-slug-99/ad-analytics",
    deps,
  });
  assert.equal(missingProject.handled, true);
  assert.equal(missingProject.statusCode, 404);
});

test("GET /api/voices & GET /api/pm-insights — language filtering, DI & graceful fallbacks", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-routes-v3-meta-"));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1. Graceful fallback when voice-lipsync.mjs is still being written
  const fallbackAll = await invokeV3Route({
    method: "GET",
    urlPath: "/api/voices",
    deps: {
      importModule: async () => {
        throw new Error("voice-lipsync mid-write");
      },
    },
  });
  assert.equal(fallbackAll.statusCode, 200);
  assert.equal(fallbackAll.json.ok, true);
  assert.equal(fallbackAll.json.voices.length, 10);
  assert.equal(fallbackAll.json.catalog.Bengali.length, 4);
  assert.equal(fallbackAll.json.catalog.English.length, 4);
  assert.equal(fallbackAll.json.catalog.Hindi.length, 2);
  assert.deepEqual(fallbackAll.json.byLanguage, fallbackAll.json.catalog);
  assert.ok(FALLBACK_VOICE_CATALOG.Bengali.some((v) => v.id === "bn-BD-NabanitaNeural"));

  // 2. Case-insensitive ?lang= filter
  const bnOnly = await invokeV3Route({
    method: "GET",
    urlPath: "/api/voices?lang=bengali",
    deps: {
      importModule: async () => {
        throw new Error("voice-lipsync mid-write");
      },
    },
  });
  assert.equal(bnOnly.statusCode, 200);
  assert.equal(bnOnly.json.voices.length, 4);
  assert.ok(bnOnly.json.voices.every((v) => v.language === "Bengali"));

  const hiOnly = await invokeV3Route({
    method: "GET",
    urlPath: "/api/voices?lang=HINDI",
    deps: {
      importModule: async () => {
        throw new Error("voice-lipsync mid-write");
      },
    },
  });
  assert.equal(hiOnly.statusCode, 200);
  assert.equal(hiOnly.json.voices.length, 2);
  assert.ok(hiOnly.json.voices.every((v) => v.language === "Hindi"));

  // 3. Live /api/pm-insights reads studio-hub/docs/pm-insights.json
  const liveInsights = await invokeV3Route({
    method: "GET",
    urlPath: "/api/pm-insights",
  });
  assert.equal(liveInsights.statusCode, 200);
  assert.equal(liveInsights.json.ok, true);
  assert.ok(Array.isArray(liveInsights.json.insights.capabilities));
  assert.ok(Array.isArray(liveInsights.json.insights.nextHorizonDifferentiators));

  // 4. Fallback /api/pm-insights when file is missing or malformed
  const missingInsights = await invokeV3Route({
    method: "GET",
    urlPath: "/api/pm-insights",
    deps: { pmInsightsPath: path.join(tmpDir, "does-not-exist.json") },
  });
  assert.equal(missingInsights.statusCode, 200);
  assert.equal(missingInsights.json.ok, true);
  assert.equal(missingInsights.json.insights.version, FALLBACK_PM_INSIGHTS.version);
});

test("POST /api/projects/:slug/voice-sync — supports original-sync and ai-voice-lipsync, updates storyboard & broadcasts SSE", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-routes-v3-voice-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  const { slug, projectDir } = createIsolatedV3Project(tmpRoot, "voice-proj");

  // Create tiny synthetic video with tone audio for original-sync test
  const rawVid = path.join(projectDir, "inbox", "raw-video", "speaker.mp4");
  const mkVid = await runCommand(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=#1E824C:s=160x90:d=0.6:r=15",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.6",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      rawVid,
    ],
    { env: getToolEnv(), shell: false },
  );
  assert.equal(mkVid.code, 0, mkVid.stderr);

  // Path traversal rejected
  const badPathRes = await invokeV3Route({
    method: "POST",
    urlPath: `/api/projects/${slug}/voice-sync`,
    body: { mode: "original-sync", videoRelPath: "../../package.json" },
    deps: { projectsDir: tmpRoot, syncManifest: false, disableBroadcast: true },
  });
  assert.ok(badPathRes.statusCode === 400 || badPathRes.statusCode === 403);

  const sseEvents = [];
  const broadcastEvent = (type, payload) => sseEvents.push({ type, payload });

  // Mode 1: original-sync (via DI)
  const origSyncRes = await invokeV3Route({
    method: "POST",
    urlPath: `/api/projects/${slug}/voice-sync`,
    body: {
      mode: "original-sync",
      videoRelPath: "inbox/raw-video/speaker.mp4",
      frameId: "frame_01",
    },
    deps: {
      projectsDir: tmpRoot,
      syncManifest: false,
      broadcastEvent,
      voiceLipsync: {
        async extractAndSyncOriginalVoice({ slug: s, videoRelPath }) {
          const outAbs = path.join(projectDir, "assets", "audio", "original_voice.mp3");
          fs.writeFileSync(outAbs, Buffer.from("ID3-original-voice"));
          return {
            ok: true,
            slug: s,
            sourceVideoRelPath: videoRelPath,
            audioRelPath: "assets/audio/original_voice.mp3",
            duration: 0.6,
            hasSpeech: true,
            segments: [
              {
                index: 0,
                startTime: 0,
                endTime: 0.6,
                duration: 0.6,
                hasSpeech: true,
                text: "Hello Dhaka",
              },
            ],
          };
        },
      },
    },
  });

  assert.equal(origSyncRes.statusCode, 200);
  assert.equal(origSyncRes.json.ok, true);
  assert.equal(origSyncRes.json.mode, "original-sync");
  assert.equal(origSyncRes.json.audioRelPath, "assets/audio/original_voice.mp3");
  assert.equal(origSyncRes.json.audioUrl, `/media/${slug}/assets/audio/original_voice.mp3`);
  assert.equal(origSyncRes.json.segments.length, 1);
  assert.ok(sseEvents.some((e) => e.type === "storyboard_updated"));

  // Mode 2: ai-voice-lipsync (via DI) updating frame audio + lip-synced clip
  sseEvents.length = 0;
  const aiSyncRes = await invokeV3Route({
    method: "POST",
    urlPath: `/api/projects/${slug}/voice-sync`,
    body: {
      mode: "ai-voice-lipsync",
      frameId: "frame_01",
      language: "Bengali",
      voiceId: "bn-BD-NabanitaNeural",
      scriptText: "তাজা বাজার এখন আরও দ্রুত।",
      syncLips: true,
    },
    deps: {
      projectsDir: tmpRoot,
      syncManifest: false,
      broadcastEvent,
      voiceLipsync: {
        async generateMultilingualLipSyncedVoice(opts) {
          const audioRelPath = `assets/audio/vo_${opts.frameId}.mp3`;
          const syncedClipRelPath = `assets/clips/lipsync_${opts.frameId}.mp4`;
          fs.writeFileSync(path.join(projectDir, audioRelPath), Buffer.from("ID3-ai-voice"));
          fs.writeFileSync(path.join(projectDir, syncedClipRelPath), Buffer.from("MP4-lipsync"));
          return {
            ok: true,
            slug: opts.slug,
            frameId: opts.frameId,
            language: opts.language,
            voiceId: opts.voiceId,
            scriptText: opts.scriptText,
            audioRelPath,
            syncedClipRelPath,
            durationSeconds: 2.8,
            lipSynced: true,
            characterDetection: {
              hasCharacter: true,
              faceRatio: 0.85,
              faceBox: { x: 0.3, y: 0.2, width: 0.4, height: 0.4 },
              mouthRegion: { x: 0.4, y: 0.48, width: 0.2, height: 0.1 },
            },
            visemeEnvelope: [0.1, 0.65, 0.82, 0.3, 0.05],
          };
        },
      },
    },
  });

  assert.equal(aiSyncRes.statusCode, 200);
  assert.equal(aiSyncRes.json.ok, true);
  assert.equal(aiSyncRes.json.mode, "ai-voice-lipsync");
  assert.equal(aiSyncRes.json.audioUrl, `/media/${slug}/assets/audio/vo_frame_01.mp3`);
  assert.equal(aiSyncRes.json.syncedClipUrl, `/media/${slug}/assets/clips/lipsync_frame_01.mp4`);
  assert.equal(aiSyncRes.json.lipSynced, true);
  assert.equal(aiSyncRes.json.frame.sourceClip, "assets/clips/lipsync_frame_01.mp4");
  assert.equal(
    aiSyncRes.json.frame.designFrameUrl,
    `/media/${slug}/.studio/frames/design/frame_01_v1.png`,
  );
  assert.ok(sseEvents.some((e) => e.type === "storyboard_updated"));

  const updatedSb = JSON.parse(fs.readFileSync(path.join(projectDir, "STORYBOARD.json"), "utf8"));
  assert.equal(updatedSb.frames[0].audioSpec.voiceoverSrc, "assets/audio/vo_frame_01.mp3");
  assert.equal(updatedSb.frames[0].sourceClip, "assets/clips/lipsync_frame_01.mp4");
});

test("Whiteboard GET/POST & compile-scene — saves unsaved graph, normalizes edges, decorates frame/storyboard & broadcasts SSE", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-routes-v3-wb-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  const { slug, projectDir } = createIsolatedV3Project(tmpRoot, "wb-proj");

  // 1. Initial GET returns empty graph
  const initialGet = await invokeV3Route({
    method: "GET",
    urlPath: `/api/projects/${slug}/whiteboard`,
    deps: { projectsDir: tmpRoot, syncManifest: false, disableBroadcast: true },
  });
  assert.equal(initialGet.statusCode, 200);
  assert.deepEqual(initialGet.json.nodes, []);
  assert.deepEqual(initialGet.json.edges, []);

  // 2. POST normalizes source/target edge aliases & persists .studio/whiteboard.json
  const postGraph = await invokeV3Route({
    method: "POST",
    urlPath: `/api/projects/${slug}/whiteboard`,
    body: {
      nodes: [
        {
          id: "n_foot_1",
          type: "footage",
          x: 80,
          y: 120,
          title: "Intro Clip",
          relPath: "assets/clips/shot_01.mp4",
          trimRange: [0, 2.5],
        },
        {
          id: "n_note_1",
          type: "note",
          x: 100,
          y: 300,
          title: "Direction",
          text: "Punchy crash zoom",
        },
        { id: "n_scene_1", type: "scene", x: 460, y: 180, title: "Compiled Scene 1" },
      ],
      edges: [
        { id: "e1", source: "n_foot_1", target: "n_scene_1" },
        { id: "e2", from: "n_note_1", to: "n_scene_1" },
      ],
    },
    deps: { projectsDir: tmpRoot, syncManifest: false, disableBroadcast: true },
  });
  assert.equal(postGraph.statusCode, 200);
  assert.equal(postGraph.json.graph.nodes.length, 3);
  assert.equal(postGraph.json.graph.nodes[0].clipRelPath, "assets/clips/shot_01.mp4");
  assert.equal(postGraph.json.graph.nodes[1].promptText, "Punchy crash zoom");
  assert.equal(postGraph.json.graph.edges[0].from, "n_foot_1");
  assert.equal(postGraph.json.graph.edges[0].to, "n_scene_1");
  assert.ok(fs.existsSync(path.join(projectDir, ".studio", "whiteboard.json")));

  // 3. Rejects traversal in node clipRelPath
  const badNodeRes = await invokeV3Route({
    method: "POST",
    urlPath: `/api/projects/${slug}/whiteboard`,
    body: {
      nodes: [
        { id: "bad", type: "footage", x: 0, y: 0, title: "Bad", clipRelPath: "../../evil.mp4" },
      ],
      edges: [],
    },
    deps: { projectsDir: tmpRoot, syncManifest: false, disableBroadcast: true },
  });
  assert.equal(badNodeRes.statusCode, 400);

  // 4. POST /whiteboard/compile-scene saves inline body.graph BEFORE compiling, decorates URLs & broadcasts SSE
  const callOrder = [];
  const sseEvents = [];
  const compileRes = await invokeV3Route({
    method: "POST",
    urlPath: `/api/projects/${slug}/whiteboard/compile-scene`,
    body: {
      sceneNodeId: "n_scene_1",
      prompt: "Connect clips with fast cut",
      transition: "cut",
      graph: {
        nodes: postGraph.json.graph.nodes,
        edges: postGraph.json.graph.edges,
      },
    },
    deps: {
      projectsDir: tmpRoot,
      syncManifest: false,
      broadcastEvent: (type, payload) => sseEvents.push({ type, payload }),
      whiteboardGraph: {
        async saveWhiteboardGraph(s, g) {
          callOrder.push("saveWhiteboardGraph");
          return { slug: s, ...g };
        },
        async compileWhiteboardScene({ sceneNodeId, prompt, transition }) {
          callOrder.push("compileWhiteboardScene");
          const sb = JSON.parse(fs.readFileSync(path.join(projectDir, "STORYBOARD.json"), "utf8"));
          const compiledClipRelPath = `assets/clips/wb_${sceneNodeId}.mp4`;
          const newFrame = {
            ...sb.frames[0],
            id: "frame_03",
            index: 3,
            title: "Whiteboard Compiled Scene",
            sourceClip: compiledClipRelPath,
            prompt,
            transition,
          };
          sb.frames.push(newFrame);
          return {
            ok: true,
            compiledClipRelPath,
            frame: newFrame,
            storyboard: sb,
            graph: postGraph.json.graph,
          };
        },
      },
    },
  });

  assert.equal(compileRes.statusCode, 200);
  assert.deepEqual(callOrder, ["saveWhiteboardGraph", "compileWhiteboardScene"]);
  assert.equal(compileRes.json.compiledClipUrl, `/media/${slug}/assets/clips/wb_n_scene_1.mp4`);
  assert.equal(
    compileRes.json.frame.currentDesignImage,
    `/media/${slug}/.studio/frames/design/frame_01_v1.png`,
  );
  assert.equal(compileRes.json.storyboard.frames.length, 3);
  assert.ok(sseEvents.some((e) => e.type === "storyboard_updated"));
  assert.ok(sseEvents.some((e) => e.type === "storyboard-updated"));
});

test("GET & POST /api/projects/:slug/ad-analytics + live HTTP server E2E", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-routes-v3-ads-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  const { slug, projectDir } = createIsolatedV3Project(tmpRoot, "ads-proj");

  // Fallback Ad Creative Analytics when ad-analytics.mjs is mid-write
  const fallbackAds = await invokeV3Route({
    method: "GET",
    urlPath: `/api/projects/${slug}/ad-analytics`,
    deps: {
      projectsDir: tmpRoot,
      syncManifest: false,
      disableBroadcast: true,
      importModule: async () => {
        throw new Error("ad-analytics mid-write");
      },
    },
  });

  assert.equal(fallbackAds.statusCode, 200);
  assert.equal(fallbackAds.json.ok, true);
  const report = fallbackAds.json.analytics;
  assert.equal(typeof report.thumbstopHookScore, "number");
  assert.ok(report.thumbstopHookScore >= 0 && report.thumbstopHookScore <= 100);
  assert.equal(typeof report.soundOffScore, "number");
  assert.ok(Array.isArray(report.retentionCurve) && report.retentionCurve.length >= 2);
  assert.ok(Array.isArray(report.dropOffRisks));
  assert.ok(Array.isArray(report.platformSafeZones) && report.platformSafeZones.length === 3);
  assert.equal(report.hookVariants.length, 3);
  assert.ok(fs.existsSync(path.join(projectDir, ".studio", "ad-analytics.json")));

  // Live ephemeral HTTP server round-trip
  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const handled = await handleV3Routes(req, res, urlObj, {
      projectsDir: tmpRoot,
      syncManifest: false,
      disableBroadcast: true,
    });
    if (!handled) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, passThrough: true }));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const voicesHttp = await fetch(`${baseUrl}/api/voices?lang=English`);
  assert.equal(voicesHttp.status, 200);
  const voicesBody = await voicesHttp.json();
  assert.equal(voicesBody.ok, true);
  assert.equal(voicesBody.voices.length, 4);

  const insightsHttp = await fetch(`${baseUrl}/api/pm-insights`);
  assert.equal(insightsHttp.status, 200);
  const insightsBody = await insightsHttp.json();
  assert.equal(insightsBody.ok, true);

  const adsHttp = await fetch(`${baseUrl}/api/projects/${slug}/ad-analytics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(adsHttp.status, 200);
  const adsBody = await adsHttp.json();
  assert.equal(adsBody.ok, true);
  assert.equal(adsBody.analytics.hookVariants.length, 3);

  const passHttp = await fetch(`${baseUrl}/api/status`);
  assert.equal(passHttp.status, 404);
  const passBody = await passHttp.json();
  assert.equal(passBody.passThrough, true);
});

test("POST /inspiration/rea-decompose & /inspiration/apply-to-storyboard — newest video auto-discovery, URL decoration & SSE", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-routes-v3-rea-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  const { slug, projectDir } = createIsolatedV3Project(tmpRoot, "rea-proj");
  fs.mkdirSync(path.join(projectDir, "inbox", "inspiration"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "inbox", "references"), { recursive: true });

  // 1. Missing inspiration video -> 404
  const emptyDecomp = await invokeV3Route({
    method: "POST",
    urlPath: `/api/projects/${slug}/inspiration/rea-decompose`,
    body: {},
    deps: { projectsDir: tmpRoot, syncManifest: false, disableBroadcast: true },
  });
  assert.equal(emptyDecomp.handled, true);
  assert.equal(emptyDecomp.statusCode, 404);

  // 2. Path traversal in relPath -> 400 / 403
  const traversalDecomp = await invokeV3Route({
    method: "POST",
    urlPath: `/api/projects/${slug}/inspiration/rea-decompose`,
    body: { relPath: "../../evil.mp4" },
    deps: { projectsDir: tmpRoot, syncManifest: false, disableBroadcast: true },
  });
  assert.ok(traversalDecomp.statusCode === 400 || traversalDecomp.statusCode === 403);

  // 3. Create two inspiration videos and verify newest video auto-selection + artifact URL decoration
  const olderPath = path.join(projectDir, "inbox", "references", "older_ref.mp4");
  const newerPath = path.join(projectDir, "inbox", "inspiration", "newest_insp.mp4");
  fs.writeFileSync(olderPath, Buffer.from("older-mp4"));
  fs.utimesSync(olderPath, new Date(Date.now() - 20000), new Date(Date.now() - 20000));
  fs.writeFileSync(newerPath, Buffer.from("newer-mp4"));

  let decomposedArg = null;
  const decompRes = await invokeV3Route({
    method: "POST",
    urlPath: `/api/projects/${slug}/inspiration/rea-decompose`,
    body: {},
    deps: {
      projectsDir: tmpRoot,
      syncManifest: false,
      disableBroadcast: true,
      reaInspiration: {
        async decomposeInspirationWithReaVideo(args) {
          decomposedArg = args;
          return {
            ok: true,
            engine: "rea-video",
            videoRelPath: args.videoRelPath,
            summary: "Fast kinetic SaaS launch reel with crisp motion UI cards.",
            productionMix: {
              liveActionPct: 20,
              codeRenderPct: 60,
              screenRecordingPct: 20,
              aiVideoPct: 0,
              animationPct: 60,
            },
            editingStyle: {
              shotCount: 2,
              avgShotLength: 2.2,
              cutsPerMinute: 27.3,
              pacing: "fast-kinetic",
              bpm: 124,
              beatSyncRatio: 0.82,
              transitions: ["zoom-through", "whip-pan"],
            },
            animationPackaging: {
              subtitleStyle: "kinetic-gold-pop",
              overlayCards: "bento-glass",
              motionPatterns: ["crash-zoom-in", "bento-triptych"],
              lightingAndGrade: "emerald-vibrant",
            },
            shots: [
              {
                index: 1,
                start: 0,
                end: 2.2,
                duration: 2.2,
                productionType: "code-render",
                cameraMove: "zoom-in",
                framing: "close-up",
                overlayText: "Fast Delivery",
                recommendedArchetype: "spotlight-cursor-zoom",
                recommendedMotionPreset: "spotlight-cursor-follow",
              },
              {
                index: 2,
                start: 2.2,
                end: 4.4,
                duration: 2.2,
                productionType: "screen-recording",
                cameraMove: "pan-right",
                framing: "medium",
                overlayText: "Order Now",
                recommendedArchetype: "bento-feature-grid",
                recommendedMotionPreset: "bento-triptych",
              },
            ],
            artifacts: {
              videoMdUrl: ".studio/rea-breakdown/newest_insp/VIDEO.md",
              reportHtmlUrl: ".studio/rea-breakdown/newest_insp/report.html",
              storyboardImgUrl: ".studio/rea-breakdown/newest_insp/storyboard.jpg",
              audioWaveformUrl: ".studio/rea-breakdown/newest_insp/audio.png",
            },
            videoMdPreview: "# VIDEO Breakdown",
            remakeRecipe: {
              recommendedColorLook: "emerald-vibrant",
              recommendedCaptionStyle: "kinetic-gold-pop",
              shotPresets: ["spotlight-cursor-follow", "bento-triptych"],
            },
          };
        },
      },
    },
  });

  assert.equal(decompRes.statusCode, 200);
  assert.equal(decompRes.json.ok, true);
  assert.equal(decomposedArg.videoRelPath, "inbox/inspiration/newest_insp.mp4");
  assert.equal(
    decompRes.json.reaBreakdown.artifacts.reportHtmlUrl,
    `/media/${slug}/.studio/rea-breakdown/newest_insp/report.html`,
  );
  assert.equal(
    decompRes.json.reaBreakdown.artifacts.storyboardImgUrl,
    `/media/${slug}/.studio/rea-breakdown/newest_insp/storyboard.jpg`,
  );
  assert.equal(decompRes.json.inspirationProfile.pacing, "fast-kinetic");
  assert.ok(decompRes.json.project.inspirationProfile.reaBreakdown);

  // 4. Lock frame_02 and apply inspiration style to storyboard (fallback + SSE + URL decoration)
  const sbDisk = JSON.parse(fs.readFileSync(path.join(projectDir, "STORYBOARD.json"), "utf8"));
  sbDisk.frames[1].locked = true;
  fs.writeFileSync(
    path.join(projectDir, "STORYBOARD.json"),
    JSON.stringify(sbDisk, null, 2),
    "utf8",
  );

  const sseEvents = [];
  const applyRes = await invokeV3Route({
    method: "POST",
    urlPath: `/api/projects/${slug}/inspiration/apply-to-storyboard`,
    body: { reaBreakdown: decompRes.json.reaBreakdown },
    deps: {
      projectsDir: tmpRoot,
      syncManifest: false,
      broadcastEvent: (type, payload) => sseEvents.push({ type, payload }),
      importModule: async () => {
        throw new Error("rea-inspiration mid-write");
      },
    },
  });

  assert.equal(applyRes.statusCode, 200);
  assert.equal(applyRes.json.ok, true);
  // Unlocked frame_01 updated to recommended archetype/preset; locked frame_02 preserved!
  assert.equal(applyRes.json.storyboard.frames[0].layout, "spotlight-cursor-zoom");
  assert.equal(applyRes.json.storyboard.frames[0].motionPreset, "spotlight-cursor-follow");
  assert.equal(
    applyRes.json.storyboard.frames[0].designFrameUrl,
    `/media/${slug}/.studio/frames/design/frame_01_v1.png`,
  );
  assert.equal(applyRes.json.storyboard.frames[1].layout, "kinetic-statement-card");
  assert.ok(sseEvents.some((e) => e.type === "storyboard_updated"));
  assert.ok(sseEvents.some((e) => e.type === "storyboard-updated"));
});

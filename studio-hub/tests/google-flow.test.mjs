import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROJECTS_DIR, ROOT_DIR, ensureProjectDirs, getToolEnv, runCommand } from "../lib.mjs";
import {
  GOOGLE_FLOW_URL,
  COST_MODE,
  NEGATIVE_SLOP_CONSTRAINTS,
  buildGoogleImagePrompt,
  buildGoogleFlowVideoSpec,
  buildAudioBrief,
  buildAntigravityBatchManifest,
  saveGoogleMultimodalPlan,
  loadGoogleMultimodalPlan,
  generateGoogleMultimodalPlan,
} from "../google-flow-playbook.mjs";

const TEST_SLUG = `test-gflow-${process.pid}`;
const TEST_PROJECT_DIR = path.join(PROJECTS_DIR, TEST_SLUG);

const SAMPLE_BRAND_KIT = {
  tone: "Editorial Luxury & Tactile Precision",
  guidelinesText: "High-contrast obsidian surfaces with emerald glow and crisp gold badges.",
  fonts: {
    heading: "Plus Jakarta Sans",
    body: "Inter",
  },
  brandColors: {
    primary: "#1e824c",
    secondary: "#2ecc71",
    accent: "#facc15",
    background: "#0a1612",
    surface: "#10231c",
  },
  extractedPalette: ["#1e824c", "#2ecc71", "#facc15", "#0a1612", "#38bdf8"],
};

const SAMPLE_SHOT_SHOWCASE = {
  id: "frame_01",
  sceneId: "scene_01",
  index: 1,
  title: "Hero 3D Launch Offer",
  narrativeBeat: "hook",
  layout: "device-3d-showcase",
  motionPreset: "isometric-3d-tilt",
  cameraBody: "kodak-35mm",
  lens: "35mm",
  aperture: "f/1.4",
  durationSeconds: 4.5,
  speedFactor: 1,
  aiBackgroundPlate: "emerald-studio-pedestal",
  needsGoogleFlow: true,
  cameraMotion: {
    presetId: "isometric-3d-tilt",
    label: "Isometric 3D Tilt",
    fromScale: 1.05,
    toScale: 1.28,
    panX: -6,
    panY: -4,
    tiltDeg: 15,
    focusX: 52,
    focusY: 48,
    ease: "power3.inOut",
  },
  keyframes: {
    start: ".studio/frames/raw/scene_01_start.png",
    peak: ".studio/frames/raw/scene_01_peak.png",
    end: ".studio/frames/raw/scene_01_end.png",
  },
  staging: {
    headline: "Fresh Groceries in 20 Minutes",
    subheadline: "Farm-to-door express delivery with zero hidden fees.",
    badgeText: "LAUNCH OFFER",
    theme: "brand-dark",
  },
  audioSpec: {
    voiceoverText: "Get farm-fresh groceries delivered right to your doorstep in twenty minutes.",
    sfx: ["whoosh", "pop"],
    bgmMood: "warm-modern",
  },
  locked: false,
  approved: false,
};

const SAMPLE_SHOT_LOCKED = {
  id: "frame_02",
  sceneId: "scene_02",
  index: 2,
  title: "Locked Split Editorial",
  narrativeBeat: "discovery",
  layout: "split-editorial",
  motionPreset: "whip-pan-split",
  durationSeconds: 3.8,
  speedFactor: 1.25,
  sourceClip: "assets/clips/raw_take_02.mp4",
  keyframes: {
    start: ".studio/frames/raw/scene_02_start.png",
    peak: ".studio/frames/raw/scene_02_peak.png",
    end: null,
  },
  staging: {
    headline: "Verified Daily Savings",
    subheadline: "Curated aisles updated every morning.",
    badgeText: "CURATED",
  },
  audioSpec: {
    voiceoverText: "গুণগত মানের নিশ্চয়তা প্রতিদিন।",
    sfx: ["chime"],
    bgmMood: "upbeat-tech",
  },
  locked: true,
  approved: true,
};

before(() => {
  ensureProjectDirs(TEST_SLUG);
});

after(() => {
  if (fs.existsSync(TEST_PROJECT_DIR)) {
    fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
  }
});

test("buildGoogleImagePrompt embeds brand hex palette, camera optics, overlay safe-zone, and anti-slop rules", () => {
  const res = buildGoogleImagePrompt({
    shot: SAMPLE_SHOT_SHOWCASE,
    brandKit: SAMPLE_BRAND_KIT,
    aspectRatio: "9:16",
  });

  assert.equal(res.shotId, "frame_01");
  assert.equal(res.agentType, "image-generator");
  assert.equal(res.costMode, COST_MODE);
  assert.equal(res.costMode, "subscription-zero-dollar");
  assert.equal(res.requiresApiKey, false);
  assert.equal(res.aspectRatio, "9:16");
  assert.deepEqual(res.dimensions, { width: 1080, height: 1920 });
  assert.equal(res.outputRelPath, "assets/images/plate_frame_01.png");

  // Brand palette hex normalization & presence in prompt
  assert.equal(res.palette.primary, "#1E824C");
  assert.equal(res.palette.secondary, "#2ECC71");
  assert.equal(res.palette.accent, "#FACC15");
  assert.equal(res.palette.background, "#0A1612");
  assert.ok(res.palette.hexList.includes("#38BDF8"));
  assert.match(res.prompt, /#1E824C/);
  assert.match(res.prompt, /#FACC15/);
  assert.match(res.prompt, /#0A1612/);

  // Camera optic profile
  assert.equal(res.opticProfile.cameraBody, "kodak-35mm");
  assert.equal(res.opticProfile.lens, "35mm");
  assert.equal(res.opticProfile.aperture, "f/1.4");
  assert.match(res.prompt, /kodak-35mm/i);
  assert.match(res.prompt, /35mm/);
  assert.match(res.prompt, /f\/1\.4/);

  // Clean subject space for UI/video overlays
  assert.ok(res.overlaySafeZone.length > 20);
  assert.match(res.prompt, /overlay|negative space|safe/i);

  // Anti-slop negative constraints
  assert.ok(Array.isArray(NEGATIVE_SLOP_CONSTRAINTS) && NEGATIVE_SLOP_CONSTRAINTS.length >= 5);
  assert.ok(res.negativePrompt.length > 25);
  assert.match(res.prompt, /no baked-in|no text|watermark/i);

  // String coercion returns prompt cleanly
  assert.equal(`${res}`, res.prompt);

  // 16:9 widescreen variant + split-editorial layout space
  const wideRes = buildGoogleImagePrompt({
    shot: { id: "frame_09", layout: "split-editorial", title: "Split Feature" },
    brandKit: SAMPLE_BRAND_KIT,
    aspectRatio: "16:9",
  });
  assert.deepEqual(wideRes.dimensions, { width: 1920, height: 1080 });
  assert.match(wideRes.overlaySafeZone, /left|52%|editorial/i);
});

test("buildGoogleFlowVideoSpec stages start/end keyframes in browser_sandbox/uploads and builds Flow browser instructions", () => {
  const spec = buildGoogleFlowVideoSpec({
    shot: SAMPLE_SHOT_SHOWCASE,
    brandKit: SAMPLE_BRAND_KIT,
    aspectRatio: "9:16",
    slug: TEST_SLUG,
  });

  assert.equal(spec.shotId, "frame_01");
  assert.equal(spec.toolUrl, GOOGLE_FLOW_URL);
  assert.equal(spec.toolUrl, "https://labs.google/fx/tools/flow");
  assert.equal(spec.agentType, "browser");
  assert.equal(spec.costMode, "subscription-zero-dollar");
  assert.equal(spec.requiresApiKey, false);
  assert.equal(spec.aspectRatio, "9:16");
  assert.equal(spec.flowOrientation, "portrait");

  // Staged upload paths in browser_sandbox/uploads/
  assert.ok(spec.startFrameImage.startsWith("browser_sandbox/uploads/"));
  assert.ok(spec.endFrameImage.startsWith("browser_sandbox/uploads/"));
  assert.ok(!spec.startFrameImage.includes("\\"));
  assert.ok(!spec.endFrameImage.includes("\\"));
  assert.equal(spec.tweening.mode, "start-to-end-frame");
  assert.equal(spec.tweening.startFrameSource, ".studio/frames/raw/scene_01_start.png");
  assert.equal(spec.tweening.endFrameSource, ".studio/frames/raw/scene_01_end.png");

  // Camera motion description & Veo/Flow prompt
  assert.match(spec.cameraMotionDescription, /1\.05x.*1\.28x|Isometric 3D Tilt/i);
  assert.match(spec.cameraMotionDescription, /15/);
  assert.match(spec.motionPrompt, /#1E824C/);
  assert.match(spec.motionPrompt, /start frame|end frame|tween/i);

  // Download target in projects/<slug>/inbox/raw-video/
  assert.equal(spec.downloadTarget, `projects/${TEST_SLUG}/inbox/raw-video/flow_frame_01.mp4`);
  assert.equal(spec.assetClipTarget, `projects/${TEST_SLUG}/assets/clips/flow_frame_01.mp4`);

  // Step-by-step browser instructions including auth/CAPTCHA safety rule
  assert.ok(Array.isArray(spec.browserInstructions));
  assert.ok(spec.browserInstructions.length >= 5);
  const joinedSteps = spec.browserInstructions.join("\n");
  assert.match(joinedSteps, /https:\/\/labs\.google\/fx\/tools\/flow/);
  assert.match(joinedSteps, /browser_sandbox\/uploads\//);
  assert.match(
    joinedSteps,
    new RegExp(`projects/${TEST_SLUG}/inbox/raw-video/flow_frame_01\\.mp4`),
  );
  assert.match(joinedSteps, /CAPTCHA|sign-in|never bypass|do not bypass/i);
});

test("buildAudioBrief auto-detects Bengali vs English neural voice on $0 edge-tts backend", () => {
  const enAudio = buildAudioBrief({ shot: SAMPLE_SHOT_SHOWCASE, brandKit: SAMPLE_BRAND_KIT });
  assert.equal(enAudio.costMode, "subscription-zero-dollar");
  assert.equal(enAudio.requiresApiKey, false);
  assert.equal(enAudio.ttsBackend, "edge-tts-neural");
  assert.equal(enAudio.voice, "en-US-AriaNeural");
  assert.deepEqual(enAudio.sfxCues, ["whoosh", "pop"]);

  const bnAudio = buildAudioBrief({ shot: SAMPLE_SHOT_LOCKED, brandKit: SAMPLE_BRAND_KIT });
  assert.equal(bnAudio.voice, "bn-BD-NabanitaNeural");
});

test("buildAntigravityBatchManifest produces complete .studio/google-multimodal-plan.json and enforces $0 guard", () => {
  const storyboard = {
    slug: TEST_SLUG,
    aspectRatio: "9:16",
    frames: [SAMPLE_SHOT_SHOWCASE, SAMPLE_SHOT_LOCKED],
  };

  const manifest = buildAntigravityBatchManifest({
    slug: TEST_SLUG,
    storyboard,
    brandKit: SAMPLE_BRAND_KIT,
  });

  assert.equal(manifest.slug, TEST_SLUG);
  assert.equal(manifest.planRelPath, ".studio/google-multimodal-plan.json");
  assert.equal(manifest.costMode, "subscription-zero-dollar");
  assert.equal(manifest.zeroCostGuard, true);
  assert.equal(manifest.requiresApiKey, false);
  assert.equal(manifest.estimatedApiCostUsd, 0);
  assert.equal(manifest.shots.length, 2);

  const [s1, s2] = manifest.shots;
  assert.equal(s1.shotId, "frame_01");
  assert.equal(s1.locked, false);
  assert.equal(s1.needsImagePlate, true);
  assert.equal(s1.needsGoogleFlowVideo, true);
  assert.equal(s1.imageGeneratorBrief.costMode, "subscription-zero-dollar");
  assert.equal(s1.googleFlowBrief.costMode, "subscription-zero-dollar");
  assert.equal(s1.audioBrief.costMode, "subscription-zero-dollar");

  // Locked shot is preserved and NOT flagged for regeneration
  assert.equal(s2.shotId, "frame_02");
  assert.equal(s2.locked, true);
  assert.equal(s2.needsImagePlate, false);
  assert.equal(s2.needsGoogleFlowVideo, false);

  // Summary counts
  assert.equal(manifest.summary.totalShots, 2);
  assert.equal(manifest.summary.unlockedShots, 1);
  assert.equal(manifest.summary.lockedShots, 1);
  assert.equal(manifest.summary.imagePlateCount, 1);
  assert.equal(manifest.summary.googleFlowCount, 1);

  // Enforce zeroCostGuard rejection when paid API mode is requested
  assert.throws(
    () =>
      buildAntigravityBatchManifest({
        slug: TEST_SLUG,
        storyboard,
        brandKit: SAMPLE_BRAND_KIT,
        costMode: "paid-external-api",
      }),
    /zeroCostGuard|subscription-zero-dollar/i,
  );

  // Persist & reload .studio/google-multimodal-plan.json + optional ticket queueing
  const saved = saveGoogleMultimodalPlan(TEST_SLUG, manifest);
  assert.equal(fs.existsSync(saved.planPath), true);
  const loaded = loadGoogleMultimodalPlan(TEST_SLUG);
  assert.equal(loaded.slug, TEST_SLUG);
  assert.equal(loaded.costMode, "subscription-zero-dollar");
  assert.equal(loaded.shots.length, 2);

  fs.writeFileSync(
    path.join(TEST_PROJECT_DIR, "STORYBOARD.json"),
    JSON.stringify(storyboard, null, 2),
    "utf8",
  );
  const generated = generateGoogleMultimodalPlan({
    slug: TEST_SLUG,
    brandKit: SAMPLE_BRAND_KIT,
    enqueueTickets: true,
  });
  assert.equal(generated.ok, true);
  assert.equal(generated.manifest.costMode, "subscription-zero-dollar");
  assert.ok(Array.isArray(generated.tickets) && generated.tickets.length >= 2);
});

test("google_media_crew.py compiles cleanly with Python py_compile and uses required run_workflow primitives", async () => {
  const workflowPath = path.join(ROOT_DIR, "studio-hub", "workflows", "google_media_crew.py");
  assert.equal(fs.existsSync(workflowPath), true, "google_media_crew.py must exist");

  const src = fs.readFileSync(workflowPath, "utf8");
  assert.match(src, /STORYBOARD\.json/);
  assert.match(src, /google-multimodal-plan\.json/);
  assert.match(src, /\bphase\s*\(/);
  assert.match(src, /\bparallel\s*\(/);
  assert.match(src, /type_name\s*=\s*["']image-generator["']/);
  assert.match(src, /type_name\s*=\s*["']self["']/);
  assert.match(src, /\blog\s*\(/);

  const env = getToolEnv();
  const pyCompile = await runCommand(
    "python",
    ["-m", "py_compile", "studio-hub/workflows/google_media_crew.py"],
    {
      cwd: ROOT_DIR,
      env: { ...env, PYTHONIOENCODING: "utf-8" },
      shell: false,
    },
  );
  assert.equal(
    pyCompile.code,
    0,
    `py_compile failed:\nSTDOUT: ${pyCompile.stdout}\nSTDERR: ${pyCompile.stderr}`,
  );

  // Execute run_google_media_crew end-to-end with mocked run_workflow primitives
  const pySimScript = `
import asyncio, importlib.util, json, sys

spec = importlib.util.spec_from_file_location("google_media_crew", "studio-hub/workflows/google_media_crew.py")
mod = importlib.util.module_from_spec(spec)
phases = []
logs = []
agent_calls = []

def mock_phase(name):
    phases.append(name)

def mock_log(*items):
    logs.append(" ".join(str(x) for x in items))

def mock_agent(prompt=None, schema=None, role=None, type_name="self", workspace="inherit", model=None):
    async def _run():
        agent_calls.append({"role": role, "type_name": type_name, "workspace": workspace, "has_schema": bool(schema)})
        if type_name == "image-generator":
            return {"shotId": "frame_01", "plateRelPath": "assets/images/plate_frame_01.png", "ok": True, "summary": "plate ready"}
        return {"shotId": "frame_01", "sceneId": "scene_01", "ok": True, "summary": "composition updated"}
    return _run()

async def mock_parallel(items, fn):
    return await asyncio.gather(*(fn(it) for it in items))

mod.phase = mock_phase
mod.log = mock_log
mod.agent = mock_agent
mod.parallel = mock_parallel
mod.WORKSPACES = (${JSON.stringify(ROOT_DIR)},)
spec.loader.exec_module(mod)

res = asyncio.run(mod.run_google_media_crew({"slug": ${JSON.stringify(TEST_SLUG)}}))
print("SIM_JSON:" + json.dumps({"res": res, "phases": phases, "agent_calls": agent_calls, "logs": logs}))
`;

  const pySim = await runCommand("python", ["-c", pySimScript], {
    cwd: ROOT_DIR,
    env: { ...env, PYTHONIOENCODING: "utf-8" },
    shell: false,
  });
  assert.equal(pySim.code, 0, `Workflow simulation failed:\n${pySim.stdout}\n${pySim.stderr}`);
  const simLine = pySim.stdout.split(/\r?\n/).find((l) => l.startsWith("SIM_JSON:"));
  assert.ok(simLine, `Missing SIM_JSON output in:\n${pySim.stdout}`);
  const simData = JSON.parse(simLine.slice("SIM_JSON:".length));

  assert.equal(simData.res.ok, true);
  assert.equal(simData.res.costMode, "subscription-zero-dollar");
  assert.equal(simData.res.platesGenerated, 1);
  assert.equal(simData.res.compositionsUpdated, 1);
  assert.ok(simData.phases.length >= 3);
  assert.ok(simData.agent_calls.some((c) => c.type_name === "image-generator" && c.has_schema));
  assert.ok(simData.agent_calls.some((c) => c.type_name === "self" && c.has_schema));
  assert.ok(simData.logs.some((l) => l.includes("Completed")));

  // Verify STORYBOARD.json linked plate on unlocked frame_01 while keeping locked frame_02 untouched
  const updatedSb = JSON.parse(
    fs.readFileSync(path.join(TEST_PROJECT_DIR, "STORYBOARD.json"), "utf8"),
  );
  assert.equal(updatedSb.frames[0].aiBackgroundPlate, "assets/images/plate_frame_01.png");
  assert.equal(updatedSb.frames[1].locked, true);
  assert.equal(updatedSb.frames[1].aiBackgroundPlate, undefined);
});

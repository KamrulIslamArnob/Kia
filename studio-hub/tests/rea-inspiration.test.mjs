import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as lib from "../lib.mjs";
import { discoverLocalSkills } from "../skills-registry.mjs";
import {
  LAYOUT_ARCHETYPES,
  MOTION_PRESETS,
  generateStoryboard,
  updateFrame,
} from "../storyboard.mjs";

const TEST_SLUG = `test-rea-insp-${process.pid}-${Date.now()}`;
const TEST_PROJECT_DIR = path.join(lib.PROJECTS_DIR, TEST_SLUG);

let tempRoot = "";
let multiShotMp4 = "";
let ingestedRelPath = "";
let ingestedAbsPath = "";
let savedCurrentProjectRaw = null;
let hadCurrentProjectFile = false;

before(async () => {
  hadCurrentProjectFile = fs.existsSync(lib.CURRENT_PROJECT_FILE);
  if (hadCurrentProjectFile) {
    savedCurrentProjectRaw = fs.readFileSync(lib.CURRENT_PROJECT_FILE, "utf8");
  }

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-rea-insp-"));
  const rawMuteMp4 = path.join(tempRoot, "insp_mute.mp4");
  multiShotMp4 = path.join(tempRoot, "insp_multishot_reel.mp4");

  // Build a crisp 4-shot 6.0s @ 20fps inspiration reel with distinct visuals & camera motion
  const pyGen = path.join(tempRoot, "gen_reel.py");
  fs.writeFileSync(
    pyGen,
    `import sys
import cv2
import numpy as np

out_mp4 = sys.argv[1]
fourcc = cv2.VideoWriter_fourcc(*"mp4v")
writer = cv2.VideoWriter(out_mp4, fourcc, 20.0, (640, 360))

for i in range(120):
    shot = i // 30
    t = (i % 30) / 30.0
    if shot == 0:
        # Shot 1: Dark UI hero card with animated accent pill
        frame = np.full((360, 640, 3), (22, 18, 14), dtype=np.uint8)
        x_shift = int(40 * t)
        cv2.rectangle(frame, (80 + x_shift, 60), (560, 300), (48, 42, 36), -1)
        cv2.rectangle(frame, (110 + x_shift, 90), (310 + x_shift, 126), (76, 130, 30), -1)
        cv2.rectangle(frame, (110, 290), (530, 326), (245, 245, 245), -1)
    elif shot == 1:
        # Shot 2: Bright teal product zoom frame
        frame = np.full((360, 640, 3), (140, 155, 35), dtype=np.uint8)
        rad = int(50 + 45 * t)
        cv2.circle(frame, (320, 175), rad, (250, 250, 250), -1)
        cv2.rectangle(frame, (180, 40), (460, 82), (18, 24, 20), -1)
    elif shot == 2:
        # Shot 3: Split editorial crimson + cream layout
        frame = np.full((360, 640, 3), (242, 244, 248), dtype=np.uint8)
        cv2.rectangle(frame, (0, 0), (310, 360), (65, 52, 225), -1)
        y_pos = int(70 + 60 * t)
        cv2.rectangle(frame, (350, y_pos), (590, y_pos + 140), (30, 35, 42), -1)
    else:
        # Shot 4: Gold kinetic statement card on deep navy
        frame = np.full((360, 640, 3), (75, 42, 20), dtype=np.uint8)
        w_bar = int(160 + 240 * t)
        cv2.rectangle(frame, (120, 120), (120 + w_bar, 220), (18, 198, 245), -1)
        cv2.circle(frame, (520, 170), 36, (255, 255, 255), -1)
    writer.write(frame)

writer.release()
`,
    "utf8",
  );

  const env = { ...lib.getToolEnv(), PYTHONIOENCODING: "utf-8" };
  const pyRes = await lib.runCommand(lib.resolvePythonBin(), [pyGen, rawMuteMp4], {
    env,
    shell: false,
  });
  assert.equal(pyRes.code, 0, `Reel generator failed: ${pyRes.stderr}`);

  // Encode H.264 with a 120 BPM rhythmic click/pulse + warm pad audio track
  const ffRes = await lib.runCommand(
    "ffmpeg",
    [
      "-y",
      "-i",
      rawMuteMp4,
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:duration=6,tremolo=f=2:d=0.85,volume=0.35",
      "-shortest",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      multiShotMp4,
    ],
    { env, shell: false },
  );
  assert.equal(ffRes.code, 0, `FFmpeg mux failed: ${ffRes.stderr}`);

  lib.ensureProjectDirs(TEST_SLUG);
  const ingested = await lib.ingestLocalFile({
    slug: TEST_SLUG,
    sourcePath: multiShotMp4,
    category: "inspiration",
  });
  ingestedRelPath = ingested.inboxRelPath;
  ingestedAbsPath = path.join(TEST_PROJECT_DIR, ingestedRelPath);
});

after(() => {
  if (fs.existsSync(TEST_PROJECT_DIR)) {
    fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
  }
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  if (hadCurrentProjectFile && savedCurrentProjectRaw !== null) {
    fs.writeFileSync(lib.CURRENT_PROJECT_FILE, savedCurrentProjectRaw, "utf8");
  }
});

test("rea-video skill is installed with Apache-2.0 attribution and discovered by skills-registry", async () => {
  const skillDir = path.join(lib.ROOT_DIR, ".agents", "skills", "rea-video");
  assert.ok(fs.existsSync(path.join(skillDir, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(skillDir, "LICENSE")));
  assert.ok(fs.existsSync(path.join(skillDir, "NOTICE")));

  const discovered = discoverLocalSkills({ slug: TEST_SLUG });
  const reaSkill = discovered.find((s) => s.id === "rea-video");
  assert.ok(reaSkill, "Expected discoverLocalSkills() to discover rea-video");

  const reaMod = await import("../rea-inspiration.mjs");
  assert.equal(await reaMod.isReaVideoInstalled(), true);
});

test("decomposeInspirationWithReaVideo decomposes multi-shot reel, writes artifacts, and persists inspirationProfile", async () => {
  const { decomposeInspirationWithReaVideo } = await import("../rea-inspiration.mjs");

  const res = await decomposeInspirationWithReaVideo({
    slug: TEST_SLUG,
    videoPath: ingestedAbsPath,
    videoRelPath: ingestedRelPath,
    lang: "en",
    enableStems: false,
  });

  assert.equal(res.ok, true);
  assert.equal(res.engine, "rea-video");
  assert.equal(res.videoRelPath, ingestedRelPath);
  assert.ok(typeof res.summary === "string" && res.summary.length > 15);

  // Production mix
  for (const key of [
    "liveActionPct",
    "codeRenderPct",
    "screenRecordingPct",
    "aiVideoPct",
    "animationPct",
  ]) {
    assert.equal(typeof res.productionMix[key], "number", `Missing productionMix.${key}`);
    assert.ok(res.productionMix[key] >= 0 && res.productionMix[key] <= 100);
  }

  // Editing style
  assert.ok(
    res.editingStyle.shotCount >= 3,
    `Expected >=3 shots, got ${res.editingStyle.shotCount}`,
  );
  assert.ok(res.editingStyle.avgShotLength > 0 && res.editingStyle.avgShotLength < 2.5);
  assert.ok(res.editingStyle.cutsPerMinute > 15);
  assert.equal(res.editingStyle.pacing, "fast-kinetic");
  assert.equal(typeof res.editingStyle.beatSyncRatio, "number");
  assert.ok(res.editingStyle.transitions && typeof res.editingStyle.transitions === "object");

  // Animation packaging
  assert.ok(typeof res.animationPackaging.subtitleStyle === "string");
  assert.ok(Array.isArray(res.animationPackaging.overlayCards));
  assert.ok(Array.isArray(res.animationPackaging.motionPatterns));
  assert.ok(typeof res.animationPackaging.lightingAndGrade === "string");

  // Shots
  assert.ok(Array.isArray(res.shots) && res.shots.length >= 3);
  for (const shot of res.shots) {
    assert.ok(shot.index >= 1);
    assert.ok(shot.end > shot.start);
    assert.ok(shot.duration > 0);
    assert.equal(typeof shot.productionType, "string");
    assert.equal(typeof shot.cameraMove, "string");
    assert.equal(typeof shot.framing, "string");
    assert.equal(typeof shot.overlayText, "string");
    assert.ok(
      LAYOUT_ARCHETYPES.includes(shot.recommendedArchetype),
      `Invalid recommendedArchetype: ${shot.recommendedArchetype}`,
    );
    assert.ok(
      Boolean(MOTION_PRESETS[shot.recommendedMotionPreset]),
      `Invalid recommendedMotionPreset: ${shot.recommendedMotionPreset}`,
    );
  }

  // Artifacts & VIDEO.md preview
  for (const key of ["videoMdUrl", "reportHtmlUrl", "storyboardImgUrl", "audioWaveformUrl"]) {
    const urlVal = res.artifacts[key];
    assert.ok(
      typeof urlVal === "string" && urlVal.startsWith(`/media/${TEST_SLUG}/.studio/rea-breakdown/`),
      `Expected media URL for ${key}, got ${urlVal}`,
    );
    const relDisk = urlVal
      .slice(`/media/${TEST_SLUG}/`.length)
      .split("/")
      .map(decodeURIComponent)
      .join(path.sep);
    const absDisk = path.join(TEST_PROJECT_DIR, relDisk);
    assert.ok(fs.existsSync(absDisk), `Artifact missing on disk: ${absDisk}`);
    assert.ok(fs.statSync(absDisk).size > 50, `Artifact empty: ${absDisk}`);
  }
  assert.ok(typeof res.videoMdPreview === "string" && res.videoMdPreview.length > 40);

  // Remake recipe
  assert.equal(typeof res.remakeRecipe.recommendedColorLook, "string");
  assert.equal(typeof res.remakeRecipe.recommendedCaptionStyle, "string");
  assert.ok(
    Array.isArray(res.remakeRecipe.shotPresets) && res.remakeRecipe.shotPresets.length >= 3,
  );

  // Persisted onto PROJECT_BRIEF.json
  const briefOnDisk = JSON.parse(
    fs.readFileSync(path.join(TEST_PROJECT_DIR, "PROJECT_BRIEF.json"), "utf8"),
  );
  assert.ok(briefOnDisk.inspirationProfile, "Expected inspirationProfile in PROJECT_BRIEF.json");
  assert.equal(briefOnDisk.inspirationProfile.pacing, "fast-kinetic");
  assert.equal(briefOnDisk.inspirationProfile.reaBreakdown?.engine, "rea-video");
});

test("applyInspirationStyleToStoryboard updates unlocked shots, preserves locked shots, and re-renders 1080p Hero Design Frames", async () => {
  const { applyInspirationStyleToStoryboard } = await import("../rea-inspiration.mjs");
  const brief = await lib.syncProjectManifest(TEST_SLUG);

  await generateStoryboard({
    slug: TEST_SLUG,
    projectBrief: brief,
    targetScenes: 3,
    preserveLocked: false,
  });

  // Lock frame_01 so only frame_02 & frame_03 should receive inspiration restyling
  await updateFrame({
    slug: TEST_SLUG,
    frameId: "frame_01",
    patch: { locked: true },
  });

  const applied = await applyInspirationStyleToStoryboard({ slug: TEST_SLUG });
  assert.equal(applied.ok, true);
  assert.ok(applied.storyboard && Array.isArray(applied.storyboard.frames));
  assert.equal(applied.storyboard.frames.length, 3);

  const f1 = applied.storyboard.frames.find((f) => f.id === "frame_01");
  const f2 = applied.storyboard.frames.find((f) => f.id === "frame_02");
  const f3 = applied.storyboard.frames.find((f) => f.id === "frame_03");

  assert.equal(f1.locked, true);
  assert.equal(f1.currentVersion, 1, "Locked frame_01 must remain at v1");

  for (const unlockedFrame of [f2, f3]) {
    assert.equal(unlockedFrame.locked, false);
    assert.equal(unlockedFrame.currentVersion, 2, `Expected ${unlockedFrame.id} to bump to v2`);
    assert.ok(LAYOUT_ARCHETYPES.includes(unlockedFrame.layout));
    assert.ok(Boolean(MOTION_PRESETS[unlockedFrame.motionPreset]));
    assert.ok(typeof unlockedFrame.staging?.colorLook === "string");
    assert.ok(typeof unlockedFrame.staging?.captionStyle === "string");

    const cleanPng = path.join(TEST_PROJECT_DIR, unlockedFrame.designFramePath);
    const hudPng = path.join(TEST_PROJECT_DIR, unlockedFrame.hudFramePath);
    assert.ok(fs.existsSync(cleanPng) && fs.statSync(cleanPng).size > 10_000);
    assert.ok(fs.existsSync(hudPng) && fs.statSync(hudPng).size > 10_000);
  }
});

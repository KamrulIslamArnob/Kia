import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PROJECTS_DIR, ensureProjectDirs } from "../lib.mjs";
import {
  MOTION_PRESETS,
  LAYOUT_ARCHETYPES,
  loadStoryboard,
  saveStoryboard,
  generateStoryboard,
  regenerateFrame,
  updateFrame,
  renderFrameHtml,
} from "../storyboard.mjs";

const TEST_SLUG = `test-storyboard-${process.pid}`;
const TEST_PROJECT_DIR = path.join(PROJECTS_DIR, TEST_SLUG);
const TEST_SCHEMA_SLUG = `test-sb-schema-${process.pid}`;
const TEST_SCHEMA_DIR = path.join(PROJECTS_DIR, TEST_SCHEMA_SLUG);

/**
 * Generates a valid uncompressed/deflated RGB PNG buffer with a colorful gradient
 * so synthetic test keyframes render real pixels with zero external dependencies.
 */
function createSolidGradientPng(width, height, [rBase, gBase, bBase]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowLen;
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 3;
      raw[px] = (rBase + Math.floor((x / width) * 90)) & 0xff;
      raw[px + 1] = (gBase + Math.floor((y / height) * 90)) & 0xff;
      raw[px + 2] = (bBase + Math.floor(((x + y) / (width + height)) * 80)) & 0xff;
    }
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function assertValidPngOver10Kb(absPath) {
  assert.equal(fs.existsSync(absPath), true, `Expected PNG to exist: ${absPath}`);
  const stat = fs.statSync(absPath);
  assert.ok(stat.size > 10 * 1024, `Expected PNG > 10KB, got ${stat.size} bytes at ${absPath}`);
  const header = fs.readFileSync(absPath).subarray(0, 8);
  assert.deepEqual(
    [...header],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `Invalid PNG magic bytes for ${absPath}`,
  );
}

before(() => {
  ensureProjectDirs(TEST_SLUG);
  const rawFramesDir = path.join(TEST_PROJECT_DIR, ".studio", "frames", "raw");
  const imagesDir = path.join(TEST_PROJECT_DIR, "assets", "images");
  fs.mkdirSync(rawFramesDir, { recursive: true });
  fs.mkdirSync(imagesDir, { recursive: true });

  const colors = [
    [24, 120, 72],
    [38, 160, 100],
    [210, 155, 25],
  ];
  for (let s = 1; s <= 3; s += 1) {
    const idx = String(s).padStart(2, "0");
    const c = colors[s - 1];
    fs.writeFileSync(
      path.join(rawFramesDir, `scene_${idx}_start.png`),
      createSolidGradientPng(360, 640, c),
    );
    fs.writeFileSync(
      path.join(rawFramesDir, `scene_${idx}_peak.png`),
      createSolidGradientPng(360, 640, [c[0] + 20, c[1] + 15, c[2] + 30]),
    );
    fs.writeFileSync(
      path.join(rawFramesDir, `scene_${idx}_end.png`),
      createSolidGradientPng(360, 640, [c[0] + 10, c[1] + 30, c[2] + 10]),
    );
  }
  fs.writeFileSync(
    path.join(imagesDir, "bg_plate.png"),
    createSolidGradientPng(400, 400, [180, 130, 20]),
  );
});

after(() => {
  fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_SCHEMA_DIR, { recursive: true, force: true });
});

test("exports exact MOTION_PRESETS (8 presets) and LAYOUT_ARCHETYPES (6 archetypes)", () => {
  assert.deepEqual(LAYOUT_ARCHETYPES, [
    "device-3d-showcase",
    "split-editorial",
    "fullbleed-cinema",
    "bento-feature-grid",
    "spotlight-cursor-zoom",
    "kinetic-statement-card",
  ]);

  const expectedPresetIds = [
    "crash-zoom-in",
    "dolly-out-reveal",
    "isometric-3d-tilt",
    "whip-pan-split",
    "spotlight-cursor-follow",
    "bento-triptych",
    "editorial-kinetic-card",
    "parallax-float",
  ];

  const list = Array.isArray(MOTION_PRESETS) ? MOTION_PRESETS : Object.values(MOTION_PRESETS);
  assert.equal(list.length, 8);

  for (const id of expectedPresetIds) {
    const preset = Array.isArray(MOTION_PRESETS)
      ? MOTION_PRESETS.find((p) => p.id === id) && MOTION_PRESETS[id]
      : MOTION_PRESETS[id];
    assert.ok(preset, `Missing motion preset: ${id}`);
    assert.equal(typeof preset.fromScale, "number");
    assert.equal(typeof preset.toScale, "number");
    assert.equal(typeof preset.panX, "number");
    assert.equal(typeof preset.panY, "number");
    assert.equal(typeof preset.tiltDeg, "number");
    assert.equal(typeof preset.focusX, "number");
    assert.equal(typeof preset.focusY, "number");
    assert.equal(typeof preset.ease, "string");
    assert.ok(preset.ease.length > 0);
  }
});

test("renderFrameHtml supports all 6 LAYOUT_ARCHETYPES and Animation Blueprint HUD", () => {
  const sampleBrief = {
    slug: TEST_SLUG,
    title: "Krishop Launch Film",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#F1C40F",
      background: "#0A1612",
    },
  };

  for (const layout of LAYOUT_ARCHETYPES) {
    const sampleFrame = {
      id: "frame_01",
      index: 1,
      title: "Hero Hook",
      layout,
      motionPreset: "crash-zoom-in",
      cameraMotion: {
        presetId: "crash-zoom-in",
        fromScale: 1.0,
        toScale: 1.85,
        panX: 0,
        panY: -6,
        tiltDeg: 0,
        focusX: 50,
        focusY: 44,
        ease: "expo.out",
        transitionIn: "zoom-through",
        transitionOut: "cut-the-curve",
      },
      durationSeconds: 4.5,
      speedFactor: 1.5,
      rawTimeRange: [0, 6.75],
      keyframes: {
        start: ".studio/frames/raw/scene_01_start.png",
        peak: ".studio/frames/raw/scene_01_peak.png",
        end: ".studio/frames/raw/scene_01_end.png",
      },
      staging: {
        headline: "Fresh Farm Harvest",
        subheadline: "Delivered in 60 minutes across Dhaka",
        badgeText: "STORM OFFER",
        captionText: "Tap now to unlock 40% harvest savings",
        theme: "brand-dark",
      },
      audioSpec: {
        voiceoverText: "Order organic produce straight from verified farms.",
        sfx: ["whoosh", "pop"],
      },
      currentVersion: 1,
    };

    const cleanHtml = renderFrameHtml(sampleFrame, sampleBrief, { showHud: false });
    assert.ok(cleanHtml.includes("<!doctype html>") || cleanHtml.includes("<!DOCTYPE html>"));
    assert.ok(cleanHtml.includes("Fresh Farm Harvest"));
    assert.ok(cleanHtml.includes(layout));
    assert.equal(cleanHtml.includes('data-hud="true"'), false);

    const hudHtml = renderFrameHtml(sampleFrame, sampleBrief, { showHud: true });
    assert.ok(hudHtml.includes('data-hud="true"'));
    assert.ok(hudHtml.includes("1.0x → 1.85x · expo.out"));
    assert.ok(hudHtml.includes("START"));
    assert.ok(hudHtml.includes("PEAK"));
    assert.ok(hudHtml.includes("END"));
    assert.ok(hudHtml.includes("<svg"));
    assert.ok(hudHtml.includes("Order organic produce"));
  }
});

test("generateStoryboard, regenerateFrame (v1 -> v2), updateFrame rollback, and preserveLocked", async () => {
  const projectBrief = {
    slug: TEST_SLUG,
    title: "Krishop App Promo",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 15,
    language: "English",
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#F1C40F",
      background: "#0A1612",
    },
    files: {
      rawVideo: [{ name: "raw.mp4", relPath: "inbox/raw-video/raw.mp4", duration: 18 }],
      clips: [],
    },
  };

  const rawAnalysis = {
    ok: true,
    duration: 18,
    width: 1080,
    height: 1920,
    fps: 30,
    scenes: [
      {
        index: 1,
        startTime: 0,
        endTime: 5,
        duration: 5,
        motionScore: 0.82,
        dominantColors: ["#1E824C", "#F1C40F"],
        keyframes: {
          start: ".studio/frames/raw/scene_01_start.png",
          peak: ".studio/frames/raw/scene_01_peak.png",
          end: ".studio/frames/raw/scene_01_end.png",
        },
      },
      {
        index: 2,
        startTime: 5,
        endTime: 11,
        duration: 6,
        motionScore: 0.64,
        dominantColors: ["#2ECC71", "#0A1612"],
        keyframes: {
          start: ".studio/frames/raw/scene_02_start.png",
          peak: ".studio/frames/raw/scene_02_peak.png",
          end: ".studio/frames/raw/scene_02_end.png",
        },
      },
      {
        index: 3,
        startTime: 11,
        endTime: 18,
        duration: 7,
        motionScore: 0.91,
        dominantColors: ["#F1C40F", "#1E824C"],
        keyframes: {
          start: ".studio/frames/raw/scene_03_start.png",
          peak: ".studio/frames/raw/scene_03_peak.png",
          end: ".studio/frames/raw/scene_03_end.png",
        },
      },
    ],
  };

  const inspirationProfile = {
    avgShotLength: 2.2,
    cutsPerMinute: 27,
    pacing: "fast-kinetic",
    dominantColors: ["#1E824C", "#F1C40F"],
  };

  // 1. Initial Storyboard Generation (v1)
  const sb1 = await generateStoryboard({
    slug: TEST_SLUG,
    projectBrief,
    rawAnalysis,
    inspirationProfile,
    globalPrompt: "energetic launch style",
    targetScenes: 3,
  });

  assert.equal(sb1.frames.length, 3);
  assert.equal(fs.existsSync(path.join(TEST_PROJECT_DIR, ".studio", "frames", "design")), true);
  assert.equal(fs.existsSync(path.join(TEST_PROJECT_DIR, ".studio", "frames", "tmp")), true);

  const loaded = loadStoryboard(TEST_SLUG);
  assert.ok(loaded);
  assert.equal(loaded.frames.length, 3);

  for (const frame of sb1.frames) {
    assert.equal(frame.currentVersion, 1);
    assert.equal(frame.history.length, 1);
    assertValidPngOver10Kb(path.join(TEST_PROJECT_DIR, frame.designFramePath));
    assertValidPngOver10Kb(path.join(TEST_PROJECT_DIR, frame.hudFramePath));
  }

  const v1CleanAbs = path.join(TEST_PROJECT_DIR, sb1.frames[0].designFramePath);
  const v1HudAbs = path.join(TEST_PROJECT_DIR, sb1.frames[0].hudFramePath);

  // 2. Iterative Prompt Regeneration (v1 -> v2)
  const regen = await regenerateFrame({
    slug: TEST_SLUG,
    frameId: "frame_01",
    prompt: 'Zoom 180% pan right tilt 12deg bento layout gold theme badge "FLASH SALE" speed 2x',
    overrides: {
      aiBackgroundPlate: "assets/images/bg_plate.png",
    },
  });

  assert.equal(regen.frame.currentVersion, 2);
  assert.equal(regen.frame.history.length, 2);
  assert.equal(regen.frame.layout, "bento-feature-grid");
  assert.equal(regen.frame.cameraMotion.toScale, 1.8);
  assert.ok(regen.frame.cameraMotion.panX > 0);
  assert.equal(regen.frame.cameraMotion.tiltDeg, 12);
  assert.equal(regen.frame.staging.theme, "gold");
  assert.equal(regen.frame.staging.badgeText, "FLASH SALE");
  assert.equal(regen.frame.speedFactor, 2);
  assert.equal(regen.frame.aiBackgroundPlate, "assets/images/bg_plate.png");

  // Previous v1 PNGs must still exist alongside new v2 PNGs
  assertValidPngOver10Kb(v1CleanAbs);
  assertValidPngOver10Kb(v1HudAbs);
  assertValidPngOver10Kb(path.join(TEST_PROJECT_DIR, regen.frame.designFramePath));
  assertValidPngOver10Kb(path.join(TEST_PROJECT_DIR, regen.frame.hudFramePath));
  assert.match(regen.frame.designFramePath, /frame_01_v2\.png$/);
  assert.match(regen.frame.hudFramePath, /frame_01_v2_hud\.png$/);

  // 2b. Second Iterative Regeneration (v2 -> v3) with explicit preset, slow-mo, and pan left
  const regenV3 = await regenerateFrame({
    slug: TEST_SLUG,
    frameId: "frame_01",
    prompt: 'pan left slow motion emerald theme "ORGANIC CERTIFIED"',
    motionPreset: "spotlight-cursor-follow",
    layout: "spotlight-cursor-zoom",
  });
  assert.equal(regenV3.frame.currentVersion, 3);
  assert.equal(regenV3.frame.history.length, 3);
  assert.equal(regenV3.frame.motionPreset, "spotlight-cursor-follow");
  assert.equal(regenV3.frame.layout, "spotlight-cursor-zoom");
  assert.ok(regenV3.frame.cameraMotion.panX < 0);
  assert.equal(regenV3.frame.speedFactor, 0.5);
  assert.equal(regenV3.frame.staging.theme, "emerald");
  assert.equal(regenV3.frame.staging.headline, "ORGANIC CERTIFIED");
  assertValidPngOver10Kb(path.join(TEST_PROJECT_DIR, regenV3.frame.designFramePath));
  assertValidPngOver10Kb(path.join(TEST_PROJECT_DIR, regenV3.frame.hudFramePath));

  // 3. Rollback to v1 via updateFrame({ revertToVersion: 1 })
  const rolledBack = await updateFrame({
    slug: TEST_SLUG,
    frameId: "frame_01",
    patch: { revertToVersion: 1 },
  });
  assert.equal(rolledBack.frame.currentVersion, 1);
  assert.equal(rolledBack.frame.history.length, 3);
  assert.match(rolledBack.frame.designFramePath, /frame_01_v1\.png$/);

  // 4. Update fields + Lock frame_01
  const lockedRes = await updateFrame({
    slug: TEST_SLUG,
    frameId: "frame_01",
    patch: {
      locked: true,
      approved: true,
      title: "Locked Hero Offer",
      durationSeconds: 5.5,
      audioSpec: {
        voiceoverText: "Custom locked voiceover line.",
        sfx: ["chime"],
      },
    },
  });
  assert.equal(lockedRes.frame.locked, true);
  assert.equal(lockedRes.frame.approved, true);
  assert.equal(lockedRes.frame.title, "Locked Hero Offer");
  assert.equal(lockedRes.frame.durationSeconds, 5.5);

  // 5. Global regeneration with preserveLocked: true must leave frame_01 untouched
  const sbAfterGlobal = await generateStoryboard({
    slug: TEST_SLUG,
    projectBrief,
    rawAnalysis,
    globalPrompt: 'split layout light theme badge "GLOBAL REFRESH"',
    targetScenes: 3,
    preserveLocked: true,
  });

  const f1After = sbAfterGlobal.frames.find((f) => f.id === "frame_01");
  const f2After = sbAfterGlobal.frames.find((f) => f.id === "frame_02");
  assert.equal(f1After.locked, true);
  assert.equal(f1After.approved, true);
  assert.equal(f1After.title, "Locked Hero Offer");
  assert.equal(f1After.durationSeconds, 5.5);
  assert.notEqual(f1After.staging.badgeText, "GLOBAL REFRESH");

  assert.equal(f2After.locked, false);
  assert.equal(f2After.layout, "split-editorial");
  assert.equal(f2After.staging.theme, "light");
  assert.equal(f2After.staging.badgeText, "GLOBAL REFRESH");
  assertValidPngOver10Kb(path.join(TEST_PROJECT_DIR, f2After.designFramePath));
  assertValidPngOver10Kb(path.join(TEST_PROJECT_DIR, f2After.hudFramePath));

  // Verify saveStoryboard round-trip
  const saved = saveStoryboard(TEST_SLUG, sbAfterGlobal);
  assert.ok(saved.updatedAt);
});

test("generateStoryboard reads SCENE_SCHEMA.json fallback when rawAnalysis is absent", async () => {
  ensureProjectDirs(TEST_SCHEMA_SLUG);
  const schema = {
    schema_version: 2,
    project_name: "schema-fallback-test",
    canvas: { width: 1080, height: 1920, fps: 30, duration_seconds: 12 },
    scenes: [
      {
        id: "scene_01",
        name: "Opening Hook",
        start_time: 0,
        end_time: 6,
        clip_src: "assets/clips/scene_01.mp4",
        voiceover_src: "assets/audio/vo_01.mp3",
        key_fx: ["camera_zoom_200", "whoosh_sfx"],
      },
      {
        id: "scene_02",
        name: "Isometric Grid",
        start_time: 6,
        end_time: 12,
        clip_src: "assets/clips/scene_02.mp4",
        voiceover_src: "assets/audio/vo_02.mp3",
        key_fx: ["isometric_3d_tilt_15deg", "pop_sfx"],
      },
    ],
  };
  fs.writeFileSync(
    path.join(TEST_SCHEMA_DIR, "SCENE_SCHEMA.json"),
    JSON.stringify(schema, null, 2),
    "utf8",
  );

  const sb = await generateStoryboard({
    slug: TEST_SCHEMA_SLUG,
    projectBrief: {
      slug: TEST_SCHEMA_SLUG,
      title: "Schema Test",
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 12,
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#F1C40F",
        background: "#0A1612",
      },
    },
  });

  assert.equal(sb.frames.length, 2);
  assert.equal(sb.frames[0].title, "Opening Hook");
  assert.equal(sb.frames[0].sourceClip, "assets/clips/scene_01.mp4");
  assert.equal(sb.frames[1].title, "Isometric Grid");
  assertValidPngOver10Kb(path.join(TEST_SCHEMA_DIR, sb.frames[0].designFramePath));
  assertValidPngOver10Kb(path.join(TEST_SCHEMA_DIR, sb.frames[0].hudFramePath));
});

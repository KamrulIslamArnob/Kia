import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PROJECTS_DIR, ensureProjectDirs } from "../lib.mjs";
import { saveStoryboard, regenerateFrame } from "../storyboard.mjs";
import { setSelectedProjectSkills } from "../skills-registry.mjs";
import {
  evaluateProjectVideoRating,
  loadLatestVideoRating,
  computeWcagContrastRatio,
  scoreToGrade,
} from "../video-rating.mjs";

const GOOD_SLUG = `test-rating-good-${process.pid}`;
const BAD_SLUG = `test-rating-bad-${process.pid}`;
const FIX_SLUG = `test-rating-fix-${process.pid}`;
const SKILL_SLUG = `test-rating-skill-${process.pid}`;

const ALL_SLUGS = [GOOD_SLUG, BAD_SLUG, FIX_SLUG, SKILL_SLUG];

function createSolidPng(width, height, [r, g, b]) {
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
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowLen;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
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

function cleanupTempSlugs() {
  for (const slug of ALL_SLUGS) {
    fs.rmSync(path.join(PROJECTS_DIR, slug), { recursive: true, force: true });
  }
}

before(() => {
  cleanupTempSlugs();
  for (const slug of ALL_SLUGS) {
    ensureProjectDirs(slug);
  }
});

after(() => {
  cleanupTempSlugs();
});

test("scoreToGrade and computeWcagContrastRatio follow exact grade tiers and WCAG 2.1 math", () => {
  assert.equal(scoreToGrade(100), "S");
  assert.equal(scoreToGrade(95), "S");
  assert.equal(scoreToGrade(94), "A+");
  assert.equal(scoreToGrade(90), "A+");
  assert.equal(scoreToGrade(89), "A");
  assert.equal(scoreToGrade(85), "A");
  assert.equal(scoreToGrade(84), "B+");
  assert.equal(scoreToGrade(80), "B+");
  assert.equal(scoreToGrade(79), "B");
  assert.equal(scoreToGrade(70), "B");
  assert.equal(scoreToGrade(69), "C");
  assert.equal(scoreToGrade(0), "C");

  const bw = computeWcagContrastRatio("#FFFFFF", "#000000");
  assert.ok(Math.abs(bw - 21) < 0.05, `Expected ~21:1 contrast, got ${bw}`);
  assert.equal(computeWcagContrastRatio("#1E824C", "#1E824C"), 1);

  const studioDark = computeWcagContrastRatio("#F8FAFC", "#070B12");
  assert.ok(studioDark >= 17, `Expected >=17:1 contrast, got ${studioDark}`);

  const washedOut = computeWcagContrastRatio("#F8FAFC", "#CBD5E1");
  assert.ok(washedOut < 2.0, `Expected <2:1 contrast, got ${washedOut}`);
});

test("rates high-quality storyboard significantly above flawed storyboard and persists .studio/latest-rating.json", async () => {
  const goodDir = path.join(PROJECTS_DIR, GOOD_SLUG);
  const designDir = path.join(goodDir, ".studio", "frames", "design");
  fs.mkdirSync(designDir, { recursive: true });

  const goodFrames = [
    {
      id: "frame_01",
      index: 1,
      sceneId: "scene_01",
      title: "Instant Seed Harvest Savings",
      narrativeBeat: "hook",
      layout: "device-3d-showcase",
      motionPreset: "crash-zoom-in",
      cameraMotion: {
        presetId: "crash-zoom-in",
        label: "Crash Zoom In",
        fromScale: 1.0,
        toScale: 1.65,
        panX: 0,
        panY: -6,
        tiltDeg: 0,
        focusX: 50,
        focusY: 46,
        ease: "expo.out",
        transitionIn: "zoom-through",
        transitionOut: "cut-the-curve",
      },
      durationSeconds: 3.6,
      speedFactor: 1.0,
      staging: {
        headline: "Instant Seed Harvest Savings",
        subheadline: "Verified wholesale winter packets delivered direct to your shop.",
        badgeText: "WINTER LAUNCH",
        captionText: "Order verified wholesale seed packets with zero transport loss.",
        ctaText: "Order Direct",
        theme: "brand-dark",
        calloutItems: [
          { label: "SAVINGS", value: "35% Wholesale" },
          { label: "DELIVERY", value: "48h Doorstep" },
        ],
        cursorTarget: { x: 50, y: 46, showRipple: true },
      },
      audioSpec: {
        voiceoverText: "Order verified wholesale seed packets with zero transport loss.",
        sfx: ["whoosh", "pop"],
        bgmMood: "warm-modern",
      },
      locked: true,
      approved: true,
      currentVersion: 1,
      designFramePath: ".studio/frames/design/frame_01_v1.png",
      hudFramePath: ".studio/frames/design/frame_01_v1_hud.png",
    },
    {
      id: "frame_02",
      index: 2,
      sceneId: "scene_02",
      title: "Five Curated Crop Varieties",
      narrativeBeat: "feature-grid",
      layout: "bento-feature-grid",
      motionPreset: "bento-triptych",
      cameraMotion: {
        presetId: "bento-triptych",
        label: "Bento Triptych",
        fromScale: 0.96,
        toScale: 1.08,
        panX: -4,
        panY: -4,
        tiltDeg: 0,
        focusX: 50,
        focusY: 50,
        ease: "power3.out",
        transitionIn: "waterfall-cut",
        transitionOut: "cut-the-curve",
      },
      durationSeconds: 4.4,
      speedFactor: 1.1,
      staging: {
        headline: "Five Curated Crop Varieties",
        subheadline: "Cauliflower, cabbage, gourd, tomato, and carrot sealed for freshness.",
        badgeText: "5 SEED PACKS",
        captionText: "Five sealed high-yield winter varieties ready for counter display.",
        ctaText: "Browse Packs",
        theme: "brand-dark",
        calloutItems: [
          { label: "PACKS", value: "5 Hybrids" },
          { label: "GERMINATION", value: "98% Tested" },
        ],
        cursorTarget: { x: 50, y: 50, showRipple: true },
      },
      audioSpec: {
        voiceoverText: "Five sealed high-yield winter varieties ready for counter display.",
        sfx: ["pop"],
        bgmMood: "warm-modern",
      },
      locked: true,
      approved: true,
      currentVersion: 1,
      designFramePath: ".studio/frames/design/frame_02_v1.png",
      hudFramePath: ".studio/frames/design/frame_02_v1_hud.png",
    },
    {
      id: "frame_03",
      index: 3,
      sceneId: "scene_03",
      title: "One-Tap Wholesale Checkout",
      narrativeBeat: "interaction",
      layout: "spotlight-cursor-zoom",
      motionPreset: "spotlight-cursor-follow",
      cameraMotion: {
        presetId: "spotlight-cursor-follow",
        label: "Spotlight Cursor Follow",
        fromScale: 1.08,
        toScale: 1.52,
        panX: 6,
        panY: 8,
        tiltDeg: 0,
        focusX: 56,
        focusY: 58,
        ease: "power4.inOut",
        transitionIn: "rack-focus",
        transitionOut: "zoom-through",
      },
      durationSeconds: 4.1,
      speedFactor: 1.25,
      staging: {
        headline: "One-Tap Wholesale Checkout",
        subheadline: "Confirm cart quantities with instant free-shipping eligibility.",
        badgeText: "EXPRESS FLOW",
        captionText: "Tap once to lock wholesale pricing and free delivery.",
        ctaText: "Confirm Cart",
        theme: "brand-dark",
        calloutItems: [
          { label: "FREE SHIP", value: "Orders 5,000+" },
          { label: "SPEED", value: "30s Checkout" },
        ],
        cursorTarget: { x: 56, y: 58, showRipple: true },
      },
      audioSpec: {
        voiceoverText: "Tap once to lock wholesale pricing and free delivery.",
        sfx: ["pop", "whoosh"],
        bgmMood: "warm-modern",
      },
      locked: true,
      approved: true,
      currentVersion: 1,
      designFramePath: ".studio/frames/design/frame_03_v1.png",
      hudFramePath: ".studio/frames/design/frame_03_v1_hud.png",
    },
    {
      id: "frame_04",
      index: 4,
      sceneId: "scene_04",
      title: "Start Stocking Today",
      narrativeBeat: "cta-outro",
      layout: "split-editorial",
      motionPreset: "whip-pan-split",
      cameraMotion: {
        presetId: "whip-pan-split",
        label: "Whip Pan Split",
        fromScale: 1.12,
        toScale: 1.02,
        panX: -14,
        panY: 0,
        tiltDeg: -3,
        focusX: 42,
        focusY: 50,
        ease: "expo.inOut",
        transitionIn: "whip-pan",
        transitionOut: "cut-the-curve",
      },
      durationSeconds: 3.9,
      speedFactor: 1.0,
      staging: {
        headline: "Start Stocking Today",
        subheadline: "Join 4,000 agro retailers stocking direct from Krishop.",
        badgeText: "CLAIM OFFER",
        captionText: "Claim the winter wholesale offer before regional stock closes.",
        ctaText: "Claim Offer",
        theme: "brand-dark",
        calloutItems: [
          { label: "RETAILERS", value: "4,000+ Active" },
          { label: "SUPPORT", value: "7-Day Direct" },
        ],
        cursorTarget: { x: 42, y: 50, showRipple: true },
      },
      audioSpec: {
        voiceoverText: "Claim the winter wholesale offer before regional stock closes.",
        sfx: ["chime", "whoosh"],
        bgmMood: "warm-modern",
      },
      locked: true,
      approved: true,
      currentVersion: 1,
      designFramePath: ".studio/frames/design/frame_04_v1.png",
      hudFramePath: ".studio/frames/design/frame_04_v1_hud.png",
    },
  ];

  for (const frame of goodFrames) {
    fs.writeFileSync(
      path.join(goodDir, frame.designFramePath),
      createSolidPng(64, 64, [16, 42, 30]),
    );
    fs.writeFileSync(path.join(goodDir, frame.hudFramePath), createSolidPng(64, 64, [24, 52, 38]));
  }

  const goodProject = {
    slug: GOOD_SLUG,
    title: "Krishop Wholesale Reel",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 16.0,
    language: "English",
    brandColors: {
      primary: "#146C43",
      secondary: "#20C997",
      accent: "#F59E0B",
      background: "#0B1913",
    },
    brandKit: {
      logoRelPath: "assets/images/logo.svg",
      guidelinesText: "Botanical emerald wholesale palette with crisp off-white display type.",
      fonts: { heading: "Geist Sans", body: "Geist Sans" },
      tone: "Direct & Trustworthy",
      extractedPalette: ["#146C43", "#20C997", "#F59E0B", "#0B1913"],
    },
    inspirationProfile: {
      avgShotLength: 4.0,
      pacing: "rhythmic-editorial",
      cutsPerMinute: 15,
    },
    instructions: "Vertical 9:16 wholesale seed launch promo for agro shopkeepers.",
  };

  fs.writeFileSync(
    path.join(goodDir, "PROJECT_BRIEF.json"),
    JSON.stringify(goodProject, null, 2) + "\n",
    "utf8",
  );
  const goodSb = saveStoryboard(GOOD_SLUG, {
    title: goodProject.title,
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    brandColors: goodProject.brandColors,
    inspirationProfile: goodProject.inspirationProfile,
    frames: goodFrames,
  });

  const goodRating = await evaluateProjectVideoRating({
    slug: GOOD_SLUG,
    project: goodProject,
    storyboard: goodSb,
    selectedSkillSpecs: [],
  });

  assert.equal(Number.isInteger(goodRating.overallScore), true);
  assert.ok(
    goodRating.overallScore >= 88,
    `Expected strong storyboard >=88, got ${goodRating.overallScore}`,
  );
  assert.ok(["S", "A+", "A"].includes(goodRating.grade));
  assert.equal(typeof goodRating.verdict, "string");
  assert.ok(goodRating.verdict.length >= 20);

  const catKeys = [
    "hookAndPacing",
    "visualHierarchyAndContrast",
    "motionContinuity",
    "skillAlignment",
    "brandConsistency",
    "audioAndCaptions",
  ];
  let totalWeight = 0;
  for (const key of catKeys) {
    const cat = goodRating.categories[key];
    assert.ok(cat, `Missing category ${key}`);
    assert.equal(Number.isInteger(cat.score), true);
    assert.ok(cat.score >= 80 && cat.score <= 100, `Expected ${key} >=80, got ${cat.score}`);
    assert.equal(typeof cat.weight, "number");
    assert.equal(typeof cat.detail, "string");
    assert.ok(cat.detail.length > 8);
    assert.deepEqual(goodRating.subScores[key], cat);
    totalWeight += cat.weight;
  }
  assert.ok(Math.abs(totalWeight - 1.0) < 1e-6, `Expected weights sum to 1.0, got ${totalWeight}`);
  assert.equal(goodRating.frameRatings.length, 4);

  const persistedPath = path.join(goodDir, ".studio", "latest-rating.json");
  assert.equal(fs.existsSync(persistedPath), true);
  const loaded = loadLatestVideoRating(GOOD_SLUG);
  assert.equal(loaded.overallScore, goodRating.overallScore);
  assert.equal(loaded.grade, goodRating.grade);

  // Now evaluate a deliberately flawed low-quality storyboard
  const badProject = {
    slug: BAD_SLUG,
    title: "Untouched Draft",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 12.0,
    language: "English",
    brandColors: {
      // Untouched defaults EXCEPT low-contrast pale slate background with #F8FAFC text!
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#F1C40F",
      background: "#CBD5E1",
    },
    brandKit: {
      logoRelPath: null,
      guidelinesText: "",
      fonts: { heading: "Inter", body: "Inter" },
      tone: "Confident & Modern",
      extractedPalette: [],
    },
    inspirationProfile: {
      avgShotLength: 2.8,
      pacing: "fast-kinetic",
    },
    instructions: "",
  };

  const staticCam = {
    presetId: "parallax-float",
    label: "Static Lockoff",
    fromScale: 1.0,
    toScale: 1.0,
    panX: 0,
    panY: 0,
    tiltDeg: 0,
    focusX: 50,
    focusY: 50,
    ease: "none",
    transitionIn: "crossfade",
    transitionOut: "crossfade",
  };

  const badStoryboard = {
    slug: BAD_SLUG,
    frames: [
      {
        id: "frame_01",
        index: 1,
        title: "",
        layout: "device-3d-showcase",
        motionPreset: "parallax-float",
        cameraMotion: { ...staticCam },
        durationSeconds: 9.5, // > 7s hook violation!
        speedFactor: 3.8, // > 3.0x speed ramp violation!
        staging: {
          headline: "", // empty headline!
          subheadline: "",
          badgeText: "",
          captionText: "",
          theme: "brand-dark", // #F8FAFC text on #CBD5E1 bg -> < 2.0:1 contrast!
          calloutItems: [],
        },
        audioSpec: {
          voiceoverText: "", // missing VO!
          sfx: [],
        },
        locked: false,
        designFramePath: ".studio/frames/design/missing_01.png", // missing PNG on disk!
      },
      {
        id: "frame_02",
        index: 2,
        title: "Shot 2",
        layout: "device-3d-showcase",
        motionPreset: "parallax-float", // consecutive identical static lockoff!
        cameraMotion: { ...staticCam, transitionIn: "", transitionOut: "" },
        durationSeconds: 9.5, // identical duration!
        speedFactor: 0.25, // < 0.4x speed ramp violation!
        staging: {
          headline: "বাংলা টেক্সট মিক্সড উইথ English unpredictably",
          subheadline: "",
          badgeText: "",
          captionText:
            "This voiceover crams way too many spoken words into a tiny window so edge tts has to speed up playback excessively fast beyond comprehension right now today immediately.",
          theme: "brand-dark",
          calloutItems: [],
        },
        audioSpec: {
          // 28 words in 2.5s would be >11 wps; even in 9.5s let's make shot 3 have 24 words in 3.0s (8 wps > 3.4 wps!)
          voiceoverText: "",
          sfx: [],
        },
        locked: false,
        designFramePath: ".studio/frames/design/missing_02.png",
      },
      {
        id: "frame_03",
        index: 3,
        title: "Rushed VO Shot",
        layout: "device-3d-showcase",
        motionPreset: "parallax-float",
        cameraMotion: { ...staticCam },
        durationSeconds: 2.5,
        speedFactor: 3.5,
        staging: {
          headline: "Short",
          subheadline: "",
          badgeText: "",
          captionText: "Too fast narration",
          theme: "brand-dark",
          calloutItems: [],
        },
        audioSpec: {
          // 22 words in 2.5s = 8.8 words/sec (> 3.4 words/sec limit!)
          voiceoverText:
            "Every single word in this overcrowded sentence rushes past the listener much faster than three point four words per second easily.",
          sfx: [],
        },
        locked: false,
        designFramePath: ".studio/frames/design/missing_03.png",
      },
    ],
  };

  const badRating = await evaluateProjectVideoRating({
    slug: BAD_SLUG,
    project: badProject,
    storyboard: badStoryboard,
    selectedSkillSpecs: [],
  });

  assert.ok(
    badRating.overallScore < 65,
    `Expected flawed storyboard <65, got ${badRating.overallScore}`,
  );
  assert.equal(badRating.grade, "C");
  for (const key of catKeys) {
    assert.ok(
      badRating.categories[key].score < goodRating.categories[key].score,
      `Expected bad ${key} (${badRating.categories[key].score}) < good (${goodRating.categories[key].score})`,
    );
  }

  for (const fr of badRating.frameRatings) {
    assert.ok(fr.issues.length > 0, `Expected issues on ${fr.frameId}`);
    assert.equal(typeof fr.suggestedFixPrompt, "string");
    assert.ok(fr.suggestedFixPrompt.length > 10, `Expected concrete fix prompt on ${fr.frameId}`);
  }
});

test("applying suggestedFixPrompt via regenerateFrame measurably raises frame and overall video rating", async () => {
  const fixDir = path.join(PROJECTS_DIR, FIX_SLUG);
  const rawDir = path.join(fixDir, ".studio", "frames", "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, "scene_01_peak.png"), createSolidPng(96, 160, [28, 90, 62]));

  const fixProject = {
    slug: FIX_SLUG,
    title: "Interactive Product Demo",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 12.0,
    language: "English",
    brandColors: {
      primary: "#2563EB",
      secondary: "#3B82F6",
      accent: "#F59E0B",
      // Washed-out light background so default "brand-dark" (#F8FAFC text) has poor WCAG contrast!
      background: "#CBD5E1",
    },
    brandKit: {
      logoRelPath: "assets/images/logo.png",
      guidelinesText: "High-clarity interactive SaaS demo.",
      fonts: { heading: "Geist Sans", body: "Geist Sans" },
      tone: "Crisp",
      extractedPalette: ["#2563EB", "#3B82F6", "#F59E0B"],
    },
    instructions: "Show fast hook, clean feature overview, and cursor spotlight click.",
  };
  fs.writeFileSync(
    path.join(fixDir, "PROJECT_BRIEF.json"),
    JSON.stringify(fixProject, null, 2) + "\n",
    "utf8",
  );

  saveStoryboard(FIX_SLUG, {
    title: fixProject.title,
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    brandColors: fixProject.brandColors,
    frames: [
      {
        id: "frame_01",
        index: 1,
        sceneId: "scene_01",
        title: "",
        narrativeBeat: "hook",
        layout: "device-3d-showcase",
        motionPreset: "parallax-float",
        cameraMotion: {
          presetId: "parallax-float",
          label: "Static",
          fromScale: 1.0,
          toScale: 1.0,
          panX: 0,
          panY: 0,
          tiltDeg: 0,
          focusX: 50,
          focusY: 50,
          ease: "sine.inOut",
          transitionIn: "crossfade",
          transitionOut: "crossfade",
        },
        durationSeconds: 3.8,
        speedFactor: 3.6, // Out-of-bounds speed ramp!
        keyframes: {
          start: ".studio/frames/raw/scene_01_peak.png",
          peak: ".studio/frames/raw/scene_01_peak.png",
          end: ".studio/frames/raw/scene_01_peak.png",
        },
        staging: {
          headline: "", // Missing headline!
          subheadline: "Track live orders in one clean dashboard.",
          badgeText: "",
          captionText: "Track live orders in one clean dashboard.",
          theme: "brand-dark", // Poor contrast against #CBD5E1!
          calloutItems: [
            { label: "LIVE", value: "Real-Time" },
            { label: "SYNC", value: "Instant" },
          ],
          cursorTarget: { x: 50, y: 50, showRipple: true },
        },
        audioSpec: {
          voiceoverText: "Track live orders in one clean dashboard.",
          sfx: ["whoosh"],
          bgmMood: "warm-modern",
        },
        locked: false,
        approved: false,
        currentVersion: 1,
        designFramePath: ".studio/frames/design/missing_f1.png", // Missing PNG on disk!
        hudFramePath: ".studio/frames/design/missing_f1_hud.png",
        history: [],
      },
      {
        id: "frame_02",
        index: 2,
        sceneId: "scene_02",
        title: "Interactive Action Step",
        narrativeBeat: "interaction",
        layout: "device-3d-showcase", // Missing spotlight-cursor-zoom for oversized-cursor skill!
        motionPreset: "parallax-float", // Repeats preset & static camera!
        cameraMotion: {
          presetId: "parallax-float",
          label: "Static",
          fromScale: 1.0,
          toScale: 1.0,
          panX: 0,
          panY: 0,
          tiltDeg: 0,
          focusX: 50,
          focusY: 50,
          ease: "sine.inOut",
          transitionIn: "crossfade",
          transitionOut: "crossfade",
        },
        durationSeconds: 4.4,
        speedFactor: 0.28, // Out-of-bounds slow speed!
        keyframes: {
          start: ".studio/frames/raw/scene_01_peak.png",
          peak: ".studio/frames/raw/scene_01_peak.png",
          end: ".studio/frames/raw/scene_01_peak.png",
        },
        staging: {
          headline: "Tap To Confirm Dispatch",
          subheadline: "Instant courier assignment from one screen.",
          badgeText: "ACTION",
          captionText: "Tap once to assign a courier and dispatch immediately.",
          theme: "brand-dark",
          calloutItems: [
            { label: "STEP", value: "One Tap" },
            { label: "STATUS", value: "Dispatched" },
          ],
          cursorTarget: { x: 54, y: 58, showRipple: true },
        },
        audioSpec: {
          voiceoverText: "Tap once to assign a courier and dispatch immediately.",
          sfx: ["pop"],
          bgmMood: "warm-modern",
        },
        locked: false,
        approved: false,
        currentVersion: 1,
        designFramePath: ".studio/frames/design/missing_f2.png",
        hudFramePath: ".studio/frames/design/missing_f2_hud.png",
        history: [],
      },
    ],
  });

  const skillSpecs = [
    {
      id: "oversized-cursor",
      name: "oversized-cursor",
      description: "House-style oversized macOS cursor spotlight interaction for UI shots.",
      category: "motion",
      ruleHighlights: ["Include an interactive spotlight cursor shot with click target."],
    },
  ];

  const beforeRating = await evaluateProjectVideoRating({
    slug: FIX_SLUG,
    selectedSkillSpecs: skillSpecs,
  });

  assert.ok(
    beforeRating.overallScore < 78,
    `Expected pre-fix score <78, got ${beforeRating.overallScore}`,
  );
  for (const fr of beforeRating.frameRatings) {
    assert.ok(fr.suggestedFixPrompt, `Expected suggestedFixPrompt on ${fr.frameId}`);
    await regenerateFrame({
      slug: FIX_SLUG,
      frameId: fr.frameId,
      prompt: fr.suggestedFixPrompt,
    });
  }

  const afterRating = await evaluateProjectVideoRating({
    slug: FIX_SLUG,
    selectedSkillSpecs: skillSpecs,
  });

  assert.ok(
    afterRating.overallScore >= beforeRating.overallScore + 15,
    `Expected score jump >=15 after 1-click fixes (${beforeRating.overallScore} -> ${afterRating.overallScore})`,
  );
  assert.ok(
    afterRating.categories.skillAlignment.score > beforeRating.categories.skillAlignment.score,
    `Expected skillAlignment to rise (${beforeRating.categories.skillAlignment.score} -> ${afterRating.categories.skillAlignment.score})`,
  );
  for (let i = 0; i < beforeRating.frameRatings.length; i += 1) {
    assert.ok(
      afterRating.frameRatings[i].score > beforeRating.frameRatings[i].score,
      `Expected frame_${i + 1} score to rise (${beforeRating.frameRatings[i].score} -> ${afterRating.frameRatings[i].score})`,
    );
  }
});

test("dynamically evaluates captions-overlay, oversized-cursor, minimalist-ui, seam-craft, custom SKILL.md, and omitted args", async () => {
  const skillDir = path.join(PROJECTS_DIR, SKILL_SLUG);
  const designDir = path.join(skillDir, ".studio", "frames", "design");
  fs.mkdirSync(designDir, { recursive: true });
  fs.writeFileSync(path.join(designDir, "f1.png"), createSolidPng(64, 64, [15, 20, 30]));
  fs.writeFileSync(path.join(designDir, "f2.png"), createSolidPng(64, 64, [15, 20, 30]));

  const baseFrames = [
    {
      id: "frame_01",
      index: 1,
      title: "Unleash Next-Gen Seamless Magic 🚀",
      narrativeBeat: "hook",
      layout: "kinetic-statement-card",
      motionPreset: "editorial-kinetic-card",
      cameraMotion: {
        presetId: "editorial-kinetic-card",
        label: "Editorial Kinetic Card",
        fromScale: 1.0,
        toScale: 1.18,
        panX: 0,
        panY: -3,
        tiltDeg: 0,
        focusX: 50,
        focusY: 20, // Shifted up artificially as if avoiding bottom keep-out band!
        ease: "expo.out",
        transitionIn: "crossfade",
        transitionOut: "crossfade",
      },
      durationSeconds: 3.8,
      speedFactor: 1.0,
      staging: {
        headline: "Unleash Next-Gen Seamless Magic 🚀",
        subheadline: "A cheap placeholder subtitle with clichés.",
        badgeText: "LAUNCH",
        captionText:
          "This overly crowded multi-sentence bottom caption packs way too much dense copy into the lower band instead of staying a clean concise single-line verbatim rail overlay.",
        theme: "gold",
        calloutItems: [
          { label: "A", value: "1" },
          { label: "B", value: "2" },
        ],
      },
      audioSpec: {
        voiceoverText: "Discover fast reliable delivery built for modern shops.",
        sfx: ["whoosh"],
      },
      locked: false,
      designFramePath: ".studio/frames/design/f1.png",
    },
    {
      id: "frame_02",
      index: 2,
      title: "Second Adjacent Kinetic Embed",
      narrativeBeat: "interaction",
      layout: "kinetic-statement-card", // Two adjacent kinetic embed cards!
      motionPreset: "crash-zoom-in",
      cameraMotion: {
        presetId: "crash-zoom-in",
        label: "Crash Zoom In",
        fromScale: 1.0,
        toScale: 1.45,
        panX: 0,
        panY: -4,
        tiltDeg: 0,
        focusX: 50,
        focusY: 46,
        ease: "expo.out",
        transitionIn: "crossfade",
        transitionOut: "crossfade",
      },
      durationSeconds: 4.2,
      speedFactor: 1.0,
      staging: {
        headline: "Second Adjacent Embed Card",
        subheadline: "Clean supporting detail.",
        badgeText: "STEP 2",
        captionText: "Review order summary in seconds.",
        theme: "gold",
        calloutItems: [
          { label: "C", value: "3" },
          { label: "D", value: "4" },
        ],
      },
      audioSpec: {
        voiceoverText: "Review your order summary in seconds.",
        sfx: ["pop"],
      },
      locked: false,
      designFramePath: ".studio/frames/design/f2.png",
    },
  ];

  const baseProject = {
    slug: SKILL_SLUG,
    title: "Skill Matrix Test",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 8.0,
    language: "English",
    brandColors: {
      primary: "#2563EB",
      secondary: "#1D4ED8",
      accent: "#F59E0B",
      background: "transparent", // Triggers seam-craft white-flash warning!
    },
    brandKit: {
      logoRelPath: "assets/images/logo.svg",
      guidelinesText: "Clean product reel.",
      fonts: { heading: "Geist Sans", body: "Geist Sans" },
      tone: "Crisp",
      extractedPalette: ["#2563EB", "#1D4ED8"],
    },
    instructions: "Test dynamic skill compliance.",
  };

  const noSkillsRating = await evaluateProjectVideoRating({
    slug: SKILL_SLUG,
    project: baseProject,
    storyboard: { slug: SKILL_SLUG, frames: baseFrames },
    selectedSkillSpecs: [],
  });

  const captionsRating = await evaluateProjectVideoRating({
    slug: SKILL_SLUG,
    project: baseProject,
    storyboard: { slug: SKILL_SLUG, frames: baseFrames },
    selectedSkillSpecs: [{ id: "captions-overlay", name: "captions-overlay" }],
  });
  assert.ok(
    captionsRating.categories.skillAlignment.score < noSkillsRating.categories.skillAlignment.score,
    `Expected captions-overlay violation to lower skillAlignment (${captionsRating.categories.skillAlignment.score} vs ${noSkillsRating.categories.skillAlignment.score})`,
  );

  const cursorRating = await evaluateProjectVideoRating({
    slug: SKILL_SLUG,
    project: baseProject,
    storyboard: { slug: SKILL_SLUG, frames: baseFrames },
    selectedSkillSpecs: [{ id: "oversized-cursor", name: "oversized-cursor" }],
  });
  assert.ok(cursorRating.categories.skillAlignment.score < 75);
  assert.ok(
    cursorRating.frameRatings.some((fr) =>
      String(fr.suggestedFixPrompt || "").includes("spotlight-cursor"),
    ),
  );

  const minimalistRating = await evaluateProjectVideoRating({
    slug: SKILL_SLUG,
    project: baseProject,
    storyboard: { slug: SKILL_SLUG, frames: baseFrames },
    selectedSkillSpecs: [{ id: "minimalist-ui", name: "minimalist-ui" }],
  });
  assert.ok(minimalistRating.categories.skillAlignment.score < 70);
  assert.ok(
    minimalistRating.frameRatings[0].issues.some((msg) =>
      /emoji|clich|minimalist|light/i.test(msg),
    ),
  );

  const seamRating = await evaluateProjectVideoRating({
    slug: SKILL_SLUG,
    project: baseProject,
    storyboard: { slug: SKILL_SLUG, frames: baseFrames },
    selectedSkillSpecs: [{ id: "seam-craft", name: "seam-craft" }],
  });
  assert.ok(seamRating.categories.skillAlignment.score < 75);
  assert.match(seamRating.categories.skillAlignment.detail, /seam|background|crossfade|opaque/i);

  // Write a brand-new custom project-local SKILL.md and test omitted arguments auto-discovery!
  const customSkillDir = path.join(skillDir, "skills", "cinema-emerald-pro");
  fs.mkdirSync(customSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(customSkillDir, "SKILL.md"),
    [
      "---",
      "name: cinema-emerald-pro",
      "description: Bespoke emerald cinema house style requiring fullbleed-cinema and dolly-out-reveal.",
      "---",
      "# Cinema Emerald Pro",
      "- Always stage at least one `fullbleed-cinema` hero scene with `dolly-out-reveal`.",
      "- Use `emerald` theme palette (#059669).",
      '- DO NOT use "cheap" in copy.',
      "- Keep every shot maximum 5s.",
    ].join("\n"),
    "utf8",
  );

  const projectWithSelectedCustomSkill = {
    ...baseProject,
    brandColors: { ...baseProject.brandColors, background: "#051811" },
    selectedSkills: ["cinema-emerald-pro"],
  };
  fs.writeFileSync(
    path.join(skillDir, "PROJECT_BRIEF.json"),
    JSON.stringify(projectWithSelectedCustomSkill, null, 2) + "\n",
    "utf8",
  );
  saveStoryboard(SKILL_SLUG, {
    title: baseProject.title,
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    brandColors: projectWithSelectedCustomSkill.brandColors,
    frames: baseFrames,
  });

  // Call with ONLY { slug } — omitted project, storyboard, and selectedSkillSpecs!
  const customViolatedRating = await evaluateProjectVideoRating({ slug: SKILL_SLUG });
  assert.ok(customViolatedRating.activeSkillIds.includes("cinema-emerald-pro"));
  assert.ok(
    customViolatedRating.categories.skillAlignment.score < 80,
    `Expected custom skill violation <80, got ${customViolatedRating.categories.skillAlignment.score}`,
  );

  // Now satisfy the custom SKILL.md rules and verify skillAlignment jumps to >= 90!
  const compliantFrames = baseFrames.map((f, idx) => ({
    ...f,
    title: idx === 0 ? "Botanical Emerald Reserve" : "Direct Harvest Delivery",
    layout: idx === 0 ? "fullbleed-cinema" : "split-editorial",
    motionPreset: idx === 0 ? "dolly-out-reveal" : "whip-pan-split",
    cameraMotion: {
      ...f.cameraMotion,
      presetId: idx === 0 ? "dolly-out-reveal" : "whip-pan-split",
      fromScale: idx === 0 ? 1.65 : 1.12,
      toScale: idx === 0 ? 1.0 : 1.04,
      focusY: 48,
      transitionIn: idx === 0 ? "inverse-zoom" : "whip-pan",
      transitionOut: "cut-the-curve",
    },
    staging: {
      ...f.staging,
      headline: idx === 0 ? "Botanical Emerald Reserve" : "Direct Harvest Delivery",
      subheadline: "Verified origin seed packets sealed at harvest.",
      captionText: "Verified origin seed packets sealed at harvest.",
      theme: "emerald",
    },
  }));
  saveStoryboard(SKILL_SLUG, {
    title: baseProject.title,
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    brandColors: projectWithSelectedCustomSkill.brandColors,
    frames: compliantFrames,
  });

  const customCompliantRating = await evaluateProjectVideoRating({ slug: SKILL_SLUG });
  assert.ok(
    customCompliantRating.categories.skillAlignment.score >= 90,
    `Expected compliant custom skill >=90, got ${customCompliantRating.categories.skillAlignment.score}`,
  );

  await assert.rejects(() => evaluateProjectVideoRating({ slug: "../unsafe-escape" }), /Invalid/i);
});

test("integrates live with skills-registry setSelectedProjectSkills and handles empty storyboards deterministically", async () => {
  await setSelectedProjectSkills(SKILL_SLUG, ["oversized-cursor", "seam-craft"]);

  const liveRegistryRating = await evaluateProjectVideoRating({ slug: SKILL_SLUG });
  assert.deepEqual(liveRegistryRating.activeSkillIds, ["oversized-cursor", "seam-craft"]);
  assert.equal(liveRegistryRating.skillChecks.length, 2);

  // Empty storyboard returns 0 / Grade C without throwing
  const emptyRating = await evaluateProjectVideoRating({
    project: { title: "Blank" },
    storyboard: { frames: [] },
    selectedSkillSpecs: [],
  });
  assert.equal(emptyRating.overallScore, 0);
  assert.equal(emptyRating.grade, "C");
  assert.equal(emptyRating.frameRatings.length, 0);
  assert.match(emptyRating.verdict, /generate storyboard frames/i);
});

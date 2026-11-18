import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LAYOUT_ARCHETYPES, MOTION_PRESETS, parseFramePrompt } from "../storyboard.mjs";
import {
  PLATFORM_SAFE_ZONE_SPECS,
  evaluateAdCreativeAnalytics,
  loadLatestAdAnalytics,
} from "../ad-analytics.mjs";

const EMOJI_RE = /\p{Extended_Pictographic}/u;

function createStrongAdFixture() {
  return {
    project: {
      slug: "strong-ad-demo",
      title: "Krishop Express",
      aspectRatio: "9:16",
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 11,
      language: "English",
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#FACC15",
        background: "#0A1410",
      },
    },
    storyboard: {
      slug: "strong-ad-demo",
      aspectRatio: "9:16",
      totalDurationSeconds: 11,
      frames: [
        {
          id: "frame_01",
          index: 1,
          title: "Fresh Groceries in 15 Minutes",
          layout: "device-3d-showcase",
          motionPreset: "crash-zoom-in",
          durationSeconds: 2.8,
          speedFactor: 1.2,
          hasCharacter: true,
          cameraMotion: {
            presetId: "crash-zoom-in",
            fromScale: 1.0,
            toScale: 1.65,
            panX: 0,
            panY: -4,
            tiltDeg: 10,
            focusX: 48,
            focusY: 44,
          },
          staging: {
            theme: "emerald",
            badgeText: "50% OFF FIRST ORDER",
            headline: "Fresh Groceries in 15 Minutes",
            subheadline: "Farm-picked produce delivered straight to your door.",
            captionText: "Get fresh farm produce delivered in 15 minutes.",
            calloutItems: [
              { label: "DELIVERY", value: "15 MIN" },
              { label: "SAVINGS", value: "50% OFF" },
            ],
          },
          audioSpec: {
            voiceoverText: "Get fresh farm groceries delivered in fifteen minutes.",
            sfx: ["whoosh", "pop"],
          },
        },
        {
          id: "frame_02",
          index: 2,
          title: "One-Tap Smart Reorder",
          layout: "bento-feature-grid",
          motionPreset: "bento-triptych",
          durationSeconds: 3.6,
          speedFactor: 1.1,
          cameraMotion: {
            presetId: "bento-triptych",
            fromScale: 0.96,
            toScale: 1.12,
            panX: 4,
            panY: -3,
            focusX: 50,
            focusY: 48,
          },
          staging: {
            theme: "dark",
            badgeText: "VERIFIED QUALITY",
            headline: "Curated Daily Picks Zero Hassle",
            subheadline: "Every item quality-checked before dispatch.",
            captionText: "Browse verified categories and reorder in one tap.",
          },
          audioSpec: {
            voiceoverText: "Browse verified categories and reorder in a single tap.",
            sfx: ["pop"],
          },
        },
        {
          id: "frame_03",
          index: 3,
          title: "Order Now Free Delivery",
          layout: "kinetic-statement-card",
          motionPreset: "editorial-kinetic-card",
          durationSeconds: 3.6,
          speedFactor: 1.0,
          cameraMotion: {
            presetId: "editorial-kinetic-card",
            fromScale: 1.0,
            toScale: 1.18,
            panX: 0,
            panY: -3,
            focusX: 50,
            focusY: 46,
          },
          staging: {
            theme: "gold",
            badgeText: "ORDER NOW",
            headline: "Claim Free Delivery Today",
            subheadline: "Download Krishop Express and save 50% now.",
            captionText: "Download Krishop Express today for free first delivery.",
            ctaText: "Order Now",
          },
          audioSpec: {
            voiceoverText: "Download Krishop Express today for free delivery.",
            sfx: ["chime", "whoosh"],
          },
        },
      ],
    },
  };
}

function createWeakAdFixture() {
  return {
    project: {
      slug: "weak-ad-demo",
      title: "CloudDesk Workflow",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      durationSeconds: 14,
      language: "English",
      brandColors: {
        primary: "#94A3B8",
        secondary: "#CBD5E1",
        accent: "#E2E8F0",
        background: "#CBD5E1",
      },
    },
    storyboard: {
      slug: "weak-ad-demo",
      aspectRatio: "16:9",
      totalDurationSeconds: 14,
      frames: [
        {
          id: "frame_01",
          index: 1,
          title: "Scene 01",
          layout: "fullbleed-cinema",
          motionPreset: "hero-lockoff",
          durationSeconds: 6.5,
          speedFactor: 1.0,
          cameraMotion: {
            presetId: "hero-lockoff",
            fromScale: 1.0,
            toScale: 1.0,
            panX: 0,
            panY: 0,
            focusX: 91,
            focusY: 86,
          },
          staging: {
            headline:
              "Welcome to our comprehensive enterprise software presentation overview video today for modern teams",
            subheadline: "",
            captionText: "",
          },
          audioSpec: {
            voiceoverText:
              "In this video we are going to talk at length about our platform architecture and settings.",
            sfx: [],
          },
        },
        {
          id: "frame_02",
          index: 2,
          title: "Scene 02",
          layout: "fullbleed-cinema",
          motionPreset: "hero-lockoff",
          durationSeconds: 7.5,
          speedFactor: 1.0,
          cameraMotion: {
            presetId: "hero-lockoff",
            fromScale: 1.0,
            toScale: 1.01,
            panX: 0,
            panY: 0,
            focusX: 89,
            focusY: 84,
          },
          staging: {
            headline: "Scene 02",
            subheadline: "",
            captionText: "",
          },
          audioSpec: {
            voiceoverText:
              "Here is another long spoken explanation that muted viewers cannot read anywhere on screen.",
            sfx: [],
          },
        },
      ],
    },
  };
}

test("evaluateAdCreativeAnalytics scores strong vertical ad creative high across hook, sound-off, and safe zones", async () => {
  const { project, storyboard } = createStrongAdFixture();
  const report = await evaluateAdCreativeAnalytics({ project, storyboard });

  assert.ok(
    report.thumbstopHookScore >= 85,
    `Expected thumbstopHookScore >= 85, got ${report.thumbstopHookScore}`,
  );
  assert.ok(
    report.soundOffScore >= 82,
    `Expected soundOffScore >= 82, got ${report.soundOffScore}`,
  );
  assert.equal(typeof report.evaluatedAt, "string");

  // Retention curve covers 0..totalDuration integer seconds
  assert.ok(Array.isArray(report.retentionCurve));
  assert.equal(report.retentionCurve[0].second, 0);
  assert.equal(report.retentionCurve[0].retentionPct, 100);
  assert.equal(report.retentionCurve.at(-1).second, 10);
  for (const pt of report.retentionCurve) {
    assert.equal(typeof pt.second, "number");
    assert.ok(pt.retentionPct >= 0 && pt.retentionPct <= 100);
    assert.equal(typeof pt.event, "string");
    assert.ok(pt.event.length > 0);
  }

  // Platform safe zones support both array iteration and named lookup
  assert.ok(Array.isArray(PLATFORM_SAFE_ZONE_SPECS));
  assert.ok(Array.isArray(report.platformSafeZones));
  assert.equal(report.platformSafeZones.length, 3);
  const platforms = report.platformSafeZones.map((p) => p.platform);
  assert.deepEqual(platforms, ["TikTok", "Instagram Reels", "YouTube Shorts"]);
  for (const zone of report.platformSafeZones) {
    assert.equal(zone.status, "pass", `Expected ${zone.platform} to pass: ${zone.issues}`);
    assert.equal(zone.passed, true);
  }
  assert.equal(report.platformSafeZones.tiktok.status, "pass");
  assert.equal(report.platformSafeZones.instagramReels.status, "pass");
  assert.equal(report.platformSafeZones.youtubeShorts.status, "pass");
});

test("evaluateAdCreativeAnalytics flags weak hook, static dwell drop-off risks, muted gaps, and safe-zone collisions", async () => {
  const { project, storyboard } = createWeakAdFixture();
  const report = await evaluateAdCreativeAnalytics({ project, storyboard });

  assert.ok(
    report.thumbstopHookScore <= 45,
    `Expected weak thumbstopHookScore <= 45, got ${report.thumbstopHookScore}`,
  );
  assert.ok(
    report.soundOffScore <= 45,
    `Expected weak soundOffScore <= 45, got ${report.soundOffScore}`,
  );

  // Drop-off risks identify static dwell / hook issues with executable fixPrompts
  assert.ok(Array.isArray(report.dropOffRisks));
  assert.ok(report.dropOffRisks.length >= 2, "Expected >= 2 drop-off risk windows");
  for (const risk of report.dropOffRisks) {
    assert.equal(typeof risk.timeRange, "string");
    assert.ok(risk.timeRange.length > 0);
    assert.equal(typeof risk.reason, "string");
    assert.ok(risk.reason.length > 10);
    assert.equal(typeof risk.fixPrompt, "string");
    assert.ok(risk.fixPrompt.length > 5);
  }

  // Platform safe zones flag 16:9 aspect + right-rail (focusX=91) + bottom bar (focusY=86) collisions
  for (const zone of report.platformSafeZones) {
    assert.equal(zone.status, "warning");
    assert.equal(zone.passed, false);
    assert.equal(zone.rightRailClear, false);
    assert.equal(zone.bottomOverlayClear, false);
    assert.ok(zone.issues.length >= 2);
  }
});

test("hookVariants generates 3 executable A/B hooks for frame_01 that parse cleanly and boost thumbstopHookScore", async () => {
  const { project, storyboard } = createWeakAdFixture();
  const before = await evaluateAdCreativeAnalytics({ project, storyboard });

  assert.ok(Array.isArray(before.hookVariants));
  assert.equal(before.hookVariants.length, 3);

  const expectedArchetypes = [
    "Problem-Agitation Hook",
    "Bold Offer/Proof Hook",
    "Visual Pattern-Interrupt Hook",
  ];
  assert.deepEqual(
    before.hookVariants.map((v) => v.archetype),
    expectedArchetypes,
  );

  const validMotionIds = new Set(MOTION_PRESETS.map((m) => m.id));
  const validLayouts = new Set(LAYOUT_ARCHETYPES);

  for (const variant of before.hookVariants) {
    assert.equal(typeof variant.id, "string");
    assert.equal(typeof variant.name, "string");
    assert.equal(typeof variant.headline, "string");
    assert.equal(EMOJI_RE.test(variant.headline), false, "Headline must contain zero emojis");
    assert.equal(EMOJI_RE.test(variant.prompt), false, "Prompt must contain zero emojis");

    const words = variant.headline.trim().split(/\s+/).filter(Boolean);
    assert.ok(
      words.length >= 2 && words.length <= 7,
      `Hook headline "${variant.headline}" must be 2..7 words (got ${words.length})`,
    );
    assert.ok(
      validMotionIds.has(variant.motionPreset),
      `Invalid motionPreset: ${variant.motionPreset}`,
    );
    assert.ok(validLayouts.has(variant.layout), `Invalid layout: ${variant.layout}`);

    // Simulate 1-click "Test this hook on Scene 1" using storyboard.mjs parseFramePrompt
    const parsed = parseFramePrompt(variant.prompt);
    assert.equal(parsed.staging.headline, variant.headline);
    assert.ok(parsed.motionPreset, `Prompt should encode motionPreset: ${variant.prompt}`);

    const upgradedStoryboard = structuredClone(storyboard);
    const f1 = upgradedStoryboard.frames[0];
    f1.layout = parsed.layout || variant.layout;
    f1.motionPreset = parsed.motionPreset || variant.motionPreset;
    f1.durationSeconds = 2.8;
    f1.cameraMotion = {
      ...f1.cameraMotion,
      presetId: f1.motionPreset,
      fromScale: 1.0,
      toScale: parsed.camera.toScale || 1.48,
      focusX: 50,
      focusY: 46,
    };
    f1.staging = {
      ...f1.staging,
      ...parsed.staging,
    };
    f1.audioSpec = {
      ...f1.audioSpec,
      sfx: ["whoosh", "pop"],
    };

    const after = await evaluateAdCreativeAnalytics({
      project: { ...project, aspectRatio: "9:16", width: 1080, height: 1920 },
      storyboard: { ...upgradedStoryboard, aspectRatio: "9:16" },
    });

    assert.ok(
      after.thumbstopHookScore >= before.thumbstopHookScore + 30,
      `Applying "${variant.archetype}" should boost hook score by >=30 (${before.thumbstopHookScore} -> ${after.thumbstopHookScore})`,
    );
  }
});

test("persists and reloads projects/<slug>/.studio/ad-analytics.json and supports Bengali/Hindi hooks", async () => {
  const tmpProjectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "studio-ad-analytics-"));
  try {
    const slug = "bengali-shop-ad";
    const projectDir = path.join(tmpProjectsRoot, slug);
    fs.mkdirSync(path.join(projectDir, ".studio"), { recursive: true });

    const brief = {
      slug,
      title: "কৃষপ ফ্রেশ",
      aspectRatio: "9:16",
      width: 1080,
      height: 1920,
      durationSeconds: 8,
      language: "Bengali (বাংলা)",
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#FACC15",
        background: "#0A1410",
      },
    };
    const storyboard = {
      slug,
      aspectRatio: "9:16",
      frames: [
        {
          id: "frame_01",
          index: 1,
          layout: "split-editorial",
          motionPreset: "whip-pan-split",
          durationSeconds: 3.0,
          staging: {
            theme: "emerald",
            badgeText: "স্পেশাল অফার",
            headline: "তাজা বাজার এখন ঘরে বসেই",
            captionText: "মাত্র ১৫ মিনিটে তাজা বাজার ডেলিভারি পান।",
          },
          audioSpec: {
            voiceoverText: "মাত্র পনেরো মিনিটে তাজা বাজার ঘরে বসেই পান।",
            sfx: ["whoosh"],
          },
        },
        {
          id: "frame_02",
          index: 2,
          layout: "kinetic-statement-card",
          motionPreset: "editorial-kinetic-card",
          durationSeconds: 3.5,
          staging: {
            theme: "gold",
            badgeText: "অর্ডার করুন",
            headline: "আজই অর্ডার করুন ফ্রি ডেলিভারি",
            captionText: "অ্যাপ ডাউনলোড করে প্রথম অর্ডারে ছাড় নিন।",
          },
          audioSpec: {
            voiceoverText: "আজই অর্ডার করুন এবং ফ্রি ডেলিভারি উপভোগ করুন।",
            sfx: ["chime"],
          },
        },
      ],
    };

    fs.writeFileSync(path.join(projectDir, "PROJECT_BRIEF.json"), JSON.stringify(brief, null, 2));
    fs.writeFileSync(path.join(projectDir, "STORYBOARD.json"), JSON.stringify(storyboard, null, 2));

    const report = await evaluateAdCreativeAnalytics({
      slug,
      projectsDir: tmpProjectsRoot,
    });

    assert.equal(report.slug, slug);
    assert.ok(report.thumbstopHookScore >= 75);
    assert.ok(report.soundOffScore >= 75);
    assert.equal(report.hookVariants.length, 3);
    assert.match(report.hookVariants[0].headline, /[\u0980-\u09FF]/);

    const savedPath = path.join(projectDir, ".studio", "ad-analytics.json");
    assert.equal(fs.existsSync(savedPath), true, "Expected .studio/ad-analytics.json on disk");

    const loaded = loadLatestAdAnalytics(slug, { projectsDir: tmpProjectsRoot });
    assert.ok(loaded);
    assert.equal(loaded.thumbstopHookScore, report.thumbstopHookScore);

    // Reject path traversal slugs
    await assert.rejects(
      () => evaluateAdCreativeAnalytics({ slug: "../escape", projectsDir: tmpProjectsRoot }),
      /Invalid project slug/i,
    );
  } finally {
    fs.rmSync(tmpProjectsRoot, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(tmpProjectsRoot), false);
});

test("handles empty storyboards gracefully and generates Hindi A/B hook variants", async () => {
  const emptyReport = await evaluateAdCreativeAnalytics({
    project: {
      slug: "hindi-launch",
      title: "बाज़ार एक्सप्रेस",
      language: "Hindi",
      aspectRatio: "9:16",
    },
    storyboard: { slug: "hindi-launch", aspectRatio: "9:16", frames: [] },
  });

  assert.equal(emptyReport.thumbstopHookScore, 0);
  assert.equal(emptyReport.soundOffScore, 0);
  assert.equal(emptyReport.overallAdScore, 0);
  assert.equal(emptyReport.platformSafeZones.length, 3);
  assert.equal(emptyReport.hookVariants.length, 3);
  for (const variant of emptyReport.hookVariants) {
    assert.match(variant.headline, /[\u0900-\u097F]/, "Expected Devanagari Hindi headline");
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AD_VARIANT_LANGUAGES,
  buildLocalizedAdVariantsPlan,
  loadLocalizedAdVariants,
} from "../local-batch-runner.mjs";

function createTempProjectFixture(tmpRoot, slug = "ad-batch-demo") {
  const projectDir = path.join(tmpRoot, slug);
  fs.mkdirSync(path.join(projectDir, ".studio"), { recursive: true });

  const brief = {
    slug,
    title: "KrisShop Express",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 12,
    language: "English",
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#FACC15",
      background: "#0A1612",
    },
  };

  const storyboard = {
    schemaVersion: 1,
    slug,
    title: "KrisShop Express",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    frames: [
      {
        id: "frame_01",
        sceneId: "scene_01",
        index: 1,
        title: "Instant Hook & Hero Offer",
        narrativeBeat: "hook",
        layout: "hook-scroll-stopper",
        motionPreset: "crash-zoom-in",
        durationSeconds: 3.5,
        locked: false,
        staging: {
          headline: "Fresh Groceries in 20 Minutes",
          subheadline: "Save 30% on your first basket today.",
          badgeText: "LAUNCH OFFER",
          ctaText: "Order Now",
        },
        audioSpec: {
          voiceoverText: "Get fresh groceries delivered in 20 minutes and save 30% today.",
          sfx: ["whoosh", "pop"],
        },
      },
      {
        id: "frame_02",
        sceneId: "scene_02",
        index: 2,
        title: "Curated Daily Deals",
        narrativeBeat: "value-proof",
        layout: "split-editorial",
        motionPreset: "whip-pan-split",
        durationSeconds: 4.5,
        locked: false,
        staging: {
          headline: "Verified Farm Quality",
          subheadline: "Zero hidden delivery fees on orders above $25.",
          badgeText: "VERIFIED VALUE",
          ctaText: "Browse Deals",
        },
        audioSpec: {
          voiceoverText: "Every item is quality checked with zero hidden fees.",
          sfx: ["pop"],
        },
      },
      {
        id: "frame_03",
        sceneId: "scene_03",
        index: 3,
        title: "Ready When You Are",
        narrativeBeat: "cta-outro",
        layout: "kinetic-statement-card",
        motionPreset: "editorial-kinetic-card",
        durationSeconds: 4.0,
        locked: true,
        staging: {
          headline: "Download KrisShop Today",
          subheadline: "Tap below to claim your welcome reward.",
          badgeText: "GET STARTED",
          ctaText: "Install Free",
        },
        audioSpec: {
          voiceoverText: "Download KrisShop today and start saving in seconds.",
          sfx: ["chime"],
        },
      },
    ],
  };

  fs.writeFileSync(path.join(projectDir, "PROJECT_BRIEF.json"), JSON.stringify(brief, null, 2));
  fs.writeFileSync(path.join(projectDir, "STORYBOARD.json"), JSON.stringify(storyboard, null, 2));
  return { slug, projectDir, brief, storyboard };
}

test("buildLocalizedAdVariantsPlan writes Bengali, English, and Hindi $0 variant storyboards to .studio/variants/", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-local-batch-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const { slug, projectDir, storyboard, brief } = createTempProjectFixture(tmpRoot);

  assert.ok(AD_VARIANT_LANGUAGES.Bengali);
  assert.ok(AD_VARIANT_LANGUAGES.English);
  assert.ok(AD_VARIANT_LANGUAGES.Hindi);

  const plan = buildLocalizedAdVariantsPlan({
    slug,
    storyboard,
    brief,
    languages: ["Bengali", "English", "Hindi"],
    projectsDir: tmpRoot,
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.slug, slug);
  assert.equal(plan.costMode, "subscription-zero-dollar");
  assert.equal(plan.zeroCostGuard, true);
  assert.equal(plan.requiresApiKey, false);
  assert.equal(plan.estimatedApiCostUsd, 0);
  assert.equal(plan.variantCount, 3);
  assert.equal(plan.variants.length, 3);

  const byLang = Object.fromEntries(plan.variants.map((v) => [v.language, v]));
  assert.ok(byLang.Bengali);
  assert.ok(byLang.English);
  assert.ok(byLang.Hindi);

  // Verify exact disk paths: projects/<slug>/.studio/variants/variant_<lang>.json
  for (const [lang, expectedKey] of [
    ["Bengali", "bengali"],
    ["English", "english"],
    ["Hindi", "hindi"],
  ]) {
    const entry = byLang[lang];
    assert.equal(entry.langKey, expectedKey);
    assert.equal(entry.relPath, `.studio/variants/variant_${expectedKey}.json`);
    assert.equal(entry.url, `/media/${slug}/.studio/variants/variant_${expectedKey}.json`);
    const diskPath = path.join(projectDir, ".studio", "variants", `variant_${expectedKey}.json`);
    assert.equal(fs.existsSync(diskPath), true, `Expected ${diskPath} on disk`);

    const saved = JSON.parse(fs.readFileSync(diskPath, "utf8"));
    assert.equal(saved.language, lang);
    assert.equal(saved.costMode, "subscription-zero-dollar");
    assert.equal(saved.frames.length, 3);
    // Preserves numerical metrics (20, 30%) in localized hook copy
    assert.match(
      saved.frames[0].staging.headline + " " + saved.frames[0].audioSpec.voiceoverText,
      /20|30%/,
    );
  }

  // Verify native script localization & $0 neural edge-tts voice assignments
  assert.equal(byLang.Bengali.voiceId, "bn-BD-NabanitaNeural");
  assert.match(byLang.Bengali.storyboard.frames[0].staging.ctaText, /[\u0980-\u09FF]/);
  assert.match(byLang.Bengali.storyboard.frames[0].audioSpec.voiceoverText, /[\u0980-\u09FF]/);

  assert.equal(byLang.English.voiceId, "en-US-AriaNeural");
  assert.match(byLang.English.storyboard.frames[0].staging.headline, /Fresh Groceries/i);

  assert.equal(byLang.Hindi.voiceId, "hi-IN-SwaraNeural");
  assert.match(byLang.Hindi.storyboard.frames[0].staging.ctaText, /[\u0900-\u097F]/);
  assert.match(byLang.Hindi.storyboard.frames[0].audioSpec.voiceoverText, /[\u0900-\u097F]/);

  // Verify reload helper
  const reloaded = loadLocalizedAdVariants(slug, { projectsDir: tmpRoot });
  assert.equal(reloaded.variants.length, 3);
});

test("buildLocalizedAdVariantsPlan applies hookOverrides, auto-loads disk storyboard/brief, and blocks path traversal or paid APIs", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-local-batch-hooks-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const { slug, projectDir } = createTempProjectFixture(tmpRoot, "hook-matrix-proj");

  // Auto-load storyboard + brief from disk when omitted, with custom hookOverrides
  const plan = buildLocalizedAdVariantsPlan({
    slug,
    languages: ["Bengali", "English", "Hindi"],
    hookOverrides: [
      {
        id: "flash-50",
        language: "English",
        headline: "50% Off Express Basket — Today Only",
        badgeText: "FLASH DEAL",
        voiceoverText: "Claim 50% off your express grocery basket today only.",
      },
      {
        id: "bn-hook-custom",
        language: "Bengali",
        headline: "মাত্র ১৫ মিনিটে তাজা বাজার বাসায়!",
        badgeText: "ধামাকা অফার",
      },
      "Zero Delivery Fee All Weekend",
    ],
    projectsDir: tmpRoot,
  });

  assert.equal(plan.ok, true);
  const enVar = plan.variants.find((v) => v.language === "English");
  const bnVar = plan.variants.find((v) => v.language === "Bengali");
  const hiVar = plan.variants.find((v) => v.language === "Hindi");

  assert.equal(enVar.storyboard.frames[0].staging.headline, "50% Off Express Basket — Today Only");
  assert.equal(enVar.storyboard.frames[0].staging.badgeText, "FLASH DEAL");
  assert.equal(bnVar.storyboard.frames[0].staging.headline, "মাত্র ১৫ মিনিটে তাজা বাজার বাসায়!");
  assert.equal(bnVar.storyboard.frames[0].staging.badgeText, "ধামাকা অফার");
  // Hindi falls back to universal string hookOverride
  assert.match(hiVar.storyboard.frames[0].staging.headline, /Zero Delivery Fee All Weekend/);
  assert.ok(Array.isArray(plan.abHookMatrix) && plan.abHookMatrix.length >= 3);

  // Verify starter storyboard synthesis when STORYBOARD.json is absent on a fresh project
  const freshSlug = "fresh-no-sb";
  fs.mkdirSync(path.join(tmpRoot, freshSlug), { recursive: true });
  const freshPlan = buildLocalizedAdVariantsPlan({
    slug: freshSlug,
    languages: ["Bengali", "English"],
    projectsDir: tmpRoot,
  });
  assert.equal(freshPlan.variants.length, 2);
  assert.ok(freshPlan.variants[0].storyboard.frames.length >= 3);
  assert.equal(
    fs.existsSync(path.join(tmpRoot, freshSlug, ".studio", "variants", "variant_bengali.json")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(projectDir, ".studio", "variants", "variants-index.json")),
    true,
  );

  // Security & $0 guard checks
  assert.throws(
    () => buildLocalizedAdVariantsPlan({ slug: "../escape", projectsDir: tmpRoot }),
    /Invalid project slug/i,
  );
  assert.throws(
    () =>
      buildLocalizedAdVariantsPlan({
        slug,
        languages: ["../../badlang"],
        projectsDir: tmpRoot,
      }),
    /Invalid language/i,
  );
  assert.throws(
    () =>
      buildLocalizedAdVariantsPlan({
        slug,
        projectsDir: tmpRoot,
        forcePaidApi: true,
      }),
    /zeroCostGuard|subscription-zero-dollar/i,
  );
});

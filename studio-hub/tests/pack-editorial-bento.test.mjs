import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getToolEnv, ROOT_DIR } from "../lib.mjs";
import { ARCHETYPES, renderArchetypeScene } from "../templates/pack-editorial-bento.mjs";

function runProcess(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const env = getToolEnv();
    const child = spawn(cmd, args, {
      cwd: options.cwd || ROOT_DIR,
      env: { ...env, ...(options.env || {}) },
      shell: options.shell ?? process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${err.message}` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function parseLintJson(rawStdout) {
  const trimmed = String(rawStdout || "").trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  assert.ok(firstBrace !== -1 && lastBrace > firstBrace, `Expected JSON in output: ${trimmed}`);
  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
}

// 1x1 transparent PNG bytes for deterministic local asset fixtures
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("ARCHETYPES exports metadata for split-editorial and bento-feature-grid", () => {
  assert.ok(Array.isArray(ARCHETYPES), "ARCHETYPES must be an array");
  assert.equal(ARCHETYPES.length, 2);

  const ids = ARCHETYPES.map((item) => item.id);
  assert.deepEqual(ids, ["split-editorial", "bento-feature-grid"]);

  for (const item of ARCHETYPES) {
    assert.equal(typeof item.name, "string");
    assert.ok(item.name.length > 0);
    assert.equal(typeof item.description, "string");
    assert.ok(item.description.length > 10);
    assert.equal(item.pack, "editorial-bento");
    assert.ok(Array.isArray(item.supportedAspects));
    assert.ok(item.supportedAspects.includes("9:16"));
    assert.ok(item.supportedAspects.includes("16:9"));
  }
});

test("renderArchetypeScene throws on unknown archetypeId", () => {
  assert.throws(
    () =>
      renderArchetypeScene({
        archetypeId: "non-existent-archetype",
        compositionId: "scene_err",
        width: 1080,
        height: 1920,
        durationSeconds: 4,
        shot: {},
        brandColors: {},
      }),
    /Unsupported archetypeId/i,
  );
});

test("split-editorial renders deterministic, WCAG high-contrast 52/48 split HTML", () => {
  const params = {
    archetypeId: "split-editorial",
    compositionId: "scene_split_01",
    width: 1920,
    height: 1080,
    durationSeconds: 4.2,
    shot: {
      index: 1,
      stepNumber: 2,
      badge: "EDITORIAL WORKFLOW",
      headline: "Precision Storyboard Framing",
      subheadline: "Asymmetric 52/48 balance pairs bold typography with crisp motion plates.",
      clipSrc: "/assets/clips/hero_demo.mp4",
      caption: "Zero-latency scene assembly",
    },
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#FACC15",
      background: "#0A1410",
    },
  };

  const htmlA = renderArchetypeScene(params);
  const htmlB = renderArchetypeScene(params);
  assert.equal(htmlA, htmlB, "Output must be strictly deterministic");

  // Wrapper & root contract
  assert.match(htmlA, /^<template id="scene_split_01-template">/);
  assert.match(htmlA, /<\/template>\s*$/);
  assert.match(
    htmlA,
    /<div[^>]*data-composition-id="scene_split_01"[^>]*data-width="1920"[^>]*data-height="1080"[^>]*data-duration="4\.2"/,
  );

  // Asymmetric 52/48 split + step number tag + accent bar + headline + framed video plate
  assert.match(htmlA, /52fr\s+48fr/);
  assert.match(htmlA, /STEP\s*02/i);
  assert.match(htmlA, /accent-bar/);
  assert.match(htmlA, /Precision Storyboard Framing/);
  assert.match(htmlA, /<video\b[^>]*\bmuted\b/);
  assert.match(htmlA, /src="assets\/clips\/hero_demo\.mp4"/);
  assert.doesNotMatch(htmlA, /src="\/assets\//);

  // Timed .clip elements & scoped CSS
  assert.match(htmlA, /class="clip\b[^"]*"/);
  assert.match(htmlA, /data-start="0"/);
  assert.match(htmlA, /data-duration="4\.2"/);
  assert.match(htmlA, /\[data-composition-id="scene_split_01"\]/);

  // WCAG AA contrast tokens & HyperFrames bans
  assert.match(htmlA, /#FFFFFF/i);
  assert.match(htmlA, /#0A1410/i);
  assert.match(htmlA, /#08120E/i);
  assert.match(htmlA, /#FACC15/i);
  assert.doesNotMatch(htmlA, /(?<![-\w])transform\s*:/i);
  assert.doesNotMatch(htmlA, /Date\.now\s*\(/);
  assert.doesNotMatch(htmlA, /Math\.random\s*\(/);
  assert.doesNotMatch(htmlA, /repeat\s*:\s*-1/);

  // Paused GSAP timeline registration
  assert.match(htmlA, /gsap\.timeline\(\{\s*paused:\s*true\s*\}\)/);
  assert.match(htmlA, /window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\};/);
  assert.match(htmlA, /window\.__timelines\["scene_split_01"\]\s*=\s*tl;/);
});

test("bento-feature-grid renders 3-cell media bento + metric badge cell + staggered GSAP pop-in", () => {
  const html = renderArchetypeScene({
    archetypeId: "bento-feature-grid",
    compositionId: "scene_bento_02",
    width: 1080,
    height: 1920,
    durationSeconds: 4.5,
    shot: {
      index: 2,
      badge: "MODULAR SYSTEM",
      headline: "Everything Unified in One Tight Grid",
      bentoMedia: [
        "/assets/clips/cell_one.mp4",
        "assets/images/cell_two.png",
        "assets/images/cell_three.png",
      ],
      bullets: ["Auto Scene Cuts", "Brand Safe Type", "Instant 60fps MP4"],
      metricValue: "4.8x",
      metricLabel: "FASTER RENDER",
    },
    brandColors: {
      primary: "#1E824C",
      secondary: "#34D399",
      accent: "#FACC15",
      background: "#0A1410",
    },
  });

  assert.match(html, /^<template id="scene_bento_02-template">/);
  assert.match(
    html,
    /<div[^>]*data-composition-id="scene_bento_02"[^>]*data-width="1080"[^>]*data-height="1920"[^>]*data-duration="4\.5"/,
  );

  // 3 media cells + metric badge cell
  assert.match(html, /src="assets\/clips\/cell_one\.mp4"/);
  assert.match(html, /src="assets\/images\/cell_two\.png"/);
  assert.match(html, /src="assets\/images\/cell_three\.png"/);
  assert.doesNotMatch(html, /src="\/assets\//);
  assert.match(html, /4\.8x/);
  assert.match(html, /FASTER RENDER/);
  assert.match(html, /Auto Scene Cuts/);
  assert.match(html, /Brand Safe Type/);
  assert.match(html, /Instant 60fps MP4/);

  // Staggered GSAP pop-in verification + zero CSS transform
  assert.doesNotMatch(html, /(?<![-\w])transform\s*:/i);
  assert.match(html, /\[data-composition-id="scene_bento_02"\]/);
  assert.match(html, /window\.__timelines\["scene_bento_02"\]\s*=\s*tl;/);

  const fromToMatches = [...html.matchAll(/tl\.fromTo\(/g)];
  assert.ok(
    fromToMatches.length >= 5,
    `Expected staggered GSAP fromTo tweens (>=5), found ${fromToMatches.length}`,
  );
});

test("both archetypes support portrait, image plates, synthetic fallbacks, and Bengali Unicode", () => {
  const splitPortrait = renderArchetypeScene({
    archetypeId: "split-editorial",
    compositionId: "scene_bn_01",
    width: 1080,
    height: 1920,
    durationSeconds: 3.6,
    shot: {
      stepNumber: 1,
      badge: "নতুন ফিচার",
      headline: "দ্রুত ও নিখুঁত ভিডিও এডিটিং <Pro>",
      subheadline: "প্রতিটি ফ্রেমে প্রফেশনাল ডিজাইন ও স্পষ্ট কনট্রাস্ট।",
      imageSrc: "/images/hero_card.png",
    },
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#FACC15",
      background: "#0A1410",
    },
  });

  assert.match(splitPortrait, /grid-template-rows:\s*52fr\s+48fr/);
  assert.match(splitPortrait, /<img\b[^>]*src="assets\/images\/hero_card\.png"/);
  assert.match(splitPortrait, /দ্রুত ও নিখুঁত ভিডিও এডিটিং &lt;Pro&gt;/);

  const bentoFallback = renderArchetypeScene({
    archetypeId: "bento-feature-grid",
    compositionId: "scene_synth_02",
    width: 1080,
    height: 1080,
    durationSeconds: 3.5,
    shot: {
      headline: "Zero-Media Synthetic Preview Fallback",
    },
    brandColors: {},
  });

  assert.match(bentoFallback, /STUDIO PLATE/);
  assert.doesNotMatch(bentoFallback, /src="\/assets\//);
  assert.doesNotMatch(bentoFallback, /(?<![-\w])transform\s*:/i);
});

test("npx hyperframes lint passes with 0 errors on both generated archetypes in os.tmpdir()", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-pack-editorial-bento-"));
  try {
    const compsDir = path.join(tmpDir, "compositions");
    const clipsDir = path.join(tmpDir, "assets", "clips");
    const imagesDir = path.join(tmpDir, "assets", "images");
    fs.mkdirSync(compsDir, { recursive: true });
    fs.mkdirSync(clipsDir, { recursive: true });
    fs.mkdirSync(imagesDir, { recursive: true });

    // Create deterministic local PNG fixtures
    const pngBuf = Buffer.from(TINY_PNG_BASE64, "base64");
    fs.writeFileSync(path.join(imagesDir, "plate_a.png"), pngBuf);
    fs.writeFileSync(path.join(imagesDir, "plate_b.png"), pngBuf);
    fs.writeFileSync(path.join(imagesDir, "plate_c.png"), pngBuf);

    // Synthesize a tiny valid H.264 MP4 clip so video linting (codec + EOF checks) runs for real
    const sampleMp4 = path.join(clipsDir, "sample.mp4");
    const ffRes = await runProcess(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=#0A1410:s=320x180:d=5:r=30",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        sampleMp4,
      ],
      { cwd: tmpDir, shell: false },
    );
    assert.equal(ffRes.code, 0, `ffmpeg fixture generation failed: ${ffRes.stderr}`);

    const splitHtml = renderArchetypeScene({
      archetypeId: "split-editorial",
      compositionId: "split_scene",
      width: 1920,
      height: 1080,
      durationSeconds: 4,
      shot: {
        index: 0,
        badge: "CHAPTER ONE",
        headline: "Editorial Split Built for Clarity",
        subheadline: "Every element obeys strict HyperFrames seek determinism.",
        clipSrc: "assets/clips/sample.mp4",
      },
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#FACC15",
        background: "#0A1410",
      },
    });

    const bentoHtml = renderArchetypeScene({
      archetypeId: "bento-feature-grid",
      compositionId: "bento_scene",
      width: 1920,
      height: 1080,
      durationSeconds: 4.5,
      shot: {
        index: 1,
        badge: "FEATURE MATRIX",
        headline: "Three Keyframes Plus Live Metric",
        bentoMedia: [
          "assets/clips/sample.mp4",
          "assets/images/plate_b.png",
          "assets/images/plate_c.png",
        ],
        bullets: ["Keyframe Start", "Keyframe Peak", "Keyframe End"],
        metricValue: "99.9%",
        metricLabel: "DETERMINISTIC SEEK",
      },
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#FACC15",
        background: "#0A1410",
      },
    });

    const splitFile = path.join(compsDir, "split_scene.html");
    const bentoFile = path.join(compsDir, "bento_scene.html");
    fs.writeFileSync(splitFile, splitHtml, "utf8");
    fs.writeFileSync(bentoFile, bentoHtml, "utf8");

    // Minimal host index.html so HyperFrames resolves project root & compositions/ sub-comp context
    const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Editorial Bento Lint Test</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      html, body, #root { margin: 0; padding: 0; width: 1920px; height: 1080px; background: #0A1410; overflow: hidden; }
      .scene-host { position: absolute; inset: 0; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="8.5" data-width="1920" data-height="1080">
      <div
        id="split_scene"
        class="clip scene-host"
        data-composition-id="split_scene"
        data-composition-src="compositions/split_scene.html"
        data-track-kind="graphics"
        data-track-index="1"
        data-start="0"
        data-duration="4"
        data-width="1920"
        data-height="1080"
      ></div>
      <div
        id="bento_scene"
        class="clip scene-host"
        data-composition-id="bento_scene"
        data-composition-src="compositions/bento_scene.html"
        data-track-kind="graphics"
        data-track-index="1"
        data-start="4"
        data-duration="4.5"
        data-width="1920"
        data-height="1080"
      ></div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
    fs.writeFileSync(path.join(tmpDir, "index.html"), indexHtml, "utf8");

    // 1. Lint split-editorial temp file directly
    const splitLint = await runProcess("npx", ["hyperframes", "lint", "--json", splitFile], {
      cwd: ROOT_DIR,
    });
    const splitJson = parseLintJson(splitLint.stdout);
    assert.equal(
      splitLint.code,
      0,
      `split-editorial lint failed: ${JSON.stringify(splitJson.findings)}`,
    );
    assert.equal(splitJson.ok, true);
    assert.equal(splitJson.errorCount, 0);
    assert.equal(
      splitJson.warningCount,
      0,
      `Unexpected warnings in split-editorial: ${JSON.stringify(splitJson.findings)}`,
    );

    // 2. Lint bento-feature-grid temp file directly
    const bentoLint = await runProcess("npx", ["hyperframes", "lint", "--json", bentoFile], {
      cwd: ROOT_DIR,
    });
    const bentoJson = parseLintJson(bentoLint.stdout);
    assert.equal(
      bentoLint.code,
      0,
      `bento-feature-grid lint failed: ${JSON.stringify(bentoJson.findings)}`,
    );
    assert.equal(bentoJson.ok, true);
    assert.equal(bentoJson.errorCount, 0);
    assert.equal(
      bentoJson.warningCount,
      0,
      `Unexpected warnings in bento-feature-grid: ${JSON.stringify(bentoJson.findings)}`,
    );

    // 3. Lint assembled temp project directory end-to-end
    const projectLint = await runProcess("npx", ["hyperframes", "lint", "--json", tmpDir], {
      cwd: ROOT_DIR,
    });
    const projectJson = parseLintJson(projectLint.stdout);
    assert.equal(
      projectLint.code,
      0,
      `Project lint failed: ${JSON.stringify(projectJson.findings)}`,
    );
    assert.equal(projectJson.ok, true);
    assert.equal(projectJson.errorCount, 0);

    // 4. Also verify human CLI invocation `npx hyperframes lint <tempFile.html>` exits 0
    const humanSplit = await runProcess("npx", ["hyperframes", "lint", splitFile], {
      cwd: ROOT_DIR,
    });
    assert.equal(humanSplit.code, 0, `Human CLI lint failed on split: ${humanSplit.stderr}`);

    const humanBento = await runProcess("npx", ["hyperframes", "lint", bentoFile], {
      cwd: ROOT_DIR,
    });
    assert.equal(humanBento.code, 0, `Human CLI lint failed on bento: ${humanBento.stderr}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(tmpDir), false, "Temporary lint folder must be deleted");
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT_DIR, getToolEnv } from "../lib.mjs";
import {
  ARCHETYPES,
  getArchetypeById,
  renderArchetypeScene,
} from "../templates/pack-cinema-statement.mjs";

function runProcess(cmd, args, cwd = ROOT_DIR) {
  return new Promise((resolve) => {
    const env = getToolEnv();
    const isWin = process.platform === "win32";
    const safeArgs = args.map((arg) => (isWin && arg.includes(" ") ? `"${arg}"` : arg));
    const child = spawn(cmd, safeArgs, {
      cwd,
      env,
      shell: isWin,
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

function runHyperframesLint(targetFilePath) {
  return runProcess("npx", ["hyperframes", "lint", "--json", targetFilePath]);
}

function parseLintJson(stdout) {
  const trimmed = String(stdout || "").trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  assert.ok(firstBrace !== -1 && lastBrace > firstBrace, `Expected JSON output, got: ${trimmed}`);
  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
}

function writeMinimalHostIndex(tempDir, scenes) {
  const totalDuration = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  const mounts = scenes
    .map(
      (s, idx) => `      <div
        id="${s.compositionId}"
        class="clip"
        data-composition-id="${s.compositionId}"
        data-composition-src="compositions/${s.compositionId}.html"
        data-track-kind="graphics"
        data-track-index="1"
        data-start="${idx * 4}"
        data-duration="${s.durationSeconds}"
        data-width="${s.width}"
        data-height="${s.height}"
      ></div>`,
    )
    .join("\n");

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>Temp Lint Host</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #0a1410; }
      #root { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #0a1410; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${totalDuration}" data-width="1080" data-height="1920">
${mounts}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
  fs.writeFileSync(path.join(tempDir, "index.html"), indexHtml, "utf8");
}

const TINY_PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("pack-cinema-statement — ARCHETYPES metadata and contract validation", () => {
  assert.ok(Array.isArray(ARCHETYPES), "ARCHETYPES must be an array");
  assert.equal(ARCHETYPES.length, 2);

  const ids = ARCHETYPES.map((item) => item.id);
  assert.deepEqual(ids, ["fullbleed-cinema", "kinetic-statement-card"]);

  assert.equal(getArchetypeById("fullbleed-cinema")?.name, "Full-Bleed Cinema");
  assert.equal(getArchetypeById("kinetic-statement-card")?.name, "Kinetic Statement Card");
  assert.equal(getArchetypeById("unknown"), null);

  for (const meta of ARCHETYPES) {
    assert.equal(typeof meta.name, "string");
    assert.ok(meta.name.length > 0);
    assert.equal(typeof meta.description, "string");
    assert.ok(meta.description.length > 10);
    assert.equal(meta.pack, "cinema-statement");
    assert.ok(Array.isArray(meta.slots) && meta.slots.length > 0);
  }

  assert.throws(
    () =>
      renderArchetypeScene({
        archetypeId: "non-existent-archetype",
        compositionId: "bad-scene",
        width: 1080,
        height: 1920,
        durationSeconds: 3.5,
        shot: {},
        brandColors: {},
      }),
    /Unsupported archetypeId/i,
  );
});

test("pack-cinema-statement — fullbleed-cinema renders deterministic HyperFrames HTML with video/image plates, lower scrim, glass pill tag & lower-third", () => {
  const params = {
    archetypeId: "fullbleed-cinema",
    compositionId: "scene-cinema-01",
    width: 1080,
    height: 1920,
    durationSeconds: 4.2,
    shot: {
      videoSrc: "/assets/clips/harvest-drone.mp4",
      tagText: "CINEMA HERO · 4K",
      headline: "Pure Organic Harvest Delivered at Dawn",
      subheadline: "Farm-direct logistics engineered for peak freshness in every basket.",
      camera: {
        fromScale: 1.14,
        toScale: 1.02,
        panX: -16,
        panY: 10,
        ease: "power3.out",
      },
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
  assert.equal(htmlA, htmlB, "Output must be 100% deterministic");

  assert.match(htmlA, /^<template id="scene-cinema-01-template">/);
  assert.match(htmlA, /<\/template>\s*$/);
  assert.match(
    htmlA,
    /<div[^>]*data-composition-id="scene-cinema-01"[^>]*data-width="1080"[^>]*data-height="1920"[^>]*data-duration="4\.2"/,
  );

  assert.match(htmlA, /\[data-composition-id="scene-cinema-01"\]/);
  const styleBlocks = [...htmlA.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join("\n");
  assert.doesNotMatch(
    styleBlocks,
    /(?<![-\w])transform\s*:/i,
    "Must have zero CSS transform rules",
  );

  assert.match(htmlA, /<video\b[^>]*\bmuted\b[^>]*>/);
  assert.match(htmlA, /src="assets\/clips\/harvest-drone\.mp4"/);
  assert.doesNotMatch(htmlA, /src="\/assets\//);

  assert.match(htmlA, /CINEMA HERO · 4K/);
  assert.match(htmlA, /Pure Organic Harvest Delivered at Dawn/);
  assert.match(htmlA, /Farm-direct logistics engineered for peak freshness in every basket\./);
  assert.match(htmlA, /scrim/i);
  assert.match(htmlA, /glass-pill/i);
  assert.match(htmlA, /lower-third/i);

  assert.match(htmlA, /class="clip[^"]*"[^>]*data-start="0"[^>]*data-duration="4\.2"/);
  assert.doesNotMatch(htmlA, /Date\.now\s*\(/);
  assert.doesNotMatch(htmlA, /Math\.random\s*\(/);
  assert.doesNotMatch(htmlA, /repeat\s*:\s*-1/);
  assert.match(htmlA, /window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\};/);
  assert.match(htmlA, /window\.__timelines\["scene-cinema-01"\]\s*=\s*tl;/);

  assert.match(htmlA, /#ffffff/i);
  assert.match(htmlA, /#0a1410/i);
  assert.match(htmlA, /#facc15/i);
  assert.match(htmlA, /#08120e/i);
});

test("pack-cinema-statement — kinetic-statement-card renders brand logo slot, staggered headline words & primary CTA pill badge", () => {
  const params = {
    archetypeId: "kinetic-statement-card",
    compositionId: "scene-outro-cta",
    width: 1920,
    height: 1080,
    durationSeconds: 3.6,
    shot: {
      logoSrc: "/assets/images/krishop-mark.svg",
      brandName: "KRISHOP",
      badgeText: "READY IN 60 SECONDS",
      headline: "Launch Cinema Stories Without Waiting",
      subheadline: "Download the studio app and publish your next campaign today.",
      ctaText: "Start Creating Free",
    },
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#FACC15",
      background: "#0A1410",
    },
  };

  const html = renderArchetypeScene(params);

  assert.match(html, /^<template id="scene-outro-cta-template">/);
  assert.match(
    html,
    /<div[^>]*data-composition-id="scene-outro-cta"[^>]*data-width="1920"[^>]*data-height="1080"[^>]*data-duration="3\.6"/,
  );
  assert.match(html, /\[data-composition-id="scene-outro-cta"\]/);

  const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  assert.doesNotMatch(
    styleBlocks,
    /(?<![-\w])transform\s*:/i,
    "Must have zero CSS transform rules",
  );

  assert.match(html, /logo-slot/);
  assert.match(html, /src="assets\/images\/krishop-mark\.svg"/);
  assert.doesNotMatch(html, /src="\/assets\//);

  for (const word of ["Launch", "Cinema", "Stories", "Without", "Waiting"]) {
    assert.ok(html.includes(word), `Expected staggered word "${word}" in HTML`);
  }
  const wordSpanMatches = [...html.matchAll(/id="[^"]*-word-\d+"/g)];
  assert.equal(wordSpanMatches.length, 5, "Expected 5 individual staggered headline word elements");

  assert.match(html, /Start Creating Free/);
  assert.match(html, /cta-badge/);
  assert.match(html, /#ffffff/i);
  assert.match(html, /#0a1410/i);
  assert.match(html, /#facc15/i);
  assert.match(html, /#08120e/i);

  assert.doesNotMatch(html, /Date\.now\s*\(/);
  assert.doesNotMatch(html, /Math\.random\s*\(/);
  assert.doesNotMatch(html, /repeat\s*:\s*-1/);
  assert.match(html, /window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\};/);
  assert.match(html, /window\.__timelines\["scene-outro-cta"\]\s*=\s*tl;/);

  const fallbackHtml = renderArchetypeScene({
    ...params,
    compositionId: "12-outro-svg",
    shot: {
      headline: "Fast & Clean <Studio>",
      ctaText: "Join Today",
    },
  });
  assert.match(
    fallbackHtml,
    /<svg\b/i,
    "Should render vector monogram fallback when logoSrc is omitted",
  );
  assert.match(fallbackHtml, /&amp;/);
  assert.match(fallbackHtml, /&lt;Studio&gt;/);
  assert.doesNotMatch(fallbackHtml, /<Studio>/);
  assert.match(fallbackHtml, /id="sc_12-outro-svg-word-0"/);
});

test("pack-cinema-statement — npx hyperframes lint passes with 0 errors in os.tmpdir() for both archetypes and cleans up", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-pack-cinema-statement-"));

  try {
    const compsDir = path.join(tempDir, "compositions");
    const clipsDir = path.join(tempDir, "assets", "clips");
    const imagesDir = path.join(tempDir, "assets", "images");
    fs.mkdirSync(compsDir, { recursive: true });
    fs.mkdirSync(clipsDir, { recursive: true });
    fs.mkdirSync(imagesDir, { recursive: true });

    fs.writeFileSync(path.join(imagesDir, "hero-plate.png"), TINY_PNG_BUFFER);
    fs.writeFileSync(
      path.join(imagesDir, "brand-logo.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#FACC15"/></svg>',
      "utf8",
    );

    const mp4Path = path.join(clipsDir, "hero-clip.mp4");
    const ffRes = await runProcess("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=#0A1410:s=320x240:r=24:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "ultrafast",
      mp4Path,
    ]);
    const useVideoFixture = ffRes.code === 0 && fs.existsSync(mp4Path);

    const scenes = [
      {
        archetypeId: "fullbleed-cinema",
        compositionId: "cinema_fullbleed_01",
        width: 1080,
        height: 1920,
        durationSeconds: 4.0,
        shot: useVideoFixture
          ? {
              videoSrc: "/assets/clips/hero-clip.mp4",
              tagText: "STUDIO CINEMA",
              headline: "Immersive Full-Frame Storytelling",
              subheadline: "Engineered with deep lower scrims and crisp WCAG AA typography.",
            }
          : {
              imageSrc: "assets/images/hero-plate.png",
              tagText: "STUDIO CINEMA",
              headline: "Immersive Full-Frame Storytelling",
              subheadline: "Engineered with deep lower scrims and crisp WCAG AA typography.",
            },
      },
      {
        archetypeId: "kinetic-statement-card",
        compositionId: "statement_card_02",
        width: 1080,
        height: 1920,
        durationSeconds: 3.5,
        shot: {
          logoSrc: "assets/images/brand-logo.svg",
          brandName: "ANTIGRAVITY",
          badgeText: "INSTANT ACCESS",
          headline: "Ship Every Frame With Confidence",
          subheadline: "Deterministic HyperFrames scenes ready for zero-error MP4 delivery.",
          ctaText: "Launch Studio Pro",
        },
      },
    ];

    writeMinimalHostIndex(tempDir, scenes);

    for (const scene of scenes) {
      const html = renderArchetypeScene({
        archetypeId: scene.archetypeId,
        compositionId: scene.compositionId,
        width: scene.width,
        height: scene.height,
        durationSeconds: scene.durationSeconds,
        shot: scene.shot,
        brandColors: {
          primary: "#1E824C",
          secondary: "#2ECC71",
          accent: "#FACC15",
          background: "#0A1410",
        },
      });

      const tempFile = path.join(compsDir, `${scene.compositionId}.html`);
      fs.writeFileSync(tempFile, html, "utf8");

      const lintRes = await runHyperframesLint(tempFile);
      const parsed = parseLintJson(lintRes.stdout);

      assert.equal(
        lintRes.code,
        0,
        `npx hyperframes lint exited ${lintRes.code} for ${scene.archetypeId}: ${JSON.stringify(parsed.findings)}`,
      );
      assert.equal(parsed.ok, true);
      assert.equal(
        parsed.errorCount,
        0,
        `Expected 0 lint errors for ${scene.archetypeId}, got: ${JSON.stringify(parsed.findings)}`,
      );
      assert.equal(
        parsed.warningCount,
        0,
        `Expected 0 lint warnings for ${scene.archetypeId}, got: ${JSON.stringify(parsed.findings)}`,
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  assert.equal(fs.existsSync(tempDir), false, "Temporary folder under os.tmpdir() must be deleted");
});

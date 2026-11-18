import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getToolEnv, ROOT_DIR } from "../lib.mjs";
import {
  ARCHETYPES,
  PACK_ID,
  getArchetypeById,
  renderArchetypeScene,
} from "../templates/pack-social-hooks.mjs";

function runCli(cmd, args, cwd = ROOT_DIR) {
  return new Promise((resolve) => {
    const env = getToolEnv();
    const isWin = process.platform === "win32";
    const child = spawn(cmd, args, {
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

function buildMinimalHostIndexHtml({ width, height, compositions }) {
  const totalDuration = compositions.reduce((sum, item) => sum + item.durationSeconds, 0);
  let cursor = 0;
  const hosts = compositions
    .map((item) => {
      const start = cursor;
      cursor += item.durationSeconds;
      return `      <div
        id="${item.compositionId}"
        class="clip scene"
        data-composition-id="${item.compositionId}"
        data-composition-src="compositions/${item.fileName}"
        data-track-kind="graphics"
        data-track-index="1"
        data-start="${start}"
        data-duration="${item.durationSeconds}"
        data-width="${width}"
        data-height="${height}"
      ></div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>Social Hooks Test Host</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      html,
      body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #0a1410;
      }
      #root {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
      }
      .scene {
        position: absolute;
        inset: 0;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${totalDuration}"
      data-width="${width}"
      data-height="${height}"
    >
${hosts}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

test("ARCHETYPES exports frozen metadata for hook-scroll-stopper and product-price-reveal", () => {
  assert.equal(PACK_ID, "pack-social-hooks");
  assert.ok(Array.isArray(ARCHETYPES));
  assert.equal(ARCHETYPES.length, 2);
  assert.equal(Object.isFrozen(ARCHETYPES), true);

  const ids = ARCHETYPES.map((item) => item.id);
  assert.deepEqual(ids, ["hook-scroll-stopper", "product-price-reveal"]);

  for (const entry of ARCHETYPES) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(typeof entry.name, "string");
    assert.ok(entry.name.length > 0);
    assert.equal(typeof entry.description, "string");
    assert.ok(entry.description.length > 10);
    assert.equal(typeof entry.category, "string");
    assert.equal(getArchetypeById(entry.id), entry);
  }
  assert.equal(getArchetypeById("unknown-id"), null);
});

test("renderArchetypeScene rejects unknown archetypeId", () => {
  assert.throws(
    () =>
      renderArchetypeScene({
        archetypeId: "invalid-social-archetype",
        compositionId: "scene-bad",
        width: 1080,
        height: 1920,
        durationSeconds: 3,
      }),
    /hook-scroll-stopper|product-price-reveal/i,
  );
});

test("renderArchetypeScene produces deterministic HyperFrames contract HTML for hook-scroll-stopper and product-price-reveal", () => {
  const brandColors = {
    primary: "#1E824C",
    secondary: "#2ECC71",
    accent: "#FACC15",
    background: "#0A1410",
  };

  const hookShot = {
    badge: "WAIT FOR IT",
    hookTag: "00:00 · HOOK",
    headline: "Stop Editing Videos Frame By Frame",
    subheadline: "Automate studio-grade cuts and kinetic captions in seconds.",
    sourceClip: "/assets/clips/hook_intro.mp4",
  };

  const hookHtmlA = renderArchetypeScene({
    archetypeId: "hook-scroll-stopper",
    compositionId: "hook-scene-01",
    width: 1080,
    height: 1920,
    durationSeconds: 3.2,
    shot: hookShot,
    brandColors,
  });
  const hookHtmlB = renderArchetypeScene({
    archetypeId: "hook-scroll-stopper",
    compositionId: "hook-scene-01",
    width: 1080,
    height: 1920,
    durationSeconds: 3.2,
    shot: hookShot,
    brandColors,
  });

  assert.equal(hookHtmlA, hookHtmlB, "hook-scroll-stopper output must be deterministic");
  assert.match(hookHtmlA, /^<template id="hook-scene-01-template">/);
  assert.match(hookHtmlA, /<\/template>\s*$/);
  assert.match(
    hookHtmlA,
    /<div data-composition-id="hook-scene-01" data-width="1080" data-height="1920" data-duration="3\.2">/,
  );
  assert.match(hookHtmlA, /\[data-composition-id="hook-scene-01"\]/);
  assert.match(hookHtmlA, /class="clip\b/);
  assert.match(hookHtmlA, /data-start="0"/);
  assert.match(hookHtmlA, /data-duration="3\.2"/);
  assert.match(hookHtmlA, /<video\b[^>]*\bmuted\b/);
  assert.match(hookHtmlA, /src="assets\/clips\/hook_intro\.mp4"/);
  assert.doesNotMatch(hookHtmlA, /src="\/assets\//);
  assert.doesNotMatch(hookHtmlA, /\btransform\s*:/);
  assert.doesNotMatch(hookHtmlA, /Date\.now\s*\(/);
  assert.doesNotMatch(hookHtmlA, /Math\.random\s*\(/);
  assert.doesNotMatch(hookHtmlA, /repeat\s*:\s*-1/);
  assert.match(hookHtmlA, /#0A1410/i);
  assert.match(hookHtmlA, /#FFFFFF/i);
  assert.match(hookHtmlA, /#FACC15/i);
  assert.match(hookHtmlA, /#08120E/i);
  assert.match(hookHtmlA, /window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\};/);
  assert.match(hookHtmlA, /window\.__timelines\["hook-scene-01"\]\s*=\s*tl;/);

  const priceShot = {
    badge: "FLASH LAUNCH",
    headline: "Krishop Organic Harvest Box",
    subheadline: "Farm-fresh seasonal produce delivered straight to your door.",
    originalPrice: "৳১,৪৫০",
    offerPrice: "৳৮৯০",
    discountBadge: "SAVE 38%",
    ctaText: "ORDER NOW",
    productImage: "/assets/images/harvest_box.png",
  };

  const priceHtmlA = renderArchetypeScene({
    archetypeId: "product-price-reveal",
    compositionId: "price-scene-02",
    width: 1080,
    height: 1350,
    durationSeconds: 4.0,
    shot: priceShot,
    brandColors,
  });
  const priceHtmlB = renderArchetypeScene({
    archetypeId: "product-price-reveal",
    compositionId: "price-scene-02",
    width: 1080,
    height: 1350,
    durationSeconds: 4.0,
    shot: priceShot,
    brandColors,
  });

  assert.equal(priceHtmlA, priceHtmlB, "product-price-reveal output must be deterministic");
  assert.match(priceHtmlA, /^<template id="price-scene-02-template">/);
  assert.match(
    priceHtmlA,
    /<div data-composition-id="price-scene-02" data-width="1080" data-height="1350" data-duration="4">/,
  );
  assert.match(priceHtmlA, /\[data-composition-id="price-scene-02"\]/);
  assert.match(priceHtmlA, /tabular-nums/);
  assert.match(priceHtmlA, /৳১,৪৫০/);
  assert.match(priceHtmlA, /৳৮৯০/);
  assert.match(priceHtmlA, /SAVE 38%/);
  assert.match(priceHtmlA, /ORDER NOW/);
  assert.match(priceHtmlA, /src="assets\/images\/harvest_box\.png"/);
  assert.doesNotMatch(priceHtmlA, /src="\/assets\//);
  assert.doesNotMatch(priceHtmlA, /\btransform\s*:/);
  assert.doesNotMatch(priceHtmlA, /Date\.now\s*\(/);
  assert.doesNotMatch(priceHtmlA, /Math\.random\s*\(/);
  assert.doesNotMatch(priceHtmlA, /repeat\s*:\s*-1/);
  assert.match(priceHtmlA, /window\.__timelines\["price-scene-02"\]\s*=\s*tl;/);
});

test("generated HTML for both social-hook archetypes passes npx hyperframes lint with 0 errors and 0 warnings in os.tmpdir()", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-pack-social-hooks-"));

  try {
    const compositionsDir = path.join(tempDir, "compositions");
    const clipsDir = path.join(tempDir, "assets", "clips");
    const imagesDir = path.join(tempDir, "assets", "images");
    fs.mkdirSync(compositionsDir, { recursive: true });
    fs.mkdirSync(clipsDir, { recursive: true });
    fs.mkdirSync(imagesDir, { recursive: true });

    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    fs.writeFileSync(path.join(imagesDir, "product_hero.png"), minimalPng);

    const hookClipAbs = path.join(clipsDir, "hook_clip.mp4");
    const ffRes = await runCli("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=#1E824C:s=320x240:d=1",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      hookClipAbs,
    ]);
    const hasHookVideo = ffRes.code === 0 && fs.existsSync(hookClipAbs);

    const hookHtml = renderArchetypeScene({
      archetypeId: "hook-scroll-stopper",
      compositionId: "01-hook-stopper",
      width: 1080,
      height: 1920,
      durationSeconds: 3.5,
      shot: {
        badge: "STOP SCROLLING",
        headline: "Three Seconds To Win Every Viewer",
        subheadline: "Engineered opening frame with high-velocity punch-in motion.",
        ...(hasHookVideo ? { sourceClip: "assets/clips/hook_clip.mp4" } : {}),
      },
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#FACC15",
        background: "#0A1410",
      },
    });

    const priceHtml = renderArchetypeScene({
      archetypeId: "product-price-reveal",
      compositionId: "02-price-reveal",
      width: 1080,
      height: 1920,
      durationSeconds: 4.0,
      shot: {
        badge: "LAUNCH DEAL",
        headline: "Director Studio Pro Pass",
        subheadline: "Complete local AI video rendering suite with zero cloud fees.",
        originalPrice: "$149",
        offerPrice: "$49",
        discountBadge: "67% OFF",
        ctaText: "CLAIM OFFER",
        productImage: "assets/images/product_hero.png",
      },
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#FACC15",
        background: "#0A1410",
      },
    });

    const hookFile = path.join(compositionsDir, "01-hook-stopper.html");
    const priceFile = path.join(compositionsDir, "02-price-reveal.html");
    fs.writeFileSync(hookFile, hookHtml, "utf8");
    fs.writeFileSync(priceFile, priceHtml, "utf8");

    const hostIndexHtml = buildMinimalHostIndexHtml({
      width: 1080,
      height: 1920,
      compositions: [
        {
          compositionId: "01-hook-stopper",
          fileName: "01-hook-stopper.html",
          durationSeconds: 3.5,
        },
        {
          compositionId: "02-price-reveal",
          fileName: "02-price-reveal.html",
          durationSeconds: 4.0,
        },
      ],
    });
    fs.writeFileSync(path.join(tempDir, "index.html"), hostIndexHtml, "utf8");

    for (const tempFile of [hookFile, priceFile]) {
      const plainRes = await runCli("npx", ["hyperframes", "lint", tempFile], ROOT_DIR);
      assert.equal(
        plainRes.code,
        0,
        `Expected npx hyperframes lint ${tempFile} to exit 0, got ${plainRes.code}.\nSTDOUT:\n${plainRes.stdout}\nSTDERR:\n${plainRes.stderr}`,
      );

      const jsonRes = await runCli("npx", ["hyperframes", "lint", "--json", tempFile], ROOT_DIR);
      assert.equal(jsonRes.code, 0);
      const parsed = JSON.parse(jsonRes.stdout.trim());
      assert.equal(parsed.ok, true);
      assert.equal(parsed.errorCount, 0, `Errors: ${JSON.stringify(parsed.findings, null, 2)}`);
      assert.equal(parsed.warningCount, 0, `Warnings: ${JSON.stringify(parsed.findings, null, 2)}`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  assert.equal(fs.existsSync(tempDir), false, "Temporary lint directory must be deleted");
});

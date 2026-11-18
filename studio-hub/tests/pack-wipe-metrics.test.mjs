import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getToolEnv, ROOT_DIR } from "../lib.mjs";
import { ARCHETYPES, renderArchetypeScene } from "../templates/pack-wipe-metrics.mjs";

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
    <title>Wipe Metrics Test Host</title>
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

test("ARCHETYPES exports frozen metadata for before-after-wipe and metric-counter-wall", () => {
  assert.ok(Array.isArray(ARCHETYPES), "ARCHETYPES must be an array");
  assert.equal(ARCHETYPES.length, 2);
  assert.equal(Object.isFrozen(ARCHETYPES), true);

  const ids = ARCHETYPES.map((item) => item.id);
  assert.deepEqual(ids, ["before-after-wipe", "metric-counter-wall"]);

  for (const entry of ARCHETYPES) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.name, "string");
    assert.ok(entry.name.length > 0);
    assert.equal(typeof entry.description, "string");
    assert.ok(entry.description.length > 10);
    assert.equal(typeof entry.category, "string");
  }
});

test("renderArchetypeScene rejects unknown archetypeId", () => {
  assert.throws(
    () =>
      renderArchetypeScene({
        archetypeId: "non-existent-archetype",
        compositionId: "scene-bad",
        width: 1080,
        height: 1920,
        durationSeconds: 4,
      }),
    /before-after-wipe|metric-counter-wall/i,
  );
});

test("renderArchetypeScene produces deterministic, strict HyperFrames contract HTML for both archetypes", () => {
  const brandColors = {
    primary: "#1E824C",
    secondary: "#2ECC71",
    accent: "#FACC15",
    background: "#0A1410",
  };

  const wipeShot = {
    badge: "STUDIO WIPE",
    headline: "Raw Input vs Cinema Master",
    subheadline: "Split clip-path transition with synchronized divider handle.",
    beforeLabel: "RAW CAPTURE",
    afterLabel: "GRADED MASTER",
    beforeClip: "/assets/clips/raw_take.mp4",
    afterClip: "/assets/clips/graded_take.mp4",
  };

  const wipeHtmlA = renderArchetypeScene({
    archetypeId: "before-after-wipe",
    compositionId: "wipe-scene-01",
    width: 1080,
    height: 1920,
    durationSeconds: 4.5,
    shot: wipeShot,
    brandColors,
  });
  const wipeHtmlB = renderArchetypeScene({
    archetypeId: "before-after-wipe",
    compositionId: "wipe-scene-01",
    width: 1080,
    height: 1920,
    durationSeconds: 4.5,
    shot: wipeShot,
    brandColors,
  });

  assert.equal(wipeHtmlA, wipeHtmlB, "Output must be 100% deterministic across calls");
  assert.match(wipeHtmlA, /^<template id="wipe-scene-01-template">/);
  assert.match(wipeHtmlA, /<\/template>\s*$/);
  assert.match(
    wipeHtmlA,
    /<div data-composition-id="wipe-scene-01" data-width="1080" data-height="1920" data-duration="4\.5">/,
  );
  assert.match(wipeHtmlA, /\[data-composition-id="wipe-scene-01"\]/);
  assert.match(wipeHtmlA, /clip-path:\s*inset\(/i);
  assert.match(wipeHtmlA, /class="clip\b/);
  assert.match(wipeHtmlA, /data-start="0"/);
  assert.match(wipeHtmlA, /data-duration="4\.5"/);
  assert.match(wipeHtmlA, /<video\b[^>]*\bmuted\b/);
  assert.match(wipeHtmlA, /src="assets\/clips\/raw_take\.mp4"/);
  assert.match(wipeHtmlA, /src="assets\/clips\/graded_take\.mp4"/);
  assert.doesNotMatch(wipeHtmlA, /src="\/assets\//);
  assert.doesNotMatch(wipeHtmlA, /\btransform\s*:/);
  assert.doesNotMatch(wipeHtmlA, /Date\.now\s*\(/);
  assert.doesNotMatch(wipeHtmlA, /Math\.random\s*\(/);
  assert.doesNotMatch(wipeHtmlA, /repeat\s*:\s*-1/);
  assert.match(wipeHtmlA, /#0A1410/i);
  assert.match(wipeHtmlA, /#FFFFFF/i);
  assert.match(wipeHtmlA, /#FACC15/i);
  assert.match(wipeHtmlA, /#08120E/i);
  assert.match(wipeHtmlA, /window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\};/);
  assert.match(wipeHtmlA, /window\.__timelines\["wipe-scene-01"\]\s*=\s*tl;/);

  const metricsShot = {
    badge: "VERIFIED KPI",
    headline: "Production Scale Telemetry",
    subheadline: "Measured across automated HyperFrames render pipelines.",
    plateImage: "/assets/images/preview_plate.png",
    metrics: [
      { target: 4.2, suffix: "x", decimals: 1, label: "Render Throughput", delta: "+320%" },
      { value: "99.8%", label: "Seek Determinism", delta: "LOCKED" },
      { value: "$1.5M", label: "Creator Value", delta: "VERIFIED" },
    ],
  };

  const metricsHtmlA = renderArchetypeScene({
    archetypeId: "metric-counter-wall",
    compositionId: "metrics-scene-02",
    width: 1920,
    height: 1080,
    durationSeconds: 5,
    shot: metricsShot,
    brandColors,
  });
  const metricsHtmlB = renderArchetypeScene({
    archetypeId: "metric-counter-wall",
    compositionId: "metrics-scene-02",
    width: 1920,
    height: 1080,
    durationSeconds: 5,
    shot: metricsShot,
    brandColors,
  });

  assert.equal(metricsHtmlA, metricsHtmlB, "Metric wall output must be deterministic");
  assert.match(metricsHtmlA, /^<template id="metrics-scene-02-template">/);
  assert.match(
    metricsHtmlA,
    /<div data-composition-id="metrics-scene-02" data-width="1920" data-height="1080" data-duration="5">/,
  );
  assert.match(metricsHtmlA, /\[data-composition-id="metrics-scene-02"\]/);
  assert.match(metricsHtmlA, /tabular-nums/);
  assert.match(metricsHtmlA, /4\.2x/);
  assert.match(metricsHtmlA, /99\.8%/);
  assert.match(metricsHtmlA, /\$1\.5M/);
  assert.match(metricsHtmlA, /Render Throughput/);
  assert.match(metricsHtmlA, /Seek Determinism/);
  assert.match(metricsHtmlA, /Creator Value/);
  assert.match(metricsHtmlA, /src="assets\/images\/preview_plate\.png"/);
  assert.doesNotMatch(metricsHtmlA, /src="\/assets\//);
  assert.doesNotMatch(metricsHtmlA, /\btransform\s*:/);
  assert.doesNotMatch(metricsHtmlA, /Date\.now\s*\(/);
  assert.doesNotMatch(metricsHtmlA, /Math\.random\s*\(/);
  assert.doesNotMatch(metricsHtmlA, /repeat\s*:\s*-1/);
  assert.match(metricsHtmlA, /window\.__timelines\["metrics-scene-02"\]\s*=\s*tl;/);
});

test("generated HTML for both archetypes passes npx hyperframes lint <tempFile.html> with 0 errors in os.tmpdir()", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-pack-wipe-metrics-"));

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
    fs.writeFileSync(path.join(imagesDir, "metrics_preview.png"), minimalPng);

    // Synthesize two tiny valid H.264 MP4 clips so both <video muted> layers are linted end-to-end
    const rawClipAbs = path.join(clipsDir, "raw_sample.mp4");
    const gradedClipAbs = path.join(clipsDir, "graded_sample.mp4");
    const [ffRaw, ffGraded] = await Promise.all([
      runCli("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=#1E293B:s=320x240:d=1",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        rawClipAbs,
      ]),
      runCli("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=#1E824C:s=320x240:d=1",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        gradedClipAbs,
      ]),
    ]);
    const hasSampleVideos =
      ffRaw.code === 0 &&
      ffGraded.code === 0 &&
      fs.existsSync(rawClipAbs) &&
      fs.existsSync(gradedClipAbs);

    const wipeHtml = renderArchetypeScene({
      archetypeId: "before-after-wipe",
      compositionId: "01-before-after",
      width: 1080,
      height: 1920,
      durationSeconds: 4,
      shot: {
        badge: "TRANSFORMATION",
        headline: "Before & After Split Reveal",
        subheadline: "Crisp wipe handle with clip-path inset synchronization.",
        ...(hasSampleVideos
          ? {
              beforeClip: "assets/clips/raw_sample.mp4",
              afterClip: "assets/clips/graded_sample.mp4",
            }
          : {}),
      },
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#FACC15",
        background: "#0A1410",
      },
    });

    const metricsHtml = renderArchetypeScene({
      archetypeId: "metric-counter-wall",
      compositionId: "02-metric-wall",
      width: 1080,
      height: 1920,
      durationSeconds: 4,
      shot: {
        badge: "KEY METRICS",
        headline: "Three Bold Tabular Counters",
        subheadline: "High-contrast stat cards paired with a framed preview plate.",
        plateImage: "assets/images/metrics_preview.png",
      },
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#FACC15",
        background: "#0A1410",
      },
    });

    const wipeFile = path.join(compositionsDir, "01-before-after.html");
    const metricsFile = path.join(compositionsDir, "02-metric-wall.html");
    fs.writeFileSync(wipeFile, wipeHtml, "utf8");
    fs.writeFileSync(metricsFile, metricsHtml, "utf8");

    const hostIndexHtml = buildMinimalHostIndexHtml({
      width: 1080,
      height: 1920,
      compositions: [
        {
          compositionId: "01-before-after",
          fileName: "01-before-after.html",
          durationSeconds: 4,
        },
        {
          compositionId: "02-metric-wall",
          fileName: "02-metric-wall.html",
          durationSeconds: 4,
        },
      ],
    });
    fs.writeFileSync(path.join(tempDir, "index.html"), hostIndexHtml, "utf8");

    for (const tempFile of [wipeFile, metricsFile]) {
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

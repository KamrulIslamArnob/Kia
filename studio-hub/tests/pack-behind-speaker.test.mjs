import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT_DIR, getToolEnv } from "../lib.mjs";
import {
  ARCHETYPES,
  PACK_ID,
  getArchetypeById,
  renderArchetypeScene,
} from "../templates/pack-behind-speaker.mjs";

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
    <title>Temp Behind Speaker Host</title>
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

const TINY_RGBA_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("pack-behind-speaker — ARCHETYPES metadata and contract validation", () => {
  assert.equal(PACK_ID, "behind-speaker");
  assert.ok(Array.isArray(ARCHETYPES), "ARCHETYPES must be an array");
  assert.equal(ARCHETYPES.length, 2);

  const ids = ARCHETYPES.map((item) => item.id);
  assert.deepEqual(ids, ["depth-text-behind-speaker", "podcast-dual-split"]);

  assert.equal(getArchetypeById("depth-text-behind-speaker")?.name, "Depth Text Behind Speaker");
  assert.equal(getArchetypeById("podcast-dual-split")?.name, "Podcast Dual Split");
  assert.equal(getArchetypeById("invalid-id"), null);

  for (const meta of ARCHETYPES) {
    assert.equal(meta.pack, "behind-speaker");
    assert.equal(typeof meta.description, "string");
    assert.ok(meta.description.length > 12);
    assert.ok(Array.isArray(meta.slots) && meta.slots.length > 0);
  }

  assert.throws(
    () =>
      renderArchetypeScene({
        archetypeId: "unknown-archetype",
        compositionId: "bad-comp",
        width: 1080,
        height: 1920,
        durationSeconds: 4,
        shot: {},
        brandColors: {},
      }),
    /Unsupported archetypeId/i,
  );
});

test("pack-behind-speaker — depth-text-behind-speaker renders 3-layer Z sandwich with optional RGBA subjectMatteSrc", () => {
  const withMatteParams = {
    archetypeId: "depth-text-behind-speaker",
    compositionId: "scene-depth-01",
    width: 1080,
    height: 1920,
    durationSeconds: 4.0,
    shot: {
      videoSrc: "/assets/clips/speaker-raw.mp4",
      subjectMatteSrc: "/assets/images/matte_speaker.png",
      badgeText: "FOUNDER KEYNOTE",
      headline: "CREATE FASTER",
      speakerName: "Ariana Chen",
      subheadline: "Layer bold cinema typography cleanly behind your on-camera presenter.",
    },
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#FACC15",
      background: "#0A1410",
    },
  };

  const htmlA = renderArchetypeScene(withMatteParams);
  const htmlB = renderArchetypeScene(withMatteParams);
  assert.equal(htmlA, htmlB, "Output must be 100% deterministic");

  assert.match(htmlA, /^<template id="scene-depth-01-template">/);
  assert.match(
    htmlA,
    /<div[^>]*data-composition-id="scene-depth-01"[^>]*data-width="1080"[^>]*data-height="1920"[^>]*data-duration="4"/,
  );

  // Verify 3-layer sandwich DOM order: background video -> giant headline -> foreground subject matte
  const bgVideoIdx = htmlA.indexOf('src="assets/clips/speaker-raw.mp4"');
  const headlineIdx = htmlA.indexOf("CREATE FASTER");
  const matteImgIdx = htmlA.indexOf('src="assets/images/matte_speaker.png"');

  assert.ok(bgVideoIdx > 0, "Layer 1 background video must exist with normalized relative path");
  assert.ok(
    headlineIdx > bgVideoIdx,
    "Layer 2 giant display headline must follow Layer 1 background",
  );
  assert.ok(
    matteImgIdx > headlineIdx,
    "Layer 3 RGBA subject foreground matte must sit after Layer 2 headline in DOM order",
  );

  // Intentional occlusion attribute for HyperFrames layout audit
  assert.match(htmlA, /data-layout-allow-occlusion/);

  // Strict HyperFrames invariants
  const styleBlocks = [...htmlA.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join("\n");
  assert.doesNotMatch(styleBlocks, /(?<![-\w])transform\s*:/i, "Zero CSS transform rules allowed");
  assert.match(htmlA, /<video\b[^>]*\bmuted\b[^>]*>/);
  assert.doesNotMatch(htmlA, /src="\/assets\//);
  assert.doesNotMatch(htmlA, /Date\.now\s*\(/);
  assert.doesNotMatch(htmlA, /Math\.random\s*\(/);
  assert.doesNotMatch(htmlA, /repeat\s*:\s*-1/);
  assert.match(htmlA, /window\.__timelines\["scene-depth-01"\]\s*=\s*tl;/);

  // Verify optionality when subjectMatteSrc is omitted
  const withoutMatteHtml = renderArchetypeScene({
    ...withMatteParams,
    compositionId: "scene-depth-no-matte",
    shot: {
      headline: "BOLD VISION",
      subheadline: "Clean depth stage even before foreground cutout extraction.",
    },
  });
  assert.doesNotMatch(withoutMatteHtml, /subject-matte"[^>]*src=/);
  assert.match(withoutMatteHtml, /BOLD VISION/);
});

test("pack-behind-speaker — podcast-dual-split renders dual speaker feeds, active waveform meters & topic card", () => {
  const params = {
    archetypeId: "podcast-dual-split",
    compositionId: "scene-podcast-02",
    width: 1080,
    height: 1920,
    durationSeconds: 4.5,
    shot: {
      hostVideoSrc: "/assets/clips/host-cam.mp4",
      guestVideoSrc: "/assets/clips/guest-cam.mp4",
      hostName: "Nadia Rahman",
      guestName: "Devon Brooks",
      topicBadge: "EPISODE 42 · DESIGN OPS",
      headline: "Why Local-First Video Wins",
      subheadline: "Two perspectives on zero-latency creative tooling.",
    },
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#FACC15",
      background: "#0A1410",
    },
  };

  const html = renderArchetypeScene(params);

  assert.match(html, /^<template id="scene-podcast-02-template">/);
  assert.match(html, /src="assets\/clips\/host-cam\.mp4"/);
  assert.match(html, /src="assets\/clips\/guest-cam\.mp4"/);
  assert.doesNotMatch(html, /src="\/assets\//);
  assert.match(html, /Nadia Rahman/);
  assert.match(html, /Devon Brooks/);
  assert.match(html, /Why Local-First Video Wins/);
  assert.match(html, /Two perspectives on zero-latency creative tooling\./);

  const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  assert.doesNotMatch(styleBlocks, /(?<![-\w])transform\s*:/i);
  assert.doesNotMatch(html, /Date\.now\s*\(/);
  assert.doesNotMatch(html, /Math\.random\s*\(/);
  assert.doesNotMatch(html, /repeat\s*:\s*-1/);
  assert.match(html, /window\.__timelines\["scene-podcast-02"\]\s*=\s*tl;/);
});

test("pack-behind-speaker — npx hyperframes lint passes with 0 errors & 0 warnings in os.tmpdir() for both archetypes", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-pack-behind-speaker-"));

  try {
    const compsDir = path.join(tempDir, "compositions");
    const clipsDir = path.join(tempDir, "assets", "clips");
    const imagesDir = path.join(tempDir, "assets", "images");
    fs.mkdirSync(compsDir, { recursive: true });
    fs.mkdirSync(clipsDir, { recursive: true });
    fs.mkdirSync(imagesDir, { recursive: true });

    fs.writeFileSync(path.join(imagesDir, "bg-plate.png"), TINY_RGBA_PNG);
    fs.writeFileSync(path.join(imagesDir, "matte_speaker.png"), TINY_RGBA_PNG);
    fs.writeFileSync(path.join(imagesDir, "host-still.png"), TINY_RGBA_PNG);
    fs.writeFileSync(path.join(imagesDir, "guest-still.png"), TINY_RGBA_PNG);

    const mp4Path = path.join(clipsDir, "speaker-bg.mp4");
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
    const hasMp4 = ffRes.code === 0 && fs.existsSync(mp4Path);

    const scenes = [
      {
        archetypeId: "depth-text-behind-speaker",
        compositionId: "depth_speaker_01",
        width: 1080,
        height: 1920,
        durationSeconds: 4.0,
        shot: {
          ...(hasMp4
            ? { videoSrc: "assets/clips/speaker-bg.mp4" }
            : { imageSrc: "assets/images/bg-plate.png" }),
          subjectMatteSrc: "assets/images/matte_speaker.png",
          badgeText: "STUDIO DEPTH",
          headline: "BEHIND SPEAKER",
          speakerName: "Kamrul Studio",
          subheadline: "Three-plane depth sandwich with RGBA foreground speaker matte.",
        },
      },
      {
        archetypeId: "podcast-dual-split",
        compositionId: "podcast_split_02",
        width: 1080,
        height: 1920,
        durationSeconds: 4.0,
        shot: {
          hostImageSrc: "assets/images/host-still.png",
          guestImageSrc: "assets/images/guest-still.png",
          hostName: "Host Speaker",
          guestName: "Guest Speaker",
          topicBadge: "LIVE STUDIO",
          headline: "Dual Split Conversation",
          subheadline: "Balanced framing for vertical reels and widescreen episodes.",
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

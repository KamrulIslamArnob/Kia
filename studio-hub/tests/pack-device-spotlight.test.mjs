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
} from "../templates/pack-device-spotlight.mjs";

function runHyperframesLint(targetHtmlFile, extraArgs = [], cwd = ROOT_DIR) {
  return new Promise((resolve) => {
    const env = getToolEnv();
    const isWin = process.platform === "win32";
    const child = spawn("npx", ["hyperframes", "lint", ...extraArgs, targetHtmlFile], {
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

function parseLintJson(rawOutput) {
  const trimmed = String(rawOutput || "").trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  assert.ok(
    firstBrace !== -1 && lastBrace > firstBrace,
    `Expected JSON output from hyperframes lint, got: ${trimmed}`,
  );
  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
}

test("pack-device-spotlight — ARCHETYPES catalog metadata & lookup", () => {
  assert.ok(Array.isArray(ARCHETYPES), "ARCHETYPES should be an array");
  assert.equal(ARCHETYPES.length, 2);
  assert.deepEqual(
    ARCHETYPES.map((item) => item.id),
    ["device-3d-showcase", "spotlight-cursor-zoom"],
  );

  for (const entry of ARCHETYPES) {
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.name, "string");
    assert.ok(entry.name.length > 3);
    assert.equal(typeof entry.description, "string");
    assert.ok(entry.description.length > 10);
    assert.ok(Array.isArray(entry.supportedAspects));
    assert.ok(entry.supportedAspects.includes("9:16"));
    assert.ok(entry.supportedAspects.includes("16:9"));
    assert.ok(entry.defaultDurationSeconds > 0);
  }

  assert.equal(getArchetypeById("device-3d-showcase")?.id, "device-3d-showcase");
  assert.equal(getArchetypeById("spotlight-cursor-zoom")?.id, "spotlight-cursor-zoom");
  assert.equal(getArchetypeById("unknown"), null);
});

test("pack-device-spotlight — deterministic HyperFrames contract, media & WCAG contrast", () => {
  const brandColors = {
    primary: "#1E824C",
    secondary: "#2ECC71",
    accent: "#FACC15",
    background: "#08120E",
  };

  const shotPayload = {
    badge: "NEW LAUNCH",
    headline: "3D Flagship Storefront",
    subheadline: "Zero-latency mobile checkout with live inventory sync.",
    calloutLabel: "CONVERSION LIFT",
    calloutValue: "+42% Faster Tap Flow",
    videoSrc: "/assets/clips/storefront_demo.mp4",
  };

  const deviceHtmlA = renderArchetypeScene({
    archetypeId: "device-3d-showcase",
    compositionId: "scene-device-01",
    width: 1080,
    height: 1920,
    durationSeconds: 4.5,
    shot: shotPayload,
    brandColors,
  });

  const deviceHtmlB = renderArchetypeScene({
    archetypeId: "device-3d-showcase",
    compositionId: "scene-device-01",
    width: 1080,
    height: 1920,
    durationSeconds: 4.5,
    shot: shotPayload,
    brandColors,
  });

  assert.equal(deviceHtmlA, deviceHtmlB, "renderArchetypeScene must be 100% deterministic");

  // Browser bezel + HTML escaping + image plate path normalization
  const browserHtml = renderArchetypeScene({
    archetypeId: "device-3d-showcase",
    compositionId: "12-browser-scene",
    width: 1920,
    height: 1080,
    durationSeconds: 4,
    shot: {
      deviceType: "browser",
      badge: "WEB STUDIO",
      headline: "Desktop Command Deck <Pro> & Live",
      imageSrc: "\\assets\\images\\dashboard_plate.png",
    },
    brandColors,
  });
  assert.match(browserHtml, /Desktop Command Deck &lt;Pro&gt; &amp; Live/);
  assert.match(browserHtml, /browser-bar/);
  assert.match(browserHtml, /src="assets\/images\/dashboard_plate\.png"/);
  assert.doesNotMatch(browserHtml, /#12-browser/);

  // Device 3D Showcase structural checks
  assert.match(deviceHtmlA, /^<template id="scene-device-01-template">/);
  assert.match(deviceHtmlA, /<\/template>\s*$/);
  assert.match(deviceHtmlA, /data-composition-id="scene-device-01"/);
  assert.match(deviceHtmlA, /data-width="1080"/);
  assert.match(deviceHtmlA, /data-height="1920"/);
  assert.match(deviceHtmlA, /data-duration="4\.5"/);
  assert.match(deviceHtmlA, /data-layout-allow-overflow/);
  assert.match(deviceHtmlA, /<svg[\s\S]*stroke-dasharray=/);
  assert.match(deviceHtmlA, /rotationY/);
  assert.match(deviceHtmlA, /<video\b[^>]*\bmuted\b[^>]*>/);
  assert.match(deviceHtmlA, /src="assets\/clips\/storefront_demo\.mp4"/);
  assert.doesNotMatch(deviceHtmlA, /src="\/assets\//);

  // Spotlight Cursor Zoom structural checks
  const spotlightHtml = renderArchetypeScene({
    archetypeId: "spotlight-cursor-zoom",
    compositionId: "scene-spot-02",
    width: 1920,
    height: 1080,
    durationSeconds: 3.8,
    shot: {
      badge: "PRECISION FOCUS",
      headline: "One-Click Instant Checkout",
      subheadline: "Watch the spotlight lock onto the primary action trigger.",
      videoSrc: "assets/clips/checkout_click.mp4",
      camera: {
        toScale: 1.48,
        focusX: 56,
        focusY: 46,
      },
    },
    brandColors,
  });

  assert.match(spotlightHtml, /^<template id="scene-spot-02-template">/);
  assert.match(spotlightHtml, /data-composition-id="scene-spot-02"/);
  assert.match(spotlightHtml, /data-width="1920"/);
  assert.match(spotlightHtml, /data-height="1080"/);
  assert.match(spotlightHtml, /data-duration="3\.8"/);
  assert.match(spotlightHtml, /dim-stage/);
  assert.match(spotlightHtml, /spotlight-frame/);
  assert.match(spotlightHtml, /cursor/);
  assert.match(spotlightHtml, /ripple/);
  assert.match(spotlightHtml, /zoom-rig/);

  for (const [compId, html] of [
    ["scene-device-01", deviceHtmlA],
    ["scene-spot-02", spotlightHtml],
  ]) {
    assert.match(html, new RegExp(`\\[data-composition-id="${compId}"\\]`));
    assert.match(html, /class="clip\b/);
    assert.match(html, /data-start="0"/);
    assert.match(html, /gsap\.timeline\(\{\s*paused:\s*true\s*\}\)/);
    assert.match(html, /window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\};/);
    assert.match(html, new RegExp(`window\\.__timelines\\["${compId}"\\]\\s*=\\s*tl;`));
    assert.match(html, /#0A1410/i);
    assert.match(html, /#FFFFFF/i);
    assert.match(html, /#FACC15/i);
    assert.match(html, /#08120E/i);
    assert.doesNotMatch(html, /Date\.now\s*\(/);
    assert.doesNotMatch(html, /Math\.random\s*\(/);
    assert.doesNotMatch(html, /repeat\s*:\s*-1/);
    assert.doesNotMatch(html, /(?<![-\w])transform\s*:/i);
  }

  assert.throws(
    () =>
      renderArchetypeScene({
        archetypeId: "non-existent-archetype",
        compositionId: "bad-scene",
        width: 1080,
        height: 1920,
        durationSeconds: 3,
      }),
    /Unsupported archetypeId/i,
  );
});

test("pack-device-spotlight — npx hyperframes lint passes with 0 errors in os.tmpdir()", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-pack-device-spotlight-"));
  try {
    const compositionsDir = path.join(tmpDir, "compositions");
    const clipsDir = path.join(tmpDir, "assets", "clips");
    fs.mkdirSync(compositionsDir, { recursive: true });
    fs.mkdirSync(clipsDir, { recursive: true });

    const sampleClipRel = "assets/clips/demo_preview.mp4";
    fs.writeFileSync(path.join(tmpDir, sampleClipRel), Buffer.alloc(64));

    const rootIndexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="8" data-width="1080" data-height="1920">
      <div
        id="scene-01"
        class="clip"
        data-composition-id="scene-01"
        data-composition-src="compositions/device-3d-showcase.html"
        data-track-kind="graphics"
        data-track-index="1"
        data-start="0"
        data-duration="4"
        data-width="1080"
        data-height="1920"
      ></div>
      <div
        id="scene-02"
        class="clip"
        data-composition-id="scene-02"
        data-composition-src="compositions/spotlight-cursor-zoom.html"
        data-track-kind="graphics"
        data-track-index="1"
        data-start="4"
        data-duration="4"
        data-width="1080"
        data-height="1920"
      ></div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
    fs.writeFileSync(path.join(tmpDir, "index.html"), rootIndexHtml, "utf8");

    const cases = [
      {
        archetypeId: "device-3d-showcase",
        compositionId: "scene-01",
        fileName: "device-3d-showcase.html",
        shot: {
          badge: "VERIFIED QUALITY",
          headline: "3D Smartphone Showcase",
          subheadline: "Ambient glow, dotted SVG callout, and crisp dark card.",
          calloutLabel: "PERFORMANCE",
          calloutValue: "60 FPS Deterministic",
          videoSrc: sampleClipRel,
        },
      },
      {
        archetypeId: "spotlight-cursor-zoom",
        compositionId: "scene-02",
        fileName: "spotlight-cursor-zoom.html",
        shot: {
          badge: "INTERACTIVE BEAT",
          headline: "Spotlight Pointer & Optical Zoom",
          subheadline: "Oversized cursor tap ignites click ripple and smooth target zoom.",
          videoSrc: sampleClipRel,
        },
      },
    ];

    for (const item of cases) {
      const html = renderArchetypeScene({
        archetypeId: item.archetypeId,
        compositionId: item.compositionId,
        width: 1080,
        height: 1920,
        durationSeconds: 4,
        shot: item.shot,
        brandColors: {
          primary: "#1E824C",
          secondary: "#2ECC71",
          accent: "#FACC15",
          background: "#08120E",
        },
      });

      const tempFile = path.join(compositionsDir, item.fileName);
      fs.writeFileSync(tempFile, html, "utf8");

      const humanRes = await runHyperframesLint(tempFile, []);
      assert.equal(
        humanRes.code,
        0,
        `npx hyperframes lint <tempFile> failed for ${item.archetypeId}:\nSTDOUT: ${humanRes.stdout}\nSTDERR: ${humanRes.stderr}`,
      );

      const jsonRes = await runHyperframesLint(tempFile, ["--json"]);
      assert.equal(jsonRes.code, 0, jsonRes.stderr);
      const parsed = parseLintJson(jsonRes.stdout);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.errorCount, 0);
      assert.equal(
        parsed.warningCount,
        0,
        `Expected 0 warnings for ${item.archetypeId}, got: ${JSON.stringify(parsed.findings)}`,
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
  assert.equal(fs.existsSync(tmpDir), false, "Temporary folder must be deleted after test");
});

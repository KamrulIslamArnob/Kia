import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getToolEnv, ROOT_DIR, runCommand } from "../lib.mjs";
import {
  CAPTION_STYLES,
  alignScriptToWordTimings,
  computeContrastRatio,
  getCaptionStyle,
  renderCaptionsSubComposition,
} from "../captions-engine.mjs";

const EXPECTED_STYLE_IDS = [
  "kinetic-gold-pop",
  "blur-morph-chest",
  "minimal-editorial-rail",
  "karaoke-word-pill",
  "bengali-emerald-card",
  "clean-cinema-sub",
];

function hexLuminance(hex) {
  const clean = String(hex).replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : clean;
  const r = Number.parseInt(full.slice(0, 2), 16) / 255;
  const g = Number.parseInt(full.slice(2, 4), 16) / 255;
  const b = Number.parseInt(full.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function wcagRatio(fg, bg) {
  const l1 = hexLuminance(fg);
  const l2 = hexLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseJsonOutput(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    return null;
  }
}

test("CAPTION_STYLES defines 6 WCAG AA contrast-verified presets inside 80% title-safe overlay bounds", () => {
  assert.ok(Array.isArray(CAPTION_STYLES), "CAPTION_STYLES must be an array");
  assert.equal(CAPTION_STYLES.length, 6);
  assert.deepEqual(
    CAPTION_STYLES.map((s) => s.id),
    EXPECTED_STYLE_IDS,
  );

  for (const id of EXPECTED_STYLE_IDS) {
    const style = getCaptionStyle(id);
    assert.ok(style, `getCaptionStyle("${id}") should return preset`);
    assert.equal(CAPTION_STYLES[id]?.id, id, `CAPTION_STYLES["${id}"] lookup should work`);

    const baseRatio = wcagRatio(style.palette.textColor, style.palette.backgroundColor);
    assert.ok(
      baseRatio >= 4.5,
      `${id} base text contrast ${baseRatio.toFixed(2)}:1 must be >= 4.5:1`,
    );
    assert.ok(
      Math.abs(
        computeContrastRatio(style.palette.textColor, style.palette.backgroundColor) - baseRatio,
      ) < 0.05,
    );

    const hiBg = style.palette.activePillBg || style.palette.backgroundColor;
    const hiFg = style.palette.activePillBg
      ? style.palette.activePillText
      : style.palette.highlightColor;
    const hiRatio = wcagRatio(hiFg, hiBg);
    assert.ok(hiRatio >= 4.5, `${id} highlight contrast ${hiRatio.toFixed(2)}:1 must be >= 4.5:1`);

    assert.ok(style.safeZone.leftPct >= 10, `${id} leftPct must be >= 10%`);
    assert.ok(style.safeZone.rightPct >= 10, `${id} rightPct must be >= 10%`);
    assert.ok(style.safeZone.bottomPct >= 10, `${id} bottomPct must be >= 10%`);
    assert.ok(style.safeZone.bottomPct <= 80, `${id} bottomPct must stay inside 80% title-safe`);
    assert.ok(style.safeZone.maxWidthPct <= 80, `${id} maxWidthPct must be <= 80%`);
    assert.equal(style.overlay.compositedOnTop, true);
    assert.equal(style.overlay.reservesKeepOutBand, false);
    assert.equal(style.overlay.shiftsUnderlyingLayout, false);
  }
});

test("alignScriptToWordTimings deterministically weights English syllables & characters", () => {
  const scriptText =
    "Transform your harvest with extraordinary precision. Fast delivery to a farm!";
  const alignedA = alignScriptToWordTimings({
    scriptText,
    startTime: 1.0,
    durationSeconds: 7.0,
    whisperSegments: null,
    maxWordsPerPhrase: 5,
  });
  const alignedB = alignScriptToWordTimings({
    scriptText,
    startTime: 1.0,
    durationSeconds: 7.0,
    whisperSegments: null,
    maxWordsPerPhrase: 5,
  });

  assert.deepEqual(alignedA, alignedB);
  assert.ok(alignedA.phrases.length >= 3);

  const firstPhrase = alignedA.phrases[0];
  const lastPhrase = alignedA.phrases.at(-1);
  assert.ok(firstPhrase.start >= 1.0);
  assert.ok(lastPhrase.end <= 8.001);
  assert.ok(Math.abs(lastPhrase.end - 8.0) < 0.05);

  const allWords = [];
  for (let i = 0; i < alignedA.phrases.length; i++) {
    const phrase = alignedA.phrases[i];
    assert.equal(phrase.index, i);
    assert.equal(typeof phrase.text, "string");
    assert.ok(phrase.text.length > 0);
    assert.equal(typeof phrase.highlightWord, "string");
    assert.ok(phrase.highlightWord.length > 0);
    assert.ok(
      phrase.text.toLowerCase().includes(phrase.highlightWord.toLowerCase()),
      `Phrase "${phrase.text}" must contain highlightWord "${phrase.highlightWord}"`,
    );
    assert.ok(phrase.words.length >= 1 && phrase.words.length <= 5);
    assert.equal(phrase.start, phrase.words[0].start);
    assert.equal(phrase.end, phrase.words.at(-1).end);

    for (let j = 0; j < phrase.words.length; j++) {
      const w = phrase.words[j];
      assert.ok(w.end > w.start, `Word "${w.word}" must have positive duration`);
      if (j > 0) {
        assert.ok(w.start >= phrase.words[j - 1].end - 1e-6);
      }
      allWords.push(w);
    }
    if (i > 0) {
      assert.ok(phrase.start >= alignedA.phrases[i - 1].end - 1e-6);
    }
  }

  const extraordinaryWord = allWords.find((w) => /extraordinary/i.test(w.word));
  const shortArticle = allWords.find((w) => /^a$/i.test(w.word));
  assert.ok(extraordinaryWord && shortArticle);
  assert.ok(
    extraordinaryWord.end - extraordinaryWord.start > (shortArticle.end - shortArticle.start) * 1.6,
    "Polysyllabic word should receive noticeably greater weighted duration than 1-letter article",
  );

  // Empty script handling
  const emptyAligned = alignScriptToWordTimings({ scriptText: "   ", durationSeconds: 3 });
  assert.deepEqual(emptyAligned, { phrases: [] });
});

test("alignScriptToWordTimings cleanly segments and weights Bengali (বাংলা) Unicode scripts", () => {
  const bengaliScript = "কৃষকের পাশে প্রতিদিন সেরা বীজ ও আধুনিক কৃষি প্রযুক্তি। আপনার ফসলের ফলন বাড়ান দ্বিগুণ!";
  const aligned = alignScriptToWordTimings({
    scriptText: bengaliScript,
    startTime: 0,
    durationSeconds: 8.0,
    whisperSegments: null,
    maxWordsPerPhrase: 4,
  });

  assert.ok(aligned.phrases.length >= 4);
  assert.equal(aligned.phrases[0].start, 0);
  assert.ok(Math.abs(aligned.phrases.at(-1).end - 8.0) < 0.05);

  const flatWords = aligned.phrases.flatMap((p) => p.words);
  for (const w of flatWords) {
    assert.doesNotMatch(
      w.word,
      /^[\u0981-\u0983\u09BC\u09BE-\u09CD\u09D7]/,
      `Word "${w.word}" must not start with a detached Bengali combining mark`,
    );
  }

  const dariPhrase = aligned.phrases.find((p) => p.text.includes("প্রযুক্তি।"));
  assert.ok(dariPhrase, "Bengali dari should stay attached to sentence-ending word");
  assert.ok(dariPhrase.text.endsWith("প্রযুক্তি।"), "Phrase should break cleanly at Bengali dari (।)");

  const particleO = flatWords.find((w) => w.word === "ও");
  const multiAkshara = flatWords.find((w) => w.word.startsWith("প্রতিদিন"));
  assert.ok(particleO && multiAkshara);
  assert.ok(multiAkshara.end - multiAkshara.start > particleO.end - particleO.start);

  for (const p of aligned.phrases) {
    assert.notEqual(p.highlightWord, "ও");
    assert.ok(p.words.length <= 4);
  }
});

test("alignScriptToWordTimings honors whisperSegments (both word-level and segment-level)", () => {
  const whisperWordLevel = [
    {
      start: 0.2,
      end: 2.1,
      text: "Smart farming starts right now",
      words: [
        { word: "Smart", start: 0.2, end: 0.55 },
        { word: "farming", start: 0.55, end: 1.05 },
        { word: "starts", start: 1.05, end: 1.42 },
        { word: "right", start: 1.68, end: 1.88 },
        { word: "now", start: 1.88, end: 2.1 },
      ],
    },
  ];

  const fromWords = alignScriptToWordTimings({
    scriptText: "Ignored fallback when whisper words exist",
    startTime: 0,
    durationSeconds: 3.0,
    whisperSegments: whisperWordLevel,
    maxWordsPerPhrase: 4,
  });

  assert.equal(fromWords.phrases.length, 2);
  assert.equal(fromWords.phrases[0].text, "Smart farming starts");
  assert.equal(fromWords.phrases[0].start, 0.2);
  assert.equal(fromWords.phrases[0].end, 1.42);
  assert.equal(fromWords.phrases[1].text, "right now");
  assert.equal(fromWords.phrases[1].start, 1.68);
  assert.equal(fromWords.phrases[1].end, 2.1);

  const whisperSegOnly = [
    { start: 0.4, end: 2.0, text: "সেরা ফসলের নিশ্চয়তা" },
    { start: 2.2, end: 3.8, text: "প্রতিটি কৃষকের হাতে" },
  ];
  const fromSegs = alignScriptToWordTimings({
    scriptText: "",
    startTime: 0,
    durationSeconds: 4.0,
    whisperSegments: whisperSegOnly,
    maxWordsPerPhrase: 5,
  });
  assert.equal(fromSegs.phrases.length, 2);
  assert.equal(fromSegs.phrases[0].start, 0.4);
  assert.equal(fromSegs.phrases[0].end, 2.0);
  assert.equal(fromSegs.phrases[1].start, 2.2);
  assert.equal(fromSegs.phrases[1].end, 3.8);
});

test("renderCaptionsSubComposition escapes special chars, guards low-contrast brandColors, and passes npx hyperframes lint across all 6 presets", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-captions-lint-"));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const compositionsDir = path.join(tmpDir, "compositions");
  fs.mkdirSync(compositionsDir, { recursive: true });

  const englishAligned = alignScriptToWordTimings({
    scriptText: 'Grow <10x> faster & smarter with "Krishop" verified seeds!',
    startTime: 0.15,
    durationSeconds: 5.5,
    maxWordsPerPhrase: 4,
  });

  const bengaliAligned = alignScriptToWordTimings({
    scriptText: "কৃষকের আস্থার সেরা ঠিকানা কৃষপ অ্যাপ। আজই অর্ডার করুন!",
    startTime: 0.15,
    durationSeconds: 5.5,
    maxWordsPerPhrase: 4,
  });

  // Verify low-contrast brand accent (#111513 on dark card) is rejected in favor of WCAG AA preset highlight
  const guardedHtml = renderCaptionsSubComposition({
    compositionId: "captions-track",
    width: 1920,
    height: 1080,
    totalDuration: 6.0,
    styleId: "minimal-editorial-rail",
    phrases: englishAligned.phrases,
    brandColors: { accent: "#111513" },
  });
  assert.match(guardedHtml, /#38BDF8/i);
  assert.match(guardedHtml, /&lt;10x&gt;/);
  assert.match(guardedHtml, /&amp;/);
  assert.match(guardedHtml, /&quot;Krishop&quot;/);

  const env = getToolEnv();
  const writtenSubComps = [];

  for (const style of CAPTION_STYLES) {
    const isBengali = style.id === "bengali-emerald-card";
    const phrases = isBengali ? bengaliAligned.phrases : englishAligned.phrases;
    const compId = style.id === "kinetic-gold-pop" ? "captions-track" : `cap-${style.id}`;

    const subHtml = renderCaptionsSubComposition({
      compositionId: compId,
      width: 1080,
      height: 1920,
      totalDuration: 6.0,
      styleId: style.id,
      phrases,
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#FACC15",
        background: "#0A1612",
      },
    });

    assert.match(subHtml, new RegExp(`^<template id="${compId}-template">`));
    assert.match(subHtml, new RegExp(`data-composition-id="${compId}"`));
    assert.match(subHtml, /data-width="1080"/);
    assert.match(subHtml, /data-height="1920"/);
    assert.match(subHtml, /data-duration="6"/);
    assert.match(subHtml, /class="clip caption-group"/);
    assert.match(subHtml, new RegExp(`window\\.__timelines\\["${compId}"\\]\\s*=\\s*tl`));
    assert.doesNotMatch(subHtml, /Date\.now\s*\(/);
    assert.doesNotMatch(subHtml, /Math\.random\s*\(/);
    assert.doesNotMatch(subHtml, /repeat\s*:\s*-1/);
    if (style.id === "blur-morph-chest") {
      assert.match(subHtml, /blur\(10px\)/);
      assert.match(subHtml, /blur\(0px\)/);
    }

    const subCompPath = path.join(compositionsDir, `${compId}.html`);
    fs.writeFileSync(subCompPath, subHtml, "utf8");
    writtenSubComps.push({ styleId: style.id, compId, subCompPath });
  }

  // Write root `index.html` mounting all 6 generated caption sub-compositions so
  // `resolveLintTarget` recognizes `compositions/*.html` as sub-compositions of `tmpDir`
  const mountedHostsHtml = writtenSubComps
    .map(
      (entry, idx) => `      <div
        id="${entry.compId}"
        class="clip"
        data-composition-id="${entry.compId}"
        data-composition-src="compositions/${entry.compId}.html"
        data-track-kind="captions"
        data-track-index="2"
        data-start="${idx * 6}"
        data-duration="6"
        data-width="1080"
        data-height="1920"
      ></div>`,
    )
    .join("\n");

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>Caption Track Project Lint Test</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background: #0a1612;
        font-family: "Inter", sans-serif;
      }
      #root {
        position: relative;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background: #0a1612;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="36"
      data-width="1080"
      data-height="1920"
    >
${mountedHostsHtml}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
  fs.writeFileSync(path.join(tmpDir, "index.html"), indexHtml, "utf8");

  // Lint all 6 sub-composition HTML files concurrently AND lint the full mounted project
  const [projectLint, ...subLintResults] = await Promise.all([
    runCommand("npx", ["hyperframes", "lint", "--json", tmpDir], {
      cwd: ROOT_DIR,
      env,
    }),
    ...writtenSubComps.map(async (entry) => ({
      ...entry,
      res: await runCommand("npx", ["hyperframes", "lint", "--json", entry.subCompPath], {
        cwd: ROOT_DIR,
        env,
      }),
    })),
  ]);

  for (const { styleId, res } of subLintResults) {
    const parsed = parseJsonOutput(res.stdout);
    assert.equal(
      res.code,
      0,
      `npx hyperframes lint failed for ${styleId}: ${res.stdout}\n${res.stderr}`,
    );
    assert.ok(parsed?.ok, `Expected ok:true for ${styleId}`);
    assert.equal(
      parsed.errorCount,
      0,
      `Expected 0 lint errors for ${styleId}: ${JSON.stringify(parsed.findings)}`,
    );
    assert.equal(
      parsed.warningCount,
      0,
      `Expected 0 lint warnings for ${styleId}: ${JSON.stringify(parsed.findings)}`,
    );
  }

  const projectParsed = parseJsonOutput(projectLint.stdout);
  assert.equal(
    projectLint.code,
    0,
    `Mounted project lint failed: ${projectLint.stdout}\n${projectLint.stderr}`,
  );
  assert.equal(
    projectParsed?.errorCount,
    0,
    `Expected 0 project lint errors: ${JSON.stringify(projectParsed?.findings)}`,
  );
  assert.equal(
    projectParsed?.warningCount,
    0,
    `Expected 0 project lint warnings: ${JSON.stringify(projectParsed?.findings)}`,
  );
  assert.equal(projectParsed?.filesScanned, 7);
});

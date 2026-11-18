import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getToolEnv, runCommand } from "../lib.mjs";
import { alignScriptToWordTimings } from "../captions-engine.mjs";
import { exportSubtitles, hexToAssColor, writeProjectSubtitles } from "../subtitle-exporter.mjs";

const TRILINGUAL_PHRASES = [
  {
    index: 0,
    text: "Grow 10x faster & smarter today!",
    highlightWord: "10x",
    start: 0.25,
    end: 2.6,
    words: [
      { word: "Grow", start: 0.25, end: 0.6 },
      { word: "10x", start: 0.6, end: 1.05 },
      { word: "faster", start: 1.05, end: 1.55 },
      { word: "&", start: 1.55, end: 1.75 },
      { word: "smarter", start: 1.75, end: 2.2 },
      { word: "today!", start: 2.2, end: 2.6 },
    ],
  },
  {
    index: 1,
    text: "কৃষকের পাশে প্রতিদিন সেরা বীজ ও প্রযুক্তি।",
    highlightWord: "প্রযুক্তি",
    start: 2.8,
    end: 5.95,
  },
  {
    index: 2,
    text: "हर किसान के लिए आधुनिक कृषि तकनीक और उत्तम बीज!",
    highlightWord: "आधुनिक",
    start: 61.05,
    end: 65.5,
  },
];

test("exportSubtitles generates broadcast-valid UTF-8 .srt with English, Bengali, and Hindi Unicode", () => {
  const srt = exportSubtitles({
    phrases: TRILINGUAL_PHRASES,
    format: "srt",
    width: 1080,
    height: 1920,
  });

  assert.match(srt, /^1\n00:00:00,250 --> 00:00:02,600\nGrow 10x faster & smarter today!\n\n/);
  assert.match(srt, /2\n00:00:02,800 --> 00:00:05,950\nকৃষকের পাশে প্রতিদিন সেরা বীজ ও প্রযুক্তি।\n\n/);
  assert.match(
    srt,
    /3\n00:01:01,050 --> 00:01:05,500\nहर किसान के लिए आधुनिक कृषि तकनीक और उत्तम बीज!\n/,
  );

  assert.equal(exportSubtitles({ phrases: [], format: "srt" }), "");
  assert.throws(() => exportSubtitles({ phrases: TRILINGUAL_PHRASES, format: " invalid " }), {
    message: /unsupported|invalid/i,
  });
});

test("exportSubtitles generates W3C-compliant .vtt with title-safe cue settings and entity escaping", () => {
  const vtt = exportSubtitles({
    phrases: [
      ...TRILINGUAL_PHRASES,
      {
        index: 3,
        text: "Save <50%> & boost ROI",
        highlightWord: "50%",
        start: 66.0,
        end: 68.25,
      },
    ],
    format: "vtt",
    width: 1080,
    height: 1920,
  });

  assert.ok(vtt.startsWith("WEBVTT\n"), "WebVTT must begin with WEBVTT header");
  assert.match(
    vtt,
    /1\n00:00:00\.250 --> 00:00:02\.600 line:\d+% position:50% align:center size:80%\nGrow 10x faster &amp; smarter today!/,
  );
  assert.ok(vtt.includes("কৃষকের পাশে প্রতিদিন সেরা বীজ ও প্রযুক্তি।"));
  assert.ok(vtt.includes("हर किसान के लिए आधुनिक कृषि तकनीक और उत्तम बीज!"));
  assert.ok(vtt.includes("Save &lt;50%&gt; &amp; boost ROI"));
});

test("exportSubtitles generates styled SubStation Alpha v4.00+ (.ass) with BGR colors and inline highlights", () => {
  assert.equal(hexToAssColor("#FACC15"), "&H0015CCFA");
  assert.equal(hexToAssColor("#FFFFFF"), "&H00FFFFFF");
  assert.equal(hexToAssColor("#0B1210", "80"), "&H8010120B");

  const ass = exportSubtitles({
    phrases: [
      ...TRILINGUAL_PHRASES,
      {
        index: 3,
        text: "Literal {brace} safety check",
        highlightWord: "safety",
        start: 68.5,
        end: 70.0,
      },
    ],
    format: "ass",
    width: 1080,
    height: 1920,
    style: {
      styleId: "kinetic-gold-pop",
    },
  });

  assert.match(ass, /\[Script Info\]/);
  assert.match(ass, /ScriptType: v4\.00\+/);
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /\[V4\+ Styles\]/);
  assert.match(ass, /Style: Default,/);
  assert.match(ass, /\[Events\]/);
  assert.match(ass, /Dialogue: 0,0:00:00\.25,0:00:02\.60,Default,/);
  assert.match(ass, /Dialogue: 0,0:01:01\.05,0:01:05\.50,Default,/);
  // Highlight word override tag present and Unicode words intact
  assert.match(ass, /\{\\c&H0015CCFA&\}10x\{\\c&H00FFFFFF&\}/);
  assert.ok(ass.includes("প্রযুক্তি"));
  assert.ok(ass.includes("आधुनिक"));
  // Braces in user text escaped so ASS override parser never breaks
  assert.doesNotMatch(ass, /Literal \{brace\}/);
});

test("writeProjectSubtitles writes UTF-8 .srt, .vtt, and .ass into projects/<slug>/output/ and passes ffprobe demuxer verification", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-sub-exporter-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const slug = "trilingual-demo";
  const projectDir = path.join(tmpRoot, slug);
  fs.mkdirSync(path.join(projectDir, "output"), { recursive: true });

  // Seed STORYBOARD.json with English, Bengali, and Hindi voiceover lines to test phrases=null auto-alignment
  const storyboard = {
    slug,
    width: 1080,
    height: 1920,
    frames: [
      {
        id: "frame_01",
        durationSeconds: 3.0,
        audioSpec: {
          voiceoverText: "Smart organic harvest delivered straight to your doorstep.",
        },
      },
      {
        id: "frame_02",
        durationSeconds: 3.5,
        audioSpec: {
          voiceoverText: "কৃষকের আস্থার সেরা ঠিকানা কৃষপ অ্যাপ। আজই অর্ডার করুন!",
        },
      },
      {
        id: "frame_03",
        durationSeconds: 3.5,
        audioSpec: {
          voiceoverText: "बेहतर फसल और तेज़ डिलीवरी अब हर किसान के हाथ में।",
        },
      },
    ],
  };
  fs.writeFileSync(
    path.join(projectDir, "STORYBOARD.json"),
    JSON.stringify(storyboard, null, 2),
    "utf8",
  );

  const result = await writeProjectSubtitles({
    slug,
    phrases: null,
    formats: ["srt", "vtt", "ass"],
    projectsDir: tmpRoot,
  });

  assert.equal(result.ok, true);
  assert.equal(result.slug, slug);
  assert.ok(result.phraseCount >= 3);
  assert.equal(result.files.length, 3);

  const expectedCodecs = {
    srt: "subrip",
    vtt: "webvtt",
    ass: "ass",
  };
  const env = getToolEnv();

  for (const fmt of ["srt", "vtt", "ass"]) {
    const entry = result.byFormat[fmt];
    assert.ok(entry, `Missing byFormat.${fmt}`);
    assert.match(entry.relPath, new RegExp(`^output/.*\\.${fmt}$`));
    assert.match(
      entry.url,
      new RegExp(`^/media/${slug}/output/.*\\.${fmt}$`),
      `Expected /media/:slug/output/... download URL for ${fmt}`,
    );
    assert.equal(result.urls[fmt], entry.url);
    assert.ok(fs.existsSync(entry.absPath), `Expected ${entry.absPath} on disk`);
    assert.ok(entry.sizeBytes > 40);

    const diskContent = fs.readFileSync(entry.absPath, "utf8");
    assert.ok(diskContent.includes("harvest"), `${fmt} should preserve English text`);
    assert.ok(diskContent.includes("কৃষকের"), `${fmt} should preserve Bengali Unicode`);
    assert.ok(diskContent.includes("किसान"), `${fmt} should preserve Hindi Unicode`);

    // Verify real broadcast subtitle demuxer validity with ffprobe
    const probe = await runCommand(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_name", "-of", "json", entry.absPath],
      { env, shell: false },
    );
    assert.equal(
      probe.code,
      0,
      `ffprobe failed to parse generated .${fmt}: ${probe.stderr || probe.stdout}`,
    );
    const parsedProbe = JSON.parse(probe.stdout);
    assert.equal(parsedProbe.streams?.[0]?.codec_name, expectedCodecs[fmt]);
  }

  // Also test explicit phrases input from alignScriptToWordTimings + traversal rejection
  const aligned = alignScriptToWordTimings({
    scriptText: "Direct phrases export check",
    startTime: 0,
    durationSeconds: 2.5,
  });
  const singleRes = await writeProjectSubtitles({
    slug,
    phrases: aligned.phrases,
    formats: ["srt"],
    projectsDir: tmpRoot,
  });
  assert.equal(singleRes.files.length, 1);
  assert.equal(singleRes.files[0].format, "srt");

  await assert.rejects(
    () => writeProjectSubtitles({ slug: "../escape", projectsDir: tmpRoot }),
    /invalid|unsafe/i,
  );
});

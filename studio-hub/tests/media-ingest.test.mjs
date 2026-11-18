import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import * as lib from "../lib.mjs";

const TEST_SLUG = `test-media-intel-${process.pid}-${Date.now()}`;
const TEST_PROJECT_DIR = path.join(lib.PROJECTS_DIR, TEST_SLUG);

let tempRoot = "";
let savedCurrentProjectRaw = null;
let hadCurrentProjectFile = false;

let fixtures = {
  continuousMp4: "",
  inspirationMp4: "",
  audioMp4: "",
  logoPng: "",
  brandPdf: "",
  extFolder: "",
};

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function snapshotTree(rootDir) {
  const map = new Map();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const st = fs.statSync(full);
        map.set(rel, { size: st.size, sha256: sha256File(full) });
      }
    }
  }
  walk(rootDir);
  return map;
}

before(async () => {
  hadCurrentProjectFile = fs.existsSync(lib.CURRENT_PROJECT_FILE);
  if (hadCurrentProjectFile) {
    savedCurrentProjectRaw = fs.readFileSync(lib.CURRENT_PROJECT_FILE, "utf8");
  }

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hf-media-intel-"));
  const fixtureDir = path.join(tempRoot, "fixtures");
  fs.mkdirSync(fixtureDir, { recursive: true });

  fixtures.continuousMp4 = path.join(fixtureDir, "continuous_screen.mp4");
  fixtures.inspirationMp4 = path.join(fixtureDir, "inspiration_cuts.mp4");
  fixtures.audioMp4 = path.join(fixtureDir, "with_audio.mp4");
  fixtures.logoPng = path.join(fixtureDir, "brand_logo.png");
  fixtures.brandPdf = path.join(fixtureDir, "brand_guidelines.pdf");

  // Generate real PNG, PDF, continuous MP4, and multi-cut MP4 fixtures via Python
  const genScript = path.join(fixtureDir, "make_fixtures.py");
  fs.writeFileSync(
    genScript,
    `import sys
import cv2
import numpy as np
from PIL import Image, ImageDraw
try:
    import pymupdf as fitz
except ImportError:
    import fitz

cont_mp4, insp_mp4, logo_png, brand_pdf = sys.argv[1:5]

# 1. Brand Logo PNG (emerald primary, gold accent, dark background, mint secondary)
img = Image.new("RGBA", (240, 240), (10, 22, 18, 255))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle([24, 24, 216, 176], radius=24, fill=(30, 130, 76, 255))
draw.rounded_rectangle([48, 52, 148, 128], radius=12, fill=(46, 204, 113, 255))
draw.ellipse([152, 132, 208, 188], fill=(241, 196, 15, 255))
img.save(logo_png)

# 2. Brand Guidelines PDF
doc = fitz.open()
page = doc.new_page()
text = (
    "Krishop Brand Identity Guidelines\\n"
    "Primary Color: #1E824C\\n"
    "Secondary Color: #2ECC71\\n"
    "Accent Highlight: #F1C40F\\n"
    "Dark Background: #0A1612\\n"
    "Heading Font: Space Grotesk\\n"
    "Body Font: Inter\\n"
    "Brand Tone: Confident, modern, editorial, trustworthy agricultural marketplace."
)
page.insert_text((56, 72), text, fontsize=12)
doc.save(brand_pdf)
doc.close()

# 3. Continuous single-take screen recording (7.5s @ 20fps = 150 frames, no hard cuts)
fourcc = cv2.VideoWriter_fourcc(*"mp4v")
writer = cv2.VideoWriter(cont_mp4, fourcc, 20.0, (640, 360))
for i in range(150):
    frame = np.full((360, 640, 3), (24, 28, 22), dtype=np.uint8)
    # Top nav bar
    cv2.rectangle(frame, (0, 0), (640, 44), (45, 95, 60), -1)
    # Simulated scrolling bursts in 3 distinct interaction phases
    if i < 45:
        y_off = int(i * 2)
    elif i < 95:
        y_off = 90 + int((i - 45) * 5)
    else:
        y_off = 340 - int((i - 95) * 4)
    for card in range(5):
        cy = ((card * 90 - y_off) % 420) - 40
        cv2.rectangle(frame, (60, cy), (580, cy + 68), (58, 72, 64), -1)
        cv2.rectangle(frame, (76, cy + 16), (240, cy + 36), (30, 180, 110), -1)
    cx = int(120 + 380 * (0.5 + 0.45 * np.sin(i * 0.14)))
    cy_cur = int(180 + 110 * np.cos(i * 0.11))
    cv2.circle(frame, (cx, cy_cur), 14, (15, 196, 241), -1)
    writer.write(frame)
writer.release()

# 4. Fast multi-cut inspiration video (6.0s @ 20fps = 120 frames, 4 distinct shots -> 3 hard cuts, ASL=1.5s)
writer2 = cv2.VideoWriter(insp_mp4, fourcc, 20.0, (640, 360))
shot_colors = [
    (70, 57, 230),   # crimson BGR
    (87, 53, 29),    # deep navy BGR
    (143, 157, 42),  # teal BGR
    (97, 162, 244),  # warm amber BGR
]
for i in range(120):
    shot_idx = min(3, i // 30)
    bgr = shot_colors[shot_idx]
    frame = np.full((360, 640, 3), bgr, dtype=np.uint8)
    offset = (i % 30) * 8
    cv2.rectangle(frame, (80 + offset, 70), (280 + offset, 290), (245, 245, 245), -1)
    cv2.circle(frame, (480, 180), 40 + (i % 15) * 2, (20, 20, 20), -1)
    writer2.write(frame)
writer2.release()
`,
    "utf8",
  );

  const env = { ...lib.getToolEnv(), PYTHONIOENCODING: "utf-8" };
  const pyRes = await lib.runCommand(
    "python",
    [
      genScript,
      fixtures.continuousMp4,
      fixtures.inspirationMp4,
      fixtures.logoPng,
      fixtures.brandPdf,
    ],
    { env, shell: false },
  );
  assert.equal(pyRes.code, 0, `Fixture script failed: ${pyRes.stderr}`);

  // Re-encode mp4v to standard H.264 MP4 (muted) and create an audio-bearing MP4
  const h264Cont = path.join(fixtureDir, "continuous_h264.mp4");
  const h264Insp = path.join(fixtureDir, "inspiration_h264.mp4");
  await lib.runCommand(
    "ffmpeg",
    ["-y", "-i", fixtures.continuousMp4, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", h264Cont],
    { env, shell: false },
  );
  await lib.runCommand(
    "ffmpeg",
    [
      "-y",
      "-i",
      fixtures.inspirationMp4,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      h264Insp,
    ],
    { env, shell: false },
  );
  fixtures.continuousMp4 = h264Cont;
  fixtures.inspirationMp4 = h264Insp;

  await lib.runCommand(
    "ffmpeg",
    [
      "-y",
      "-i",
      fixtures.inspirationMp4,
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-shortest",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      fixtures.audioMp4,
    ],
    { env, shell: false },
  );

  // External folder with spaces + Bengali Unicode
  fixtures.extFolder = path.join(tempRoot, "External বাংলা সোর্স Folder 2026");
  const nestedSub = path.join(fixtures.extFolder, "সাব ফোল্ডার Assets");
  fs.mkdirSync(nestedSub, { recursive: true });

  fs.copyFileSync(fixtures.continuousMp4, path.join(fixtures.extFolder, "ক্লিপ 01 raw screen.mp4"));
  fs.copyFileSync(fixtures.logoPng, path.join(fixtures.extFolder, "কৃষপ লোগো.png"));
  fs.copyFileSync(fixtures.brandPdf, path.join(nestedSub, "ব্র্যান্ড গাইডলাইন.pdf"));
  fs.writeFileSync(
    path.join(nestedSub, "brand notes নোট.md"),
    "# Brand Voice\nPrimary `#1E824C`, Font: Space Grotesk.\n",
    "utf8",
  );
  // Minimal synthetic font & wav bytes for folder scan/import verification
  fs.writeFileSync(
    path.join(nestedSub, "KrishopDisplay Regular.ttf"),
    Buffer.from("00010000", "hex"),
  );
  await lib.runCommand(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=520:duration=1",
      path.join(fixtures.extFolder, "ভয়েস sample.wav"),
    ],
    { env, shell: false },
  );
});

after(() => {
  if (fs.existsSync(TEST_PROJECT_DIR)) {
    fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
  }
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  if (hadCurrentProjectFile && savedCurrentProjectRaw !== null) {
    fs.writeFileSync(lib.CURRENT_PROJECT_FILE, savedCurrentProjectRaw, "utf8");
  }
});

test("lib.mjs exports updated CATEGORIES, studio subdirs, findChromeHeadlessShell, brand ingest, and manifest fields", async () => {
  assert.deepEqual(lib.CATEGORIES, [
    "raw-video",
    "inspiration",
    "references",
    "images",
    "brand",
    "audio",
  ]);

  assert.equal(typeof lib.findChromeHeadlessShell, "function");
  const chromePath = lib.findChromeHeadlessShell();
  if (chromePath !== null) {
    assert.ok(fs.existsSync(chromePath), "Discovered chrome-headless-shell.exe must exist");
    assert.match(path.basename(chromePath), /^chrome-headless-shell\.exe$/i);
  }
  assert.equal(lib.findChromeHeadlessShell(path.join(tempRoot, "non-existent-chrome-dir")), null);

  const mockChromeBase = path.join(tempRoot, "mock-chrome");
  for (const ver of ["win64-151.0.900.1", "win64-152.0.7928.2", "win64-152.0.10000.4"]) {
    const dir = path.join(mockChromeBase, ver, "chrome-headless-shell-win64");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "chrome-headless-shell.exe"), "stub", "utf8");
  }
  assert.ok(lib.findChromeHeadlessShell(mockChromeBase)?.includes("win64-152.0.10000.4"));

  const projectDir = lib.ensureProjectDirs(TEST_SLUG);
  for (const rel of [
    "inbox/inspiration",
    "inbox/brand",
    ".studio/frames/raw",
    ".studio/frames/inspiration",
    ".studio/frames/design",
    ".studio/frames/tmp",
    ".studio/agent-queue",
  ]) {
    assert.ok(fs.existsSync(path.join(projectDir, rel)), `Expected directory ${rel} to exist`);
  }

  // Test brand font & brand image copying into assets/fonts and assets/images
  const fontSrc = path.join(fixtures.extFolder, "সাব ফোল্ডার Assets", "KrishopDisplay Regular.ttf");
  const fontIngest = await lib.ingestLocalFile({
    slug: TEST_SLUG,
    sourcePath: fontSrc,
    category: "brand",
  });
  assert.match(fontIngest.inboxRelPath, /^inbox\/brand\/.+\.ttf$/);
  assert.match(fontIngest.assetRelPath, /^assets\/fonts\/.+\.ttf$/);
  assert.ok(fs.existsSync(path.join(projectDir, fontIngest.assetRelPath)));

  const logoIngest = await lib.ingestLocalFile({
    slug: TEST_SLUG,
    sourcePath: fixtures.logoPng,
    category: "brand",
  });
  assert.match(logoIngest.inboxRelPath, /^inbox\/brand\/.+\.png$/);
  assert.match(logoIngest.assetRelPath, /^assets\/images\/.+\.png$/);
  assert.ok(fs.existsSync(path.join(projectDir, logoIngest.assetRelPath)));

  const inspIngest = await lib.ingestLocalFile({
    slug: TEST_SLUG,
    sourcePath: fixtures.inspirationMp4,
    category: "inspiration",
  });
  assert.match(inspIngest.inboxRelPath, /^inbox\/inspiration\/.+\.mp4$/);

  const synced = await lib.syncProjectManifest(TEST_SLUG, {
    brandKit: {
      logoRelPath: logoIngest.inboxRelPath,
      guidelinesText: "Clean agricultural brand",
      fonts: { heading: "Space Grotesk" },
      extractedPalette: ["#1E824C", "#2ECC71", "#F1C40F", "#0A1612", "#14261E"],
    },
    inspirationProfile: {
      avgShotLength: 1.5,
      cutsPerMinute: 30,
      pacing: "fast-kinetic",
      dominantColors: ["#E63946", "#1D3557", "#2A9D8F", "#F4A261", "#F5F5F5"],
      styleFrames: [],
      brightness: 52,
      contrast: 48,
    },
    sourceFolders: ["C:\\Example\\Folder"],
  });

  assert.equal(synced.brandKit.logoRelPath, logoIngest.inboxRelPath);
  assert.equal(synced.brandKit.fonts.heading, "Space Grotesk");
  assert.equal(synced.brandKit.fonts.body, "Inter");
  assert.equal(synced.brandKit.tone, "Confident & Modern");
  assert.equal(synced.brandKit.extractedPalette.length, 5);
  assert.equal(synced.inspirationProfile?.pacing, "fast-kinetic");
  assert.deepEqual(synced.sourceFolders, ["C:\\Example\\Folder"]);
  assert.equal(synced.files.inspiration.length, 1);
  assert.equal(synced.files.brand.length, 2);

  // Re-sync without patch must persist merged fields
  const persisted = await lib.syncProjectManifest(TEST_SLUG);
  assert.equal(persisted.brandKit.fonts.heading, "Space Grotesk");
  assert.equal(persisted.inspirationProfile?.pacing, "fast-kinetic");
  assert.deepEqual(persisted.sourceFolders, ["C:\\Example\\Folder"]);
});

test("folder-ingest.mjs scans & imports external folders with spaces and Bengali Unicode non-destructively", async () => {
  const folderMod = await import("../folder-ingest.mjs");
  const beforeSnapshot = snapshotTree(fixtures.extFolder);

  const topOnly = await folderMod.scanExternalFolder(fixtures.extFolder, { recursive: false });
  assert.equal(topOnly.totalFiles, 3);
  assert.equal(topOnly.counts.video, 1);
  assert.equal(topOnly.counts.image, 1);
  assert.equal(topOnly.counts.audio, 1);

  const scanned = await folderMod.scanExternalFolder(fixtures.extFolder, { recursive: true });
  assert.equal(scanned.folderPath, path.resolve(fixtures.extFolder));
  assert.equal(scanned.totalFiles, 6);
  assert.deepEqual(scanned.counts, {
    video: 1,
    image: 1,
    audio: 1,
    brandDoc: 2,
    font: 1,
  });
  assert.equal(scanned.files.length, 6);

  const importRes = await folderMod.importExternalFolder({
    slug: TEST_SLUG,
    folderPath: fixtures.extFolder,
    category: "raw-video",
    recursive: true,
  });

  assert.equal(importRes.importedCount, 1);
  assert.equal(importRes.importedFiles.length, 1);
  assert.equal(importRes.sourceFolder, fixtures.extFolder);
  assert.ok(importRes.manifest.sourceFolders.includes(fixtures.extFolder));

  // Also test brand folder import with selectedFiles subset
  const brandImport = await folderMod.importExternalFolder({
    slug: TEST_SLUG,
    folderPath: fixtures.extFolder,
    category: "brand",
    selectedFiles: [
      "কৃষপ লোগো.png",
      "সাব ফোল্ডার Assets/ব্র্যান্ড গাইডলাইন.pdf",
      "সাব ফোল্ডার Assets/KrishopDisplay Regular.ttf",
    ],
    recursive: true,
  });
  assert.equal(brandImport.importedCount, 3);
  assert.equal(
    brandImport.manifest.sourceFolders.filter((f) => f === fixtures.extFolder).length,
    1,
    "sourceFolders should deduplicate repeated imports",
  );

  // Verify external folder was NEVER modified, deleted, or touched
  const afterSnapshot = snapshotTree(fixtures.extFolder);
  assert.deepEqual([...afterSnapshot.entries()], [...beforeSnapshot.entries()]);
});

test("media_intelligence.py analyze-raw segments continuous video and writes start/peak/end keyframes", async () => {
  const { runMediaIntelligence } = await import("../folder-ingest.mjs");
  const outDir = path.join(TEST_PROJECT_DIR, ".studio", "frames", "raw");

  const res = await runMediaIntelligence("analyze-raw", [
    "--video",
    fixtures.continuousMp4,
    "--out-dir",
    outDir,
    "--target-scenes",
    "5",
  ]);

  assert.equal(res.ok, true);
  assert.ok(res.duration >= 6.5, `Expected duration >= 6.5s, got ${res.duration}`);
  assert.equal(res.width, 640);
  assert.equal(res.height, 360);
  assert.ok(
    res.scenes.length >= 3 && res.scenes.length <= 5,
    `Expected 3..5 scenes for >=6s continuous recording, got ${res.scenes.length}`,
  );

  for (const scene of res.scenes) {
    assert.ok(scene.index >= 1);
    assert.ok(scene.endTime > scene.startTime);
    assert.ok(scene.duration > 0);
    assert.equal(typeof scene.motionScore, "number");
    assert.equal(scene.dominantColors.length, 5);
    for (const hex of scene.dominantColors) {
      assert.match(hex, /^#[0-9A-Fa-f]{6}$/);
    }
    for (const role of ["start", "peak", "end"]) {
      const kfPath = scene.keyframes[role];
      assert.ok(kfPath && fs.existsSync(kfPath), `Missing keyframe ${role}: ${kfPath}`);
      assert.ok(fs.statSync(kfPath).size > 200, `Keyframe ${kfPath} looks empty`);
    }
  }
  assert.ok(fs.existsSync(path.join(outDir, "scene_01_start.png")));
  assert.ok(fs.existsSync(path.join(outDir, "scene_01_peak.png")));
  assert.ok(fs.existsSync(path.join(outDir, "scene_01_end.png")));
});

test("media_intelligence.py analyze-inspiration detects cuts, pacing, colors, and style frames", async () => {
  const { runMediaIntelligence } = await import("../folder-ingest.mjs");
  const outDir = path.join(TEST_PROJECT_DIR, ".studio", "frames", "inspiration");

  const res = await runMediaIntelligence("analyze-inspiration", [
    "--video",
    fixtures.inspirationMp4,
    "--out-dir",
    outDir,
  ]);

  assert.equal(res.ok, true);
  assert.equal(res.width, 640);
  assert.equal(res.height, 360);
  assert.ok(res.cutCount >= 2, `Expected >=2 cuts, got ${res.cutCount}`);
  assert.ok(res.avgShotLength < 2.5, `Expected ASL < 2.5s, got ${res.avgShotLength}`);
  assert.ok(res.cutsPerMinute > 15);
  assert.equal(res.pacing, "fast-kinetic");
  assert.ok(res.brightness >= 0 && res.brightness <= 100);
  assert.ok(res.contrast >= 0 && res.contrast <= 100);
  assert.equal(res.dominantColors.length, 5);
  for (const hex of res.dominantColors) {
    assert.match(hex, /^#[0-9A-Fa-f]{6}$/);
  }
  assert.ok(fs.existsSync(path.join(outDir, "insp_01.png")));
});

test("media_intelligence.py extract-brand & transcribe handle logo, PDF, text, muted and audio clips", async () => {
  const { runMediaIntelligence } = await import("../folder-ingest.mjs");

  const brand = await runMediaIntelligence("extract-brand", [
    "--logo",
    fixtures.logoPng,
    "--doc",
    fixtures.brandPdf,
    "--text",
    "Extra highlight #FF6B35 with playful vibe",
  ]);

  assert.equal(brand.ok, true);
  for (const key of ["primary", "secondary", "accent", "background", "surface"]) {
    assert.match(brand.colors[key], /^#[0-9A-Fa-f]{6}$/, `Invalid ${key} color`);
  }
  assert.ok(brand.hexCodes.includes("#1E824C"));
  assert.ok(brand.hexCodes.includes("#F1C40F"));
  assert.ok(brand.hexCodes.includes("#FF6B35"));
  assert.ok(brand.fontMentions.includes("Space Grotesk"));
  assert.ok(brand.fontMentions.includes("Inter"));
  assert.ok(brand.toneKeywords.includes("confident"));
  assert.ok(brand.toneKeywords.includes("modern"));
  assert.ok(brand.summary.length > 20);

  const mutedTx = await runMediaIntelligence("transcribe", ["--media", fixtures.continuousMp4]);
  assert.equal(mutedTx.ok, true);
  assert.equal(mutedTx.hasSpeech, false);
  assert.deepEqual(mutedTx.segments, []);

  const audioTx = await runMediaIntelligence("transcribe", ["--media", fixtures.audioMp4]);
  assert.equal(audioTx.ok, true);
  assert.ok(Array.isArray(audioTx.segments));
});

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PROJECTS_DIR, ensureProjectDirs } from "../lib.mjs";
import { generateStoryboard, loadStoryboard } from "../storyboard.mjs";
import { listAgentTasks } from "../agent-bridge.mjs";
import {
  analyzeAnnotationRegion,
  saveFrameAnnotation,
  regenerateFrameRegion,
  saveDesignFrameBookmark,
  listSavedFrames,
  deleteSavedFrame,
  restoreSavedFrame,
} from "../frame-inpaint.mjs";

const TEST_SLUG = `test-frame-inpaint-${process.pid}`;
const TEST_PROJECT_DIR = path.join(PROJECTS_DIR, TEST_SLUG);

function createSolidPngBuffer(width, height, [r, g, b]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowLen;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 3;
      raw[px] = (r + (x % 40)) & 0xff;
      raw[px + 1] = (g + (y % 40)) & 0xff;
      raw[px + 2] = b & 0xff;
    }
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function makePngDataUrl(width = 64, height = 64, rgb = [255, 255, 255]) {
  const buf = createSolidPngBuffer(width, height, rgb);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function assertValidPng(absPath, minBytes = 64) {
  assert.equal(fs.existsSync(absPath), true, `Expected PNG file at ${absPath}`);
  const stat = fs.statSync(absPath);
  assert.ok(stat.size >= minBytes, `Expected PNG >= ${minBytes}B, got ${stat.size}B at ${absPath}`);
  const header = fs.readFileSync(absPath).subarray(0, 8);
  assert.deepEqual(
    [...header],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `Invalid PNG header: ${absPath}`,
  );
}

before(() => {
  ensureProjectDirs(TEST_SLUG);
  const rawFramesDir = path.join(TEST_PROJECT_DIR, ".studio", "frames", "raw");
  fs.mkdirSync(rawFramesDir, { recursive: true });
  for (let s = 1; s <= 2; s += 1) {
    const idx = String(s).padStart(2, "0");
    fs.writeFileSync(
      path.join(rawFramesDir, `scene_${idx}_start.png`),
      createSolidPngBuffer(320, 568, [24, 118, 72]),
    );
    fs.writeFileSync(
      path.join(rawFramesDir, `scene_${idx}_peak.png`),
      createSolidPngBuffer(320, 568, [38, 158, 96]),
    );
    fs.writeFileSync(
      path.join(rawFramesDir, `scene_${idx}_end.png`),
      createSolidPngBuffer(320, 568, [212, 160, 24]),
    );
  }
});

after(() => {
  fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
});

test("analyzeAnnotationRegion classifies all 6 semantic zones and computes normalized bounds + arrow camera vectors", () => {
  // 1. badge-header (centerY < 0.22) from pixel brush strokes on 1080x1920
  const headerRes = analyzeAnnotationRegion({
    canvasWidth: 1080,
    canvasHeight: 1920,
    strokes: [
      {
        tool: "brush",
        color: "#E03E3E",
        points: [
          { x: 216, y: 144 },
          { x: 648, y: 288 },
        ],
      },
    ],
  });
  assert.equal(headerRes.zone, "badge-header");
  assert.ok(Math.abs(headerRes.x - 0.2) < 0.001);
  assert.ok(Math.abs(headerRes.y - 0.075) < 0.001);
  assert.ok(Math.abs(headerRes.width - 0.4) < 0.001);
  assert.ok(Math.abs(headerRes.height - 0.075) < 0.001);
  assert.ok(headerRes.centerY < 0.22);

  // 2. caption-lower-third (centerY > 0.76) from explicit regionBox
  const lowerRes = analyzeAnnotationRegion({
    canvasWidth: 1080,
    canvasHeight: 1920,
    regionBox: { x: 108, y: 1536, width: 864, height: 240 },
  });
  assert.equal(lowerRes.zone, "caption-lower-third");
  assert.ok(lowerRes.centerY > 0.76);
  assert.ok(Math.abs(lowerRes.x - 0.1) < 0.001);
  assert.ok(Math.abs(lowerRes.width - 0.8) < 0.001);

  // 3. callout-left (centerX < 0.36 and 0.22 <= centerY <= 0.76)
  const leftRes = analyzeAnnotationRegion({
    canvasWidth: 1080,
    canvasHeight: 1920,
    strokes: [
      {
        tool: "box",
        color: "#2563EB",
        points: [
          { x: 54, y: 768 },
          { x: 324, y: 1056 },
        ],
      },
    ],
  });
  assert.equal(leftRes.zone, "callout-left");
  assert.ok(leftRes.centerX < 0.36);
  assert.ok(leftRes.centerY >= 0.22 && leftRes.centerY <= 0.76);

  // 4. callout-right (centerX > 0.64 and 0.22 <= centerY <= 0.76) via normalized 0..1 pin
  const rightRes = analyzeAnnotationRegion({
    strokes: [
      {
        tool: "pin",
        label: "Add free delivery badge",
        color: "#D97706",
        points: [{ x: 0.82, y: 0.48 }],
      },
    ],
  });
  assert.equal(rightRes.zone, "callout-right");
  assert.ok(rightRes.centerX > 0.64);
  assert.ok(rightRes.centerY >= 0.22 && rightRes.centerY <= 0.76);

  // 5. center-subject (0.30 <= centerX <= 0.70 and 0.22 <= centerY <= 0.76)
  const centerRes = analyzeAnnotationRegion({
    canvasWidth: 1080,
    canvasHeight: 1920,
    strokes: [
      {
        tool: "brush",
        points: [
          { x: 432, y: 768 },
          { x: 648, y: 1152 },
        ],
      },
    ],
  });
  assert.equal(centerRes.zone, "center-subject");
  assert.ok(Math.abs(centerRes.centerX - 0.5) < 0.001);
  assert.ok(Math.abs(centerRes.centerY - 0.5) < 0.001);

  // 6. motion-trajectory (drawn arrow from (0.25, 0.70) -> (0.75, 0.30))
  const arrowRes = analyzeAnnotationRegion({
    canvasWidth: 1080,
    canvasHeight: 1920,
    strokes: [
      {
        tool: "arrow",
        color: "#2563EB",
        points: [
          { x: 270, y: 1344 },
          { x: 810, y: 576 },
        ],
      },
    ],
  });
  assert.equal(arrowRes.zone, "motion-trajectory");
  assert.ok(Math.abs(arrowRes.dx - 0.5) < 0.001);
  assert.ok(Math.abs(arrowRes.dy - -0.4) < 0.001);
  assert.ok(Math.abs(arrowRes.magnitude - Math.hypot(0.5, -0.4)) < 0.002);
  assert.ok(arrowRes.angleDeg < -38 && arrowRes.angleDeg > -39);
  assert.equal(arrowRes.focusX, 75);
  assert.equal(arrowRes.focusY, 30);
  assert.ok(arrowRes.panX > 0);
  assert.ok(arrowRes.panY < 0);
  assert.ok(arrowRes.arrowVector);
  assert.equal(arrowRes.arrowVector.focusX, 75);
  assert.equal(arrowRes.arrowVector.focusY, 30);

  // 7. Empty input fallback
  const emptyRes = analyzeAnnotationRegion();
  assert.equal(emptyRes.zone, "center-subject");
  assert.equal(emptyRes.hasDrawing, false);
  assert.equal(emptyRes.arrowVector, null);
  assert.equal(emptyRes.centerX, 0.5);
  assert.equal(emptyRes.centerY, 0.5);
});

test("saveFrameAnnotation decodes base64 mask & composite PNGs to disk and records annotations.json", () => {
  const maskDataUrl = makePngDataUrl(90, 160, [255, 255, 255]);
  const compositeDataUrl = makePngDataUrl(90, 160, [224, 62, 62]);

  const saved = saveFrameAnnotation({
    slug: TEST_SLUG,
    frameId: "frame_01",
    maskDataUrl,
    compositeDataUrl,
    strokes: [
      {
        tool: "brush",
        color: "#E03E3E",
        points: [
          { x: 180, y: 140 },
          { x: 620, y: 260 },
        ],
      },
    ],
    prompt: 'Badge "ORGANIC HARVEST"',
  });

  assert.ok(saved.annotationId.startsWith("ann_"));
  assert.match(
    saved.maskRelPath,
    /^\.studio\/frames\/annotations\/frame_01_ann_[a-z0-9_]+_mask\.png$/,
  );
  assert.match(
    saved.compositeRelPath,
    /^\.studio\/frames\/annotations\/frame_01_ann_[a-z0-9_]+_annotated\.png$/,
  );
  assert.equal(saved.regionAnalysis.zone, "badge-header");

  assertValidPng(path.join(TEST_PROJECT_DIR, saved.maskRelPath));
  assertValidPng(path.join(TEST_PROJECT_DIR, saved.compositeRelPath));

  const annJsonPath = path.join(TEST_PROJECT_DIR, ".studio", "annotations.json");
  assert.equal(fs.existsSync(annJsonPath), true);
  const annStore = JSON.parse(fs.readFileSync(annJsonPath, "utf8"));
  assert.equal(Array.isArray(annStore.annotations), true);
  assert.equal(annStore.annotations.length, 1);
  assert.equal(annStore.annotations[0].annotationId, saved.annotationId);
  assert.equal(annStore.annotations[0].prompt, 'Badge "ORGANIC HARVEST"');

  // Reject path traversal in frameId or slug
  assert.throws(() => {
    saveFrameAnnotation({
      slug: TEST_SLUG,
      frameId: "../escape",
      maskDataUrl,
    });
  }, /Invalid frameId/i);

  // Reject corrupt PNG data URL
  assert.throws(() => {
    saveFrameAnnotation({
      slug: TEST_SLUG,
      frameId: "frame_01",
      maskDataUrl: "data:image/png;base64,bm90LWEtcG5n",
    });
  }, /PNG magic header/i);

  // Strokes-only annotation (null data URLs) succeeds cleanly
  const strokesOnly = saveFrameAnnotation({
    slug: TEST_SLUG,
    frameId: "frame_01",
    strokes: [{ tool: "pin", label: "Check logo", points: [{ x: 0.5, y: 0.1 }] }],
  });
  assert.equal(strokesOnly.maskRelPath, null);
  assert.equal(strokesOnly.compositeRelPath, null);
  assert.equal(strokesOnly.regionAnalysis.zone, "badge-header");
});

test("regenerateFrameRegion performs surgical regional updates (v1 -> v2 -> v3 -> v4) preserving untouched fields and rendering real 1080p PNGs", async () => {
  const sbInitial = await generateStoryboard({
    slug: TEST_SLUG,
    projectBrief: {
      slug: TEST_SLUG,
      title: "Krishop Seed Launch",
      aspectRatio: "9:16",
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 10,
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#F1C40F",
        background: "#0A1612",
      },
    },
    rawAnalysis: {
      ok: true,
      duration: 10,
      scenes: [
        {
          index: 1,
          startTime: 0,
          endTime: 5,
          title: "Winter Seed Offer",
          keyframes: {
            start: ".studio/frames/raw/scene_01_start.png",
            peak: ".studio/frames/raw/scene_01_peak.png",
            end: ".studio/frames/raw/scene_01_end.png",
          },
        },
        {
          index: 2,
          startTime: 5,
          endTime: 10,
          title: "5 Seed Varieties",
          keyframes: {
            start: ".studio/frames/raw/scene_02_start.png",
            peak: ".studio/frames/raw/scene_02_peak.png",
            end: ".studio/frames/raw/scene_02_end.png",
          },
        },
      ],
    },
    targetScenes: 2,
  });

  assert.equal(sbInitial.frames.length, 2);
  const f1v1 = structuredClone(sbInitial.frames[0]);
  const f2v1 = structuredClone(sbInitial.frames[1]);
  assert.equal(f1v1.currentVersion, 1);

  const maskDataUrl = makePngDataUrl(90, 160, [255, 255, 255]);
  const compositeDataUrl = makePngDataUrl(90, 160, [224, 62, 62]);

  // 1. Surgical badge-header update on frame_01 (v1 -> v2)
  // Include words like "card" and "50%" that would mutate layout/zoom if non-surgical!
  const rBadge = await regenerateFrameRegion({
    slug: TEST_SLUG,
    frameId: "frame_01",
    maskDataUrl,
    compositeDataUrl,
    strokes: [
      {
        tool: "brush",
        color: "#D97706",
        points: [
          { x: 180, y: 120 },
          { x: 640, y: 240 },
        ],
      },
    ],
    prompt: 'Replace badge with "50% STORM CARD"',
    selectedSkills: ["minimalist-ui"],
  });

  assert.equal(rBadge.regionAnalysis.zone, "badge-header");
  assert.equal(rBadge.frame.currentVersion, 2);
  assert.equal(rBadge.frame.history.length, 2);
  assert.equal(rBadge.frame.staging.badgeText, "50% STORM CARD");
  // Untouched regions MUST remain identical to v1:
  assert.equal(rBadge.frame.layout, f1v1.layout);
  assert.equal(rBadge.frame.motionPreset, f1v1.motionPreset);
  assert.deepEqual(rBadge.frame.cameraMotion, f1v1.cameraMotion);
  assert.equal(rBadge.frame.staging.headline, f1v1.staging.headline);
  assert.equal(rBadge.frame.staging.subheadline, f1v1.staging.subheadline);
  assert.equal(rBadge.frame.staging.captionText, f1v1.staging.captionText);
  assertValidPng(path.join(TEST_PROJECT_DIR, f1v1.designFramePath), 10 * 1024);
  assertValidPng(path.join(TEST_PROJECT_DIR, rBadge.frame.designFramePath), 10 * 1024);
  assertValidPng(path.join(TEST_PROJECT_DIR, rBadge.frame.hudFramePath), 10 * 1024);

  // 2. Surgical caption-lower-third update on frame_01 (v2 -> v3)
  const rLower = await regenerateFrameRegion({
    slug: TEST_SLUG,
    frameId: "frame_01",
    maskDataUrl,
    compositeDataUrl,
    regionBox: { x: 80, y: 1560, width: 920, height: 260 },
    prompt:
      'Headline "Direct Wholesale Delivery" subline "Zero transport loss across 64 districts"',
  });

  assert.equal(rLower.regionAnalysis.zone, "caption-lower-third");
  assert.equal(rLower.frame.currentVersion, 3);
  assert.equal(rLower.frame.staging.headline, "Direct Wholesale Delivery");
  assert.equal(rLower.frame.staging.subheadline, "Zero transport loss across 64 districts");
  assert.equal(rLower.frame.staging.subline, "Zero transport loss across 64 districts");
  // Badge, layout, and camera from v2 MUST remain untouched:
  assert.equal(rLower.frame.staging.badgeText, "50% STORM CARD");
  assert.equal(rLower.frame.layout, f1v1.layout);
  assert.deepEqual(rLower.frame.cameraMotion, f1v1.cameraMotion);
  assertValidPng(path.join(TEST_PROJECT_DIR, rLower.frame.designFramePath), 10 * 1024);

  // 3. Surgical callout-right update on frame_01 (v3 -> v4)
  const rCallout = await regenerateFrameRegion({
    slug: TEST_SLUG,
    frameId: "frame_01",
    maskDataUrl,
    compositeDataUrl,
    strokes: [
      {
        tool: "box",
        color: "#2563EB",
        points: [
          { x: 756, y: 864 },
          { x: 1026, y: 1056 },
        ],
      },
    ],
    prompt: "Free Delivery on 5000 BDT",
  });

  assert.equal(rCallout.regionAnalysis.zone, "callout-right");
  assert.equal(rCallout.frame.currentVersion, 4);
  assert.equal(rCallout.frame.staging.calloutCard.side, "right");
  assert.equal(rCallout.frame.staging.calloutCard.text, "Free Delivery on 5000 BDT");
  assert.ok(
    Math.abs(rCallout.frame.staging.spotlightTarget.x - rCallout.regionAnalysis.centerX) < 0.001,
  );
  assert.ok(
    Math.abs(rCallout.frame.staging.spotlightTarget.y - rCallout.regionAnalysis.centerY) < 0.001,
  );
  // Badge, lower-third headline, layout, and camera pan/scale remain untouched:
  assert.equal(rCallout.frame.staging.badgeText, "50% STORM CARD");
  assert.equal(rCallout.frame.staging.headline, "Direct Wholesale Delivery");
  assert.equal(rCallout.frame.layout, f1v1.layout);
  assert.equal(rCallout.frame.cameraMotion.toScale, f1v1.cameraMotion.toScale);

  // 3b. Surgical callout-left update on frame_01 (v4 -> v5) syncing calloutItems[0] & 0..100 cursorTarget
  const rCalloutLeft = await regenerateFrameRegion({
    slug: TEST_SLUG,
    frameId: "frame_01",
    strokes: [
      {
        tool: "pin",
        label: "Verified germination 98%",
        color: "#10B981",
        points: [{ x: 216, y: 960 }],
      },
    ],
    prompt: "",
  });
  assert.equal(rCalloutLeft.regionAnalysis.zone, "callout-left");
  assert.equal(rCalloutLeft.frame.currentVersion, 5);
  assert.equal(rCalloutLeft.frame.staging.calloutCard.side, "left");
  assert.equal(rCalloutLeft.frame.staging.calloutCard.text, "Verified germination 98%");
  assert.equal(rCalloutLeft.frame.staging.calloutItems[0].value, "Verified germination 98%");
  assert.equal(rCalloutLeft.frame.staging.calloutItems[1].value, "Free Delivery on 5000 BDT");
  assert.equal(rCalloutLeft.frame.staging.cursorTarget.x, 20);
  assert.equal(rCalloutLeft.frame.staging.cursorTarget.y, 50);
  assert.equal(rCalloutLeft.frame.staging.badgeText, "50% STORM CARD");
  assert.equal(rCalloutLeft.frame.staging.headline, "Direct Wholesale Delivery");

  // 4. Surgical motion-trajectory arrow update on frame_02 (v1 -> v2)
  const rArrow = await regenerateFrameRegion({
    slug: TEST_SLUG,
    frameId: "frame_02",
    maskDataUrl,
    compositeDataUrl,
    strokes: [
      {
        tool: "arrow",
        color: "#2563EB",
        points: [
          { x: 216, y: 1440 },
          { x: 864, y: 480 },
        ],
      },
    ],
    prompt: "Glide camera along arrow toward top-right seed pack",
  });

  assert.equal(rArrow.regionAnalysis.zone, "motion-trajectory");
  assert.equal(rArrow.frame.currentVersion, 2);
  assert.equal(rArrow.frame.cameraMotion.focusX, 80);
  assert.equal(rArrow.frame.cameraMotion.focusY, 25);
  assert.ok(rArrow.frame.cameraMotion.panX > 0);
  assert.ok(rArrow.frame.cameraMotion.panY < 0);
  // Copy & layout on frame_02 remain untouched:
  assert.equal(rArrow.frame.layout, f2v1.layout);
  assert.equal(rArrow.frame.staging.badgeText, f2v1.staging.badgeText);
  assert.equal(rArrow.frame.staging.headline, f2v1.staging.headline);
  assert.equal(rArrow.frame.staging.captionText, f2v1.staging.captionText);

  // 5. Surgical center-subject update + enqueueAiInpaint: true on frame_02 (v2 -> v3)
  const rCenter = await regenerateFrameRegion({
    slug: TEST_SLUG,
    frameId: "frame_02",
    maskDataUrl,
    compositeDataUrl,
    strokes: [
      {
        tool: "brush",
        color: "#E03E3E",
        points: [
          { x: 432, y: 768 },
          { x: 648, y: 1152 },
        ],
      },
    ],
    prompt: "Zoom 190% spotlight botanical seed packet",
    selectedSkills: ["oversized-cursor"],
    enqueueAiInpaint: true,
  });

  assert.equal(rCenter.regionAnalysis.zone, "center-subject");
  assert.equal(rCenter.frame.currentVersion, 3);
  assert.equal(rCenter.frame.cameraMotion.toScale, 1.9);
  assert.equal(rCenter.frame.cameraMotion.focusX, 50);
  assert.equal(rCenter.frame.cameraMotion.focusY, 50);
  assert.ok(rCenter.frame.staging.subjectOverlay);
  assert.equal(rCenter.frame.staging.badgeText, f2v1.staging.badgeText);
  assert.equal(rCenter.frame.staging.headline, f2v1.staging.headline);

  assert.ok(rCenter.ticket);
  assert.equal(rCenter.ticket.type, "ai_regenerate_frame");
  assert.equal(rCenter.ticket.payload.maskRelPath, rCenter.maskRelPath);
  assert.equal(rCenter.ticket.payload.compositeRelPath, rCenter.compositeRelPath);
  assert.equal(rCenter.ticket.payload.regionAnalysis.zone, "center-subject");

  const projectTickets = listAgentTasks(TEST_SLUG);
  assert.equal(
    projectTickets.some((t) => t.id === rCenter.ticket.id),
    true,
  );
});

test("Saved Design Frames Vault CRUD persists PNGs across scene rebuilds and supports restoration", async () => {
  // Bookmark frame_01 v1 (historical version) and frame_02 v3 (latest)
  const bm1 = saveDesignFrameBookmark({
    slug: TEST_SLUG,
    frameId: "frame_01",
    version: 1,
    label: "Clean Hook v1",
    notes: "Original baseline frame",
  });
  const bm2 = saveDesignFrameBookmark({
    slug: TEST_SLUG,
    frameId: "frame_02",
    version: 3,
    label: "Seed Spotlight v3",
    notes: "190% zoom center subject",
  });

  assert.ok(bm1.id.startsWith("sf_"));
  assert.equal(bm1.savedId, bm1.id);
  assert.equal(bm1.version, 1);
  assert.equal(bm1.label, "Clean Hook v1");
  assert.match(bm1.imageRelPath, /^\.studio\/frames\/saved\/sf_[a-z0-9_]+\.png$/);
  assertValidPng(path.join(TEST_PROJECT_DIR, bm1.imageRelPath), 10 * 1024);
  assertValidPng(path.join(TEST_PROJECT_DIR, bm2.imageRelPath), 10 * 1024);

  const vaultList = listSavedFrames(TEST_SLUG);
  assert.equal(Array.isArray(vaultList), true);
  assert.equal(vaultList.length, 2);
  assert.equal(vaultList[0].id, bm1.id);
  assert.equal(vaultList[1].id, bm2.id);

  // Rebuild storyboard down to 1 scene (deleting frame_02 from STORYBOARD.json!)
  const rebuilt = await generateStoryboard({
    slug: TEST_SLUG,
    targetScenes: 1,
    preserveLocked: false,
  });
  assert.equal(rebuilt.frames.length, 1);
  assert.equal(
    rebuilt.frames.some((f) => f.id === "frame_02"),
    false,
  );

  // Saved frames in vault MUST still exist permanently on disk and remain restorable!
  const afterRebuildList = listSavedFrames(TEST_SLUG);
  assert.equal(afterRebuildList.length, 2);
  assertValidPng(path.join(TEST_PROJECT_DIR, bm2.imageRelPath), 10 * 1024);

  const restored = await restoreSavedFrame({
    slug: TEST_SLUG,
    savedId: bm2.id,
  });
  assert.ok(restored.frame);
  assert.equal(restored.frame.id, "frame_02");
  const sbAfterRestore = loadStoryboard(TEST_SLUG);
  assert.equal(
    sbAfterRestore.frames.some((f) => f.id === "frame_02"),
    true,
  );

  // Delete bm1 and confirm its PNG and JSON record are removed while bm2 stays intact
  const remaining = deleteSavedFrame(TEST_SLUG, bm1.id);
  assert.equal(Array.isArray(remaining), true);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, bm2.id);
  assert.equal(fs.existsSync(path.join(TEST_PROJECT_DIR, bm1.imageRelPath)), false);
  assertValidPng(path.join(TEST_PROJECT_DIR, bm2.imageRelPath), 10 * 1024);

  // Positional overload & traversal guard check
  const bmPositional = saveDesignFrameBookmark(TEST_SLUG, {
    frameId: "frame_01",
    label: "Positional Bookmark",
  });
  assert.equal(bmPositional.savedFrame.id, bmPositional.id);
  assert.equal(bmPositional.savedFrames.length, 2);

  assert.throws(() => {
    deleteSavedFrame(TEST_SLUG, "../bad");
  }, /Invalid savedId/i);
});

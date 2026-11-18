import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PROJECTS_DIR, ensureProjectDirs } from "../lib.mjs";
import { saveStoryboard } from "../storyboard.mjs";
import {
  THUMBNAIL_AB_STRATEGIES,
  renderThumbnailVariantHtml,
  generateThumbnailAbVariants,
} from "../thumbnail-ab-gen.mjs";

const TEST_SLUG = `test-thumb-ab-${process.pid}`;
const TEST_PROJECT_DIR = path.join(PROJECTS_DIR, TEST_SLUG);

function createTestGradientPng(width, height, [r0, g0, b0]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

  function chunk(type, data) {
    const t = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowBytes;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowOffset + 1 + x * 3;
      raw[px] = (r0 + Math.floor((x / width) * 110)) & 0xff;
      raw[px + 1] = (g0 + Math.floor((y / height) * 95)) & 0xff;
      raw[px + 2] = (b0 + Math.floor(((x + y) / (width + height)) * 90)) & 0xff;
    }
  }

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function readPngMeta(absPath) {
  assert.equal(fs.existsSync(absPath), true, `Expected PNG file at ${absPath}`);
  const buf = fs.readFileSync(absPath);
  assert.ok(buf.length > 15 * 1024, `Expected PNG > 15KB, got ${buf.length} bytes at ${absPath}`);
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(buf.subarray(12, 16).toString("ascii"), "IHDR");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { sizeBytes: buf.length, width, height, buf };
}

before(() => {
  ensureProjectDirs(TEST_SLUG);
  const rawDir = path.join(TEST_PROJECT_DIR, ".studio", "frames", "raw");
  const assetsImgDir = path.join(TEST_PROJECT_DIR, "assets", "images");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(assetsImgDir, { recursive: true });

  fs.writeFileSync(
    path.join(rawDir, "scene_01_peak.png"),
    createTestGradientPng(480, 854, [24, 130, 76]),
  );
  fs.writeFileSync(
    path.join(rawDir, "scene_02_peak.png"),
    createTestGradientPng(480, 854, [42, 98, 175]),
  );
  fs.writeFileSync(
    path.join(assetsImgDir, "brand_logo.png"),
    createTestGradientPng(160, 160, [241, 196, 15]),
  );

  const brief = {
    slug: TEST_SLUG,
    title: "Krishop (কৃষপ) Fresh Harvest",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 18,
    language: "Bengali",
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#F1C40F",
      background: "#0A1612",
    },
    files: {
      assetImages: [{ name: "brand_logo.png", relPath: "assets/images/brand_logo.png" }],
    },
  };
  fs.writeFileSync(
    path.join(TEST_PROJECT_DIR, "PROJECT_BRIEF.json"),
    JSON.stringify(brief, null, 2),
    "utf8",
  );

  saveStoryboard(TEST_SLUG, {
    title: brief.title,
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    brandColors: brief.brandColors,
    frames: [
      {
        id: "frame_01",
        index: 1,
        title: "৪০% ঝড়ো ছাড় — তাজা বীজ ও সার",
        layout: "device-3d-showcase",
        motionPreset: "crash-zoom-in",
        durationSeconds: 5,
        speedFactor: 1,
        keyframes: {
          start: ".studio/frames/raw/scene_01_peak.png",
          peak: ".studio/frames/raw/scene_01_peak.png",
          end: ".studio/frames/raw/scene_01_peak.png",
        },
        staging: {
          headline: "৪০% ঝড়ো ছাড় — তাজা বীজ ও সার",
          subheadline: "ঘরে বসেই অর্ডার করুন সেরা কৃষি পণ্য",
          badgeText: "STORM OFFER",
          ctaText: "এখনই কিনুন",
        },
      },
      {
        id: "frame_02",
        index: 2,
        title: "Fast 60-Minute Delivery",
        layout: "spotlight-cursor-zoom",
        motionPreset: "spotlight-cursor-follow",
        cameraMotion: { focusX: 58, focusY: 54 },
        durationSeconds: 6,
        speedFactor: 1.5,
        keyframes: {
          start: ".studio/frames/raw/scene_02_peak.png",
          peak: ".studio/frames/raw/scene_02_peak.png",
          end: ".studio/frames/raw/scene_02_peak.png",
        },
        staging: {
          headline: "One-Tap Express Checkout",
          subheadline: "Verified organic farm catalog with live tracking",
          badgeText: "FREE DELIVERY",
          ctaText: "Order Now",
        },
      },
    ],
  });
});

after(() => {
  fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
});

test("exports THUMBNAIL_AB_STRATEGIES and escapes multilingual HTML safely", () => {
  assert.equal(THUMBNAIL_AB_STRATEGIES.length, 3);
  assert.deepEqual(
    THUMBNAIL_AB_STRATEGIES.map((s) => s.filename),
    ["variant_a_hook.png", "variant_b_split.png", "variant_c_spotlight.png"],
  );

  for (const strat of THUMBNAIL_AB_STRATEGIES) {
    const html = renderThumbnailVariantHtml({
      variantId: strat.id,
      brief: {
        slug: TEST_SLUG,
        title: 'Krishop <script>alert("xss")</script> ताज़ा फसल',
        width: 1920,
        height: 1080,
        brandColors: {
          primary: "#1E824C",
          secondary: "#2ECC71",
          accent: "#F1C40F",
          background: "#0A1612",
        },
      },
      frame: {
        title: "বাংলা ও हिन्दी Hook",
        staging: {
          headline: 'Save 50% <img src=x onerror="1">',
          subheadline: "তাড়াতাড়ি অর্ডার করুন · तेज़ डिलीवरी",
          badgeText: "LIMITED DEAL",
        },
      },
    });

    assert.ok(html.includes("<!doctype html>"));
    assert.equal(html.includes("<script>alert"), false);
    assert.equal(html.includes('<img src=x onerror="1">'), false);
    assert.ok(html.includes("তাড়াতাড়ি অর্ডার করুন"));
    assert.ok(html.includes("तेज़ डिलीवरी"));
    assert.ok(html.includes(strat.id));
  }
});

test("generateThumbnailAbVariants renders 3 distinct 1080p PNGs into output/thumbnails/", async () => {
  const res = await generateThumbnailAbVariants({ slug: TEST_SLUG });

  assert.equal(res.ok, true);
  assert.equal(res.slug, TEST_SLUG);
  assert.equal(res.width, 1080);
  assert.equal(res.height, 1920);
  assert.equal(res.variants.length, 3);
  assert.equal(res.thumbnails.length, 3);

  const expectedFiles = ["variant_a_hook.png", "variant_b_split.png", "variant_c_spotlight.png"];
  assert.deepEqual(
    res.variants.map((v) => v.filename),
    expectedFiles,
  );

  const buffers = [];
  for (const item of res.variants) {
    assert.equal(item.relPath, `output/thumbnails/${item.filename}`);
    assert.equal(
      item.url,
      `/media/${encodeURIComponent(TEST_SLUG)}/output/thumbnails/${item.filename}`,
    );
    const absPng = path.join(TEST_PROJECT_DIR, "output", "thumbnails", item.filename);
    const meta = readPngMeta(absPng);
    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1920);
    assert.equal(item.sizeBytes, meta.sizeBytes);
    buffers.push(meta.buf);
  }

  // Ensure each variant renders a genuinely distinct layout composition
  assert.notEqual(Buffer.compare(buffers[0], buffers[1]), 0);
  assert.notEqual(Buffer.compare(buffers[1], buffers[2]), 0);
  assert.notEqual(Buffer.compare(buffers[0], buffers[2]), 0);

  // Also test explicit 16:9 1920x1080 brief override
  const resLandscape = await generateThumbnailAbVariants({
    slug: TEST_SLUG,
    brief: {
      slug: TEST_SLUG,
      title: "Krishop Landscape Cover",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      brandColors: {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#F1C40F",
        background: "#0A1612",
      },
    },
  });
  assert.equal(resLandscape.width, 1920);
  assert.equal(resLandscape.height, 1080);
  const metaLandscape = readPngMeta(
    path.join(TEST_PROJECT_DIR, "output", "thumbnails", "variant_a_hook.png"),
  );
  assert.equal(metaLandscape.width, 1920);
  assert.equal(metaLandscape.height, 1080);
});

test("generateThumbnailAbVariants rejects unsafe path traversal slugs", async () => {
  for (const badSlug of ["", "../escape", "nested/slug", "..", "bad\0slug"]) {
    await assert.rejects(
      () => generateThumbnailAbVariants({ slug: badSlug }),
      /Invalid project slug|Unsafe project path/i,
    );
  }
});

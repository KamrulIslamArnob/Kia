import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getToolEnv, resolvePythonBin, runCommand } from "../lib.mjs";
import { extractSubjectForegroundMatte } from "../subject-matte.mjs";

const SYNTH_PORTRAIT_PY = `
import sys, cv2, numpy as np

out_path = sys.argv[1]
mode = sys.argv[2] if len(sys.argv) > 2 else "speaker"

h, w = 960, 540
img = np.zeros((h, w, 3), dtype=np.uint8)

# Studio gradient background (cool slate/teal BGR)
for y in range(h):
    ratio = y / float(h)
    img[y, :, 0] = int(58 - 18 * ratio)
    img[y, :, 1] = int(38 - 12 * ratio)
    img[y, :, 2] = int(20 - 6 * ratio)

if mode == "speaker":
    # Blazer shoulders & torso anchored to bottom of frame
    torso_pts = np.array([
        [95, h],
        [120, 610],
        [215, 555],
        [325, 555],
        [420, 610],
        [445, h],
    ], dtype=np.int32)
    cv2.fillConvexPoly(img, torso_pts, (36, 32, 165))
    # Shirt V-neck
    shirt_pts = np.array([[235, 560], [305, 560], [270, 700]], dtype=np.int32)
    cv2.fillConvexPoly(img, shirt_pts, (238, 240, 242))
    # Neck (warm skin BGR)
    cv2.rectangle(img, (238, 475), (302, 570), (132, 168, 218), -1)
    # Head oval (warm skin BGR)
    cv2.ellipse(img, (270, 365), (86, 112), 0, 0, 360, (138, 176, 226), -1)
    # Hair cap
    cv2.ellipse(img, (270, 285), (90, 52), 0, 180, 360, (24, 26, 32), -1)
    # Facial features (brows, eyes, nose shadow, mouth) for realistic texture variance
    cv2.line(img, (224, 336), (254, 333), (30, 32, 42), 5)
    cv2.line(img, (286, 333), (316, 336), (30, 32, 42), 5)
    cv2.circle(img, (240, 354), 9, (25, 28, 35), -1)
    cv2.circle(img, (300, 354), 9, (25, 28, 35), -1)
    cv2.line(img, (270, 358), (266, 396), (108, 138, 185), 3)
    cv2.ellipse(img, (270, 424), (26, 10), 0, 0, 180, (82, 92, 175), -1)
else:
    # Stylized high-contrast geometric product/avatar subject (non-skin)
    cv2.circle(img, (270, 430), 125, (40, 205, 248), -1)
    cv2.rectangle(img, (175, 540), (365, h), (48, 190, 235), -1)

ok, enc = cv2.imencode(".png", img)
assert ok
enc.tofile(out_path)
`;

const INSPECT_MATTE_PY = `
import sys, json, cv2, numpy as np

raw = np.fromfile(sys.argv[1], dtype=np.uint8)
im = cv2.imdecode(raw, cv2.IMREAD_UNCHANGED)
h, w = im.shape[:2]
ch = im.shape[2] if im.ndim == 3 else 1
alpha = im[:, :, 3] if ch == 4 else np.full((h, w), 255, dtype=np.uint8)

top_left = float(np.mean(alpha[:40, :40]))
top_right = float(np.mean(alpha[:40, w - 40:]))
face_center = float(np.mean(alpha[330:400, 240:300]))
torso_center = float(np.mean(alpha[680:780, 220:320]))
feathered_count = int(np.sum((alpha >= 15) & (alpha <= 240)))
opaque_ratio = float(np.mean(alpha > 200))
transparent_ratio = float(np.mean(alpha < 25))

print(json.dumps({
    "width": int(w),
    "height": int(h),
    "channels": int(ch),
    "topLeftAlpha": top_left,
    "topRightAlpha": top_right,
    "faceCenterAlpha": face_center,
    "torsoCenterAlpha": torso_center,
    "featheredPixels": feathered_count,
    "opaqueRatio": opaque_ratio,
    "transparentRatio": transparent_ratio,
}))
`;

async function generateSyntheticFixture(outPath, mode = "speaker") {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const env = { ...getToolEnv(), PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
  const res = await runCommand(resolvePythonBin(), ["-c", SYNTH_PORTRAIT_PY, outPath, mode], {
    env,
    shell: false,
  });
  assert.equal(res.code, 0, `Synthetic portrait generation failed: ${res.stderr}`);
}

async function inspectRgbaMatte(mattePath) {
  const env = { ...getToolEnv(), PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
  const res = await runCommand(resolvePythonBin(), ["-c", INSPECT_MATTE_PY, mattePath], {
    env,
    shell: false,
  });
  assert.equal(res.code, 0, `Matte inspection failed: ${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

test("Offline Subject Matte Occlusion Engine — speaker cutout, Gaussian feathering & path safety", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "studio-subject-matte-"));
  const tmpProjectsDir = path.join(tmpRoot, "projects");
  const slug = "matte-test-reel";
  const projectDir = path.join(tmpProjectsDir, slug);
  fs.mkdirSync(path.join(projectDir, "assets", "images"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, ".studio", "frames", "raw"), { recursive: true });

  t.after(() => {
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await t.test(
    "extractSubjectForegroundMatte segments on-camera speaker into feathered 4-channel RGBA PNG",
    async () => {
      const speakerImg = path.join(tmpRoot, "speaker_shot_01.png");
      await generateSyntheticFixture(speakerImg, "speaker");

      const result = await extractSubjectForegroundMatte({
        slug,
        imagePath: speakerImg,
        projectsDir: tmpProjectsDir,
      });

      assert.equal(result.ok, true);
      assert.equal(result.slug, slug);
      assert.equal(result.outRelPath, "assets/images/matte_speaker_shot_01.png");
      assert.equal(result.subjectMatteSrc, "assets/images/matte_speaker_shot_01.png");
      assert.equal(result.url, `/media/${slug}/assets/images/matte_speaker_shot_01.png`);
      assert.equal(result.hasAlpha, true);
      assert.equal(result.channels, 4);
      assert.equal(result.width, 540);
      assert.equal(result.height, 960);
      assert.equal(result.faceDetected, true);

      const expectedOut = path.join(projectDir, "assets", "images", "matte_speaker_shot_01.png");
      assert.ok(fs.existsSync(expectedOut), "Matte PNG must exist in project assets/images/");

      // Verify RGBA pixel format via ffprobe
      const probeRes = await runCommand(
        "ffprobe",
        ["-v", "quiet", "-print_format", "json", "-show_streams", expectedOut],
        { env: getToolEnv(), shell: false },
      );
      assert.equal(probeRes.code, 0, probeRes.stderr);
      const stream = JSON.parse(probeRes.stdout).streams[0];
      assert.equal(stream.codec_name, "png");
      assert.equal(stream.pix_fmt, "rgba");
      assert.equal(stream.width, 540);
      assert.equal(stream.height, 960);

      // Verify transparent background, opaque face/torso, and feathered boundary
      const stats = await inspectRgbaMatte(expectedOut);
      assert.equal(stats.channels, 4);
      assert.ok(
        stats.topLeftAlpha < 10,
        `Expected transparent top-left, got ${stats.topLeftAlpha}`,
      );
      assert.ok(
        stats.topRightAlpha < 10,
        `Expected transparent top-right, got ${stats.topRightAlpha}`,
      );
      assert.ok(
        stats.faceCenterAlpha > 240,
        `Expected opaque speaker face, got ${stats.faceCenterAlpha}`,
      );
      assert.ok(
        stats.torsoCenterAlpha > 240,
        `Expected opaque speaker torso, got ${stats.torsoCenterAlpha}`,
      );
      assert.ok(
        stats.featheredPixels > 100,
        `Expected Gaussian-feathered boundary pixels, got ${stats.featheredPixels}`,
      );
      assert.ok(stats.opaqueRatio > 0.12 && stats.opaqueRatio < 0.65);
      assert.ok(stats.transparentRatio > 0.35);
    },
  );

  await t.test(
    "Supports Unicode/spaces source paths, custom outRelPath, and non-skin contrast saliency fallback",
    async () => {
      const unicodeDir = path.join(tmpRoot, "বাংলা ফোল্ডার with spaces");
      const stylizedImg = path.join(unicodeDir, "স্পিকার_frame.png");
      await generateSyntheticFixture(stylizedImg, "stylized");

      const result = await extractSubjectForegroundMatte({
        slug,
        imagePath: stylizedImg,
        outRelPath: "assets/images/matte_custom_hero.png",
        projectsDir: tmpProjectsDir,
      });

      assert.equal(result.ok, true);
      assert.equal(result.outRelPath, "assets/images/matte_custom_hero.png");
      const customAbs = path.join(projectDir, "assets", "images", "matte_custom_hero.png");
      assert.ok(fs.existsSync(customAbs));

      const stats = await inspectRgbaMatte(customAbs);
      assert.equal(stats.channels, 4);
      assert.ok(stats.topLeftAlpha < 10);
      assert.ok(stats.opaqueRatio > 0.1 && stats.opaqueRatio < 0.7);
      assert.ok(stats.featheredPixels > 80);
    },
  );

  await t.test(
    "Auto-discovers project raw keyframe when imagePath is omitted (1-click ProToolsBelt mode)",
    async () => {
      const rawKeyframe = path.join(projectDir, ".studio", "frames", "raw", "scene_01_peak.png");
      await generateSyntheticFixture(rawKeyframe, "speaker");

      const result = await extractSubjectForegroundMatte({
        slug,
        projectsDir: tmpProjectsDir,
      });

      assert.equal(result.ok, true);
      assert.equal(result.outRelPath, "assets/images/matte_scene_01_peak.png");
      assert.ok(
        fs.existsSync(path.join(projectDir, "assets", "images", "matte_scene_01_peak.png")),
      );
    },
  );

  await t.test("Rejects path traversal in slug, outRelPath, and imagePath", async () => {
    const validSource = path.join(projectDir, ".studio", "frames", "raw", "scene_01_peak.png");

    await assert.rejects(
      () =>
        extractSubjectForegroundMatte({
          slug: "../escape",
          imagePath: validSource,
          projectsDir: tmpProjectsDir,
        }),
      /Invalid project slug/i,
    );

    await assert.rejects(
      () =>
        extractSubjectForegroundMatte({
          slug,
          imagePath: validSource,
          outRelPath: "../../outside.png",
          projectsDir: tmpProjectsDir,
        }),
      /Unsafe|Invalid|traversal/i,
    );

    await assert.rejects(
      () =>
        extractSubjectForegroundMatte({
          slug,
          imagePath: "../../secret.png",
          projectsDir: tmpProjectsDir,
        }),
      /Unsafe|Invalid|traversal|not found/i,
    );

    await assert.rejects(
      () =>
        extractSubjectForegroundMatte({
          slug,
          imagePath: path.join(tmpRoot, "missing_frame_999.png"),
          projectsDir: tmpProjectsDir,
        }),
      /not found/i,
    );
  });
});

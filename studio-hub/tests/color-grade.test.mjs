import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getToolEnv, runCommand } from "../lib.mjs";
import {
  COLOR_LOOKS,
  applyColorLook,
  applyColorLookToImage,
  applyColorLookToVideo,
  getColorLook,
} from "../color-grade.mjs";

const EXPECTED_LOOK_IDS = [
  "clean-commercial",
  "kodak-2383-warm",
  "emerald-vibrant",
  "teal-orange-cinema",
  "apple-keynote-crisp",
  "matte-editorial",
  "cyber-neon",
  "vintage-16mm-grain",
  "warm-golden-hour",
  "noir-high-contrast",
];

const REQUIRED_FILTER_STAGES = ["eq", "colorbalance", "curves", "unsharp", "noise", "vignette"];

async function ffprobeJson(filePath) {
  const env = getToolEnv();
  const res = await runCommand(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { env, shell: false },
  );
  assert.equal(res.code, 0, `ffprobe failed for ${filePath}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

async function sampleMeanRgb(filePath) {
  const env = getToolEnv();
  const tmpRaw = `${filePath}.rgb.raw`;
  const rawRes = await runCommand(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      filePath,
      "-frames:v",
      "1",
      "-vf",
      "scale=16:16:flags=area,format=rgb24",
      "-f",
      "rawvideo",
      tmpRaw,
    ],
    { env, shell: false },
  );
  assert.equal(rawRes.code, 0, `Raw RGB sample failed: ${rawRes.stderr}`);
  const buf = fs.readFileSync(tmpRaw);
  fs.unlinkSync(tmpRaw);

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  const pixelCount = Math.floor(buf.length / 3);
  for (let i = 0; i < pixelCount * 3; i += 3) {
    rSum += buf[i];
    gSum += buf[i + 1];
    bSum += buf[i + 2];
  }
  return {
    r: rSum / pixelCount,
    g: gSum / pixelCount,
    b: bSum / pixelCount,
  };
}

test("Cinema Color Grade Engine — COLOR_LOOKS catalog, FFmpeg video & 1:1 image grading", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-color-grade-"));

  t.after(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test(
    "COLOR_LOOKS defines all 10 cinema looks with FFmpeg filters & UI swatch metadata",
    () => {
      assert.ok(Array.isArray(COLOR_LOOKS), "COLOR_LOOKS should be iterable as an array");
      assert.equal(COLOR_LOOKS.length, 10);
      assert.deepEqual(
        COLOR_LOOKS.map((look) => look.id),
        EXPECTED_LOOK_IDS,
      );

      for (const lookId of EXPECTED_LOOK_IDS) {
        const look = getColorLook(lookId);
        assert.ok(look, `getColorLook("${lookId}") must return look definition`);
        assert.equal(COLOR_LOOKS[lookId], look, `COLOR_LOOKS["${lookId}"] key lookup must match`);
        assert.equal(look.id, lookId);
        assert.equal(typeof look.name, "string");
        assert.ok(look.name.length > 2);
        assert.equal(typeof look.description, "string");
        assert.ok(look.description.length > 10);
        assert.equal(typeof look.filterChain, "string");

        for (const stage of REQUIRED_FILTER_STAGES) {
          assert.equal(
            typeof look.filters[stage],
            "string",
            `${lookId} must specify ${stage} filter definition`,
          );
          assert.ok(
            look.filterChain.includes(`${stage}=`),
            `${lookId} filterChain must include "${stage}="`,
          );
        }

        // HyperFrames Rule #11 guard: filterChain must be FFmpeg syntax, never CSS filter() functions
        assert.doesNotMatch(look.filterChain, /hue-rotate\(|sepia\(|drop-shadow\(/i);

        // UI swatch preview metadata
        assert.ok(Array.isArray(look.swatches) && look.swatches.length >= 3);
        for (const hex of look.swatches) {
          assert.match(hex, /^#[0-9A-Fa-f]{6}$/);
        }
        assert.equal(typeof look.swatch, "object");
        assert.match(look.swatch.shadows, /^#[0-9A-Fa-f]{6}$/);
        assert.match(look.swatch.midtones, /^#[0-9A-Fa-f]{6}$/);
        assert.match(look.swatch.highlights, /^#[0-9A-Fa-f]{6}$/);
        assert.match(look.swatch.accent, /^#[0-9A-Fa-f]{6}$/);
        assert.match(look.swatch.gradient, /^linear-gradient\(/);
      }
    },
  );

  await t.test("Validation rejects unknown lookId and missing input files cleanly", async () => {
    const missingFile = path.join(tmpDir, "does_not_exist.mp4");
    const outVideo = path.join(tmpDir, "unused_out.mp4");

    await assert.rejects(
      () => applyColorLookToVideo({ inputPath: missingFile, outputPath: outVideo }),
      /not found|does not exist/i,
    );

    const dummyInput = path.join(tmpDir, "dummy.png");
    fs.writeFileSync(dummyInput, "placeholder");

    await assert.rejects(
      () =>
        applyColorLookToImage({
          inputPath: dummyInput,
          outputPath: path.join(tmpDir, "out.png"),
          lookId: "invalid-lut-999",
        }),
      /Unknown color look/i,
    );
  });

  await t.test(
    "applyColorLookToVideo grades synthetic MP4 with libx264 yuv420p, preserves audio & verifies dimensions via ffprobe",
    async () => {
      const env = getToolEnv();
      const inputVideo = path.join(tmpDir, "source_clip.mp4");

      const synthRes = await runCommand(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=640x360:rate=30:duration=1.2",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=44100:duration=1.2",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-preset",
          "ultrafast",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          inputVideo,
        ],
        { env, shell: false },
      );
      assert.equal(synthRes.code, 0, `Synthetic video generation failed: ${synthRes.stderr}`);

      // Default look ("clean-commercial") in nested directory
      const defaultOut = path.join(tmpDir, "nested", "graded_default.mp4");
      const resDefault = await applyColorLookToVideo({
        inputPath: inputVideo,
        outputPath: defaultOut,
      });
      assert.deepEqual(resDefault, {
        ok: true,
        outputPath: defaultOut,
        lookId: "clean-commercial",
      });
      assert.ok(fs.existsSync(defaultOut));

      const defaultProbe = await ffprobeJson(defaultOut);
      const vStream = defaultProbe.streams.find((s) => s.codec_type === "video");
      const aStream = defaultProbe.streams.find((s) => s.codec_type === "audio");
      assert.ok(vStream, "Graded video must contain video stream");
      assert.ok(aStream, "Graded video must copy audio stream");
      assert.equal(vStream.codec_name, "h264");
      assert.equal(vStream.pix_fmt, "yuv420p");
      assert.equal(vStream.width, 640);
      assert.equal(vStream.height, 360);
      assert.equal(aStream.codec_name, "aac");

      // Custom look + custom fps (24fps)
      const noirOut = path.join(tmpDir, "graded_noir_24.mp4");
      const resNoir = await applyColorLookToVideo({
        inputPath: inputVideo,
        outputPath: noirOut,
        lookId: "noir-high-contrast",
        fps: 24,
      });
      assert.deepEqual(resNoir, {
        ok: true,
        outputPath: noirOut,
        lookId: "noir-high-contrast",
      });

      const noirProbe = await ffprobeJson(noirOut);
      const noirV = noirProbe.streams.find((s) => s.codec_type === "video");
      assert.equal(noirV.width, 640);
      assert.equal(noirV.height, 360);
      assert.equal(noirV.r_frame_rate, "24/1");

      // In-place overwrite safety (inputPath === outputPath)
      const inPlaceVideo = path.join(tmpDir, "inplace_clip.mp4");
      fs.copyFileSync(inputVideo, inPlaceVideo);
      const resInPlace = await applyColorLookToVideo({
        inputPath: inPlaceVideo,
        outputPath: inPlaceVideo,
        lookId: "kodak-2383-warm",
      });
      assert.equal(resInPlace.ok, true);
      assert.ok(fs.existsSync(inPlaceVideo));
      const inPlaceProbe = await ffprobeJson(inPlaceVideo);
      assert.equal(inPlaceProbe.streams.find((s) => s.codec_type === "video").width, 640);
    },
  );

  await t.test(
    "applyColorLookToImage executes all 10 looks on numbered PNG & JPG keyframes and matches video grade 1:1",
    async () => {
      const env = getToolEnv();
      const refVideo = path.join(tmpDir, "match_source.mp4");
      const refPng = path.join(tmpDir, "frame_01_v1.png");

      await runCommand(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=640x360:rate=30:duration=0.5",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          refVideo,
        ],
        { env, shell: false },
      );

      await runCommand("ffmpeg", ["-y", "-i", refVideo, "-frames:v", "1", "-update", "1", refPng], {
        env,
        shell: false,
      });

      // Smoke-test all 10 cinema looks on keyframe PNG
      for (const lookId of EXPECTED_LOOK_IDS) {
        const outPng = path.join(tmpDir, `hero_${lookId}_01.png`);
        const res = await applyColorLookToImage({
          inputPath: refPng,
          outputPath: outPng,
          lookId,
        });
        assert.deepEqual(res, {
          ok: true,
          outputPath: outPng,
          lookId,
        });
        assert.ok(fs.existsSync(outPng) && fs.statSync(outPng).size > 1000);

        const info = await ffprobeJson(outPng);
        const stream = info.streams.find((s) => s.codec_type === "video");
        assert.equal(stream.width, 640);
        assert.equal(stream.height, 360);
      }

      // Verify JPG output & applyColorLook convenience dispatcher
      const outJpg = path.join(tmpDir, "hero_warm_01.jpg");
      const jpgRes = await applyColorLook({
        inputPath: refPng,
        outputPath: outJpg,
        lookId: "warm-golden-hour",
      });
      assert.equal(jpgRes.ok, true);
      const jpgInfo = await ffprobeJson(outJpg);
      assert.equal(jpgInfo.streams[0].codec_name, "mjpeg");
      assert.equal(jpgInfo.streams[0].width, 640);
      assert.equal(jpgInfo.streams[0].height, 360);

      // Verify 1:1 tonal parity between graded image and graded video for "emerald-vibrant"
      const gradedVideo = path.join(tmpDir, "parity_emerald.mp4");
      const gradedPng = path.join(tmpDir, "hero_emerald-vibrant_01.png");
      await applyColorLookToVideo({
        inputPath: refVideo,
        outputPath: gradedVideo,
        lookId: "emerald-vibrant",
      });

      const imgRgb = await sampleMeanRgb(gradedPng);
      const vidRgb = await sampleMeanRgb(gradedVideo);
      assert.ok(
        Math.abs(imgRgb.r - vidRgb.r) <= 4 &&
          Math.abs(imgRgb.g - vidRgb.g) <= 4 &&
          Math.abs(imgRgb.b - vidRgb.b) <= 4,
        `Expected 1:1 tonal match between graded Hero Frame PNG (${JSON.stringify(imgRgb)}) and graded MP4 (${JSON.stringify(vidRgb)})`,
      );
    },
  );
});

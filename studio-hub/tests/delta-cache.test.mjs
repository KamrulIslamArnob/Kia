import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROJECTS_DIR, ROOT_DIR, ensureProjectDirs, probeMedia, runCommand } from "../lib.mjs";
import {
  computeSceneContentHash,
  lookupCachedSceneRender,
  stitchCachedScenesMp4,
  storeCachedSceneRender,
} from "../delta-cache.mjs";

const TEST_SLUG = "tmp-delta-cache-tdd";
const TEST_PROJECT_DIR = path.join(PROJECTS_DIR, TEST_SLUG);

test("PM Differentiator #4 — SHA-256 Content-Addressed Delta Scene Cache", async (t) => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-delta-cache- "));

  t.after(async () => {
    if (fs.existsSync(TEST_PROJECT_DIR)) {
      await fs.promises.rm(TEST_PROJECT_DIR, { recursive: true, force: true, maxRetries: 5 });
    }
    if (fs.existsSync(scratchDir)) {
      await fs.promises.rm(scratchDir, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  await t.test(
    "computeSceneContentHash is deterministic across key order and sensitive to visual, audio, canvas, and clip byte edits",
    async () => {
      const clipFile = path.join(scratchDir, "clip_a.mp4");
      fs.writeFileSync(clipFile, Buffer.from("synthetic-mp4-payload-v1"));

      const hash1 = computeSceneContentHash({
        frame: {
          id: "frame_01",
          layout: "device-3d-showcase",
          durationSeconds: 2.5,
          staging: { headline: "Fresh Harvest", badgeText: "NEW" },
          updatedAt: "2026-11-18T00:00:00.000Z",
        },
        sceneHtml: '<template id="scene_01-template"><div id="root">Hello</div></template>\r\n',
        clipPath: clipFile,
        audioSpec: { voice: "en-US-AriaNeural", voiceoverText: "Hello world" },
        width: 1080,
        height: 1920,
        fps: 30,
      });

      assert.match(hash1, /^[a-f0-9]{64}$/);

      // Reordered object keys, CRLF->LF normalization, and volatile updatedAt change must NOT alter hash
      const hashSame = computeSceneContentHash({
        frame: {
          updatedAt: "2026-11-19T12:34:56.000Z",
          staging: { badgeText: "NEW", headline: "Fresh Harvest" },
          durationSeconds: 2.5,
          layout: "device-3d-showcase",
          id: "frame_01",
        },
        sceneHtml: '<template id="scene_01-template"><div id="root">Hello</div></template>\n',
        clipPath: clipFile,
        audioSpec: { voiceoverText: "Hello world", voice: "en-US-AriaNeural" },
        width: 1080,
        height: 1920,
        fps: 30,
      });
      assert.equal(hash1, hashSame);

      // Visual HTML change -> new hash
      const hashHtmlChanged = computeSceneContentHash({
        frame: {
          id: "frame_01",
          layout: "device-3d-showcase",
          durationSeconds: 2.5,
          staging: { headline: "Fresh Harvest", badgeText: "NEW" },
        },
        sceneHtml: '<template id="scene_01-template"><div id="root">Updated</div></template>\n',
        clipPath: clipFile,
        audioSpec: { voice: "en-US-AriaNeural", voiceoverText: "Hello world" },
        width: 1080,
        height: 1920,
        fps: 30,
      });
      assert.notEqual(hash1, hashHtmlChanged);

      // Underlying clip bytes changed -> new hash
      fs.writeFileSync(clipFile, Buffer.from("synthetic-mp4-payload-v2-modified"));
      const hashClipChanged = computeSceneContentHash({
        frame: {
          id: "frame_01",
          layout: "device-3d-showcase",
          durationSeconds: 2.5,
          staging: { headline: "Fresh Harvest", badgeText: "NEW" },
        },
        sceneHtml: '<template id="scene_01-template"><div id="root">Hello</div></template>\n',
        clipPath: clipFile,
        audioSpec: { voice: "en-US-AriaNeural", voiceoverText: "Hello world" },
        width: 1080,
        height: 1920,
        fps: 30,
      });
      assert.notEqual(hash1, hashClipChanged);

      // Canvas FPS change -> new hash
      const hashFpsChanged = computeSceneContentHash({
        frame: { id: "frame_01", layout: "device-3d-showcase", durationSeconds: 2.5 },
        sceneHtml: "<template></template>",
        clipPath: null,
        audioSpec: {},
        width: 1080,
        height: 1920,
        fps: 60,
      });
      const hashFpsBase = computeSceneContentHash({
        frame: { id: "frame_01", layout: "device-3d-showcase", durationSeconds: 2.5 },
        sceneHtml: "<template></template>",
        clipPath: null,
        audioSpec: {},
        width: 1080,
        height: 1920,
        fps: 30,
      });
      assert.notEqual(hashFpsBase, hashFpsChanged);
    },
  );

  await t.test(
    "lookupCachedSceneRender, storeCachedSceneRender & stitchCachedScenesMp4 store and concat MP4 scenes with master audio",
    async () => {
      ensureProjectDirs(TEST_SLUG);

      const scene1Src = path.join(scratchDir, "render_scene_01.mp4");
      const scene2Src = path.join(scratchDir, "render_scene_02.mp4");
      const masterAudioSrc = path.join(scratchDir, "master_audio.mp3");

      const gen1 = await runCommand(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=0x1e824c:s=360x640:r=30:d=1.5",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-preset",
          "ultrafast",
          scene1Src,
        ],
        { cwd: ROOT_DIR, shell: false },
      );
      assert.equal(gen1.code, 0, gen1.stderr);

      const gen2 = await runCommand(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=0x0a1612:s=360x640:r=30:d=1.5",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-preset",
          "ultrafast",
          scene2Src,
        ],
        { cwd: ROOT_DIR, shell: false },
      );
      assert.equal(gen2.code, 0, gen2.stderr);

      const genAudio = await runCommand(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=330:sample_rate=44100:duration=3.0",
          "-ac",
          "2",
          "-c:a",
          "libmp3lame",
          "-b:a",
          "128k",
          masterAudioSrc,
        ],
        { cwd: ROOT_DIR, shell: false },
      );
      assert.equal(genAudio.code, 0, genAudio.stderr);

      const hash1 = computeSceneContentHash({
        frame: { id: "frame_01", durationSeconds: 1.5 },
        sceneHtml: "<template>scene 1</template>",
        clipPath: scene1Src,
        audioSpec: { voiceoverText: "One" },
        width: 360,
        height: 640,
        fps: 30,
      });
      const hash2 = computeSceneContentHash({
        frame: { id: "frame_02", durationSeconds: 1.5 },
        sceneHtml: "<template>scene 2</template>",
        clipPath: scene2Src,
        audioSpec: { voiceoverText: "Two" },
        width: 360,
        height: 640,
        fps: 30,
      });

      // Cache miss initially
      const miss = lookupCachedSceneRender({ slug: TEST_SLUG, sceneId: "scene_01", hash: hash1 });
      assert.equal(miss.hit, false);
      assert.equal(miss.cachedMp4Path, null);

      // Store both scenes inside projects/<slug>/.studio/scene-cache/
      const stored1 = storeCachedSceneRender({
        slug: TEST_SLUG,
        sceneId: "scene_01",
        hash: hash1,
        renderedMp4Path: scene1Src,
      });
      const stored2 = storeCachedSceneRender({
        slug: TEST_SLUG,
        sceneId: "scene_02",
        hash: hash2,
        renderedMp4Path: scene2Src,
      });

      assert.equal(stored1.ok, true);
      assert.ok(stored1.relPath.startsWith(".studio/scene-cache/"));
      assert.ok(fs.existsSync(stored1.cachedMp4Path));
      assert.ok(fs.existsSync(stored2.cachedMp4Path));

      // Cache hit after store
      const hit1 = lookupCachedSceneRender({ slug: TEST_SLUG, sceneId: "scene_01", hash: hash1 });
      assert.equal(hit1.hit, true);
      assert.equal(hit1.cachedMp4Path, stored1.cachedMp4Path);

      // Path traversal rejection
      assert.throws(
        () =>
          lookupCachedSceneRender({
            slug: TEST_SLUG,
            sceneId: "../escape",
            hash: hash1,
          }),
        /invalid/i,
      );

      // Stitch with master audio via ffmpeg -f concat -safe 0 (shell: false)
      const stitchedWithAudioPath = path.join(
        TEST_PROJECT_DIR,
        "output",
        "stitched_with_audio.mp4",
      );
      const stitchRes = await stitchCachedScenesMp4({
        sceneMp4Paths: [hit1.cachedMp4Path, stored2.cachedMp4Path],
        masterAudioPath: masterAudioSrc,
        outPath: stitchedWithAudioPath,
      });

      assert.equal(stitchRes.ok, true);
      assert.ok(fs.existsSync(stitchedWithAudioPath));
      const probed = await probeMedia(stitchedWithAudioPath);
      assert.equal(probed.mediaType, "video");
      assert.equal(probed.width, 360);
      assert.equal(probed.height, 640);
      assert.equal(probed.hasAudio, true);
      assert.ok(
        probed.duration >= 2.8 && probed.duration <= 3.3,
        `Expected ~3.0s, got ${probed.duration}`,
      );

      // Stitch video-only (masterAudioPath = null)
      const stitchedSilentPath = path.join(TEST_PROJECT_DIR, "output", "stitched_video_only.mp4");
      const silentStitchRes = await stitchCachedScenesMp4({
        sceneMp4Paths: [hit1.cachedMp4Path, stored2.cachedMp4Path],
        masterAudioPath: null,
        outPath: stitchedSilentPath,
      });
      assert.equal(silentStitchRes.ok, true);
      const silentProbed = await probeMedia(stitchedSilentPath);
      assert.equal(silentProbed.width, 360);
      assert.equal(silentProbed.hasAudio, false);
    },
  );
});

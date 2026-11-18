import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { getToolEnv, runCommand } from "../lib.mjs";
import { quantizeStoryboardToBeats, snapTimeToFrame } from "../beat-quantizer.mjs";

function isFrameExact(seconds, fps) {
  const frames = seconds * fps;
  return Math.abs(frames - Math.round(frames)) < 1e-3;
}

describe("beat-quantizer: Beat-Quantized Magnetic Cuts & Frame-Exact Snapper", () => {
  let tmpRoot = "";
  let projectsDir = "";
  const slug = "beat-quant-test";

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "studio-beat-quantizer-test-"));
    projectsDir = path.join(tmpRoot, "projects");
    const projDir = path.join(projectsDir, slug);
    fs.mkdirSync(path.join(projDir, "assets", "audio"), { recursive: true });
    fs.mkdirSync(path.join(projDir, "inbox", "audio"), { recursive: true });
  });

  after(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("snaps arbitrary timestamps to exact 1/fps integer frame boundaries across 24, 30, and 60 fps", () => {
    const s30 = snapTimeToFrame(1.419, 30);
    assert.equal(s30.frame, 43);
    assert.ok(isFrameExact(s30.seconds, 30));

    const s24 = snapTimeToFrame(2.11, 24);
    assert.equal(s24.frame, 51);
    assert.ok(isFrameExact(s24.seconds, 24));

    const s60 = snapTimeToFrame(0.508, 60);
    assert.equal(s60.frame, 30);
    assert.equal(s60.seconds, 0.5);
  });

  it("snaps unlocked shot boundaries and camera velocity peaks to detected 120 BPM audio beats while preserving locked shots", async () => {
    const projDir = path.join(projectsDir, slug);
    const beatTrackPath = path.join(projDir, "assets", "audio", "compiled_master.mp3");

    // Generate crisp 120 BPM (0.50s period) percussive track over 8.0s
    const pulseExpr =
      "0.82*sin(2*PI*135*t)*exp(-40*mod(t,0.5))+0.38*sin(2*PI*1750*t)*exp(-90*mod(t,0.5))";
    const genRes = await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `aevalsrc='${pulseExpr}':s=44100:d=8.0`,
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        beatTrackPath,
      ],
      { shell: false, env: getToolEnv() },
    );
    assert.equal(genRes.code, 0, genRes.stderr);

    const initialStoryboard = {
      schemaVersion: 1,
      slug,
      frames: [
        {
          id: "frame_01",
          index: 1,
          locked: false,
          durationSeconds: 1.42, // Near 1.50s beat (+0.08s within 0.35s snap window)
          motionPreset: "crash-zoom-in",
          cameraMotion: {
            presetId: "crash-zoom-in",
            ease: "expo.out",
            fromScale: 1.0,
            toScale: 1.85,
          },
        },
        {
          id: "frame_02",
          index: 2,
          locked: false,
          durationSeconds: 1.59, // Cumulative ~3.09s -> snaps to 3.00s beat!
          motionPreset: "whip-pan-split",
          cameraMotion: {
            presetId: "whip-pan-split",
            ease: "expo.inOut",
            fromScale: 1.12,
            toScale: 1.04,
          },
        },
        {
          id: "frame_03",
          index: 3,
          locked: true,
          durationSeconds: 1.73, // Locked shot -> MUST remain 1.73s untouched!
          motionPreset: "parallax-float",
          cameraMotion: {
            presetId: "parallax-float",
            ease: "sine.inOut",
            fromScale: 1.04,
            toScale: 1.22,
          },
        },
        {
          id: "frame_04",
          index: 4,
          locked: false,
          durationSeconds: 1.41, // Unlocked shot after locked shot -> snaps end to nearest beat & 1/30s frame grid
          motionPreset: "spotlight-cursor-follow",
          cameraMotion: {
            presetId: "spotlight-cursor-follow",
            ease: "power4.inOut",
            fromScale: 1.08,
            toScale: 1.55,
          },
        },
      ],
    };

    fs.writeFileSync(
      path.join(projDir, "STORYBOARD.json"),
      JSON.stringify(initialStoryboard, null, 2),
      "utf8",
    );

    const res = await quantizeStoryboardToBeats({
      slug,
      audioPath: "assets/audio/compiled_master.mp3",
      fps: 30,
      maxSnapSec: 0.35,
      projectsDir,
    });

    assert.equal(res.ok, true);
    assert.equal(res.fps, 30);
    assert.equal(res.beatSource, "detected-audio");
    assert.ok(res.bpm >= 114 && res.bpm <= 126, `Expected ~120 BPM, got ${res.bpm}`);
    assert.ok(res.snappedCutCount >= 2, `Expected >= 2 snapped cuts, got ${res.snappedCutCount}`);
    assert.equal(res.lockedPreservedCount, 1);

    const frames = res.storyboard.frames;
    assert.equal(frames.length, 4);

    // Locked frame_03 must preserve its exact durationSeconds (1.73) untouched
    assert.equal(frames[2].locked, true);
    assert.equal(frames[2].durationSeconds, 1.73);

    // Unlocked frames must have 1/30s frame-exact durations and camera velocity peaks
    for (const idx of [0, 1, 3]) {
      const f = frames[idx];
      assert.ok(
        isFrameExact(f.durationSeconds, 30),
        `Unlocked ${f.id} duration ${f.durationSeconds}s is not 30fps frame-exact`,
      );
      assert.ok(f.beatSync, `Missing beatSync metadata on ${f.id}`);
      assert.ok(
        isFrameExact(f.beatSync.velocityPeakSec, 30),
        `Velocity peak ${f.beatSync.velocityPeakSec}s on ${f.id} is not 30fps frame-exact`,
      );
      assert.equal(typeof f.cameraMotion.velocityPeakFrame, "number");
      assert.ok(f.cameraMotion.velocityPeakFrame >= 1);
    }

    // frame_01 nominal 1.42s should have snapped magnetically to the 1.50s beat (45 frames)
    assert.ok(
      Math.abs(frames[0].durationSeconds - 1.5) <= 1 / 30 + 0.002,
      `Expected frame_01 to snap to ~1.50s beat, got ${frames[0].durationSeconds}s`,
    );

    // Verify STORYBOARD.json persisted to disk
    const saved = JSON.parse(fs.readFileSync(path.join(projDir, "STORYBOARD.json"), "utf8"));
    assert.ok(saved.beatQuantization);
    assert.equal(saved.frames[2].durationSeconds, 1.73);
  });

  it("gracefully falls back to rhythmic 120 BPM grid when project has no audio files yet", async () => {
    const emptySlug = "beat-fallback-empty";
    const emptyProjDir = path.join(projectsDir, emptySlug);
    fs.mkdirSync(emptyProjDir, { recursive: true });

    const sb = {
      schemaVersion: 1,
      slug: emptySlug,
      frames: [
        {
          id: "frame_01",
          index: 1,
          locked: false,
          durationSeconds: 2.11,
          motionPreset: "crash-zoom-in",
        },
        {
          id: "frame_02",
          index: 2,
          locked: false,
          durationSeconds: 2.89,
          motionPreset: "dolly-out-reveal",
        },
      ],
    };

    const res = await quantizeStoryboardToBeats({
      slug: emptySlug,
      storyboard: sb,
      audioPath: null,
      fps: 30,
      maxSnapSec: 0.35,
      projectsDir,
    });

    assert.equal(res.ok, true);
    assert.equal(res.beatSource, "rhythmic-fallback-120bpm");
    assert.equal(res.bpm, 120);
    assert.ok(isFrameExact(res.storyboard.frames[0].durationSeconds, 30));
    assert.ok(isFrameExact(res.storyboard.frames[1].durationSeconds, 30));
  });
});

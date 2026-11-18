import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { getToolEnv, runCommand } from "../lib.mjs";
import {
  BGM_MOODS,
  SFX_CATALOG,
  detectAudioBeats,
  masterAudioTimeline,
  probeAudioDuration,
  synthesizeAmbientBgm,
  synthesizeSfx,
} from "../sound-engine.mjs";

const EXPECTED_SFX_IDS = [
  "cinema-whoosh",
  "whip-swish",
  "sub-bass-drop",
  "ui-pop",
  "glass-ping",
  "camera-shutter",
  "riser-build",
  "confetti-chime",
  "keyboard-tap",
  "soft-click",
  "card-slide",
  "success-chord",
];

const EXPECTED_MOODS = ["upbeat-tech", "warm-acoustic", "cinematic-pulse", "minimal-lofi"];

async function ffprobeJson(filePath) {
  const res = await runCommand(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { shell: false, env: getToolEnv() },
  );
  assert.equal(res.code, 0, `ffprobe failed on ${filePath}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

async function measureLowBandRmsDb(filePath, startSec, durationSec) {
  const res = await runCommand(
    "ffmpeg",
    [
      "-ss",
      String(startSec),
      "-t",
      String(durationSec),
      "-i",
      filePath,
      "-af",
      "lowpass=f=340:poles=2,lowpass=f=340:poles=2,astats=measure_perchannel=0",
      "-f",
      "null",
      "-",
    ],
    { shell: false, env: getToolEnv() },
  );
  const match = res.stderr.match(/RMS level dB:\s*([-\d.]+)/);
  return match ? Number(match[1]) : null;
}

describe("sound-engine: Procedural Cinema SFX, Beat Detector & Multi-Bus Mastering Engine", () => {
  let tmpDir = "";

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-sound-engine-test-"));
  });

  after(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("exposes all 12 studio SFX presets with valid FFmpeg lavfi filtergraphs", () => {
    assert.ok(Array.isArray(SFX_CATALOG), "SFX_CATALOG must be an array");
    assert.equal(SFX_CATALOG.length, 12);

    const ids = SFX_CATALOG.map((item) => item.id);
    assert.deepEqual(ids, EXPECTED_SFX_IDS);

    for (const entry of SFX_CATALOG) {
      assert.equal(typeof entry.name, "string");
      assert.ok(entry.name.length > 0);
      assert.equal(typeof entry.category, "string");
      assert.equal(typeof entry.description, "string");
      assert.equal(typeof entry.durationSeconds, "number");
      assert.ok(entry.durationSeconds > 0 && entry.durationSeconds <= 2.0);
      assert.equal(typeof entry.lavfi, "string");
      assert.ok(entry.lavfi.includes("44100"), `Expected 44.1kHz synthesis in ${entry.id}`);
    }

    assert.ok(Array.isArray(BGM_MOODS));
    assert.deepEqual(
      BGM_MOODS.map((m) => m.id),
      EXPECTED_MOODS,
    );
  });

  it("synthesizes all 12 SFX cleanly on-device as MP3 and WAV with non-empty valid audio", async () => {
    const sfxDir = path.join(tmpDir, "sfx");
    for (const sfxId of EXPECTED_SFX_IDS) {
      const ext = sfxId === "soft-click" || sfxId === "ui-pop" ? ".wav" : ".mp3";
      const outPath = path.join(sfxDir, `${sfxId}${ext}`);
      const res = await synthesizeSfx({ sfxId, outPath });

      assert.equal(res.ok, true);
      assert.equal(res.sfxId, sfxId);
      assert.equal(res.outPath, outPath);
      assert.ok(fs.existsSync(outPath), `Missing synthesized SFX file: ${outPath}`);
      const stat = fs.statSync(outPath);
      assert.ok(stat.size > 256, `SFX ${sfxId} file too small (${stat.size} bytes)`);

      const info = await ffprobeJson(outPath);
      const audioStream = info.streams.find((s) => s.codec_type === "audio");
      assert.ok(audioStream, `No audio stream found in ${sfxId}`);
      const duration = Number(info.format?.duration ?? audioStream.duration);
      assert.ok(duration > 0.03, `Unexpected duration ${duration}s for ${sfxId}`);
    }

    await assert.rejects(
      () => synthesizeSfx({ sfxId: "non-existent-sfx", outPath: path.join(sfxDir, "bad.mp3") }),
      /Unknown sfxId/i,
    );
  });

  it("synthesizes all 4 ambient BGM moods with layered chord progressions and accurate duration", async () => {
    const bgmDir = path.join(tmpDir, "bgm");
    for (const mood of EXPECTED_MOODS) {
      const targetSec = mood === "upbeat-tech" ? 4.5 : 3.2;
      const outPath = path.join(bgmDir, `bgm_${mood}.mp3`);
      const res = await synthesizeAmbientBgm({
        mood,
        durationSeconds: targetSec,
        outPath,
      });

      assert.equal(res.ok, true);
      assert.equal(res.mood, mood);
      assert.ok(fs.existsSync(outPath));
      assert.ok(fs.statSync(outPath).size > 4096);

      const dur = await probeAudioDuration(outPath);
      assert.ok(
        Math.abs(dur - targetSec) <= 0.15,
        `Expected ~${targetSec}s for ${mood}, got ${dur}s`,
      );
    }

    await assert.rejects(
      () =>
        synthesizeAmbientBgm({
          mood: "heavy-death-metal",
          durationSeconds: 3,
          outPath: path.join(bgmDir, "bad.mp3"),
        }),
      /Unsupported BGM mood/i,
    );
  });

  it("masters multi-bus timeline with auto atempo clamping (0.85..1.45), speech BGM ducking, and 192k MP3 output", async () => {
    const mixDir = path.join(tmpDir, "master");
    fs.mkdirSync(mixDir, { recursive: true });

    // Low-frequency 200Hz BGM bed so we can isolate & verify ducking acoustically even under a high-frequency voice clip
    const bgmPath = path.join(mixDir, "bed_200hz.wav");
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=200:sample_rate=44100:duration=8.0",
        "-af",
        "volume=0.8,aformat=sample_rates=44100:channel_layouts=stereo",
        bgmPath,
      ],
      { shell: false, env: getToolEnv() },
    );

    // Voice clip 1: 2.6s raw clip fitting into 2.0s targetDurationSec -> auto atempo = 1.30
    const vo1Path = path.join(mixDir, "vo1_overrun.wav");
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1450:sample_rate=44100:duration=2.6",
        "-af",
        "volume=0.72,afade=t=in:st=0:d=0.02,afade=t=out:st=2.55:d=0.05,aformat=sample_rates=44100:channel_layouts=stereo",
        vo1Path,
      ],
      { shell: false, env: getToolEnv() },
    );

    // Voice clip 2: 2.0s raw clip targeting 1.0s -> ratio 2.0 must clamp cleanly to 1.45!
    const vo2Path = path.join(mixDir, "vo2_clamp.wav");
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1620:sample_rate=44100:duration=1.45",
        "-af",
        "volume=0.68,afade=t=in:st=0:d=0.02,afade=t=out:st=1.40:d=0.05,aformat=sample_rates=44100:channel_layouts=stereo",
        vo2Path,
      ],
      { shell: false, env: getToolEnv() },
    );

    const whooshPath = path.join(mixDir, "whoosh.wav");
    const chimePath = path.join(mixDir, "chime.wav");
    await synthesizeSfx({ sfxId: "cinema-whoosh", outPath: whooshPath });
    await synthesizeSfx({ sfxId: "confetti-chime", outPath: chimePath });

    const masteredPath = path.join(mixDir, "compiled_master.mp3");
    const result = await masterAudioTimeline({
      durationSeconds: 8.0,
      bgmPath,
      bgmVolume: 0.24,
      voiceClips: [
        { path: vo1Path, startSec: 1.8, targetDurationSec: 2.0 },
        { path: vo2Path, startSec: 5.0, targetDurationSec: 0.8 },
      ],
      sfxCues: [
        { path: whooshPath, startSec: 0.1, volume: 0.45 },
        { path: chimePath, startSec: 7.1, volume: 0.5 },
      ],
      outPath: masteredPath,
      normalizeLoudness: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.outPath, masteredPath);
    assert.ok(fs.existsSync(masteredPath));
    assert.ok(fs.statSync(masteredPath).size > 20000);

    // Verify auto atempo ratios: clip 1 ~ 1.30, clip 2 clamped to 1.45
    assert.equal(result.appliedVoiceClips.length, 2);
    assert.ok(
      Math.abs(result.appliedVoiceClips[0].tempo - 1.3) < 0.05,
      `Expected ~1.30 tempo, got ${result.appliedVoiceClips[0].tempo}`,
    );
    assert.equal(result.appliedVoiceClips[1].tempo, 1.45);

    // Verify MP3 codec, 192kbps nominal bitrate, and 8.0s duration via ffprobe
    const probe = await ffprobeJson(masteredPath);
    const audioStream = probe.streams.find((s) => s.codec_type === "audio");
    assert.ok(audioStream);
    assert.equal(audioStream.codec_name, "mp3");
    const duration = Number(probe.format?.duration ?? audioStream.duration);
    assert.ok(Math.abs(duration - 8.0) <= 0.15, `Expected ~8.0s master, got ${duration}s`);

    // Verify BGM ducking: low-band (200Hz) RMS during speech [2.1..3.4s] is significantly lower than un-ducked [0.7..1.4s]
    const unduckedRms = await measureLowBandRmsDb(masteredPath, 0.7, 0.7);
    const duckedRms = await measureLowBandRmsDb(masteredPath, 2.1, 1.3);
    assert.ok(
      unduckedRms !== null && duckedRms !== null,
      "Expected measurable RMS in both windows",
    );
    assert.ok(
      duckedRms < unduckedRms - 6.0,
      `Expected BGM to duck by >6 dB during speech (unducked=${unduckedRms} dB, ducked=${duckedRms} dB)`,
    );
  });

  it("detects rhythmic beat timestamps and BPM from percussive audio", async () => {
    const beatFile = path.join(tmpDir, "click_120bpm.wav");
    // 120 BPM = pulse every 0.5s across 4.0s (8 pulses at 0.0, 0.5, 1.0, ..., 3.5s)
    const pulseExpr =
      "0.8*sin(2*PI*140*t)*exp(-42*mod(t,0.5))+0.35*sin(2*PI*1800*t)*exp(-95*mod(t,0.5))";
    const genRes = await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `aevalsrc='${pulseExpr}':s=44100:d=4.0`,
        "-c:a",
        "pcm_s16le",
        beatFile,
      ],
      { shell: false, env: getToolEnv() },
    );
    assert.equal(genRes.code, 0, genRes.stderr);

    const beats = await detectAudioBeats({ audioPath: beatFile, minIntervalSec: 0.3 });
    assert.equal(beats.ok, true);
    assert.ok(beats.beatTimes.length >= 6, `Expected >= 6 beats, got ${beats.beatTimes.length}`);
    assert.ok(beats.bpm >= 114 && beats.bpm <= 126, `Expected ~120 BPM, got ${beats.bpm}`);
  });

  it("handles masterAudioTimeline without BGM and with normalizeLoudness=false", async () => {
    const popPath = path.join(tmpDir, "solo_pop.wav");
    await synthesizeSfx({ sfxId: "ui-pop", outPath: popPath });

    const outPath = path.join(tmpDir, "no_bgm_master.mp3");
    const res = await masterAudioTimeline({
      durationSeconds: 2.5,
      bgmPath: null,
      voiceClips: [],
      sfxCues: [{ path: popPath, startSec: 0.4, volume: 0.7 }],
      outPath,
      normalizeLoudness: false,
    });

    assert.equal(res.ok, true);
    assert.equal(res.normalizeLoudness, false);
    assert.equal(res.duckingWindows.length, 0);
    const dur = await probeAudioDuration(outPath);
    assert.ok(Math.abs(dur - 2.5) <= 0.15, `Expected ~2.5s duration, got ${dur}s`);
  });
});

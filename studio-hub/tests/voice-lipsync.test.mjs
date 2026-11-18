import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { getToolEnv, probeMedia, runCommand } from "../lib.mjs";
import {
  VOICE_CATALOG,
  detectCharacterFaceAndLips,
  extractAndSyncOriginalVoice,
  generateMultilingualLipSyncedVoice,
  listVoices,
} from "../voice-lipsync.mjs";

describe("voice-lipsync: Multilingual Neural Voice, Original Speech Sync & Character Lip-Sync", () => {
  let tmpRoot = "";
  let projectsDir = "";
  const slug = "voice-sync-test";

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "studio-voice-lipsync-test-"));
    projectsDir = path.join(tmpRoot, "projects");
    const projDir = path.join(projectsDir, slug);
    fs.mkdirSync(path.join(projDir, "inbox", "raw-video"), { recursive: true });
    fs.mkdirSync(path.join(projDir, "assets", "audio"), { recursive: true });
    fs.mkdirSync(path.join(projDir, "assets", "clips"), { recursive: true });
  });

  after(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("exposes complete VOICE_CATALOG for Bengali, English, and Hindi with metadata", () => {
    assert.ok(VOICE_CATALOG && typeof VOICE_CATALOG === "object");
    assert.deepEqual(Object.keys(VOICE_CATALOG), ["Bengali", "English", "Hindi"]);

    assert.deepEqual(
      VOICE_CATALOG.Bengali.map((v) => v.id),
      [
        "bn-BD-PradeepNeural",
        "bn-BD-NabanitaNeural",
        "bn-IN-BashkarNeural",
        "bn-IN-TanishaaNeural",
      ],
    );
    assert.deepEqual(
      VOICE_CATALOG.English.map((v) => v.id),
      ["en-US-ChristopherNeural", "en-US-AriaNeural", "en-GB-RyanNeural", "en-IN-NeerjaNeural"],
    );
    assert.deepEqual(
      VOICE_CATALOG.Hindi.map((v) => v.id),
      ["hi-IN-MadhurNeural", "hi-IN-SwaraNeural"],
    );

    for (const lang of ["Bengali", "English", "Hindi"]) {
      for (const spec of VOICE_CATALOG[lang]) {
        assert.equal(spec.language, lang);
        assert.ok(spec.gender === "Male" || spec.gender === "Female");
        assert.equal(typeof spec.style, "string");
        assert.ok(spec.style.length > 0);
        assert.equal(typeof spec.locale, "string");
        assert.equal(typeof spec.sampleRateHz, "number");
        assert.ok(spec.sampleRateHz >= 16000);
      }
    }

    assert.equal(listVoices().length, 10);
    assert.equal(listVoices("bengali").length, 4);
    assert.equal(listVoices("Hindi").length, 2);
  });

  it("extracts original speech from raw video and returns natural speech-aligned scene cut windows", async () => {
    const projDir = path.join(projectsDir, slug);
    const rawVideoRel = "inbox/raw-video/speaker_raw.mp4";
    const rawVideoAbs = path.join(projDir, rawVideoRel);

    // Synthesize a 4.2s raw video with 2 distinct voiced bursts [0.35..1.55s] and [2.35..3.75s] separated by 0.8s silence
    const speechExpr =
      "(gte(t,0.35)*lte(t,1.55)+gte(t,2.35)*lte(t,3.75))*(0.45*sin(2*PI*185*t)+0.25*sin(2*PI*370*t))*(0.65+0.35*sin(2*PI*5*t))";
    const genRes = await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x111827:s=360x640:r=24:d=4.2",
        "-f",
        "lavfi",
        "-i",
        `aevalsrc='${speechExpr}':s=44100:d=4.2`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        rawVideoAbs,
      ],
      { shell: false, env: getToolEnv() },
    );
    assert.equal(genRes.code, 0, genRes.stderr);

    const syncRes = await extractAndSyncOriginalVoice({
      slug,
      videoRelPath: rawVideoRel,
      trimSilence: true,
      projectsDir,
    });

    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.audioRelPath, "assets/audio/original_voice.mp3");
    const extractedMp3 = path.join(projDir, syncRes.audioRelPath);
    assert.ok(fs.existsSync(extractedMp3));
    assert.ok(fs.statSync(extractedMp3).size > 2048);
    assert.equal(syncRes.hasSpeech, true);
    assert.ok(Array.isArray(syncRes.segments));
    assert.equal(
      syncRes.segments.length,
      2,
      `Expected 2 speech phrases, got ${JSON.stringify(syncRes.segments)}`,
    );
    assert.equal(syncRes.segments[0].hasSpeech, true);
    assert.equal(syncRes.segments[1].hasSpeech, true);
    assert.ok(syncRes.segments[0].startTime >= 0.15 && syncRes.segments[0].endTime <= 1.85);
    assert.ok(syncRes.segments[1].startTime >= 2.1 && syncRes.segments[1].endTime <= 4.05);

    // Also verify trimSilence=false includes silence gap windows
    const fullTimelineRes = await extractAndSyncOriginalVoice({
      slug,
      videoRelPath: rawVideoRel,
      trimSilence: false,
      projectsDir,
    });
    assert.ok(fullTimelineRes.segments.some((s) => s.hasSpeech === false));
  });

  it("distinguishes on-camera speaking characters from non-character UI footage", async () => {
    const uiClip = path.join(tmpRoot, "ui_screen.mp4");
    const charClip = path.join(tmpRoot, "talking_character.mp4");

    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x0F172A:s=360x640:r=15:d=1.4,drawbox=x=30:y=110:w=300:h=180:color=0x2ECC71:t=fill",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        uiClip,
      ],
      { shell: false, env: getToolEnv() },
    );

    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x1E293B:s=360x640:r=15:d=2.2,drawbox=x=105:y=140:w=150:h=190:color=0xC68662:t=fill,drawbox=x=135:y=195:w=22:h=14:color=0x1A120E:t=fill,drawbox=x=203:y=195:w=22:h=14:color=0x1A120E:t=fill,drawbox=x=152:y=275:w=56:h=18:color=0x5A2320:t=fill",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        charClip,
      ],
      { shell: false, env: getToolEnv() },
    );

    const uiDetect = await detectCharacterFaceAndLips({ videoPath: uiClip });
    assert.equal(uiDetect.hasCharacter, false);
    assert.equal(uiDetect.faceBox, null);
    assert.equal(uiDetect.mouthRegion, null);

    const charDetect = await detectCharacterFaceAndLips({ videoPath: charClip });
    assert.equal(charDetect.hasCharacter, true);
    assert.ok(charDetect.faceRatio >= 0.8);
    assert.ok(charDetect.faceBox && charDetect.faceBox.width > 0.2);
    assert.ok(charDetect.mouthRegion && charDetect.mouthRegion.y > charDetect.faceBox.y);
  });

  it("generates Bengali AI voiceover, 30fps viseme envelope, and lip-synced character clip", async () => {
    const projDir = path.join(projectsDir, slug);
    const charClipRel = "inbox/raw-video/character_shot.mp4";
    const charClipAbs = path.join(projDir, charClipRel);

    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x1E293B:s=360x640:r=30:d=1.8,drawbox=x=105:y=140:w=150:h=190:color=0xC68662:t=fill,drawbox=x=135:y=195:w=22:h=14:color=0x1A120E:t=fill,drawbox=x=203:y=195:w=22:h=14:color=0x1A120E:t=fill,drawbox=x=152:y=275:w=56:h=18:color=0x5A2320:t=fill",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        charClipAbs,
      ],
      { shell: false, env: getToolEnv() },
    );

    const res = await generateMultilingualLipSyncedVoice({
      slug,
      frameId: "frame_01",
      clipPath: charClipRel,
      language: "Bengali",
      voiceId: "bn-BD-NabanitaNeural",
      scriptText: "আমাদের নতুন প্রোডাক্ট এখন আপনার হাতে।",
      targetDurationSec: 2.8,
      syncLips: true,
      projectsDir,
    });

    assert.equal(res.ok, true);
    assert.equal(res.language, "Bengali");
    assert.equal(res.voiceId, "bn-BD-NabanitaNeural");
    assert.equal(res.audioRelPath, "assets/audio/vo_frame_01.mp3");
    assert.equal(res.syncedClipRelPath, "assets/clips/lipsync_frame_01.mp4");
    assert.equal(res.lipSynced, true);
    assert.ok(res.characterDetection?.hasCharacter);

    // Verify 30fps viseme envelope
    assert.ok(Array.isArray(res.visemeEnvelope));
    const expectedFrames = Math.max(1, Math.round(res.durationSeconds * 30));
    assert.ok(
      Math.abs(res.visemeEnvelope.length - expectedFrames) <= 3,
      `Expected ~${expectedFrames} 30fps viseme samples, got ${res.visemeEnvelope.length}`,
    );
    assert.ok(res.visemeEnvelope.some((v) => v > 0.25));
    assert.ok(res.visemeEnvelope.every((v) => v >= 0 && v <= 1));

    // Verify synced video clip duration matches voiceover duration closely
    const syncedAbs = path.join(projDir, res.syncedClipRelPath);
    assert.ok(fs.existsSync(syncedAbs));
    const syncedMeta = await probeMedia(syncedAbs);
    assert.ok(
      Math.abs((syncedMeta.duration || 0) - res.durationSeconds) <= 0.25,
      `Expected synced clip duration ~${res.durationSeconds}s, got ${syncedMeta.duration}s`,
    );
  });
});

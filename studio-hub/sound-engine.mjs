import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getToolEnv, runCommand } from "./lib.mjs";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createSfxPreset({ id, name, category, description, durationSeconds, lavfi }) {
  return Object.freeze({
    id,
    name,
    category,
    description,
    duration: durationSeconds,
    durationSeconds,
    lavfi,
    filtergraph: lavfi,
  });
}

export const SFX_CATALOG = Object.freeze([
  createSfxPreset({
    id: "cinema-whoosh",
    name: "Cinema Whoosh",
    category: "transition",
    description: "Wide stereo pink-air sweep with low-end cinema body for hero transitions.",
    durationSeconds: 0.45,
    lavfi:
      "anoisesrc=c=pink:r=44100:d=0.45:a=0.45[n];aevalsrc='0.34*sin(2*PI*(115*t-60*t*t))*sin(PI*t/0.45)':s=44100:d=0.45[s];[n]bandpass=f=680:w=520,afade=t=in:st=0:d=0.16,afade=t=out:st=0.18:d=0.27[nf];[nf][s]amix=inputs=2:normalize=0,extrastereo=m=1.6,afade=t=out:st=0.38:d=0.07,alimiter=limit=0.88,aformat=sample_rates=44100:channel_layouts=stereo",
  }),
  createSfxPreset({
    id: "whip-swish",
    name: "Whip Swish",
    category: "transition",
    description: "Fast high-velocity camera whip-pan swish with crisp transient air.",
    durationSeconds: 0.2,
    lavfi:
      "anoisesrc=c=white:r=44100:d=0.20:a=0.42[n];aevalsrc='0.30*sin(2*PI*(420*t+2800*t*t))*sin(PI*t/0.20)':s=44100:d=0.20[s];[n]bandpass=f=1850:w=1100,afade=t=in:st=0:d=0.035,afade=t=out:st=0.045:d=0.155[nf];[nf][s]amix=inputs=2:normalize=0,afade=t=out:st=0.15:d=0.05,alimiter=limit=0.88,aformat=sample_rates=44100:channel_layouts=stereo",
  }),
  createSfxPreset({
    id: "sub-bass-drop",
    name: "Sub Bass Drop",
    category: "impact",
    description: "Deep exponential pitch-drop sub impact for title reveals and hero beats.",
    durationSeconds: 0.75,
    lavfi:
      "aevalsrc='(0.62*sin(2*PI*36*t+52*(1-exp(-5*t)))+0.24*sin(4*PI*36*t+104*(1-exp(-5.5*t)))*exp(-4.5*t))*exp(-2.2*t)':s=44100:d=0.75,afade=t=in:st=0:d=0.006,afade=t=out:st=0.50:d=0.25,alimiter=limit=0.90,aformat=sample_rates=44100:channel_layouts=stereo",
  }),
  createSfxPreset({
    id: "ui-pop",
    name: "UI Pop",
    category: "ui",
    description: "Warm tactile upward-inflecting UI bubble pop for badges and callouts.",
    durationSeconds: 0.11,
    lavfi:
      "aevalsrc='(0.55*sin(2*PI*(230*t+1750*t*t))+0.18*sin(4*PI*(230*t+1750*t*t)))*exp(-34*t)':s=44100:d=0.11,afade=t=in:st=0:d=0.003,afade=t=out:st=0.07:d=0.04,aformat=sample_rates=44100:channel_layouts=stereo",
  }),
  createSfxPreset({
    id: "glass-ping",
    name: "Glass Ping",
    category: "ui",
    description: "Crystalline multi-partial glass harmonic chime for spotlight highlights.",
    durationSeconds: 0.55,
    lavfi:
      "aevalsrc='0.36*sin(2*PI*1760*t)*exp(-6.5*t)+0.22*sin(2*PI*2637.02*t)*exp(-11*t)+0.14*sin(2*PI*3520*t)*exp(-17*t)':s=44100:d=0.55,afade=t=in:st=0:d=0.003,afade=t=out:st=0.38:d=0.17,aformat=sample_rates=44100:channel_layouts=stereo",
  }),
  createSfxPreset({
    id: "camera-shutter",
    name: "Camera Shutter",
    category: "foley",
    description: "Crisp dual-curtain mechanical shutter click for freeze-frames and snapshots.",
    durationSeconds: 0.18,
    lavfi:
      "anoisesrc=c=white:r=44100:d=0.18:a=0.55,bandpass=f=2200:w=1600[n];aevalsrc='0.48*sin(2*PI*920*t)*exp(-95*t)+0.42*gte(t,0.058)*sin(2*PI*1280*(t-0.058))*exp(-105*max(0,t-0.058))':s=44100:d=0.18[m];[n]volume='0.65*exp(-90*t)+0.55*gte(t,0.058)*exp(-95*max(0,t-0.058))':eval=frame[nf];[nf][m]amix=inputs=2:normalize=0,afade=t=in:st=0:d=0.002,afade=t=out:st=0.13:d=0.05,alimiter=limit=0.88,aformat=sample_rates=44100:channel_layouts=stereo",
  }),
  createSfxPreset({
    id: "riser-build",
    name: "Riser Build",
    category: "transition",
    description: "Accelerating harmonic + filtered-air tension riser leading into a drop or cut.",
    durationSeconds: 1.05,
    lavfi:
      "anoisesrc=c=pink:r=44100:d=1.05:a=0.34,bandpass=f=1350:w=950,afade=t=in:st=0:d=0.96,afade=t=out:st=0.98:d=0.07[n];aevalsrc='(0.32*sin(2*PI*(150*t+420*t*t))+0.18*sin(2*PI*(300*t+840*t*t)))*(t/1.05)*(t/1.05)':s=44100:d=1.05,afade=t=out:st=0.98:d=0.07[s];[n][s]amix=inputs=2:normalize=0,alimiter=limit=0.88,aformat=sample_rates=44100:channel_layouts=stereo",
  }),
  createSfxPreset({
    id: "confetti-chime",
    name: "Confetti Chime",
    category: "musical",
    description: "Sparkling 4-note ascending major-9 bell arpeggio for milestones and reveals.",
    durationSeconds: 0.65,
    lavfi:
      "aevalsrc='0.28*sin(2*PI*1046.50*t)*exp(-9*t)+0.28*gte(t,0.055)*sin(2*PI*1318.51*(t-0.055))*exp(-9*max(0,t-0.055))+0.28*gte(t,0.110)*sin(2*PI*1567.98*(t-0.110))*exp(-8.5*max(0,t-0.110))+0.24*gte(t,0.165)*(sin(2*PI*1975.53*(t-0.165))+0.65*sin(2*PI*2349.32*(t-0.165)))*exp(-6.5*max(0,t-0.165))':s=44100:d=0.65,afade=t=in:st=0:d=0.003,afade=t=out:st=0.45:d=0.20,alimiter=limit=0.88,aformat=sample_rates=44100:channel_layouts=stereo",
  }),
  createSfxPreset({
    id: "keyboard-tap",
    name: "Keyboard Tap",
    category: "foley",
    description: "Tactile mechanical keycap thock for typing sequences and search prompts.",
    durationSeconds: 0.08,
    lavfi:
      "anoisesrc=c=pink:r=44100:d=0.08:a=0.45,bandpass=f=2600:w=1400,afade=t=out:st=0.004:d=0.024[n];aevalsrc='0.48*sin(2*PI*(340*t-900*t*t))*exp(-75*t)':s=44100:d=0.08[b];[n][b]amix=inputs=2:normalize=0,afade=t=in:st=0:d=0.002,afade=t=out:st=0.045:d=0.035,alimiter=limit=0.85,aformat=sample_rates=44100:channel_layouts=stereo",
  }),
  createSfxPreset({
    id: "soft-click",
    name: "Soft Click",
    category: "ui",
    description: "Refined precision cursor click for pointer taps and button activations.",
    durationSeconds: 0.06,
    lavfi:
      "aevalsrc='(0.42*sin(2*PI*1180*t)*exp(-110*t)+0.28*sin(2*PI*490*t)*exp(-85*t))':s=44100:d=0.06,afade=t=in:st=0:d=0.0015,afade=t=out:st=0.03:d=0.03,aformat=sample_rates=44100:channel_layouts=stereo",
  }),
  createSfxPreset({
    id: "card-slide",
    name: "Card Slide",
    category: "foley",
    description: "Velvet filtered air-glide for bento cards, drawers, and split panels.",
    durationSeconds: 0.26,
    lavfi:
      "anoisesrc=c=pink:r=44100:d=0.26:a=0.38,highpass=f=420,lowpass=f=2900,afade=t=in:st=0:d=0.065,afade=t=out:st=0.095:d=0.165,aformat=sample_rates=44100:channel_layouts=stereo",
  }),
  createSfxPreset({
    id: "success-chord",
    name: "Success Chord",
    category: "musical",
    description: "Warm Cmaj9 studio resolution chord for CTA outros and verified completions.",
    durationSeconds: 0.85,
    lavfi:
      "aevalsrc='(0.24*sin(2*PI*261.63*t)+0.20*sin(2*PI*392.00*t)+0.18*sin(2*PI*493.88*t)+0.18*sin(2*PI*659.25*t)+0.14*sin(2*PI*587.33*t))*exp(-2.8*t)':s=44100:d=0.85,afade=t=in:st=0:d=0.018,afade=t=out:st=0.55:d=0.30,alimiter=limit=0.88,aformat=sample_rates=44100:channel_layouts=stereo",
  }),
]);

export const SFX_CATALOG_BY_ID = Object.freeze(
  Object.fromEntries(SFX_CATALOG.map((preset) => [preset.id, preset])),
);

const BGM_MOOD_PROFILES = Object.freeze({
  "upbeat-tech": {
    id: "upbeat-tech",
    name: "Upbeat Tech",
    description: "Crisp Cmaj7 -> Gadd9 -> Am7 -> Fmaj7 launch progression with rhythmic pulse.",
    bpm: 120,
    chords: [
      [261.63, 329.63, 392.0, 493.88],
      [196.0, 293.66, 392.0, 440.0],
      [220.0, 261.63, 329.63, 392.0],
      [174.61, 261.63, 349.23, 440.0],
    ],
    weights: [0.28, 0.24, 0.22, 0.18],
    noiseColor: "pink",
    noiseAmp: 0.028,
    noiseFilter: "bandpass=f=2800:w=1200",
    postFilter: "lowpass=f=1750,tremolo=f=4.0:d=0.26,extrastereo=m=1.35",
  },
  "warm-acoustic": {
    id: "warm-acoustic",
    name: "Warm Acoustic",
    description: "Organic Fadd9 -> C -> Dm7 -> Bbmaj7 storytelling bed with soft room warmth.",
    bpm: 92,
    chords: [
      [174.61, 220.0, 261.63, 392.0],
      [164.81, 261.63, 329.63, 392.0],
      [146.83, 220.0, 261.63, 349.23],
      [116.54, 220.0, 293.66, 349.23],
    ],
    weights: [0.3, 0.25, 0.22, 0.15],
    noiseColor: "brown",
    noiseAmp: 0.022,
    noiseFilter: "lowpass=f=850",
    postFilter: "aecho=0.8:0.84:60:0.16,lowpass=f=1180,tremolo=f=1.5:d=0.14,extrastereo=m=1.2",
  },
  "cinematic-pulse": {
    id: "cinematic-pulse",
    name: "Cinematic Pulse",
    description: "Deep Dm9 -> Bbmaj7 -> F -> Asus4 cinema score bed with sub-harmonic pulse.",
    bpm: 108,
    chords: [
      [73.42, 146.83, 220.0, 329.63],
      [58.27, 116.54, 220.0, 293.66],
      [87.31, 174.61, 261.63, 349.23],
      [55.0, 110.0, 220.0, 293.66],
    ],
    weights: [0.34, 0.26, 0.2, 0.14],
    noiseColor: "pink",
    noiseAmp: 0.03,
    noiseFilter: "lowpass=f=520",
    postFilter: "lowpass=f=980,tremolo=f=2.0:d=0.4,extrastereo=m=1.45",
  },
  "minimal-lofi": {
    id: "minimal-lofi",
    name: "Minimal Lo-Fi",
    description:
      "Mellow Ebmaj7 -> Cm7 -> Fm7 -> Bb9 editorial jazz-lofi progression with vinyl dust.",
    bpm: 80,
    chords: [
      [155.56, 233.08, 293.66, 392.0],
      [130.81, 196.0, 233.08, 311.13],
      [174.61, 207.65, 261.63, 311.13],
      [116.54, 207.65, 261.63, 293.66],
    ],
    weights: [0.29, 0.25, 0.22, 0.16],
    noiseColor: "pink",
    noiseAmp: 0.032,
    noiseFilter: "bandpass=f=1850:w=900",
    postFilter: "vibrato=f=0.8:d=0.07,lowpass=f=880,tremolo=f=1.25:d=0.12",
  },
});

export const BGM_MOODS = Object.freeze(
  Object.values(BGM_MOOD_PROFILES).map(({ id, name, description, bpm }) =>
    Object.freeze({ id, name, description, bpm }),
  ),
);

export function getSfxSpec(sfxId) {
  const key = String(sfxId || "")
    .trim()
    .toLowerCase();
  return SFX_CATALOG_BY_ID[key] || null;
}

function getAudioCodecArgs(outPath, defaultMp3Bitrate = "192k") {
  const ext = path.extname(outPath).toLowerCase();
  if (ext === ".wav") return ["-c:a", "pcm_s16le"];
  if (ext === ".flac") return ["-c:a", "flac"];
  if (ext === ".aac" || ext === ".m4a") return ["-c:a", "aac", "-b:a", defaultMp3Bitrate];
  if (ext === ".ogg") return ["-c:a", "libvorbis", "-q:a", "5"];
  return ["-c:a", "libmp3lame", "-b:a", defaultMp3Bitrate];
}

export async function probeAudioDuration(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }
  const res = await runCommand(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { shell: false, env: getToolEnv() },
  );
  if (res.code !== 0 || !res.stdout.trim()) {
    throw new Error(`ffprobe failed for ${filePath}: ${(res.stderr || "").trim()}`);
  }
  const info = JSON.parse(res.stdout);
  const streams = Array.isArray(info.streams) ? info.streams : [];
  const audioStream = streams.find((s) => s.codec_type === "audio");
  const raw = info.format?.duration ?? audioStream?.duration;
  const dur = Number(raw);
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error(`Unable to determine valid audio duration for ${filePath}`);
  }
  return dur;
}

export async function synthesizeSfx({ sfxId, outPath }) {
  const spec = getSfxSpec(sfxId);
  if (!spec) {
    throw new Error(
      `Unknown sfxId "${sfxId}". Supported IDs: ${SFX_CATALOG.map((s) => s.id).join(", ")}`,
    );
  }
  if (!outPath || typeof outPath !== "string") {
    throw new Error("synthesizeSfx requires a valid outPath string");
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const codecArgs = getAudioCodecArgs(outPath, "192k");
  const startedAt = performance.now();

  const res = await runCommand(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", spec.lavfi, ...codecArgs, outPath],
    { shell: false, env: getToolEnv() },
  );

  if (res.code !== 0) {
    throw new Error(
      `FFmpeg SFX synthesis failed for "${spec.id}": ${(res.stderr || res.stdout).trim().slice(-500)}`,
    );
  }
  if (!fs.existsSync(outPath)) {
    throw new Error(`Synthesized SFX file missing at ${outPath}`);
  }
  const stat = fs.statSync(outPath);
  if (stat.size <= 0) {
    throw new Error(`Synthesized SFX file is empty at ${outPath}`);
  }

  return {
    ok: true,
    sfxId: spec.id,
    outPath,
    sizeBytes: stat.size,
    durationSeconds: spec.durationSeconds,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

export async function synthesizeAmbientBgm({
  mood = "upbeat-tech",
  durationSeconds = 30,
  outPath,
}) {
  const moodKey = String(mood || "upbeat-tech")
    .trim()
    .toLowerCase();
  const profile = BGM_MOOD_PROFILES[moodKey];
  if (!profile) {
    throw new Error(
      `Unsupported BGM mood "${mood}". Supported moods: ${Object.keys(BGM_MOOD_PROFILES).join(", ")}`,
    );
  }
  const dur = Number(durationSeconds);
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error(`synthesizeAmbientBgm requires durationSeconds > 0 (got ${durationSeconds})`);
  }
  if (!outPath || typeof outPath !== "string") {
    throw new Error("synthesizeAmbientBgm requires a valid outPath string");
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Synthesize a 4-chord crossfaded cycle using FFmpeg sine oscillators, then loop & sculpt with anoisesrc texture
  const cycleTarget = Math.min(8.0, Math.max(1.2, dur));
  const xfade = Math.min(0.32, cycleTarget * 0.08);
  const segDur = (cycleTarget + 3 * xfade) / 4;

  const inputs = [];
  const filterParts = [];
  let inputIdx = 0;

  for (let c = 0; c < 4; c++) {
    const chordVoices = [];
    for (let n = 0; n < profile.chords[c].length; n++) {
      const freq = profile.chords[c][n];
      const weight = profile.weights[n] ?? 0.2;
      inputs.push(
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${freq.toFixed(2)}:sample_rate=44100:duration=${segDur.toFixed(3)}`,
      );
      filterParts.push(`[${inputIdx}:a]volume=${weight.toFixed(3)}[v${inputIdx}]`);
      chordVoices.push(`[v${inputIdx}]`);
      inputIdx++;
    }
    const endFadeStart = Math.max(0.015, segDur - 0.02);
    filterParts.push(
      `${chordVoices.join("")}amix=inputs=${chordVoices.length}:normalize=0,afade=t=in:st=0:d=0.015,afade=t=out:st=${endFadeStart.toFixed(3)}:d=0.02[ch${c}]`,
    );
  }

  inputs.push(
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=c=${profile.noiseColor}:r=44100:d=${dur.toFixed(3)}:a=${profile.noiseAmp.toFixed(4)}`,
  );
  const noiseIdx = inputIdx;

  filterParts.push(`[ch0][ch1]acrossfade=d=${xfade.toFixed(3)}:c1=tri:c2=tri[p01]`);
  filterParts.push(`[p01][ch2]acrossfade=d=${xfade.toFixed(3)}:c1=tri:c2=tri[p012]`);
  filterParts.push(`[p012][ch3]acrossfade=d=${xfade.toFixed(3)}:c1=tri:c2=tri[cycle]`);

  const effectiveCycleLen = Math.max(0.4, 4 * segDur - 3 * xfade);
  const loopsNeeded = Math.max(0, Math.ceil(dur / effectiveCycleLen) + 1);
  const fadeIn = Math.min(0.85, Math.max(0.08, dur * 0.12));
  const fadeOut = Math.min(1.25, Math.max(0.12, dur * 0.18));
  const fadeOutStart = Math.max(0, dur - fadeOut);

  filterParts.push(
    `[cycle]aloop=loop=${loopsNeeded}:size=2000000000,atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS[prog]`,
  );
  filterParts.push(`[${noiseIdx}:a]${profile.noiseFilter}[tex]`);
  filterParts.push(
    `[prog][tex]amix=inputs=2:normalize=0,${profile.postFilter},afade=t=in:st=0:d=${fadeIn.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)},alimiter=limit=0.86,aformat=sample_rates=44100:channel_layouts=stereo[outa]`,
  );

  const codecArgs = getAudioCodecArgs(outPath, "192k");
  const res = await runCommand(
    "ffmpeg",
    [
      "-y",
      ...inputs,
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "[outa]",
      "-t",
      dur.toFixed(3),
      ...codecArgs,
      outPath,
    ],
    { shell: false, env: getToolEnv() },
  );

  if (res.code !== 0 || !fs.existsSync(outPath)) {
    throw new Error(
      `FFmpeg BGM synthesis failed for mood "${moodKey}": ${(res.stderr || res.stdout).trim().slice(-500)}`,
    );
  }
  const stat = fs.statSync(outPath);
  if (stat.size <= 0) {
    throw new Error(`Synthesized BGM file is empty at ${outPath}`);
  }

  return {
    ok: true,
    mood: moodKey,
    durationSeconds: dur,
    outPath,
    sizeBytes: stat.size,
  };
}

function mergeSpeechWindows(rawWindows, mergeGapSec = 0.4) {
  const valid = rawWindows
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .map((w) => ({ start: Math.max(0, w.start), end: w.end }))
    .sort((a, b) => a.start - b.start);

  if (valid.length === 0) return [];

  const merged = [valid[0]];
  for (let i = 1; i < valid.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = valid[i];
    if (curr.start <= prev.end + mergeGapSec) {
      prev.end = Math.max(prev.end, curr.end);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

function buildBgmDuckingVolumeExpr(baseVolume, mergedWindows) {
  const vol = clamp(Number(baseVolume) || 0, 0, 1.5);
  if (mergedWindows.length === 0 || vol === 0) {
    return { expr: vol.toFixed(4), dynamic: false };
  }

  const attack = 0.15;
  const release = 0.28;
  const duckReduction = 0.74; // Ducks BGM to 26% (~ -11.7 dB) during speech windows

  const windowTerms = mergedWindows.map((w) => {
    const rampStart = (w.start - attack).toFixed(3);
    const rampEnd = (w.end + release).toFixed(3);
    return `clip(min((t-(${rampStart}))/${attack},((${rampEnd})-t)/${release}),0,1)`;
  });

  const combinedActivity =
    windowTerms.length === 1 ? windowTerms[0] : `min(1,${windowTerms.join("+")})`;
  return {
    expr: `${vol.toFixed(4)}*(1-${duckReduction}*${combinedActivity})`,
    dynamic: true,
  };
}

export async function masterAudioTimeline({
  durationSeconds,
  bgmPath = null,
  bgmVolume = 0.16,
  voiceClips = [],
  sfxCues = [],
  outPath,
  normalizeLoudness = true,
}) {
  const totalDur = Number(durationSeconds);
  if (!Number.isFinite(totalDur) || totalDur <= 0) {
    throw new Error(`masterAudioTimeline requires durationSeconds > 0 (got ${durationSeconds})`);
  }
  if (!outPath || typeof outPath !== "string") {
    throw new Error("masterAudioTimeline requires a valid outPath string");
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const preparedVoiceClips = [];
  const rawSpeechWindows = [];

  for (const clip of Array.isArray(voiceClips) ? voiceClips : []) {
    const clipPath = clip?.path || clip?.filePath;
    if (!clipPath || !fs.existsSync(clipPath)) {
      throw new Error(`Voice clip file not found: ${clipPath}`);
    }
    const startSec = Math.max(0, Number(clip.startSec ?? clip.startSeconds ?? 0) || 0);
    if (startSec >= totalDur) continue;

    const rawDurationSec = await probeAudioDuration(clipPath);
    const targetDurationSec = Number(clip.targetDurationSec ?? clip.targetDurationSeconds ?? 0);
    let tempo = 1.0;
    if (targetDurationSec > 0 && rawDurationSec > targetDurationSec) {
      tempo = Math.round(clamp(rawDurationSec / targetDurationSec, 0.85, 1.45) * 10000) / 10000;
    }

    const effectiveDurationSec = Math.min(totalDur - startSec, rawDurationSec / tempo);
    const volume = clamp(Number(clip.volume ?? 1.0) || 1.0, 0, 2.5);

    preparedVoiceClips.push({
      path: clipPath,
      startSec,
      rawDurationSec: Math.round(rawDurationSec * 1000) / 1000,
      targetDurationSec: targetDurationSec > 0 ? targetDurationSec : null,
      tempo,
      effectiveDurationSec: Math.round(effectiveDurationSec * 1000) / 1000,
      volume,
    });

    rawSpeechWindows.push({
      start: startSec,
      end: Math.min(totalDur, startSec + effectiveDurationSec),
    });
  }

  const preparedSfxCues = [];
  for (const cue of Array.isArray(sfxCues) ? sfxCues : []) {
    const cuePath = cue?.path || cue?.filePath;
    if (!cuePath || !fs.existsSync(cuePath)) {
      throw new Error(`SFX cue file not found: ${cuePath}`);
    }
    const startSec = Math.max(0, Number(cue.startSec ?? cue.startSeconds ?? 0) || 0);
    if (startSec >= totalDur) continue;
    const volume = clamp(Number(cue.volume ?? 0.5) || 0.5, 0, 2.0);
    preparedSfxCues.push({ path: cuePath, startSec, volume });
  }

  const duckingWindows = mergeSpeechWindows(rawSpeechWindows);
  const hasBgm = Boolean(bgmPath && fs.existsSync(bgmPath));
  if (bgmPath && !hasBgm) {
    throw new Error(`BGM file not found: ${bgmPath}`);
  }

  const ffmpegArgs = ["-y"];
  if (hasBgm) {
    ffmpegArgs.push("-stream_loop", "-1", "-i", bgmPath);
  } else {
    ffmpegArgs.push(
      "-f",
      "lavfi",
      "-i",
      `anullsrc=channel_layout=stereo:sample_rate=44100:d=${totalDur.toFixed(3)}`,
    );
  }

  for (const vo of preparedVoiceClips) {
    ffmpegArgs.push("-i", vo.path);
  }
  for (const sfx of preparedSfxCues) {
    ffmpegArgs.push("-i", sfx.path);
  }

  const filterGraph = [];
  const busInputs = ["[bgm_bus]"];

  if (hasBgm) {
    const { expr, dynamic } = buildBgmDuckingVolumeExpr(bgmVolume, duckingWindows);
    const volFilter = dynamic ? `volume='${expr}':eval=frame` : `volume=${expr}`;
    const bgmFadeIn = Math.min(0.35, totalDur * 0.08);
    const bgmFadeOut = Math.min(0.75, totalDur * 0.15);
    const bgmFadeOutStart = Math.max(0, totalDur - bgmFadeOut);
    filterGraph.push(
      `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS,${volFilter},afade=t=in:st=0:d=${bgmFadeIn.toFixed(3)},afade=t=out:st=${bgmFadeOutStart.toFixed(3)}:d=${bgmFadeOut.toFixed(3)}[bgm_bus]`,
    );
  } else {
    filterGraph.push(
      `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS[bgm_bus]`,
    );
  }

  let currentInputIndex = 1;
  for (let i = 0; i < preparedVoiceClips.length; i++) {
    const vo = preparedVoiceClips[i];
    const chain = [];
    if (Math.abs(vo.tempo - 1.0) > 0.0005) {
      chain.push(`atempo=${vo.tempo.toFixed(4)}`);
    }
    chain.push(
      "highpass=f=75",
      "aformat=sample_rates=44100:channel_layouts=stereo",
      `volume=${vo.volume.toFixed(3)}`,
    );
    const delayMs = Math.round(vo.startSec * 1000);
    if (delayMs > 0) {
      chain.push(`adelay=${delayMs}|${delayMs}`);
    }
    const label = `[vo_${i}]`;
    filterGraph.push(`[${currentInputIndex}:a]${chain.join(",")}${label}`);
    busInputs.push(label);
    currentInputIndex++;
  }

  for (let i = 0; i < preparedSfxCues.length; i++) {
    const sfx = preparedSfxCues[i];
    const chain = [
      "aformat=sample_rates=44100:channel_layouts=stereo",
      `volume=${sfx.volume.toFixed(3)}`,
    ];
    const delayMs = Math.round(sfx.startSec * 1000);
    if (delayMs > 0) {
      chain.push(`adelay=${delayMs}|${delayMs}`);
    }
    const label = `[sfx_${i}]`;
    filterGraph.push(`[${currentInputIndex}:a]${chain.join(",")}${label}`);
    busInputs.push(label);
    currentInputIndex++;
  }

  const hasActiveSignal = hasBgm || preparedVoiceClips.length > 0 || preparedSfxCues.length > 0;

  const masterPost = [];
  if (normalizeLoudness && hasActiveSignal) {
    masterPost.push("loudnorm=I=-16:TP=-1.5:LRA=20", "aresample=44100");
  }
  masterPost.push(
    `atrim=0:${totalDur.toFixed(3)}`,
    "asetpts=PTS-STARTPTS",
    "alimiter=limit=0.92",
    "aformat=sample_rates=44100:channel_layouts=stereo",
  );

  filterGraph.push(
    `${busInputs.join("")}amix=inputs=${busInputs.length}:duration=first:dropout_transition=0:normalize=0,${masterPost.join(",")}[outa]`,
  );

  const codecArgs = getAudioCodecArgs(outPath, "192k");
  ffmpegArgs.push(
    "-filter_complex",
    filterGraph.join(";"),
    "-map",
    "[outa]",
    "-t",
    totalDur.toFixed(3),
    ...codecArgs,
    outPath,
  );

  const res = await runCommand("ffmpeg", ffmpegArgs, { shell: false, env: getToolEnv() });
  if (res.code !== 0 || !fs.existsSync(outPath)) {
    throw new Error(
      `masterAudioTimeline FFmpeg mix failed: ${(res.stderr || res.stdout).trim().slice(-600)}`,
    );
  }
  const stat = fs.statSync(outPath);
  if (stat.size <= 0) {
    throw new Error(`Mastered audio output is empty at ${outPath}`);
  }

  return {
    ok: true,
    outPath,
    durationSeconds: totalDur,
    sizeBytes: stat.size,
    appliedVoiceClips: preparedVoiceClips,
    duckingWindows,
    normalizeLoudness: Boolean(normalizeLoudness),
  };
}

export async function detectAudioBeats({
  audioPath,
  minIntervalSec = 0.25,
  sensitivity = 1.35,
  maxBeats = 128,
}) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found for beat detection: ${audioPath}`);
  }

  const sampleRate = 4000;
  const hopSamples = 80; // 20ms hop = 50 Hz onset envelope resolution
  const frameSec = hopSamples / sampleRate;
  const rawPcmPath = path.join(os.tmpdir(), `studio-beat-${crypto.randomUUID()}.s16le`);

  try {
    const res = await runCommand(
      "ffmpeg",
      [
        "-y",
        "-i",
        audioPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(sampleRate),
        "-f",
        "s16le",
        rawPcmPath,
      ],
      { shell: false, env: getToolEnv() },
    );

    if (res.code !== 0 || !fs.existsSync(rawPcmPath)) {
      throw new Error(
        `FFmpeg PCM decode failed during beat detection: ${(res.stderr || "").trim().slice(-400)}`,
      );
    }

    const buf = fs.readFileSync(rawPcmPath);
    const totalSamples = Math.floor(buf.byteLength / 2);
    const samples = new Int16Array(buf.buffer, buf.byteOffset, totalSamples);
    const durationSeconds = Math.round((totalSamples / sampleRate) * 1000) / 1000;
    const frameCount = Math.floor(totalSamples / hopSamples);

    if (frameCount < 3) {
      return { ok: true, durationSeconds, bpm: null, beatCount: 0, beatTimes: [] };
    }

    const rms = new Float64Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      let sumSq = 0;
      const offset = f * hopSamples;
      for (let i = 0; i < hopSamples; i++) {
        const norm = samples[offset + i] / 32768;
        sumSq += norm * norm;
      }
      rms[f] = Math.sqrt(sumSq / hopSamples);
    }

    const flux = new Float64Array(frameCount);
    flux[0] = rms[0];
    for (let f = 1; f < frameCount; f++) {
      const diff = rms[f] - rms[f - 1];
      flux[f] = diff > 0 ? diff : 0;
    }

    const halfWin = 20; // +/- 0.4s local adaptive threshold window
    const minRefractoryFrames = Math.max(1, Math.round(minIntervalSec / frameSec));
    const noiseFloor = 0.012;
    const beatTimes = [];
    let lastBeatFrame = -minRefractoryFrames - 1;

    for (let f = 0; f < frameCount; f++) {
      const left = f > 0 ? flux[f - 1] : 0;
      const right = f + 1 < frameCount ? flux[f + 1] : 0;
      if (flux[f] < left || flux[f] < right || flux[f] < noiseFloor) continue;
      if (f - lastBeatFrame < minRefractoryFrames) continue;

      const wStart = Math.max(0, f - halfWin);
      const wEnd = Math.min(frameCount - 1, f + halfWin);
      const count = wEnd - wStart + 1;
      let mean = 0;
      for (let k = wStart; k <= wEnd; k++) mean += flux[k];
      mean /= count;

      let variance = 0;
      for (let k = wStart; k <= wEnd; k++) {
        const d = flux[k] - mean;
        variance += d * d;
      }
      const stdDev = Math.sqrt(variance / count);
      const threshold = mean + sensitivity * stdDev;

      if (flux[f] >= threshold) {
        beatTimes.push(Math.round(f * frameSec * 1000) / 1000);
        lastBeatFrame = f;
        if (beatTimes.length >= maxBeats) break;
      }
    }

    let bpm = null;
    if (beatTimes.length >= 3) {
      const intervals = [];
      for (let i = 1; i < beatTimes.length; i++) {
        const dt = beatTimes[i] - beatTimes[i - 1];
        if (dt >= 0.2 && dt <= 2.0) intervals.push(dt);
      }
      if (intervals.length > 0) {
        intervals.sort((a, b) => a - b);
        const medianInterval = intervals[Math.floor(intervals.length / 2)];
        let rawBpm = 60 / medianInterval;
        while (rawBpm < 70) rawBpm *= 2;
        while (rawBpm > 175) rawBpm /= 2;
        bpm = Math.round(rawBpm * 10) / 10;
      }
    }

    return {
      ok: true,
      durationSeconds,
      bpm,
      beatCount: beatTimes.length,
      beatTimes,
    };
  } finally {
    if (fs.existsSync(rawPcmPath)) {
      try {
        fs.unlinkSync(rawPcmPath);
      } catch {
        // Best-effort temp cleanup
      }
    }
  }
}

import fs from "node:fs";
import path from "node:path";
import { PROJECTS_DIR, probeMedia } from "./lib.mjs";
import { detectAudioBeats } from "./sound-engine.mjs";

const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round6(value) {
  return Number(Number(value || 0).toFixed(6));
}

export function snapTimeToFrame(seconds, fps = 30) {
  const safeFps = clamp(Math.round(Number(fps) || 30), 12, 120);
  const clampedSec = Math.max(0, Number(seconds) || 0);
  const frame = Math.round(clampedSec * safeFps);
  return {
    frame,
    fps: safeFps,
    seconds: round6(frame / safeFps),
  };
}

export function quantizeBeatGrid(beatTimes, fps = 30) {
  const safeFps = clamp(Math.round(Number(fps) || 30), 12, 120);
  const seenFrames = new Set();
  const quantized = [];

  for (const raw of Array.isArray(beatTimes) ? beatTimes : []) {
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 0) continue;
    const { frame, seconds } = snapTimeToFrame(val, safeFps);
    if (!seenFrames.has(frame)) {
      seenFrames.add(frame);
      quantized.push(seconds);
    }
  }

  return quantized.sort((a, b) => a - b);
}

function resolveProjectFolder(slug, projectsDir = PROJECTS_DIR) {
  if (!slug) return null;
  if (!SAFE_ID_RE.test(slug)) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  const root = path.resolve(projectsDir);
  const projectDir = path.resolve(root, slug);
  if (!projectDir.startsWith(root + path.sep)) {
    throw new Error(`Unsafe project path: ${slug}`);
  }
  return projectDir;
}

function resolveAudioCandidate(projectDir, explicitAudioPath) {
  if (explicitAudioPath) {
    if (path.isAbsolute(explicitAudioPath)) {
      const abs = path.resolve(explicitAudioPath);
      if (!fs.existsSync(abs)) {
        throw new Error(`Audio file not found for beat quantization: ${abs}`);
      }
      return abs;
    }
    if (!projectDir) {
      const abs = path.resolve(explicitAudioPath);
      if (!fs.existsSync(abs)) {
        throw new Error(`Audio file not found for beat quantization: ${abs}`);
      }
      return abs;
    }
    const cleanRel = String(explicitAudioPath).replaceAll("\\", "/").replace(/^\/+/, "");
    if (cleanRel.includes("..")) {
      throw new Error(`Unsafe relative audioPath: ${explicitAudioPath}`);
    }
    const abs = path.resolve(projectDir, cleanRel);
    if (!abs.startsWith(projectDir + path.sep)) {
      throw new Error(`Audio path escapes project directory: ${explicitAudioPath}`);
    }
    if (!fs.existsSync(abs)) {
      throw new Error(`Audio file not found in project: ${cleanRel}`);
    }
    return abs;
  }

  if (!projectDir || !fs.existsSync(projectDir)) return null;

  const preferredRelPaths = ["assets/audio/compiled_master.mp3", "assets/audio/original_voice.mp3"];
  for (const rel of preferredRelPaths) {
    const cand = path.join(projectDir, rel);
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return cand;
    }
  }

  const audioDirs = ["inbox/audio", "assets/audio"];
  for (const sub of audioDirs) {
    const absDir = path.join(projectDir, sub);
    if (!fs.existsSync(absDir)) continue;
    const files = fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.isFile() && AUDIO_EXTS.has(path.extname(e.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (files.length > 0) {
      return path.join(absDir, files[0].name);
    }
  }

  const videoDirs = ["inbox/inspiration", "inbox/raw-video"];
  for (const sub of videoDirs) {
    const absDir = path.join(projectDir, sub);
    if (!fs.existsSync(absDir)) continue;
    const files = fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.isFile() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (files.length > 0) {
      return path.join(absDir, files[0].name);
    }
  }

  return null;
}

function estimateNominalVelocityPeakRatio(frame) {
  const ease = String(frame?.cameraMotion?.ease || "").toLowerCase();
  const preset = String(frame?.motionPreset || frame?.cameraMotion?.presetId || "").toLowerCase();

  if (
    ease.includes("inout") ||
    preset.includes("whip") ||
    preset.includes("spotlight") ||
    preset.includes("tilt")
  ) {
    return 0.5;
  }
  if (
    ease.includes(".out") ||
    preset.includes("crash") ||
    preset.includes("dolly-out") ||
    preset.includes("kinetic")
  ) {
    return 0.2;
  }
  return 0.42;
}

function buildFallbackBeatGrid(horizonSeconds, bpm = 120, fps = 30) {
  const interval = 60 / clamp(bpm, 60, 180);
  const raw = [];
  for (let t = 0; t <= horizonSeconds + interval; t += interval) {
    raw.push(t);
  }
  return quantizeBeatGrid(raw, fps);
}

export async function quantizeStoryboardToBeats({
  slug = null,
  storyboard = null,
  audioPath = null,
  fps = 30,
  maxSnapSec = 0.35,
  minShotDurationSec = 1.0,
  persist = true,
  projectsDir = PROJECTS_DIR,
} = {}) {
  const safeFps = clamp(Math.round(Number(fps) || 30), 12, 120);
  const snapWindow = clamp(Number(maxSnapSec) || 0.35, 0.02, 1.5);
  const minFrames = Math.max(
    6,
    Math.round(Math.max(0.4, Number(minShotDurationSec) || 1.0) * safeFps),
  );

  const projectDir = resolveProjectFolder(slug, projectsDir);
  let workingStoryboard = storyboard ? structuredClone(storyboard) : null;

  if (!workingStoryboard) {
    if (!projectDir) {
      throw new Error(
        "quantizeStoryboardToBeats requires either a storyboard object or a valid project slug",
      );
    }
    const sbPath = path.join(projectDir, "STORYBOARD.json");
    if (!fs.existsSync(sbPath)) {
      throw new Error(`STORYBOARD.json not found for project "${slug}"`);
    }
    workingStoryboard = JSON.parse(fs.readFileSync(sbPath, "utf8"));
  }

  const frames = Array.isArray(workingStoryboard.frames) ? workingStoryboard.frames : [];
  const nominalTotalDur = Math.max(
    4.0,
    frames.reduce((sum, f) => sum + Math.max(0.5, Number(f.durationSeconds || 3.0)), 0) + 4.0,
  );

  const resolvedAudioPath = resolveAudioCandidate(projectDir, audioPath);
  let beatSource = "rhythmic-fallback-120bpm";
  let bpm = 120;
  let quantizedBeats = [];

  if (resolvedAudioPath) {
    let canAnalyzeAudio = true;
    if (VIDEO_EXTS.has(path.extname(resolvedAudioPath).toLowerCase())) {
      const meta = await probeMedia(resolvedAudioPath);
      canAnalyzeAudio = Boolean(meta.hasAudio);
    }

    if (canAnalyzeAudio) {
      const detected = await detectAudioBeats({
        audioPath: resolvedAudioPath,
        minIntervalSec: 0.22,
        maxBeats: 256,
      });
      if (detected.beatTimes.length >= 2) {
        quantizedBeats = quantizeBeatGrid(detected.beatTimes, safeFps);
        bpm = detected.bpm || 120;
        beatSource = "detected-audio";
      }
    }
  }

  if (quantizedBeats.length === 0) {
    let fallbackBpm = 120;
    if (projectDir) {
      const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
      if (fs.existsSync(briefPath)) {
        try {
          const brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
          const cutsPerMin = Number(brief?.inspirationProfile?.cutsPerMinute || 0);
          if (cutsPerMin >= 15) {
            fallbackBpm = clamp(Math.round(cutsPerMin * 4), 84, 150);
          }
        } catch {
          // Use default 120 BPM
        }
      }
    }
    bpm = fallbackBpm;
    quantizedBeats = buildFallbackBeatGrid(nominalTotalDur, bpm, safeFps);
  }

  let cursorSec = 0;
  let snappedCutCount = 0;
  let snappedVelocityPeakCount = 0;
  let lockedPreservedCount = 0;
  const cuts = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const frameId = frame.id || `frame_${String(i + 1).padStart(2, "0")}`;
    const prevDurationSec = Math.max(0.4, Number(frame.durationSeconds || 3.0));

    if (frame.locked === true) {
      lockedPreservedCount += 1;
      const startSec = round6(cursorSec);
      const endSec = round6(cursorSec + prevDurationSec);
      cursorSec = endSec;

      cuts.push({
        frameId,
        index: frame.index ?? i + 1,
        locked: true,
        previousDurationSec: prevDurationSec,
        durationSeconds: frame.durationSeconds,
        startTime: startSec,
        endTime: endSec,
        snappedToBeat: false,
        snapDeltaSec: 0,
      });
      continue;
    }

    const startSnap = snapTimeToFrame(cursorSec, safeFps);
    const nominalEndSec = cursorSec + prevDurationSec;
    const minEndSec = cursorSec + minFrames / safeFps;

    let chosenBeat = null;
    let bestDist = Infinity;
    for (const b of quantizedBeats) {
      if (b < minEndSec - 1e-6) continue;
      const dist = Math.abs(b - nominalEndSec);
      if (dist <= snapWindow && dist < bestDist) {
        bestDist = dist;
        chosenBeat = b;
      }
    }

    const targetEndSec = chosenBeat !== null ? chosenBeat : Math.max(minEndSec, nominalEndSec);
    const durationFrames = Math.max(minFrames, Math.round((targetEndSec - cursorSec) * safeFps));
    const quantizedDurationSec = round6(durationFrames / safeFps);
    const shotStartSec = round6(cursorSec);
    const shotEndSec = round6(cursorSec + quantizedDurationSec);
    const snappedToBeat = chosenBeat !== null;
    const snapDeltaSec = round6(shotEndSec - nominalEndSec);

    if (snappedToBeat) {
      snappedCutCount += 1;
    }

    // Quantize internal camera velocity peak onto nearest transient or exact 1/fps frame
    const nominalPeakRatio = estimateNominalVelocityPeakRatio(frame);
    const nominalPeakGlobal = shotStartSec + quantizedDurationSec * nominalPeakRatio;
    const minPeakGlobal = shotStartSec + 2 / safeFps;
    const maxPeakGlobal = Math.max(minPeakGlobal, shotEndSec - 2 / safeFps);

    let peakBeat = null;
    let bestPeakDist = Infinity;
    for (const b of quantizedBeats) {
      if (b < minPeakGlobal || b > maxPeakGlobal) continue;
      const dist = Math.abs(b - nominalPeakGlobal);
      if (dist <= snapWindow && dist < bestPeakDist) {
        bestPeakDist = dist;
        peakBeat = b;
      }
    }

    if (peakBeat !== null) {
      snappedVelocityPeakCount += 1;
    }

    const targetPeakLocalSec = (peakBeat !== null ? peakBeat : nominalPeakGlobal) - shotStartSec;
    const velocityPeakFrame = clamp(
      Math.round(targetPeakLocalSec * safeFps),
      1,
      Math.max(1, durationFrames - 1),
    );
    const velocityPeakSec = round6(velocityPeakFrame / safeFps);
    const velocityPeakGlobalSec = round6(shotStartSec + velocityPeakSec);
    const velocityPeakRatio = Number((velocityPeakFrame / Math.max(1, durationFrames)).toFixed(4));

    frame.durationSeconds = quantizedDurationSec;
    frame.beatSync = {
      quantized: true,
      fps: safeFps,
      startFrame: startSnap.frame,
      endFrame: startSnap.frame + durationFrames,
      durationFrames,
      startTime: shotStartSec,
      endTime: shotEndSec,
      snappedToBeat,
      snapDeltaSec,
      velocityPeakFrame,
      velocityPeakSec,
      velocityPeakGlobalSec,
      velocityPeakRatio,
    };

    frame.cameraMotion = {
      ...(frame.cameraMotion && typeof frame.cameraMotion === "object" ? frame.cameraMotion : {}),
      velocityPeakFrame,
      velocityPeakSec,
      velocityPeakRatio,
    };

    cursorSec = shotEndSec;

    cuts.push({
      frameId,
      index: frame.index ?? i + 1,
      locked: false,
      previousDurationSec: prevDurationSec,
      durationSeconds: quantizedDurationSec,
      startFrame: startSnap.frame,
      endFrame: startSnap.frame + durationFrames,
      durationFrames,
      startTime: shotStartSec,
      endTime: shotEndSec,
      snappedToBeat,
      snapDeltaSec,
      velocityPeakFrame,
      velocityPeakSec,
      velocityPeakGlobalSec,
    });
  }

  const totalDurationSeconds = round6(
    frames.reduce((acc, f) => acc + Number(f.durationSeconds || 0), 0),
  );
  const totalFrames = Math.round(totalDurationSeconds * safeFps);

  const updatedStoryboard = {
    ...workingStoryboard,
    slug: slug || workingStoryboard.slug || "project",
    frames,
    frameCount: frames.length,
    lockedCount: frames.filter((f) => Boolean(f.locked)).length,
    approvedCount: frames.filter((f) => Boolean(f.approved)).length,
    totalDurationSeconds,
    beatQuantization: {
      fps: safeFps,
      bpm,
      beatSource,
      beatCount: quantizedBeats.length,
      snappedCutCount,
      snappedVelocityPeakCount,
      lockedPreservedCount,
      maxSnapSec: snapWindow,
      quantizedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  if (persist && projectDir && fs.existsSync(projectDir)) {
    const sbPath = path.join(projectDir, "STORYBOARD.json");
    fs.writeFileSync(sbPath, JSON.stringify(updatedStoryboard, null, 2) + "\n", "utf8");
  }

  return {
    ok: true,
    slug: slug || workingStoryboard.slug || null,
    fps: safeFps,
    audioSourcePath: resolvedAudioPath,
    beatSource,
    bpm,
    beatCount: quantizedBeats.length,
    beatTimes: quantizedBeats,
    snappedCutCount,
    snappedVelocityPeakCount,
    lockedPreservedCount,
    totalDurationSeconds,
    totalFrames,
    cuts,
    storyboard: updatedStoryboard,
  };
}

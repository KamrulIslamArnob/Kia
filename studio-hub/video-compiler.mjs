import fs from "node:fs";
import path from "node:path";
import {
  ROOT_DIR,
  assertValidSlug,
  ensureProjectDirs,
  probeMedia,
  runCommand,
  syncProjectManifest,
} from "./lib.mjs";
import { getProviderSettings } from "./agent-bridge.mjs";

export const LAYOUT_ARCHETYPES = Object.freeze([
  "device-3d-showcase",
  "split-editorial",
  "fullbleed-cinema",
  "bento-feature-grid",
  "spotlight-cursor-zoom",
  "kinetic-statement-card",
]);

const ASPECT_MAP = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeIdToken(raw, fallback) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function resolveCanvasDimensions(aspectRatio, resolution, brief) {
  const base = ASPECT_MAP[aspectRatio] || {
    width: Number(brief?.width) || 1080,
    height: Number(brief?.height) || 1920,
  };
  const normRes = String(resolution || "1080p").toLowerCase();
  const scale = normRes === "720p" ? 2 / 3 : normRes === "4k" ? 2 : 1;
  return {
    width: Math.round((base.width * scale) / 2) * 2,
    height: Math.round((base.height * scale) / 2) * 2,
  };
}

function detectDefaultVoice(text, brief) {
  if (
    /[\u0980-\u09FF]/.test(String(text || "")) ||
    /bengali|বাংলা/i.test(String(brief?.language || ""))
  ) {
    return "bn-BD-NabanitaNeural";
  }
  return "en-US-AriaNeural";
}

function normalizeSfxList(rawSfx, shotIndex, totalShots) {
  if (rawSfx === "none" || rawSfx === false) return [];
  if (Array.isArray(rawSfx)) {
    return rawSfx
      .map((s) =>
        String(s || "")
          .trim()
          .toLowerCase(),
      )
      .filter((s) => s === "whoosh" || s === "pop" || s === "chime");
  }
  if (typeof rawSfx === "string" && rawSfx.trim()) {
    return rawSfx
      .split(/[,+\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s === "whoosh" || s === "pop" || s === "chime");
  }
  if (shotIndex === totalShots - 1) return ["whoosh", "chime"];
  if (shotIndex > 0) return ["whoosh", "pop"];
  return ["pop"];
}

function normalizeFrame(rawFrame, index, totalShots, brief) {
  const shotNum = String(index + 1).padStart(2, "0");
  const sceneId = `scene_${shotNum}`;
  const frameId = sanitizeIdToken(rawFrame?.id, `frame_${shotNum}`);
  const durationSeconds =
    Math.round(
      clamp(Number(rawFrame?.durationSeconds ?? rawFrame?.duration) || 3.5, 1.0, 60.0) * 100,
    ) / 100;
  const speedFactor = clamp(
    Number(rawFrame?.speedFactor ?? rawFrame?.staging?.speedFactor) || 1.0,
    0.25,
    4.0,
  );

  const requestedLayout = String(
    rawFrame?.layout ||
      rawFrame?.layoutArchetype ||
      rawFrame?.staging?.layout ||
      rawFrame?.staging?.layoutArchetype ||
      "",
  ).trim();
  const layout = LAYOUT_ARCHETYPES.includes(requestedLayout)
    ? requestedLayout
    : LAYOUT_ARCHETYPES[index % LAYOUT_ARCHETYPES.length];

  const sourceClip =
    rawFrame?.aiVideoClip ||
    rawFrame?.sourceClip ||
    rawFrame?.clipSrc ||
    rawFrame?.clip_src ||
    rawFrame?.staging?.sourceClip ||
    null;

  const rawTimeRange = Array.isArray(rawFrame?.rawTimeRange)
    ? rawFrame.rawTimeRange
    : Array.isArray(rawFrame?.timeRange)
      ? rawFrame.timeRange
      : null;

  const camSrc =
    rawFrame?.cameraMotion ||
    rawFrame?.staging?.camera ||
    rawFrame?.staging?.cameraMotion ||
    rawFrame?.staging?.motion ||
    rawFrame?.camera ||
    rawFrame?.motion ||
    {};

  const fromScale = clamp(Number(camSrc.fromScale) || 1.0, 0.75, 2.2);
  const toScale = clamp(
    Number(camSrc.toScale) || (fromScale === 1.0 ? 1.08 : fromScale + 0.08),
    0.75,
    2.4,
  );
  const panX = clamp(Number(camSrc.panX) || 0, -48, 48);
  const panY = clamp(Number(camSrc.panY) || 0, -48, 48);
  const tiltDeg = clamp(Number(camSrc.tiltDeg) || 0, -14, 14);
  const rawFocusX = Number(camSrc.focusX);
  const rawFocusY = Number(camSrc.focusY);
  const focusX = clamp(
    Number.isFinite(rawFocusX) ? (rawFocusX > 1 ? rawFocusX / 100 : rawFocusX) : 0.5,
    0.15,
    0.85,
  );
  const focusY = clamp(
    Number.isFinite(rawFocusY) ? (rawFocusY > 1 ? rawFocusY / 100 : rawFocusY) : 0.5,
    0.15,
    0.85,
  );
  const ease = String(camSrc.ease || "power2.out");

  const staging = rawFrame?.staging || {};
  const copy = rawFrame?.copy || {};
  const audioSpec = rawFrame?.audioSpec || {};

  const badge = String(
    staging.badge ||
      staging.badgeText ||
      copy.badge ||
      rawFrame?.badge ||
      rawFrame?.badgeText ||
      `SHOT ${shotNum}`,
  ).trim();
  const headline = String(
    staging.headline ||
      copy.headline ||
      rawFrame?.headline ||
      rawFrame?.title ||
      rawFrame?.name ||
      brief?.title ||
      `Scene ${shotNum}`,
  ).trim();
  const subheadline = String(
    staging.subheadline ||
      copy.subheadline ||
      rawFrame?.subheadline ||
      rawFrame?.description ||
      "Precision visual storytelling crafted in Director Studio Pro.",
  ).trim();
  const voiceoverText = String(audioSpec.voiceoverText ?? rawFrame?.voiceoverText ?? "").trim();
  const caption = String(
    staging.caption ||
      staging.captionText ||
      copy.caption ||
      rawFrame?.caption ||
      voiceoverText ||
      subheadline,
  ).trim();

  const calloutStrings =
    Array.isArray(staging.calloutItems) && staging.calloutItems.length >= 3
      ? staging.calloutItems
          .slice(0, 3)
          .map((item) =>
            typeof item === "string"
              ? item
              : `${item?.label || "SPEC"}: ${item?.value || ""}`.trim(),
          )
      : null;

  const bullets =
    Array.isArray(staging.bullets) && staging.bullets.length >= 3
      ? staging.bullets.slice(0, 3).map(String)
      : calloutStrings || [
          "Instant Smart Workflow",
          "Verified Studio Quality",
          "Zero-Friction Delivery",
        ];

  const plateCandidate =
    staging.aiBackgroundPlate ||
    rawFrame?.aiBackgroundPlate ||
    staging.plateImage ||
    rawFrame?.plateImage ||
    null;

  return {
    index,
    shotNum,
    sceneId,
    id: frameId,
    title: String(rawFrame?.title || headline),
    durationSeconds,
    speedFactor,
    layout,
    sourceClip: sourceClip ? String(sourceClip).replaceAll("\\", "/") : null,
    rawTimeRange,
    plateCandidate: plateCandidate ? String(plateCandidate).replaceAll("\\", "/") : null,
    badge,
    headline,
    subheadline,
    caption,
    bullets,
    camera: {
      fromScale,
      toScale,
      panX,
      panY,
      tiltDeg,
      focusX,
      focusY,
      ease,
    },
    audioSpec: {
      voiceoverText,
      voice: String(audioSpec.voice || detectDefaultVoice(voiceoverText || headline, brief)),
      sfx: normalizeSfxList(audioSpec.sfx, index, totalShots),
    },
    clipRelPath: null,
    plateRelPath: null,
    voRelPath: null,
  };
}

function resolveExistingProjectAsset(projectDir, relCandidate) {
  if (!relCandidate) return null;
  const cleaned = String(relCandidate).replaceAll("\\", "/").replace(/^\/+/, "");
  if (cleaned.includes("..")) return null;
  const abs = path.resolve(projectDir, cleaned);
  if (!abs.startsWith(projectDir + path.sep)) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return { abs, rel: cleaned };
}

async function sliceProjectClips({ projectDir, frames, fps, onProgress }) {
  const clipsDir = path.join(projectDir, "assets", "clips");
  fs.mkdirSync(clipsDir, { recursive: true });

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    onProgress({
      stage: "slice-clips",
      current: i + 1,
      total: frames.length,
      message: `Preparing clip for ${frame.sceneId} (${frame.id})`,
    });

    if (frame.plateCandidate) {
      const resolvedPlate = resolveExistingProjectAsset(projectDir, frame.plateCandidate);
      if (resolvedPlate) {
        if (resolvedPlate.rel.startsWith("assets/")) {
          frame.plateRelPath = resolvedPlate.rel;
        } else {
          const ext = path.extname(resolvedPlate.abs) || ".png";
          const destRel = `assets/images/plate_${frame.id}${ext}`;
          const destAbs = path.join(projectDir, destRel);
          fs.mkdirSync(path.dirname(destAbs), { recursive: true });
          fs.copyFileSync(resolvedPlate.abs, destAbs);
          frame.plateRelPath = destRel;
        }
      }
    }

    if (!frame.sourceClip) continue;
    const resolvedClip = resolveExistingProjectAsset(projectDir, frame.sourceClip);
    if (!resolvedClip) continue;

    const outRel = `assets/clips/shot_${frame.id}.mp4`;
    const outAbs = path.join(projectDir, outRel);

    if (Array.isArray(frame.rawTimeRange) && frame.rawTimeRange.length >= 2) {
      const start = Math.max(0, Number(frame.rawTimeRange[0]) || 0);
      const end = Math.max(
        start + 0.2,
        Number(frame.rawTimeRange[1]) || start + frame.durationSeconds,
      );
      const rawSliceDuration = Math.max(0.2, end - start);
      const speed = frame.speedFactor || 1.0;

      const vfChain = [
        `setpts=(1/${speed.toFixed(4)})*PTS`,
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        `tpad=stop_mode=clone:stop_duration=${Math.max(0.5, frame.durationSeconds).toFixed(2)}`,
      ].join(",");

      const args = [
        "-y",
        "-ss",
        start.toFixed(3),
        "-t",
        rawSliceDuration.toFixed(3),
        "-i",
        resolvedClip.abs,
        "-an",
        "-vf",
        vfChain,
        "-t",
        frame.durationSeconds.toFixed(3),
        "-r",
        String(fps),
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        outAbs,
      ];

      const res = await runCommand("ffmpeg", args, { cwd: ROOT_DIR, shell: false });
      if (res.code !== 0 || !fs.existsSync(outAbs)) {
        throw new Error(
          `FFmpeg slice failed for ${frame.id}: ${(res.stderr || res.stdout).trim().slice(-500)}`,
        );
      }
      frame.clipRelPath = outRel;
    } else if (resolvedClip.rel.startsWith("assets/clips/")) {
      frame.clipRelPath = resolvedClip.rel;
    } else {
      const copyArgs = [
        "-y",
        "-i",
        resolvedClip.abs,
        "-an",
        "-vf",
        `scale=trunc(iw/2)*2:trunc(ih/2)*2,tpad=stop_mode=clone:stop_duration=${Math.max(0.5, frame.durationSeconds).toFixed(2)}`,
        "-t",
        frame.durationSeconds.toFixed(3),
        "-r",
        String(fps),
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        outAbs,
      ];
      const res = await runCommand("ffmpeg", copyArgs, { cwd: ROOT_DIR, shell: false });
      if (res.code === 0 && fs.existsSync(outAbs)) {
        frame.clipRelPath = outRel;
      }
    }
  }
}

async function ensureSfxFiles(projectDir) {
  const sfxDir = path.join(projectDir, ".studio", "audio-tmp", "sfx");
  fs.mkdirSync(sfxDir, { recursive: true });

  const whooshPath = path.join(sfxDir, "whoosh.wav");
  const popPath = path.join(sfxDir, "pop.wav");
  const chimePath = path.join(sfxDir, "chime.wav");

  if (!fs.existsSync(whooshPath)) {
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anoisesrc=color=pink:sample_rate=44100:duration=0.26:amplitude=0.16",
        "-af",
        "bandpass=f=880:width_type=h:w=650,afade=t=in:st=0:d=0.07,afade=t=out:st=0.09:d=0.17,aformat=sample_rates=44100:channel_layouts=stereo",
        whooshPath,
      ],
      { cwd: ROOT_DIR, shell: false },
    );
  }

  if (!fs.existsSync(popPath)) {
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=195:sample_rate=44100:duration=0.085",
        "-af",
        "afade=t=in:st=0:d=0.005,afade=t=out:st=0.015:d=0.07,volume=0.22,aformat=sample_rates=44100:channel_layouts=stereo",
        popPath,
      ],
      { cwd: ROOT_DIR, shell: false },
    );
  }

  if (!fs.existsSync(chimePath)) {
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=523.25:sample_rate=44100:duration=0.55",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=783.99:sample_rate=44100:duration=0.55",
        "-filter_complex",
        "[0:a][1:a]amix=inputs=2:normalize=0,afade=t=in:st=0:d=0.01,afade=t=out:st=0.12:d=0.43,volume=0.16,aformat=sample_rates=44100:channel_layouts=stereo",
        chimePath,
      ],
      { cwd: ROOT_DIR, shell: false },
    );
  }

  return {
    whoosh: fs.existsSync(whooshPath) ? whooshPath : null,
    pop: fs.existsSync(popPath) ? popPath : null,
    chime: fs.existsSync(chimePath) ? chimePath : null,
  };
}

async function generateBgmBed(projectDir, totalDuration, bgmVolume) {
  const tmpDir = path.join(projectDir, ".studio", "audio-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const bgmPath = path.join(tmpDir, "bgm_bed.wav");
  const dur = Math.max(1.0, totalDuration);
  const fadeOutStart = Math.max(0.2, dur - 0.75);

  const res = await runCommand(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=196.00:sample_rate=44100:duration=${dur.toFixed(3)}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=261.63:sample_rate=44100:duration=${dur.toFixed(3)}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=329.63:sample_rate=44100:duration=${dur.toFixed(3)}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=392.00:sample_rate=44100:duration=${dur.toFixed(3)}`,
      "-filter_complex",
      `[0:a]volume=0.28[a0];[1:a]volume=0.26[a1];[2:a]volume=0.24[a2];[3:a]volume=0.18[a3];[a0][a1][a2][a3]amix=inputs=4:normalize=0,lowpass=f=1150,tremolo=f=0.4:d=0.18,afade=t=in:st=0:d=0.35,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.75,volume=${clamp(bgmVolume, 0.02, 0.6).toFixed(3)},aformat=sample_rates=44100:channel_layouts=stereo`,
      bgmPath,
    ],
    { cwd: ROOT_DIR, shell: false },
  );

  return res.code === 0 && fs.existsSync(bgmPath) ? bgmPath : null;
}

async function buildMasterAudioMix({
  projectDir,
  frames,
  totalDuration,
  includeVoiceover,
  includeBgm,
  bgmVolume,
  onProgress,
}) {
  const audioOutDir = path.join(projectDir, "assets", "audio");
  const tmpDir = path.join(projectDir, ".studio", "audio-tmp");
  fs.mkdirSync(audioOutDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  onProgress({
    stage: "audio-mix",
    progress: 0.1,
    message: "Generating neural voiceovers, SFX cues, and harmonic BGM bed",
  });

  const stems = [];
  const sfxMap = await ensureSfxFiles(projectDir);

  let cursorSeconds = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const shotStart = cursorSeconds;
    cursorSeconds = Math.round((cursorSeconds + frame.durationSeconds) * 1000) / 1000;

    if (includeVoiceover && frame.audioSpec.voiceoverText) {
      const rawVoPath = path.join(tmpDir, `vo_raw_${frame.id}.mp3`);
      const fittedVoRel = `assets/audio/vo_${frame.id}.mp3`;
      const fittedVoAbs = path.join(projectDir, fittedVoRel);

      const ttsRes = await runCommand(
        "edge-tts",
        [
          "--voice",
          frame.audioSpec.voice,
          "--text",
          frame.audioSpec.voiceoverText,
          "--write-media",
          rawVoPath,
        ],
        {
          cwd: ROOT_DIR,
          shell: false,
          env: { PYTHONIOENCODING: "utf-8" },
        },
      );

      if (ttsRes.code === 0 && fs.existsSync(rawVoPath) && fs.statSync(rawVoPath).size > 200) {
        const voMeta = await probeMedia(rawVoPath);
        const maxVoBudget = Math.max(1.2, frame.durationSeconds - 0.25);
        const rawDur = Number(voMeta.duration) || 0;

        const filterParts = [];
        if (rawDur > maxVoBudget && maxVoBudget > 0) {
          const tempo = clamp(rawDur / maxVoBudget, 0.85, 1.45);
          filterParts.push(`atempo=${tempo.toFixed(4)}`);
        }
        filterParts.push("aformat=sample_rates=44100:channel_layouts=stereo");

        const fitRes = await runCommand(
          "ffmpeg",
          [
            "-y",
            "-i",
            rawVoPath,
            "-filter:a",
            filterParts.join(","),
            "-t",
            frame.durationSeconds.toFixed(3),
            "-c:a",
            "libmp3lame",
            "-b:a",
            "160k",
            fittedVoAbs,
          ],
          { cwd: ROOT_DIR, shell: false },
        );

        if (fitRes.code === 0 && fs.existsSync(fittedVoAbs)) {
          frame.voRelPath = fittedVoRel;
          stems.push({
            filePath: fittedVoAbs,
            startSeconds: shotStart + 0.06,
            volume: 1.0,
          });
        }
      }
    }

    for (const cue of frame.audioSpec.sfx) {
      const sfxFile = sfxMap[cue];
      if (!sfxFile) continue;
      const cueOffset =
        cue === "whoosh"
          ? 0.02
          : cue === "pop"
            ? 0.22
            : Math.max(0.15, frame.durationSeconds * 0.45);
      stems.push({
        filePath: sfxFile,
        startSeconds: shotStart + Math.min(cueOffset, Math.max(0, frame.durationSeconds - 0.15)),
        volume: 0.45,
      });
    }
  }

  let baseTrackPath = null;
  if (includeBgm) {
    baseTrackPath = await generateBgmBed(projectDir, totalDuration, bgmVolume);
  }
  if (!baseTrackPath) {
    const silentPath = path.join(tmpDir, "silent_base.wav");
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `anullsrc=channel_layout=stereo:sample_rate=44100`,
        "-t",
        totalDuration.toFixed(3),
        silentPath,
      ],
      { cwd: ROOT_DIR, shell: false },
    );
    baseTrackPath = silentPath;
  }

  const masterRelPath = "assets/audio/compiled_master.mp3";
  const masterAbsPath = path.join(projectDir, masterRelPath);

  const mixArgs = ["-y", "-i", baseTrackPath];
  for (const stem of stems) {
    mixArgs.push("-i", stem.filePath);
  }

  const chainDefs = ["[0:a]aformat=sample_rates=44100:channel_layouts=stereo[s0]"];
  const mixInputs = ["[s0]"];
  for (let idx = 0; idx < stems.length; idx++) {
    const inputIdx = idx + 1;
    const stem = stems[idx];
    const delayMs = Math.max(0, Math.round(stem.startSeconds * 1000));
    const delayPart = delayMs > 0 ? `,adelay=${delayMs}|${delayMs}` : "";
    chainDefs.push(
      `[${inputIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${stem.volume.toFixed(3)}${delayPart}[s${inputIdx}]`,
    );
    mixInputs.push(`[s${inputIdx}]`);
  }

  const totalInputs = stems.length + 1;
  chainDefs.push(
    `${mixInputs.join("")}amix=inputs=${totalInputs}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.89[outa]`,
  );

  mixArgs.push(
    "-filter_complex",
    chainDefs.join(";"),
    "-map",
    "[outa]",
    "-t",
    totalDuration.toFixed(3),
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    masterAbsPath,
  );

  const mixRes = await runCommand("ffmpeg", mixArgs, { cwd: ROOT_DIR, shell: false });
  if (mixRes.code !== 0 || !fs.existsSync(masterAbsPath)) {
    throw new Error(
      `Master audio mix failed: ${(mixRes.stderr || mixRes.stdout).trim().slice(-500)}`,
    );
  }

  return masterRelPath;
}

function renderMediaSlotHtml({ pfx, frame }) {
  const dur = frame.durationSeconds;
  if (frame.clipRelPath) {
    return `<video id="${pfx}-video" class="clip ${pfx}-media" src="${escapeHtml(frame.clipRelPath)}" data-start="0" data-duration="${dur}" data-track-index="1" muted playsinline></video>`;
  }
  if (frame.plateRelPath) {
    return `<img id="${pfx}-plate" class="${pfx}-media" src="${escapeHtml(frame.plateRelPath)}" alt="" />`;
  }
  return `<div id="${pfx}-synth-plate" class="${pfx}-synth-plate"></div>`;
}

export function buildSceneSubCompositionHtml({
  sceneId,
  width,
  height,
  frame,
  brandColors = {},
  captionsMode = "kinetic",
}) {
  const pfx = sanitizeIdToken(sceneId, "scene_01").replaceAll("_", "");
  const dur = Number(frame.durationSeconds) || 3.0;
  const isLandscape = width >= height;
  const primary = brandColors?.primary || "#1E824C";
  const secondary = brandColors?.secondary || "#2ECC71";
  const accent = brandColors?.accent || "#F1C40F";
  const bg = brandColors?.background || "#0A1612";

  const layout = LAYOUT_ARCHETYPES.includes(frame.layout) ? frame.layout : "device-3d-showcase";

  const cam = frame.camera || {};
  const fromScale = Number(cam.fromScale) || 1.0;
  const toScale = Number(cam.toScale) || 1.08;
  const panX = Number(cam.panX) || 0;
  const panY = Number(cam.panY) || 0;
  const tiltDeg = Number(cam.tiltDeg) || 0;
  const ease = escapeHtml(cam.ease || "power2.out");

  const badgeText = escapeHtml(frame.badge || "STUDIO PRO");
  const headlineText = escapeHtml(frame.headline || frame.title || "Featured Shot");
  const subheadlineText = escapeHtml(frame.subheadline || "");
  const captionText = escapeHtml(frame.caption || "");
  const bullets =
    Array.isArray(frame.bullets) && frame.bullets.length >= 3
      ? frame.bullets.slice(0, 3).map(escapeHtml)
      : ["Precision Staging", "Adaptive Pacing", "Verified Render"];

  const mediaHtml = renderMediaSlotHtml({ pfx, frame });
  const showCaptionPill = captionsMode !== "off" && Boolean(captionText);

  const headingPx = isLandscape ? 46 : 48;
  const subPx = isLandscape ? 24 : 25;

  let bodyInnerHtml = "";
  let extraStyles = "";

  if (layout === "device-3d-showcase") {
    extraStyles = `
      .${pfx}-safe {
        display: flex;
        flex-direction: ${isLandscape ? "row" : "column"};
        align-items: center;
        justify-content: space-between;
        gap: 24px;
      }
      .${pfx}-device-shell {
        width: ${isLandscape ? "44%" : "72%"};
        height: ${isLandscape ? "86%" : "54%"};
        background: #0d1512;
        border-radius: 36px;
        padding: 12px;
        border: 3px solid ${secondary};
        box-shadow: 0 24px 56px rgba(0, 0, 0, 0.65);
        overflow: hidden;
        position: relative;
      }
      .${pfx}-copy-card {
        width: ${isLandscape ? "50%" : "100%"};
        background: #0a1612;
        border: 2px solid ${primary};
        border-radius: 26px;
        padding: 26px 28px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
    `;
    bodyInnerHtml = `
      <div id="${pfx}-card" class="${pfx}-copy-card">
        <div id="${pfx}-badge" class="${pfx}-badge">${badgeText}</div>
        <h1 id="${pfx}-headline" class="${pfx}-headline">${headlineText}</h1>
        <p id="${pfx}-subline" class="${pfx}-subline">${subheadlineText}</p>
      </div>
      <div id="${pfx}-device" class="${pfx}-device-shell" data-layout-allow-overflow>
        <div id="${pfx}-rig" class="${pfx}-rig" data-layout-allow-overflow>
          ${mediaHtml}
        </div>
      </div>
    `;
  } else if (layout === "split-editorial") {
    extraStyles = `
      .${pfx}-safe {
        display: flex;
        flex-direction: ${isLandscape ? "row" : "column"};
        align-items: stretch;
        justify-content: space-between;
        gap: 24px;
      }
      .${pfx}-media-pane {
        flex: 1 1 52%;
        border-radius: 28px;
        overflow: hidden;
        border: 2px solid ${secondary};
        background: #0d1814;
        position: relative;
      }
      .${pfx}-editorial-pane {
        flex: 1 1 44%;
        background: #0a1612;
        border: 2px solid ${primary};
        border-radius: 28px;
        padding: 28px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 14px;
      }
    `;
    bodyInnerHtml = `
      <div class="${pfx}-media-pane" data-layout-allow-overflow>
        <div id="${pfx}-rig" class="${pfx}-rig" data-layout-allow-overflow>
          ${mediaHtml}
        </div>
      </div>
      <div id="${pfx}-card" class="${pfx}-editorial-pane">
        <div id="${pfx}-badge" class="${pfx}-badge">${badgeText}</div>
        <h1 id="${pfx}-headline" class="${pfx}-headline">${headlineText}</h1>
        <p id="${pfx}-subline" class="${pfx}-subline">${subheadlineText}</p>
      </div>
    `;
  } else if (layout === "fullbleed-cinema") {
    extraStyles = `
      .${pfx}-bg-bleed {
        position: absolute;
        inset: 0;
        overflow: hidden;
      }
      .${pfx}-safe {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: flex-start;
        gap: 18px;
      }
      .${pfx}-cinema-card {
        width: 100%;
        background: #0a1612;
        border: 2px solid ${secondary};
        border-radius: 28px;
        padding: 28px 30px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.72);
      }
    `;
    bodyInnerHtml = `
      <div id="${pfx}-card" class="${pfx}-cinema-card">
        <div id="${pfx}-badge" class="${pfx}-badge">${badgeText}</div>
        <h1 id="${pfx}-headline" class="${pfx}-headline">${headlineText}</h1>
        <p id="${pfx}-subline" class="${pfx}-subline">${subheadlineText}</p>
      </div>
    `;
  } else if (layout === "bento-feature-grid") {
    extraStyles = `
      .${pfx}-safe {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 20px;
      }
      .${pfx}-bento-hero {
        flex: 1 1 48%;
        border-radius: 26px;
        overflow: hidden;
        border: 2px solid ${secondary};
        background: #0d1814;
        position: relative;
      }
      .${pfx}-bento-card {
        background: #0a1612;
        border: 2px solid ${primary};
        border-radius: 24px;
        padding: 22px 26px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .${pfx}-bento-row {
        display: flex;
        flex-direction: row;
        gap: 14px;
      }
      .${pfx}-bento-pill {
        flex: 1 1 0;
        background: #11221b;
        border: 1px solid ${secondary};
        border-radius: 16px;
        padding: 14px 16px;
        color: #ffffff;
        font-size: 19px;
        font-weight: 700;
        line-height: 1.3;
      }
    `;
    bodyInnerHtml = `
      <div class="${pfx}-bento-hero" data-layout-allow-overflow>
        <div id="${pfx}-rig" class="${pfx}-rig" data-layout-allow-overflow>
          ${mediaHtml}
        </div>
      </div>
      <div id="${pfx}-card" class="${pfx}-bento-card">
        <div id="${pfx}-badge" class="${pfx}-badge">${badgeText}</div>
        <h1 id="${pfx}-headline" class="${pfx}-headline">${headlineText}</h1>
        <p id="${pfx}-subline" class="${pfx}-subline">${subheadlineText}</p>
      </div>
      <div class="${pfx}-bento-row">
        <div class="${pfx}-bento-pill">${bullets[0]}</div>
        <div class="${pfx}-bento-pill">${bullets[1]}</div>
        <div class="${pfx}-bento-pill">${bullets[2]}</div>
      </div>
    `;
  } else if (layout === "spotlight-cursor-zoom") {
    extraStyles = `
      .${pfx}-safe {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 20px;
      }
      .${pfx}-spotlight-frame {
        flex: 1 1 56%;
        border-radius: 30px;
        overflow: hidden;
        border: 3px solid ${accent};
        background: #0d1814;
        position: relative;
      }
      .${pfx}-reticle {
        position: absolute;
        left: 44%;
        top: 38%;
        width: 96px;
        height: 96px;
        border-radius: 999px;
        border: 3px solid ${accent};
        box-shadow: 0 0 0 6px rgba(10, 22, 18, 0.65);
        pointer-events: none;
      }
      .${pfx}-spot-card {
        background: #0a1612;
        border: 2px solid ${primary};
        border-radius: 24px;
        padding: 24px 28px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
    `;
    bodyInnerHtml = `
      <div class="${pfx}-spotlight-frame" data-layout-allow-overflow>
        <div id="${pfx}-rig" class="${pfx}-rig" data-layout-allow-overflow>
          ${mediaHtml}
        </div>
        <div id="${pfx}-reticle" class="${pfx}-reticle"></div>
      </div>
      <div id="${pfx}-card" class="${pfx}-spot-card">
        <div id="${pfx}-badge" class="${pfx}-badge">${badgeText}</div>
        <h1 id="${pfx}-headline" class="${pfx}-headline">${headlineText}</h1>
        <p id="${pfx}-subline" class="${pfx}-subline">${subheadlineText}</p>
      </div>
    `;
  } else {
    // kinetic-statement-card
    extraStyles = `
      .${pfx}-safe {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 24px;
      }
      .${pfx}-statement-card {
        width: 100%;
        background: #0a1612;
        border: 3px solid ${secondary};
        border-radius: 32px;
        padding: 40px 34px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 16px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.68);
      }
      .${pfx}-preview-strip {
        width: 100%;
        height: 220px;
        border-radius: 20px;
        overflow: hidden;
        border: 2px solid ${primary};
        position: relative;
        background: #0d1814;
      }
      .${pfx}-preview-strip video,
      .${pfx}-preview-strip img,
      .preview-strip video,
      .preview-strip img {
        object-position: 50% 25%;
      }
    `;
    bodyInnerHtml = `
      <div id="${pfx}-card" class="${pfx}-statement-card">
        <div id="${pfx}-badge" class="${pfx}-badge">${badgeText}</div>
        <h1 id="${pfx}-headline" class="${pfx}-headline">${headlineText}</h1>
        <p id="${pfx}-subline" class="${pfx}-subline">${subheadlineText}</p>
        <div class="${pfx}-preview-strip preview-strip" data-layout-allow-overflow>
          <div id="${pfx}-rig" class="${pfx}-rig" data-layout-allow-overflow>
            ${mediaHtml}
          </div>
        </div>
      </div>
    `;
  }

  const fullBleedBgLayer =
    layout === "fullbleed-cinema"
      ? `<div class="${pfx}-bg-bleed" data-layout-allow-overflow>
        <div id="${pfx}-rig" class="${pfx}-rig" data-layout-allow-overflow>
          ${mediaHtml}
        </div>
      </div>`
      : "";

  const subtitleBlock = showCaptionPill
    ? `<div id="${pfx}-subpill" class="${pfx}-subpill" data-layout-allow-caption-zone>${captionText}</div>`
    : "";

  const motionEnd = Math.max(0.4, Number((dur * 0.94).toFixed(2)));
  const cardInDur = Math.min(0.45, Number((dur * 0.32).toFixed(2)));

  return `<template id="${sceneId}-template">
  <style>
    #root {
      position: absolute;
      inset: 0;
      overflow: hidden;
      background: linear-gradient(160deg, ${bg} 0%, #050c09 100%);
      font-family: "Inter", sans-serif;
      color: #ffffff;
    }
    .${pfx}-rig {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      transform-origin: center center;
    }
    .${pfx}-media {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .${pfx}-synth-plate {
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, ${primary} 0%, ${bg} 65%, #091510 100%);
    }
    .${pfx}-safe {
      position: absolute;
      left: 11%;
      right: 11%;
      top: 11%;
      bottom: ${showCaptionPill ? "17%" : "12%"};
    }
    .${pfx}-badge {
      display: inline-block;
      align-self: flex-start;
      background: #4ade80;
      color: #07130e;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: 0.05em;
      padding: 6px 16px;
      border-radius: 999px;
    }
    .${pfx}-headline {
      margin: 0;
      color: #ffffff;
      font-size: ${headingPx}px;
      font-weight: 800;
      line-height: 1.16;
      letter-spacing: -0.02em;
    }
    .${pfx}-subline {
      margin: 0;
      color: #e2e8f0;
      font-size: ${subPx}px;
      font-weight: 500;
      line-height: 1.36;
    }
    .${pfx}-subpill {
      position: absolute;
      left: 12%;
      right: 12%;
      bottom: 6%;
      background: #0a1612;
      border: 2px solid #4ade80;
      border-radius: 18px;
      padding: 12px 20px;
      color: #ffffff;
      font-size: 23px;
      font-weight: 700;
      line-height: 1.3;
      text-align: center;
    }
    ${extraStyles}
  </style>
  <div
    id="root"
    data-composition-id="${sceneId}"
    data-width="${width}"
    data-height="${height}"
    data-duration="${dur}"
  >
    ${fullBleedBgLayer}
    <div class="${pfx}-safe">
      ${bodyInnerHtml}
    </div>
    ${subtitleBlock}
  </div>
  <script>
    (function () {
      const tl = gsap.timeline({ paused: true });
      tl.fromTo(
        "#${pfx}-rig",
        { scale: ${fromScale}, x: 0, y: 0, rotation: 0 },
        {
          scale: ${toScale},
          x: ${panX},
          y: ${panY},
          rotation: ${(tiltDeg * 0.25).toFixed(2)},
          duration: ${motionEnd},
          ease: "${ease}",
        },
        0,
      );
      tl.fromTo(
        "#${pfx}-card",
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: ${cardInDur}, ease: "power3.out" },
        0.04,
      );
      tl.fromTo(
        "#${pfx}-badge",
        { opacity: 0, scale: 0.92 },
        { opacity: 1, scale: 1, duration: ${cardInDur}, ease: "power2.out" },
        0.08,
      );${
        showCaptionPill
          ? `
      tl.fromTo(
        "#${pfx}-subpill",
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: ${cardInDur}, ease: "power2.out" },
        0.12,
      );`
          : ""
      }
      window.__timelines = window.__timelines || {};
      window.__timelines["${sceneId}"] = tl;
    })();
  </script>
</template>
`;
}

export function buildMasterIndexHtml({
  title,
  width,
  height,
  fps,
  totalDuration,
  scenes,
  brandColors = {},
  masterAudioRelPath = "assets/audio/compiled_master.mp3",
}) {
  const primary = brandColors?.primary || "#1E824C";
  const secondary = brandColors?.secondary || "#2ECC71";
  const accent = brandColors?.accent || "#F1C40F";
  const bg = brandColors?.background || "#0A1612";

  const variablesJson = JSON.stringify([
    { id: "brand-primary", type: "color", label: "Primary Brand Color", default: primary },
    { id: "brand-secondary", type: "color", label: "Secondary Brand Color", default: secondary },
    { id: "brand-accent", type: "color", label: "Accent Color", default: accent },
    { id: "brand-bg", type: "color", label: "Stage Background", default: bg },
  ]);

  const sceneHostsHtml = scenes
    .map(
      (s) => `      <div
        id="${s.sceneId}"
        class="clip scene"
        data-composition-id="${s.sceneId}"
        data-composition-src="compositions/${s.sceneId}.html"
        data-track-kind="graphics"
        data-track-index="1"
        data-start="${s.start}"
        data-duration="${s.duration}"
        data-width="${width}"
        data-height="${height}"
      ></div>`,
    )
    .join("\n\n");

  const audioHtml = masterAudioRelPath
    ? `      <audio
        id="master-audio"
        class="clip"
        src="${escapeHtml(masterAudioRelPath)}"
        data-start="0"
        data-duration="${totalDuration}"
        data-track-index="0"
        data-volume="1"
      ></audio>`
    : "";

  return `<!doctype html>
<html lang="en" data-composition-variables='${variablesJson}'>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${escapeHtml(title || "Director Studio Pro Composition")}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      :root {
        --brand-primary: ${primary};
        --brand-secondary: ${secondary};
        --brand-accent: ${accent};
        --brand-bg: ${bg};
      }
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: ${bg};
        font-family: "Inter", sans-serif;
      }
      #root {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: ${bg};
      }
      .scene {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${totalDuration}"
      data-width="${width}"
      data-height="${height}"
      data-fps="${fps}"
    >
${sceneHostsHtml}

${audioHtml}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

function parseTrailingJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function compileProjectVideo({
  slug,
  storyboard,
  brief,
  settings = {},
  onProgress = () => {},
}) {
  assertValidSlug(slug);
  getProviderSettings();
  const projectDir = ensureProjectDirs(slug);

  const effectiveBrief = brief || (await syncProjectManifest(slug));
  let effectiveStoryboard = storyboard;
  if (!effectiveStoryboard) {
    const sbPath = path.join(projectDir, "STORYBOARD.json");
    if (fs.existsSync(sbPath)) {
      effectiveStoryboard = JSON.parse(fs.readFileSync(sbPath, "utf8"));
    }
  }

  const rawFrames = Array.isArray(effectiveStoryboard?.frames) ? effectiveStoryboard.frames : [];
  if (rawFrames.length === 0) {
    throw new Error(`compileProjectVideo requires storyboard.frames (got 0 frames for "${slug}").`);
  }

  const resolvedSettings = {
    resolution: "1080p",
    aspectRatio: effectiveBrief?.aspectRatio || "9:16",
    fps: Number(effectiveBrief?.fps) || 30,
    quality: "draft",
    captionsMode: "kinetic",
    includeVoiceover: true,
    includeBgm: true,
    bgmVolume: 0.16,
    renderVideo: true,
    ...settings,
  };

  const { width, height } = resolveCanvasDimensions(
    resolvedSettings.aspectRatio,
    resolvedSettings.resolution,
    effectiveBrief,
  );
  const fps = clamp(Math.round(Number(resolvedSettings.fps) || 30), 12, 120);

  const normalizedFrames = rawFrames.map((f, idx) =>
    normalizeFrame(f, idx, rawFrames.length, effectiveBrief),
  );
  const totalDuration =
    Math.round(normalizedFrames.reduce((sum, f) => sum + f.durationSeconds, 0) * 100) / 100;

  // Stage 1: slice-clips
  onProgress({ stage: "slice-clips", progress: 0, message: "Slicing and speed-ramping shots" });
  await sliceProjectClips({
    projectDir,
    frames: normalizedFrames,
    fps,
    onProgress,
  });

  // Stage 2: audio-mix
  const masterAudioRelPath = await buildMasterAudioMix({
    projectDir,
    frames: normalizedFrames,
    totalDuration,
    includeVoiceover: Boolean(resolvedSettings.includeVoiceover),
    includeBgm: Boolean(resolvedSettings.includeBgm),
    bgmVolume: Number(resolvedSettings.bgmVolume ?? 0.16),
    onProgress,
  });

  // Stage 3: build-compositions
  onProgress({
    stage: "build-compositions",
    progress: 0.5,
    message: `Writing ${normalizedFrames.length} modular scene sub-compositions and master index.html`,
  });

  const compositionsDir = path.join(projectDir, "compositions");
  fs.mkdirSync(compositionsDir, { recursive: true });
  for (const existing of fs.readdirSync(compositionsDir)) {
    if (/^scene_\d+\.html$/i.test(existing)) {
      fs.unlinkSync(path.join(compositionsDir, existing));
    }
  }

  const mountedScenes = [];
  let timelineCursor = 0;
  for (const frame of normalizedFrames) {
    const sceneHtml = buildSceneSubCompositionHtml({
      sceneId: frame.sceneId,
      width,
      height,
      frame,
      brandColors: effectiveBrief?.brandColors,
      captionsMode: resolvedSettings.captionsMode,
    });
    fs.writeFileSync(path.join(compositionsDir, `${frame.sceneId}.html`), sceneHtml, "utf8");
    mountedScenes.push({
      sceneId: frame.sceneId,
      start: Math.round(timelineCursor * 100) / 100,
      duration: frame.durationSeconds,
    });
    timelineCursor += frame.durationSeconds;
  }

  const indexHtml = buildMasterIndexHtml({
    title: effectiveBrief?.title || slug,
    width,
    height,
    fps,
    totalDuration,
    scenes: mountedScenes,
    brandColors: effectiveBrief?.brandColors,
    masterAudioRelPath,
  });
  fs.writeFileSync(path.join(projectDir, "index.html"), indexHtml, "utf8");

  // Stage 4: validate (npx hyperframes lint && npx hyperframes check --json)
  onProgress({
    stage: "validate",
    progress: 0.72,
    message: "Running HyperFrames static lint & headless Chrome check gate",
  });

  const projectRelArg = `projects/${slug}`;

  const lintHumanCmd = await runCommand("npx", ["hyperframes", "lint", projectRelArg], {
    cwd: ROOT_DIR,
  });
  const lintJsonCmd = await runCommand("npx", ["hyperframes", "lint", "--json", projectRelArg], {
    cwd: ROOT_DIR,
  });
  const parsedLint = parseTrailingJson(lintJsonCmd.stdout) || {
    ok: lintHumanCmd.code === 0,
    errorCount: lintHumanCmd.code === 0 ? 0 : 1,
    warningCount: 0,
    findings: [],
  };
  const lintResult = {
    ...parsedLint,
    code: lintHumanCmd.code,
    rawOutput: (lintHumanCmd.stdout || lintHumanCmd.stderr || "").trim(),
  };

  if (lintHumanCmd.code !== 0 || !lintResult.ok || Number(lintResult.errorCount) > 0) {
    throw new Error(
      `HyperFrames lint failed for "${slug}": ${JSON.stringify(lintResult.findings || lintResult.rawOutput)}`,
    );
  }

  const checkCmd = await runCommand("npx", ["hyperframes", "check", "--json", projectRelArg], {
    cwd: ROOT_DIR,
  });
  const checkResult = parseTrailingJson(checkCmd.stdout);
  if (!checkResult) {
    throw new Error(
      `Failed to parse npx hyperframes check --json output: ${(checkCmd.stderr || checkCmd.stdout).slice(-800)}`,
    );
  }

  const sectionErrorSum =
    Number(checkResult.lint?.errorCount || 0) +
    Number(checkResult.runtime?.errorCount || 0) +
    Number(checkResult.layout?.errorCount || 0) +
    Number(checkResult.motion?.errorCount || 0) +
    Number(checkResult.contrast?.errorCount || 0) +
    Number(checkResult.craft?.errorCount || 0) +
    Number(checkResult.audio?.errorCount || 0);

  if (checkCmd.code !== 0 || !checkResult.ok || checkResult.browserSkipped || sectionErrorSum > 0) {
    throw new Error(
      `HyperFrames check gate failed (${sectionErrorSum} errors): ${JSON.stringify({
        ok: checkResult.ok,
        browserSkipped: checkResult.browserSkipped,
        lint: checkResult.lint?.findings,
        runtime: checkResult.runtime?.findings,
        layout: checkResult.layout?.findings,
        motion: checkResult.motion?.findings,
        contrast: checkResult.contrast?.findings,
      })}`,
    );
  }

  // Stage 5: render
  let outputRelPath = null;
  let probe = null;

  if (resolvedSettings.renderVideo !== false) {
    const quality = String(resolvedSettings.quality || "draft");
    outputRelPath = `output/${slug}_${quality}.mp4`;
    const outputAbsPath = path.join(projectDir, outputRelPath);
    fs.mkdirSync(path.dirname(outputAbsPath), { recursive: true });

    onProgress({
      stage: "render",
      progress: 0.88,
      message: `Rendering ${outputRelPath} (${quality} @ ${fps}fps)`,
    });

    const renderCmd = await runCommand(
      "npx",
      [
        "hyperframes",
        "render",
        "--quality",
        quality,
        "--fps",
        String(fps),
        "-o",
        `${projectRelArg}/${outputRelPath}`,
        projectRelArg,
      ],
      { cwd: ROOT_DIR },
    );

    if (renderCmd.code !== 0 || !fs.existsSync(outputAbsPath)) {
      throw new Error(
        `HyperFrames render failed (${renderCmd.code}): ${(renderCmd.stderr || renderCmd.stdout).trim().slice(-1000)}`,
      );
    }

    probe = await probeMedia(outputAbsPath);
  }

  const manifest = await syncProjectManifest(slug, {
    width,
    height,
    aspectRatio: resolvedSettings.aspectRatio,
    fps,
    durationSeconds: totalDuration,
  });

  onProgress({
    stage: "done",
    progress: 1,
    message: outputRelPath ? `Rendered ${outputRelPath}` : "Compositions validated cleanly",
  });

  return {
    ok: true,
    slug,
    outputRelPath,
    totalDuration,
    sceneCount: mountedScenes.length,
    lintResult,
    checkResult,
    probe,
    manifest,
  };
}

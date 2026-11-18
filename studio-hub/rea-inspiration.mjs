import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { runMediaIntelligence } from "./folder-ingest.mjs";
import {
  PROJECTS_DIR,
  ROOT_DIR,
  assertValidSlug,
  ensureProjectDirs,
  getToolEnv,
  resolvePythonBin,
  runCommand,
  syncProjectManifest,
} from "./lib.mjs";
import {
  LAYOUT_ARCHETYPES,
  MOTION_PRESETS,
  generateStoryboard,
  loadStoryboard,
  regenerateFrame,
  saveStoryboard,
} from "./storyboard.mjs";

let cachedReaInstalled = null;

function round2(val) {
  return Math.round(Number(val || 0) * 100) / 100;
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function readTextIfExists(filePath, maxChars = 0) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return maxChars > 0 ? raw.slice(0, maxChars) : raw;
  } catch {
    return "";
  }
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function computePacingLabel(avgShotLength) {
  const asl = Number(avgShotLength || 0);
  if (asl > 0 && asl < 2.5) return "fast-kinetic";
  if (asl <= 5.5) return "rhythmic-editorial";
  return "calm-cinematic";
}

function buildSafeVideoId(absVideoPath) {
  const stem = path
    .basename(absVideoPath, path.extname(absVideoPath))
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 42);
  let statSig = absVideoPath;
  try {
    const st = fs.statSync(absVideoPath);
    statSig = `${absVideoPath}:${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    // Ignore stat errors before validation
  }
  const hash = crypto.createHash("sha1").update(statSig).digest("hex").slice(0, 8);
  return `${stem || "inspiration"}_${hash}`;
}

function toProjectMediaUrl(slug, relPath) {
  const normalized = String(relPath || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
  return `/media/${encodeURIComponent(slug)}/${normalized
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

/**
 * Checks whether the Python `rea_video` package is importable in the Studio toolchain.
 * Synchronous so both `if (isReaVideoInstalled())` and `await isReaVideoInstalled()` work.
 */
export function isReaVideoInstalled({ refresh = false } = {}) {
  if (!refresh && cachedReaInstalled !== null) {
    return cachedReaInstalled;
  }
  const env = { ...getToolEnv(), PYTHONIOENCODING: "utf-8" };
  const pythonBin = resolvePythonBin();
  const probe = spawnSync(pythonBin, ["-c", "import rea_video; print(rea_video.__version__)"], {
    cwd: ROOT_DIR,
    env,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: 10_000,
  });
  cachedReaInstalled = probe.status === 0;
  return cachedReaInstalled;
}

function mapShotToHyperFramesRig({
  shotIndex,
  totalShots,
  productionType,
  cameraMove,
  zoomPerSec = 0,
  panPxPerSec = 0,
  overlayCount = 0,
  facePresence = 0,
}) {
  const isOpener = shotIndex === 1;
  const isCloser = totalShots >= 2 && shotIndex === totalShots;

  let recommendedArchetype = "device-3d-showcase";
  let recommendedMotionPreset = "crash-zoom-in";

  if (isCloser && (productionType === "code_render" || productionType === "static_hold")) {
    recommendedArchetype = "kinetic-statement-card";
    recommendedMotionPreset = "editorial-kinetic-card";
  } else if (productionType === "screen_capture") {
    if (zoomPerSec > 0.06 || cameraMove === "planar_zoom_pan") {
      recommendedArchetype = "spotlight-cursor-zoom";
      recommendedMotionPreset = "spotlight-cursor-follow";
    } else {
      recommendedArchetype = "device-3d-showcase";
      recommendedMotionPreset = "isometric-3d-tilt";
    }
  } else if (productionType === "code_render") {
    if (overlayCount >= 3) {
      recommendedArchetype = "bento-feature-grid";
      recommendedMotionPreset = "bento-triptych";
    } else if (panPxPerSec > 18 || cameraMove === "planar_zoom_pan") {
      recommendedArchetype = "split-editorial";
      recommendedMotionPreset = "whip-pan-split";
    } else if (isOpener) {
      recommendedArchetype = "kinetic-statement-card";
      recommendedMotionPreset = "editorial-kinetic-card";
    } else {
      recommendedArchetype = shotIndex % 2 === 0 ? "split-editorial" : "bento-feature-grid";
      recommendedMotionPreset = shotIndex % 2 === 0 ? "whip-pan-split" : "bento-triptych";
    }
  } else if (
    productionType === "live_action" ||
    productionType === "film_footage" ||
    facePresence > 0.3
  ) {
    recommendedArchetype = "fullbleed-cinema";
    recommendedMotionPreset = zoomPerSec < -0.03 ? "dolly-out-reveal" : "crash-zoom-in";
  } else if (productionType === "ai_video" || productionType === "cg_3d") {
    recommendedArchetype = shotIndex % 2 === 0 ? "device-3d-showcase" : "fullbleed-cinema";
    recommendedMotionPreset = cameraMove === "smooth_move" ? "parallax-float" : "dolly-out-reveal";
  } else if (productionType === "still_motion") {
    recommendedArchetype = "device-3d-showcase";
    recommendedMotionPreset = zoomPerSec < 0 ? "dolly-out-reveal" : "parallax-float";
  } else {
    const cycleLayouts = [
      "device-3d-showcase",
      "split-editorial",
      "spotlight-cursor-zoom",
      "bento-feature-grid",
      "fullbleed-cinema",
      "kinetic-statement-card",
    ];
    const cyclePresets = [
      "crash-zoom-in",
      "whip-pan-split",
      "spotlight-cursor-follow",
      "bento-triptych",
      "dolly-out-reveal",
      "editorial-kinetic-card",
    ];
    const pick = (shotIndex - 1) % cycleLayouts.length;
    recommendedArchetype = cycleLayouts[pick];
    recommendedMotionPreset = cyclePresets[pick];
  }

  if (!LAYOUT_ARCHETYPES.includes(recommendedArchetype)) {
    recommendedArchetype = "device-3d-showcase";
  }
  if (!MOTION_PRESETS[recommendedMotionPreset]) {
    recommendedMotionPreset = "crash-zoom-in";
  }

  return { recommendedArchetype, recommendedMotionPreset };
}

function inferColorLookFromBreakdown(shots, inspMetrics) {
  let warmthSum = 0;
  let satSum = 0;
  let darkSum = 0;
  let count = 0;

  for (const s of shots) {
    const grade = s?.aspects?.grade?.measured;
    const lighting = s?.aspects?.lighting?.measured;
    if (grade || lighting) {
      warmthSum += Number(lighting?.warmth ?? grade?.mean_b ?? 0);
      satSum += Number(grade?.sat ?? s?.features?.saturation ?? 0.25);
      darkSum += Number(grade?.dark_share ?? s?.features?.dark_ratio ?? 0.15);
      count += 1;
    }
  }

  const avgWarmth = count > 0 ? warmthSum / count : 0;
  const avgSat = count > 0 ? satSum / count : 0.25;
  const avgDark = count > 0 ? darkSum / count : 0.2;
  const brightness = Number(inspMetrics?.brightness ?? 50);
  const contrast = Number(inspMetrics?.contrast ?? 45);

  if (avgDark > 0.55 && contrast > 55) return "noir-high-contrast";
  if (avgWarmth > 14 && brightness >= 45) return "warm-golden-hour";
  if (avgWarmth > 8) return "kodak-2383-warm";
  if (avgSat > 0.42 && avgDark > 0.35) return "cyber-neon";
  if (avgSat > 0.34) return "teal-orange-cinema";
  if (brightness > 68 && contrast < 42) return "apple-keynote-crisp";
  if (contrast < 35) return "matte-editorial";
  return "clean-commercial";
}

function inferCaptionStyle({ pacing, packaging, lang }) {
  if (/^bn|bengali|বাংলা/i.test(String(lang || ""))) {
    return "bengali-emerald-card";
  }
  const textCues = Array.isArray(packaging?.text_cues) ? packaging.text_cues : [];
  const hasRapidPop = textCues.some((c) => c?.anim_in === "pop" || c?.kind === "huazi");
  if (hasRapidPop || pacing === "fast-kinetic") {
    return "kinetic-gold-pop";
  }
  if (pacing === "rhythmic-editorial") {
    return textCues.length >= 4 ? "karaoke-word-pill" : "minimal-editorial-rail";
  }
  return "clean-cinema-sub";
}

async function ensureRequiredArtifacts({ outDir, absVideoPath, env }) {
  const audioPng = path.join(outDir, "audio.png");
  if (!fs.existsSync(audioPng)) {
    // Try rendering waveform from audio stream first; fall back to clean studio baseline PNG if muted
    const waveRes = await runCommand(
      "ffmpeg",
      [
        "-y",
        "-i",
        absVideoPath,
        "-filter_complex",
        "showwavespic=s=640x120:colors=#1E824C|#2ECC71",
        "-frames:v",
        "1",
        audioPng,
      ],
      { env, shell: false },
    );
    if (waveRes.code !== 0 || !fs.existsSync(audioPng)) {
      await runCommand(
        "ffmpeg",
        ["-y", "-f", "lavfi", "-i", "color=c=0xF4F6F8:s=640x120:d=0.1", "-frames:v", "1", audioPng],
        { env, shell: false },
      );
    }
  }

  const storyboardJpg = path.join(outDir, "storyboard.jpg");
  if (!fs.existsSync(storyboardJpg)) {
    await runCommand(
      "ffmpeg",
      ["-y", "-i", absVideoPath, "-frames:v", "1", "-vf", "scale=640:-1", storyboardJpg],
      { env, shell: false },
    );
  }

  const videoMdPath = path.join(outDir, "VIDEO.md");
  if (!fs.existsSync(videoMdPath)) {
    fs.writeFileSync(
      videoMdPath,
      `---\nvideomd: 1\nname: inspiration\n---\n\n# ${path.basename(absVideoPath)}\n\nDeterministic inspiration breakdown.\n`,
      "utf8",
    );
  }

  const reportHtmlPath = path.join(outDir, "report.html");
  if (!fs.existsSync(reportHtmlPath)) {
    const mdText = readTextIfExists(videoMdPath, 4000)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    fs.writeFileSync(
      reportHtmlPath,
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Inspiration Breakdown</title></head><body><pre>${mdText}</pre></body></html>`,
      "utf8",
    );
  }
}

function resolveProjectContext(slug, projectsDir = PROJECTS_DIR) {
  const resolvedProjectsRoot = path.resolve(projectsDir || PROJECTS_DIR);
  const isDefaultRoot =
    resolvedProjectsRoot.toLowerCase() === path.resolve(PROJECTS_DIR).toLowerCase();
  if (isDefaultRoot) {
    const projectDir = ensureProjectDirs(slug);
    return { projectDir, isDefaultRoot: true };
  }
  if (!slug || !/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  const projectDir = path.resolve(resolvedProjectsRoot, slug);
  if (!projectDir.startsWith(resolvedProjectsRoot + path.sep)) {
    throw new Error(`Unsafe project path: ${slug}`);
  }
  fs.mkdirSync(path.join(projectDir, ".studio", "frames", "inspiration"), { recursive: true });
  return { projectDir, isDefaultRoot: false };
}

export async function decomposeInspirationWithReaVideo({
  slug,
  videoPath,
  videoRelPath = null,
  lang = "en",
  enableStems = false,
  projectsDir = PROJECTS_DIR,
} = {}) {
  const { projectDir, isDefaultRoot } = resolveProjectContext(slug, projectsDir);

  const absVideoPath = videoPath
    ? path.isAbsolute(videoPath)
      ? videoPath
      : path.resolve(projectDir, videoPath)
    : videoRelPath
      ? path.resolve(projectDir, videoRelPath)
      : "";

  if (!absVideoPath || !fs.existsSync(absVideoPath)) {
    throw new Error(`Inspiration video not found: ${videoPath || videoRelPath}`);
  }

  const normalizedRelPath = videoRelPath
    ? String(videoRelPath).replaceAll("\\", "/")
    : absVideoPath.startsWith(projectDir + path.sep)
      ? path.relative(projectDir, absVideoPath).replaceAll("\\", "/")
      : path.basename(absVideoPath);

  const safeVideoId = buildSafeVideoId(absVideoPath);
  const relBreakDir = `.studio/rea-breakdown/${safeVideoId}`;
  const outDir = path.join(projectDir, ".studio", "rea-breakdown", safeVideoId);
  fs.mkdirSync(outDir, { recursive: true });

  const reaLang = String(lang || "en")
    .toLowerCase()
    .startsWith("zh")
    ? "zh"
    : "en";
  const env = { ...getToolEnv(), PYTHONIOENCODING: "utf-8" };

  const decomposeArgs = [
    "-m",
    "rea_video",
    "decompose",
    absVideoPath,
    "-o",
    outDir,
    "--no-vlm",
    "--no-asr",
    "--no-speakers",
    "--lang",
    reaLang,
  ];
  if (!enableStems) {
    decomposeArgs.push("--no-stems");
  }

  const inspFramesDir = path.join(projectDir, ".studio", "frames", "inspiration");
  fs.mkdirSync(inspFramesDir, { recursive: true });

  const [reaRes, mediaIntelRes] = await Promise.all([
    isReaVideoInstalled()
      ? runCommand(resolvePythonBin(), decomposeArgs, { cwd: ROOT_DIR, env, shell: false })
      : Promise.resolve({ code: 1, stdout: "", stderr: "rea_video not installed" }),
    runMediaIntelligence("analyze-inspiration", [
      "--video",
      absVideoPath,
      "--out-dir",
      inspFramesDir,
    ]).catch(() => null),
  ]);

  await ensureRequiredArtifacts({ outDir, absVideoPath, env });

  const breakdown = readJsonIfExists(path.join(outDir, "breakdown.json"));
  if (!breakdown && !mediaIntelRes) {
    throw new Error(
      `rea-video decompose failed (${reaRes.code}): ${(reaRes.stderr || reaRes.stdout || "").slice(0, 500)}`,
    );
  }

  const videoMdFull = readTextIfExists(path.join(outDir, "VIDEO.md"), 4500);
  const timelineMd = readTextIfExists(path.join(outDir, "video", "timeline.md"), 2500);
  const rhythmMd = readTextIfExists(path.join(outDir, "video", "rhythm.md"), 1800);
  const packagingMd = readTextIfExists(path.join(outDir, "video", "packaging.md"), 1800);
  const lookMd = readTextIfExists(path.join(outDir, "video", "look.md"), 1800);

  const duration = round2(
    breakdown?.source?.duration ?? breakdown?.summary?.duration ?? mediaIntelRes?.duration ?? 0,
  );

  let rawShots = Array.isArray(breakdown?.shots) ? breakdown.shots : [];

  // Enrich/fallback if synthetic test clip was segmented more finely by media_intelligence.py
  if (rawShots.length <= 1 && mediaIntelRes && Number(mediaIntelRes.cutCount || 0) >= 2) {
    const baseRec = rawShots[0] || {};
    const cuts = Array.isArray(mediaIntelRes.cutTimestamps) ? mediaIntelRes.cutTimestamps : [];
    const edges = [0, ...cuts, duration];
    rawShots = [];
    for (let i = 0; i < edges.length - 1; i += 1) {
      const s = round2(edges[i]);
      const e = round2(edges[i + 1]);
      if (e - s < 0.15) continue;
      rawShots.push({
        ...baseRec,
        index: rawShots.length + 1,
        start: s,
        end: e,
        duration: round2(e - s),
      });
    }
  }

  // Production mix percentages
  const mixRaw = Array.isArray(breakdown?.summary?.production_mix)
    ? breakdown.summary.production_mix
    : [];
  let liveRatio = 0;
  let codeRatio = 0;
  let screenRatio = 0;
  let aiRatio = 0;
  let animRatio = 0;

  for (const item of mixRaw) {
    const r = Number(item?.ratio || 0);
    const lbl = String(item?.label || "");
    if (lbl === "live_action" || lbl === "film_footage") liveRatio += r;
    else if (lbl === "code_render" || lbl === "static_hold") codeRatio += r;
    else if (lbl === "screen_capture") screenRatio += r;
    else if (lbl === "ai_video" || lbl === "avatar") aiRatio += r;
    else animRatio += r;
  }

  if (mixRaw.length === 0) {
    codeRatio = 1;
  }

  const productionMix = {
    liveActionPct: round2(liveRatio * 100),
    codeRenderPct: round2(codeRatio * 100),
    screenRecordingPct: round2(screenRatio * 100),
    aiVideoPct: round2(aiRatio * 100),
    animationPct: round2(animRatio * 100),
  };

  // Normalize per-shot records
  const totalShots = Math.max(1, rawShots.length);
  const normalizedShots = rawShots.map((rec, idx) => {
    const shotIndex = idx + 1;
    const start = round2(rec?.start ?? 0);
    const end = round2(rec?.end ?? start + 2);
    const shotDur = round2(Math.max(0.1, rec?.duration ?? end - start));
    const productionType = String(rec?.base?.label || "code_render");
    const cameraMove = String(
      rec?.aspects?.camera?.measured?.motion || rec?.features?.camera || "static",
    );
    const shotSize = rec?.aspects?.framing?.measured?.shot_size || "medium shot";
    const subjectPos = rec?.aspects?.framing?.measured?.position || "centred";
    const framing = `${shotSize} (${subjectPos})`;

    const textItems = Array.isArray(rec?.text?.items) ? rec.text.items : [];
    const overlayText = textItems
      .map((it) => String(it?.text || "").trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(" · ");

    const overlayLayers = Array.isArray(rec?.layers) ? rec.layers : [];
    const { recommendedArchetype, recommendedMotionPreset } = mapShotToHyperFramesRig({
      shotIndex,
      totalShots,
      productionType,
      cameraMove,
      zoomPerSec: Number(rec?.features?.zoom_per_s || 0),
      panPxPerSec: Number(rec?.features?.pan_px_per_s || 0),
      overlayCount: overlayLayers.length + textItems.length,
      facePresence: Number(rec?.faces || rec?.features?.face_presence || 0),
    });

    return {
      index: shotIndex,
      start,
      end,
      duration: shotDur,
      productionType,
      cameraMove,
      framing,
      overlayText,
      recommendedArchetype,
      recommendedMotionPreset,
    };
  });

  const shotCount = normalizedShots.length;
  const cutCount = Math.max(0, shotCount - 1);
  const avgShotLength =
    shotCount > 0 ? round2(duration / shotCount) : round2(mediaIntelRes?.avgShotLength || duration);
  const cutsPerMinute = duration > 0 ? round2((cutCount / duration) * 60) : 0;
  const pacing = computePacingLabel(avgShotLength);

  const bpmRaw = breakdown?.audio?.tempo_bpm ?? breakdown?.audio?.music?.tempo_bpm ?? null;
  const bpm = bpmRaw !== null && Number.isFinite(Number(bpmRaw)) ? round2(bpmRaw) : null;
  const beatSyncRatio = round2(
    breakdown?.audio?.cuts_on_beat_ratio ?? breakdown?.audio?.cuts_on_onset_ratio ?? 0,
  );

  const rawTransitions =
    breakdown?.summary?.transitions && typeof breakdown.summary.transitions === "object"
      ? breakdown.summary.transitions
      : {};
  const transitions = {
    ...rawTransitions,
    ...(cutCount > 0 && Object.keys(rawTransitions).length <= 1 ? { hard_cut: cutCount } : {}),
  };

  // Animation & packaging synthesis
  const packagingObj = breakdown?.packaging || {};
  const overlayKinds = Array.isArray(breakdown?.summary?.overlay_kinds)
    ? breakdown.summary.overlay_kinds
    : [];
  const stickerList = Array.isArray(packagingObj?.stickers) ? packagingObj.stickers : [];
  const textCueList = Array.isArray(packagingObj?.text_cues) ? packagingObj.text_cues : [];

  let subtitleStyle =
    textCueList.length > 0
      ? `Timed lower-third subtitle cues (${textCueList.length} segments detected)`
      : pacing === "fast-kinetic"
        ? "High-tempo punchy word-pop overlay rail"
        : "Clean lower-third editorial subtitle rail";
  if (packagingMd) {
    const firstBullet = packagingMd
      .split(/\r?\n/)
      .find((ln) => ln.trim().startsWith("- ") || ln.trim().startsWith("* "));
    if (firstBullet) {
      subtitleStyle = firstBullet
        .replace(/^[-*]\s+/, "")
        .trim()
        .slice(0, 140);
    }
  }

  const overlayCards = [
    ...overlayKinds.map((k) => String(k)),
    ...(stickerList.length > 0 ? [`${stickerList.length} callout/sticker regions`] : []),
    ...(breakdown?.global_layers?.frozen_ratio > 0.03 ? ["Persistent frame chrome / badge"] : []),
  ];
  if (overlayCards.length === 0) {
    overlayCards.push("Frameless full-stage visual composition");
  }

  const uniqueMoves = [...new Set(normalizedShots.map((s) => s.cameraMove).filter(Boolean))];
  const uniquePresets = [
    ...new Set(normalizedShots.map((s) => s.recommendedMotionPreset).filter(Boolean)),
  ];
  const motionPatterns = [
    ...uniqueMoves.map((m) => m.replaceAll("_", " ")),
    ...uniquePresets.map((p) => `rig:${p}`),
  ];
  if (rhythmMd) {
    const rhythmNote = rhythmMd
      .split(/\r?\n/)
      .find((ln) => ln.includes("cuts") || ln.includes("average") || ln.includes("BPM"));
    if (rhythmNote) {
      motionPatterns.push(
        rhythmNote
          .replace(/^[-*#]\s*/, "")
          .trim()
          .slice(0, 110),
      );
    }
  }

  const recommendedColorLook = inferColorLookFromBreakdown(rawShots, mediaIntelRes);
  const recommendedCaptionStyle = inferCaptionStyle({ pacing, packaging: packagingObj, lang });

  let lightingAndGrade = `${recommendedColorLook} (${pacing} contrast profile)`;
  if (lookMd) {
    const lookLine = lookMd
      .split(/\r?\n/)
      .find((ln) => ln.trim() && !ln.startsWith("---") && !ln.startsWith("#") && !ln.includes(":"));
    if (lookLine) {
      lightingAndGrade = `${recommendedColorLook} · ${lookLine.trim().slice(0, 100)}`;
    }
  }

  const artifacts = {
    videoMdUrl: toProjectMediaUrl(slug, `${relBreakDir}/VIDEO.md`),
    reportHtmlUrl: toProjectMediaUrl(slug, `${relBreakDir}/report.html`),
    storyboardImgUrl: toProjectMediaUrl(slug, `${relBreakDir}/storyboard.jpg`),
    audioWaveformUrl: toProjectMediaUrl(slug, `${relBreakDir}/audio.png`),
  };

  const verdictStr =
    breakdown?.summary?.verdict ||
    `Code/motion mix (${productionMix.codeRenderPct}% UI/code, ${productionMix.liveActionPct}% live)`;
  const summary = `${verdictStr} · ${shotCount} shots (${avgShotLength}s avg cut, ${pacing}${bpm ? `, ${Math.round(bpm)} BPM` : ""})`;

  const videoMdPreview = [videoMdFull.trim(), timelineMd ? `\n\n${timelineMd.trim()}` : ""]
    .join("")
    .trim()
    .slice(0, 5000);

  const remakeRecipe = {
    recommendedColorLook,
    recommendedCaptionStyle,
    shotPresets: normalizedShots.map((s) => ({
      shotIndex: s.index,
      recommendedArchetype: s.recommendedArchetype,
      recommendedMotionPreset: s.recommendedMotionPreset,
      targetDuration: s.duration,
      cameraMove: s.cameraMove,
      productionType: s.productionType,
    })),
  };

  const reaBreakdown = {
    ok: true,
    engine: "rea-video",
    videoRelPath: normalizedRelPath,
    summary,
    productionMix,
    editingStyle: {
      shotCount,
      avgShotLength,
      cutsPerMinute,
      pacing,
      bpm,
      beatSyncRatio,
      transitions,
    },
    animationPackaging: {
      subtitleStyle,
      overlayCards,
      motionPatterns,
      lightingAndGrade,
    },
    shots: normalizedShots,
    artifacts,
    videoMdPreview,
    remakeRecipe,
  };

  const styleFramesRel = Array.isArray(mediaIntelRes?.styleFrames)
    ? mediaIntelRes.styleFrames.map((absP) =>
        absP.startsWith(projectDir + path.sep)
          ? path.relative(projectDir, absP).replaceAll("\\", "/")
          : absP,
      )
    : [];

  const inspirationProfile = {
    avgShotLength,
    cutsPerMinute,
    pacing,
    dominantColors: mediaIntelRes?.dominantColors || [
      "#1E824C",
      "#2ECC71",
      "#F1C40F",
      "#0A1612",
      "#F8FAFC",
    ],
    styleFrames: styleFramesRel,
    brightness: mediaIntelRes?.brightness ?? 52,
    contrast: mediaIntelRes?.contrast ?? 48,
    reaBreakdown,
  };

  if (isDefaultRoot) {
    await syncProjectManifest(slug, { inspirationProfile });
  } else {
    const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
    const existingBrief = readJsonIfExists(briefPath) || { slug };
    fs.writeFileSync(
      briefPath,
      JSON.stringify(
        {
          ...existingBrief,
          inspirationProfile,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  return reaBreakdown;
}

function cameraOverridesFromMove(cameraMove, motionPresetId) {
  const preset = MOTION_PRESETS[motionPresetId] || MOTION_PRESETS["crash-zoom-in"];
  if (cameraMove === "planar_zoom_pan") {
    return {
      fromScale: preset.fromScale,
      toScale: round2(Math.max(preset.toScale, 1.32)),
      panX: preset.panX || -6,
    };
  }
  if (cameraMove === "smooth_move") {
    return {
      fromScale: 1.04,
      toScale: 1.2,
      ease: "sine.inOut",
    };
  }
  if (cameraMove === "handheld_like") {
    return {
      tiltDeg: preset.tiltDeg || 3,
      panY: -4,
    };
  }
  return {};
}

function themeFromColorLook(lookId) {
  if (lookId === "apple-keynote-crisp" || lookId === "matte-editorial") return "light";
  if (lookId === "warm-golden-hour" || lookId === "kodak-2383-warm") return "warm";
  if (lookId === "emerald-vibrant") return "emerald";
  return "dark";
}

export async function applyInspirationStyleToStoryboard({
  slug,
  reaBreakdown = null,
  projectsDir = PROJECTS_DIR,
} = {}) {
  assertValidSlug(slug);
  const { projectDir, isDefaultRoot } = resolveProjectContext(slug, projectsDir);

  let brief = isDefaultRoot
    ? await syncProjectManifest(slug)
    : readJsonIfExists(path.join(projectDir, "PROJECT_BRIEF.json")) || { slug };

  const activeBreakdown =
    reaBreakdown && typeof reaBreakdown === "object"
      ? reaBreakdown
      : brief?.inspirationProfile?.reaBreakdown || null;

  if (!activeBreakdown) {
    throw new Error(
      `No rea-video inspiration breakdown found for "${slug}". Run decomposeInspirationWithReaVideo first.`,
    );
  }

  let storyboard = loadStoryboard(slug);
  const refShots = Array.isArray(activeBreakdown.shots) ? activeBreakdown.shots : [];
  const pacing = activeBreakdown.editingStyle?.pacing || "rhythmic-editorial";
  const avgCut = Number(activeBreakdown.editingStyle?.avgShotLength || 3.5);
  const colorLook = activeBreakdown.remakeRecipe?.recommendedColorLook || "clean-commercial";
  const captionStyle =
    activeBreakdown.remakeRecipe?.recommendedCaptionStyle || "minimal-editorial-rail";
  const targetTheme = themeFromColorLook(colorLook);

  if (!storyboard || !Array.isArray(storyboard.frames) || storyboard.frames.length === 0) {
    storyboard = await generateStoryboard({
      slug,
      projectBrief: brief,
      inspirationProfile: brief?.inspirationProfile || {
        avgShotLength: avgCut,
        cutsPerMinute: activeBreakdown.editingStyle?.cutsPerMinute || 18,
        pacing,
      },
      targetScenes: clamp(refShots.length || 4, 3, 8),
      preserveLocked: true,
    });
  }

  const speedByPacing = pacing === "fast-kinetic" ? 1.25 : pacing === "calm-cinematic" ? 0.95 : 1.0;

  let updatedCount = 0;
  let skippedLockedCount = 0;

  for (let i = 0; i < storyboard.frames.length; i += 1) {
    const frame = storyboard.frames[i];
    if (frame.locked) {
      skippedLockedCount += 1;
      continue;
    }

    const refShot = refShots.length > 0 ? refShots[i % refShots.length] : null;
    const nextLayout =
      refShot?.recommendedArchetype && LAYOUT_ARCHETYPES.includes(refShot.recommendedArchetype)
        ? refShot.recommendedArchetype
        : frame.layout;
    const nextMotionPreset =
      refShot?.recommendedMotionPreset && MOTION_PRESETS[refShot.recommendedMotionPreset]
        ? refShot.recommendedMotionPreset
        : frame.motionPreset;

    const targetDur = refShot?.duration
      ? round2(clamp(refShot.duration * 0.65 + avgCut * 0.35, 1.2, 8.0))
      : round2(clamp(avgCut, 1.5, 8.0));

    const camOverrides = cameraOverridesFromMove(refShot?.cameraMove || "static", nextMotionPreset);

    await regenerateFrame({
      slug,
      frameId: frame.id,
      prompt: `Applied rea-video inspiration style (${pacing}, ${nextMotionPreset}, ${colorLook})`,
      motionPreset: nextMotionPreset,
      layout: nextLayout,
      overrides: {
        durationSeconds: targetDur,
        speedFactor: speedByPacing,
        cameraMotion: camOverrides,
        staging: {
          theme: targetTheme,
          colorLook,
          captionStyle,
          captionMode: "overlay",
          inspirationCameraMove: refShot?.cameraMove || "static",
          inspirationProductionType: refShot?.productionType || "code_render",
        },
        audioSpec: {
          bgmMood: pacing === "fast-kinetic" ? "upbeat-tech" : "warm-modern",
        },
      },
    });
    updatedCount += 1;
  }

  const finalStoryboard = loadStoryboard(slug);
  if (finalStoryboard) {
    finalStoryboard.inspirationProfile = {
      ...(finalStoryboard.inspirationProfile || {}),
      avgShotLength: avgCut,
      cutsPerMinute: activeBreakdown.editingStyle?.cutsPerMinute || 0,
      pacing,
      appliedReaRecipe: {
        recommendedColorLook: colorLook,
        recommendedCaptionStyle: captionStyle,
        appliedAt: new Date().toISOString(),
      },
    };
    saveStoryboard(slug, finalStoryboard);
  }

  if (isDefaultRoot) {
    brief = await syncProjectManifest(slug);
  }

  return {
    ok: true,
    slug,
    updatedCount,
    skippedLockedCount,
    storyboard: loadStoryboard(slug),
    project: brief,
  };
}

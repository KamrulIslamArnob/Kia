import fs from "node:fs";
import path from "node:path";
import { PROJECTS_DIR, assertValidSlug } from "./lib.mjs";
import { enqueueAgentTask, getProviderSettings } from "./agent-bridge.mjs";

export const GOOGLE_FLOW_URL = "https://labs.google/fx/tools/flow";
export const COST_MODE = "subscription-zero-dollar";
export const BROWSER_SANDBOX_UPLOADS_DIR = "browser_sandbox/uploads";

export const NEGATIVE_SLOP_CONSTRAINTS = Object.freeze([
  "no baked-in UI text, gibberish letters, or fake interface wireframes",
  "no watermarks, stock photo badges, or third-party brand logos",
  "no distorted anatomy, extra fingers, or uncanny plastic skin",
  "no generic cyberpunk purple-cyan neon AI slop glow",
  "no cluttered high-frequency detail inside foreground UI/caption overlay safe zones",
  "no oversaturated HDR haloing, lens dirt clutter, or clipped highlights",
]);

const ASPECT_DIMENSIONS = Object.freeze({
  "9:16": Object.freeze({ width: 1080, height: 1920, orientation: "portrait" }),
  "16:9": Object.freeze({ width: 1920, height: 1080, orientation: "landscape" }),
  "1:1": Object.freeze({ width: 1080, height: 1080, orientation: "square" }),
  "4:5": Object.freeze({ width: 1080, height: 1350, orientation: "portrait" }),
});

const CAMERA_BODY_PROFILES = Object.freeze({
  "modern-digital":
    "ARRI Alexa Mini LF clean digital cinema sensor, natural highlight roll-off, crisp micro-contrast",
  "kodak-35mm":
    "Kodak Vision3 500T 35mm motion-picture film stock, organic halation, warm skin-tone separation, fine analog grain",
  "indie-16mm":
    "Super 16mm celluloid texture, tactile filmic softness, authentic organic color density",
  "anamorphic-2x":
    "2x anamorphic cinema prime optics, oval bokeh falloff, subtle horizontal optical breathing",
  "clean-ui-studio":
    "Medium-format commercial tabletop studio capture, ultra-clean razor-sharp edge fidelity, controlled softbox lighting",
  "handheld-doc":
    "Naturalistic cinema verite documentary optics, grounded available-light realism, tactile depth",
});

const LAYOUT_SAFE_ZONES = Object.freeze({
  "device-3d-showcase":
    "Reserve the center-right 55% of the frame as a calm, low-frequency tonal stage so an angled 3D smartphone/browser bezel and floating callout cards read with maximum contrast; place sculptural rim-lighting and atmospheric depth along the outer perimeter.",
  "split-editorial":
    "Keep the left 52% of the frame as clean dark editorial negative space for oversized display typography and step badges; concentrate tactile subject lighting and rich visual interest on the right 48%.",
  "fullbleed-cinema":
    "Compose hero visual depth in the upper two-thirds while keeping a smooth, uncluttered dark tonal falloff across the lower 35% safe zone for lower-third headlines and caption overlays.",
  "bento-feature-grid":
    "Render an understated architectural matte backdrop with soft radial edge falloff and calm center luminance so a 3-cell modular bento grid and metric pills sit cleanly above without visual collision.",
  "spotlight-cursor-zoom":
    "Create a darkened vignette studio surface with a subtle radial key-light pool centered near the pointer focus target and clean uncluttered margins for magnified UI spotlight overlays.",
  "kinetic-statement-card":
    "Keep the central 70% canvas calm and minimalist with refined peripheral brand-colored rim light so bold kinetic typography and CTA pill badges command immediate legibility.",
  "before-after-wipe":
    "Maintain balanced lateral lighting continuity across left and right halves with uncluttered upper/lower safe bands for split-wipe comparison labels.",
  "metric-counter-wall":
    "Craft a sleek dark architectural surface with subtle depth cues and clean central negative space so large tabular metric counters achieve crisp WCAG AA contrast.",
});

function toPosixPath(p) {
  return String(p || "")
    .trim()
    .replaceAll("\\", "/");
}

function sanitizeToken(raw, fallback = "item") {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function normalizeHex(raw, fallback) {
  const match = String(raw || "")
    .trim()
    .match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
  if (!match) return fallback;
  const hex = match[1].toUpperCase();
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  return `#${hex}`;
}

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

function resolveAspectSpec(aspectRatio, shot) {
  const candidate = String(aspectRatio || shot?.aspectRatio || "9:16").trim();
  const key = ASPECT_DIMENSIONS[candidate] ? candidate : "9:16";
  const spec = ASPECT_DIMENSIONS[key];
  return {
    aspectRatio: key,
    width: spec.width,
    height: spec.height,
    orientation: spec.orientation,
  };
}

export function normalizeBrandPalette(brandKit = {}) {
  const colors = brandKit?.brandColors || brandKit?.colors || brandKit || {};
  const extractedRaw = Array.isArray(brandKit?.extractedPalette)
    ? brandKit.extractedPalette
    : Array.isArray(colors?.extractedPalette)
      ? colors.extractedPalette
      : [];

  const extracted = extractedRaw
    .map((c) => normalizeHex(c, null))
    .filter((c) => typeof c === "string");

  const primary = normalizeHex(colors.primary, extracted[0] || "#1E824C");
  const secondary = normalizeHex(colors.secondary, extracted[1] || "#2ECC71");
  const accent = normalizeHex(colors.accent, extracted[2] || "#FACC15");
  const background = normalizeHex(colors.background, extracted[3] || "#0A1612");
  const surface = normalizeHex(colors.surface, "#10231C");

  const hexSet = new Set([primary, secondary, accent, background, surface, ...extracted]);

  return {
    primary,
    secondary,
    accent,
    background,
    surface,
    hexList: [...hexSet],
    tone: String(brandKit?.tone || "Confident & Modern").trim(),
    guidelinesText: String(brandKit?.guidelinesText || "").trim(),
    headingFont: String(brandKit?.fonts?.heading || "Inter").trim(),
  };
}

function resolveOpticProfile(shot = {}) {
  const rig = shot?.cameraRig || shot?.optics || {};
  const layout = String(shot?.layout || "device-3d-showcase").trim();
  const defaultBody =
    layout === "fullbleed-cinema"
      ? "kodak-35mm"
      : layout === "device-3d-showcase" || layout === "spotlight-cursor-zoom"
        ? "clean-ui-studio"
        : "modern-digital";

  const rawBody = String(shot?.cameraBody || rig?.cameraBody || defaultBody)
    .trim()
    .toLowerCase();
  const cameraBody = CAMERA_BODY_PROFILES[rawBody] ? rawBody : defaultBody;
  const lens = String(shot?.lens || rig?.lens || "35mm").trim();
  const aperture = String(shot?.aperture || rig?.aperture || "f/2.8").trim();
  const bodyDescription = CAMERA_BODY_PROFILES[cameraBody];

  return {
    cameraBody,
    lens,
    aperture,
    sensorDescription: bodyDescription,
    summary: `${cameraBody} cinema body · ${lens} prime lens at ${aperture} (${bodyDescription})`,
  };
}

function resolveOverlaySafeZone(shot = {}) {
  const layout = String(shot?.layout || "device-3d-showcase").trim();
  const baseZone = LAYOUT_SAFE_ZONES[layout] || LAYOUT_SAFE_ZONES["device-3d-showcase"];
  const focusX = shot?.cameraMotion?.focusX ?? shot?.staging?.cursorTarget?.x;
  const focusY = shot?.cameraMotion?.focusY ?? shot?.staging?.cursorTarget?.y;
  if (focusX !== undefined && focusY !== undefined) {
    return `${baseZone} Primary focal anchor around (${Number(focusX)}%, ${Number(focusY)}%) within the 80% title-safe frame.`;
  }
  return baseZone;
}

function describeCameraMotion(shot = {}) {
  const cam = shot?.cameraMotion || {};
  const presetId = String(shot?.motionPreset || cam?.presetId || "crash-zoom-in").trim();
  const label = String(cam?.label || presetId).trim();
  const fromScale = round2(cam?.fromScale ?? 1.0);
  const toScale = round2(cam?.toScale ?? 1.25);
  const panX = Number(cam?.panX ?? 0);
  const panY = Number(cam?.panY ?? 0);
  const tiltDeg = Number(cam?.tiltDeg ?? 0);
  const ease = String(cam?.ease || "power3.out").trim();
  const speedFactor = round2(shot?.speedFactor ?? 1.0);

  const parts = [`${label} (${presetId})`, `optical scale ${fromScale}x -> ${toScale}x`];
  if (panX !== 0 || panY !== 0) {
    const horiz = panX < 0 ? `pan left ${Math.abs(panX)}%` : panX > 0 ? `pan right ${panX}%` : "";
    const vert =
      panY < 0 ? `pedestal up ${Math.abs(panY)}%` : panY > 0 ? `pedestal down ${panY}%` : "";
    parts.push([horiz, vert].filter(Boolean).join(", "));
  }
  if (tiltDeg !== 0) {
    parts.push(`dimensional ${tiltDeg}° perspective tilt`);
  }
  parts.push(`easing ${ease}`);
  if (speedFactor !== 1) {
    parts.push(`playback speed ${speedFactor}x`);
  }
  return parts.join(" · ");
}

function assertSubscriptionZeroCost(options = {}) {
  if (options.forcePaidApi === true) {
    throw new Error(
      `zeroCostGuard blocked paid external API execution. Only costMode "${COST_MODE}" is permitted.`,
    );
  }
  if (options.costMode !== undefined && options.costMode !== COST_MODE) {
    throw new Error(
      `zeroCostGuard rejected unsupported costMode "${options.costMode}". Expected "${COST_MODE}".`,
    );
  }
  if (options.paidApiKey || options.externalApiKey) {
    throw new Error(
      `zeroCostGuard rejected external paid API key input; use Antigravity ${COST_MODE} backends only.`,
    );
  }
}

/**
 * Crafts a high-precision art-direction prompt & metadata payload for Antigravity's
 * built-in `image-generator` subagent ($0 included subscription).
 */
export function buildGoogleImagePrompt({ shot = {}, brandKit = {}, aspectRatio } = {}) {
  const shotId = sanitizeToken(shot?.id || shot?.shotId, "frame_01");
  const sceneId = sanitizeToken(shot?.sceneId, shotId.replace(/^frame_/, "scene_"));
  const aspect = resolveAspectSpec(aspectRatio, shot);
  const palette = normalizeBrandPalette(brandKit);
  const opticProfile = resolveOpticProfile(shot);
  const overlaySafeZone = resolveOverlaySafeZone(shot);

  const title = String(shot?.title || shot?.staging?.headline || "Editorial Hero Stage").trim();
  const beat = String(shot?.narrativeBeat || "hero").trim();
  const plateHint = shot?.aiBackgroundPlate
    ? ` Motif cue: ${String(shot.aiBackgroundPlate).trim()}.`
    : "";
  const guidelinesCue = palette.guidelinesText ? ` Brand world: ${palette.guidelinesText}` : "";
  const negativePrompt = NEGATIVE_SLOP_CONSTRAINTS.join("; ");

  const prompt = [
    `Art-directed ${aspect.aspectRatio} (${aspect.width}x${aspect.height} ${aspect.orientation}) cinema background design plate for "${title}" (${beat} beat).${plateHint}`,
    `Brand color architecture: primary ${palette.primary}, secondary ${palette.secondary}, accent highlight ${palette.accent}, deep stage ground ${palette.background}, elevated surface ${palette.surface} (full palette: ${palette.hexList.join(", ")}); mood: ${palette.tone}.${guidelinesCue}`,
    `Camera & optics: ${opticProfile.summary}.`,
    `Composition & clean overlay safe space: ${overlaySafeZone}`,
    `Strict anti-slop negative constraints: ${negativePrompt}. Render pure photographic/architectural lighting and surface depth only — zero text or UI chrome.`,
  ].join(" ");

  const outputRelPath = `assets/images/plate_${shotId}.png`;

  const payload = {
    shotId,
    sceneId,
    agentType: "image-generator",
    costMode: COST_MODE,
    requiresApiKey: false,
    aspectRatio: aspect.aspectRatio,
    dimensions: { width: aspect.width, height: aspect.height },
    palette,
    opticProfile,
    overlaySafeZone,
    negativeConstraints: [...NEGATIVE_SLOP_CONSTRAINTS],
    negativePrompt,
    outputRelPath,
    prompt,
  };

  Object.defineProperty(payload, "toString", {
    value() {
      return this.prompt;
    },
    enumerable: false,
  });

  return payload;
}

/**
 * Builds structured Start-Frame + End-Frame tweening & Veo / Google Flow motion prompts
 * plus step-by-step browser subagent instructions for `https://labs.google/fx/tools/flow`.
 */
export function buildGoogleFlowVideoSpec({
  shot = {},
  brandKit = {},
  aspectRatio,
  slug = "project",
} = {}) {
  const cleanSlug = sanitizeToken(slug || shot?.slug, "project");
  const shotId = sanitizeToken(shot?.id || shot?.shotId, "frame_01");
  const sceneId = sanitizeToken(shot?.sceneId, shotId.replace(/^frame_/, "scene_"));
  const aspect = resolveAspectSpec(aspectRatio, shot);
  const palette = normalizeBrandPalette(brandKit);
  const opticProfile = resolveOpticProfile(shot);
  const cameraMotionDescription = describeCameraMotion(shot);
  const overlaySafeZone = resolveOverlaySafeZone(shot);
  const durationSeconds = Math.max(1.5, round2(shot?.durationSeconds ?? 4.0));

  const startSourceRaw =
    shot?.keyframes?.start ||
    shot?.startFrame ||
    (shot?.aiBackgroundPlate ? `assets/images/plate_${shotId}.png` : null) ||
    shot?.designFramePath ||
    null;
  const endSourceRaw =
    shot?.keyframes?.end ||
    shot?.endFrame ||
    (shot?.keyframes?.peak && shot?.keyframes?.peak !== startSourceRaw
      ? shot.keyframes.peak
      : null);

  const startFrameSource = startSourceRaw ? toPosixPath(startSourceRaw) : null;
  const endFrameSource = endSourceRaw ? toPosixPath(endSourceRaw) : null;

  const startFrameImage = `${BROWSER_SANDBOX_UPLOADS_DIR}/${cleanSlug}_${shotId}_start.png`;
  const endFrameImage = `${BROWSER_SANDBOX_UPLOADS_DIR}/${cleanSlug}_${shotId}_end.png`;

  const tweenMode =
    startFrameSource && endFrameSource
      ? "start-to-end-frame"
      : startFrameSource
        ? "image-to-video"
        : "text-to-video";

  const title = String(shot?.title || shot?.staging?.headline || "Cinematic B-Roll Shot").trim();
  const tweenClause =
    tweenMode === "start-to-end-frame"
      ? "Smoothly tween from the uploaded Start Frame keyframe into the End Frame keyframe with physically plausible parallax and temporal consistency."
      : tweenMode === "image-to-video"
        ? "Animate seamlessly out of the uploaded Start Frame plate while preserving exact subject geometry and lighting continuity."
        : "Generate cohesive studio B-roll motion from scratch matching the brand color world.";

  const motionPrompt = [
    `Cinematic ${aspect.aspectRatio} (${aspect.orientation}) Veo / Google Flow motion clip for "${title}" (${durationSeconds}s).`,
    tweenClause,
    `Camera trajectory: ${cameraMotionDescription}. Optics: ${opticProfile.cameraBody}, ${opticProfile.lens} at ${opticProfile.aperture}.`,
    `Color & lighting: ${palette.background} obsidian shadow base with ${palette.primary} primary key light and subtle ${palette.accent} specular accents.`,
    `Overlay framing: ${overlaySafeZone}`,
    `Motion constraints: fluid optical camera movement, zero morphing artifacts, ${NEGATIVE_SLOP_CONSTRAINTS[0]}, ${NEGATIVE_SLOP_CONSTRAINTS[1]}.`,
  ].join(" ");

  const downloadTarget = `projects/${cleanSlug}/inbox/raw-video/flow_${shotId}.mp4`;
  const assetClipTarget = `projects/${cleanSlug}/assets/clips/flow_${shotId}.mp4`;

  const browserInstructions = [
    startFrameSource
      ? `1. Stage keyframe upload(s): copy project "${startFrameSource}" to "${startFrameImage}"${
          endFrameSource ? ` and "${endFrameSource}" to "${endFrameImage}"` : ""
        } so the browser sandbox can attach clean PNG anchors.`
      : `1. Verify "${BROWSER_SANDBOX_UPLOADS_DIR}/" is ready (no local start keyframe required for text-to-video mode; optional plate path "${startFrameImage}").`,
    `2. Open "${GOOGLE_FLOW_URL}" in the Antigravity browser tool using the user's active Google Labs subscription session ($0 costMode "${COST_MODE}", never paid API keys).`,
    `3. Auth & CAPTCHA Safety Gate: Do NOT bypass authentication, sign-in screens, CAPTCHAs, or "verify you are human" challenges. If Google Flow prompts for sign-in or verification, stop immediately and ask the user to complete it directly in the visible browser window.`,
    `4. Configure Google Flow / Veo frame builder: set aspect ratio to "${aspect.aspectRatio}" (${aspect.orientation}, ${aspect.width}x${aspect.height}) and select "${tweenMode}" mode; upload "${startFrameImage}" as Start Frame${
      endFrameSource ? ` and "${endFrameImage}" as End Frame` : ""
    }.`,
    `5. Paste the motion prompt (${cameraMotionDescription}) into the Google Flow prompt composer and generate the ${durationSeconds}s take.`,
    `6. Inspect playback for smooth optical motion and clean overlay negative space, download the rendered MP4 to "${downloadTarget}", and sync/copy the approved clip to "${assetClipTarget}".`,
  ];

  return {
    shotId,
    sceneId,
    slug: cleanSlug,
    toolUrl: GOOGLE_FLOW_URL,
    engine: "google-flow-veo",
    agentType: "browser",
    costMode: COST_MODE,
    requiresApiKey: false,
    aspectRatio: aspect.aspectRatio,
    flowOrientation: aspect.orientation,
    dimensions: { width: aspect.width, height: aspect.height },
    durationSeconds,
    startFrameImage,
    endFrameImage,
    tweening: {
      mode: tweenMode,
      startFrameSource,
      endFrameSource,
      startFrameImage,
      endFrameImage,
    },
    opticProfile,
    cameraMotionDescription,
    motionPrompt,
    downloadTarget,
    assetClipTarget,
    browserInstructions,
  };
}

/**
 * Builds a $0 local neural voiceover + Whisper alignment + FFmpeg SFX/BGM mix brief for a shot.
 */
export function buildAudioBrief({ shot = {}, brandKit = {}, language = "English" } = {}) {
  const shotId = sanitizeToken(shot?.id || shot?.shotId, "frame_01");
  const durationSeconds = Math.max(1.2, round2(shot?.durationSeconds ?? 4.0));
  const voiceoverText = String(
    shot?.audioSpec?.voiceoverText ?? shot?.voText ?? shot?.staging?.captionText ?? "",
  ).trim();

  const hasBengaliScript =
    /[\u0980-\u09FF]/.test(voiceoverText) || /bengali|বাংলা/i.test(String(language || ""));
  const explicitVoice = shot?.audioSpec?.voice || brandKit?.voice || null;
  const voice = explicitVoice || (hasBengaliScript ? "bn-BD-NabanitaNeural" : "en-US-AriaNeural");

  const rawSfx = shot?.audioSpec?.sfx ?? shot?.sfx ?? ["whoosh"];
  const sfxCues = Array.isArray(rawSfx)
    ? rawSfx.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  return {
    shotId,
    costMode: COST_MODE,
    requiresApiKey: false,
    ttsBackend: "edge-tts-neural",
    transcriptionBackend: "faster-whisper-local",
    mixBackend: "ffmpeg-local",
    voice,
    voiceoverText,
    maxSpeechWindowSeconds: Math.max(1.0, round2(durationSeconds - 0.25)),
    sfxCues,
    bgmMood: String(shot?.audioSpec?.bgmMood || "warm-modern").trim(),
    duckingDb: -16,
    outputVoiceoverRelPath: `assets/audio/vo_${shotId}.mp3`,
  };
}

function loadProjectContextFallback(slug) {
  let projectDir = null;
  try {
    projectDir = assertValidSlug(slug);
  } catch {
    return { projectDir: null, storyboard: null, brief: null };
  }
  if (!fs.existsSync(projectDir)) {
    return { projectDir, storyboard: null, brief: null };
  }

  let storyboard = null;
  const sbPath = path.join(projectDir, "STORYBOARD.json");
  if (fs.existsSync(sbPath)) {
    try {
      storyboard = JSON.parse(fs.readFileSync(sbPath, "utf8"));
    } catch {
      storyboard = null;
    }
  }

  let brief = null;
  const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
  if (fs.existsSync(briefPath)) {
    try {
      brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
    } catch {
      brief = null;
    }
  }

  return { projectDir, storyboard, brief };
}

/**
 * Produces a complete `.studio/google-multimodal-plan.json` manifest listing every shot's
 * `imageGeneratorBrief`, `googleFlowBrief`, and `audioBrief`, strictly enforcing
 * `costMode: "subscription-zero-dollar"` (never requiring paid API keys).
 */
export function buildAntigravityBatchManifest(options = {}) {
  assertSubscriptionZeroCost(options);

  const rawSlug = String(options.slug || options.storyboard?.slug || "project").trim();
  const cleanSlug = sanitizeToken(rawSlug, "project");
  const diskCtx = loadProjectContextFallback(rawSlug);

  const resolvedStoryboard = options.storyboard || diskCtx.storyboard || { frames: [] };
  const rawFrames = Array.isArray(resolvedStoryboard)
    ? resolvedStoryboard
    : Array.isArray(resolvedStoryboard?.frames)
      ? resolvedStoryboard.frames
      : Array.isArray(resolvedStoryboard?.shots)
        ? resolvedStoryboard.shots
        : [];

  const mergedBrandKit = options.brandKit || {
    ...(diskCtx.brief?.brandKit || {}),
    brandColors:
      resolvedStoryboard?.brandColors ||
      diskCtx.brief?.brandColors ||
      diskCtx.brief?.brandKit?.brandColors ||
      {},
  };

  const resolvedAspect =
    options.aspectRatio || resolvedStoryboard?.aspectRatio || diskCtx.brief?.aspectRatio || "9:16";
  const language = diskCtx.brief?.language || "English";
  const palette = normalizeBrandPalette(mergedBrandKit);
  const providerSettings = getProviderSettings();

  const shots = rawFrames.map((frame, idx) => {
    const fallbackId = `frame_${String(idx + 1).padStart(2, "0")}`;
    const shotId = sanitizeToken(frame?.id || frame?.shotId, fallbackId);
    const sceneId = sanitizeToken(frame?.sceneId, `scene_${String(idx + 1).padStart(2, "0")}`);
    const locked = Boolean(frame?.locked);
    const approved = Boolean(frame?.approved);

    const normalizedShot = {
      ...frame,
      id: shotId,
      sceneId,
    };

    const hasExplicitPlateCue = Boolean(
      frame?.needsImagePlate ||
      frame?.aiBackgroundPlate ||
      frame?.generatePlate ||
      (!frame?.sourceClip && !frame?.keyframes?.peak),
    );
    const hasExplicitFlowCue = Boolean(
      frame?.needsGoogleFlow ||
      frame?.useGoogleFlow ||
      frame?.aiVideoClip ||
      frame?.generateFlowVideo ||
      !frame?.sourceClip,
    );

    const needsImagePlate = !locked && hasExplicitPlateCue;
    const needsGoogleFlowVideo = !locked && hasExplicitFlowCue;
    const needsAudio =
      !locked &&
      Boolean(frame?.audioSpec?.voiceoverText || frame?.voText || frame?.staging?.captionText);

    const imageGeneratorBrief = buildGoogleImagePrompt({
      shot: normalizedShot,
      brandKit: mergedBrandKit,
      aspectRatio: resolvedAspect,
    });

    const googleFlowBrief = buildGoogleFlowVideoSpec({
      shot: normalizedShot,
      brandKit: mergedBrandKit,
      aspectRatio: resolvedAspect,
      slug: cleanSlug,
    });

    const audioBrief = buildAudioBrief({
      shot: normalizedShot,
      brandKit: mergedBrandKit,
      language,
    });

    return {
      id: shotId,
      shotId,
      frameId: shotId,
      sceneId,
      index: Number(frame?.index ?? idx + 1),
      title: String(frame?.title || frame?.staging?.headline || `Shot ${idx + 1}`).trim(),
      locked,
      approved,
      needsImagePlate,
      needsGoogleFlowVideo,
      needsAudio,
      imageGeneratorBrief,
      googleFlowBrief,
      audioBrief,
    };
  });

  const unlockedShots = shots.filter((s) => !s.locked).length;
  const lockedShots = shots.filter((s) => s.locked).length;

  const manifest = {
    schemaVersion: 1,
    slug: cleanSlug,
    planRelPath: ".studio/google-multimodal-plan.json",
    costMode: COST_MODE,
    zeroCostGuard: true,
    requiresApiKey: false,
    estimatedApiCostUsd: 0,
    provider: {
      providerMode: providerSettings.providerMode || "antigravity-subscription",
      model: providerSettings.model || "gemini-4-carbon-high",
      imageBackend: "antigravity-image-generator",
      videoBackend: "google-flow-browser",
      audioBackend: "edge-tts-neural",
      flowUrl: GOOGLE_FLOW_URL,
    },
    aspectRatio: resolveAspectSpec(resolvedAspect).aspectRatio,
    brandPalette: palette,
    summary: {
      totalShots: shots.length,
      unlockedShots,
      lockedShots,
      imagePlateCount: shots.filter((s) => s.needsImagePlate).length,
      googleFlowCount: shots.filter((s) => s.needsGoogleFlowVideo).length,
      audioCount: shots.filter((s) => s.needsAudio).length,
    },
    shots,
    workflowInvocation: {
      scriptPath: "studio-hub/workflows/google_media_crew.py",
      args: { slug: cleanSlug },
    },
    generatedAt: new Date().toISOString(),
  };

  if (options.persist === true || options.writeToDisk === true) {
    saveGoogleMultimodalPlan(rawSlug, manifest);
  }

  return manifest;
}

export function saveGoogleMultimodalPlan(slug, manifest, baseProjectsDir = PROJECTS_DIR) {
  let projectDir;
  if (baseProjectsDir === PROJECTS_DIR) {
    projectDir = assertValidSlug(slug);
  } else {
    if (!slug || !/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) {
      throw new Error(`Invalid project slug: ${slug}`);
    }
    projectDir = path.resolve(baseProjectsDir, slug);
  }

  const planRelPath = ".studio/google-multimodal-plan.json";
  const planPath = path.join(projectDir, ".studio", "google-multimodal-plan.json");
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { planPath, planRelPath, manifest };
}

export function loadGoogleMultimodalPlan(slug, baseProjectsDir = PROJECTS_DIR) {
  const projectDir =
    baseProjectsDir === PROJECTS_DIR ? assertValidSlug(slug) : path.resolve(baseProjectsDir, slug);
  const planPath = path.join(projectDir, ".studio", "google-multimodal-plan.json");
  if (!fs.existsSync(planPath)) return null;
  return JSON.parse(fs.readFileSync(planPath, "utf8"));
}

export function generateGoogleMultimodalPlan({
  slug,
  storyboard = null,
  brandKit = null,
  aspectRatio = null,
  enqueueTickets = false,
  forcePaidApi = false,
  costMode = COST_MODE,
  projectsDir = PROJECTS_DIR,
} = {}) {
  assertSubscriptionZeroCost({ forcePaidApi, costMode });
  const manifest = buildAntigravityBatchManifest({
    slug,
    storyboard,
    brandKit,
    aspectRatio,
    costMode,
    forcePaidApi,
  });

  const { planPath, planRelPath } = saveGoogleMultimodalPlan(slug, manifest, projectsDir);
  const tickets = [];

  if (enqueueTickets) {
    for (const shot of manifest.shots) {
      if (shot.locked) continue;
      if (shot.needsImagePlate) {
        tickets.push(
          enqueueAgentTask({
            slug,
            type: "ai_generate_image_plate",
            payload: {
              frameId: shot.shotId,
              shotId: shot.shotId,
              costMode: COST_MODE,
              forcePaidApi,
              outputRelPath: shot.imageGeneratorBrief.outputRelPath,
              prompt: shot.imageGeneratorBrief.prompt,
            },
          }),
        );
      }
      if (shot.needsGoogleFlowVideo) {
        tickets.push(
          enqueueAgentTask({
            slug,
            type: "ai_google_flow_video",
            payload: {
              frameId: shot.shotId,
              shotId: shot.shotId,
              costMode: COST_MODE,
              forcePaidApi,
              toolUrl: GOOGLE_FLOW_URL,
              downloadTarget: shot.googleFlowBrief.downloadTarget,
              motionPrompt: shot.googleFlowBrief.motionPrompt,
            },
          }),
        );
      }
    }
  }

  return {
    ok: true,
    slug: manifest.slug,
    costMode: COST_MODE,
    planRelPath,
    planPath,
    ticketsEnqueued: tickets.length,
    tickets,
    manifest,
  };
}

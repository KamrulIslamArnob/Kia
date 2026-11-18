import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PROJECTS_DIR = path.resolve(__dirname, "..", "projects");
const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function round3(val) {
  return Math.round(val * 1000) / 1000;
}

function round4(val) {
  return Math.round(val * 10000) / 10000;
}

function buildDualTargets(definitions) {
  const arr = definitions.map((entry) => Object.freeze({ ...entry }));
  for (const item of arr) {
    Object.defineProperty(arr, item.id, {
      value: item,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(arr);
}

const REFRAME_TARGET_DEFINITIONS = [
  {
    id: "9:16",
    aspectRatio: "9:16",
    label: "Vertical Reel / Shorts (9:16)",
    width: 1080,
    height: 1920,
    ratio: 9 / 16,
  },
  {
    id: "16:9",
    aspectRatio: "16:9",
    label: "Landscape Widescreen (16:9)",
    width: 1920,
    height: 1080,
    ratio: 16 / 9,
  },
  {
    id: "1:1",
    aspectRatio: "1:1",
    label: "Square Social Feed (1:1)",
    width: 1080,
    height: 1080,
    ratio: 1,
  },
  {
    id: "4:5",
    aspectRatio: "4:5",
    label: "Portrait Feed (4:5)",
    width: 1080,
    height: 1350,
    ratio: 4 / 5,
  },
];

export const REFRAME_TARGETS = buildDualTargets(REFRAME_TARGET_DEFINITIONS);

function resolveTargetAspectSpec(rawAspect) {
  if (rawAspect === undefined || rawAspect === null || String(rawAspect).trim() === "") {
    return REFRAME_TARGETS["16:9"];
  }
  const normalized = String(rawAspect).trim().toLowerCase().replace(/[x/]/g, ":");
  const spec = REFRAME_TARGETS[normalized];
  if (!spec) {
    const err = new Error(
      `Unsupported targetAspect: "${rawAspect}". Must be one of 9:16, 16:9, 1:1, 4:5.`,
    );
    err.statusCode = 400;
    throw err;
  }
  return spec;
}

function isBoxLike(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }
  const w = Number(candidate.width ?? candidate.w);
  const h = Number(candidate.height ?? candidate.h);
  return Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0;
}

function normalizeFaceBox(rawBox, sourceWidth, sourceHeight) {
  if (!isBoxLike(rawBox)) {
    return null;
  }
  const rx = Number(rawBox.x ?? 0);
  const ry = Number(rawBox.y ?? 0);
  const rw = Number(rawBox.width ?? rawBox.w);
  const rh = Number(rawBox.height ?? rawBox.h);
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || rw <= 0 || rh <= 0) {
    return null;
  }

  const isPixelSpace = rx > 1 || ry > 1 || rw > 1 || rh > 1;
  const nx = clamp(isPixelSpace ? rx / sourceWidth : rx, 0, 0.98);
  const ny = clamp(isPixelSpace ? ry / sourceHeight : ry, 0, 0.98);
  const nw = clamp(isPixelSpace ? rw / sourceWidth : rw, 0.01, 1 - nx);
  const nh = clamp(isPixelSpace ? rh / sourceHeight : rh, 0.01, 1 - ny);

  return {
    x: round4(nx),
    y: round4(ny),
    width: round4(nw),
    height: round4(nh),
  };
}

function resolveShotFaceBox(frame, faceBoxInput, sourceWidth, sourceHeight) {
  const frameBox =
    frame?.faceBox || frame?.characterDetection?.faceBox || frame?.staging?.faceBox || null;
  if (isBoxLike(frameBox)) {
    return normalizeFaceBox(frameBox, sourceWidth, sourceHeight);
  }
  if (!faceBoxInput || typeof faceBoxInput !== "object") {
    return null;
  }
  if (isBoxLike(faceBoxInput)) {
    return normalizeFaceBox(faceBoxInput, sourceWidth, sourceHeight);
  }
  const frameId = String(frame?.id || "");
  const sceneId = String(frame?.sceneId || "");
  const mapped = (frameId && faceBoxInput[frameId]) || (sceneId && faceBoxInput[sceneId]) || null;
  return normalizeFaceBox(mapped, sourceWidth, sourceHeight);
}

function normalizePointCoord(raw, maxPixels, fallback = 0.5) {
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  if (num > 100) {
    return clamp(num / maxPixels, 0, 1);
  }
  if (num > 1) {
    return clamp(num / 100, 0, 1);
  }
  return clamp(num, 0, 1);
}

function resolveShotSaliency(frame, face, sourceWidth, sourceHeight) {
  if (face) {
    return {
      source: "face",
      x: clamp(face.x + 0.5 * face.width, 0, 1),
      y: clamp(face.y + 0.38 * face.height, 0, 1),
      crownY: Math.max(0, face.y - 0.3 * face.height),
      eyeY: clamp(face.y + 0.38 * face.height, 0, 1),
      chinY: Math.min(1, face.y + 1.06 * face.height),
    };
  }

  const cursor = frame?.staging?.cursorTarget || frame?.cursorTarget;
  if (cursor && typeof cursor === "object" && (cursor.x !== undefined || cursor.y !== undefined)) {
    return {
      source: "cursor",
      x: normalizePointCoord(cursor.x, sourceWidth, 0.5),
      y: normalizePointCoord(cursor.y, sourceHeight, 0.5),
      crownY: null,
      eyeY: null,
      chinY: null,
    };
  }

  const cam = frame?.cameraMotion || frame?.staging?.camera || frame?.camera;
  if (cam && typeof cam === "object" && (cam.focusX !== undefined || cam.focusY !== undefined)) {
    return {
      source: "camera-focus",
      x: normalizePointCoord(cam.focusX, sourceWidth, 0.5),
      y: normalizePointCoord(cam.focusY, sourceHeight, 0.42),
      crownY: null,
      eyeY: null,
      chinY: null,
    };
  }

  return {
    source: "center-editorial",
    x: 0.5,
    y: 0.42,
    crownY: null,
    eyeY: null,
    chinY: null,
  };
}

function loadStoryboardFromSlug(slug, projectsDir = DEFAULT_PROJECTS_DIR) {
  const cleaned = String(slug || "").trim();
  if (!cleaned || !SAFE_SLUG_RE.test(cleaned)) {
    const err = new Error(`Invalid project slug: "${slug}"`);
    err.statusCode = 400;
    throw err;
  }
  const sbPath = path.join(projectsDir, cleaned, "STORYBOARD.json");
  if (!fs.existsSync(sbPath)) {
    const err = new Error(`Storyboard not found for project "${cleaned}"`);
    err.statusCode = 404;
    throw err;
  }
  return JSON.parse(fs.readFileSync(sbPath, "utf8"));
}

/**
 * Computes deterministic per-shot crop, pan, focal, and scale coordinates for
 * reframing a storyboard across 9:16, 16:9, 1:1, and 4:5 masters without cropping heads.
 */
export function computeSmartReframePlan({
  storyboard = null,
  slug = null,
  sourceWidth = 1080,
  sourceHeight = 1920,
  targetAspect = "16:9",
  faceBox = null,
  projectsDir = DEFAULT_PROJECTS_DIR,
} = {}) {
  const targetSpec = resolveTargetAspectSpec(targetAspect);
  const resolvedStoryboard =
    storyboard || (slug ? loadStoryboardFromSlug(slug, projectsDir) : { frames: [] });

  const rawFrames = Array.isArray(resolvedStoryboard)
    ? resolvedStoryboard
    : Array.isArray(resolvedStoryboard?.frames)
      ? resolvedStoryboard.frames
      : Array.isArray(resolvedStoryboard?.shots)
        ? resolvedStoryboard.shots
        : [];

  const srcW = Math.max(
    64,
    Math.round((Number(sourceWidth) || Number(resolvedStoryboard?.width) || 1080) / 2) * 2,
  );
  const srcH = Math.max(
    64,
    Math.round((Number(sourceHeight) || Number(resolvedStoryboard?.height) || 1920) / 2) * 2,
  );
  const sourceRatio = srcW / srcH;
  const targetRatio = targetSpec.width / targetSpec.height;

  const cropWNorm = targetRatio >= sourceRatio ? 1.0 : clamp(targetRatio / sourceRatio, 0.05, 1.0);
  const cropHNorm = targetRatio >= sourceRatio ? clamp(sourceRatio / targetRatio, 0.05, 1.0) : 1.0;

  const shots = rawFrames.map((frame, idx) => {
    const shotNum = String(idx + 1).padStart(2, "0");
    const frameId = String(frame?.id || `frame_${shotNum}`);
    const sceneId = String(frame?.sceneId || `scene_${shotNum}`);
    const face = resolveShotFaceBox(frame, faceBox, srcW, srcH);
    const saliency = resolveShotSaliency(frame, face, srcW, srcH);

    // 1. Vertical crop window placement with strict head-crown protection
    let cropTopNorm = 0;
    let focusY = saliency.y;
    if (cropHNorm < 1.0) {
      if (face) {
        cropTopNorm = saliency.eyeY - 0.38 * cropHNorm;
        if (cropTopNorm + cropHNorm < saliency.chinY) {
          cropTopNorm = saliency.chinY - cropHNorm;
        }
        const headroomPad = Math.min(0.025, saliency.crownY);
        if (cropTopNorm > saliency.crownY - headroomPad) {
          cropTopNorm = saliency.crownY - headroomPad;
        }
        cropTopNorm = clamp(cropTopNorm, 0, 1 - cropHNorm);
      } else {
        cropTopNorm = clamp(saliency.y - 0.5 * cropHNorm, 0, 1 - cropHNorm);
      }
      focusY = cropTopNorm + 0.5 * cropHNorm;
    }

    // 2. Horizontal crop window placement keeping face cheeks/shoulders inside
    let cropLeftNorm = 0;
    let focusX = saliency.x;
    if (cropWNorm < 1.0) {
      cropLeftNorm = clamp(saliency.x - 0.5 * cropWNorm, 0, 1 - cropWNorm);
      if (face) {
        const rightSafe = Math.min(1, face.x + face.width + 0.02);
        if (cropLeftNorm + cropWNorm < rightSafe) {
          cropLeftNorm = rightSafe - cropWNorm;
        }
        const leftSafe = Math.max(0, face.x - 0.02);
        if (cropLeftNorm > leftSafe) {
          cropLeftNorm = leftSafe;
        }
        cropLeftNorm = clamp(cropLeftNorm, 0, 1 - cropWNorm);
      }
      focusX = cropLeftNorm + 0.5 * cropWNorm;
    }

    // 3. Even-pixel FFmpeg-ready crop box inside (srcW x srcH)
    const cropW = Math.min(srcW, Math.max(2, Math.floor((cropWNorm * srcW) / 2) * 2));
    const cropH = Math.min(srcH, Math.max(2, Math.floor((cropHNorm * srcH) / 2) * 2));
    const cropX = clamp(Math.floor((cropLeftNorm * srcW) / 2) * 2, 0, srcW - cropW);
    const cropY = clamp(Math.floor((cropTopNorm * srcH) / 2) * 2, 0, srcH - cropH);

    // 4. Head-safe camera motion scale (caps aggressive zoom on tight vertical crops)
    const cam = frame?.cameraMotion || frame?.staging?.camera || frame?.camera || {};
    const rawFromScale = Number(cam.fromScale) || 1.0;
    const rawToScale = Number(cam.toScale) || Math.max(1.06, rawFromScale);
    let scale = round3(clamp(Math.max(1.0, rawFromScale), 1.0, 2.2));
    let toScale = round3(clamp(Math.max(scale, rawToScale), 1.0, 2.2));

    if (face) {
      const headSpanInCrop = (saliency.chinY - saliency.crownY) / cropHNorm;
      const maxHeadSafeScale = clamp(0.88 / Math.max(0.12, headSpanInCrop), 1.0, 1.65);
      scale = round3(clamp(Math.min(scale, maxHeadSafeScale), 1.0, 2.0));
      toScale = round3(clamp(Math.min(toScale, maxHeadSafeScale), 1.0, 2.0));
    }

    const objPosX = cropWNorm < 1 ? cropLeftNorm / (1 - cropWNorm) : focusX;
    const objPosY = cropHNorm < 1 ? cropTopNorm / (1 - cropHNorm) : focusY;

    const headSafe = face
      ? cropY <= Math.floor(saliency.crownY * srcH) + 2 &&
        cropY + cropH >= Math.round(saliency.eyeY * srcH)
      : true;

    return Object.freeze({
      id: frameId,
      frameId,
      sceneId,
      index: idx + 1,
      title: String(frame?.title || frame?.staging?.headline || `Shot ${shotNum}`),
      focusX: round4(clamp(focusX, 0, 1)),
      focusY: round4(clamp(focusY, 0, 1)),
      scale,
      toScale,
      width: targetSpec.width,
      height: targetSpec.height,
      panX: round3((0.5 - focusX) * 100),
      panY: round3((0.5 - focusY) * 100),
      objectPosition: `${round3(clamp(objPosX, 0, 1) * 100)}% ${round3(clamp(objPosY, 0, 1) * 100)}%`,
      cropBox: Object.freeze({
        x: cropX,
        y: cropY,
        width: cropW,
        height: cropH,
      }),
      ffmpegFilter: `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${targetSpec.width}:${targetSpec.height}:flags=lanczos`,
      anchorSource: saliency.source,
      headSafe,
      faceBox: face ? Object.freeze({ ...face }) : null,
    });
  });

  const frozenShots = Object.freeze(shots);

  return {
    ok: true,
    targetAspect: targetSpec.id,
    aspectRatio: targetSpec.id,
    label: targetSpec.label,
    sourceWidth: srcW,
    sourceHeight: srcH,
    width: targetSpec.width,
    height: targetSpec.height,
    shotCount: frozenShots.length,
    shots: frozenShots,
    frames: frozenShots,
  };
}

/**
 * Convenience batch planner computing smart reframe plans across multiple target
 * aspects (defaults to all 4 studio targets: 9:16, 16:9, 1:1, 4:5).
 */
export function computeMultiAspectReframePlans({
  storyboard = null,
  slug = null,
  sourceWidth = 1080,
  sourceHeight = 1920,
  targetAspects = ["9:16", "16:9", "1:1", "4:5"],
  faceBox = null,
  projectsDir = DEFAULT_PROJECTS_DIR,
} = {}) {
  const resolvedStoryboard =
    storyboard || (slug ? loadStoryboardFromSlug(slug, projectsDir) : { frames: [] });
  const aspects =
    Array.isArray(targetAspects) && targetAspects.length > 0
      ? targetAspects
      : ["9:16", "16:9", "1:1", "4:5"];

  const plans = {};
  for (const aspect of aspects) {
    const plan = computeSmartReframePlan({
      storyboard: resolvedStoryboard,
      sourceWidth,
      sourceHeight,
      targetAspect: aspect,
      faceBox,
      projectsDir,
    });
    plans[plan.targetAspect] = plan;
  }

  return {
    ok: true,
    aspects: Object.keys(plans),
    plans,
  };
}

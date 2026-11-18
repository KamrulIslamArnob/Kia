import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PROJECTS_DIR,
  ensureProjectDirs,
  getToolEnv,
  resolvePythonBin,
  runCommand,
  syncProjectManifest,
} from "./lib.mjs";

const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);

export const MATTE_DEFAULTS = Object.freeze({
  featherSigma: 2.6,
  grabCutIterations: 5,
});

let videoFrameTempSeq = 0;

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function hasTraversalSegment(rawPath) {
  return /(^|[\\/])\.\.([\\/]|$)/.test(String(rawPath || ""));
}

function sanitizeMatteStem(rawStem) {
  const cleaned = String(rawStem || "")
    .trim()
    .replace(/^matte_+/i, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "subject";
}

function resolveValidatedProjectDir(slug, projectsDir = PROJECTS_DIR) {
  const rawSlug = String(slug || "").trim();
  if (!rawSlug || !SAFE_SLUG_RE.test(rawSlug) || hasTraversalSegment(rawSlug)) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  const baseProjectsDir = path.resolve(projectsDir);
  const projectDir = path.resolve(baseProjectsDir, rawSlug);
  if (!projectDir.startsWith(baseProjectsDir + path.sep)) {
    throw new Error(`Invalid project slug path: ${slug}`);
  }
  if (baseProjectsDir === path.resolve(PROJECTS_DIR)) {
    ensureProjectDirs(rawSlug);
  } else {
    fs.mkdirSync(path.join(projectDir, "assets", "images"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, ".studio", "frames", "tmp"), { recursive: true });
  }
  return projectDir;
}

function normalizeOutRelPath(outRelPath, sourcePath, projectDir) {
  if (!outRelPath) {
    const ext = path.extname(sourcePath);
    const stem = sanitizeMatteStem(path.basename(sourcePath, ext));
    return `assets/images/matte_${stem}.png`;
  }

  const raw = String(outRelPath).trim().replaceAll("\\", "/");
  if (!raw || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw) || hasTraversalSegment(raw)) {
    throw new Error(`Unsafe outRelPath traversal rejected: ${outRelPath}`);
  }

  const withPng = raw.toLowerCase().endsWith(".png") ? raw : `${raw.replace(/\.[^./]+$/, "")}.png`;

  const resolvedOut = path.resolve(projectDir, withPng);
  if (!resolvedOut.startsWith(projectDir + path.sep)) {
    throw new Error(`Unsafe outRelPath outside project directory: ${outRelPath}`);
  }
  return withPng;
}

function pickFirstExistingFile(projectDir, relCandidates) {
  for (const rel of relCandidates) {
    if (!rel || typeof rel !== "string") continue;
    const cleaned = rel.trim().replaceAll("\\", "/").replace(/^\/+/, "");
    if (!cleaned || hasTraversalSegment(cleaned)) continue;
    const abs = path.resolve(projectDir, cleaned);
    if (abs.startsWith(projectDir + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return abs;
    }
  }
  return null;
}

function scanDirForSourceMedia(absDir, allowedExts, excludeMattePrefix = false) {
  if (!fs.existsSync(absDir)) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = entries
    .filter((entry) => {
      if (!entry.isFile()) return false;
      if (excludeMattePrefix && /^matte_/i.test(entry.name)) return false;
      const ext = path.extname(entry.name).toLowerCase();
      return allowedExts.has(ext);
    })
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return files.length > 0 ? path.join(absDir, files[0]) : null;
}

export function resolveSubjectSourceImage({
  projectDir,
  slug = "",
  imagePath = null,
  frameId = null,
} = {}) {
  if (imagePath !== null && imagePath !== undefined && String(imagePath).trim() !== "") {
    let raw = String(imagePath).trim();
    const mediaPrefix = slug ? `/media/${encodeURIComponent(slug)}/` : "";
    if (mediaPrefix && raw.startsWith(mediaPrefix)) {
      raw = raw
        .slice(mediaPrefix.length)
        .split("/")
        .map((seg) => decodeURIComponent(seg))
        .join("/");
    } else if (raw.startsWith("/media/")) {
      const parts = raw.replace(/^\/media\/[^/]+\//, "");
      raw = parts
        .split("/")
        .map((seg) => decodeURIComponent(seg))
        .join("/");
    }

    if (hasTraversalSegment(raw)) {
      throw new Error(`Unsafe imagePath traversal rejected: ${imagePath}`);
    }

    if (path.isAbsolute(raw)) {
      if (!fs.existsSync(raw) || !fs.statSync(raw).isFile()) {
        throw new Error(`Source image file not found: ${imagePath}`);
      }
      return path.resolve(raw);
    }

    const inProject = path.resolve(projectDir, raw);
    if (!inProject.startsWith(projectDir + path.sep)) {
      throw new Error(`Unsafe relative imagePath outside project: ${imagePath}`);
    }
    if (!fs.existsSync(inProject) || !fs.statSync(inProject).isFile()) {
      throw new Error(`Source image file not found: ${imagePath}`);
    }
    return inProject;
  }

  // Auto-discover from STORYBOARD.json or project frame/media folders
  const storyboardPath = path.join(projectDir, "STORYBOARD.json");
  if (fs.existsSync(storyboardPath)) {
    try {
      const sb = JSON.parse(fs.readFileSync(storyboardPath, "utf8"));
      const frames = Array.isArray(sb?.frames) ? sb.frames : [];
      const targetFrame =
        (frameId ? frames.find((f) => f?.id === frameId) : null) || frames[0] || null;
      if (targetFrame) {
        const found = pickFirstExistingFile(projectDir, [
          targetFrame?.keyframes?.peak,
          targetFrame?.keyframes?.start,
          targetFrame?.staging?.aiBackgroundPlate,
          targetFrame?.currentDesignImage,
          targetFrame?.sourceClip,
        ]);
        if (found) return found;
      }
    } catch {
      // Ignore malformed STORYBOARD.json and continue folder discovery
    }
  }

  const rawFrameCandidate =
    scanDirForSourceMedia(path.join(projectDir, ".studio", "frames", "raw"), IMAGE_EXTS) ||
    scanDirForSourceMedia(path.join(projectDir, "inbox", "images"), IMAGE_EXTS) ||
    scanDirForSourceMedia(path.join(projectDir, "assets", "images"), IMAGE_EXTS, true) ||
    scanDirForSourceMedia(path.join(projectDir, ".studio", "frames", "design"), IMAGE_EXTS) ||
    scanDirForSourceMedia(path.join(projectDir, "inbox", "raw-video"), VIDEO_EXTS) ||
    scanDirForSourceMedia(path.join(projectDir, "assets", "clips"), VIDEO_EXTS);

  if (!rawFrameCandidate) {
    throw new Error(`No source image or keyframe found in project "${slug}" for subject matte`);
  }
  return rawFrameCandidate;
}

const PYTHON_SUBJECT_MATTE_SCRIPT = `
import sys, json, cv2, numpy as np

in_path = sys.argv[1]
out_path = sys.argv[2]
feather_sigma = float(sys.argv[3]) if len(sys.argv) > 3 else 2.6
grabcut_iters = int(sys.argv[4]) if len(sys.argv) > 4 else 5

raw = np.fromfile(in_path, dtype=np.uint8)
decoded = cv2.imdecode(raw, cv2.IMREAD_UNCHANGED)
if decoded is None:
    print(json.dumps({"ok": False, "error": "Failed to decode input image"}))
    sys.exit(2)

if decoded.ndim == 2:
    bgr = cv2.cvtColor(decoded, cv2.COLOR_GRAY2BGR)
elif decoded.shape[2] == 4:
    bgr = cv2.cvtColor(decoded, cv2.COLOR_BGRA2BGR)
else:
    bgr = decoded[:, :, :3].copy()

h0, w0 = bgr.shape[:2]
max_dim = 480.0
scale = min(1.0, max_dim / float(max(h0, w0)))
sw = max(32, int(round(w0 * scale)))
sh = max(32, int(round(h0 * scale)))
small = cv2.resize(bgr, (sw, sh), interpolation=cv2.INTER_AREA) if scale < 1.0 else bgr.copy()
gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

face_rect = None
seed_method = None

# 1. Primary Haar Cascade face detector when available in OpenCV build
if hasattr(cv2, "CascadeClassifier") and hasattr(cv2, "data"):
    for xml_name in (
        "haarcascade_frontalface_default.xml",
        "haarcascade_frontalface_alt2.xml",
        "haarcascade_profileface.xml",
    ):
        try:
            cand = cv2.CascadeClassifier(cv2.data.haarcascades + xml_name)
            if not cand.empty():
                rects = cand.detectMultiScale(
                    gray,
                    scaleFactor=1.1,
                    minNeighbors=4,
                    minSize=(max(16, int(sw * 0.08)), max(16, int(sh * 0.08))),
                )
                if len(rects) > 0:
                    rx, ry, rw, rh = max(rects, key=lambda r: int(r[2]) * int(r[3]))
                    face_rect = (int(rx), int(ry), int(rw), int(rh))
                    seed_method = "haar-face-torso"
                    break
        except Exception:
            pass

# 2. Dual-space YCrCb + HSV skin chrominance face/head detector (OpenCV 5.0+ & portrait fallback)
if face_rect is None:
    ycrcb = cv2.cvtColor(small, cv2.COLOR_BGR2YCrCb)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    m_ycrcb = cv2.inRange(
        ycrcb,
        np.array([25, 129, 72], dtype=np.uint8),
        np.array([253, 185, 138], dtype=np.uint8),
    )
    m_hsv1 = cv2.inRange(
        hsv,
        np.array([0, 16, 30], dtype=np.uint8),
        np.array([28, 210, 255], dtype=np.uint8),
    )
    m_hsv2 = cv2.inRange(
        hsv,
        np.array([165, 16, 30], dtype=np.uint8),
        np.array([180, 210, 255], dtype=np.uint8),
    )
    skin_mask = cv2.bitwise_and(m_ycrcb, cv2.bitwise_or(m_hsv1, m_hsv2))
    k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_OPEN, k5)
    skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_CLOSE, k5)

    cnts_res = cv2.findContours(skin_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cnts = cnts_res[0] if len(cnts_res) == 2 else cnts_res[1]
    best_score = 0.0
    for cnt in cnts:
        area = cv2.contourArea(cnt)
        if area <= 0:
            continue
        bx, by, bw, bh = cv2.boundingRect(cnt)
        if by > int(sh * 0.72):
            continue
        box_ratio = (bw * bh) / float(sw * sh)
        aspect = bh / float(max(1, bw))
        solidity = area / float(max(1, bw * bh))
        if box_ratio < 0.008 or box_ratio > 0.48:
            continue
        if aspect < 0.55 or aspect > 2.5 or solidity < 0.38:
            continue
        cx_norm = abs(((bx + bw * 0.5) / float(sw)) - 0.5)
        score = box_ratio * (1.15 - 0.6 * cx_norm)
        if score > best_score:
            best_score = score
            face_rect = (int(bx), int(by), int(bw), int(bh))
            seed_method = "skin-face-torso"

gc_mask = np.full((sh, sw), cv2.GC_PR_BGD, dtype=np.uint8)
bx_pad = max(2, int(round(sw * 0.04)))
by_pad = max(2, int(round(sh * 0.04)))

torso_rect = None

if face_rect is not None:
    fx, fy, fw, fh = face_rect
    fcx = fx + fw // 2
    head_cy = max(by_pad + 4, int(round(fy + fh * 0.38)))
    head_rx = max(8, int(round(fw * 0.72)))
    head_ry = max(10, int(round(fh * 0.82)))

    tw = min(int(sw * 0.88), max(int(round(fw * 2.85)), int(round(sw * 0.34))))
    tx = max(bx_pad, min(sw - bx_pad - tw, fcx - tw // 2))
    ty = max(by_pad + 4, int(round(fy + fh * 0.78)))
    th = max(8, sh - ty)
    torso_rect = (int(tx), int(ty), int(tw), int(th))

    shoulder_y = min(sh - 1, ty + max(6, int(round(fh * 0.42))))
    neck_half = max(6, int(round(fw * 0.42)))
    torso_poly = np.array([
        [tx, sh - 1],
        [tx + int(round(tw * 0.06)), shoulder_y],
        [max(bx_pad, fcx - neck_half), ty],
        [min(sw - bx_pad, fcx + neck_half), ty],
        [tx + tw - int(round(tw * 0.06)), shoulder_y],
        [tx + tw, sh - 1],
    ], dtype=np.int32)

    cv2.fillConvexPoly(gc_mask, torso_poly, int(cv2.GC_PR_FGD))
    cv2.ellipse(gc_mask, (fcx, head_cy), (head_rx, head_ry), 0, 0, 360, int(cv2.GC_PR_FGD), -1)

    # Definite foreground core (face center + neck + central chest)
    core_rx = max(4, int(round(fw * 0.40)))
    core_ry = max(6, int(round(fh * 0.48)))
    cv2.ellipse(gc_mask, (fcx, fy + fh // 2), (core_rx, core_ry), 0, 0, 360, int(cv2.GC_FGD), -1)

    chest_half = max(6, int(round(fw * 0.62)))
    chest_top = min(sh - 2, int(round(fy + fh * 0.85)))
    chest_bot = min(sh - 1, int(round(fy + fh * 3.6)))
    if chest_bot > chest_top:
        cv2.rectangle(
            gc_mask,
            (max(bx_pad + 1, fcx - chest_half), chest_top),
            (min(sw - bx_pad - 1, fcx + chest_half), chest_bot),
            int(cv2.GC_FGD),
            -1,
        )
else:
    # 3. Border-contrast Lab color saliency seed for non-skin / stylized subjects
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    border_samples = np.concatenate([
        lab[:by_pad, :, :].reshape(-1, 3),
        lab[:, :bx_pad, :].reshape(-1, 3),
        lab[:, sw - bx_pad:, :].reshape(-1, 3),
    ], axis=0)
    bg_med = np.median(border_samples, axis=0)
    dist = np.linalg.norm(lab - bg_med, axis=2)
    border_dist = np.linalg.norm(border_samples - bg_med, axis=1)
    thresh = max(14.0, float(np.percentile(border_dist, 95)) * 1.45 + 6.0)

    sal = (dist > thresh).astype(np.uint8) * 255
    sal[:by_pad, :] = 0
    sal[:, :bx_pad] = 0
    sal[:, sw - bx_pad:] = 0

    k7 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    sal = cv2.morphologyEx(sal, cv2.MORPH_CLOSE, k7)
    sal = cv2.morphologyEx(sal, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    sal_ratio = float(np.mean(sal > 0))

    if 0.015 <= sal_ratio <= 0.82:
        seed_method = "border-contrast-saliency"
        dilated = cv2.dilate(sal, k7, iterations=1)
        eroded = cv2.erode(sal, k7, iterations=1)
        gc_mask[dilated > 0] = cv2.GC_PR_FGD
        if np.any(eroded > 0):
            gc_mask[eroded > 0] = cv2.GC_FGD
        else:
            gc_mask[sal > 0] = cv2.GC_FGD
    else:
        seed_method = "portrait-silhouette-fallback"
        cx, cy = sw // 2, int(sh * 0.38)
        cv2.ellipse(gc_mask, (cx, cy), (int(sw * 0.20), int(sh * 0.16)), 0, 0, 360, int(cv2.GC_PR_FGD), -1)
        cv2.rectangle(gc_mask, (int(sw * 0.24), int(sh * 0.50)), (int(sw * 0.76), sh - 1), int(cv2.GC_PR_FGD), -1)
        cv2.ellipse(gc_mask, (cx, cy), (int(sw * 0.11), int(sh * 0.09)), 0, 0, 360, int(cv2.GC_FGD), -1)
        cv2.rectangle(gc_mask, (int(sw * 0.36), int(sh * 0.54)), (int(sw * 0.64), sh - 1), int(cv2.GC_FGD), -1)

# Enforce clean outer background frame on top, left, right, and far bottom corners
gc_mask[:by_pad, :] = cv2.GC_BGD
gc_mask[:, :bx_pad] = cv2.GC_BGD
gc_mask[:, sw - bx_pad:] = cv2.GC_BGD
corner_w = max(bx_pad, int(round(sw * 0.07)))
gc_mask[sh - by_pad:, :corner_w] = cv2.GC_BGD
gc_mask[sh - by_pad:, sw - corner_w:] = cv2.GC_BGD

seed_backup = np.where((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

bgd_model = np.zeros((1, 65), dtype=np.float64)
fgd_model = np.zeros((1, 65), dtype=np.float64)

has_bg = bool(np.any((gc_mask == cv2.GC_BGD) | (gc_mask == cv2.GC_PR_BGD)))
has_fg = bool(np.any((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD)))

if has_bg and has_fg:
    try:
        cv2.grabCut(small, gc_mask, None, bgd_model, fgd_model, max(1, grabcut_iters), cv2.GC_INIT_WITH_MASK)
    except Exception:
        pass

fg_small = np.where((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
fg_ratio = float(np.mean(fg_small > 0))
if fg_ratio < 0.015 or fg_ratio > 0.94:
    fg_small = seed_backup

# Morphological refinement + retain significant foreground subject components
fg_small = cv2.morphologyEx(
    fg_small,
    cv2.MORPH_CLOSE,
    cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
)
fg_small = cv2.morphologyEx(
    fg_small,
    cv2.MORPH_OPEN,
    cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
)

cnts_fg_res = cv2.findContours(fg_small, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
cnts_fg = cnts_fg_res[0] if len(cnts_fg_res) == 2 else cnts_fg_res[1]
if len(cnts_fg) > 0:
    areas = [cv2.contourArea(c) for c in cnts_fg]
    max_area = max(areas)
    cleaned = np.zeros_like(fg_small)
    for c, a in zip(cnts_fg, areas):
        if a >= max_area * 0.08:
            cv2.drawContours(cleaned, [c], -1, 255, -1)
    fg_small = cleaned

fg_full = (
    cv2.resize(fg_small, (w0, h0), interpolation=cv2.INTER_LINEAR)
    if (sw != w0 or sh != h0)
    else fg_small
)

# Gaussian alpha feathering for smooth anti-aliased occlusion edges
sigma = max(0.6, min(12.0, feather_sigma))
alpha = cv2.GaussianBlur(fg_full, (0, 0), sigmaX=sigma, sigmaY=sigma)
alpha = np.where(alpha < 2, 0, np.where(alpha > 253, 255, alpha)).astype(np.uint8)

bgra = cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA)
zero_mask = alpha == 0
bgra[zero_mask, 0] = 0
bgra[zero_mask, 1] = 0
bgra[zero_mask, 2] = 0
bgra[:, :, 3] = alpha

ok, encoded = cv2.imencode(".png", bgra)
if not ok:
    print(json.dumps({"ok": False, "error": "Failed to encode RGBA PNG"}))
    sys.exit(3)
encoded.tofile(out_path)

ys, xs = np.where(alpha > 25)
subject_box = None
if len(xs) > 0 and len(ys) > 0:
    x0, x1 = int(np.min(xs)), int(np.max(xs))
    y0, y1 = int(np.min(ys)), int(np.max(ys))
    subject_box = {
        "x": round(x0 / float(w0), 4),
        "y": round(y0 / float(h0), 4),
        "width": round((x1 - x0 + 1) / float(w0), 4),
        "height": round((y1 - y0 + 1) / float(h0), 4),
    }

def norm_rect(r):
    if r is None:
        return None
    rx, ry, rw, rh = r
    return {
        "x": round(rx / float(sw), 4),
        "y": round(ry / float(sh), 4),
        "width": round(rw / float(sw), 4),
        "height": round(rh / float(sh), 4),
    }

print(json.dumps({
    "ok": True,
    "width": int(w0),
    "height": int(h0),
    "channels": 4,
    "faceDetected": face_rect is not None,
    "seedMethod": seed_method or "grabcut",
    "faceBox": norm_rect(face_rect),
    "torsoBox": norm_rect(torso_rect),
    "subjectBox": subject_box,
    "foregroundCoverage": round(float(np.mean(alpha > 128)), 4),
    "transparentCoverage": round(float(np.mean(alpha < 16)), 4),
    "featheredEdgePixels": int(np.sum((alpha >= 15) & (alpha <= 240))),
}))
`;

async function extractVideoFrameIfNeeded(sourcePath, tempDir) {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!VIDEO_EXTS.has(ext)) {
    return { imageToSegment: sourcePath, tempFramePath: null };
  }

  videoFrameTempSeq += 1;
  fs.mkdirSync(tempDir, { recursive: true });
  const stem = sanitizeMatteStem(path.basename(sourcePath, ext));
  const tempPng = path.join(tempDir, `${stem}_matte_src_${process.pid}_${videoFrameTempSeq}.png`);
  const res = await runCommand(
    "ffmpeg",
    ["-y", "-i", sourcePath, "-frames:v", "1", "-update", "1", tempPng],
    { env: getToolEnv(), shell: false },
  );
  if (res.code !== 0 || !fs.existsSync(tempPng)) {
    throw new Error(
      `Failed to extract keyframe from video for subject matte: ${(res.stderr || res.stdout).slice(-400)}`,
    );
  }
  return { imageToSegment: tempPng, tempFramePath: tempPng };
}

export async function extractSubjectForegroundMatte({
  slug,
  imagePath = null,
  imageRelPath = null,
  frameId = null,
  outRelPath = null,
  projectsDir = PROJECTS_DIR,
  featherSigma = MATTE_DEFAULTS.featherSigma,
  grabCutIterations = MATTE_DEFAULTS.grabCutIterations,
  syncManifest = false,
} = {}) {
  const projectDir = resolveValidatedProjectDir(slug, projectsDir);
  const resolvedSource = resolveSubjectSourceImage({
    projectDir,
    slug,
    imagePath: imagePath ?? imageRelPath,
    frameId,
  });

  const normalizedOutRelPath = normalizeOutRelPath(outRelPath, resolvedSource, projectDir);
  const absOutPath = path.resolve(projectDir, normalizedOutRelPath);
  fs.mkdirSync(path.dirname(absOutPath), { recursive: true });

  const tmpFramesDir = path.join(projectDir, ".studio", "frames", "tmp");
  const { imageToSegment, tempFramePath } = await extractVideoFrameIfNeeded(
    resolvedSource,
    tmpFramesDir || os.tmpdir(),
  );

  const clampedSigma = clamp(
    Number(featherSigma) || MATTE_DEFAULTS.featherSigma,
    0.6,
    12.0,
  ).toFixed(2);
  const clampedIters = String(
    Math.round(clamp(Number(grabCutIterations) || MATTE_DEFAULTS.grabCutIterations, 1, 12)),
  );

  try {
    const env = { ...getToolEnv(), PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
    const pyRes = await runCommand(
      resolvePythonBin(),
      ["-c", PYTHON_SUBJECT_MATTE_SCRIPT, imageToSegment, absOutPath, clampedSigma, clampedIters],
      { env, shell: false },
    );

    const stdout = (pyRes.stdout || "").trim();
    if (pyRes.code !== 0 || !stdout || !fs.existsSync(absOutPath)) {
      throw new Error(
        `OpenCV subject matte extraction failed (${pyRes.code}): ${(pyRes.stderr || stdout).slice(-500)}`,
      );
    }

    let parsed;
    try {
      const lines = stdout.split(/\r?\n/).filter(Boolean);
      parsed = JSON.parse(lines[lines.length - 1]);
    } catch {
      throw new Error(`Invalid JSON from subject matte pipeline: ${stdout.slice(-300)}`);
    }

    if (!parsed.ok) {
      throw new Error(`Subject matte pipeline error: ${parsed.error || "unknown"}`);
    }

    if (syncManifest && path.resolve(projectsDir) === path.resolve(PROJECTS_DIR)) {
      await syncProjectManifest(slug);
    }

    const encodedUrl = `/media/${encodeURIComponent(slug)}/${normalizedOutRelPath
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/")}`;

    return {
      ok: true,
      slug,
      sourceImagePath: resolvedSource,
      outRelPath: normalizedOutRelPath,
      subjectMatteSrc: normalizedOutRelPath,
      mattePath: absOutPath,
      outPath: absOutPath,
      url: encodedUrl,
      matteUrl: encodedUrl,
      width: parsed.width,
      height: parsed.height,
      channels: 4,
      hasAlpha: true,
      faceDetected: Boolean(parsed.faceDetected),
      seedMethod: parsed.seedMethod,
      faceBox: parsed.faceBox || null,
      torsoBox: parsed.torsoBox || null,
      subjectBox: parsed.subjectBox || null,
      foregroundCoverage: parsed.foregroundCoverage,
      transparentCoverage: parsed.transparentCoverage,
      featheredEdgePixels: parsed.featheredEdgePixels,
    };
  } finally {
    if (tempFramePath && fs.existsSync(tempFramePath)) {
      fs.rmSync(tempFramePath, { force: true });
    }
  }
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertValidSlug, ensureProjectDirs } from "./lib.mjs";
import { loadStoryboard, saveStoryboard, regenerateFrame } from "./storyboard.mjs";
import { enqueueAgentTask } from "./agent-bridge.mjs";

const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];

const NAMED_ACCENT_HEX = {
  coral: "#E03E3E",
  red: "#E03E3E",
  crimson: "#DC2626",
  amber: "#D97706",
  gold: "#F59E0B",
  yellow: "#FACC15",
  emerald: "#10B981",
  green: "#1E824C",
  blue: "#2563EB",
  cyan: "#0EA5E9",
  sky: "#38BDF8",
  charcoal: "#111111",
  white: "#FFFFFF",
};

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

function round4(num) {
  return Math.round(Number(num || 0) * 10000) / 10000;
}

function assertSafeIdentifier(raw, fieldName = "id") {
  const str = String(raw ?? "").trim();
  if (!str || !SAFE_ID_RE.test(str) || str.includes("..")) {
    throw new Error(`Invalid ${fieldName}: "${raw}"`);
  }
  return str;
}

function makeMediaUrl(slug, relPath) {
  const cleanRel = String(relPath || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
  if (!cleanRel) return "";
  return `/media/${encodeURIComponent(slug)}/${cleanRel.split("/").map(encodeURIComponent).join("/")}`;
}

function hasValidPngSignature(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (buf[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

function decodeImageDataUrl(dataUrl, label = "image") {
  if (dataUrl === null || dataUrl === undefined || dataUrl === "") {
    return null;
  }
  const raw = String(dataUrl).trim();
  if (!raw) return null;

  let base64Part = raw;
  const match = raw.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,([\s\S]+)$/i);
  if (match) {
    base64Part = match[2].replace(/\s+/g, "");
  } else if (raw.startsWith("data:")) {
    throw new Error(`Unsupported ${label} data URL format.`);
  } else {
    base64Part = raw.replace(/\s+/g, "");
  }

  if (!base64Part || !/^[A-Za-z0-9+/=]+$/.test(base64Part)) {
    throw new Error(`Invalid base64 payload for ${label}.`);
  }

  const buf = Buffer.from(base64Part, "base64");
  if (buf.length < 8) {
    throw new Error(`Decoded ${label} buffer is empty or truncated.`);
  }

  if (match && match[1].toLowerCase() === "png" && !hasValidPngSignature(buf)) {
    throw new Error(`Decoded ${label} PNG buffer is missing valid PNG magic header.`);
  }

  return buf;
}

function normalizeStrokePoints(stroke, cw, ch) {
  const rawPoints = [];
  if (Array.isArray(stroke?.points) && stroke.points.length > 0) {
    for (const pt of stroke.points) {
      if (pt && Number.isFinite(Number(pt.x)) && Number.isFinite(Number(pt.y))) {
        rawPoints.push({ x: Number(pt.x), y: Number(pt.y) });
      }
    }
  } else if (
    stroke &&
    Number.isFinite(Number(stroke.x)) &&
    Number.isFinite(Number(stroke.y)) &&
    Number.isFinite(Number(stroke.width ?? stroke.w)) &&
    Number.isFinite(Number(stroke.height ?? stroke.h))
  ) {
    const sx = Number(stroke.x);
    const sy = Number(stroke.y);
    const sw = Number(stroke.width ?? stroke.w);
    const sh = Number(stroke.height ?? stroke.h);
    rawPoints.push({ x: sx, y: sy }, { x: sx + sw, y: sy + sh });
  }

  if (rawPoints.length === 0) return [];

  const isPixelSpace = rawPoints.some((pt) => Math.abs(pt.x) > 1.01 || Math.abs(pt.y) > 1.01);
  return rawPoints.map((pt) => ({
    x: clamp(isPixelSpace ? pt.x / cw : pt.x, 0, 1),
    y: clamp(isPixelSpace ? pt.y / ch : pt.y, 0, 1),
  }));
}

function normalizeRegionBox(regionBox, cw, ch) {
  if (!regionBox || typeof regionBox !== "object") return null;
  const rx = Number(regionBox.x ?? regionBox.left ?? 0);
  const ry = Number(regionBox.y ?? regionBox.top ?? 0);
  const rw = Number(regionBox.width ?? regionBox.w ?? 0);
  const rh = Number(regionBox.height ?? regionBox.h ?? 0);
  if (
    !Number.isFinite(rx) ||
    !Number.isFinite(ry) ||
    !Number.isFinite(rw) ||
    !Number.isFinite(rh)
  ) {
    return null;
  }

  const isPixelSpace =
    Math.abs(rx) > 1.01 || Math.abs(ry) > 1.01 || Math.abs(rw) > 1.01 || Math.abs(rh) > 1.01;

  const x1 = isPixelSpace ? rx / cw : rx;
  const y1 = isPixelSpace ? ry / ch : ry;
  const x2 = isPixelSpace ? (rx + rw) / cw : rx + rw;
  const y2 = isPixelSpace ? (ry + rh) / ch : ry + rh;

  const minX = clamp(Math.min(x1, x2), 0, 1);
  const minY = clamp(Math.min(y1, y2), 0, 1);
  const maxX = clamp(Math.max(x1, x2), 0, 1);
  const maxY = clamp(Math.max(y1, y2), 0, 1);

  const width = round4(maxX - minX);
  const height = round4(maxY - minY);
  const x = round4(minX);
  const y = round4(minY);
  const centerX = round4(clamp(x + width / 2, 0, 1));
  const centerY = round4(clamp(y + height / 2, 0, 1));

  return { x, y, width, height, centerX, centerY };
}

/**
 * 1. Stroke & Mask Geometry Analyzer
 */
export function analyzeAnnotationRegion({
  strokes = [],
  regionBox = null,
  canvasWidth = 1080,
  canvasHeight = 1920,
} = {}) {
  const cw = Math.max(1, Number(canvasWidth) || 1080);
  const ch = Math.max(1, Number(canvasHeight) || 1920);
  const safeStrokes = Array.isArray(strokes) ? strokes : [];

  const normalizedStrokes = [];
  const allPoints = [];
  const pins = [];
  let lastArrowStroke = null;

  for (let i = 0; i < safeStrokes.length; i += 1) {
    const rawStroke = safeStrokes[i];
    if (!rawStroke || typeof rawStroke !== "object") continue;
    const rawTool = String(rawStroke.tool || "brush")
      .trim()
      .toLowerCase();
    const tool = rawTool === "motion-arrow" ? "arrow" : rawTool;
    const pts = normalizeStrokePoints(rawStroke, cw, ch);
    if (pts.length === 0) continue;

    const normalized = {
      tool,
      points: pts,
      color: rawStroke.color ? String(rawStroke.color) : null,
      label: rawStroke.label ? String(rawStroke.label) : "",
      size: Number(rawStroke.size) || null,
    };
    normalizedStrokes.push(normalized);
    allPoints.push(...pts);

    if (tool === "pin") {
      pins.push({
        index: pins.length + 1,
        x: round4(pts[0].x),
        y: round4(pts[0].y),
        label: normalized.label,
        color: normalized.color,
      });
    }
    if (tool === "arrow" && pts.length >= 2) {
      lastArrowStroke = normalized;
    }
  }

  const explicitBounds = normalizeRegionBox(regionBox, cw, ch);
  let bounds;

  if (explicitBounds) {
    bounds = explicitBounds;
  } else if (allPoints.length > 0) {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const pt of allPoints) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
    const x = round4(clamp(minX, 0, 1));
    const y = round4(clamp(minY, 0, 1));
    const width = round4(clamp(maxX - minX, 0, 1 - x));
    const height = round4(clamp(maxY - minY, 0, 1 - y));
    const centerX = round4(clamp(x + width / 2, 0, 1));
    const centerY = round4(clamp(y + height / 2, 0, 1));
    bounds = { x, y, width, height, centerX, centerY };
  } else {
    bounds = { x: 0, y: 0, width: 1, height: 1, centerX: 0.5, centerY: 0.5 };
  }

  let arrowVector = null;
  if (lastArrowStroke) {
    const startPt = lastArrowStroke.points[0];
    const tipPt = lastArrowStroke.points[lastArrowStroke.points.length - 1];
    const dx = round4(tipPt.x - startPt.x);
    const dy = round4(tipPt.y - startPt.y);
    const magnitude = round4(Math.hypot(dx, dy));
    const angleRad = round4(Math.atan2(dy, dx));
    const angleDeg = round2((Math.atan2(dy, dx) * 180) / Math.PI);
    const focusX = round2(clamp(tipPt.x * 100, 0, 100));
    const focusY = round2(clamp(tipPt.y * 100, 0, 100));
    const panX = round2(clamp(dx * 28, -24, 24));
    const panY = round2(clamp(dy * 28, -24, 24));
    const toScale = round2(clamp(1.15 + magnitude * 0.85, 1.15, 2.25));

    arrowVector = {
      startX: round4(startPt.x),
      startY: round4(startPt.y),
      endX: round4(tipPt.x),
      endY: round4(tipPt.y),
      dx,
      dy,
      angleRad,
      angleDeg,
      magnitude,
      focusX,
      focusY,
      panX,
      panY,
      toScale,
    };
  }

  let zone;
  if (arrowVector) {
    zone = "motion-trajectory";
  } else if (bounds.centerY < 0.22) {
    zone = "badge-header";
  } else if (bounds.centerY > 0.76) {
    zone = "caption-lower-third";
  } else if (bounds.centerX < 0.36) {
    zone = "callout-left";
  } else if (bounds.centerX > 0.64) {
    zone = "callout-right";
  } else {
    zone = "center-subject";
  }

  const toolsUsed = [...new Set(normalizedStrokes.map((s) => s.tool))];

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    centerX: bounds.centerX,
    centerY: bounds.centerY,
    zone,
    boundingBox: { ...bounds },
    hasDrawing: normalizedStrokes.length > 0 || Boolean(explicitBounds),
    toolsUsed,
    pins,
    arrowVector,
    ...(arrowVector
      ? {
          dx: arrowVector.dx,
          dy: arrowVector.dy,
          angleRad: arrowVector.angleRad,
          angleDeg: arrowVector.angleDeg,
          magnitude: arrowVector.magnitude,
          focusX: arrowVector.focusX,
          focusY: arrowVector.focusY,
          panX: arrowVector.panX,
          panY: arrowVector.panY,
        }
      : {}),
  };
}

function getAnnotationsJsonPath(projectDir) {
  return path.join(projectDir, ".studio", "annotations.json");
}

function loadAnnotationsStore(slug, projectDir) {
  const filePath = getAnnotationsJsonPath(projectDir);
  if (!fs.existsSync(filePath)) {
    return { schemaVersion: 1, slug, updatedAt: null, annotations: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      schemaVersion: 1,
      slug,
      updatedAt: parsed?.updatedAt || null,
      annotations: Array.isArray(parsed?.annotations) ? parsed.annotations : [],
    };
  } catch {
    return { schemaVersion: 1, slug, updatedAt: null, annotations: [] };
  }
}

function saveAnnotationsStore(slug, projectDir, annotations) {
  const filePath = getAnnotationsJsonPath(projectDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = {
    schemaVersion: 1,
    slug,
    updatedAt: new Date().toISOString(),
    annotations,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

/**
 * 2. Persist Annotation PNGs
 */
export function saveFrameAnnotation({
  slug,
  frameId,
  maskDataUrl = null,
  compositeDataUrl = null,
  strokes = [],
  regionBox = null,
  prompt = "",
  canvasWidth = 1080,
  canvasHeight = 1920,
} = {}) {
  const projectDir = ensureProjectDirs(slug);
  const safeFrameId = assertSafeIdentifier(frameId, "frameId");
  const shortId = `${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
  const annotationId = `ann_${shortId}`;

  const annotationsDir = path.join(projectDir, ".studio", "frames", "annotations");
  fs.mkdirSync(annotationsDir, { recursive: true });

  const maskBuf = decodeImageDataUrl(maskDataUrl, "maskDataUrl");
  const compositeBuf = decodeImageDataUrl(compositeDataUrl, "compositeDataUrl");

  let maskRelPath = null;
  if (maskBuf) {
    const maskFilename = `${safeFrameId}_${annotationId}_mask.png`;
    fs.writeFileSync(path.join(annotationsDir, maskFilename), maskBuf);
    maskRelPath = `.studio/frames/annotations/${maskFilename}`;
  }

  let compositeRelPath = null;
  if (compositeBuf) {
    const compositeFilename = `${safeFrameId}_${annotationId}_annotated.png`;
    fs.writeFileSync(path.join(annotationsDir, compositeFilename), compositeBuf);
    compositeRelPath = `.studio/frames/annotations/${compositeFilename}`;
  }

  const regionAnalysis = analyzeAnnotationRegion({
    strokes,
    regionBox,
    canvasWidth,
    canvasHeight,
  });

  const createdAt = new Date().toISOString();
  const record = {
    annotationId,
    id: annotationId,
    slug,
    frameId: safeFrameId,
    prompt: String(prompt || ""),
    maskRelPath,
    compositeRelPath,
    maskUrl: maskRelPath ? makeMediaUrl(slug, maskRelPath) : null,
    compositeUrl: compositeRelPath ? makeMediaUrl(slug, compositeRelPath) : null,
    strokeCount: Array.isArray(strokes) ? strokes.length : 0,
    strokes: Array.isArray(strokes) ? structuredClone(strokes) : [],
    regionBox: regionBox ? structuredClone(regionBox) : null,
    regionAnalysis,
    createdAt,
  };

  const store = loadAnnotationsStore(slug, projectDir);
  store.annotations.push(record);
  saveAnnotationsStore(slug, projectDir, store.annotations);

  return {
    annotationId,
    maskRelPath,
    compositeRelPath,
    maskUrl: record.maskUrl,
    compositeUrl: record.compositeUrl,
    regionAnalysis,
  };
}

export function listFrameAnnotations(slug, frameId = null) {
  const projectDir = assertValidSlug(slug);
  const store = loadAnnotationsStore(slug, projectDir);
  if (!frameId) return store.annotations;
  return store.annotations.filter((a) => a.frameId === frameId);
}

function parseRegionalPromptCues(prompt = "", strokes = []) {
  const raw = String(prompt || "").trim();
  const safeStrokes = Array.isArray(strokes) ? strokes : [];

  const pinLabels = safeStrokes
    .filter((s) => String(s?.tool || "").toLowerCase() === "pin" && s?.label)
    .map((s) => String(s.label).trim())
    .filter(Boolean);

  const strokeColor =
    safeStrokes
      .map((s) => s?.color)
      .find((c) => typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c.trim())) || null;

  let accentColor = null;
  const hexMatch = raw.match(/#[0-9a-fA-F]{6}\b/);
  if (hexMatch) {
    accentColor = hexMatch[0].toUpperCase();
  } else {
    for (const [name, hex] of Object.entries(NAMED_ACCENT_HEX)) {
      if (new RegExp(`\\b${name}\\b`, "i").test(raw)) {
        accentColor = hex;
        break;
      }
    }
  }
  if (!accentColor && strokeColor) {
    accentColor = strokeColor;
  }

  let explicitBadge = null;
  const badgeMatch = raw.match(/badge(?:\s+text)?\s*[:=]?\s*["“'‘]([^"”'’]+)["”'’]/i);
  if (badgeMatch) explicitBadge = badgeMatch[1].trim();

  let explicitHeadline = null;
  const headlineMatch = raw.match(
    /(?:headline|title)(?:\s+text)?\s*[:=]?\s*["“'‘]([^"”'’]+)["”'’]/i,
  );
  if (headlineMatch) explicitHeadline = headlineMatch[1].trim();

  let explicitSubline = null;
  const sublineMatch = raw.match(
    /(?:subheadline|subtitle|subline)\s*[:=]?\s*["“'‘]([^"”'’]+)["”'’]/i,
  );
  if (sublineMatch) explicitSubline = sublineMatch[1].trim();

  let explicitCaption = null;
  const captionMatch = raw.match(/caption(?:\s+text)?\s*[:=]?\s*["“'‘]([^"”'’]+)["”'’]/i);
  if (captionMatch) explicitCaption = captionMatch[1].trim();

  let explicitLabel = null;
  const labelMatch = raw.match(/label\s*[:=]?\s*["“'‘]([^"”'’]+)["”'’]/i);
  if (labelMatch) explicitLabel = labelMatch[1].trim();

  const quotes = [...raw.matchAll(/["“]([^"”]+)["”]|'([^']+)'/g)]
    .map((m) => (m[1] || m[2] || "").trim())
    .filter(Boolean);

  // Extract explicit zoom cue for center-subject / motion-trajectory
  let zoomScale = null;
  const unquoted = raw.replace(/["“][^"”]+["”]|'[^']+'/g, " ");
  const zoomPct = unquoted.match(/(?:zoom(?:\s+in|\s+to)?\s*)?(\d{2,3})\s*%/i);
  if (zoomPct) {
    zoomScale = round2(clamp(Number(zoomPct[1]) / 100, 0.5, 3.5));
  } else {
    const zoomMult =
      unquoted.match(
        /\b(?:zoom(?:\s+in|\s+to)?|scale|magnif\w*)\s*(?:to\s*|by\s*)?(\d+(?:\.\d+)?)\s*x\b/i,
      ) || unquoted.match(/\b(\d+(?:\.\d+)?)\s*x\s*(?:zoom|scale|closer|punch|magnif\w*)\b/i);
    if (zoomMult) {
      zoomScale = round2(clamp(Number(zoomMult[1]), 0.5, 3.5));
    } else if (/\bdolly[-\s]?out\b|\bzoom[-\s]?out\b|\bpull[-\s]?back\b/i.test(unquoted)) {
      zoomScale = 1.0;
    }
  }

  let cleanedText = "";
  if (quotes.length === 1 && !explicitHeadline && !explicitSubline && !explicitCaption) {
    cleanedText = quotes[0];
  } else {
    cleanedText = raw
      .replace(/#[0-9a-fA-F]{6}\b/g, "")
      .replace(
        /^(?:please\s+)?(?:replace|change|update|set|make|edit|put|add|write)\s+(?:the\s+)?(?:top\s+|bottom\s+|left\s+|right\s+)?(?:badge(?:\s+text)?|header(?:\s+pill)?|pill|caption(?:\s+text)?|lower[-\s]?third|subline|subheadline|subtitle|headline|title|callout(?:\s+card)?|card|text|label)\s*(?:to|with|as|:|=)?\s*/i,
        "",
      )
      .replace(/^["“'‘]+|["”'’]+$/g, "")
      .trim();
  }

  if (!cleanedText && pinLabels.length > 0) {
    cleanedText = pinLabels[0];
  }

  return {
    raw,
    cleanedText,
    quotes,
    pinLabels,
    accentColor,
    explicitBadge,
    explicitHeadline,
    explicitSubline,
    explicitCaption,
    explicitLabel,
    zoomScale,
  };
}

/**
 * 3. Targeted Regional Regeneration
 */
export async function regenerateFrameRegion({
  slug,
  frameId,
  maskDataUrl = null,
  compositeDataUrl = null,
  strokes = [],
  regionBox = null,
  prompt = "",
  selectedSkills = [],
  enqueueAiInpaint = false,
} = {}) {
  ensureProjectDirs(slug);
  const safeFrameId = assertSafeIdentifier(frameId, "frameId");
  const storyboard = loadStoryboard(slug);
  if (!storyboard) {
    throw new Error(`Storyboard not found for project "${slug}". Run generateStoryboard first.`);
  }

  const existingFrame = storyboard.frames.find((f) => f.id === safeFrameId);
  if (!existingFrame) {
    throw new Error(`Frame "${safeFrameId}" not found in storyboard "${slug}".`);
  }

  const annotation = saveFrameAnnotation({
    slug,
    frameId: safeFrameId,
    maskDataUrl,
    compositeDataUrl,
    strokes,
    regionBox,
    prompt,
    canvasWidth: Number(storyboard.width) || 1080,
    canvasHeight: Number(storyboard.height) || 1920,
  });

  const { regionAnalysis } = annotation;
  const zone = regionAnalysis.zone;
  const parsed = parseRegionalPromptCues(prompt, strokes);
  const now = new Date().toISOString();

  // Clone untouched state so regional regeneration is strictly surgical
  const lockedLayout = existingFrame.layout;
  const lockedMotionPreset = existingFrame.motionPreset;
  const lockedTitle = existingFrame.title;
  const nextCameraMotion = structuredClone(existingFrame.cameraMotion || {});
  const nextStaging = structuredClone(existingFrame.staging || {});
  const nextAudioSpec = structuredClone(existingFrame.audioSpec || {});
  const existingCursor = structuredClone(
    existingFrame.staging?.cursorTarget || {
      x: nextCameraMotion.focusX ?? 50,
      y: nextCameraMotion.focusY ?? 50,
      showRipple: true,
    },
  );

  if (zone === "badge-header") {
    const nextBadge =
      parsed.explicitBadge || parsed.cleanedText || nextStaging.badgeText || "FEATURED";
    nextStaging.badgeText = nextBadge;
    nextStaging.headerPill = {
      text: nextBadge,
      accentColor: parsed.accentColor || nextStaging.headerPill?.accentColor || "#F59E0B",
      updatedAt: now,
    };
    if (parsed.accentColor) {
      nextStaging.topAccent = parsed.accentColor;
    }
    nextStaging.cursorTarget = existingCursor;
  } else if (zone === "caption-lower-third") {
    const hasExplicitParts = Boolean(
      parsed.explicitHeadline || parsed.explicitSubline || parsed.explicitCaption,
    );

    if (hasExplicitParts) {
      if (parsed.explicitHeadline) {
        nextStaging.headline = parsed.explicitHeadline;
      }
      if (parsed.explicitSubline) {
        nextStaging.subheadline = parsed.explicitSubline;
        nextStaging.subline = parsed.explicitSubline;
      }
      if (parsed.explicitCaption) {
        nextStaging.captionText = parsed.explicitCaption;
      } else if (parsed.explicitSubline) {
        nextStaging.captionText = parsed.explicitSubline;
      } else if (parsed.explicitHeadline) {
        nextStaging.captionText = parsed.explicitHeadline;
      }
    } else if (parsed.quotes.length >= 2) {
      nextStaging.headline = parsed.quotes[0];
      nextStaging.subheadline = parsed.quotes[1];
      nextStaging.subline = parsed.quotes[1];
      nextStaging.captionText = parsed.quotes[1];
    } else if (parsed.cleanedText) {
      const splitDash = parsed.cleanedText.split(/\s+(?:—|--|\|)\s+/);
      if (splitDash.length >= 2) {
        nextStaging.headline = splitDash[0].trim();
        const rest = splitDash.slice(1).join(" — ").trim();
        nextStaging.subheadline = rest;
        nextStaging.subline = rest;
        nextStaging.captionText = rest;
      } else {
        nextStaging.headline = parsed.cleanedText;
        nextStaging.subheadline = parsed.cleanedText;
        nextStaging.subline = parsed.cleanedText;
        nextStaging.captionText = parsed.cleanedText;
      }
    }
    nextStaging.cursorTarget = existingCursor;
  } else if (zone === "callout-left" || zone === "callout-right") {
    const side = zone === "callout-left" ? "left" : "right";
    const calloutText =
      parsed.cleanedText ||
      parsed.explicitHeadline ||
      parsed.explicitCaption ||
      (side === "left" ? "Verified Highlight" : "Instant Benefit");
    const calloutLabel =
      parsed.explicitLabel || (side === "left" ? "LEFT CALLOUT" : "RIGHT CALLOUT");
    const accentColor = parsed.accentColor || "#2563EB";
    const targetPctX = round2(clamp(regionAnalysis.centerX * 100, 0, 100));
    const targetPctY = round2(clamp(regionAnalysis.centerY * 100, 0, 100));

    const card = {
      side,
      label: calloutLabel,
      text: calloutText,
      value: calloutText,
      accentColor,
      anchorX: regionAnalysis.centerX,
      anchorY: regionAnalysis.centerY,
      updatedAt: now,
    };

    nextStaging.calloutCard = card;
    nextStaging.calloutCards = {
      ...(nextStaging.calloutCards && typeof nextStaging.calloutCards === "object"
        ? nextStaging.calloutCards
        : {}),
      [side]: card,
    };

    const items = Array.isArray(nextStaging.calloutItems)
      ? structuredClone(nextStaging.calloutItems)
      : [
          { label: "HIGHLIGHT", value: nextStaging.badgeText || "Featured" },
          { label: "DETAIL", value: nextStaging.ctaText || "Explore" },
        ];
    while (items.length < 2) {
      items.push({ label: "DETAIL", value: calloutText });
    }
    const targetIdx = side === "left" ? 0 : 1;
    items[targetIdx] = {
      label: calloutLabel,
      value: calloutText,
      side,
    };
    nextStaging.calloutItems = items;

    nextStaging.cursorTarget = {
      ...existingCursor,
      x: targetPctX,
      y: targetPctY,
      showRipple: true,
    };
    nextStaging.spotlightTarget = {
      x: regionAnalysis.centerX,
      y: regionAnalysis.centerY,
      percentX: targetPctX,
      percentY: targetPctY,
    };
  } else if (zone === "motion-trajectory") {
    const vec = regionAnalysis.arrowVector;
    if (vec) {
      nextCameraMotion.focusX = vec.focusX;
      nextCameraMotion.focusY = vec.focusY;
      nextCameraMotion.panX = vec.panX;
      nextCameraMotion.panY = vec.panY;
      nextCameraMotion.toScale = parsed.zoomScale ?? vec.toScale;
      nextCameraMotion.trajectoryVector = {
        dx: vec.dx,
        dy: vec.dy,
        angleDeg: vec.angleDeg,
        magnitude: vec.magnitude,
        startNormalized: { x: vec.startX, y: vec.startY },
        tipNormalized: { x: vec.endX, y: vec.endY },
      };
      nextStaging.cursorTarget = {
        ...existingCursor,
        x: vec.focusX,
        y: vec.focusY,
        showRipple: true,
      };
    }
  } else {
    // "center-subject"
    const focusX = round2(clamp(regionAnalysis.centerX * 100, 0, 100));
    const focusY = round2(clamp(regionAnalysis.centerY * 100, 0, 100));
    const targetScale =
      parsed.zoomScale ??
      round2(clamp(Math.max(Number(nextCameraMotion.toScale) || 1.25, 1.35), 0.5, 3.5));

    nextCameraMotion.focusX = focusX;
    nextCameraMotion.focusY = focusY;
    nextCameraMotion.toScale = targetScale;

    const highlightLabel = parsed.cleanedText || "Subject Spotlight";
    const accentColor = parsed.accentColor || "#FACC15";

    nextStaging.cursorTarget = {
      ...existingCursor,
      x: focusX,
      y: focusY,
      showRipple: true,
    };
    nextStaging.spotlightTarget = {
      x: regionAnalysis.centerX,
      y: regionAnalysis.centerY,
      percentX: focusX,
      percentY: focusY,
    };
    nextStaging.regionHighlight = {
      zone: "center-subject",
      x: regionAnalysis.x,
      y: regionAnalysis.y,
      width: regionAnalysis.width,
      height: regionAnalysis.height,
      centerX: regionAnalysis.centerX,
      centerY: regionAnalysis.centerY,
      label: highlightLabel,
      accentColor,
    };
    nextStaging.subjectOverlay = {
      ...nextStaging.regionHighlight,
      zoomScale: targetScale,
      updatedAt: now,
    };
    nextStaging.deviceMockup = {
      ...(nextStaging.deviceMockup && typeof nextStaging.deviceMockup === "object"
        ? nextStaging.deviceMockup
        : {}),
      focusX: regionAnalysis.centerX,
      focusY: regionAnalysis.centerY,
      zoomScale: targetScale,
      highlightLabel,
      accentColor,
      updatedAt: now,
    };
  }

  const activeSkillList = Array.isArray(selectedSkills)
    ? selectedSkills.map(String).filter(Boolean)
    : [];
  const prevEdits = Array.isArray(nextStaging.regionalEdits) ? nextStaging.regionalEdits : [];
  nextStaging.regionalEdits = [
    ...prevEdits,
    {
      annotationId: annotation.annotationId,
      zone,
      bounds: regionAnalysis.boundingBox,
      prompt: String(prompt || ""),
      maskRelPath: annotation.maskRelPath,
      compositeRelPath: annotation.compositeRelPath,
      selectedSkills: activeSkillList,
      createdAt: now,
    },
  ];

  const effectivePrompt = String(prompt || "").trim() || `[${zone}] regional update`;

  const regenResult = await regenerateFrame({
    slug,
    frameId: safeFrameId,
    prompt: effectivePrompt,
    motionPreset: lockedMotionPreset,
    layout: lockedLayout,
    overrides: {
      title: lockedTitle,
      layout: lockedLayout,
      motionPreset: lockedMotionPreset,
      speedFactor: existingFrame.speedFactor,
      durationSeconds: existingFrame.durationSeconds,
      rawTimeRange: Array.isArray(existingFrame.rawTimeRange)
        ? [...existingFrame.rawTimeRange]
        : [0, existingFrame.durationSeconds || 4],
      sourceClip: existingFrame.sourceClip,
      keyframes: existingFrame.keyframes ? structuredClone(existingFrame.keyframes) : undefined,
      aiBackgroundPlate: existingFrame.aiBackgroundPlate ?? null,
      aiVideoClip: existingFrame.aiVideoClip ?? null,
      cameraMotion: nextCameraMotion,
      staging: nextStaging,
      audioSpec: nextAudioSpec,
    },
  });

  let ticket = null;
  if (enqueueAiInpaint === true) {
    ticket = enqueueAgentTask({
      slug,
      type: "ai_regenerate_frame",
      payload: {
        frameId: safeFrameId,
        annotationId: annotation.annotationId,
        maskRelPath: annotation.maskRelPath,
        compositeRelPath: annotation.compositeRelPath,
        regionAnalysis,
        zone,
        prompt: String(prompt || ""),
        selectedSkills: activeSkillList,
        targetVersion: regenResult.frame.currentVersion,
        designFramePath: regenResult.frame.designFramePath,
      },
    });
  }

  return {
    frame: regenResult.frame,
    storyboard: regenResult.storyboard,
    annotation,
    annotationId: annotation.annotationId,
    maskRelPath: annotation.maskRelPath,
    compositeRelPath: annotation.compositeRelPath,
    regionAnalysis,
    ticket,
  };
}

function getSavedFramesJsonPath(projectDir) {
  return path.join(projectDir, ".studio", "saved-frames.json");
}

function loadSavedFramesStore(slug, projectDir) {
  const filePath = getSavedFramesJsonPath(projectDir);
  if (!fs.existsSync(filePath)) {
    return { schemaVersion: 1, slug, updatedAt: null, savedFrames: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      schemaVersion: 1,
      slug,
      updatedAt: parsed?.updatedAt || null,
      savedFrames: Array.isArray(parsed?.savedFrames) ? parsed.savedFrames : [],
    };
  } catch {
    return { schemaVersion: 1, slug, updatedAt: null, savedFrames: [] };
  }
}

function writeSavedFramesStore(slug, projectDir, savedFrames) {
  const filePath = getSavedFramesJsonPath(projectDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = {
    schemaVersion: 1,
    slug,
    updatedAt: new Date().toISOString(),
    savedFrames,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

function decorateSavedFrameEntry(slug, entry) {
  const savedId = entry.id || entry.savedId;
  const imageRelPath =
    entry.imageRelPath || entry.savedFramePath || `.studio/frames/saved/${savedId}.png`;
  const imageUrl = makeMediaUrl(slug, imageRelPath);
  const hudUrl = entry.hudRelPath ? makeMediaUrl(slug, entry.hudRelPath) : imageUrl;
  return {
    ...entry,
    id: savedId,
    savedId,
    slug,
    imageRelPath,
    savedFramePath: imageRelPath,
    pngRelPath: imageRelPath,
    imageUrl,
    savedFrameUrl: imageUrl,
    url: imageUrl,
    hudUrl,
  };
}

/**
 * 4a. List Saved Design Frames Vault
 */
export function listSavedFrames(slugOrOptions) {
  const slug =
    typeof slugOrOptions === "object" && slugOrOptions !== null
      ? slugOrOptions.slug
      : slugOrOptions;
  const projectDir = assertValidSlug(slug);
  const store = loadSavedFramesStore(slug, projectDir);
  const items = store.savedFrames.map((item) => decorateSavedFrameEntry(slug, item));
  Object.defineProperty(items, "savedFrames", {
    value: items,
    enumerable: false,
    configurable: true,
  });
  return items;
}

/**
 * 4b. Bookmark a Design Frame into the Saved Frames Vault
 */
export function saveDesignFrameBookmark(slugOrOptions, maybeOptions = {}) {
  const opts =
    typeof slugOrOptions === "string"
      ? { ...(maybeOptions || {}), slug: slugOrOptions }
      : { ...(slugOrOptions || {}) };

  const { slug, frameId, version = null, label = "", notes = "" } = opts;
  const projectDir = ensureProjectDirs(slug);
  const safeFrameId = assertSafeIdentifier(frameId, "frameId");

  const storyboard = loadStoryboard(slug);
  if (!storyboard) {
    throw new Error(`Storyboard not found for project "${slug}".`);
  }

  const frame = storyboard.frames.find((f) => f.id === safeFrameId);
  if (!frame) {
    throw new Error(`Frame "${safeFrameId}" not found in storyboard "${slug}".`);
  }

  let targetVersion = Number(frame.currentVersion || 1);
  let sourceSnap = null;
  if (version !== null && version !== undefined && version !== "") {
    const requestedVer = Number(version);
    if (!Number.isFinite(requestedVer) || requestedVer < 1) {
      throw new Error(`Invalid frame version: ${version}`);
    }
    const fromHistory = (frame.history || []).find((h) => Number(h.version) === requestedVer);
    if (fromHistory) {
      sourceSnap = fromHistory;
      targetVersion = requestedVer;
    } else if (Number(frame.currentVersion) === requestedVer) {
      targetVersion = requestedVer;
    } else {
      throw new Error(`Version ${requestedVer} not found in frame "${safeFrameId}" history.`);
    }
  }

  const sourceDesignRel = sourceSnap?.designFramePath || frame.designFramePath;
  if (!sourceDesignRel) {
    throw new Error(`Frame "${safeFrameId}" has no rendered designFramePath to bookmark.`);
  }
  const sourceDesignAbs = path.resolve(projectDir, sourceDesignRel);
  if (!sourceDesignAbs.startsWith(projectDir + path.sep) || !fs.existsSync(sourceDesignAbs)) {
    throw new Error(`Design frame PNG missing on disk: ${sourceDesignRel}`);
  }

  const savedDir = path.join(projectDir, ".studio", "frames", "saved");
  fs.mkdirSync(savedDir, { recursive: true });

  const savedId = `sf_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
  const destRelPath = `.studio/frames/saved/${savedId}.png`;
  const destAbsPath = path.join(savedDir, `${savedId}.png`);
  fs.copyFileSync(sourceDesignAbs, destAbsPath);

  let hudRelPath = null;
  const sourceHudRel = sourceSnap?.hudFramePath || frame.hudFramePath;
  if (sourceHudRel) {
    const sourceHudAbs = path.resolve(projectDir, sourceHudRel);
    if (sourceHudAbs.startsWith(projectDir + path.sep) && fs.existsSync(sourceHudAbs)) {
      const destHudAbs = path.join(savedDir, `${savedId}_hud.png`);
      fs.copyFileSync(sourceHudAbs, destHudAbs);
      hudRelPath = `.studio/frames/saved/${savedId}_hud.png`;
    }
  }

  const createdAt = new Date().toISOString();
  const resolvedTitle = String(sourceSnap?.title || frame.title || safeFrameId);
  const resolvedLabel =
    String(label || "").trim() || `${resolvedTitle} (v${Number(targetVersion)})`;

  const rawRecord = {
    id: savedId,
    savedId,
    slug,
    frameId: safeFrameId,
    sceneId: frame.sceneId || `scene_${String(frame.index || 1).padStart(2, "0")}`,
    index: Number(frame.index || 1),
    version: Number(targetVersion),
    label: resolvedLabel,
    title: resolvedTitle,
    notes: String(notes || "").trim(),
    prompt: String(sourceSnap?.prompt ?? frame.prompt ?? ""),
    layout: sourceSnap?.layout || frame.layout,
    motionPreset: sourceSnap?.motionPreset || frame.motionPreset,
    imageRelPath: destRelPath,
    hudRelPath,
    snapshot: {
      version: Number(targetVersion),
      title: resolvedTitle,
      narrativeBeat: frame.narrativeBeat || "scene",
      prompt: String(sourceSnap?.prompt ?? frame.prompt ?? ""),
      layout: sourceSnap?.layout || frame.layout,
      motionPreset: sourceSnap?.motionPreset || frame.motionPreset,
      cameraMotion: structuredClone(sourceSnap?.cameraMotion || frame.cameraMotion || {}),
      durationSeconds: Number(sourceSnap?.durationSeconds ?? frame.durationSeconds ?? 4),
      speedFactor: Number(sourceSnap?.speedFactor ?? frame.speedFactor ?? 1),
      sourceClip: frame.sourceClip || null,
      rawTimeRange: structuredClone(sourceSnap?.rawTimeRange || frame.rawTimeRange || [0, 4]),
      keyframes: structuredClone(frame.keyframes || { start: null, peak: null, end: null }),
      staging: structuredClone(sourceSnap?.staging || frame.staging || {}),
      audioSpec: structuredClone(sourceSnap?.audioSpec || frame.audioSpec || {}),
      aiBackgroundPlate: sourceSnap?.aiBackgroundPlate ?? frame.aiBackgroundPlate ?? null,
    },
    createdAt,
    savedAt: createdAt,
  };

  const store = loadSavedFramesStore(slug, projectDir);
  store.savedFrames.push(rawRecord);
  writeSavedFramesStore(slug, projectDir, store.savedFrames);

  const decorated = decorateSavedFrameEntry(slug, rawRecord);
  const allSavedFrames = store.savedFrames.map((item) => decorateSavedFrameEntry(slug, item));

  Object.defineProperties(decorated, {
    savedFrame: {
      value: { ...decorated },
      enumerable: false,
      configurable: true,
    },
    savedFrames: {
      value: allSavedFrames,
      enumerable: false,
      configurable: true,
    },
  });

  return decorated;
}

/**
 * 4c. Delete a Saved Frame from the Vault
 */
export function deleteSavedFrame(slugOrOptions, maybeSavedId) {
  const slug =
    typeof slugOrOptions === "object" && slugOrOptions !== null
      ? slugOrOptions.slug
      : slugOrOptions;
  const rawSavedId =
    typeof slugOrOptions === "object" && slugOrOptions !== null
      ? slugOrOptions.savedId || slugOrOptions.id
      : maybeSavedId;

  const projectDir = assertValidSlug(slug);
  const safeSavedId = assertSafeIdentifier(rawSavedId, "savedId");

  const store = loadSavedFramesStore(slug, projectDir);
  const target = store.savedFrames.find(
    (item) => item.id === safeSavedId || item.savedId === safeSavedId,
  );
  const nextList = store.savedFrames.filter(
    (item) => item.id !== safeSavedId && item.savedId !== safeSavedId,
  );

  for (const relCandidate of [
    target?.imageRelPath,
    target?.hudRelPath,
    `.studio/frames/saved/${safeSavedId}.png`,
    `.studio/frames/saved/${safeSavedId}_hud.png`,
  ]) {
    if (!relCandidate) continue;
    const absCandidate = path.resolve(projectDir, relCandidate);
    if (absCandidate.startsWith(projectDir + path.sep) && fs.existsSync(absCandidate)) {
      fs.unlinkSync(absCandidate);
    }
  }

  writeSavedFramesStore(slug, projectDir, nextList);
  const decoratedList = nextList.map((item) => decorateSavedFrameEntry(slug, item));

  Object.defineProperties(decoratedList, {
    ok: { value: true, enumerable: false, configurable: true },
    deleted: { value: Boolean(target), enumerable: false, configurable: true },
    removed: {
      value: target ? decorateSavedFrameEntry(slug, target) : null,
      enumerable: false,
      configurable: true,
    },
    savedFrames: { value: decoratedList, enumerable: false, configurable: true },
  });

  return decoratedList;
}

/**
 * 4d. Restore a Saved Frame back into the active Storyboard (even if its scene was deleted or rebuilt)
 */
export async function restoreSavedFrame({ slug, savedId, targetFrameId = null } = {}) {
  const projectDir = ensureProjectDirs(slug);
  const safeSavedId = assertSafeIdentifier(savedId, "savedId");
  const vault = listSavedFrames(slug);
  const savedEntry = vault.find((item) => item.id === safeSavedId || item.savedId === safeSavedId);
  if (!savedEntry) {
    throw new Error(`Saved frame "${safeSavedId}" not found in project "${slug}".`);
  }

  const vaultedPngAbs = path.resolve(projectDir, savedEntry.imageRelPath);
  if (!vaultedPngAbs.startsWith(projectDir + path.sep) || !fs.existsSync(vaultedPngAbs)) {
    throw new Error(`Vaulted PNG missing on disk for "${safeSavedId}".`);
  }

  const storyboard = loadStoryboard(slug) || {
    schemaVersion: 1,
    slug,
    title: slug,
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    globalPrompt: "",
    frames: [],
  };

  const destFrameId = targetFrameId
    ? assertSafeIdentifier(targetFrameId, "targetFrameId")
    : savedEntry.frameId;

  const designDir = path.join(projectDir, ".studio", "frames", "design");
  fs.mkdirSync(designDir, { recursive: true });

  const existingIdx = storyboard.frames.findIndex((f) => f.id === destFrameId);
  const snap = savedEntry.snapshot || {};
  const nextVersion =
    existingIdx >= 0 ? Number(storyboard.frames[existingIdx].currentVersion || 1) + 1 : 1;

  const designRel = `.studio/frames/design/${destFrameId}_v${nextVersion}.png`;
  const hudRel = `.studio/frames/design/${destFrameId}_v${nextVersion}_hud.png`;
  fs.copyFileSync(vaultedPngAbs, path.join(projectDir, designRel));

  const vaultedHudAbs = savedEntry.hudRelPath
    ? path.resolve(projectDir, savedEntry.hudRelPath)
    : null;
  if (
    vaultedHudAbs &&
    vaultedHudAbs.startsWith(projectDir + path.sep) &&
    fs.existsSync(vaultedHudAbs)
  ) {
    fs.copyFileSync(vaultedHudAbs, path.join(projectDir, hudRel));
  } else {
    fs.copyFileSync(vaultedPngAbs, path.join(projectDir, hudRel));
  }

  const designUrl = makeMediaUrl(slug, designRel);
  const hudUrl = makeMediaUrl(slug, hudRel);
  const now = new Date().toISOString();

  const restoredSnapshotEntry = {
    version: nextVersion,
    createdAt: now,
    prompt: snap.prompt || savedEntry.prompt || "",
    title: snap.title || savedEntry.title || destFrameId,
    layout: snap.layout || savedEntry.layout || "device-3d-showcase",
    motionPreset: snap.motionPreset || savedEntry.motionPreset || "crash-zoom-in",
    cameraMotion: structuredClone(snap.cameraMotion || {}),
    durationSeconds: Number(snap.durationSeconds ?? 4),
    speedFactor: Number(snap.speedFactor ?? 1),
    rawTimeRange: structuredClone(snap.rawTimeRange || [0, 4]),
    staging: structuredClone(snap.staging || {}),
    audioSpec: structuredClone(snap.audioSpec || {}),
    aiBackgroundPlate: snap.aiBackgroundPlate ?? null,
    designFramePath: designRel,
    hudFramePath: hudRel,
    designFrameUrl: designUrl,
    hudFrameUrl: hudUrl,
  };

  let restoredFrame;
  if (existingIdx >= 0) {
    const prev = storyboard.frames[existingIdx];
    restoredFrame = {
      ...prev,
      title: restoredSnapshotEntry.title,
      layout: restoredSnapshotEntry.layout,
      motionPreset: restoredSnapshotEntry.motionPreset,
      cameraMotion: structuredClone(restoredSnapshotEntry.cameraMotion),
      durationSeconds: restoredSnapshotEntry.durationSeconds,
      speedFactor: restoredSnapshotEntry.speedFactor,
      rawTimeRange: structuredClone(restoredSnapshotEntry.rawTimeRange),
      staging: structuredClone(restoredSnapshotEntry.staging),
      audioSpec: structuredClone(restoredSnapshotEntry.audioSpec),
      aiBackgroundPlate: restoredSnapshotEntry.aiBackgroundPlate,
      prompt: restoredSnapshotEntry.prompt,
      currentVersion: nextVersion,
      designFramePath: designRel,
      hudFramePath: hudRel,
      designFrameUrl: designUrl,
      hudFrameUrl: hudUrl,
      history: [...(Array.isArray(prev.history) ? prev.history : []), restoredSnapshotEntry],
    };
    storyboard.frames[existingIdx] = restoredFrame;
  } else {
    const inferredIndex = Number(savedEntry.index) || storyboard.frames.length + 1;
    restoredFrame = {
      id: destFrameId,
      index: inferredIndex,
      sceneId: savedEntry.sceneId || `scene_${String(inferredIndex).padStart(2, "0")}`,
      title: restoredSnapshotEntry.title,
      narrativeBeat: snap.narrativeBeat || "scene",
      layout: restoredSnapshotEntry.layout,
      motionPreset: restoredSnapshotEntry.motionPreset,
      cameraMotion: structuredClone(restoredSnapshotEntry.cameraMotion),
      durationSeconds: restoredSnapshotEntry.durationSeconds,
      speedFactor: restoredSnapshotEntry.speedFactor,
      sourceClip: snap.sourceClip || null,
      rawTimeRange: structuredClone(restoredSnapshotEntry.rawTimeRange),
      keyframes: structuredClone(snap.keyframes || { start: null, peak: null, end: null }),
      aiBackgroundPlate: restoredSnapshotEntry.aiBackgroundPlate,
      aiVideoClip: null,
      staging: structuredClone(restoredSnapshotEntry.staging),
      audioSpec: structuredClone(restoredSnapshotEntry.audioSpec),
      locked: false,
      approved: false,
      prompt: restoredSnapshotEntry.prompt,
      currentVersion: nextVersion,
      designFramePath: designRel,
      hudFramePath: hudRel,
      designFrameUrl: designUrl,
      hudFrameUrl: hudUrl,
      history: [restoredSnapshotEntry],
    };
    storyboard.frames.push(restoredFrame);
    storyboard.frames.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  }

  const savedSb = saveStoryboard(slug, storyboard);
  const finalFrame = savedSb.frames.find((f) => f.id === destFrameId);
  return { frame: finalFrame, storyboard: savedSb, savedFrame: savedEntry };
}

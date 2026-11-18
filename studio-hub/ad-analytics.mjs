import fs from "node:fs";
import path from "node:path";
import { PROJECTS_DIR } from "./lib.mjs";
import { LAYOUT_ARCHETYPES, MOTION_PRESETS } from "./storyboard.mjs";

const VALID_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const BENGALI_RE = /[\u0980-\u09FF]/;
const HINDI_RE = /[\u0900-\u097F]/;

const HIGH_ENERGY_HOOK_PRESETS = new Set([
  "crash-zoom-in",
  "whip-pan-split",
  "whip-pan-left",
  "whip-pan-right",
  "spotlight-cursor-follow",
  "spotlight-cursor-200",
  "isometric-3d-tilt",
  "isometric-3d-tilt-left",
  "isometric-3d-tilt-right",
  "editorial-kinetic-card",
  "dolly-out-reveal",
  "snap-punch-135",
]);

const MODERATE_HOOK_PRESETS = new Set([
  "bento-triptych",
  "bento-stagger-pop",
  "parallax-float",
  "dolly-in-slow",
  "crane-up-reveal",
  "crane-down-land",
]);

const TRANSIENT_HOOK_SFX = new Set([
  "whoosh",
  "cinema-whoosh",
  "whip-swish",
  "pop",
  "ui-pop",
  "sub-bass-drop",
  "riser-build",
  "glass-ping",
  "chime",
  "confetti-chime",
]);

const GENERIC_PLACEHOLDER_RE = /^(?:scene|shot|frame|untitled|slide|clip)\s*0*\d*$/i;

const CTA_CUE_RE =
  /\b(?:shop|order|get|try|start|download|claim|book|buy|explore|join|save|install|unlock|free|off|now|today)\b|অর্ডার|কিনুন|শুরু|ডাউনলোড|দেখুন|নিন|ফ্রি|ছাড়|ছাড়|अभी|खरीदें|शुरू|डाउनलोड|पाएं|मुफ्त/iu;

const OFFER_VALUE_RE =
  /\b(?:\d+\s*(?:%|x|min|mins|minutes|sec|seconds|hr|hrs|days)|free|save|instant|fast|zero|guaranteed|verified)\b|মিনিট|ফ্রি|ছাড়|দ্রুত|নিখুঁত|তাজা|मिनट|मुफ्त|तेज़/iu;

export const PLATFORM_SAFE_ZONE_SPECS = Object.freeze([
  Object.freeze({
    id: "tiktok",
    camelKey: "tiktok",
    platform: "TikTok",
    requiredAspect: "9:16",
    rightRailMinX: 84,
    bottomOverlayMinY: 78,
    topHeaderMaxY: 10,
    overlaySummary:
      "Right engagement icon stack (x > 84%) and bottom caption + Shop CTA bar (y > 78%)",
  }),
  Object.freeze({
    id: "instagram-reels",
    camelKey: "instagramReels",
    platform: "Instagram Reels",
    requiredAspect: "9:16",
    rightRailMinX: 86,
    bottomOverlayMinY: 80,
    topHeaderMaxY: 9,
    overlaySummary:
      "Right Reels reaction rail (x > 86%) and bottom handle + Sponsored CTA banner (y > 80%)",
  }),
  Object.freeze({
    id: "youtube-shorts",
    camelKey: "youtubeShorts",
    platform: "YouTube Shorts",
    requiredAspect: "9:16",
    rightRailMinX: 85,
    bottomOverlayMinY: 81,
    topHeaderMaxY: 8,
    overlaySummary:
      "Right Shorts action bar (x > 85%) and bottom channel subscribe + shelf overlay (y > 81%)",
  }),
]);

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function clampScore(num) {
  if (!Number.isFinite(num)) return 0;
  return Math.round(clamp(num, 0, 100));
}

function round1(num) {
  return Math.round(Number(num || 0) * 10) / 10;
}

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

function scoreToGrade(score) {
  const s = clampScore(score);
  if (s >= 95) return "S";
  if (s >= 90) return "A+";
  if (s >= 85) return "A";
  if (s >= 80) return "B+";
  if (s >= 70) return "B";
  return "C";
}

function stripEmojisAndQuotes(raw) {
  return String(raw || "")
    .replace(EMOJI_RE, "")
    .replace(/["“”'‘’`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text) {
  const cleaned = stripEmojisAndQuotes(text);
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

function trimToMaxWords(text, maxWords = 7) {
  const words = stripEmojisAndQuotes(text).split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function parseColorRgb(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const hexMatch = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return [
        Number.parseInt(hex[0] + hex[0], 16),
        Number.parseInt(hex[1] + hex[1], 16),
        Number.parseInt(hex[2] + hex[2], 16),
      ];
    }
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgbMatch) {
    return [
      clamp(Number(rgbMatch[1]), 0, 255),
      clamp(Number(rgbMatch[2]), 0, 255),
      clamp(Number(rgbMatch[3]), 0, 255),
    ];
  }
  return null;
}

function relativeLuminance([r, g, b]) {
  const channelToLinear = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

export function computeWcagContrast(fgColor, bgColor) {
  const fg = parseColorRgb(fgColor);
  const bg = parseColorRgb(bgColor);
  if (!fg || !bg) return null;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return round2((lighter + 0.05) / (darker + 0.05));
}

function resolveFrameColors(frame, project) {
  const theme = String(frame?.staging?.theme || "").toLowerCase();
  const brandBg = project?.brandColors?.background || "#0A1410";

  if (theme === "light") {
    return { fg: "#0B1324", bg: "#FFFFFF" };
  }
  if (theme === "gold") {
    return { fg: "#FFFBEB", bg: "#1F180B" };
  }
  if (theme === "emerald") {
    return { fg: "#ECFDF5", bg: "#0B291E" };
  }
  if (theme === "warm") {
    return { fg: "#FFF7ED", bg: "#2A1710" };
  }
  if (theme === "dark") {
    return { fg: "#F8FAFC", bg: "#101826" };
  }

  const explicitFg = frame?.staging?.textColor || "#FFFFFF";
  const explicitBg = frame?.staging?.surfaceColor || brandBg;
  return { fg: explicitFg, bg: explicitBg };
}

function resolveSafeProjectDir(slug, customProjectsDir = null) {
  const cleaned = String(slug || "").trim();
  if (!cleaned) {
    throw new Error("Invalid project slug: slug is required");
  }
  if (
    cleaned.includes("..") ||
    cleaned.includes("/") ||
    cleaned.includes("\\") ||
    cleaned.includes("\0") ||
    !VALID_SLUG_RE.test(cleaned)
  ) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  const baseRoot = customProjectsDir ? path.resolve(customProjectsDir) : PROJECTS_DIR;
  const resolved = path.resolve(baseRoot, cleaned);
  if (!resolved.startsWith(baseRoot + path.sep)) {
    throw new Error(`Invalid project slug path: ${slug}`);
  }
  return resolved;
}

function extractFrameHeadline(frame) {
  return String(
    frame?.staging?.headline ?? frame?.copy?.headline ?? frame?.headline ?? frame?.title ?? "",
  ).trim();
}

function extractFrameSubheadline(frame) {
  return String(
    frame?.staging?.subheadline ??
      frame?.copy?.subheadline ??
      frame?.subheadline ??
      frame?.description ??
      "",
  ).trim();
}

function extractFrameBadge(frame) {
  return String(
    frame?.staging?.badgeText ?? frame?.staging?.badge ?? frame?.copy?.badge ?? frame?.badge ?? "",
  ).trim();
}

function extractFrameCaption(frame) {
  return String(
    frame?.staging?.captionText ??
      frame?.staging?.caption ??
      frame?.copy?.caption ??
      frame?.caption ??
      "",
  ).trim();
}

function extractFrameVoiceover(frame) {
  return String(frame?.audioSpec?.voiceoverText ?? frame?.voiceoverText ?? "").trim();
}

function extractFrameSfx(frame) {
  const raw = frame?.audioSpec?.sfx ?? frame?.sfx ?? [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) =>
        String(item || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(/[,+\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function extractFrameCamera(frame) {
  const cam = frame?.cameraMotion || frame?.staging?.camera || frame?.camera || {};
  const presetId = String(frame?.motionPreset || cam.presetId || "crash-zoom-in").trim();
  const presetDef = MOTION_PRESETS.find((p) => p.id === presetId) || null;

  const fromScale = Number.isFinite(Number(cam.fromScale))
    ? Number(cam.fromScale)
    : (presetDef?.fromScale ?? 1.0);
  const toScale = Number.isFinite(Number(cam.toScale))
    ? Number(cam.toScale)
    : (presetDef?.toScale ?? 1.0);
  const panX = Number.isFinite(Number(cam.panX)) ? Number(cam.panX) : (presetDef?.panX ?? 0);
  const panY = Number.isFinite(Number(cam.panY)) ? Number(cam.panY) : (presetDef?.panY ?? 0);
  const tiltDeg = Number.isFinite(Number(cam.tiltDeg))
    ? Number(cam.tiltDeg)
    : (presetDef?.tiltDeg ?? 0);

  let rawFocusX = cam.focusX ?? presetDef?.focusX ?? 50;
  let rawFocusY = cam.focusY ?? presetDef?.focusY ?? 50;
  // Normalize 0..1 fractions vs 0..100 percentages
  if (rawFocusX > 0 && rawFocusX <= 1) rawFocusX *= 100;
  if (rawFocusY > 0 && rawFocusY <= 1) rawFocusY *= 100;

  return {
    presetId,
    fromScale,
    toScale,
    scaleDelta: Math.abs(toScale - fromScale),
    maxScale: Math.max(fromScale, toScale),
    panX,
    panY,
    tiltDeg,
    focusX: clamp(Number(rawFocusX) || 50, 0, 100),
    focusY: clamp(Number(rawFocusY) || 50, 0, 100),
  };
}

function evaluateThumbstopHook(frames, project) {
  if (!frames.length) {
    return {
      score: 0,
      firstFrameId: "frame_01",
      headlineWordCount: 0,
      contrastRatio: 0,
      hasBoldMotion: false,
      hasSubjectFocus: false,
      hasAudioHook: false,
      signals: [],
      issues: ["No storyboard frames exist yet to evaluate the 3-second hook."],
      fixPrompt:
        'device-3d-showcase crash-zoom-in zoom 150% emerald badge: "WATCH NOW" headline: "See Results 3x Faster"',
    };
  }

  const f1 = frames[0];
  const f1Id = String(f1.id || "frame_01");
  const dur1 = Math.max(0.5, Number(f1.durationSeconds ?? f1.duration) || 3.5);
  const cam = extractFrameCamera(f1);
  const headline = extractFrameHeadline(f1);
  const badge = extractFrameBadge(f1);
  const vo = extractFrameVoiceover(f1);
  const sfx = extractFrameSfx(f1);
  const words = countWords(headline);
  const isGenericHeadline = !headline || GENERIC_PLACEHOLDER_RE.test(headline);

  const signals = [];
  const issues = [];

  // 1. Motion preset energy in first 3.0s (0..25 pts)
  let motionPts = 5;
  const hasHighPreset = HIGH_ENERGY_HOOK_PRESETS.has(cam.presetId);
  const hasModeratePreset = MODERATE_HOOK_PRESETS.has(cam.presetId);

  if (
    hasHighPreset &&
    (cam.scaleDelta >= 0.14 || Math.abs(cam.panX) >= 8 || Math.abs(cam.tiltDeg) >= 6)
  ) {
    motionPts = 25;
    signals.push(`High-velocity opening camera rig (${cam.presetId})`);
  } else if (hasHighPreset || cam.scaleDelta >= 0.2) {
    motionPts = 21;
    signals.push(`Dynamic opening motion (${cam.presetId})`);
  } else if (hasModeratePreset || cam.scaleDelta >= 0.08) {
    motionPts = 15;
  } else {
    motionPts = 4;
    issues.push("Opening 3.0s uses a static lockoff camera without scroll-stopping motion.");
  }

  if (dur1 > 4.8) {
    motionPts = Math.max(0, motionPts - 8);
    issues.push(
      `Opening shot holds for ${round1(dur1)}s (target <= 3.5s before first visual beat change).`,
    );
  } else if (dur1 <= 3.2 && frames.length > 1) {
    motionPts = Math.min(25, motionPts + 2);
    signals.push(`Crisp ${round1(dur1)}s opening beat locks attention before 3.0s`);
  }

  // 2. Headline word count <= 7 & hook clarity (0..25 pts)
  let headlinePts = 0;
  if (isGenericHeadline || words === 0) {
    headlinePts = 2;
    issues.push("Opening frame lacks a specific value or problem headline.");
  } else if (words >= 2 && words <= 7) {
    headlinePts = 25;
    signals.push(`Sub-second readable hook headline (${words} words <= 7)`);
  } else if (words === 1) {
    headlinePts = 18;
  } else if (words <= 10) {
    headlinePts = 13;
    issues.push(`Opening headline is ${words} words (trim to <= 7 words for instant 3s read).`);
  } else {
    headlinePts = 5;
    issues.push(`Opening headline has ${words} words, overloading mobile viewers in the first 3s.`);
  }

  // 3. Visual WCAG contrast (0..20 pts)
  const { fg, bg } = resolveFrameColors(f1, project);
  const contrastRatio = computeWcagContrast(fg, bg) ?? 7.5;
  let contrastPts = 0;
  if (contrastRatio >= 7.0) {
    contrastPts = 20;
    signals.push(`WCAG AAA visual contrast (${contrastRatio}:1)`);
  } else if (contrastRatio >= 4.5) {
    contrastPts = 16;
  } else if (contrastRatio >= 3.0) {
    contrastPts = 8;
    issues.push(`Low opening text-to-surface contrast (${contrastRatio}:1 < 4.5:1 WCAG AA).`);
  } else {
    contrastPts = 2;
    issues.push(`Severe low contrast (${contrastRatio}:1) washes out the opening hook.`);
  }

  // 4. Character face / closeup or bold optical zoom (0..15 pts)
  const hasCharacter =
    Boolean(f1.hasCharacter) ||
    Boolean(f1.characterDetection?.hasCharacter) ||
    Boolean(f1.characterFace?.hasCharacter) ||
    /character|face|closeup|close-up|founder|presenter|avatar|portrait/i.test(
      `${f1.title || ""} ${f1.prompt || ""} ${f1.layout || ""}`,
    );
  const hasBoldZoomOrHero =
    cam.maxScale >= 1.25 ||
    f1.layout === "device-3d-showcase" ||
    f1.layout === "spotlight-cursor-zoom" ||
    Math.abs(cam.tiltDeg) >= 8;

  let subjectPts = 3;
  if (hasCharacter && cam.maxScale >= 1.2) {
    subjectPts = 15;
    signals.push("On-camera character presence paired with bold optical framing");
  } else if (
    hasCharacter ||
    cam.maxScale >= 1.32 ||
    (hasBoldZoomOrHero && cam.scaleDelta >= 0.12)
  ) {
    subjectPts = 14;
    signals.push("Focal closeup / 3D hero framing anchors viewer eye immediately");
  } else if (cam.maxScale >= 1.12 || badge) {
    subjectPts = 9;
  } else {
    issues.push("Add a 1.35x+ closeup zoom, 3D hero device, or speaking character in Scene 1.");
  }

  // 5. Audio / SFX hook in first 3.0s (0..15 pts)
  const hasTransientSfx = sfx.some((cue) => TRANSIENT_HOOK_SFX.has(cue));
  const hasVoHook = vo.length >= 6;
  let audioPts = 0;
  if (hasTransientSfx && hasVoHook) {
    audioPts = 15;
    signals.push("Transient SFX + spoken hook land within the first 3.0s");
  } else if (hasTransientSfx) {
    audioPts = 11;
    signals.push("Transient SFX accents the opening motion beat");
  } else if (hasVoHook) {
    audioPts = 8;
    issues.push("Add a transient whoosh/pop SFX cue on Scene 1 to reinforce the opening cut.");
  } else {
    audioPts = 0;
    issues.push("Silent opening 3.0s — add transient SFX and an immediate spoken hook.");
  }

  const score = clampScore(motionPts + headlinePts + contrastPts + subjectPts + audioPts);
  const conciseHeadline =
    words > 0 && !isGenericHeadline
      ? trimToMaxWords(headline, 6)
      : trimToMaxWords(`${project?.title || "Studio"} Faster in One Tap`, 6);

  return {
    score,
    firstFrameId: f1Id,
    headlineWordCount: words,
    contrastRatio,
    hasBoldMotion: motionPts >= 20,
    hasSubjectFocus: subjectPts >= 12,
    hasAudioHook: audioPts >= 10,
    signals,
    issues,
    fixPrompt: `device-3d-showcase crash-zoom-in zoom 148% emerald badge: "FEATURED OFFER" headline: "${conciseHeadline}"`,
  };
}

function buildRetentionTimeline(frames, thumbstopHook) {
  if (!frames.length) {
    return {
      totalDuration: 0,
      retentionCurve: [{ second: 0, retentionPct: 100, event: "Empty storyboard", risk: "high" }],
      dropOffRisks: [
        {
          timeRange: "0.0s–3.0s",
          startSec: 0,
          endSec: 3,
          frameId: "frame_01",
          reason: "Storyboard has no scenes yet.",
          fixPrompt: thumbstopHook.fixPrompt,
        },
      ],
    };
  }

  // Map frame time spans
  const spans = [];
  let cursor = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const dur = Math.max(0.8, Number(frame.durationSeconds ?? frame.duration) || 3.5);
    const startSec = round2(cursor);
    const endSec = round2(cursor + dur);
    spans.push({
      frame,
      frameId: String(frame.id || `frame_${String(i + 1).padStart(2, "0")}`),
      index: i + 1,
      startSec,
      endSec,
      duration: dur,
      cam: extractFrameCamera(frame),
      speedFactor: Number(frame.speedFactor) || 1.0,
      layout: String(frame.layout || "device-3d-showcase"),
    });
    cursor += dur;
  }

  const totalDuration = round2(cursor);
  const maxIntSec = Math.max(1, Math.ceil(totalDuration));
  const retentionCurve = [];

  let retention = 100;
  const hookQuality = thumbstopHook.score / 100;

  for (let sec = 0; sec <= maxIntSec; sec++) {
    if (sec === 0) {
      retentionCurve.push({
        second: 0,
        retentionPct: 100,
        frameId: spans[0].frameId,
        event: `Ad start · ${spans[0].cam.presetId} (${spans[0].layout})`,
        risk: thumbstopHook.score < 60 ? "high" : "low",
      });
      continue;
    }

    const activeSpan =
      spans.find((sp) => sec >= sp.startSec && sec < sp.endSec) || spans[spans.length - 1];
    const prevSpan = activeSpan.index > 1 ? spans[activeSpan.index - 2] : null;
    const dwellInShot = sec - activeSpan.startSec;
    const isCutSecond = activeSpan.index > 1 && dwellInShot >= 0 && dwellInShot < 1.0;
    const isLayoutShift = Boolean(isCutSecond && prevSpan && prevSpan.layout !== activeSpan.layout);
    const hasKineticCamera =
      HIGH_ENERGY_HOOK_PRESETS.has(activeSpan.cam.presetId) ||
      activeSpan.cam.scaleDelta >= 0.16 ||
      activeSpan.speedFactor >= 1.25;

    let loss = 1.6;
    let event = `Scene ${activeSpan.index} active (${activeSpan.layout})`;
    let risk = "low";

    if (sec <= 3) {
      // First 3 seconds: driven heavily by thumbstop hook strength
      loss = round2(6.8 - hookQuality * 4.9);
      if (isCutSecond) {
        loss = Math.max(0.9, loss - 0.8);
        event = `Early pattern-interrupt cut -> Scene ${activeSpan.index}`;
      } else {
        event =
          thumbstopHook.score >= 75
            ? `3s Hook lock (${activeSpan.cam.presetId})`
            : "3s Hook window — elevated swipe risk";
      }
      if (thumbstopHook.score < 55) risk = "high";
      else if (thumbstopHook.score < 72) risk = "medium";
    } else if (isCutSecond) {
      if (
        prevSpan &&
        prevSpan.layout === activeSpan.layout &&
        prevSpan.cam.presetId === activeSpan.cam.presetId
      ) {
        loss = 2.6;
        risk = "medium";
        event = `Scene ${activeSpan.index} cut (same layout & camera rig)`;
      } else {
        loss = isLayoutShift ? 0.85 : 1.15;
        risk = "low";
        event = `Pattern interrupt -> Scene ${activeSpan.index} (${activeSpan.layout})`;
      }
    } else if (dwellInShot >= 3.6 && !hasKineticCamera) {
      loss = 4.6;
      risk = "high";
      event = `Static dwell (${round1(dwellInShot)}s in Scene ${activeSpan.index})`;
    } else if (dwellInShot >= 3.2) {
      loss = 2.9;
      risk = "medium";
      event = `Extended hold (${round1(dwellInShot)}s in Scene ${activeSpan.index})`;
    } else if (!hasKineticCamera && activeSpan.cam.scaleDelta < 0.05) {
      loss = 3.2;
      risk = "medium";
      event = `Low-motion hold in Scene ${activeSpan.index}`;
    } else {
      loss = 1.35;
      risk = "low";
      event = `Sustained camera motion (${activeSpan.cam.presetId})`;
    }

    retention = clamp(round1(retention - loss), 12, 100);
    retentionCurve.push({
      second: sec,
      retentionPct: retention,
      frameId: activeSpan.frameId,
      event,
      risk,
    });
  }

  // Synthesize concrete dropOffRisks windows
  const dropOffRisks = [];

  if (thumbstopHook.score < 68) {
    const windowEnd = round1(Math.min(3.0, spans[0].endSec));
    dropOffRisks.push({
      timeRange: `0.0s–${windowEnd.toFixed(1)}s`,
      startSec: 0,
      endSec: windowEnd,
      frameId: spans[0].frameId,
      severity: thumbstopHook.score < 50 ? "high" : "medium",
      reason:
        thumbstopHook.issues[0] ||
        "First 3.0s hook lacks high-contrast punchy headline or scroll-stopping motion.",
      fixPrompt: thumbstopHook.fixPrompt,
    });
  }

  for (let i = 0; i < spans.length; i++) {
    const sp = spans[i];
    const prev = i > 0 ? spans[i - 1] : null;
    const headline = stripEmojisAndQuotes(extractFrameHeadline(sp.frame));
    const safeHeadline =
      headline && !GENERIC_PLACEHOLDER_RE.test(headline)
        ? trimToMaxWords(headline, 6)
        : `Key Benefit ${String(sp.index).padStart(2, "0")}`;

    if (sp.duration > 4.6) {
      const alternateLayout =
        sp.layout === "spotlight-cursor-zoom" ? "bento-feature-grid" : "spotlight-cursor-zoom";
      dropOffRisks.push({
        timeRange: `${sp.startSec.toFixed(1)}s–${sp.endSec.toFixed(1)}s`,
        startSec: sp.startSec,
        endSec: sp.endSec,
        frameId: sp.frameId,
        severity: sp.duration >= 6.0 ? "high" : "medium",
        reason: `Scene ${sp.index} dwells for ${round1(sp.duration)}s without a cut, accelerating mid-video viewer drop-off.`,
        fixPrompt: `${alternateLayout} spotlight-cursor-follow zoom 145% pace 1.4x dark headline: "${safeHeadline}"`,
      });
    } else if (prev && prev.layout === sp.layout && prev.cam.presetId === sp.cam.presetId) {
      const nextLayout =
        LAYOUT_ARCHETYPES[(LAYOUT_ARCHETYPES.indexOf(sp.layout) + 1) % LAYOUT_ARCHETYPES.length] ||
        "split-editorial";
      dropOffRisks.push({
        timeRange: `${sp.startSec.toFixed(1)}s–${sp.endSec.toFixed(1)}s`,
        startSec: sp.startSec,
        endSec: sp.endSec,
        frameId: sp.frameId,
        severity: "medium",
        reason: `Scene ${sp.index} repeats the exact layout (${sp.layout}) and camera preset (${sp.cam.presetId}) from Scene ${prev.index}, dulling visual momentum.`,
        fixPrompt: `${nextLayout} whip-pan-split zoom 136% emerald headline: "${safeHeadline}"`,
      });
    }
  }

  if (spans.length >= 2) {
    const last = spans[spans.length - 1];
    const closingCopy = `${extractFrameBadge(last.frame)} ${extractFrameHeadline(last.frame)} ${last.frame?.staging?.ctaText || ""}`;
    if (!CTA_CUE_RE.test(closingCopy)) {
      dropOffRisks.push({
        timeRange: `${last.startSec.toFixed(1)}s–${last.endSec.toFixed(1)}s`,
        startSec: last.startSec,
        endSec: last.endSec,
        frameId: last.frameId,
        severity: "low",
        reason:
          "Closing scene has no explicit call-to-action verb or badge, reducing click-through conversion.",
        fixPrompt:
          'kinetic-statement-card editorial-kinetic-card zoom 124% gold badge: "GET STARTED NOW" headline: "Try It Today in Seconds"',
      });
    }
  }

  return { totalDuration, retentionCurve, dropOffRisks };
}

function evaluateSoundOffReadability(frames, project) {
  if (!frames.length) {
    return {
      score: 0,
      issues: ["No storyboard frames available to audit muted autoplay comprehension."],
      recommendations: ["Generate storyboard scenes with concise headlines, badges, and captions."],
    };
  }

  const issues = [];
  const recommendations = [];

  let clearHeadlineCount = 0;
  let captionCoveredCount = 0;
  let audioOnlyGapCount = 0;
  let calloutBadgeCount = 0;
  let contrastPassCount = 0;
  let hasOfferSignal = false;
  let hasVisualCta = false;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const headline = extractFrameHeadline(frame);
    const subheadline = extractFrameSubheadline(frame);
    const badge = extractFrameBadge(frame);
    const caption = extractFrameCaption(frame);
    const vo = extractFrameVoiceover(frame);
    const ctaText = String(frame?.staging?.ctaText || "").trim();
    const callouts = Array.isArray(frame?.staging?.calloutItems)
      ? frame.staging.calloutItems
      : Array.isArray(frame?.bullets)
        ? frame.bullets
        : [];

    const words = countWords(headline);
    const nonGeneric = Boolean(headline) && !GENERIC_PLACEHOLDER_RE.test(headline);

    if (nonGeneric && words >= 2 && words <= 10) {
      clearHeadlineCount += 1;
    } else if (nonGeneric && words > 10) {
      clearHeadlineCount += 0.4;
    }

    if (caption.length >= 6 || (vo.length === 0 && subheadline.length >= 8)) {
      captionCoveredCount += 1;
    } else if (countWords(vo) >= 6 && !caption && !subheadline) {
      audioOnlyGapCount += 1;
    }

    if (badge || callouts.length > 0 || frame?.metricValue) {
      calloutBadgeCount += 1;
    }

    const combinedVisible = `${badge} ${headline} ${subheadline} ${caption} ${ctaText}`;
    if (OFFER_VALUE_RE.test(combinedVisible)) hasOfferSignal = true;
    if (CTA_CUE_RE.test(combinedVisible)) hasVisualCta = true;

    const { fg, bg } = resolveFrameColors(frame, project);
    const ratio = computeWcagContrast(fg, bg) ?? 7.0;
    if (ratio >= 4.5) contrastPassCount += 1;
  }

  const total = frames.length;
  const headlinePts = (clearHeadlineCount / total) * 34;
  const captionPts = Math.max(0, (captionCoveredCount / total) * 26 - audioOnlyGapCount * 6);
  const calloutPts = Math.min(18, (calloutBadgeCount / total) * 18);
  const offerCtaPts = (hasOfferSignal ? 6 : 0) + (hasVisualCta ? 6 : 0);
  const contrastPts = (contrastPassCount / total) * 10;

  if (clearHeadlineCount < total) {
    issues.push(
      "Some scenes use placeholder or overly long headlines that muted scrollers cannot scan quickly.",
    );
    recommendations.push("Give every scene a specific 3–7 word on-screen headline.");
  }
  if (audioOnlyGapCount > 0) {
    issues.push(
      `${audioOnlyGapCount} scene(s) carry spoken voiceover with no on-screen caption or subheadline fallback.`,
    );
    recommendations.push(
      "Enable kinetic captions or add concise captionText on spoken scenes for muted feeds.",
    );
  }
  if (!hasOfferSignal) {
    issues.push("No concrete offer, timeframe, or proof metric is visible without audio.");
  }
  if (!hasVisualCta) {
    issues.push("No visible CTA badge or action verb appears on screen for muted viewers.");
  }

  return {
    score: clampScore(headlinePts + captionPts + calloutPts + offerCtaPts + contrastPts),
    issues,
    recommendations,
  };
}

function resolveEffectiveAspectRatio(project, storyboard) {
  const explicit = String(storyboard?.aspectRatio || project?.aspectRatio || "").trim();
  if (explicit) return explicit;
  const w = Number(project?.width || storyboard?.width) || 1080;
  const h = Number(project?.height || storyboard?.height) || 1920;
  if (w === h) return "1:1";
  return w < h ? "9:16" : "16:9";
}

function evaluatePlatformSafeZones(frames, project, storyboard) {
  const aspectRatio = resolveEffectiveAspectRatio(project, storyboard);
  const audits = [];

  for (const spec of PLATFORM_SAFE_ZONE_SPECS) {
    const issues = [];
    let rightRailClear = true;
    let bottomOverlayClear = true;
    const aspectCompatible = aspectRatio === spec.requiredAspect;

    if (!aspectCompatible) {
      issues.push(
        `Project canvas is ${aspectRatio}; ${spec.platform} ads perform best in full-screen ${spec.requiredAspect} (1080x1920) without letterbox bars.`,
      );
    }

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const cam = extractFrameCamera(frame);
      const sceneLabel = `Scene ${i + 1}`;
      const captionWords = countWords(extractFrameCaption(frame));
      const explicitBottomPct = Number(frame?.staging?.captionBottomPct);

      // Check right-side engagement icon rail collision
      if (cam.focusX > spec.rightRailMinX || cam.panX > 22) {
        rightRailClear = false;
        issues.push(
          `${sceneLabel} focal point (focusX ${Math.round(cam.focusX)}%) sits under ${spec.platform}'s right-side engagement icon rail (> ${spec.rightRailMinX}%).`,
        );
      }

      // Check bottom caption + sponsored CTA bar collision
      const collidesBottomFocus = cam.focusY > spec.bottomOverlayMinY || cam.panY > 20;
      const collidesExplicitBottom =
        Number.isFinite(explicitBottomPct) && explicitBottomPct < 100 - spec.bottomOverlayMinY;
      const collidesDenseLowerThird = frame?.layout === "fullbleed-cinema" && captionWords > 16;

      if (collidesBottomFocus || collidesExplicitBottom || collidesDenseLowerThird) {
        bottomOverlayClear = false;
        issues.push(
          `${sceneLabel} places key focus or dense copy inside ${spec.platform}'s bottom caption/CTA overlay zone (> ${spec.bottomOverlayMinY}% height).`,
        );
      }
    }

    const passed = aspectCompatible && rightRailClear && bottomOverlayClear && issues.length === 0;
    audits.push({
      platform: spec.platform,
      id: spec.id,
      status: passed ? "pass" : "warning",
      passed,
      aspectCompatible,
      rightRailClear,
      bottomOverlayClear,
      bottomBarClear: bottomOverlayClear,
      safeZoneBounds: {
        topPct: spec.topHeaderMaxY,
        bottomPct: 100 - spec.bottomOverlayMinY,
        rightRailPct: 100 - spec.rightRailMinX,
      },
      issues,
      warnings: issues,
      summary: passed
        ? `Clear of ${spec.platform} right-rail icons and bottom sponsored CTA overlay.`
        : issues[0],
      fixPrompt: passed
        ? null
        : 'split-editorial crash-zoom-in zoom 135% pan left dark badge: "SAFE ZONE"',
    });
  }

  // Attach non-enumerable named lookups (.tiktok, .instagramReels, .youtubeShorts) per V3_CONTRACTS.md
  for (let i = 0; i < PLATFORM_SAFE_ZONE_SPECS.length; i++) {
    const spec = PLATFORM_SAFE_ZONE_SPECS[i];
    const entry = audits[i];
    Object.defineProperty(audits, spec.camelKey, {
      value: entry,
      enumerable: false,
      configurable: true,
    });
    if (spec.id !== spec.camelKey) {
      Object.defineProperty(audits, spec.id, {
        value: entry,
        enumerable: false,
        configurable: true,
      });
    }
  }

  return audits;
}

function detectLanguageFamily(project, frames) {
  const sample = `${project?.language || ""} ${project?.title || ""} ${extractFrameHeadline(frames[0])}`;
  if (/bengali|বাংলা/i.test(sample) || BENGALI_RE.test(sample)) return "Bengali";
  if (/hindi|हिन्दी|हिंदी/i.test(sample) || HINDI_RE.test(sample)) return "Hindi";
  return "English";
}

function extractBrandSubject(project, frames) {
  const rawTitle = stripEmojisAndQuotes(project?.title || "");
  const cleanedTitle = rawTitle
    .replace(/\b(?:promo|video|project|ad|draft|demo|test|v\d+)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanedTitle) {
    return trimToMaxWords(cleanedTitle, 2);
  }

  const f1Headline = stripEmojisAndQuotes(extractFrameHeadline(frames[0]));
  if (f1Headline && !GENERIC_PLACEHOLDER_RE.test(f1Headline)) {
    return trimToMaxWords(f1Headline, 2);
  }
  return "Your Workflow";
}

function extractProofToken(frames) {
  for (const frame of frames) {
    const text = `${extractFrameBadge(frame)} ${extractFrameHeadline(frame)} ${extractFrameSubheadline(frame)}`;
    const statMatch = text.match(/\b(\d+(?:\.\d+)?\s*(?:%|x|min|mins|minutes))\b/i);
    if (statMatch) {
      return stripEmojisAndQuotes(statMatch[1]).replace(/\s+/g, " ");
    }
  }
  return "3x";
}

function generateHookVariants(frames, project) {
  const firstFrameId = String(frames[0]?.id || "frame_01");
  const lang = detectLanguageFamily(project, frames);
  const subject = extractBrandSubject(project, frames);
  const proof = extractProofToken(frames);

  let problemHeadline = "";
  let problemSub = "";
  let problemBadge = "";

  let proofHeadline = "";
  let proofSub = "";
  let proofBadge = "";

  let interruptHeadline = "";
  let interruptSub = "";
  let interruptBadge = "";

  if (lang === "Bengali") {
    problemBadge = "সময় বাঁচান";
    problemHeadline = trimToMaxWords(`দেরি নয়, ${subject} এখন আরও সহজ`, 7);
    problemSub = "পুরোনো ঝামেলা বাদ দিয়ে এক ট্যাপেই সমাধান পান।";

    proofBadge = "বিশেষ অফার";
    proofHeadline = trimToMaxWords(`${subject} দিয়ে ৩ গুণ দ্রুত সাফল্য`, 7);
    proofSub = "প্রথম দিন থেকেই যাচাইকৃত ফলাফল ও সেরা মান।";

    interruptBadge = "সরাসরি দেখুন";
    interruptHeadline = trimToMaxWords(`এক ক্লিকেই ${subject} ম্যাজিক দেখুন`, 7);
    interruptSub = "চোখের পলকে নিখুঁত ফলাফল ও স্মার্ট অভিজ্ঞতা।";
  } else if (lang === "Hindi") {
    problemBadge = "समय बचाएं";
    problemHeadline = trimToMaxWords(`धीमे काम छोड़ें, ${subject} अपनाएं आज`, 7);
    problemSub = "बिना किसी झंझट के एक टैप में तेज़ समाधान।";

    proofBadge = "विशेष ऑफ़र";
    proofHeadline = trimToMaxWords(`${subject} से पाएं 3 गुना तेज़ नतीजे`, 7);
    proofSub = "पहले ही दिन से भरोसेमंद क्वालिटी और बचत।";

    interruptBadge = "लाइव देखें";
    interruptHeadline = trimToMaxWords(`देखें ${subject} कैसे बदलता है सब`, 7);
    interruptSub = "कुछ ही सेकंड में स्मार्ट और स्पष्ट परिणाम।";
  } else {
    problemBadge = "STOP WASTING TIME";
    problemHeadline = trimToMaxWords(`Tired of Slow ${subject} Every Day`, 7);
    problemSub = "Eliminate manual friction in seconds with one clean workflow.";

    proofBadge = "VERIFIED PROOF";
    proofHeadline = trimToMaxWords(`Get ${subject} Results ${proof} Faster`, 7);
    proofSub = "Proven speed and high-contrast clarity from your very first tap.";

    interruptBadge = "WATCH CLOSELY";
    interruptHeadline = trimToMaxWords(`Watch ${subject} Transform One Tap`, 7);
    interruptSub = "Instant visual payoff engineered to stop the scroll cold.";
  }

  return [
    {
      id: "hook_problem_agitation",
      archetype: "Problem-Agitation Hook",
      name: "Problem-Agitation Hook",
      title: "Problem-Agitation Hook",
      targetFrameId: firstFrameId,
      headline: problemHeadline,
      subheadline: problemSub,
      badgeText: problemBadge,
      motionPreset: "whip-pan-split",
      layout: "split-editorial",
      rationale:
        "Calls out viewer frustration in under 7 words while lateral whip-pan momentum breaks feed monotony.",
      prompt: `split-editorial whip-pan-split zoom 142% emerald badge: "${problemBadge}" headline: "${problemHeadline}" subheadline: "${problemSub}"`,
    },
    {
      id: "hook_bold_offer",
      archetype: "Bold Offer/Proof Hook",
      name: "Bold Offer/Proof Hook",
      title: "Bold Offer/Proof Hook",
      targetFrameId: firstFrameId,
      headline: proofHeadline,
      subheadline: proofSub,
      badgeText: proofBadge,
      motionPreset: "crash-zoom-in",
      layout: "device-3d-showcase",
      rationale:
        "Leads with concrete quantified proof paired with an optical crash-zoom onto the 3D hero frame.",
      prompt: `device-3d-showcase crash-zoom-in zoom 155% gold badge: "${proofBadge}" headline: "${proofHeadline}" subheadline: "${proofSub}"`,
    },
    {
      id: "hook_pattern_interrupt",
      archetype: "Visual Pattern-Interrupt Hook",
      name: "Visual Pattern-Interrupt Hook",
      title: "Visual Pattern-Interrupt Hook",
      targetFrameId: firstFrameId,
      headline: interruptHeadline,
      subheadline: interruptSub,
      badgeText: interruptBadge,
      motionPreset: "spotlight-cursor-follow",
      layout: "spotlight-cursor-zoom",
      rationale:
        "Uses a dimmed spotlight stage and kinetic cursor magnification to trigger immediate visual curiosity.",
      prompt: `spotlight-cursor-zoom spotlight-cursor-follow zoom 160% dark badge: "${interruptBadge}" headline: "${interruptHeadline}" subheadline: "${interruptSub}"`,
    },
  ];
}

export function loadLatestAdAnalytics(slug, options = {}) {
  const projectDir = resolveSafeProjectDir(slug, options.projectsDir || null);
  const reportPath = path.join(projectDir, ".studio", "ad-analytics.json");
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch {
    return null;
  }
}

export async function evaluateAdCreativeAnalytics(options = {}) {
  const rawSlug = options.slug || options.project?.slug || options.storyboard?.slug || null;
  let projectDir = null;
  if (options.slug) {
    projectDir = resolveSafeProjectDir(options.slug, options.projectsDir || null);
  } else if (rawSlug && VALID_SLUG_RE.test(String(rawSlug))) {
    const candidate = resolveSafeProjectDir(rawSlug, options.projectsDir || null);
    if (fs.existsSync(candidate)) {
      projectDir = candidate;
    }
  }

  let project = options.project || null;
  if (!project && projectDir) {
    const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
    if (fs.existsSync(briefPath)) {
      try {
        project = JSON.parse(fs.readFileSync(briefPath, "utf8"));
      } catch {
        project = null;
      }
    }
  }

  let storyboard = options.storyboard || null;
  if (!storyboard && projectDir) {
    const sbPath = path.join(projectDir, "STORYBOARD.json");
    if (fs.existsSync(sbPath)) {
      try {
        storyboard = JSON.parse(fs.readFileSync(sbPath, "utf8"));
      } catch {
        storyboard = null;
      }
    }
  }

  const effectiveProject = project || {
    slug: rawSlug || "untitled",
    title: storyboard?.title || rawSlug || "Studio Ad",
    aspectRatio: storyboard?.aspectRatio || "9:16",
    width: 1080,
    height: 1920,
    language: "English",
    brandColors: storyboard?.brandColors || {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#FACC15",
      background: "#0A1410",
    },
  };

  const frames = Array.isArray(storyboard?.frames) ? storyboard.frames : [];

  const thumbstopHook = evaluateThumbstopHook(frames, effectiveProject);
  const { totalDuration, retentionCurve, dropOffRisks } = buildRetentionTimeline(
    frames,
    thumbstopHook,
  );
  const soundOff = evaluateSoundOffReadability(frames, effectiveProject);
  const platformSafeZones = evaluatePlatformSafeZones(frames, effectiveProject, storyboard);
  const hookVariants = generateHookVariants(frames, effectiveProject);

  const safeZonePassCount = platformSafeZones.filter((z) => z.passed).length;
  const safeZoneScore = Math.round((safeZonePassCount / platformSafeZones.length) * 100);
  const endRetentionPct = retentionCurve.at(-1)?.retentionPct ?? 0;

  const overallAdScore =
    frames.length === 0
      ? 0
      : clampScore(
          thumbstopHook.score * 0.38 +
            soundOff.score * 0.27 +
            endRetentionPct * 0.2 +
            safeZoneScore * 0.15,
        );

  const grade = scoreToGrade(overallAdScore);
  const verdict =
    frames.length === 0
      ? "Generate storyboard frames first to unlock 3-second hook, retention, and safe-zone diagnostics."
      : overallAdScore >= 85
        ? `Ad creative is launch-ready (${overallAdScore}/100, Grade ${grade}) with strong 3s thumbstop energy and clean vertical safe zones.`
        : overallAdScore >= 70
          ? `Solid ad draft (${overallAdScore}/100, Grade ${grade}) — test an A/B Scene 1 hook or tighten long holds to lift retention.`
          : `High early swipe-away risk (${overallAdScore}/100, Grade ${grade}) — apply a 1-click Scene 1 hook variant and resolve safe-zone warnings before export.`;

  const evaluatedAt = new Date().toISOString();

  const report = {
    slug: rawSlug || effectiveProject.slug,
    overallAdScore,
    grade,
    verdict,
    totalDurationSeconds: totalDuration,
    thumbstopHookScore: thumbstopHook.score,
    soundOffScore: soundOff.score,
    thumbstopBreakdown: thumbstopHook,
    soundOffBreakdown: soundOff,
    retentionCurve,
    dropOffRisks,
    platformSafeZones,
    hookVariants,
    evaluatedAt,
  };

  if (projectDir && fs.existsSync(projectDir)) {
    const studioDir = path.join(projectDir, ".studio");
    fs.mkdirSync(studioDir, { recursive: true });
    fs.writeFileSync(
      path.join(studioDir, "ad-analytics.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );
  }

  return report;
}

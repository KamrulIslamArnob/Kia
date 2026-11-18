import fs from "node:fs";
import path from "node:path";
import { assertValidSlug, PROJECTS_DIR, ROOT_DIR } from "./lib.mjs";
import { LAYOUT_ARCHETYPES, MOTION_PRESETS } from "./storyboard.mjs";

const CATEGORY_WEIGHTS = Object.freeze({
  hookAndPacing: 0.2,
  visualHierarchyAndContrast: 0.2,
  motionContinuity: 0.2,
  skillAlignment: 0.15,
  brandConsistency: 0.1,
  audioAndCaptions: 0.15,
});

const DEFAULT_BRAND_COLORS = Object.freeze({
  primary: "#1E824C",
  secondary: "#2ECC71",
  accent: "#F1C40F",
  background: "#0A1612",
});

const TIER_B_SEAMS = new Set([
  "zoom-through",
  "inverse-zoom",
  "cut-the-curve",
  "waterfall-cut",
  "rack-focus",
  "whip-pan",
]);

const BANNED_CLICHES_RE =
  /\b(elevate|seamless|unleash|next-gen|game-changer|delve|lorem ipsum|acme corp)\b/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const BENGALI_CHAR_RE = /[\u0980-\u09FF]/;
const LATIN_WORD_RE = /[A-Za-z]{3,}/g;

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function clampScore(num) {
  if (!Number.isFinite(num)) return 0;
  return Math.round(clamp(num, 0, 100));
}

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

/**
 * Maps an integer 0..100 quality score to its Studio Hub V2 letter grade.
 * @param {number} score
 * @returns {"S" | "A+" | "A" | "B+" | "B" | "C"}
 */
export function scoreToGrade(score) {
  const s = clampScore(score);
  if (s >= 95) return "S";
  if (s >= 90) return "A+";
  if (s >= 85) return "A";
  if (s >= 80) return "B+";
  if (s >= 70) return "B";
  return "C";
}

function parseColorRgb(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || /^transparent$/i.test(trimmed) || /^none$/i.test(trimmed)) {
    return null;
  }

  const hexMatch = trimmed.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      const r = Number.parseInt(hex[0] + hex[0], 16);
      const g = Number.parseInt(hex[1] + hex[1], 16);
      const b = Number.parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? Number.parseInt(hex[3] + hex[3], 16) / 255 : 1;
      if (a < 0.5) return null;
      return [r, g, b];
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if (a < 0.5) return null;
      return [r, g, b];
    }
    return null;
  }

  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*[,/]\s*([0-9.]+))?\s*\)$/i,
  );
  if (rgbMatch) {
    const a = rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1;
    if (!Number.isFinite(a) || a < 0.5) return null;
    return [
      clamp(Number(rgbMatch[1]), 0, 255),
      clamp(Number(rgbMatch[2]), 0, 255),
      clamp(Number(rgbMatch[3]), 0, 255),
    ];
  }

  return null;
}

function relativeLuminance([r, g, b]) {
  const toLinear = (channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Computes WCAG 2.1 relative luminance contrast ratio (1..21) between two CSS colors.
 * Returns null if either color cannot be parsed as an opaque color.
 * @param {string} fgColor
 * @param {string} bgColor
 * @returns {number | null}
 */
export function computeWcagContrastRatio(fgColor, bgColor) {
  const fg = parseColorRgb(fgColor);
  const bg = parseColorRgb(bgColor);
  if (!fg || !bg) return null;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return round2((lighter + 0.05) / (darker + 0.05));
}

function resolveFrameStagingColors(theme, brandColors = {}) {
  const primary = brandColors?.primary || DEFAULT_BRAND_COLORS.primary;
  const accent = brandColors?.accent || DEFAULT_BRAND_COLORS.accent;
  const baseBg = brandColors?.background ?? DEFAULT_BRAND_COLORS.background;

  switch (theme) {
    case "light":
      return {
        theme: "light",
        background: "#F4F7FA",
        surface: "#FFFFFF",
        text: "#0B1324",
        badgeBg: primary,
        badgeText: "#FFFFFF",
      };
    case "gold":
      return {
        theme: "gold",
        background: "#120E06",
        surface: "#1F180B",
        text: "#FFFBEB",
        badgeBg: "#F59E0B",
        badgeText: "#120E06",
      };
    case "emerald":
      return {
        theme: "emerald",
        background: "#051811",
        surface: "#0B291E",
        text: "#ECFDF5",
        badgeBg: "#10B981",
        badgeText: "#04130D",
      };
    case "warm":
      return {
        theme: "warm",
        background: "#1A0F0A",
        surface: "#2A1710",
        text: "#FFF7ED",
        badgeBg: "#F97316",
        badgeText: "#1A0F0A",
      };
    case "dark":
      return {
        theme: "dark",
        background: "#070B12",
        surface: "#101826",
        text: "#F8FAFC",
        badgeBg: primary,
        badgeText: "#FFFFFF",
      };
    default:
      return {
        theme: "brand-dark",
        background: baseBg,
        surface: "#10231C",
        text: "#F8FAFC",
        badgeBg: accent,
        badgeText: "#0A1612",
      };
  }
}

function countWords(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

function stripQuotesAndEmojis(text) {
  return String(text || "")
    .replace(EMOJI_RE, "")
    .replace(BANNED_CLICHES_RE, "")
    .replace(/["“”'‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSkillMarkdownFallback(skillId, mdPath) {
  let raw = "";
  try {
    raw = fs.readFileSync(mdPath, "utf8");
  } catch {
    return null;
  }

  let name = skillId;
  let description = "";
  let body = raw;
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    const fm = fmMatch[1];
    body = fmMatch[2] || "";
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const descMatch = fm.match(/^description:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, "");
  }

  const ruleHighlights = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^([-*]|\d+\.)\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 8);

  const extractedHexColors = [
    ...new Set((raw.match(/#[0-9A-Fa-f]{6}\b/g) || []).map((h) => h.toUpperCase())),
  ];

  return {
    id: skillId,
    name,
    description,
    skillDir: path.dirname(mdPath),
    skillMdPath: mdPath,
    ruleHighlights,
    extractedHexColors,
    content: raw,
  };
}

function findLocalSkillMarkdown(skillId, slug = null) {
  if (!skillId || !/^[a-z0-9][a-z0-9_-]*$/i.test(skillId)) return null;
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  const candidates = [
    slug ? path.join(PROJECTS_DIR, slug, "skills", skillId, "SKILL.md") : null,
    path.join(ROOT_DIR, ".agents", "skills", skillId, "SKILL.md"),
    path.join(ROOT_DIR, "skills", skillId, "SKILL.md"),
    userProfile ? path.join(userProfile, ".gemini", "config", "skills", skillId, "SKILL.md") : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return parseSkillMarkdownFallback(skillId, candidate);
    }
  }
  return null;
}

function readSidecarSelectedSkills(projectDir) {
  if (!projectDir) return null;
  const sidecarPath = path.join(projectDir, ".studio", "selected-skills.json");
  if (!fs.existsSync(sidecarPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    if (Array.isArray(parsed?.selectedSkills)) {
      return parsed.selectedSkills.map(String).filter(Boolean);
    }
  } catch {
    // Ignore malformed sidecar
  }
  return null;
}

async function resolveSkillSpecs({
  slug,
  projectDir,
  project,
  storyboard,
  hasExplicitSkillSpecs,
  rawSkillSpecs,
}) {
  let skillsMod = null;
  try {
    skillsMod = await import("./skills-registry.mjs");
  } catch {
    skillsMod = null;
  }

  let catalogMap = new Map();
  if (skillsMod && typeof skillsMod.discoverLocalSkills === "function") {
    try {
      const discovered = await skillsMod.discoverLocalSkills({ slug });
      if (Array.isArray(discovered)) {
        catalogMap = new Map(discovered.map((item) => [item.id || item.name, item]));
      }
    } catch {
      catalogMap = new Map();
    }
  }

  let rawList = [];
  if (hasExplicitSkillSpecs) {
    rawList = Array.isArray(rawSkillSpecs) ? rawSkillSpecs : [];
  } else {
    let selectedIds = null;
    if (Array.isArray(project?.selectedSkills)) {
      selectedIds = project.selectedSkills;
    } else if (Array.isArray(storyboard?.selectedSkills)) {
      selectedIds = storyboard.selectedSkills;
    } else if (skillsMod && typeof skillsMod.getSelectedProjectSkills === "function" && slug) {
      try {
        selectedIds = await skillsMod.getSelectedProjectSkills(slug);
      } catch {
        selectedIds = null;
      }
    }
    if (!selectedIds) {
      selectedIds = readSidecarSelectedSkills(projectDir) || [];
    }
    rawList = selectedIds;
  }

  const normalized = [];
  const seen = new Set();

  for (const entry of rawList) {
    if (!entry) continue;
    const rawId =
      typeof entry === "string" ? entry.trim() : String(entry.id || entry.name || "").trim();
    if (!rawId || seen.has(rawId)) continue;
    seen.add(rawId);

    const fromCatalog = catalogMap.get(rawId) || null;
    const diskFallback = findLocalSkillMarkdown(rawId, slug);
    const objEntry = typeof entry === "object" ? entry : {};

    let content = objEntry.content || "";
    const mdPath = objEntry.skillMdPath || fromCatalog?.skillMdPath || diskFallback?.skillMdPath;
    if (!content && mdPath && fs.existsSync(mdPath)) {
      try {
        content = fs.readFileSync(mdPath, "utf8");
      } catch {
        content = "";
      }
    }
    if (!content && diskFallback?.content) {
      content = diskFallback.content;
    }

    normalized.push({
      id: rawId,
      name: objEntry.name || fromCatalog?.name || diskFallback?.name || rawId,
      description:
        objEntry.description || fromCatalog?.description || diskFallback?.description || "",
      category: objEntry.category || fromCatalog?.category || "general",
      ruleHighlights:
        objEntry.ruleHighlights ||
        fromCatalog?.ruleHighlights ||
        diskFallback?.ruleHighlights ||
        [],
      extractedHexColors:
        objEntry.extractedHexColors ||
        fromCatalog?.extractedHexColors ||
        diskFallback?.extractedHexColors ||
        [],
      motionKeywords: objEntry.motionKeywords || fromCatalog?.motionKeywords || [],
      content,
    });
  }

  let compiledDirectives = null;
  if (
    normalized.length > 0 &&
    skillsMod &&
    typeof skillsMod.compileSkillDirectives === "function"
  ) {
    try {
      compiledDirectives = await skillsMod.compileSkillDirectives({
        slug,
        skillIds: normalized.map((s) => s.id),
      });
    } catch {
      compiledDirectives = null;
    }
  }

  return { skillSpecs: normalized, compiledDirectives };
}

function isFrameCameraStatic(cam = {}) {
  const fromScale = Number(cam.fromScale ?? 1);
  const toScale = Number(cam.toScale ?? 1);
  const scaleDelta = Math.abs(toScale - fromScale);
  const panMag = Math.hypot(Number(cam.panX || 0), Number(cam.panY || 0));
  const tiltMag = Math.abs(Number(cam.tiltDeg || 0));
  return scaleDelta < 0.04 && panMag < 2 && tiltMag < 2;
}

function pickDistinctMotionPreset(index, currentPreset, prevPreset) {
  const ordered = [
    "crash-zoom-in",
    "isometric-3d-tilt",
    "whip-pan-split",
    "bento-triptych",
    "dolly-out-reveal",
    "editorial-kinetic-card",
    "spotlight-cursor-follow",
    "parallax-float",
  ];
  const preferredStart = ordered[index % ordered.length];
  if (preferredStart !== currentPreset && preferredStart !== prevPreset) {
    return preferredStart;
  }
  for (const id of ordered) {
    if (id !== currentPreset && id !== prevPreset) return id;
  }
  return "crash-zoom-in";
}

function evaluateHookAndPacing(frames, project, storyboard, frameTrackers) {
  if (frames.length === 0) {
    return {
      score: 0,
      weight: CATEGORY_WEIGHTS.hookAndPacing,
      label: "Hook & pacing",
      detail: "No storyboard frames exist yet to evaluate hook timing or shot cadence.",
    };
  }

  let score = 100;
  const notes = [];
  const first = frames[0];
  const firstDur = Number(first.durationSeconds || 0);
  const firstCam = first.cameraMotion || {};
  const firstHeadline = String(first.staging?.headline || first.title || "").trim();

  if (firstDur > 7.0) {
    score -= 28;
    notes.push(`Shot 1 runs ${round2(firstDur)}s (> 7s hook threshold)`);
    frameTrackers[0].deduct(
      20,
      `Opening shot duration (${round2(firstDur)}s) exceeds the 7.0s hook retention window.`,
    );
  } else if (firstDur < 1.0) {
    score -= 16;
    notes.push(`Shot 1 is too brief (${round2(firstDur)}s)`);
    frameTrackers[0].deduct(12, `Opening shot (${round2(firstDur)}s) cuts away before hook lands.`);
  } else {
    frameTrackers[0].addStrength(`Hook opens cleanly inside ${round2(firstDur)}s`);
  }

  if (isFrameCameraStatic(firstCam)) {
    score -= 18;
    notes.push("Shot 1 lacks opening camera motion/zoom");
    frameTrackers[0].deduct(
      16,
      "Shot 1 camera is static at 1.0x without an active hook zoom or pan.",
    );
    frameTrackers[0].fixHints.needsMotion = true;
    frameTrackers[0].fixHints.preferHookZoom = true;
  } else {
    frameTrackers[0].addStrength("Active opening camera choreography");
  }

  if (firstHeadline.length < 6) {
    score -= 16;
    notes.push("Shot 1 is missing a strong opening headline");
  } else {
    frameTrackers[0].addStrength("Clear opening hook headline");
  }

  const durations = frames.map((f) => Math.max(0.1, Number(f.durationSeconds || 0)));
  const totalDur = durations.reduce((acc, d) => acc + d, 0);
  const avgDur = totalDur / durations.length;

  if (frames.length >= 2) {
    const variance = durations.reduce((acc, d) => acc + (d - avgDur) ** 2, 0) / durations.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev < 0.08) {
      score -= 12;
      notes.push(`uniform mechanical shot lengths (${round2(avgDur)}s each)`);
    }
  }

  for (let i = 1; i < frames.length; i += 1) {
    const dur = durations[i];
    if (dur > 9.0) {
      score -= 8;
      frameTrackers[i].deduct(10, `Shot ${i + 1} holds for ${round2(dur)}s without a scene cut.`);
    }
  }

  const targetDur = Number(project?.durationSeconds || storyboard?.totalDurationSeconds || 0);
  if (targetDur > 0) {
    const relDiff = Math.abs(totalDur - targetDur) / targetDur;
    if (relDiff > 0.4) {
      score -= 18;
      notes.push(`total ${round2(totalDur)}s drifts from ${round2(targetDur)}s target`);
    } else if (relDiff > 0.2) {
      score -= 8;
      notes.push(`total ${round2(totalDur)}s slightly off ${round2(targetDur)}s target`);
    }
  }

  const insp = project?.inspirationProfile || storyboard?.inspirationProfile || null;
  const inspAvg = Number(insp?.avgShotLength || 0);
  if (inspAvg > 0) {
    const effectiveTargetAvg = clamp(inspAvg, 1.8, 7.0);
    const avgRatioDiff = Math.abs(avgDur - effectiveTargetAvg) / effectiveTargetAvg;
    if (avgRatioDiff > 0.65) {
      score -= 14;
      notes.push(
        `avg shot ${round2(avgDur)}s diverges from inspiration pace (${round2(inspAvg)}s)`,
      );
    }
  }

  const finalScore = clampScore(score);
  const detail =
    notes.length === 0
      ? `Shot 1 hooks in ${round2(firstDur)}s with active motion; ${frames.length} shots total ${round2(totalDur)}s (avg ${round2(avgDur)}s/shot).`
      : `Pacing audit (${round2(totalDur)}s across ${frames.length} shots): ${notes.join("; ")}.`;

  return {
    score: finalScore,
    weight: CATEGORY_WEIGHTS.hookAndPacing,
    label: "Hook & pacing",
    detail,
  };
}

function evaluateVisualHierarchyAndContrast(frames, project, projectDir, frameTrackers) {
  if (frames.length === 0) {
    return {
      score: 0,
      weight: CATEGORY_WEIGHTS.visualHierarchyAndContrast,
      label: "Visual contrast",
      detail: "No design frames available for WCAG contrast or Hero PNG verification.",
    };
  }

  const brandColors = project?.brandColors || DEFAULT_BRAND_COLORS;
  let totalFrameVisual = 0;
  let minContrast = Infinity;
  let missingPngCount = 0;
  let missingCopyCount = 0;
  let lowContrastCount = 0;

  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    const tracker = frameTrackers[i];
    let fScore = 100;

    const themeName = f.staging?.theme || "brand-dark";
    const resolved = resolveFrameStagingColors(themeName, brandColors);
    const fgColor = f.staging?.textColor || resolved.text;
    const bgColor = f.staging?.backgroundColor || resolved.background;
    const contrast = computeWcagContrastRatio(fgColor, bgColor);

    if (contrast === null) {
      fScore -= 28;
      lowContrastCount += 1;
      tracker.deduct(
        22,
        `Stage background "${String(bgColor)}" is non-opaque; WCAG contrast cannot be guaranteed.`,
      );
      tracker.fixHints.needsContrastTheme = "obsidian dark";
    } else {
      minContrast = Math.min(minContrast, contrast);
      if (contrast < 3.0) {
        fScore -= 38;
        lowContrastCount += 1;
        tracker.deduct(
          26,
          `Foreground/background WCAG contrast is ${contrast}:1 (< 4.5:1 AA minimum).`,
        );
        tracker.fixHints.needsContrastTheme = "obsidian dark";
      } else if (contrast < 4.5) {
        fScore -= 22;
        lowContrastCount += 1;
        tracker.deduct(
          16,
          `Foreground/background WCAG contrast is ${contrast}:1 (< 4.5:1 AA target).`,
        );
        tracker.fixHints.needsContrastTheme = "obsidian dark";
      } else if (contrast >= 7.0) {
        tracker.addStrength(`WCAG AAA contrast (${contrast}:1)`);
      } else {
        tracker.addStrength(`WCAG AA contrast (${contrast}:1)`);
      }
    }

    const headline = String(f.staging?.headline || f.title || "").trim();
    const badge = String(f.staging?.badgeText || "").trim();
    const subheadline = String(f.staging?.subheadline || "").trim();
    const calloutCount = Array.isArray(f.staging?.calloutItems) ? f.staging.calloutItems.length : 0;

    if (!headline || headline.length < 4) {
      fScore -= 24;
      missingCopyCount += 1;
      tracker.deduct(18, "Missing or ultra-short hero headline reduces visual hierarchy.");
      tracker.fixHints.needsHeadline = true;
    } else if (headline.length > 78) {
      fScore -= 10;
      tracker.deduct(8, "Headline exceeds 78 characters and risks multi-line wrapping.");
      tracker.fixHints.trimHeadline = headline.slice(0, 52).trim();
    }

    if (!badge) {
      fScore -= 8;
      tracker.deduct(6, "Missing eyebrow badge text.");
      tracker.fixHints.needsBadge = true;
    }

    if (!subheadline && calloutCount === 0) {
      fScore -= 10;
      tracker.deduct(8, "Missing supporting subheadline and callout metrics.");
    }

    if (projectDir) {
      const relPng = String(f.designFramePath || "").trim();
      const absPng = relPng
        ? path.isAbsolute(relPng)
          ? relPng
          : path.join(projectDir, relPng.replace(/^\/+/, ""))
        : "";
      let pngExists = false;
      if (absPng && fs.existsSync(absPng)) {
        try {
          pngExists = fs.statSync(absPng).size > 0;
        } catch {
          pngExists = false;
        }
      }
      if (!pngExists) {
        fScore -= 24;
        missingPngCount += 1;
        tracker.deduct(18, "Rendered 1080p Hero Design Frame PNG is missing on disk.");
        tracker.fixHints.needsRender = true;
      } else {
        tracker.addStrength("Hero Frame PNG verified on disk");
      }
    }

    totalFrameVisual += clampScore(fScore);
  }

  const avgVisual = clampScore(totalFrameVisual / frames.length);
  const contrastLabel = Number.isFinite(minContrast)
    ? `${minContrast}:1 min contrast`
    : "unverified contrast";
  const issueParts = [];
  if (lowContrastCount > 0) issueParts.push(`${lowContrastCount} low-contrast shot(s)`);
  if (missingCopyCount > 0) issueParts.push(`${missingCopyCount} missing headline(s)`);
  if (missingPngCount > 0) issueParts.push(`${missingPngCount} unrendered Hero PNG(s)`);

  const detail =
    issueParts.length === 0
      ? `All ${frames.length} Hero Frames pass WCAG legibility (${contrastLabel}) with complete typographic hierarchy.`
      : `Visual audit (${contrastLabel}): ${issueParts.join(", ")}.`;

  return {
    score: avgVisual,
    weight: CATEGORY_WEIGHTS.visualHierarchyAndContrast,
    label: "Visual contrast",
    detail,
  };
}

function evaluateMotionContinuity(frames, frameTrackers) {
  if (frames.length === 0) {
    return {
      score: 0,
      weight: CATEGORY_WEIGHTS.motionContinuity,
      label: "Motion continuity",
      detail: "No shots available to audit camera vectors, transition seams, or speed ramps.",
    };
  }

  let score = 100;
  let staticCount = 0;
  let repeatedCount = 0;
  let badSeamCount = 0;
  let speedViolationCount = 0;
  const presetSet = new Set();

  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    const tracker = frameTrackers[i];
    const cam = f.cameraMotion || {};
    const preset = String(f.motionPreset || cam.presetId || "");
    if (preset) presetSet.add(preset);

    const staticShot = isFrameCameraStatic(cam);
    if (staticShot && i > 0) {
      // Shot 1 static penalty already logged on Shot 1 hook, still counts for motion continuity
      staticCount += 1;
      score -= Math.round(36 / frames.length);
      tracker.deduct(16, "Static camera lockoff violates motion-doctrine continuous performance.");
      tracker.fixHints.needsMotion = true;
    } else if (staticShot && i === 0) {
      staticCount += 1;
      score -= Math.round(28 / frames.length);
      tracker.fixHints.needsMotion = true;
    } else if (i > 0) {
      tracker.addStrength(`Active ${cam.label || preset || "camera"} vector`);
    }

    if (i > 0) {
      const prev = frames[i - 1];
      const prevCam = prev.cameraMotion || {};
      const prevPreset = String(prev.motionPreset || prevCam.presetId || "");
      const samePreset = Boolean(preset && preset === prevPreset);
      const sameVector =
        Math.abs(Number(cam.toScale ?? 1) - Number(prevCam.toScale ?? 1)) < 0.04 &&
        Math.abs(Number(cam.panX || 0) - Number(prevCam.panX || 0)) < 2;

      if (samePreset && (sameVector || staticShot)) {
        repeatedCount += 1;
        score -= 14;
        tracker.deduct(
          14,
          `Repeats identical "${preset}" camera vector from Shot ${i}; vary shot-to-shot momentum.`,
        );
        tracker.fixHints.needsMotion = true;
      }
    }

    const tIn = String(cam.transitionIn || "")
      .trim()
      .toLowerCase();
    const tOut = String(cam.transitionOut || "")
      .trim()
      .toLowerCase();
    if (!tIn || !tOut || tIn === "crossfade" || tOut === "crossfade" || tIn === "dissolve") {
      badSeamCount += 1;
      score -= Math.round(28 / frames.length);
      tracker.deduct(
        12,
        "Missing or carrier-free crossfade transition seam; use a velocity-matched seam.",
      );
      tracker.fixHints.needsMotion = true;
    } else {
      tracker.addStrength(`Velocity-matched ${tIn} -> ${tOut} seams`);
    }

    const speed = Number(f.speedFactor ?? 1);
    if (!Number.isFinite(speed) || speed < 0.4 || speed > 3.0) {
      speedViolationCount += 1;
      score -= 15;
      tracker.deduct(
        16,
        `Speed ramp ${round2(speed)}x is outside sane optical bounds (0.4x..3.0x).`,
      );
      tracker.fixHints.targetSpeed = speed > 3.0 ? 1.25 : 1.0;
    }
  }

  if (frames.length >= 3 && presetSet.size === 1) {
    score -= 12;
  }

  const finalScore = clampScore(score);
  const issues = [];
  if (staticCount > 0) issues.push(`${staticCount} static lockoff(s)`);
  if (repeatedCount > 0) issues.push(`${repeatedCount} repeated adjacent vector(s)`);
  if (badSeamCount > 0) issues.push(`${badSeamCount} weak/crossfade seam(s)`);
  if (speedViolationCount > 0) issues.push(`${speedViolationCount} out-of-bounds speed ramp(s)`);

  const detail =
    issues.length === 0
      ? `Continuous motion verified across ${presetSet.size} distinct camera presets with clean 0.4x..3.0x speed ramps.`
      : `Motion continuity gaps: ${issues.join(", ")}.`;

  return {
    score: finalScore,
    weight: CATEGORY_WEIGHTS.motionContinuity,
    label: "Motion continuity",
    detail,
  };
}

function evaluateSingleSkillSpec(skill, frames, project, projectDir, frameTrackers) {
  const id = String(skill.id || skill.name || "").toLowerCase();
  const fullText = [
    skill.name,
    skill.description,
    ...(skill.ruleHighlights || []),
    skill.content || "",
  ].join("\n");

  let skillScore = 100;
  const issues = [];
  const passedChecks = [];

  if (id === "captions-overlay" || /\bcaptions-overlay\b/i.test(fullText)) {
    let crowdedCount = 0;
    let shiftedUpCount = 0;
    let adjacentEmbeds = 0;

    for (let i = 0; i < frames.length; i += 1) {
      const f = frames[i];
      const cap = String(f.staging?.captionText || "").trim();
      const capWords = countWords(cap);
      if (cap.length > 98 || capWords > 17) {
        crowdedCount += 1;
        skillScore -= 18;
        frameTrackers[i].deduct(
          12,
          `captions-overlay: Caption has ${capWords} words (${cap.length} chars), crowding the bottom overlay line.`,
        );
        const concise =
          cap
            .split(/\s+/)
            .slice(0, 10)
            .join(" ")
            .replace(/[.,;:!?]+$/, "") + ".";
        frameTrackers[i].fixHints.conciseCaption = concise;
      }

      const focusY = Number(f.cameraMotion?.focusY ?? 50);
      if (focusY < 28) {
        shiftedUpCount += 1;
        skillScore -= 14;
        frameTrackers[i].deduct(
          10,
          `captions-overlay: Camera focusY (${focusY}%) shifts composition up for a dead keep-out band instead of true center.`,
        );
        frameTrackers[i].fixHints.needsMotion = true;
      }

      if (
        i > 0 &&
        f.layout === "kinetic-statement-card" &&
        frames[i - 1].layout === "kinetic-statement-card"
      ) {
        adjacentEmbeds += 1;
        skillScore -= 18;
        frameTrackers[i].deduct(
          12,
          "captions-overlay: Two adjacent kinetic statement embeds violate the scarce-embed rule.",
        );
        frameTrackers[i].fixHints.targetLayout = "split-editorial";
      }
    }

    if (crowdedCount === 0 && shiftedUpCount === 0 && adjacentEmbeds === 0) {
      passedChecks.push("captions-overlay: concise overlay rails and true-center framing");
    } else {
      if (crowdedCount > 0) issues.push(`${crowdedCount} overcrowded caption rail(s)`);
      if (shiftedUpCount > 0) issues.push(`${shiftedUpCount} upward keep-out shift(s)`);
      if (adjacentEmbeds > 0) issues.push(`${adjacentEmbeds} adjacent kinetic embed pair(s)`);
    }
  } else if (id === "oversized-cursor" || /\boversized-cursor\b/i.test(fullText)) {
    const hasSpotlightShot = frames.some(
      (f) =>
        f.layout === "spotlight-cursor-zoom" ||
        f.motionPreset === "spotlight-cursor-follow" ||
        f.cameraMotion?.presetId === "spotlight-cursor-follow",
    );
    if (!hasSpotlightShot) {
      skillScore -= 45;
      issues.push("missing interactive cursor/spotlight UI shot");
      const targetIdx = frames.findIndex((f) => f.narrativeBeat === "interaction");
      const pickIdx = targetIdx >= 0 ? targetIdx : frames.length > 1 ? 1 : 0;
      if (frameTrackers[pickIdx]) {
        frameTrackers[pickIdx].deduct(
          22,
          "oversized-cursor: Storyboard lacks an interactive cursor spotlight shot.",
        );
        frameTrackers[pickIdx].fixHints.targetLayout = "spotlight-cursor-zoom";
        frameTrackers[pickIdx].fixHints.targetMotionPreset = "spotlight-cursor-follow";
        frameTrackers[pickIdx].fixHints.targetZoomPct = 150;
      }
    } else {
      passedChecks.push("oversized-cursor: interactive spotlight cursor shot staged");
    }
  } else if (id === "minimalist-ui" || /\bminimalist-ui\b/i.test(fullText)) {
    let loudThemeCount = 0;
    let emojiOrClicheCount = 0;
    const hasStructuredEditorial = frames.some(
      (f) => f.layout === "bento-feature-grid" || f.layout === "split-editorial",
    );

    for (let i = 0; i < frames.length; i += 1) {
      const f = frames[i];
      const theme = f.staging?.theme || "brand-dark";
      if (theme === "gold" || theme === "warm") {
        loudThemeCount += 1;
        skillScore -= 18;
        frameTrackers[i].deduct(
          14,
          `minimalist-ui: "${theme}" theme conflicts with restrained warm-monochrome / alabaster light palette.`,
        );
        frameTrackers[i].fixHints.needsContrastTheme = "alabaster light";
      }

      const copyBlob = [
        f.title,
        f.staging?.headline,
        f.staging?.subheadline,
        f.staging?.badgeText,
        f.staging?.captionText,
      ]
        .filter(Boolean)
        .join(" ");

      if (EMOJI_RE.test(copyBlob) || BANNED_CLICHES_RE.test(copyBlob)) {
        emojiOrClicheCount += 1;
        skillScore -= 22;
        frameTrackers[i].deduct(
          16,
          "minimalist-ui: Copy contains pictographic emojis or banned AI marketing clichés.",
        );
        const cleanedHeadline = stripQuotesAndEmojis(f.staging?.headline || f.title);
        frameTrackers[i].fixHints.cleanHeadline = cleanedHeadline || "Structured Product Overview";
      }
    }

    if (!hasStructuredEditorial) {
      skillScore -= 14;
      issues.push("no bento-feature-grid or split-editorial layout used");
      if (frameTrackers[0] && !frameTrackers[0].fixHints.targetLayout) {
        frameTrackers[0].fixHints.targetLayout = "bento-feature-grid";
      }
    }

    if (loudThemeCount > 0) issues.push(`${loudThemeCount} non-minimalist palette shot(s)`);
    if (emojiOrClicheCount > 0) issues.push(`${emojiOrClicheCount} emoji/cliché violation(s)`);
    if (issues.length === 0) {
      passedChecks.push("minimalist-ui: clean palette restraint, zero emojis, editorial structure");
    }
  } else if (id === "seam-craft" || /\bseam-craft\b/i.test(fullText)) {
    const bgHex = project?.brandColors?.background;
    if (!parseColorRgb(bgHex)) {
      skillScore -= 28;
      issues.push("non-opaque stage background risks white flash at seams");
    }

    if (projectDir) {
      const indexHtmlPath = path.join(projectDir, "index.html");
      if (fs.existsSync(indexHtmlPath)) {
        try {
          const html = fs.readFileSync(indexHtmlPath, "utf8");
          if (!/#root\s*\{[^}]*background/i.test(html) && !/body\s*\{[^}]*background/i.test(html)) {
            skillScore -= 12;
            issues.push("index.html lacks explicit opaque #root/body background");
          }
        } catch {
          // Ignore unreadable index.html
        }
      }
    }

    let invalidSeams = 0;
    for (let i = 0; i < frames.length; i += 1) {
      const cam = frames[i].cameraMotion || {};
      const tIn = String(cam.transitionIn || "").toLowerCase();
      const tOut = String(cam.transitionOut || "").toLowerCase();
      if (!TIER_B_SEAMS.has(tIn) || !TIER_B_SEAMS.has(tOut)) {
        invalidSeams += 1;
        skillScore -= Math.round(32 / frames.length);
        frameTrackers[i].deduct(
          12,
          `seam-craft: Transition pair (${tIn || "none"} / ${tOut || "none"}) is not a verified Tier-B wrapper seam.`,
        );
        frameTrackers[i].fixHints.needsMotion = true;
      }
    }

    if (invalidSeams > 0) {
      issues.push(`${invalidSeams} shot(s) missing Tier-B wrapper transition pairs`);
    }
    if (issues.length === 0) {
      passedChecks.push("seam-craft: opaque stage ground and Tier-B transition pairs verified");
    }
  } else if (id === "motion-doctrine" || id === "cut-the-curve") {
    let violations = 0;
    for (let i = 0; i < frames.length; i += 1) {
      const cam = frames[i].cameraMotion || {};
      if (isFrameCameraStatic(cam)) {
        violations += 1;
        skillScore -= 18;
        frameTrackers[i].deduct(12, `${id}: Shot camera sits static instead of performing.`);
        frameTrackers[i].fixHints.needsMotion = true;
      }
      const tOut = String(cam.transitionOut || "").toLowerCase();
      if (tOut === "crossfade" || !tOut) {
        violations += 1;
        skillScore -= 14;
        frameTrackers[i].deduct(10, `${id}: Crossfade/empty exit lacks a concrete motion carrier.`);
        frameTrackers[i].fixHints.needsMotion = true;
      }
    }
    if (violations > 0) {
      issues.push(`${violations} motion-doctrine vector/carrier violation(s)`);
    } else {
      passedChecks.push(`${id}: continuous camera performance and carrier seams`);
    }
  } else if (id === "signature-reel-style") {
    if (project?.aspectRatio && project.aspectRatio !== "9:16") {
      skillScore -= 18;
      issues.push(`aspect ratio is ${project.aspectRatio} instead of vertical 9:16`);
    }
    for (let i = 0; i < frames.length; i += 1) {
      if (Number(frames[i].durationSeconds || 0) > 5.2) {
        skillScore -= 14;
        issues.push(`Shot ${i + 1} exceeds 5.2s signature beat cadence`);
        frameTrackers[i].deduct(
          10,
          "signature-reel-style: Hold exceeds 5.2s without a fresh beat progression.",
        );
      }
    }
    if (issues.length === 0) {
      passedChecks.push("signature-reel-style: vertical 9:16 high-retention beat cadence");
    }
  } else {
    // Generic dynamic evaluator for any newly installed or custom local SKILL.md!
    const requiredLayouts = LAYOUT_ARCHETYPES.filter((arch) =>
      fullText.toLowerCase().includes(arch),
    );
    if (requiredLayouts.length > 0) {
      const matchedLayout = frames.some((f) => requiredLayouts.includes(f.layout));
      if (!matchedLayout) {
        skillScore -= 24;
        issues.push(`no shot uses skill layout (${requiredLayouts.join(" or ")})`);
        if (frameTrackers[0]) {
          frameTrackers[0].deduct(
            14,
            `${skill.name}: Requires layout archetype ${requiredLayouts[0]}.`,
          );
          frameTrackers[0].fixHints.targetLayout = requiredLayouts[0];
        }
      } else {
        passedChecks.push(`uses ${requiredLayouts[0]} layout`);
      }
    }

    const presetList = Array.isArray(MOTION_PRESETS)
      ? MOTION_PRESETS
      : Object.values(MOTION_PRESETS);
    const requiredPresets = presetList
      .map((p) => p.id)
      .filter((pid) => fullText.toLowerCase().includes(pid));
    if (requiredPresets.length > 0) {
      const matchedPreset = frames.some(
        (f) =>
          requiredPresets.includes(f.motionPreset) ||
          requiredPresets.includes(f.cameraMotion?.presetId),
      );
      if (!matchedPreset) {
        skillScore -= 20;
        issues.push(`no shot uses skill motion preset (${requiredPresets.join(" or ")})`);
        if (frameTrackers[0]) {
          frameTrackers[0].deduct(
            12,
            `${skill.name}: Requires motion preset ${requiredPresets[0]}.`,
          );
          frameTrackers[0].fixHints.targetMotionPreset = requiredPresets[0];
        }
      } else {
        passedChecks.push(`uses ${requiredPresets[0]} motion`);
      }
    }

    const themeCandidates = ["emerald", "gold", "light", "warm", "dark"];
    const explicitTheme = themeCandidates.find((t) =>
      new RegExp(`\\b${t}\\b\\s+theme|\`${t}\`\\s+theme`, "i").test(fullText),
    );
    if (explicitTheme) {
      const hasTheme = frames.some((f) => f.staging?.theme === explicitTheme);
      if (!hasTheme) {
        skillScore -= 18;
        issues.push(`shots do not apply "${explicitTheme}" theme`);
        if (frameTrackers[0]) {
          frameTrackers[0].deduct(
            10,
            `${skill.name}: Recommends "${explicitTheme}" staging theme.`,
          );
          frameTrackers[0].fixHints.needsContrastTheme = explicitTheme;
        }
      } else {
        passedChecks.push(`applies ${explicitTheme} theme`);
      }
    }

    // Parse "DO NOT use '<word>'" or 'Never use "<word>"' negative copy constraints
    const bannedLiterals = [
      ...fullText.matchAll(/(?:do\s+not|never|avoid)\s+use\s+["“'`]([^"”'`]{2,32})["”'`]/gi),
    ].map((m) => m[1].trim());
    for (const banned of bannedLiterals) {
      const escaped = banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "i");
      for (let i = 0; i < frames.length; i += 1) {
        const blob = [
          frames[i].title,
          frames[i].staging?.headline,
          frames[i].staging?.subheadline,
          frames[i].staging?.captionText,
        ]
          .filter(Boolean)
          .join(" ");
        if (re.test(blob)) {
          skillScore -= 18;
          issues.push(`copy contains banned term "${banned}"`);
          frameTrackers[i].deduct(12, `${skill.name}: Copy contains prohibited term "${banned}".`);
        }
      }
    }

    if (/no\s+emoji|zero\s+emoji|do\s+not\s+use\s+emoji/i.test(fullText)) {
      for (let i = 0; i < frames.length; i += 1) {
        const blob = [frames[i].title, frames[i].staging?.headline, frames[i].staging?.captionText]
          .filter(Boolean)
          .join(" ");
        if (EMOJI_RE.test(blob)) {
          skillScore -= 16;
          issues.push(`Shot ${i + 1} contains banned emoji`);
          frameTrackers[i].deduct(12, `${skill.name}: Emoji detected in frame copy.`);
        }
      }
    }

    const maxSecMatch = fullText.match(
      /(?:maximum|max|under|at\s+most|<=)\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?\b/i,
    );
    if (maxSecMatch) {
      const maxSec = Number(maxSecMatch[1]);
      if (Number.isFinite(maxSec) && maxSec >= 1) {
        for (let i = 0; i < frames.length; i += 1) {
          if (Number(frames[i].durationSeconds || 0) > maxSec) {
            skillScore -= 14;
            issues.push(`Shot ${i + 1} exceeds ${maxSec}s custom skill cap`);
            frameTrackers[i].deduct(
              10,
              `${skill.name}: Shot duration (${frames[i].durationSeconds}s) exceeds ${maxSec}s cap.`,
            );
          }
        }
      }
    }

    if (issues.length === 0 && passedChecks.length === 0) {
      passedChecks.push(`${skill.name}: custom skill constraints satisfied`);
    }
  }

  return {
    skillId: skill.id,
    skillName: skill.name || skill.id,
    score: clampScore(skillScore),
    passed: issues.length === 0,
    passedChecks,
    issues,
  };
}

function evaluateSkillAlignment(frames, project, projectDir, skillSpecs, frameTrackers) {
  if (frames.length === 0) {
    return {
      category: {
        score: 0,
        weight: CATEGORY_WEIGHTS.skillAlignment,
        label: "Selected skills",
        detail: "No frames available to audit against local skill directives.",
      },
      skillChecks: [],
    };
  }

  if (!Array.isArray(skillSpecs) || skillSpecs.length === 0) {
    // Baseline HyperFrames craft hygiene when zero optional skills are toggled
    let base = 94;
    const uniqueLayouts = new Set(frames.map((f) => f.layout).filter(Boolean));
    if (frames.length >= 3 && uniqueLayouts.size === 1) {
      base -= 16;
    }
    const crossfadeCount = frames.filter(
      (f) => String(f.cameraMotion?.transitionOut || "").toLowerCase() === "crossfade",
    ).length;
    if (crossfadeCount > 0) {
      base -= Math.min(20, crossfadeCount * 7);
    }
    const finalBase = clampScore(base);
    return {
      category: {
        score: finalBase,
        weight: CATEGORY_WEIGHTS.skillAlignment,
        label: "Selected skills",
        detail: `Baseline HyperFrames craft verified across ${uniqueLayouts.size} layout archetype(s) (select local skills to enforce specialized rules).`,
      },
      skillChecks: [],
    };
  }

  const skillChecks = skillSpecs.map((spec) =>
    evaluateSingleSkillSpec(spec, frames, project, projectDir, frameTrackers),
  );
  const avgSkillScore = clampScore(
    skillChecks.reduce((acc, item) => acc + item.score, 0) / skillChecks.length,
  );
  const failing = skillChecks.filter((c) => !c.passed);

  const detail =
    failing.length === 0
      ? `All ${skillChecks.length} active local skill(s) (${skillChecks.map((s) => s.skillId).join(", ")}) pass compliance checks.`
      : `${failing.length}/${skillChecks.length} active skill(s) flagged gaps: ${failing
          .map((f) => `${f.skillId} (${f.issues.join(", ")})`)
          .join("; ")}.`;

  return {
    category: {
      score: avgSkillScore,
      weight: CATEGORY_WEIGHTS.skillAlignment,
      label: "Selected skills",
      detail,
    },
    skillChecks,
  };
}

function evaluateBrandConsistency(frames, project) {
  let score = 100;
  const notes = [];

  const bc = project?.brandColors || {};
  const validHexCount = ["primary", "secondary", "accent", "background"].filter(
    (k) => parseColorRgb(bc[k]) !== null,
  ).length;
  if (validHexCount < 4) {
    score -= 22;
    notes.push(`${4 - validHexCount} invalid/transparent brand color token(s)`);
  }

  const isUntouchedDefaultColors =
    String(bc.primary || "").toUpperCase() === DEFAULT_BRAND_COLORS.primary &&
    String(bc.secondary || "").toUpperCase() === DEFAULT_BRAND_COLORS.secondary &&
    String(bc.accent || "").toUpperCase() === DEFAULT_BRAND_COLORS.accent &&
    String(bc.background || "").toUpperCase() === DEFAULT_BRAND_COLORS.background;

  const extractedCount = Array.isArray(project?.brandKit?.extractedPalette)
    ? project.brandKit.extractedPalette.length
    : 0;
  if (isUntouchedDefaultColors && extractedCount === 0) {
    score -= 22;
    notes.push("brand colors still on uncustomized stock defaults");
  }

  const hasLogo =
    Boolean(project?.brandKit?.logoRelPath) ||
    (Array.isArray(project?.files?.brand) && project.files.brand.length > 0);
  const hasGuidelines =
    String(project?.brandKit?.guidelinesText || "").trim().length >= 10 ||
    String(project?.brandKit?.guidelinesSummary || "").trim().length >= 10 ||
    String(project?.instructions || "").trim().length >= 15;

  if (!hasLogo && !hasGuidelines) {
    score -= 24;
    notes.push("missing brand logo and brand guidelines/brief");
  } else if (!hasLogo || !hasGuidelines) {
    score -= 6;
  }

  // Language consistency check across frames
  const declaredLang = String(project?.language || "English").toLowerCase();
  const expectsBengali = /bengali|bangla|বাংলা|\bbn\b/i.test(declaredLang);
  if (frames.length > 0) {
    let scriptMismatchShots = 0;
    for (const f of frames) {
      const headline = String(f.staging?.headline || f.title || "");
      const hasBn = BENGALI_CHAR_RE.test(headline);
      const latinWords = headline.match(LATIN_WORD_RE) || [];
      if (!expectsBengali && hasBn && latinWords.length >= 2) {
        scriptMismatchShots += 1;
      }
    }
    if (scriptMismatchShots > 0) {
      score -= Math.min(20, scriptMismatchShots * 12);
      notes.push(`${scriptMismatchShots} shot(s) mix undeclared script in headlines`);
    }
  }

  const finalScore = clampScore(score);
  const detail =
    notes.length === 0
      ? `Brand palette (${extractedCount || 4} swatches), guidelines, and ${project?.language || "English"} copy are consistent.`
      : `Brand consistency notes: ${notes.join("; ")}.`;

  return {
    score: finalScore,
    weight: CATEGORY_WEIGHTS.brandConsistency,
    label: "Brand consistency",
    detail,
  };
}

function evaluateAudioAndCaptions(frames, frameTrackers) {
  if (frames.length === 0) {
    return {
      score: 0,
      weight: CATEGORY_WEIGHTS.audioAndCaptions,
      label: "Audio & captions",
      detail: "No frames available to audit voiceover coverage or words-per-second pacing.",
    };
  }

  let score = 100;
  let coveredCount = 0;
  let rushedCount = 0;
  let maxWps = 0;

  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    const tracker = frameTrackers[i];
    const vo = String(f.audioSpec?.voiceoverText || "").trim();
    const cap = String(f.staging?.captionText || "").trim();
    const spoken = vo || cap;
    const dur = Math.max(0.25, Number(f.durationSeconds || 0));

    if (!spoken && !f.audioSpec?.voiceoverSrc) {
      score -= Math.round(45 / frames.length);
      tracker.deduct(14, "Missing voiceover script and caption text for this shot.");
      tracker.fixHints.needsCaption = true;
    } else {
      coveredCount += 1;
      const words = countWords(vo || cap);
      const wps = round2(words / dur);
      maxWps = Math.max(maxWps, wps);

      if (wps > 3.4) {
        rushedCount += 1;
        const excessPenalty = Math.min(28, Math.round(14 + (wps - 3.4) * 5));
        score -= excessPenalty;
        tracker.deduct(
          18,
          `Voiceover speaking rate is ${wps} words/sec (> 3.4 words/sec limit), which forces rushed atempo narration.`,
        );
        const maxWordsAllowed = Math.max(4, Math.floor(dur * 2.8));
        const trimmedCaption = (vo || cap)
          .split(/\s+/)
          .slice(0, maxWordsAllowed)
          .join(" ")
          .replace(/[.,;:!?]+$/, "");
        tracker.fixHints.conciseCaption = `${trimmedCaption}.`;
      } else if (wps >= 1.2) {
        tracker.addStrength(`Natural ${wps} words/sec narration pace`);
      }
    }
  }

  const sfxCovered = frames.filter(
    (f) => Array.isArray(f.audioSpec?.sfx) && f.audioSpec.sfx.length > 0,
  ).length;
  if (sfxCovered === 0) {
    score -= 8;
  }

  const finalScore = clampScore(score);
  const coveragePct = Math.round((coveredCount / frames.length) * 100);
  const detail =
    rushedCount === 0 && coveredCount === frames.length
      ? `100% voiceover coverage across ${frames.length} shots; peak speaking rate ${round2(maxWps)} words/sec (<= 3.4 wps safe limit).`
      : `VO coverage ${coveragePct}% (${coveredCount}/${frames.length} shots), peak rate ${round2(maxWps)} words/sec${rushedCount > 0 ? ` (${rushedCount} rushed shot(s) > 3.4 wps)` : ""}.`;

  return {
    score: finalScore,
    weight: CATEGORY_WEIGHTS.audioAndCaptions,
    label: "Audio & captions",
    detail,
  };
}

function buildFrameSuggestedFixPrompt(frame, index, prevFrame, tracker) {
  if (tracker.issues.length === 0) return null;

  const hints = tracker.fixHints;
  const parts = [];

  const targetLayout =
    hints.targetLayout ||
    (LAYOUT_ARCHETYPES.includes(frame.layout) ? frame.layout : "device-3d-showcase");
  parts.push(targetLayout);

  if (hints.targetMotionPreset) {
    parts.push(hints.targetMotionPreset);
  } else if (hints.needsMotion || hints.needsRender) {
    const prevPreset = prevFrame?.motionPreset || prevFrame?.cameraMotion?.presetId || null;
    const nextPreset = pickDistinctMotionPreset(index, frame.motionPreset, prevPreset);
    parts.push(nextPreset);
  }

  if (hints.targetZoomPct) {
    parts.push(`zoom ${hints.targetZoomPct}%`);
  } else if (hints.preferHookZoom) {
    parts.push("zoom 148%");
  } else if (hints.needsMotion) {
    parts.push("zoom 134%");
  }

  if (hints.needsContrastTheme) {
    parts.push(hints.needsContrastTheme);
  }

  if (hints.targetSpeed !== undefined) {
    parts.push(`pace ${hints.targetSpeed}x`);
  }

  if (hints.cleanHeadline) {
    parts.push(`headline: "${hints.cleanHeadline}"`);
  } else if (hints.trimHeadline) {
    parts.push(`headline: "${hints.trimHeadline}"`);
  } else if (hints.needsHeadline) {
    const fallbackHeadline =
      stripQuotesAndEmojis(frame.staging?.subheadline || "")
        .split(/\s+/)
        .slice(0, 5)
        .join(" ") || `Featured Highlight ${String(index + 1).padStart(2, "0")}`;
    parts.push(`headline: "${fallbackHeadline}"`);
  }

  if (hints.needsBadge) {
    const beatBadge = String(frame.narrativeBeat || `SHOT ${index + 1}`)
      .replace(/[^a-zA-Z0-9 ]+/g, " ")
      .trim()
      .toUpperCase();
    parts.push(`badge: "${beatBadge || "HIGHLIGHT"}"`);
  }

  if (hints.conciseCaption) {
    parts.push(`caption: "${stripQuotesAndEmojis(hints.conciseCaption)}"`);
  } else if (hints.needsCaption) {
    const fallbackCap =
      stripQuotesAndEmojis(frame.staging?.subheadline || frame.staging?.headline || "") ||
      "Explore verified product highlights in real time.";
    parts.push(`caption: "${fallbackCap}"`);
  }

  return parts.join(" ").trim() || `${targetLayout} crash-zoom-in zoom 135%`;
}

function buildVerdict(overallScore, grade, categories, frameCount) {
  if (frameCount === 0) {
    return "No design frames exist yet — generate storyboard frames in Step 4 before rating video readiness.";
  }

  const entries = Object.entries(categories).sort((a, b) => a[1].score - b[1].score);
  const weakest = entries[0][1];
  const strongest = entries[entries.length - 1][1];

  if (overallScore >= 90) {
    return `Storyboard is export-ready at Grade ${grade} (${overallScore}/100) with standout ${strongest.label.toLowerCase()} across all ${frameCount} frames.`;
  }
  if (overallScore >= 80) {
    return `Storyboard is ready for video generation at Grade ${grade} (${overallScore}/100), with optional 1-click polish available in ${weakest.label.toLowerCase()}.`;
  }
  if (overallScore >= 70) {
    return `Storyboard is a watchable Grade ${grade} draft (${overallScore}/100), but tightening ${weakest.label.toLowerCase()} via 1-click fixes will noticeably elevate final output.`;
  }
  return `Storyboard needs refinement before final MP4 export (Grade ${grade}, ${overallScore}/100) — apply the suggested 1-click frame fixes starting with ${weakest.label.toLowerCase()}.`;
}

/**
 * Reads the most recently persisted rating snapshot from `projects/<slug>/.studio/latest-rating.json`,
 * or returns null if none has been saved yet.
 * @param {string} slug
 */
export function loadLatestVideoRating(slug) {
  const projectDir = assertValidSlug(slug);
  const ratingPath = path.join(projectDir, ".studio", "latest-rating.json");
  if (!fs.existsSync(ratingPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(ratingPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Evaluates deterministic Whole-Video Quality Rating (0..100 + S..C grade + 6 weighted categories
 * + per-frame 1-click fix prompts) before final video export, persisting the snapshot to
 * `projects/<slug>/.studio/latest-rating.json`.
 *
 * @param {object} [options]
 * @param {string | null} [options.slug]
 * @param {object | null} [options.project]
 * @param {object | null} [options.storyboard]
 * @param {Array<object | string>} [options.selectedSkillSpecs]
 */
export async function evaluateProjectVideoRating(options = {}) {
  const rawSlug = options.slug || options.project?.slug || options.storyboard?.slug || null;
  const projectDir = rawSlug ? assertValidSlug(rawSlug) : null;

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
    slug: rawSlug,
    title: storyboard?.title || rawSlug || "Untitled Project",
    aspectRatio: storyboard?.aspectRatio || "9:16",
    durationSeconds: storyboard?.totalDurationSeconds || 24,
    language: "English",
    brandColors: storyboard?.brandColors || { ...DEFAULT_BRAND_COLORS },
    brandKit: { logoRelPath: null, guidelinesText: "", extractedPalette: [] },
    inspirationProfile: storyboard?.inspirationProfile || null,
    instructions: "",
  };

  const frames = Array.isArray(storyboard?.frames) ? storyboard.frames : [];
  const hasExplicitSkillSpecs =
    Object.hasOwn(options, "selectedSkillSpecs") && options.selectedSkillSpecs !== undefined;

  const { skillSpecs } = await resolveSkillSpecs({
    slug: rawSlug,
    projectDir,
    project: effectiveProject,
    storyboard,
    hasExplicitSkillSpecs,
    rawSkillSpecs: options.selectedSkillSpecs,
  });

  const frameTrackers = frames.map((f, idx) => ({
    frameId: f.id || `frame_${String(idx + 1).padStart(2, "0")}`,
    index: Number(f.index || idx + 1),
    title: String(f.title || f.staging?.headline || `Scene ${idx + 1}`),
    locked: Boolean(f.locked),
    rawScore: 100,
    strengths: [],
    issues: [],
    fixHints: {},
    deduct(points, message) {
      this.rawScore -= points;
      if (message && !this.issues.includes(message)) {
        this.issues.push(message);
      }
    },
    addStrength(message) {
      if (message && !this.strengths.includes(message)) {
        this.strengths.push(message);
      }
    },
  }));

  const hookAndPacing = evaluateHookAndPacing(frames, effectiveProject, storyboard, frameTrackers);
  const visualHierarchyAndContrast = evaluateVisualHierarchyAndContrast(
    frames,
    effectiveProject,
    projectDir,
    frameTrackers,
  );
  const motionContinuity = evaluateMotionContinuity(frames, frameTrackers);
  const { category: skillAlignment, skillChecks } = evaluateSkillAlignment(
    frames,
    effectiveProject,
    projectDir,
    skillSpecs,
    frameTrackers,
  );
  const brandConsistency = evaluateBrandConsistency(frames, effectiveProject);
  const audioAndCaptions = evaluateAudioAndCaptions(frames, frameTrackers);

  const categories = {
    hookAndPacing,
    visualHierarchyAndContrast,
    motionContinuity,
    skillAlignment,
    brandConsistency,
    audioAndCaptions,
  };

  const weightedSum =
    hookAndPacing.score * hookAndPacing.weight +
    visualHierarchyAndContrast.score * visualHierarchyAndContrast.weight +
    motionContinuity.score * motionContinuity.weight +
    skillAlignment.score * skillAlignment.weight +
    brandConsistency.score * brandConsistency.weight +
    audioAndCaptions.score * audioAndCaptions.weight;

  const overallScore = frames.length === 0 ? 0 : clampScore(weightedSum);
  const grade = scoreToGrade(overallScore);
  const verdict = buildVerdict(overallScore, grade, categories, frames.length);

  const frameRatings = frameTrackers.map((tracker, idx) => {
    const score = clampScore(tracker.rawScore);
    const prevFrame = idx > 0 ? frames[idx - 1] : null;
    return {
      frameId: tracker.frameId,
      index: tracker.index,
      title: tracker.title,
      score,
      grade: scoreToGrade(score),
      locked: tracker.locked,
      strengths: tracker.strengths,
      issues: tracker.issues,
      suggestedFixPrompt: buildFrameSuggestedFixPrompt(frames[idx], idx, prevFrame, tracker),
    };
  });

  const activeSkillIds = skillSpecs.map((s) => s.id);
  const evaluatedAt = new Date().toISOString();

  const report = {
    slug: rawSlug,
    overallScore,
    grade,
    verdict,
    categories,
    subScores: categories,
    frameRatings,
    activeSkillIds,
    selectedSkills: activeSkillIds,
    skillChecks,
    evaluatedAt,
  };

  if (projectDir) {
    const studioDir = path.join(projectDir, ".studio");
    fs.mkdirSync(studioDir, { recursive: true });
    const outPath = path.join(studioDir, "latest-rating.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  }

  return report;
}

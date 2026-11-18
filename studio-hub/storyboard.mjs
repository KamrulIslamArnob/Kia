import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertValidSlug,
  ensureProjectDirs,
  PROJECTS_DIR,
  ROOT_DIR,
  runCommand,
  getToolEnv,
} from "./lib.mjs";

export const LAYOUT_ARCHETYPES = [
  "device-3d-showcase",
  "split-editorial",
  "fullbleed-cinema",
  "bento-feature-grid",
  "spotlight-cursor-zoom",
  "kinetic-statement-card",
];

const PRESET_DEFINITIONS = [
  {
    id: "crash-zoom-in",
    name: "Crash Zoom In",
    description: "High-velocity optical punch-in locking onto the hero UI action.",
    fromScale: 1.0,
    toScale: 1.85,
    panX: 0,
    panY: -6,
    tiltDeg: 0,
    focusX: 50,
    focusY: 44,
    ease: "expo.out",
    defaultLayout: "device-3d-showcase",
    transitionIn: "zoom-through",
    transitionOut: "cut-the-curve",
  },
  {
    id: "dolly-out-reveal",
    name: "Dolly Out Reveal",
    description: "Starts tight on crisp UI detail and pulls back into full stage context.",
    fromScale: 1.65,
    toScale: 1.0,
    panX: 0,
    panY: 8,
    tiltDeg: 0,
    focusX: 50,
    focusY: 38,
    ease: "power4.out",
    defaultLayout: "fullbleed-cinema",
    transitionIn: "inverse-zoom",
    transitionOut: "whip-pan",
  },
  {
    id: "isometric-3d-tilt",
    name: "Isometric 3D Tilt",
    description: "Dimensional 15-degree perspective rotation with elevated callout cards.",
    fromScale: 1.05,
    toScale: 1.28,
    panX: -6,
    panY: -4,
    tiltDeg: 15,
    focusX: 52,
    focusY: 48,
    ease: "power3.inOut",
    defaultLayout: "device-3d-showcase",
    transitionIn: "rack-focus",
    transitionOut: "cut-the-curve",
  },
  {
    id: "whip-pan-split",
    name: "Whip Pan Split",
    description: "Lateral momentum sweep settling into an asymmetric editorial split.",
    fromScale: 1.12,
    toScale: 1.04,
    panX: -14,
    panY: 0,
    tiltDeg: -3,
    focusX: 36,
    focusY: 50,
    ease: "expo.inOut",
    defaultLayout: "split-editorial",
    transitionIn: "whip-pan",
    transitionOut: "whip-pan",
  },
  {
    id: "spotlight-cursor-follow",
    name: "Spotlight Cursor Follow",
    description: "Dimmed vignette stage tracking pointer click ripple and magnified UI.",
    fromScale: 1.08,
    toScale: 1.55,
    panX: 6,
    panY: 10,
    tiltDeg: 0,
    focusX: 58,
    focusY: 62,
    ease: "power4.inOut",
    defaultLayout: "spotlight-cursor-zoom",
    transitionIn: "rack-focus",
    transitionOut: "zoom-through",
  },
  {
    id: "bento-triptych",
    name: "Bento Triptych",
    description: "Staggered waterfall cascade assembling modular feature bento cards.",
    fromScale: 0.96,
    toScale: 1.06,
    panX: 0,
    panY: -4,
    tiltDeg: 0,
    focusX: 50,
    focusY: 50,
    ease: "power3.out",
    defaultLayout: "bento-feature-grid",
    transitionIn: "waterfall-cut",
    transitionOut: "cut-the-curve",
  },
  {
    id: "editorial-kinetic-card",
    name: "Editorial Kinetic Card",
    description: "High-impact typographic statement lockup with crisp nudge momentum.",
    fromScale: 1.0,
    toScale: 1.14,
    panX: 0,
    panY: -3,
    tiltDeg: 0,
    focusX: 50,
    focusY: 46,
    ease: "expo.out",
    defaultLayout: "kinetic-statement-card",
    transitionIn: "waterfall-cut",
    transitionOut: "zoom-through",
  },
  {
    id: "parallax-float",
    name: "Parallax Float",
    description: "Multi-plane Z-depth glide separating foreground badges from hero glass.",
    fromScale: 1.04,
    toScale: 1.22,
    panX: 5,
    panY: -5,
    tiltDeg: 6,
    focusX: 48,
    focusY: 48,
    ease: "sine.inOut",
    defaultLayout: "device-3d-showcase",
    transitionIn: "cut-the-curve",
    transitionOut: "rack-focus",
  },
];

function buildDualMotionPresets(defs) {
  const arr = defs.map((item) => Object.freeze({ ...item }));
  for (const preset of arr) {
    Object.defineProperty(arr, preset.id, {
      value: preset,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return arr;
}

export const MOTION_PRESETS = buildDualMotionPresets(PRESET_DEFINITIONS);

const NARRATIVE_BEATS = [
  {
    role: "hook",
    badge: "FEATURED LAUNCH",
    headline: "Instant Hook & Hero Offer",
    subheadline: "Capture attention in the first two seconds with bold motion clarity.",
    vo: "Discover a faster, smarter experience built right for your daily workflow.",
    sfx: ["whoosh", "pop"],
  },
  {
    role: "discovery",
    badge: "CURATED CATALOG",
    headline: "Browse Fresh Deals Effortlessly",
    subheadline: "Clean visual hierarchy puts top picks and live savings front and center.",
    vo: "Explore curated categories and real-time offers tailored to what you need.",
    sfx: ["whoosh"],
  },
  {
    role: "feature-grid",
    badge: "SMART CATEGORIES",
    headline: "Modular Bento Feature View",
    subheadline: "Everything organized into crisp, one-tap categories with zero clutter.",
    vo: "Jump straight into verified collections with a single tap.",
    sfx: ["pop"],
  },
  {
    role: "interaction",
    badge: "PRECISION FLOW",
    headline: "One-Tap Cart & Live Controls",
    subheadline: "Responsive touch feedback and clear pricing keep every step transparent.",
    vo: "Adjust quantities and review your cart with instant visual confirmation.",
    sfx: ["pop", "whoosh"],
  },
  {
    role: "speed-ramp",
    badge: "2X EXPRESS CHECKOUT",
    headline: "Zero-Friction Fast Checkout",
    subheadline: "Streamlined address entry turns a long form into seconds.",
    vo: "Complete your details in seconds with our streamlined express form.",
    sfx: ["whoosh"],
  },
  {
    role: "value-proof",
    badge: "VERIFIED VALUE",
    headline: "Transparent Perks & Rewards",
    subheadline: "Unlock free delivery thresholds and instant order confirmation.",
    vo: "Unlock instant delivery perks and confirm your order with confidence.",
    sfx: ["chime", "pop"],
  },
  {
    role: "cta-outro",
    badge: "GET STARTED TODAY",
    headline: "Ready When You Are",
    subheadline: "Download now and experience seamless service from start to finish.",
    vo: "Download the app today and get started in under a minute.",
    sfx: ["chime", "whoosh"],
  },
];

let cachedChromeExecutable = null;

function walkForChromeBinary(dir, targetNames, found = []) {
  if (!dir || !fs.existsSync(dir)) return found;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkForChromeBinary(full, targetNames, found);
    } else if (entry.isFile() && targetNames.has(entry.name.toLowerCase())) {
      found.push(full);
    }
  }
  return found;
}

export function resolveChromeHeadlessShell() {
  if (cachedChromeExecutable && fs.existsSync(cachedChromeExecutable)) {
    return cachedChromeExecutable;
  }
  if (process.env.CHROME_HEADLESS_SHELL && fs.existsSync(process.env.CHROME_HEADLESS_SHELL)) {
    cachedChromeExecutable = process.env.CHROME_HEADLESS_SHELL;
    return cachedChromeExecutable;
  }

  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  const cacheRoot = path.join(userProfile, ".cache", "hyperframes", "chrome");
  const targetNames =
    process.platform === "win32"
      ? new Set(["chrome-headless-shell.exe", "chrome.exe"])
      : new Set(["chrome-headless-shell", "google-chrome", "chromium"]);

  const matches = walkForChromeBinary(cacheRoot, targetNames);
  if (matches.length > 0) {
    matches.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
    cachedChromeExecutable = matches[0];
    return cachedChromeExecutable;
  }

  const systemFallbacks =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
          ];
  for (const candidate of systemFallbacks) {
    if (fs.existsSync(candidate)) {
      cachedChromeExecutable = candidate;
      return cachedChromeExecutable;
    }
  }
  return null;
}

function escapeHtml(val) {
  return String(val ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

function formatScale(num) {
  const n = Number(num || 1);
  if (Number.isInteger(n)) return `${n.toFixed(1)}x`;
  return `${Number(n.toFixed(2))}x`;
}

function formatTimecode(sec) {
  const s = Math.max(0, Number(sec || 0));
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  return `${String(mins).padStart(2, "0")}:${rem.toFixed(1).padStart(4, "0")}`;
}

export function getMotionPreset(id) {
  if (id && MOTION_PRESETS[id]) return MOTION_PRESETS[id];
  return MOTION_PRESETS[0];
}

function buildCameraMotionFromPreset(presetId, overrides = {}) {
  const preset = getMotionPreset(presetId);
  return {
    presetId: preset.id,
    label: preset.name,
    fromScale: overrides.fromScale ?? preset.fromScale,
    toScale: overrides.toScale ?? preset.toScale,
    panX: overrides.panX ?? preset.panX,
    panY: overrides.panY ?? preset.panY,
    tiltDeg: overrides.tiltDeg ?? preset.tiltDeg,
    focusX: overrides.focusX ?? preset.focusX,
    focusY: overrides.focusY ?? preset.focusY,
    ease: overrides.ease ?? preset.ease,
    transitionIn: overrides.transitionIn ?? preset.transitionIn,
    transitionOut: overrides.transitionOut ?? preset.transitionOut,
  };
}

function resolveThemePalette(theme, brandColors = {}) {
  const primary = brandColors?.primary || "#1E824C";
  const secondary = brandColors?.secondary || "#2ECC71";
  const accent = brandColors?.accent || "#F1C40F";
  const baseBg = brandColors?.background || "#0A1612";

  switch (theme) {
    case "light":
      return {
        theme: "light",
        primary,
        secondary,
        accent: accent === "#F1C40F" ? "#D97706" : accent,
        background: "#F4F7FA",
        surface: "#FFFFFF",
        surfaceAlt: "#E8EEF5",
        text: "#0B1324",
        mutedText: "#475569",
        badgeBg: primary,
        badgeText: "#FFFFFF",
        border: "rgba(15, 23, 42, 0.14)",
        glowA: primary,
        glowB: secondary,
      };
    case "gold":
      return {
        theme: "gold",
        primary: "#D97706",
        secondary: "#FBBF24",
        accent: "#FDE047",
        background: "#120E06",
        surface: "#1F180B",
        surfaceAlt: "#2B210E",
        text: "#FFFBEB",
        mutedText: "#FDE68A",
        badgeBg: "#F59E0B",
        badgeText: "#120E06",
        border: "rgba(251, 191, 36, 0.34)",
        glowA: "#F59E0B",
        glowB: "#B45309",
      };
    case "emerald":
      return {
        theme: "emerald",
        primary: "#059669",
        secondary: "#34D399",
        accent: "#A7F3D0",
        background: "#051811",
        surface: "#0B291E",
        surfaceAlt: "#11382A",
        text: "#ECFDF5",
        mutedText: "#A7F3D0",
        badgeBg: "#10B981",
        badgeText: "#04130D",
        border: "rgba(52, 211, 153, 0.32)",
        glowA: "#10B981",
        glowB: "#047857",
      };
    case "warm":
      return {
        theme: "warm",
        primary: "#EA580C",
        secondary: "#FB923C",
        accent: "#FACC15",
        background: "#1A0F0A",
        surface: "#2A1710",
        surfaceAlt: "#381F15",
        text: "#FFF7ED",
        mutedText: "#FED7AA",
        badgeBg: "#F97316",
        badgeText: "#1A0F0A",
        border: "rgba(251, 146, 60, 0.32)",
        glowA: "#EA580C",
        glowB: "#F59E0B",
      };
    case "dark":
      return {
        theme: "dark",
        primary,
        secondary,
        accent,
        background: "#070B12",
        surface: "#101826",
        surfaceAlt: "#172236",
        text: "#F8FAFC",
        mutedText: "#94A3B8",
        badgeBg: primary,
        badgeText: "#FFFFFF",
        border: "rgba(148, 163, 184, 0.24)",
        glowA: primary,
        glowB: "#2563EB",
      };
    default:
      return {
        theme: "brand-dark",
        primary,
        secondary,
        accent,
        background: baseBg,
        surface: "#10231C",
        surfaceAlt: "#163026",
        text: "#F8FAFC",
        mutedText: "#CBD5E1",
        badgeBg: accent,
        badgeText: "#0A1612",
        border: "rgba(255, 255, 255, 0.18)",
        glowA: primary,
        glowB: secondary,
      };
  }
}

export function parseFramePrompt(prompt = "") {
  const raw = String(prompt || "").trim();
  if (!raw) return {};

  const result = {
    camera: {},
    staging: {},
  };

  // 1. Extract quoted strings first so quoted words don't accidentally trigger layout/speed keywords
  let unquoted = raw;
  const badgeExplicit = raw.match(/badge(?:\s+text)?\s*[:=]?\s*["“'‘]([^"”'’]+)["”'’]/i);
  if (badgeExplicit) {
    result.staging.badgeText = badgeExplicit[1].trim();
    unquoted = unquoted.replace(badgeExplicit[0], " ");
  }
  const badgeTrailing = unquoted.match(/["“'‘]([^"”'’]+)["”'’]\s*badge\b/i);
  if (!result.staging.badgeText && badgeTrailing) {
    result.staging.badgeText = badgeTrailing[1].trim();
    unquoted = unquoted.replace(badgeTrailing[0], " ");
  }

  const headlineExplicit = unquoted.match(
    /(?:headline|title)(?:\s+text)?\s*[:=]?\s*["“'‘]([^"”'’]+)["”'’]/i,
  );
  if (headlineExplicit) {
    result.staging.headline = headlineExplicit[1].trim();
    unquoted = unquoted.replace(headlineExplicit[0], " ");
  }

  const subExplicit = unquoted.match(
    /(?:subheadline|subtitle|subline)\s*[:=]?\s*["“'‘]([^"”'’]+)["”'’]/i,
  );
  if (subExplicit) {
    result.staging.subheadline = subExplicit[1].trim();
    unquoted = unquoted.replace(subExplicit[0], " ");
  }

  const captionExplicit = unquoted.match(/caption\s*[:=]?\s*["“'‘]([^"”'’]+)["”'’]/i);
  if (captionExplicit) {
    result.staging.captionText = captionExplicit[1].trim();
    unquoted = unquoted.replace(captionExplicit[0], " ");
  }

  const remainingQuotes = [...unquoted.matchAll(/["“]([^"”]+)["”]|'([^']+)'/g)]
    .map((m) => (m[1] || m[2] || "").trim())
    .filter(Boolean);
  if (remainingQuotes.length > 0) {
    if (!result.staging.headline) {
      result.staging.headline = remainingQuotes[0];
    } else if (!result.staging.badgeText) {
      result.staging.badgeText = remainingQuotes[0];
    }
    if (remainingQuotes.length > 1 && !result.staging.subheadline) {
      result.staging.subheadline = remainingQuotes[1];
    }
    unquoted = unquoted.replace(/["“][^"”]+["”]|'[^']+'/g, " ");
  }

  // 2. Speed cues (parse before generic Nx zoom cues)
  const speedPre = unquoted.match(
    /\b(?:speed(?:\s*ramp)?|playback|pace)\s*(?:to\s*|at\s*)?(\d+(?:\.\d+)?)\s*x\b/i,
  );
  const speedPost = unquoted.match(/\b(\d+(?:\.\d+)?)\s*x\s*(?:speed|faster|pace)\b/i);
  if (speedPre) {
    result.speedFactor = clamp(Number(speedPre[1]), 0.25, 4);
    unquoted = unquoted.replace(speedPre[0], " ");
  } else if (speedPost) {
    result.speedFactor = clamp(Number(speedPost[1]), 0.25, 4);
    unquoted = unquoted.replace(speedPost[0], " ");
  } else if (/\bslow(?:[-\s]?mo(?:tion)?)?\b|\bhalf[-\s]?speed\b/i.test(unquoted)) {
    result.speedFactor = 0.5;
  }

  // 3. Zoom percentage & multiplier cues
  const zoomPct = unquoted.match(/(?:zoom(?:\s+in|\s+to)?\s*)?(\d{2,3})\s*%/i);
  if (zoomPct) {
    result.camera.toScale = round2(clamp(Number(zoomPct[1]) / 100, 0.5, 3.5));
  } else {
    const zoomMultPre = unquoted.match(
      /\b(?:zoom(?:\s+in|\s+to)?|scale|magnif\w*)\s*(?:to\s*|by\s*)?(\d+(?:\.\d+)?)\s*x\b/i,
    );
    const zoomMultPost = unquoted.match(
      /\b(\d+(?:\.\d+)?)\s*x\s*(?:zoom|scale|closer|punch|magnif\w*)\b/i,
    );
    const standaloneMult = unquoted.match(/\b([1-3](?:\.\d+)?)\s*x\b/i);
    if (zoomMultPre) {
      result.camera.toScale = round2(clamp(Number(zoomMultPre[1]), 0.5, 3.5));
    } else if (zoomMultPost) {
      result.camera.toScale = round2(clamp(Number(zoomMultPost[1]), 0.5, 3.5));
    } else if (standaloneMult) {
      result.camera.toScale = round2(clamp(Number(standaloneMult[1]), 0.5, 3.5));
    } else if (/\bdolly[-\s]?out\b|\bzoom[-\s]?out\b|\bpull[-\s]?back\b/i.test(unquoted)) {
      result.camera.fromScale = 1.65;
      result.camera.toScale = 1.0;
    }
  }

  // 4. Pan & Tilt directional cues
  if (/\b(?:pan|slide|move|shift)\s+left\b|\bleft\s+pan\b/i.test(unquoted)) {
    result.camera.panX = -14;
    result.camera.focusX = 36;
  } else if (/\b(?:pan|slide|move|shift)\s+right\b|\bright\s+pan\b/i.test(unquoted)) {
    result.camera.panX = 14;
    result.camera.focusX = 64;
  }

  if (/\b(?:pan|slide|move|scroll)\s+up\b/i.test(unquoted)) {
    result.camera.panY = -12;
    result.camera.focusY = 34;
  } else if (/\b(?:pan|slide|move|scroll)\s+down\b/i.test(unquoted)) {
    result.camera.panY = 12;
    result.camera.focusY = 66;
  }

  const tiltDegMatch =
    unquoted.match(/\btilt(?:ed)?\s*(?:by\s*)?(-?\d+(?:\.\d+)?)\s*(?:deg|°)?\b/i) ||
    unquoted.match(/(-?\d+(?:\.\d+)?)\s*(?:deg|°)\s*(?:isometric\s*)?tilt\b/i);
  if (tiltDegMatch) {
    result.camera.tiltDeg = clamp(Number(tiltDegMatch[1]), -35, 35);
  } else if (/\btilt\s+left\b/i.test(unquoted)) {
    result.camera.tiltDeg = -15;
  } else if (/\btilt\s+right\b|\bisometric\b/i.test(unquoted)) {
    result.camera.tiltDeg = 15;
  } else if (/\btilt\s+up\b/i.test(unquoted)) {
    result.camera.tiltDeg = 10;
    result.camera.panY = result.camera.panY ?? -10;
  } else if (/\btilt\s+down\b/i.test(unquoted)) {
    result.camera.tiltDeg = -10;
    result.camera.panY = result.camera.panY ?? 10;
  }

  // 5. Motion preset keywords
  for (const preset of MOTION_PRESETS) {
    if (unquoted.toLowerCase().includes(preset.id)) {
      result.motionPreset = preset.id;
      break;
    }
  }
  if (!result.motionPreset) {
    if (/\bcrash[-\s]?zoom\b|\bpunch[-\s]?in\b/i.test(unquoted)) {
      result.motionPreset = "crash-zoom-in";
    } else if (/\bdolly[-\s]?out\b|\bpull[-\s]?back\b|\bzoom[-\s]?out\b/i.test(unquoted)) {
      result.motionPreset = "dolly-out-reveal";
    } else if (/\bisometric\b|\b3d[-\s]?tilt\b/i.test(unquoted)) {
      result.motionPreset = "isometric-3d-tilt";
    } else if (/\bwhip[-\s]?pan\b/i.test(unquoted)) {
      result.motionPreset = "whip-pan-split";
    } else if (/\bcursor[-\s]?follow\b|\bspotlight\b/i.test(unquoted)) {
      result.motionPreset = "spotlight-cursor-follow";
    } else if (/\btriptych\b|\bbento[-\s]?triptych\b/i.test(unquoted)) {
      result.motionPreset = "bento-triptych";
    } else if (/\bkinetic[-\s]?card\b|\beditorial[-\s]?kinetic\b/i.test(unquoted)) {
      result.motionPreset = "editorial-kinetic-card";
    } else if (/\bparallax\b|\bfloat(?:ing)?\b/i.test(unquoted)) {
      result.motionPreset = "parallax-float";
    }
  }

  // 6. Layout archetype keywords
  for (const arch of LAYOUT_ARCHETYPES) {
    if (unquoted.toLowerCase().includes(arch)) {
      result.layout = arch;
      break;
    }
  }
  if (!result.layout) {
    if (/\bbento\b|\bfeature[-\s]?grid\b|\btriptych\b/i.test(unquoted)) {
      result.layout = "bento-feature-grid";
    } else if (/\bsplit\b|\bside[-\s]?by[-\s]?side\b/i.test(unquoted)) {
      result.layout = "split-editorial";
    } else if (/\bfull[-\s]?bleed\b|\bcinema(?:tic)?\b|\bfullscreen\b/i.test(unquoted)) {
      result.layout = "fullbleed-cinema";
    } else if (/\bspotlight\b|\bcursor\b|\bmagnif/i.test(unquoted)) {
      result.layout = "spotlight-cursor-zoom";
    } else if (/\b3d\b|\bdevice\b|\bphone\b|\bmockup\b/i.test(unquoted)) {
      result.layout = "device-3d-showcase";
    } else if (/\bkinetic\b|\bstatement\b|\bcard\b/i.test(unquoted)) {
      result.layout = "kinetic-statement-card";
    }
  }

  // 7. Theme shifts
  if (/\blight\b|\balabaster\b|\bdaylight\b/i.test(unquoted)) {
    result.staging.theme = "light";
  } else if (/\bgold(?:en)?\b|\bluxury\b/i.test(unquoted)) {
    result.staging.theme = "gold";
  } else if (/\bemerald\b|\bforest\b/i.test(unquoted)) {
    result.staging.theme = "emerald";
  } else if (/\bwarm\b|\bsunset\b|\bamber\b/i.test(unquoted)) {
    result.staging.theme = "warm";
  } else if (/\bdark\b|\bobsidian\b|\bmidnight\b/i.test(unquoted)) {
    result.staging.theme = "dark";
  }

  // 8. Background plate directive
  const plateMatch = raw.match(
    /(?:aiBackgroundPlate|background[-\s]?plate|bg[-\s]?plate)\s*[:=]\s*([^\s,;]+)/i,
  );
  if (plateMatch) {
    result.aiBackgroundPlate = plateMatch[1].trim();
  }

  return result;
}

function createDefaultAssetResolver(slug) {
  const baseDir = slug ? path.join(PROJECTS_DIR, slug) : ROOT_DIR;
  return (relOrAbs) => {
    if (!relOrAbs || typeof relOrAbs !== "string") return null;
    if (
      relOrAbs.startsWith("file://") ||
      relOrAbs.startsWith("data:") ||
      relOrAbs.startsWith("http://") ||
      relOrAbs.startsWith("https://")
    ) {
      return relOrAbs;
    }
    const cleaned = relOrAbs.replace(/^\/+/, "");
    const abs = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(baseDir, cleaned);
    if (fs.existsSync(abs)) {
      return pathToFileURL(abs).href;
    }
    return null;
  };
}

function renderMediaSurfaceHtml(imgUrl, fallbackTitle, palette, extraStyle = "") {
  if (imgUrl) {
    return `<img class="media-img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(fallbackTitle)}" style="${extraStyle}" />`;
  }
  return `
    <div class="synthetic-screen" style="${extraStyle}">
      <div class="syn-topbar">
        <span class="syn-dot" style="background:${palette.accent}"></span>
        <span class="syn-dot" style="background:${palette.secondary}"></span>
        <span class="syn-pill">LIVE PREVIEW</span>
      </div>
      <div class="syn-hero-card" style="background:linear-gradient(135deg, ${palette.primary}, ${palette.secondary});">
        <div class="syn-kicker">ACTIVE SCENE</div>
        <div class="syn-card-title">${escapeHtml(fallbackTitle)}</div>
      </div>
      <div class="syn-grid">
        <div class="syn-cell">
          <div class="syn-bar" style="width:68%;background:${palette.accent}"></div>
          <div class="syn-bar muted" style="width:88%"></div>
          <div class="syn-bar muted" style="width:52%"></div>
        </div>
        <div class="syn-cell">
          <div class="syn-bar" style="width:54%;background:${palette.secondary}"></div>
          <div class="syn-bar muted" style="width:80%"></div>
          <div class="syn-bar muted" style="width:62%"></div>
        </div>
      </div>
    </div>
  `;
}

function renderArchetypeStageHtml(frame, brief, palette, resolvedAssets) {
  const layout = LAYOUT_ARCHETYPES.includes(frame.layout) ? frame.layout : "device-3d-showcase";
  const st = frame.staging || {};
  const cam = frame.cameraMotion || buildCameraMotionFromPreset(frame.motionPreset);
  const headline = st.headline || frame.title || brief?.title || "Scene Highlight";
  const subheadline =
    st.subheadline || "Precision-crafted motion beat engineered for instant viewer retention.";
  const badgeText = st.badgeText || `SHOT ${String(frame.index || 1).padStart(2, "0")}`;
  const captionText = st.captionText || frame.audioSpec?.voiceoverText || subheadline;
  const ctaText = st.ctaText || "Explore Now";
  const callouts =
    Array.isArray(st.calloutItems) && st.calloutItems.length >= 2
      ? st.calloutItems
      : [
          { label: "MOTION", value: cam.label || frame.motionPreset || "Dynamic" },
          {
            label: "PACE",
            value: `${round2(frame.speedFactor || 1)}x · ${round2(frame.durationSeconds || 4)}s`,
          },
          {
            label: "FOCUS",
            value: `${Math.round(cam.focusX ?? 50)}% / ${Math.round(cam.focusY ?? 50)}%`,
          },
        ];

  const primaryImg = resolvedAssets.peak || resolvedAssets.start || resolvedAssets.bgPlate;
  const startImg = resolvedAssets.start || primaryImg;
  const endImg = resolvedAssets.end || primaryImg;

  const tiltY = clamp((cam.tiltDeg || 0) * -0.75, -22, 22);
  const tiltX = clamp((cam.tiltDeg || 0) * 0.35, -14, 14);

  if (layout === "split-editorial") {
    return `
      <div class="stage layout-split-editorial" data-layout="split-editorial">
        <div class="split-copy-pane">
          <div class="eyebrow-row">
            <span class="shot-num">${String(frame.index || 1).padStart(2, "0")}</span>
            <span class="badge-pill">${escapeHtml(badgeText)}</span>
          </div>
          <h1 class="hero-headline">${escapeHtml(headline)}</h1>
          <p class="hero-subheadline">${escapeHtml(subheadline)}</p>
          <div class="split-metrics">
            ${callouts
              .slice(0, 2)
              .map(
                (c) => `
              <div class="glass-card metric-card">
                <div class="metric-label">${escapeHtml(c.label)}</div>
                <div class="metric-value">${escapeHtml(c.value)}</div>
              </div>`,
              )
              .join("")}
          </div>
        </div>
        <div class="split-media-pane">
          <div class="architectural-frame">
            ${renderMediaSurfaceHtml(primaryImg, headline, palette)}
            <div class="floating-chip">${escapeHtml(ctaText)} →</div>
          </div>
        </div>
        <div class="caption-rail"><span>${escapeHtml(captionText)}</span></div>
      </div>
    `;
  }

  if (layout === "fullbleed-cinema") {
    const mediaScale = clamp(cam.toScale || 1.12, 1.0, 2.1);
    return `
      <div class="stage layout-fullbleed-cinema" data-layout="fullbleed-cinema">
        <div class="cinema-backdrop" style="transform: scale(${mediaScale.toFixed(2)}) translate(${(cam.panX || 0) * 0.35}%, ${(cam.panY || 0) * 0.35}%);">
          ${renderMediaSurfaceHtml(resolvedAssets.bgPlate || primaryImg, headline, palette)}
        </div>
        <div class="cinema-scrim"></div>
        <div class="cinema-topbar">
          <span class="badge-pill">${escapeHtml(badgeText)}</span>
          <span class="cinema-tag">${escapeHtml(brief?.title || "STUDIO FILM")}</span>
        </div>
        <div class="cinema-lower-third">
          <div class="accent-rule"></div>
          <h1 class="hero-headline cinema-title">${escapeHtml(headline)}</h1>
          <p class="hero-subheadline cinema-sub">${escapeHtml(subheadline)}</p>
          <div class="callout-strip">
            ${callouts
              .slice(0, 3)
              .map(
                (c) =>
                  `<div class="glass-pill"><strong>${escapeHtml(c.label)}:</strong> ${escapeHtml(c.value)}</div>`,
              )
              .join("")}
          </div>
        </div>
        <div class="caption-rail"><span>${escapeHtml(captionText)}</span></div>
      </div>
    `;
  }

  if (layout === "bento-feature-grid") {
    return `
      <div class="stage layout-bento-feature-grid" data-layout="bento-feature-grid">
        <div class="bento-header">
          <span class="badge-pill">${escapeHtml(badgeText)}</span>
          <h1 class="hero-headline bento-title">${escapeHtml(headline)}</h1>
          <p class="hero-subheadline">${escapeHtml(subheadline)}</p>
        </div>
        <div class="bento-grid">
          <div class="bento-cell bento-hero">
            ${renderMediaSurfaceHtml(primaryImg, headline, palette)}
            <div class="bento-overlay-label">${escapeHtml(callouts[0]?.value || "Featured View")}</div>
          </div>
          <div class="bento-cell bento-sub">
            <div class="bento-mini-media">${renderMediaSurfaceHtml(startImg, "Entry Beat", palette)}</div>
            <div class="bento-stat-title">${escapeHtml(callouts[1]?.label || "HIGHLIGHT")}</div>
            <div class="bento-stat-val">${escapeHtml(callouts[1]?.value || "Verified Quality")}</div>
          </div>
          <div class="bento-cell bento-accent-card">
            <div class="bento-mini-media">${renderMediaSurfaceHtml(endImg, "Peak Action", palette)}</div>
            <div class="bento-stat-title">${escapeHtml(callouts[2]?.label || "OUTCOME")}</div>
            <div class="bento-stat-val">${escapeHtml(callouts[2]?.value || ctaText)}</div>
          </div>
        </div>
        <div class="caption-rail"><span>${escapeHtml(captionText)}</span></div>
      </div>
    `;
  }

  if (layout === "spotlight-cursor-zoom") {
    const cx = clamp(st.cursorTarget?.x ?? cam.focusX ?? 56, 22, 78);
    const cy = clamp(st.cursorTarget?.y ?? cam.focusY ?? 58, 28, 76);
    return `
      <div class="stage layout-spotlight-cursor-zoom" data-layout="spotlight-cursor-zoom">
        <div class="spotlight-header">
          <span class="badge-pill">${escapeHtml(badgeText)}</span>
          <h1 class="hero-headline">${escapeHtml(headline)}</h1>
        </div>
        <div class="spotlight-viewport">
          <div class="spotlight-base-media">
            ${renderMediaSurfaceHtml(primaryImg, headline, palette)}
          </div>
          <div class="spotlight-dim" style="background: radial-gradient(circle at ${cx}% ${cy}%, rgba(0,0,0,0.02) 0%, rgba(4,9,14,0.78) 54%);"></div>
          <div class="spotlight-loupe" style="left:${cx}%; top:${cy}%;">
            <div class="loupe-inner">
              ${renderMediaSurfaceHtml(primaryImg, headline, palette, "transform: scale(1.65);")}
            </div>
            <div class="loupe-ring"></div>
            <div class="loupe-ripple"></div>
            <svg class="cursor-svg" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M12 8 L12 50 L24 39 L33 56 L41 52 L32 35 L48 35 Z" fill="#FFFFFF" stroke="#090D16" stroke-width="4" stroke-linejoin="round" />
            </svg>
          </div>
          <div class="glass-card spotlight-callout">
            <div class="metric-label">${escapeHtml(callouts[0]?.label || "INTERACTION")}</div>
            <div class="metric-value">${escapeHtml(subheadline)}</div>
          </div>
        </div>
        <div class="caption-rail"><span>${escapeHtml(captionText)}</span></div>
      </div>
    `;
  }

  if (layout === "kinetic-statement-card") {
    return `
      <div class="stage layout-kinetic-statement-card" data-layout="kinetic-statement-card">
        <div class="kinetic-poster">
          <div class="corner-mark tl"></div>
          <div class="corner-mark tr"></div>
          <div class="corner-mark bl"></div>
          <div class="corner-mark br"></div>
          <span class="badge-pill">${escapeHtml(badgeText)}</span>
          <h1 class="kinetic-display">${escapeHtml(headline)}</h1>
          <div class="kinetic-divider"></div>
          <p class="hero-subheadline kinetic-sub">${escapeHtml(subheadline)}</p>
          <div class="kinetic-preview-row">
            <div class="kinetic-thumb">${renderMediaSurfaceHtml(primaryImg, headline, palette)}</div>
            <div class="kinetic-cta-box">
              <div class="metric-label">${escapeHtml(brief?.title || "FEATURE")}</div>
              <div class="kinetic-cta-pill">${escapeHtml(ctaText)} →</div>
            </div>
          </div>
        </div>
        <div class="caption-rail"><span>${escapeHtml(captionText)}</span></div>
      </div>
    `;
  }

  // Default: device-3d-showcase
  return `
    <div class="stage layout-device-3d-showcase" data-layout="device-3d-showcase">
      <div class="device-copy-top">
        <span class="badge-pill">${escapeHtml(badgeText)}</span>
        <h1 class="hero-headline">${escapeHtml(headline)}</h1>
        <p class="hero-subheadline">${escapeHtml(subheadline)}</p>
      </div>
      <div class="device-stage-center">
        <div class="device-halo"></div>
        <div class="phone-3d-chassis" style="transform: perspective(1500px) rotateY(${tiltY.toFixed(1)}deg) rotateX(${tiltX.toFixed(1)}deg);">
          <div class="phone-island"></div>
          <div class="phone-screen">
            ${renderMediaSurfaceHtml(primaryImg, headline, palette)}
          </div>
        </div>
        <div class="glass-card floating-callout left-callout">
          <div class="metric-label">${escapeHtml(callouts[0]?.label || "HIGHLIGHT")}</div>
          <div class="metric-value">${escapeHtml(callouts[0]?.value || badgeText)}</div>
        </div>
        <div class="glass-card floating-callout right-callout">
          <div class="metric-label">${escapeHtml(callouts[1]?.label || "SPEED")}</div>
          <div class="metric-value">${escapeHtml(callouts[1]?.value || ctaText)}</div>
        </div>
      </div>
      <div class="caption-rail"><span>${escapeHtml(captionText)}</span></div>
    </div>
  `;
}

function renderBlueprintHudOverlayHtml(frame, width, height, resolvedAssets) {
  const cam = frame.cameraMotion || buildCameraMotionFromPreset(frame.motionPreset);
  const fx = clamp(Number(cam.focusX ?? 50), 14, 86);
  const fy = clamp(Number(cam.focusY ?? 46), 16, 80);

  const startX = Math.round(width * 0.5 - (cam.panX || 0) * (width * 0.012));
  const startY = Math.round(height * 0.5 - (cam.panY || 0) * (height * 0.009));
  const targetX = Math.round((fx / 100) * width);
  const targetY = Math.round((fy / 100) * height);

  // Ensure trajectory arrow always has clear visible vector length (~180px+)
  const dx = targetX - startX;
  const dy = targetY - startY;
  const dist = Math.hypot(dx, dy);
  const minVecLen = Math.round(Math.min(width, height) * 0.19);
  let vecStartX = startX;
  let vecStartY = startY;
  if (dist < 20) {
    vecStartX = Math.round(targetX - width * 0.16);
    vecStartY = Math.round(targetY + height * 0.11);
  } else if (dist < minVecLen) {
    const scaleFactor = minVecLen / dist;
    vecStartX = Math.round(targetX - dx * scaleFactor);
    vecStartY = Math.round(targetY - dy * scaleFactor);
  }

  const toScaleNum = Number(cam.toScale || 1.25);
  const cropW = Math.round(clamp(width / Math.max(1.05, toScaleNum), width * 0.28, width * 0.82));
  const cropH = Math.round(
    clamp(height / Math.max(1.05, toScaleNum), height * 0.24, height * 0.72),
  );
  const cropX = Math.round(clamp(targetX - cropW / 2, width * 0.06, width * 0.94 - cropW));
  const cropY = Math.round(clamp(targetY - cropH / 2, height * 0.08, height * 0.84 - cropH));

  const zoomReticleLabel = `${formatScale(cam.fromScale ?? 1.0)} → ${formatScale(cam.toScale ?? 1.85)} · ${cam.ease || "expo.out"}`;
  const range = Array.isArray(frame.rawTimeRange)
    ? frame.rawTimeRange
    : [0, frame.durationSeconds || 4];
  const tcLabel = `TC ${formatTimecode(range[0])} → ${formatTimecode(range[1])} (${round2(frame.durationSeconds || 4)}s)`;
  const speedLabel = `SPEED ${round2(frame.speedFactor || 1).toFixed(1)}x`;
  const transIn = (cam.transitionIn || "zoom-through").toUpperCase();
  const transOut = (cam.transitionOut || "cut-the-curve").toUpperCase();
  const voText = frame.audioSpec?.voiceoverText || "Instrumental / visual beat";
  const sfxList =
    Array.isArray(frame.audioSpec?.sfx) && frame.audioSpec.sfx.length > 0
      ? frame.audioSpec.sfx.map((s) => String(s).toUpperCase()).join(" · ")
      : "AMBIENT";

  const kfItems = [
    { tag: "START", src: resolvedAssets.start, t: formatTimecode(range[0]) },
    {
      tag: "PEAK",
      src: resolvedAssets.peak || resolvedAssets.start,
      t: formatTimecode((Number(range[0] || 0) + Number(range[1] || 0)) / 2),
    },
    { tag: "END", src: resolvedAssets.end || resolvedAssets.peak, t: formatTimecode(range[1]) },
  ];

  return `
    <div class="hud-layer" data-hud="true">
      <svg class="hud-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
        <defs>
          <marker id="hud-arrow" markerWidth="14" markerHeight="14" refX="11" refY="7" orient="auto">
            <path d="M 1 1 L 12 7 L 1 13 z" fill="#38BDF8" />
          </marker>
        </defs>
        <!-- 90% Action-Safe & 80% Title-Safe Guides -->
        <rect x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.05)}" width="${Math.round(width * 0.9)}" height="${Math.round(height * 0.9)}" fill="none" stroke="rgba(56,189,248,0.28)" stroke-width="2" stroke-dasharray="12 10" />
        <rect x="${Math.round(width * 0.1)}" y="${Math.round(height * 0.1)}" width="${Math.round(width * 0.8)}" height="${Math.round(height * 0.8)}" fill="none" stroke="rgba(250,204,21,0.22)" stroke-width="1.5" stroke-dasharray="6 8" />

        <!-- Target Zoom Crop Box -->
        <rect x="${cropX}" y="${cropY}" width="${cropW}" height="${cropH}" rx="16" fill="rgba(250,204,21,0.05)" stroke="#FACC15" stroke-width="3" stroke-dasharray="16 8" />

        <!-- Camera Trajectory Vector Arrow -->
        <line x1="${vecStartX}" y1="${vecStartY}" x2="${targetX}" y2="${targetY}" stroke="#38BDF8" stroke-width="5" marker-end="url(#hud-arrow)" />
        <circle cx="${vecStartX}" cy="${vecStartY}" r="9" fill="#0EA5E9" stroke="#FFFFFF" stroke-width="3" />

        <!-- Zoom Target Reticle -->
        <circle cx="${targetX}" cy="${targetY}" r="42" fill="rgba(250,204,21,0.12)" stroke="#FACC15" stroke-width="3" />
        <circle cx="${targetX}" cy="${targetY}" r="8" fill="#FACC15" />
        <line x1="${targetX - 60}" y1="${targetY}" x2="${targetX - 20}" y2="${targetY}" stroke="#FACC15" stroke-width="3" />
        <line x1="${targetX + 20}" y1="${targetY}" x2="${targetX + 60}" y2="${targetY}" stroke="#FACC15" stroke-width="3" />
        <line x1="${targetX}" y1="${targetY - 60}" x2="${targetX}" y2="${targetY - 20}" stroke="#FACC15" stroke-width="3" />
        <line x1="${targetX}" y1="${targetY + 20}" x2="${targetX}" y2="${targetY + 60}" stroke="#FACC15" stroke-width="3" />
      </svg>

      <div class="hud-topbar">
        <div class="hud-chip hud-chip-primary">
          ${escapeHtml((frame.id || "frame_01").toUpperCase())} · V${Number(frame.currentVersion || 1)} · ${escapeHtml((frame.motionPreset || "crash-zoom-in").toUpperCase())}
        </div>
        <div class="hud-chip hud-chip-amber">${escapeHtml(tcLabel)} · ${escapeHtml(speedLabel)}</div>
        <div class="hud-transitions">
          <span class="hud-trans-badge">IN ▸ ${escapeHtml(transIn)}</span>
          <span class="hud-trans-badge">OUT ▸ ${escapeHtml(transOut)}</span>
        </div>
      </div>

      <div class="hud-reticle-pill" style="left:${fx}%; top:${fy}%;">
        🎯 ${escapeHtml(zoomReticleLabel)}${cam.tiltDeg ? ` · TILT ${cam.tiltDeg}°` : ""}
      </div>

      <div class="hud-bottom-deck">
        <div class="hud-kf-strip">
          ${kfItems
            .map(
              (item) => `
            <div class="hud-kf-card">
              <div class="hud-kf-thumb">
                ${
                  item.src
                    ? `<img src="${escapeHtml(item.src)}" alt="${item.tag}" />`
                    : `<div class="hud-kf-empty">${item.tag}</div>`
                }
              </div>
              <div class="hud-kf-meta">
                <strong>${item.tag}</strong>
                <span>${escapeHtml(item.t)}</span>
              </div>
            </div>`,
            )
            .join("")}
        </div>
        <div class="hud-audio-strip">
          <div class="hud-vo-line"><strong>VO:</strong> "${escapeHtml(voText)}"</div>
          <div class="hud-sfx-badge">SFX: ${escapeHtml(sfxList)}</div>
        </div>
      </div>
    </div>
  `;
}

export function renderFrameHtml(frame, brief = {}, { showHud = false, assetResolver } = {}) {
  const width = Number(brief?.width) || 1080;
  const height = Number(brief?.height) || 1920;
  const isLandscape = width > height;
  const unit = Math.min(width, height) / 1080;
  const resolveAsset = assetResolver || createDefaultAssetResolver(brief?.slug);

  const themeName = frame?.staging?.theme || "brand-dark";
  const palette = resolveThemePalette(themeName, brief?.brandColors);

  const resolvedAssets = {
    start: resolveAsset(frame?.keyframes?.start),
    peak: resolveAsset(frame?.keyframes?.peak),
    end: resolveAsset(frame?.keyframes?.end),
    bgPlate: resolveAsset(frame?.aiBackgroundPlate || frame?.staging?.aiBackgroundPlate),
  };

  const stageHtml = renderArchetypeStageHtml(frame, brief, palette, resolvedAssets);
  const hudHtml = showHud
    ? renderBlueprintHudOverlayHtml(frame, width, height, resolvedAssets)
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${escapeHtml(frame?.title || brief?.title || "Storyboard Frame")}</title>
    <style>
      :root {
        --u: ${unit.toFixed(4)}px;
        --bg: ${palette.background};
        --surface: ${palette.surface};
        --surface-alt: ${palette.surfaceAlt};
        --primary: ${palette.primary};
        --secondary: ${palette.secondary};
        --accent: ${palette.accent};
        --text: ${palette.text};
        --muted: ${palette.mutedText};
        --badge-bg: ${palette.badgeBg};
        --badge-text: ${palette.badgeText};
        --border: ${palette.border};
      }
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      html, body {
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: var(--bg);
        color: var(--text);
        font-family: "Inter", "Hind Siliguri", "Nirmala UI", "Segoe UI", -apple-system, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      #canvas {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background:
          radial-gradient(circle at 18% 16%, color-mix(in srgb, ${palette.glowA} 38%, transparent) 0%, transparent 54%),
          radial-gradient(circle at 84% 78%, color-mix(in srgb, ${palette.glowB} 30%, transparent) 0%, transparent 58%),
          var(--bg);
      }
      .ambient-grid {
        position: absolute;
        inset: 0;
        background-image:
          linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px);
        background-size: calc(72 * var(--u)) calc(72 * var(--u));
        pointer-events: none;
      }
      .stage {
        position: relative;
        width: 100%;
        height: 100%;
        padding: ${
          showHud
            ? isLandscape
              ? "calc(112 * var(--u)) calc(84 * var(--u)) calc(210 * var(--u))"
              : "calc(136 * var(--u)) calc(82 * var(--u)) calc(230 * var(--u))"
            : isLandscape
              ? "calc(76 * var(--u)) calc(84 * var(--u)) calc(86 * var(--u))"
              : "calc(118 * var(--u)) calc(82 * var(--u)) calc(116 * var(--u))"
        };
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        z-index: 2;
      }
      .badge-pill {
        display: inline-flex;
        align-items: center;
        padding: calc(10 * var(--u)) calc(24 * var(--u));
        border-radius: 999px;
        background: var(--badge-bg);
        color: var(--badge-text);
        font-size: calc(21 * var(--u));
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        box-shadow: 0 calc(8 * var(--u)) calc(24 * var(--u)) rgba(0,0,0,0.28);
      }
      .hero-headline {
        font-size: calc(${isLandscape ? 58 : 62} * var(--u));
        font-weight: 800;
        line-height: 1.08;
        letter-spacing: -0.025em;
        color: var(--text);
        margin-top: calc(18 * var(--u));
      }
      .hero-subheadline {
        font-size: calc(27 * var(--u));
        font-weight: 500;
        line-height: 1.38;
        color: var(--muted);
        margin-top: calc(14 * var(--u));
        max-width: 92%;
      }
      .glass-card {
        background: color-mix(in srgb, var(--surface) 88%, rgba(255,255,255,0.08));
        border: 1.5px solid var(--border);
        border-radius: calc(24 * var(--u));
        padding: calc(18 * var(--u)) calc(24 * var(--u));
        box-shadow: 0 calc(18 * var(--u)) calc(42 * var(--u)) rgba(0,0,0,0.38);
      }
      .metric-label {
        font-size: calc(17 * var(--u));
        font-weight: 700;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        color: var(--accent);
      }
      .metric-value {
        font-size: calc(25 * var(--u));
        font-weight: 700;
        color: var(--text);
        margin-top: calc(6 * var(--u));
      }
      .media-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .synthetic-screen {
        width: 100%;
        height: 100%;
        padding: calc(26 * var(--u));
        background: linear-gradient(165deg, var(--surface), var(--surface-alt));
        display: flex;
        flex-direction: column;
        gap: calc(22 * var(--u));
        justify-content: space-between;
      }
      .syn-topbar {
        display: flex;
        align-items: center;
        gap: calc(10 * var(--u));
      }
      .syn-dot {
        width: calc(14 * var(--u));
        height: calc(14 * var(--u));
        border-radius: 50%;
      }
      .syn-pill {
        margin-left: auto;
        font-size: calc(16 * var(--u));
        font-weight: 700;
        letter-spacing: 0.08em;
        padding: calc(6 * var(--u)) calc(14 * var(--u));
        border-radius: 999px;
        background: rgba(255,255,255,0.12);
      }
      .syn-hero-card {
        border-radius: calc(24 * var(--u));
        padding: calc(32 * var(--u));
        color: #FFFFFF;
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.22);
      }
      .syn-kicker {
        font-size: calc(18 * var(--u));
        font-weight: 700;
        opacity: 0.88;
        letter-spacing: 0.1em;
      }
      .syn-card-title {
        font-size: calc(38 * var(--u));
        font-weight: 800;
        margin-top: calc(10 * var(--u));
        line-height: 1.15;
      }
      .syn-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: calc(16 * var(--u));
      }
      .syn-cell {
        background: rgba(0,0,0,0.24);
        border-radius: calc(18 * var(--u));
        padding: calc(18 * var(--u));
        display: flex;
        flex-direction: column;
        gap: calc(10 * var(--u));
      }
      .syn-bar {
        height: calc(12 * var(--u));
        border-radius: 999px;
      }
      .syn-bar.muted {
        background: rgba(255,255,255,0.18);
      }
      .caption-rail {
        align-self: center;
        max-width: 90%;
        background: rgba(8, 13, 20, 0.84);
        border: 1.5px solid rgba(255, 255, 255, 0.18);
        padding: calc(14 * var(--u)) calc(28 * var(--u));
        border-radius: 999px;
        color: #FFFFFF;
        font-size: calc(24 * var(--u));
        font-weight: 700;
        text-align: center;
        box-shadow: 0 calc(12 * var(--u)) calc(32 * var(--u)) rgba(0,0,0,0.42);
      }

      /* 1. Device 3D Showcase */
      .device-copy-top {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .device-stage-center {
        position: relative;
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: calc(24 * var(--u)) 0;
      }
      .device-halo {
        position: absolute;
        width: calc(560 * var(--u));
        height: calc(560 * var(--u));
        border-radius: 50%;
        background: radial-gradient(circle, color-mix(in srgb, var(--primary) 52%, transparent) 0%, transparent 70%);
      }
      .phone-3d-chassis {
        position: relative;
        width: ${isLandscape ? "calc(420 * var(--u))" : "calc(540 * var(--u))"};
        height: ${isLandscape ? "calc(560 * var(--u))" : "calc(1020 * var(--u))"};
        border-radius: calc(54 * var(--u));
        padding: calc(16 * var(--u));
        background: linear-gradient(145deg, #334155 0%, #0F172A 48%, #475569 100%);
        box-shadow:
          0 calc(36 * var(--u)) calc(80 * var(--u)) rgba(0,0,0,0.6),
          inset 0 0 0 calc(3 * var(--u)) rgba(255,255,255,0.22);
      }
      .phone-island {
        position: absolute;
        top: calc(28 * var(--u));
        left: 50%;
        transform: translateX(-50%);
        width: calc(136 * var(--u));
        height: calc(30 * var(--u));
        border-radius: 999px;
        background: #05080F;
        z-index: 4;
      }
      .phone-screen {
        width: 100%;
        height: 100%;
        border-radius: calc(40 * var(--u));
        overflow: hidden;
        background: var(--surface);
      }
      .floating-callout {
        position: absolute;
        max-width: calc(310 * var(--u));
        z-index: 5;
      }
      .left-callout {
        left: calc(10 * var(--u));
        top: 22%;
      }
      .right-callout {
        right: calc(10 * var(--u));
        bottom: 18%;
      }

      /* 2. Split Editorial */
      .layout-split-editorial {
        display: grid;
        grid-template-rows: ${isLandscape ? "1fr auto" : "auto 1fr auto"};
        grid-template-columns: ${isLandscape ? "1fr 1.08fr" : "1fr"};
        gap: calc(28 * var(--u));
      }
      .eyebrow-row {
        display: flex;
        align-items: center;
        gap: calc(16 * var(--u));
      }
      .shot-num {
        font-size: calc(34 * var(--u));
        font-weight: 900;
        color: var(--accent);
      }
      .split-metrics {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: calc(16 * var(--u));
        margin-top: calc(24 * var(--u));
      }
      .split-media-pane {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 0;
      }
      .architectural-frame {
        position: relative;
        width: 100%;
        height: 100%;
        min-height: calc(520 * var(--u));
        border-radius: calc(36 * var(--u));
        overflow: hidden;
        border: 2px solid var(--border);
        box-shadow: 0 calc(28 * var(--u)) calc(64 * var(--u)) rgba(0,0,0,0.48);
      }
      .floating-chip {
        position: absolute;
        right: calc(24 * var(--u));
        bottom: calc(24 * var(--u));
        padding: calc(12 * var(--u)) calc(24 * var(--u));
        border-radius: 999px;
        background: var(--accent);
        color: #090D16;
        font-weight: 800;
        font-size: calc(22 * var(--u));
      }
      .layout-split-editorial .caption-rail {
        grid-column: 1 / -1;
        justify-self: center;
      }

      /* 3. Fullbleed Cinema */
      .layout-fullbleed-cinema {
        position: relative;
      }
      .cinema-backdrop {
        position: absolute;
        inset: 0;
        z-index: 0;
      }
      .cinema-scrim {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(5,10,14,0.72) 0%, rgba(5,10,14,0.22) 42%, rgba(5,10,14,0.92) 100%);
        z-index: 1;
      }
      .cinema-topbar, .cinema-lower-third, .layout-fullbleed-cinema .caption-rail {
        position: relative;
        z-index: 3;
      }
      .cinema-topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .cinema-tag {
        font-size: calc(20 * var(--u));
        font-weight: 700;
        letter-spacing: 0.1em;
        color: #E2E8F0;
        padding: calc(8 * var(--u)) calc(18 * var(--u));
        border-radius: 999px;
        background: rgba(15,23,42,0.68);
        border: 1px solid rgba(255,255,255,0.2);
      }
      .cinema-lower-third {
        margin-top: auto;
        margin-bottom: calc(28 * var(--u));
      }
      .accent-rule {
        width: calc(110 * var(--u));
        height: calc(8 * var(--u));
        border-radius: 999px;
        background: var(--accent);
        margin-bottom: calc(14 * var(--u));
      }
      .cinema-title { color: #FFFFFF; }
      .cinema-sub { color: #E2E8F0; }
      .callout-strip {
        display: flex;
        flex-wrap: wrap;
        gap: calc(12 * var(--u));
        margin-top: calc(22 * var(--u));
      }
      .glass-pill {
        background: rgba(15,23,42,0.78);
        border: 1px solid rgba(255,255,255,0.22);
        color: #F8FAFC;
        padding: calc(10 * var(--u)) calc(20 * var(--u));
        border-radius: 999px;
        font-size: calc(20 * var(--u));
      }

      /* 4. Bento Feature Grid */
      .bento-grid {
        flex: 1;
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1.35fr 1fr;
        gap: calc(20 * var(--u));
        margin: calc(24 * var(--u)) 0;
        min-height: 0;
      }
      .bento-cell {
        position: relative;
        border-radius: calc(30 * var(--u));
        overflow: hidden;
        background: var(--surface);
        border: 1.5px solid var(--border);
        box-shadow: 0 calc(16 * var(--u)) calc(40 * var(--u)) rgba(0,0,0,0.34);
      }
      .bento-hero {
        grid-column: 1 / -1;
      }
      .bento-overlay-label {
        position: absolute;
        left: calc(22 * var(--u));
        bottom: calc(22 * var(--u));
        background: rgba(9, 13, 22, 0.86);
        color: #FFFFFF;
        padding: calc(10 * var(--u)) calc(20 * var(--u));
        border-radius: 999px;
        font-size: calc(21 * var(--u));
        font-weight: 700;
      }
      .bento-sub, .bento-accent-card {
        padding: calc(20 * var(--u));
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .bento-accent-card {
        background: linear-gradient(155deg, color-mix(in srgb, var(--primary) 36%, var(--surface)), var(--surface-alt));
      }
      .bento-mini-media {
        height: 62%;
        border-radius: calc(18 * var(--u));
        overflow: hidden;
      }
      .bento-stat-title {
        font-size: calc(17 * var(--u));
        font-weight: 800;
        letter-spacing: 0.08em;
        color: var(--accent);
        margin-top: calc(12 * var(--u));
      }
      .bento-stat-val {
        font-size: calc(25 * var(--u));
        font-weight: 800;
        color: var(--text);
      }

      /* 5. Spotlight Cursor Zoom */
      .spotlight-viewport {
        position: relative;
        flex: 1;
        margin: calc(24 * var(--u)) 0;
        border-radius: calc(36 * var(--u));
        overflow: hidden;
        border: 2px solid var(--border);
      }
      .spotlight-base-media, .spotlight-dim {
        position: absolute;
        inset: 0;
      }
      .spotlight-loupe {
        position: absolute;
        width: calc(360 * var(--u));
        height: calc(360 * var(--u));
        transform: translate(-50%, -50%);
        z-index: 4;
      }
      .loupe-inner {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        overflow: hidden;
        border: calc(6 * var(--u)) solid var(--accent);
        box-shadow: 0 calc(24 * var(--u)) calc(60 * var(--u)) rgba(0,0,0,0.68);
      }
      .loupe-ring {
        position: absolute;
        inset: calc(-18 * var(--u));
        border-radius: 50%;
        border: 2px dashed rgba(250, 204, 21, 0.65);
      }
      .loupe-ripple {
        position: absolute;
        inset: calc(-36 * var(--u));
        border-radius: 50%;
        border: 2px solid rgba(56, 189, 248, 0.42);
      }
      .cursor-svg {
        position: absolute;
        right: calc(18 * var(--u));
        bottom: calc(10 * var(--u));
        width: calc(88 * var(--u));
        height: calc(88 * var(--u));
        filter: drop-shadow(0 calc(10 * var(--u)) calc(18 * var(--u)) rgba(0,0,0,0.55));
      }
      .spotlight-callout {
        position: absolute;
        left: calc(28 * var(--u));
        bottom: calc(28 * var(--u));
        right: calc(28 * var(--u));
        z-index: 5;
      }

      /* 6. Kinetic Statement Card */
      .kinetic-poster {
        position: relative;
        flex: 1;
        margin: calc(18 * var(--u)) 0 calc(26 * var(--u));
        border-radius: calc(40 * var(--u));
        padding: calc(56 * var(--u));
        background: linear-gradient(155deg, var(--surface) 0%, var(--surface-alt) 100%);
        border: 2px solid var(--border);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        box-shadow: 0 calc(30 * var(--u)) calc(70 * var(--u)) rgba(0,0,0,0.45);
      }
      .corner-mark {
        position: absolute;
        width: calc(32 * var(--u));
        height: calc(32 * var(--u));
        border-color: var(--accent);
        border-style: solid;
      }
      .corner-mark.tl { top: calc(24 * var(--u)); left: calc(24 * var(--u)); border-width: 4px 0 0 4px; }
      .corner-mark.tr { top: calc(24 * var(--u)); right: calc(24 * var(--u)); border-width: 4px 4px 0 0; }
      .corner-mark.bl { bottom: calc(24 * var(--u)); left: calc(24 * var(--u)); border-width: 0 0 4px 4px; }
      .corner-mark.br { bottom: calc(24 * var(--u)); right: calc(24 * var(--u)); border-width: 0 4px 4px 0; }
      .kinetic-display {
        font-size: calc(${isLandscape ? 68 : 78} * var(--u));
        font-weight: 900;
        line-height: 1.04;
        letter-spacing: -0.03em;
        margin-top: calc(28 * var(--u));
        color: var(--text);
      }
      .kinetic-divider {
        width: calc(160 * var(--u));
        height: calc(10 * var(--u));
        border-radius: 999px;
        background: linear-gradient(90deg, var(--accent), var(--secondary));
        margin: calc(28 * var(--u)) 0;
      }
      .kinetic-preview-row {
        margin-top: calc(36 * var(--u));
        width: 100%;
        display: flex;
        align-items: center;
        gap: calc(24 * var(--u));
      }
      .kinetic-thumb {
        width: calc(220 * var(--u));
        height: calc(220 * var(--u));
        border-radius: calc(26 * var(--u));
        overflow: hidden;
        border: 2px solid var(--border);
        flex-shrink: 0;
      }
      .kinetic-cta-pill {
        margin-top: calc(12 * var(--u));
        display: inline-block;
        padding: calc(16 * var(--u)) calc(32 * var(--u));
        border-radius: 999px;
        background: var(--primary);
        color: #FFFFFF;
        font-size: calc(26 * var(--u));
        font-weight: 800;
      }

      /* Animation Blueprint HUD Overlay */
      .hud-layer {
        position: absolute;
        inset: 0;
        z-index: 20;
        pointer-events: none;
        font-family: "Consolas", "JetBrains Mono", "Segoe UI", monospace;
      }
      .hud-svg {
        position: absolute;
        inset: 0;
      }
      .hud-topbar {
        position: absolute;
        top: calc(22 * var(--u));
        left: calc(24 * var(--u));
        right: calc(24 * var(--u));
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: calc(10 * var(--u));
      }
      .hud-chip {
        padding: calc(8 * var(--u)) calc(16 * var(--u));
        border-radius: calc(10 * var(--u));
        font-size: calc(18 * var(--u));
        font-weight: 800;
        background: rgba(6, 11, 20, 0.9);
        border: 1.5px solid rgba(56, 189, 248, 0.65);
        color: #38BDF8;
      }
      .hud-chip-amber {
        border-color: rgba(250, 204, 21, 0.75);
        color: #FACC15;
      }
      .hud-transitions {
        display: flex;
        gap: calc(8 * var(--u));
      }
      .hud-trans-badge {
        padding: calc(7 * var(--u)) calc(14 * var(--u));
        border-radius: calc(8 * var(--u));
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid rgba(167, 243, 208, 0.55);
        color: #6EE7B7;
        font-size: calc(16 * var(--u));
        font-weight: 700;
      }
      .hud-reticle-pill {
        position: absolute;
        transform: translate(-50%, calc(48 * var(--u)));
        background: rgba(9, 13, 22, 0.92);
        border: 2px solid #FACC15;
        color: #FEF08A;
        padding: calc(8 * var(--u)) calc(18 * var(--u));
        border-radius: 999px;
        font-size: calc(19 * var(--u));
        font-weight: 800;
        white-space: nowrap;
        box-shadow: 0 calc(8 * var(--u)) calc(24 * var(--u)) rgba(0,0,0,0.65);
      }
      .hud-bottom-deck {
        position: absolute;
        left: calc(24 * var(--u));
        right: calc(24 * var(--u));
        bottom: calc(20 * var(--u));
        background: rgba(6, 11, 20, 0.9);
        border: 1.5px solid rgba(56, 189, 248, 0.45);
        border-radius: calc(20 * var(--u));
        padding: calc(14 * var(--u)) calc(18 * var(--u));
        display: flex;
        flex-direction: column;
        gap: calc(12 * var(--u));
      }
      .hud-kf-strip {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: calc(12 * var(--u));
      }
      .hud-kf-card {
        display: flex;
        align-items: center;
        gap: calc(10 * var(--u));
        background: rgba(15, 23, 42, 0.85);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: calc(12 * var(--u));
        padding: calc(8 * var(--u));
      }
      .hud-kf-thumb {
        width: calc(76 * var(--u));
        height: calc(56 * var(--u));
        border-radius: calc(8 * var(--u));
        overflow: hidden;
        background: #1E293B;
        flex-shrink: 0;
      }
      .hud-kf-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .hud-kf-empty {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: calc(14 * var(--u));
        color: #94A3B8;
      }
      .hud-kf-meta {
        display: flex;
        flex-direction: column;
        font-size: calc(16 * var(--u));
        color: #E2E8F0;
      }
      .hud-kf-meta strong { color: #38BDF8; }
      .hud-audio-strip {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: calc(14 * var(--u));
        border-top: 1px solid rgba(148, 163, 184, 0.22);
        padding-top: calc(10 * var(--u));
      }
      .hud-vo-line {
        font-size: calc(17 * var(--u));
        color: #F8FAFC;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hud-vo-line strong { color: #34D399; }
      .hud-sfx-badge {
        flex-shrink: 0;
        padding: calc(5 * var(--u)) calc(12 * var(--u));
        border-radius: calc(8 * var(--u));
        background: rgba(245, 158, 11, 0.2);
        border: 1px solid rgba(250, 204, 21, 0.6);
        color: #FDE047;
        font-size: calc(16 * var(--u));
        font-weight: 800;
      }
    </style>
  </head>
  <body>
    <div id="canvas">
      <div class="ambient-grid"></div>
      ${stageHtml}
      ${hudHtml}
    </div>
  </body>
</html>
`;
}

async function captureHtmlToPng({ html, htmlPath, pngPath, width, height }) {
  const chromeExe = resolveChromeHeadlessShell();
  if (!chromeExe) {
    throw new Error(
      "chrome-headless-shell executable not found in ~/.cache/hyperframes/chrome or system Chrome paths.",
    );
  }

  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  fs.writeFileSync(htmlPath, html, "utf8");

  const args = [
    "--headless",
    "--no-first-run",
    "--disable-gpu",
    "--disable-extensions",
    "--allow-file-access-from-files",
    `--window-size=${width},${height}`,
    "--hide-scrollbars",
    `--screenshot=${pngPath}`,
    pathToFileURL(htmlPath).href,
  ];

  let res = await runCommand(chromeExe, args, { shell: false, env: getToolEnv() });
  if (res.code !== 0 || !fs.existsSync(pngPath)) {
    res = await runCommand(chromeExe, args, { shell: false, env: getToolEnv() });
  }
  if (res.code !== 0 || !fs.existsSync(pngPath)) {
    throw new Error(
      `Failed to capture PNG via chrome-headless-shell (code ${res.code}): ${(res.stderr || res.stdout || "").slice(0, 400)}`,
    );
  }
  return pngPath;
}

async function runWithConcurrency(tasks, concurrency = 4) {
  const results = new Array(tasks.length);
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function ensureStoryboardDirs(slug) {
  const projectDir = ensureProjectDirs(slug);
  const designDir = path.join(projectDir, ".studio", "frames", "design");
  const tmpDir = path.join(projectDir, ".studio", "frames", "tmp");
  fs.mkdirSync(designDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  return { projectDir, designDir, tmpDir };
}

function makeMediaUrl(slug, relPath) {
  return `/media/${encodeURIComponent(slug)}/${relPath.split("/").map(encodeURIComponent).join("/")}`;
}

function buildVersionSnapshot(frame) {
  return {
    version: frame.currentVersion,
    createdAt: new Date().toISOString(),
    prompt: frame.prompt || "",
    title: frame.title,
    layout: frame.layout,
    motionPreset: frame.motionPreset,
    cameraMotion: structuredClone(frame.cameraMotion),
    durationSeconds: frame.durationSeconds,
    speedFactor: frame.speedFactor,
    rawTimeRange: structuredClone(frame.rawTimeRange),
    staging: structuredClone(frame.staging),
    audioSpec: structuredClone(frame.audioSpec),
    aiBackgroundPlate: frame.aiBackgroundPlate ?? null,
    designFramePath: frame.designFramePath,
    hudFramePath: frame.hudFramePath,
    designFrameUrl: frame.designFrameUrl,
    hudFrameUrl: frame.hudFrameUrl,
  };
}

async function renderBothFramePngs({ slug, projectDir, frame, brief }) {
  const version = Number(frame.currentVersion || 1);
  const designRel = `.studio/frames/design/${frame.id}_v${version}.png`;
  const hudRel = `.studio/frames/design/${frame.id}_v${version}_hud.png`;
  const cleanHtmlPath = path.join(
    projectDir,
    ".studio",
    "frames",
    "tmp",
    `${frame.id}_v${version}.html`,
  );
  const hudHtmlPath = path.join(
    projectDir,
    ".studio",
    "frames",
    "tmp",
    `${frame.id}_v${version}_hud.html`,
  );

  const width = Number(brief?.width) || 1080;
  const height = Number(brief?.height) || 1920;
  const resolver = createDefaultAssetResolver(slug);

  const cleanHtml = renderFrameHtml(frame, brief, { showHud: false, assetResolver: resolver });
  const hudHtml = renderFrameHtml(frame, brief, { showHud: true, assetResolver: resolver });

  frame.designFramePath = designRel;
  frame.hudFramePath = hudRel;
  frame.designFrameUrl = makeMediaUrl(slug, designRel);
  frame.hudFrameUrl = makeMediaUrl(slug, hudRel);

  await Promise.all([
    captureHtmlToPng({
      html: cleanHtml,
      htmlPath: cleanHtmlPath,
      pngPath: path.join(projectDir, designRel),
      width,
      height,
    }),
    captureHtmlToPng({
      html: hudHtml,
      htmlPath: hudHtmlPath,
      pngPath: path.join(projectDir, hudRel),
      width,
      height,
    }),
  ]);
}

function loadProjectBriefFallback(slug, projectDir, providedBrief) {
  if (providedBrief && typeof providedBrief === "object") {
    return {
      slug,
      title: providedBrief.title || slug,
      aspectRatio: providedBrief.aspectRatio || "9:16",
      width: Number(providedBrief.width) || 1080,
      height: Number(providedBrief.height) || 1920,
      fps: Number(providedBrief.fps) || 30,
      durationSeconds: Number(providedBrief.durationSeconds) || 30,
      language: providedBrief.language || "English",
      brandColors: {
        primary: providedBrief.brandColors?.primary || "#1E824C",
        secondary: providedBrief.brandColors?.secondary || "#2ECC71",
        accent: providedBrief.brandColors?.accent || "#F1C40F",
        background: providedBrief.brandColors?.background || "#0A1612",
      },
      files: providedBrief.files || {},
      inspirationProfile: providedBrief.inspirationProfile || null,
    };
  }

  const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
  if (fs.existsSync(briefPath)) {
    try {
      return JSON.parse(fs.readFileSync(briefPath, "utf8"));
    } catch {
      // Fall through
    }
  }

  return {
    slug,
    title: slug,
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 30,
    language: "English",
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#F1C40F",
      background: "#0A1612",
    },
    files: {},
  };
}

function inferPresetAndLayoutFromSchemaFx(index, keyFx = []) {
  const joined = keyFx.join(" ").toLowerCase();
  if (joined.includes("isometric") || joined.includes("tilt")) {
    return { presetId: "isometric-3d-tilt", layout: "bento-feature-grid", speedFactor: 1 };
  }
  if (joined.includes("spotlight")) {
    return { presetId: "spotlight-cursor-follow", layout: "spotlight-cursor-zoom", speedFactor: 1 };
  }
  if (joined.includes("speed_ramp_2x") || joined.includes("2x")) {
    return { presetId: "whip-pan-split", layout: "split-editorial", speedFactor: 2 };
  }
  if (joined.includes("zoom_out")) {
    return { presetId: "dolly-out-reveal", layout: "split-editorial", speedFactor: 1 };
  }
  if (joined.includes("outro") || joined.includes("confetti")) {
    return { presetId: "editorial-kinetic-card", layout: "kinetic-statement-card", speedFactor: 1 };
  }
  if (joined.includes("zoom_200") || index === 0) {
    return { presetId: "crash-zoom-in", layout: "device-3d-showcase", speedFactor: 1 };
  }
  const cyclePresets = [
    "crash-zoom-in",
    "dolly-out-reveal",
    "bento-triptych",
    "spotlight-cursor-follow",
    "whip-pan-split",
    "parallax-float",
    "editorial-kinetic-card",
  ];
  const presetId = cyclePresets[index % cyclePresets.length];
  return { presetId, layout: getMotionPreset(presetId).defaultLayout, speedFactor: 1 };
}

function findMatchingAssetKeyframe(projectDir, sceneNum) {
  const padded = String(sceneNum).padStart(2, "0");
  const candidates = [
    `.studio/frames/raw/scene_${padded}_peak.png`,
    `assets/first_scene_${padded}.mp4.png`,
    `assets/scene${sceneNum}_t2.5.png`,
    `assets/scene${sceneNum}_t3.png`,
  ];
  for (const rel of candidates) {
    if (fs.existsSync(path.join(projectDir, rel))) return rel;
  }
  const thumbDir = path.join(projectDir, ".thumbnails");
  if (fs.existsSync(thumbDir)) {
    const match = fs
      .readdirSync(thumbDir)
      .find((name) => name.startsWith(`scene_${padded}_`) && name.endsWith(".jpg"));
    if (match) return `.thumbnails/${match}`;
  }
  return null;
}

function deriveCandidateShots({ projectDir, brief, rawAnalysis, targetScenes, inspiration }) {
  const pacing = inspiration?.pacing || "rhythmic-editorial";
  const defaultShotSec = pacing === "fast-kinetic" ? 3.2 : pacing === "calm-cinematic" ? 5.8 : 4.5;

  // 1. From rawAnalysis.scenes
  if (Array.isArray(rawAnalysis?.scenes) && rawAnalysis.scenes.length > 0) {
    const count =
      targetScenes !== undefined
        ? Math.max(1, Math.min(Number(targetScenes) || 6, rawAnalysis.scenes.length))
        : rawAnalysis.scenes.length;
    const primaryVideo =
      rawAnalysis.videoRelPath ||
      brief?.files?.rawVideo?.[0]?.relPath ||
      brief?.files?.clips?.[0]?.relPath ||
      null;

    return rawAnalysis.scenes.slice(0, count).map((sc, i) => {
      const start = Number(sc.startTime ?? 0);
      const end = Number(sc.endTime ?? start + defaultShotSec);
      const rawDur = Math.max(1.2, round2(end - start));
      const beat = NARRATIVE_BEATS[i % NARRATIVE_BEATS.length];
      const presetOrder =
        pacing === "fast-kinetic"
          ? [
              "crash-zoom-in",
              "whip-pan-split",
              "spotlight-cursor-follow",
              "bento-triptych",
              "isometric-3d-tilt",
              "editorial-kinetic-card",
            ]
          : [
              "crash-zoom-in",
              "dolly-out-reveal",
              "isometric-3d-tilt",
              "bento-triptych",
              "spotlight-cursor-follow",
              "parallax-float",
            ];
      const presetId = presetOrder[i % presetOrder.length];
      const layout = LAYOUT_ARCHETYPES[i % LAYOUT_ARCHETYPES.length];

      return {
        index: i + 1,
        title: sc.title || beat.headline,
        narrativeBeat: beat.role,
        layout,
        motionPreset: presetId,
        durationSeconds: round2(clamp(rawDur, 2.0, pacing === "fast-kinetic" ? 4.5 : 7.5)),
        speedFactor: rawDur > 7 ? 1.5 : 1,
        sourceClip: primaryVideo,
        rawTimeRange: [round2(start), round2(end)],
        keyframes: {
          start: sc.keyframes?.start || null,
          peak: sc.keyframes?.peak || sc.keyframes?.start || null,
          end: sc.keyframes?.end || sc.keyframes?.peak || null,
        },
        badgeText: beat.badge,
        headline: sc.title || beat.headline,
        subheadline: beat.subheadline,
        voText: beat.vo,
        sfx: beat.sfx,
      };
    });
  }

  // 2. From SCENE_SCHEMA.json if present (e.g. krishop-promo)
  const schemaPath = path.join(projectDir, "SCENE_SCHEMA.json");
  if (fs.existsSync(schemaPath)) {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
      if (Array.isArray(schema.scenes) && schema.scenes.length > 0) {
        const list =
          targetScenes !== undefined
            ? schema.scenes.slice(0, Math.max(1, Number(targetScenes)))
            : schema.scenes;
        return list.map((sc, i) => {
          const beat = NARRATIVE_BEATS[i % NARRATIVE_BEATS.length];
          const fxChoice = inferPresetAndLayoutFromSchemaFx(i, sc.key_fx || []);
          const start = Number(sc.start_time ?? 0);
          const end = Number(sc.end_time ?? start + defaultShotSec);
          const dur = Math.max(1.5, round2(end - start));
          const kfRel = findMatchingAssetKeyframe(projectDir, i + 1);
          const sfx = (sc.key_fx || [])
            .filter((fx) => fx.includes("sfx"))
            .map((fx) => fx.replace(/_sfx$/i, ""));

          return {
            index: i + 1,
            title: sc.name || beat.headline,
            narrativeBeat: beat.role,
            layout: fxChoice.layout,
            motionPreset: fxChoice.presetId,
            durationSeconds: dur,
            speedFactor: fxChoice.speedFactor,
            sourceClip: sc.clip_src || null,
            rawTimeRange: [0, dur],
            keyframes: {
              start: kfRel,
              peak: kfRel,
              end: kfRel,
            },
            badgeText: beat.badge,
            headline: sc.name || beat.headline,
            subheadline: beat.subheadline,
            voText: beat.vo,
            voiceoverSrc: sc.voiceover_src || null,
            sfx: sfx.length > 0 ? sfx : beat.sfx,
          };
        });
      }
    } catch {
      // Fall through if schema JSON is malformed
    }
  }

  // 3. From brief.files.clips or brief.files.rawVideo
  const clips = brief?.files?.clips || [];
  const rawVideos = brief?.files?.rawVideo || [];
  const desiredCount = Math.max(1, Number(targetScenes) || 6);

  if (rawVideos.length > 0) {
    const primary = rawVideos[0];
    const totalRawDur = Math.max(desiredCount * 2, Number(primary.duration) || desiredCount * 4.5);
    const segDur = totalRawDur / desiredCount;
    return Array.from({ length: desiredCount }, (_, i) => {
      const beat = NARRATIVE_BEATS[i % NARRATIVE_BEATS.length];
      const preset = MOTION_PRESETS[i % MOTION_PRESETS.length];
      const layout = LAYOUT_ARCHETYPES[i % LAYOUT_ARCHETYPES.length];
      const kfRel = findMatchingAssetKeyframe(projectDir, i + 1);
      return {
        index: i + 1,
        title: beat.headline,
        narrativeBeat: beat.role,
        layout,
        motionPreset: preset.id,
        durationSeconds: round2(clamp(defaultShotSec, 2.5, 6.5)),
        speedFactor: 1,
        sourceClip: primary.relPath,
        rawTimeRange: [round2(i * segDur), round2((i + 1) * segDur)],
        keyframes: { start: kfRel, peak: kfRel, end: kfRel },
        badgeText: beat.badge,
        headline: beat.headline,
        subheadline: beat.subheadline,
        voText: beat.vo,
        sfx: beat.sfx,
      };
    });
  }

  if (clips.length > 0) {
    const count = targetScenes !== undefined ? desiredCount : clips.length;
    return Array.from({ length: count }, (_, i) => {
      const clip = clips[i % clips.length];
      const beat = NARRATIVE_BEATS[i % NARRATIVE_BEATS.length];
      const preset = MOTION_PRESETS[i % MOTION_PRESETS.length];
      const layout = LAYOUT_ARCHETYPES[i % LAYOUT_ARCHETYPES.length];
      const dur = round2(clamp(Number(clip.duration) || defaultShotSec, 2.0, 8.0));
      const kfRel = findMatchingAssetKeyframe(projectDir, i + 1);
      return {
        index: i + 1,
        title: beat.headline,
        narrativeBeat: beat.role,
        layout,
        motionPreset: preset.id,
        durationSeconds: dur,
        speedFactor: 1,
        sourceClip: clip.relPath,
        rawTimeRange: [0, dur],
        keyframes: { start: kfRel, peak: kfRel, end: kfRel },
        badgeText: beat.badge,
        headline: beat.headline,
        subheadline: beat.subheadline,
        voText: beat.vo,
        sfx: beat.sfx,
      };
    });
  }

  // 4. Pure editorial storyboard fallback
  const totalSec = Math.max(desiredCount * 2, Number(brief?.durationSeconds) || 24);
  const perShot = round2(totalSec / desiredCount);
  const fallbackImg =
    brief?.files?.assetImages?.[0]?.relPath || brief?.files?.images?.[0]?.relPath || null;

  return Array.from({ length: desiredCount }, (_, i) => {
    const beat = NARRATIVE_BEATS[i % NARRATIVE_BEATS.length];
    const preset = MOTION_PRESETS[i % MOTION_PRESETS.length];
    const layout = LAYOUT_ARCHETYPES[i % LAYOUT_ARCHETYPES.length];
    return {
      index: i + 1,
      title: beat.headline,
      narrativeBeat: beat.role,
      layout,
      motionPreset: preset.id,
      durationSeconds: perShot,
      speedFactor: 1,
      sourceClip: null,
      rawTimeRange: [round2(i * perShot), round2((i + 1) * perShot)],
      keyframes: { start: fallbackImg, peak: fallbackImg, end: fallbackImg },
      badgeText: beat.badge,
      headline: beat.headline,
      subheadline: beat.subheadline,
      voText: beat.vo,
      sfx: beat.sfx,
    };
  });
}

export function loadStoryboard(slug) {
  const projectDir = assertValidSlug(slug);
  const sbPath = path.join(projectDir, "STORYBOARD.json");
  if (!fs.existsSync(sbPath)) return null;
  return JSON.parse(fs.readFileSync(sbPath, "utf8"));
}

export function saveStoryboard(slug, storyboard) {
  const projectDir = assertValidSlug(slug);
  fs.mkdirSync(projectDir, { recursive: true });
  const frames = Array.isArray(storyboard?.frames) ? storyboard.frames : [];
  const totalDurationSeconds = round2(
    frames.reduce((acc, f) => acc + Number(f.durationSeconds || 0), 0),
  );
  const payload = {
    schemaVersion: 1,
    slug,
    ...storyboard,
    frames,
    frameCount: frames.length,
    lockedCount: frames.filter((f) => Boolean(f.locked)).length,
    approvedCount: frames.filter((f) => Boolean(f.approved)).length,
    totalDurationSeconds,
    updatedAt: new Date().toISOString(),
  };
  const sbPath = path.join(projectDir, "STORYBOARD.json");
  fs.writeFileSync(sbPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

export async function generateStoryboard({
  slug,
  projectBrief = null,
  rawAnalysis = null,
  inspirationProfile = null,
  globalPrompt = "",
  targetScenes,
  preserveLocked = true,
  selectedSkills = null,
  compiledSkillDirectives = null,
} = {}) {
  const { projectDir } = ensureStoryboardDirs(slug);
  const brief = loadProjectBriefFallback(slug, projectDir, projectBrief);
  const inspiration = inspirationProfile || brief.inspirationProfile || null;
  const existing = loadStoryboard(slug);
  const existingMap = new Map((existing?.frames || []).map((f) => [f.id, f]));

  const globalCues = parseFramePrompt(globalPrompt);
  const stagingHints = compiledSkillDirectives?.stagingHints || null;
  const preferredArchetypes = Array.isArray(stagingHints?.preferredArchetypes)
    ? stagingHints.preferredArchetypes.filter((arch) => LAYOUT_ARCHETYPES.includes(arch))
    : [];
  const defaultSkillTheme =
    stagingHints?.preferMinimalPalette && !stagingHints?.enforceSeamCraft ? "light" : "brand-dark";

  const candidates = deriveCandidateShots({
    projectDir,
    brief,
    rawAnalysis,
    targetScenes,
    inspiration,
  });

  const frames = [];
  const renderTasks = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const shotNum = i + 1;
    const frameId = `frame_${String(shotNum).padStart(2, "0")}`;
    const prev = existingMap.get(frameId);

    if (preserveLocked && prev?.locked === true) {
      frames.push(structuredClone(prev));
      continue;
    }

    const cand = candidates[i];
    let presetId = globalCues.motionPreset || cand.motionPreset;
    let layout = globalCues.layout || cand.layout;

    if (!globalCues.layout && stagingHints) {
      const isCursorTargetBeat =
        stagingHints.includeOversizedCursor &&
        (cand.narrativeBeat === "interaction" || i === Math.min(2, candidates.length - 1));
      if (isCursorTargetBeat) {
        layout = "spotlight-cursor-zoom";
        if (!globalCues.motionPreset) {
          presetId = "spotlight-cursor-follow";
        }
      } else if (
        preferredArchetypes.length > 0 &&
        i > 0 &&
        i < candidates.length - 1 &&
        !preferredArchetypes.includes(layout)
      ) {
        layout = preferredArchetypes[i % preferredArchetypes.length];
      }
    }

    const cameraMotion = buildCameraMotionFromPreset(presetId, globalCues.camera || {});
    const speedFactor = globalCues.speedFactor ?? cand.speedFactor ?? 1;
    const nextVersion = prev ? Number(prev.currentVersion || 1) + 1 : 1;

    const frame = {
      id: frameId,
      index: shotNum,
      sceneId: `scene_${String(shotNum).padStart(2, "0")}`,
      title: globalCues.staging?.headline || cand.title,
      narrativeBeat: cand.narrativeBeat,
      layout,
      motionPreset: presetId,
      cameraMotion,
      durationSeconds: cand.durationSeconds,
      speedFactor,
      sourceClip: cand.sourceClip,
      rawTimeRange: cand.rawTimeRange,
      keyframes: cand.keyframes,
      aiBackgroundPlate: globalCues.aiBackgroundPlate || null,
      aiVideoClip: null,
      staging: {
        headline: globalCues.staging?.headline || cand.headline,
        subheadline: globalCues.staging?.subheadline || cand.subheadline,
        badgeText: globalCues.staging?.badgeText || cand.badgeText,
        captionText: globalCues.staging?.captionText || cand.voText,
        ctaText: "Order Now",
        theme: globalCues.staging?.theme || defaultSkillTheme,
        ...(stagingHints?.enforceCaptionOverlay ? { captionMode: "overlay" } : {}),
        calloutItems: [
          { label: "CAMERA", value: getMotionPreset(presetId).name },
          { label: "TIMING", value: `${cand.durationSeconds}s @ ${speedFactor}x` },
          { label: "BEAT", value: String(cand.narrativeBeat || "scene").toUpperCase() },
        ],
        cursorTarget: { x: cameraMotion.focusX, y: cameraMotion.focusY, showRipple: true },
      },
      audioSpec: {
        voiceoverText: cand.voText,
        voiceoverSrc: cand.voiceoverSrc || null,
        sfx: cand.sfx || ["whoosh"],
        bgmMood: inspiration?.pacing === "fast-kinetic" ? "upbeat-tech" : "warm-modern",
      },
      locked: false,
      approved: false,
      prompt: globalPrompt || "",
      currentVersion: nextVersion,
      designFramePath: "",
      hudFramePath: "",
      designFrameUrl: "",
      hudFrameUrl: "",
      history: Array.isArray(prev?.history) ? structuredClone(prev.history) : [],
    };

    frames.push(frame);
    renderTasks.push(async () => {
      await renderBothFramePngs({ slug, projectDir, frame, brief });
      frame.history.push(buildVersionSnapshot(frame));
    });
  }

  // Also preserve any locked frames that existed at indices beyond candidates.length
  if (preserveLocked && existing?.frames?.length) {
    for (const prev of existing.frames) {
      if (prev.locked && !frames.some((f) => f.id === prev.id)) {
        frames.push(structuredClone(prev));
      }
    }
  }

  await runWithConcurrency(renderTasks, 4);

  const normalizedSelectedSkills = Array.isArray(selectedSkills)
    ? selectedSkills.filter(Boolean)
    : Array.isArray(existing?.selectedSkills)
      ? existing.selectedSkills
      : [];

  const storyboard = {
    schemaVersion: 1,
    slug,
    title: brief.title,
    aspectRatio: brief.aspectRatio,
    width: brief.width,
    height: brief.height,
    fps: brief.fps,
    globalPrompt,
    brandColors: brief.brandColors,
    inspirationProfile: inspiration,
    selectedSkills: normalizedSelectedSkills,
    ...(compiledSkillDirectives
      ? {
          skillDirectivesSummary: {
            activeSkillIds: (compiledSkillDirectives.activeSkills || []).map((s) => s.id),
            stagingHints: compiledSkillDirectives.stagingHints || null,
          },
        }
      : existing?.skillDirectivesSummary
        ? { skillDirectivesSummary: existing.skillDirectivesSummary }
        : {}),
    createdAt: existing?.createdAt || new Date().toISOString(),
    frames,
  };

  return saveStoryboard(slug, storyboard);
}

export async function regenerateFrame({
  slug,
  frameId,
  prompt = "",
  motionPreset = null,
  layout = null,
  overrides = {},
} = {}) {
  const { projectDir } = ensureStoryboardDirs(slug);
  const storyboard = loadStoryboard(slug);
  if (!storyboard) {
    throw new Error(`Storyboard not found for project "${slug}". Run generateStoryboard first.`);
  }

  const frame = storyboard.frames.find((f) => f.id === frameId);
  if (!frame) {
    throw new Error(`Frame "${frameId}" not found in storyboard "${slug}".`);
  }

  const brief = loadProjectBriefFallback(slug, projectDir, storyboard);
  const cues = parseFramePrompt(prompt);

  const nextPreset =
    motionPreset && MOTION_PRESETS[motionPreset]
      ? motionPreset
      : cues.motionPreset || overrides.motionPreset || frame.motionPreset;

  const nextLayout =
    layout && LAYOUT_ARCHETYPES.includes(layout)
      ? layout
      : overrides.layout && LAYOUT_ARCHETYPES.includes(overrides.layout)
        ? overrides.layout
        : cues.layout || frame.layout;

  const baseCamera =
    nextPreset !== frame.motionPreset
      ? buildCameraMotionFromPreset(nextPreset)
      : { ...frame.cameraMotion };

  const nextCameraMotion = {
    ...baseCamera,
    ...(cues.camera || {}),
    ...(overrides.cameraMotion || {}),
    presetId: nextPreset,
    label: getMotionPreset(nextPreset).name,
  };

  frame.layout = nextLayout;
  frame.motionPreset = nextPreset;
  frame.cameraMotion = nextCameraMotion;
  frame.speedFactor = overrides.speedFactor ?? cues.speedFactor ?? frame.speedFactor ?? 1;
  if (overrides.durationSeconds !== undefined) {
    frame.durationSeconds = Math.max(0.5, Number(overrides.durationSeconds));
  }
  if (overrides.title !== undefined) {
    frame.title = String(overrides.title);
  } else if (cues.staging?.headline) {
    frame.title = cues.staging.headline;
  }
  if (Array.isArray(overrides.rawTimeRange)) {
    frame.rawTimeRange = overrides.rawTimeRange.map(Number);
  }
  if (overrides.sourceClip !== undefined) {
    frame.sourceClip = overrides.sourceClip;
  }
  if (overrides.keyframes) {
    frame.keyframes = { ...frame.keyframes, ...overrides.keyframes };
  }
  if (overrides.aiBackgroundPlate !== undefined) {
    frame.aiBackgroundPlate = overrides.aiBackgroundPlate;
  } else if (cues.aiBackgroundPlate !== undefined) {
    frame.aiBackgroundPlate = cues.aiBackgroundPlate;
  }
  if (overrides.aiVideoClip !== undefined) {
    frame.aiVideoClip = overrides.aiVideoClip;
  }

  frame.staging = {
    ...frame.staging,
    ...(cues.staging || {}),
    ...(overrides.staging || {}),
    cursorTarget: {
      ...(frame.staging?.cursorTarget || {}),
      x: nextCameraMotion.focusX,
      y: nextCameraMotion.focusY,
      ...(overrides.staging?.cursorTarget || {}),
    },
  };

  if (overrides.audioSpec) {
    frame.audioSpec = { ...frame.audioSpec, ...overrides.audioSpec };
  }

  frame.prompt = prompt || frame.prompt || "";
  frame.currentVersion = Number(frame.currentVersion || 1) + 1;
  if (!Array.isArray(frame.history)) frame.history = [];

  await renderBothFramePngs({ slug, projectDir, frame, brief });
  frame.history.push(buildVersionSnapshot(frame));

  const saved = saveStoryboard(slug, storyboard);
  const savedFrame = saved.frames.find((f) => f.id === frameId);
  return { frame: savedFrame, storyboard: saved };
}

export async function updateFrame({ slug, frameId, patch = {} } = {}) {
  const { projectDir } = ensureStoryboardDirs(slug);
  const storyboard = loadStoryboard(slug);
  if (!storyboard) {
    throw new Error(`Storyboard not found for project "${slug}".`);
  }

  const frame = storyboard.frames.find((f) => f.id === frameId);
  if (!frame) {
    throw new Error(`Frame "${frameId}" not found in storyboard "${slug}".`);
  }

  const brief = loadProjectBriefFallback(slug, projectDir, storyboard);
  let visualChanged = false;

  if (patch.revertToVersion !== undefined && patch.revertToVersion !== null) {
    const targetVer = Number(patch.revertToVersion);
    const snap = (frame.history || []).find((h) => Number(h.version) === targetVer);
    if (!snap) {
      throw new Error(`Version ${targetVer} not found in frame "${frameId}" history.`);
    }
    frame.currentVersion = snap.version;
    frame.prompt = snap.prompt || "";
    frame.title = snap.title || frame.title;
    frame.layout = snap.layout;
    frame.motionPreset = snap.motionPreset;
    frame.cameraMotion = structuredClone(snap.cameraMotion);
    frame.durationSeconds = snap.durationSeconds;
    frame.speedFactor = snap.speedFactor;
    frame.rawTimeRange = structuredClone(snap.rawTimeRange);
    frame.staging = structuredClone(snap.staging);
    frame.audioSpec = structuredClone(snap.audioSpec);
    frame.aiBackgroundPlate = snap.aiBackgroundPlate ?? null;
    frame.designFramePath = snap.designFramePath;
    frame.hudFramePath = snap.hudFramePath;
    frame.designFrameUrl = snap.designFrameUrl;
    frame.hudFrameUrl = snap.hudFrameUrl;

    if (
      !fs.existsSync(path.join(projectDir, frame.designFramePath)) ||
      !fs.existsSync(path.join(projectDir, frame.hudFramePath))
    ) {
      visualChanged = true;
    }
  }

  if (patch.locked !== undefined) frame.locked = Boolean(patch.locked);
  if (patch.approved !== undefined) frame.approved = Boolean(patch.approved);

  if (patch.title !== undefined && patch.title !== frame.title) {
    frame.title = String(patch.title);
    visualChanged = true;
  }
  if (patch.durationSeconds !== undefined) {
    frame.durationSeconds = Math.max(0.5, Number(patch.durationSeconds));
    visualChanged = true;
  }
  if (patch.speedFactor !== undefined) {
    frame.speedFactor = clamp(Number(patch.speedFactor) || 1, 0.25, 4);
    visualChanged = true;
  }
  if (Array.isArray(patch.rawTimeRange)) {
    frame.rawTimeRange = patch.rawTimeRange.map(Number);
    visualChanged = true;
  }
  if (patch.layout && LAYOUT_ARCHETYPES.includes(patch.layout) && patch.layout !== frame.layout) {
    frame.layout = patch.layout;
    visualChanged = true;
  }
  if (patch.motionPreset && MOTION_PRESETS[patch.motionPreset]) {
    frame.motionPreset = patch.motionPreset;
    frame.cameraMotion = buildCameraMotionFromPreset(patch.motionPreset, patch.cameraMotion || {});
    visualChanged = true;
  } else if (patch.cameraMotion && typeof patch.cameraMotion === "object") {
    frame.cameraMotion = { ...frame.cameraMotion, ...patch.cameraMotion };
    visualChanged = true;
  }
  if (patch.aiBackgroundPlate !== undefined) {
    frame.aiBackgroundPlate = patch.aiBackgroundPlate;
    visualChanged = true;
  }
  if (patch.staging && typeof patch.staging === "object") {
    frame.staging = { ...frame.staging, ...patch.staging };
    visualChanged = true;
  }
  if (patch.audioSpec && typeof patch.audioSpec === "object") {
    frame.audioSpec = { ...frame.audioSpec, ...patch.audioSpec };
    visualChanged = true;
  }

  if (visualChanged) {
    await renderBothFramePngs({ slug, projectDir, frame, brief });
    if (Array.isArray(frame.history)) {
      const idx = frame.history.findIndex(
        (h) => Number(h.version) === Number(frame.currentVersion),
      );
      if (idx >= 0) {
        frame.history[idx] = buildVersionSnapshot(frame);
      } else {
        frame.history.push(buildVersionSnapshot(frame));
      }
    }
  }

  const saved = saveStoryboard(slug, storyboard);
  const savedFrame = saved.frames.find((f) => f.id === frameId);
  return { frame: savedFrame, storyboard: saved };
}

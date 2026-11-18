import fs from "node:fs";
import path from "node:path";
import {
  PROJECTS_DIR,
  assertValidSlug,
  ensureProjectDirs,
  getToolEnv,
  runCommand,
  sanitizeFilename,
  syncProjectManifest,
} from "./lib.mjs";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

const PRO_PROJECT_SUBROUTES = new Set([
  "preview-sfx",
  "color-grade",
  "captions/generate",
  "google-multimodal-plan",
]);

const FALLBACK_CAMERA_BODIES = Object.freeze([
  {
    id: "modern-digital",
    name: "Modern Digital Cinema",
    description: "Clean full-frame digital sensor with balanced contrast.",
    grain: 0.02,
    vignette: 0.06,
    aspect: "native",
    contrast: 1.04,
  },
  {
    id: "kodak-35mm",
    name: "Kodak 35mm Film",
    description: "Organic warm halation and fine 35mm cinema grain.",
    grain: 0.12,
    vignette: 0.14,
    aspect: "native",
    contrast: 1.08,
  },
  {
    id: "indie-16mm",
    name: "Indie 16mm Stock",
    description: "Textured 16mm celluloid character with lifted blacks.",
    grain: 0.24,
    vignette: 0.18,
    aspect: "native",
    contrast: 1.06,
  },
  {
    id: "anamorphic-2x",
    name: "Anamorphic 2x Prime",
    description: "Wide cinema optical profile with subtle edge falloff.",
    grain: 0.06,
    vignette: 0.2,
    aspect: "2.39:1",
    contrast: 1.1,
  },
  {
    id: "clean-ui-studio",
    name: "Clean UI Studio",
    description: "Zero-grain razor-sharp SaaS and mobile interface capture.",
    grain: 0,
    vignette: 0,
    aspect: "native",
    contrast: 1.02,
  },
  {
    id: "handheld-doc",
    name: "Handheld Documentary",
    description: "Naturalistic documentary sensor profile with light vignette.",
    grain: 0.09,
    vignette: 0.12,
    aspect: "native",
    contrast: 1.05,
  },
]);

const FALLBACK_LENSES = Object.freeze([
  { id: "14mm", name: "14mm Ultra Wide", perspectivePx: 900, fovScale: 1.24 },
  { id: "24mm", name: "24mm Wide Cinema", perspectivePx: 1150, fovScale: 1.12 },
  { id: "35mm", name: "35mm Director Prime", perspectivePx: 1400, fovScale: 1.04 },
  { id: "50mm", name: "50mm Standard Prime", perspectivePx: 1750, fovScale: 1.0 },
  { id: "85mm", name: "85mm Portrait Tele", perspectivePx: 2200, fovScale: 0.92 },
]);

const FALLBACK_APERTURES = Object.freeze([
  { id: "f/1.4", name: "f/1.4 Wide Open", separation: "deep" },
  { id: "f/2.8", name: "f/2.8 Cinema Sweet Spot", separation: "medium" },
  { id: "f/5.6", name: "f/5.6 Balanced Editorial", separation: "light" },
  { id: "f/11", name: "f/11 Crisp Deep Focus", separation: "none" },
]);

const FALLBACK_CAMERA_PRESETS = Object.freeze([
  { id: "crash-zoom-in", name: "Crash Zoom In", category: "zoom", ease: "expo.out" },
  { id: "dolly-in-slow", name: "Dolly In Slow", category: "dolly", ease: "sine.inOut" },
  { id: "dolly-out-reveal", name: "Dolly Out Reveal", category: "dolly", ease: "power4.out" },
  { id: "whip-pan-left", name: "Whip Pan Left", category: "pan", ease: "expo.inOut" },
  { id: "whip-pan-right", name: "Whip Pan Right", category: "pan", ease: "expo.inOut" },
  {
    id: "isometric-3d-tilt-left",
    name: "Isometric 3D Tilt Left",
    category: "3d",
    ease: "power3.out",
  },
  {
    id: "isometric-3d-tilt-right",
    name: "Isometric 3D Tilt Right",
    category: "3d",
    ease: "power3.out",
  },
  { id: "crane-up-reveal", name: "Crane Up Reveal", category: "crane", ease: "power3.out" },
  { id: "crane-down-land", name: "Crane Down Land", category: "crane", ease: "power3.out" },
  { id: "orbit-float-cw", name: "Orbit Float CW", category: "3d", ease: "sine.inOut" },
  { id: "orbit-float-ccw", name: "Orbit Float CCW", category: "3d", ease: "sine.inOut" },
  { id: "push-pull-vertigo", name: "Push Pull Vertigo", category: "zoom", ease: "power2.inOut" },
  {
    id: "spotlight-cursor-200",
    name: "Spotlight Cursor 200%",
    category: "ui",
    ease: "power4.inOut",
  },
  { id: "bottom-left-cta-zoom", name: "Bottom Left CTA Zoom", category: "ui", ease: "expo.out" },
  { id: "top-right-badge-zoom", name: "Top Right Badge Zoom", category: "ui", ease: "expo.out" },
  { id: "bento-stagger-pop", name: "Bento Stagger Pop", category: "ui", ease: "power3.out" },
  { id: "split-slide-duet", name: "Split Slide Duet", category: "editorial", ease: "power3.inOut" },
  { id: "hero-lockoff", name: "Hero Lockoff", category: "static", ease: "none" },
  {
    id: "handheld-micro-drift",
    name: "Handheld Micro Drift",
    category: "cinema",
    ease: "sine.inOut",
  },
  { id: "snap-punch-135", name: "Snap Punch 135%", category: "zoom", ease: "expo.out" },
  { id: "glide-down-scroll", name: "Glide Down Scroll", category: "ui", ease: "power2.inOut" },
  { id: "glide-up-scroll", name: "Glide Up Scroll", category: "ui", ease: "power2.inOut" },
  { id: "flip-card-reveal", name: "Flip Card Reveal", category: "3d", ease: "power3.out" },
  { id: "outro-dock-left", name: "Outro Dock Left", category: "editorial", ease: "power3.out" },
]);

const FALLBACK_COLOR_LOOKS = Object.freeze([
  {
    id: "clean-commercial",
    name: "Clean Commercial",
    ffmpegFilter: "eq=contrast=1.04:saturation=1.06:brightness=0.01",
  },
  {
    id: "kodak-2383-warm",
    name: "Kodak 2383 Warm",
    ffmpegFilter: "eq=contrast=1.08:saturation=1.1,colorbalance=rs=0.04:gs=0.01:bs=-0.04",
  },
  {
    id: "emerald-vibrant",
    name: "Emerald Vibrant",
    ffmpegFilter: "eq=contrast=1.07:saturation=1.16,colorbalance=gm=0.05:bm=0.02",
  },
  {
    id: "teal-orange-cinema",
    name: "Teal & Orange Cinema",
    ffmpegFilter: "eq=contrast=1.1:saturation=1.12,colorbalance=rs=-0.05:bs=0.06:rh=0.06:bh=-0.05",
  },
  {
    id: "apple-keynote-crisp",
    name: "Apple Keynote Crisp",
    ffmpegFilter: "eq=contrast=1.06:saturation=1.04,unsharp=5:5:0.6:5:5:0.0",
  },
  {
    id: "matte-editorial",
    name: "Matte Editorial",
    ffmpegFilter: "eq=contrast=0.96:saturation=0.92:brightness=0.02",
  },
  {
    id: "cyber-neon",
    name: "Cyber Neon",
    ffmpegFilter: "eq=contrast=1.14:saturation=1.24,colorbalance=bm=0.06:rh=0.04",
  },
  {
    id: "vintage-16mm-grain",
    name: "Vintage 16mm Grain",
    ffmpegFilter: "eq=contrast=1.05:saturation=0.9,noise=alls=8:allf=t,vignette=PI/6",
  },
  {
    id: "warm-golden-hour",
    name: "Warm Golden Hour",
    ffmpegFilter: "eq=contrast=1.06:saturation=1.12,colorbalance=rm=0.06:gm=0.03:bm=-0.05",
  },
  {
    id: "noir-high-contrast",
    name: "Noir High Contrast",
    ffmpegFilter: "eq=contrast=1.24:saturation=0.25,vignette=PI/5",
  },
]);

const FALLBACK_CAPTION_STYLES = Object.freeze([
  {
    id: "kinetic-gold-pop",
    name: "Kinetic Gold Pop",
    textColor: "#FFFFFF",
    accentColor: "#FACC15",
  },
  {
    id: "blur-morph-chest",
    name: "Blur Morph Chest",
    textColor: "#FFFFFF",
    accentColor: "#38BDF8",
  },
  {
    id: "minimal-editorial-rail",
    name: "Minimal Editorial Rail",
    textColor: "#F8FAFC",
    accentColor: "#2ECC71",
  },
  {
    id: "karaoke-word-pill",
    name: "Karaoke Word Pill",
    textColor: "#FFFFFF",
    accentColor: "#F59E0B",
  },
  {
    id: "bengali-emerald-card",
    name: "Bengali Emerald Card",
    textColor: "#FFFFFF",
    accentColor: "#34D399",
  },
  {
    id: "clean-cinema-sub",
    name: "Clean Cinema Sub",
    textColor: "#FFFFFF",
    accentColor: "#E2E8F0",
  },
]);

const FALLBACK_SFX_CATALOG = Object.freeze([
  { id: "cinema-whoosh", name: "Cinema Whoosh", freq: 240, duration: 0.34 },
  { id: "whip-swish", name: "Whip Swish", freq: 520, duration: 0.22 },
  { id: "sub-bass-drop", name: "Sub Bass Drop", freq: 68, duration: 0.55 },
  { id: "ui-pop", name: "UI Pop", freq: 740, duration: 0.14 },
  { id: "glass-ping", name: "Glass Ping", freq: 1320, duration: 0.32 },
  { id: "camera-shutter", name: "Camera Shutter", freq: 920, duration: 0.12 },
  { id: "riser-build", name: "Riser Build", freq: 420, duration: 0.65 },
  { id: "confetti-chime", name: "Confetti Chime", freq: 1046, duration: 0.38 },
  { id: "keyboard-tap", name: "Keyboard Tap", freq: 620, duration: 0.09 },
  { id: "soft-click", name: "Soft Click", freq: 480, duration: 0.08 },
  { id: "card-slide", name: "Card Slide", freq: 340, duration: 0.24 },
  { id: "success-chord", name: "Success Chord", freq: 880, duration: 0.45 },
]);

const FALLBACK_ARCHETYPES = Object.freeze([
  { id: "device-3d-showcase", name: "Device 3D Showcase" },
  { id: "spotlight-cursor-zoom", name: "Spotlight Cursor Zoom" },
  { id: "split-editorial", name: "Split Editorial" },
  { id: "bento-feature-grid", name: "Bento Feature Grid" },
  { id: "fullbleed-cinema", name: "Fullbleed Cinema" },
  { id: "kinetic-statement-card", name: "Kinetic Statement Card" },
  { id: "before-after-wipe", name: "Before After Wipe" },
  { id: "metric-counter-wall", name: "Metric Counter Wall" },
  { id: "depth-text-behind-speaker", name: "Depth Text Behind Speaker" },
  { id: "podcast-dual-split", name: "Podcast Dual Split" },
  { id: "hook-scroll-stopper", name: "Hook Scroll Stopper" },
  { id: "product-price-reveal", name: "Product Price Reveal" },
]);

export const FALLBACK_CATALOG = Object.freeze({
  cameraBodies: FALLBACK_CAMERA_BODIES,
  lenses: FALLBACK_LENSES,
  apertures: FALLBACK_APERTURES,
  cameraPresets: FALLBACK_CAMERA_PRESETS,
  colorLooks: FALLBACK_COLOR_LOOKS,
  captionStyles: FALLBACK_CAPTION_STYLES,
  sfxCatalog: FALLBACK_SFX_CATALOG,
  archetypes: FALLBACK_ARCHETYPES,
});

function defaultSendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function defaultSendError(res, status, message) {
  defaultSendJson(res, status, { ok: false, error: message });
}

function defaultReadJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += buf.length;
      if (total > maxBytes) {
        reject(new Error("Request payload too large"));
        req.destroy?.();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function defaultImportModule(specifier) {
  return import(new URL(specifier, import.meta.url).href);
}

async function safeImport(specifier, deps = {}) {
  const importer =
    typeof deps.importModule === "function" ? deps.importModule : defaultImportModule;
  try {
    return await importer(specifier);
  } catch {
    return null;
  }
}

function normalizeCatalogList(raw, fallback) {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((item) => {
      if (typeof item === "string") {
        return { id: item, name: item };
      }
      if (item && typeof item === "object") {
        const id = String(item.id || item.key || item.slug || item.name || "");
        return id ? { ...item, id } : { ...item };
      }
      return item;
    });
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const keys = Object.keys(raw);
    if (keys.length > 0) {
      return keys.map((key) => {
        const val = raw[key];
        if (val && typeof val === "object") {
          return { id: key, ...val };
        }
        return { id: key, name: String(val ?? key) };
      });
    }
  }
  return [...fallback];
}

function extractKnownIds(catalogSource, fallbackList) {
  const normalized = normalizeCatalogList(catalogSource, fallbackList);
  return new Set(normalized.map((entry) => String(entry.id || entry.name || "")).filter(Boolean));
}

function resolveProjectDir(slug, deps = {}) {
  if (!slug || !SAFE_ID_RE.test(slug)) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  if (deps.projectsDir) {
    const root = path.resolve(deps.projectsDir);
    const resolved = path.resolve(root, slug);
    if (!resolved.startsWith(root + path.sep)) {
      throw new Error(`Unsafe project path: ${slug}`);
    }
    return resolved;
  }
  return assertValidSlug(slug);
}

function buildMediaUrl(slug, relPath) {
  const cleanRel = String(relPath || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
  const encodedRel = cleanRel.split("/").map(encodeURIComponent).join("/");
  return `/media/${encodeURIComponent(slug)}/${encodedRel}`;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function maybeSyncManifest(slug, deps = {}) {
  if (deps.syncManifest === false) return null;
  if (typeof deps.syncProjectManifest === "function") {
    return deps.syncProjectManifest(slug);
  }
  if (deps.projectsDir && path.resolve(deps.projectsDir) !== path.resolve(PROJECTS_DIR)) {
    return null;
  }
  try {
    return await syncProjectManifest(slug);
  } catch {
    return null;
  }
}

function escapeHtml(val) {
  return String(val ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fallbackAlignScriptToWordTimings({
  scriptText = "",
  startTime = 0,
  durationSeconds = 10,
  whisperSegments = null,
  maxWordsPerPhrase = 5,
}) {
  if (Array.isArray(whisperSegments) && whisperSegments.length > 0) {
    const phrases = whisperSegments
      .map((seg, idx) => {
        const text = String(seg.text || "").trim();
        if (!text) return null;
        const start = Number(seg.start ?? startTime);
        const end = Math.max(start + 0.2, Number(seg.end ?? start + 1.5));
        const rawWords = text.split(/\s+/).filter(Boolean);
        const span = end - start;
        const totalWeight = Math.max(
          1,
          rawWords.reduce((sum, w) => sum + Math.max(1, [...w].length), 0),
        );
        let cursor = start;
        const words = rawWords.map((word, wIdx) => {
          const wStart = Math.round(cursor * 100) / 100;
          const share = (Math.max(1, [...word].length) / totalWeight) * span;
          cursor = wIdx === rawWords.length - 1 ? end : cursor + share;
          return {
            word,
            start: wStart,
            end: Math.round(cursor * 100) / 100,
          };
        });
        const longest =
          [...rawWords].sort((a, b) => [...b].length - [...a].length)[0] || rawWords[0];
        return {
          index: idx,
          text,
          highlightWord: longest || "",
          start: Math.round(start * 100) / 100,
          end: Math.round(end * 100) / 100,
          words,
        };
      })
      .filter(Boolean);
    return { phrases };
  }

  const tokens = String(scriptText || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return { phrases: [] };
  }

  const limit = Math.max(1, Number(maxWordsPerPhrase) || 5);
  const groups = [];
  for (let i = 0; i < tokens.length; i += limit) {
    groups.push(tokens.slice(i, i + limit));
  }

  const totalDur = Math.max(0.5, Number(durationSeconds) || 10);
  const groupWeights = groups.map((g) =>
    g.reduce((sum, word) => sum + Math.max(1, [...word].length), 0),
  );
  const allWeight = Math.max(
    1,
    groupWeights.reduce((sum, w) => sum + w, 0),
  );

  let cursor = Number(startTime) || 0;
  const phrases = groups.map((groupWords, idx) => {
    const pStart = cursor;
    const pDur = (groupWeights[idx] / allWeight) * totalDur;
    const pEnd = idx === groups.length - 1 ? (Number(startTime) || 0) + totalDur : pStart + pDur;
    cursor = pEnd;

    let wordCursor = pStart;
    const gWeight = Math.max(1, groupWeights[idx]);
    const words = groupWords.map((word, wIdx) => {
      const wStart = Math.round(wordCursor * 100) / 100;
      const wShare = (Math.max(1, [...word].length) / gWeight) * (pEnd - pStart);
      wordCursor = wIdx === groupWords.length - 1 ? pEnd : wordCursor + wShare;
      return {
        word,
        start: wStart,
        end: Math.round(wordCursor * 100) / 100,
      };
    });

    const highlightWord =
      [...groupWords].sort((a, b) => [...b].length - [...a].length)[0] || groupWords[0];

    return {
      index: idx,
      text: groupWords.join(" "),
      highlightWord,
      start: Math.round(pStart * 100) / 100,
      end: Math.round(pEnd * 100) / 100,
      words,
    };
  });

  return { phrases };
}

function fallbackRenderCaptionsSubComposition({
  compositionId = "captions-track",
  width = 1080,
  height = 1920,
  totalDuration = 10,
  styleId = "kinetic-gold-pop",
  phrases = [],
  brandColors = {},
}) {
  const stylePreset =
    FALLBACK_CAPTION_STYLES.find((s) => s.id === styleId) || FALLBACK_CAPTION_STYLES[0];
  const accent = brandColors?.accent || stylePreset.accentColor || "#FACC15";
  const dur = Math.max(0.5, Number(totalDuration) || 10);
  const fontSize = width >= height ? 44 : 50;

  const phraseElements = phrases
    .map((phrase, idx) => {
      const start = Math.max(0, Number(phrase.start || 0));
      const end = Math.max(start + 0.2, Number(phrase.end || start + 1.5));
      const clipDur = Math.round((end - start) * 100) / 100;
      const wordsHtml = String(phrase.text || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => {
          const isHighlight = phrase.highlightWord && w === phrase.highlightWord;
          return isHighlight
            ? `<span class="cap-word cap-highlight">${escapeHtml(w)}</span>`
            : `<span class="cap-word">${escapeHtml(w)}</span>`;
        })
        .join(" ");

      return `      <div id="${compositionId}-phrase-${idx}" class="clip cap-phrase" data-start="${start}" data-duration="${clipDur}">
        <p class="cap-card">${wordsHtml}</p>
      </div>`;
    })
    .join("\n");

  const tweenLines = phrases
    .map((phrase, idx) => {
      const start = Math.max(0, Number(phrase.start || 0));
      const enterDur = Math.min(
        0.24,
        Math.max(0.08, (Number(phrase.end || start + 1) - start) * 0.25),
      );
      return `        tl.fromTo("#${compositionId}-phrase-${idx} .cap-card", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: ${enterDur.toFixed(2)}, ease: "power3.out" }, ${start.toFixed(2)});`;
    })
    .join("\n");

  return `<template id="${compositionId}-template">
  <div
    data-composition-id="${compositionId}"
    data-width="${width}"
    data-height="${height}"
    data-duration="${dur}"
  >
    <style>
      [data-composition-id="${compositionId}"] {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        pointer-events: none;
        font-family: "Inter", sans-serif;
      }
      [data-composition-id="${compositionId}"] .cap-phrase {
        position: absolute;
        left: 10%;
        right: 10%;
        bottom: 12%;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      [data-composition-id="${compositionId}"] .cap-card {
        background: #0a1410;
        color: #ffffff;
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-radius: 20px;
        padding: 16px 28px;
        font-size: ${fontSize}px;
        font-weight: 800;
        line-height: 1.24;
        text-align: center;
      }
      [data-composition-id="${compositionId}"] .cap-highlight {
        color: ${accent};
      }
    </style>
${phraseElements}
    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });
${tweenLines}
        tl.to({}, { duration: 0.1 }, ${Math.max(0, dur - 0.1).toFixed(2)});
        window.__timelines = window.__timelines || {};
        window.__timelines["${compositionId}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

function fallbackBuildAntigravityBatchManifest({
  slug,
  storyboard,
  brandKit,
  aspectRatio = "9:16",
}) {
  const frames = Array.isArray(storyboard?.frames) ? storyboard.frames : [];
  const palette = Array.isArray(brandKit?.extractedPalette) ? brandKit.extractedPalette : [];
  const tone = brandKit?.tone || "Confident & Modern";

  const shots = frames.map((frame, idx) => {
    const frameId = frame.id || `frame_${String(idx + 1).padStart(2, "0")}`;
    const headline = frame.staging?.headline || frame.title || `Shot ${idx + 1}`;
    const motion = frame.motionPreset || "crash-zoom-in";
    const voText = frame.audioSpec?.voiceoverText || "";
    return {
      frameId,
      index: frame.index || idx + 1,
      locked: Boolean(frame.locked),
      aspectRatio,
      imageGeneratorBrief: {
        backend: "antigravity-image-generator",
        prompt: `Editorial cinema background plate for "${headline}", tone ${tone}, palette ${palette.join(", ") || "#1E824C, #F1C40F"}, clean negative space for UI overlay, aspect ${aspectRatio}, zero text watermarks.`,
        outputRelPath: `.studio/frames/design/${frameId}_plate.png`,
      },
      googleFlowBrief: {
        backend: "google-flow-browser",
        targetUrl: "https://labs.google/fx/tools/flow",
        motionPreset: motion,
        startFrameImage: frame.keyframes?.start || frame.designFramePath || null,
        endFrameImage: frame.keyframes?.end || frame.designFramePath || null,
        prompt: `Smooth ${motion} camera move showcasing "${headline}" in ${aspectRatio}.`,
        downloadTargetRelPath: `inbox/raw-video/flow_${frameId}.mp4`,
      },
      audioBrief: {
        backend: "edge-tts-neural",
        voiceoverText: voText,
        sfx: Array.isArray(frame.audioSpec?.sfx) ? frame.audioSpec.sfx : ["ui-pop"],
      },
    };
  });

  return {
    schemaVersion: 1,
    slug,
    costMode: "subscription-zero-dollar",
    aspectRatio,
    generatedAt: new Date().toISOString(),
    shotCount: shots.length,
    shots,
  };
}

export async function loadCatalogPresets(deps = {}) {
  const [cameraRigs, colorGrade, captionsEngine, soundEngine] = await Promise.all([
    deps.cameraRigs
      ? Promise.resolve(deps.cameraRigs)
      : safeImport("./presets/camera-rigs.mjs", deps),
    deps.colorGrade ? Promise.resolve(deps.colorGrade) : safeImport("./color-grade.mjs", deps),
    deps.captionsEngine
      ? Promise.resolve(deps.captionsEngine)
      : safeImport("./captions-engine.mjs", deps),
    deps.soundEngine ? Promise.resolve(deps.soundEngine) : safeImport("./sound-engine.mjs", deps),
  ]);

  let packModules = null;
  if (Array.isArray(deps.archetypePacks)) {
    packModules = deps.archetypePacks;
  } else {
    packModules = await Promise.all([
      safeImport("./templates/pack-device-spotlight.mjs", deps),
      safeImport("./templates/pack-editorial-bento.mjs", deps),
      safeImport("./templates/pack-cinema-statement.mjs", deps),
      safeImport("./templates/pack-wipe-metrics.mjs", deps),
      safeImport("./templates/pack-behind-speaker.mjs", deps),
      safeImport("./templates/pack-social-hooks.mjs", deps),
    ]);
  }

  const collectedArchetypes = [];
  const seenArchetypeIds = new Set();
  for (const mod of packModules) {
    if (!mod?.ARCHETYPES) continue;
    const list = normalizeCatalogList(mod.ARCHETYPES, []);
    for (const item of list) {
      const id = String(item.id || "");
      if (id && !seenArchetypeIds.has(id)) {
        seenArchetypeIds.add(id);
        collectedArchetypes.push(item);
      }
    }
  }

  if (collectedArchetypes.length === 0) {
    for (const fallbackArch of FALLBACK_ARCHETYPES) {
      collectedArchetypes.push({ ...fallbackArch });
    }
  } else if (!Array.isArray(deps.archetypePacks)) {
    // Fill in any shard still being written so all 8 archetypes remain discoverable
    for (const fallbackArch of FALLBACK_ARCHETYPES) {
      if (!seenArchetypeIds.has(fallbackArch.id)) {
        seenArchetypeIds.add(fallbackArch.id);
        collectedArchetypes.push({ ...fallbackArch });
      }
    }
  }

  return {
    cameraBodies: normalizeCatalogList(
      cameraRigs?.CAMERA_BODIES ?? cameraRigs?.cameraBodies,
      FALLBACK_CAMERA_BODIES,
    ),
    lenses: normalizeCatalogList(
      cameraRigs?.LENS_FOCAL_LENGTHS ?? cameraRigs?.LENSES ?? cameraRigs?.lenses,
      FALLBACK_LENSES,
    ),
    apertures: normalizeCatalogList(
      cameraRigs?.APERTURE_STOPS ?? cameraRigs?.APERTURES ?? cameraRigs?.apertures,
      FALLBACK_APERTURES,
    ),
    cameraPresets: normalizeCatalogList(
      cameraRigs?.DOP_CAMERA_PRESETS ?? cameraRigs?.CAMERA_PRESETS ?? cameraRigs?.cameraPresets,
      FALLBACK_CAMERA_PRESETS,
    ),
    colorLooks: normalizeCatalogList(
      colorGrade?.COLOR_LOOKS ?? colorGrade?.colorLooks,
      FALLBACK_COLOR_LOOKS,
    ),
    captionStyles: normalizeCatalogList(
      captionsEngine?.CAPTION_STYLES ?? captionsEngine?.captionStyles,
      FALLBACK_CAPTION_STYLES,
    ),
    sfxCatalog: normalizeCatalogList(
      soundEngine?.SFX_CATALOG ?? soundEngine?.sfxCatalog,
      FALLBACK_SFX_CATALOG,
    ),
    archetypes: collectedArchetypes,
  };
}

export async function handleProRoutes(req, res, urlObj, deps = {}) {
  const parsedUrl = urlObj || new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const method = (req.method || "GET").toUpperCase();

  const sendJson = deps.sendJson || defaultSendJson;
  const sendError = deps.sendError || defaultSendError;
  const readJsonBody = deps.readJsonBody || defaultReadJsonBody;

  // 1. GET /api/catalog/presets
  if (pathname === "/api/catalog/presets") {
    if (method !== "GET") {
      sendError(res, 405, `Method ${method} not allowed for /api/catalog/presets`);
      return true;
    }
    try {
      const catalog = await loadCatalogPresets(deps);
      sendJson(res, 200, { ok: true, ...catalog });
    } catch (err) {
      sendError(res, 500, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  // Check if pathname matches a project-scoped Pro route
  const projMatch = pathname.match(/^\/api\/projects\/([^/]+)\/(.+)$/);
  if (!projMatch) {
    return false;
  }

  let slug = "";
  try {
    slug = decodeURIComponent(projMatch[1]);
  } catch {
    sendError(res, 400, "Malformed project slug encoding");
    return true;
  }

  const subRoute = projMatch[2];
  if (!PRO_PROJECT_SUBROUTES.has(subRoute)) {
    return false;
  }

  let projectDir = "";
  try {
    projectDir = resolveProjectDir(slug, deps);
  } catch (err) {
    sendError(res, 400, err instanceof Error ? err.message : "Invalid project slug");
    return true;
  }

  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    sendError(res, 404, `Project not found: ${slug}`);
    return true;
  }

  if (method !== "POST") {
    sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
    return true;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendError(res, 400, err instanceof Error ? err.message : "Invalid request body");
    return true;
  }

  try {
    // 2. POST /api/projects/:slug/preview-sfx
    if (subRoute === "preview-sfx") {
      const sfxId = String(body.sfxId || body.id || "").trim();
      if (!sfxId || !SAFE_ID_RE.test(sfxId)) {
        sendError(res, 400, "Valid sfxId is required");
        return true;
      }

      const soundEngine =
        deps.soundEngine || (await safeImport("./sound-engine.mjs", deps)) || null;
      const knownSfxIds = extractKnownIds(soundEngine?.SFX_CATALOG, FALLBACK_SFX_CATALOG);
      if (!knownSfxIds.has(sfxId)) {
        sendError(res, 400, `Unknown sfxId: ${sfxId}`);
        return true;
      }

      const relPath = `assets/audio/sfx_${sfxId}.mp3`;
      const outPath = path.resolve(projectDir, relPath);
      if (!outPath.startsWith(projectDir + path.sep)) {
        sendError(res, 403, "Unsafe output path");
        return true;
      }
      fs.mkdirSync(path.dirname(outPath), { recursive: true });

      if (typeof soundEngine?.synthesizeSfx === "function") {
        await soundEngine.synthesizeSfx({ sfxId, outPath });
      } else {
        const spec = FALLBACK_SFX_CATALOG.find((item) => item.id === sfxId) || {
          freq: 660,
          duration: 0.22,
        };
        const dur = Number(spec.duration) || 0.22;
        const fadeOutStart = Math.max(0.02, dur * 0.45).toFixed(2);
        const fadeOutDur = Math.max(0.04, dur * 0.5).toFixed(2);
        const cmdRes = await runCommand(
          "ffmpeg",
          [
            "-y",
            "-f",
            "lavfi",
            "-i",
            `sine=frequency=${spec.freq}:duration=${dur}`,
            "-af",
            `afade=t=in:st=0:d=0.01,afade=t=out:st=${fadeOutStart}:d=${fadeOutDur},volume=0.35`,
            "-c:a",
            "libmp3lame",
            "-q:a",
            "4",
            outPath,
          ],
          { env: getToolEnv(), shell: false },
        );
        if (cmdRes.code !== 0) {
          sendError(res, 500, `SFX synthesis failed: ${(cmdRes.stderr || cmdRes.stdout).trim()}`);
          return true;
        }
      }

      if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
        sendError(res, 500, `SFX output was not created for ${sfxId}`);
        return true;
      }

      const stat = fs.statSync(outPath);
      await maybeSyncManifest(slug, deps);
      const mediaUrl = buildMediaUrl(slug, relPath);

      sendJson(res, 200, {
        ok: true,
        slug,
        sfxId,
        relPath,
        url: mediaUrl,
        audioUrl: mediaUrl,
        sizeBytes: stat.size,
      });
      return true;
    }

    // 3. POST /api/projects/:slug/color-grade
    if (subRoute === "color-grade") {
      const lookId = String(body.lookId || body.look || "clean-commercial").trim();
      if (!lookId || !SAFE_ID_RE.test(lookId)) {
        sendError(res, 400, "Valid lookId is required");
        return true;
      }

      const rawInputRel = String(
        body.relPath ||
          body.inputRelPath ||
          body.sourceRelPath ||
          body.clipPath ||
          body.imagePath ||
          "",
      )
        .trim()
        .replaceAll("\\", "/");

      if (!rawInputRel) {
        sendError(res, 400, "relPath (clip or keyframe image) is required");
        return true;
      }
      if (rawInputRel.includes("..") || path.isAbsolute(rawInputRel)) {
        sendError(res, 403, "Unsafe input path");
        return true;
      }

      const inputPath = path.resolve(projectDir, rawInputRel.replace(/^\/+/, ""));
      if (!inputPath.startsWith(projectDir + path.sep)) {
        sendError(res, 403, "Input path escapes project directory");
        return true;
      }
      if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
        sendError(res, 404, `Source media file not found: ${rawInputRel}`);
        return true;
      }

      const ext = path.extname(inputPath).toLowerCase();
      const mediaType = VIDEO_EXTS.has(ext) ? "video" : IMAGE_EXTS.has(ext) ? "image" : null;
      if (!mediaType) {
        sendError(res, 400, `Unsupported media extension for color grading: ${ext}`);
        return true;
      }

      const colorGrade = deps.colorGrade || (await safeImport("./color-grade.mjs", deps)) || null;
      const knownLooks = extractKnownIds(colorGrade?.COLOR_LOOKS, FALLBACK_COLOR_LOOKS);
      if (!knownLooks.has(lookId)) {
        sendError(res, 400, `Unknown lookId: ${lookId}`);
        return true;
      }

      let outputRelPath = "";
      if (body.outputRelPath) {
        const cleanOut = String(body.outputRelPath).trim().replaceAll("\\", "/");
        if (cleanOut.includes("..") || path.isAbsolute(cleanOut)) {
          sendError(res, 403, "Unsafe outputRelPath");
          return true;
        }
        outputRelPath = cleanOut.replace(/^\/+/, "");
      } else {
        const stem = sanitizeFilename(path.basename(inputPath, ext));
        outputRelPath =
          mediaType === "video"
            ? `assets/clips/${stem}_${lookId}.mp4`
            : `assets/images/${stem}_${lookId}${ext}`;
      }

      const outputPath = path.resolve(projectDir, outputRelPath);
      if (!outputPath.startsWith(projectDir + path.sep)) {
        sendError(res, 403, "Output path escapes project directory");
        return true;
      }
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      const fps = Number(body.fps) || 30;
      const fallbackLook =
        FALLBACK_COLOR_LOOKS.find((l) => l.id === lookId) || FALLBACK_COLOR_LOOKS[0];

      if (mediaType === "video") {
        if (typeof colorGrade?.applyColorLookToVideo === "function") {
          await colorGrade.applyColorLookToVideo({ inputPath, outputPath, lookId, fps });
        } else {
          const cmdRes = await runCommand(
            "ffmpeg",
            [
              "-y",
              "-i",
              inputPath,
              "-vf",
              fallbackLook.ffmpegFilter,
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
              "-c:a",
              "copy",
              outputPath,
            ],
            { env: getToolEnv(), shell: false },
          );
          if (cmdRes.code !== 0) {
            sendError(
              res,
              500,
              `Video color grade failed: ${(cmdRes.stderr || cmdRes.stdout).trim()}`,
            );
            return true;
          }
        }
      } else if (typeof colorGrade?.applyColorLookToImage === "function") {
        await colorGrade.applyColorLookToImage({ inputPath, outputPath, lookId });
      } else {
        const cmdRes = await runCommand(
          "ffmpeg",
          ["-y", "-i", inputPath, "-vf", fallbackLook.ffmpegFilter, "-frames:v", "1", outputPath],
          { env: getToolEnv(), shell: false },
        );
        if (cmdRes.code !== 0) {
          sendError(
            res,
            500,
            `Image color grade failed: ${(cmdRes.stderr || cmdRes.stdout).trim()}`,
          );
          return true;
        }
      }

      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        sendError(res, 500, "Color graded output file was not produced");
        return true;
      }

      await maybeSyncManifest(slug, deps);
      const mediaUrl = buildMediaUrl(slug, outputRelPath);

      sendJson(res, 200, {
        ok: true,
        slug,
        lookId,
        mediaType,
        inputRelPath: rawInputRel,
        outputRelPath,
        relPath: outputRelPath,
        url: mediaUrl,
      });
      return true;
    }

    // 4. POST /api/projects/:slug/captions/generate
    if (subRoute === "captions/generate") {
      const styleId = String(body.styleId || body.style || "kinetic-gold-pop").trim();
      if (!styleId || !SAFE_ID_RE.test(styleId)) {
        sendError(res, 400, "Valid styleId is required");
        return true;
      }

      const compositionId = String(body.compositionId || "captions-track").trim();
      if (!compositionId || !SAFE_ID_RE.test(compositionId)) {
        sendError(res, 400, "Valid compositionId is required");
        return true;
      }

      const captionsEngine =
        deps.captionsEngine || (await safeImport("./captions-engine.mjs", deps)) || null;
      const knownStyles = extractKnownIds(captionsEngine?.CAPTION_STYLES, FALLBACK_CAPTION_STYLES);
      if (!knownStyles.has(styleId)) {
        sendError(res, 400, `Unknown caption styleId: ${styleId}`);
        return true;
      }

      const brief = readJsonIfExists(path.join(projectDir, "PROJECT_BRIEF.json")) || {};
      const storyboard = readJsonIfExists(path.join(projectDir, "STORYBOARD.json"));

      let scriptText = String(body.scriptText ?? body.script ?? body.text ?? "").trim();
      const whisperSegments = Array.isArray(body.whisperSegments) ? body.whisperSegments : null;

      if (!scriptText && (!whisperSegments || whisperSegments.length === 0) && storyboard?.frames) {
        scriptText = storyboard.frames
          .map((f) => f.audioSpec?.voiceoverText || f.staging?.captionText || "")
          .map((s) => String(s).trim())
          .filter(Boolean)
          .join(" ");
      }

      if (!scriptText && (!whisperSegments || whisperSegments.length === 0)) {
        sendError(res, 400, "scriptText or whisperSegments is required to generate captions");
        return true;
      }

      const width = Number(body.width) || Number(brief.width) || 1080;
      const height = Number(body.height) || Number(brief.height) || 1920;
      const durationSeconds =
        Number(body.durationSeconds || body.totalDuration) ||
        Number(storyboard?.totalDurationSeconds) ||
        Number(brief.durationSeconds) ||
        12;
      const startTime = Number(body.startTime) || 0;
      const maxWordsPerPhrase = Number(body.maxWordsPerPhrase) || 5;
      const brandColors = { ...(brief.brandColors || {}), ...(body.brandColors || {}) };

      const alignFn =
        typeof captionsEngine?.alignScriptToWordTimings === "function"
          ? captionsEngine.alignScriptToWordTimings
          : fallbackAlignScriptToWordTimings;
      const aligned = await alignFn({
        scriptText,
        startTime,
        durationSeconds,
        whisperSegments,
        maxWordsPerPhrase,
      });
      const phrases = Array.isArray(aligned?.phrases)
        ? aligned.phrases
        : Array.isArray(aligned)
          ? aligned
          : [];

      const renderFn =
        typeof captionsEngine?.renderCaptionsSubComposition === "function"
          ? captionsEngine.renderCaptionsSubComposition
          : fallbackRenderCaptionsSubComposition;
      const html = await renderFn({
        compositionId,
        width,
        height,
        totalDuration: durationSeconds,
        styleId,
        phrases,
        brandColors,
      });

      const relPath = "compositions/captions-track.html";
      const outPath = path.resolve(projectDir, relPath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, String(html), "utf8");

      sendJson(res, 200, {
        ok: true,
        slug,
        styleId,
        compositionId,
        relPath,
        url: buildMediaUrl(slug, relPath),
        phraseCount: phrases.length,
        phrases,
        totalDuration: durationSeconds,
      });
      return true;
    }

    // 5. POST /api/projects/:slug/google-multimodal-plan
    if (subRoute === "google-multimodal-plan") {
      if (!deps.projectsDir || path.resolve(deps.projectsDir) === path.resolve(PROJECTS_DIR)) {
        ensureProjectDirs(slug);
      }

      const brief = readJsonIfExists(path.join(projectDir, "PROJECT_BRIEF.json")) || {
        slug,
        aspectRatio: "9:16",
        width: 1080,
        height: 1920,
        brandColors: {},
        brandKit: {},
      };

      let storyboard =
        body.storyboard && typeof body.storyboard === "object" ? body.storyboard : null;
      if (!storyboard) {
        if (typeof deps.storyboard?.loadStoryboard === "function") {
          storyboard = deps.storyboard.loadStoryboard(slug);
        } else {
          storyboard = readJsonIfExists(path.join(projectDir, "STORYBOARD.json"));
        }
      }

      if (!storyboard) {
        if (body.requireStoryboard === true) {
          sendError(res, 404, `STORYBOARD.json not found for project: ${slug}`);
          return true;
        }
        storyboard = {
          schemaVersion: 1,
          slug,
          aspectRatio: brief.aspectRatio || "9:16",
          width: brief.width || 1080,
          height: brief.height || 1920,
          frames: [
            {
              id: "frame_01",
              index: 1,
              title: brief.title || slug,
              layout: "device-3d-showcase",
              motionPreset: "crash-zoom-in",
              durationSeconds: Number(brief.durationSeconds) || 6,
              locked: false,
              staging: { headline: brief.title || slug },
              audioSpec: { voiceoverText: brief.instructions || "" },
            },
          ],
        };
      }

      const brandKit = {
        ...(brief.brandKit || {}),
        ...(body.brandKit || {}),
      };
      const aspectRatio = String(
        body.aspectRatio || storyboard.aspectRatio || brief.aspectRatio || "9:16",
      ).trim();

      const playbook =
        deps.googleFlowPlaybook || (await safeImport("./google-flow-playbook.mjs", deps)) || null;
      const buildManifestFn =
        typeof playbook?.buildAntigravityBatchManifest === "function"
          ? playbook.buildAntigravityBatchManifest
          : fallbackBuildAntigravityBatchManifest;

      let rawResult;
      try {
        rawResult = await buildManifestFn({
          slug,
          storyboard,
          brandKit,
          aspectRatio,
          projectBrief: brief,
          ...(body.forcePaidApi !== undefined ? { forcePaidApi: Boolean(body.forcePaidApi) } : {}),
          ...(body.costMode !== undefined ? { costMode: body.costMode } : {}),
          ...(body.paidApiKey !== undefined ? { paidApiKey: body.paidApiKey } : {}),
          ...(body.externalApiKey !== undefined ? { externalApiKey: body.externalApiKey } : {}),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = /zeroCostGuard/i.test(msg) ? 403 : 400;
        sendError(res, status, msg);
        return true;
      }

      const basePlan =
        rawResult?.plan && typeof rawResult.plan === "object"
          ? rawResult.plan
          : rawResult?.manifest && typeof rawResult.manifest === "object"
            ? rawResult.manifest
            : rawResult && typeof rawResult === "object"
              ? rawResult
              : {};

      const plan = {
        ...basePlan,
        slug: basePlan.slug || slug,
        costMode: basePlan.costMode || "subscription-zero-dollar",
      };

      const planRelPath = ".studio/google-multimodal-plan.json";
      const planAbsPath = path.resolve(projectDir, planRelPath);
      fs.mkdirSync(path.dirname(planAbsPath), { recursive: true });
      fs.writeFileSync(planAbsPath, JSON.stringify(plan, null, 2) + "\n", "utf8");

      const shouldEnqueue = Boolean(body.enqueueTickets ?? body.enqueue ?? false);
      const enqueuedTickets = [];

      if (shouldEnqueue) {
        const agentBridge =
          deps.agentBridge || (await safeImport("./agent-bridge.mjs", deps)) || null;
        if (typeof agentBridge?.enqueueAgentTask !== "function") {
          sendError(res, 500, "agent-bridge enqueueAgentTask is unavailable");
          return true;
        }

        const lockedFrameIds = new Set(
          (Array.isArray(storyboard.frames) ? storyboard.frames : [])
            .filter((f) => Boolean(f.locked))
            .map((f) => String(f.id)),
        );

        const filterIds =
          Array.isArray(body.frameIds) || Array.isArray(body.shotIds)
            ? new Set([...(body.frameIds || []), ...(body.shotIds || [])].map(String))
            : null;

        const planEntries = Array.isArray(plan.shots)
          ? plan.shots
          : Array.isArray(plan.frames)
            ? plan.frames
            : Array.isArray(plan.items)
              ? plan.items
              : Array.isArray(storyboard.frames)
                ? storyboard.frames
                : [];

        const requestedTypes = Array.isArray(body.ticketTypes)
          ? body.ticketTypes.map(String)
          : [
              ...(body.includeImages === false ? [] : ["ai_generate_image_plate"]),
              ...(body.includeVideo === false ? [] : ["ai_google_flow_video"]),
            ];

        for (let i = 0; i < planEntries.length; i += 1) {
          const entry = planEntries[i] || {};
          const frameId = String(
            entry.frameId || entry.shotId || entry.id || `frame_${String(i + 1).padStart(2, "0")}`,
          );
          if (filterIds && !filterIds.has(frameId)) continue;
          const isLocked = Boolean(entry.locked) || lockedFrameIds.has(frameId);
          if (isLocked && !body.includeLocked) continue;

          for (const taskType of requestedTypes) {
            const payload = {
              frameId,
              planRelPath,
              ...(taskType === "ai_generate_image_plate" && entry.imageGeneratorBrief
                ? { imageGeneratorBrief: entry.imageGeneratorBrief }
                : {}),
              ...(taskType === "ai_google_flow_video" && entry.googleFlowBrief
                ? { googleFlowBrief: entry.googleFlowBrief }
                : {}),
              ...(body.forcePaidApi ? { forcePaidApi: true } : {}),
            };
            try {
              const ticket = agentBridge.enqueueAgentTask({ slug, type: taskType, payload });
              enqueuedTickets.push(ticket);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              const status = /zeroCostGuard/i.test(msg) ? 403 : 400;
              sendError(res, status, msg);
              return true;
            }
          }
        }
      }

      sendJson(res, 200, {
        ok: true,
        slug,
        planRelPath,
        relPath: planRelPath,
        plan,
        manifest: plan,
        ticketsEnqueued: enqueuedTickets.length,
        tickets: enqueuedTickets,
      });
      return true;
    }
  } catch (err) {
    if (!res.headersSent) {
      sendError(res, 500, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  return false;
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"]);
const PLACEHOLDER_HOST_RE =
  /\b(?:placehold\.co|placeholder\.com|placekitten\.com|picsum\.photos|example\.com|via\.placeholder\.com|dummyimage\.com)\b/i;

export const ARCHETYPES = Object.freeze([
  Object.freeze({
    id: "device-3d-showcase",
    name: "3D Device Showcase",
    category: "device-spotlight",
    pack: "pack-device-spotlight",
    description:
      "3D angled smartphone or browser bezel over an ambient brand glow with SVG dotted callout line, crisp dark callout card, and high-contrast gold badge.",
    supportedAspects: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    features: Object.freeze([
      "3d-bezel",
      "ambient-glow",
      "svg-dotted-callout",
      "callout-card",
      "gold-badge",
    ]),
    defaultDuration: 4.0,
    defaultDurationSeconds: 4.0,
  }),
  Object.freeze({
    id: "spotlight-cursor-zoom",
    name: "Spotlight Cursor Zoom",
    category: "device-spotlight",
    pack: "pack-device-spotlight",
    description:
      "Dimmed cinema stage with a bright spotlight frame, oversized macOS/touch cursor, click ripple ring, and optical zoom-to-target GSAP tween.",
    supportedAspects: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    features: Object.freeze([
      "dimmed-stage",
      "spotlight-frame",
      "oversized-cursor",
      "click-ripple",
      "zoom-to-target",
    ]),
    defaultDuration: 4.0,
    defaultDurationSeconds: 4.0,
  }),
]);

const ARCHETYPE_IDS = new Set(ARCHETYPES.map((entry) => entry.id));

export function getArchetypeById(archetypeId) {
  return ARCHETYPES.find((entry) => entry.id === archetypeId) || null;
}

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

function round3(num) {
  return Math.round(Number(num || 0) * 1000) / 1000;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeCompositionId(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "scene-01";
}

function sanitizeIdPrefix(compId) {
  const base = sanitizeCompositionId(compId).toLowerCase();
  return /^[a-z]/.test(base) ? base : `s-${base}`;
}

function sanitizeHexColor(raw, fallback) {
  const candidate = String(raw || "").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(candidate) ? candidate : fallback;
}

function normalizeAssetPath(raw, defaultSubdir = "clips") {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || PLACEHOLDER_HOST_RE.test(trimmed)) return null;
  if (/^data:(?:audio|video)\//i.test(trimmed)) return null;
  if (/^(?:https?:|blob:|data:image\/)/i.test(trimmed)) return null;

  const cleaned = trimmed.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..")) return null;
  if (cleaned.startsWith("assets/")) return cleaned;

  const strippedInbox = cleaned.replace(/^inbox\/[^/]+\//, "");
  return `assets/${defaultSubdir}/${strippedInbox.replace(/^\/+/, "")}`;
}

function hasVideoExt(assetPath) {
  if (!assetPath) return false;
  const clean = assetPath.split(/[?#]/)[0] || "";
  const dotIdx = clean.lastIndexOf(".");
  if (dotIdx === -1) return false;
  return VIDEO_EXTENSIONS.has(clean.slice(dotIdx).toLowerCase());
}

function extractShotDetails(shot = {}, archetypeId = "device-3d-showcase") {
  const s = shot && typeof shot === "object" ? shot : {};
  const staging = s.staging && typeof s.staging === "object" ? s.staging : {};
  const copy = s.copy && typeof s.copy === "object" ? s.copy : {};
  const cam =
    (staging.camera && typeof staging.camera === "object" ? staging.camera : null) ||
    (s.camera && typeof s.camera === "object" ? s.camera : null) ||
    (s.cameraMotion && typeof s.cameraMotion === "object" ? s.cameraMotion : null) ||
    {};

  const defaultBadge = archetypeId === "spotlight-cursor-zoom" ? "LIVE SPOTLIGHT" : "FEATURED";
  const defaultHeadline =
    archetypeId === "spotlight-cursor-zoom"
      ? "Precision Action Spotlight"
      : "3D Product Flagship Showcase";
  const defaultSub =
    archetypeId === "spotlight-cursor-zoom"
      ? "Guided pointer tap ignites crisp optical magnification onto your key workflow."
      : "Dimensional bezel framing paired with high-contrast callout telemetry.";

  const badge = String(
    s.badge || s.badgeText || staging.badge || staging.badgeText || copy.badge || defaultBadge,
  ).trim();
  const headline = String(
    s.headline || staging.headline || copy.headline || s.title || s.name || defaultHeadline,
  ).trim();
  const subheadline = String(
    s.subheadline || staging.subheadline || copy.subheadline || s.description || defaultSub,
  ).trim();

  const firstCallout =
    (Array.isArray(s.callouts) && s.callouts[0]) ||
    (Array.isArray(staging.calloutItems) && staging.calloutItems[0]) ||
    null;

  const calloutLabel = String(
    s.calloutLabel || staging.calloutLabel || firstCallout?.label || "VERIFIED FLOW",
  ).trim();
  const calloutValue = String(
    s.calloutValue || staging.calloutValue || firstCallout?.value || "99.8% Instant Sync",
  ).trim();
  const ctaText = String(s.ctaText || staging.ctaText || s.targetLabel || "Confirm Action").trim();

  const rawVideoCandidate =
    s.videoSrc ||
    s.clipRelPath ||
    s.clipSrc ||
    s.clip_src ||
    staging.videoSrc ||
    (hasVideoExt(String(s.sourceClip || "")) ? s.sourceClip : null) ||
    null;

  const rawImageCandidate =
    s.imageSrc ||
    s.plateRelPath ||
    s.plateImage ||
    staging.imageSrc ||
    staging.plateImage ||
    staging.aiBackgroundPlate ||
    s.keyframeSrc ||
    null;

  const videoSrc = hasVideoExt(rawVideoCandidate)
    ? normalizeAssetPath(rawVideoCandidate, "clips")
    : null;
  const imageSrc = !videoSrc ? normalizeAssetPath(rawImageCandidate, "images") : null;

  const deviceType =
    String(s.deviceType || staging.deviceType || "").toLowerCase() === "browser"
      ? "browser"
      : "phone";

  let rawFocusX = Number(cam.focusX);
  if (!Number.isFinite(rawFocusX)) rawFocusX = 54;
  else if (rawFocusX <= 1) rawFocusX = rawFocusX * 100;

  let rawFocusY = Number(cam.focusY);
  if (!Number.isFinite(rawFocusY)) rawFocusY = 46;
  else if (rawFocusY <= 1) rawFocusY = rawFocusY * 100;

  return {
    badge,
    headline,
    subheadline,
    calloutLabel,
    calloutValue,
    ctaText,
    videoSrc,
    imageSrc,
    deviceType,
    camera: {
      fromScale: clamp(Number(cam.fromScale) || 0.96, 0.75, 1.8),
      toScale: clamp(Number(cam.toScale) || 1.42, 1.04, 2.2),
      panX: clamp(Number(cam.panX) || 0, -60, 60),
      panY: clamp(Number(cam.panY) || 0, -60, 60),
      tiltDeg: clamp(Number(cam.tiltDeg) || -10, -22, 22),
      focusX: clamp(rawFocusX, 24, 76),
      focusY: clamp(rawFocusY, 24, 76),
    },
  };
}

function renderScreenMediaMarkup({ pfx, details, dur, primary, secondary }) {
  if (details.videoSrc) {
    return `<video id="${pfx}-video" class="clip ${pfx}-screen-media" src="${escapeHtml(details.videoSrc)}" data-start="0" data-duration="${dur}" data-track-index="1" muted playsinline></video>`;
  }
  if (details.imageSrc) {
    return `<img id="${pfx}-image" class="${pfx}-screen-media" src="${escapeHtml(details.imageSrc)}" alt="${escapeHtml(details.headline)}" />`;
  }
  return `<div id="${pfx}-synth-ui" class="${pfx}-synth-ui" data-layout-ignore>
              <div class="${pfx}-synth-header" data-layout-ignore>
                <span class="${pfx}-synth-pill" data-layout-ignore>LIVE PRODUCT</span>
                <span class="${pfx}-synth-status" style="background-color: ${secondary};"></span>
              </div>
              <div class="${pfx}-synth-hero" style="border-color: ${primary};" data-layout-ignore>
                <div class="${pfx}-synth-kicker" data-layout-ignore>${escapeHtml(details.calloutLabel)}</div>
                <div class="${pfx}-synth-metric" data-layout-ignore>${escapeHtml(details.calloutValue)}</div>
              </div>
              <div class="${pfx}-synth-cta" data-layout-ignore>${escapeHtml(details.ctaText)}</div>
            </div>`;
}

function renderDevice3dShowcase({ compId, pfx, w, h, dur, details, palette }) {
  const isLandscape = w >= h;
  const isBrowser = details.deviceType === "browser";
  const hasVideo = Boolean(details.videoSrc);
  const shortSide = Math.min(w, h);
  const floorPx = Math.max(20, Math.ceil(shortSide * 0.027));

  const headingPx = Math.max(floorPx + 14, Math.round(shortSide * 0.043));
  const subPx = Math.max(floorPx, Math.round(shortSide * 0.028));
  const badgePx = Math.max(floorPx, Math.round(shortSide * 0.027));

  const bezelChromeHtml = isBrowser
    ? `<div class="${pfx}-browser-bar" data-layout-ignore>
              <span class="${pfx}-dot ${pfx}-dot-r"></span>
              <span class="${pfx}-dot ${pfx}-dot-y"></span>
              <span class="${pfx}-dot ${pfx}-dot-g"></span>
              <span class="${pfx}-url-pill" data-layout-ignore>studio.pro/live</span>
            </div>`
    : `<div class="${pfx}-phone-island"></div>`;

  const screenInnerHtml = renderScreenMediaMarkup({
    pfx,
    details,
    dur,
    primary: palette.primary,
    secondary: palette.secondary,
  });

  const deviceWrapperAttrs = hasVideo
    ? `id="${pfx}-device-slot" class="${pfx}-device-slot"`
    : `id="${pfx}-device-slot" class="clip ${pfx}-device-slot" data-start="0" data-duration="${dur}" data-track-index="1"`;

  const glowEnd = round3(Math.max(0.25, dur * 0.9));
  const bezelEnd = round3(Math.max(0.3, dur * 0.92));
  const cardStart = round3(Math.min(0.14, dur * 0.06));
  const cardDur = round3(clamp(dur * 0.22, 0.16, 0.44));
  const lineStart = round3(Math.min(0.2, dur * 0.1));
  const lineDur = round3(clamp(dur * 0.26, 0.18, 0.52));
  const badgeStart = round3(Math.min(0.22, dur * 0.1));
  const badgeDur = round3(clamp(dur * 0.2, 0.16, 0.38));

  const fromRotY = round2(isLandscape ? -14 : -13);
  const toRotY = round2(isLandscape ? -8 : -7);
  const fromRotX = round2(isLandscape ? 5 : 6);
  const toRotX = round2(isLandscape ? 2.5 : 3);
  const rigToScale = round2(clamp(details.camera.fromScale + 0.06, 0.98, 1.08));

  return `<template id="${compId}-template">
  <div
    data-composition-id="${compId}"
    data-width="${w}"
    data-height="${h}"
    data-duration="${dur}"
  >
    <div
      id="${pfx}-glow-clip"
      class="clip ${pfx}-glow-clip"
      data-start="0"
      data-duration="${dur}"
      data-track-index="1"
      data-layout-allow-overflow
    >
      <div id="${pfx}-ambient-glow" class="${pfx}-ambient-glow" data-layout-allow-overflow></div>
    </div>

    <div class="${pfx}-safe-stage">
      <div ${deviceWrapperAttrs} data-layout-allow-overflow>
        <div id="${pfx}-bezel-rig" class="${pfx}-bezel-rig" data-layout-allow-overflow>
          <div class="${pfx}-bezel-chassis ${isBrowser ? `${pfx}-is-browser` : `${pfx}-is-phone`}">
            ${bezelChromeHtml}
            <div class="${pfx}-bezel-screen" data-layout-allow-overflow>
              ${screenInnerHtml}
            </div>
          </div>
        </div>
      </div>

      <div
        id="${pfx}-connector-clip"
        class="clip ${pfx}-connector-clip"
        data-start="0"
        data-duration="${dur}"
        data-track-index="2"
      >
        <div id="${pfx}-connector-anim" class="${pfx}-connector-anim">
          <svg
            viewBox="0 0 280 96"
            width="280"
            height="96"
            class="${pfx}-callout-svg"
            aria-hidden="true"
          >
            <circle cx="18" cy="72" r="8" fill="#FACC15" />
            <circle cx="18" cy="72" r="14" fill="none" stroke="${palette.secondary}" stroke-width="2" />
            <path
              d="M 28 72 C 106 72, 152 24, 258 24"
              fill="none"
              stroke="#FACC15"
              stroke-width="3.5"
              stroke-dasharray="7 9"
            />
            <circle cx="262" cy="24" r="7" fill="${palette.secondary}" />
          </svg>
        </div>
      </div>

      <div
        id="${pfx}-card-clip"
        class="clip ${pfx}-card-clip"
        data-start="0"
        data-duration="${dur}"
        data-track-index="3"
      >
        <div id="${pfx}-callout-card" class="${pfx}-callout-card">
          <div id="${pfx}-badge" class="${pfx}-badge">${escapeHtml(details.badge)}</div>
          <h1 id="${pfx}-headline" class="${pfx}-headline">${escapeHtml(details.headline)}</h1>
          <p id="${pfx}-subheadline" class="${pfx}-subheadline">${escapeHtml(details.subheadline)}</p>
          <div class="${pfx}-telemetry-row" data-layout-ignore>
            <span class="${pfx}-telemetry-dot"></span>
            <span class="${pfx}-telemetry-label" data-layout-ignore>${escapeHtml(details.calloutLabel)}:</span>
            <span class="${pfx}-telemetry-val" data-layout-ignore>${escapeHtml(details.calloutValue)}</span>
          </div>
        </div>
      </div>
    </div>

    <style>
      [data-composition-id="${compId}"] {
        position: relative;
        width: ${w}px;
        height: ${h}px;
        overflow: hidden;
        background: linear-gradient(155deg, ${palette.background} 0%, #050b08 100%);
        font-family: "Inter", sans-serif;
        color: #FFFFFF;
      }

      [data-composition-id="${compId}"] .${pfx}-glow-clip {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
      }

      [data-composition-id="${compId}"] .${pfx}-ambient-glow {
        position: absolute;
        left: ${isLandscape ? "4%" : "6%"};
        top: ${isLandscape ? "8%" : "6%"};
        width: ${isLandscape ? "58%" : "88%"};
        height: ${isLandscape ? "84%" : "56%"};
        border-radius: 999px;
        background: radial-gradient(
          circle at 50% 50%,
          ${palette.secondary}55 0%,
          ${palette.primary}38 42%,
          rgba(8, 18, 14, 0) 74%
        );
        pointer-events: none;
      }

      [data-composition-id="${compId}"] .${pfx}-safe-stage {
        position: absolute;
        left: 10%;
        right: 10%;
        top: 10%;
        bottom: 11%;
        z-index: 2;
        display: flex;
        flex-direction: ${isLandscape ? "row" : "column"};
        align-items: center;
        justify-content: space-between;
        gap: ${isLandscape ? "20px" : "14px"};
        perspective: 1400px;
      }

      [data-composition-id="${compId}"] .${pfx}-device-slot {
        width: ${isLandscape ? "42%" : "76%"};
        height: ${isLandscape ? "86%" : "44%"};
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }

      [data-composition-id="${compId}"] .${pfx}-bezel-rig {
        width: 100%;
        height: 100%;
        transform-style: preserve-3d;
        transform-origin: center center;
      }

      [data-composition-id="${compId}"] .${pfx}-bezel-chassis {
        width: 100%;
        height: 100%;
        background-color: #0A1410;
        border: 3px solid ${palette.secondary};
        box-shadow:
          0 28px 64px rgba(0, 0, 0, 0.72),
          0 0 0 2px ${palette.primary};
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-sizing: border-box;
      }

      [data-composition-id="${compId}"] .${pfx}-is-phone {
        border-radius: 40px;
        padding: 12px;
      }

      [data-composition-id="${compId}"] .${pfx}-is-browser {
        border-radius: 24px;
        padding: 10px;
      }

      [data-composition-id="${compId}"] .${pfx}-phone-island {
        width: 96px;
        height: 14px;
        border-radius: 999px;
        background-color: #050A08;
        border: 1px solid #1E352B;
        align-self: center;
        margin-bottom: 8px;
        flex-shrink: 0;
      }

      [data-composition-id="${compId}"] .${pfx}-browser-bar {
        height: 32px;
        background-color: #07100D;
        border-radius: 14px;
        padding: 0 12px;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 7px;
        flex-shrink: 0;
      }

      [data-composition-id="${compId}"] .${pfx}-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
      }

      [data-composition-id="${compId}"] .${pfx}-dot-r {
        background-color: #EF4444;
      }

      [data-composition-id="${compId}"] .${pfx}-dot-y {
        background-color: #FACC15;
      }

      [data-composition-id="${compId}"] .${pfx}-dot-g {
        background-color: #22C55E;
      }

      [data-composition-id="${compId}"] .${pfx}-url-pill {
        margin-left: 8px;
        padding: 2px 12px;
        border-radius: 999px;
        background-color: #0F201A;
        color: #E2E8F0;
        font-family: "JetBrains Mono", monospace;
        font-size: 12px;
        font-weight: 700;
      }

      [data-composition-id="${compId}"] .${pfx}-bezel-screen {
        position: relative;
        flex: 1 1 auto;
        width: 100%;
        border-radius: 24px;
        overflow: hidden;
        background-color: #08120E;
      }

      [data-composition-id="${compId}"] .${pfx}-screen-media {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-ui {
        position: absolute;
        inset: 0;
        padding: 22px;
        background: linear-gradient(160deg, #0D2019 0%, #08120E 100%);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        box-sizing: border-box;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-pill {
        background-color: #FACC15;
        color: #08120E;
        font-family: "JetBrains Mono", monospace;
        font-size: 13px;
        font-weight: 700;
        padding: 4px 10px;
        border-radius: 999px;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-status {
        width: 12px;
        height: 12px;
        border-radius: 999px;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-hero {
        background-color: #0A1410;
        border: 2px solid ${palette.primary};
        border-radius: 18px;
        padding: 18px;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-kicker {
        color: #CBD5E1;
        font-family: "JetBrains Mono", monospace;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.06em;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-metric {
        margin-top: 6px;
        color: #FFFFFF;
        font-size: 24px;
        font-weight: 900;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-cta {
        background-color: #FACC15;
        color: #08120E;
        text-align: center;
        font-size: 16px;
        font-weight: 900;
        padding: 12px 16px;
        border-radius: 14px;
      }

      [data-composition-id="${compId}"] .${pfx}-connector-clip {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      [data-composition-id="${compId}"] .${pfx}-connector-anim {
        transform-origin: center center;
      }

      [data-composition-id="${compId}"] .${pfx}-callout-svg {
        width: ${isLandscape ? "132px" : "196px"};
        height: ${isLandscape ? "70px" : "52px"};
        display: block;
      }

      [data-composition-id="${compId}"] .${pfx}-card-clip {
        width: ${isLandscape ? "46%" : "100%"};
      }

      [data-composition-id="${compId}"] .${pfx}-callout-card {
        width: 100%;
        background-color: #0A1410;
        border: 2px solid ${palette.primary};
        border-radius: 26px;
        padding: ${isLandscape ? "26px 28px" : "22px 24px"};
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.68);
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
        box-sizing: border-box;
      }

      [data-composition-id="${compId}"] .${pfx}-badge {
        display: inline-block;
        background-color: #FACC15;
        color: #08120E;
        font-family: "JetBrains Mono", monospace;
        font-size: ${badgePx}px;
        font-weight: 700;
        letter-spacing: 0.04em;
        padding: 6px 16px;
        border-radius: 999px;
      }

      [data-composition-id="${compId}"] .${pfx}-headline {
        margin: 0;
        color: #FFFFFF;
        font-size: ${headingPx}px;
        font-weight: 900;
        line-height: 1.14;
        letter-spacing: -0.02em;
      }

      [data-composition-id="${compId}"] .${pfx}-subheadline {
        margin: 0;
        color: #E2E8F0;
        font-size: ${subPx}px;
        font-weight: 400;
        line-height: 1.34;
      }

      [data-composition-id="${compId}"] .${pfx}-telemetry-row {
        margin-top: 4px;
        padding: 10px 14px;
        border-radius: 14px;
        background-color: #0F201A;
        border: 1px solid ${palette.secondary};
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: "JetBrains Mono", monospace;
        font-size: 16px;
      }

      [data-composition-id="${compId}"] .${pfx}-telemetry-dot {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background-color: #FACC15;
        flex-shrink: 0;
      }

      [data-composition-id="${compId}"] .${pfx}-telemetry-label {
        color: #CBD5E1;
        font-weight: 700;
      }

      [data-composition-id="${compId}"] .${pfx}-telemetry-val {
        color: #FFFFFF;
        font-weight: 700;
      }
    </style>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });

        tl.fromTo(
          '[data-composition-id="${compId}"] #${pfx}-ambient-glow',
          { opacity: 0.55, scale: 0.9 },
          { opacity: 0.96, scale: 1.08, duration: ${glowEnd}, ease: "sine.inOut" },
          0,
        );

        tl.fromTo(
          '[data-composition-id="${compId}"] #${pfx}-bezel-rig',
          {
            transformPerspective: 1400,
            rotationY: ${fromRotY},
            rotationX: ${fromRotX},
            rotationZ: -1.2,
            scale: ${details.camera.fromScale},
            x: 0,
            y: 18,
            opacity: 0.92,
          },
          {
            transformPerspective: 1400,
            rotationY: ${toRotY},
            rotationX: ${toRotX},
            rotationZ: 0,
            scale: ${rigToScale},
            x: ${round2(details.camera.panX * 0.4)},
            y: ${round2(details.camera.panY * 0.4)},
            opacity: 1,
            duration: ${bezelEnd},
            ease: "power3.out",
          },
          0,
        );

        tl.fromTo(
          '[data-composition-id="${compId}"] #${pfx}-connector-anim',
          { opacity: 0, x: -16, scale: 0.92 },
          { opacity: 1, x: 0, scale: 1, duration: ${lineDur}, ease: "power3.out" },
          ${lineStart},
        );

        tl.fromTo(
          '[data-composition-id="${compId}"] #${pfx}-callout-card',
          { opacity: 0, y: 20, scale: 0.97 },
          { opacity: 1, y: 0, scale: 1, duration: ${cardDur}, ease: "power3.out" },
          ${cardStart},
        );

        tl.fromTo(
          '[data-composition-id="${compId}"] #${pfx}-badge',
          { opacity: 0, scale: 0.9 },
          { opacity: 1, scale: 1, duration: ${badgeDur}, ease: "back.out(1.4)" },
          ${badgeStart},
        );

        window.__timelines = window.__timelines || {};
        window.__timelines["${compId}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

function renderSpotlightCursorZoom({ compId, pfx, w, h, dur, details, palette }) {
  const isLandscape = w >= h;
  const hasVideo = Boolean(details.videoSrc);
  const shortSide = Math.min(w, h);
  const floorPx = Math.max(20, Math.ceil(shortSide * 0.027));

  const headingPx = Math.max(floorPx + 14, Math.round(shortSide * 0.042));
  const subPx = Math.max(floorPx, Math.round(shortSide * 0.028));
  const badgePx = Math.max(floorPx, Math.round(shortSide * 0.027));

  const cursorSize = Math.round(clamp(shortSide * 0.082, 68, 108));
  const rippleSize = Math.round(cursorSize * 1.85);

  const focusRatioX = details.camera.focusX / 100;
  const focusRatioY = details.camera.focusY / 100;

  const frameBoxLeft = w * 0.1;
  const frameBoxWidth = w * 0.8;
  const frameBoxTop = h * 0.1;
  const frameBoxHeight = h * (isLandscape ? 0.5 : 0.46);

  const targetX = Math.round(frameBoxLeft + frameBoxWidth * focusRatioX);
  const targetY = Math.round(frameBoxTop + frameBoxHeight * focusRatioY);
  const cursorStartX = Math.round(clamp(targetX + w * 0.22, 0, w * 0.96));
  const cursorStartY = Math.round(h * 1.06);
  const cursorDriftX = Math.round(clamp(targetX + w * 0.09, w * 0.12, w * 0.88));
  const cursorDriftY = Math.round(clamp(targetY + h * 0.06, h * 0.14, h * 0.84));

  const rippleLeft = Math.round(targetX - rippleSize / 2);
  const rippleTop = Math.round(targetY - rippleSize / 2);

  const toScale = round2(clamp(details.camera.toScale, 1.24, 1.85));
  const zoomPanX = round2((0.5 - focusRatioX) * frameBoxWidth * (toScale - 1) * 0.65);
  const zoomPanY = round2((0.5 - focusRatioY) * frameBoxHeight * (toScale - 1) * 0.65);

  const tClick = round3(clamp(dur * 0.32, 0.2, 1.35));
  const preZoomDur = round3(Math.max(0.12, tClick - 0.02));
  const zoomDur = round3(Math.max(0.22, dur * 0.92 - tClick));

  const tCursorIn = 0.02;
  const dCursorIn = round3(Math.max(0.14, tClick - tCursorIn - 0.02));
  const dTapDown = round3(clamp(dur * 0.06, 0.05, 0.1));
  const tTapUp = round3(tClick + dTapDown + 0.01);
  const dTapUp = round3(clamp(dur * 0.1, 0.08, 0.18));
  const tDrift = round3(tTapUp + dTapUp + 0.02);
  const dDrift = round3(Math.max(0.12, Math.min(0.55, dur * 0.9 - tDrift)));

  const dRippleIn = round3(clamp(dur * 0.06, 0.05, 0.1));
  const tRippleOut = round3(tClick + dRippleIn + 0.01);
  const dRippleOut = round3(Math.max(0.16, Math.min(0.48, dur * 0.9 - tRippleOut)));

  const dimEnd = round3(Math.max(0.25, dur * 0.9));
  const cardInDur = round3(clamp(dur * 0.2, 0.16, 0.38));

  const screenInnerHtml = renderScreenMediaMarkup({
    pfx,
    details,
    dur,
    primary: palette.primary,
    secondary: palette.secondary,
  });

  const spotlightWrapperAttrs = hasVideo
    ? `id="${pfx}-spotlight-wrap" class="${pfx}-spotlight-wrap"`
    : `id="${pfx}-spotlight-wrap" class="clip ${pfx}-spotlight-wrap" data-start="0" data-duration="${dur}" data-track-index="1"`;

  return `<template id="${compId}-template">
  <div
    data-composition-id="${compId}"
    data-width="${w}"
    data-height="${h}"
    data-duration="${dur}"
  >
    <div
      id="${pfx}-dim-stage"
      class="clip ${pfx}-dim-stage"
      data-start="0"
      data-duration="${dur}"
      data-track-index="1"
    >
      <div id="${pfx}-dim-veil" class="${pfx}-dim-veil"></div>
    </div>

    <div class="${pfx}-safe-stage">
      <div ${spotlightWrapperAttrs} data-layout-allow-overflow>
        <div id="${pfx}-spotlight-frame" class="${pfx}-spotlight-frame" data-layout-allow-overflow>
          <div class="${pfx}-spotlight-topbar" data-layout-ignore>
            <span class="${pfx}-spot-indicator"></span>
            <span class="${pfx}-spot-label" data-layout-ignore>SPOTLIGHT TARGET LOCK</span>
          </div>
          <div class="${pfx}-spotlight-viewport" data-layout-allow-overflow>
            <div id="${pfx}-zoom-rig" class="${pfx}-zoom-rig" data-layout-allow-overflow>
              ${screenInnerHtml}
            </div>
          </div>
        </div>
      </div>

      <div
        id="${pfx}-card-clip"
        class="clip ${pfx}-card-clip"
        data-start="0"
        data-duration="${dur}"
        data-track-index="2"
      >
        <div id="${pfx}-spot-card" class="${pfx}-spot-card">
          <div id="${pfx}-spot-badge" class="${pfx}-badge">${escapeHtml(details.badge)}</div>
          <h1 id="${pfx}-spot-headline" class="${pfx}-headline">${escapeHtml(details.headline)}</h1>
          <p id="${pfx}-spot-subheadline" class="${pfx}-subheadline">${escapeHtml(details.subheadline)}</p>
        </div>
      </div>
    </div>

    <div
      id="${pfx}-pointer-clip"
      class="clip ${pfx}-pointer-clip"
      data-start="0"
      data-duration="${dur}"
      data-track-index="3"
      data-layout-allow-overflow
    >
      <div
        id="${pfx}-ripple-ring"
        class="${pfx}-ripple-ring"
        style="left: ${rippleLeft}px; top: ${rippleTop}px;"
        data-layout-allow-overflow
      >
        <svg viewBox="0 0 160 160" width="${rippleSize}" height="${rippleSize}" aria-hidden="true">
          <circle cx="80" cy="80" r="58" fill="none" stroke="#FACC15" stroke-width="5" />
          <circle cx="80" cy="80" r="30" fill="none" stroke="#FFFFFF" stroke-width="3" />
        </svg>
      </div>

      <div id="${pfx}-cursor" class="${pfx}-cursor" data-layout-allow-overflow>
        <svg viewBox="0 0 64 64" width="${cursorSize}" height="${cursorSize}" aria-hidden="true">
          <circle cx="14" cy="10" r="9" fill="#FACC15" opacity="0.35" />
          <path
            d="M 12 6 L 12 48 L 23 38 L 31 55 L 38 51 L 30 35 L 45 35 Z"
            fill="#FFFFFF"
            stroke="#08120E"
            stroke-width="3.2"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    </div>

    <style>
      [data-composition-id="${compId}"] {
        position: relative;
        width: ${w}px;
        height: ${h}px;
        overflow: hidden;
        background-color: #050B08;
        font-family: "Inter", sans-serif;
        color: #FFFFFF;
      }

      [data-composition-id="${compId}"] .${pfx}-dim-stage {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
      }

      [data-composition-id="${compId}"] .${pfx}-dim-veil {
        position: absolute;
        inset: 0;
        background: radial-gradient(
          circle at 50% 38%,
          rgba(14, 34, 26, 0.2) 0%,
          rgba(5, 11, 8, 0.9) 74%
        );
      }

      [data-composition-id="${compId}"] .${pfx}-safe-stage {
        position: absolute;
        left: 10%;
        right: 10%;
        top: 10%;
        bottom: 11%;
        z-index: 2;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 18px;
      }

      [data-composition-id="${compId}"] .${pfx}-spotlight-wrap {
        width: 100%;
        flex: 1 1 52%;
        display: flex;
        position: relative;
      }

      [data-composition-id="${compId}"] .${pfx}-spotlight-frame {
        width: 100%;
        height: 100%;
        background-color: #0A1410;
        border: 3px solid #FACC15;
        border-radius: 28px;
        padding: 12px;
        box-shadow:
          0 28px 68px rgba(0, 0, 0, 0.82),
          0 0 0 3px ${palette.primary};
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-sizing: border-box;
      }

      [data-composition-id="${compId}"] .${pfx}-spotlight-topbar {
        height: 30px;
        padding: 0 12px;
        margin-bottom: 8px;
        border-radius: 12px;
        background-color: #0F201A;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      [data-composition-id="${compId}"] .${pfx}-spot-indicator {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background-color: #FACC15;
      }

      [data-composition-id="${compId}"] .${pfx}-spot-label {
        color: #FFFFFF;
        font-family: "JetBrains Mono", monospace;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.06em;
      }

      [data-composition-id="${compId}"] .${pfx}-spotlight-viewport {
        position: relative;
        flex: 1 1 auto;
        width: 100%;
        border-radius: 18px;
        overflow: hidden;
        background-color: #08120E;
      }

      [data-composition-id="${compId}"] .${pfx}-zoom-rig {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transform-origin: ${round2(details.camera.focusX)}% ${round2(details.camera.focusY)}%;
      }

      [data-composition-id="${compId}"] .${pfx}-screen-media {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-ui {
        position: absolute;
        inset: 0;
        padding: 24px;
        background: linear-gradient(150deg, #0E231B 0%, #08120E 100%);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        box-sizing: border-box;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-pill {
        background-color: #FACC15;
        color: #08120E;
        font-family: "JetBrains Mono", monospace;
        font-size: 13px;
        font-weight: 700;
        padding: 4px 10px;
        border-radius: 999px;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-status {
        width: 12px;
        height: 12px;
        border-radius: 999px;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-hero {
        background-color: #0A1410;
        border: 2px solid ${palette.primary};
        border-radius: 18px;
        padding: 18px;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-kicker {
        color: #CBD5E1;
        font-family: "JetBrains Mono", monospace;
        font-size: 13px;
        font-weight: 700;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-metric {
        margin-top: 6px;
        color: #FFFFFF;
        font-size: 24px;
        font-weight: 900;
      }

      [data-composition-id="${compId}"] .${pfx}-synth-cta {
        background-color: #FACC15;
        color: #08120E;
        text-align: center;
        font-size: 16px;
        font-weight: 900;
        padding: 12px 16px;
        border-radius: 14px;
      }

      [data-composition-id="${compId}"] .${pfx}-card-clip {
        width: 100%;
      }

      [data-composition-id="${compId}"] .${pfx}-spot-card {
        width: 100%;
        background-color: #0A1410;
        border: 2px solid ${palette.primary};
        border-radius: 24px;
        padding: 22px 26px;
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.72);
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        box-sizing: border-box;
      }

      [data-composition-id="${compId}"] .${pfx}-badge {
        display: inline-block;
        background-color: #FACC15;
        color: #08120E;
        font-family: "JetBrains Mono", monospace;
        font-size: ${badgePx}px;
        font-weight: 700;
        letter-spacing: 0.04em;
        padding: 6px 16px;
        border-radius: 999px;
      }

      [data-composition-id="${compId}"] .${pfx}-headline {
        margin: 0;
        color: #FFFFFF;
        font-size: ${headingPx}px;
        font-weight: 900;
        line-height: 1.14;
        letter-spacing: -0.02em;
      }

      [data-composition-id="${compId}"] .${pfx}-subheadline {
        margin: 0;
        color: #E2E8F0;
        font-size: ${subPx}px;
        font-weight: 400;
        line-height: 1.34;
      }

      [data-composition-id="${compId}"] .${pfx}-pointer-clip {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 12;
      }

      [data-composition-id="${compId}"] .${pfx}-ripple-ring {
        position: absolute;
        width: ${rippleSize}px;
        height: ${rippleSize}px;
        transform-origin: center center;
        pointer-events: none;
      }

      [data-composition-id="${compId}"] .${pfx}-cursor {
        position: absolute;
        left: 0;
        top: 0;
        width: ${cursorSize}px;
        height: ${cursorSize}px;
        transform-origin: 19% 10%;
        pointer-events: none;
      }
    </style>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });

        tl.fromTo(
          '[data-composition-id="${compId}"] #${pfx}-dim-veil',
          { opacity: 0.68 },
          { opacity: 0.94, duration: ${dimEnd}, ease: "sine.out" },
          0,
        );

        tl.fromTo(
          '[data-composition-id="${compId}"] #${pfx}-spotlight-frame',
          { opacity: 0.9, y: 16, scale: 0.97 },
          { opacity: 1, y: 0, scale: 1, duration: ${cardInDur}, ease: "power3.out" },
          0,
        );

        tl.fromTo(
          '[data-composition-id="${compId}"] #${pfx}-zoom-rig',
          { scale: 1, x: 0, y: 0 },
          { scale: 1.03, x: 0, y: 0, duration: ${preZoomDur}, ease: "sine.out" },
          0,
        );

        tl.to(
          '[data-composition-id="${compId}"] #${pfx}-zoom-rig',
          {
            scale: ${toScale},
            x: ${zoomPanX},
            y: ${zoomPanY},
            duration: ${zoomDur},
            ease: "expo.out",
          },
          ${tClick},
        );

        tl.fromTo(
          '[data-composition-id="${compId}"] #${pfx}-cursor',
          { x: ${cursorStartX}, y: ${cursorStartY}, scale: 1, opacity: 1 },
          {
            x: ${targetX},
            y: ${targetY},
            scale: 1,
            opacity: 1,
            duration: ${dCursorIn},
            ease: "power3.out",
          },
          ${tCursorIn},
        );

        tl.to(
          '[data-composition-id="${compId}"] #${pfx}-cursor',
          { scale: 0.84, duration: ${dTapDown}, ease: "power2.in" },
          ${tClick},
        );

        tl.to(
          '[data-composition-id="${compId}"] #${pfx}-cursor',
          { scale: 1, duration: ${dTapUp}, ease: "power2.out" },
          ${tTapUp},
        );

        tl.to(
          '[data-composition-id="${compId}"] #${pfx}-cursor',
          { x: ${cursorDriftX}, y: ${cursorDriftY}, duration: ${dDrift}, ease: "power2.out" },
          ${tDrift},
        );

        tl.fromTo(
          '[data-composition-id="${compId}"] #${pfx}-ripple-ring',
          { scale: 0.22, opacity: 0 },
          { scale: 0.56, opacity: 1, duration: ${dRippleIn}, ease: "power2.out" },
          ${tClick},
        );

        tl.to(
          '[data-composition-id="${compId}"] #${pfx}-ripple-ring',
          { scale: 1.92, opacity: 0, duration: ${dRippleOut}, ease: "power2.out" },
          ${tRippleOut},
        );

        tl.fromTo(
          '[data-composition-id="${compId}"] #${pfx}-spot-card',
          { opacity: 0, y: 18 },
          { opacity: 1, y: 0, duration: ${cardInDur}, ease: "power3.out" },
          0.04,
        );

        tl.fromTo(
          '[data-composition-id="${compId}"] #${pfx}-spot-badge',
          { opacity: 0, scale: 0.9 },
          { opacity: 1, scale: 1, duration: ${cardInDur}, ease: "back.out(1.4)" },
          0.08,
        );

        window.__timelines = window.__timelines || {};
        window.__timelines["${compId}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

export function renderArchetypeScene({
  archetypeId,
  compositionId = "scene-01",
  width = 1080,
  height = 1920,
  durationSeconds = 4,
  shot = {},
  brandColors = {},
} = {}) {
  const resolvedArchetype = String(
    archetypeId ?? shot?.archetypeId ?? shot?.layout ?? "device-3d-showcase",
  ).trim();

  if (!ARCHETYPE_IDS.has(resolvedArchetype)) {
    throw new Error(
      `Unsupported archetypeId "${resolvedArchetype}" in pack-device-spotlight. Expected one of: ${[...ARCHETYPE_IDS].join(", ")}.`,
    );
  }

  const compId = sanitizeCompositionId(compositionId);
  const pfx = sanitizeIdPrefix(compId);
  const w = Math.max(320, Math.round(Number(width) || 1080));
  const h = Math.max(320, Math.round(Number(height) || 1920));
  const dur = round3(Math.max(0.6, Number(durationSeconds) || Number(shot?.durationSeconds) || 4));

  const palette = {
    primary: sanitizeHexColor(brandColors?.primary, "#1E824C"),
    secondary: sanitizeHexColor(brandColors?.secondary, "#2ECC71"),
    accent: sanitizeHexColor(brandColors?.accent, "#FACC15"),
    background: sanitizeHexColor(brandColors?.background, "#08120E"),
  };

  const details = extractShotDetails(shot, resolvedArchetype);

  if (resolvedArchetype === "spotlight-cursor-zoom") {
    return renderSpotlightCursorZoom({ compId, pfx, w, h, dur, details, palette });
  }

  return renderDevice3dShowcase({ compId, pfx, w, h, dur, details, palette });
}

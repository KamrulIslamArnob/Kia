export const PACK_ID = "pack-wipe-metrics";

export const ARCHETYPES = Object.freeze([
  Object.freeze({
    id: "before-after-wipe",
    name: "Before / After Split Wipe",
    pack: PACK_ID,
    category: "comparison",
    description:
      "Split clip-path reveal transitioning raw vs transformed state with an animated divider handle and high-contrast comparison badges.",
    defaultDurationSeconds: 4.0,
    recommendedAspectRatios: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    tags: Object.freeze(["before-after", "wipe", "clip-path", "comparison", "transformation"]),
  }),
  Object.freeze({
    id: "metric-counter-wall",
    name: "Metric Counter Wall",
    pack: PACK_ID,
    category: "metrics",
    description:
      "Three bold tabular stat counters with staggered count-up choreography, display headline, and subtle framed preview plate.",
    defaultDurationSeconds: 4.0,
    recommendedAspectRatios: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    tags: Object.freeze(["metrics", "counters", "tabular-nums", "stats", "kpi"]),
  }),
]);

const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv", "m4v", "avi"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "svg", "gif", "avif"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeJsString(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "");
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function sanitizeCompositionId(raw, fallback = "scene-wipe-metrics") {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function buildSafePrefix(compId) {
  const token = compId.replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
  return `s_${token || "scene"}`;
}

function normalizeRelativeAssetPath(rawPath) {
  if (typeof rawPath !== "string") return null;
  let cleaned = rawPath.trim().replaceAll("\\", "/");
  if (!cleaned) return null;
  if (/^(?:https?:|data:|blob:)/i.test(cleaned)) return null;
  cleaned = cleaned.replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
  if (!cleaned || cleaned.split("/").includes("..")) return null;
  if (!cleaned.startsWith("assets/")) {
    cleaned = `assets/${cleaned}`;
  }
  return cleaned;
}

function detectMediaKind(relPath) {
  if (!relPath) return null;
  const clean = relPath.split(/[?#]/, 1)[0] || "";
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = clean.slice(dot + 1).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return "video";
  if (IMAGE_EXTS.has(ext)) return "image";
  return null;
}

function normalizeBrandPalette(brandColors) {
  const hexRe = /^#[0-9A-Fa-f]{6}$/;
  const pick = (val, fallback) =>
    typeof val === "string" && hexRe.test(val.trim()) ? val.trim() : fallback;
  return {
    primary: pick(brandColors?.primary, "#1E824C"),
    secondary: pick(brandColors?.secondary, "#2ECC71"),
    accent: pick(brandColors?.accent, "#FACC15"),
    background: pick(brandColors?.background, "#0A1410"),
  };
}

function parseMetricItem(rawItem, fallbackItem) {
  if (!rawItem || typeof rawItem !== "object") {
    return fallbackItem;
  }

  let prefix = typeof rawItem.prefix === "string" ? rawItem.prefix : "";
  let suffix = typeof rawItem.suffix === "string" ? rawItem.suffix : "";
  let target = Number(rawItem.target);
  let decimals = Number.isInteger(rawItem.decimals) ? clamp(rawItem.decimals, 0, 3) : null;

  if (!Number.isFinite(target) && rawItem.value !== undefined && rawItem.value !== null) {
    const rawStr = String(rawItem.value).trim();
    const match = rawStr.match(/^([^0-9+-]*?)([+-]?\d+(?:\.\d+)?)(.*)$/);
    if (match) {
      if (!prefix) prefix = match[1] || "";
      target = Number(match[2]);
      if (!suffix) suffix = match[3] || "";
      if (decimals === null) {
        const dotIdx = match[2].indexOf(".");
        decimals = dotIdx >= 0 ? clamp(match[2].length - dotIdx - 1, 0, 3) : 0;
      }
    }
  }

  if (!Number.isFinite(target)) {
    target = fallbackItem.target;
    if (!prefix) prefix = fallbackItem.prefix;
    if (!suffix) suffix = fallbackItem.suffix;
  }

  if (decimals === null) {
    decimals = Number.isInteger(target) ? 0 : 1;
  }

  const label = String(rawItem.label || fallbackItem.label).trim() || fallbackItem.label;
  const delta = String(rawItem.delta || fallbackItem.delta).trim() || fallbackItem.delta;
  const formatted = `${prefix}${target.toFixed(decimals)}${suffix}`;

  return {
    target,
    prefix,
    suffix,
    decimals,
    label,
    delta,
    formatted,
  };
}

function renderLayerMedia({ pfx, slotName, relPath, dur, trackIndex, synthHtml }) {
  const mediaKind = detectMediaKind(relPath);
  if (mediaKind === "video") {
    return {
      wrapperTimedAttrs: "",
      innerHtml: `<video id="${pfx}-${slotName}-video" class="clip ${pfx}-media" src="${escapeHtml(relPath)}" data-start="0" data-duration="${dur}" data-track-index="${trackIndex}" muted playsinline></video>`,
    };
  }
  if (mediaKind === "image") {
    return {
      wrapperTimedAttrs: ` class="clip ${pfx}-timed-slot" data-start="0" data-duration="${dur}" data-track-index="${trackIndex}"`,
      innerHtml: `<img id="${pfx}-${slotName}-img" class="${pfx}-media" src="${escapeHtml(relPath)}" alt="" />`,
    };
  }
  return {
    wrapperTimedAttrs: ` class="clip ${pfx}-timed-slot" data-start="0" data-duration="${dur}" data-track-index="${trackIndex}"`,
    innerHtml: synthHtml,
  };
}

function renderBeforeAfterWipeScene({ compId, pfx, w, h, dur, shot, palette }) {
  const isLandscape = w >= h;
  const padX = Math.round(w * 0.1);
  const padY = Math.round(h * 0.1);
  const safeW = w - padX * 2;
  const safeH = h - padY * 2;

  const shortSide = Math.min(w, h);
  const readFloorPx = Math.max(18, Math.ceil(shortSide * 0.027));
  const headingPx = Math.max(readFloorPx + 12, isLandscape ? 42 : 44);
  const subPx = Math.max(readFloorPx, isLandscape ? 28 : 29);
  const headerH = isLandscape ? Math.round(safeH * 0.28) : Math.round(safeH * 0.24);
  const gapPx = isLandscape ? 20 : 24;
  const stageW = safeW;
  const stageH = Math.max(220, safeH - headerH - gapPx);
  const knobSize = isLandscape ? 52 : 56;
  const knobTop = Math.round(stageH / 2 - knobSize / 2);
  const knobOffsetLeft = -Math.round(knobSize / 2 - 2);

  const staging = shot?.staging || {};
  const copy = shot?.copy || {};

  const badgeText = escapeHtml(staging.badge || copy.badge || shot?.badge || "BEFORE / AFTER");
  const headlineText = escapeHtml(
    staging.headline ||
      copy.headline ||
      shot?.headline ||
      shot?.title ||
      "Raw Capture vs Cinema Grade",
  );
  const subheadlineText = escapeHtml(
    staging.subheadline ||
      copy.subheadline ||
      shot?.subheadline ||
      shot?.description ||
      "Deterministic clip-path reveal transitioning raw source to finished studio output.",
  );
  const beforeLabelText = escapeHtml(staging.beforeLabel || shot?.beforeLabel || "RAW INPUT");
  const afterLabelText = escapeHtml(staging.afterLabel || shot?.afterLabel || "TRANSFORMED");

  const rawBeforeRel = normalizeRelativeAssetPath(
    shot?.beforeClip ||
      shot?.rawClip ||
      shot?.beforeImage ||
      shot?.rawImage ||
      staging.beforeClip ||
      staging.beforeImage,
  );
  const afterRel = normalizeRelativeAssetPath(
    shot?.afterClip ||
      shot?.afterImage ||
      shot?.clipRelPath ||
      shot?.sourceClip ||
      shot?.plateRelPath ||
      shot?.plateImage ||
      staging.afterClip ||
      staging.afterImage,
  );
  const beforeRel =
    rawBeforeRel &&
    afterRel &&
    rawBeforeRel === afterRel &&
    detectMediaKind(rawBeforeRel) === "video"
      ? null
      : rawBeforeRel;

  const startPct = clamp(Number(shot?.wipeStartPercent) || 82, 12, 90);
  const peakPct = clamp(Number(shot?.wipePeakPercent) || 18, 8, 88);
  const settlePct = clamp(Number(shot?.wipeSettlePercent) || 30, 15, 85);

  const xStart = Number(((startPct / 100) * stageW).toFixed(2));
  const xPeak = Number(((peakPct / 100) * stageW).toFixed(2));
  const xSettle = Number(((settlePct / 100) * stageW).toFixed(2));

  const introDur = Number(Math.min(0.45, dur * 0.2).toFixed(2));
  const sweepDur = Number(Math.max(0.45, dur * 0.48).toFixed(2));
  const sweepEnd = Number((sweepDur + 0.04).toFixed(2));
  const settleDur = Number(Math.max(0.25, dur * 0.28).toFixed(2));

  const beforeMedia = renderLayerMedia({
    pfx,
    slotName: "before",
    relPath: beforeRel,
    dur,
    trackIndex: 2,
    synthHtml: `<div id="${pfx}-before-synth" class="${pfx}-synth-raw">
      <div class="${pfx}-wire-bar ${pfx}-wire-w70"></div>
      <div class="${pfx}-wire-bar ${pfx}-wire-w45"></div>
      <div class="${pfx}-wire-box"></div>
    </div>`,
  });

  const afterMedia = renderLayerMedia({
    pfx,
    slotName: "after",
    relPath: afterRel,
    dur,
    trackIndex: 3,
    synthHtml: `<div id="${pfx}-after-synth" class="${pfx}-synth-graded">
      <div class="${pfx}-glow-bar ${pfx}-wire-w70"></div>
      <div class="${pfx}-glow-bar ${pfx}-wire-w55"></div>
      <div class="${pfx}-glow-box"></div>
    </div>`,
  });

  const beforePaneAttrs = beforeMedia.wrapperTimedAttrs
    ? `id="${pfx}-before-slot"${beforeMedia.wrapperTimedAttrs}`
    : `id="${pfx}-before-slot" class="${pfx}-untimed-slot"`;

  const afterPaneAttrs = afterMedia.wrapperTimedAttrs
    ? `id="${pfx}-after-slot"${afterMedia.wrapperTimedAttrs}`
    : `id="${pfx}-after-slot" class="${pfx}-untimed-slot"`;

  return `<template id="${escapeHtml(compId)}-template">
  <div data-composition-id="${escapeHtml(compId)}" data-width="${w}" data-height="${h}" data-duration="${dur}">
    <style>
      [data-composition-id="${escapeHtml(compId)}"] {
        position: relative;
        width: ${w}px;
        height: ${h}px;
        overflow: hidden;
        background-color: #0A1410;
        font-family: "Inter", sans-serif;
        color: #FFFFFF;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-canvas {
        position: absolute;
        inset: 0;
        background: linear-gradient(160deg, ${palette.background} 0%, #0A1410 65%, #060D0A 100%);
        overflow: hidden;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-safe {
        position: absolute;
        left: ${padX}px;
        top: ${padY}px;
        width: ${safeW}px;
        height: ${safeH}px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: ${gapPx}px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-header-clip {
        width: 100%;
        height: ${headerH}px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-header-card {
        width: 100%;
        height: 100%;
        background-color: #0A1410;
        border: 2px solid ${palette.primary};
        border-radius: 24px;
        padding: 20px 26px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 8px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-gold-badge {
        display: inline-block;
        align-self: flex-start;
        background-color: #FACC15;
        color: #08120E;
        font-size: 16px;
        font-weight: 800;
        letter-spacing: 0.06em;
        padding: 5px 14px;
        border-radius: 999px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-headline {
        margin: 0;
        color: #FFFFFF;
        font-size: ${headingPx}px;
        font-weight: 800;
        line-height: 1.14;
        letter-spacing: -0.02em;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-subline {
        margin: 0;
        color: #E2E8F0;
        font-size: ${subPx}px;
        font-weight: 500;
        line-height: 1.32;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wipe-stage {
        position: relative;
        width: ${stageW}px;
        height: ${stageH}px;
        border-radius: 28px;
        border: 2px solid ${palette.secondary};
        background-color: #0A1410;
        overflow: hidden;
        box-sizing: border-box;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-timed-slot,
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-untimed-slot {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-after-mask {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        clip-path: inset(0% 0% 0% ${startPct}%);
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-media {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-synth-raw {
        position: absolute;
        inset: 0;
        background: linear-gradient(145deg, #16201C 0%, #0D1411 100%);
        padding: 64px 36px 36px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-synth-graded {
        position: absolute;
        inset: 0;
        background: linear-gradient(145deg, ${palette.primary} 0%, #0A1410 68%, #091A13 100%);
        padding: 64px 36px 36px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wire-bar {
        height: 18px;
        border-radius: 9px;
        background-color: #334155;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-glow-bar {
        height: 18px;
        border-radius: 9px;
        background-color: ${palette.secondary};
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wire-w70 {
        width: 70%;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wire-w55 {
        width: 55%;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wire-w45 {
        width: 45%;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wire-box {
        flex: 1 1 auto;
        border-radius: 20px;
        border: 2px dashed #475569;
        background-color: #0F1714;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-glow-box {
        flex: 1 1 auto;
        border-radius: 20px;
        border: 2px solid #FACC15;
        background-color: #0A1410;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-pill-before {
        position: absolute;
        left: 20px;
        top: 20px;
        background-color: #0A1410;
        color: #FFFFFF;
        border: 2px solid #CBD5E1;
        font-size: 18px;
        font-weight: 800;
        letter-spacing: 0.06em;
        padding: 6px 14px;
        border-radius: 999px;
        z-index: 6;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-pill-after {
        position: absolute;
        right: 20px;
        top: 20px;
        background-color: #FACC15;
        color: #08120E;
        font-size: 18px;
        font-weight: 800;
        letter-spacing: 0.06em;
        padding: 6px 14px;
        border-radius: 999px;
        z-index: 6;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-divider-clip {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 5;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-divider-line {
        position: absolute;
        left: 0;
        top: 0;
        width: 4px;
        height: 100%;
        background-color: #FACC15;
        box-shadow: 0 0 18px rgba(250, 204, 21, 0.55);
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-divider-knob {
        position: absolute;
        left: ${knobOffsetLeft}px;
        top: ${knobTop}px;
        width: ${knobSize}px;
        height: ${knobSize}px;
        border-radius: 999px;
        background-color: #FACC15;
        border: 3px solid #08120E;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        transform-origin: center center;
      }
    </style>

    <div class="${pfx}-canvas">
      <div class="${pfx}-safe">
        <div
          id="${pfx}-header-clip"
          class="clip ${pfx}-header-clip"
          data-start="0"
          data-duration="${dur}"
          data-track-index="1"
        >
          <div id="${pfx}-header-card" class="${pfx}-header-card">
            <span id="${pfx}-badge" class="${pfx}-gold-badge" data-layout-ignore>${badgeText}</span>
            <h1 id="${pfx}-headline" class="${pfx}-headline">${headlineText}</h1>
            <p id="${pfx}-subline" class="${pfx}-subline">${subheadlineText}</p>
          </div>
        </div>

        <div id="${pfx}-wipe-stage" class="${pfx}-wipe-stage" data-layout-allow-overflow>
          <div ${beforePaneAttrs} data-layout-allow-overflow>
            ${beforeMedia.innerHtml}
          </div>

          <div id="${pfx}-after-mask" class="${pfx}-after-mask" data-layout-allow-overflow>
            <div ${afterPaneAttrs} data-layout-allow-overflow>
              ${afterMedia.innerHtml}
            </div>
          </div>

          <div id="${pfx}-pill-before" class="${pfx}-pill-before" data-layout-ignore>${beforeLabelText}</div>
          <div id="${pfx}-pill-after" class="${pfx}-pill-after" data-layout-ignore>${afterLabelText}</div>

          <div
            id="${pfx}-divider-clip"
            class="clip ${pfx}-divider-clip"
            data-start="0"
            data-duration="${dur}"
            data-track-index="4"
            data-layout-allow-overflow
          >
            <div id="${pfx}-divider-line" class="${pfx}-divider-line">
              <div id="${pfx}-divider-knob" class="${pfx}-divider-knob">
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                  <path
                    d="M9 7L4 12L9 17M15 7L20 12L15 17"
                    fill="none"
                    stroke="#08120E"
                    stroke-width="2.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });

        const headerSel = '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-header-card';
        const maskSel = '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-after-mask';
        const dividerSel = '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-divider-line';
        const knobSel = '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-divider-knob';

        tl.fromTo(
          headerSel,
          { opacity: 0, y: 18 },
          { opacity: 1, y: 0, duration: ${introDur}, ease: "power3.out" },
          0,
        );

        tl.fromTo(
          knobSel,
          { scale: 0.85 },
          { scale: 1, duration: ${introDur}, ease: "back.out(1.4)" },
          0.04,
        );

        tl.fromTo(
          maskSel,
          { clipPath: "inset(0% 0% 0% ${startPct}%)" },
          { clipPath: "inset(0% 0% 0% ${peakPct}%)", duration: ${sweepDur}, ease: "power3.inOut" },
          0,
        );
        tl.to(
          maskSel,
          { clipPath: "inset(0% 0% 0% ${settlePct}%)", duration: ${settleDur}, ease: "power2.out" },
          ${sweepEnd},
        );

        tl.fromTo(
          dividerSel,
          { x: ${xStart} },
          { x: ${xPeak}, duration: ${sweepDur}, ease: "power3.inOut" },
          0,
        );
        tl.to(
          dividerSel,
          { x: ${xSettle}, duration: ${settleDur}, ease: "power2.out" },
          ${sweepEnd},
        );

        window.__timelines = window.__timelines || {};
        window.__timelines["${escapeJsString(compId)}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

function renderMetricCounterWallScene({ compId, pfx, w, h, dur, shot, palette }) {
  const isLandscape = w >= h;
  const padX = Math.round(w * 0.1);
  const padY = Math.round(h * 0.1);
  const safeW = w - padX * 2;
  const safeH = h - padY * 2;

  const staging = shot?.staging || {};
  const copy = shot?.copy || {};

  const badgeText = escapeHtml(staging.badge || copy.badge || shot?.badge || "VERIFIED METRICS");
  const headlineText = escapeHtml(
    staging.headline ||
      copy.headline ||
      shot?.headline ||
      shot?.title ||
      "Studio Telemetry & Impact",
  );
  const subheadlineText = escapeHtml(
    staging.subheadline ||
      copy.subheadline ||
      shot?.subheadline ||
      shot?.description ||
      "Bold tabular KPI counters synchronized with live preview verification.",
  );

  const defaultMetrics = [
    {
      target: 3.8,
      prefix: "",
      suffix: "x",
      decimals: 1,
      label: "Faster Delivery",
      delta: "+280% SPEED",
      formatted: "3.8x",
    },
    {
      target: 99.4,
      prefix: "",
      suffix: "%",
      decimals: 1,
      label: "Frame Precision",
      delta: "ZERO DRIFT",
      formatted: "99.4%",
    },
    {
      target: 60,
      prefix: "",
      suffix: "fps",
      decimals: 0,
      label: "Cinema Capture",
      delta: "1080P NATIVE",
      formatted: "60fps",
    },
  ];

  const rawMetrics = Array.isArray(shot?.metrics)
    ? shot.metrics
    : Array.isArray(shot?.stats)
      ? shot.stats
      : Array.isArray(staging.metrics)
        ? staging.metrics
        : [];

  const metrics = [0, 1, 2].map((idx) => parseMetricItem(rawMetrics[idx], defaultMetrics[idx]));

  const previewRel = normalizeRelativeAssetPath(
    shot?.clipRelPath ||
      shot?.sourceClip ||
      shot?.plateRelPath ||
      shot?.plateImage ||
      staging.plateImage ||
      staging.sourceClip,
  );

  const previewMedia = renderLayerMedia({
    pfx,
    slotName: "preview",
    relPath: previewRel,
    dur,
    trackIndex: 1,
    synthHtml: `<div id="${pfx}-preview-synth" class="${pfx}-preview-synth">
      <div class="${pfx}-telemetry-bar ${pfx}-bar-a"></div>
      <div class="${pfx}-telemetry-bar ${pfx}-bar-b"></div>
      <div class="${pfx}-telemetry-bar ${pfx}-bar-c"></div>
    </div>`,
  });

  const previewSlotAttrs = previewMedia.wrapperTimedAttrs
    ? `id="${pfx}-preview-slot"${previewMedia.wrapperTimedAttrs}`
    : `id="${pfx}-preview-slot" class="${pfx}-untimed-slot"`;

  const shortSide = Math.min(w, h);
  const readFloorPx = Math.max(18, Math.ceil(shortSide * 0.027));
  const headingPx = Math.max(readFloorPx + 12, isLandscape ? 42 : 44);
  const subPx = Math.max(readFloorPx, isLandscape ? 28 : 29);
  const labelPx = Math.max(readFloorPx, isLandscape ? 28 : 29);
  const statFontPx = isLandscape ? 58 : 54;
  const previewH = isLandscape ? Math.round(safeH * 0.25) : Math.round(safeH * 0.22);

  const introDur = Number(Math.min(0.42, dur * 0.18).toFixed(2));
  const countDur = Number(Math.max(0.55, dur * 0.56).toFixed(2));
  const driftDur = Number(Math.max(0.6, dur * 0.9).toFixed(2));

  const metricCardsHtml = metrics
    .map((m, idx) => {
      const n = idx + 1;
      return `          <div
            id="${pfx}-metric-clip-${n}"
            class="clip ${pfx}-metric-clip"
            data-start="0"
            data-duration="${dur}"
            data-track-index="2"
          >
            <div id="${pfx}-metric-card-${n}" class="${pfx}-metric-card">
              <div class="${pfx}-metric-top">
                <span class="${pfx}-metric-label">${escapeHtml(m.label)}</span>
                <span class="${pfx}-metric-delta" data-layout-ignore>${escapeHtml(m.delta)}</span>
              </div>
              <div id="${pfx}-stat-val-${n}" class="${pfx}-stat-value">${escapeHtml(m.formatted)}</div>
              <div class="${pfx}-bar-track">
                <div id="${pfx}-stat-bar-${n}" class="${pfx}-bar-fill"></div>
              </div>
            </div>
          </div>`;
    })
    .join("\n");

  const counterTweensJs = metrics
    .map((m, idx) => {
      const n = idx + 1;
      const propKey = `v${n}`;
      const offset = Number((0.06 + idx * 0.08).toFixed(2));
      return `        const valEl${n} = document.getElementById("${pfx}-stat-val-${n}");
        const proxy${n} = { ${propKey}: 0 };
        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-metric-card-${n}',
          { opacity: 0, y: 20, scale: 0.96 },
          { opacity: 1, y: 0, scale: 1, duration: ${introDur}, ease: "power3.out" },
          ${offset},
        );
        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-stat-bar-${n}',
          { scaleX: 0 },
          { scaleX: 1, duration: ${countDur}, ease: "power3.out" },
          ${offset},
        );
        tl.fromTo(
          proxy${n},
          { ${propKey}: 0 },
          {
            ${propKey}: ${m.target},
            duration: ${countDur},
            ease: "power2.out",
            onUpdate: function () {
              if (valEl${n}) {
                valEl${n}.textContent = "${escapeJsString(m.prefix)}" + proxy${n}.${propKey}.toFixed(${m.decimals}) + "${escapeJsString(m.suffix)}";
              }
            },
          },
          ${offset},
        );`;
    })
    .join("\n");

  return `<template id="${escapeHtml(compId)}-template">
  <div data-composition-id="${escapeHtml(compId)}" data-width="${w}" data-height="${h}" data-duration="${dur}">
    <style>
      [data-composition-id="${escapeHtml(compId)}"] {
        position: relative;
        width: ${w}px;
        height: ${h}px;
        overflow: hidden;
        background-color: #0A1410;
        font-family: "Inter", sans-serif;
        color: #FFFFFF;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-canvas {
        position: absolute;
        inset: 0;
        background: linear-gradient(165deg, ${palette.background} 0%, #0A1410 62%, #050B09 100%);
        overflow: hidden;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-safe {
        position: absolute;
        left: ${padX}px;
        top: ${padY}px;
        width: ${safeW}px;
        height: ${safeH}px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 18px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-header-card {
        background-color: #0A1410;
        border: 2px solid ${palette.primary};
        border-radius: 24px;
        padding: 20px 26px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-gold-badge {
        display: inline-block;
        align-self: flex-start;
        background-color: #FACC15;
        color: #08120E;
        font-size: 15px;
        font-weight: 800;
        letter-spacing: 0.06em;
        padding: 5px 14px;
        border-radius: 999px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-headline {
        margin: 0;
        color: #FFFFFF;
        font-size: ${headingPx}px;
        font-weight: 800;
        line-height: 1.14;
        letter-spacing: -0.02em;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-subline {
        margin: 0;
        color: #E2E8F0;
        font-size: ${subPx}px;
        font-weight: 500;
        line-height: 1.32;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-metrics-grid {
        display: flex;
        flex-direction: ${isLandscape ? "row" : "column"};
        gap: 16px;
        flex: 1 1 auto;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-metric-clip {
        flex: 1 1 0;
        display: flex;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-metric-card {
        width: 100%;
        background-color: #0A1410;
        border: 2px solid ${palette.secondary};
        border-radius: 22px;
        padding: 18px 22px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 10px;
        transform-origin: center center;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-metric-top {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-metric-label {
        color: #E2E8F0;
        font-size: ${labelPx}px;
        font-weight: 700;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-metric-delta {
        background-color: #FACC15;
        color: #08120E;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.05em;
        padding: 4px 10px;
        border-radius: 999px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-stat-value {
        color: #FFFFFF;
        font-size: ${statFontPx}px;
        font-weight: 900;
        line-height: 1.04;
        letter-spacing: -0.03em;
        font-variant-numeric: tabular-nums;
        font-feature-settings: "tnum" 1;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-bar-track {
        width: 100%;
        height: 8px;
        border-radius: 999px;
        background-color: #162820;
        overflow: hidden;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-bar-fill {
        width: 100%;
        height: 100%;
        border-radius: 999px;
        background-color: #FACC15;
        transform-origin: left center;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-preview-frame {
        position: relative;
        width: 100%;
        height: ${previewH}px;
        border-radius: 22px;
        border: 2px solid ${palette.primary};
        background-color: #0A1410;
        overflow: hidden;
        box-sizing: border-box;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-preview-rig {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transform-origin: center center;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-timed-slot,
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-untimed-slot {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-media {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-preview-synth {
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, #0F221A 0%, #0A1410 65%, ${palette.primary} 100%);
        padding: 24px;
        box-sizing: border-box;
        display: flex;
        flex-direction: row;
        align-items: flex-end;
        gap: 14px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-telemetry-bar {
        flex: 1 1 0;
        border-radius: 10px;
        background-color: ${palette.secondary};
        opacity: 0.45;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-bar-a {
        height: 45%;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-bar-b {
        height: 72%;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-bar-c {
        height: 90%;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-preview-tag {
        position: absolute;
        left: 16px;
        top: 14px;
        background-color: #0A1410;
        color: #FFFFFF;
        border: 1px solid ${palette.secondary};
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.05em;
        padding: 4px 12px;
        border-radius: 999px;
        z-index: 2;
      }
    </style>

    <div class="${pfx}-canvas">
      <div class="${pfx}-safe">
        <div
          id="${pfx}-header-clip"
          class="clip ${pfx}-header-clip"
          data-start="0"
          data-duration="${dur}"
          data-track-index="1"
        >
          <div id="${pfx}-header-card" class="${pfx}-header-card">
            <span id="${pfx}-badge" class="${pfx}-gold-badge" data-layout-ignore>${badgeText}</span>
            <h1 id="${pfx}-headline" class="${pfx}-headline">${headlineText}</h1>
            <p id="${pfx}-subline" class="${pfx}-subline">${subheadlineText}</p>
          </div>
        </div>

        <div class="${pfx}-metrics-grid">
${metricCardsHtml}
        </div>

        <div id="${pfx}-preview-frame" class="${pfx}-preview-frame" data-layout-allow-overflow>
          <div id="${pfx}-preview-rig" class="${pfx}-preview-rig" data-layout-allow-overflow>
            <div ${previewSlotAttrs} data-layout-allow-overflow>
              ${previewMedia.innerHtml}
            </div>
          </div>
          <div id="${pfx}-preview-tag" class="${pfx}-preview-tag" data-layout-ignore>FRAMED PREVIEW PLATE</div>
        </div>
      </div>
    </div>

    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });

        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-header-card',
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: ${introDur}, ease: "power3.out" },
          0,
        );

        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-preview-rig',
          { scale: 1, x: 0, y: 0 },
          { scale: 1.06, x: -8, y: -4, duration: ${driftDur}, ease: "sine.inOut" },
          0,
        );

${counterTweensJs}

        window.__timelines = window.__timelines || {};
        window.__timelines["${escapeJsString(compId)}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

export function renderArchetypeScene({
  archetypeId,
  compositionId = "scene-wipe-metrics",
  width = 1080,
  height = 1920,
  durationSeconds = 4,
  shot = {},
  brandColors = {},
} = {}) {
  const compId = sanitizeCompositionId(compositionId);
  const pfx = buildSafePrefix(compId);
  const w = Math.max(240, Math.round(Number(width) || 1080));
  const h = Math.max(240, Math.round(Number(height) || 1920));
  const dur = Math.max(0.5, Math.round((Number(durationSeconds) || 4) * 100) / 100);
  const palette = normalizeBrandPalette(brandColors);

  if (archetypeId === "before-after-wipe") {
    return renderBeforeAfterWipeScene({ compId, pfx, w, h, dur, shot, palette });
  }
  if (archetypeId === "metric-counter-wall") {
    return renderMetricCounterWallScene({ compId, pfx, w, h, dur, shot, palette });
  }

  throw new Error(
    `Unsupported archetypeId "${String(archetypeId)}" in ${PACK_ID}. Expected one of: ${ARCHETYPES.map((a) => a.id).join(", ")}`,
  );
}

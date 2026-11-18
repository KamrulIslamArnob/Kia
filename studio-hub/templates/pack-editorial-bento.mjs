const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".avif"]);

export const ARCHETYPES = Object.freeze([
  Object.freeze({
    id: "split-editorial",
    name: "Split Editorial",
    pack: "editorial-bento",
    category: "editorial",
    description:
      "Asymmetric 52/48 split pairing an oversized display headline, step number tag, and accent bar with a framed video or image plate.",
    supportedAspects: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    defaultDuration: 4.0,
    features: Object.freeze([
      "asymmetric-52-48-split",
      "oversized-display-headline",
      "step-number-tag",
      "accent-bar",
      "framed-media-plate",
    ]),
  }),
  Object.freeze({
    id: "bento-feature-grid",
    name: "Bento Feature Grid",
    pack: "editorial-bento",
    category: "feature-grid",
    description:
      "Tight 3-cell bento feature grid showcasing 3 keyframes or clips alongside a high-contrast metric badge cell with staggered GSAP pop-in.",
    supportedAspects: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    defaultDuration: 4.5,
    features: Object.freeze([
      "3-cell-bento-grid",
      "3-keyframe-clip-slots",
      "metric-badge-cell",
      "staggered-gsap-pop-in",
    ]),
  }),
]);

export function getArchetypeById(archetypeId) {
  return ARCHETYPES.find((entry) => entry.id === archetypeId) || null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function round3(num) {
  return Math.round(Number(num || 0) * 1000) / 1000;
}

function sanitizeCompositionId(raw, fallback = "scene_editorial_01") {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `s_${cleaned}` : cleaned;
}

function sanitizePrefix(compId) {
  const token = String(compId || "scene")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
  if (!token) return "eb";
  return /^[0-9]/.test(token) ? `eb${token}` : token;
}

function sanitizeHexColor(raw, fallback) {
  const str = String(raw || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(str)) return str.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(str)) {
    const r = str[1];
    const g = str[2];
    const b = str[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

function sanitizeGsapEase(raw, fallback = "power3.out") {
  const cleaned = String(raw || "").trim();
  if (!cleaned || /bounce|elastic/i.test(cleaned)) return fallback;
  if (/^[a-zA-Z0-9_.()-]+$/.test(cleaned)) return cleaned;
  return fallback;
}

function detectMediaKind(srcPath) {
  if (!srcPath) return "none";
  const clean = String(srcPath).split(/[?#]/)[0].toLowerCase();
  const dotIdx = clean.lastIndexOf(".");
  if (dotIdx === -1) return "none";
  const ext = clean.slice(dotIdx);
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "none";
}

function normalizeRelativeAssetPath(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return null;
  let cleaned = rawPath.trim().replaceAll("\\", "/");
  if (!cleaned) return null;
  if (/^(?:https?:|data:|blob:|file:)/i.test(cleaned)) return null;

  cleaned = cleaned.replace(/^\/+/, "");
  const parts = cleaned
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..");
  if (parts.length === 0) return null;

  const joined = parts.join("/");
  if (joined.startsWith("assets/")) return joined;

  const kind = detectMediaKind(joined);
  if (joined.startsWith("clips/") || joined.startsWith("images/") || joined.startsWith("audio/")) {
    return `assets/${joined}`;
  }
  if (kind === "video") return `assets/clips/${parts[parts.length - 1]}`;
  if (kind === "image") return `assets/images/${parts[parts.length - 1]}`;
  return `assets/${joined}`;
}

function formatStepTag(shot) {
  const rawStep =
    shot?.stepNumber ??
    shot?.staging?.stepNumber ??
    (Number.isFinite(Number(shot?.index)) ? Number(shot.index) + 1 : 1);
  const numeric = Number(rawStep);
  if (Number.isFinite(numeric) && numeric > 0) {
    return `STEP ${String(Math.round(numeric)).padStart(2, "0")}`;
  }
  const text = String(rawStep || "01")
    .trim()
    .toUpperCase();
  return text.startsWith("STEP") ? text : `STEP ${text}`;
}

function resolveBrandTokens(brandColors = {}) {
  return {
    primary: sanitizeHexColor(brandColors?.primary, "#1E824C"),
    secondary: sanitizeHexColor(brandColors?.secondary, "#2ECC71"),
    accent: sanitizeHexColor(brandColors?.accent, "#FACC15"),
    stageBg: "#0A1410",
    cardBg: "#0A1410",
    cardElevatedBg: "#0E1C16",
    textPrimary: "#FFFFFF",
    textSecondary: "#E2E8F0",
    badgeGoldBg: "#FACC15",
    badgeDarkText: "#08120E",
  };
}

function resolveCameraParams(shot) {
  const cam = shot?.camera || shot?.cameraMotion || shot?.staging?.camera || shot?.motion || {};
  const fromScale = round3(clamp(Number(cam.fromScale) || 1.02, 0.85, 1.8));
  const toScale = round3(
    clamp(
      Number(cam.toScale) || (fromScale >= 1.08 ? fromScale : round3(fromScale + 0.08)),
      0.85,
      1.95,
    ),
  );
  const panX = round3(clamp(Number(cam.panX) || 0, -28, 28));
  const panY = round3(clamp(Number(cam.panY) || 0, -24, 24));
  const ease = sanitizeGsapEase(cam.ease, "power2.out");
  return { fromScale, toScale, panX, panY, ease };
}

function renderMediaElementHtml({
  idPrefix,
  slotSuffix,
  rawSrc,
  altText,
  durationSeconds,
  trackIndex,
  fallbackLabel,
}) {
  const normalizedSrc = normalizeRelativeAssetPath(rawSrc);
  const kind = detectMediaKind(normalizedSrc);

  if (normalizedSrc && kind === "video") {
    return `<video id="${idPrefix}-${slotSuffix}-video" class="clip ${idPrefix}-media-el" src="${escapeHtml(normalizedSrc)}" data-start="0" data-duration="${durationSeconds}" data-track-index="${trackIndex}" muted playsinline></video>`;
  }

  if (normalizedSrc && kind === "image") {
    return `<img id="${idPrefix}-${slotSuffix}-img" class="clip ${idPrefix}-media-el" src="${escapeHtml(normalizedSrc)}" alt="${escapeHtml(altText)}" data-start="0" data-duration="${durationSeconds}" data-track-index="${trackIndex}" />`;
  }

  return `<div id="${idPrefix}-${slotSuffix}-plate" class="clip ${idPrefix}-synth-plate" data-start="0" data-duration="${durationSeconds}" data-track-index="${trackIndex}">
              <div class="${idPrefix}-synth-inner">
                <span class="${idPrefix}-synth-kicker">STUDIO PLATE</span>
                <strong class="${idPrefix}-synth-title">${escapeHtml(fallbackLabel)}</strong>
              </div>
            </div>`;
}

function renderSplitEditorial({ compId, pfx, width, height, dur, shot, tokens }) {
  const isLandscape = width > height;
  const minDim = Math.min(width, height);
  const padX = Math.round(width * 0.075);
  const padY = Math.round(height * 0.08);
  const headlinePx = clamp(Math.round(minDim * (isLandscape ? 0.056 : 0.052)), 32, 76);
  const subPx = clamp(Math.round(minDim * 0.023), 18, 30);
  const tagPx = clamp(Math.round(minDim * 0.017), 14, 21);

  const stepTag = escapeHtml(formatStepTag(shot));
  const badgeText = escapeHtml(
    shot?.staging?.badgeText ||
      shot?.staging?.badge ||
      shot?.copy?.badge ||
      shot?.badge ||
      "EDITORIAL FOCUS",
  );
  const headlineText = escapeHtml(
    shot?.staging?.headline ||
      shot?.copy?.headline ||
      shot?.headline ||
      shot?.title ||
      "Oversized Editorial Story Lockup",
  );
  const subheadlineText = escapeHtml(
    shot?.staging?.subheadline ||
      shot?.copy?.subheadline ||
      shot?.subheadline ||
      shot?.description ||
      "Asymmetric 52/48 composition balancing crisp typography with framed motion footage.",
  );
  const captionNote = escapeHtml(
    shot?.staging?.captionText ||
      shot?.caption ||
      shot?.metaNote ||
      "VERIFIED STUDIO PLATE · HIGH CONTRAST",
  );

  const rawMedia =
    shot?.clipSrc ||
    shot?.clipRelPath ||
    shot?.videoSrc ||
    shot?.sourceClip ||
    shot?.mediaSrc ||
    shot?.imageSrc ||
    shot?.plateRelPath ||
    shot?.plateImage ||
    shot?.keyframes?.peak ||
    shot?.keyframes?.start ||
    null;

  const mediaHtml = renderMediaElementHtml({
    idPrefix: pfx,
    slotSuffix: "hero",
    rawSrc: rawMedia,
    altText: headlineText,
    durationSeconds: dur,
    trackIndex: 1,
    fallbackLabel: headlineText,
  });

  const cam = resolveCameraParams(shot);
  const entryDur = round3(Math.min(0.48, Math.max(0.16, dur * 0.28)));
  const barDur = round3(Math.min(0.44, Math.max(0.15, dur * 0.25)));
  const metaStart = round3(Math.min(0.22, Math.max(0.06, dur * 0.14)));
  const camDur = round3(Math.max(0.24, dur - 0.08));

  const gridTemplate = isLandscape
    ? "grid-template-columns: 52fr 48fr; grid-template-rows: 1fr;"
    : "grid-template-columns: 1fr; grid-template-rows: 52fr 48fr;";

  return `<template id="${compId}-template">
  <div data-composition-id="${compId}" data-width="${width}" data-height="${height}" data-duration="${dur}" id="root">
    <style>
      #root {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background-color: ${tokens.stageBg};
        color: ${tokens.textPrimary};
        font-family: "Inter", sans-serif;
      }
      [data-composition-id="${compId}"] .${pfx}-backdrop {
        position: absolute;
        inset: 0;
        background: linear-gradient(145deg, ${tokens.stageBg} 0%, ${tokens.cardElevatedBg} 62%, ${tokens.stageBg} 100%);
      }
      [data-composition-id="${compId}"] .${pfx}-grid {
        position: absolute;
        left: ${padX}px;
        right: ${padX}px;
        top: ${padY}px;
        bottom: ${padY}px;
        display: grid;
        ${gridTemplate}
        gap: 26px;
        align-items: stretch;
      }
      [data-composition-id="${compId}"] .${pfx}-copy-clip {
        position: relative;
        display: flex;
        min-width: 0;
        min-height: 0;
      }
      [data-composition-id="${compId}"] .${pfx}-copy-card {
        flex: 1 1 auto;
        background-color: ${tokens.cardBg};
        border: 2px solid ${tokens.primary};
        border-radius: 28px;
        padding: ${isLandscape ? "38px 40px" : "30px 32px"};
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 18px;
        box-sizing: border-box;
        overflow: hidden;
      }
      [data-composition-id="${compId}"] .${pfx}-top-group {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 16px;
      }
      [data-composition-id="${compId}"] .${pfx}-eyebrow-row {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
      }
      [data-composition-id="${compId}"] .${pfx}-step-tag {
        display: inline-flex;
        align-items: center;
        background-color: ${tokens.badgeGoldBg};
        color: ${tokens.badgeDarkText};
        font-family: "JetBrains Mono", monospace;
        font-size: ${tagPx}px;
        font-weight: 800;
        letter-spacing: 0.06em;
        padding: 7px 14px;
        border-radius: 999px;
      }
      [data-composition-id="${compId}"] .${pfx}-kicker-pill {
        display: inline-flex;
        align-items: center;
        background-color: ${tokens.cardElevatedBg};
        color: ${tokens.textPrimary};
        border: 1px solid ${tokens.secondary};
        font-size: ${tagPx}px;
        font-weight: 700;
        letter-spacing: 0.05em;
        padding: 7px 14px;
        border-radius: 999px;
      }
      [data-composition-id="${compId}"] .${pfx}-accent-bar {
        width: 108px;
        height: 6px;
        border-radius: 999px;
        background: linear-gradient(90deg, ${tokens.badgeGoldBg} 0%, ${tokens.accent} 52%, ${tokens.secondary} 100%);
        transform-origin: left center;
      }
      [data-composition-id="${compId}"] .${pfx}-headline {
        margin: 0;
        color: ${tokens.textPrimary};
        font-size: ${headlinePx}px;
        font-weight: 900;
        line-height: 1.07;
        letter-spacing: -0.03em;
      }
      [data-composition-id="${compId}"] .${pfx}-subheadline {
        margin: 0;
        color: ${tokens.textSecondary};
        font-size: ${subPx}px;
        font-weight: 500;
        line-height: 1.38;
      }
      [data-composition-id="${compId}"] .${pfx}-meta-row {
        display: flex;
        align-items: center;
      }
      [data-composition-id="${compId}"] .${pfx}-meta-strip {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        background-color: ${tokens.cardElevatedBg};
        border: 1px solid ${tokens.primary};
        border-radius: 14px;
        padding: 10px 16px;
        color: ${tokens.textPrimary};
        font-family: "JetBrains Mono", monospace;
        font-size: ${Math.max(13, tagPx - 2)}px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
      [data-composition-id="${compId}"] .${pfx}-meta-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background-color: ${tokens.badgeGoldBg};
        flex-shrink: 0;
      }
      [data-composition-id="${compId}"] .${pfx}-plate-pane {
        position: relative;
        display: flex;
        min-width: 0;
        min-height: 0;
      }
      [data-composition-id="${compId}"] .${pfx}-plate-frame {
        position: relative;
        flex: 1 1 auto;
        background-color: ${tokens.cardBg};
        border: 3px solid ${tokens.secondary};
        border-radius: 28px;
        padding: 12px;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
      }
      [data-composition-id="${compId}"] .${pfx}-plate-viewport {
        position: relative;
        flex: 1 1 auto;
        border-radius: 18px;
        overflow: hidden;
        background-color: ${tokens.cardElevatedBg};
      }
      [data-composition-id="${compId}"] .${pfx}-media-rig {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transform-origin: center center;
      }
      [data-composition-id="${compId}"] .${pfx}-media-el {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      [data-composition-id="${compId}"] .${pfx}-synth-plate {
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, ${tokens.primary} 0%, ${tokens.cardElevatedBg} 60%, ${tokens.stageBg} 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        box-sizing: border-box;
      }
      [data-composition-id="${compId}"] .${pfx}-synth-inner {
        background-color: ${tokens.cardBg};
        border: 2px solid ${tokens.badgeGoldBg};
        border-radius: 20px;
        padding: 20px 24px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-width: 86%;
      }
      [data-composition-id="${compId}"] .${pfx}-synth-kicker {
        color: ${tokens.badgeGoldBg};
        font-family: "JetBrains Mono", monospace;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0.08em;
      }
      [data-composition-id="${compId}"] .${pfx}-synth-title {
        color: ${tokens.textPrimary};
        font-size: 22px;
        font-weight: 800;
        line-height: 1.25;
      }
      [data-composition-id="${compId}"] .${pfx}-plate-chip-clip {
        position: absolute;
        top: 24px;
        right: 24px;
        z-index: 2;
      }
      [data-composition-id="${compId}"] .${pfx}-plate-chip {
        background-color: ${tokens.badgeGoldBg};
        color: ${tokens.badgeDarkText};
        font-family: "JetBrains Mono", monospace;
        font-size: ${Math.max(13, tagPx - 2)}px;
        font-weight: 800;
        letter-spacing: 0.06em;
        padding: 6px 14px;
        border-radius: 999px;
      }
    </style>

    <div class="${pfx}-backdrop"></div>
    <div class="${pfx}-grid">
      <div id="${pfx}-copy-clip" class="clip ${pfx}-copy-clip" data-start="0" data-duration="${dur}" data-track-index="2">
        <div id="${pfx}-copy-card" class="${pfx}-copy-card">
          <div class="${pfx}-top-group">
            <div class="${pfx}-eyebrow-row">
              <span id="${pfx}-step-tag" class="${pfx}-step-tag">${stepTag}</span>
              <span id="${pfx}-kicker" class="${pfx}-kicker-pill">${badgeText}</span>
            </div>
            <div id="${pfx}-accent-bar" class="accent-bar ${pfx}-accent-bar"></div>
            <h1 id="${pfx}-headline" class="${pfx}-headline">${headlineText}</h1>
            <p id="${pfx}-subheadline" class="${pfx}-subheadline">${subheadlineText}</p>
          </div>
          <div class="${pfx}-meta-row">
            <div id="${pfx}-meta-strip" class="${pfx}-meta-strip">
              <span class="${pfx}-meta-dot"></span>
              <span>${captionNote}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="${pfx}-plate-pane">
        <div id="${pfx}-plate-frame" class="${pfx}-plate-frame">
          <div class="${pfx}-plate-viewport" data-layout-allow-overflow>
            <div id="${pfx}-media-rig" class="${pfx}-media-rig" data-layout-allow-overflow>
              ${mediaHtml}
            </div>
          </div>
          <div id="${pfx}-plate-chip-clip" class="clip ${pfx}-plate-chip-clip" data-start="0" data-duration="${dur}" data-track-index="3">
            <div id="${pfx}-plate-chip" class="${pfx}-plate-chip">52 / 48 FRAME</div>
          </div>
        </div>
      </div>
    </div>

    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });
        tl.fromTo(
          "#${pfx}-copy-card",
          { opacity: 0, x: -32 },
          { opacity: 1, x: 0, duration: ${entryDur}, ease: "power4.out" },
          0,
        );
        tl.fromTo(
          "#${pfx}-step-tag",
          { opacity: 0, y: 12, scale: 0.92 },
          { opacity: 1, y: 0, scale: 1, duration: ${barDur}, ease: "back.out(1.4)" },
          0.04,
        );
        tl.fromTo(
          "#${pfx}-accent-bar",
          { scaleX: 0, opacity: 0 },
          { scaleX: 1, opacity: 1, duration: ${barDur}, ease: "expo.out" },
          0.08,
        );
        tl.fromTo(
          "#${pfx}-headline",
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: ${entryDur}, ease: "power3.out" },
          0.1,
        );
        tl.fromTo(
          "#${pfx}-subheadline",
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: ${entryDur}, ease: "power3.out" },
          0.14,
        );
        tl.fromTo(
          "#${pfx}-plate-frame",
          { opacity: 0, x: 32 },
          { opacity: 1, x: 0, duration: ${entryDur}, ease: "power4.out" },
          0.06,
        );
        tl.fromTo(
          "#${pfx}-meta-strip",
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: ${barDur}, ease: "power2.out" },
          ${metaStart},
        );
        tl.fromTo(
          "#${pfx}-plate-chip",
          { opacity: 0, scale: 0.88 },
          { opacity: 1, scale: 1, duration: ${barDur}, ease: "back.out(1.4)" },
          ${metaStart},
        );
        tl.fromTo(
          "#${pfx}-media-rig",
          { scale: ${cam.fromScale}, x: 0, y: 0 },
          {
            scale: ${cam.toScale},
            x: ${cam.panX},
            y: ${cam.panY},
            duration: ${camDur},
            ease: "${cam.ease}",
          },
          0,
        );
        window.__timelines = window.__timelines || {};
        window.__timelines["${compId}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

function resolveBentoMediaSlots(shot) {
  const candidates = [];
  const listSource =
    (Array.isArray(shot?.bentoMedia) && shot.bentoMedia) ||
    (Array.isArray(shot?.clips) && shot.clips) ||
    (Array.isArray(shot?.mediaItems) && shot.mediaItems) ||
    null;

  if (listSource) {
    for (const item of listSource.slice(0, 3)) {
      if (typeof item === "string") {
        candidates.push(item);
      } else if (item && typeof item === "object") {
        candidates.push(item.src || item.path || item.relPath || null);
      }
    }
  }

  const fallbacks = [
    shot?.keyframes?.start ||
      shot?.clipSrc ||
      shot?.clipRelPath ||
      shot?.videoSrc ||
      shot?.sourceClip ||
      shot?.imageSrc ||
      shot?.plateRelPath ||
      null,
    shot?.keyframes?.peak || shot?.secondarySrc || shot?.plateImage || null,
    shot?.keyframes?.end || shot?.tertiarySrc || null,
  ];

  for (let i = 0; i < 3; i++) {
    if (!candidates[i]) {
      candidates[i] = fallbacks[i] || fallbacks[0] || null;
    }
  }
  return candidates.slice(0, 3);
}

function resolveBentoFeatureLabels(shot) {
  const rawList =
    (Array.isArray(shot?.bullets) && shot.bullets) ||
    (Array.isArray(shot?.featureLabels) && shot.featureLabels) ||
    (Array.isArray(shot?.staging?.bullets) && shot.staging.bullets) ||
    [];
  const defaults = ["Keyframe Capture", "Smart Choreography", "Instant Delivery"];
  return [0, 1, 2].map((idx) => String(rawList[idx] || defaults[idx]).trim());
}

function renderBentoFeatureGrid({ compId, pfx, width, height, dur, shot, tokens }) {
  const isLandscape = width > height;
  const minDim = Math.min(width, height);
  const padX = Math.round(width * 0.075);
  const padY = Math.round(height * 0.075);
  const titlePx = clamp(Math.round(minDim * (isLandscape ? 0.044 : 0.042)), 28, 56);
  const metricValPx = clamp(Math.round(minDim * (isLandscape ? 0.056 : 0.052)), 34, 72);
  const labelPx = clamp(Math.round(minDim * 0.018), 14, 21);

  const badgeText = escapeHtml(
    shot?.staging?.badgeText ||
      shot?.staging?.badge ||
      shot?.copy?.badge ||
      shot?.badge ||
      "BENTO FEATURE MATRIX",
  );
  const headlineText = escapeHtml(
    shot?.staging?.headline ||
      shot?.copy?.headline ||
      shot?.headline ||
      shot?.title ||
      "Three Precision Views in One Tight Bento",
  );

  const metricValue = escapeHtml(
    shot?.metricValue || shot?.metric?.value || shot?.staging?.metricValue || "3.4x",
  );
  const metricLabel = escapeHtml(
    shot?.metricLabel || shot?.metric?.label || shot?.staging?.metricLabel || "FASTER PIPELINE",
  );
  const metricSub = escapeHtml(
    shot?.metricSub ||
      shot?.metric?.sublabel ||
      shot?.staging?.subheadline ||
      shot?.subheadline ||
      "Deterministic frame-accurate output",
  );

  const mediaSlots = resolveBentoMediaSlots(shot);
  const featureLabels = resolveBentoFeatureLabels(shot).map(escapeHtml);

  const cell1Media = renderMediaElementHtml({
    idPrefix: pfx,
    slotSuffix: "c1",
    rawSrc: mediaSlots[0],
    altText: featureLabels[0],
    durationSeconds: dur,
    trackIndex: 2,
    fallbackLabel: featureLabels[0],
  });
  const cell2Media = renderMediaElementHtml({
    idPrefix: pfx,
    slotSuffix: "c2",
    rawSrc: mediaSlots[1],
    altText: featureLabels[1],
    durationSeconds: dur,
    trackIndex: 2,
    fallbackLabel: featureLabels[1],
  });
  const cell3Media = renderMediaElementHtml({
    idPrefix: pfx,
    slotSuffix: "c3",
    rawSrc: mediaSlots[2],
    altText: featureLabels[2],
    durationSeconds: dur,
    trackIndex: 3,
    fallbackLabel: featureLabels[2],
  });

  const cam = resolveCameraParams(shot);
  const popDur = round3(Math.min(0.42, Math.max(0.16, dur * 0.24)));
  const staggerStep = round3(Math.min(0.09, Math.max(0.03, dur * 0.05)));
  const t1 = round3(0.06);
  const t2 = round3(t1 + staggerStep);
  const t3 = round3(t2 + staggerStep);
  const t4 = round3(t3 + staggerStep);
  const camDur = round3(Math.max(0.24, dur - 0.08));

  const mosaicCss = isLandscape
    ? `
        grid-template-columns: 54fr 23fr 23fr;
        grid-template-rows: 58fr 42fr;
      `
    : `
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 46fr 30fr 24fr;
      `;

  const cellPlacementCss = isLandscape
    ? `
      [data-composition-id="${compId}"] .${pfx}-slot-1 {
        grid-column: 1 / 2;
        grid-row: 1 / 3;
      }
      [data-composition-id="${compId}"] .${pfx}-slot-2 {
        grid-column: 2 / 3;
        grid-row: 1 / 2;
      }
      [data-composition-id="${compId}"] .${pfx}-slot-3 {
        grid-column: 3 / 4;
        grid-row: 1 / 2;
      }
      [data-composition-id="${compId}"] .${pfx}-slot-metric {
        grid-column: 2 / 4;
        grid-row: 2 / 3;
      }
    `
    : `
      [data-composition-id="${compId}"] .${pfx}-slot-1 {
        grid-column: 1 / 3;
        grid-row: 1 / 2;
      }
      [data-composition-id="${compId}"] .${pfx}-slot-2 {
        grid-column: 1 / 2;
        grid-row: 2 / 3;
      }
      [data-composition-id="${compId}"] .${pfx}-slot-3 {
        grid-column: 2 / 3;
        grid-row: 2 / 3;
      }
      [data-composition-id="${compId}"] .${pfx}-slot-metric {
        grid-column: 1 / 3;
        grid-row: 3 / 4;
      }
    `;

  return `<template id="${compId}-template">
  <div data-composition-id="${compId}" data-width="${width}" data-height="${height}" data-duration="${dur}" id="root">
    <style>
      #root {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background-color: ${tokens.stageBg};
        color: ${tokens.textPrimary};
        font-family: "Inter", sans-serif;
      }
      [data-composition-id="${compId}"] .${pfx}-backdrop {
        position: absolute;
        inset: 0;
        background: linear-gradient(160deg, ${tokens.stageBg} 0%, ${tokens.cardElevatedBg} 65%, ${tokens.stageBg} 100%);
      }
      [data-composition-id="${compId}"] .${pfx}-shell {
        position: absolute;
        left: ${padX}px;
        right: ${padX}px;
        top: ${padY}px;
        bottom: ${padY}px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      [data-composition-id="${compId}"] .${pfx}-header-clip {
        flex: 0 0 auto;
      }
      [data-composition-id="${compId}"] .${pfx}-header-bar {
        background-color: ${tokens.cardBg};
        border: 2px solid ${tokens.primary};
        border-radius: 22px;
        padding: 18px 24px;
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
      }
      [data-composition-id="${compId}"] .${pfx}-headline {
        margin: 0;
        color: ${tokens.textPrimary};
        font-size: ${titlePx}px;
        font-weight: 900;
        line-height: 1.1;
        letter-spacing: -0.025em;
      }
      [data-composition-id="${compId}"] .${pfx}-gold-pill {
        display: inline-flex;
        align-items: center;
        background-color: ${tokens.badgeGoldBg};
        color: ${tokens.badgeDarkText};
        font-family: "JetBrains Mono", monospace;
        font-size: ${labelPx}px;
        font-weight: 800;
        letter-spacing: 0.06em;
        padding: 6px 14px;
        border-radius: 999px;
      }
      [data-composition-id="${compId}"] .${pfx}-bento-chassis {
        flex: 1 1 auto;
        min-height: 0;
        background-color: ${tokens.cardBg};
        border: 2px solid ${tokens.primary};
        border-radius: 26px;
        padding: 10px;
        display: grid;
        ${mosaicCss}
        gap: 10px;
        box-sizing: border-box;
      }
      ${cellPlacementCss}
      [data-composition-id="${compId}"] .${pfx}-cell-slot {
        position: relative;
        min-width: 0;
        min-height: 0;
        display: flex;
      }
      [data-composition-id="${compId}"] .${pfx}-bento-card {
        position: relative;
        flex: 1 1 auto;
        border-radius: 18px;
        overflow: hidden;
        background-color: ${tokens.cardElevatedBg};
        border: 2px solid ${tokens.secondary};
      }
      [data-composition-id="${compId}"] .${pfx}-cell-rig {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transform-origin: center center;
      }
      [data-composition-id="${compId}"] .${pfx}-media-el {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      [data-composition-id="${compId}"] .${pfx}-synth-plate {
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, ${tokens.primary} 0%, ${tokens.cardElevatedBg} 64%, ${tokens.stageBg} 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        box-sizing: border-box;
      }
      [data-composition-id="${compId}"] .${pfx}-synth-inner {
        background-color: ${tokens.cardBg};
        border: 1px solid ${tokens.badgeGoldBg};
        border-radius: 14px;
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      [data-composition-id="${compId}"] .${pfx}-synth-kicker {
        color: ${tokens.badgeGoldBg};
        font-family: "JetBrains Mono", monospace;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.07em;
      }
      [data-composition-id="${compId}"] .${pfx}-synth-title {
        color: ${tokens.textPrimary};
        font-size: 17px;
        font-weight: 800;
      }
      [data-composition-id="${compId}"] .${pfx}-cell-tag {
        position: absolute;
        left: 14px;
        bottom: 14px;
        z-index: 2;
        background-color: ${tokens.cardBg};
        color: ${tokens.textPrimary};
        border: 1px solid ${tokens.secondary};
        border-radius: 12px;
        padding: 7px 12px;
        font-size: ${labelPx}px;
        font-weight: 700;
        line-height: 1.2;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      [data-composition-id="${compId}"] .${pfx}-cell-idx {
        background-color: ${tokens.badgeGoldBg};
        color: ${tokens.badgeDarkText};
        font-family: "JetBrains Mono", monospace;
        font-size: ${Math.max(12, labelPx - 2)}px;
        font-weight: 800;
        padding: 2px 7px;
        border-radius: 6px;
      }
      [data-composition-id="${compId}"] .${pfx}-metric-card {
        flex: 1 1 auto;
        background-color: ${tokens.badgeGoldBg};
        color: ${tokens.badgeDarkText};
        border-radius: 18px;
        padding: 20px 24px;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        box-sizing: border-box;
      }
      [data-composition-id="${compId}"] .${pfx}-metric-value {
        font-family: "JetBrains Mono", monospace;
        font-size: ${metricValPx}px;
        font-weight: 900;
        line-height: 1;
        letter-spacing: -0.03em;
        color: ${tokens.badgeDarkText};
      }
      [data-composition-id="${compId}"] .${pfx}-metric-copy {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      [data-composition-id="${compId}"] .${pfx}-metric-label {
        font-family: "JetBrains Mono", monospace;
        font-size: ${labelPx}px;
        font-weight: 900;
        letter-spacing: 0.06em;
        color: ${tokens.badgeDarkText};
      }
      [data-composition-id="${compId}"] .${pfx}-metric-sub {
        font-size: ${Math.max(14, labelPx - 1)}px;
        font-weight: 700;
        color: ${tokens.badgeDarkText};
      }
    </style>

    <div class="${pfx}-backdrop"></div>
    <div class="${pfx}-shell">
      <div id="${pfx}-header-clip" class="clip ${pfx}-header-clip" data-start="0" data-duration="${dur}" data-track-index="1">
        <div id="${pfx}-header-bar" class="${pfx}-header-bar">
          <h1 id="${pfx}-headline" class="${pfx}-headline">${headlineText}</h1>
          <span id="${pfx}-badge" class="${pfx}-gold-pill">${badgeText}</span>
        </div>
      </div>

      <div class="${pfx}-bento-chassis">
        <div class="${pfx}-cell-slot ${pfx}-slot-1">
          <div id="${pfx}-bento-card-1" class="${pfx}-bento-card" data-layout-allow-overflow>
            <div id="${pfx}-rig-1" class="${pfx}-cell-rig" data-layout-allow-overflow>
              ${cell1Media}
            </div>
            <div class="${pfx}-cell-tag">
              <span class="${pfx}-cell-idx">01</span>
              <span>${featureLabels[0]}</span>
            </div>
          </div>
        </div>

        <div class="${pfx}-cell-slot ${pfx}-slot-2">
          <div id="${pfx}-bento-card-2" class="${pfx}-bento-card" data-layout-allow-overflow>
            <div id="${pfx}-rig-2" class="${pfx}-cell-rig" data-layout-allow-overflow>
              ${cell2Media}
            </div>
            <div class="${pfx}-cell-tag">
              <span class="${pfx}-cell-idx">02</span>
              <span>${featureLabels[1]}</span>
            </div>
          </div>
        </div>

        <div class="${pfx}-cell-slot ${pfx}-slot-3">
          <div id="${pfx}-bento-card-3" class="${pfx}-bento-card" data-layout-allow-overflow>
            <div id="${pfx}-rig-3" class="${pfx}-cell-rig" data-layout-allow-overflow>
              ${cell3Media}
            </div>
            <div class="${pfx}-cell-tag">
              <span class="${pfx}-cell-idx">03</span>
              <span>${featureLabels[2]}</span>
            </div>
          </div>
        </div>

        <div id="${pfx}-metric-clip" class="clip ${pfx}-cell-slot ${pfx}-slot-metric" data-start="0" data-duration="${dur}" data-track-index="3">
          <div id="${pfx}-metric-card" class="${pfx}-metric-card">
            <div class="${pfx}-metric-value">${metricValue}</div>
            <div class="${pfx}-metric-copy">
              <span class="${pfx}-metric-label">${metricLabel}</span>
              <span class="${pfx}-metric-sub">${metricSub}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });
        tl.fromTo(
          "#${pfx}-header-bar",
          { opacity: 0, y: -18 },
          { opacity: 1, y: 0, duration: ${popDur}, ease: "power3.out" },
          0,
        );
        tl.fromTo(
          "#${pfx}-bento-card-1",
          { opacity: 0, y: 24, scale: 0.92 },
          { opacity: 1, y: 0, scale: 1, duration: ${popDur}, ease: "back.out(1.35)" },
          ${t1},
        );
        tl.fromTo(
          "#${pfx}-bento-card-2",
          { opacity: 0, y: 24, scale: 0.92 },
          { opacity: 1, y: 0, scale: 1, duration: ${popDur}, ease: "back.out(1.35)" },
          ${t2},
        );
        tl.fromTo(
          "#${pfx}-bento-card-3",
          { opacity: 0, y: 24, scale: 0.92 },
          { opacity: 1, y: 0, scale: 1, duration: ${popDur}, ease: "back.out(1.35)" },
          ${t3},
        );
        tl.fromTo(
          "#${pfx}-metric-card",
          { opacity: 0, y: 20, scale: 0.94 },
          { opacity: 1, y: 0, scale: 1, duration: ${popDur}, ease: "back.out(1.45)" },
          ${t4},
        );
        tl.fromTo(
          "#${pfx}-rig-1",
          { scale: ${cam.fromScale}, x: 0, y: 0 },
          { scale: ${cam.toScale}, x: ${cam.panX}, y: ${cam.panY}, duration: ${camDur}, ease: "${cam.ease}" },
          0,
        );
        tl.fromTo(
          "#${pfx}-rig-2",
          { scale: 1.08, x: 0, y: 0 },
          { scale: 1.0, x: 0, y: -6, duration: ${camDur}, ease: "power2.out" },
          0,
        );
        tl.fromTo(
          "#${pfx}-rig-3",
          { scale: 1.0, x: 0, y: 0 },
          { scale: 1.08, x: -6, y: 0, duration: ${camDur}, ease: "power2.out" },
          0,
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
  compositionId = "scene_editorial_01",
  width = 1080,
  height = 1920,
  durationSeconds = 4,
  shot = {},
  brandColors = {},
} = {}) {
  const resolvedArchetypeId = String(archetypeId || shot?.layout || shot?.archetypeId || "").trim();
  const compId = sanitizeCompositionId(compositionId);
  const pfx = sanitizePrefix(compId);
  const safeWidth = Math.max(320, Math.round(Number(width) || 1080));
  const safeHeight = Math.max(320, Math.round(Number(height) || 1920));
  const safeDuration = round3(clamp(Number(durationSeconds) || 4, 0.5, 120));
  const tokens = resolveBrandTokens(brandColors);

  if (resolvedArchetypeId === "split-editorial") {
    return renderSplitEditorial({
      compId,
      pfx,
      width: safeWidth,
      height: safeHeight,
      dur: safeDuration,
      shot: shot || {},
      tokens,
    });
  }

  if (resolvedArchetypeId === "bento-feature-grid") {
    return renderBentoFeatureGrid({
      compId,
      pfx,
      width: safeWidth,
      height: safeHeight,
      dur: safeDuration,
      shot: shot || {},
      tokens,
    });
  }

  throw new Error(
    `Unsupported archetypeId "${resolvedArchetypeId}" in pack-editorial-bento. Expected "split-editorial" or "bento-feature-grid".`,
  );
}

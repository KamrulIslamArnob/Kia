const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi"]);

export const ARCHETYPES = Object.freeze([
  Object.freeze({
    id: "fullbleed-cinema",
    name: "Full-Bleed Cinema",
    pack: "cinema-statement",
    category: "cinema",
    description:
      "Full-frame video or image plate with dark gradient lower scrim, glass pill tag, and bold lower-third title + subline.",
    defaultDuration: 4.0,
    defaultDurationSeconds: 4.0,
    supportedAspects: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    recommendedAspectRatios: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    features: Object.freeze([
      "full-frame-plate",
      "dark-gradient-lower-scrim",
      "glass-pill-tag",
      "lower-third-typography",
    ]),
    slots: Object.freeze([
      "videoSrc",
      "imageSrc",
      "tagText",
      "headline",
      "subheadline",
      "kickerText",
    ]),
  }),
  Object.freeze({
    id: "kinetic-statement-card",
    name: "Kinetic Statement Card",
    pack: "cinema-statement",
    category: "statement",
    description:
      "High-impact CTA and outro card with brand logo slot, staggered headline words, and primary CTA pill badge.",
    defaultDuration: 3.5,
    defaultDurationSeconds: 3.5,
    supportedAspects: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    recommendedAspectRatios: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    features: Object.freeze([
      "brand-logo-slot",
      "staggered-headline-words",
      "primary-cta-pill-badge",
    ]),
    slots: Object.freeze([
      "logoSrc",
      "brandName",
      "badgeText",
      "headline",
      "subheadline",
      "ctaText",
    ]),
  }),
]);

const SUPPORTED_IDS = new Set(ARCHETYPES.map((a) => a.id));

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

function escapeJsString(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "")
    .replaceAll("\n", "\\n");
}

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function round3(num) {
  return Math.round(Number(num || 0) * 1000) / 1000;
}

function sanitizeHexColor(raw, fallback) {
  const cleaned = String(raw || "").trim();
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(cleaned)) {
    return cleaned;
  }
  return fallback;
}

function sanitizePrefix(compositionId) {
  const cleaned = String(compositionId || "scene")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return "sc_scene";
  return /^[a-zA-Z]/.test(cleaned) ? cleaned : `sc_${cleaned}`;
}

function hasVideoExt(filePath) {
  const clean = String(filePath || "")
    .split(/[?#]/)[0]
    .toLowerCase();
  const dotIdx = clean.lastIndexOf(".");
  if (dotIdx === -1) return false;
  return VIDEO_EXTENSIONS.has(clean.slice(dotIdx));
}

function normalizeRelativeAssetPath(rawPath, defaultSubdir = "images") {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed)) {
    return trimmed;
  }

  const forward = trimmed.replaceAll("\\", "/").replace(/^(?:\.\/|\/)+/, "");
  const safeSegments = forward
    .split("/")
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0 && seg !== "." && seg !== "..");

  if (safeSegments.length === 0) return null;
  if (safeSegments[0] === "assets") {
    return safeSegments.join("/");
  }
  if (
    safeSegments[0] === "clips" ||
    safeSegments[0] === "images" ||
    safeSegments[0] === "fonts" ||
    safeSegments[0] === "audio"
  ) {
    return `assets/${safeSegments.join("/")}`;
  }
  return `assets/${defaultSubdir}/${safeSegments.join("/")}`;
}

function resolveShotMedia(shot = {}) {
  const staging = shot?.staging || {};
  const rawVideo =
    shot?.videoSrc ||
    shot?.clipRelPath ||
    shot?.clipSrc ||
    shot?.clip_src ||
    staging?.videoSrc ||
    (hasVideoExt(shot?.sourceClip) ? shot.sourceClip : null) ||
    (hasVideoExt(staging?.sourceClip) ? staging.sourceClip : null) ||
    null;

  const rawImage =
    shot?.imageSrc ||
    shot?.plateRelPath ||
    shot?.plateImage ||
    shot?.aiBackgroundPlate ||
    staging?.imageSrc ||
    staging?.plateImage ||
    staging?.aiBackgroundPlate ||
    (!hasVideoExt(shot?.sourceClip) ? shot?.sourceClip : null) ||
    null;

  const rawLogo =
    shot?.logoSrc ||
    shot?.logoRelPath ||
    shot?.brandLogo ||
    staging?.logoSrc ||
    staging?.logoRelPath ||
    null;

  return {
    videoSrc: normalizeRelativeAssetPath(rawVideo, "clips"),
    imageSrc: normalizeRelativeAssetPath(rawImage, "images"),
    logoSrc: normalizeRelativeAssetPath(rawLogo, "images"),
  };
}

function splitHeadlineWords(text, maxSpans = 12) {
  const tokens = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return ["Ready", "Now"];
  if (tokens.length <= maxSpans) return tokens;
  return [...tokens.slice(0, maxSpans - 1), tokens.slice(maxSpans - 1).join(" ")];
}

function renderFullbleedCinema({ compId, pfx, width, height, durAttr, durNum, shot, colors }) {
  const isLandscape = width >= height;
  const minDim = Math.min(width, height);
  const typeFloor = Math.max(18, Math.ceil(minDim * 0.027));
  const titleSize = Math.round(clamp(minDim * (isLandscape ? 0.056 : 0.052), typeFloor + 12, 82));
  const subSize = Math.round(clamp(minDim * 0.029, typeFloor + 2, 38));
  const pillSize = Math.round(clamp(minDim * 0.027, typeFloor, 32));
  const padCard = Math.round(clamp(minDim * 0.032, 24, 42));

  const staging = shot?.staging || {};
  const copy = shot?.copy || {};
  const cam = shot?.camera || shot?.cameraMotion || staging?.camera || {};

  const tagText = escapeHtml(
    shot?.tagText ||
      shot?.badgeText ||
      shot?.badge ||
      staging?.badgeText ||
      staging?.badge ||
      copy?.badge ||
      "FEATURED CINEMA",
  );
  const kickerText = escapeHtml(
    shot?.kickerText || shot?.kicker || staging?.kickerText || copy?.kicker || "STUDIO PRO",
  );
  const headline = escapeHtml(
    shot?.headline ||
      shot?.title ||
      staging?.headline ||
      copy?.headline ||
      "Built For Pure Visual Momentum",
  );
  const subheadline = escapeHtml(
    shot?.subheadline ||
      shot?.subline ||
      shot?.subtitle ||
      shot?.description ||
      staging?.subheadline ||
      copy?.subheadline ||
      "Full-frame cinema plate balanced with deep lower scrim contrast.",
  );

  const fromScale = round3(clamp(Number(cam.fromScale) || 1.1, 0.85, 2.2));
  const toScale = round3(clamp(Number(cam.toScale) || 1.0, 0.85, 2.2));
  const panX = round3(clamp(Number(cam.panX) || 0, -64, 64));
  const panY = round3(clamp(Number(cam.panY) || 0, -64, 64));
  const ease = escapeJsString(cam.ease || "power2.out");

  const { videoSrc, imageSrc } = resolveShotMedia(shot);

  let plateMediaHtml = "";
  if (videoSrc) {
    plateMediaHtml = `<video id="${pfx}-video" class="clip ${pfx}-plate-media" data-start="0" data-duration="${durAttr}" data-track-index="1" src="${escapeHtml(videoSrc)}" muted playsinline></video>`;
  } else if (imageSrc) {
    plateMediaHtml = `<img id="${pfx}-image" class="clip ${pfx}-plate-media" data-start="0" data-duration="${durAttr}" data-track-index="1" src="${escapeHtml(imageSrc)}" alt="${headline}" />`;
  } else {
    plateMediaHtml = `<div id="${pfx}-synth-plate" class="clip ${pfx}-synth-plate" data-start="0" data-duration="${durAttr}" data-track-index="1"></div>`;
  }

  const plateDur = round3(Math.max(0.35, durNum * 0.92));
  const pillDur = round3(Math.min(0.45, durNum * 0.24));
  const cardDur = round3(Math.min(0.52, durNum * 0.28));
  const textDur = round3(Math.min(0.46, durNum * 0.25));

  const escapedCompId = escapeHtml(compId);
  const jsCompId = escapeJsString(compId);

  return `<template id="${escapedCompId}-template">
  <div
    id="root"
    data-composition-id="${escapedCompId}"
    data-width="${width}"
    data-height="${height}"
    data-duration="${durAttr}"
  >
    <div id="${pfx}-plate-rig" class="${pfx}-plate-rig" data-layout-allow-overflow>
      ${plateMediaHtml}
    </div>

    <div
      id="${pfx}-scrim-clip"
      class="clip ${pfx}-scrim-layer"
      data-start="0"
      data-duration="${durAttr}"
      data-track-index="2"
    >
      <div id="${pfx}-lower-scrim" class="${pfx}-lower-scrim"></div>
    </div>

    <div
      id="${pfx}-tag-clip"
      class="clip ${pfx}-tag-layer"
      data-start="0"
      data-duration="${durAttr}"
      data-track-index="3"
    >
      <div id="${pfx}-glass-pill" class="${pfx}-glass-pill">
        <span class="${pfx}-pill-chip" data-layout-ignore>${kickerText}</span>
        <span class="${pfx}-pill-label">${tagText}</span>
      </div>
    </div>

    <div
      id="${pfx}-lower-third-clip"
      class="clip ${pfx}-lower-third-layer"
      data-start="0"
      data-duration="${durAttr}"
      data-track-index="4"
    >
      <div id="${pfx}-lower-third-card" class="${pfx}-lower-third-card">
        <div class="${pfx}-accent-bar"></div>
        <h1 id="${pfx}-cinema-title" class="${pfx}-cinema-title">${headline}</h1>
        <p id="${pfx}-cinema-subline" class="${pfx}-cinema-subline">${subheadline}</p>
      </div>
    </div>

    <style>
      [data-composition-id="${escapedCompId}"] {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background-color: #0a1410;
        font-family: "Inter", sans-serif;
        color: #ffffff;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-plate-rig {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        transform-origin: center center;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-plate-media {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-synth-plate {
        position: absolute;
        inset: 0;
        background: linear-gradient(145deg, ${colors.primary} 0%, ${colors.secondary} 36%, #0a1410 88%);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-scrim-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-lower-scrim {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          180deg,
          rgba(10, 20, 16, 0.14) 0%,
          rgba(10, 20, 16, 0.48) 44%,
          rgba(10, 20, 16, 0.94) 76%,
          #0a1410 100%
        );
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-tag-layer {
        position: absolute;
        top: 8%;
        left: 8%;
        right: 8%;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: flex-start;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-glass-pill {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        padding: 10px 20px 10px 12px;
        border-radius: 999px;
        background-color: #0a1410;
        border: 1.5px solid rgba(255, 255, 255, 0.26);
        backdrop-filter: blur(12px);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-pill-chip {
        display: inline-block;
        padding: 5px 14px;
        border-radius: 999px;
        background-color: #facc15;
        color: #08120e;
        font-size: 20px;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-pill-label {
        color: #ffffff;
        font-size: ${pillSize}px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-lower-third-layer {
        position: absolute;
        left: 8%;
        right: 8%;
        bottom: 10%;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-lower-third-card {
        width: ${isLandscape ? "76%" : "100%"};
        background-color: #0a1410;
        border: 2px solid ${colors.primary};
        border-left: 6px solid #facc15;
        border-radius: 26px;
        padding: ${padCard}px ${padCard + 4}px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        box-shadow: 0 24px 54px rgba(0, 0, 0, 0.72);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-accent-bar {
        width: 68px;
        height: 5px;
        border-radius: 999px;
        background-color: #facc15;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-cinema-title {
        margin: 0;
        color: #ffffff;
        font-size: ${titleSize}px;
        font-weight: 800;
        line-height: 1.12;
        letter-spacing: -0.025em;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-cinema-subline {
        margin: 0;
        color: #f1f5f9;
        font-size: ${subSize}px;
        font-weight: 500;
        line-height: 1.36;
      }
    </style>

    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });

        tl.fromTo(
          "#${pfx}-plate-rig",
          { scale: ${fromScale}, x: 0, y: 0 },
          { scale: ${toScale}, x: ${panX}, y: ${panY}, duration: ${plateDur}, ease: "${ease}" },
          0,
        );

        tl.fromTo(
          "#${pfx}-lower-scrim",
          { opacity: 0.78 },
          { opacity: 1, duration: ${pillDur}, ease: "power2.out" },
          0,
        );

        tl.fromTo(
          "#${pfx}-glass-pill",
          { opacity: 0.92, y: -14, scale: 0.96 },
          { opacity: 1, y: 0, scale: 1, duration: ${pillDur}, ease: "power3.out" },
          0,
        );

        tl.fromTo(
          "#${pfx}-lower-third-card",
          { opacity: 0.94, y: 24 },
          { opacity: 1, y: 0, duration: ${cardDur}, ease: "power4.out" },
          0,
        );

        tl.fromTo(
          "#${pfx}-cinema-title",
          { opacity: 0.95, y: 14 },
          { opacity: 1, y: 0, duration: ${textDur}, ease: "power3.out" },
          0.04,
        );

        tl.fromTo(
          "#${pfx}-cinema-subline",
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: ${textDur}, ease: "power3.out" },
          0.14,
        );

        window.__timelines = window.__timelines || {};
        window.__timelines["${jsCompId}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

function renderKineticStatementCard({ compId, pfx, width, height, durAttr, durNum, shot, colors }) {
  const isLandscape = width >= height;
  const minDim = Math.min(width, height);
  const typeFloor = Math.max(18, Math.ceil(minDim * 0.027));
  const titleSize = Math.round(clamp(minDim * (isLandscape ? 0.062 : 0.058), typeFloor + 14, 84));
  const subSize = Math.round(clamp(minDim * 0.029, typeFloor + 2, 38));
  const ctaSize = Math.round(clamp(minDim * 0.031, typeFloor + 3, 40));
  const brandSize = Math.round(clamp(minDim * 0.027, typeFloor, 32));
  const cardPad = Math.round(clamp(minDim * 0.042, 28, 56));

  const staging = shot?.staging || {};
  const copy = shot?.copy || {};

  const brandNameRaw = shot?.brandName || staging?.brandName || copy?.brandName || "STUDIO PRO";
  const brandName = escapeHtml(brandNameRaw);
  const monogramChar = escapeHtml(String(brandNameRaw).trim().charAt(0).toUpperCase() || "S");

  const badgeText = escapeHtml(
    shot?.badgeText ||
      shot?.badge ||
      shot?.tagText ||
      staging?.badgeText ||
      staging?.badge ||
      copy?.badge ||
      "OFFICIAL RELEASE",
  );
  const rawHeadline =
    shot?.headline ||
    shot?.title ||
    staging?.headline ||
    copy?.headline ||
    "Start Your Next Chapter Today";
  const subheadline = escapeHtml(
    shot?.subheadline ||
      shot?.subline ||
      shot?.subtitle ||
      shot?.description ||
      staging?.subheadline ||
      copy?.subheadline ||
      "High-impact visual storytelling crafted for instant audience action.",
  );
  const ctaText = escapeHtml(
    shot?.ctaText || shot?.cta || staging?.ctaText || copy?.cta || "Get Started Now",
  );

  const words = splitHeadlineWords(rawHeadline, 12);
  const wordSpansHtml = words
    .map(
      (word, idx) => `<span id="${pfx}-word-${idx}" class="${pfx}-word">${escapeHtml(word)}</span>`,
    )
    .join(" ");

  const { videoSrc, imageSrc, logoSrc } = resolveShotMedia(shot);

  let stageMediaHtml = "";
  if (videoSrc) {
    stageMediaHtml = `<video id="${pfx}-bg-video" class="clip ${pfx}-stage-media" data-start="0" data-duration="${durAttr}" data-track-index="1" src="${escapeHtml(videoSrc)}" muted playsinline></video>`;
  } else if (imageSrc) {
    stageMediaHtml = `<img id="${pfx}-bg-image" class="clip ${pfx}-stage-media" data-start="0" data-duration="${durAttr}" data-track-index="1" src="${escapeHtml(imageSrc)}" alt="" />`;
  } else {
    stageMediaHtml = `<div id="${pfx}-stage-bg" class="clip ${pfx}-stage-bg" data-start="0" data-duration="${durAttr}" data-track-index="1"></div>`;
  }

  const logoVisualHtml = logoSrc
    ? `<img id="${pfx}-logo-img" class="${pfx}-logo-img" src="${escapeHtml(logoSrc)}" alt="${brandName}" />`
    : `<svg class="${pfx}-logo-svg" viewBox="0 0 56 56" width="56" height="56" aria-hidden="true" data-layout-ignore>
            <rect x="2" y="2" width="52" height="52" rx="16" fill="#facc15" />
            <text x="28" y="37" text-anchor="middle" fill="#08120e" font-family="Inter, sans-serif" font-size="28" font-weight="900">${monogramChar}</text>
          </svg>`;

  const cardInDur = round3(Math.min(0.46, durNum * 0.22));
  const logoInDur = round3(Math.min(0.38, durNum * 0.18));
  const wordBaseStart = 0.08;
  const maxStaggerBudget = Math.max(0.18, Math.min(0.62, durNum * 0.28));
  const wordStagger = words.length > 1 ? round3(maxStaggerBudget / (words.length - 1)) : 0;
  const wordDur = round3(Math.min(0.42, durNum * 0.2));
  const subStart = round3(
    Math.min(durNum * 0.56, wordBaseStart + (words.length - 1) * wordStagger + 0.08),
  );
  const ctaStart = round3(Math.min(durNum * 0.64, subStart + 0.08));
  const ctaDur = round3(Math.min(0.44, durNum * 0.2));

  const wordTweensJs = words
    .map((_w, idx) => {
      const startOpacity = idx === 0 ? 0.92 : 0;
      const startAt = idx === 0 ? 0 : round3(wordBaseStart + idx * wordStagger);
      return `        tl.fromTo("#${pfx}-word-${idx}", { opacity: ${startOpacity}, y: 24, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: ${wordDur}, ease: "power4.out" }, ${startAt});`;
    })
    .join("\n");

  const escapedCompId = escapeHtml(compId);
  const jsCompId = escapeJsString(compId);

  return `<template id="${escapedCompId}-template">
  <div
    id="root"
    data-composition-id="${escapedCompId}"
    data-width="${width}"
    data-height="${height}"
    data-duration="${durAttr}"
  >
    <div id="${pfx}-stage-rig" class="${pfx}-stage-rig" data-layout-allow-overflow>
      ${stageMediaHtml}
    </div>

    <div
      id="${pfx}-card-clip"
      class="clip ${pfx}-card-layer"
      data-start="0"
      data-duration="${durAttr}"
      data-track-index="2"
    >
      <div id="${pfx}-statement-card" class="${pfx}-statement-card">
        <div id="${pfx}-logo-slot" class="${pfx}-logo-slot">
          <div class="${pfx}-logo-badge-wrap">
            ${logoVisualHtml}
          </div>
          <div class="${pfx}-brand-meta">
            <span class="${pfx}-brand-name">${brandName}</span>
            <span class="${pfx}-kicker-tag" data-layout-ignore>${badgeText}</span>
          </div>
        </div>

        <h1 id="${pfx}-headline" class="${pfx}-headline">
          ${wordSpansHtml}
        </h1>

        <p id="${pfx}-subline" class="${pfx}-subline">${subheadline}</p>

        <div id="${pfx}-cta-row" class="${pfx}-cta-row">
          <div id="${pfx}-cta-badge" class="${pfx}-cta-badge">
            <span class="${pfx}-cta-label">${ctaText}</span>
            <span class="${pfx}-cta-arrow" aria-hidden="true" data-layout-ignore>&#8594;</span>
          </div>
        </div>
      </div>
    </div>

    <style>
      [data-composition-id="${escapedCompId}"] {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background-color: #0a1410;
        font-family: "Inter", sans-serif;
        color: #ffffff;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-stage-rig {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-stage-media {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 0.26;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-stage-bg {
        position: absolute;
        inset: 0;
        background: linear-gradient(155deg, #0a1410 0%, ${colors.primary} 52%, #060d0a 100%);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-card-layer {
        position: absolute;
        left: 9%;
        right: 9%;
        top: 10%;
        bottom: 10%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-statement-card {
        width: ${isLandscape ? "84%" : "100%"};
        background-color: #0a1410;
        border: 2.5px solid ${colors.secondary};
        border-radius: 34px;
        padding: ${cardPad}px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: ${isLandscape ? 24 : 28}px;
        box-shadow: 0 28px 68px rgba(0, 0, 0, 0.78);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-logo-slot {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 16px;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-logo-badge-wrap {
        width: 68px;
        height: 68px;
        border-radius: 18px;
        background-color: #11241c;
        border: 1.5px solid rgba(255, 255, 255, 0.22);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-logo-img {
        width: 50px;
        height: 50px;
        object-fit: contain;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-logo-svg {
        display: block;
        width: 50px;
        height: 50px;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-brand-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-brand-name {
        color: #ffffff;
        font-size: ${brandSize}px;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-kicker-tag {
        display: inline-block;
        padding: 5px 14px;
        border-radius: 999px;
        background-color: #facc15;
        color: #08120e;
        font-size: 19px;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-headline {
        margin: 0;
        color: #ffffff;
        font-size: ${titleSize}px;
        font-weight: 900;
        line-height: 1.1;
        letter-spacing: -0.028em;
        display: flex;
        flex-wrap: wrap;
        column-gap: 0.28em;
        row-gap: 0.08em;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-word {
        display: inline-block;
        color: #ffffff;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-subline {
        margin: 0;
        color: #f1f5f9;
        font-size: ${subSize}px;
        font-weight: 500;
        line-height: 1.36;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-cta-row {
        margin-top: 6px;
        display: flex;
        flex-direction: row;
        align-items: center;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-cta-badge {
        display: inline-flex;
        align-items: center;
        gap: 14px;
        padding: 18px 34px;
        border-radius: 999px;
        background-color: #facc15;
        color: #08120e;
        font-size: ${ctaSize}px;
        font-weight: 900;
        letter-spacing: -0.01em;
        box-shadow: 0 14px 32px rgba(0, 0, 0, 0.45);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-cta-label {
        color: #08120e;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-cta-arrow {
        color: #08120e;
        font-weight: 900;
      }
    </style>

    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });

        tl.fromTo(
          "#${pfx}-statement-card",
          { opacity: 0.94, y: 26, scale: 0.97 },
          { opacity: 1, y: 0, scale: 1, duration: ${cardInDur}, ease: "power4.out" },
          0,
        );

        tl.fromTo(
          "#${pfx}-logo-slot",
          { opacity: 0.92, y: -12, scale: 0.94 },
          { opacity: 1, y: 0, scale: 1, duration: ${logoInDur}, ease: "power3.out" },
          0,
        );

${wordTweensJs}

        tl.fromTo(
          "#${pfx}-subline",
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: ${wordDur}, ease: "power3.out" },
          ${subStart},
        );

        tl.fromTo(
          "#${pfx}-cta-badge",
          { opacity: 0, y: 18, scale: 0.88 },
          { opacity: 1, y: 0, scale: 1, duration: ${ctaDur}, ease: "back.out(1.4)" },
          ${ctaStart},
        );

        window.__timelines = window.__timelines || {};
        window.__timelines["${jsCompId}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

export function renderArchetypeScene({
  archetypeId,
  compositionId = "scene-cinema-01",
  width = 1080,
  height = 1920,
  durationSeconds = 4,
  shot = {},
  brandColors = {},
} = {}) {
  const resolvedId = String(archetypeId ?? shot?.archetypeId ?? shot?.layout ?? "").trim();
  if (!SUPPORTED_IDS.has(resolvedId)) {
    throw new Error(
      `Unsupported archetypeId "${archetypeId}". Expected one of: ${[...SUPPORTED_IDS].join(", ")}`,
    );
  }

  const compId = String(compositionId || "scene-cinema-01").trim() || "scene-cinema-01";
  const pfx = sanitizePrefix(compId);
  const safeWidth = Math.max(240, Math.round(Number(width) || 1080));
  const safeHeight = Math.max(240, Math.round(Number(height) || 1920));
  const durNum = round3(clamp(Number(durationSeconds) || 4, 0.5, 120));
  const durAttr = String(durNum);

  const colors = {
    primary: sanitizeHexColor(brandColors?.primary, "#1E824C"),
    secondary: sanitizeHexColor(brandColors?.secondary, "#2ECC71"),
    accent: sanitizeHexColor(brandColors?.accent, "#FACC15"),
    background: sanitizeHexColor(brandColors?.background, "#0A1410"),
  };

  if (resolvedId === "fullbleed-cinema") {
    return renderFullbleedCinema({
      compId,
      pfx,
      width: safeWidth,
      height: safeHeight,
      durAttr,
      durNum,
      shot: shot || {},
      colors,
    });
  }

  return renderKineticStatementCard({
    compId,
    pfx,
    width: safeWidth,
    height: safeHeight,
    durAttr,
    durNum,
    shot: shot || {},
    colors,
  });
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi"]);

export const PACK_ID = "behind-speaker";

export const ARCHETYPES = Object.freeze([
  Object.freeze({
    id: "depth-text-behind-speaker",
    name: "Depth Text Behind Speaker",
    pack: PACK_ID,
    category: "depth-occlusion",
    description:
      "Three-layer Z-depth sandwich placing a giant kinetic display headline behind an optional RGBA speaker foreground matte over a full-frame background video or plate.",
    defaultDuration: 4.0,
    defaultDurationSeconds: 4.0,
    supportedAspects: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    recommendedAspectRatios: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    features: Object.freeze([
      "3-layer-z-sandwich",
      "giant-display-headline",
      "rgba-subject-foreground-matte",
      "speaker-lower-third-card",
    ]),
    slots: Object.freeze([
      "videoSrc",
      "imageSrc",
      "subjectMatteSrc",
      "badgeText",
      "headline",
      "speakerName",
      "subheadline",
    ]),
  }),
  Object.freeze({
    id: "podcast-dual-split",
    name: "Podcast Dual Split",
    pack: PACK_ID,
    category: "podcast",
    description:
      "Dual-speaker studio split frame with stacked portrait or side-by-side widescreen camera feeds, active audio level meters, and topic lower-third card.",
    defaultDuration: 4.5,
    defaultDurationSeconds: 4.5,
    supportedAspects: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    recommendedAspectRatios: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    features: Object.freeze([
      "dual-speaker-feeds",
      "active-speaker-meters",
      "speaker-nameplates",
      "topic-callout-card",
    ]),
    slots: Object.freeze([
      "hostVideoSrc",
      "hostImageSrc",
      "guestVideoSrc",
      "guestImageSrc",
      "hostName",
      "guestName",
      "topicBadge",
      "headline",
      "subheadline",
    ]),
  }),
]);

const SUPPORTED_IDS = new Set(ARCHETYPES.map((entry) => entry.id));

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
  if (!cleaned) return "bs_scene";
  return /^[a-zA-Z]/.test(cleaned) ? cleaned : `bs_${cleaned}`;
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

function resolveDepthMedia(shot = {}) {
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

  const rawMatte =
    shot?.subjectMatteSrc ||
    shot?.matteSrc ||
    shot?.foregroundMatteSrc ||
    staging?.subjectMatteSrc ||
    staging?.matteSrc ||
    null;

  return {
    videoSrc: normalizeRelativeAssetPath(rawVideo, "clips"),
    imageSrc: normalizeRelativeAssetPath(rawImage, "images"),
    subjectMatteSrc: normalizeRelativeAssetPath(rawMatte, "images"),
  };
}

function resolvePodcastMedia(shot = {}) {
  const staging = shot?.staging || {};
  const rawHostVid =
    shot?.hostVideoSrc ||
    shot?.leftVideoSrc ||
    shot?.topVideoSrc ||
    shot?.videoSrc ||
    shot?.clipRelPath ||
    staging?.hostVideoSrc ||
    (hasVideoExt(shot?.sourceClip) ? shot.sourceClip : null) ||
    null;

  const rawHostImg =
    shot?.hostImageSrc ||
    shot?.leftImageSrc ||
    shot?.topImageSrc ||
    shot?.imageSrc ||
    shot?.plateRelPath ||
    staging?.hostImageSrc ||
    (!hasVideoExt(shot?.sourceClip) ? shot?.sourceClip : null) ||
    null;

  const rawGuestVid =
    shot?.guestVideoSrc ||
    shot?.rightVideoSrc ||
    shot?.bottomVideoSrc ||
    shot?.secondaryVideoSrc ||
    staging?.guestVideoSrc ||
    null;

  const rawGuestImg =
    shot?.guestImageSrc ||
    shot?.rightImageSrc ||
    shot?.bottomImageSrc ||
    shot?.secondaryImageSrc ||
    staging?.guestImageSrc ||
    null;

  const hostVideoSrc = normalizeRelativeAssetPath(rawHostVid, "clips");
  const hostImageSrc = normalizeRelativeAssetPath(rawHostImg, "images");
  let guestVideoSrc = normalizeRelativeAssetPath(rawGuestVid, "clips");
  let guestImageSrc = normalizeRelativeAssetPath(rawGuestImg, "images");

  // Prevent duplicate media fingerprint warnings if identical path passed to both slots
  if (guestVideoSrc && guestVideoSrc === hostVideoSrc) {
    guestVideoSrc = null;
  }
  if (guestImageSrc && guestImageSrc === hostImageSrc) {
    guestImageSrc = null;
  }

  return {
    hostVideoSrc,
    hostImageSrc,
    guestVideoSrc,
    guestImageSrc,
  };
}

function renderDepthTextBehindSpeaker({
  compId,
  pfx,
  width,
  height,
  durAttr,
  durNum,
  shot,
  colors,
}) {
  const isLandscape = width >= height;
  const minDim = Math.min(width, height);
  const typeFloor = Math.max(18, Math.ceil(minDim * 0.027));
  const giantSize = Math.round(clamp(minDim * (isLandscape ? 0.135 : 0.118), typeFloor + 36, 168));
  const subSize = Math.round(clamp(minDim * 0.029, typeFloor + 2, 38));
  const speakerSize = Math.round(clamp(minDim * 0.028, typeFloor, 34));
  const padCard = Math.round(clamp(minDim * 0.028, 22, 38));

  const staging = shot?.staging || {};
  const copy = shot?.copy || {};
  const cam = shot?.camera || shot?.cameraMotion || staging?.camera || {};

  const badgeText = escapeHtml(
    shot?.badgeText ||
      shot?.badge ||
      shot?.tagText ||
      staging?.badgeText ||
      staging?.badge ||
      copy?.badge ||
      "SPEAKER SPOTLIGHT",
  );
  const headline = escapeHtml(
    shot?.headline || shot?.title || staging?.headline || copy?.headline || "BUILD BOLD",
  );
  const speakerName = escapeHtml(
    shot?.speakerName || staging?.speakerName || copy?.speakerName || "Studio Presenter",
  );
  const subheadline = escapeHtml(
    shot?.subheadline ||
      shot?.subline ||
      shot?.subtitle ||
      shot?.description ||
      staging?.subheadline ||
      copy?.subheadline ||
      "Three-layer depth composition anchoring bold display type behind the speaker.",
  );

  const fromScale = round3(clamp(Number(cam.fromScale) || 1.06, 0.85, 2.1));
  const toScale = round3(clamp(Number(cam.toScale) || 1.0, 0.85, 2.1));
  const panX = round3(clamp(Number(cam.panX) || 0, -48, 48));
  const panY = round3(clamp(Number(cam.panY) || 0, -48, 48));
  const ease = escapeJsString(cam.ease || "power2.out");

  const { videoSrc, imageSrc, subjectMatteSrc } = resolveDepthMedia(shot);

  let bgMediaHtml = "";
  if (videoSrc) {
    bgMediaHtml = `<video id="${pfx}-bg-video" class="clip ${pfx}-bg-media" data-start="0" data-duration="${durAttr}" data-track-index="1" src="${escapeHtml(videoSrc)}" muted playsinline></video>`;
  } else if (imageSrc) {
    bgMediaHtml = `<img id="${pfx}-bg-image" class="clip ${pfx}-bg-media" data-start="0" data-duration="${durAttr}" data-track-index="1" src="${escapeHtml(imageSrc)}" alt="" />`;
  } else {
    bgMediaHtml = `<div id="${pfx}-bg-synth" class="clip ${pfx}-bg-synth" data-start="0" data-duration="${durAttr}" data-track-index="1"></div>`;
  }

  const matteLayerHtml = subjectMatteSrc
    ? `
    <div
      id="${pfx}-matte-clip"
      class="clip ${pfx}-matte-layer"
      data-start="0"
      data-duration="${durAttr}"
      data-track-index="3"
      data-layout-allow-occlusion
    >
      <div
        id="${pfx}-matte-rig"
        class="${pfx}-matte-rig"
        data-layout-allow-overflow
        data-layout-allow-occlusion
      >
        <img
          id="${pfx}-subject-matte"
          class="${pfx}-subject-matte"
          src="${escapeHtml(subjectMatteSrc)}"
          alt="${speakerName}"
          data-layout-allow-occlusion
        />
      </div>
    </div>`
    : "";

  const bgDur = round3(Math.max(0.35, durNum * 0.92));
  const headlineDur = round3(Math.min(0.54, durNum * 0.3));
  const cardDur = round3(Math.min(0.46, durNum * 0.25));

  const matteTweenJs = subjectMatteSrc
    ? `
        tl.fromTo(
          "#${pfx}-matte-rig",
          { scale: 1.0, y: 14 },
          { scale: 1.045, y: 0, duration: ${bgDur}, ease: "power2.out" },
          0,
        );`
    : "";

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
    <!-- Layer 1: Background Video / Image Plate + Depth Contrast Scrim -->
    <div id="${pfx}-bg-rig" class="${pfx}-bg-rig" data-layout-allow-overflow>
      ${bgMediaHtml}
    </div>
    <div id="${pfx}-depth-scrim" class="${pfx}-depth-scrim"></div>

    <!-- Layer 2: Giant Display Headline Behind Speaker -->
    <div
      id="${pfx}-headline-clip"
      class="clip ${pfx}-headline-layer"
      data-start="0"
      data-duration="${durAttr}"
      data-track-index="2"
    >
      <div id="${pfx}-headline-stage" class="${pfx}-headline-stage">
        <span class="${pfx}-depth-kicker" data-layout-ignore>${badgeText}</span>
        <h1
          id="${pfx}-depth-headline"
          class="${pfx}-depth-headline"
          data-layout-allow-occlusion
        >
          ${headline}
        </h1>
      </div>
    </div>

    <!-- Layer 3: Optional RGBA Subject Foreground Matte Occluding Headline -->${matteLayerHtml}

    <!-- Layer 4: Lower Speaker & Context Card -->
    <div
      id="${pfx}-speaker-clip"
      class="clip ${pfx}-speaker-layer"
      data-start="0"
      data-duration="${durAttr}"
      data-track-index="4"
    >
      <div id="${pfx}-speaker-card" class="${pfx}-speaker-card">
        <div class="${pfx}-speaker-header">
          <span class="${pfx}-speaker-dot" data-layout-ignore></span>
          <span class="${pfx}-speaker-name">${speakerName}</span>
        </div>
        <p id="${pfx}-speaker-subline" class="${pfx}-speaker-subline">${subheadline}</p>
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

      [data-composition-id="${escapedCompId}"] .${pfx}-bg-rig {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        z-index: 1;
        transform-origin: center center;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-bg-media {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-bg-synth {
        position: absolute;
        inset: 0;
        background: linear-gradient(150deg, #0a1410 0%, ${colors.primary} 48%, #07100c 100%);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-depth-scrim {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
        background: linear-gradient(
          180deg,
          rgba(10, 20, 16, 0.88) 0%,
          rgba(10, 20, 16, 0.62) 48%,
          rgba(10, 20, 16, 0.94) 100%
        );
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-headline-layer {
        position: absolute;
        left: 8%;
        right: 8%;
        top: 11%;
        z-index: 3;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-headline-stage {
        width: 100%;
        background-color: rgba(10, 20, 16, 0.86);
        border: 1.5px solid rgba(255, 255, 255, 0.16);
        border-radius: 28px;
        padding: 24px 28px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        text-align: center;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-depth-kicker {
        display: inline-block;
        padding: 6px 16px;
        border-radius: 999px;
        background-color: #facc15;
        color: #08120e;
        font-size: 20px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-depth-headline {
        margin: 0;
        color: #ffffff;
        font-size: ${giantSize}px;
        font-weight: 900;
        line-height: 0.98;
        letter-spacing: -0.035em;
        text-transform: uppercase;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-matte-layer {
        position: absolute;
        inset: 0;
        z-index: 4;
        pointer-events: none;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-matte-rig {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        transform-origin: center bottom;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-subject-matte {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-speaker-layer {
        position: absolute;
        left: 8%;
        right: 8%;
        bottom: 9%;
        z-index: 5;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-speaker-card {
        width: ${isLandscape ? "72%" : "100%"};
        background-color: #0a1410;
        border: 2px solid ${colors.primary};
        border-left: 6px solid #facc15;
        border-radius: 24px;
        padding: ${padCard}px ${padCard + 4}px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-shadow: 0 22px 52px rgba(0, 0, 0, 0.74);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-speaker-header {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-speaker-dot {
        width: 12px;
        height: 12px;
        border-radius: 999px;
        background-color: #facc15;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-speaker-name {
        color: #ffffff;
        font-size: ${speakerSize}px;
        font-weight: 800;
        letter-spacing: -0.01em;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-speaker-subline {
        margin: 0;
        color: #f1f5f9;
        font-size: ${subSize}px;
        font-weight: 500;
        line-height: 1.35;
      }
    </style>

    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });

        tl.fromTo(
          "#${pfx}-bg-rig",
          { scale: ${fromScale}, x: 0, y: 0 },
          { scale: ${toScale}, x: ${panX}, y: ${panY}, duration: ${bgDur}, ease: "${ease}" },
          0,
        );

        tl.fromTo(
          "#${pfx}-headline-stage",
          { opacity: 0.94, y: 34, scale: 0.95 },
          { opacity: 1, y: 0, scale: 1, duration: ${headlineDur}, ease: "power4.out" },
          0,
        );${matteTweenJs}

        tl.fromTo(
          "#${pfx}-speaker-card",
          { opacity: 0.92, y: 24 },
          { opacity: 1, y: 0, duration: ${cardDur}, ease: "power3.out" },
          0.08,
        );

        window.__timelines = window.__timelines || {};
        window.__timelines["${jsCompId}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

function renderPodcastDualSplit({ compId, pfx, width, height, durAttr, durNum, shot, colors }) {
  const isLandscape = width >= height;
  const minDim = Math.min(width, height);
  const typeFloor = Math.max(18, Math.ceil(minDim * 0.027));
  const titleSize = Math.round(clamp(minDim * (isLandscape ? 0.044 : 0.042), typeFloor + 8, 60));
  const subSize = Math.round(clamp(minDim * 0.028, typeFloor + 1, 34));
  const nameSize = Math.round(clamp(minDim * 0.027, typeFloor, 32));
  const padCard = Math.round(clamp(minDim * 0.026, 20, 34));

  const staging = shot?.staging || {};
  const copy = shot?.copy || {};

  const hostName = escapeHtml(
    shot?.hostName || staging?.hostName || copy?.hostName || "Host Speaker",
  );
  const guestName = escapeHtml(
    shot?.guestName || staging?.guestName || copy?.guestName || "Guest Speaker",
  );
  const topicBadge = escapeHtml(
    shot?.topicBadge ||
      shot?.badgeText ||
      shot?.badge ||
      staging?.badgeText ||
      staging?.badge ||
      copy?.badge ||
      "STUDIO PODCAST",
  );
  const headline = escapeHtml(
    shot?.headline ||
      shot?.title ||
      staging?.headline ||
      copy?.headline ||
      "Dual Camera Studio Conversation",
  );
  const subheadline = escapeHtml(
    shot?.subheadline ||
      shot?.subline ||
      shot?.subtitle ||
      shot?.description ||
      staging?.subheadline ||
      copy?.subheadline ||
      "Crisp split-screen framing engineered for interviews and commentary.",
  );

  const { hostVideoSrc, hostImageSrc, guestVideoSrc, guestImageSrc } = resolvePodcastMedia(shot);

  let hostFeedHtml = "";
  if (hostVideoSrc) {
    hostFeedHtml = `<video id="${pfx}-host-video" class="clip ${pfx}-feed-media" data-start="0" data-duration="${durAttr}" data-track-index="1" src="${escapeHtml(hostVideoSrc)}" muted playsinline></video>`;
  } else if (hostImageSrc) {
    hostFeedHtml = `<img id="${pfx}-host-image" class="clip ${pfx}-feed-media" data-start="0" data-duration="${durAttr}" data-track-index="1" src="${escapeHtml(hostImageSrc)}" alt="${hostName}" />`;
  } else {
    hostFeedHtml = `<div id="${pfx}-host-synth" class="clip ${pfx}-host-synth" data-start="0" data-duration="${durAttr}" data-track-index="1"></div>`;
  }

  let guestFeedHtml = "";
  if (guestVideoSrc) {
    guestFeedHtml = `<video id="${pfx}-guest-video" class="clip ${pfx}-feed-media" data-start="0" data-duration="${durAttr}" data-track-index="2" src="${escapeHtml(guestVideoSrc)}" muted playsinline></video>`;
  } else if (guestImageSrc) {
    guestFeedHtml = `<img id="${pfx}-guest-image" class="clip ${pfx}-feed-media" data-start="0" data-duration="${durAttr}" data-track-index="2" src="${escapeHtml(guestImageSrc)}" alt="${guestName}" />`;
  } else {
    guestFeedHtml = `<div id="${pfx}-guest-synth" class="clip ${pfx}-guest-synth" data-start="0" data-duration="${durAttr}" data-track-index="2"></div>`;
  }

  const zoomDur = round3(Math.max(0.35, durNum * 0.92));
  const cardInDur = round3(Math.min(0.45, durNum * 0.24));
  const meterPulseDur = round3(Math.min(0.36, durNum * 0.2));

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
    <div id="${pfx}-split-grid" class="${pfx}-split-grid">
      <!-- Host Feed Slot -->
      <div id="${pfx}-host-pane" class="${pfx}-feed-pane ${pfx}-host-pane" data-layout-allow-overflow>
        <div id="${pfx}-host-rig" class="${pfx}-feed-rig" data-layout-allow-overflow>
          ${hostFeedHtml}
        </div>
        <div class="${pfx}-feed-scrim"></div>
        <div id="${pfx}-host-tag" class="${pfx}-speaker-pill">
          <span class="${pfx}-role-chip" data-layout-ignore>HOST</span>
          <span class="${pfx}-pill-name">${hostName}</span>
          <span class="${pfx}-meter-group" aria-hidden="true" data-layout-ignore>
            <span id="${pfx}-hbar-1" class="${pfx}-meter-bar"></span>
            <span id="${pfx}-hbar-2" class="${pfx}-meter-bar"></span>
            <span id="${pfx}-hbar-3" class="${pfx}-meter-bar"></span>
          </span>
        </div>
      </div>

      <!-- Guest Feed Slot -->
      <div id="${pfx}-guest-pane" class="${pfx}-feed-pane ${pfx}-guest-pane" data-layout-allow-overflow>
        <div id="${pfx}-guest-rig" class="${pfx}-feed-rig" data-layout-allow-overflow>
          ${guestFeedHtml}
        </div>
        <div class="${pfx}-feed-scrim"></div>
        <div id="${pfx}-guest-tag" class="${pfx}-speaker-pill">
          <span class="${pfx}-role-chip ${pfx}-guest-chip" data-layout-ignore>GUEST</span>
          <span class="${pfx}-pill-name">${guestName}</span>
          <span class="${pfx}-meter-group" aria-hidden="true" data-layout-ignore>
            <span id="${pfx}-gbar-1" class="${pfx}-meter-bar"></span>
            <span id="${pfx}-gbar-2" class="${pfx}-meter-bar"></span>
            <span id="${pfx}-gbar-3" class="${pfx}-meter-bar"></span>
          </span>
        </div>
      </div>
    </div>

    <!-- Topic Lower-Third Card -->
    <div
      id="${pfx}-topic-clip"
      class="clip ${pfx}-topic-layer"
      data-start="0"
      data-duration="${durAttr}"
      data-track-index="3"
    >
      <div id="${pfx}-topic-card" class="${pfx}-topic-card">
        <div class="${pfx}-topic-eyebrow">
          <span class="${pfx}-topic-badge" data-layout-ignore>${topicBadge}</span>
        </div>
        <h1 id="${pfx}-topic-title" class="${pfx}-topic-title">${headline}</h1>
        <p id="${pfx}-topic-subline" class="${pfx}-topic-subline">${subheadline}</p>
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

      [data-composition-id="${escapedCompId}"] .${pfx}-split-grid {
        position: absolute;
        left: 8%;
        right: 8%;
        top: 8%;
        bottom: 31%;
        display: flex;
        flex-direction: ${isLandscape ? "row" : "column"};
        gap: 16px;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-feed-pane {
        flex: 1 1 0;
        position: relative;
        border-radius: 26px;
        overflow: hidden;
        background-color: #0f1f19;
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.58);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-host-pane {
        border: 3px solid #facc15;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-guest-pane {
        border: 2.5px solid ${colors.secondary};
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-feed-rig {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transform-origin: center center;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-feed-media {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-host-synth {
        position: absolute;
        inset: 0;
        background: linear-gradient(140deg, ${colors.primary} 0%, #0d241b 55%, #0a1410 100%);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-guest-synth {
        position: absolute;
        inset: 0;
        background: linear-gradient(140deg, #1b2a22 0%, ${colors.secondary} 45%, #0a1410 100%);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-feed-scrim {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(
          180deg,
          rgba(10, 20, 16, 0.04) 45%,
          rgba(10, 20, 16, 0.86) 100%
        );
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-speaker-pill {
        position: absolute;
        left: 18px;
        bottom: 16px;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 16px 8px 10px;
        border-radius: 999px;
        background-color: #0a1410;
        border: 1.5px solid rgba(255, 255, 255, 0.24);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-role-chip {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 999px;
        background-color: #facc15;
        color: #08120e;
        font-size: 16px;
        font-weight: 800;
        letter-spacing: 0.06em;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-guest-chip {
        background-color: #4ade80;
        color: #08120e;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-pill-name {
        color: #ffffff;
        font-size: ${nameSize}px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-meter-group {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 20px;
        margin-left: 4px;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-meter-bar {
        display: inline-block;
        width: 4px;
        height: 16px;
        border-radius: 999px;
        background-color: #facc15;
        transform-origin: center bottom;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-topic-layer {
        position: absolute;
        left: 8%;
        right: 8%;
        bottom: 8%;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-topic-card {
        width: 100%;
        background-color: #0a1410;
        border: 2px solid ${colors.primary};
        border-left: 6px solid #facc15;
        border-radius: 24px;
        padding: ${padCard}px ${padCard + 4}px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.72);
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-topic-eyebrow {
        display: flex;
        align-items: center;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-topic-badge {
        display: inline-block;
        padding: 5px 14px;
        border-radius: 999px;
        background-color: #facc15;
        color: #08120e;
        font-size: 18px;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-topic-title {
        margin: 0;
        color: #ffffff;
        font-size: ${titleSize}px;
        font-weight: 800;
        line-height: 1.14;
        letter-spacing: -0.022em;
      }

      [data-composition-id="${escapedCompId}"] .${pfx}-topic-subline {
        margin: 0;
        color: #f1f5f9;
        font-size: ${subSize}px;
        font-weight: 500;
        line-height: 1.34;
      }
    </style>

    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });

        tl.fromTo(
          "#${pfx}-host-rig",
          { scale: 1.06, y: -6 },
          { scale: 1.0, y: 0, duration: ${zoomDur}, ease: "power2.out" },
          0,
        );

        tl.fromTo(
          "#${pfx}-guest-rig",
          { scale: 1.0, y: 6 },
          { scale: 1.05, y: 0, duration: ${zoomDur}, ease: "power2.out" },
          0,
        );

        tl.fromTo(
          "#${pfx}-host-pane",
          { opacity: 0.94, y: -14 },
          { opacity: 1, y: 0, duration: ${cardInDur}, ease: "power3.out" },
          0,
        );

        tl.fromTo(
          "#${pfx}-guest-pane",
          { opacity: 0.92, y: 14 },
          { opacity: 1, y: 0, duration: ${cardInDur}, ease: "power3.out" },
          0.06,
        );

        tl.fromTo(
          "#${pfx}-hbar-1",
          { scaleY: 0.45 },
          { scaleY: 1.0, duration: ${meterPulseDur}, ease: "sine.inOut" },
          0.1,
        );

        tl.fromTo(
          "#${pfx}-hbar-2",
          { scaleY: 0.95 },
          { scaleY: 0.55, duration: ${meterPulseDur}, ease: "sine.inOut" },
          0.14,
        );

        tl.fromTo(
          "#${pfx}-hbar-3",
          { scaleY: 0.5 },
          { scaleY: 0.9, duration: ${meterPulseDur}, ease: "sine.inOut" },
          0.18,
        );

        tl.fromTo(
          "#${pfx}-gbar-1",
          { scaleY: 0.4 },
          { scaleY: 0.8, duration: ${meterPulseDur}, ease: "sine.inOut" },
          0.22,
        );

        tl.fromTo(
          "#${pfx}-gbar-2",
          { scaleY: 0.75 },
          { scaleY: 0.45, duration: ${meterPulseDur}, ease: "sine.inOut" },
          0.26,
        );

        tl.fromTo(
          "#${pfx}-gbar-3",
          { scaleY: 0.5 },
          { scaleY: 0.85, duration: ${meterPulseDur}, ease: "sine.inOut" },
          0.3,
        );

        tl.fromTo(
          "#${pfx}-topic-card",
          { opacity: 0.94, y: 22 },
          { opacity: 1, y: 0, duration: ${cardInDur}, ease: "power4.out" },
          0.08,
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
  compositionId = "scene-behind-speaker-01",
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

  const compId =
    String(compositionId || "scene-behind-speaker-01").trim() || "scene-behind-speaker-01";
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

  if (resolvedId === "depth-text-behind-speaker") {
    return renderDepthTextBehindSpeaker({
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

  return renderPodcastDualSplit({
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

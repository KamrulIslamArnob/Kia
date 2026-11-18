export const PACK_ID = "pack-social-hooks";

export const ARCHETYPES = Object.freeze([
  Object.freeze({
    id: "hook-scroll-stopper",
    name: "Hook Scroll-Stopper",
    pack: PACK_ID,
    category: "social-hook",
    description:
      "High-retention 0-3s opening hook scene with velocity punch-in media viewport, staggered kinetic word cascade, and retention progress bar.",
    defaultDuration: 3.2,
    defaultDurationSeconds: 3.2,
    supportedAspects: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    recommendedAspectRatios: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    features: Object.freeze([
      "velocity-punch-in-viewport",
      "staggered-kinetic-headline",
      "retention-progress-bar",
      "high-contrast-hook-badge",
    ]),
    tags: Object.freeze(["hook", "scroll-stopper", "reels", "shorts", "social-ad"]),
    slots: Object.freeze([
      "sourceClip",
      "plateImage",
      "badge",
      "hookTag",
      "headline",
      "subheadline",
    ]),
  }),
  Object.freeze({
    id: "product-price-reveal",
    name: "Product Price Reveal",
    pack: PACK_ID,
    category: "commerce",
    description:
      "E-commerce and launch offer showcase featuring framed product stage, discount badge, animated strikethrough anchor price, tabular offer price pop, and CTA pill.",
    defaultDuration: 4.0,
    defaultDurationSeconds: 4.0,
    supportedAspects: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    recommendedAspectRatios: Object.freeze(["9:16", "16:9", "1:1", "4:5"]),
    features: Object.freeze([
      "framed-product-showcase",
      "animated-anchor-strikethrough",
      "tabular-offer-price-pop",
      "primary-cta-pill",
    ]),
    tags: Object.freeze(["product", "price-reveal", "offer", "ecommerce", "promo"]),
    slots: Object.freeze([
      "productVideo",
      "productImage",
      "badge",
      "discountBadge",
      "headline",
      "subheadline",
      "originalPrice",
      "offerPrice",
      "ctaText",
    ]),
  }),
]);

const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv", "m4v", "avi"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "svg", "gif", "avif"]);

export function getArchetypeById(archetypeId) {
  return ARCHETYPES.find((entry) => entry.id === archetypeId) || null;
}

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

function sanitizeCompositionId(raw, fallback = "scene-social-hooks") {
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

function chunkHeadlineTokens(rawHeadline, maxTokens = 7) {
  const words = String(rawHeadline || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return ["Stop", "Scrolling", "Now"];
  if (words.length <= maxTokens) return words;
  const head = words.slice(0, maxTokens - 1);
  const tail = words.slice(maxTokens - 1).join(" ");
  return [...head, tail];
}

function renderHookScrollStopperScene({ compId, pfx, w, h, dur, shot, palette }) {
  const isLandscape = w >= h;
  const padX = Math.round(w * 0.1);
  const padY = Math.round(h * 0.1);
  const safeW = w - padX * 2;
  const safeH = h - padY * 2;

  const shortSide = Math.min(w, h);
  const readFloorPx = Math.max(18, Math.ceil(shortSide * 0.027));
  const headingPx = Math.max(readFloorPx + 14, isLandscape ? 46 : 50);
  const subPx = Math.max(readFloorPx, isLandscape ? 28 : 29);

  const staging = shot?.staging || {};
  const copy = shot?.copy || {};

  const badgeText = escapeHtml(staging.badge || copy.badge || shot?.badge || "STOP SCROLLING");
  const hookTagText = escapeHtml(staging.hookTag || shot?.hookTag || "00:00 · HOOK");
  const rawHeadline =
    staging.headline ||
    copy.headline ||
    shot?.headline ||
    shot?.title ||
    "Watch How Fast Studio Pro Cuts Your Reel";
  const subheadlineText = escapeHtml(
    staging.subheadline ||
      copy.subheadline ||
      shot?.subheadline ||
      shot?.description ||
      "Engineered opening frame designed for maximum 3-second viewer retention.",
  );

  const mediaRel = normalizeRelativeAssetPath(
    shot?.videoSrc ||
      shot?.clipRelPath ||
      shot?.sourceClip ||
      shot?.imageSrc ||
      shot?.plateRelPath ||
      shot?.plateImage ||
      staging.sourceClip ||
      staging.plateImage,
  );

  const hookMedia = renderLayerMedia({
    pfx,
    slotName: "hook",
    relPath: mediaRel,
    dur,
    trackIndex: 1,
    synthHtml: `<div id="${pfx}-hook-synth" class="${pfx}-hook-synth">
      <div class="${pfx}-pulse-ring"></div>
      <div class="${pfx}-wave-row">
        <div class="${pfx}-wave-bar ${pfx}-wb-1"></div>
        <div class="${pfx}-wave-bar ${pfx}-wb-2"></div>
        <div class="${pfx}-wave-bar ${pfx}-wb-3"></div>
        <div class="${pfx}-wave-bar ${pfx}-wb-4"></div>
        <div class="${pfx}-wave-bar ${pfx}-wb-5"></div>
      </div>
    </div>`,
  });

  const mediaSlotAttrs = hookMedia.wrapperTimedAttrs
    ? `id="${pfx}-hook-slot"${hookMedia.wrapperTimedAttrs}`
    : `id="${pfx}-hook-slot" class="${pfx}-untimed-slot"`;

  const tokens = chunkHeadlineTokens(rawHeadline, 7);
  const wordSpansHtml = tokens
    .map(
      (token, idx) =>
        `<span id="${pfx}-word-${idx + 1}" class="${pfx}-word">${escapeHtml(token)}</span>`,
    )
    .join(" ");

  const punchDur = Number(Math.min(0.55, dur * 0.28).toFixed(2));
  const cardDur = Number(Math.min(0.4, dur * 0.2).toFixed(2));
  const wordDur = Number(Math.min(0.36, dur * 0.18).toFixed(2));
  const progressDur = Number(Math.max(0.5, dur * 0.92).toFixed(2));

  const wordTweensJs = tokens
    .map((_, idx) => {
      const n = idx + 1;
      const at = Number((idx * 0.045).toFixed(3));
      const startOpacity = idx === 0 ? 1 : 0;
      return `        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-word-${n}',
          { opacity: ${startOpacity}, y: 16, scale: 0.95 },
          { opacity: 1, y: 0, scale: 1, duration: ${wordDur}, ease: "back.out(1.4)" },
          ${at},
        );`;
    })
    .join("\n");

  const viewportH = isLandscape ? Math.round(safeH * 0.48) : Math.round(safeH * 0.52);

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
        background: linear-gradient(165deg, ${palette.background} 0%, #0A1410 64%, #060C09 100%);
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
        gap: 22px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-viewport {
        position: relative;
        width: 100%;
        height: ${viewportH}px;
        border-radius: 28px;
        border: 3px solid #FACC15;
        background-color: #0A1410;
        overflow: hidden;
        box-sizing: border-box;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-rig {
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
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-hook-synth {
        position: absolute;
        inset: 0;
        background: linear-gradient(140deg, ${palette.primary} 0%, #0A1410 65%, #0D2018 100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 24px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-pulse-ring {
        width: 112px;
        height: 112px;
        border-radius: 999px;
        border: 4px solid #FACC15;
        background-color: #0A1410;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wave-row {
        display: flex;
        flex-direction: row;
        align-items: flex-end;
        gap: 12px;
        height: 76px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wave-bar {
        width: 18px;
        border-radius: 999px;
        background-color: ${palette.secondary};
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wb-1 { height: 38%; }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wb-2 { height: 78%; }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wb-3 { height: 100%; }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wb-4 { height: 66%; }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-wb-5 { height: 44%; }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-hook-tag {
        position: absolute;
        left: 20px;
        top: 20px;
        background-color: #0A1410;
        color: #FFFFFF;
        border: 2px solid #FACC15;
        font-size: 16px;
        font-weight: 800;
        letter-spacing: 0.06em;
        padding: 6px 14px;
        border-radius: 999px;
        z-index: 4;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-card-clip {
        flex: 1 1 auto;
        display: flex;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-hook-card {
        width: 100%;
        background-color: #0A1410;
        border: 2px solid ${palette.secondary};
        border-radius: 28px;
        padding: 24px 28px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 14px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-gold-badge {
        display: inline-block;
        align-self: flex-start;
        background-color: #FACC15;
        color: #08120E;
        font-size: 17px;
        font-weight: 900;
        letter-spacing: 0.06em;
        padding: 6px 16px;
        border-radius: 999px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-headline {
        margin: 0;
        color: #FFFFFF;
        font-size: ${headingPx}px;
        font-weight: 900;
        line-height: 1.12;
        letter-spacing: -0.025em;
        display: flex;
        flex-wrap: wrap;
        gap: 10px 12px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-word {
        display: inline-block;
        color: #FFFFFF;
        transform-origin: center bottom;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-subline {
        margin: 0;
        color: #E2E8F0;
        font-size: ${subPx}px;
        font-weight: 500;
        line-height: 1.32;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-progress-track {
        width: 100%;
        height: 10px;
        border-radius: 999px;
        background-color: #162820;
        overflow: hidden;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-progress-fill {
        width: 100%;
        height: 100%;
        border-radius: 999px;
        background-color: #FACC15;
        transform-origin: left center;
      }
    </style>

    <div class="${pfx}-canvas">
      <div class="${pfx}-safe">
        <div id="${pfx}-viewport" class="${pfx}-viewport" data-layout-allow-overflow>
          <div id="${pfx}-rig" class="${pfx}-rig" data-layout-allow-overflow>
            <div ${mediaSlotAttrs} data-layout-allow-overflow>
              ${hookMedia.innerHtml}
            </div>
          </div>
          <div id="${pfx}-hook-tag" class="${pfx}-hook-tag" data-layout-ignore>${hookTagText}</div>
        </div>

        <div
          id="${pfx}-card-clip"
          class="clip ${pfx}-card-clip"
          data-start="0"
          data-duration="${dur}"
          data-track-index="2"
        >
          <div id="${pfx}-hook-card" class="${pfx}-hook-card">
            <span id="${pfx}-badge" class="${pfx}-gold-badge" data-layout-ignore>${badgeText}</span>
            <h1 id="${pfx}-headline" class="${pfx}-headline">${wordSpansHtml}</h1>
            <p id="${pfx}-subline" class="${pfx}-subline">${subheadlineText}</p>
            <div class="${pfx}-progress-track">
              <div id="${pfx}-progress-fill" class="${pfx}-progress-fill"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });

        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-rig',
          { scale: 1.14, y: 14 },
          { scale: 1, y: 0, duration: ${punchDur}, ease: "expo.out" },
          0,
        );

        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-hook-card',
          { opacity: 1, y: 14, scale: 0.98 },
          { opacity: 1, y: 0, scale: 1, duration: ${cardDur}, ease: "power3.out" },
          0,
        );

${wordTweensJs}

        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-progress-fill',
          { scaleX: 0 },
          { scaleX: 1, duration: ${progressDur}, ease: "none" },
          0,
        );

        window.__timelines = window.__timelines || {};
        window.__timelines["${escapeJsString(compId)}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

function renderProductPriceRevealScene({ compId, pfx, w, h, dur, shot, palette }) {
  const isLandscape = w >= h;
  const padX = Math.round(w * 0.1);
  const padY = Math.round(h * 0.1);
  const safeW = w - padX * 2;
  const safeH = h - padY * 2;

  const shortSide = Math.min(w, h);
  const readFloorPx = Math.max(18, Math.ceil(shortSide * 0.027));
  const headingPx = Math.max(readFloorPx + 12, isLandscape ? 42 : 46);
  const subPx = Math.max(readFloorPx, isLandscape ? 28 : 29);
  const offerPricePx = isLandscape ? 58 : 62;
  const origPricePx = Math.max(readFloorPx, 30);

  const staging = shot?.staging || {};
  const copy = shot?.copy || {};

  const badgeText = escapeHtml(
    staging.badge || copy.badge || shot?.badge || "LIMITED LAUNCH OFFER",
  );
  const discountText = escapeHtml(
    staging.discountBadge || shot?.discountBadge || shot?.savingsText || "SAVE 40%",
  );
  const headlineText = escapeHtml(
    staging.headline ||
      copy.headline ||
      shot?.headline ||
      shot?.title ||
      "Studio Pro Creator Bundle",
  );
  const subheadlineText = escapeHtml(
    staging.subheadline ||
      copy.subheadline ||
      shot?.subheadline ||
      shot?.description ||
      "Instant access to cinema templates, neural voiceovers, and 1080p local exports.",
  );
  const originalPriceText = escapeHtml(
    staging.originalPrice || shot?.originalPrice || shot?.compareAtPrice || "$129",
  );
  const offerPriceText = escapeHtml(
    staging.offerPrice || shot?.offerPrice || shot?.price || shot?.salePrice || "$49",
  );
  const ctaText = escapeHtml(
    staging.ctaText || copy.ctaText || shot?.ctaText || "GET INSTANT ACCESS",
  );

  const productRel = normalizeRelativeAssetPath(
    shot?.productVideo ||
      shot?.videoSrc ||
      shot?.clipRelPath ||
      shot?.sourceClip ||
      shot?.productImage ||
      shot?.imageSrc ||
      shot?.plateRelPath ||
      shot?.plateImage ||
      staging.productImage ||
      staging.plateImage,
  );

  const productMedia = renderLayerMedia({
    pfx,
    slotName: "product",
    relPath: productRel,
    dur,
    trackIndex: 1,
    synthHtml: `<div id="${pfx}-product-synth" class="${pfx}-product-synth">
      <div class="${pfx}-pedestal-card">
        <div class="${pfx}-pedestal-accent"></div>
        <div class="${pfx}-pedestal-line ${pfx}-pl-wide"></div>
        <div class="${pfx}-pedestal-line ${pfx}-pl-mid"></div>
      </div>
    </div>`,
  });

  const productSlotAttrs = productMedia.wrapperTimedAttrs
    ? `id="${pfx}-product-slot"${productMedia.wrapperTimedAttrs}`
    : `id="${pfx}-product-slot" class="${pfx}-untimed-slot"`;

  const stageH = isLandscape ? Math.round(safeH * 0.44) : Math.round(safeH * 0.44);
  const introDur = Number(Math.min(0.42, dur * 0.18).toFixed(2));
  const strikeStart = Number(Math.min(0.32, dur * 0.14).toFixed(2));
  const strikeDur = Number(Math.min(0.36, dur * 0.18).toFixed(2));
  const popStart = Number((strikeStart + strikeDur * 0.55).toFixed(2));
  const popDur = Number(Math.min(0.48, dur * 0.24).toFixed(2));
  const floatDur = Number(Math.max(0.6, dur * 0.9).toFixed(2));

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
        background: linear-gradient(160deg, ${palette.background} 0%, #0A1410 64%, #060D0A 100%);
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
        gap: 20px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-product-stage {
        position: relative;
        width: 100%;
        height: ${stageH}px;
        border-radius: 28px;
        border: 2px solid ${palette.secondary};
        background-color: #0A1410;
        overflow: hidden;
        box-sizing: border-box;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-product-rig {
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
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-product-synth {
        position: absolute;
        inset: 0;
        background: linear-gradient(145deg, ${palette.primary} 0%, #0A1410 68%, #0C1E16 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px;
        box-sizing: border-box;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-pedestal-card {
        width: 68%;
        height: 74%;
        border-radius: 22px;
        border: 2px solid #FACC15;
        background-color: #0A1410;
        padding: 24px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 14px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-pedestal-accent {
        width: 56px;
        height: 14px;
        border-radius: 999px;
        background-color: #FACC15;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-pedestal-line {
        height: 16px;
        border-radius: 999px;
        background-color: ${palette.secondary};
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-pl-wide { width: 82%; }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-pl-mid { width: 54%; }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-discount-pill {
        position: absolute;
        right: 20px;
        top: 20px;
        background-color: #FACC15;
        color: #08120E;
        font-size: 18px;
        font-weight: 900;
        letter-spacing: 0.05em;
        padding: 8px 18px;
        border-radius: 999px;
        z-index: 6;
        transform-origin: center center;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-offer-clip {
        flex: 1 1 auto;
        display: flex;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-price-card {
        width: 100%;
        background-color: #0A1410;
        border: 2px solid ${palette.primary};
        border-radius: 28px;
        padding: 24px 28px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 14px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-gold-badge {
        display: inline-block;
        align-self: flex-start;
        background-color: #FACC15;
        color: #08120E;
        font-size: 16px;
        font-weight: 800;
        letter-spacing: 0.06em;
        padding: 6px 14px;
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
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-price-footer {
        display: flex;
        flex-direction: ${isLandscape ? "row" : "column"};
        align-items: ${isLandscape ? "center" : "stretch"};
        justify-content: space-between;
        gap: 16px;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-price-lockup {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 20px;
        font-variant-numeric: tabular-nums;
        font-feature-settings: "tnum" 1;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-orig-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-orig-price {
        color: #CBD5E1;
        font-size: ${origPricePx}px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-strike-line {
        position: absolute;
        left: -4px;
        right: -4px;
        top: 50%;
        height: 4px;
        border-radius: 999px;
        background-color: #FACC15;
        transform-origin: left center;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-offer-price-chip {
        display: inline-flex;
        align-items: center;
        background-color: #FACC15;
        color: #08120E;
        font-size: ${offerPricePx}px;
        font-weight: 900;
        line-height: 1.04;
        letter-spacing: -0.03em;
        padding: 8px 22px;
        border-radius: 20px;
        font-variant-numeric: tabular-nums;
        transform-origin: center center;
      }
      [data-composition-id="${escapeHtml(compId)}"] .${pfx}-cta-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        align-self: ${isLandscape ? "center" : "flex-start"};
        background-color: #FFFFFF;
        color: #08120E;
        font-size: 20px;
        font-weight: 900;
        letter-spacing: 0.05em;
        padding: 14px 26px;
        border-radius: 999px;
        transform-origin: center center;
      }
    </style>

    <div class="${pfx}-canvas">
      <div class="${pfx}-safe">
        <div id="${pfx}-product-stage" class="${pfx}-product-stage" data-layout-allow-overflow>
          <div id="${pfx}-product-rig" class="${pfx}-product-rig" data-layout-allow-overflow>
            <div ${productSlotAttrs} data-layout-allow-overflow>
              ${productMedia.innerHtml}
            </div>
          </div>
          <div id="${pfx}-discount-pill" class="${pfx}-discount-pill" data-layout-ignore>${discountText}</div>
        </div>

        <div
          id="${pfx}-offer-clip"
          class="clip ${pfx}-offer-clip"
          data-start="0"
          data-duration="${dur}"
          data-track-index="2"
        >
          <div id="${pfx}-price-card" class="${pfx}-price-card">
            <span id="${pfx}-badge" class="${pfx}-gold-badge" data-layout-ignore>${badgeText}</span>
            <h1 id="${pfx}-headline" class="${pfx}-headline">${headlineText}</h1>
            <p id="${pfx}-subline" class="${pfx}-subline">${subheadlineText}</p>

            <div class="${pfx}-price-footer">
              <div class="${pfx}-price-lockup">
                <div class="${pfx}-orig-wrap">
                  <span id="${pfx}-orig-price" class="${pfx}-orig-price" data-layout-ignore>${originalPriceText}</span>
                  <span id="${pfx}-strike-line" class="${pfx}-strike-line" data-layout-allow-occlusion></span>
                </div>
                <div id="${pfx}-offer-price" class="${pfx}-offer-price-chip">${offerPriceText}</div>
              </div>

              <div id="${pfx}-cta-pill" class="${pfx}-cta-pill" data-layout-ignore>${ctaText}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });

        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-product-rig',
          { scale: 0.95, y: 12 },
          { scale: 1.04, y: 0, duration: ${floatDur}, ease: "power2.out" },
          0,
        );

        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-discount-pill',
          { opacity: 0, scale: 0.84 },
          { opacity: 1, scale: 1, duration: ${introDur}, ease: "back.out(1.5)" },
          0.06,
        );

        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-price-card',
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: ${introDur}, ease: "power3.out" },
          0.04,
        );

        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-strike-line',
          { scaleX: 0 },
          { scaleX: 1, duration: ${strikeDur}, ease: "power3.inOut" },
          ${strikeStart},
        );

        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-offer-price',
          { opacity: 0, scale: 0.82, y: 12 },
          { opacity: 1, scale: 1, y: 0, duration: ${popDur}, ease: "back.out(1.6)" },
          ${popStart},
        );

        tl.fromTo(
          '[data-composition-id="${escapeJsString(compId)}"] #${pfx}-cta-pill',
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: ${introDur}, ease: "power2.out" },
          ${Number((popStart + 0.08).toFixed(2))},
        );

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
  compositionId = "scene-social-hooks",
  width = 1080,
  height = 1920,
  durationSeconds = 3.5,
  shot = {},
  brandColors = {},
} = {}) {
  const compId = sanitizeCompositionId(compositionId);
  const pfx = buildSafePrefix(compId);
  const w = Math.max(240, Math.round(Number(width) || 1080));
  const h = Math.max(240, Math.round(Number(height) || 1920));
  const dur = Math.max(0.5, Math.round((Number(durationSeconds) || 3.5) * 100) / 100);
  const palette = normalizeBrandPalette(brandColors);

  if (archetypeId === "hook-scroll-stopper") {
    return renderHookScrollStopperScene({ compId, pfx, w, h, dur, shot, palette });
  }
  if (archetypeId === "product-price-reveal") {
    return renderProductPriceRevealScene({ compId, pfx, w, h, dur, shot, palette });
  }

  throw new Error(
    `Unsupported archetypeId "${String(archetypeId)}" in ${PACK_ID}. Expected one of: ${ARCHETYPES.map((a) => a.id).join(", ")}`,
  );
}

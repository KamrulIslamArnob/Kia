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
import { loadStoryboard, resolveChromeHeadlessShell } from "./storyboard.mjs";

const ASPECT_DIMS = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export const THUMBNAIL_AB_STRATEGIES = Object.freeze([
  Object.freeze({
    id: "variant_a_hook",
    variant: "A",
    filename: "variant_a_hook.png",
    label: "Variant A — Bold Hook",
    strategy: "curiosity-hook",
    description:
      "Full-bleed hero frame with high-contrast display hook typography and urgency badge for scroll-stop CTR.",
  }),
  Object.freeze({
    id: "variant_b_split",
    variant: "B",
    filename: "variant_b_split.png",
    label: "Variant B — Editorial Split",
    strategy: "value-split",
    description:
      "Asymmetric split pairing an editorial value-stack panel with a framed product showcase window.",
  }),
  Object.freeze({
    id: "variant_c_spotlight",
    variant: "C",
    filename: "variant_c_spotlight.png",
    label: "Variant C — Focal Spotlight",
    strategy: "detail-magnifier",
    description:
      "Dimmed scene context with an optical magnifier loupe and pointer cursor highlighting key proof.",
  }),
]);

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

function makeMediaUrl(slug, relPath) {
  return `/media/${encodeURIComponent(slug)}/${relPath.split("/").map(encodeURIComponent).join("/")}`;
}

function createAssetResolver(slug, projectsDir = PROJECTS_DIR) {
  const baseDir = slug ? path.join(projectsDir, slug) : ROOT_DIR;
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

function resolveValidatedProjectDir(slug, projectsDir = PROJECTS_DIR) {
  if (!slug || typeof slug !== "string" || slug.includes("\0")) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  const baseProjectsDir = path.resolve(projectsDir);
  if (baseProjectsDir === path.resolve(PROJECTS_DIR)) {
    assertValidSlug(slug);
    return ensureProjectDirs(slug);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  const resolved = path.resolve(baseProjectsDir, slug);
  if (!resolved.startsWith(baseProjectsDir + path.sep)) {
    throw new Error(`Unsafe project path: ${slug}`);
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function loadStoryboardForDir(slug, projectDir, projectsDir = PROJECTS_DIR) {
  if (path.resolve(projectsDir) === path.resolve(PROJECTS_DIR)) {
    return loadStoryboard(slug);
  }
  const sbPath = path.join(projectDir, "STORYBOARD.json");
  if (!fs.existsSync(sbPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(sbPath, "utf8"));
  } catch {
    return null;
  }
}

function loadBriefWithDefaults(slug, projectDir, providedBrief) {
  let diskBrief = null;
  const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
  if (fs.existsSync(briefPath)) {
    try {
      diskBrief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
    } catch {
      diskBrief = null;
    }
  }

  const merged = { ...(diskBrief || {}), ...(providedBrief || {}) };
  const aspectRatio = ASPECT_DIMS[merged.aspectRatio] ? merged.aspectRatio : "9:16";
  const fallbackDims = ASPECT_DIMS[aspectRatio];
  const width = Number(merged.width) || fallbackDims.width;
  const height = Number(merged.height) || fallbackDims.height;

  return {
    slug,
    title: merged.title || slug,
    aspectRatio,
    width,
    height,
    language: merged.language || "English",
    brandColors: {
      primary: merged.brandColors?.primary || "#1E824C",
      secondary: merged.brandColors?.secondary || "#2ECC71",
      accent: merged.brandColors?.accent || "#F1C40F",
      background: merged.brandColors?.background || "#0A1612",
    },
    files: merged.files || diskBrief?.files || {},
  };
}

function discoverFallbackProjectImages(projectDir, brief, frames = []) {
  const candidates = [];

  for (const frame of frames) {
    if (frame?.keyframes?.peak) candidates.push(frame.keyframes.peak);
    if (frame?.keyframes?.start) candidates.push(frame.keyframes.start);
    if (frame?.aiBackgroundPlate) candidates.push(frame.aiBackgroundPlate);
    if (frame?.designFramePath) candidates.push(frame.designFramePath);
  }

  for (const item of brief?.files?.assetImages || []) {
    if (item?.relPath) candidates.push(item.relPath);
  }
  for (const item of brief?.files?.images || []) {
    if (item?.relPath) candidates.push(item.relPath);
  }

  const rawDir = path.join(projectDir, ".studio", "frames", "raw");
  if (fs.existsSync(rawDir)) {
    const rawPngs = fs
      .readdirSync(rawDir)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .sort();
    for (const f of rawPngs) {
      candidates.push(`.studio/frames/raw/${f}`);
    }
  }

  const thumbDir = path.join(projectDir, ".thumbnails");
  if (fs.existsSync(thumbDir)) {
    const thumbs = fs
      .readdirSync(thumbDir)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .sort();
    for (const f of thumbs) {
      candidates.push(`.thumbnails/${f}`);
    }
  }

  const existingUnique = [];
  const seen = new Set();
  for (const rel of candidates) {
    if (!rel || seen.has(rel)) continue;
    if (fs.existsSync(path.join(projectDir, rel))) {
      seen.add(rel);
      existingUnique.push(rel);
    }
  }
  return existingUnique;
}

function renderVisualPlateHtml(imgUrl, title, brand) {
  if (imgUrl) {
    return `<img class="plate-img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(title)}" />`;
  }
  return `
    <div class="synthetic-plate" style="background: linear-gradient(145deg, ${brand.primary} 0%, ${brand.background} 68%, #05080D 100%);">
      <div class="syn-window">
        <div class="syn-header">
          <span class="syn-dot" style="background:${brand.accent}"></span>
          <span class="syn-dot" style="background:${brand.secondary}"></span>
          <span class="syn-chip">1080P STUDIO</span>
        </div>
        <div class="syn-body">
          <div class="syn-title">${escapeHtml(title)}</div>
          <div class="syn-bars">
            <div class="syn-bar" style="width:74%;background:${brand.accent}"></div>
            <div class="syn-bar" style="width:52%;background:${brand.secondary}"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderThumbnailVariantHtml({
  variantId = "variant_a_hook",
  brief = {},
  storyboard = null,
  frame = null,
  secondaryFrame = null,
  width: explicitW,
  height: explicitH,
  assetResolver,
} = {}) {
  const width = Number(explicitW || brief?.width) || 1080;
  const height = Number(explicitH || brief?.height) || 1920;
  const isLandscape = width > height;
  const u = Math.min(width, height) / 1080;

  const brand = {
    primary: brief?.brandColors?.primary || "#1E824C",
    secondary: brief?.brandColors?.secondary || "#2ECC71",
    accent: brief?.brandColors?.accent || "#F1C40F",
    background: brief?.brandColors?.background || "#0A1612",
  };

  const resolveAsset = assetResolver || createAssetResolver(brief?.slug);
  const frames = Array.isArray(storyboard?.frames) ? storyboard.frames : [];
  const primaryFrame = frame || frames[0] || {};
  const altFrame = secondaryFrame || frames[1] || primaryFrame;

  const headline =
    primaryFrame?.staging?.headline ||
    primaryFrame?.title ||
    brief?.title ||
    "Watch Before You Scroll";
  const subheadline =
    primaryFrame?.staging?.subheadline ||
    altFrame?.staging?.headline ||
    "Proven step-by-step workflow engineered for instant results";
  const badgeText = primaryFrame?.staging?.badgeText || "MUST WATCH";
  const ctaText = primaryFrame?.staging?.ctaText || "Watch Now";
  const altBadge = altFrame?.staging?.badgeText || "VERIFIED PROOF";

  const heroImgUrl =
    resolveAsset(primaryFrame?.keyframes?.peak) ||
    resolveAsset(primaryFrame?.keyframes?.start) ||
    resolveAsset(primaryFrame?.aiBackgroundPlate) ||
    resolveAsset(primaryFrame?.designFramePath) ||
    resolveAsset(brief?.files?.assetImages?.[0]?.relPath);

  const secondImgUrl =
    resolveAsset(altFrame?.keyframes?.peak) ||
    resolveAsset(altFrame?.designFramePath) ||
    heroImgUrl;

  const focusX = clamp(Number(altFrame?.cameraMotion?.focusX ?? 56), 28, 72);
  const focusY = clamp(Number(altFrame?.cameraMotion?.focusY ?? 52), 30, 70);

  let bodyMarkup = "";

  if (variantId === "variant_b_split") {
    bodyMarkup = `
      <div class="cover variant-b" data-variant-id="variant_b_split">
        <div class="split-copy">
          <div class="top-row">
            <span class="pill-accent">${escapeHtml(badgeText)}</span>
            <span class="pill-outline">${escapeHtml(altBadge)}</span>
          </div>
          <h1 class="split-headline">${escapeHtml(headline)}</h1>
          <p class="split-sub">${escapeHtml(subheadline)}</p>
          <div class="proof-cards">
            <div class="proof-card">
              <div class="proof-kicker">HIGHLIGHT</div>
              <div class="proof-val">${escapeHtml(altFrame?.title || brief?.title || "Instant Impact")}</div>
            </div>
            <div class="proof-cta">${escapeHtml(ctaText)} →</div>
          </div>
        </div>
        <div class="split-visual">
          <div class="device-frame">
            ${renderVisualPlateHtml(secondImgUrl || heroImgUrl, headline, brand)}
          </div>
        </div>
      </div>
    `;
  } else if (variantId === "variant_c_spotlight") {
    bodyMarkup = `
      <div class="cover variant-c" data-variant-id="variant_c_spotlight">
        <div class="spot-bg">
          ${renderVisualPlateHtml(secondImgUrl || heroImgUrl, headline, brand)}
        </div>
        <div class="spot-vignette" style="background: radial-gradient(circle at ${focusX}% ${focusY}%, rgba(6,10,16,0.08) 0%, rgba(6,10,16,0.86) 58%);"></div>
        <div class="spot-top">
          <span class="pill-accent">${escapeHtml(altBadge)}</span>
          <h1 class="spot-headline">${escapeHtml(headline)}</h1>
        </div>
        <div class="spot-loupe" style="left:${focusX}%; top:${focusY}%;">
          <div class="loupe-crop">
            ${renderVisualPlateHtml(heroImgUrl || secondImgUrl, headline, brand)}
          </div>
          <div class="loupe-halo"></div>
          <svg class="pointer-icon" viewBox="0 0 64 64" aria-hidden="true">
            <path d="M14 8 L14 50 L26 39 L35 56 L43 52 L34 35 L50 35 Z" fill="#FFFFFF" stroke="#0B101B" stroke-width="4" stroke-linejoin="round" />
          </svg>
        </div>
        <div class="spot-bottom-card">
          <div class="spot-sub">${escapeHtml(subheadline)}</div>
          <span class="spot-cta">${escapeHtml(ctaText)}</span>
        </div>
      </div>
    `;
  } else {
    bodyMarkup = `
      <div class="cover variant-a" data-variant-id="variant_a_hook">
        <div class="hook-backdrop">
          ${renderVisualPlateHtml(heroImgUrl, headline, brand)}
        </div>
        <div class="hook-scrim"></div>
        <div class="hook-top">
          <span class="pill-accent">${escapeHtml(badgeText)}</span>
          <span class="brand-tag">${escapeHtml(brief?.title || "FEATURED")}</span>
        </div>
        <div class="hook-bottom">
          <div class="hook-bar"></div>
          <h1 class="hook-headline">${escapeHtml(headline)}</h1>
          <p class="hook-sub">${escapeHtml(subheadline)}</p>
          <div class="hook-cta-row">
            <span class="hook-cta">${escapeHtml(ctaText)} →</span>
          </div>
        </div>
      </div>
    `;
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${escapeHtml(headline)}</title>
    <style>
      :root {
        --u: ${u.toFixed(4)}px;
        --primary: ${brand.primary};
        --secondary: ${brand.secondary};
        --accent: ${brand.accent};
        --bg: ${brand.background};
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
        color: #FFFFFF;
        font-family: "Inter", "Hind Siliguri", "Nirmala UI", "Noto Sans Devanagari", "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .cover {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
      }
      .plate-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .synthetic-plate {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: calc(64 * var(--u));
      }
      .syn-window {
        width: 86%;
        height: 74%;
        border-radius: calc(34 * var(--u));
        background: rgba(12, 19, 28, 0.88);
        border: 2px solid rgba(255, 255, 255, 0.18);
        padding: calc(34 * var(--u));
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .syn-header {
        display: flex;
        align-items: center;
        gap: calc(12 * var(--u));
      }
      .syn-dot {
        width: calc(16 * var(--u));
        height: calc(16 * var(--u));
        border-radius: 50%;
      }
      .syn-chip {
        margin-left: auto;
        font-size: calc(18 * var(--u));
        font-weight: 800;
        letter-spacing: 0.08em;
        color: #CBD5E1;
      }
      .syn-title {
        font-size: calc(46 * var(--u));
        font-weight: 900;
        line-height: 1.12;
      }
      .syn-bars {
        display: flex;
        flex-direction: column;
        gap: calc(14 * var(--u));
        margin-top: calc(28 * var(--u));
      }
      .syn-bar {
        height: calc(16 * var(--u));
        border-radius: 999px;
      }
      .pill-accent {
        display: inline-flex;
        align-items: center;
        padding: calc(12 * var(--u)) calc(28 * var(--u));
        border-radius: 999px;
        background: var(--accent);
        color: #0B101B;
        font-size: calc(24 * var(--u));
        font-weight: 900;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        box-shadow: 0 calc(10 * var(--u)) calc(28 * var(--u)) rgba(0, 0, 0, 0.42);
      }
      .pill-outline {
        display: inline-flex;
        align-items: center;
        padding: calc(11 * var(--u)) calc(24 * var(--u));
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
        border: 1.5px solid rgba(255, 255, 255, 0.28);
        color: #F8FAFC;
        font-size: calc(21 * var(--u));
        font-weight: 700;
        letter-spacing: 0.05em;
      }

      /* Variant A — Bold Hook */
      .hook-backdrop {
        position: absolute;
        inset: 0;
        transform: scale(1.06);
      }
      .hook-scrim {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          180deg,
          rgba(6, 10, 16, 0.68) 0%,
          rgba(6, 10, 16, 0.14) 34%,
          rgba(6, 10, 16, 0.88) 62%,
          rgba(6, 10, 16, 0.98) 100%
        );
      }
      .hook-top {
        position: relative;
        z-index: 2;
        padding: calc(74 * var(--u)) calc(76 * var(--u)) 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: calc(20 * var(--u));
      }
      .brand-tag {
        padding: calc(10 * var(--u)) calc(22 * var(--u));
        border-radius: 999px;
        background: rgba(9, 14, 22, 0.78);
        border: 1.5px solid rgba(255, 255, 255, 0.22);
        font-size: calc(21 * var(--u));
        font-weight: 700;
        max-width: 52%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hook-bottom {
        position: absolute;
        z-index: 2;
        left: calc(76 * var(--u));
        right: calc(76 * var(--u));
        bottom: calc(88 * var(--u));
      }
      .hook-bar {
        width: calc(140 * var(--u));
        height: calc(12 * var(--u));
        border-radius: 999px;
        background: var(--accent);
        margin-bottom: calc(24 * var(--u));
      }
      .hook-headline {
        font-size: calc(${isLandscape ? 82 : 88} * var(--u));
        font-weight: 900;
        line-height: 1.05;
        letter-spacing: -0.025em;
        text-shadow: 0 calc(8 * var(--u)) calc(28 * var(--u)) rgba(0, 0, 0, 0.65);
      }
      .hook-sub {
        margin-top: calc(22 * var(--u));
        font-size: calc(32 * var(--u));
        font-weight: 600;
        color: #E2E8F0;
        line-height: 1.32;
        max-width: 92%;
      }
      .hook-cta-row {
        margin-top: calc(34 * var(--u));
      }
      .hook-cta {
        display: inline-block;
        padding: calc(18 * var(--u)) calc(38 * var(--u));
        border-radius: 999px;
        background: var(--primary);
        border: 2px solid rgba(255, 255, 255, 0.25);
        color: #FFFFFF;
        font-size: calc(28 * var(--u));
        font-weight: 800;
      }

      /* Variant B — Editorial Split */
      .variant-b {
        display: grid;
        grid-template-columns: ${isLandscape ? "1.05fr 0.95fr" : "1fr"};
        grid-template-rows: ${isLandscape ? "1fr" : "auto 1fr"};
        gap: calc(36 * var(--u));
        padding: calc(72 * var(--u));
        background:
          radial-gradient(circle at 14% 18%, color-mix(in srgb, var(--primary) 42%, transparent) 0%, transparent 56%),
          #0A1118;
      }
      .split-copy {
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      .top-row {
        display: flex;
        flex-wrap: wrap;
        gap: calc(14 * var(--u));
      }
      .split-headline {
        margin-top: calc(28 * var(--u));
        font-size: calc(${isLandscape ? 68 : 74} * var(--u));
        font-weight: 900;
        line-height: 1.06;
        letter-spacing: -0.025em;
      }
      .split-sub {
        margin-top: calc(20 * var(--u));
        font-size: calc(29 * var(--u));
        color: #CBD5E1;
        line-height: 1.36;
      }
      .proof-cards {
        margin-top: calc(34 * var(--u));
        display: flex;
        align-items: center;
        gap: calc(20 * var(--u));
        flex-wrap: wrap;
      }
      .proof-card {
        background: rgba(255, 255, 255, 0.08);
        border: 1.5px solid rgba(255, 255, 255, 0.18);
        border-radius: calc(22 * var(--u));
        padding: calc(18 * var(--u)) calc(26 * var(--u));
      }
      .proof-kicker {
        font-size: calc(17 * var(--u));
        font-weight: 800;
        letter-spacing: 0.08em;
        color: var(--accent);
      }
      .proof-val {
        font-size: calc(25 * var(--u));
        font-weight: 800;
        margin-top: calc(4 * var(--u));
      }
      .proof-cta {
        padding: calc(20 * var(--u)) calc(34 * var(--u));
        border-radius: 999px;
        background: var(--secondary);
        color: #06140D;
        font-size: calc(26 * var(--u));
        font-weight: 900;
      }
      .split-visual {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 0;
      }
      .device-frame {
        width: 100%;
        height: 100%;
        border-radius: calc(42 * var(--u));
        overflow: hidden;
        border: calc(6 * var(--u)) solid rgba(255, 255, 255, 0.22);
        box-shadow: 0 calc(32 * var(--u)) calc(72 * var(--u)) rgba(0, 0, 0, 0.62);
      }

      /* Variant C — Focal Spotlight */
      .spot-bg, .spot-vignette {
        position: absolute;
        inset: 0;
      }
      .spot-top {
        position: relative;
        z-index: 3;
        padding: calc(70 * var(--u)) calc(74 * var(--u)) 0;
      }
      .spot-headline {
        margin-top: calc(22 * var(--u));
        font-size: calc(${isLandscape ? 66 : 72} * var(--u));
        font-weight: 900;
        line-height: 1.06;
        max-width: 90%;
        text-shadow: 0 calc(8 * var(--u)) calc(28 * var(--u)) rgba(0, 0, 0, 0.72);
      }
      .spot-loupe {
        position: absolute;
        z-index: 4;
        width: calc(${isLandscape ? 400 : 460} * var(--u));
        height: calc(${isLandscape ? 400 : 460} * var(--u));
        transform: translate(-50%, -44%);
      }
      .loupe-crop {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        overflow: hidden;
        border: calc(8 * var(--u)) solid var(--accent);
        box-shadow: 0 calc(28 * var(--u)) calc(68 * var(--u)) rgba(0, 0, 0, 0.78);
      }
      .loupe-crop .plate-img, .loupe-crop .synthetic-plate {
        transform: scale(1.72);
      }
      .loupe-halo {
        position: absolute;
        inset: calc(-22 * var(--u));
        border-radius: 50%;
        border: 3px dashed rgba(250, 204, 21, 0.72);
      }
      .pointer-icon {
        position: absolute;
        right: calc(12 * var(--u));
        bottom: calc(8 * var(--u));
        width: calc(96 * var(--u));
        height: calc(96 * var(--u));
        filter: drop-shadow(0 calc(10 * var(--u)) calc(20 * var(--u)) rgba(0, 0, 0, 0.65));
      }
      .spot-bottom-card {
        position: absolute;
        z-index: 5;
        left: calc(74 * var(--u));
        right: calc(74 * var(--u));
        bottom: calc(72 * var(--u));
        background: rgba(9, 14, 22, 0.9);
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-radius: calc(28 * var(--u));
        padding: calc(26 * var(--u)) calc(34 * var(--u));
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: calc(24 * var(--u));
      }
      .spot-sub {
        font-size: calc(27 * var(--u));
        font-weight: 700;
        color: #F1F5F9;
        line-height: 1.3;
      }
      .spot-cta {
        flex-shrink: 0;
        padding: calc(16 * var(--u)) calc(30 * var(--u));
        border-radius: 999px;
        background: var(--accent);
        color: #0B101B;
        font-size: calc(24 * var(--u));
        font-weight: 900;
      }
    </style>
  </head>
  <body>
    ${bodyMarkup}
  </body>
</html>
`;
}

async function capturePngWithChrome({ chromeExe, html, htmlPath, pngPath, width, height }) {
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
      `Failed to capture thumbnail PNG via chrome-headless-shell (code ${res.code}): ${(res.stderr || res.stdout || "").slice(0, 400)}`,
    );
  }
  return fs.statSync(pngPath).size;
}

export async function generateThumbnailAbVariants({
  slug,
  brief = null,
  storyboard = null,
  width: overrideWidth,
  height: overrideHeight,
  aspectRatio: overrideAspect,
  chromeExecutable = null,
  projectsDir = PROJECTS_DIR,
} = {}) {
  const projectDir = resolveValidatedProjectDir(slug, projectsDir);

  const outDir = path.join(projectDir, "output", "thumbnails");
  const tmpDir = path.join(projectDir, ".studio", "frames", "tmp", "thumbnails");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const resolvedBrief = loadBriefWithDefaults(slug, projectDir, {
    ...(brief || {}),
    ...(overrideAspect ? { aspectRatio: overrideAspect } : {}),
    ...(overrideWidth ? { width: overrideWidth } : {}),
    ...(overrideHeight ? { height: overrideHeight } : {}),
  });

  const resolvedStoryboard = storyboard ||
    loadStoryboardForDir(slug, projectDir, projectsDir) || { frames: [] };
  const frames = Array.isArray(resolvedStoryboard.frames) ? resolvedStoryboard.frames : [];
  const discoveredImages = discoverFallbackProjectImages(projectDir, resolvedBrief, frames);

  const primaryFrame = frames[0]
    ? {
        ...frames[0],
        keyframes: {
          ...(frames[0].keyframes || {}),
          peak: frames[0].keyframes?.peak || discoveredImages[0] || null,
        },
      }
    : {
        title: resolvedBrief.title,
        keyframes: { peak: discoveredImages[0] || null },
        staging: {
          headline: resolvedBrief.title,
          subheadline: "High-impact cover engineered for instant click-through",
          badgeText: "NEW RELEASE",
          ctaText: "Watch Now",
        },
      };

  const secondaryFrame = frames[1]
    ? {
        ...frames[1],
        keyframes: {
          ...(frames[1].keyframes || {}),
          peak: frames[1].keyframes?.peak || discoveredImages[1] || discoveredImages[0] || null,
        },
      }
    : {
        ...primaryFrame,
        keyframes: { peak: discoveredImages[1] || discoveredImages[0] || null },
      };

  const chromeExe = chromeExecutable || resolveChromeHeadlessShell();
  if (!chromeExe) {
    throw new Error(
      "chrome-headless-shell executable not found in ~/.cache/hyperframes/chrome or system Chrome paths.",
    );
  }

  const width = resolvedBrief.width;
  const height = resolvedBrief.height;
  const assetResolver = createAssetResolver(slug, projectsDir);

  const variants = await Promise.all(
    THUMBNAIL_AB_STRATEGIES.map(async (spec) => {
      const html = renderThumbnailVariantHtml({
        variantId: spec.id,
        brief: resolvedBrief,
        storyboard: resolvedStoryboard,
        frame: primaryFrame,
        secondaryFrame,
        width,
        height,
        assetResolver,
      });

      const htmlPath = path.join(tmpDir, `${spec.id}.html`);
      const pngPath = path.join(outDir, spec.filename);
      const sizeBytes = await capturePngWithChrome({
        chromeExe,
        html,
        htmlPath,
        pngPath,
        width,
        height,
      });

      const relPath = `output/thumbnails/${spec.filename}`;
      const mediaUrl = makeMediaUrl(slug, relPath);

      return {
        id: spec.id,
        variant: spec.variant,
        name: spec.label,
        label: spec.label,
        strategy: spec.strategy,
        description: spec.description,
        filename: spec.filename,
        relPath,
        url: mediaUrl,
        downloadUrl: mediaUrl,
        headline: primaryFrame?.staging?.headline || primaryFrame?.title || resolvedBrief.title,
        badgeText: primaryFrame?.staging?.badgeText || "FEATURED",
        width,
        height,
        sizeBytes,
      };
    }),
  );

  const generatedAt = new Date().toISOString();
  const manifestPayload = {
    ok: true,
    slug,
    width,
    height,
    aspectRatio: resolvedBrief.aspectRatio,
    outputDir: "output/thumbnails",
    generatedAt,
    variants,
    thumbnails: variants,
  };

  const metaPath = path.join(projectDir, ".studio", "thumbnails-ab.json");
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(manifestPayload, null, 2) + "\n", "utf8");

  return manifestPayload;
}

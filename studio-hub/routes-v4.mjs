import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_ROOT_DIR, "projects");

export const V4_MAX_JSON_BYTES = 15 * 1024 * 1024;

const VALID_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const VALID_SAFE_ID_RE = /^[a-z0-9][a-z0-9_.-]*$/i;
const VALID_SUBTITLE_FORMATS = new Set(["srt", "vtt", "ass"]);
const VALID_TARGET_SCOPES = new Set(["workspace", "project"]);
const VALID_ASPECT_TARGETS = Object.freeze({
  "9:16": Object.freeze({ width: 1080, height: 1920 }),
  "16:9": Object.freeze({ width: 1920, height: 1080 }),
  "1:1": Object.freeze({ width: 1080, height: 1080 }),
  "4:5": Object.freeze({ width: 1080, height: 1350 }),
});

const FALLBACK_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const V4_PROJECT_SUBROUTES = new Set([
  "beat-quantize",
  "subject-matte",
  "smart-reframe",
  "subtitles-export",
  "thumbnails-generate",
  "localized-variants",
]);

function defaultSendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

function defaultSendError(res, status, message, req = null) {
  if (req && !req.readableEnded) {
    req.resume?.();
  }
  const extraHeaders = status === 413 ? { Connection: "close" } : {};
  defaultSendJson(res, status, { ok: false, error: message }, extraHeaders);
}

function readJsonBodyLarge(req, maxBytes = V4_MAX_JSON_BYTES) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let exceeded = false;
    const chunks = [];

    req.on("data", (chunk) => {
      if (exceeded) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += buf.length;
      if (total > maxBytes) {
        exceeded = true;
        req.resume?.();
        const err = new Error(
          `Request payload too large (exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit)`,
        );
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(buf);
    });

    req.on("end", () => {
      if (exceeded) return;
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          const err = new Error("JSON body must be an object");
          err.statusCode = 400;
          reject(err);
          return;
        }
        resolve(parsed);
      } catch {
        const err = new Error("Invalid JSON body");
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on("error", (err) => {
      if (!exceeded) reject(err);
    });
  });
}

function makeBadRequestError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function classifyV4ErrorStatus(err) {
  if (err && typeof err === "object" && typeof err.statusCode === "number") {
    return err.statusCode;
  }
  const msg = err instanceof Error ? err.message : String(err || "");
  if (/payload too large|exceeds .* limit/i.test(msg)) return 413;
  if (/zeroCostGuard/i.test(msg)) return 403;
  if (/not found|does not exist|ENOENT/i.test(msg)) return 404;
  if (
    /invalid|unsafe|traversal|forbidden|restricted|required|unsupported|malformed|must be|outside/i.test(
      msg,
    )
  ) {
    return 400;
  }
  return 500;
}

function hasTraversalTokens(rawValue) {
  const str = String(rawValue ?? "");
  if (str.includes("\0")) return true;
  return /(^|[\\/])\.\.([\\/]|$)/.test(str) || str.includes("..");
}

function validateSafeIdentifier(rawId, label = "identifier") {
  const str = String(rawId ?? "").trim();
  if (!str) {
    throw makeBadRequestError(`Valid ${label} is required`);
  }
  if (
    str === "." ||
    str === ".." ||
    str.includes("..") ||
    str.includes("\0") ||
    /[\\/]/.test(str) ||
    !VALID_SAFE_ID_RE.test(str)
  ) {
    throw makeBadRequestError(`Invalid ${label}: path traversal or unsafe characters rejected`);
  }
  return str;
}

function decodeUriSegmentOrThrow(raw, label) {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw makeBadRequestError(`Malformed URL encoding for ${label}`);
  }
}

async function safeLazyImport(specifier, deps = {}, cache = {}) {
  if (specifier in cache) return cache[specifier];
  const importer = typeof deps.importModule === "function" ? deps.importModule : (s) => import(s);
  try {
    const mod = await importer(specifier);
    cache[specifier] = mod;
    return mod;
  } catch {
    cache[specifier] = null;
    return null;
  }
}

function resolveProjectsBaseDir(deps = {}) {
  if (deps.projectsDir) {
    return path.resolve(deps.projectsDir);
  }
  if (deps.lib?.PROJECTS_DIR) {
    return path.resolve(deps.lib.PROJECTS_DIR);
  }
  return DEFAULT_PROJECTS_DIR;
}

function resolveValidatedProjectDir(slug, deps = {}) {
  const clean = String(slug ?? "").trim();
  if (
    !clean ||
    clean.includes("..") ||
    clean.includes("\0") ||
    /[\\/]/.test(clean) ||
    !VALID_SLUG_RE.test(clean)
  ) {
    throw makeBadRequestError(`Invalid project slug: ${slug}`);
  }
  const baseDir = resolveProjectsBaseDir(deps);
  const resolved = path.resolve(baseDir, clean);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw makeBadRequestError(`Unsafe project path: ${slug}`);
  }
  return resolved;
}

function resolveConfinedProjectPath(projectDir, rawPath, label = "path") {
  const str = String(rawPath ?? "").trim();
  if (!str) return null;
  if (hasTraversalTokens(str)) {
    throw makeBadRequestError(`Unsafe ${label}: path traversal is not allowed`);
  }

  let normalized = str;
  if (normalized.startsWith("/media/")) {
    const cleanUrl = normalized.split("?")[0];
    const parts = cleanUrl.slice("/media/".length).split("/");
    if (parts.length < 2) {
      throw makeBadRequestError(`Malformed media URL in ${label}`);
    }
    const decodedRel = parts
      .slice(1)
      .map((seg) => decodeUriSegmentOrThrow(seg, label))
      .join("/");
    if (hasTraversalTokens(decodedRel)) {
      throw makeBadRequestError(`Unsafe ${label}: path traversal is not allowed`);
    }
    normalized = decodedRel;
  }

  const resolvedProject = path.resolve(projectDir);
  const resolvedFile = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(resolvedProject, normalized);

  const prefix = resolvedProject.endsWith(path.sep) ? resolvedProject : resolvedProject + path.sep;
  const inside =
    process.platform === "win32"
      ? resolvedFile.toLowerCase().startsWith(prefix.toLowerCase())
      : resolvedFile.startsWith(prefix);

  if (!inside || resolvedFile === resolvedProject) {
    throw makeBadRequestError(`Unsafe ${label}: resolved outside project directory`);
  }

  const relPosix = path.relative(resolvedProject, resolvedFile).replaceAll("\\", "/");
  return { absPath: resolvedFile, relPath: relPosix };
}

function toProjectRelativePosix(projectDir, rawPath) {
  if (!rawPath) return "";
  const str = String(rawPath).trim();
  if (!str) return "";
  if (str.startsWith("http://") || str.startsWith("https://") || str.startsWith("data:")) {
    return str;
  }
  if (str.startsWith("/media/")) {
    const cleanUrl = str.split("?")[0];
    const parts = cleanUrl.slice("/media/".length).split("/");
    if (parts.length >= 2) {
      return parts.slice(1).map(decodeURIComponent).join("/");
    }
    return "";
  }
  if (projectDir && path.isAbsolute(str)) {
    const rel = path.relative(projectDir, path.resolve(str)).replaceAll("\\", "/");
    if (!rel.startsWith("..")) {
      return rel;
    }
  }
  let norm = str.replaceAll("\\", "/");
  if (projectDir) {
    const slugName = path.basename(projectDir);
    const marker = `/projects/${slugName}/`;
    const idx = norm.toLowerCase().indexOf(marker.toLowerCase());
    if (idx !== -1) {
      norm = norm.slice(idx + marker.length);
    }
  }
  return norm.replace(/^\.\/+/, "").replace(/^\/+/, "");
}

export function toV4MediaUrl(slug, projectDir, rawPath) {
  if (!slug || !rawPath) return "";
  const str = String(rawPath).trim();
  if (!str) return "";
  if (str.startsWith("http://") || str.startsWith("https://") || str.startsWith("data:")) {
    return str;
  }
  if (str.startsWith("/media/")) {
    return str.split("?")[0];
  }
  const rel = toProjectRelativePosix(projectDir, str);
  if (!rel || rel.startsWith("..")) return "";
  const encoded = rel.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `/media/${encodeURIComponent(slug)}/${encoded}`;
}

export function decorateV4StoryboardForUi(slug, storyboard, projectDir) {
  if (!storyboard || typeof storyboard !== "object") return storyboard;
  const frames = Array.isArray(storyboard.frames)
    ? storyboard.frames.map((frame) => {
        if (!frame || typeof frame !== "object") return frame;
        const designUrl = toV4MediaUrl(
          slug,
          projectDir,
          frame.designFrameUrl || frame.currentDesignImage || frame.designFramePath || frame.image,
        );
        const hudUrl =
          toV4MediaUrl(
            slug,
            projectDir,
            frame.hudFrameUrl || frame.currentBlueprintImage || frame.hudFramePath,
          ) || designUrl;
        const kfSrc = frame.keyframes && typeof frame.keyframes === "object" ? frame.keyframes : {};
        const keyframes = {
          start: toV4MediaUrl(slug, projectDir, kfSrc.start) || null,
          peak: toV4MediaUrl(slug, projectDir, kfSrc.peak) || null,
          end: toV4MediaUrl(slug, projectDir, kfSrc.end) || null,
        };
        return {
          ...frame,
          designFrameUrl: designUrl,
          hudFrameUrl: hudUrl,
          currentDesignImage: designUrl,
          currentBlueprintImage: hudUrl,
          keyframes,
        };
      })
    : [];
  return { ...storyboard, frames };
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function findFirstExistingImageInProject(projectDir, storyboard, requestedFrameId = null) {
  const frames = Array.isArray(storyboard?.frames) ? storyboard.frames : [];
  const targetFrame =
    (requestedFrameId ? frames.find((f) => f.id === requestedFrameId) : null) || frames[0] || null;

  const relCandidates = [];
  if (targetFrame) {
    const kf = targetFrame.keyframes || {};
    if (kf.peak) relCandidates.push(kf.peak);
    if (kf.start) relCandidates.push(kf.start);
    if (targetFrame.designFramePath) relCandidates.push(targetFrame.designFramePath);
    if (targetFrame.aiBackgroundPlate) relCandidates.push(targetFrame.aiBackgroundPlate);
  }

  for (const cand of relCandidates) {
    try {
      const conf = resolveConfinedProjectPath(projectDir, cand, "frame image");
      if (conf && fs.existsSync(conf.absPath) && fs.statSync(conf.absPath).isFile()) {
        return conf;
      }
    } catch {
      // Try next candidate
    }
  }

  const searchSubdirs = [
    ".studio/frames/raw",
    "assets/images",
    "inbox/images",
    ".studio/frames/design",
  ];
  const imgExts = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  for (const sub of searchSubdirs) {
    const dir = path.join(projectDir, sub);
    if (!fs.existsSync(dir)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (!imgExts.has(path.extname(ent.name).toLowerCase())) continue;
      const absPath = path.join(dir, ent.name);
      const relPath = path.relative(projectDir, absPath).replaceAll("\\", "/");
      return { absPath, relPath };
    }
  }

  return null;
}

/* ---------- Deterministic Local Fallbacks When Peer Module Is Unavailable ---------- */

function fallbackQuantizeStoryboard({ slug, storyboard, fps = 30 }) {
  const safeFps = Math.max(1, Number(fps) || 30);
  const snap = (sec) => Math.round(Number(sec || 0) * safeFps) / safeFps;
  let snappedCount = 0;
  let cursorSec = 0;

  const nextFrames = (Array.isArray(storyboard?.frames) ? storyboard.frames : []).map((frame) => {
    if (frame.locked) {
      cursorSec += Number(frame.durationSeconds) || 4;
      return frame;
    }
    const snappedDur = Math.max(1, snap(Number(frame.durationSeconds) || 4));
    const startSec = snap(cursorSec);
    const endSec = snap(startSec + snappedDur);
    cursorSec = endSec;
    snappedCount += 1;
    return {
      ...frame,
      durationSeconds: Math.round(snappedDur * 10000) / 10000,
      rawTimeRange: Array.isArray(frame.rawTimeRange)
        ? [snap(frame.rawTimeRange[0]), snap(frame.rawTimeRange[0] + snappedDur)]
        : [startSec, endSec],
    };
  });

  const beats = [];
  for (let t = 0; t <= Math.max(4, cursorSec); t += 0.5) {
    beats.push(Math.round(snap(t) * 10000) / 10000);
  }

  return {
    ok: true,
    slug,
    fps: safeFps,
    bpm: 120,
    snappedCount,
    snappedCutCount: snappedCount,
    beats,
    beatTimes: beats,
    storyboard: {
      ...storyboard,
      fps: safeFps,
      frames: nextFrames,
    },
  };
}

function fallbackComputeSmartReframe({
  storyboard,
  sourceWidth = 1080,
  sourceHeight = 1920,
  targetAspect = "16:9",
  faceBox = null,
}) {
  const spec = VALID_ASPECT_TARGETS[targetAspect];
  if (!spec) {
    throw makeBadRequestError(`Unsupported targetAspect: ${targetAspect}`);
  }
  const srcRatio = Math.max(0.1, Number(sourceWidth) / Math.max(1, Number(sourceHeight)));
  const dstRatio = spec.width / spec.height;
  const baseScale = dstRatio > srcRatio ? Math.min(1.45, dstRatio / srcRatio) : 1.04;

  const shots = (Array.isArray(storyboard?.frames) ? storyboard.frames : []).map((frame, idx) => {
    const rawFocusX =
      faceBox?.centerX !== undefined
        ? Number(faceBox.centerX) <= 1
          ? Number(faceBox.centerX) * 100
          : Number(faceBox.centerX)
        : Number(frame?.cameraMotion?.focusX ?? 50);
    const rawFocusY =
      faceBox?.centerY !== undefined
        ? Number(faceBox.centerY) <= 1
          ? Number(faceBox.centerY) * 100
          : Number(faceBox.centerY)
        : Number(frame?.cameraMotion?.focusY ?? 36);

    return {
      frameId: frame.id || `frame_${String(idx + 1).padStart(2, "0")}`,
      index: frame.index || idx + 1,
      focusX: Math.min(85, Math.max(15, Math.round(rawFocusX * 100) / 100)),
      focusY: Math.min(80, Math.max(18, Math.round(rawFocusY * 100) / 100)),
      scale: Math.round(baseScale * 100) / 100,
      width: spec.width,
      height: spec.height,
    };
  });

  return {
    targetAspect,
    width: spec.width,
    height: spec.height,
    sourceWidth: Number(sourceWidth) || 1080,
    sourceHeight: Number(sourceHeight) || 1920,
    shots,
  };
}

function formatClock(sec, sep, centiseconds = false) {
  const clamped = Math.max(0, Number(sec) || 0);
  const hours = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  if (centiseconds) {
    const cs = Math.round((clamped - Math.floor(clamped)) * 100);
    return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}${sep}${String(ms).padStart(3, "0")}`;
}

function fallbackWriteSubtitles({ slug, projectDir, storyboard, brief, phrases, formats }) {
  const outDir = path.join(projectDir, "output");
  fs.mkdirSync(outDir, { recursive: true });

  let cues = Array.isArray(phrases) && phrases.length > 0 ? phrases : null;
  if (!cues) {
    let t = 0;
    const frames = Array.isArray(storyboard?.frames) ? storyboard.frames : [];
    cues =
      frames.length > 0
        ? frames.map((f) => {
            const dur = Math.max(1, Number(f.durationSeconds) || 3);
            const item = {
              start: t,
              end: t + dur,
              text:
                f.audioSpec?.voiceoverText ||
                f.staging?.captionText ||
                f.staging?.headline ||
                f.title ||
                slug,
            };
            t += dur;
            return item;
          })
        : [{ start: 0, end: 4, text: brief?.title || slug }];
  }

  const width = Number(storyboard?.width || brief?.width || 1080);
  const height = Number(storyboard?.height || brief?.height || 1920);
  const files = [];

  for (const fmt of formats) {
    const filename = `${slug}_subtitles.${fmt}`;
    const relPath = `output/${filename}`;
    const absPath = path.join(projectDir, relPath);
    let content = "";

    if (fmt === "srt") {
      content =
        cues
          .map(
            (c, i) =>
              `${i + 1}\n${formatClock(c.start, ",")} --> ${formatClock(c.end, ",")}\n${String(c.text || "").trim()}\n`,
          )
          .join("\n") + "\n";
    } else if (fmt === "vtt") {
      content =
        "WEBVTT\n\n" +
        cues
          .map(
            (c) =>
              `${formatClock(c.start, ".")} --> ${formatClock(c.end, ".")} line:82% position:50% align:center size:80%\n${String(c.text || "").trim()}\n`,
          )
          .join("\n") +
        "\n";
    } else if (fmt === "ass") {
      const events = cues
        .map(
          (c) =>
            `Dialogue: 0,${formatClock(c.start, ".", true)},${formatClock(c.end, ".", true)},Default,,0,0,0,,${String(c.text || "").replace(/[{}]/g, "")}`,
        )
        .join("\n");
      content = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, BackColour, Bold, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Noto Sans,54,&H00FFFFFF,&H80000000,-1,2,108,108,140,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`;
    }

    fs.writeFileSync(absPath, content, "utf8");
    files.push({ format: fmt, filename, relPath, cueCount: cues.length });
  }

  return { files };
}

function fallbackGenerateThumbnails({ projectDir, storyboard }) {
  const thumbDir = path.join(projectDir, "output", "thumbnails");
  fs.mkdirSync(thumbDir, { recursive: true });
  const seedCand = findFirstExistingImageInProject(projectDir, storyboard, null);
  const seedBytes =
    seedCand && fs.existsSync(seedCand.absPath)
      ? fs.readFileSync(seedCand.absPath)
      : FALLBACK_PNG_BYTES;

  const specs = [
    { id: "A", filename: "variant_a_hook.png", label: "Variant A — Bold Hook" },
    { id: "B", filename: "variant_b_split.png", label: "Variant B — Editorial Split" },
    { id: "C", filename: "variant_c_spotlight.png", label: "Variant C — Product Spotlight" },
  ];

  const variants = specs.map((spec) => {
    const relPath = `output/thumbnails/${spec.filename}`;
    fs.writeFileSync(path.join(projectDir, relPath), seedBytes);
    return {
      id: spec.id,
      variant: spec.id,
      label: spec.label,
      filename: spec.filename,
      relPath,
    };
  });

  return { variants };
}

function fallbackBuildLocalizedVariants({ slug, projectDir, storyboard, brief, languages }) {
  const varDir = path.join(projectDir, ".studio", "variants");
  fs.mkdirSync(varDir, { recursive: true });
  const baseFrames = Array.isArray(storyboard?.frames) ? storyboard.frames : [];

  const defaultCopy = {
    bengali: { headline: "বিশেষ অফার — আজই অর্ডার করুন", cta: "অর্ডার করুন" },
    english: { headline: "Featured Launch — Order Direct Today", cta: "Order Now" },
    hindi: { headline: "विशेष ऑफ़र — आज ही ऑर्डर करें", cta: "अभी ऑर्डर करें" },
  };

  const variants = languages.map((lang) => {
    const langKey = String(lang)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-");
    const copy = defaultCopy[langKey] || {
      headline: `${brief?.title || slug} (${lang})`,
      cta: "Learn More",
    };
    const relPath = `.studio/variants/variant_${langKey}.json`;
    const localizedSb = {
      ...(storyboard || { schemaVersion: 1, slug }),
      language: lang,
      frames: baseFrames.map((f, i) => ({
        ...f,
        staging: {
          ...(f.staging || {}),
          headline: i === 0 ? copy.headline : f.staging?.headline || f.title,
          ctaText: copy.cta,
        },
      })),
    };
    fs.writeFileSync(
      path.join(projectDir, relPath),
      JSON.stringify(localizedSb, null, 2) + "\n",
      "utf8",
    );
    return {
      id: `variant_${langKey}`,
      language: lang,
      langKey,
      relPath,
      hookHeadline: copy.headline,
      ctaText: copy.cta,
      frameCount: localizedSb.frames.length,
      storyboard: localizedSb,
    };
  });

  return { slug, languages, variants };
}

function fallbackExtractMatte({ projectDir, sourceConf, outRelPath }) {
  const stem = path.basename(sourceConf.absPath, path.extname(sourceConf.absPath));
  const safeStem = stem.replace(/[^a-zA-Z0-9_-]+/g, "_") || "speaker";
  const relPath = outRelPath || `assets/images/matte_${safeStem}.png`;
  const targetConf = resolveConfinedProjectPath(projectDir, relPath, "outRelPath");
  fs.mkdirSync(path.dirname(targetConf.absPath), { recursive: true });
  fs.copyFileSync(sourceConf.absPath, targetConf.absPath);
  return {
    matteRelPath: targetConf.relPath,
    outRelPath: targetConf.relPath,
    relPath: targetConf.relPath,
    method: "local-alpha-copy-fallback",
  };
}

function fallbackExportSkillBundle({ skillIds, slug, projectDir, outFilePath }) {
  const searchDirs = [];
  if (projectDir) searchDirs.push(path.join(projectDir, "skills"));
  searchDirs.push(path.join(DEFAULT_ROOT_DIR, ".agents", "skills"));
  searchDirs.push(path.join(DEFAULT_ROOT_DIR, "skills"));

  const discovered = new Map();
  for (const base of searchDirs) {
    if (!fs.existsSync(base)) continue;
    for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
      if (!ent.isDirectory() || discovered.has(ent.name)) continue;
      const mdPath = path.join(base, ent.name, "SKILL.md");
      if (fs.existsSync(mdPath)) {
        discovered.set(ent.name, { id: ent.name, dir: path.join(base, ent.name), mdPath });
      }
    }
  }

  const targetIds =
    Array.isArray(skillIds) && skillIds.length > 0 ? skillIds : Array.from(discovered.keys());
  const skills = targetIds.map((id) => {
    const hit = discovered.get(id);
    if (!hit) {
      throw new Error(`Skill "${id}" not found on disk`);
    }
    return {
      id,
      name: id,
      skillMd: fs.readFileSync(hit.mdPath, "utf8"),
      references: {},
    };
  });

  const bundle = {
    schemaVersion: 1,
    format: "studioskills-v1",
    slug: slug || null,
    exportedAt: new Date().toISOString(),
    skills,
  };

  if (outFilePath && projectDir) {
    const outConf = resolveConfinedProjectPath(projectDir, outFilePath, "outFilePath");
    fs.mkdirSync(path.dirname(outConf.absPath), { recursive: true });
    fs.writeFileSync(outConf.absPath, JSON.stringify(bundle, null, 2) + "\n", "utf8");
  }

  return { bundle };
}

function fallbackImportSkillBundle({ bundleDataOrPath, targetScope, slug, projectDir }) {
  let bundleObj = bundleDataOrPath;
  if (typeof bundleDataOrPath === "string") {
    const raw = fs.readFileSync(bundleDataOrPath, "utf8");
    bundleObj = JSON.parse(raw);
  }
  const rawSkills = Array.isArray(bundleObj?.skills) ? bundleObj.skills : [];
  const baseTargetDir =
    targetScope === "project" && projectDir
      ? path.join(projectDir, "skills")
      : path.join(DEFAULT_ROOT_DIR, ".agents", "skills");

  fs.mkdirSync(baseTargetDir, { recursive: true });
  const importedSkills = [];

  for (const entry of rawSkills) {
    const safeId = validateSafeIdentifier(entry?.id || entry?.name, "bundle skill id");
    const skillDir = path.resolve(baseTargetDir, safeId);
    if (!skillDir.startsWith(path.resolve(baseTargetDir) + path.sep)) {
      throw makeBadRequestError(`Unsafe bundle skill path: ${safeId}`);
    }
    fs.mkdirSync(skillDir, { recursive: true });
    const mdText = String(
      entry?.skillMd ?? entry?.content ?? `---\nname: ${safeId}\n---\n# ${safeId}\n`,
    );
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), mdText, "utf8");

    if (entry?.references && typeof entry.references === "object") {
      const refsDir = path.join(skillDir, "references");
      fs.mkdirSync(refsDir, { recursive: true });
      for (const [refName, refContent] of Object.entries(entry.references)) {
        const cleanRef = validateSafeIdentifier(refName, "reference filename");
        fs.writeFileSync(path.join(refsDir, cleanRef), String(refContent ?? ""), "utf8");
      }
    }

    importedSkills.push({
      id: safeId,
      name: entry?.name || safeId,
      installed: true,
      sourceScope: targetScope === "project" ? "project" : "workspace-agents",
    });
  }

  return { targetScope, slug, importedSkills };
}

function validateBundleObjectSafety(bundleObj) {
  if (!bundleObj || typeof bundleObj !== "object" || Array.isArray(bundleObj)) {
    throw makeBadRequestError("Invalid skill bundle object");
  }
  const list = Array.isArray(bundleObj.skills) ? bundleObj.skills : [];
  for (const item of list) {
    if (!item || typeof item !== "object") {
      throw makeBadRequestError("Invalid skill entry inside bundle");
    }
    validateSafeIdentifier(item.id || item.name, "bundle skill id");
    if (item.references && typeof item.references === "object") {
      for (const refKey of Object.keys(item.references)) {
        if (hasTraversalTokens(refKey) || /[\\/]/.test(refKey)) {
          throw makeBadRequestError(`Unsafe reference filename in bundle: ${refKey}`);
        }
      }
    }
  }
}

function assertHttpConfinedBundlePath(rawPath, { projectDir = null, deps = {} } = {}) {
  const str = String(rawPath ?? "").trim();
  if (!str) return null;
  if (hasTraversalTokens(str)) {
    throw makeBadRequestError("Unsafe bundle file path: path traversal is not allowed");
  }

  const allowedRoots = [path.resolve(DEFAULT_ROOT_DIR)];
  if (projectDir) {
    allowedRoots.push(path.resolve(projectDir));
  }
  if (deps.projectsDir) {
    allowedRoots.push(path.resolve(deps.projectsDir));
  }

  const baseForRelative = projectDir ? path.join(projectDir, "output") : DEFAULT_ROOT_DIR;
  const resolved = path.isAbsolute(str) ? path.resolve(str) : path.resolve(baseForRelative, str);

  const isInsideAllowed = allowedRoots.some((root) => {
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    return process.platform === "win32"
      ? resolved.toLowerCase().startsWith(prefix.toLowerCase())
      : resolved.startsWith(prefix);
  });

  if (!isInsideAllowed) {
    throw makeBadRequestError("Unsafe bundle file path: resolved outside allowed workspace root");
  }
  return str;
}

function matchV4Route(pathname) {
  if (pathname === "/api/skill-bundles/export") {
    return { kind: "bundle-export" };
  }
  if (pathname === "/api/skill-bundles/import") {
    return { kind: "bundle-import" };
  }

  const projMatch = pathname.match(/^\/api\/projects\/([^/]+)\/(.+)$/);
  if (!projMatch) return null;

  const rawSlug = projMatch[1];
  const subRoute = projMatch[2];
  if (!V4_PROJECT_SUBROUTES.has(subRoute)) {
    return null;
  }

  return { kind: subRoute, rawSlug };
}

export async function handleV4Routes(req, res, urlObj, deps = {}) {
  const parsedUrl = urlObj || new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const method = String(req.method || "GET").toUpperCase();

  const matched = matchV4Route(pathname);
  if (!matched) {
    return false;
  }

  const sendJson = deps.sendJson || defaultSendJson;
  const rawSendError = deps.sendError || null;
  const sendError = (targetRes, status, message) => {
    if (req && !req.readableEnded) {
      req.resume?.();
    }
    if (rawSendError) {
      rawSendError(targetRes, status, message);
      return;
    }
    defaultSendError(targetRes, status, message, req);
  };

  if (method !== "POST") {
    sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
    return true;
  }

  const maxBodyBytes =
    typeof deps.maxBodyBytes === "number" && deps.maxBodyBytes > 0
      ? deps.maxBodyBytes
      : V4_MAX_JSON_BYTES;
  const readBody = (incomingReq) =>
    typeof deps.readJsonBody === "function"
      ? deps.readJsonBody(incomingReq, maxBodyBytes)
      : readJsonBodyLarge(incomingReq, maxBodyBytes);

  const moduleCache = {};

  try {
    const body = await readBody(req);

    // 7. POST /api/skill-bundles/export
    if (matched.kind === "bundle-export") {
      const slug = body.slug && String(body.slug).trim() ? String(body.slug).trim() : null;
      let projectDir = null;
      if (slug) {
        projectDir = resolveValidatedProjectDir(slug, deps);
      }

      let cleanSkillIds = [];
      if (body.skillIds !== undefined && body.skillIds !== null) {
        if (!Array.isArray(body.skillIds)) {
          sendError(res, 400, "skillIds must be an array of skill IDs");
          return true;
        }
        cleanSkillIds = body.skillIds.map((id) => validateSafeIdentifier(id, "skillId"));
      }

      const outFilePath =
        body.outFilePath !== undefined && body.outFilePath !== null
          ? String(body.outFilePath).trim()
          : null;
      if (outFilePath) {
        assertHttpConfinedBundlePath(outFilePath, { projectDir, deps });
      }

      const directExportFn = deps.exportSkillBundle || deps.skillBundles?.exportSkillBundle;
      const lazyBundles = directExportFn
        ? null
        : await safeLazyImport("./skill-bundles.mjs", deps, moduleCache);
      const exportFn = directExportFn || lazyBundles?.exportSkillBundle;

      const rawRes =
        typeof exportFn === "function"
          ? await exportFn({
              skillIds: cleanSkillIds,
              outFilePath,
              slug,
            })
          : fallbackExportSkillBundle({
              skillIds: cleanSkillIds,
              slug,
              projectDir,
              outFilePath,
            });

      const bundle = rawRes?.bundle ?? rawRes;
      const downloadUrl =
        slug && projectDir && (rawRes?.relPath || outFilePath)
          ? toV4MediaUrl(slug, projectDir, rawRes?.relPath || outFilePath)
          : null;

      sendJson(res, 200, {
        ok: true,
        ...(rawRes && typeof rawRes === "object" ? rawRes : {}),
        bundle,
        ...(downloadUrl ? { downloadUrl, url: downloadUrl } : {}),
      });
      return true;
    }

    // 8. POST /api/skill-bundles/import
    if (matched.kind === "bundle-import") {
      const targetScope = body.targetScope ? String(body.targetScope).trim() : "workspace";
      if (!VALID_TARGET_SCOPES.has(targetScope)) {
        sendError(res, 400, `Invalid targetScope: ${targetScope}`);
        return true;
      }

      const slug = body.slug && String(body.slug).trim() ? String(body.slug).trim() : null;
      let projectDir = null;
      if (slug) {
        projectDir = resolveValidatedProjectDir(slug, deps);
      } else if (targetScope === "project") {
        sendError(res, 400, "slug is required when targetScope is 'project'");
        return true;
      }

      const bundleDataOrPath = body.bundleDataOrPath ?? body.bundle ?? body.bundlePath ?? null;
      if (bundleDataOrPath === null || bundleDataOrPath === undefined || bundleDataOrPath === "") {
        sendError(res, 400, "bundleDataOrPath (or bundle) is required");
        return true;
      }

      if (typeof bundleDataOrPath === "string") {
        assertHttpConfinedBundlePath(bundleDataOrPath, { projectDir, deps });
      } else if (typeof bundleDataOrPath === "object") {
        validateBundleObjectSafety(bundleDataOrPath);
      } else {
        sendError(res, 400, "bundleDataOrPath must be a bundle object or local file path");
        return true;
      }

      const directImportFn = deps.importSkillBundle || deps.skillBundles?.importSkillBundle;
      const lazyBundles = directImportFn
        ? null
        : await safeLazyImport("./skill-bundles.mjs", deps, moduleCache);
      const importFn = directImportFn || lazyBundles?.importSkillBundle;

      const rawRes =
        typeof importFn === "function"
          ? await importFn({
              bundleDataOrPath,
              targetScope,
              slug,
            })
          : fallbackImportSkillBundle({
              bundleDataOrPath,
              targetScope,
              slug,
              projectDir,
            });

      const importedSkills =
        rawRes?.importedSkills ?? rawRes?.skills ?? (Array.isArray(rawRes) ? rawRes : []);

      sendJson(res, 200, {
        ok: true,
        ...(rawRes && typeof rawRes === "object" && !Array.isArray(rawRes) ? rawRes : {}),
        importedSkills,
      });
      return true;
    }

    // Project-scoped Wave 6 routes (/api/projects/:slug/...)
    const slug = decodeUriSegmentOrThrow(matched.rawSlug, "project slug");
    const projectDir = resolveValidatedProjectDir(slug, deps);
    if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
      sendError(res, 404, `Project not found: ${slug}`);
      return true;
    }

    const brief =
      body.brief && typeof body.brief === "object"
        ? body.brief
        : readJsonIfExists(path.join(projectDir, "PROJECT_BRIEF.json")) || { slug };
    const diskStoryboard = readJsonIfExists(path.join(projectDir, "STORYBOARD.json"));
    const storyboard =
      body.storyboard && typeof body.storyboard === "object" ? body.storyboard : diskStoryboard;

    // 1. POST /api/projects/:slug/beat-quantize
    if (matched.kind === "beat-quantize") {
      let resolvedAudioPath = null;
      const rawAudio = body.audioPath ?? body.audioRelPath ?? null;
      if (rawAudio !== null && rawAudio !== undefined && String(rawAudio).trim() !== "") {
        resolvedAudioPath = resolveConfinedProjectPath(projectDir, rawAudio, "audioPath").absPath;
      }

      const fps = Math.max(1, Number(body.fps || storyboard?.fps || brief?.fps || 30));
      const maxSnapSec =
        body.maxSnapSec !== undefined && body.maxSnapSec !== null
          ? Math.max(0.01, Number(body.maxSnapSec))
          : 0.35;

      const directFn =
        deps.quantizeStoryboardToBeats || deps.beatQuantizer?.quantizeStoryboardToBeats;
      const lazyMod = directFn
        ? null
        : await safeLazyImport("./beat-quantizer.mjs", deps, moduleCache);
      const quantizeFn = directFn || lazyMod?.quantizeStoryboardToBeats;

      if (!storyboard && typeof quantizeFn !== "function") {
        sendError(res, 404, `Storyboard not found for project: ${slug}`);
        return true;
      }

      const rawRes =
        typeof quantizeFn === "function"
          ? await quantizeFn({
              slug,
              storyboard,
              audioPath: resolvedAudioPath,
              fps,
              maxSnapSec,
              ...(deps.projectsDir ? { projectsDir: deps.projectsDir } : {}),
            })
          : fallbackQuantizeStoryboard({ slug, storyboard, fps, maxSnapSec });

      const nextSb =
        rawRes?.storyboard && typeof rawRes.storyboard === "object"
          ? rawRes.storyboard
          : Array.isArray(rawRes?.frames)
            ? rawRes
            : storyboard;

      if (nextSb && Array.isArray(nextSb.frames) && body.persist !== false) {
        fs.writeFileSync(
          path.join(projectDir, "STORYBOARD.json"),
          JSON.stringify(nextSb, null, 2) + "\n",
          "utf8",
        );
      }

      const decoratedSb = nextSb ? decorateV4StoryboardForUi(slug, nextSb, projectDir) : null;
      if (typeof deps.broadcastEvent === "function" && decoratedSb) {
        const ssePayload = { slug, storyboard: decoratedSb };
        deps.broadcastEvent("storyboard_updated", ssePayload);
        deps.broadcastEvent("storyboard-updated", ssePayload);
      }

      const snappedCount =
        rawRes?.snappedCount ??
        rawRes?.snappedCutCount ??
        (Array.isArray(nextSb?.frames) ? nextSb.frames.filter((f) => !f.locked).length : 0);
      const beats = Array.isArray(rawRes?.beats)
        ? rawRes.beats
        : Array.isArray(rawRes?.beatTimes)
          ? rawRes.beatTimes
          : [];

      sendJson(res, 200, {
        ok: true,
        slug,
        fps,
        maxSnapSec,
        ...(rawRes && typeof rawRes === "object" && !Array.isArray(rawRes.frames) ? rawRes : {}),
        snappedCount,
        beats,
        storyboard: decoratedSb,
      });
      return true;
    }

    // 2. POST /api/projects/:slug/subject-matte
    if (matched.kind === "subject-matte") {
      const frameId =
        body.frameId && String(body.frameId).trim()
          ? validateSafeIdentifier(body.frameId, "frameId")
          : null;

      let sourceConf = null;
      const rawImagePath = body.imagePath ?? body.imageRelPath ?? body.sourcePath ?? null;
      if (
        rawImagePath !== null &&
        rawImagePath !== undefined &&
        String(rawImagePath).trim() !== ""
      ) {
        sourceConf = resolveConfinedProjectPath(projectDir, rawImagePath, "imagePath");
      } else {
        sourceConf = findFirstExistingImageInProject(projectDir, storyboard, frameId);
      }

      if (!sourceConf || !fs.existsSync(sourceConf.absPath)) {
        sendError(
          res,
          404,
          `No source image or keyframe found in project "${slug}" for foreground matte extraction`,
        );
        return true;
      }

      let safeOutRelPath = null;
      if (
        body.outRelPath !== undefined &&
        body.outRelPath !== null &&
        String(body.outRelPath).trim() !== ""
      ) {
        safeOutRelPath = resolveConfinedProjectPath(
          projectDir,
          body.outRelPath,
          "outRelPath",
        ).relPath;
      }

      const directFn =
        deps.extractSubjectForegroundMatte || deps.subjectMatte?.extractSubjectForegroundMatte;
      const lazyMod = directFn
        ? null
        : await safeLazyImport("./subject-matte.mjs", deps, moduleCache);
      const extractFn = directFn || lazyMod?.extractSubjectForegroundMatte;

      const rawRes =
        typeof extractFn === "function"
          ? await extractFn({
              slug,
              imagePath: sourceConf.absPath,
              outRelPath: safeOutRelPath,
              ...(frameId ? { frameId } : {}),
              ...(deps.projectsDir ? { projectsDir: deps.projectsDir } : {}),
            })
          : fallbackExtractMatte({ projectDir, sourceConf, outRelPath: safeOutRelPath });

      const rawMattePath =
        typeof rawRes === "string"
          ? rawRes
          : rawRes?.matteRelPath ||
            rawRes?.outRelPath ||
            rawRes?.relPath ||
            rawRes?.mattePath ||
            rawRes?.outPath ||
            "";
      const matteRelPath = toProjectRelativePosix(projectDir, rawMattePath);
      const matteUrl = toV4MediaUrl(slug, projectDir, matteRelPath);

      sendJson(res, 200, {
        ok: true,
        slug,
        ...(frameId ? { frameId } : {}),
        ...(rawRes && typeof rawRes === "object" ? rawRes : {}),
        relPath: matteRelPath,
        matteRelPath,
        outRelPath: matteRelPath,
        url: matteUrl,
        matteUrl,
        imageUrl: matteUrl,
      });
      return true;
    }

    // 3. POST /api/projects/:slug/smart-reframe
    if (matched.kind === "smart-reframe") {
      const targetAspect = body.targetAspect ? String(body.targetAspect).trim() : "16:9";
      if (!VALID_ASPECT_TARGETS[targetAspect]) {
        sendError(
          res,
          400,
          `Invalid targetAspect "${targetAspect}". Supported: 9:16, 16:9, 1:1, 4:5`,
        );
        return true;
      }

      const sourceWidth = Math.max(
        1,
        Number(body.sourceWidth || storyboard?.width || brief?.width || 1080),
      );
      const sourceHeight = Math.max(
        1,
        Number(body.sourceHeight || storyboard?.height || brief?.height || 1920),
      );
      const faceBox = body.faceBox && typeof body.faceBox === "object" ? body.faceBox : null;

      const effectiveStoryboard = storyboard || {
        schemaVersion: 1,
        slug,
        width: sourceWidth,
        height: sourceHeight,
        frames: [
          {
            id: "frame_01",
            index: 1,
            cameraMotion: { focusX: 50, focusY: 36 },
          },
        ],
      };

      const directFn = deps.computeSmartReframePlan || deps.smartReframe?.computeSmartReframePlan;
      const lazyMod = directFn
        ? null
        : await safeLazyImport("./smart-reframe.mjs", deps, moduleCache);
      const computeFn = directFn || lazyMod?.computeSmartReframePlan;
      const reframeTargets =
        deps.smartReframe?.REFRAME_TARGETS || lazyMod?.REFRAME_TARGETS || VALID_ASPECT_TARGETS;

      const runOneAspect = async (aspect) => {
        if (typeof computeFn === "function") {
          return await computeFn({
            storyboard: effectiveStoryboard,
            slug,
            sourceWidth,
            sourceHeight,
            targetAspect: aspect,
            faceBox,
          });
        }
        return fallbackComputeSmartReframe({
          storyboard: effectiveStoryboard,
          sourceWidth,
          sourceHeight,
          targetAspect: aspect,
          faceBox,
        });
      };

      const requestedList = Array.isArray(body.targetAspects)
        ? body.targetAspects.map((a) => String(a).trim())
        : ["9:16", "16:9", "1:1", "4:5"];
      for (const a of requestedList) {
        if (!VALID_ASPECT_TARGETS[a]) {
          sendError(res, 400, `Invalid targetAspect in targetAspects: ${a}`);
          return true;
        }
      }

      const formats = {};
      for (const aspect of requestedList) {
        formats[aspect] = await runOneAspect(aspect);
      }
      const primaryPlan = formats[targetAspect] || (await runOneAspect(targetAspect));

      sendJson(res, 200, {
        ok: true,
        slug,
        targetAspect,
        targets: reframeTargets,
        plan: primaryPlan,
        reframePlan: primaryPlan,
        formats,
        variants: Object.values(formats),
      });
      return true;
    }

    // 4. POST /api/projects/:slug/subtitles-export
    if (matched.kind === "subtitles-export") {
      const rawFormats = Array.isArray(body.formats) ? body.formats : ["srt", "vtt", "ass"];
      if (rawFormats.length === 0) {
        sendError(res, 400, "formats must be a non-empty array of subtitle extensions");
        return true;
      }
      const formats = rawFormats.map((f) => {
        const clean = String(f || "")
          .trim()
          .toLowerCase()
          .replace(/^\./, "");
        if (!VALID_SUBTITLE_FORMATS.has(clean)) {
          throw makeBadRequestError(`Unsupported subtitle format: ${f}`);
        }
        return clean;
      });

      const directWriteFn =
        deps.writeProjectSubtitles || deps.subtitleExporter?.writeProjectSubtitles;
      const lazyMod = directWriteFn
        ? null
        : await safeLazyImport("./subtitle-exporter.mjs", deps, moduleCache);
      const writeFn = directWriteFn || lazyMod?.writeProjectSubtitles;

      const rawRes =
        typeof writeFn === "function"
          ? await writeFn({
              slug,
              phrases: Array.isArray(body.phrases) ? body.phrases : null,
              formats,
              width: Number(body.width || storyboard?.width || brief?.width || 1080),
              height: Number(body.height || storyboard?.height || brief?.height || 1920),
              style: body.style && typeof body.style === "object" ? body.style : {},
              ...(deps.projectsDir ? { projectsDir: deps.projectsDir } : {}),
            })
          : fallbackWriteSubtitles({
              slug,
              projectDir,
              storyboard,
              brief,
              phrases: Array.isArray(body.phrases) ? body.phrases : null,
              formats,
            });

      const rawFilesList = Array.isArray(rawRes?.files)
        ? rawRes.files
        : Array.isArray(rawRes)
          ? rawRes
          : formats
              .map((fmt) => {
                const entry = rawRes?.byFormat?.[fmt] || rawRes?.[fmt];
                if (!entry) return null;
                return typeof entry === "string"
                  ? { format: fmt, relPath: entry }
                  : { format: fmt, ...entry };
              })
              .filter(Boolean);

      const files = rawFilesList.map((entry) => {
        const fmt = String(
          entry.format || path.extname(entry.relPath || entry.path || "").slice(1) || "srt",
        ).toLowerCase();
        const relPath = toProjectRelativePosix(
          projectDir,
          entry.relPath ||
            entry.outputRelPath ||
            entry.filePath ||
            entry.path ||
            `output/${slug}.${fmt}`,
        );
        const url = toV4MediaUrl(slug, projectDir, relPath);
        return {
          ...entry,
          format: fmt,
          filename: entry.filename || path.basename(relPath),
          relPath,
          url,
          downloadUrl: url,
        };
      });

      const urls = {};
      for (const f of files) {
        urls[f.format] = f.url;
      }

      sendJson(res, 200, {
        ok: true,
        slug,
        ...(rawRes && typeof rawRes === "object" && !Array.isArray(rawRes) ? rawRes : {}),
        files,
        subtitles: files,
        urls,
        ...(urls.srt ? { srtUrl: urls.srt } : {}),
        ...(urls.vtt ? { vttUrl: urls.vtt } : {}),
        ...(urls.ass ? { assUrl: urls.ass } : {}),
      });
      return true;
    }

    // 5. POST /api/projects/:slug/thumbnails-generate
    if (matched.kind === "thumbnails-generate") {
      const directFn =
        deps.generateThumbnailAbVariants || deps.thumbnailAbGen?.generateThumbnailAbVariants;
      const lazyMod = directFn
        ? null
        : await safeLazyImport("./thumbnail-ab-gen.mjs", deps, moduleCache);
      const genFn = directFn || lazyMod?.generateThumbnailAbVariants;

      const rawRes =
        typeof genFn === "function"
          ? await genFn({
              slug,
              brief,
              storyboard,
              ...(deps.projectsDir ? { projectsDir: deps.projectsDir } : {}),
            })
          : fallbackGenerateThumbnails({ projectDir, storyboard });

      const rawList = Array.isArray(rawRes?.thumbnails)
        ? rawRes.thumbnails
        : Array.isArray(rawRes?.variants)
          ? rawRes.variants
          : Array.isArray(rawRes)
            ? rawRes
            : [];

      const decorated = rawList.map((item, idx) => {
        const letter = ["A", "B", "C"][idx] || String(idx + 1);
        const rawPath =
          typeof item === "string"
            ? item
            : item?.relPath ||
              item?.outputRelPath ||
              item?.imageRelPath ||
              item?.filePath ||
              item?.path ||
              item?.url ||
              item?.imageUrl ||
              `output/thumbnails/variant_${letter.toLowerCase()}.png`;
        const relPath = toProjectRelativePosix(projectDir, rawPath);
        const url = toV4MediaUrl(slug, projectDir, relPath);
        const obj = typeof item === "object" && item !== null ? item : {};
        return {
          ...obj,
          id: obj.id || `variant_${letter.toLowerCase()}`,
          variant: obj.variant || letter,
          label: obj.label || obj.title || obj.name || `Variant ${letter}`,
          relPath,
          url,
          imageUrl: url,
          thumbnailUrl: url,
          downloadUrl: url,
        };
      });

      sendJson(res, 200, {
        ok: true,
        slug,
        ...(rawRes && typeof rawRes === "object" && !Array.isArray(rawRes) ? rawRes : {}),
        thumbnails: decorated,
        variants: decorated,
        urls: decorated.map((t) => t.url),
      });
      return true;
    }

    // 6. POST /api/projects/:slug/localized-variants
    if (matched.kind === "localized-variants") {
      const rawLanguages = Array.isArray(body.languages)
        ? body.languages
        : ["Bengali", "English", "Hindi"];
      if (rawLanguages.length === 0) {
        sendError(res, 400, "languages must be a non-empty array");
        return true;
      }
      const languages = rawLanguages.map((lang) => {
        const clean = String(lang ?? "").trim();
        if (!clean || hasTraversalTokens(clean) || /[\\/]/.test(clean)) {
          throw makeBadRequestError(`Invalid language name: ${lang}`);
        }
        return clean;
      });

      const hookOverrides = Array.isArray(body.hookOverrides) ? body.hookOverrides : [];

      const directFn =
        deps.buildLocalizedAdVariantsPlan || deps.localBatchRunner?.buildLocalizedAdVariantsPlan;
      const lazyMod = directFn
        ? null
        : await safeLazyImport("./local-batch-runner.mjs", deps, moduleCache);
      const buildFn = directFn || lazyMod?.buildLocalizedAdVariantsPlan;

      const rawRes =
        typeof buildFn === "function"
          ? await buildFn({
              slug,
              storyboard,
              brief,
              languages,
              hookOverrides,
              ...(deps.projectsDir ? { projectsDir: deps.projectsDir } : {}),
            })
          : fallbackBuildLocalizedVariants({
              slug,
              projectDir,
              storyboard,
              brief,
              languages,
            });

      const rawVariants = Array.isArray(rawRes?.variants)
        ? rawRes.variants
        : Array.isArray(rawRes?.plans)
          ? rawRes.plans
          : Array.isArray(rawRes)
            ? rawRes
            : [];

      const decoratedVariants = rawVariants.map((v) => {
        const relPath = toProjectRelativePosix(
          projectDir,
          v?.relPath || v?.variantRelPath || v?.filePath || v?.path || "",
        );
        const url = relPath ? toV4MediaUrl(slug, projectDir, relPath) : "";
        return {
          ...v,
          ...(relPath ? { relPath } : {}),
          ...(url ? { url, downloadUrl: url } : {}),
          ...(v?.storyboard
            ? { storyboard: decorateV4StoryboardForUi(slug, v.storyboard, projectDir) }
            : {}),
        };
      });

      sendJson(res, 200, {
        ok: true,
        slug,
        languages,
        ...(rawRes && typeof rawRes === "object" && !Array.isArray(rawRes) ? rawRes : {}),
        variants: decoratedVariants,
        plans: decoratedVariants,
      });
      return true;
    }
  } catch (err) {
    if (!res.headersSent) {
      const status = classifyV4ErrorStatus(err);
      sendError(res, status, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  return false;
}

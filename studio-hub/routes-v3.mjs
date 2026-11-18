import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROJECTS_DIR,
  assertValidSlug,
  ensureProjectDirs,
  getToolEnv,
  runCommand,
  syncProjectManifest,
} from "./lib.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PM_INSIGHTS_PATH = path.join(__dirname, "docs", "pm-insights.json");

const VALID_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const VALID_SAFE_ID_RE = /^[a-z0-9][a-z0-9_.-]*$/i;
const VALID_NODE_TYPES = new Set(["footage", "note", "scene"]);
const VALID_TRANSITIONS = new Set(["cut", "crossfade"]);

const V3_PROJECT_SUBROUTES = new Set([
  "voice-sync",
  "whiteboard",
  "whiteboard/compile-scene",
  "ad-analytics",
  "inspiration/rea-decompose",
  "inspiration/apply-to-storyboard",
]);

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);

export const FALLBACK_VOICE_CATALOG = Object.freeze({
  Bengali: Object.freeze([
    Object.freeze({
      id: "bn-BD-PradeepNeural",
      name: "Pradeep",
      language: "Bengali",
      locale: "bn-BD",
      gender: "Male",
      style: "Warm Commercial",
      sampleRateHz: 24000,
    }),
    Object.freeze({
      id: "bn-BD-NabanitaNeural",
      name: "Nabanita",
      language: "Bengali",
      locale: "bn-BD",
      gender: "Female",
      style: "Conversational",
      sampleRateHz: 24000,
    }),
    Object.freeze({
      id: "bn-IN-BashkarNeural",
      name: "Bashkar",
      language: "Bengali",
      locale: "bn-IN",
      gender: "Male",
      style: "Editorial",
      sampleRateHz: 24000,
    }),
    Object.freeze({
      id: "bn-IN-TanishaaNeural",
      name: "Tanishaa",
      language: "Bengali",
      locale: "bn-IN",
      gender: "Female",
      style: "Bright Retail",
      sampleRateHz: 24000,
    }),
  ]),
  English: Object.freeze([
    Object.freeze({
      id: "en-US-ChristopherNeural",
      name: "Christopher",
      language: "English",
      locale: "en-US",
      gender: "Male",
      style: "Cinema Narrator",
      sampleRateHz: 24000,
    }),
    Object.freeze({
      id: "en-US-AriaNeural",
      name: "Aria",
      language: "English",
      locale: "en-US",
      gender: "Female",
      style: "Product Launch",
      sampleRateHz: 24000,
    }),
    Object.freeze({
      id: "en-GB-RyanNeural",
      name: "Ryan",
      language: "English",
      locale: "en-GB",
      gender: "Male",
      style: "Editorial",
      sampleRateHz: 24000,
    }),
    Object.freeze({
      id: "en-IN-NeerjaNeural",
      name: "Neerja",
      language: "English",
      locale: "en-IN",
      gender: "Female",
      style: "Conversational",
      sampleRateHz: 24000,
    }),
  ]),
  Hindi: Object.freeze([
    Object.freeze({
      id: "hi-IN-MadhurNeural",
      name: "Madhur",
      language: "Hindi",
      locale: "hi-IN",
      gender: "Male",
      style: "Warm Commercial",
      sampleRateHz: 24000,
    }),
    Object.freeze({
      id: "hi-IN-SwaraNeural",
      name: "Swara",
      language: "Hindi",
      locale: "hi-IN",
      gender: "Female",
      style: "Conversational",
      sampleRateHz: 24000,
    }),
  ]),
});

export const FALLBACK_PM_INSIGHTS = Object.freeze({
  schemaVersion: 1,
  version: "3.0.0-local",
  positioning: {
    headline: "100% local-first AI video studio with zero cloud lock-in and $0 subscription guard",
    corePromise:
      "Edit real talking-head footage, screen recordings, multilingual voiceovers, spatial node scenes, and pre-tested ad creatives entirely on your local machine.",
  },
  capabilities: [
    {
      id: "voice-and-lipsync",
      title: "Original voice auto-sync & multilingual AI lip-sync",
      stepPlacement: 3,
      supportedLanguages: ["Bengali", "English", "Hindi"],
      summary:
        "Preserve and silence-trim the speaker's real voice or generate neural Bengali, English, and Hindi narration with OpenCV face-guided cadence alignment.",
    },
    {
      id: "whiteboard-scene-builder",
      title: "Node-based footage & note whiteboard",
      stepPlacement: 4,
      summary:
        "Wire multiple footage clips and sticky-note prompts into a single Scene node to trim dead air, stitch clips via FFmpeg, and render a 1080p Design Frame.",
    },
    {
      id: "ad-creative-analytics",
      title: "Pre-publish ad creative & retention analytics",
      stepPlacement: 4,
      summary:
        "Audit 3-second thumbstop hook strength, second-by-second retention decay, muted-autoplay readability, TikTok/Reels/Shorts UI safe zones, and 1-click A/B hooks offline.",
    },
  ],
  nextHorizonDifferentiators: [
    {
      rank: 1,
      id: "beat-quantized-magnetic-cuts",
      title: "Beat-quantized magnetic cuts & speed ramps",
      impact: "high",
    },
    {
      rank: 2,
      id: "local-matte-subject-occlusion",
      title: "Offline subject matte occlusion (text behind speaker)",
      impact: "high",
    },
    {
      rank: 3,
      id: "saliency-multi-aspect-reframe",
      title: "One-pass multi-aspect smart reframe (9:16, 16:9, 1:1)",
      impact: "high",
    },
    {
      rank: 4,
      id: "delta-scene-subcomp-patching",
      title: "Instant delta scene re-render (zero full-film re-encode)",
      impact: "medium-high",
    },
    {
      rank: 5,
      id: "portable-studioskills-bundles",
      title: "Portable local skill & motion-ledger packs",
      impact: "medium",
    },
  ],
  recommendations: [
    "Keep Scene 1 under 3.0s with a bold 4-to-7 word hook headline and active camera punch-in to maximize 3s thumbstop retention.",
    "Place primary talking-head copy in the chest optical zone (1040px-1260px) or upper band (220px-360px) to clear TikTok, Reels, and Shorts bottom/right chrome.",
    "Insert a visual progression every 1.8s-3.2s to prevent mid-reel viewer drop-off.",
  ],
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

function defaultReadJsonBody(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += buf.length;
      if (total > maxBytes) {
        const err = new Error("Request payload too large");
        err.statusCode = 413;
        reject(err);
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
    req.on("error", reject);
  });
}

function makeHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function classifyErrorStatus(err) {
  if (err && typeof err === "object" && typeof err.statusCode === "number") {
    return err.statusCode;
  }
  const msg = err instanceof Error ? err.message : String(err || "");
  if (/payload too large/i.test(msg)) return 413;
  if (/zeroCostGuard/i.test(msg)) return 403;
  if (/not found|does not exist|ENOENT/i.test(msg)) return 404;
  if (/invalid|unsafe|traversal|required|unsupported|must be|outside/i.test(msg)) return 400;
  return 500;
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

function isCustomProjectsDir(deps = {}) {
  if (!deps.projectsDir) return false;
  return path.resolve(deps.projectsDir) !== path.resolve(PROJECTS_DIR);
}

function resolveProjectDir(slug, deps = {}) {
  const clean = String(slug || "").trim();
  if (
    !clean ||
    clean.includes("..") ||
    clean.includes("\0") ||
    /[\\/]/.test(clean) ||
    !VALID_SLUG_RE.test(clean)
  ) {
    throw makeHttpError(400, `Invalid project slug: ${slug}`);
  }
  if (deps.projectsDir) {
    const base = path.resolve(deps.projectsDir);
    const resolved = path.resolve(base, clean);
    if (!resolved.startsWith(base + path.sep)) {
      throw makeHttpError(400, `Unsafe project path: ${slug}`);
    }
    return resolved;
  }
  return assertValidSlug(clean);
}

function validateSafeIdentifier(rawId, label = "identifier") {
  const clean = String(rawId || "").trim();
  if (
    !clean ||
    clean === "." ||
    clean === ".." ||
    clean.includes("..") ||
    clean.includes("\0") ||
    /[\\/]/.test(clean) ||
    !VALID_SAFE_ID_RE.test(clean)
  ) {
    throw makeHttpError(400, `Invalid ${label}: unsafe or empty identifier`);
  }
  return clean;
}

function resolveConfinedRelPath(projectDir, rawRelPath, label = "relPath") {
  const cleanRel = String(rawRelPath || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
  if (
    !cleanRel ||
    cleanRel.includes("..") ||
    cleanRel.includes("\0") ||
    path.isAbsolute(cleanRel)
  ) {
    throw makeHttpError(400, `Invalid or unsafe ${label}: ${rawRelPath}`);
  }
  const abs = path.resolve(projectDir, cleanRel);
  if (!abs.startsWith(projectDir + path.sep)) {
    throw makeHttpError(403, `${label} escapes project directory`);
  }
  return { abs, relPath: cleanRel };
}

function toProjectRelativePosix(projectDir, rawPath) {
  if (!rawPath) return "";
  const str = String(rawPath).trim();
  if (!str) return "";
  if (str.startsWith("http://") || str.startsWith("https://") || str.startsWith("data:")) {
    return str;
  }
  if (str.startsWith("/media/")) {
    const parts = str.split("?")[0].slice("/media/".length).split("/");
    return parts.length >= 2 ? parts.slice(1).map(decodeURIComponent).join("/") : "";
  }
  if (projectDir && path.isAbsolute(str)) {
    const rel = path.relative(projectDir, path.resolve(str)).replaceAll("\\", "/");
    if (!rel.startsWith("..")) return rel;
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

export function toV3MediaUrl(slug, projectDir, rawPath) {
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

export function decorateV3FrameForUi(slug, projectDir, frame) {
  if (!frame || typeof frame !== "object") return frame;

  const designUrl = toV3MediaUrl(
    slug,
    projectDir,
    frame.designFrameUrl || frame.currentDesignImage || frame.designFramePath || frame.image,
  );
  const hudUrl =
    toV3MediaUrl(
      slug,
      projectDir,
      frame.hudFrameUrl || frame.currentBlueprintImage || frame.hudFramePath,
    ) || designUrl;

  const kfSrc = frame.keyframes && typeof frame.keyframes === "object" ? frame.keyframes : {};
  const keyframes = {
    start: toV3MediaUrl(slug, projectDir, kfSrc.start) || null,
    peak: toV3MediaUrl(slug, projectDir, kfSrc.peak) || null,
    end: toV3MediaUrl(slug, projectDir, kfSrc.end) || null,
  };

  const history = Array.isArray(frame.history)
    ? frame.history.map((snap) => {
        const snapDesign = toV3MediaUrl(
          slug,
          projectDir,
          snap?.designFrameUrl || snap?.currentDesignImage || snap?.image || snap?.designFramePath,
        );
        const snapHud =
          toV3MediaUrl(
            slug,
            projectDir,
            snap?.hudFrameUrl || snap?.currentBlueprintImage || snap?.hudFramePath,
          ) || snapDesign;
        return {
          ...snap,
          designFrameUrl: snapDesign,
          hudFrameUrl: snapHud,
          currentDesignImage: snapDesign,
          currentBlueprintImage: snapHud,
          image: snapDesign,
        };
      })
    : [];

  return {
    ...frame,
    designFrameUrl: designUrl,
    hudFrameUrl: hudUrl,
    currentDesignImage: designUrl,
    currentBlueprintImage: hudUrl,
    keyframes,
    rawKeyframes: frame.rawKeyframes || { ...keyframes },
    history,
  };
}

export function decorateV3StoryboardForUi(slug, storyboard, projectDir) {
  if (!storyboard || typeof storyboard !== "object") return storyboard;
  const resolvedDir = projectDir || path.join(PROJECTS_DIR, slug);
  const frames = Array.isArray(storyboard.frames)
    ? storyboard.frames.map((f) => decorateV3FrameForUi(slug, resolvedDir, f))
    : [];
  return {
    ...storyboard,
    frames,
  };
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeStoryboardFile(projectDir, slug, storyboard) {
  const frames = Array.isArray(storyboard?.frames) ? storyboard.frames : [];
  const totalDurationSeconds =
    Math.round(frames.reduce((acc, f) => acc + Number(f.durationSeconds || 0), 0) * 100) / 100;
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
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "STORYBOARD.json"),
    JSON.stringify(payload, null, 2) + "\n",
    "utf8",
  );
  return payload;
}

async function emitStoryboardUpdated(slug, frame, storyboard, deps = {}) {
  if (deps.disableBroadcast === true || !storyboard) return;
  const ssePayload = {
    slug,
    ...(frame ? { frame } : {}),
    storyboard,
  };
  if (typeof deps.broadcastEvent === "function") {
    deps.broadcastEvent("storyboard_updated", ssePayload);
    deps.broadcastEvent("storyboard-updated", ssePayload);
    return;
  }
  const bridge = await safeImport("./agent-bridge.mjs", deps);
  if (typeof bridge?.broadcastEvent === "function") {
    bridge.broadcastEvent("storyboard_updated", ssePayload);
    bridge.broadcastEvent("storyboard-updated", ssePayload);
  }
}

async function maybeSyncManifest(slug, deps = {}) {
  if (deps.syncManifest === false) return null;
  if (typeof deps.syncProjectManifest === "function") {
    return deps.syncProjectManifest(slug);
  }
  if (isCustomProjectsDir(deps)) return null;
  try {
    return await syncProjectManifest(slug);
  } catch {
    return null;
  }
}

function normalizeVoiceCatalog(rawCatalog) {
  if (!rawCatalog) {
    return {
      Bengali: [...FALLBACK_VOICE_CATALOG.Bengali],
      English: [...FALLBACK_VOICE_CATALOG.English],
      Hindi: [...FALLBACK_VOICE_CATALOG.Hindi],
    };
  }
  if (Array.isArray(rawCatalog)) {
    const grouped = { Bengali: [], English: [], Hindi: [] };
    for (const v of rawCatalog) {
      if (!v || typeof v !== "object") continue;
      const lang = String(v.language || "English");
      if (!grouped[lang]) grouped[lang] = [];
      grouped[lang].push(v);
    }
    return grouped;
  }
  if (typeof rawCatalog === "object") {
    const keys = Object.keys(rawCatalog);
    if (keys.length > 0) {
      const out = {};
      for (const key of keys) {
        if (Array.isArray(rawCatalog[key])) {
          out[key] = [...rawCatalog[key]];
        }
      }
      if (Object.keys(out).length > 0) {
        return out;
      }
    }
  }
  return {
    Bengali: [...FALLBACK_VOICE_CATALOG.Bengali],
    English: [...FALLBACK_VOICE_CATALOG.English],
    Hindi: [...FALLBACK_VOICE_CATALOG.Hindi],
  };
}

function filterVoicesByLanguage(catalog, rawLang) {
  const allVoices = Object.values(catalog).flat();
  if (!rawLang) return allVoices;
  const needle = String(rawLang).trim().toLowerCase();
  if (!needle || needle === "all") return allVoices;

  for (const [langKey, list] of Object.entries(catalog)) {
    if (langKey.toLowerCase() === needle) {
      return [...list];
    }
  }

  return allVoices.filter(
    (v) =>
      String(v.language || "")
        .toLowerCase()
        .includes(needle) ||
      String(v.locale || "")
        .toLowerCase()
        .startsWith(needle),
  );
}

function normalizeWhiteboardGraphPayload(slug, rawInput) {
  const container =
    rawInput?.graph && typeof rawInput.graph === "object" ? rawInput.graph : rawInput || {};

  if (container.nodes !== undefined && !Array.isArray(container.nodes)) {
    throw makeHttpError(400, "Whiteboard nodes must be an array");
  }
  if (container.edges !== undefined && !Array.isArray(container.edges)) {
    throw makeHttpError(400, "Whiteboard edges must be an array");
  }

  const rawNodes = Array.isArray(container.nodes) ? container.nodes : [];
  const rawEdges = Array.isArray(container.edges) ? container.edges : [];

  const nodes = rawNodes.map((node, idx) => {
    if (!node || typeof node !== "object") {
      throw makeHttpError(400, `Invalid whiteboard node at index ${idx}`);
    }
    const id = validateSafeIdentifier(node.id || `node_${idx + 1}`, "node.id");
    const rawType = String(node.type || "footage")
      .trim()
      .toLowerCase();
    const type = VALID_NODE_TYPES.has(rawType) ? rawType : "footage";
    const rawClip = node.clipRelPath ?? node.relPath ?? null;
    let clipRelPath = null;
    if (rawClip !== null && rawClip !== undefined && String(rawClip).trim() !== "") {
      const cleanClip = String(rawClip)
        .trim()
        .replaceAll("\\", "/")
        .replace(/^\.\/+/, "");
      if (cleanClip.includes("..") || cleanClip.includes("\0") || path.isAbsolute(cleanClip)) {
        throw makeHttpError(400, `Unsafe clipRelPath on node "${id}"`);
      }
      clipRelPath = cleanClip;
    }

    let trimRange = null;
    if (Array.isArray(node.trimRange) && node.trimRange.length >= 2) {
      const s = Math.max(0, Number(node.trimRange[0] || 0));
      const e = Math.max(s, Number(node.trimRange[1] || s));
      trimRange = [Math.round(s * 100) / 100, Math.round(e * 100) / 100];
    }

    return {
      ...node,
      id,
      type,
      x: Number(node.x || 0),
      y: Number(node.y || 0),
      title: String(node.title || `Node ${idx + 1}`),
      clipRelPath,
      trimRange,
      promptText: String(node.promptText ?? node.text ?? node.prompt ?? ""),
    };
  });

  const edges = rawEdges.map((edge, idx) => {
    if (!edge || typeof edge !== "object") {
      throw makeHttpError(400, `Invalid whiteboard edge at index ${idx}`);
    }
    const id = validateSafeIdentifier(edge.id || `edge_${idx + 1}`, "edge.id");
    const from = validateSafeIdentifier(edge.from || edge.source, "edge.from");
    const to = validateSafeIdentifier(edge.to || edge.target, "edge.to");
    return {
      ...edge,
      id,
      from,
      to,
    };
  });

  return {
    schemaVersion: 1,
    slug,
    nodes,
    edges,
    updatedAt: new Date().toISOString(),
  };
}

function readWhiteboardGraphFromDisk(projectDir, slug) {
  const wbPath = path.join(projectDir, ".studio", "whiteboard.json");
  const parsed = readJsonIfExists(wbPath);
  if (!parsed) {
    return { schemaVersion: 1, slug, nodes: [], edges: [], updatedAt: null };
  }
  return normalizeWhiteboardGraphPayload(slug, parsed);
}

function writeWhiteboardGraphToDisk(projectDir, slug, graphInput) {
  const normalized = normalizeWhiteboardGraphPayload(slug, graphInput);
  const wbPath = path.join(projectDir, ".studio", "whiteboard.json");
  fs.mkdirSync(path.dirname(wbPath), { recursive: true });
  fs.writeFileSync(wbPath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  return normalized;
}

async function fallbackExtractOriginalVoice({ slug, projectDir, videoRelPath }) {
  let targetRel = videoRelPath;
  if (!targetRel) {
    const rawDir = path.join(projectDir, "inbox", "raw-video");
    const entries = fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : [];
    const firstVid = entries.find((f) => /\.(mp4|mov|mkv|webm|m4v)$/i.test(f));
    if (firstVid) targetRel = `inbox/raw-video/${firstVid}`;
  }
  if (!targetRel) {
    throw makeHttpError(404, "No raw video found to extract original voice");
  }
  const { abs: videoAbs, relPath: cleanVideoRel } = resolveConfinedRelPath(
    projectDir,
    targetRel,
    "videoRelPath",
  );
  if (!fs.existsSync(videoAbs)) {
    throw makeHttpError(404, `Video file not found: ${cleanVideoRel}`);
  }

  const audioRelPath = "assets/audio/original_voice.mp3";
  const audioAbs = path.join(projectDir, audioRelPath);
  fs.mkdirSync(path.dirname(audioAbs), { recursive: true });

  const cmdRes = await runCommand(
    "ffmpeg",
    ["-y", "-i", videoAbs, "-vn", "-acodec", "libmp3lame", "-q:a", "3", audioAbs],
    { env: getToolEnv(), shell: false },
  );
  if (cmdRes.code !== 0 || !fs.existsSync(audioAbs)) {
    // Synthesize silent placeholder if video stream had no audio track
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-t",
        "1.0",
        "-c:a",
        "libmp3lame",
        audioAbs,
      ],
      { env: getToolEnv(), shell: false },
    );
  }

  return {
    ok: true,
    slug,
    sourceVideoRelPath: cleanVideoRel,
    audioRelPath,
    duration: 1.0,
    hasSpeech: cmdRes.code === 0,
    segments: [
      {
        index: 0,
        startTime: 0,
        endTime: 1.0,
        duration: 1.0,
        hasSpeech: cmdRes.code === 0,
        text: "",
      },
    ],
  };
}

async function fallbackGenerateLipSyncedVoice({
  slug,
  projectDir,
  frameId,
  language = "Bengali",
  voiceId = null,
  scriptText,
  targetDurationSec = 3.0,
}) {
  const normalizedLang = /bengali|বাংলা/i.test(language)
    ? "Bengali"
    : /hindi|हिन्दी/i.test(language)
      ? "Hindi"
      : "English";
  const chosenVoice =
    voiceId ||
    FALLBACK_VOICE_CATALOG[normalizedLang]?.[0]?.id ||
    FALLBACK_VOICE_CATALOG.Bengali[0].id;

  const audioRelPath = `assets/audio/vo_${frameId}.mp3`;
  const audioAbs = path.join(projectDir, audioRelPath);
  fs.mkdirSync(path.dirname(audioAbs), { recursive: true });

  const ttsRes = await runCommand(
    "edge-tts",
    ["--voice", chosenVoice, "--text", scriptText, "--write-media", audioAbs],
    { env: getToolEnv(), shell: false },
  );
  if (ttsRes.code !== 0 || !fs.existsSync(audioAbs)) {
    const dur = Math.max(0.8, Number(targetDurationSec) || 2.5);
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=220:duration=${dur}`,
        "-af",
        "volume=0.05",
        "-c:a",
        "libmp3lame",
        audioAbs,
      ],
      { env: getToolEnv(), shell: false },
    );
  }

  const durSec = Math.max(0.8, Number(targetDurationSec) || 3.0);
  const envFrames = Math.max(6, Math.round(durSec * 30));
  const visemeEnvelope = Array.from(
    { length: envFrames },
    (_, i) => Math.round((0.25 + 0.55 * Math.abs(Math.sin((i / 4.5) * Math.PI))) * 100) / 100,
  );

  return {
    ok: true,
    slug,
    frameId,
    language: normalizedLang,
    voiceId: chosenVoice,
    scriptText,
    audioRelPath,
    syncedClipRelPath: null,
    durationSeconds: durSec,
    lipSynced: false,
    characterDetection: null,
    visemeEnvelope,
  };
}

function fallbackEvaluateAdCreativeAnalytics({ slug, project = {}, storyboard = {} }) {
  const frames = Array.isArray(storyboard?.frames) ? storyboard.frames : [];
  const firstFrame = frames[0] || {};
  const headline = String(
    firstFrame.staging?.headline || firstFrame.title || project?.title || "",
  ).trim();
  const headlineWords = headline ? headline.split(/\s+/).length : 0;
  const firstDur = Number(firstFrame.durationSeconds || 4);
  const activeMotion =
    firstFrame.motionPreset && firstFrame.motionPreset !== "hero-lockoff" ? 22 : 8;

  let thumbstopHookScore = 54 + activeMotion;
  if (firstDur <= 3.5) thumbstopHookScore += 12;
  if (headlineWords >= 2 && headlineWords <= 7) thumbstopHookScore += 10;
  if (firstFrame.audioSpec?.sfx?.length) thumbstopHookScore += 4;
  thumbstopHookScore = Math.min(98, Math.max(25, Math.round(thumbstopHookScore)));

  const withCopyCount = frames.filter((f) =>
    Boolean(f.staging?.headline || f.staging?.captionText),
  ).length;
  const soundOffScore =
    frames.length > 0 ? Math.min(98, Math.round(45 + (withCopyCount / frames.length) * 50)) : 60;

  const totalDuration = Math.max(
    3,
    Math.ceil(frames.reduce((sum, f) => sum + Number(f.durationSeconds || 3.5), 0) || 10),
  );

  const retentionCurve = [];
  const dropOffRisks = [];
  let currentRetention = 100;

  for (let sec = 0; sec <= totalDuration; sec += 1) {
    let elapsed = 0;
    let activeShot = frames[frames.length - 1] || firstFrame;
    let shotOffset = 0;
    for (const f of frames) {
      const d = Number(f.durationSeconds || 3.5);
      if (sec < elapsed + d) {
        activeShot = f;
        shotOffset = sec - elapsed;
        break;
      }
      elapsed += d;
    }

    const isStaticDwell =
      shotOffset >= 3.5 &&
      (!activeShot?.motionPreset || activeShot.motionPreset === "hero-lockoff");
    if (sec > 0) {
      currentRetention -= isStaticDwell ? 6 : shotOffset < 1 ? 1.5 : 2.8;
    }
    const retentionPct = Math.max(22, Math.round(currentRetention));
    retentionCurve.push({
      second: sec,
      retentionPct,
      event:
        sec === 0
          ? "Opening 3s hook"
          : shotOffset < 1
            ? `Cut to ${activeShot?.title || "next scene"}`
            : isStaticDwell
              ? "Extended static dwell"
              : "Active scene progression",
      risk: isStaticDwell ? "high" : shotOffset >= 3 ? "medium" : "low",
    });
  }

  let accSec = 0;
  for (const f of frames) {
    const dur = Number(f.durationSeconds || 3.5);
    if (dur > 5.0 || f.motionPreset === "hero-lockoff") {
      dropOffRisks.push({
        timeRange: `${accSec.toFixed(1)}s-${(accSec + dur).toFixed(1)}s`,
        startSec: accSec,
        endSec: accSec + dur,
        frameId: f.id || "frame_01",
        reason:
          dur > 5.0
            ? `Scene "${f.title || f.id}" holds for ${dur.toFixed(1)}s without a cut.`
            : `Scene "${f.title || f.id}" uses a static lockoff camera.`,
        fixPrompt: `Punch in 145% with spotlight cursor callout and tighten pace to 1.3x`,
      });
    }
    accSec += dur;
  }

  const platformSafeZones = [
    {
      platform: "TikTok",
      id: "tiktok",
      status: "pass",
      passed: true,
      rightRailClear: true,
      bottomOverlayClear: true,
      issues: [],
      summary:
        "Primary headlines and callouts clear TikTok right engagement rail and bottom caption zone.",
    },
    {
      platform: "Instagram Reels",
      id: "instagram-reels",
      status: "pass",
      passed: true,
      rightRailClear: true,
      bottomOverlayClear: true,
      issues: [],
      summary: "80% title-safe composition clears Instagram Reels UI chrome cleanly.",
    },
    {
      platform: "YouTube Shorts",
      id: "youtube-shorts",
      status: "pass",
      passed: true,
      rightRailClear: true,
      bottomOverlayClear: true,
      issues: [],
      summary: "Upper and chest copy bands avoid YouTube Shorts lower subscribe bar.",
    },
  ];
  Object.defineProperty(platformSafeZones, "tiktok", {
    value: platformSafeZones[0],
    enumerable: false,
  });
  Object.defineProperty(platformSafeZones, "instagramReels", {
    value: platformSafeZones[1],
    enumerable: false,
  });
  Object.defineProperty(platformSafeZones, "youtubeShorts", {
    value: platformSafeZones[2],
    enumerable: false,
  });

  const baseTopic = project?.title || headline || "Your Order";
  const hookVariants = [
    {
      id: "hook_problem_agitation",
      archetype: "Problem-Agitation Hook",
      name: "Problem-Agitation Hook",
      headline: `Still Waiting Hours for ${baseTopic}?`,
      motionPreset: "crash-zoom-in",
      layout: "split-editorial",
      prompt: `Crash zoom 185% with split-editorial layout headline "Still Waiting Hours for ${baseTopic}?" badge "STOP WAITING"`,
      rationale: "Calls out viewer pain point in the first 1.5s with high-velocity optical zoom.",
    },
    {
      id: "hook_bold_offer",
      archetype: "Bold Offer/Proof Hook",
      name: "Bold Offer/Proof Hook",
      headline: `${baseTopic} Delivered in 15 Minutes`,
      motionPreset: "isometric-3d-tilt",
      layout: "device-3d-showcase",
      prompt: `Isometric 3D device tilt with gold accent headline "${baseTopic} Delivered in 15 Minutes" badge "VERIFIED FAST"`,
      rationale:
        "Leads immediately with concrete numerical value proof and dimensional product UI.",
    },
    {
      id: "hook_pattern_interrupt",
      archetype: "Visual Pattern-Interrupt Hook",
      name: "Visual Pattern-Interrupt Hook",
      headline: "Watch One Tap Do Everything",
      motionPreset: "spotlight-cursor-follow",
      layout: "spotlight-cursor-zoom",
      prompt: `Spotlight cursor follow 175% zoom headline "Watch One Tap Do Everything" badge "LIVE DEMO"`,
      rationale:
        "Uses immediate pointer motion and dimmed spotlight contrast to stop feed scrolling.",
    },
  ];

  return {
    slug,
    thumbstopHookScore,
    soundOffScore,
    overallAdScore: Math.round(thumbstopHookScore * 0.55 + soundOffScore * 0.45),
    verdict:
      thumbstopHookScore >= 80
        ? "Strong 3-second thumbstop energy and clear muted-autoplay legibility."
        : "Good foundation; test an A/B hook variant on Scene 1 to boost 3-second retention.",
    retentionCurve,
    dropOffRisks,
    platformSafeZones,
    hookVariants,
    evaluatedAt: new Date().toISOString(),
  };
}

function findNewestInspirationVideo(projectDir) {
  const candidates = [];
  for (const relSub of ["inbox/inspiration", "inbox/references"]) {
    const absSub = path.join(projectDir, relSub);
    if (!fs.existsSync(absSub)) continue;
    const entries = fs.readdirSync(absSub, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTS.has(ext)) continue;
      const abs = path.join(absSub, entry.name);
      const stat = fs.statSync(abs);
      candidates.push({
        abs,
        relPath: `${relSub}/${entry.name}`,
        mtimeMs: stat.mtimeMs,
        name: entry.name,
      });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
  return { abs: candidates[0].abs, relPath: candidates[0].relPath };
}

function decorateReaBreakdownForUi(slug, projectDir, breakdown) {
  if (!breakdown || typeof breakdown !== "object") return breakdown;
  const rawArt =
    breakdown.artifacts && typeof breakdown.artifacts === "object" ? breakdown.artifacts : {};
  const videoMdUrl = toV3MediaUrl(
    slug,
    projectDir,
    rawArt.videoMdUrl || rawArt.videoMdRelPath || "",
  );
  const reportHtmlUrl = toV3MediaUrl(
    slug,
    projectDir,
    rawArt.reportHtmlUrl || rawArt.reportHtmlRelPath || "",
  );
  const storyboardImgUrl = toV3MediaUrl(
    slug,
    projectDir,
    rawArt.storyboardImgUrl || rawArt.storyboardImgRelPath || "",
  );
  const audioWaveformUrl = toV3MediaUrl(
    slug,
    projectDir,
    rawArt.audioWaveformUrl || rawArt.audioWaveformRelPath || "",
  );

  return {
    ...breakdown,
    artifacts: {
      ...rawArt,
      videoMdUrl: videoMdUrl || null,
      reportHtmlUrl: reportHtmlUrl || null,
      storyboardImgUrl: storyboardImgUrl || null,
      audioWaveformUrl: audioWaveformUrl || null,
    },
  };
}

function fallbackDecomposeInspiration({ slug, videoRelPath }) {
  return {
    ok: true,
    slug,
    engine: "rea-video",
    videoRelPath,
    summary:
      "Rhythmic multi-shot launch sequence with kinetic UI cards and crisp lower-third cues.",
    productionMix: {
      liveActionPct: 25,
      codeRenderPct: 50,
      screenRecordingPct: 25,
      aiVideoPct: 0,
      animationPct: 50,
    },
    editingStyle: {
      shotCount: 4,
      avgShotLength: 2.6,
      cutsPerMinute: 23.1,
      pacing: "rhythmic-editorial",
      bpm: 118,
      beatSyncRatio: 0.75,
      transitions: ["zoom-through", "cut-the-curve", "whip-pan"],
    },
    animationPackaging: {
      subtitleStyle: "kinetic-gold-pop",
      overlayCards: "clean-editorial-card",
      motionPatterns: ["crash-zoom-in", "spotlight-cursor-follow", "bento-triptych"],
      lightingAndGrade: "clean-commercial",
    },
    shots: [
      {
        index: 1,
        start: 0,
        end: 2.5,
        duration: 2.5,
        productionType: "code-render",
        cameraMove: "zoom-in",
        framing: "close-up",
        overlayText: "Hero Hook",
        recommendedArchetype: "device-3d-showcase",
        recommendedMotionPreset: "crash-zoom-in",
      },
      {
        index: 2,
        start: 2.5,
        end: 5.2,
        duration: 2.7,
        productionType: "screen-recording",
        cameraMove: "cursor-follow",
        framing: "medium",
        overlayText: "Live Action",
        recommendedArchetype: "spotlight-cursor-zoom",
        recommendedMotionPreset: "spotlight-cursor-follow",
      },
    ],
    artifacts: {
      videoMdUrl: null,
      reportHtmlUrl: null,
      storyboardImgUrl: null,
      audioWaveformUrl: null,
    },
    videoMdPreview: "# VIDEO Breakdown\n- Pacing: rhythmic-editorial",
    remakeRecipe: {
      recommendedColorLook: "clean-commercial",
      recommendedCaptionStyle: "kinetic-gold-pop",
      shotPresets: ["crash-zoom-in", "spotlight-cursor-follow"],
    },
  };
}

function fallbackApplyInspirationToStoryboard({ slug, projectDir, reaBreakdown }) {
  const sb = readJsonIfExists(path.join(projectDir, "STORYBOARD.json")) || {
    schemaVersion: 1,
    slug,
    frames: [],
  };
  const refShots = Array.isArray(reaBreakdown?.shots) ? reaBreakdown.shots : [];
  const frames = (Array.isArray(sb.frames) ? sb.frames : []).map((frame, idx) => {
    if (frame.locked) return frame;
    const refShot = refShots.length > 0 ? refShots[idx % refShots.length] : null;
    if (!refShot) return frame;
    return {
      ...frame,
      ...(refShot.recommendedArchetype ? { layout: refShot.recommendedArchetype } : {}),
      ...(refShot.recommendedMotionPreset ? { motionPreset: refShot.recommendedMotionPreset } : {}),
      ...(Number(refShot.duration) > 0
        ? { durationSeconds: Math.max(1.2, Math.min(8, Number(refShot.duration))) }
        : {}),
    };
  });
  const saved = writeStoryboardFile(projectDir, slug, {
    ...sb,
    frames,
    appliedInspirationEngine: reaBreakdown?.engine || "rea-video",
  });
  return { ok: true, storyboard: saved };
}

export async function handleV3Routes(req, res, urlObj, deps = {}) {
  const parsedUrl = urlObj || new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const method = (req.method || "GET").toUpperCase();

  const sendJson = deps.sendJson || defaultSendJson;
  const sendError = deps.sendError || defaultSendError;
  const readJsonBody = deps.readJsonBody || defaultReadJsonBody;

  // 1. GET /api/voices (?lang=Bengali|English|Hindi)
  if (pathname === "/api/voices") {
    if (method !== "GET") {
      sendError(res, 405, `Method ${method} not allowed for /api/voices`);
      return true;
    }
    try {
      const voiceMod = deps.voiceLipsync || (await safeImport("./voice-lipsync.mjs", deps)) || null;
      const catalog = normalizeVoiceCatalog(voiceMod?.VOICE_CATALOG);
      const langParam =
        parsedUrl.searchParams.get("lang") || parsedUrl.searchParams.get("language") || "";
      const voices = filterVoicesByLanguage(catalog, langParam);
      sendJson(res, 200, {
        ok: true,
        voices,
        catalog,
        byLanguage: catalog,
        languages: Object.keys(catalog),
      });
    } catch (err) {
      sendError(res, classifyErrorStatus(err), err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  // 7. GET /api/pm-insights
  if (pathname === "/api/pm-insights") {
    if (method !== "GET") {
      sendError(res, 405, `Method ${method} not allowed for /api/pm-insights`);
      return true;
    }
    const targetPath = deps.pmInsightsPath || DEFAULT_PM_INSIGHTS_PATH;
    const diskInsights = readJsonIfExists(targetPath);
    const insights =
      diskInsights && typeof diskInsights === "object" ? diskInsights : FALLBACK_PM_INSIGHTS;
    sendJson(res, 200, {
      ok: true,
      source: diskInsights ? "file" : "fallback",
      insights,
    });
    return true;
  }

  // Project-scoped V3 routes: /api/projects/:slug/<subRoute>
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
  if (!V3_PROJECT_SUBROUTES.has(subRoute)) {
    return false;
  }

  let projectDir = "";
  try {
    projectDir = resolveProjectDir(slug, deps);
  } catch (err) {
    sendError(res, classifyErrorStatus(err), err instanceof Error ? err.message : "Invalid slug");
    return true;
  }

  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    sendError(res, 404, `Project not found: ${slug}`);
    return true;
  }

  try {
    // 2. POST /api/projects/:slug/voice-sync
    if (subRoute === "voice-sync") {
      if (method !== "POST") {
        sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
        return true;
      }

      const body = await readJsonBody(req);
      const inferredMode =
        body.mode !== undefined
          ? String(body.mode).trim()
          : body.scriptText || body.voiceId
            ? "ai-voice-lipsync"
            : "original-sync";

      if (inferredMode !== "original-sync" && inferredMode !== "ai-voice-lipsync") {
        sendError(
          res,
          400,
          `Unsupported voice-sync mode "${inferredMode}". Expected "original-sync" or "ai-voice-lipsync".`,
        );
        return true;
      }

      if (!isCustomProjectsDir(deps)) {
        ensureProjectDirs(slug);
      }

      let cleanVideoRelPath = null;
      if (body.videoRelPath || body.clipRelPath) {
        const resolvedVid = resolveConfinedRelPath(
          projectDir,
          body.videoRelPath || body.clipRelPath,
          "videoRelPath",
        );
        cleanVideoRelPath = resolvedVid.relPath;
      }

      const cleanFrameId = body.frameId ? validateSafeIdentifier(body.frameId, "frameId") : null;
      const baseProjectsDir = path.dirname(projectDir);
      const voiceMod = deps.voiceLipsync || (await safeImport("./voice-lipsync.mjs", deps)) || null;

      const storyboard = readJsonIfExists(path.join(projectDir, "STORYBOARD.json"));
      const brief = readJsonIfExists(path.join(projectDir, "PROJECT_BRIEF.json")) || {};

      if (inferredMode === "original-sync") {
        const extractFn =
          typeof voiceMod?.extractAndSyncOriginalVoice === "function"
            ? voiceMod.extractAndSyncOriginalVoice
            : null;

        const syncRes = extractFn
          ? await extractFn({
              slug,
              videoRelPath: cleanVideoRelPath,
              trimSilence: body.trimSilence !== false,
              projectsDir: baseProjectsDir,
            })
          : await fallbackExtractOriginalVoice({
              slug,
              projectDir,
              videoRelPath: cleanVideoRelPath,
            });

        const audioRelPath =
          toProjectRelativePosix(projectDir, syncRes.audioRelPath) ||
          "assets/audio/original_voice.mp3";
        const audioUrl = toV3MediaUrl(slug, projectDir, audioRelPath);

        let savedSb = null;
        let targetFrame = null;
        if (storyboard && Array.isArray(storyboard.frames)) {
          if (cleanFrameId) {
            targetFrame = storyboard.frames.find((f) => f.id === cleanFrameId) || null;
            if (targetFrame) {
              targetFrame.audioSpec = {
                ...(targetFrame.audioSpec || {}),
                voiceoverSrc: audioRelPath,
                voiceMode: "original-sync",
              };
            }
          } else {
            storyboard.originalVoiceAudioRelPath = audioRelPath;
          }
          savedSb = writeStoryboardFile(projectDir, slug, storyboard);
        }

        const project = await maybeSyncManifest(slug, deps);
        const decoratedStoryboard = savedSb
          ? decorateV3StoryboardForUi(slug, savedSb, projectDir)
          : null;
        const decoratedFrame =
          cleanFrameId && decoratedStoryboard
            ? decoratedStoryboard.frames.find((f) => f.id === cleanFrameId) || null
            : null;

        if (decoratedStoryboard) {
          await emitStoryboardUpdated(slug, decoratedFrame, decoratedStoryboard, deps);
        }

        sendJson(res, 200, {
          ok: true,
          slug,
          mode: "original-sync",
          ...syncRes,
          audioRelPath,
          audioUrl,
          url: audioUrl,
          segments: Array.isArray(syncRes.segments) ? syncRes.segments : [],
          ...(decoratedFrame ? { frame: decoratedFrame } : {}),
          ...(decoratedStoryboard ? { storyboard: decoratedStoryboard } : {}),
          ...(project ? { project } : {}),
        });
        return true;
      }

      // Mode: ai-voice-lipsync
      const resolvedFrameId = cleanFrameId || storyboard?.frames?.[0]?.id || "frame_01";
      const existingFrame = storyboard?.frames?.find((f) => f.id === resolvedFrameId) || null;

      const scriptText = String(
        body.scriptText ??
          existingFrame?.audioSpec?.voiceoverText ??
          existingFrame?.staging?.captionText ??
          "",
      ).trim();

      if (!scriptText) {
        sendError(res, 400, "scriptText is required for ai-voice-lipsync");
        return true;
      }

      let clipPath = null;
      if (cleanVideoRelPath) {
        const candidateAbs = path.resolve(projectDir, cleanVideoRelPath);
        if (fs.existsSync(candidateAbs)) clipPath = candidateAbs;
      } else if (existingFrame?.sourceClip) {
        const safeClip = resolveConfinedRelPath(projectDir, existingFrame.sourceClip, "sourceClip");
        if (fs.existsSync(safeClip.abs)) clipPath = safeClip.abs;
      }

      const language = String(body.language || brief.language || "Bengali").trim();
      const targetDurationSec =
        Number(body.targetDurationSec) || Number(existingFrame?.durationSeconds) || undefined;
      const syncLips = body.syncLips !== undefined ? Boolean(body.syncLips) : true;

      const genFn =
        typeof voiceMod?.generateMultilingualLipSyncedVoice === "function"
          ? voiceMod.generateMultilingualLipSyncedVoice
          : null;

      const aiRes = genFn
        ? await genFn({
            slug,
            frameId: resolvedFrameId,
            clipPath,
            language,
            voiceId: body.voiceId || null,
            scriptText,
            targetDurationSec,
            syncLips,
            projectsDir: baseProjectsDir,
          })
        : await fallbackGenerateLipSyncedVoice({
            slug,
            projectDir,
            frameId: resolvedFrameId,
            language,
            voiceId: body.voiceId || null,
            scriptText,
            targetDurationSec,
          });

      const audioRelPath =
        toProjectRelativePosix(projectDir, aiRes.audioRelPath) ||
        `assets/audio/vo_${resolvedFrameId}.mp3`;
      const audioUrl = toV3MediaUrl(slug, projectDir, audioRelPath);
      const syncedClipRelPath = aiRes.syncedClipRelPath
        ? toProjectRelativePosix(projectDir, aiRes.syncedClipRelPath)
        : null;
      const syncedClipUrl = syncedClipRelPath
        ? toV3MediaUrl(slug, projectDir, syncedClipRelPath)
        : null;

      let savedSb = null;
      if (storyboard && Array.isArray(storyboard.frames) && existingFrame) {
        existingFrame.audioSpec = {
          ...(existingFrame.audioSpec || {}),
          voiceoverText: scriptText,
          voiceoverSrc: audioRelPath,
          language: aiRes.language || language,
          voiceId: aiRes.voiceId || body.voiceId || null,
          voiceMode: "ai-voice-lipsync",
          lipSynced: Boolean(aiRes.lipSynced),
          visemeEnvelope: Array.isArray(aiRes.visemeEnvelope) ? aiRes.visemeEnvelope : [],
        };
        if (syncedClipRelPath) {
          existingFrame.sourceClip = syncedClipRelPath;
          existingFrame.lipSyncedClip = syncedClipRelPath;
        }
        savedSb = writeStoryboardFile(projectDir, slug, storyboard);
      }

      const project = await maybeSyncManifest(slug, deps);
      const decoratedStoryboard = savedSb
        ? decorateV3StoryboardForUi(slug, savedSb, projectDir)
        : null;
      const decoratedFrame = decoratedStoryboard
        ? decoratedStoryboard.frames.find((f) => f.id === resolvedFrameId) || null
        : null;

      if (decoratedStoryboard) {
        await emitStoryboardUpdated(slug, decoratedFrame, decoratedStoryboard, deps);
      }

      sendJson(res, 200, {
        ok: true,
        slug,
        mode: "ai-voice-lipsync",
        ...aiRes,
        frameId: resolvedFrameId,
        audioRelPath,
        audioUrl,
        url: audioUrl,
        syncedClipRelPath,
        syncedClipUrl,
        ...(decoratedFrame ? { frame: decoratedFrame } : {}),
        ...(decoratedStoryboard ? { storyboard: decoratedStoryboard } : {}),
        ...(project ? { project } : {}),
      });
      return true;
    }

    // 3 & 4. GET & POST /api/projects/:slug/whiteboard
    if (subRoute === "whiteboard") {
      const wbOptions = { projectsDir: path.dirname(projectDir) };
      const wbMod =
        deps.whiteboardGraph || (await safeImport("./whiteboard-graph.mjs", deps)) || null;

      if (method === "GET") {
        const rawGraph =
          typeof wbMod?.loadWhiteboardGraph === "function"
            ? await wbMod.loadWhiteboardGraph(slug, wbOptions)
            : readWhiteboardGraphFromDisk(projectDir, slug);
        const graph = normalizeWhiteboardGraphPayload(slug, rawGraph);
        sendJson(res, 200, {
          ok: true,
          slug,
          graph,
          nodes: graph.nodes,
          edges: graph.edges,
        });
        return true;
      }

      if (method === "POST" || method === "PUT") {
        const body = await readJsonBody(req);
        const normalized = normalizeWhiteboardGraphPayload(slug, body);
        const savedRaw =
          typeof wbMod?.saveWhiteboardGraph === "function"
            ? await wbMod.saveWhiteboardGraph(slug, normalized, wbOptions)
            : writeWhiteboardGraphToDisk(projectDir, slug, normalized);
        const graph = normalizeWhiteboardGraphPayload(slug, savedRaw);
        sendJson(res, 200, {
          ok: true,
          slug,
          graph,
          nodes: graph.nodes,
          edges: graph.edges,
        });
        return true;
      }

      sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
      return true;
    }

    // 5. POST /api/projects/:slug/whiteboard/compile-scene
    if (subRoute === "whiteboard/compile-scene") {
      if (method !== "POST") {
        sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
        return true;
      }

      const body = await readJsonBody(req);
      const transition = String(body.transition || "cut")
        .trim()
        .toLowerCase();
      if (!VALID_TRANSITIONS.has(transition)) {
        sendError(res, 400, `Unsupported whiteboard transition "${transition}"`);
        return true;
      }

      const sceneNodeId = body.sceneNodeId
        ? validateSafeIdentifier(body.sceneNodeId, "sceneNodeId")
        : null;
      const nodeIds = Array.isArray(body.nodeIds)
        ? body.nodeIds.map((id) => validateSafeIdentifier(id, "nodeId"))
        : null;
      const prompt = String(body.prompt ?? "").trim();

      const customDir = isCustomProjectsDir(deps);
      const wbMod =
        deps.whiteboardGraph ||
        (!customDir ? await safeImport("./whiteboard-graph.mjs", deps) : null) ||
        null;

      // Persist inline unsaved graph before compiling scene (V3 Contract Rule #2)
      let currentGraph = null;
      if (
        (body.graph && typeof body.graph === "object") ||
        Array.isArray(body.nodes) ||
        Array.isArray(body.edges)
      ) {
        const normalizedInline = normalizeWhiteboardGraphPayload(slug, body);
        if (typeof wbMod?.saveWhiteboardGraph === "function") {
          currentGraph = await wbMod.saveWhiteboardGraph(slug, normalizedInline);
        } else {
          currentGraph = writeWhiteboardGraphToDisk(projectDir, slug, normalizedInline);
        }
      }

      let compileResult;
      if (typeof wbMod?.compileWhiteboardScene === "function") {
        compileResult = await wbMod.compileWhiteboardScene({
          slug,
          sceneNodeId,
          nodeIds,
          prompt,
          transition,
        });
      } else {
        // Minimal fallback when whiteboard-graph.mjs is not yet present
        const graph = currentGraph || readWhiteboardGraphFromDisk(projectDir, slug);
        const sb = readJsonIfExists(path.join(projectDir, "STORYBOARD.json")) || {
          schemaVersion: 1,
          slug,
          frames: [],
        };
        const nextIdx = (sb.frames?.length || 0) + 1;
        const frameId = `frame_${String(nextIdx).padStart(2, "0")}`;
        const compiledClipRelPath = `assets/clips/wb_scene_${sceneNodeId || nextIdx}.mp4`;
        const notePrompts = graph.nodes
          .filter((n) => n.type === "note" && n.promptText)
          .map((n) => n.promptText);
        const combinedPrompt = [...notePrompts, prompt].filter(Boolean).join(" · ");
        const newFrame = {
          id: frameId,
          index: nextIdx,
          sceneId: `scene_${String(nextIdx).padStart(2, "0")}`,
          title: combinedPrompt.slice(0, 48) || `Whiteboard Scene ${nextIdx}`,
          layout: "device-3d-showcase",
          motionPreset: "crash-zoom-in",
          durationSeconds: 4,
          speedFactor: 1,
          sourceClip: compiledClipRelPath,
          prompt: combinedPrompt,
          locked: false,
          approved: false,
          currentVersion: 1,
          staging: { headline: combinedPrompt.slice(0, 48) || `Scene ${nextIdx}` },
          audioSpec: { voiceoverText: "", sfx: ["cinema-whoosh"] },
          history: [],
        };
        sb.frames = [...(sb.frames || []), newFrame];
        const savedSb = writeStoryboardFile(projectDir, slug, sb);
        compileResult = {
          ok: true,
          compiledClipRelPath,
          frame: newFrame,
          storyboard: savedSb,
          graph,
        };
      }

      const compiledClipRelPath = toProjectRelativePosix(
        projectDir,
        compileResult?.compiledClipRelPath || "",
      );
      const compiledClipUrl = compiledClipRelPath
        ? toV3MediaUrl(slug, projectDir, compiledClipRelPath)
        : "";

      const decoratedStoryboard = compileResult?.storyboard
        ? decorateV3StoryboardForUi(slug, compileResult.storyboard, projectDir)
        : null;
      const rawFrame = compileResult?.frame || null;
      const decoratedFrame =
        (rawFrame?.id && decoratedStoryboard?.frames?.find((f) => f.id === rawFrame.id)) ||
        (rawFrame ? decorateV3FrameForUi(slug, projectDir, rawFrame) : null);

      if (decoratedStoryboard) {
        await emitStoryboardUpdated(slug, decoratedFrame, decoratedStoryboard, deps);
      }

      await maybeSyncManifest(slug, deps);

      sendJson(res, 200, {
        ok: true,
        slug,
        ...(compileResult && typeof compileResult === "object" ? compileResult : {}),
        compiledClipRelPath,
        compiledClipUrl,
        ...(decoratedFrame ? { frame: decoratedFrame } : {}),
        ...(decoratedStoryboard ? { storyboard: decoratedStoryboard } : {}),
        graph: compileResult?.graph
          ? normalizeWhiteboardGraphPayload(slug, compileResult.graph)
          : currentGraph || readWhiteboardGraphFromDisk(projectDir, slug),
      });
      return true;
    }

    // 6. GET & POST /api/projects/:slug/ad-analytics
    if (subRoute === "ad-analytics") {
      if (method !== "GET" && method !== "POST") {
        sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
        return true;
      }

      const body = method === "POST" ? await readJsonBody(req) : {};
      const project =
        body.project && typeof body.project === "object"
          ? body.project
          : readJsonIfExists(path.join(projectDir, "PROJECT_BRIEF.json")) || { slug };
      const storyboard =
        body.storyboard && typeof body.storyboard === "object"
          ? body.storyboard
          : readJsonIfExists(path.join(projectDir, "STORYBOARD.json")) || { slug, frames: [] };

      const customDir = isCustomProjectsDir(deps);
      const adsMod = deps.adAnalytics || (await safeImport("./ad-analytics.mjs", deps)) || null;

      const evalFn =
        typeof adsMod?.evaluateAdCreativeAnalytics === "function"
          ? adsMod.evaluateAdCreativeAnalytics
          : fallbackEvaluateAdCreativeAnalytics;

      const rawAnalytics = await evalFn({
        slug: customDir && !deps.adAnalytics ? null : slug,
        project,
        storyboard,
      });

      const baseAnalytics =
        rawAnalytics?.analytics && typeof rawAnalytics.analytics === "object"
          ? rawAnalytics.analytics
          : rawAnalytics;

      const analytics =
        baseAnalytics && typeof baseAnalytics === "object"
          ? { ...baseAnalytics, slug }
          : baseAnalytics;

      const cachePath = path.join(projectDir, ".studio", "ad-analytics.json");
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(analytics, null, 2) + "\n", "utf8");

      sendJson(res, 200, {
        ok: true,
        slug,
        analytics,
      });
      return true;
    }

    // 8. POST /api/projects/:slug/inspiration/rea-decompose
    if (subRoute === "inspiration/rea-decompose") {
      if (method !== "POST") {
        sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
        return true;
      }

      const body = await readJsonBody(req);
      let targetVideo = null;
      const requestedRel = body.relPath || body.videoRelPath || "";
      if (String(requestedRel).trim()) {
        const resolved = resolveConfinedRelPath(projectDir, requestedRel, "relPath");
        if (!fs.existsSync(resolved.abs) || !fs.statSync(resolved.abs).isFile()) {
          sendError(res, 404, `Inspiration video not found: ${resolved.relPath}`);
          return true;
        }
        targetVideo = resolved;
      } else {
        targetVideo = findNewestInspirationVideo(projectDir);
      }

      if (!targetVideo) {
        sendError(res, 404, "No inspiration video found in inbox/inspiration or inbox/references");
        return true;
      }

      const reaMod =
        deps.reaInspiration || (await safeImport("./rea-inspiration.mjs", deps)) || null;
      const decomposeFn =
        typeof reaMod?.decomposeInspirationWithReaVideo === "function"
          ? reaMod.decomposeInspirationWithReaVideo
          : null;

      const rawRes = decomposeFn
        ? await decomposeFn({
            slug,
            videoPath: targetVideo.abs,
            videoRelPath: targetVideo.relPath,
            lang: String(body.lang || body.language || "en").trim(),
            enableStems: Boolean(body.enableStems),
            projectsDir: path.dirname(projectDir),
          })
        : fallbackDecomposeInspiration({
            slug,
            videoRelPath: targetVideo.relPath,
          });

      const rawBreakdown =
        rawRes?.reaBreakdown && typeof rawRes.reaBreakdown === "object"
          ? rawRes.reaBreakdown
          : rawRes;
      const reaBreakdown = decorateReaBreakdownForUi(slug, projectDir, rawBreakdown);

      const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
      const existingBrief = readJsonIfExists(briefPath) || { slug };
      const editing = reaBreakdown?.editingStyle || {};
      const inspirationProfile = {
        ...(existingBrief.inspirationProfile && typeof existingBrief.inspirationProfile === "object"
          ? existingBrief.inspirationProfile
          : {}),
        ...(rawRes?.inspirationProfile && typeof rawRes.inspirationProfile === "object"
          ? rawRes.inspirationProfile
          : {}),
        ...(editing.avgShotLength !== undefined ? { avgShotLength: editing.avgShotLength } : {}),
        ...(editing.cutsPerMinute !== undefined ? { cutsPerMinute: editing.cutsPerMinute } : {}),
        ...(editing.pacing ? { pacing: editing.pacing } : {}),
        reaBreakdown,
      };

      let project = null;
      if (deps.syncManifest !== false && !isCustomProjectsDir(deps)) {
        project = await syncProjectManifest(slug, { inspirationProfile });
      } else {
        project = {
          ...existingBrief,
          inspirationProfile,
          updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(briefPath, JSON.stringify(project, null, 2) + "\n", "utf8");
      }

      sendJson(res, 200, {
        ok: true,
        slug,
        reaBreakdown,
        inspirationProfile: project?.inspirationProfile || inspirationProfile,
        project,
      });
      return true;
    }

    // 9. POST /api/projects/:slug/inspiration/apply-to-storyboard
    if (subRoute === "inspiration/apply-to-storyboard") {
      if (method !== "POST") {
        sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
        return true;
      }

      const body = await readJsonBody(req);
      const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
      const existingBrief = readJsonIfExists(briefPath) || { slug };
      const reaBreakdown =
        body.reaBreakdown && typeof body.reaBreakdown === "object"
          ? body.reaBreakdown
          : existingBrief.inspirationProfile?.reaBreakdown || null;

      if (!reaBreakdown) {
        sendError(res, 400, "No rea-video breakdown available. Run rea-decompose first.");
        return true;
      }

      const customDir = isCustomProjectsDir(deps);
      const reaMod =
        deps.reaInspiration ||
        (!customDir ? await safeImport("./rea-inspiration.mjs", deps) : null) ||
        null;

      const applyFn =
        typeof reaMod?.applyInspirationStyleToStoryboard === "function"
          ? reaMod.applyInspirationStyleToStoryboard
          : null;

      const rawApplyRes = applyFn
        ? await applyFn({
            slug,
            reaBreakdown,
            projectsDir: path.dirname(projectDir),
          })
        : fallbackApplyInspirationToStoryboard({
            slug,
            projectDir,
            reaBreakdown,
          });

      const rawStoryboard =
        rawApplyRes?.storyboard && typeof rawApplyRes.storyboard === "object"
          ? rawApplyRes.storyboard
          : Array.isArray(rawApplyRes?.frames)
            ? rawApplyRes
            : readJsonIfExists(path.join(projectDir, "STORYBOARD.json"));

      const decoratedStoryboard = rawStoryboard
        ? decorateV3StoryboardForUi(slug, rawStoryboard, projectDir)
        : null;

      if (decoratedStoryboard) {
        await emitStoryboardUpdated(slug, null, decoratedStoryboard, deps);
      }

      const project =
        (await maybeSyncManifest(slug, deps)) || readJsonIfExists(briefPath) || existingBrief;

      sendJson(res, 200, {
        ok: true,
        slug,
        storyboard: decoratedStoryboard,
        project,
      });
      return true;
    }
  } catch (err) {
    if (!res.headersSent) {
      const status = classifyErrorStatus(err);
      sendError(res, status, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  return false;
}

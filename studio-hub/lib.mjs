import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, "..");
export const PROJECTS_DIR = path.join(ROOT_DIR, "projects");
export const DROP_DIR = path.join(ROOT_DIR, "DROP_HERE");
export const CURRENT_PROJECT_FILE = path.join(ROOT_DIR, "CURRENT_PROJECT.json");
export const CATEGORIES = ["raw-video", "inspiration", "references", "images", "brand", "audio"];

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const BRAND_FONT_EXTS = new Set([".ttf", ".otf", ".woff", ".woff2"]);
const BRAND_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);

const ASPECT_DIMENSIONS = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

const ASSET_SUBDIR_FOR_CATEGORY = {
  "raw-video": "clips",
  images: "images",
  audio: "audio",
};

function resolveAssetSubdir(category, filename) {
  if (category === "brand") {
    const ext = path.extname(filename).toLowerCase();
    if (BRAND_FONT_EXTS.has(ext)) return "fonts";
    if (BRAND_IMAGE_EXTS.has(ext)) return "images";
    return null;
  }
  return ASSET_SUBDIR_FOR_CATEGORY[category] || null;
}

export function findChromeHeadlessShell(baseDir) {
  const explicitBase = baseDir !== undefined;
  if (
    !explicitBase &&
    process.env.CHROME_HEADLESS_SHELL &&
    fs.existsSync(process.env.CHROME_HEADLESS_SHELL)
  ) {
    return process.env.CHROME_HEADLESS_SHELL;
  }

  const homeDir = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const searchBase = explicitBase ? baseDir : path.join(homeDir, ".cache", "hyperframes", "chrome");
  const targetNames = new Set(["chrome-headless-shell.exe", "chrome-headless-shell"]);

  if (searchBase && fs.existsSync(searchBase)) {
    const matches = [];
    function walk(dir) {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && targetNames.has(entry.name.toLowerCase())) {
          matches.push(fullPath);
        }
      }
    }
    walk(searchBase);
    if (matches.length > 0) {
      matches.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
      return matches[0];
    }
  }

  if (explicitBase) return null;

  const systemFallbacks =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
          ];

  for (const candidate of systemFallbacks) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findFfmpegBinDir() {
  if (process.platform !== "win32") {
    for (const dir of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]) {
      if (fs.existsSync(path.join(dir, "ffmpeg"))) return dir;
    }
    return null;
  }
  const localAppData = process.env.LOCALAPPDATA || "";
  const wingetBase = path.join(localAppData, "Microsoft", "WinGet", "Packages");
  if (fs.existsSync(wingetBase)) {
    try {
      const entries = fs.readdirSync(wingetBase);
      for (const entry of entries) {
        if (entry.startsWith("Gyan.FFmpeg")) {
          const pkgRoot = path.join(wingetBase, entry);
          const subDirs = fs.readdirSync(pkgRoot);
          for (const sub of subDirs) {
            const candidate = path.join(pkgRoot, sub, "bin");
            if (fs.existsSync(path.join(candidate, "ffmpeg.exe"))) {
              return candidate;
            }
          }
        }
      }
    } catch {
      // Fallback below
    }
  }
  return null;
}

function discoverPythonUserBinDirs(homeDir, localAppData, appData) {
  const dirs = [];
  if (process.platform === "win32") {
    for (const root of [
      localAppData ? path.join(localAppData, "Programs", "Python") : "",
      appData ? path.join(appData, "Python") : "",
    ]) {
      if (!root || !fs.existsSync(root)) continue;
      try {
        const vers = fs
          .readdirSync(root, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^Python3\d+/i.test(d.name))
          .map((d) => d.name)
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
        for (const ver of vers) {
          dirs.push(path.join(root, ver));
          dirs.push(path.join(root, ver, "Scripts"));
        }
      } catch {
        // Ignore unreadable dirs
      }
    }
  } else if (process.platform === "darwin" && homeDir) {
    const macPyRoot = path.join(homeDir, "Library", "Python");
    if (fs.existsSync(macPyRoot)) {
      try {
        const vers = fs
          .readdirSync(macPyRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^3\.\d+/.test(d.name))
          .map((d) => d.name)
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
        for (const ver of vers) {
          dirs.push(path.join(macPyRoot, ver, "bin"));
        }
      } catch {
        // Ignore unreadable dirs
      }
    }
  }
  return dirs;
}

export function getEnhancedPath() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const appData = process.env.APPDATA || "";
  const homeDir = process.env.USERPROFILE || process.env.HOME || os.homedir();

  const platformCandidates =
    process.platform === "win32"
      ? [process.env.NVM_SYMLINK || "", "C:\\Program Files\\nodejs", "C:\\nvm4w\\nodejs"]
      : [
          "/opt/homebrew/bin",
          "/opt/homebrew/sbin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/snap/bin",
          homeDir ? path.join(homeDir, ".local", "bin") : "",
        ];

  const candidates = [
    findFfmpegBinDir(),
    ...discoverPythonUserBinDirs(homeDir, localAppData, appData),
    homeDir ? path.join(homeDir, ".bun", "bin") : "",
    ...platformCandidates,
    path.join(ROOT_DIR, "node_modules", ".bin"),
  ].filter(Boolean);

  const existing = (process.env.PATH || "")
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter((p) => p && p !== "System.Object[]");

  const merged = [];
  const seen = new Set();
  for (const p of [...candidates, ...existing]) {
    const key = process.platform === "win32" ? p.toLowerCase() : p;
    if (seen.has(key)) continue;
    if (fs.existsSync(p)) {
      seen.add(key);
      merged.push(p);
    }
  }
  return merged.join(path.delimiter);
}

let cachedPythonBin = null;

export function resolvePythonBin() {
  if (process.env.STUDIO_HUB_PYTHON) {
    return process.env.STUDIO_HUB_PYTHON;
  }
  if (cachedPythonBin) {
    return cachedPythonBin;
  }

  const enhancedPath = getEnhancedPath();
  const env = { ...process.env, PATH: enhancedPath };
  const candidates =
    process.platform === "win32" ? ["python", "python3", "py"] : ["python3", "python"];

  for (const bin of candidates) {
    try {
      const probe = spawnSync(bin, ["-c", "import sys; print(sys.version_info[0])"], {
        env,
        encoding: "utf8",
        timeout: 3000,
        windowsHide: true,
        shell: false,
      });
      if (probe.status === 0 && String(probe.stdout || "").trim() === "3") {
        cachedPythonBin = bin;
        return bin;
      }
    } catch {
      // Try next candidate
    }
  }

  cachedPythonBin = process.platform === "win32" ? "python" : "python3";
  return cachedPythonBin;
}

export function getToolEnv() {
  const enhancedPath = getEnhancedPath();
  process.env.PATH = enhancedPath;
  return { ...process.env, PATH: enhancedPath };
}

export function runCommand(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const env = getToolEnv();
    const isWin = process.platform === "win32";
    const child = spawn(cmd, args, {
      cwd: options.cwd || ROOT_DIR,
      env: { ...env, ...(options.env || {}) },
      shell: options.shell ?? isWin,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk) => {
      const s = String(chunk);
      stdout += s;
      options.onOutput?.(s);
    });
    child.stderr?.on("data", (chunk) => {
      const s = String(chunk);
      stderr += s;
      options.onOutput?.(s);
    });
    child.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: stderr + "\n" + err.message });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function checkTools() {
  const env = getToolEnv();
  const checks = await Promise.all([
    runCommand("ffmpeg", ["-version"], { env, shell: false }),
    runCommand("ffprobe", ["-version"], { env, shell: false }),
    runCommand("yt-dlp", ["--version"], { env, shell: false }),
    runCommand("edge-tts", ["--version"], { env, shell: false }),
    runCommand("npx", ["hyperframes", "--version"], { env }),
  ]);

  const firstLine = (res) => (res.stdout || res.stderr || "").trim().split(/\r?\n/)[0] || "";
  return {
    ffmpeg: { ok: checks[0].code === 0, version: firstLine(checks[0]) },
    ffprobe: { ok: checks[1].code === 0, version: firstLine(checks[1]) },
    ytdlp: { ok: checks[2].code === 0, version: firstLine(checks[2]) },
    edgeTts: { ok: checks[3].code === 0, version: firstLine(checks[3]) },
    hyperframes: {
      ok:
        firstLine(checks[4]).length > 0 &&
        (checks[4].code === 0 || /\d+\.\d+/.test(firstLine(checks[4]))),
      version: firstLine(checks[4]),
    },
  };
}

export function sanitizeSlug(raw) {
  const cleaned = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || `project-${Date.now()}`;
}

export function assertValidSlug(slug) {
  if (!slug || !/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  const resolved = path.resolve(PROJECTS_DIR, slug);
  if (!resolved.startsWith(PROJECTS_DIR + path.sep)) {
    throw new Error(`Unsafe project path: ${slug}`);
  }
  return resolved;
}

export function sanitizeFilename(raw) {
  const base = path.basename(String(raw || "upload.bin")).trim();
  const ext = path.extname(base);
  const stem = path
    .basename(base, ext)
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${stem || "file"}${ext.replace(/[^a-zA-Z0-9.]/g, "")}`;
}

export function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return "video";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "other";
}

export function ensureDropStructure() {
  for (const cat of CATEGORIES) {
    fs.mkdirSync(path.join(DROP_DIR, cat), { recursive: true });
  }
}

export function ensureProjectDirs(slug) {
  const projectDir = assertValidSlug(slug);
  const subdirs = [
    "inbox/raw-video",
    "inbox/inspiration",
    "inbox/references",
    "inbox/images",
    "inbox/brand",
    "inbox/audio",
    "assets/clips",
    "assets/images",
    "assets/audio",
    "assets/fonts",
    "compositions",
    "renders",
    "output",
    ".thumbnails",
    ".hyperframes",
    ".studio/frames/raw",
    ".studio/frames/inspiration",
    ".studio/frames/design",
    ".studio/frames/tmp",
    ".studio/agent-queue",
  ];
  for (const rel of subdirs) {
    fs.mkdirSync(path.join(projectDir, rel), { recursive: true });
  }
  return projectDir;
}

export function readCurrentProjectSlug() {
  try {
    if (fs.existsSync(CURRENT_PROJECT_FILE)) {
      const data = JSON.parse(fs.readFileSync(CURRENT_PROJECT_FILE, "utf8"));
      if (data?.activeProject && fs.existsSync(path.join(PROJECTS_DIR, data.activeProject))) {
        return data.activeProject;
      }
    }
  } catch {
    // Fall through
  }
  if (fs.existsSync(PROJECTS_DIR)) {
    const dirs = fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
    if (dirs.includes("krishop-promo")) return "krishop-promo";
    if (dirs.length > 0) return dirs[0];
  }
  return null;
}

export function setCurrentProjectSlug(slug) {
  assertValidSlug(slug);
  const payload = {
    activeProject: slug,
    studioUrl: "http://localhost:4400",
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CURRENT_PROJECT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

function parseFpsRatio(ratioStr) {
  if (!ratioStr || !ratioStr.includes("/")) return Number(ratioStr) || null;
  const [num, den] = ratioStr.split("/").map(Number);
  if (!den) return null;
  return Math.round((num / den) * 100) / 100;
}

export async function probeMedia(filePath) {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const base = {
    sizeBytes: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
    mediaType: getMediaType(filePath),
    duration: null,
    width: null,
    height: null,
    fps: null,
    codec: null,
    hasAudio: false,
    audioCodec: null,
  };

  if (ext === ".svg" || base.mediaType === "other") {
    return base;
  }

  const res = await runCommand(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { shell: false },
  );

  if (res.code !== 0 || !res.stdout.trim()) {
    return base;
  }

  try {
    const info = JSON.parse(res.stdout);
    const streams = Array.isArray(info.streams) ? info.streams : [];
    const videoStream = streams.find((s) => s.codec_type === "video");
    const audioStream = streams.find((s) => s.codec_type === "audio");
    const rawDuration = info.format?.duration ?? videoStream?.duration ?? audioStream?.duration;
    const durationNum = rawDuration !== undefined ? Number(rawDuration) : null;

    return {
      ...base,
      duration:
        Number.isFinite(durationNum) && base.mediaType !== "image"
          ? Math.round(durationNum * 100) / 100
          : null,
      width: videoStream?.width ? Number(videoStream.width) : null,
      height: videoStream?.height ? Number(videoStream.height) : null,
      fps:
        base.mediaType === "video"
          ? parseFpsRatio(videoStream?.r_frame_rate || videoStream?.avg_frame_rate)
          : null,
      codec: videoStream?.codec_name || audioStream?.codec_name || null,
      hasAudio: Boolean(audioStream),
      audioCodec: audioStream?.codec_name || null,
    };
  } catch {
    return base;
  }
}

export async function generateThumbnail(videoPath, thumbPath) {
  if (fs.existsSync(thumbPath)) return true;
  fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
  let res = await runCommand(
    "ffmpeg",
    [
      "-y",
      "-ss",
      "00:00:01",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      "-vf",
      "scale=480:-1",
      thumbPath,
    ],
    { shell: false },
  );
  if (res.code !== 0 || !fs.existsSync(thumbPath)) {
    res = await runCommand(
      "ffmpeg",
      [
        "-y",
        "-ss",
        "00:00:00",
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        "-vf",
        "scale=480:-1",
        thumbPath,
      ],
      { shell: false },
    );
  }
  return fs.existsSync(thumbPath);
}

function loadProbeCache(projectDir) {
  const cachePath = path.join(projectDir, ".hyperframes", "media-probe-cache.json");
  try {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, "utf8"));
    }
  } catch {
    // Ignore corrupt cache
  }
  return {};
}

function saveProbeCache(projectDir, cache) {
  const cachePath = path.join(projectDir, ".hyperframes", "media-probe-cache.json");
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf8");
}

function defaultBrandKit() {
  return {
    logoRelPath: null,
    guidelinesText: "",
    fonts: { heading: "Inter", body: "Inter" },
    tone: "Confident & Modern",
    extractedPalette: [],
  };
}

function normalizeBrandKit(raw, patch = null) {
  const defaults = defaultBrandKit();
  const baseObj = raw && typeof raw === "object" ? raw : {};
  const patchObj = patch && typeof patch === "object" ? patch : {};
  const merged = {
    ...defaults,
    ...baseObj,
    ...patchObj,
    fonts: {
      ...defaults.fonts,
      ...(baseObj.fonts && typeof baseObj.fonts === "object" ? baseObj.fonts : {}),
      ...(patchObj.fonts && typeof patchObj.fonts === "object" ? patchObj.fonts : {}),
    },
  };
  merged.extractedPalette = Array.isArray(patchObj.extractedPalette)
    ? [...patchObj.extractedPalette]
    : Array.isArray(baseObj.extractedPalette)
      ? [...baseObj.extractedPalette]
      : [];
  merged.guidelinesText = String(merged.guidelinesText ?? "");
  merged.tone = String(merged.tone || defaults.tone);
  merged.logoRelPath = merged.logoRelPath ? String(merged.logoRelPath) : null;
  return merged;
}

function inferDefaultBrief(slug, projectDir) {
  const base = {
    slug,
    title: slug
      .split(/[-_]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 30,
    language: "English",
    brandColors: {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#F1C40F",
      background: "#0A1612",
    },
    brandKit: defaultBrandKit(),
    inspirationProfile: null,
    sourceFolders: [],
    instructions: "",
    referenceLinks: [],
  };

  // Enrich from existing SCENE_SCHEMA.json or BRIEF_DESIGN_PROPOSAL.md if present
  const schemaPath = path.join(projectDir, "SCENE_SCHEMA.json");
  if (fs.existsSync(schemaPath)) {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
      if (schema.canvas) {
        base.width = Number(schema.canvas.width) || base.width;
        base.height = Number(schema.canvas.height) || base.height;
        base.fps = Number(schema.canvas.fps) || base.fps;
        base.durationSeconds = Number(schema.canvas.duration_seconds) || base.durationSeconds;
        base.aspectRatio =
          base.width === base.height ? "1:1" : base.width > base.height ? "16:9" : "9:16";
      }
      if (schema.project_name) base.title = schema.project_name;
    } catch {
      // Ignore
    }
  }

  const proposalPath = path.join(projectDir, "BRIEF_DESIGN_PROPOSAL.md");
  if (fs.existsSync(proposalPath)) {
    try {
      const md = fs.readFileSync(proposalPath, "utf8");
      const firstHeading = md.match(/^#\s+(.+)$/m);
      if (firstHeading) base.title = firstHeading[1].trim();
      if (/bengali|বাংলা/i.test(md)) base.language = "Bengali (বাংলা)";
      if (!base.instructions) {
        base.instructions = md.slice(0, 1500);
      }
    } catch {
      // Ignore
    }
  }

  return base;
}

async function scanDirectoryMedia(slug, projectDir, relDir, bucket, probeCache, options = {}) {
  const absDir = path.join(projectDir, relDir);
  if (!fs.existsSync(absDir)) return [];

  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absPath = path.join(absDir, entry.name);
    const relPath = `${relDir.replaceAll("\\", "/")}/${entry.name}`;
    const mediaType = getMediaType(absPath);
    if (options.mediaOnly && mediaType === "other") continue;

    const stat = fs.statSync(absPath);
    const mtimeMs = Math.round(stat.mtimeMs);
    const cached = probeCache[relPath];
    let meta;
    if (cached && cached.sizeBytes === stat.size && cached.mtimeMs === mtimeMs) {
      meta = cached;
    } else {
      meta = await probeMedia(absPath);
      probeCache[relPath] = meta;
    }

    let thumbnailUrl = null;
    if (meta.mediaType === "video") {
      const hash = crypto.createHash("md5").update(relPath).digest("hex").slice(0, 10);
      const thumbName = `${sanitizeFilename(path.basename(entry.name, path.extname(entry.name)))}_${hash}.jpg`;
      const thumbPath = path.join(projectDir, ".thumbnails", thumbName);
      const ok = await generateThumbnail(absPath, thumbPath);
      if (ok) {
        thumbnailUrl = `/media/${encodeURIComponent(slug)}/.thumbnails/${encodeURIComponent(thumbName)}`;
      }
    } else if (meta.mediaType === "image") {
      thumbnailUrl = `/media/${encodeURIComponent(slug)}/${relPath.split("/").map(encodeURIComponent).join("/")}`;
    }

    results.push({
      name: entry.name,
      relPath,
      bucket,
      url: `/media/${encodeURIComponent(slug)}/${relPath.split("/").map(encodeURIComponent).join("/")}`,
      thumbnailUrl,
      ...meta,
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function buildAiReadyPrompt(brief) {
  const lines = [
    `# AI Video Production Brief: ${brief.title}`,
    ``,
    `- **Active Project Slug**: \`${brief.slug}\``,
    `- **Project Folder**: \`projects/${brief.slug}/\``,
    `- **Target Canvas**: \`${brief.width}x${brief.height}\` (${brief.aspectRatio}) @ \`${brief.fps} fps\``,
    `- **Target Duration**: \`${brief.durationSeconds}s\``,
    `- **Primary Language**: ${brief.language}`,
    `- **Brand Colors**: Primary \`${brief.brandColors.primary}\`, Secondary \`${brief.brandColors.secondary}\`, Accent \`${brief.brandColors.accent}\`, Background \`${brief.brandColors.background}\``,
    `- **Updated**: ${brief.updatedAt}`,
    ``,
    `## Creative Instructions`,
    brief.instructions?.trim()
      ? brief.instructions.trim()
      : "_No custom instructions added yet. Edit using uploaded raw footage and assets._",
    ``,
  ];

  if (brief.referenceLinks?.length) {
    lines.push(`## Reference Links & Notes`);
    for (const ref of brief.referenceLinks) {
      lines.push(
        `- ${ref.title ? `**${ref.title}**: ` : ""}${ref.url}${ref.notes ? ` — ${ref.notes}` : ""}`,
      );
    }
    lines.push("");
  }

  const formatFileLine = (f) => {
    const specs = [];
    if (f.width && f.height) specs.push(`${f.width}x${f.height}`);
    if (f.duration !== null) specs.push(`${f.duration}s`);
    if (f.fps) specs.push(`${f.fps}fps`);
    if (f.mediaType === "video") specs.push(f.hasAudio ? "audio:yes" : "audio:muted");
    specs.push(`${(f.sizeBytes / (1024 * 1024)).toFixed(2)} MB`);
    return `- \`${f.relPath}\` (${f.mediaType}${specs.length ? " · " + specs.join(" · ") : ""})`;
  };

  const sections = [
    ["Raw Videos (`inbox/raw-video/`)", brief.files.rawVideo],
    ["Inspiration Videos (`inbox/inspiration/`)", brief.files.inspiration],
    ["HyperFrames Clips (`assets/clips/`)", brief.files.clips],
    ["References (`inbox/references/`)", brief.files.references],
    ["Brand Assets (`inbox/brand/`)", brief.files.brand],
    ["Uploaded Images & Logos (`inbox/images/`)", brief.files.images],
    ["HyperFrames Images (`assets/images/` & `assets/`)", brief.files.assetImages],
    ["Audio & Voiceovers (`assets/audio/`)", brief.files.assetAudio],
    ["Rendered Outputs (`output/` & `renders/`)", brief.files.renders],
  ];

  lines.push(`## Available Project Media`);
  for (const [heading, items] of sections) {
    lines.push(`### ${heading}`);
    if (!items || items.length === 0) {
      lines.push(`- _None yet_`);
    } else {
      for (const item of items) {
        lines.push(formatFileLine(item));
      }
    }
    lines.push("");
  }

  lines.push(`## Execution Checklist for AI Agent`);
  lines.push(
    `1. Read \`projects/${brief.slug}/index.html\` and follow \`skills/hyperframes/SKILL.md\`.`,
  );
  lines.push(
    `2. Reference media using relative HyperFrames paths (\`assets/clips/...\`, \`assets/images/...\`, \`assets/audio/...\`).`,
  );
  lines.push(
    `3. Validate with \`npx hyperframes lint projects/${brief.slug}\` and \`npx hyperframes check --json projects/${brief.slug}\`.`,
  );
  lines.push(
    `4. Render final video with \`npx hyperframes render --quality delivery -o projects/${brief.slug}/output/${brief.slug}_final.mp4 projects/${brief.slug}\`.`,
  );
  lines.push("");

  return lines.join("\n");
}

export async function syncProjectManifest(slug, briefPatch = null) {
  const projectDir = ensureProjectDirs(slug);
  const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");

  let existing = null;
  if (fs.existsSync(briefPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(briefPath, "utf8"));
    } catch {
      existing = null;
    }
  }

  const base = existing || inferDefaultBrief(slug, projectDir);
  base.brandKit = normalizeBrandKit(base.brandKit);
  if (base.inspirationProfile === undefined) {
    base.inspirationProfile = null;
  }
  base.sourceFolders = Array.isArray(base.sourceFolders)
    ? [...new Set(base.sourceFolders.map(String).filter(Boolean))]
    : [];

  if (briefPatch) {
    if (briefPatch.title !== undefined) base.title = String(briefPatch.title).trim() || base.title;
    if (briefPatch.aspectRatio && ASPECT_DIMENSIONS[briefPatch.aspectRatio]) {
      base.aspectRatio = briefPatch.aspectRatio;
      base.width = ASPECT_DIMENSIONS[briefPatch.aspectRatio].width;
      base.height = ASPECT_DIMENSIONS[briefPatch.aspectRatio].height;
    }
    if (briefPatch.width !== undefined) base.width = Number(briefPatch.width) || base.width;
    if (briefPatch.height !== undefined) base.height = Number(briefPatch.height) || base.height;
    if (briefPatch.fps !== undefined) base.fps = Number(briefPatch.fps) || base.fps;
    if (briefPatch.durationSeconds !== undefined) {
      base.durationSeconds = Number(briefPatch.durationSeconds) || base.durationSeconds;
    }
    if (briefPatch.language !== undefined) base.language = String(briefPatch.language);
    if (briefPatch.instructions !== undefined) base.instructions = String(briefPatch.instructions);
    if (briefPatch.brandColors && typeof briefPatch.brandColors === "object") {
      base.brandColors = { ...base.brandColors, ...briefPatch.brandColors };
    }
    if (briefPatch.brandKit && typeof briefPatch.brandKit === "object") {
      base.brandKit = normalizeBrandKit(base.brandKit, briefPatch.brandKit);
    }
    if (briefPatch.inspirationProfile !== undefined) {
      base.inspirationProfile =
        briefPatch.inspirationProfile === null
          ? null
          : {
              ...(base.inspirationProfile && typeof base.inspirationProfile === "object"
                ? base.inspirationProfile
                : {}),
              ...briefPatch.inspirationProfile,
            };
    }
    if (Array.isArray(briefPatch.sourceFolders)) {
      base.sourceFolders = [...new Set(briefPatch.sourceFolders.map(String).filter(Boolean))];
    }
    if (Array.isArray(briefPatch.referenceLinks)) {
      base.referenceLinks = briefPatch.referenceLinks;
    }
  }

  const probeCache = loadProbeCache(projectDir);

  const [
    rawVideo,
    inspiration,
    references,
    images,
    brand,
    audio,
    clips,
    assetImagesSub,
    assetImagesRoot,
    assetAudio,
    outputRenders,
    rendersDirFiles,
  ] = await Promise.all([
    scanDirectoryMedia(slug, projectDir, "inbox/raw-video", "raw-video", probeCache, {
      mediaOnly: false,
    }),
    scanDirectoryMedia(slug, projectDir, "inbox/inspiration", "inspiration", probeCache, {
      mediaOnly: false,
    }),
    scanDirectoryMedia(slug, projectDir, "inbox/references", "references", probeCache, {
      mediaOnly: false,
    }),
    scanDirectoryMedia(slug, projectDir, "inbox/images", "images", probeCache, {
      mediaOnly: false,
    }),
    scanDirectoryMedia(slug, projectDir, "inbox/brand", "brand", probeCache, {
      mediaOnly: false,
    }),
    scanDirectoryMedia(slug, projectDir, "inbox/audio", "audio", probeCache, { mediaOnly: false }),
    scanDirectoryMedia(slug, projectDir, "assets/clips", "clips", probeCache, { mediaOnly: true }),
    scanDirectoryMedia(slug, projectDir, "assets/images", "asset-images", probeCache, {
      mediaOnly: true,
    }),
    scanDirectoryMedia(slug, projectDir, "assets", "asset-images", probeCache, { mediaOnly: true }),
    scanDirectoryMedia(slug, projectDir, "assets/audio", "asset-audio", probeCache, {
      mediaOnly: true,
    }),
    scanDirectoryMedia(slug, projectDir, "output", "renders", probeCache, { mediaOnly: true }),
    scanDirectoryMedia(slug, projectDir, "renders", "renders", probeCache, { mediaOnly: true }),
  ]);

  saveProbeCache(projectDir, probeCache);

  // Deduplicate images if root assets/ had items also synced
  const assetImages = [...assetImagesSub, ...assetImagesRoot];
  const renders = [...outputRenders, ...rendersDirFiles].filter((f) => f.mediaType === "video");

  const manifest = {
    slug,
    title: base.title,
    aspectRatio: base.aspectRatio,
    width: base.width,
    height: base.height,
    fps: base.fps,
    durationSeconds: base.durationSeconds,
    language: base.language,
    brandColors: base.brandColors,
    brandKit: base.brandKit,
    inspirationProfile: base.inspirationProfile ?? null,
    sourceFolders: base.sourceFolders || [],
    instructions: base.instructions,
    referenceLinks: base.referenceLinks || [],
    hasIndexHtml: fs.existsSync(path.join(projectDir, "index.html")),
    files: {
      rawVideo,
      inspiration,
      references,
      images,
      brand,
      audio,
      clips,
      assetImages,
      assetAudio,
      renders,
    },
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(briefPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    path.join(projectDir, "AI_READY_PROMPT.md"),
    buildAiReadyPrompt(manifest),
    "utf8",
  );
  return manifest;
}

export function buildStarterIndexHtml({
  slug,
  title,
  width,
  height,
  fps,
  durationSeconds,
  brandColors,
}) {
  const primary = brandColors?.primary || "#1E824C";
  const secondary = brandColors?.secondary || "#2ECC71";
  const accent = brandColors?.accent || "#F1C40F";
  const bg = brandColors?.background || "#0A1612";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${escapeHtml(title)}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800&display=block"
      rel="stylesheet"
    />
    <style>
      :root {
        --brand-primary: ${primary};
        --brand-secondary: ${secondary};
        --brand-accent: ${accent};
        --brand-bg: ${bg};
      }
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: var(--brand-bg);
        font-family: "Inter", sans-serif;
        color: #f8fafc;
      }
      #root {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--brand-primary) 35%, #000) 0%, var(--brand-bg) 70%);
      }
      .scene-stage {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 12%;
        text-align: center;
      }
      .badge {
        display: inline-block;
        padding: 12px 24px;
        border-radius: 999px;
        background: var(--brand-primary);
        color: #ffffff;
        font-size: 24px;
        font-weight: 700;
        letter-spacing: 0.04em;
        margin-bottom: 28px;
      }
      .headline {
        font-size: ${width >= height ? 72 : 64}px;
        font-weight: 800;
        line-height: 1.12;
        color: #ffffff;
        margin-bottom: 20px;
      }
      .subline {
        font-size: ${width >= height ? 32 : 28}px;
        font-weight: 500;
        color: #cbd5e1;
        max-width: 820px;
      }
      .accent-bar {
        width: 120px;
        height: 8px;
        border-radius: 999px;
        background: var(--brand-accent);
        margin-top: 32px;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="${slug}"
      data-start="0"
      data-duration="${durationSeconds}"
      data-width="${width}"
      data-height="${height}"
      data-fps="${fps}"
    >
      <div id="intro-clip" class="clip scene-stage" data-start="0" data-duration="${durationSeconds}">
        <div id="hero-badge" class="badge" data-var-text="badge">STUDIO HUB READY</div>
        <h1 id="hero-title" class="headline" data-var-text="headline">${escapeHtml(title)}</h1>
        <p id="hero-subline" class="subline" data-var-text="subline">
          Raw media and references loaded. Ready for AI timeline editing.
        </p>
        <div id="hero-bar" class="accent-bar"></div>
      </div>
    </div>

    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });
        tl.fromTo("#hero-badge", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.2);
        tl.fromTo("#hero-title", { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }, 0.45);
        tl.fromTo("#hero-subline", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, 0.8);
        tl.fromTo("#hero-bar", { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.6, ease: "power2.out" }, 1.1);
        tl.to({}, { duration: 1 }, ${Math.max(0, Number(durationSeconds) - 1)});

        window.__timelines = window.__timelines || {};
        window.__timelines["${slug}"] = tl;
      })();
    </script>
  </body>
</html>
`;
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function createProject(input) {
  const title = String(input.title || "Untitled Video").trim();
  const slug = sanitizeSlug(input.slug || title);
  const projectDir = ensureProjectDirs(slug);

  const aspectRatio = ASPECT_DIMENSIONS[input.aspectRatio] ? input.aspectRatio : "9:16";
  const dims = ASPECT_DIMENSIONS[aspectRatio];
  const fps = Number(input.fps) || 30;
  const durationSeconds = Number(input.durationSeconds) || 30;
  const brandColors = {
    primary: input.brandColors?.primary || "#1E824C",
    secondary: input.brandColors?.secondary || "#2ECC71",
    accent: input.brandColors?.accent || "#F1C40F",
    background: input.brandColors?.background || "#0A1612",
  };

  const indexPath = path.join(projectDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      buildStarterIndexHtml({
        slug,
        title,
        width: dims.width,
        height: dims.height,
        fps,
        durationSeconds,
        brandColors,
      }),
      "utf8",
    );
  }

  const manifest = await syncProjectManifest(slug, {
    title,
    aspectRatio,
    width: dims.width,
    height: dims.height,
    fps,
    durationSeconds,
    language: input.language || "English",
    brandColors,
    instructions: input.instructions || "",
  });

  setCurrentProjectSlug(slug);
  return manifest;
}

export async function listProjects() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const activeSlug = readCurrentProjectSlug();
  const dirs = fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();

  const summaries = [];
  for (const slug of dirs) {
    const projectDir = path.join(PROJECTS_DIR, slug);
    const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
    let brief;
    if (fs.existsSync(briefPath)) {
      try {
        brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
      } catch {
        brief = await syncProjectManifest(slug);
      }
    } else {
      brief = await syncProjectManifest(slug);
    }

    const counts = {
      rawVideo: brief.files?.rawVideo?.length || 0,
      references: (brief.files?.references?.length || 0) + (brief.referenceLinks?.length || 0),
      images: (brief.files?.images?.length || 0) + (brief.files?.assetImages?.length || 0),
      audio: brief.files?.assetAudio?.length || 0,
      clips: brief.files?.clips?.length || 0,
      renders: brief.files?.renders?.length || 0,
    };

    summaries.push({
      slug,
      title: brief.title || slug,
      aspectRatio: brief.aspectRatio || "9:16",
      width: brief.width || 1080,
      height: brief.height || 1920,
      fps: brief.fps || 30,
      durationSeconds: brief.durationSeconds || 30,
      active: slug === activeSlug,
      counts,
      updatedAt: brief.updatedAt || null,
    });
  }

  return summaries;
}

function uniqueDestPath(dir, filename) {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}_${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

export async function ingestLocalFile({
  slug,
  sourcePath,
  category,
  move = false,
  targetFilename = null,
}) {
  if (!CATEGORIES.includes(category)) {
    throw new Error(`Invalid category "${category}". Use one of: ${CATEGORIES.join(", ")}`);
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  const projectDir = ensureProjectDirs(slug);
  const safeName = sanitizeFilename(targetFilename || path.basename(sourcePath));
  const inboxDir = path.join(projectDir, "inbox", category);
  const destInbox = uniqueDestPath(inboxDir, safeName);

  if (move) {
    try {
      fs.renameSync(sourcePath, destInbox);
    } catch {
      fs.copyFileSync(sourcePath, destInbox);
      fs.unlinkSync(sourcePath);
    }
  } else {
    fs.copyFileSync(sourcePath, destInbox);
  }

  const finalName = path.basename(destInbox);
  const assetSubdir = resolveAssetSubdir(category, finalName);
  let syncedAssetRelPath = null;
  if (assetSubdir) {
    const destAsset = path.join(projectDir, "assets", assetSubdir, finalName);
    fs.mkdirSync(path.dirname(destAsset), { recursive: true });
    fs.copyFileSync(destInbox, destAsset);
    syncedAssetRelPath = `assets/${assetSubdir}/${finalName}`;
  }

  const manifest = await syncProjectManifest(slug);
  return {
    slug,
    category,
    inboxRelPath: `inbox/${category}/${finalName}`,
    assetRelPath: syncedAssetRelPath,
    manifest,
  };
}

function looksLikeDirectMediaUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const ext = path.extname(u.pathname).toLowerCase();
    return VIDEO_EXTS.has(ext) || IMAGE_EXTS.has(ext) || AUDIO_EXTS.has(ext);
  } catch {
    return false;
  }
}

export async function ingestUrl({
  slug,
  url,
  category = "raw-video",
  title = "",
  notes = "",
  download = null,
}) {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl) throw new Error("URL is required");
  try {
    new URL(cleanUrl);
  } catch {
    throw new Error(`Invalid URL: ${cleanUrl}`);
  }

  const projectDir = ensureProjectDirs(slug);
  const shouldDownload = download !== null ? Boolean(download) : category === "raw-video";

  // Always record reference links when category === 'references'
  if (category === "references") {
    const manifest = await syncProjectManifest(slug);
    const links = Array.isArray(manifest.referenceLinks) ? [...manifest.referenceLinks] : [];
    if (!links.some((item) => item.url === cleanUrl)) {
      links.push({
        id: crypto.randomUUID(),
        url: cleanUrl,
        title: title.trim(),
        notes: notes.trim(),
        addedAt: new Date().toISOString(),
      });
    }
    await syncProjectManifest(slug, { referenceLinks: links });
    if (!shouldDownload) {
      return {
        mode: "reference-link",
        url: cleanUrl,
        manifest: await syncProjectManifest(slug),
      };
    }
  }

  const inboxDir = path.join(projectDir, "inbox", category);
  const beforeFiles = new Set(fs.readdirSync(inboxDir));
  let downloadedPath = null;

  // Try direct binary fetch first if URL clearly ends with a media extension
  if (looksLikeDirectMediaUrl(cleanUrl)) {
    try {
      const resp = await fetch(cleanUrl, { redirect: "follow" });
      const contentType = (resp.headers.get("content-type") || "").toLowerCase();
      if (resp.ok && !contentType.includes("text/html")) {
        const parsed = new URL(cleanUrl);
        const safeName = sanitizeFilename(
          path.basename(parsed.pathname) || `download_${Date.now()}.mp4`,
        );
        const dest = uniqueDestPath(inboxDir, safeName);
        const buf = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(dest, buf);
        downloadedPath = dest;
      }
    } catch {
      // Fall through to yt-dlp
    }
  }

  // Use yt-dlp for YouTube, TikTok, Reels, Facebook, Loom, Google Drive, etc.
  if (!downloadedPath) {
    const outTemplate = path.join(inboxDir, "dl_%(title).45s_%(id)s.%(ext)s");
    const args = [
      "--no-playlist",
      "--restrict-filenames",
      "-f",
      "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
      "--merge-output-format",
      "mp4",
      "-o",
      outTemplate,
      cleanUrl,
    ];
    const res = await runCommand("yt-dlp", args, { cwd: projectDir, shell: false });
    if (res.code !== 0) {
      throw new Error(
        `yt-dlp failed (${res.code}): ${(res.stderr || res.stdout).trim().slice(0, 600)}`,
      );
    }
    const afterFiles = fs
      .readdirSync(inboxDir)
      .filter((f) => !beforeFiles.has(f) && !f.endsWith(".part"));
    if (afterFiles.length > 0) {
      downloadedPath = path.join(inboxDir, afterFiles[0]);
    } else {
      // Pick newest file in inboxDir as fallback
      const newest = fs
        .readdirSync(inboxDir)
        .map((name) => ({ name, mtime: fs.statSync(path.join(inboxDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0];
      if (newest) downloadedPath = path.join(inboxDir, newest.name);
    }
  }

  if (!downloadedPath || !fs.existsSync(downloadedPath)) {
    throw new Error("Download completed but no media file was produced.");
  }

  const finalName = path.basename(downloadedPath);
  const assetSubdir = resolveAssetSubdir(category, finalName);
  let assetRelPath = null;
  if (assetSubdir) {
    const destAsset = path.join(projectDir, "assets", assetSubdir, finalName);
    fs.mkdirSync(path.dirname(destAsset), { recursive: true });
    fs.copyFileSync(downloadedPath, destAsset);
    assetRelPath = `assets/${assetSubdir}/${finalName}`;
  }

  const manifest = await syncProjectManifest(slug);
  return {
    mode: "downloaded",
    url: cleanUrl,
    inboxRelPath: `inbox/${category}/${finalName}`,
    assetRelPath,
    manifest,
  };
}

export function listLooseRootFiles() {
  const entries = fs.readdirSync(ROOT_DIR, { withFileTypes: true });
  const loose = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const mediaType = getMediaType(entry.name);
    if (mediaType === "other") continue;
    const stat = fs.statSync(path.join(ROOT_DIR, entry.name));
    loose.push({
      name: entry.name,
      mediaType,
      sizeBytes: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
    });
  }
  return loose.sort((a, b) => a.name.localeCompare(b.name));
}

export async function processDropFolder() {
  ensureDropStructure();
  const activeSlug = readCurrentProjectSlug();
  if (!activeSlug) return [];

  const moved = [];
  for (const category of CATEGORIES) {
    const catDir = path.join(DROP_DIR, category);
    if (!fs.existsSync(catDir)) continue;
    const entries = fs.readdirSync(catDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name === "README.txt" || entry.name.startsWith(".")) continue;
      const srcPath = path.join(catDir, entry.name);
      try {
        // Skip files actively being written (mtime within last 800ms)
        const stat = fs.statSync(srcPath);
        if (Date.now() - stat.mtimeMs < 800) continue;
        const result = await ingestLocalFile({
          slug: activeSlug,
          sourcePath: srcPath,
          category,
          move: true,
        });
        moved.push({
          file: entry.name,
          category,
          slug: activeSlug,
          inboxRelPath: result.inboxRelPath,
        });
      } catch {
        // File might still be locked by Explorer copy; retry on next poll
      }
    }
  }
  return moved;
}

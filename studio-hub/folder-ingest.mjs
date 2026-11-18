import fs from "node:fs";
import path from "node:path";
import {
  CATEGORIES,
  getToolEnv,
  ingestLocalFile,
  resolvePythonBin,
  ROOT_DIR,
  runCommand,
  syncProjectManifest,
} from "./lib.mjs";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const BRAND_DOC_EXTS = new Set([".pdf", ".md", ".txt", ".json"]);
const FONT_EXTS = new Set([".ttf", ".otf", ".woff", ".woff2"]);

const IGNORED_DIRS = new Set([".git", "node_modules", "__pycache__", ".studio", ".hyperframes"]);
const IGNORED_FILES = new Set(["desktop.ini", "thumbs.db", ".ds_store"]);

function classifyExternalMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return "video";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (BRAND_DOC_EXTS.has(ext)) return "brandDoc";
  if (FONT_EXTS.has(ext)) return "font";
  return null;
}

function matchesImportCategory(mediaType, category) {
  switch (category) {
    case "raw-video":
      return mediaType === "video";
    case "inspiration":
      return mediaType === "video" || mediaType === "image";
    case "images":
      return mediaType === "image";
    case "audio":
      return mediaType === "audio";
    case "brand":
      return mediaType === "image" || mediaType === "brandDoc" || mediaType === "font";
    case "references":
    case "auto":
      return Boolean(mediaType);
    default:
      return Boolean(mediaType);
  }
}

function resolveTargetCategory(mediaType, requestedCategory) {
  if (requestedCategory !== "auto") {
    return requestedCategory;
  }
  if (mediaType === "video") return "raw-video";
  if (mediaType === "image") return "images";
  if (mediaType === "audio") return "audio";
  return "brand";
}

export function scanExternalFolder(folderPath, { recursive = true } = {}) {
  const rawInput = String(folderPath || "").trim();
  if (!rawInput) {
    throw new Error("folderPath is required");
  }
  const resolvedFolder = path.resolve(rawInput);
  if (!fs.existsSync(resolvedFolder)) {
    throw new Error(`External folder not found: ${resolvedFolder}`);
  }
  const rootStat = fs.statSync(resolvedFolder);
  if (!rootStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolvedFolder}`);
  }

  const counts = {
    video: 0,
    image: 0,
    audio: 0,
    brandDoc: 0,
    font: 0,
  };
  const files = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (IGNORED_FILES.has(entry.name.toLowerCase())) continue;

      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !IGNORED_DIRS.has(entry.name)) {
          walk(absPath);
        }
        continue;
      }
      if (!entry.isFile()) continue;

      const mediaType = classifyExternalMediaType(entry.name);
      if (!mediaType) continue;

      const stat = fs.statSync(absPath);
      const ext = path.extname(entry.name).toLowerCase();
      const relFromFolder = path.relative(resolvedFolder, absPath).replaceAll("\\", "/");
      counts[mediaType] += 1;

      files.push({
        name: entry.name,
        absPath,
        relFromFolder,
        mediaType,
        ext,
        sizeBytes: stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
      });
    }
  }

  walk(resolvedFolder);
  files.sort((a, b) => a.relFromFolder.localeCompare(b.relFromFolder));

  return {
    folderPath: resolvedFolder,
    totalFiles: files.length,
    counts,
    files,
  };
}

export async function importExternalFolder({
  slug,
  folderPath,
  category = "raw-video",
  selectedFiles = null,
  recursive = true,
}) {
  if (category !== "auto" && !CATEGORIES.includes(category)) {
    throw new Error(`Invalid category "${category}". Use one of: ${CATEGORIES.join(", ")}`);
  }

  const scanned = scanExternalFolder(folderPath, { recursive });
  let candidates = scanned.files;

  if (Array.isArray(selectedFiles)) {
    const selectedLookup = new Set();
    for (const item of selectedFiles) {
      const token = String(item || "").trim();
      if (!token) continue;
      selectedLookup.add(token);
      selectedLookup.add(token.replaceAll("\\", "/"));
      selectedLookup.add(path.resolve(scanned.folderPath, token));
    }
    candidates = candidates.filter(
      (f) =>
        selectedLookup.has(f.relFromFolder) ||
        selectedLookup.has(f.absPath) ||
        selectedLookup.has(f.name),
    );
  } else {
    candidates = candidates.filter((f) => matchesImportCategory(f.mediaType, category));
  }

  const importedFiles = [];
  for (const file of candidates) {
    const targetCategory = resolveTargetCategory(file.mediaType, category);
    const res = await ingestLocalFile({
      slug,
      sourcePath: file.absPath,
      category: targetCategory,
      move: false,
    });
    importedFiles.push({
      sourceAbsPath: file.absPath,
      relFromFolder: file.relFromFolder,
      mediaType: file.mediaType,
      category: targetCategory,
      inboxRelPath: res.inboxRelPath,
      assetRelPath: res.assetRelPath,
    });
  }

  const currentManifest = await syncProjectManifest(slug);
  const existingFolders = Array.isArray(currentManifest.sourceFolders)
    ? currentManifest.sourceFolders
    : [];
  const nextFolders = [...new Set([...existingFolders, folderPath])];
  const manifest = await syncProjectManifest(slug, { sourceFolders: nextFolders });

  return {
    importedCount: importedFiles.length,
    importedFiles,
    sourceFolder: folderPath,
    manifest,
  };
}

export async function runMediaIntelligence(subcommand, argsArray = []) {
  if (!subcommand || typeof subcommand !== "string") {
    throw new Error("subcommand is required for runMediaIntelligence");
  }
  const scriptPath = path.join(ROOT_DIR, "studio-hub", "media_intelligence.py");
  const env = { ...getToolEnv(), PYTHONIOENCODING: "utf-8" };
  const cliArgs = [scriptPath, subcommand, ...argsArray.map((a) => String(a))];

  const res = await runCommand(resolvePythonBin(), cliArgs, {
    cwd: ROOT_DIR,
    env,
    shell: false,
  });

  const trimmed = (res.stdout || "").trim();
  let parsed = null;
  if (trimmed) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      const lines = trimmed
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("{") && l.endsWith("}"));
      if (lines.length > 0) {
        parsed = JSON.parse(lines[lines.length - 1]);
      }
    }
  }

  if (res.code !== 0) {
    const detail = parsed?.error || (res.stderr || res.stdout || "").trim().slice(0, 600);
    throw new Error(`media_intelligence.py ${subcommand} failed (${res.code}): ${detail}`);
  }
  if (!parsed) {
    throw new Error(
      `media_intelligence.py ${subcommand} returned non-JSON output: ${trimmed.slice(0, 300)}`,
    );
  }
  return parsed;
}

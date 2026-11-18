import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROJECTS_DIR, ROOT_DIR, assertValidSlug, probeMedia, runCommand } from "./lib.mjs";

const VOLATILE_FRAME_KEYS = new Set([
  "updatedAt",
  "createdAt",
  "history",
  "approved",
  "locked",
  "designFrameUrl",
  "hudFrameUrl",
  "currentDesignImage",
  "currentBlueprintImage",
]);

const FULL_HASH_MAX_BYTES = 32 * 1024 * 1024;
const CHUNK_SAMPLE_BYTES = 1024 * 1024;

function canonicalizeValue(value, stripVolatile = false) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item, stripVolatile));
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    if (stripVolatile && VOLATILE_FRAME_KEYS.has(key)) continue;
    const child = value[key];
    if (child !== undefined) {
      sorted[key] = canonicalizeValue(child, stripVolatile);
    }
  }
  return sorted;
}

function computeClipFingerprint(clipPath) {
  if (!clipPath) return null;
  const resolved = path.resolve(String(clipPath));
  if (!fs.existsSync(resolved)) {
    return {
      exists: false,
      normalizedRef: String(clipPath).replaceAll("\\", "/"),
    };
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    return { exists: false, normalizedRef: String(clipPath).replaceAll("\\", "/") };
  }

  if (stat.size <= FULL_HASH_MAX_BYTES) {
    const digest = crypto.createHash("sha256").update(fs.readFileSync(resolved)).digest("hex");
    return {
      exists: true,
      sizeBytes: stat.size,
      sha256: digest,
    };
  }

  const fd = fs.openSync(resolved, "r");
  try {
    const headLen = Math.min(CHUNK_SAMPLE_BYTES, stat.size);
    const headBuf = Buffer.alloc(headLen);
    fs.readSync(fd, headBuf, 0, headLen, 0);

    const tailLen = Math.min(CHUNK_SAMPLE_BYTES, stat.size);
    const tailOffset = Math.max(0, stat.size - tailLen);
    const tailBuf = Buffer.alloc(tailLen);
    fs.readSync(fd, tailBuf, 0, tailLen, tailOffset);

    const sampleDigest = crypto.createHash("sha256").update(headBuf).update(tailBuf).digest("hex");

    return {
      exists: true,
      sizeBytes: stat.size,
      sampleSha256: sampleDigest,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function resolveProjectCacheDir(slug, projectsDir = PROJECTS_DIR) {
  let projectDir;
  if (path.resolve(projectsDir) === path.resolve(PROJECTS_DIR)) {
    projectDir = assertValidSlug(slug);
  } else {
    if (!slug || !/^[a-z0-9][a-z0-9_-]*$/i.test(String(slug))) {
      throw new Error(`Invalid project slug: ${slug}`);
    }
    const base = path.resolve(projectsDir);
    projectDir = path.resolve(base, String(slug));
    if (!projectDir.startsWith(base + path.sep)) {
      throw new Error(`Unsafe project slug path: ${slug}`);
    }
  }
  const cacheDir = path.join(projectDir, ".studio", "scene-cache");
  return { projectDir, cacheDir };
}

function validateSceneId(sceneId) {
  const raw = String(sceneId || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(raw)) {
    throw new Error(`Invalid sceneId "${sceneId}". Only alphanumeric, "_" and "-" are allowed.`);
  }
  return raw;
}

function validateContentHash(hash) {
  const raw = String(hash || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{16,64}$/.test(raw)) {
    throw new Error(`Invalid scene content hash "${hash}". Expected hex SHA-256 digest.`);
  }
  return raw;
}

function loadCacheIndex(cacheDir) {
  const indexPath = path.join(cacheDir, "index.json");
  if (!fs.existsSync(indexPath)) {
    return { schemaVersion: 1, entries: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    return {
      schemaVersion: 1,
      entries: parsed?.entries && typeof parsed.entries === "object" ? parsed.entries : {},
    };
  } catch {
    return { schemaVersion: 1, entries: {} };
  }
}

function saveCacheIndex(cacheDir, indexData) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const indexPath = path.join(cacheDir, "index.json");
  fs.writeFileSync(
    indexPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        entries: indexData.entries || {},
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export function computeSceneContentHash({
  frame = {},
  sceneHtml = "",
  clipPath = null,
  audioSpec = null,
  width = 1080,
  height = 1920,
  fps = 30,
} = {}) {
  const normalizedHtml = String(sceneHtml ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const payload = {
    schemaVersion: 1,
    canvas: {
      width: Number(width) || 1080,
      height: Number(height) || 1920,
      fps: Number(fps) || 30,
    },
    frame: canonicalizeValue(frame || {}, true),
    audioSpec: canonicalizeValue(audioSpec ?? frame?.audioSpec ?? {}, false),
    sceneHtml: normalizedHtml,
    clip: computeClipFingerprint(clipPath),
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function lookupCachedSceneRender({ slug, sceneId, hash, projectsDir = PROJECTS_DIR } = {}) {
  const { cacheDir } = resolveProjectCacheDir(slug, projectsDir);
  const safeSceneId = validateSceneId(sceneId);
  const safeHash = validateContentHash(hash);
  const fileName = `${safeSceneId}_${safeHash}.mp4`;
  const absTarget = path.resolve(cacheDir, fileName);

  if (!absTarget.startsWith(cacheDir + path.sep)) {
    throw new Error("Invalid cache target path");
  }

  if (!fs.existsSync(absTarget)) {
    return {
      hit: false,
      slug,
      sceneId: safeSceneId,
      hash: safeHash,
      cachedMp4Path: null,
      relPath: null,
      sizeBytes: 0,
      storedAt: null,
    };
  }

  const stat = fs.statSync(absTarget);
  if (!stat.isFile() || stat.size === 0) {
    return {
      hit: false,
      slug,
      sceneId: safeSceneId,
      hash: safeHash,
      cachedMp4Path: null,
      relPath: null,
      sizeBytes: 0,
      storedAt: null,
    };
  }

  const indexData = loadCacheIndex(cacheDir);
  const entryKey = `${safeSceneId}:${safeHash}`;
  const meta = indexData.entries[entryKey] || null;

  return {
    hit: true,
    slug,
    sceneId: safeSceneId,
    hash: safeHash,
    cachedMp4Path: absTarget,
    relPath: `.studio/scene-cache/${fileName}`,
    sizeBytes: stat.size,
    storedAt: meta?.storedAt || new Date(stat.mtimeMs).toISOString(),
  };
}

export function storeCachedSceneRender({
  slug,
  sceneId,
  hash,
  renderedMp4Path,
  projectsDir = PROJECTS_DIR,
  maxVersionsPerScene = 4,
} = {}) {
  const { cacheDir } = resolveProjectCacheDir(slug, projectsDir);
  const safeSceneId = validateSceneId(sceneId);
  const safeHash = validateContentHash(hash);

  if (!renderedMp4Path) {
    throw new Error("renderedMp4Path is required to store cached scene render.");
  }
  const absSource = path.resolve(String(renderedMp4Path));
  if (!fs.existsSync(absSource) || !fs.statSync(absSource).isFile()) {
    throw new Error(`Rendered scene MP4 not found: ${absSource}`);
  }
  const srcStat = fs.statSync(absSource);
  if (srcStat.size === 0) {
    throw new Error(`Rendered scene MP4 is empty (0 bytes): ${absSource}`);
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  const fileName = `${safeSceneId}_${safeHash}.mp4`;
  const absDest = path.resolve(cacheDir, fileName);
  if (!absDest.startsWith(cacheDir + path.sep)) {
    throw new Error("Invalid cache destination path");
  }

  if (absSource !== absDest) {
    const tmpDest = `${absDest}.tmp_${crypto.randomUUID().slice(0, 8)}`;
    fs.copyFileSync(absSource, tmpDest);
    fs.renameSync(tmpDest, absDest);
  }

  const storedAt = new Date().toISOString();
  const indexData = loadCacheIndex(cacheDir);
  const entryKey = `${safeSceneId}:${safeHash}`;
  indexData.entries[entryKey] = {
    sceneId: safeSceneId,
    hash: safeHash,
    fileName,
    relPath: `.studio/scene-cache/${fileName}`,
    sizeBytes: srcStat.size,
    storedAt,
  };

  // Prune oldest cached renders for this sceneId beyond maxVersionsPerScene
  if (Number.isFinite(maxVersionsPerScene) && maxVersionsPerScene > 0) {
    const matchingKeys = Object.keys(indexData.entries)
      .filter((k) => indexData.entries[k]?.sceneId === safeSceneId)
      .sort((a, b) =>
        String(indexData.entries[b]?.storedAt || "").localeCompare(
          String(indexData.entries[a]?.storedAt || ""),
        ),
      );
    for (const staleKey of matchingKeys.slice(maxVersionsPerScene)) {
      const staleEntry = indexData.entries[staleKey];
      if (staleEntry?.fileName) {
        const stalePath = path.resolve(cacheDir, staleEntry.fileName);
        if (stalePath.startsWith(cacheDir + path.sep) && fs.existsSync(stalePath)) {
          try {
            fs.unlinkSync(stalePath);
          } catch {
            // Best-effort cleanup
          }
        }
      }
      delete indexData.entries[staleKey];
    }
  }

  saveCacheIndex(cacheDir, indexData);

  return {
    ok: true,
    slug,
    sceneId: safeSceneId,
    hash: safeHash,
    cachedMp4Path: absDest,
    relPath: `.studio/scene-cache/${fileName}`,
    sizeBytes: srcStat.size,
    storedAt,
  };
}

function escapeConcatPath(absPath) {
  const posixStyle = path.resolve(absPath).replaceAll("\\", "/");
  return `file '${posixStyle.replaceAll("'", "'\\''")}'`;
}

export async function stitchCachedScenesMp4({
  sceneMp4Paths,
  masterAudioPath = null,
  outPath,
} = {}) {
  if (!Array.isArray(sceneMp4Paths) || sceneMp4Paths.length === 0) {
    throw new Error("stitchCachedScenesMp4 requires a non-empty array of sceneMp4Paths.");
  }
  if (!outPath) {
    throw new Error("stitchCachedScenesMp4 requires outPath.");
  }

  const resolvedScenes = sceneMp4Paths.map((p, idx) => {
    const abs = path.resolve(String(p || ""));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile() || fs.statSync(abs).size === 0) {
      throw new Error(`Scene MP4 at index ${idx} does not exist or is empty: ${abs}`);
    }
    return abs;
  });

  let resolvedAudio = null;
  if (masterAudioPath) {
    const absAudio = path.resolve(String(masterAudioPath));
    if (!fs.existsSync(absAudio) || !fs.statSync(absAudio).isFile()) {
      throw new Error(`Master audio file not found: ${absAudio}`);
    }
    resolvedAudio = absAudio;
  }

  const absOut = path.resolve(String(outPath));
  fs.mkdirSync(path.dirname(absOut), { recursive: true });

  const concatManifestPath = path.join(
    os.tmpdir(),
    `hf_delta_concat_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}.txt`,
  );
  const manifestLines = resolvedScenes.map(escapeConcatPath).join("\n") + "\n";
  fs.writeFileSync(concatManifestPath, manifestLines, "utf8");

  try {
    const copyArgs = resolvedAudio
      ? [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatManifestPath,
          "-i",
          resolvedAudio,
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          "-movflags",
          "+faststart",
          absOut,
        ]
      : [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatManifestPath,
          "-map",
          "0:v:0",
          "-c:v",
          "copy",
          "-an",
          "-movflags",
          "+faststart",
          absOut,
        ];

    let res = await runCommand("ffmpeg", copyArgs, { cwd: ROOT_DIR, shell: false });

    // Fallback to clean H.264 re-encode if cached scenes had mixed stream parameters
    if (res.code !== 0 || !fs.existsSync(absOut) || fs.statSync(absOut).size === 0) {
      const reencodeArgs = resolvedAudio
        ? [
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concatManifestPath,
            "-i",
            resolvedAudio,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-preset",
            "fast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-movflags",
            "+faststart",
            absOut,
          ]
        : [
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concatManifestPath,
            "-map",
            "0:v:0",
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-preset",
            "fast",
            "-pix_fmt",
            "yuv420p",
            "-an",
            "-movflags",
            "+faststart",
            absOut,
          ];

      res = await runCommand("ffmpeg", reencodeArgs, { cwd: ROOT_DIR, shell: false });
      if (res.code !== 0 || !fs.existsSync(absOut)) {
        throw new Error(
          `FFmpeg scene stitch failed: ${(res.stderr || res.stdout).trim().slice(-600)}`,
        );
      }
    }

    const probe = await probeMedia(absOut);
    return {
      ok: true,
      outPath: absOut,
      sceneCount: resolvedScenes.length,
      hasMasterAudio: Boolean(resolvedAudio),
      probe,
    };
  } finally {
    if (fs.existsSync(concatManifestPath)) {
      try {
        fs.unlinkSync(concatManifestPath);
      } catch {
        // Ignore temp cleanup error
      }
    }
  }
}

export function getSceneCacheStats({ slug, projectsDir = PROJECTS_DIR } = {}) {
  const { cacheDir } = resolveProjectCacheDir(slug, projectsDir);
  if (!fs.existsSync(cacheDir)) {
    return { slug, entryCount: 0, totalBytes: 0, entries: [] };
  }
  const indexData = loadCacheIndex(cacheDir);
  const entries = Object.values(indexData.entries || {}).filter((entry) => {
    if (!entry?.fileName) return false;
    const p = path.resolve(cacheDir, entry.fileName);
    return p.startsWith(cacheDir + path.sep) && fs.existsSync(p);
  });
  const totalBytes = entries.reduce((sum, item) => sum + (Number(item.sizeBytes) || 0), 0);
  return {
    slug,
    entryCount: entries.length,
    totalBytes,
    entries,
  };
}

export function clearSceneCache({ slug, projectsDir = PROJECTS_DIR } = {}) {
  const { cacheDir } = resolveProjectCacheDir(slug, projectsDir);
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  return { ok: true, slug };
}

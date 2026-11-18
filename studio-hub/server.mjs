import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertValidSlug,
  CATEGORIES,
  checkTools,
  createProject,
  DROP_DIR,
  ensureDropStructure,
  ensureProjectDirs,
  getMediaType,
  getToolEnv,
  ingestLocalFile,
  ingestUrl,
  listLooseRootFiles,
  listProjects,
  processDropFolder,
  PROJECTS_DIR,
  readCurrentProjectSlug,
  ROOT_DIR,
  runCommand,
  sanitizeFilename,
  setCurrentProjectSlug,
  syncProjectManifest,
} from "./lib.mjs";
import {
  importExternalFolder,
  runMediaIntelligence,
  scanExternalFolder,
} from "./folder-ingest.mjs";
import {
  generateStoryboard,
  LAYOUT_ARCHETYPES,
  loadStoryboard,
  MOTION_PRESETS,
  regenerateFrame,
  saveStoryboard,
  updateFrame,
} from "./storyboard.mjs";
import {
  broadcastEvent,
  enqueueAgentTask,
  getAgentCrewState,
  getProviderSettings,
  listAgentTasks,
  saveProviderSettings,
  setAgentStatus,
  subscribeSse,
} from "./agent-bridge.mjs";
import { compileProjectVideo } from "./video-compiler.mjs";
import { handleProRoutes } from "./routes-pro.mjs";
import { handleV2Routes } from "./routes-v2.mjs";
import { handleV3Routes } from "./routes-v3.mjs";
import { handleV4Routes } from "./routes-v4.mjs";
import {
  compileSkillDirectives,
  getSelectedProjectSkills,
  setSelectedProjectSkills,
} from "./skills-registry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_PORT = Number(process.env.STUDIO_HUB_PORT) || 4400;

const BRAND_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const BRAND_DOC_EXTS = new Set([".pdf", ".md", ".txt", ".json"]);

const TASK_TYPE_TO_AGENT = {
  ai_storyboard_direct: "storyboard-director",
  ai_regenerate_frame: "frame-designer",
  ai_generate_image_plate: "frame-designer",
  ai_google_flow_video: "google-flow-video",
  ai_full_video_edit: "hyperframes-qa",
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const jobs = new Map();
const projectJobIds = new Map();

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: message });
}

function classifyErrorStatus(err) {
  const msg = err instanceof Error ? err.message : String(err || "");
  if (/zeroCostGuard/i.test(msg)) return 403;
  if (/forbidden|restricted|unsafe project path/i.test(msg)) return 403;
  if (/not found/i.test(msg)) return 404;
  if (
    /invalid|unsupported|required|payload too large|malformed|not a directory|version .* not found/i.test(
      msg,
    )
  ) {
    return 400;
  }
  return 500;
}

function readJsonBody(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += buf.length;
      if (total > maxBytes) {
        reject(new Error("Request payload too large"));
        req.destroy();
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
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function serveFileWithRange(req, res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start >= stat.size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": contentType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, {
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
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

  if (path.isAbsolute(str)) {
    const rel = path.relative(projectDir, path.resolve(str)).replaceAll("\\", "/");
    if (!rel.startsWith("..")) {
      return rel;
    }
  }

  let norm = str.replaceAll("\\", "/");
  const slugName = path.basename(projectDir);
  const marker = `/projects/${slugName}/`;
  const idx = norm.toLowerCase().indexOf(marker.toLowerCase());
  if (idx !== -1) {
    norm = norm.slice(idx + marker.length);
  }
  return norm.replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function toProjectMediaUrl(slug, projectDir, rawPath) {
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
  if (!rel) return "";
  const encoded = rel.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `/media/${encodeURIComponent(slug)}/${encoded}`;
}

function decorateFrameForUi(slug, projectDir, frame) {
  if (!frame || typeof frame !== "object") return frame;

  const designUrl = toProjectMediaUrl(
    slug,
    projectDir,
    frame.designFrameUrl || frame.currentDesignImage || frame.designFramePath,
  );
  const hudUrl =
    toProjectMediaUrl(
      slug,
      projectDir,
      frame.hudFrameUrl || frame.currentBlueprintImage || frame.hudFramePath,
    ) || designUrl;

  const kfSrc = frame.keyframes || {};
  const keyframes = {
    start: toProjectMediaUrl(slug, projectDir, kfSrc.start) || null,
    peak: toProjectMediaUrl(slug, projectDir, kfSrc.peak) || null,
    end: toProjectMediaUrl(slug, projectDir, kfSrc.end) || null,
  };

  let rawKeyframes;
  if (Array.isArray(frame.rawKeyframes)) {
    rawKeyframes = frame.rawKeyframes
      .map((item) => toProjectMediaUrl(slug, projectDir, item))
      .filter(Boolean);
  } else if (frame.rawKeyframes && typeof frame.rawKeyframes === "object") {
    rawKeyframes = {
      start: toProjectMediaUrl(slug, projectDir, frame.rawKeyframes.start) || keyframes.start,
      peak: toProjectMediaUrl(slug, projectDir, frame.rawKeyframes.peak) || keyframes.peak,
      end: toProjectMediaUrl(slug, projectDir, frame.rawKeyframes.end) || keyframes.end,
    };
  } else {
    rawKeyframes = { ...keyframes };
  }

  const history = Array.isArray(frame.history)
    ? frame.history.map((snap) => {
        const snapDesign = toProjectMediaUrl(
          slug,
          projectDir,
          snap?.designFrameUrl || snap?.currentDesignImage || snap?.image || snap?.designFramePath,
        );
        const snapHud =
          toProjectMediaUrl(
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
    rawKeyframes,
    history,
  };
}

export function decorateStoryboardForUi(slug, sb) {
  if (!sb || typeof sb !== "object") return null;
  const projectDir = path.join(PROJECTS_DIR, slug);
  const frames = Array.isArray(sb.frames)
    ? sb.frames.map((f) => decorateFrameForUi(slug, projectDir, f))
    : [];
  return {
    ...sb,
    frames,
  };
}

function broadcastStoryboardUpdated(slug, decoratedSb) {
  const payload = { slug, storyboard: decoratedSb };
  broadcastEvent("storyboard_updated", payload);
  broadcastEvent("storyboard-updated", payload);
}

function registerJob(slug, job) {
  jobs.set(job.id, job);
  const ids = projectJobIds.get(slug) || [];
  ids.unshift(job.id);
  projectJobIds.set(slug, ids.slice(0, 20));
  return job;
}

function appendJobOutput(job, text) {
  job.output += String(text || "");
  if (job.output.length > 64000) {
    job.output = job.output.slice(-64000);
  }
}

function getProjectJobs(slug) {
  const ids = projectJobIds.get(slug) || [];
  return ids.map((id) => jobs.get(id)).filter(Boolean);
}

function startHyperframesJob(slug, action) {
  assertValidSlug(slug);
  const id = crypto.randomUUID().slice(0, 8);
  const projRel = `projects/${slug}`;

  const actionMap = {
    lint: { label: "HyperFrames Lint", args: ["hyperframes", "lint", projRel] },
    check: {
      label: "HyperFrames Check (Browser Gate)",
      args: ["hyperframes", "check", "--json", projRel],
    },
    "render-draft": {
      label: "Render Draft MP4",
      args: [
        "hyperframes",
        "render",
        "--quality",
        "draft",
        "-o",
        `${projRel}/output/${slug}_draft.mp4`,
        projRel,
      ],
    },
    "render-final": {
      label: "Render Delivery MP4",
      args: [
        "hyperframes",
        "render",
        "--quality",
        "delivery",
        "-o",
        `${projRel}/output/${slug}_final.mp4`,
        projRel,
      ],
    },
  };

  const spec = actionMap[action];
  if (!spec) {
    throw new Error(`Unsupported action: ${action}`);
  }

  const job = registerJob(slug, {
    id,
    slug,
    action,
    label: spec.label,
    status: "running",
    stage: null,
    progress: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    output: "",
    result: null,
    error: null,
  });

  const child = spawn("npx", spec.args, {
    cwd: ROOT_DIR,
    env: getToolEnv(),
    shell: process.platform === "win32",
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => appendJobOutput(job, chunk));
  child.stderr?.on("data", (chunk) => appendJobOutput(job, chunk));
  child.on("error", (err) => {
    appendJobOutput(job, `\nProcess error: ${err.message}\n`);
    job.status = "failed";
    job.exitCode = 1;
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
    broadcastEvent("job_updated", { slug, job });
  });
  child.on("close", async (code) => {
    job.exitCode = code ?? 1;
    job.status = code === 0 ? "done" : "failed";
    job.progress = code === 0 ? 1 : job.progress;
    job.finishedAt = new Date().toISOString();
    try {
      await syncProjectManifest(slug);
    } catch {
      // Best-effort refresh
    }
    broadcastEvent("job_updated", { slug, job });
  });

  return job;
}

function startVideoCompileJob(slug, initialBrief, settings = {}) {
  assertValidSlug(slug);
  const jobId = `cmp_${crypto.randomUUID().slice(0, 8)}`;

  const job = registerJob(slug, {
    id: jobId,
    slug,
    action: "generate-video",
    label: "5-Stage Video Compiler",
    status: "running",
    stage: "slice-clips",
    progress: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    output: "",
    result: null,
    error: null,
  });

  (async () => {
    try {
      const brief = initialBrief || (await syncProjectManifest(slug));
      let storyboard = settings.storyboard || loadStoryboard(slug);
      if (!storyboard || !Array.isArray(storyboard.frames) || storyboard.frames.length === 0) {
        appendJobOutput(job, "[storyboard] Auto-generating initial storyboard frames...\n");
        const cachedRawPath = path.join(assertValidSlug(slug), ".studio", "raw-analysis.json");
        let rawAnalysis = null;
        if (fs.existsSync(cachedRawPath)) {
          try {
            rawAnalysis = JSON.parse(fs.readFileSync(cachedRawPath, "utf8"));
          } catch {
            rawAnalysis = null;
          }
        }
        const activeSkills = Array.isArray(settings.selectedSkills)
          ? await setSelectedProjectSkills(slug, settings.selectedSkills)
          : await getSelectedProjectSkills(slug);
        const compiledSkillDirectives =
          settings.compiledSkillDirectives ||
          (activeSkills.length > 0
            ? compileSkillDirectives({ slug, skillIds: activeSkills })
            : null);
        storyboard = await generateStoryboard({
          slug,
          projectBrief: brief,
          rawAnalysis,
          inspirationProfile: brief?.inspirationProfile || null,
          selectedSkills: activeSkills,
          compiledSkillDirectives,
        });
      }

      const compileSettings = { ...settings };
      delete compileSettings.storyboard;

      const result = await compileProjectVideo({
        slug,
        storyboard,
        brief,
        settings: compileSettings,
        onProgress: (p) => {
          if (p?.stage) job.stage = p.stage;
          if (typeof p?.progress === "number") job.progress = p.progress;
          appendJobOutput(job, `[${p?.stage || "compiler"}] ${p?.message || ""}\n`);
          const evtPayload = { slug, jobId: job.id, ...p };
          broadcastEvent("compile_progress", evtPayload);
          broadcastEvent("compile-progress", evtPayload);
        },
      });

      job.status = "done";
      job.stage = "done";
      job.progress = 1;
      job.exitCode = 0;
      job.finishedAt = new Date().toISOString();
      job.result = {
        outputRelPath: result.outputRelPath,
        totalDuration: result.totalDuration,
        sceneCount: result.sceneCount,
        probe: result.probe,
      };
      appendJobOutput(
        job,
        `\nCompilation succeeded: ${result.outputRelPath || "Compositions validated cleanly"}\n`,
      );
      broadcastEvent("job_updated", { slug, job });
      broadcastEvent("compile-progress", {
        slug,
        jobId: job.id,
        stage: "done",
        status: "done",
        done: true,
        outputRelPath: result.outputRelPath,
        message: result.outputRelPath ? `Rendered ${result.outputRelPath}` : "Validated cleanly",
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      job.status = "failed";
      job.exitCode = 1;
      job.error = errMsg;
      job.finishedAt = new Date().toISOString();
      appendJobOutput(job, `\nCompilation failed: ${errMsg}\n`);
      broadcastEvent("job_updated", { slug, job });
      broadcastEvent("compile-progress", {
        slug,
        jobId: job.id,
        stage: job.stage || "render",
        status: "failed",
        message: errMsg,
      });
    }
  })();

  return job;
}

function resolveConfinedFile(projectDir, relPath) {
  const cleanRel = String(relPath || "")
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
  if (!cleanRel || cleanRel.includes("..")) {
    throw new Error(`Invalid relPath: ${relPath}`);
  }
  const abs = path.resolve(projectDir, cleanRel);
  if (!abs.startsWith(projectDir + path.sep)) {
    throw new Error(`Unsafe relPath outside project: ${relPath}`);
  }
  return { abs, relPath: cleanRel };
}

function listVideosInSubdir(projectDir, relSubdir) {
  const absDir = path.join(projectDir, relSubdir);
  if (!fs.existsSync(absDir)) return [];
  return fs
    .readdirSync(absDir, { withFileTypes: true })
    .filter((e) => e.isFile() && getMediaType(e.name) === "video")
    .map((e) => {
      const abs = path.join(absDir, e.name);
      const stat = fs.statSync(abs);
      return {
        abs,
        relPath: `${relSubdir.replaceAll("\\", "/")}/${e.name}`,
        mtimeMs: stat.mtimeMs,
        name: e.name,
      };
    });
}

function findFirstMatchingFile(projectDir, relSubdirs, extSet) {
  for (const relSubdir of relSubdirs) {
    const absDir = path.join(projectDir, relSubdir);
    if (!fs.existsSync(absDir)) continue;
    const entries = fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.isFile() && extSet.has(path.extname(e.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length > 0) {
      const chosen = entries[0];
      const prefix = relSubdir ? `${relSubdir.replaceAll("\\", "/")}/` : "";
      return {
        abs: path.join(absDir, chosen.name),
        relPath: `${prefix}${chosen.name}`,
      };
    }
  }
  return null;
}

function readCachedRawAnalysis(projectDir) {
  const cachePath = path.join(projectDir, ".studio", "raw-analysis.json");
  if (!fs.existsSync(cachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch {
    return null;
  }
}

async function performAnalyzeRaw(slug, { relPath, targetScenes = 6 } = {}) {
  const projectDir = ensureProjectDirs(slug);
  let targetVideo = null;

  if (relPath) {
    const resolved = resolveConfinedFile(projectDir, relPath);
    if (!fs.existsSync(resolved.abs)) {
      throw new Error(`Raw video file not found: ${resolved.relPath}`);
    }
    targetVideo = resolved;
  } else {
    const candidates = [
      ...listVideosInSubdir(projectDir, "inbox/raw-video"),
      ...listVideosInSubdir(projectDir, "assets/clips"),
    ];
    if (candidates.length > 0) {
      targetVideo = { abs: candidates[0].abs, relPath: candidates[0].relPath };
    }
  }

  if (!targetVideo) {
    throw new Error("No raw video found in inbox/raw-video or assets/clips");
  }

  const rawFramesDir = path.join(projectDir, ".studio", "frames", "raw");
  fs.mkdirSync(rawFramesDir, { recursive: true });

  const desiredCount = Math.max(1, Number(targetScenes) || 6);
  const rawResult = await runMediaIntelligence("analyze-raw", [
    "--video",
    targetVideo.abs,
    "--out-dir",
    rawFramesDir,
    "--target-scenes",
    String(desiredCount),
  ]);

  const normalizedScenes = (Array.isArray(rawResult.scenes) ? rawResult.scenes : []).map((sc) => {
    const startRel = toProjectRelativePosix(projectDir, sc.keyframes?.start);
    const peakRel = toProjectRelativePosix(projectDir, sc.keyframes?.peak);
    const endRel = toProjectRelativePosix(projectDir, sc.keyframes?.end);
    return {
      ...sc,
      keyframes: {
        start: startRel,
        peak: peakRel,
        end: endRel,
      },
      keyframeUrls: {
        start: toProjectMediaUrl(slug, projectDir, startRel),
        peak: toProjectMediaUrl(slug, projectDir, peakRel),
        end: toProjectMediaUrl(slug, projectDir, endRel),
      },
    };
  });

  const analysis = {
    ...rawResult,
    slug,
    videoRelPath: targetVideo.relPath,
    videoUrl: toProjectMediaUrl(slug, projectDir, targetVideo.relPath),
    analyzedAt: new Date().toISOString(),
    scenes: normalizedScenes,
  };

  const cachePath = path.join(projectDir, ".studio", "raw-analysis.json");
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(analysis, null, 2) + "\n", "utf8");

  return analysis;
}

async function handleApi(req, res, urlObj, serverPort) {
  // 1a. Delegate Wave 6 V4 routes (beat-quantize, subject-matte, smart-reframe, subtitles, thumbnails, variants, skill-bundles)
  if (await handleV4Routes(req, res, urlObj, { broadcastEvent })) {
    return;
  }

  // 1b. Delegate Wave 4/5 V3 routes (voices, lip-sync, whiteboard, ad-analytics, pm-insights, rea-video inspiration)
  if (await handleV3Routes(req, res, urlObj, { broadcastEvent })) {
    return;
  }

  // 1c. Delegate Wave 3 V2 routes (dynamic skills, whole-video rating, regional canvas inpaint, saved frames)
  if (await handleV2Routes(req, res, urlObj, { broadcastEvent })) {
    return;
  }

  // 1d. Delegate Pro catalog & specialist utility routes
  if (await handleProRoutes(req, res, urlObj, { sendJson, sendError, readJsonBody })) {
    return;
  }

  const pathname = urlObj.pathname;
  const method = (req.method || "GET").toUpperCase();

  // 2. GET /api/events (SSE stream)
  if (method === "GET" && pathname === "/api/events") {
    subscribeSse(req, res);
    return;
  }

  // 3. POST /api/internal/notify
  if (method === "POST" && pathname === "/api/internal/notify") {
    const body = await readJsonBody(req);
    const type = String(body.type || "").trim();
    if (!type) {
      sendError(res, 400, "Event type is required");
      return;
    }
    broadcastEvent(type, body.payload || {});
    sendJson(res, 200, { ok: true });
    return;
  }

  // 4. GET /api/status
  if (method === "GET" && pathname === "/api/status") {
    const [tools, looseRootFiles] = await Promise.all([
      checkTools(),
      Promise.resolve(listLooseRootFiles()),
    ]);
    const activeProject = readCurrentProjectSlug();
    const providerSettings = getProviderSettings();
    const agentCrew = getAgentCrewState();
    sendJson(res, 200, {
      ok: tools.ffmpeg.ok && tools.ffprobe.ok,
      activeProject,
      tools,
      looseRootFiles,
      dropDir: DROP_DIR,
      studioUrl: `http://localhost:${serverPort}`,
      providerSettings,
      agentCrew,
      crew: agentCrew,
    });
    return;
  }

  // 5. GET & POST /api/provider-settings
  if (pathname === "/api/provider-settings") {
    if (method === "GET") {
      const settings = getProviderSettings();
      sendJson(res, 200, { ok: true, providerSettings: settings, settings });
      return;
    }
    if (method === "POST") {
      const body = await readJsonBody(req);
      const updated = saveProviderSettings(body);
      broadcastEvent("provider_settings", { providerSettings: updated, ...updated });
      sendJson(res, 200, { ok: true, providerSettings: updated, settings: updated });
      return;
    }
  }

  // 6. GET & POST /api/projects
  if (method === "GET" && pathname === "/api/projects") {
    const projects = await listProjects();
    sendJson(res, 200, {
      ok: true,
      activeProject: readCurrentProjectSlug(),
      projects,
    });
    return;
  }

  if (method === "POST" && pathname === "/api/projects") {
    const body = await readJsonBody(req);
    const project = await createProject(body);
    sendJson(res, 201, { ok: true, project, activeProject: project.slug });
    return;
  }

  // GET /api/jobs/:jobId
  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (method === "GET" && jobMatch) {
    const job = jobs.get(decodeURIComponent(jobMatch[1]));
    if (!job) {
      sendError(res, 404, "Job not found");
      return;
    }
    sendJson(res, 200, { ok: true, job });
    return;
  }

  // Project-scoped endpoints: /api/projects/:slug/...
  const projMatch = pathname.match(/^\/api\/projects\/([^/]+)(?:\/(.*))?$/);
  if (projMatch) {
    const slug = decodeURIComponent(projMatch[1]);
    const subRoute = projMatch[2] || "";
    const projectDir = assertValidSlug(slug);

    if (!fs.existsSync(projectDir)) {
      sendError(res, 404, `Project not found: ${slug}`);
      return;
    }

    // 7. GET /api/projects/:slug
    if (method === "GET" && subRoute === "") {
      const project = await syncProjectManifest(slug);
      const rawAnalysis = readCachedRawAnalysis(projectDir);
      if (rawAnalysis) {
        project.rawAnalysis = rawAnalysis;
      }
      const aiPromptPath = path.join(projectDir, "AI_READY_PROMPT.md");
      const aiReadyPrompt = fs.existsSync(aiPromptPath)
        ? fs.readFileSync(aiPromptPath, "utf8")
        : "";
      const agentCrew = getAgentCrewState();
      const selectedSkills = await getSelectedProjectSkills(slug);

      sendJson(res, 200, {
        ok: true,
        project,
        rawAnalysis,
        storyboard: decorateStoryboardForUi(slug, loadStoryboard(slug)),
        selectedSkills,
        motionPresets: Array.from(MOTION_PRESETS),
        layoutArchetypes: LAYOUT_ARCHETYPES,
        aiReadyPrompt,
        jobs: getProjectJobs(slug),
        tickets: listAgentTasks(slug),
        agentCrew,
        crew: agentCrew,
      });
      return;
    }

    // 8a. POST /api/projects/:slug/activate
    if (method === "POST" && subRoute === "activate") {
      setCurrentProjectSlug(slug);
      const project = await syncProjectManifest(slug);
      sendJson(res, 200, { ok: true, activeProject: slug, project });
      return;
    }

    // 8b. POST /api/projects/:slug/brief
    if (method === "POST" && subRoute === "brief") {
      const body = await readJsonBody(req);
      const project = await syncProjectManifest(slug, body);
      const aiPromptPath = path.join(projectDir, "AI_READY_PROMPT.md");
      const aiReadyPrompt = fs.existsSync(aiPromptPath)
        ? fs.readFileSync(aiPromptPath, "utf8")
        : "";
      sendJson(res, 200, { ok: true, project, aiReadyPrompt });
      return;
    }

    // 8c. POST /api/projects/:slug/upload?category=...&filename=...
    if (method === "POST" && subRoute === "upload") {
      const category = urlObj.searchParams.get("category") || "raw-video";
      const rawName = urlObj.searchParams.get("filename") || `upload_${Date.now()}.bin`;
      if (!CATEGORIES.includes(category)) {
        sendError(res, 400, `Invalid category: ${category}`);
        return;
      }

      ensureProjectDirs(slug);
      const safeName = sanitizeFilename(rawName);
      const tempDir = path.join(projectDir, ".hyperframes", "tmp-uploads");
      fs.mkdirSync(tempDir, { recursive: true });
      const tempPath = path.join(tempDir, `${Date.now()}_${safeName}`);

      try {
        await new Promise((resolve, reject) => {
          const writeStream = fs.createWriteStream(tempPath);
          req.pipe(writeStream);
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);
          req.on("error", reject);
        });

        const result = await ingestLocalFile({
          slug,
          sourcePath: tempPath,
          category,
          move: true,
          targetFilename: safeName,
        });
        sendJson(res, 200, { ok: true, ...result, project: result.manifest });
      } finally {
        if (fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
          } catch {
            // Best-effort temp cleanup
          }
        }
      }
      return;
    }

    // 8d. POST /api/projects/:slug/ingest-url
    if (method === "POST" && subRoute === "ingest-url") {
      const body = await readJsonBody(req);
      const requestedCat = body.category || "raw-video";
      if (!CATEGORIES.includes(requestedCat)) {
        sendError(res, 400, `Invalid category: ${requestedCat}`);
        return;
      }
      // When saving an inspiration link without downloading, route to "references" so lib.mjs records referenceLinks
      const effectiveCategory =
        requestedCat === "inspiration" && body.download === false ? "references" : requestedCat;

      const result = await ingestUrl({
        slug,
        url: body.url,
        category: effectiveCategory,
        title: body.title || "",
        notes: body.notes || "",
        download: body.download !== undefined ? Boolean(body.download) : null,
      });
      sendJson(res, 200, { ok: true, ...result, project: result.manifest });
      return;
    }

    // 8e. POST /api/projects/:slug/import-root-file
    if (method === "POST" && subRoute === "import-root-file") {
      const body = await readJsonBody(req);
      const filename = String(body.filename || "");
      if (!filename || path.basename(filename) !== filename) {
        sendError(res, 400, "Invalid filename");
        return;
      }
      const sourcePath = path.join(ROOT_DIR, filename);
      if (!fs.existsSync(sourcePath)) {
        sendError(res, 404, `Root file not found: ${filename}`);
        return;
      }
      const result = await ingestLocalFile({
        slug,
        sourcePath,
        category: body.category || "raw-video",
        move: Boolean(body.move),
      });
      sendJson(res, 200, {
        ok: true,
        ...result,
        project: result.manifest,
        looseRootFiles: listLooseRootFiles(),
      });
      return;
    }

    // 8f. DELETE /api/projects/:slug/file
    if (method === "DELETE" && subRoute === "file") {
      const body = await readJsonBody(req);
      const relPath = String(body.relPath || urlObj.searchParams.get("relPath") || "").replaceAll(
        "\\",
        "/",
      );
      if (!relPath || relPath.includes("..")) {
        sendError(res, 400, "Invalid relPath");
        return;
      }
      const allowedPrefix =
        relPath.startsWith("inbox/") ||
        relPath.startsWith("assets/") ||
        relPath.startsWith("output/") ||
        relPath.startsWith("renders/");
      if (!allowedPrefix) {
        sendError(res, 403, "Deletion is restricted to inbox/, assets/, output/, and renders/");
        return;
      }
      const absTarget = path.resolve(projectDir, relPath);
      if (!absTarget.startsWith(projectDir + path.sep) || !fs.existsSync(absTarget)) {
        sendError(res, 404, `File not found: ${relPath}`);
        return;
      }
      fs.unlinkSync(absTarget);

      // Remove mirrored asset copy if deleted from inbox/
      const inboxMatch = relPath.match(/^inbox\/(raw-video|images|audio|brand)\/([^/]+)$/);
      if (inboxMatch) {
        const [, cat, fname] = inboxMatch;
        const subMap = { "raw-video": "clips", images: "images", audio: "audio" };
        if (subMap[cat]) {
          const twin = path.join(projectDir, "assets", subMap[cat], fname);
          if (fs.existsSync(twin)) fs.unlinkSync(twin);
        } else if (cat === "brand") {
          for (const sub of ["images", "fonts"]) {
            const twin = path.join(projectDir, "assets", sub, fname);
            if (fs.existsSync(twin)) fs.unlinkSync(twin);
          }
        }
      }

      const project = await syncProjectManifest(slug);
      sendJson(res, 200, { ok: true, project });
      return;
    }

    // 8g. DELETE /api/projects/:slug/reference-link
    if (method === "DELETE" && subRoute === "reference-link") {
      const body = await readJsonBody(req);
      const manifest = await syncProjectManifest(slug);
      const filtered = (manifest.referenceLinks || []).filter(
        (item) => item.id !== body.id && item.url !== body.url,
      );
      const project = await syncProjectManifest(slug, { referenceLinks: filtered });
      sendJson(res, 200, { ok: true, project });
      return;
    }

    // 8h. POST /api/projects/:slug/tts
    if (method === "POST" && subRoute === "tts") {
      const body = await readJsonBody(req);
      const text = String(body.text || "").trim();
      if (!text) {
        sendError(res, 400, "TTS text is required");
        return;
      }
      const voice = String(body.voice || "bn-BD-NabanitaNeural").trim();
      const safeName = sanitizeFilename(body.filename || `vo_${Date.now()}.mp3`);
      const finalName = safeName.endsWith(".mp3") ? safeName : `${safeName}.mp3`;

      ensureProjectDirs(slug);
      const tempOut = path.join(
        projectDir,
        ".hyperframes",
        "tmp-uploads",
        `${Date.now()}_${finalName}`,
      );
      fs.mkdirSync(path.dirname(tempOut), { recursive: true });

      const resCmd = await runCommand(
        "edge-tts",
        ["--voice", voice, "--text", text, "--write-media", tempOut],
        { cwd: projectDir, shell: false },
      );
      if (resCmd.code !== 0 || !fs.existsSync(tempOut)) {
        sendError(res, 500, `edge-tts failed: ${(resCmd.stderr || resCmd.stdout).trim()}`);
        return;
      }

      const result = await ingestLocalFile({
        slug,
        sourcePath: tempOut,
        category: "audio",
        move: true,
        targetFilename: finalName,
      });
      sendJson(res, 200, { ok: true, ...result, project: result.manifest });
      return;
    }

    // 8i. POST /api/projects/:slug/action
    if (method === "POST" && subRoute === "action") {
      const body = await readJsonBody(req);
      const job = startHyperframesJob(slug, String(body.action || ""));
      sendJson(res, 202, { ok: true, job });
      return;
    }

    // 9. POST /api/projects/:slug/scan-folder
    if (method === "POST" && subRoute === "scan-folder") {
      const body = await readJsonBody(req);
      const scan = scanExternalFolder(body.folderPath, { recursive: body.recursive !== false });
      sendJson(res, 200, { ok: true, scan, ...scan });
      return;
    }

    // 10. POST /api/projects/:slug/import-folder
    if (method === "POST" && subRoute === "import-folder") {
      const body = await readJsonBody(req);
      const result = await importExternalFolder({
        slug,
        folderPath: body.folderPath,
        category: body.category || "raw-video",
        selectedFiles: body.selectedFiles || null,
        recursive: body.recursive !== false,
      });
      sendJson(res, 200, { ok: true, ...result, project: result.manifest });
      return;
    }

    // 11. POST /api/projects/:slug/analyze-raw
    if (method === "POST" && subRoute === "analyze-raw") {
      const body = await readJsonBody(req);
      const analysis = await performAnalyzeRaw(slug, {
        relPath: body.relPath,
        targetScenes: body.targetScenes || 6,
      });
      const project = await syncProjectManifest(slug);
      project.rawAnalysis = analysis;
      broadcastEvent("raw_analyzed", { slug, analysis });
      sendJson(res, 200, { ok: true, analysis, rawAnalysis: analysis, project });
      return;
    }

    // 12. POST /api/projects/:slug/analyze-inspiration
    if (method === "POST" && subRoute === "analyze-inspiration") {
      const body = await readJsonBody(req);
      ensureProjectDirs(slug);
      let targetVideo = null;

      if (body.relPath) {
        const resolved = resolveConfinedFile(projectDir, body.relPath);
        if (!fs.existsSync(resolved.abs)) {
          sendError(res, 404, `Inspiration video not found: ${resolved.relPath}`);
          return;
        }
        targetVideo = resolved;
      } else {
        const inspVideos = [
          ...listVideosInSubdir(projectDir, "inbox/inspiration"),
          ...listVideosInSubdir(projectDir, "inbox/references"),
        ].sort((a, b) => b.mtimeMs - a.mtimeMs);
        if (inspVideos.length > 0) {
          targetVideo = { abs: inspVideos[0].abs, relPath: inspVideos[0].relPath };
        }
      }

      if (!targetVideo) {
        sendError(res, 400, "No inspiration video found in inbox/inspiration or inbox/references");
        return;
      }

      const inspFramesDir = path.join(projectDir, ".studio", "frames", "inspiration");
      fs.mkdirSync(inspFramesDir, { recursive: true });

      const rawInsp = await runMediaIntelligence("analyze-inspiration", [
        "--video",
        targetVideo.abs,
        "--out-dir",
        inspFramesDir,
      ]);

      const styleFrames = (Array.isArray(rawInsp.styleFrames) ? rawInsp.styleFrames : []).map((p) =>
        toProjectRelativePosix(projectDir, p),
      );
      const styleFrameUrls = styleFrames.map((rel) => toProjectMediaUrl(slug, projectDir, rel));

      const inspirationProfile = {
        ...rawInsp,
        videoRelPath: targetVideo.relPath,
        videoUrl: toProjectMediaUrl(slug, projectDir, targetVideo.relPath),
        styleFrames,
        styleFrameUrls,
        analyzedAt: new Date().toISOString(),
      };

      const project = await syncProjectManifest(slug, { inspirationProfile });
      broadcastEvent("inspiration_analyzed", { slug, inspirationProfile });
      sendJson(res, 200, { ok: true, inspirationProfile, project });
      return;
    }

    // 13. POST /api/projects/:slug/extract-brand
    if (method === "POST" && subRoute === "extract-brand") {
      const body = await readJsonBody(req);
      const currentBrief = await syncProjectManifest(slug);

      let logoPick = null;
      if (body.logoRelPath) {
        const resolved = resolveConfinedFile(projectDir, body.logoRelPath);
        if (!fs.existsSync(resolved.abs)) {
          sendError(res, 404, `Brand logo not found: ${resolved.relPath}`);
          return;
        }
        logoPick = resolved;
      } else {
        logoPick = findFirstMatchingFile(
          projectDir,
          ["inbox/brand", "inbox/images", "assets/images", "assets"],
          BRAND_IMAGE_EXTS,
        );
      }

      let docPick = null;
      if (body.docRelPath) {
        const resolved = resolveConfinedFile(projectDir, body.docRelPath);
        if (!fs.existsSync(resolved.abs)) {
          sendError(res, 404, `Brand document not found: ${resolved.relPath}`);
          return;
        }
        docPick = resolved;
      } else {
        docPick = findFirstMatchingFile(projectDir, ["inbox/brand"], BRAND_DOC_EXTS);
      }

      const inlineText = String(body.text ?? currentBrief.instructions ?? "").trim();
      const cliArgs = [];
      if (logoPick) cliArgs.push("--logo", logoPick.abs);
      if (docPick) cliArgs.push("--doc", docPick.abs);
      if (inlineText) cliArgs.push("--text", inlineText);

      const extracted = await runMediaIntelligence("extract-brand", cliArgs);

      const nextBrandColors = {
        primary:
          extracted.colors?.primary ||
          extracted.primary ||
          currentBrief.brandColors?.primary ||
          "#1E824C",
        secondary:
          extracted.colors?.secondary ||
          extracted.secondary ||
          currentBrief.brandColors?.secondary ||
          "#2ECC71",
        accent:
          extracted.colors?.accent ||
          extracted.accent ||
          currentBrief.brandColors?.accent ||
          "#F1C40F",
        background:
          extracted.colors?.background ||
          extracted.background ||
          currentBrief.brandColors?.background ||
          "#0A1612",
      };

      const nextBrandKit = {
        ...(currentBrief.brandKit || {}),
        extractedPalette: Array.isArray(extracted.extractedPalette)
          ? extracted.extractedPalette
          : [],
        fonts: extracted.fonts ||
          currentBrief.brandKit?.fonts || { heading: "Inter", body: "Inter" },
        tone: extracted.tone || currentBrief.brandKit?.tone || "Confident & Modern",
        guidelinesText:
          extracted.guidelinesText || inlineText || currentBrief.brandKit?.guidelinesText || "",
        logoRelPath: logoPick?.relPath || currentBrief.brandKit?.logoRelPath || null,
      };

      const project = await syncProjectManifest(slug, {
        brandColors: nextBrandColors,
        brandKit: nextBrandKit,
      });

      broadcastEvent("brand_extracted", { slug, extracted });
      sendJson(res, 200, { ok: true, extracted, brand: extracted, project });
      return;
    }

    // 14. GET /api/projects/:slug/storyboard
    if (method === "GET" && subRoute === "storyboard") {
      sendJson(res, 200, {
        ok: true,
        storyboard: decorateStoryboardForUi(slug, loadStoryboard(slug)),
        motionPresets: Array.from(MOTION_PRESETS),
        layoutArchetypes: LAYOUT_ARCHETYPES,
      });
      return;
    }

    // 15. POST /api/projects/:slug/storyboard/generate
    if (method === "POST" && subRoute === "storyboard/generate") {
      const body = await readJsonBody(req);
      const projectBrief = await syncProjectManifest(slug);
      let rawAnalysis = readCachedRawAnalysis(projectDir);

      if (!rawAnalysis && listVideosInSubdir(projectDir, "inbox/raw-video").length > 0) {
        try {
          rawAnalysis = await performAnalyzeRaw(slug, {
            targetScenes: body.targetScenes || 6,
          });
        } catch {
          // Fall back cleanly if raw video cannot be analyzed
          rawAnalysis = null;
        }
      }

      const activeSkills = Array.isArray(body.selectedSkills)
        ? await setSelectedProjectSkills(slug, body.selectedSkills)
        : await getSelectedProjectSkills(slug);
      const compiledSkillDirectives =
        body.compiledSkillDirectives ||
        (activeSkills.length > 0 ? compileSkillDirectives({ slug, skillIds: activeSkills }) : null);

      const sb = await generateStoryboard({
        slug,
        projectBrief,
        rawAnalysis,
        inspirationProfile: projectBrief.inspirationProfile || null,
        globalPrompt: String(body.globalPrompt || body.prompt || ""),
        targetScenes: body.targetScenes !== undefined ? Number(body.targetScenes) : undefined,
        preserveLocked: body.preserveLocked !== false,
        selectedSkills: activeSkills,
        compiledSkillDirectives,
      });

      const decoratedSb = decorateStoryboardForUi(slug, sb);
      broadcastStoryboardUpdated(slug, decoratedSb);
      sendJson(res, 200, {
        ok: true,
        storyboard: decoratedSb,
        selectedSkills: activeSkills,
        skillDirectives: compiledSkillDirectives,
      });
      return;
    }

    // 16. POST /api/projects/:slug/storyboard/frames/:frameId/regenerate
    const regenMatch = subRoute.match(/^storyboard\/frames\/([^/]+)\/regenerate$/);
    if (method === "POST" && regenMatch) {
      const frameId = decodeURIComponent(regenMatch[1]);
      const body = await readJsonBody(req);
      const { frame, storyboard } = await regenerateFrame({
        slug,
        frameId,
        prompt: String(body.prompt || ""),
        motionPreset: body.motionPreset || null,
        layout: body.layout || null,
        overrides: body.overrides || {},
      });
      const decoratedSb = decorateStoryboardForUi(slug, storyboard);
      const decoratedFrame =
        decoratedSb?.frames?.find((f) => f.id === frameId) ||
        decorateFrameForUi(slug, projectDir, frame);
      broadcastStoryboardUpdated(slug, decoratedSb);
      sendJson(res, 200, { ok: true, frame: decoratedFrame, storyboard: decoratedSb });
      return;
    }

    // 17. PATCH / POST /api/projects/:slug/storyboard/frames/:frameId
    const framePatchMatch = subRoute.match(/^storyboard\/frames\/([^/]+)$/);
    if ((method === "PATCH" || method === "POST") && framePatchMatch) {
      const frameId = decodeURIComponent(framePatchMatch[1]);
      const body = await readJsonBody(req);
      const patch = body.patch && typeof body.patch === "object" ? body.patch : body;
      const { frame, storyboard } = await updateFrame({ slug, frameId, patch });
      const decoratedSb = decorateStoryboardForUi(slug, storyboard);
      const decoratedFrame =
        decoratedSb?.frames?.find((f) => f.id === frameId) ||
        decorateFrameForUi(slug, projectDir, frame);
      broadcastStoryboardUpdated(slug, decoratedSb);
      sendJson(res, 200, { ok: true, frame: decoratedFrame, storyboard: decoratedSb });
      return;
    }

    // 18. POST /api/projects/:slug/storyboard/approve-all
    if (method === "POST" && subRoute === "storyboard/approve-all") {
      const body = await readJsonBody(req);
      const sb = loadStoryboard(slug);
      if (!sb) {
        sendError(res, 404, `Storyboard not found for project "${slug}"`);
        return;
      }
      const nextLocked = body.locked ?? true;
      const nextApproved = body.approved ?? true;
      for (const frame of sb.frames || []) {
        frame.locked = Boolean(nextLocked);
        frame.approved = Boolean(nextApproved);
      }
      const saved = saveStoryboard(slug, sb);
      const decoratedSb = decorateStoryboardForUi(slug, saved);
      broadcastStoryboardUpdated(slug, decoratedSb);
      sendJson(res, 200, { ok: true, storyboard: decoratedSb });
      return;
    }

    // 19. GET & POST /api/projects/:slug/agent-queue
    if (subRoute === "agent-queue") {
      if (method === "GET") {
        const tickets = listAgentTasks(slug);
        const agentCrew = getAgentCrewState();
        sendJson(res, 200, { ok: true, slug, tickets, agentCrew, crew: agentCrew });
        return;
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        const ticket = enqueueAgentTask({
          slug,
          type: body.type,
          payload: body.payload || {},
        });
        const targetAgentId = TASK_TYPE_TO_AGENT[ticket.type];
        if (targetAgentId) {
          setAgentStatus(targetAgentId, "working", `Queued ${ticket.type} (${ticket.id})`, {
            slug,
            ticketId: ticket.id,
          });
        }
        const tickets = listAgentTasks(slug);
        const agentCrew = getAgentCrewState();
        broadcastEvent("ticket_updated", { slug, ticket, tickets, crew: agentCrew });
        sendJson(res, 200, { ok: true, ticket, tickets, agentCrew, crew: agentCrew });
        return;
      }
    }

    // 20. POST /api/projects/:slug/generate-video
    if (method === "POST" && subRoute === "generate-video") {
      const body = await readJsonBody(req);
      const brief = await syncProjectManifest(slug);
      const job = startVideoCompileJob(slug, brief, body);
      sendJson(res, 202, { ok: true, job });
      return;
    }
  }

  sendError(res, 404, `Unknown API route: ${method} ${pathname}`);
}

export function createStudioHttpServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const pathname = urlObj.pathname;
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr?.port ? addr.port : DEFAULT_PORT;

      if (pathname.startsWith("/api/")) {
        await handleApi(req, res, urlObj, boundPort);
        return;
      }

      // Media serving: /media/:slug/<relative-path>
      if (pathname.startsWith("/media/")) {
        const rest = pathname.slice("/media/".length);
        const firstSlash = rest.indexOf("/");
        if (firstSlash === -1) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        const slug = decodeURIComponent(rest.slice(0, firstSlash));
        const relPart = rest
          .slice(firstSlash + 1)
          .split("/")
          .map(decodeURIComponent)
          .join("/");

        const projectDir = assertValidSlug(slug);
        const absFile = path.resolve(projectDir, relPart);
        if (!absFile.startsWith(projectDir + path.sep)) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        serveFileWithRange(req, res, absFile);
        return;
      }

      // Static frontend files
      const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const safeRel = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
      const absStatic = path.resolve(PUBLIC_DIR, safeRel);
      if (!absStatic.startsWith(PUBLIC_DIR + path.sep) && absStatic !== PUBLIC_DIR) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      serveFileWithRange(req, res, absStatic);
    } catch (err) {
      if (!res.headersSent) {
        const status = classifyErrorStatus(err);
        sendError(res, status, err instanceof Error ? err.message : String(err));
      }
    }
  });

  return server;
}

export async function bootstrapServer({
  port = DEFAULT_PORT,
  host = "127.0.0.1",
  enableDropWatcher = true,
  syncOnStart = true,
} = {}) {
  getToolEnv();
  ensureDropStructure();

  if (syncOnStart && fs.existsSync(PROJECTS_DIR)) {
    const dirs = fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
    for (const slug of dirs) {
      try {
        await syncProjectManifest(slug);
      } catch (err) {
        console.error(`Warning syncing ${slug}:`, err.message);
      }
    }
  }

  const server = createStudioHttpServer();
  let dropPollBusy = false;

  if (enableDropWatcher) {
    const dropTimer = setInterval(async () => {
      if (dropPollBusy) return;
      dropPollBusy = true;
      try {
        const moved = await processDropFolder();
        if (moved.length > 0) {
          console.log(
            `[DROP_HERE] Auto-ingested ${moved.length} file(s):`,
            moved.map((m) => m.file).join(", "),
          );
          broadcastEvent("drop_ingested", { moved });
        }
      } catch {
        // Ignore transient poll errors
      } finally {
        dropPollBusy = false;
      }
    }, 3000);
    dropTimer.unref?.();
    server.once("close", () => clearInterval(dropTimer));
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr?.port ? addr.port : port;
  console.log(`HyperFrames Studio Hub running at http://localhost:${actualPort}`);
  console.log(`Active project: ${readCurrentProjectSlug() || "none"}`);
  console.log(`Drop folder: ${DROP_DIR}`);

  return { server, port: actualPort, url: `http://localhost:${actualPort}` };
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  bootstrapServer({ port: DEFAULT_PORT }).catch((err) => {
    console.error("Failed to bootstrap Studio Hub server:", err);
    process.exitCode = 1;
  });
}

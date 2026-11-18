import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PROJECTS_DIR = path.resolve(__dirname, "..", "projects");

export const V2_MAX_JSON_BYTES = 15 * 1024 * 1024; // 15 MB ceiling for base64 1080p canvas PNGs

const VALID_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const VALID_SAFE_ID_RE = /^[a-z0-9][a-z0-9_.-]*$/i;
const VALID_TARGET_SCOPES = new Set(["workspace", "project"]);

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

function readLargeJsonBody(req, maxBytes = V2_MAX_JSON_BYTES) {
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
        // Drain remaining bytes rather than destroying socket mid-flight so HTTP 413 flushes cleanly
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

function classifyV2ErrorStatus(err) {
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

function makeBadRequestError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function hasTraversalSegment(rawValue) {
  const str = String(rawValue || "");
  if (str.includes("\0")) return true;
  return /(^|[\\/])\.\.([\\/]|$)/.test(str) || str.includes("..");
}

function validateSafeIdentifier(rawId, label = "identifier") {
  const str = String(rawId || "").trim();
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

async function loadLazyModule(specifier, deps = {}, cache = {}) {
  if (cache[specifier]) return cache[specifier];
  const importer = typeof deps.importModule === "function" ? deps.importModule : (s) => import(s);
  const mod = await importer(specifier);
  cache[specifier] = mod;
  return mod;
}

async function resolveProjectsBaseDir(deps, moduleCache) {
  if (deps.projectsDir) {
    return path.resolve(deps.projectsDir);
  }
  if (deps.lib?.PROJECTS_DIR) {
    return path.resolve(deps.lib.PROJECTS_DIR);
  }
  try {
    const libMod = await loadLazyModule("./lib.mjs", deps, moduleCache);
    if (libMod?.PROJECTS_DIR) {
      return path.resolve(libMod.PROJECTS_DIR);
    }
  } catch {
    // Fall back to default workspace projects directory
  }
  return DEFAULT_PROJECTS_DIR;
}

async function resolveValidatedProjectDir(slug, deps, moduleCache) {
  const clean = String(slug || "").trim();
  if (
    !clean ||
    clean.includes("..") ||
    clean.includes("\0") ||
    /[\\/]/.test(clean) ||
    !VALID_SLUG_RE.test(clean)
  ) {
    throw makeBadRequestError(`Invalid project slug: ${slug}`);
  }

  const baseDir = await resolveProjectsBaseDir(deps, moduleCache);
  const resolved = path.resolve(baseDir, clean);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw makeBadRequestError(`Unsafe project path: ${slug}`);
  }

  if (!deps.projectsDir) {
    const assertFn = deps.assertValidSlug || deps.lib?.assertValidSlug;
    if (typeof assertFn === "function") {
      assertFn(clean);
    }
  }

  return resolved;
}

function decodeUriSegmentOrThrow(raw, label) {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw makeBadRequestError(`Malformed URL encoding for ${label}`);
  }
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

export function toV2MediaUrl(slug, projectDir, rawPath) {
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

export function decorateV2FrameForUi(slug, projectDir, frame) {
  if (!frame || typeof frame !== "object") return frame;

  const designUrl = toV2MediaUrl(
    slug,
    projectDir,
    frame.designFrameUrl || frame.currentDesignImage || frame.designFramePath || frame.image,
  );
  const hudUrl =
    toV2MediaUrl(
      slug,
      projectDir,
      frame.hudFrameUrl || frame.currentBlueprintImage || frame.hudFramePath,
    ) || designUrl;

  const kfSrc = frame.keyframes && typeof frame.keyframes === "object" ? frame.keyframes : {};
  const keyframes = {
    start: toV2MediaUrl(slug, projectDir, kfSrc.start) || null,
    peak: toV2MediaUrl(slug, projectDir, kfSrc.peak) || null,
    end: toV2MediaUrl(slug, projectDir, kfSrc.end) || null,
  };

  let rawKeyframes;
  if (Array.isArray(frame.rawKeyframes)) {
    rawKeyframes = frame.rawKeyframes
      .map((item) => toV2MediaUrl(slug, projectDir, item))
      .filter(Boolean);
  } else if (frame.rawKeyframes && typeof frame.rawKeyframes === "object") {
    rawKeyframes = {
      start: toV2MediaUrl(slug, projectDir, frame.rawKeyframes.start) || keyframes.start,
      peak: toV2MediaUrl(slug, projectDir, frame.rawKeyframes.peak) || keyframes.peak,
      end: toV2MediaUrl(slug, projectDir, frame.rawKeyframes.end) || keyframes.end,
    };
  } else {
    rawKeyframes = { ...keyframes };
  }

  const history = Array.isArray(frame.history)
    ? frame.history.map((snap) => {
        const snapDesign = toV2MediaUrl(
          slug,
          projectDir,
          snap?.designFrameUrl || snap?.currentDesignImage || snap?.image || snap?.designFramePath,
        );
        const snapHud =
          toV2MediaUrl(
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

export function decorateV2StoryboardForUi(slug, storyboard, projectDir) {
  if (!storyboard || typeof storyboard !== "object") return storyboard;
  const resolvedDir = projectDir || path.join(DEFAULT_PROJECTS_DIR, slug);
  const frames = Array.isArray(storyboard.frames)
    ? storyboard.frames.map((f) => decorateV2FrameForUi(slug, resolvedDir, f))
    : [];
  return {
    ...storyboard,
    frames,
  };
}

export function decorateSavedFrameForUi(slug, projectDir, item) {
  if (!item || typeof item !== "object") return item;
  const rawImg =
    item.imageUrl ||
    item.pngUrl ||
    item.url ||
    item.designFrameUrl ||
    item.thumbnailUrl ||
    item.image ||
    item.imageRelPath ||
    item.pngRelPath ||
    item.relPath ||
    item.designFramePath ||
    item.imagePath ||
    item.filePath ||
    "";
  const mediaUrl = toV2MediaUrl(slug, projectDir, rawImg);

  const rawHud = item.hudFrameUrl || item.hudUrl || item.hudRelPath || item.hudFramePath || "";
  const hudMediaUrl = toV2MediaUrl(slug, projectDir, rawHud) || mediaUrl;

  const id = String(item.id || item.savedId || "").trim();
  return {
    ...item,
    ...(id ? { id, savedId: item.savedId || id } : {}),
    ...(mediaUrl
      ? {
          url: mediaUrl,
          imageUrl: mediaUrl,
          pngUrl: mediaUrl,
          designFrameUrl: mediaUrl,
          currentDesignImage: mediaUrl,
          thumbnailUrl: mediaUrl,
          image: mediaUrl,
        }
      : {}),
    ...(hudMediaUrl
      ? {
          hudFrameUrl: hudMediaUrl,
          currentBlueprintImage: hudMediaUrl,
        }
      : {}),
  };
}

async function resolveSkillFn(fnName, deps, moduleCache) {
  const direct = deps[fnName] || deps.skillsRegistry?.[fnName];
  if (typeof direct === "function") return direct;
  const lazy = await loadLazyModule("./skills-registry.mjs", deps, moduleCache);
  if (typeof lazy?.[fnName] !== "function") {
    throw new Error(`skills-registry.${fnName} is not available`);
  }
  return lazy[fnName];
}

async function resolveOptionalSkillFn(fnName, deps, moduleCache) {
  const direct = deps[fnName] || deps.skillsRegistry?.[fnName];
  if (typeof direct === "function") return direct;
  try {
    const lazy = await loadLazyModule("./skills-registry.mjs", deps, moduleCache);
    return typeof lazy?.[fnName] === "function" ? lazy[fnName] : null;
  } catch {
    return null;
  }
}

async function resolveRatingFn(deps, moduleCache) {
  const fn = deps.evaluateProjectVideoRating || deps.videoRating?.evaluateProjectVideoRating;
  if (typeof fn === "function") return fn;
  const lazy = await loadLazyModule("./video-rating.mjs", deps, moduleCache);
  if (typeof lazy?.evaluateProjectVideoRating !== "function") {
    throw new Error("video-rating.evaluateProjectVideoRating is not available");
  }
  return lazy.evaluateProjectVideoRating;
}

async function resolveInpaintFn(fnName, deps, moduleCache) {
  const direct = deps[fnName] || deps.frameInpaint?.[fnName];
  if (typeof direct === "function") return direct;
  const lazy = await loadLazyModule("./frame-inpaint.mjs", deps, moduleCache);
  if (typeof lazy?.[fnName] !== "function") {
    throw new Error(`frame-inpaint.${fnName} is not available`);
  }
  return lazy[fnName];
}

async function resolveOptionalInpaintFn(fnName, deps, moduleCache) {
  const direct = deps[fnName] || deps.frameInpaint?.[fnName];
  if (typeof direct === "function") return direct;
  try {
    const lazy = await loadLazyModule("./frame-inpaint.mjs", deps, moduleCache);
    return typeof lazy?.[fnName] === "function" ? lazy[fnName] : null;
  } catch {
    return null;
  }
}

function normalizeArrayResult(raw, nestedKey) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && nestedKey && Array.isArray(raw[nestedKey])) {
    return raw[nestedKey];
  }
  return [];
}

function normalizeSkillDescriptor(skill) {
  if (!skill || typeof skill !== "object") return skill;
  const hexList = Array.isArray(skill.extractedHexColors)
    ? skill.extractedHexColors
    : Array.isArray(skill.ExtractedHexColors)
      ? skill.ExtractedHexColors
      : [];
  return {
    ...skill,
    extractedHexColors: hexList,
    ExtractedHexColors: hexList,
  };
}

async function callGetSelectedSkills(getFn, slug) {
  if (typeof getFn !== "function") return [];
  if (!slug) {
    try {
      const raw = await getFn(null);
      return normalizeArrayResult(raw, "selectedSkills");
    } catch {
      return [];
    }
  }
  try {
    const raw = await getFn(slug);
    return normalizeArrayResult(raw, "selectedSkills");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Invalid project slug:\s*(undefined|null)|Cannot destructure/i.test(msg)) {
      const raw = await getFn({ slug });
      return normalizeArrayResult(raw, "selectedSkills");
    }
    throw err;
  }
}

async function callSetSelectedSkills(setFn, slug, selectedSkills) {
  try {
    const raw = await setFn(slug, selectedSkills);
    return Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.selectedSkills)
        ? raw.selectedSkills
        : selectedSkills;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Invalid project slug:\s*(undefined|null)|Cannot destructure/i.test(msg)) {
      const raw = await setFn({ slug, skillIds: selectedSkills, selectedSkills });
      return Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.selectedSkills)
          ? raw.selectedSkills
          : selectedSkills;
    }
    throw err;
  }
}

async function callListSavedFrames(listFn, slug) {
  try {
    const raw = await listFn(slug);
    return normalizeArrayResult(raw, "savedFrames");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Invalid project slug:\s*(undefined|null)|Cannot destructure/i.test(msg)) {
      const raw = await listFn({ slug });
      return normalizeArrayResult(raw, "savedFrames");
    }
    throw err;
  }
}

async function callSaveBookmark(saveFn, listFn, slug, payload) {
  let raw;
  try {
    raw = await saveFn({ slug, ...payload });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Invalid project slug:\s*\[object Object\]/i.test(msg)) {
      raw = await saveFn(slug, payload);
    } else {
      throw err;
    }
  }

  const savedFrame = raw?.savedFrame ?? raw?.bookmark ?? raw?.item ?? raw ?? null;
  let savedFrames = Array.isArray(raw?.savedFrames) ? raw.savedFrames : null;
  if (!savedFrames && typeof listFn === "function") {
    savedFrames = await callListSavedFrames(listFn, slug);
  }
  return { savedFrame, savedFrames: savedFrames || (savedFrame ? [savedFrame] : []) };
}

async function callDeleteSavedFrame(deleteFn, listFn, slug, savedId) {
  let raw;
  try {
    raw = await deleteFn(slug, savedId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Invalid project slug:\s*(undefined|null)|Cannot destructure/i.test(msg)) {
      raw = await deleteFn({ slug, savedId, id: savedId });
    } else {
      throw err;
    }
  }

  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.savedFrames)) return raw.savedFrames;
  if (typeof listFn === "function") {
    return await callListSavedFrames(listFn, slug);
  }
  return [];
}

function matchV2Route(pathname) {
  if (pathname === "/api/skills") {
    return { kind: "skills-list" };
  }
  if (pathname === "/api/skills/install") {
    return { kind: "skills-install" };
  }

  const projMatch = pathname.match(/^\/api\/projects\/([^/]+)\/(.+)$/);
  if (!projMatch) return null;

  const rawSlug = projMatch[1];
  const subRoute = projMatch[2];

  if (subRoute === "skills") {
    return { kind: "project-skills", rawSlug };
  }
  if (subRoute === "rating") {
    return { kind: "project-rating", rawSlug };
  }
  if (subRoute === "saved-frames") {
    return { kind: "saved-frames", rawSlug };
  }

  const savedDeleteMatch = subRoute.match(/^saved-frames\/([^/]+)$/);
  if (savedDeleteMatch) {
    return { kind: "saved-frame-item", rawSlug, rawSavedId: savedDeleteMatch[1] };
  }

  const regenRegionMatch = subRoute.match(/^storyboard\/frames\/([^/]+)\/regenerate-region$/);
  if (regenRegionMatch) {
    return { kind: "regenerate-region", rawSlug, rawFrameId: regenRegionMatch[1] };
  }

  return null;
}

export async function handleV2Routes(req, res, urlObj, deps = {}) {
  const parsedUrl = urlObj || new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const method = String(req.method || "GET").toUpperCase();

  const matched = matchV2Route(pathname);
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
  const maxBodyBytes =
    typeof deps.maxBodyBytes === "number" && deps.maxBodyBytes > 0
      ? deps.maxBodyBytes
      : V2_MAX_JSON_BYTES;
  const readBody = (incomingReq) =>
    typeof deps.readJsonBody === "function"
      ? deps.readJsonBody(incomingReq, maxBodyBytes)
      : readLargeJsonBody(incomingReq, maxBodyBytes);

  const moduleCache = {};

  try {
    // 1. GET /api/skills (?slug=<optional>)
    if (matched.kind === "skills-list") {
      if (method !== "GET") {
        sendError(res, 405, `Method ${method} not allowed for /api/skills`);
        return true;
      }

      const rawQuerySlug = parsedUrl.searchParams.get("slug");
      const slug = rawQuerySlug && rawQuerySlug.trim() ? rawQuerySlug.trim() : null;
      if (slug) {
        await resolveValidatedProjectDir(slug, deps, moduleCache);
      }

      const discoverFn = await resolveSkillFn("discoverLocalSkills", deps, moduleCache);
      const getSelectedFn = await resolveOptionalSkillFn(
        "getSelectedProjectSkills",
        deps,
        moduleCache,
      );
      const rawSkills = await discoverFn({ slug });
      const skills = normalizeArrayResult(rawSkills, "skills").map(normalizeSkillDescriptor);
      const selectedSkills = await callGetSelectedSkills(getSelectedFn, slug);

      sendJson(res, 200, { ok: true, skills, selectedSkills });
      return true;
    }

    // 2. POST /api/skills/install
    if (matched.kind === "skills-install") {
      if (method !== "POST") {
        sendError(res, 405, `Method ${method} not allowed for /api/skills/install`);
        return true;
      }

      const body = await readBody(req);
      const targetScope = body.targetScope ? String(body.targetScope).trim() : "workspace";
      if (!VALID_TARGET_SCOPES.has(targetScope)) {
        sendError(res, 400, `Invalid targetScope: ${targetScope}`);
        return true;
      }

      const slug = body.slug && String(body.slug).trim() ? String(body.slug).trim() : null;
      if (slug) {
        await resolveValidatedProjectDir(slug, deps, moduleCache);
      } else if (targetScope === "project") {
        sendError(res, 400, "slug is required when targetScope is 'project'");
        return true;
      }

      const sourcePath =
        body.sourcePath !== undefined && body.sourcePath !== null
          ? String(body.sourcePath).trim()
          : null;
      const globalSkillId =
        body.globalSkillId !== undefined && body.globalSkillId !== null
          ? String(body.globalSkillId).trim()
          : null;
      const name = body.name !== undefined && body.name !== null ? String(body.name).trim() : null;
      const description =
        body.description !== undefined && body.description !== null
          ? String(body.description)
          : null;
      const content =
        body.content !== undefined && body.content !== null ? String(body.content) : null;

      if (sourcePath && hasTraversalSegment(sourcePath)) {
        sendError(res, 400, "Invalid sourcePath: path traversal segments are rejected");
        return true;
      }
      if (globalSkillId) {
        validateSafeIdentifier(globalSkillId, "globalSkillId");
      }
      if (name && (hasTraversalSegment(name) || /[\\/]/.test(name))) {
        sendError(res, 400, "Invalid skill name: path traversal or path separators rejected");
        return true;
      }
      if (!sourcePath && !globalSkillId && !name && !content) {
        sendError(
          res,
          400,
          "Provide sourcePath, globalSkillId, or { name, content } to install a local skill",
        );
        return true;
      }

      const installFn = await resolveSkillFn("installSkillToLocal", deps, moduleCache);
      const installRaw = await installFn({
        sourcePath,
        globalSkillId,
        name,
        description,
        content,
        targetScope,
        slug,
      });

      const rawInstalled = installRaw?.installedSkill ?? installRaw?.skill ?? installRaw ?? null;
      const installedSkill = rawInstalled ? normalizeSkillDescriptor(rawInstalled) : null;
      let rawSkillsList = Array.isArray(installRaw?.skills) ? installRaw.skills : null;
      if (!rawSkillsList) {
        const discoverFn = await resolveOptionalSkillFn("discoverLocalSkills", deps, moduleCache);
        if (discoverFn) {
          const discovered = await discoverFn({ slug });
          rawSkillsList = normalizeArrayResult(discovered, "skills");
        } else {
          rawSkillsList = installedSkill ? [installedSkill] : [];
        }
      }
      const skills = rawSkillsList.map(normalizeSkillDescriptor);

      sendJson(res, 200, { ok: true, installedSkill, skills });
      return true;
    }

    // All remaining V2 endpoints are project-scoped (/api/projects/:slug/...)
    const slug = decodeUriSegmentOrThrow(matched.rawSlug, "project slug");
    const projectDir = await resolveValidatedProjectDir(slug, deps, moduleCache);
    if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
      sendError(res, 404, `Project not found: ${slug}`);
      return true;
    }

    // 3. POST (and GET/PUT) /api/projects/:slug/skills
    if (matched.kind === "project-skills") {
      if (method === "GET") {
        const discoverFn = await resolveSkillFn("discoverLocalSkills", deps, moduleCache);
        const getSelectedFn = await resolveOptionalSkillFn(
          "getSelectedProjectSkills",
          deps,
          moduleCache,
        );
        const compileFn = await resolveOptionalSkillFn("compileSkillDirectives", deps, moduleCache);
        const rawSkills = await discoverFn({ slug });
        const skills = normalizeArrayResult(rawSkills, "skills");
        const selectedSkills = await callGetSelectedSkills(getSelectedFn, slug);
        const directives = compileFn ? await compileFn({ slug, skillIds: selectedSkills }) : null;
        sendJson(res, 200, { ok: true, skills, selectedSkills, directives });
        return true;
      }

      if (method !== "POST" && method !== "PUT") {
        sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
        return true;
      }

      const body = await readBody(req);
      const rawSelected = body.selectedSkills ?? body.skillIds;
      if (!Array.isArray(rawSelected)) {
        sendError(res, 400, "selectedSkills must be an array of skill IDs");
        return true;
      }

      const cleanSkillIds = rawSelected.map((id) => validateSafeIdentifier(id, "skillId"));
      const setFn = await resolveSkillFn("setSelectedProjectSkills", deps, moduleCache);
      const compileFn = await resolveSkillFn("compileSkillDirectives", deps, moduleCache);
      const selectedSkills = await callSetSelectedSkills(setFn, slug, cleanSkillIds);
      const directives = await compileFn({
        slug,
        skillIds: selectedSkills,
      });

      if (typeof deps.broadcastEvent === "function") {
        deps.broadcastEvent("skills_updated", { slug, selectedSkills });
      }

      sendJson(res, 200, { ok: true, selectedSkills, directives });
      return true;
    }

    // 4. GET & POST /api/projects/:slug/rating
    if (matched.kind === "project-rating") {
      if (method !== "GET" && method !== "POST") {
        sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
        return true;
      }

      const body = method === "POST" ? await readBody(req) : {};
      const ratingArgs = { slug };
      if (body.project && typeof body.project === "object") {
        ratingArgs.project = body.project;
      }
      if (body.storyboard && typeof body.storyboard === "object") {
        ratingArgs.storyboard = body.storyboard;
      }
      if (Array.isArray(body.selectedSkillSpecs)) {
        ratingArgs.selectedSkillSpecs = body.selectedSkillSpecs;
      } else if (Array.isArray(body.selectedSkills)) {
        const cleanIds = body.selectedSkills.map((id) => validateSafeIdentifier(id, "skillId"));
        const discoverFn = await resolveOptionalSkillFn("discoverLocalSkills", deps, moduleCache);
        if (discoverFn) {
          const all = normalizeArrayResult(await discoverFn({ slug }), "skills");
          const idSet = new Set(cleanIds);
          ratingArgs.selectedSkillSpecs = all.filter((s) => idSet.has(s.id));
        }
      }

      const evaluateRatingFn = await resolveRatingFn(deps, moduleCache);
      const rawRating = await evaluateRatingFn(ratingArgs);
      const baseRating =
        rawRating?.rating && typeof rawRating.rating === "object" ? rawRating.rating : rawRating;

      const rating =
        baseRating && typeof baseRating === "object"
          ? {
              ...baseRating,
              ...(baseRating.categories && !baseRating.subScores
                ? { subScores: baseRating.categories }
                : {}),
              ...(baseRating.subScores && !baseRating.categories
                ? { categories: baseRating.subScores }
                : {}),
            }
          : baseRating;

      sendJson(res, 200, { ok: true, rating });
      return true;
    }

    // 5. POST /api/projects/:slug/storyboard/frames/:frameId/regenerate-region
    if (matched.kind === "regenerate-region") {
      const frameId = validateSafeIdentifier(
        decodeUriSegmentOrThrow(matched.rawFrameId, "frameId"),
        "frameId",
      );

      if (method !== "POST") {
        sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
        return true;
      }

      const body = await readBody(req);
      let selectedSkills = [];
      if (Array.isArray(body.selectedSkills)) {
        selectedSkills = body.selectedSkills.map((id) => validateSafeIdentifier(id, "skillId"));
      } else {
        const getSelectedFn = await resolveOptionalSkillFn(
          "getSelectedProjectSkills",
          deps,
          moduleCache,
        );
        selectedSkills = await callGetSelectedSkills(getSelectedFn, slug);
      }

      const regenRegionFn = await resolveInpaintFn("regenerateFrameRegion", deps, moduleCache);
      const result = await regenRegionFn({
        slug,
        frameId,
        maskDataUrl: body.maskDataUrl ?? null,
        compositeDataUrl: body.compositeDataUrl ?? null,
        strokes: Array.isArray(body.strokes) ? body.strokes : [],
        regionBox: body.regionBox ?? null,
        prompt: String(body.prompt ?? ""),
        selectedSkills,
        enqueueAiInpaint: Boolean(body.enqueueAiInpaint),
      });

      const decoratedStoryboard = result?.storyboard
        ? decorateV2StoryboardForUi(slug, result.storyboard, projectDir)
        : null;
      const decoratedFrame =
        decoratedStoryboard?.frames?.find((f) => f.id === frameId) ||
        (result?.frame ? decorateV2FrameForUi(slug, projectDir, result.frame) : null);

      const maskUrl = result?.maskRelPath
        ? toV2MediaUrl(slug, projectDir, result.maskRelPath)
        : null;
      const compositeUrl = result?.compositeRelPath
        ? toV2MediaUrl(slug, projectDir, result.compositeRelPath)
        : null;

      if (typeof deps.broadcastEvent === "function" && decoratedStoryboard) {
        const ssePayload = {
          slug,
          frame: decoratedFrame,
          storyboard: decoratedStoryboard,
        };
        deps.broadcastEvent("storyboard_updated", ssePayload);
        deps.broadcastEvent("storyboard-updated", ssePayload);
      }

      sendJson(res, 200, {
        ok: true,
        ...(result && typeof result === "object" ? result : {}),
        ...(decoratedFrame ? { frame: decoratedFrame } : {}),
        ...(decoratedStoryboard ? { storyboard: decoratedStoryboard } : {}),
        ...(maskUrl ? { maskUrl } : {}),
        ...(compositeUrl ? { compositeUrl } : {}),
      });
      return true;
    }

    // 6 & 7. GET / POST /api/projects/:slug/saved-frames
    if (matched.kind === "saved-frames") {
      if (method === "GET") {
        const listFn = await resolveInpaintFn("listSavedFrames", deps, moduleCache);
        const rawList = await callListSavedFrames(listFn, slug);
        const savedFrames = rawList.map((item) => decorateSavedFrameForUi(slug, projectDir, item));
        sendJson(res, 200, { ok: true, savedFrames });
        return true;
      }

      if (method === "POST") {
        const body = await readBody(req);
        const frameId = validateSafeIdentifier(body.frameId, "frameId");
        let version;
        if (body.version !== undefined && body.version !== null && body.version !== "") {
          version = Number(body.version);
          if (!Number.isFinite(version) || version < 1) {
            sendError(res, 400, "version must be a positive number");
            return true;
          }
        }
        const label = body.label !== undefined && body.label !== null ? String(body.label) : "";
        const notes = body.notes !== undefined && body.notes !== null ? String(body.notes) : "";

        const saveFn = await resolveInpaintFn("saveDesignFrameBookmark", deps, moduleCache);
        const listFn = await resolveOptionalInpaintFn("listSavedFrames", deps, moduleCache);
        const { savedFrame: rawSaved, savedFrames: rawAll } = await callSaveBookmark(
          saveFn,
          listFn,
          slug,
          { frameId, version, label, notes },
        );

        const savedFrame = decorateSavedFrameForUi(slug, projectDir, rawSaved);
        const savedFrames = rawAll.map((item) => decorateSavedFrameForUi(slug, projectDir, item));
        sendJson(res, 200, { ok: true, savedFrame, savedFrames });
        return true;
      }

      sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
      return true;
    }

    // 8. DELETE /api/projects/:slug/saved-frames/:savedId
    if (matched.kind === "saved-frame-item") {
      const savedId = validateSafeIdentifier(
        decodeUriSegmentOrThrow(matched.rawSavedId, "savedId"),
        "savedId",
      );

      if (method !== "DELETE") {
        sendError(res, 405, `Method ${method} not allowed for ${pathname}`);
        return true;
      }

      const deleteFn = await resolveInpaintFn("deleteSavedFrame", deps, moduleCache);
      const listFn = await resolveOptionalInpaintFn("listSavedFrames", deps, moduleCache);
      const rawRemaining = await callDeleteSavedFrame(deleteFn, listFn, slug, savedId);
      const savedFrames = rawRemaining.map((item) =>
        decorateSavedFrameForUi(slug, projectDir, item),
      );
      sendJson(res, 200, { ok: true, savedFrames });
      return true;
    }
  } catch (err) {
    if (!res.headersSent) {
      const status = classifyV2ErrorStatus(err);
      sendError(res, status, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  return false;
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertValidSlug, PROJECTS_DIR, ROOT_DIR } from "./lib.mjs";
import {
  discoverLocalSkills,
  getSelectedProjectSkills,
  parseSkillMarkdown,
  sanitizeSkillId,
} from "./skills-registry.mjs";

export const BUNDLE_FORMAT = "studioskills-v1";
export const BUNDLE_SCHEMA_VERSION = 1;

const ALLOWED_BUNDLE_FILE_RE = /\.(?:studioskills(?:\.json)?|json)$/i;
const SAFE_REF_MD_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.md$/i;

function assertNoTraversalTokens(rawValue, label) {
  const str = String(rawValue ?? "");
  if (str.includes("\0")) {
    throw new Error(`Invalid ${label}: null byte detected`);
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(str) || str.includes("..")) {
    throw new Error(`Unsafe ${label}: path traversal is not allowed`);
  }
}

function ensureContainedSubpath(baseDir, childRel, label = "path") {
  assertNoTraversalTokens(childRel, label);
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, childRel);
  const prefix = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
  const isInside =
    process.platform === "win32"
      ? resolvedTarget.toLowerCase().startsWith(prefix.toLowerCase())
      : resolvedTarget.startsWith(prefix);
  if (!isInside || resolvedTarget === resolvedBase) {
    throw new Error(`Unsafe ${label}: resolved outside target root`);
  }
  return resolvedTarget;
}

function resolveProjectDirSafe(slug, rootDir = ROOT_DIR) {
  const resolvedRoot = path.resolve(rootDir || ROOT_DIR);
  if (resolvedRoot === ROOT_DIR) {
    return assertValidSlug(slug);
  }
  assertNoTraversalTokens(slug, "project slug");
  return ensureContainedSubpath(path.join(resolvedRoot, "projects"), slug, "project slug");
}

function readSkillReferencesMap(skillDir) {
  const refs = {};
  if (!skillDir) return refs;
  const refsDir = path.join(skillDir, "references");
  if (!fs.existsSync(refsDir)) return refs;

  let entries = [];
  try {
    entries = fs.readdirSync(refsDir, { withFileTypes: true });
  } catch {
    return refs;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isFile()) continue;
    if (!SAFE_REF_MD_NAME_RE.test(entry.name)) continue;
    const fullPath = path.join(refsDir, entry.name);
    refs[entry.name] = fs.readFileSync(fullPath, "utf8");
  }
  return refs;
}

function resolveSafeExportFilePath(outFilePath, { slug = null, rootDir = ROOT_DIR } = {}) {
  const raw = String(outFilePath || "").trim();
  assertNoTraversalTokens(raw, "outFilePath");
  if (!ALLOWED_BUNDLE_FILE_RE.test(raw)) {
    throw new Error(
      `Invalid bundle file extension for "${raw}". Expected .studioskills.json, .studioskills, or .json.`,
    );
  }

  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }

  const resolvedRoot = path.resolve(rootDir || ROOT_DIR);
  if (slug) {
    const projectDir = resolveProjectDirSafe(slug, resolvedRoot);
    return ensureContainedSubpath(path.join(projectDir, "output"), raw, "outFilePath");
  }
  return ensureContainedSubpath(resolvedRoot, raw, "outFilePath");
}

export async function exportSkillBundle(opts = {}) {
  const {
    skillIds = null,
    selectedSkills = null,
    outFilePath = null,
    outputPath = null,
    filePath = null,
    slug = null,
    bundleName = null,
    rootDir = ROOT_DIR,
    globalSkillsDir = null,
  } = opts || {};

  const resolvedRoot = path.resolve(rootDir || ROOT_DIR);
  const explicitIds = Array.isArray(skillIds)
    ? skillIds
    : Array.isArray(selectedSkills)
      ? selectedSkills
      : null;

  let rawIds = explicitIds;
  if ((!rawIds || rawIds.length === 0) && slug) {
    const projectSelected = getSelectedProjectSkills(slug, { rootDir: resolvedRoot });
    if (projectSelected.length > 0) {
      rawIds = projectSelected;
    } else {
      const localInstalled = discoverLocalSkills({
        slug,
        rootDir: resolvedRoot,
        globalSkillsDir,
      }).filter(
        (s) => s.installed && (s.sourceScope === "project" || s.sourceScope === "workspace-agents"),
      );
      rawIds = localInstalled.map((s) => s.id);
    }
  }

  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new Error("exportSkillBundle requires a non-empty skillIds array.");
  }

  const normalizedIds = [];
  const seen = new Set();
  for (const item of rawIds) {
    const cleanId = sanitizeSkillId(item);
    if (!seen.has(cleanId)) {
      seen.add(cleanId);
      normalizedIds.push(cleanId);
    }
  }
  if (normalizedIds.length === 0) {
    throw new Error("exportSkillBundle received no valid skill IDs.");
  }

  const catalog = discoverLocalSkills({ slug, rootDir: resolvedRoot, globalSkillsDir });
  const byId = new Map(catalog.map((s) => [s.id, s]));

  const bundledSkills = [];
  for (const id of normalizedIds) {
    const found = byId.get(id);
    if (!found || !found.skillMdPath || !fs.existsSync(found.skillMdPath)) {
      throw new Error(`Local skill "${id}" was not found on disk for bundle export.`);
    }

    const skillMd = fs.readFileSync(found.skillMdPath, "utf8");
    const references = readSkillReferencesMap(found.skillDir);

    bundledSkills.push({
      id: found.id,
      name: found.name,
      description: found.description,
      category: found.category,
      skillMd,
      references,
      ruleHighlights: found.ruleHighlights,
      extractedHexColors: found.extractedHexColors,
      motionKeywords: found.motionKeywords,
    });
  }

  const checksumSha256 = crypto
    .createHash("sha256")
    .update(JSON.stringify(bundledSkills))
    .digest("hex");

  const exportedAt = new Date().toISOString();
  const effectiveName =
    String(bundleName || "").trim() ||
    (slug ? `${slug}-skills` : `studio-skills-${bundledSkills.length}`);

  const bundle = {
    format: BUNDLE_FORMAT,
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    name: effectiveName,
    exportedAt,
    skillCount: bundledSkills.length,
    checksumSha256,
    skills: bundledSkills,
  };

  const targetOutRaw = outFilePath ?? outputPath ?? filePath ?? null;
  let writtenFilePath = null;
  let downloadUrl = null;

  if (targetOutRaw !== null && String(targetOutRaw).trim() !== "") {
    writtenFilePath = resolveSafeExportFilePath(targetOutRaw, { slug, rootDir: resolvedRoot });
    fs.mkdirSync(path.dirname(writtenFilePath), { recursive: true });
    fs.writeFileSync(writtenFilePath, JSON.stringify(bundle, null, 2) + "\n", "utf8");

    if (slug) {
      const projectsBase =
        resolvedRoot === ROOT_DIR ? PROJECTS_DIR : path.join(resolvedRoot, "projects");
      const projectDir = path.join(projectsBase, slug);
      const rel = path.relative(projectDir, writtenFilePath).replaceAll("\\", "/");
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
        downloadUrl = `/media/${encodeURIComponent(slug)}/${rel}`;
      }
    }
  }

  return {
    ok: true,
    ...bundle,
    bundle,
    outFilePath: writtenFilePath,
    downloadUrl,
  };
}

function normalizeSafeReferenceFilename(rawRefKey) {
  assertNoTraversalTokens(rawRefKey, "reference filename");
  const str = String(rawRefKey || "")
    .trim()
    .replaceAll("\\", "/");
  const stripped = str.startsWith("references/") ? str.slice("references/".length) : str;

  if (stripped.includes("/") || stripped.includes(":")) {
    throw new Error(
      `Unsafe reference path "${rawRefKey}": nested or absolute paths are forbidden.`,
    );
  }
  if (!SAFE_REF_MD_NAME_RE.test(stripped)) {
    throw new Error(
      `Invalid reference filename "${rawRefKey}": only safe Markdown (*.md) files are allowed.`,
    );
  }
  return stripped;
}

function extractValidatedReferencesMap(rawReferences) {
  const cleanRefs = new Map();
  if (!rawReferences) return cleanRefs;

  if (Array.isArray(rawReferences)) {
    for (const item of rawReferences) {
      if (!item || typeof item !== "object") {
        throw new Error("Invalid reference entry in bundle array.");
      }
      const key = normalizeSafeReferenceFilename(item.name || item.relPath || "");
      const content = String(item.content ?? "");
      cleanRefs.set(key, content);
    }
    return cleanRefs;
  }

  if (typeof rawReferences === "object") {
    for (const [rawKey, rawVal] of Object.entries(rawReferences)) {
      const key = normalizeSafeReferenceFilename(rawKey);
      if (typeof rawVal !== "string") {
        throw new Error(`Reference "${key}" content must be a UTF-8 string.`);
      }
      cleanRefs.set(key, rawVal);
    }
    return cleanRefs;
  }

  throw new Error("Invalid references field in skill bundle.");
}

function ensureFrontmatterOnImportedMarkdown(rawSkillMd, safeId, fallbackDescription = "") {
  const text = String(rawSkillMd || "").trim();
  if (!text) {
    throw new Error(`Skill "${safeId}" in bundle has empty SKILL.md content.`);
  }
  if (/^---\r?\n[\s\S]*?\r?\n---\r?\n?/.test(text)) {
    return text + "\n";
  }
  const cleanDesc = String(fallbackDescription || `Imported skill ${safeId}`)
    .replace(/\r?\n+/g, " ")
    .replace(/"/g, '\\"')
    .trim();
  return `---\nname: ${safeId}\ndescription: "${cleanDesc}"\n---\n\n${text}\n`;
}

function parseBundleInput(rawBundleDataOrPath) {
  if (!rawBundleDataOrPath) {
    throw new Error("bundleDataOrPath is required to import a skill bundle.");
  }

  let parsedObj;
  if (typeof rawBundleDataOrPath === "string") {
    const trimmed = rawBundleDataOrPath.trim();
    if (!trimmed) {
      throw new Error("bundleDataOrPath cannot be empty.");
    }
    if (trimmed.startsWith("{")) {
      parsedObj = JSON.parse(trimmed);
    } else {
      assertNoTraversalTokens(trimmed, "bundleDataOrPath");
      const resolvedPath = path.resolve(trimmed);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Skill bundle file not found: ${resolvedPath}`);
      }
      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        throw new Error(`Skill bundle path is not a file: ${resolvedPath}`);
      }
      parsedObj = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    }
  } else if (typeof rawBundleDataOrPath === "object") {
    parsedObj = rawBundleDataOrPath;
  } else {
    throw new Error("Unsupported bundleDataOrPath type.");
  }

  const candidate =
    parsedObj?.bundle &&
    typeof parsedObj.bundle === "object" &&
    Array.isArray(parsedObj.bundle.skills)
      ? parsedObj.bundle
      : parsedObj;

  if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.skills)) {
    throw new Error("Invalid .studioskills bundle: missing skills array.");
  }
  if (candidate.skills.length === 0) {
    throw new Error("Invalid .studioskills bundle: skills array is empty.");
  }
  return candidate;
}

export async function importSkillBundle(input = {}) {
  const normalizedOpts =
    typeof input === "string" || (input && Array.isArray(input.skills))
      ? { bundleDataOrPath: input }
      : input || {};

  const {
    bundleDataOrPath = null,
    bundle = null,
    bundleData = null,
    bundlePath = null,
    filePath = null,
    targetScope = "workspace",
    slug = null,
    rootDir = ROOT_DIR,
    globalSkillsDir = null,
  } = normalizedOpts;

  if (targetScope !== "workspace" && targetScope !== "project") {
    throw new Error(`Invalid targetScope "${targetScope}". Must be "workspace" or "project".`);
  }

  const resolvedRoot = path.resolve(rootDir || ROOT_DIR);
  let targetBaseDir;
  let scopeLabel;

  if (targetScope === "project") {
    if (!slug) {
      throw new Error("Project slug is required when targetScope is 'project'.");
    }
    const projectDir = resolveProjectDirSafe(slug, resolvedRoot);
    targetBaseDir = path.join(projectDir, "skills");
    scopeLabel = "project";
  } else {
    targetBaseDir = path.join(resolvedRoot, ".agents", "skills");
    scopeLabel = "workspace-agents";
  }

  const effectiveSource = bundleDataOrPath ?? bundle ?? bundleData ?? bundlePath ?? filePath;
  const parsedBundle = parseBundleInput(effectiveSource);

  // Phase 1: Strictly validate ALL skills and ALL reference paths BEFORE touching disk (atomic safety)
  const stagedWrites = [];
  for (const rawSkill of parsedBundle.skills) {
    if (!rawSkill || typeof rawSkill !== "object") {
      throw new Error("Invalid skill entry in bundle.");
    }
    const rawIdentifier = rawSkill.id ?? rawSkill.name;
    assertNoTraversalTokens(rawIdentifier, "skill id");
    const safeId = sanitizeSkillId(rawIdentifier);
    const destSkillDir = ensureContainedSubpath(targetBaseDir, safeId, "skill directory");

    const normalizedSkillMd = ensureFrontmatterOnImportedMarkdown(
      rawSkill.skillMd ?? rawSkill.content,
      safeId,
      rawSkill.description,
    );
    const validatedRefs = extractValidatedReferencesMap(rawSkill.references);
    const stagedRefs = [];
    const destRefsBase = path.join(destSkillDir, "references");
    for (const [refName, refContent] of validatedRefs.entries()) {
      const destRefPath = ensureContainedSubpath(destRefsBase, refName, "reference file");
      stagedRefs.push({ refName, destRefPath, refContent });
    }

    stagedWrites.push({
      safeId,
      destSkillDir,
      destSkillMdPath: path.join(destSkillDir, "SKILL.md"),
      normalizedSkillMd,
      stagedRefs,
    });
  }

  // Phase 2: Commit validated skills and references to disk
  fs.mkdirSync(targetBaseDir, { recursive: true });
  const importedSkills = [];

  for (const item of stagedWrites) {
    fs.mkdirSync(item.destSkillDir, { recursive: true });
    fs.writeFileSync(item.destSkillMdPath, item.normalizedSkillMd, "utf8");

    if (item.stagedRefs.length > 0) {
      fs.mkdirSync(path.join(item.destSkillDir, "references"), { recursive: true });
      for (const ref of item.stagedRefs) {
        fs.writeFileSync(ref.destRefPath, ref.refContent, "utf8");
      }
    }

    const parsed = parseSkillMarkdown(item.normalizedSkillMd, {
      fallbackId: item.safeId,
      skillDir: item.destSkillDir,
      skillMdPath: item.destSkillMdPath,
    });

    importedSkills.push({
      id: item.safeId,
      name: parsed.name,
      description: parsed.description,
      category: parsed.category,
      sourceScope: scopeLabel,
      installed: true,
      ruleHighlights: parsed.ruleHighlights,
      ExtractedHexColors: parsed.ExtractedHexColors,
      extractedHexColors: parsed.extractedHexColors,
      motionKeywords: parsed.motionKeywords,
      negativeConstraints: parsed.negativeConstraints,
      skillDir: item.destSkillDir,
      skillMdPath: item.destSkillMdPath,
      hasReferences: parsed.hasReferences,
      hasScripts: parsed.hasScripts,
      hasAssets: parsed.hasAssets,
      availableScopes: [scopeLabel],
    });
  }

  const skills = discoverLocalSkills({ slug, rootDir: resolvedRoot, globalSkillsDir });
  return {
    ok: true,
    targetScope,
    slug: slug || null,
    importedCount: importedSkills.length,
    importedSkillIds: importedSkills.map((s) => s.id),
    importedSkills,
    skills,
  };
}

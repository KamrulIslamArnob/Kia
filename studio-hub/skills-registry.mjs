import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertValidSlug,
  ensureProjectDirs,
  PROJECTS_DIR,
  ROOT_DIR,
  syncProjectManifest,
} from "./lib.mjs";

const VALID_CATEGORIES = new Set(["motion", "captions", "design", "video", "brand", "general"]);

const CANONICAL_LAYOUT_ARCHETYPES = [
  "device-3d-showcase",
  "split-editorial",
  "fullbleed-cinema",
  "bento-feature-grid",
  "spotlight-cursor-zoom",
  "kinetic-statement-card",
];

const MOTION_TOKEN_PATTERNS = [
  ["zoom-through", /\bzoom-through\b/i],
  ["inverse-zoom", /\binverse[- ]zoom\b/i],
  ["cut-the-curve", /\bcut-the-curve\b/i],
  ["waterfall-cut", /\bwaterfall[- ]cut\b/i],
  ["waterfall", /\bwaterfall\b/i],
  ["rack-focus", /\brack[- ]focus\b/i],
  ["whip-pan", /\bwhip[- ]pan\b/i],
  ["nudge-curve", /\bnudge[- ]curve\b/i],
  ["oversized-cursor", /\boversized[- ]cursor\b/i],
  ["blur-morph", /\bblur[- ]morph\b/i],
  ["split-slot", /\bsplit[- ]slot\b/i],
  ["speed-ramp", /\bspeed[- ]ramp(?:ing)?\b/i],
  ["crash-zoom", /\bcrash[- ]zoom\b/i],
  ["dolly-out", /\bdolly[- ]out\b/i],
  ["3d-perspective", /\b(?:3d[- ]perspective|perspective\(\d+px\)|rotateY)\b/i],
  ["parallax", /\bparallax\b/i],
  ["stagger", /\bstagger(?:ed)?\b/i],
  ["power4", /\bpower4\.(?:in|out|inOut)\b/i],
  ["power3", /\bpower3\.(?:in|out|inOut)\b/i],
  ["expo", /\bexpo\.(?:in|out|inOut)\b/i],
  ["gsap", /\bgsap\b/i],
  ["fromTo", /\bfromTo\b/],
  ["seam-gate", /\bseam[- ]gate\b/i],
  ["ping-pong-tracks", /\bping[- ]pong\b/i],
  ["spotlight", /\bspotlight\b/i],
  ["cursor-click", /\bclick[- ]ignit|click\s+tap\b/i],
];

const COPY_SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".DS_Store"]);

function resolveDefaultGlobalSkillsDir() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir() || "";
  if (!home) return "";
  return path.join(home, ".gemini", "config", "skills");
}

function assertNoTraversalTokens(rawValue, label) {
  const str = String(rawValue ?? "");
  if (str.includes("\0")) {
    throw new Error(`Invalid ${label}: null byte detected`);
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(str) || str.includes("..")) {
    throw new Error(`Unsafe ${label}: path traversal is not allowed`);
  }
}

export function sanitizeSkillId(rawName) {
  assertNoTraversalTokens(rawName, "skill identifier");
  const str = String(rawName || "").trim();
  if (/[\\/]/.test(str)) {
    throw new Error(`Unsafe skill identifier "${str}": path separators are not allowed`);
  }
  const cleaned = str
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error(`Invalid skill identifier: "${rawName}"`);
  }
  return cleaned.slice(0, 80);
}

function ensureContainedSubpath(baseDir, childName, label = "skill path") {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, childName);
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

function unquoteYamlScalar(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
  }
  return trimmed;
}

function parseYamlFrontmatter(rawMarkdown) {
  const text = String(rawMarkdown || "");
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) {
    return { frontmatter: {}, body: text };
  }

  const yamlBlock = fmMatch[1];
  const body = text.slice(fmMatch[0].length);
  const lines = yamlBlock.split(/\r?\n/);
  const frontmatter = {};

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (!keyMatch) {
      i += 1;
      continue;
    }

    const key = keyMatch[1];
    const rest = keyMatch[2].trim();

    if (rest === ">" || rest === ">-" || rest === "|" || rest === "|-") {
      const blockLines = [];
      i += 1;
      while (i < lines.length && (/^\s+\S/.test(lines[i]) || lines[i].trim() === "")) {
        blockLines.push(lines[i].trim());
        i += 1;
      }
      const joiner = rest.startsWith("|") ? "\n" : " ";
      frontmatter[key] = blockLines.filter(Boolean).join(joiner).trim();
      continue;
    }

    const continuation = [unquoteYamlScalar(rest)];
    i += 1;
    while (
      i < lines.length &&
      /^\s{2,}\S/.test(lines[i]) &&
      !/^\s+[a-zA-Z0-9_-]+\s*:/.test(lines[i])
    ) {
      continuation.push(lines[i].trim());
      i += 1;
    }
    frontmatter[key] = continuation.filter(Boolean).join(" ").trim();
  }

  return { frontmatter, body };
}

function stripFencedCodeBlocks(markdownBody) {
  return String(markdownBody || "").replace(/```[\s\S]*?```/g, "\n");
}

function cleanInlineMarkdown(line) {
  return String(line || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRuleHighlights(markdownBody, maxRules = 5) {
  const prose = stripFencedCodeBlocks(markdownBody);
  const lines = prose.split(/\r?\n/);
  const rawBullets = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const bulletMatch = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (!bulletMatch) continue;

    let combined = bulletMatch[1].trim();
    while (
      i + 1 < lines.length &&
      /^\s{2,}\S/.test(lines[i + 1]) &&
      !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i + 1]) &&
      !lines[i + 1].trim().startsWith("|")
    ) {
      combined += " " + lines[i + 1].trim();
      i += 1;
    }

    const cleaned = cleanInlineMarkdown(combined);
    if (cleaned.length < 12) continue;
    if (/^_[a-z\s]+_$/i.test(cleaned)) continue;

    rawBullets.push({
      index: rawBullets.length,
      text: cleaned.length > 220 ? `${cleaned.slice(0, 217).trim()}...` : cleaned,
    });
  }

  const scored = rawBullets.map((item) => {
    let score = 0;
    if (/\b\d+(?:\.\d+)?\s*(?:px|%|s|ms|fps|cqw|deg|x|LUFS|dB|:1)\b/i.test(item.text)) {
      score += 4;
    } else if (/\b\d+(?:\.\d+)?\b/.test(item.text)) {
      score += 2;
    }
    if (/#[0-9a-fA-F]{6}\b/.test(item.text)) {
      score += 2;
    }
    if (
      /\b(?:DO NOT|Never|Always|Must|Enforce|Keep|Use|Avoid|Center|Maintain|Pair|Open|Showcase)\b/i.test(
        item.text,
      )
    ) {
      score += 2;
    }
    if (/[<>]=?\s*\d/.test(item.text)) {
      score += 2;
    }
    return { ...item, score };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = scored.slice(0, maxRules).sort((a, b) => a.index - b.index);

  if (selected.length > 0) {
    return selected.map((s) => s.text);
  }

  // Fallback for prose-only custom SKILL.md files without bullet lists
  const fallbackSentences = prose
    .split(/\r?\n/)
    .map((l) => cleanInlineMarkdown(l))
    .filter(
      (l) => l.length >= 16 && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("---"),
    );

  return fallbackSentences.slice(0, maxRules);
}

function extractHexColors(rawMarkdown) {
  const seen = new Set();
  const colors = [];
  const text = String(rawMarkdown || "");

  const sixCharRegex = /#([0-9a-fA-F]{6})\b/g;
  for (const match of text.matchAll(sixCharRegex)) {
    const normalized = `#${match[1].toUpperCase()}`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      colors.push(normalized);
    }
  }

  const threeCharContextRegex = /(?:`|:\s*|,\s*)#([0-9a-fA-F]{3})(?=`|\b|;|\))/g;
  for (const match of text.matchAll(threeCharContextRegex)) {
    const [r, g, b] = match[1].toUpperCase().split("");
    const normalized = `#${r}${r}${g}${g}${b}${b}`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      colors.push(normalized);
    }
  }

  return colors;
}

function extractMotionKeywords(frontmatter, body) {
  const combined = `${frontmatter.name || ""}\n${frontmatter.description || ""}\n${body || ""}`;
  const found = new Set();

  for (const [token, regex] of MOTION_TOKEN_PATTERNS) {
    if (regex.test(combined)) {
      found.add(token);
    }
  }

  // Also parse trailing bracketed tags in description, e.g. [continuity, vector, seam]
  const desc = String(frontmatter.description || "");
  const bracketMatch = desc.match(/\[([^\]]+)\]\s*$/);
  if (bracketMatch) {
    for (const rawTag of bracketMatch[1].split(",")) {
      const cleanTag = rawTag.trim().toLowerCase();
      if (/^[a-z0-9][a-z0-9-]{1,28}$/.test(cleanTag)) {
        found.add(cleanTag);
      }
    }
  }

  return [...found].slice(0, 16);
}

function extractNegativeConstraints(markdownBody) {
  const prose = stripFencedCodeBlocks(markdownBody);
  const constraints = [];
  for (const line of prose.split(/\r?\n/)) {
    const cleaned = cleanInlineMarkdown(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""));
    if (!cleaned || cleaned.length < 10) continue;
    if (/^(?:DO NOT|DON'T|Never|Avoid|Ban\b)/i.test(cleaned) || /\bDO NOT\b/.test(cleaned)) {
      constraints.push(cleaned.length > 200 ? `${cleaned.slice(0, 197)}...` : cleaned);
    }
    if (constraints.length >= 5) break;
  }
  return constraints;
}

function classifySkillCategory({ id, name, description, body }) {
  const idAndName = `${id} ${name}`.toLowerCase();
  const headerAndDesc = `${id} ${name} ${description}`.toLowerCase();
  const sampleBody = String(body || "")
    .slice(0, 1800)
    .toLowerCase();

  if (/\b(?:caption|captions|subtitle|subtitles|karaoke)\b/.test(idAndName)) {
    return "captions";
  }
  if (/\b(?:brandkit|brand-kit|brand|palette|better-colors)\b/.test(idAndName)) {
    return "brand";
  }
  if (
    /\b(?:motion|seam|curve|cursor|transition|velocity|choreograph|kinetic-rules)\b/.test(idAndName)
  ) {
    return "motion";
  }
  if (
    /\b(?:ui|layout|typography|accessibility|interface|design|minimalist|monochrome|brutalist|impeccable|figma|stitch|taste)\b/.test(
      idAndName,
    )
  ) {
    return "design";
  }
  if (/\b(?:video|reel|hyperframes|remotion|director|media-use|slideshow|film)\b/.test(idAndName)) {
    return "video";
  }

  // Score description + lead body when id/name is generic
  const scores = {
    captions: 0,
    brand: 0,
    motion: 0,
    design: 0,
    video: 0,
  };

  const full = `${headerAndDesc} ${sampleBody}`;
  if (/\bcaptions?\b|\bsubtitles?\b|\bverbatim rail\b/.test(full)) scores.captions += 4;
  if (/\bbrand guidelines?\b|\bbrand identity\b|\bcolor system\b|\blogo\b/.test(full)) {
    scores.brand += 4;
  }
  if (/\bcamera move\b|\bzoom-through\b|\bseam\b|\bvelocity\b|\bgsap\b|\bwhip-pan\b/.test(full)) {
    scores.motion += 3;
  }
  if (
    /\bbento\b|\btypography\b|\bmonochrome\b|\bwhitespace\b|\bfrontend\b|\bcomponent\b/.test(full)
  ) {
    scores.design += 3;
  }
  if (/\bmp4\b|\brender\b|\bfootage\b|\bvoiceover\b|\bstoryboard\b|\breel\b/.test(full)) {
    scores.video += 3;
  }

  let bestCat = "general";
  let bestScore = 0;
  for (const [cat, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat;
    }
  }
  return VALID_CATEGORIES.has(bestCat) ? bestCat : "general";
}

export function parseSkillMarkdown(
  rawMarkdown,
  { fallbackId = "skill", skillDir = "", skillMdPath = "" } = {},
) {
  const { frontmatter, body } = parseYamlFrontmatter(rawMarkdown);
  const headingMatch = body.match(/^\s*#\s+(.+)$/m);
  const name =
    frontmatter.name || (headingMatch ? cleanInlineMarkdown(headingMatch[1]) : fallbackId);

  let description = frontmatter.description || "";
  if (!description) {
    const firstPara = stripFencedCodeBlocks(body)
      .split(/\r?\n/)
      .map((l) => cleanInlineMarkdown(l))
      .find((l) => l.length > 15 && !l.startsWith("#") && !l.startsWith("-") && !l.startsWith("|"));
    description = firstPara || "";
  }

  const category = classifySkillCategory({
    id: fallbackId,
    name,
    description,
    body,
  });
  const ruleHighlights = extractRuleHighlights(body, 5);
  const hexColors = extractHexColors(rawMarkdown);
  const motionKeywords = extractMotionKeywords(frontmatter, body);
  const negativeConstraints = extractNegativeConstraints(body);

  return {
    id: fallbackId,
    name,
    description,
    category,
    ruleHighlights,
    ExtractedHexColors: hexColors,
    extractedHexColors: hexColors,
    motionKeywords,
    negativeConstraints,
    skillDir,
    skillMdPath,
    hasReferences: Boolean(skillDir && fs.existsSync(path.join(skillDir, "references"))),
    hasScripts: Boolean(skillDir && fs.existsSync(path.join(skillDir, "scripts"))),
    hasAssets: Boolean(skillDir && fs.existsSync(path.join(skillDir, "assets"))),
    rawBody: body,
  };
}

function scanSkillsInDirectory(baseDir, sourceScope, installedByDefault) {
  if (!baseDir || !fs.existsSync(baseDir)) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillDir = path.join(baseDir, entry.name);
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;

    let rawMarkdown = "";
    try {
      rawMarkdown = fs.readFileSync(skillMdPath, "utf8");
    } catch {
      continue;
    }

    const parsed = parseSkillMarkdown(rawMarkdown, {
      fallbackId: entry.name,
      skillDir,
      skillMdPath,
    });

    results.push({
      id: entry.name,
      name: parsed.name,
      description: parsed.description,
      category: parsed.category,
      sourceScope,
      installed: installedByDefault,
      ruleHighlights: parsed.ruleHighlights,
      ExtractedHexColors: parsed.ExtractedHexColors,
      extractedHexColors: parsed.extractedHexColors,
      motionKeywords: parsed.motionKeywords,
      negativeConstraints: parsed.negativeConstraints,
      skillDir,
      skillMdPath,
      hasReferences: parsed.hasReferences,
      hasScripts: parsed.hasScripts,
      hasAssets: parsed.hasAssets,
    });
  }

  results.sort((a, b) => a.id.localeCompare(b.id));
  return results;
}

export function discoverLocalSkills({
  slug = null,
  rootDir = ROOT_DIR,
  globalSkillsDir = null,
} = {}) {
  const resolvedRoot = path.resolve(rootDir || ROOT_DIR);
  const resolvedProjectsDir =
    resolvedRoot === ROOT_DIR ? PROJECTS_DIR : path.join(resolvedRoot, "projects");

  let projectSkillsDir = null;
  if (slug) {
    if (resolvedRoot === ROOT_DIR) {
      projectSkillsDir = path.join(assertValidSlug(slug), "skills");
    } else {
      assertNoTraversalTokens(slug, "project slug");
      projectSkillsDir = path.join(
        ensureContainedSubpath(resolvedProjectsDir, slug, "project slug"),
        "skills",
      );
    }
  }

  const workspaceAgentsDir = path.join(resolvedRoot, ".agents", "skills");
  const workspaceSkillsDir = path.join(resolvedRoot, "skills");
  const resolvedGlobalDir =
    globalSkillsDir !== null ? globalSkillsDir : resolveDefaultGlobalSkillsDir();

  const projectSkills = projectSkillsDir
    ? scanSkillsInDirectory(projectSkillsDir, "project", true)
    : [];
  const workspaceAgentSkills = scanSkillsInDirectory(workspaceAgentsDir, "workspace-agents", true);
  const workspaceCoreSkills = scanSkillsInDirectory(workspaceSkillsDir, "workspace-skills", true);
  const globalAvailableSkills = resolvedGlobalDir
    ? scanSkillsInDirectory(resolvedGlobalDir, "global-available", false)
    : [];

  const mirroredLocalIds = new Set([
    ...projectSkills.map((s) => s.id),
    ...workspaceAgentSkills.map((s) => s.id),
  ]);

  const byId = new Map();
  const orderedBatches = [
    projectSkills,
    workspaceAgentSkills,
    workspaceCoreSkills,
    globalAvailableSkills.map((s) => ({
      ...s,
      installed: mirroredLocalIds.has(s.id),
    })),
  ];

  for (const batch of orderedBatches) {
    for (const item of batch) {
      const existing = byId.get(item.id);
      if (!existing) {
        byId.set(item.id, {
          ...item,
          availableScopes: [item.sourceScope],
        });
      } else {
        if (!existing.availableScopes.includes(item.sourceScope)) {
          existing.availableScopes.push(item.sourceScope);
        }
      }
    }
  }

  return [...byId.values()];
}

function copySkillDirectorySafe(srcDir, destDir) {
  const resolvedSrc = path.resolve(srcDir);
  const resolvedDest = path.resolve(destDir);

  if (resolvedSrc === resolvedDest) {
    return;
  }

  fs.mkdirSync(resolvedDest, { recursive: true });
  const entries = fs.readdirSync(resolvedSrc, { withFileTypes: true });

  for (const entry of entries) {
    if (COPY_SKIP_DIRS.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;

    const srcEntryPath = path.join(resolvedSrc, entry.name);
    const destEntryPath = path.join(resolvedDest, entry.name);

    if (entry.isDirectory()) {
      copySkillDirectorySafe(srcEntryPath, destEntryPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcEntryPath, destEntryPath);
    }
  }
}

function formatYamlQuoted(str) {
  const clean = String(str || "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const escaped = clean.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function buildCustomSkillMarkdown({ safeSkillId, displayName, description, content }) {
  const rawContent = String(content || "").trim();
  const hasFrontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.test(rawContent);
  if (hasFrontmatter) {
    return rawContent + "\n";
  }

  const effectiveDesc =
    String(description || "").trim() ||
    `Custom local skill rules for ${displayName || safeSkillId}.`;
  const heading = rawContent.startsWith("#") ? "" : `# ${displayName || safeSkillId}\n\n`;

  return [
    "---",
    `name: ${safeSkillId}`,
    `description: ${formatYamlQuoted(effectiveDesc)}`,
    "---",
    "",
    `${heading}${rawContent}`,
    "",
  ].join("\n");
}

export async function installSkillToLocal({
  sourcePath = null,
  globalSkillId = null,
  name = null,
  description = "",
  content = null,
  targetScope = "workspace",
  slug = null,
  rootDir = ROOT_DIR,
  globalSkillsDir = null,
} = {}) {
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
    const projectDir =
      resolvedRoot === ROOT_DIR
        ? assertValidSlug(slug)
        : ensureContainedSubpath(path.join(resolvedRoot, "projects"), slug, "project slug");
    targetBaseDir = path.join(projectDir, "skills");
    scopeLabel = "project";
  } else {
    targetBaseDir = path.join(resolvedRoot, ".agents", "skills");
    scopeLabel = "workspace-agents";
  }

  fs.mkdirSync(targetBaseDir, { recursive: true });

  let safeSkillId = "";
  let destDir = "";

  if (sourcePath !== null && String(sourcePath).trim() !== "") {
    assertNoTraversalTokens(sourcePath, "sourcePath");
    const resolvedInput = path.resolve(String(sourcePath).trim());
    if (!fs.existsSync(resolvedInput)) {
      throw new Error(`Skill sourcePath does not exist: ${resolvedInput}`);
    }

    const stat = fs.statSync(resolvedInput);
    const srcSkillDir =
      stat.isFile() && path.basename(resolvedInput).toLowerCase() === "skill.md"
        ? path.dirname(resolvedInput)
        : resolvedInput;

    if (!fs.statSync(srcSkillDir).isDirectory()) {
      throw new Error(`Skill sourcePath must be a directory containing SKILL.md: ${resolvedInput}`);
    }
    const srcSkillMd = path.join(srcSkillDir, "SKILL.md");
    if (!fs.existsSync(srcSkillMd)) {
      throw new Error(`No SKILL.md found in source directory: ${srcSkillDir}`);
    }

    safeSkillId = sanitizeSkillId(name || path.basename(srcSkillDir));
    destDir = ensureContainedSubpath(targetBaseDir, safeSkillId, "destination skill directory");
    copySkillDirectorySafe(srcSkillDir, destDir);
  } else if (globalSkillId !== null && String(globalSkillId).trim() !== "") {
    safeSkillId = sanitizeSkillId(globalSkillId);
    const resolvedGlobalRoot = path.resolve(
      globalSkillsDir !== null ? globalSkillsDir : resolveDefaultGlobalSkillsDir(),
    );
    if (!resolvedGlobalRoot || !fs.existsSync(resolvedGlobalRoot)) {
      throw new Error("Global skills library directory was not found on this machine.");
    }

    const srcSkillDir = ensureContainedSubpath(resolvedGlobalRoot, safeSkillId, "globalSkillId");
    if (!fs.existsSync(path.join(srcSkillDir, "SKILL.md"))) {
      throw new Error(`Global skill "${safeSkillId}" not found at ${srcSkillDir}`);
    }

    destDir = ensureContainedSubpath(targetBaseDir, safeSkillId, "destination skill directory");
    copySkillDirectorySafe(srcSkillDir, destDir);
  } else if (name !== null && String(name).trim() !== "" && content !== null) {
    assertNoTraversalTokens(name, "skill name");
    safeSkillId = sanitizeSkillId(name);
    destDir = ensureContainedSubpath(targetBaseDir, safeSkillId, "destination skill directory");
    fs.mkdirSync(destDir, { recursive: true });

    const markdown = buildCustomSkillMarkdown({
      safeSkillId,
      displayName: String(name).trim(),
      description,
      content,
    });
    fs.writeFileSync(path.join(destDir, "SKILL.md"), markdown, "utf8");
  } else {
    throw new Error(
      "installSkillToLocal requires either { sourcePath }, { globalSkillId }, or { name, content }.",
    );
  }

  const destSkillMdPath = path.join(destDir, "SKILL.md");
  const rawInstalled = fs.readFileSync(destSkillMdPath, "utf8");
  const parsed = parseSkillMarkdown(rawInstalled, {
    fallbackId: safeSkillId,
    skillDir: destDir,
    skillMdPath: destSkillMdPath,
  });

  const installedSkill = {
    id: safeSkillId,
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
    skillDir: destDir,
    skillMdPath: destSkillMdPath,
    hasReferences: parsed.hasReferences,
    hasScripts: parsed.hasScripts,
    hasAssets: parsed.hasAssets,
    availableScopes: [scopeLabel],
  };

  const skills = discoverLocalSkills({ slug, rootDir, globalSkillsDir });
  return {
    ...installedSkill,
    installedSkill,
    skills,
  };
}

function resolveProjectDirSafe(slug, rootDir = ROOT_DIR) {
  const resolvedRoot = path.resolve(rootDir || ROOT_DIR);
  if (resolvedRoot === ROOT_DIR) {
    return assertValidSlug(slug);
  }
  assertNoTraversalTokens(slug, "project slug");
  return ensureContainedSubpath(path.join(resolvedRoot, "projects"), slug, "project slug");
}

function normalizeSkillIdList(skillIds) {
  if (skillIds === null || skillIds === undefined) return [];
  if (!Array.isArray(skillIds)) {
    throw new TypeError("skillIds must be an array of skill ID strings.");
  }
  const seen = new Set();
  const normalized = [];
  for (const item of skillIds) {
    const raw = String(item ?? "").trim();
    if (!raw) continue;
    const clean = sanitizeSkillId(raw);
    if (!seen.has(clean)) {
      seen.add(clean);
      normalized.push(clean);
    }
  }
  return normalized;
}

export function getSelectedProjectSkills(slug, { rootDir = ROOT_DIR } = {}) {
  if (!slug || String(slug).trim() === "") {
    return [];
  }

  const projectDir = resolveProjectDirSafe(slug, rootDir);
  const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
  if (fs.existsSync(briefPath)) {
    try {
      const brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
      if (Array.isArray(brief.selectedSkills)) {
        return normalizeSkillIdList(brief.selectedSkills);
      }
    } catch {
      // Fall through to .studio sidecar check
    }
  }

  const sidecarPath = path.join(projectDir, ".studio", "selected-skills.json");
  if (fs.existsSync(sidecarPath)) {
    try {
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
      if (Array.isArray(sidecar.selectedSkills)) {
        return normalizeSkillIdList(sidecar.selectedSkills);
      }
    } catch {
      return [];
    }
  }

  return [];
}

function renderActiveSkillsMarkdownSection(activeSkills, requestedIds) {
  const lines = ["## Active Dynamic Skills", ""];
  if (requestedIds.length === 0) {
    lines.push("- _No dynamic local skills currently selected._", "");
    return lines.join("\n");
  }

  const resolvedMap = new Map(activeSkills.map((s) => [s.id, s]));
  for (const skillId of requestedIds) {
    const skill = resolvedMap.get(skillId);
    if (!skill) {
      lines.push(`### \`${skillId}\` _(not currently found on disk)_`, "");
      continue;
    }

    lines.push(
      `### \`${skill.id}\` — ${skill.name} (\`${skill.category}\` · \`${skill.sourceScope}\`)`,
    );
    if (skill.description) {
      lines.push(`> ${skill.description}`);
    }
    if (skill.ExtractedHexColors.length > 0) {
      lines.push(
        `- **Extracted Palette Tokens:** ${skill.ExtractedHexColors.map((c) => `\`${c}\``).join(", ")}`,
      );
    }
    if (skill.motionKeywords.length > 0) {
      lines.push(
        `- **Motion Directives:** ${skill.motionKeywords.map((k) => `\`${k}\``).join(", ")}`,
      );
    }
    for (const rule of skill.ruleHighlights) {
      lines.push(`- ${rule}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function setSelectedProjectSkills(
  slug,
  skillIds,
  { rootDir = ROOT_DIR, globalSkillsDir = null } = {},
) {
  const normalizedIds = normalizeSkillIdList(skillIds);
  const resolvedRoot = path.resolve(rootDir || ROOT_DIR);
  const projectDir = resolveProjectDirSafe(slug, resolvedRoot);

  let baseManifest;
  if (resolvedRoot === ROOT_DIR) {
    ensureProjectDirs(slug);
    baseManifest = await syncProjectManifest(slug);
  } else {
    fs.mkdirSync(path.join(projectDir, ".studio"), { recursive: true });
    const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
    baseManifest = fs.existsSync(briefPath)
      ? JSON.parse(fs.readFileSync(briefPath, "utf8"))
      : { slug };
  }

  const updatedAt = new Date().toISOString();
  const mergedManifest = {
    ...baseManifest,
    selectedSkills: normalizedIds,
    updatedAt,
  };

  const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
  fs.writeFileSync(briefPath, JSON.stringify(mergedManifest, null, 2) + "\n", "utf8");

  const sidecarDir = path.join(projectDir, ".studio");
  fs.mkdirSync(sidecarDir, { recursive: true });
  fs.writeFileSync(
    path.join(sidecarDir, "selected-skills.json"),
    JSON.stringify({ slug, selectedSkills: normalizedIds, updatedAt }, null, 2) + "\n",
    "utf8",
  );

  const directives = compileSkillDirectives({
    slug,
    skillIds: normalizedIds,
    rootDir: resolvedRoot,
    globalSkillsDir,
  });

  const promptPath = path.join(projectDir, "AI_READY_PROMPT.md");
  const existingPrompt = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, "utf8")
    : `# AI_READY_PROMPT — ${mergedManifest.title || slug}\n\n`;

  const strippedPrompt = existingPrompt
    .replace(/\r?\n*## Active Dynamic Skills[\s\S]*$/, "")
    .trimEnd();
  const skillsSection = renderActiveSkillsMarkdownSection(directives.activeSkills, normalizedIds);
  const nextPrompt = `${strippedPrompt}\n\n${skillsSection}`;
  fs.writeFileSync(promptPath, nextPrompt, "utf8");

  return normalizedIds;
}

function parseHighestContrastFloor(fullSkillText) {
  let floor = 4.5;
  const text = String(fullSkillText || "");

  if (/\bWCAG\s+AAA\b/i.test(text)) {
    floor = Math.max(floor, 7.0);
  }

  const ratioMatches = text.matchAll(
    /(?:contrast(?:\s+ratio|\s+floor)?|wcag(?:\s+aa|\s+aaa)?)\s*(?:>=|>|at\s+least|minimum|of|:)?\s*(\d+(?:\.\d+)?)\s*:\s*1/gi,
  );
  for (const match of ratioMatches) {
    const val = Number.parseFloat(match[1]);
    if (Number.isFinite(val) && val >= 3.0 && val <= 21.0) {
      floor = Math.max(floor, val);
    }
  }

  return Number(floor.toFixed(2));
}

function inferPreferredArchetypes(activeSkills, rawTexts) {
  const preferred = new Set();

  for (let i = 0; i < activeSkills.length; i += 1) {
    const skill = activeSkills[i];
    const text = `${skill.id} ${skill.name} ${skill.description} ${rawTexts[i] || ""}`;

    if (/\b(?:oversized[- ]cursor|spotlight|cursor[- ]click|pointer[- ]led|7cqw)\b/i.test(text)) {
      preferred.add("spotlight-cursor-zoom");
    }
    if (
      /\b(?:bento|feature[- ]grid|modular\s+cards|asymmetric(?:al)?\s+css\s+grid)\b/i.test(text)
    ) {
      preferred.add("bento-feature-grid");
    }
    if (
      /\b(?:iphone|phone\s+mockup|3d\s+device|device[- ]showcase|perspective\(\d+px\))\b/i.test(
        text,
      )
    ) {
      preferred.add("device-3d-showcase");
    }
    if (/\b(?:editorial|minimalist|monochrome|asymmetric|typography|serif)\b/i.test(text)) {
      preferred.add("split-editorial");
      preferred.add("kinetic-statement-card");
    }
    if (/\b(?:zoom-through|inverse[- ]zoom|cinema|film\s+grammar|full[- ]bleed)\b/i.test(text)) {
      preferred.add("fullbleed-cinema");
    }
    if (/\b(?:kinetic|title[- ]card|waterfall[- ]entry|chest\s+blur-morph)\b/i.test(text)) {
      preferred.add("kinetic-statement-card");
    }
  }

  return CANONICAL_LAYOUT_ARCHETYPES.filter((arch) => preferred.has(arch));
}

function buildRatingChecksForSkill(skill, fullRawText) {
  const checks = [];
  const addedTypes = new Set();
  const pushCheck = (suffix, description, ruleType) => {
    checks.push({
      skillId: skill.id,
      skillName: skill.name,
      checkId: `${skill.id}:${suffix}`,
      description,
      ruleType,
    });
    addedTypes.add(ruleType);
  };

  const combined = `${skill.id} ${skill.name} ${skill.description}\n${fullRawText}`;

  if (
    skill.id === "motion-doctrine" ||
    /\b(?:vector\s+law|camera\s+move|static\s+lockoff|ping-pong)\b/i.test(combined)
  ) {
    pushCheck(
      "motion-vector-variety",
      "Consecutive shots must vary camera vectors without static lockoff repetition, keeping speed ramps within 0.4x..3.0x.",
      "motion-continuity",
    );
  }

  if (
    skill.id === "cut-the-curve" ||
    /\b(?:cut-the-curve|velocity[- ]matched|scale[- ]sign)\b/i.test(combined)
  ) {
    pushCheck(
      "velocity-matched-seams",
      "Adjacent shots must define velocity-matched transitionIn/transitionOut pairs without opposing Z scale-sign fights.",
      "seam-continuity",
    );
  }

  if (
    skill.id === "seam-craft" ||
    /\b(?:white-flash\s+guard|opaque\s+stage-ground|ping-pong\s+track)\b/i.test(combined)
  ) {
    pushCheck(
      "opaque-stage-ground",
      "Master composition must maintain an opaque #root background and clean transition seam pairs to prevent white-flash dips.",
      "seam-continuity",
    );
  }

  if (
    skill.id === "captions-overlay" ||
    /\b(?:overlay\s+law|not\s+a\s+reserved\s+band|rail[- ]first)\b/i.test(combined)
  ) {
    pushCheck(
      "caption-overlay-balance",
      "Captions must ride as a true-center overlay without dead keep-out bands, keeping embeds scarce.",
      "caption-overlay",
    );
  }

  if (
    skill.id === "oversized-cursor" ||
    /\b(?:oversized[- ]cursor|7cqw|tip-targeting|click\s+tap)\b/i.test(combined)
  ) {
    pushCheck(
      "cursor-spotlight-presence",
      "Interactive UI/product shots should stage an active cursorTarget and spotlight-cursor choreography.",
      "cursor-choreography",
    );
  }

  if (/\b(?:minimalist|monochrom|DO NOT\s+use\s+gradients|no\s+gradients)\b/i.test(combined)) {
    pushCheck(
      "minimal-palette-restraint",
      "Enforce clean monochrome/editorial palette restraint without clashing neon accents or heavy gradients.",
      "palette-restraint",
    );
  }

  const parsedFloor = parseHighestContrastFloor(combined);
  if (parsedFloor > 4.5 || /\bcontrast\b|\bwcag\b/i.test(combined)) {
    pushCheck(
      "contrast-floor",
      `Foreground typography and callout badges must meet relative luminance contrast >= ${parsedFloor}:1.`,
      "contrast",
    );
  }

  const maxStaticMatch = combined.match(
    /(?:never\s+hold|exceeds?|longer\s+than|<=|<)\s*(\d+(?:\.\d+)?)\s*s\b/i,
  );
  if (maxStaticMatch || skill.id === "signature-reel-style") {
    const limitSec = maxStaticMatch ? Number.parseFloat(maxStaticMatch[1]) : 3.2;
    pushCheck(
      "beat-cadence",
      `Maintain brisk visual progression so shots stay crisp (~${limitSec}s beat cadence) with active staging.`,
      "pacing",
    );
  }

  if (skill.ExtractedHexColors.length > 0 && !addedTypes.has("palette-tokens")) {
    pushCheck(
      "palette-tokens",
      `Align staging swatches with skill palette tokens (${skill.ExtractedHexColors.slice(0, 4).join(", ")}).`,
      "brand-palette",
    );
  }

  if (checks.length === 0) {
    const primaryHighlight =
      skill.ruleHighlights[0] || skill.description || `Comply with ${skill.name} directives.`;
    pushCheck("primary-directive", primaryHighlight, "custom-directive");
  }

  return checks;
}

export function compileSkillDirectives({
  slug = null,
  skillIds = null,
  rootDir = ROOT_DIR,
  globalSkillsDir = null,
} = {}) {
  const effectiveIds =
    skillIds !== null && skillIds !== undefined
      ? normalizeSkillIdList(skillIds)
      : slug
        ? getSelectedProjectSkills(slug, { rootDir })
        : [];

  const catalog = discoverLocalSkills({ slug, rootDir, globalSkillsDir });
  const byId = new Map(catalog.map((s) => [s.id, s]));

  const activeSkills = [];
  const rawSkillTexts = [];

  for (const id of effectiveIds) {
    const entry = byId.get(id);
    if (!entry) continue;
    let rawText = "";
    try {
      if (entry.skillMdPath && fs.existsSync(entry.skillMdPath)) {
        rawText = fs.readFileSync(entry.skillMdPath, "utf8");
      }
    } catch {
      rawText = "";
    }
    activeSkills.push(entry);
    rawSkillTexts.push(rawText);
  }

  const combinedCorpus = activeSkills
    .map(
      (s, idx) =>
        `${s.id}\n${s.name}\n${s.description}\n${s.ruleHighlights.join("\n")}\n${rawSkillTexts[idx]}`,
    )
    .join("\n\n");

  const preferMinimalPalette =
    activeSkills.length > 0 &&
    /\b(?:minimalist|monochrom|no\s+gradients|DO NOT\s+use\s+gradients|warm\s+bone|#FBFBFA|#F7F6F3)\b/i.test(
      combinedCorpus,
    );

  const enforceCaptionOverlay =
    activeSkills.length > 0 &&
    /\b(?:captions-overlay|overlay\s+law|not\s+a\s+reserved\s+(?:bottom\s+)?band|verbatim\s+rail)\b/i.test(
      combinedCorpus,
    );

  const includeOversizedCursor =
    activeSkills.length > 0 &&
    /\b(?:oversized-cursor|7cqw|macOS[- ]style\s+pointer|tip-targeting|click[- ]ignit)\b/i.test(
      combinedCorpus,
    );

  const enforceSeamCraft =
    activeSkills.length > 0 &&
    /\b(?:seam-craft|motion-doctrine|cut-the-curve|white-flash\s+guard|vector\s+law|velocity[- ]matched)\b/i.test(
      combinedCorpus,
    );

  const preferredArchetypes = inferPreferredArchetypes(activeSkills, rawSkillTexts);
  const contrastFloor = activeSkills.length > 0 ? parseHighestContrastFloor(combinedCorpus) : 4.5;

  const stagingHints = {
    preferMinimalPalette,
    enforceCaptionOverlay,
    includeOversizedCursor,
    enforceSeamCraft,
    preferredArchetypes,
    contrastFloor,
  };

  const ratingChecks = [];
  for (let i = 0; i < activeSkills.length; i += 1) {
    ratingChecks.push(...buildRatingChecksForSkill(activeSkills[i], rawSkillTexts[i]));
  }

  let promptInjection = "";
  if (activeSkills.length > 0) {
    const promptLines = [
      `Active Local Skills (${activeSkills.length}): ${activeSkills.map((s) => s.id).join(", ")}`,
      `Staging Directives: contrastFloor >= ${contrastFloor}:1` +
        (preferredArchetypes.length > 0
          ? ` | preferredArchetypes: ${preferredArchetypes.join(", ")}`
          : "") +
        (preferMinimalPalette ? " | minimal monochrome palette" : "") +
        (enforceCaptionOverlay ? " | true-center caption overlay" : "") +
        (includeOversizedCursor ? " | oversized cursor spotlight" : "") +
        (enforceSeamCraft ? " | velocity-matched opaque seams" : ""),
    ];

    for (const skill of activeSkills) {
      promptLines.push(`[${skill.id}] ${skill.name}:`);
      for (const highlight of skill.ruleHighlights.slice(0, 4)) {
        promptLines.push(`  - ${highlight}`);
      }
      if (skill.ExtractedHexColors.length > 0) {
        promptLines.push(`  - Palette tokens: ${skill.ExtractedHexColors.slice(0, 6).join(", ")}`);
      }
    }
    promptInjection = promptLines.join("\n");
  }

  return {
    activeSkills,
    promptInjection,
    stagingHints,
    ratingChecks,
  };
}

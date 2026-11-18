/**
 * Broadcast Subtitle Exporter (.srt, .vtt, .ass) for Director Studio Pro.
 *
 * Exports UTF-8 compliant SubRip (.srt), W3C WebVTT (.vtt), and styled
 * SubStation Alpha v4.00+ (.ass) files supporting English, Bengali (বাংলা),
 * and Hindi (हिन्दी) Unicode scripts with 80% title-safe positioning.
 */

import fs from "node:fs";
import path from "node:path";
import { PROJECTS_DIR, assertValidSlug, ensureProjectDirs } from "./lib.mjs";
import { alignScriptToWordTimings, getCaptionStyle } from "./captions-engine.mjs";

export const SUPPORTED_SUBTITLE_FORMATS = Object.freeze(["srt", "vtt", "ass"]);

const VALID_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const BENGALI_RE = /[\u0980-\u09FF]/;
const DEVANAGARI_RE = /[\u0900-\u097F]/;

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function normalizeHex(rawHex, fallback = "#FFFFFF") {
  if (typeof rawHex !== "string") return fallback;
  const trimmed = rawHex.trim();
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed);
  if (!match) return fallback;
  const hex = match[1];
  if (hex.length === 3) {
    return (
      "#" +
      hex
        .split("")
        .map((c) => c + c)
        .join("")
        .toUpperCase()
    );
  }
  return `#${hex.toUpperCase()}`;
}

/**
 * Converts standard `#RRGGBB` hex color + 2-char hex alpha (`00` = opaque, `FF` = transparent)
 * into SubStation Alpha `&HAABBGGRR` BGR format.
 */
export function hexToAssColor(hexColor, alphaHex = "00") {
  const hex = normalizeHex(hexColor, "#FFFFFF");
  const rr = hex.slice(1, 3);
  const gg = hex.slice(3, 5);
  const bb = hex.slice(5, 7);
  const aa = /^[0-9a-fA-F]{2}$/.test(String(alphaHex || ""))
    ? String(alphaHex).toUpperCase()
    : "00";
  return `&H${aa}${bb}${gg}${rr}`;
}

/**
 * Formats seconds as SubRip `HH:MM:SS,mmm`.
 */
export function formatSrtTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hrs = Math.floor(totalMin / 60);
  return (
    `${String(hrs).padStart(2, "0")}:` +
    `${String(min).padStart(2, "0")}:` +
    `${String(sec).padStart(2, "0")},` +
    `${String(ms).padStart(3, "0")}`
  );
}

/**
 * Formats seconds as WebVTT `HH:MM:SS.mmm`.
 */
export function formatVttTimestamp(seconds) {
  return formatSrtTimestamp(seconds).replace(",", ".");
}

/**
 * Formats seconds as SubStation Alpha `H:MM:SS.cc` (centiseconds).
 */
export function formatAssTimestamp(seconds) {
  const totalCs = Math.max(0, Math.round((Number(seconds) || 0) * 100));
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hrs = Math.floor(totalMin / 60);
  return (
    `${hrs}:` +
    `${String(min).padStart(2, "0")}:` +
    `${String(sec).padStart(2, "0")}.` +
    `${String(cs).padStart(2, "0")}`
  );
}

function normalizeFormatToken(rawFormat) {
  const normalized = String(rawFormat || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "");
  if (!SUPPORTED_SUBTITLE_FORMATS.includes(normalized)) {
    throw new Error(
      `Unsupported subtitle format "${rawFormat}". Expected one of: ${SUPPORTED_SUBTITLE_FORMATS.join(", ")}.`,
    );
  }
  return normalized;
}

function normalizePhrasesList(rawPhrases) {
  const source = Array.isArray(rawPhrases)
    ? rawPhrases
    : Array.isArray(rawPhrases?.phrases)
      ? rawPhrases.phrases
      : [];

  const normalized = [];
  for (let i = 0; i < source.length; i++) {
    const item = source[i];
    if (!item || typeof item !== "object") continue;
    const rawText = String(item.text ?? item.caption ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();
    if (!rawText) continue;

    const rawStart = Number(item.start);
    const start = Number.isFinite(rawStart) && rawStart >= 0 ? rawStart : i * 2.0;
    const rawEnd = Number(item.end);
    const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + 2.0;

    normalized.push({
      index: normalized.length,
      text: rawText,
      highlightWord: String(item.highlightWord || "").trim(),
      start: Math.round(start * 1000) / 1000,
      end: Math.round(Math.max(start + 0.04, end) * 1000) / 1000,
      words: Array.isArray(item.words) ? item.words : [],
    });
  }
  return normalized;
}

function escapeVttText(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAssPlainText(text) {
  return String(text || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\uFF5B")
    .replaceAll("}", "\uFF5D")
    .replaceAll("\n", "\\N");
}

function stripOuterPunct(word) {
  return String(word || "")
    .replace(/^[^\p{L}\p{N}\u0900-\u097F\u0980-\u09FF%$৳₹]+/gu, "")
    .replace(/[^\p{L}\p{N}\u0900-\u097F\u0980-\u09FF%$৳₹]+$/gu, "");
}

function buildAssDialogueText(phrase, assPrimary, assHighlight) {
  const hiTarget = stripOuterPunct(phrase.highlightWord).toLowerCase();
  if (!hiTarget) {
    return escapeAssPlainText(phrase.text);
  }

  const tokens = phrase.text.split(/(\s+)/);
  let highlighted = false;
  return tokens
    .map((tok) => {
      if (!tok || /^\s+$/.test(tok)) return tok;
      if (!highlighted && stripOuterPunct(tok).toLowerCase() === hiTarget) {
        highlighted = true;
        return `{\\c${assHighlight}&}${escapeAssPlainText(tok)}{\\c${assPrimary}&}`;
      }
      return escapeAssPlainText(tok);
    })
    .join("");
}

function resolveAssFontName(preset, styleOverrides, phrases) {
  if (typeof styleOverrides?.fontName === "string" && styleOverrides.fontName.trim()) {
    return styleOverrides.fontName.trim().replace(/["']/g, "").split(",")[0].trim();
  }
  if (typeof styleOverrides?.fontFamily === "string" && styleOverrides.fontFamily.trim()) {
    return styleOverrides.fontFamily.trim().replace(/["']/g, "").split(",")[0].trim();
  }
  const combinedText = phrases.map((p) => p.text).join(" ");
  if (BENGALI_RE.test(combinedText)) {
    return "Nirmala UI";
  }
  if (DEVANAGARI_RE.test(combinedText)) {
    return "Nirmala UI";
  }
  const firstFamily = String(preset?.typography?.fontFamily || "Inter")
    .replace(/["']/g, "")
    .split(",")[0]
    .trim();
  return firstFamily || "Inter";
}

/**
 * Exports normalized caption phrases into broadcast-valid `.srt`, `.vtt`, or `.ass` UTF-8 text.
 */
export function exportSubtitles({
  phrases,
  format = "srt",
  width = 1080,
  height = 1920,
  style = {},
} = {}) {
  const fmt = normalizeFormatToken(format);
  const cues = normalizePhrasesList(phrases);
  const canvasW = Math.max(240, Math.round(Number(width) || 1080));
  const canvasH = Math.max(240, Math.round(Number(height) || 1920));
  const preset = getCaptionStyle(style?.styleId || style?.id || "kinetic-gold-pop");
  const bottomPct = clamp(Number(style?.bottomPct ?? preset?.safeZone?.bottomPct ?? 14), 10, 80);

  if (fmt === "srt") {
    if (cues.length === 0) return "";
    return (
      cues
        .map((cue, idx) => {
          const safeText = cue.text.replaceAll("-->", "->");
          return `${idx + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${safeText}`;
        })
        .join("\n\n") + "\n"
    );
  }

  if (fmt === "vtt") {
    const vttLinePct = clamp(Math.round(100 - bottomPct), 20, 90);
    if (cues.length === 0) return "WEBVTT\n";
    const blocks = cues.map(
      (cue, idx) =>
        `${idx + 1}\n${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)} line:${vttLinePct}% position:50% align:center size:80%\n${escapeVttText(cue.text)}`,
    );
    return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
  }

  // SubStation Alpha v4.00+ (.ass)
  const textColor = normalizeHex(style?.textColor || preset.palette.textColor, "#FFFFFF");
  const highlightColor = normalizeHex(
    style?.highlightColor || style?.accentColor || preset.palette.highlightColor,
    "#FACC15",
  );
  const bgColor = normalizeHex(style?.backgroundColor || preset.palette.backgroundColor, "#0B1210");

  const assPrimary = hexToAssColor(textColor, "00");
  const assHighlight = hexToAssColor(highlightColor, "00");
  const assOutline = hexToAssColor(bgColor, "00");
  const assBack = hexToAssColor(bgColor, "80");

  const scaleUnit = Math.min(canvasW, canvasH) / 1080;
  const isLandscape = canvasW > canvasH;
  const baseFontPx = isLandscape
    ? preset.typography.fontSizeLandscape
    : preset.typography.fontSizePortrait;
  const fontSize = Math.max(
    22,
    Math.round(Number(style?.fontSize) || baseFontPx * scaleUnit * 1.1),
  );
  const fontName = resolveAssFontName(preset, style, cues).replaceAll(",", " ");
  const boldFlag = style?.bold === false ? 0 : -1;

  const marginL = Math.round(canvasW * 0.1);
  const marginR = Math.round(canvasW * 0.1);
  const marginV = Math.round(canvasH * (bottomPct / 100));

  const dialogueLines = cues.map((cue) => {
    const startAss = formatAssTimestamp(cue.start);
    const endAss = formatAssTimestamp(cue.end);
    const styledText = buildAssDialogueText(cue, assPrimary, assHighlight);
    return `Dialogue: 0,${startAss},${endAss},Default,,0,0,0,,${styledText}`;
  });

  return [
    "[Script Info]",
    "; Generated by Director Studio Pro Subtitle Exporter",
    "Title: Director Studio Pro Subtitles",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    `PlayResX: ${canvasW}`,
    `PlayResY: ${canvasH}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},${assPrimary},${assHighlight},${assOutline},${assBack},${boldFlag},0,0,0,100,100,0,0,1,3,1,2,${marginL},${marginR},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...dialogueLines,
    "",
  ].join("\n");
}

function readJsonSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {
    // Ignore malformed JSON
  }
  return null;
}

function resolveConfinedProjectDir(slug, projectsDir) {
  const cleanedSlug = String(slug || "").trim();
  if (!cleanedSlug || !VALID_SLUG_RE.test(cleanedSlug)) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  const baseRoot = path.resolve(projectsDir || PROJECTS_DIR);
  if (baseRoot === path.resolve(PROJECTS_DIR)) {
    return ensureProjectDirs(assertValidSlug(cleanedSlug) ? cleanedSlug : cleanedSlug);
  }
  const resolved = path.resolve(baseRoot, cleanedSlug);
  if (!resolved.startsWith(baseRoot + path.sep)) {
    throw new Error(`Unsafe project slug path: ${slug}`);
  }
  fs.mkdirSync(path.join(resolved, "output"), { recursive: true });
  return resolved;
}

function deriveProjectPhrases(projectDir) {
  // 1. Check existing compositions/captions-track.html inline TRANSCRIPT
  const capCompPath = path.join(projectDir, "compositions", "captions-track.html");
  if (fs.existsSync(capCompPath)) {
    try {
      const html = fs.readFileSync(capCompPath, "utf8");
      const match = /const\s+TRANSCRIPT\s*=\s*(\[[\s\S]*?\]);/.exec(html);
      if (match?.[1]) {
        const parsed = JSON.parse(match[1]);
        const normalized = normalizePhrasesList(parsed);
        if (normalized.length > 0) return normalized;
      }
    } catch {
      // Fall through to STORYBOARD.json
    }
  }

  // 2. Align per-shot voiceover / caption copy from STORYBOARD.json
  const storyboard = readJsonSafe(path.join(projectDir, "STORYBOARD.json"));
  if (Array.isArray(storyboard?.frames) && storyboard.frames.length > 0) {
    const collected = [];
    let cursor = 0;
    for (const frame of storyboard.frames) {
      const dur = Math.max(0.5, Number(frame?.durationSeconds ?? frame?.duration) || 3.0);
      const copy = String(
        frame?.audioSpec?.voiceoverText ||
          frame?.staging?.captionText ||
          frame?.caption ||
          frame?.staging?.subheadline ||
          frame?.staging?.headline ||
          frame?.title ||
          "",
      ).trim();

      if (copy) {
        const aligned = alignScriptToWordTimings({
          scriptText: copy,
          startTime: cursor,
          durationSeconds: dur,
          whisperSegments: frame?.audioSpec?.whisperSegments || null,
          maxWordsPerPhrase: 5,
        });
        for (const p of aligned.phrases) {
          collected.push({ ...p, index: collected.length });
        }
      }
      cursor = Math.round((cursor + dur) * 1000) / 1000;
    }
    if (collected.length > 0) return collected;
  }

  // 3. Fallback to PROJECT_BRIEF.json instructions or title
  const brief = readJsonSafe(path.join(projectDir, "PROJECT_BRIEF.json"));
  const fallbackText = String(
    brief?.instructions || brief?.title || path.basename(projectDir),
  ).trim();
  const fallbackDur = Math.max(2.0, Number(brief?.durationSeconds) || 6.0);
  return alignScriptToWordTimings({
    scriptText: fallbackText,
    startTime: 0,
    durationSeconds: fallbackDur,
    maxWordsPerPhrase: 5,
  }).phrases;
}

/**
 * Writes broadcast-valid UTF-8 `.srt`, `.vtt`, and `.ass` subtitle files into
 * `projects/<slug>/output/` and returns file metadata + `/media/:slug/output/...` URLs.
 */
export async function writeProjectSubtitles({
  slug,
  phrases = null,
  formats = ["srt", "vtt", "ass"],
  width,
  height,
  style = {},
  projectsDir = PROJECTS_DIR,
  filenameBase = null,
} = {}) {
  const projectDir = resolveConfinedProjectDir(slug, projectsDir);
  const brief = readJsonSafe(path.join(projectDir, "PROJECT_BRIEF.json")) || {};
  const storyboard = readJsonSafe(path.join(projectDir, "STORYBOARD.json")) || {};

  const resolvedWidth = Math.round(
    Number(width) || Number(storyboard.width) || Number(brief.width) || 1080,
  );
  const resolvedHeight = Math.round(
    Number(height) || Number(storyboard.height) || Number(brief.height) || 1920,
  );

  const requestedFormats =
    Array.isArray(formats) && formats.length > 0 ? formats : SUPPORTED_SUBTITLE_FORMATS;
  const uniqueFormats = [...new Set(requestedFormats.map((f) => normalizeFormatToken(f)))];

  const resolvedPhrases =
    phrases !== null && phrases !== undefined
      ? normalizePhrasesList(phrases)
      : deriveProjectPhrases(projectDir);

  const safeBase =
    String(filenameBase || `${slug}_subtitles`)
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "subtitles";

  const outDir = path.join(projectDir, "output");
  fs.mkdirSync(outDir, { recursive: true });

  const files = [];
  const byFormat = {};
  const urls = {};

  for (const fmt of uniqueFormats) {
    const content = exportSubtitles({
      phrases: resolvedPhrases,
      format: fmt,
      width: resolvedWidth,
      height: resolvedHeight,
      style,
    });
    const filename = `${safeBase}.${fmt}`;
    const relPath = `output/${filename}`;
    const absPath = path.join(outDir, filename);
    fs.writeFileSync(absPath, content, { encoding: "utf8" });

    const stat = fs.statSync(absPath);
    const mediaUrl = `/media/${encodeURIComponent(slug)}/output/${encodeURIComponent(filename)}`;
    const record = {
      format: fmt,
      ext: `.${fmt}`,
      filename,
      relPath,
      absPath,
      url: mediaUrl,
      downloadUrl: mediaUrl,
      sizeBytes: stat.size,
    };
    files.push(record);
    byFormat[fmt] = record;
    urls[fmt] = mediaUrl;
  }

  return {
    ok: true,
    slug,
    phraseCount: resolvedPhrases.length,
    width: resolvedWidth,
    height: resolvedHeight,
    files,
    byFormat,
    urls,
  };
}

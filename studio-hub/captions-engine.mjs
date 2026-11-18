/**
 * Kinetic & Subtitle Choreography Engine for Director Studio Pro.
 *
 * Implements:
 * - CAPTION_STYLES: 6 WCAG AA (>= 4.5:1) contrast-verified caption presets
 *   positioned strictly within the 80% title-safe box and composited as a
 *   true non-intrusive overlay per `.agents/skills/captions-overlay/SKILL.md`.
 * - alignScriptToWordTimings: Whisper-aligned or deterministic syllable/grapheme
 *   weighted phrase & word timing engine supporting English and Bengali (বাংলা).
 * - renderCaptionsSubComposition: Lint-clean HyperFrames `<template>` generator.
 */

const BENGALI_CHAR_RE = /[\u0980-\u09FF]/;
const BENGALI_CONSONANT_RE = /[\u0995-\u09B9\u09CE\u09DC-\u09DF]/g;
const BENGALI_INDEPENDENT_VOWEL_RE = /[\u0985-\u0994]/g;
const BENGALI_LONG_MATRA_RE = /[\u09BE\u09C0\u09C2\u09C8\u09CB\u09CC\u09D7]/g;
const BENGALI_VIRAMA_CLUSTER_RE = /[\u0995-\u09B9\u09DC-\u09DF]\u09CD[\u0995-\u09B9\u09DC-\u09DF]/g;
const SENTENCE_END_RE = /[.!?।\u0964\u0965]+["')\]»”’]*$/;
const CLAUSE_END_RE = /[,;:—–]+["')\]»”’]*$/;

const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "out",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "up",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "will",
  "with",
  "you",
  "your",
]);

const BENGALI_STOP_WORDS = new Set([
  "ও",
  "এবং",
  "বা",
  "কিন্তু",
  "যে",
  "এই",
  "ওই",
  "সেই",
  "থেকে",
  "জন্য",
  "করে",
  "হয়",
  "হয়",
  "আছে",
  "ছিল",
  "তো",
  "না",
  "বাঁ",
  "এর",
  "কে",
  "তে",
  "টা",
  "টি",
  "গুলো",
  "সহ",
  "দিয়ে",
  "দিয়ে",
  "এক",
  "একটি",
  "আমাদের",
  "আপনার",
]);

const graphemeSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("bn", { granularity: "grapheme" })
    : null;

function roundTime(seconds) {
  return Math.round(Number(seconds) * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(rawHex) {
  if (typeof rawHex !== "string") return null;
  const trimmed = rawHex.trim();
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed);
  if (!match) return null;
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

function relativeLuminance(hexColor) {
  const normalized = normalizeHexColor(hexColor) || "#000000";
  const r = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const g = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const b = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const toLinear = (channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Computes WCAG 2.1 contrast ratio between two hex colors (1.0 .. 21.0).
 */
export function computeContrastRatio(foregroundHex, backgroundHex) {
  const lumA = relativeLuminance(foregroundHex);
  const lumB = relativeLuminance(backgroundHex);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

function createStyleDefinition(spec) {
  const baseContrast = computeContrastRatio(spec.palette.textColor, spec.palette.backgroundColor);
  const hiBg = spec.palette.activePillBg || spec.palette.backgroundColor;
  const hiFg = spec.palette.activePillBg
    ? spec.palette.activePillText
    : spec.palette.highlightColor;
  const highlightContrast = computeContrastRatio(hiFg, hiBg);

  if (baseContrast < 4.5 || highlightContrast < 4.5) {
    throw new Error(
      `Caption preset "${spec.id}" violates WCAG AA (>= 4.5:1): base=${baseContrast}, highlight=${highlightContrast}`,
    );
  }

  return Object.freeze({
    ...spec,
    textColor: spec.palette.textColor,
    accentColor: spec.palette.highlightColor,
    backgroundColor: spec.palette.backgroundColor,
    contrastRatio: baseContrast,
    overlay: Object.freeze({
      compositedOnTop: true,
      reservesKeepOutBand: false,
      shiftsUnderlyingLayout: false,
    }),
    safeZone: Object.freeze({
      leftPct: 10,
      rightPct: 10,
      maxWidthPct: 80,
      withinTitleSafe80: true,
      ...spec.safeZone,
    }),
    palette: Object.freeze({
      ...spec.palette,
      contrastRatio: baseContrast,
      highlightContrastRatio: highlightContrast,
      wcagAA: true,
    }),
    typography: Object.freeze({ ...spec.typography }),
    animation: Object.freeze({ ...spec.animation }),
  });
}

const STYLE_DEFINITIONS = [
  createStyleDefinition({
    id: "kinetic-gold-pop",
    name: "Kinetic Gold Pop",
    description:
      "High-retention dark obsidian pill overlay with crisp white copy and energetic gold punch-word pop.",
    model: "rail",
    safeZone: { bottomPct: 14 },
    palette: {
      textColor: "#FFFFFF",
      highlightColor: "#FACC15",
      backgroundColor: "#0B1210",
      borderColor: "#FACC15",
      activePillBg: "#FACC15",
      activePillText: "#08120E",
    },
    typography: {
      fontFamily: '"Inter", sans-serif',
      fontWeight: 800,
      fontSizePortrait: 44,
      fontSizeLandscape: 46,
      lineHeight: 1.24,
      letterSpacing: "-0.015em",
      borderRadiusPx: 22,
      paddingY: 14,
      paddingX: 24,
    },
    animation: {
      mode: "kinetic-pop",
      enterDuration: 0.16,
      exitDuration: 0.11,
      enterY: 16,
      enterScale: 0.94,
      highlightScale: 1.08,
      ease: "back.out(1.6)",
    },
  }),
  createStyleDefinition({
    id: "blur-morph-chest",
    name: "Blur-Morph Chest",
    description:
      "Signature reel chest-zone editorial stack with 6-frame optical settle and electric lime emphasis.",
    model: "rail",
    safeZone: { bottomPct: 34 },
    palette: {
      textColor: "#FFFFFF",
      highlightColor: "#A3E635",
      backgroundColor: "#0B0914",
      borderColor: "#27233A",
      activePillBg: null,
      activePillText: null,
    },
    typography: {
      fontFamily: '"Outfit", "Inter", sans-serif',
      fontWeight: 800,
      fontSizePortrait: 48,
      fontSizeLandscape: 48,
      lineHeight: 1.16,
      letterSpacing: "-0.02em",
      borderRadiusPx: 20,
      paddingY: 14,
      paddingX: 24,
    },
    animation: {
      mode: "blur-morph",
      enterDuration: 0.2,
      exitDuration: 0.12,
      enterY: 18,
      enterScale: 0.98,
      highlightScale: 1.07,
      ease: "power3.out",
    },
  }),
  createStyleDefinition({
    id: "minimal-editorial-rail",
    name: "Minimal Editorial Rail",
    description:
      "Low-profile verbatim lower-third subtitle rail riding cleanly in front of full-bleed visuals.",
    model: "rail",
    safeZone: { bottomPct: 11 },
    palette: {
      textColor: "#F8FAFC",
      highlightColor: "#38BDF8",
      backgroundColor: "#0F172A",
      borderColor: "#334155",
      activePillBg: null,
      activePillText: null,
    },
    typography: {
      fontFamily: '"Inter", sans-serif',
      fontWeight: 600,
      fontSizePortrait: 36,
      fontSizeLandscape: 38,
      lineHeight: 1.3,
      letterSpacing: "-0.005em",
      borderRadiusPx: 14,
      paddingY: 10,
      paddingX: 20,
    },
    animation: {
      mode: "editorial-rail",
      enterDuration: 0.15,
      exitDuration: 0.1,
      enterY: 10,
      enterScale: 1,
      highlightScale: 1.04,
      ease: "power2.out",
    },
  }),
  createStyleDefinition({
    id: "karaoke-word-pill",
    name: "Karaoke Word Pill",
    description:
      "Word-synced progressive active pill choreography lighting up each spoken word on its exact timestamp.",
    model: "rail",
    safeZone: { bottomPct: 15 },
    palette: {
      textColor: "#F1F5F9",
      highlightColor: "#34D399",
      backgroundColor: "#0F172A",
      borderColor: "#1E293B",
      activePillBg: "#34D399",
      activePillText: "#051B11",
    },
    typography: {
      fontFamily: '"Montserrat", "Inter", sans-serif',
      fontWeight: 800,
      fontSizePortrait: 40,
      fontSizeLandscape: 42,
      lineHeight: 1.28,
      letterSpacing: "-0.01em",
      borderRadiusPx: 20,
      paddingY: 13,
      paddingX: 22,
    },
    animation: {
      mode: "karaoke-pill",
      enterDuration: 0.14,
      exitDuration: 0.1,
      enterY: 12,
      enterScale: 0.97,
      highlightScale: 1.05,
      ease: "power2.out",
    },
  }),
  createStyleDefinition({
    id: "bengali-emerald-card",
    name: "Bengali Emerald Card",
    description:
      "Bilingual & Bengali (বাংলা) tuned emerald card with generous matra/conjunct line-height and gold highlights.",
    model: "rail",
    safeZone: { bottomPct: 14 },
    palette: {
      textColor: "#FFFFFF",
      highlightColor: "#FACC15",
      backgroundColor: "#071A12",
      borderColor: "#2ECC71",
      activePillBg: "#FACC15",
      activePillText: "#071A12",
    },
    typography: {
      fontFamily: '"Noto Sans Bengali", "Inter", sans-serif',
      needsBengaliFontFace: true,
      fontWeight: 700,
      fontSizePortrait: 40,
      fontSizeLandscape: 42,
      lineHeight: 1.44,
      letterSpacing: "0em",
      borderRadiusPx: 20,
      paddingY: 14,
      paddingX: 24,
    },
    animation: {
      mode: "emerald-rise",
      enterDuration: 0.17,
      exitDuration: 0.11,
      enterY: 14,
      enterScale: 0.97,
      highlightScale: 1.06,
      ease: "power3.out",
    },
  }),
  createStyleDefinition({
    id: "clean-cinema-sub",
    name: "Clean Cinema Sub",
    description:
      "Documentary & film-festival subtitle rail with warm cinema ivory ink and amber emphasis over dark scrim.",
    model: "rail",
    safeZone: { bottomPct: 11 },
    palette: {
      textColor: "#FFFBEB",
      highlightColor: "#FBBF24",
      backgroundColor: "#090D16",
      borderColor: "#1F2937",
      activePillBg: null,
      activePillText: null,
    },
    typography: {
      fontFamily: '"Inter", sans-serif',
      fontWeight: 600,
      fontSizePortrait: 36,
      fontSizeLandscape: 38,
      lineHeight: 1.32,
      letterSpacing: "0.005em",
      borderRadiusPx: 12,
      paddingY: 10,
      paddingX: 20,
    },
    animation: {
      mode: "cinema-dissolve",
      enterDuration: 0.14,
      exitDuration: 0.1,
      enterY: 6,
      enterScale: 1,
      highlightScale: 1.03,
      ease: "power2.out",
    },
  }),
];

function buildDualStyleRegistry(defs) {
  const list = [...defs];
  for (const preset of list) {
    Object.defineProperty(list, preset.id, {
      value: preset,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(list);
}

export const CAPTION_STYLES = buildDualStyleRegistry(STYLE_DEFINITIONS);

export function getCaptionStyle(styleId) {
  const requested = String(styleId || "").trim();
  return CAPTION_STYLES.find((s) => s.id === requested) || CAPTION_STYLES[0];
}

function countGraphemes(text) {
  if (!text) return 0;
  if (graphemeSegmenter) {
    let count = 0;
    for (const _ of graphemeSegmenter.segment(text)) {
      count += 1;
    }
    return count;
  }
  return Array.from(text).length;
}

function stripOuterPunctuation(token) {
  return String(token || "")
    .replace(/^[^\p{L}\p{N}\u0980-\u09FF%$৳]+/gu, "")
    .replace(/[^\p{L}\p{N}\u0980-\u09FF%$৳]+$/gu, "");
}

function estimateEnglishSyllables(cleanWord) {
  const lower = cleanWord.toLowerCase().replace(/[^a-z]/g, "");
  if (!lower) return 1;
  if (lower.length <= 3) return 1;
  const trimmed = lower.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const vowelGroups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, vowelGroups ? vowelGroups.length : 1);
}

function estimateBengaliSyllables(cleanWord) {
  const consonants = (cleanWord.match(BENGALI_CONSONANT_RE) || []).length;
  const indepVowels = (cleanWord.match(BENGALI_INDEPENDENT_VOWEL_RE) || []).length;
  const conjunctLinks = (cleanWord.match(BENGALI_VIRAMA_CLUSTER_RE) || []).length;
  const longMatras = (cleanWord.match(BENGALI_LONG_MATRA_RE) || []).length;
  const aksharaNuclei = Math.max(1, consonants + indepVowels - conjunctLinks);
  return aksharaNuclei + longMatras * 0.22 + conjunctLinks * 0.18;
}

/**
 * Computes spoken duration weight of a single word across English, Bengali, and numbers.
 */
function computeWordWeight(rawWord) {
  const clean = stripOuterPunctuation(rawWord);
  if (!clean) return 0.5;

  const graphemes = Math.max(1, countGraphemes(clean));
  let syllableScore = 1;

  if (BENGALI_CHAR_RE.test(clean)) {
    syllableScore = estimateBengaliSyllables(clean);
  } else if (/[a-zA-Z]/.test(clean)) {
    syllableScore = estimateEnglishSyllables(clean);
  } else if (/\d/.test(clean)) {
    syllableScore = Math.max(1.2, graphemes * 0.65);
  }

  let pauseBonus = 0;
  if (SENTENCE_END_RE.test(rawWord)) {
    pauseBonus = 0.45;
  } else if (CLAUSE_END_RE.test(rawWord)) {
    pauseBonus = 0.22;
  }

  return Math.max(0.45, syllableScore * 0.68 + graphemes * 0.14 + pauseBonus);
}

function tokenizeScriptWords(text) {
  const rawTokens = String(text || "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const merged = [];
  for (const tok of rawTokens) {
    // Drop Whisper music-note or replacement-char artifacts
    if (/^[♪♫]+$/.test(tok)) continue;
    // Attach standalone punctuation tokens (e.g. lone "।" or "—") to the previous word
    if (/^[^\p{L}\p{N}\u0980-\u09FF]+$/u.test(tok)) {
      if (merged.length > 0) {
        merged[merged.length - 1] += tok;
      }
      continue;
    }
    merged.push(tok);
  }
  return merged;
}

function selectHighlightWord(words) {
  if (!words || words.length === 0) return "";
  let bestClean = "";
  let bestScore = -1;

  for (let i = 0; i < words.length; i++) {
    const raw = words[i].word;
    const clean = stripOuterPunctuation(raw);
    if (!clean) continue;

    const lower = clean.toLowerCase();
    const isStop = ENGLISH_STOP_WORDS.has(lower) || BENGALI_STOP_WORDS.has(clean);
    const graphemes = countGraphemes(clean);
    const hasNumberOrMetric = /[\d%$৳]/.test(clean);

    let score = computeWordWeight(clean);
    if (isStop) {
      score *= 0.2;
    } else {
      score += graphemes * 0.25;
    }
    if (hasNumberOrMetric) {
      score += 2.2;
    }
    // Slight preference for climax/later word on near-ties
    score += (i / Math.max(1, words.length)) * 0.18;

    if (score > bestScore) {
      bestScore = score;
      bestClean = clean;
    }
  }

  return bestClean || stripOuterPunctuation(words[0].word) || words[0].word;
}

function distributeWordsOverSpan(wordStrings, spanStart, spanEnd) {
  if (wordStrings.length === 0) return [];
  const safeStart = Math.max(0, Number(spanStart) || 0);
  const safeEnd = Math.max(safeStart + 0.05 * wordStrings.length, Number(spanEnd) || safeStart + 1);
  const totalSpan = safeEnd - safeStart;

  const weights = wordStrings.map((w) => computeWordWeight(w));
  const weightSum = weights.reduce((acc, w) => acc + w, 0) || wordStrings.length;

  const timed = [];
  let cursor = safeStart;
  for (let i = 0; i < wordStrings.length; i++) {
    const wordStart = i === 0 ? roundTime(safeStart) : cursor;
    const rawEnd =
      i === wordStrings.length - 1
        ? roundTime(safeEnd)
        : roundTime(
            safeStart +
              (weights.slice(0, i + 1).reduce((a, b) => a + b, 0) / weightSum) * totalSpan,
          );
    const wordEnd = Math.max(roundTime(wordStart + 0.02), rawEnd);
    timed.push({
      word: wordStrings[i],
      start: wordStart,
      end: i === wordStrings.length - 1 ? Math.max(wordStart + 0.02, roundTime(safeEnd)) : wordEnd,
    });
    cursor = timed[i].end;
  }

  // Ensure monotonic non-overlapping boundaries within [safeStart, safeEnd]
  for (let i = 0; i < timed.length - 1; i++) {
    if (timed[i].end > timed[i + 1].start) {
      timed[i].end = timed[i + 1].start;
    }
  }
  return timed;
}

function extractTimedWordsFromWhisper(whisperSegments, startTime, durationSeconds) {
  if (!Array.isArray(whisperSegments) || whisperSegments.length === 0) return null;

  const collected = [];
  for (const seg of whisperSegments) {
    if (!seg || typeof seg !== "object") continue;

    if (Array.isArray(seg.words) && seg.words.length > 0) {
      for (const wObj of seg.words) {
        const rawText = String(wObj?.word ?? wObj?.text ?? "").trim();
        const tokens = tokenizeScriptWords(rawText);
        if (tokens.length === 0) continue;
        const wStart = Number(wObj.start ?? seg.start ?? 0);
        const wEnd = Number(wObj.end ?? wStart + 0.2);
        if (tokens.length === 1) {
          collected.push({
            word: tokens[0],
            start: roundTime(wStart),
            end: roundTime(Math.max(wStart + 0.02, wEnd)),
          });
        } else {
          collected.push(...distributeWordsOverSpan(tokens, wStart, Math.max(wStart + 0.08, wEnd)));
        }
      }
      continue;
    }

    // Flat word entry or segment-only entry `{ start, end, text }`
    const rawLabel = String(seg.word ?? seg.text ?? "").trim();
    const segTokens = tokenizeScriptWords(rawLabel);
    if (segTokens.length === 0) continue;

    const segStart = Number(seg.start ?? 0);
    const segEnd = Number(seg.end ?? segStart + Math.max(0.25, segTokens.length * 0.32));
    if (segTokens.length === 1) {
      collected.push({
        word: segTokens[0],
        start: roundTime(segStart),
        end: roundTime(Math.max(segStart + 0.02, segEnd)),
      });
    } else {
      collected.push(
        ...distributeWordsOverSpan(segTokens, segStart, Math.max(segStart + 0.08, segEnd)),
      );
    }
  }

  if (collected.length === 0) return null;

  // Offset local 0-based clip timestamps when startTime > 0 and timestamps precede startTime
  const baseStart = Math.max(0, Number(startTime) || 0);
  const maxEnd = Math.max(...collected.map((w) => w.end));
  const needsOffset =
    baseStart > 0 &&
    collected[0].start < baseStart &&
    (!Number.isFinite(Number(durationSeconds)) || maxEnd <= Number(durationSeconds) + 0.1);

  const maxAllowedEnd =
    Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0
      ? roundTime(baseStart + Number(durationSeconds))
      : Infinity;

  const normalized = [];
  for (const item of collected) {
    const s = roundTime(item.start + (needsOffset ? baseStart : 0));
    const e = roundTime(item.end + (needsOffset ? baseStart : 0));
    if (s >= maxAllowedEnd - 0.01) continue;
    const clampedStart = Math.max(baseStart, s);
    const clampedEnd = Math.min(maxAllowedEnd, Math.max(clampedStart + 0.02, e));
    normalized.push({
      word: item.word,
      start: clampedStart,
      end: clampedEnd,
    });
  }

  return normalized.length > 0 ? normalized : null;
}

function groupTimedWordsIntoPhrases(timedWords, maxWordsPerPhrase, respectPauseGap) {
  const maxWords = clamp(Math.floor(Number(maxWordsPerPhrase) || 5), 1, 12);
  const rawGroups = [];
  let current = [];

  for (let i = 0; i < timedWords.length; i++) {
    const item = timedWords[i];
    current.push(item);

    const next = timedWords[i + 1];
    if (!next) {
      rawGroups.push(current);
      current = [];
      continue;
    }

    const hitWordCap = current.length >= maxWords;
    const hitSentenceEnd = SENTENCE_END_RE.test(item.word);
    const hitClauseBreak =
      CLAUSE_END_RE.test(item.word) && current.length >= Math.max(2, Math.ceil(maxWords * 0.6));
    const pauseGap = next.start - item.end;
    const hitSpeechPause = respectPauseGap && pauseGap >= 0.18;

    if (hitWordCap || hitSentenceEnd || hitClauseBreak || hitSpeechPause) {
      rawGroups.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    rawGroups.push(current);
  }

  return rawGroups.map((words, index) => ({
    index,
    text: words.map((w) => w.word).join(" "),
    highlightWord: selectHighlightWord(words),
    start: words[0].start,
    end: words[words.length - 1].end,
    words: words.map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    })),
  }));
}

/**
 * Aligns spoken script text into phrase and word timing windows.
 * Uses `whisperSegments` timestamps if provided; otherwise deterministically
 * distributes timing across phrases & words weighted by character/syllable count
 * for both English and Bengali Unicode scripts.
 */
export function alignScriptToWordTimings({
  scriptText = "",
  startTime = 0,
  durationSeconds,
  whisperSegments = null,
  maxWordsPerPhrase = 5,
} = {}) {
  const safeStart = Math.max(0, Number(startTime) || 0);
  const whisperWords = extractTimedWordsFromWhisper(whisperSegments, safeStart, durationSeconds);

  if (whisperWords && whisperWords.length > 0) {
    return {
      phrases: groupTimedWordsIntoPhrases(whisperWords, maxWordsPerPhrase, true),
    };
  }

  const tokens = tokenizeScriptWords(scriptText);
  if (tokens.length === 0) {
    return { phrases: [] };
  }

  const resolvedDuration =
    Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0
      ? Number(durationSeconds)
      : Math.max(1.2, tokens.length * 0.38);

  const timedWords = distributeWordsOverSpan(tokens, safeStart, safeStart + resolvedDuration);
  return {
    phrases: groupTimedWordsIntoPhrases(timedWords, maxWordsPerPhrase, false),
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeCompositionId(rawId) {
  const cleaned = String(rawId || "captions-track")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned) return "captions-track";
  return /^[a-zA-Z]/.test(cleaned) ? cleaned : `cap-${cleaned}`;
}

function resolveAccessiblePalette(style, brandColors = {}) {
  const baseBg = style.palette.backgroundColor;
  const baseText = style.palette.textColor;
  let highlightColor = style.palette.highlightColor;
  let borderColor = style.palette.borderColor;
  let activePillBg = style.palette.activePillBg;
  let activePillText = style.palette.activePillText;

  const candidateAccent = normalizeHexColor(brandColors?.accent);
  const candidateSecondary = normalizeHexColor(brandColors?.secondary);

  if (candidateAccent && computeContrastRatio(candidateAccent, baseBg) >= 4.5) {
    highlightColor = candidateAccent;
    if (activePillBg) {
      if (computeContrastRatio("#08120E", candidateAccent) >= 4.5) {
        activePillBg = candidateAccent;
        activePillText = "#08120E";
      } else if (computeContrastRatio("#FFFFFF", candidateAccent) >= 4.5) {
        activePillBg = candidateAccent;
        activePillText = "#FFFFFF";
      }
    }
  }

  if (candidateSecondary && computeContrastRatio(candidateSecondary, baseBg) >= 3.0) {
    borderColor = candidateSecondary;
  } else if (candidateAccent && computeContrastRatio(candidateAccent, baseBg) >= 3.0) {
    borderColor = candidateAccent;
  }

  return {
    backgroundColor: baseBg,
    textColor: baseText,
    highlightColor,
    borderColor,
    activePillBg,
    activePillText,
  };
}

/**
 * Generates a complete, lint-clean HyperFrames `<template id="captions-track-template">`
 * HTML sub-composition following the `captions-overlay` doctrine.
 */
export function renderCaptionsSubComposition({
  compositionId = "captions-track",
  width = 1080,
  height = 1920,
  totalDuration,
  styleId = "kinetic-gold-pop",
  phrases = [],
  brandColors = {},
} = {}) {
  const compId = sanitizeCompositionId(compositionId);
  const pfx = compId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const canvasW = Math.max(240, Math.round(Number(width) || 1080));
  const canvasH = Math.max(240, Math.round(Number(height) || 1920));
  const isLandscape = canvasW > canvasH;

  const style = getCaptionStyle(styleId);
  const palette = resolveAccessiblePalette(style, brandColors);

  const normalizedPhrases = Array.isArray(phrases) ? phrases : [];
  const inferredEnd =
    normalizedPhrases.length > 0
      ? Math.max(...normalizedPhrases.map((p) => Number(p.end) || 0))
      : 1;
  const rootDuration = roundTime(
    Number.isFinite(Number(totalDuration)) && Number(totalDuration) > 0
      ? Number(totalDuration)
      : Math.max(1, inferredEnd),
  );

  const scaleUnit = Math.min(canvasW, canvasH) / 1080;
  const baseFontSize = isLandscape
    ? style.typography.fontSizeLandscape
    : style.typography.fontSizePortrait;
  const fontSizePx = Math.max(20, Math.round(baseFontSize * scaleUnit));
  const padY = Math.max(6, Math.round(style.typography.paddingY * scaleUnit));
  const padX = Math.max(12, Math.round(style.typography.paddingX * scaleUnit));
  const radiusPx = Math.max(8, Math.round(style.typography.borderRadiusPx * scaleUnit));
  const maxWidthPx = Math.round(canvasW * (style.safeZone.maxWidthPct / 100));

  const hasBengaliText =
    Boolean(style.typography.needsBengaliFontFace) ||
    normalizedPhrases.some((p) => BENGALI_CHAR_RE.test(String(p?.text || "")));

  const fontFaceRule = hasBengaliText
    ? `
    @font-face {
      font-family: "Noto Sans Bengali";
      src: local("Noto Sans Bengali"), local("Nirmala UI"), local("Vrinda");
      font-weight: 400 800;
      font-style: normal;
    }`
    : "";

  const fontFamilyCss =
    hasBengaliText && !style.typography.fontFamily.includes("Noto Sans Bengali")
      ? `"Noto Sans Bengali", ${style.typography.fontFamily}`
      : style.typography.fontFamily;

  const transcriptEntries = [];
  const phraseMarkupBlocks = [];

  for (let i = 0; i < normalizedPhrases.length; i++) {
    const rawPhrase = normalizedPhrases[i];
    const start = clamp(
      roundTime(Number(rawPhrase?.start) || 0),
      0,
      Math.max(0, rootDuration - 0.05),
    );
    const clampedEnd = clamp(
      roundTime(Number(rawPhrase?.end) || start + 0.5),
      roundTime(start + 0.05),
      rootDuration,
    );
    const clipDuration = Math.max(0.05, roundTime(clampedEnd - start));

    const rawWords =
      Array.isArray(rawPhrase?.words) && rawPhrase.words.length > 0
        ? rawPhrase.words
        : distributeWordsOverSpan(tokenizeScriptWords(rawPhrase?.text || ""), start, clampedEnd);

    const hiClean = stripOuterPunctuation(rawPhrase?.highlightWord || "").toLowerCase();
    let highlightedIndex = -1;
    for (let wIdx = 0; wIdx < rawWords.length; wIdx++) {
      const candidateClean = stripOuterPunctuation(rawWords[wIdx].word).toLowerCase();
      if (hiClean && candidateClean === hiClean) {
        highlightedIndex = wIdx;
        break;
      }
    }

    const cueId = `${pfx}-cue-${i}`;
    const boxId = `${pfx}-box-${i}`;
    const wordSpans = [];
    const wordTimings = [];

    for (let wIdx = 0; wIdx < rawWords.length; wIdx++) {
      const wItem = rawWords[wIdx];
      const wordId = `${pfx}-w-${i}-${wIdx}`;
      const isHighlight = wIdx === highlightedIndex && style.animation.mode !== "karaoke-pill";
      const classes = isHighlight ? `${pfx}-word ${pfx}-word-hi` : `${pfx}-word`;
      wordSpans.push(`<span id="${wordId}" class="${classes}">${escapeHtml(wItem.word)}</span>`);

      const rawWStart = Number(wItem.start);
      const rawWEnd = Number(wItem.end);
      const wStart = clamp(
        roundTime(Number.isFinite(rawWStart) ? rawWStart : start),
        start,
        clampedEnd - 0.02,
      );
      const wEnd = clamp(
        roundTime(Number.isFinite(rawWEnd) ? rawWEnd : clampedEnd),
        wStart + 0.02,
        clampedEnd,
      );
      wordTimings.push({
        id: wordId,
        word: String(wItem.word || ""),
        start: wStart,
        end: wEnd,
      });
    }

    phraseMarkupBlocks.push(`    <div
      id="${cueId}"
      class="clip caption-group"
      data-start="${start}"
      data-duration="${clipDuration}"
      data-track-index="1"
      data-layout-allow-caption-zone
    >
      <span id="${boxId}" class="${pfx}-box">${wordSpans.join(" ")}</span>
    </div>`);

    const enterDur = roundTime(Math.min(style.animation.enterDuration, clipDuration * 0.34));
    const exitDur = roundTime(Math.min(style.animation.exitDuration, clipDuration * 0.26));
    const killAt = roundTime(Math.max(start + enterDur + 0.01, clampedEnd - 0.005));
    const exitStart = roundTime(Math.max(start + enterDur + 0.005, killAt - exitDur - 0.004));

    const hiWordObj = highlightedIndex >= 0 ? wordTimings[highlightedIndex] : null;
    transcriptEntries.push({
      text: String(rawPhrase?.text || rawWords.map((w) => w.word).join(" ")),
      start,
      end: clampedEnd,
      boxSel: `#${boxId}`,
      enterDur,
      exitStart,
      exitDur,
      killAt,
      hiSel: hiWordObj && style.animation.mode !== "karaoke-pill" ? `#${hiWordObj.id}` : null,
      hiStart: hiWordObj ? hiWordObj.start : start,
      hiDur: roundTime(Math.min(0.18, clipDuration * 0.25)),
      words: wordTimings.map((wt) => ({
        sel: `#${wt.id}`,
        start: wt.start,
        dur: roundTime(Math.min(0.12, Math.max(0.03, (wt.end - wt.start) * 0.45))),
      })),
    });
  }

  const highlightSpanCss =
    palette.activePillBg && style.animation.mode !== "karaoke-pill"
      ? `
    .${pfx}-word-hi {
      color: ${palette.activePillText};
      background-color: ${palette.activePillBg};
      padding: 2px 10px;
      border-radius: 10px;
    }`
      : `
    .${pfx}-word-hi {
      color: ${palette.highlightColor};
    }`;

  const karaokeScriptSnippet =
    style.animation.mode === "karaoke-pill"
      ? `
        cue.words.forEach(function (w) {
          tl.fromTo(
            w.sel,
            {
              backgroundColor: "rgba(15, 23, 42, 0)",
              color: "${palette.textColor}",
              scale: 1,
            },
            {
              backgroundColor: "${palette.activePillBg || palette.highlightColor}",
              color: "${palette.activePillText || "#051B11"}",
              scale: ${style.animation.highlightScale},
              duration: w.dur,
              ease: "power2.out",
              immediateRender: false,
            },
            w.start,
          );
        });`
      : `
        if (cue.hiSel) {
          tl.fromTo(
            cue.hiSel,
            { scale: 1 },
            {
              scale: ${style.animation.highlightScale},
              duration: cue.hiDur,
              ease: "back.out(1.7)",
              immediateRender: false,
            },
            cue.hiStart,
          );
        }`;

  const enterFromVars =
    style.animation.mode === "blur-morph"
      ? `{
            opacity: 0,
            y: ${style.animation.enterY},
            scale: ${style.animation.enterScale},
            filter: "blur(10px)",
          }`
      : `{
            opacity: 0,
            y: ${style.animation.enterY},
            scale: ${style.animation.enterScale},
          }`;

  const enterToExtra =
    style.animation.mode === "blur-morph" ? `\n            filter: "blur(0px)",` : "";

  const transcriptJson = JSON.stringify(transcriptEntries);

  return `<template id="${compId}-template">
  <style>${fontFaceRule}
    #root {
      position: absolute;
      inset: 0;
      overflow: visible;
      pointer-events: none;
      background: transparent;
      font-family: ${fontFamilyCss};
    }
    [data-composition-id="${compId}"] .caption-group {
      position: absolute;
      left: ${style.safeZone.leftPct}%;
      right: ${style.safeZone.rightPct}%;
      bottom: ${style.safeZone.bottomPct}%;
      max-width: ${maxWidthPx}px;
      margin: 0 auto;
      display: flex;
      justify-content: center;
      align-items: center;
      text-align: center;
      overflow: visible;
      pointer-events: none;
    }
    .${pfx}-box {
      display: inline-flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 0.28em;
      max-width: ${maxWidthPx}px;
      padding: ${padY}px ${padX}px;
      border-radius: ${radiusPx}px;
      background-color: ${palette.backgroundColor};
      border: 2px solid ${palette.borderColor};
      color: ${palette.textColor};
      font-family: ${fontFamilyCss};
      font-size: ${fontSizePx}px;
      font-weight: ${style.typography.fontWeight};
      line-height: ${style.typography.lineHeight};
      letter-spacing: ${style.typography.letterSpacing};
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.48);
      overflow: visible;
    }
    .${pfx}-word {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 8px;
      color: ${palette.textColor};
    }${highlightSpanCss}
  </style>
  <div
    id="root"
    data-composition-id="${compId}"
    data-width="${canvasW}"
    data-height="${canvasH}"
    data-duration="${rootDuration}"
  >
${phraseMarkupBlocks.join("\n")}
  </div>
  <script>
    (function () {
      const TRANSCRIPT = ${transcriptJson};
      const tl = gsap.timeline({ paused: true });
      TRANSCRIPT.forEach(function (cue) {
        tl.fromTo(
          cue.boxSel,
          ${enterFromVars},
          {
            opacity: 1,
            y: 0,
            scale: 1,${enterToExtra}
            duration: cue.enterDur,
            ease: "${style.animation.ease}",
            immediateRender: false,
          },
          cue.start,
        );${karaokeScriptSnippet}
        tl.to(
          cue.boxSel,
          {
            opacity: 0,
            y: -6,
            duration: cue.exitDur,
            ease: "power2.in",
          },
          cue.exitStart,
        );
        tl.set(cue.boxSel, { opacity: 0, visibility: "hidden" }, cue.killAt);
      });
      window.__timelines = window.__timelines || {};
      window.__timelines["${compId}"] = tl;
    })();
  </script>
</template>
`;
}

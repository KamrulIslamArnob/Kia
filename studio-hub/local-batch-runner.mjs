import fs from "node:fs";
import path from "node:path";
import { PROJECTS_DIR, assertValidSlug } from "./lib.mjs";

export const COST_MODE = "subscription-zero-dollar";

const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const SAFE_LANG_RE =
  /^[a-zA-Z0-9\u0980-\u09FF\u0900-\u097F][a-zA-Z0-9\u0980-\u09FF\u0900-\u097F _-]{0,40}$/;

export const AD_VARIANT_LANGUAGES = Object.freeze({
  Bengali: Object.freeze({
    language: "Bengali",
    langKey: "bengali",
    locale: "bn-BD",
    isoCode: "bn",
    script: "Bengali",
    primaryVoice: "bn-BD-NabanitaNeural",
    alternateVoice: "bn-BD-PradeepNeural",
    captionStyleId: "bengali-emerald-card",
    fontStack: "'Noto Sans Bengali', 'Hind Siliguri', 'Inter', sans-serif",
    wordsPerSecond: 2.35,
    ctaDefault: "এখনই অর্ডার করুন",
    badgeDefault: "বিশেষ অফার",
  }),
  English: Object.freeze({
    language: "English",
    langKey: "english",
    locale: "en-US",
    isoCode: "en",
    script: "Latin",
    primaryVoice: "en-US-AriaNeural",
    alternateVoice: "en-US-ChristopherNeural",
    captionStyleId: "kinetic-gold-pop",
    fontStack: "'Inter', 'Plus Jakarta Sans', sans-serif",
    wordsPerSecond: 2.65,
    ctaDefault: "Order Now",
    badgeDefault: "FEATURED OFFER",
  }),
  Hindi: Object.freeze({
    language: "Hindi",
    langKey: "hindi",
    locale: "hi-IN",
    isoCode: "hi",
    script: "Devanagari",
    primaryVoice: "hi-IN-SwaraNeural",
    alternateVoice: "hi-IN-MadhurNeural",
    captionStyleId: "kinetic-gold-pop",
    fontStack: "'Noto Sans Devanagari', 'Poppins', 'Inter', sans-serif",
    wordsPerSecond: 2.45,
    ctaDefault: "अभी ऑर्डर करें",
    badgeDefault: "विशेष ऑफ़र",
  }),
});

const BEAT_COPY_TEMPLATES = Object.freeze({
  Bengali: Object.freeze({
    hook: {
      badge: "বিশেষ লঞ্চ অফার",
      headline: ({ brand, timeVal, pctVal }) =>
        timeVal && pctVal
          ? `মাত্র ${timeVal} মিনিটে দ্রুত ডেলিভারি — ${pctVal} সাশ্রয়`
          : pctVal
            ? `${brand} — আজই ${pctVal} বিশেষ ছাড় পান`
            : timeVal
              ? `মাত্র ${timeVal} মিনিটে তাজা ডেলিভারি আপনার দরজায়`
              : `${brand} — দ্রুত ও নির্ভরযোগ্য অভিজ্ঞতা`,
      subheadline: ({ pctVal, priceVal }) =>
        pctVal
          ? `প্রথম অর্ডারে নিশ্চিত ${pctVal} সাশ্রয় এবং কোনো গোপন চার্জ নেই।`
          : priceVal
            ? `মাত্র ${priceVal} থেকে শুরু — সরাসরি আপনার হাতের মুঠোয়।`
            : "সহজ অর্ডার ও তাৎক্ষণিক ডেলিভারি সুবিধা প্রতিদিন।",
      vo: ({ brand, timeVal, pctVal }) =>
        timeVal && pctVal
          ? `${brand} থেকে মাত্র ${timeVal} মিনিটে ডেলিভারি পান এবং আজই ${pctVal} সাশ্রয় করুন।`
          : pctVal
            ? `${brand} অ্যাপে অর্ডার করে আজই পান নিশ্চিত ${pctVal} সাশ্রয়।`
            : `${brand} এর সাথে আপনার প্রতিদিনের কেনাকাটা করুন আরও দ্রুত ও সহজে।`,
      cta: "এখনই অর্ডার করুন",
    },
    discovery: {
      badge: "বাছাইকৃত কালেকশন",
      headline: ({ brand }) => `${brand} এর সেরা ডিল এক নজরে`,
      subheadline: () => "প্রতিদিন নতুন অফার ও যাচাইকৃত পণ্যের সমাহার।",
      vo: () => "এক ক্লিকেই দেখে নিন আজকের সেরা অফার এবং আপনার পছন্দের কালেকশন।",
      cta: "ডিল দেখুন",
    },
    "feature-grid": {
      badge: "স্মার্ট ক্যাটাগরি",
      headline: () => "সব কিছু সাজানো পরিপাটি ক্যাটাগরিতে",
      subheadline: () => "কোনো ঝামেলা ছাড়াই মুহূর্তে খুঁজে পান প্রয়োজনীয় পণ্য।",
      vo: () => "পরিষ্কার ক্যাটাগরি থেকে এক ট্যাপেই বেছে নিন আপনার দরকারি সব পণ্য।",
      cta: "ক্যাটাগরি দেখুন",
    },
    interaction: {
      badge: "সহজ কন্ট্রোল",
      headline: () => "ওয়ান-ট্যাপ কার্ট ও লাইভ আপডেট",
      subheadline: () => "স্বচ্ছ মূল্য এবং তাৎক্ষণিক অর্ডার কনফার্মেশন।",
      vo: () => "সহজেই কার্টে যোগ করুন এবং রিয়েল-টাইম মূল্য দেখে অর্ডার নিশ্চিত করুন।",
      cta: "কার্টে যোগ করুন",
    },
    "speed-ramp": {
      badge: "২X ফাস্ট চেকআউট",
      headline: () => "কয়েক সেকেন্ডেই ঝামেলামুক্ত চেকআউট",
      subheadline: () => "দ্রুত ঠিকানা ও পেমেন্ট সম্পন্ন করুন চোখের পলকে।",
      vo: () => "মাত্র কয়েক সেকেন্ডে আপনার অর্ডার সম্পন্ন করুন কোনো অপেক্ষা ছাড়াই।",
      cta: "দ্রুত চেকআউট",
    },
    "value-proof": {
      badge: "মানের নিশ্চয়তা",
      headline: ({ priceVal }) =>
        priceVal ? `${priceVal} অর্ডারে ফ্রি ডেলিভারি ও সেরা মান` : "পরীক্ষিত মান ও শূন্য গোপন চার্জ",
      subheadline: ({ priceVal }) =>
        priceVal
          ? `${priceVal} এর উপরে অর্ডারে কোনো অতিরিক্ত ডেলিভারি ফি নেই।`
          : "প্রতিটি পণ্য মান যাচাই করা এবং সম্পূর্ণ স্বচ্ছ মূল্যে।",
      vo: ({ priceVal }) =>
        priceVal
          ? `প্রতিটি পণ্যের মান পরীক্ষিত এবং ${priceVal} অর্ডারে থাকছে শূন্য গোপন চার্জ।`
          : "প্রতিটি পণ্যের মান পরীক্ষিত এবং ডেলিভারিতে কোনো গোপন চার্জ নেই।",
      cta: "অফার নিন",
    },
    "cta-outro": {
      badge: "আজই শুরু করুন",
      headline: ({ brand }) => `আজই ${brand} ডাউনলোড করুন`,
      subheadline: () => "নিচে ট্যাপ করে আপনার ওয়েলকাম রিওয়ার্ড সংগ্রহ করুন।",
      vo: ({ brand }) => `আজই ${brand} ডাউনলোড করুন এবং মুহূর্তেই সাশ্রয় শুরু করুন।`,
      cta: "ফ্রি ডাউনলোড",
    },
  }),
  Hindi: Object.freeze({
    hook: {
      badge: "स्पेशल लॉन्च ऑफ़र",
      headline: ({ brand, timeVal, pctVal }) =>
        timeVal && pctVal
          ? `सिर्फ ${timeVal} मिनट में ताज़ा डिलीवरी — ${pctVal} की बचत`
          : pctVal
            ? `${brand} — आज ही पाएं ${pctVal} की शानदार छूट`
            : timeVal
              ? `सिर्फ ${timeVal} मिनट में तेज़ डोरस्टेप डिलीवरी`
              : `${brand} — तेज़ और भरोसेमंद स्मार्ट अनुभव`,
      subheadline: ({ pctVal, priceVal }) =>
        pctVal
          ? `अपने पहले ऑर्डर पर ${pctVal} बचाएं, बिना किसी छिपे शुल्क के।`
          : priceVal
            ? `सिर्फ ${priceVal} से शुरू — सीधा आपके घर तक।`
            : "हर रोज़ आसान ऑर्डर और तुरंत डिलीवरी की सुविधा।",
      vo: ({ brand, timeVal, pctVal }) =>
        timeVal && pctVal
          ? `${brand} से सिर्फ ${timeVal} मिनट में ताज़ा डिलीवरी पाएं और आज ही ${pctVal} बचाएं।`
          : pctVal
            ? `${brand} पर अभी ऑर्डर करें और पाएं पूरे ${pctVal} की बचत।`
            : `${brand} के साथ अपनी रोज़मर्रा की शॉपिंग को बनाएं तेज़ और आसान।`,
      cta: "अभी ऑर्डर करें",
    },
    discovery: {
      badge: "चुनिंदा कलेक्शन",
      headline: ({ brand }) => `${brand} के टॉप डील्स एक नज़र में`,
      subheadline: () => "हर सुबह अपडेट किए गए ताज़ा ऑफ़र और भरोसेमंद उत्पाद।",
      vo: () => "एक टैप में देखें आज के बेहतरीन ऑफ़र और अपने पसंदीदा आइटम्स।",
      cta: "डील्स देखें",
    },
    "feature-grid": {
      badge: "स्मार्ट कैटेगरी",
      headline: () => "हर ज़रूरत के लिए साफ़ और स्मार्ट कैटेगरी",
      subheadline: () => "बिना किसी उलझन के तुरंत चुनें अपनी पसंद।",
      vo: () => "व्यवस्थित कैटेगरी के साथ एक ही टैप में पाएं अपनी ज़रूरत का सामान।",
      cta: "कैटेगरी देखें",
    },
    interaction: {
      badge: "वन-टैप कंट्रोल",
      headline: () => "वन-टैप कार्ट और लाइव प्राइसिंग",
      subheadline: () => "पारदर्शी कीमत और तुरंत ऑर्डर कन्फ़र्मेशन।",
      vo: () => "आसानी से कार्ट में जोड़ें और पूरी पारदर्शिता के साथ ऑर्डर कन्फ़र्म करें।",
      cta: "कार्ट में जोड़ें",
    },
    "speed-ramp": {
      badge: "2X एक्सप्रेस चेकआउट",
      headline: () => "कुछ ही सेकंड में तेज़ एक्सप्रेस चेकआउट",
      subheadline: () => "बिना इंतज़ार किए तुरंत पता और पेमेंट पूरा करें।",
      vo: () => "हमारे एक्सप्रेस चेकआउट के साथ कुछ ही सेकंड में अपना ऑर्डर पूरा करें।",
      cta: "तेज़ चेकआउट",
    },
    "value-proof": {
      badge: "प्रमाणित भरोसा",
      headline: ({ priceVal }) =>
        priceVal ? `${priceVal} के ऑर्डर पर ज़ीरो डिलीवरी शुल्क` : "परखी हुई क्वालिटी और ज़ीरो छिपा शुल्क",
      subheadline: ({ priceVal }) =>
        priceVal
          ? `${priceVal} से ऊपर के सभी ऑर्डर पर कोई अतिरिक्त शुल्क नहीं।`
          : "हर उत्पाद की गुणवत्ता जांची गई है, पूरी पारदर्शिता के साथ।",
      vo: ({ priceVal }) =>
        priceVal
          ? `हर आइटम क्वालिटी चेक्ड है और ${priceVal} से ऊपर के ऑर्डर पर ज़ीरो छिपा शुल्क है।`
          : "हर आइटम क्वालिटी चेक्ड है और डिलीवरी पर कोई छिपा शुल्क नहीं है।",
      cta: "ऑफ़र पाएं",
    },
    "cta-outro": {
      badge: "अभी शुरू करें",
      headline: ({ brand }) => `आज ही ${brand} डाउनलोड करें`,
      subheadline: () => "नीचे टैप करें और अपना वेलकम रिवॉर्ड पाएं।",
      vo: ({ brand }) => `आज ही ${brand} ऐप डाउनलोड करें और सेकंडों में बचत शुरू करें।`,
      cta: "मुफ़्त इंस्टॉल करें",
    },
  }),
});

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

function assertSubscriptionZeroCost(options = {}) {
  if (options.forcePaidApi === true) {
    throw new Error(
      `zeroCostGuard blocked paid external translation/TTS API. Only costMode "${COST_MODE}" is allowed.`,
    );
  }
  if (options.costMode !== undefined && options.costMode !== COST_MODE) {
    throw new Error(
      `zeroCostGuard rejected unsupported costMode "${options.costMode}". Expected "${COST_MODE}".`,
    );
  }
}

function resolveProjectDirectory(slug, projectsDir = PROJECTS_DIR) {
  if (projectsDir === PROJECTS_DIR) {
    return assertValidSlug(slug);
  }
  const cleaned = String(slug || "").trim();
  if (!cleaned || !SAFE_SLUG_RE.test(cleaned)) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  const baseAbs = path.resolve(projectsDir);
  const resolved = path.resolve(baseAbs, cleaned);
  if (!resolved.startsWith(baseAbs + path.sep)) {
    throw new Error(`Unsafe project slug path: ${slug}`);
  }
  return resolved;
}

export function resolveLanguageProfile(rawLang) {
  const trimmed = String(rawLang || "").trim();
  if (!trimmed || !SAFE_LANG_RE.test(trimmed) || trimmed.includes("..")) {
    throw new Error(`Invalid language specifier: "${rawLang}"`);
  }

  const lower = trimmed.toLowerCase();
  if (
    lower === "bengali" ||
    lower === "bangla" ||
    lower === "bn" ||
    lower === "bn-bd" ||
    /বাংলা/.test(trimmed)
  ) {
    return AD_VARIANT_LANGUAGES.Bengali;
  }
  if (lower === "english" || lower === "en" || lower === "en-us" || lower === "en-gb") {
    return AD_VARIANT_LANGUAGES.English;
  }
  if (lower === "hindi" || lower === "hi" || lower === "hi-in" || /हिन्दी|हिंदी/.test(trimmed)) {
    return AD_VARIANT_LANGUAGES.Hindi;
  }

  const safeKey = lower.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!safeKey) {
    throw new Error(`Invalid language key derived from "${rawLang}"`);
  }

  return Object.freeze({
    language: trimmed,
    langKey: safeKey,
    locale: `${safeKey.slice(0, 2)}-XX`,
    isoCode: safeKey.slice(0, 2),
    script: "Latin",
    primaryVoice: "en-US-AriaNeural",
    alternateVoice: "en-US-ChristopherNeural",
    captionStyleId: "clean-cinema-sub",
    fontStack: "'Inter', sans-serif",
    wordsPerSecond: 2.5,
    ctaDefault: "Order Now",
    badgeDefault: "SPECIAL OFFER",
  });
}

function extractCopyMetrics(sourceText) {
  const combined = String(sourceText || "");
  const pctMatch = combined.match(/\b(\d+(?:\.\d+)?%)/);
  const timeMatch = combined.match(/\b(\d+)\s*(?:min(?:ute)?s?|মিনিট|मिनट)\b/i);
  const priceMatch = combined.match(/(?:[$৳₹€£]\s*\d+(?:\.\d+)?|\b\d+\s*(?:tk|taka|inr|usd)\b)/i);
  return {
    pctVal: pctMatch ? pctMatch[1] : null,
    timeVal: timeMatch ? timeMatch[1] : null,
    priceVal: priceMatch ? priceMatch[0].trim() : null,
  };
}

function isAlreadyInTargetScript(text, langProfile) {
  const str = String(text || "").trim();
  if (!str) return false;
  if (langProfile.language === "Bengali") return /[\u0980-\u09FF]/.test(str);
  if (langProfile.language === "Hindi") return /[\u0900-\u097F]/.test(str);
  if (langProfile.language === "English") {
    return /[A-Za-z]/.test(str) && !/[\u0980-\u09FF\u0900-\u097F]/.test(str);
  }
  return false;
}

function inferBeatRole(frame, shotIndex, totalShots) {
  const explicit = String(frame?.narrativeBeat || "")
    .trim()
    .toLowerCase();
  if (explicit && BEAT_COPY_TEMPLATES.Bengali[explicit]) return explicit;
  if (shotIndex === 0) return "hook";
  if (shotIndex === totalShots - 1) return "cta-outro";
  const middleRoles = ["discovery", "value-proof", "feature-grid", "interaction", "speed-ramp"];
  return middleRoles[(shotIndex - 1) % middleRoles.length];
}

function buildStarterFallbackStoryboard(slug, brief) {
  const title = String(brief?.title || slug || "Studio Promo").trim();
  const aspectRatio = brief?.aspectRatio || "9:16";
  const width = Number(brief?.width) || 1080;
  const height = Number(brief?.height) || 1920;
  const fps = Number(brief?.fps) || 30;

  return {
    schemaVersion: 1,
    slug,
    title,
    aspectRatio,
    width,
    height,
    fps,
    brandColors: brief?.brandColors || {
      primary: "#1E824C",
      secondary: "#2ECC71",
      accent: "#FACC15",
      background: "#0A1612",
    },
    frames: [
      {
        id: "frame_01",
        sceneId: "scene_01",
        index: 1,
        title: `${title} — Instant Hook`,
        narrativeBeat: "hook",
        layout: "device-3d-showcase",
        motionPreset: "crash-zoom-in",
        durationSeconds: 3.5,
        locked: false,
        staging: {
          headline: `${title} in Seconds`,
          subheadline: "Save 25% on your first order today.",
          badgeText: "LAUNCH OFFER",
          ctaText: "Order Now",
        },
        audioSpec: {
          voiceoverText: `Experience ${title} today and save 25% on your first order.`,
          sfx: ["whoosh", "pop"],
        },
      },
      {
        id: "frame_02",
        sceneId: "scene_02",
        index: 2,
        title: "Verified Quality & Speed",
        narrativeBeat: "value-proof",
        layout: "split-editorial",
        motionPreset: "whip-pan-split",
        durationSeconds: 4.0,
        locked: false,
        staging: {
          headline: "Zero Friction Workflow",
          subheadline: "Verified quality with transparent pricing.",
          badgeText: "VERIFIED VALUE",
          ctaText: "Explore",
        },
        audioSpec: {
          voiceoverText: "Every detail is verified for speed and zero hidden fees.",
          sfx: ["pop"],
        },
      },
      {
        id: "frame_03",
        sceneId: "scene_03",
        index: 3,
        title: "Start Today",
        narrativeBeat: "cta-outro",
        layout: "kinetic-statement-card",
        motionPreset: "editorial-kinetic-card",
        durationSeconds: 3.5,
        locked: false,
        staging: {
          headline: `Get ${title} Now`,
          subheadline: "Tap below to start in under a minute.",
          badgeText: "GET STARTED",
          ctaText: "Get Started",
        },
        audioSpec: {
          voiceoverText: `Download ${title} today and get started in under a minute.`,
          sfx: ["chime"],
        },
      },
    ],
  };
}

function normalizeHookOverrides(hookOverrides = []) {
  if (!Array.isArray(hookOverrides)) return [];
  return hookOverrides
    .map((entry, idx) => {
      if (typeof entry === "string" && entry.trim()) {
        return {
          id: `hook_${idx + 1}`,
          language: null,
          headline: entry.trim(),
          subheadline: null,
          badgeText: null,
          voiceoverText: null,
          ctaText: null,
        };
      }
      if (entry && typeof entry === "object") {
        return {
          id: String(entry.id || `hook_${idx + 1}`).trim(),
          language: entry.language ? resolveLanguageProfile(entry.language).language : null,
          headline: entry.headline ? String(entry.headline).trim() : null,
          subheadline: entry.subheadline ? String(entry.subheadline).trim() : null,
          badgeText: entry.badgeText ? String(entry.badgeText).trim() : null,
          voiceoverText: entry.voiceoverText ? String(entry.voiceoverText).trim() : null,
          ctaText: entry.ctaText ? String(entry.ctaText).trim() : null,
        };
      }
      return null;
    })
    .filter(Boolean);
}

export function localizeShotForLanguage({
  frame,
  shotIndex = 0,
  totalShots = 3,
  langProfile,
  brandTitle = "Brand",
  hookOverride = null,
}) {
  const cloned = structuredClone(frame || {});
  const staging = { ...(cloned.staging || {}) };
  const audioSpec = { ...(cloned.audioSpec || {}) };

  const sourceHeadline = String(staging.headline || cloned.title || "").trim();
  const sourceSub = String(staging.subheadline || "").trim();
  const sourceBadge = String(staging.badgeText || "").trim();
  const sourceVo = String(audioSpec.voiceoverText || staging.captionText || "").trim();
  const sourceCta = String(staging.ctaText || "").trim();

  const metrics = extractCopyMetrics(`${sourceHeadline} ${sourceSub} ${sourceVo}`);
  const beatRole = inferBeatRole(cloned, shotIndex, totalShots);
  const templates = BEAT_COPY_TEMPLATES[langProfile.language]?.[beatRole] || null;
  const ctx = {
    brand: brandTitle,
    timeVal: metrics.timeVal,
    pctVal: metrics.pctVal,
    priceVal: metrics.priceVal,
  };

  let headline = sourceHeadline;
  let subheadline = sourceSub;
  let badgeText = sourceBadge || langProfile.badgeDefault;
  let voiceoverText = sourceVo;
  let ctaText = sourceCta || langProfile.ctaDefault;

  if (templates && !isAlreadyInTargetScript(sourceHeadline, langProfile)) {
    headline = templates.headline(ctx);
  }
  if (templates && !isAlreadyInTargetScript(sourceSub, langProfile)) {
    subheadline = templates.subheadline(ctx);
  }
  if (templates && !isAlreadyInTargetScript(sourceBadge, langProfile)) {
    badgeText = templates.badge;
  }
  if (templates && !isAlreadyInTargetScript(sourceVo, langProfile)) {
    voiceoverText = templates.vo(ctx);
  }
  if (templates && !isAlreadyInTargetScript(sourceCta, langProfile)) {
    ctaText = templates.cta;
  }

  // Apply explicit A/B hook override on Shot 1 (0..3s scroll-stopper)
  if (shotIndex === 0 && hookOverride) {
    if (hookOverride.headline) headline = hookOverride.headline;
    if (hookOverride.subheadline) subheadline = hookOverride.subheadline;
    if (hookOverride.badgeText) badgeText = hookOverride.badgeText;
    if (hookOverride.voiceoverText) voiceoverText = hookOverride.voiceoverText;
    if (hookOverride.ctaText) ctaText = hookOverride.ctaText;
  }

  const wordCount = voiceoverText ? voiceoverText.split(/\s+/).filter(Boolean).length : 0;
  const estimatedSpeechSeconds = round2(wordCount / (langProfile.wordsPerSecond || 2.5));
  const baseDuration = Math.max(1.5, Number(cloned.durationSeconds) || 3.5);
  const durationSeconds = cloned.locked
    ? baseDuration
    : round2(Math.max(baseDuration, estimatedSpeechSeconds + 0.4));

  return {
    ...cloned,
    title: headline || cloned.title,
    durationSeconds,
    captionStyleId: langProfile.captionStyleId,
    staging: {
      ...staging,
      headline,
      subheadline,
      badgeText,
      ctaText,
      captionText: voiceoverText,
      fontFamily: langProfile.fontStack,
      locale: langProfile.locale,
    },
    audioSpec: {
      ...audioSpec,
      language: langProfile.language,
      locale: langProfile.locale,
      ttsBackend: "edge-tts-neural",
      voice: langProfile.primaryVoice,
      alternateVoice: langProfile.alternateVoice,
      voiceoverText,
      estimatedSpeechSeconds,
    },
  };
}

/**
 * Produces ready-to-render localized A/B ad variant storyboards
 * (`projects/<slug>/.studio/variants/variant_<lang>.json`) at $0 subscription cost.
 */
export function buildLocalizedAdVariantsPlan(options = {}) {
  assertSubscriptionZeroCost(options);

  const {
    slug,
    storyboard = null,
    brief = null,
    languages = ["Bengali", "English", "Hindi"],
    hookOverrides = [],
    projectsDir = PROJECTS_DIR,
    persist = true,
  } = options;

  const projectDir = resolveProjectDirectory(slug, projectsDir);
  const cleanSlug = path.basename(projectDir);

  let resolvedBrief = brief;
  if (!resolvedBrief) {
    const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
    if (fs.existsSync(briefPath)) {
      try {
        resolvedBrief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
      } catch {
        resolvedBrief = null;
      }
    }
  }

  let resolvedStoryboard = storyboard;
  if (!resolvedStoryboard) {
    const sbPath = path.join(projectDir, "STORYBOARD.json");
    if (fs.existsSync(sbPath)) {
      try {
        resolvedStoryboard = JSON.parse(fs.readFileSync(sbPath, "utf8"));
      } catch {
        resolvedStoryboard = null;
      }
    }
  }
  if (
    !resolvedStoryboard ||
    !Array.isArray(resolvedStoryboard.frames) ||
    resolvedStoryboard.frames.length === 0
  ) {
    resolvedStoryboard = buildStarterFallbackStoryboard(cleanSlug, resolvedBrief);
  }

  const langList =
    Array.isArray(languages) && languages.length > 0 ? languages : ["Bengali", "English", "Hindi"];
  const profiles = langList.map((l) => resolveLanguageProfile(l));
  const normalizedHooks = normalizeHookOverrides(hookOverrides);
  const brandTitle = String(resolvedBrief?.title || resolvedStoryboard?.title || cleanSlug).trim();

  const variantsDir = path.join(projectDir, ".studio", "variants");
  if (persist) {
    fs.mkdirSync(variantsDir, { recursive: true });
  }

  const variants = [];
  const abHookMatrix = [];

  for (const langProfile of profiles) {
    const languageSpecificHook = normalizedHooks.find((h) => h.language === langProfile.language);
    const universalHook = normalizedHooks.find((h) => h.language === null);
    const primaryHook = languageSpecificHook || universalHook || null;

    const sourceFrames = resolvedStoryboard.frames;
    const localizedFrames = sourceFrames.map((frame, idx) =>
      localizeShotForLanguage({
        frame,
        shotIndex: idx,
        totalShots: sourceFrames.length,
        langProfile,
        brandTitle,
        hookOverride: primaryHook,
      }),
    );

    const totalDurationSeconds = round2(
      localizedFrames.reduce((sum, f) => sum + Number(f.durationSeconds || 0), 0),
    );

    const variantId = `variant_${langProfile.langKey}`;
    const relPath = `.studio/variants/${variantId}.json`;
    const filePath = path.join(variantsDir, `${variantId}.json`);
    const url = `/media/${cleanSlug}/${relPath}`;

    const variantStoryboard = {
      schemaVersion: 1,
      slug: cleanSlug,
      variantId,
      language: langProfile.language,
      langKey: langProfile.langKey,
      locale: langProfile.locale,
      isoCode: langProfile.isoCode,
      costMode: COST_MODE,
      zeroCostGuard: true,
      requiresApiKey: false,
      ttsBackend: "edge-tts-neural",
      voiceId: langProfile.primaryVoice,
      captionStyleId: langProfile.captionStyleId,
      title: `${brandTitle} (${langProfile.language})`,
      aspectRatio: resolvedStoryboard.aspectRatio || resolvedBrief?.aspectRatio || "9:16",
      width: Number(resolvedStoryboard.width || resolvedBrief?.width || 1080),
      height: Number(resolvedStoryboard.height || resolvedBrief?.height || 1920),
      fps: Number(resolvedStoryboard.fps || resolvedBrief?.fps || 30),
      brandColors: resolvedStoryboard.brandColors || resolvedBrief?.brandColors || {},
      frameCount: localizedFrames.length,
      totalDurationSeconds,
      frames: localizedFrames,
      outputMp4RelPath: `output/${cleanSlug}_${langProfile.langKey}.mp4`,
      generatedAt: new Date().toISOString(),
    };

    if (persist) {
      fs.writeFileSync(filePath, JSON.stringify(variantStoryboard, null, 2) + "\n", "utf8");
    }

    const hookFrame = localizedFrames[0] || {};
    variants.push({
      id: variantId,
      language: langProfile.language,
      langKey: langProfile.langKey,
      locale: langProfile.locale,
      isoCode: langProfile.isoCode,
      costMode: COST_MODE,
      voiceId: langProfile.primaryVoice,
      alternateVoiceId: langProfile.alternateVoice,
      captionStyleId: langProfile.captionStyleId,
      fontStack: langProfile.fontStack,
      relPath,
      filePath,
      url,
      outputMp4RelPath: variantStoryboard.outputMp4RelPath,
      hookHeadline: hookFrame?.staging?.headline || "",
      ctaText: hookFrame?.staging?.ctaText || langProfile.ctaDefault,
      frameCount: localizedFrames.length,
      totalDurationSeconds,
      storyboard: variantStoryboard,
    });

    const candidateHooks = normalizedHooks.filter(
      (h) => !h.language || h.language === langProfile.language,
    );
    if (candidateHooks.length > 0) {
      for (const h of candidateHooks) {
        abHookMatrix.push({
          variantKey: `${langProfile.langKey}_${h.id}`,
          language: langProfile.language,
          langKey: langProfile.langKey,
          hookId: h.id,
          hookHeadline: h.headline || hookFrame?.staging?.headline || "",
          voiceId: langProfile.primaryVoice,
          costMode: COST_MODE,
        });
      }
    } else {
      abHookMatrix.push({
        variantKey: `${langProfile.langKey}_default`,
        language: langProfile.language,
        langKey: langProfile.langKey,
        hookId: "default",
        hookHeadline: hookFrame?.staging?.headline || "",
        voiceId: langProfile.primaryVoice,
        costMode: COST_MODE,
      });
    }
  }

  const indexRelPath = ".studio/variants/variants-index.json";
  const indexPayload = {
    ok: true,
    slug: cleanSlug,
    costMode: COST_MODE,
    zeroCostGuard: true,
    requiresApiKey: false,
    estimatedApiCostUsd: 0,
    languages: profiles.map((p) => p.language),
    variantCount: variants.length,
    variantsDirRelPath: ".studio/variants",
    indexRelPath,
    variants,
    abHookMatrix,
    generatedAt: new Date().toISOString(),
  };

  if (persist) {
    const indexSummary = {
      ...indexPayload,
      variants: variants.map(({ storyboard: _sb, ...meta }) => meta),
    };
    fs.writeFileSync(
      path.join(variantsDir, "variants-index.json"),
      JSON.stringify(indexSummary, null, 2) + "\n",
      "utf8",
    );
  }

  return indexPayload;
}

export function loadLocalizedAdVariants(slug, { projectsDir = PROJECTS_DIR } = {}) {
  const projectDir = resolveProjectDirectory(slug, projectsDir);
  const cleanSlug = path.basename(projectDir);
  const variantsDir = path.join(projectDir, ".studio", "variants");
  if (!fs.existsSync(variantsDir)) {
    return { ok: true, slug: cleanSlug, variants: [] };
  }

  const files = fs
    .readdirSync(variantsDir)
    .filter((f) => f.startsWith("variant_") && f.endsWith(".json"))
    .sort();

  const variants = files.map((filename) => {
    const filePath = path.join(variantsDir, filename);
    const storyboard = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const relPath = `.studio/variants/${filename}`;
    return {
      id: storyboard.variantId || path.basename(filename, ".json"),
      language: storyboard.language,
      langKey: storyboard.langKey,
      locale: storyboard.locale,
      voiceId: storyboard.voiceId,
      captionStyleId: storyboard.captionStyleId,
      relPath,
      filePath,
      url: `/media/${cleanSlug}/${relPath}`,
      frameCount: storyboard.frameCount,
      totalDurationSeconds: storyboard.totalDurationSeconds,
      storyboard,
    };
  });

  return {
    ok: true,
    slug: cleanSlug,
    costMode: COST_MODE,
    variantCount: variants.length,
    variants,
  };
}

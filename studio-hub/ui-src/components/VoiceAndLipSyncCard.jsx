import { useState, useEffect, useMemo, useCallback } from "react";
import { useStudio, Icons } from "../store.jsx";
import { api, resolveMediaUrl } from "../api.js";

const LANGUAGES = ["Bengali", "English", "Hindi"];

const FALLBACK_VOICES = {
  Bengali: [
    {
      id: "bn-BD-PradeepNeural",
      name: "Pradeep (Bangladesh)",
      gender: "Male",
      style: "Warm conversational",
      locale: "bn-BD",
    },
    {
      id: "bn-BD-NabanitaNeural",
      name: "Nabanita (Bangladesh)",
      gender: "Female",
      style: "Clear editorial",
      locale: "bn-BD",
    },
    {
      id: "bn-IN-BashkarNeural",
      name: "Bashkar (India)",
      gender: "Male",
      style: "Broadcast",
      locale: "bn-IN",
    },
    {
      id: "bn-IN-TanishaaNeural",
      name: "Tanishaa (India)",
      gender: "Female",
      style: "Bright commercial",
      locale: "bn-IN",
    },
  ],
  English: [
    {
      id: "en-US-ChristopherNeural",
      name: "Christopher (US)",
      gender: "Male",
      style: "Studio narrator",
      locale: "en-US",
    },
    {
      id: "en-US-AriaNeural",
      name: "Aria (US)",
      gender: "Female",
      style: "Crisp product launch",
      locale: "en-US",
    },
    {
      id: "en-GB-RyanNeural",
      name: "Ryan (UK)",
      gender: "Male",
      style: "Documentary",
      locale: "en-GB",
    },
    {
      id: "en-IN-NeerjaNeural",
      name: "Neerja (India)",
      gender: "Female",
      style: "Clear commercial",
      locale: "en-IN",
    },
  ],
  Hindi: [
    {
      id: "hi-IN-MadhurNeural",
      name: "Madhur (India)",
      gender: "Male",
      style: "Warm retail",
      locale: "hi-IN",
    },
    {
      id: "hi-IN-SwaraNeural",
      name: "Swara (India)",
      gender: "Female",
      style: "Expressive story",
      locale: "hi-IN",
    },
  ],
};

function inferInitialLanguage(projectLang) {
  const raw = String(projectLang || "")
    .trim()
    .toLowerCase();
  if (raw === "bn" || raw.startsWith("bn-") || raw.includes("bengali") || raw.includes("bangla")) {
    return "Bengali";
  }
  if (raw === "hi" || raw.startsWith("hi-") || raw.includes("hindi")) {
    return "Hindi";
  }
  return "English";
}

function normalizeVoiceListForLanguage(catalogPayload, language) {
  const target = String(language || "English").toLowerCase();
  const root =
    catalogPayload?.voices ||
    catalogPayload?.catalog ||
    catalogPayload?.VOICE_CATALOG ||
    catalogPayload;

  if (Array.isArray(root)) {
    const filtered = root.filter((item) => {
      const itemLang = String(item?.language || "").toLowerCase();
      const locale = String(item?.locale || item?.id || item?.voiceId || "").toLowerCase();
      if (itemLang === target) return true;
      if (target === "bengali" && locale.startsWith("bn-")) return true;
      if (target === "english" && locale.startsWith("en-")) return true;
      if (target === "hindi" && locale.startsWith("hi-")) return true;
      return false;
    });
    if (filtered.length > 0) {
      return filtered.map((v) => ({
        id: v.id || v.voiceId || v.shortName,
        name: v.name || v.label || v.id || v.voiceId,
        gender: v.gender || "",
        style: v.style || "",
        locale: v.locale || "",
      }));
    }
  } else if (root && typeof root === "object") {
    const matchedKey = Object.keys(root).find((k) => k.toLowerCase() === target);
    const list = matchedKey ? root[matchedKey] : null;
    if (Array.isArray(list) && list.length > 0) {
      return list.map((v) =>
        typeof v === "string"
          ? { id: v, name: v, gender: "", style: "", locale: "" }
          : {
              id: v.id || v.voiceId || v.shortName,
              name: v.name || v.label || v.id || v.voiceId,
              gender: v.gender || "",
              style: v.style || "",
              locale: v.locale || "",
            },
      );
    }
  }

  return FALLBACK_VOICES[language] || FALLBACK_VOICES.English;
}

export function VoiceAndLipSyncCard({ compact = false }) {
  const { activeSlug, project, storyboard, refreshAll, notify } = useStudio();

  const [mode, setMode] = useState("original-sync");
  const [language, setLanguage] = useState(() => inferInitialLanguage(project?.language));
  const [voiceCatalogRaw, setVoiceCatalogRaw] = useState(null);
  const [voiceId, setVoiceId] = useState("");
  const [selectedVideoRelPath, setSelectedVideoRelPath] = useState("");
  const [targetFrameId, setTargetFrameId] = useState("");
  const [syncLips, setSyncLips] = useState(true);
  const [scriptText, setScriptText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    setLanguage(inferInitialLanguage(project?.language));
  }, [project?.slug, project?.language]);

  const sourceVideos = useMemo(() => {
    const rawList = Array.isArray(project?.files?.rawVideo) ? project.files.rawVideo : [];
    const clipList = Array.isArray(project?.files?.clips)
      ? project.files.clips.filter(
          (c) =>
            !String(c?.name || "").startsWith("shot_frame_") &&
            !String(c?.name || "").startsWith("lipsync_"),
        )
      : [];
    const seen = new Set();
    const merged = [];
    for (const item of [...rawList, ...clipList]) {
      if (item?.relPath && !seen.has(item.relPath)) {
        seen.add(item.relPath);
        merged.push(item);
      }
    }
    return merged;
  }, [project?.files?.rawVideo, project?.files?.clips]);

  useEffect(() => {
    if (!selectedVideoRelPath && sourceVideos.length > 0) {
      setSelectedVideoRelPath(sourceVideos[0].relPath);
    }
  }, [sourceVideos, selectedVideoRelPath]);

  const frames = useMemo(
    () => (Array.isArray(storyboard?.frames) ? storyboard.frames : []),
    [storyboard?.frames],
  );

  const deriveDefaultScript = useCallback(
    (frameIdValue) => {
      if (frameIdValue) {
        const hit = frames.find((f) => f.id === frameIdValue);
        if (hit) {
          return hit.audioSpec?.voiceoverText || hit.staging?.captionText || hit.title || "";
        }
      }
      if (frames.length > 0) {
        const joined = frames
          .map((f) => f.audioSpec?.voiceoverText || f.staging?.captionText || "")
          .filter(Boolean)
          .join(" ");
        if (joined.trim()) return joined.trim();
      }
      return String(project?.instructions || "").trim();
    },
    [frames, project?.instructions],
  );

  useEffect(() => {
    setScriptText((prev) => (prev.trim() ? prev : deriveDefaultScript(targetFrameId)));
  }, [deriveDefaultScript, targetFrameId]);

  useEffect(() => {
    let cancelled = false;
    api(`/api/voices?lang=${encodeURIComponent(language)}`)
      .then((data) => {
        if (!cancelled) {
          setVoiceCatalogRaw(data);
        }
      })
      .catch(() => {
        // Keep local fallback voices when endpoint is offline
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const voicesForLanguage = useMemo(
    () => normalizeVoiceListForLanguage(voiceCatalogRaw, language),
    [voiceCatalogRaw, language],
  );

  useEffect(() => {
    if (!voicesForLanguage.some((v) => v.id === voiceId)) {
      setVoiceId(voicesForLanguage[0]?.id || "");
    }
  }, [voicesForLanguage, voiceId]);

  const handleTargetFrameChange = (nextFrameId) => {
    setTargetFrameId(nextFrameId);
    const nextDefault = deriveDefaultScript(nextFrameId);
    if (nextDefault) {
      setScriptText(nextDefault);
    }
  };

  const handleApplyVoiceSetup = async (event) => {
    event.preventDefault();
    if (!activeSlug || submitting) return;

    if (mode === "ai-voice-lipsync" && !scriptText.trim()) {
      setErrorMsg("Enter the voiceover script before generating AI voice.");
      return;
    }

    setErrorMsg("");
    setSubmitting(true);
    try {
      const payload = {
        mode,
        videoRelPath: selectedVideoRelPath || sourceVideos[0]?.relPath || null,
        frameId: targetFrameId || frames[0]?.id || null,
        language,
        voiceId: voiceId || voicesForLanguage[0]?.id || null,
        scriptText: scriptText.trim(),
        syncLips: Boolean(syncLips),
        trimSilence: true,
      };

      const res = await api(`/api/projects/${encodeURIComponent(activeSlug)}/voice-sync`, {
        method: "POST",
        body: payload,
      });

      setSyncResult(res);
      await refreshAll?.(activeSlug);
      notify?.(
        mode === "original-sync"
          ? "Synced scene cuts to original video speech."
          : `Generated ${language} AI voiceover${syncLips ? " with character lip-sync" : ""}.`,
        "success",
      );
    } catch (err) {
      setErrorMsg(err?.message || "Unable to apply voice setup. Check your source clip and retry.");
    } finally {
      setSubmitting(false);
    }
  };

  const wordCount = scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0;
  const previewAudioPath =
    syncResult?.audioUrl ||
    syncResult?.audioRelPath ||
    syncResult?.voiceoverRelPath ||
    syncResult?.originalAudioRelPath ||
    "";
  const previewAudioUrl = resolveMediaUrl(activeSlug, previewAudioPath, Date.now());
  const detectedSegments = Array.isArray(syncResult?.segments)
    ? syncResult.segments
    : Array.isArray(syncResult?.speechSegments)
      ? syncResult.speechSegments
      : [];

  const SparklesIcon = Icons.Sparkles || Icons.Wand || Icons.Play;

  return (
    <section
      className={`studio-card voice-lipsync-card ${compact ? "is-compact" : ""}`}
      aria-label="Voice and character lip-sync setup"
      style={{
        background: "var(--bg-surface, #FFFFFF)",
        borderRadius: "12px",
        padding: compact ? "14px" : "18px",
        boxShadow:
          "var(--shadow-border, 0px 0px 0px 1px oklch(0 0 0 / 0.06), 0px 1px 2px -1px oklch(0 0 0 / 0.06), 0px 2px 4px 0px oklch(0 0 0 / 0.04))",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
      {/* Header + Segmented Mode Switch */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: compact ? "14px" : "15px", fontWeight: 600 }}>
            Voice &amp; character lip-sync
          </h3>
          <p
            style={{
              margin: "2px 0 0 0",
              fontSize: "12px",
              color: "var(--text-secondary, #6E6D6A)",
            }}
          >
            Preserve your real spoken take with pause trimming or generate multilingual neural
            voice.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Voice source mode"
          style={{
            display: "inline-flex",
            flexWrap: "wrap",
            padding: "3px",
            borderRadius: "8px",
            background: "var(--bg-subtle, #F4F3EF)",
            border: "1px solid var(--border-divider, #EAEAEA)",
            gap: "2px",
          }}
        >
          {[
            { id: "original-sync", label: "Use original video voice (auto-sync)" },
            { id: "ai-voice-lipsync", label: "Generate AI voice" },
          ].map((item) => {
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setErrorMsg("");
                  setMode(item.id);
                }}
                style={{
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 11px",
                  fontSize: "12px",
                  fontWeight: active ? 600 : 500,
                  background: active ? "var(--bg-surface, #FFFFFF)" : "transparent",
                  color: active ? "var(--text-primary, #111111)" : "var(--text-secondary, #6E6D6A)",
                  boxShadow: active ? "var(--shadow-border)" : "none",
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <form
        onSubmit={handleApplyVoiceSetup}
        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
      >
        {/* Source Footage Row */}
        {sourceVideos.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label htmlFor="voice-source-video" style={{ fontSize: "12px", fontWeight: 500 }}>
                Source video clip
              </label>
              <select
                id="voice-source-video"
                value={selectedVideoRelPath}
                onChange={(e) => setSelectedVideoRelPath(e.target.value)}
                style={{
                  padding: "7px 10px",
                  fontSize: "12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-input, #DCDBD6)",
                  background: "var(--bg-surface, #FFFFFF)",
                  color: "var(--text-primary, #111111)",
                }}
              >
                {sourceVideos.map((vid) => (
                  <option key={vid.relPath} value={vid.relPath}>
                    {vid.name || vid.relPath}
                  </option>
                ))}
              </select>
            </div>

            {mode === "ai-voice-lipsync" && frames.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label htmlFor="voice-target-frame" style={{ fontSize: "12px", fontWeight: 500 }}>
                  Target scene
                </label>
                <select
                  id="voice-target-frame"
                  value={targetFrameId}
                  onChange={(e) => handleTargetFrameChange(e.target.value)}
                  style={{
                    padding: "7px 10px",
                    fontSize: "12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-input, #DCDBD6)",
                    background: "var(--bg-surface, #FFFFFF)",
                    color: "var(--text-primary, #111111)",
                  }}
                >
                  <option value="">Scene 01 / Primary narration</option>
                  {frames.map((fr) => (
                    <option key={fr.id} value={fr.id}>
                      Scene {String(fr.index || 1).padStart(2, "0")}: {fr.title || fr.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Mode A: Original Video Voice (Auto-Sync) */}
        {mode === "original-sync" && (
          <div
            style={{
              padding: "12px",
              borderRadius: "8px",
              background: "var(--bg-subtle, #F4F3EF)",
              border: "1px solid var(--border-divider, #EAEAEA)",
              fontSize: "12px",
              color: "var(--text-secondary, #6E6D6A)",
              lineHeight: 1.5,
            }}
          >
            Extracts clean spoken audio from your footage into{" "}
            <code>assets/audio/original_voice.mp3</code>, detects natural breath and silence gaps,
            and aligns scene cuts directly to the speaker&apos;s real sentences.
          </div>
        )}

        {/* Mode B: Generate Multilingual AI Voice + Character Lip-Sync */}
        {mode === "ai-voice-lipsync" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "12px",
                alignItems: "end",
              }}
            >
              {/* Language Pills */}
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                <span style={{ fontSize: "12px", fontWeight: 500 }}>Voice language</span>
                <div
                  role="group"
                  aria-label="Voice language"
                  style={{ display: "inline-flex", gap: "6px", flexWrap: "wrap" }}
                >
                  {LANGUAGES.map((lang) => {
                    const active = language === lang;
                    return (
                      <button
                        key={lang}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setLanguage(lang)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "9999px",
                          fontSize: "12px",
                          fontWeight: active ? 600 : 500,
                          border: active
                            ? "1px solid var(--cta-bg, #111111)"
                            : "1px solid var(--border-divider, #EAEAEA)",
                          background: active
                            ? "var(--cta-bg, #111111)"
                            : "var(--bg-subtle, #F4F3EF)",
                          color: active ? "var(--cta-fg, #FFFFFF)" : "var(--text-primary, #111111)",
                          cursor: "pointer",
                        }}
                      >
                        {lang}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Neural Voice Selector */}
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                <label htmlFor="neural-voice-select" style={{ fontSize: "12px", fontWeight: 500 }}>
                  Neural voice
                </label>
                <select
                  id="neural-voice-select"
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  style={{
                    padding: "7px 10px",
                    fontSize: "12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-input, #DCDBD6)",
                    background: "var(--bg-surface, #FFFFFF)",
                    color: "var(--text-primary, #111111)",
                  }}
                >
                  {voicesForLanguage.map((voice) => {
                    const details = [voice.gender, voice.style].filter(Boolean).join(" · ");
                    return (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                        {details ? ` (${details})` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Character Lip-Sync Toggle */}
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--text-primary, #111111)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={syncLips}
                onChange={(e) => setSyncLips(e.target.checked)}
              />
              <span>Sync character lips on camera</span>
              <span style={{ fontWeight: 400, color: "var(--text-muted, #787774)" }}>
                (aligns on-screen speaker cadence to generated syllable timing)
              </span>
            </label>

            {/* Script Preview & Editor */}
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <label htmlFor="voice-script-preview" style={{ fontSize: "12px", fontWeight: 500 }}>
                  Script preview
                </label>
                <span
                  style={{
                    fontSize: "11px",
                    fontFamily: 'var(--font-mono, "Geist Mono", "SF Mono", monospace)',
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--text-muted, #787774)",
                  }}
                >
                  {wordCount === 1 ? "1 word" : `${wordCount} words`}
                </span>
              </div>
              <textarea
                id="voice-script-preview"
                rows={3}
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                placeholder={
                  language === "Bengali"
                    ? "শীতের মৌসুমে পরিবহন খরচ ও পুরানো বীজের ক্ষতি এড়াতে আজই সরাসরি অর্ডার করুন।"
                    : language === "Hindi"
                      ? "इस सीज़न तेज़ डिलीवरी और प्रमाणित गुणवत्ता के साथ सीधे ऑर्डर करें।"
                      : "Order direct today with verified quality and zero transport loss."
                }
                style={{
                  padding: "8px 10px",
                  fontSize: "12px",
                  lineHeight: 1.5,
                  borderRadius: "8px",
                  border: "1px solid var(--border-input, #DCDBD6)",
                  background: "var(--bg-surface, #FFFFFF)",
                  color: "var(--text-primary, #111111)",
                  resize: "vertical",
                }}
              />
            </div>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            style={{
              padding: "8px 10px",
              borderRadius: "6px",
              fontSize: "12px",
              background: "var(--tag-red-bg, #FDEBEC)",
              color: "var(--tag-red-fg, #9F2F2D)",
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Submit Row */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !activeSlug}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              padding: "8px 14px",
              borderRadius: "6px",
              border: "1px solid var(--cta-bg, #111111)",
              background: "var(--cta-bg, #111111)",
              color: "var(--cta-fg, #FFFFFF)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            <SparklesIcon width={14} height={14} />
            <span>{submitting ? "Applying voice setup..." : "Apply voice setup"}</span>
          </button>

          {(syncResult?.characterDetection?.hasCharacter !== undefined ||
            syncResult?.faceDetection?.hasCharacter !== undefined ||
            syncResult?.lipSynced !== undefined) && (
            <span
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "9999px",
                background:
                  syncResult?.characterDetection?.hasCharacter ||
                  syncResult?.faceDetection?.hasCharacter ||
                  syncResult?.lipSynced
                    ? "var(--tag-green-bg, #EDF3EC)"
                    : "var(--bg-subtle, #F4F3EF)",
                color:
                  syncResult?.characterDetection?.hasCharacter ||
                  syncResult?.faceDetection?.hasCharacter ||
                  syncResult?.lipSynced
                    ? "var(--tag-green-fg, #346538)"
                    : "var(--text-secondary, #6E6D6A)",
              }}
            >
              {syncResult?.characterDetection?.hasCharacter ||
              syncResult?.faceDetection?.hasCharacter ||
              syncResult?.lipSynced
                ? "On-camera speaker detected & lip-synced"
                : "Voiceover synced (no close-up face detected)"}
            </span>
          )}
        </div>
      </form>

      {/* Output Audio / Speech Phrase Result Summary */}
      {(previewAudioUrl || detectedSegments.length > 0) && (
        <div
          style={{
            paddingTop: "10px",
            borderTop: "1px solid var(--border-divider, #EAEAEA)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {previewAudioUrl && (
            <audio controls src={previewAudioUrl} style={{ width: "100%", height: "34px" }} />
          )}

          {detectedSegments.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
                fontSize: "11px",
                fontFamily: 'var(--font-mono, "Geist Mono", "SF Mono", monospace)',
                fontVariantNumeric: "tabular-nums",
                color: "var(--text-secondary, #6E6D6A)",
              }}
            >
              {detectedSegments.slice(0, 6).map((seg, idx) => (
                <span
                  key={idx}
                  style={{
                    padding: "2px 8px",
                    borderRadius: "9999px",
                    background: "var(--bg-subtle, #F4F3EF)",
                    border: "1px solid var(--border-divider, #EAEAEA)",
                  }}
                >
                  {Number(seg.startTime || 0).toFixed(1)}s–{Number(seg.endTime || 0).toFixed(1)}s
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

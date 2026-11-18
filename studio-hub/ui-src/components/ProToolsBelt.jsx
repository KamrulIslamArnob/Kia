import { useState, useMemo } from "react";
import { useStudio, Icons } from "../store.jsx";
import { api, resolveMediaUrl } from "../api.js";

function normalizeThumbnailItems(res, slug) {
  const rawList =
    (Array.isArray(res?.thumbnails) && res.thumbnails) ||
    (Array.isArray(res?.variants) && res.variants) ||
    (Array.isArray(res?.files) && res.files) ||
    [];

  if (rawList.length > 0) {
    return rawList.map((item, idx) => {
      const pathOrUrl =
        (typeof item === "string" ? item : null) ||
        item?.url ||
        item?.imageUrl ||
        item?.downloadUrl ||
        item?.relPath ||
        item?.outputRelPath ||
        item?.path ||
        "";
      const letter = ["A", "B", "C"][idx] || String(idx + 1);
      const label =
        (typeof item === "object" && (item?.label || item?.name || item?.title || item?.variant)) ||
        `Variant ${letter}`;
      return {
        id: (typeof item === "object" && item?.id) || `thumb_${idx}`,
        label: String(label),
        url: resolveMediaUrl(slug, pathOrUrl, Date.now()),
        filename: `${slug || "project"}_cover_${letter.toLowerCase()}.png`,
      };
    });
  }

  return [];
}

function normalizeSubtitleDownloads(res, slug) {
  const out = [];
  const bag = res?.files || res?.subtitles || res?.outputs || res?.urls || res;

  if (Array.isArray(bag)) {
    for (const entry of bag) {
      if (!entry) continue;
      const rawPath =
        (typeof entry === "string" ? entry : null) ||
        entry.url ||
        entry.downloadUrl ||
        entry.relPath ||
        entry.outputRelPath ||
        entry.path ||
        "";
      const extMatch = String(entry.format || rawPath).match(/(srt|vtt|ass)$/i);
      const fmt = (entry.format || (extMatch ? extMatch[1] : "srt")).toLowerCase();
      const url = resolveMediaUrl(slug, rawPath);
      if (url) {
        out.push({
          format: fmt,
          url,
          filename: entry.filename || `${slug || "subtitles"}.${fmt}`,
        });
      }
    }
    return out;
  }

  if (bag && typeof bag === "object") {
    for (const fmt of ["srt", "vtt", "ass"]) {
      const candidate = bag[fmt] || bag[`${fmt}Url`] || bag[`${fmt}RelPath`];
      if (!candidate) continue;
      const rawPath =
        typeof candidate === "string"
          ? candidate
          : candidate.url || candidate.downloadUrl || candidate.relPath || candidate.path || "";
      const url = resolveMediaUrl(slug, rawPath);
      if (url) {
        out.push({
          format: fmt,
          url,
          filename: `${slug || "subtitles"}.${fmt}`,
        });
      }
    }
  }

  return out;
}

function normalizeReframePlans(results) {
  const plans = [];
  for (const item of results) {
    const root = item?.plan || item;
    if (Array.isArray(root?.plans)) {
      for (const p of root.plans) {
        if (p) plans.push(p);
      }
      continue;
    }
    if (root && typeof root === "object") {
      plans.push(root);
    }
  }
  return plans;
}

function normalizeLocalizedVariants(res) {
  const raw =
    (Array.isArray(res?.variants) && res.variants) ||
    (Array.isArray(res?.plans) && res.plans) ||
    [];
  if (raw.length > 0) {
    return raw.map((v, idx) => ({
      language: String(v?.language || v?.lang || ["Bengali", "English", "Hindi"][idx] || "Variant"),
      relPath: String(v?.relPath || v?.variantRelPath || v?.outputRelPath || v?.path || ""),
      headline: String(
        v?.hookHeadline ||
          v?.headline ||
          v?.storyboard?.frames?.[0]?.staging?.headline ||
          v?.frames?.[0]?.staging?.headline ||
          v?.title ||
          "Localized storyboard ready",
      ),
      frameCount: Number(v?.frameCount || v?.storyboard?.frames?.length || v?.frames?.length || 0),
    }));
  }

  if (res?.variants && typeof res.variants === "object") {
    return Object.entries(res.variants).map(([lang, v]) => ({
      language: lang,
      relPath: String(v?.relPath || v?.path || ""),
      headline: String(v?.hookHeadline || v?.headline || "Localized storyboard ready"),
      frameCount: Number(v?.frameCount || v?.frames?.length || 0),
    }));
  }

  return [];
}

export function ProToolsBelt({ mode = "storyboard" }) {
  const { theme, activeSlug, project, storyboard, selectedSkills, refreshAll, notify } =
    useStudio();
  const isDark = theme === "dark";
  const imageOutline = isDark ? "1px solid oklch(1 0 0 / 0.1)" : "1px solid oklch(0 0 0 / 0.1)";

  const [busyAction, setBusyAction] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Storyboard mode results
  const [beatResult, setBeatResult] = useState(null);
  const [matteResult, setMatteResult] = useState(null);
  const [reframePlans, setReframePlans] = useState([]);
  const [selectedMatteFrameId, setSelectedMatteFrameId] = useState("");

  // Export mode results
  const [thumbnails, setThumbnails] = useState([]);
  const [subtitleFiles, setSubtitleFiles] = useState([]);
  const [localizedVariants, setLocalizedVariants] = useState([]);

  const frames = useMemo(
    () => (Array.isArray(storyboard?.frames) ? storyboard.frames : []),
    [storyboard?.frames],
  );

  const resolveCandidateFrameImage = () => {
    const targetFrame = frames.find((f) => f.id === selectedMatteFrameId) || frames[0] || null;
    if (targetFrame) {
      const kf = targetFrame.keyframes || {};
      const candidate =
        kf.peak || kf.start || targetFrame.designFramePath || targetFrame.aiBackgroundPlate || "";
      if (candidate) return { frameId: targetFrame.id, imagePath: candidate };
    }
    const fallbackImg =
      project?.files?.images?.[0]?.relPath || project?.files?.assetImages?.[0]?.relPath || "";
    return { frameId: frames[0]?.id || "frame_01", imagePath: fallbackImg };
  };

  const handleBeatQuantize = async () => {
    if (!activeSlug || busyAction) return;
    setBusyAction("beat");
    setErrorMsg("");
    try {
      const res = await api(`/api/projects/${encodeURIComponent(activeSlug)}/beat-quantize`, {
        method: "POST",
        body: { fps: Number(storyboard?.fps) || 30, maxSnapSec: 0.35 },
      });
      setBeatResult(res);
      await refreshAll?.(activeSlug);
      notify?.("Snapped unlocked scene cuts to detected audio beats.", "success");
    } catch (err) {
      setErrorMsg(
        err?.message || "Unable to snap cuts to audio beats. Ensure audio or raw footage exists.",
      );
    } finally {
      setBusyAction("");
    }
  };

  const handleSubjectMatte = async () => {
    if (!activeSlug || busyAction) return;
    setBusyAction("matte");
    setErrorMsg("");
    try {
      const { frameId, imagePath } = resolveCandidateFrameImage();
      const res = await api(`/api/projects/${encodeURIComponent(activeSlug)}/subject-matte`, {
        method: "POST",
        body: { frameId, imagePath },
      });
      setMatteResult(res);
      await refreshAll?.(activeSlug);
      notify?.("Extracted transparent speaker foreground matte.", "success");
    } catch (err) {
      setErrorMsg(
        err?.message ||
          "Unable to extract speaker matte. Generate design frames or upload a reference image first.",
      );
    } finally {
      setBusyAction("");
    }
  };

  const handleSmartReframe = async () => {
    if (!activeSlug || busyAction) return;
    setBusyAction("reframe");
    setErrorMsg("");
    try {
      const aspects = ["9:16", "16:9", "1:1"];
      const responses = await Promise.all(
        aspects.map((targetAspect) =>
          api(`/api/projects/${encodeURIComponent(activeSlug)}/smart-reframe`, {
            method: "POST",
            body: {
              targetAspect,
              sourceWidth: Number(storyboard?.width) || 1080,
              sourceHeight: Number(storyboard?.height) || 1920,
            },
          }).then((data) => ({ ...(data?.plan || data), targetAspect })),
        ),
      );
      setReframePlans(normalizeReframePlans(responses));
      notify?.("Computed smart reframe crop vectors for 9:16, 16:9, and 1:1.", "success");
    } catch (err) {
      setErrorMsg(err?.message || "Unable to preview smart reframe.");
    } finally {
      setBusyAction("");
    }
  };

  const handleGenerateThumbnails = async () => {
    if (!activeSlug || busyAction) return;
    setBusyAction("thumbnails");
    setErrorMsg("");
    try {
      const res = await api(`/api/projects/${encodeURIComponent(activeSlug)}/thumbnails-generate`, {
        method: "POST",
        body: {},
      });
      setThumbnails(normalizeThumbnailItems(res, activeSlug));
      await refreshAll?.(activeSlug);
      notify?.("Rendered 3 high-contrast cover thumbnails (A/B/C).", "success");
    } catch (err) {
      setErrorMsg(err?.message || "Unable to generate cover thumbnails.");
    } finally {
      setBusyAction("");
    }
  };

  const handleExportSubtitles = async () => {
    if (!activeSlug || busyAction) return;
    setBusyAction("subtitles");
    setErrorMsg("");
    try {
      const res = await api(`/api/projects/${encodeURIComponent(activeSlug)}/subtitles-export`, {
        method: "POST",
        body: { formats: ["srt", "vtt", "ass"] },
      });
      setSubtitleFiles(normalizeSubtitleDownloads(res, activeSlug));
      notify?.("Exported UTF-8 .srt, .vtt, and .ass subtitle files.", "success");
    } catch (err) {
      setErrorMsg(err?.message || "Unable to export subtitle files.");
    } finally {
      setBusyAction("");
    }
  };

  const handleLocalizedVariants = async () => {
    if (!activeSlug || busyAction) return;
    setBusyAction("variants");
    setErrorMsg("");
    try {
      const res = await api(`/api/projects/${encodeURIComponent(activeSlug)}/localized-variants`, {
        method: "POST",
        body: { languages: ["Bengali", "English", "Hindi"] },
      });
      setLocalizedVariants(normalizeLocalizedVariants(res));
      notify?.("Built Bengali, English, and Hindi ad variant plans.", "success");
    } catch (err) {
      setErrorMsg(err?.message || "Unable to build localized ad variant plans.");
    } finally {
      setBusyAction("");
    }
  };

  const handleExportSkillBundle = async () => {
    if (busyAction) return;
    setBusyAction("skill-export");
    setErrorMsg("");
    try {
      const res = await api("/api/skill-bundles/export", {
        method: "POST",
        body: {
          skillIds: Array.isArray(selectedSkills) ? selectedSkills : [],
          slug: activeSlug || null,
        },
      });
      const bundleObj = res?.bundle || res;
      const blob = new Blob([JSON.stringify(bundleObj, null, 2)], {
        type: "application/json",
      });
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `${activeSlug || "studio"}.studioskills.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      notify?.("Exported portable .studioskills.json bundle.", "success");
    } catch (err) {
      setErrorMsg(err?.message || "Unable to export skill bundle.");
    } finally {
      setBusyAction("");
    }
  };

  const mattePreviewUrl = resolveMediaUrl(
    activeSlug,
    matteResult?.matteUrl ||
      matteResult?.url ||
      matteResult?.outRelPath ||
      matteResult?.matteRelPath ||
      matteResult?.relPath,
    Date.now(),
  );

  const summaryLabel =
    mode === "export"
      ? "Pro delivery tools — Cover thumbnails, subtitle files (.srt · .vtt · .ass) & localized variants"
      : "Pro storyboard tools — Beat snap, speaker foreground matte & multi-format smart reframe";

  return (
    <details
      className={`studio-card studio-disclosure pro-tools-belt is-${mode}`}
      style={{
        background: "var(--bg-surface, #FFFFFF)",
        borderRadius: "12px",
        padding: "12px 16px",
        boxShadow:
          "var(--shadow-border, 0px 0px 0px 1px oklch(0 0 0 / 0.06), 0px 1px 2px -1px oklch(0 0 0 / 0.06), 0px 2px 4px 0px oklch(0 0 0 / 0.04))",
      }}
    >
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          cursor: "pointer",
          listStyle: "none",
          fontSize: "13px",
          fontWeight: 600,
          color: "var(--text-primary, #111111)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
          <Icons.Sliders width={15} height={15} />
          <span>{summaryLabel}</span>
        </span>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 500,
            color: "var(--text-muted, #787774)",
          }}
        >
          Optional power tools
        </span>
      </summary>

      <div
        style={{
          marginTop: "14px",
          paddingTop: "14px",
          borderTop: "1px solid var(--border-divider, #EAEAEA)",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
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

        {/* MODE 1: STORYBOARD POWER TOOLS */}
        {mode === "storyboard" && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
              <button
                type="button"
                disabled={Boolean(busyAction) || !activeSlug}
                onClick={handleBeatQuantize}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-divider, #EAEAEA)",
                  background: "var(--bg-subtle, #F4F3EF)",
                  color: "var(--text-primary, #111111)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: busyAction ? "wait" : "pointer",
                }}
              >
                <Icons.Refresh width={13} height={13} />
                <span>
                  {busyAction === "beat"
                    ? "Snapping cuts to beats..."
                    : "Snap scene cuts to audio beats"}
                </span>
              </button>

              {frames.length > 0 && (
                <select
                  aria-label="Target scene for foreground matte"
                  value={selectedMatteFrameId}
                  onChange={(e) => setSelectedMatteFrameId(e.target.value)}
                  style={{
                    padding: "7px 9px",
                    fontSize: "12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-input, #DCDBD6)",
                    background: "var(--bg-surface, #FFFFFF)",
                    color: "var(--text-primary, #111111)",
                  }}
                >
                  {frames.map((fr) => (
                    <option key={fr.id} value={fr.id}>
                      Scene {String(fr.index || 1).padStart(2, "0")}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                disabled={Boolean(busyAction) || !activeSlug}
                onClick={handleSubjectMatte}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-divider, #EAEAEA)",
                  background: "var(--bg-subtle, #F4F3EF)",
                  color: "var(--text-primary, #111111)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: busyAction ? "wait" : "pointer",
                }}
              >
                <Icons.Layers width={13} height={13} />
                <span>
                  {busyAction === "matte"
                    ? "Extracting speaker matte..."
                    : "Extract speaker foreground matte"}
                </span>
              </button>

              <button
                type="button"
                disabled={Boolean(busyAction) || !activeSlug}
                onClick={handleSmartReframe}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-divider, #EAEAEA)",
                  background: "var(--bg-subtle, #F4F3EF)",
                  color: "var(--text-primary, #111111)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: busyAction ? "wait" : "pointer",
                }}
              >
                <Icons.BoxSelect width={13} height={13} />
                <span>
                  {busyAction === "reframe"
                    ? "Computing reframes..."
                    : "Preview multi-format smart reframe (9:16 · 16:9 · 1:1)"}
                </span>
              </button>
            </div>

            {beatResult && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: "var(--tag-green-bg, #EDF3EC)",
                  color: "var(--tag-green-fg, #346538)",
                  fontSize: "12px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                Beat-quantized cuts aligned at {beatResult.fps || 30} fps
                {beatResult.bpm ? ` · ${Math.round(Number(beatResult.bpm))} BPM` : ""}
                {(beatResult.snappedCount ?? beatResult.snappedCutCount) !== undefined
                  ? ` · ${beatResult.snappedCount ?? beatResult.snappedCutCount} boundaries snapped`
                  : ""}
                .
              </div>
            )}

            {mattePreviewUrl && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "12px",
                  padding: "8px 12px 8px 8px",
                  borderRadius: "16px",
                  background: "var(--bg-subtle, #F4F3EF)",
                  border: "1px solid var(--border-divider, #EAEAEA)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <img
                    src={mattePreviewUrl}
                    alt="Extracted foreground speaker matte"
                    style={{
                      width: "56px",
                      height: "76px",
                      objectFit: "contain",
                      borderRadius: "8px",
                      background: "#161618",
                      outline: imageOutline,
                      outlineOffset: "-1px",
                    }}
                  />
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 600 }}>
                      RGBA foreground speaker cutout ready
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary, #6E6D6A)" }}>
                      Compatible with depth-text-behind-speaker 3-layer titles.
                    </div>
                  </div>
                </div>
                <a
                  href={mattePreviewUrl}
                  download={`${activeSlug || "project"}_speaker_matte.png`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-divider, #EAEAEA)",
                    background: "var(--bg-surface, #FFFFFF)",
                    color: "var(--text-primary, #111111)",
                    fontSize: "12px",
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  <Icons.Download width={12} height={12} />
                  <span>Download matte PNG</span>
                </a>
              </div>
            )}

            {reframePlans.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: "8px",
                }}
              >
                {reframePlans.map((plan, idx) => {
                  const aspect =
                    plan.targetAspect || plan.aspectRatio || ["9:16", "16:9", "1:1"][idx];
                  const shotList = plan.shots || plan.frames || [];
                  const firstShot = shotList[0] || plan;
                  const toPct = (val, fallback) => {
                    const n = Number(val);
                    return Number.isFinite(n) ? Math.round(n <= 1 ? n * 100 : n) : fallback;
                  };
                  return (
                    <div
                      key={`${aspect}_${idx}`}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--border-divider, #EAEAEA)",
                        background: "var(--bg-subtle, #F4F3EF)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        <span>Format {aspect}</span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontFamily: 'var(--font-mono, "Geist Mono", monospace)',
                            fontVariantNumeric: "tabular-nums",
                            color: "var(--text-secondary, #6E6D6A)",
                          }}
                        >
                          {plan.width && plan.height ? `${plan.width}×${plan.height}` : ""}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          fontFamily: 'var(--font-mono, "Geist Mono", monospace)',
                          fontVariantNumeric: "tabular-nums",
                          color: "var(--text-secondary, #6E6D6A)",
                        }}
                      >
                        Focus ({toPct(firstShot?.focusX, 50)}%, {toPct(firstShot?.focusY, 42)}%) ·{" "}
                        {Number(firstShot?.scale ?? 1).toFixed(2)}x
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* MODE 2: EXPORT & DELIVERY POWER TOOLS */}
        {mode === "export" && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
              <button
                type="button"
                disabled={Boolean(busyAction) || !activeSlug}
                onClick={handleGenerateThumbnails}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--cta-bg, #111111)",
                  background: "var(--cta-bg, #111111)",
                  color: "var(--cta-fg, #FFFFFF)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: busyAction ? "wait" : "pointer",
                }}
              >
                <Icons.Layers width={13} height={13} />
                <span>
                  {busyAction === "thumbnails"
                    ? "Rendering 3 cover thumbnails..."
                    : "Generate 3 cover thumbnails (A/B/C)"}
                </span>
              </button>

              <button
                type="button"
                disabled={Boolean(busyAction) || !activeSlug}
                onClick={handleExportSubtitles}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-divider, #EAEAEA)",
                  background: "var(--bg-subtle, #F4F3EF)",
                  color: "var(--text-primary, #111111)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: busyAction ? "wait" : "pointer",
                }}
              >
                <Icons.Download width={13} height={13} />
                <span>
                  {busyAction === "subtitles"
                    ? "Exporting subtitles..."
                    : "Export subtitle files (.srt · .vtt · .ass)"}
                </span>
              </button>

              <button
                type="button"
                disabled={Boolean(busyAction) || !activeSlug}
                onClick={handleLocalizedVariants}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-divider, #EAEAEA)",
                  background: "var(--bg-subtle, #F4F3EF)",
                  color: "var(--text-primary, #111111)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: busyAction ? "wait" : "pointer",
                }}
              >
                <Icons.Sparkles width={13} height={13} />
                <span>
                  {busyAction === "variants"
                    ? "Building localized plans..."
                    : "Generate Bengali / English / Hindi ad variant plans"}
                </span>
              </button>

              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={handleExportSkillBundle}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-divider, #EAEAEA)",
                  background: "var(--bg-surface, #FFFFFF)",
                  color: "var(--text-primary, #111111)",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: busyAction ? "wait" : "pointer",
                }}
              >
                <Icons.Download width={13} height={13} />
                <span>Export .studioskills bundle</span>
              </button>
            </div>

            {/* Cover Thumbnail A/B/C Gallery */}
            {thumbnails.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: "10px",
                }}
              >
                {thumbnails.map((thumb) => (
                  <div
                    key={thumb.id}
                    style={{
                      padding: "8px",
                      borderRadius: "16px",
                      background: "var(--bg-subtle, #F4F3EF)",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    {thumb.url && (
                      <img
                        src={thumb.url}
                        alt={thumb.label}
                        style={{
                          width: "100%",
                          height: "148px",
                          objectFit: "cover",
                          borderRadius: "8px",
                          outline: imageOutline,
                          outlineOffset: "-1px",
                        }}
                      />
                    )}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "6px",
                        paddingInline: "2px",
                      }}
                    >
                      <span style={{ fontSize: "12px", fontWeight: 600 }}>{thumb.label}</span>
                      {thumb.url && (
                        <a
                          href={thumb.url}
                          download={thumb.filename}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "var(--text-primary, #111111)",
                            textDecoration: "none",
                          }}
                        >
                          <Icons.Download width={12} height={12} />
                          <span>Download</span>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Subtitle Download Pills (.srt, .vtt, .ass) */}
            {subtitleFiles.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "12px", fontWeight: 600 }}>Subtitle downloads:</span>
                {subtitleFiles.map((sub) => (
                  <a
                    key={sub.format}
                    href={sub.url}
                    download={sub.filename}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "6px 11px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-subtle, #F4F3EF)",
                      color: "var(--text-primary, #111111)",
                      fontSize: "12px",
                      fontFamily: 'var(--font-mono, "Geist Mono", monospace)',
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    <Icons.Download width={12} height={12} />
                    <span>Download .{sub.format}</span>
                  </a>
                ))}
              </div>
            )}

            {/* Localized Bengali / English / Hindi Ad Variant Plans */}
            {localizedVariants.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: "8px",
                }}
              >
                {localizedVariants.map((variant, idx) => (
                  <div
                    key={`${variant.language}_${idx}`}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-subtle, #F4F3EF)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: "12px",
                        fontWeight: 600,
                      }}
                    >
                      <span>{variant.language}</span>
                      {variant.frameCount > 0 && (
                        <span
                          style={{
                            fontSize: "11px",
                            fontVariantNumeric: "tabular-nums",
                            color: "var(--text-muted, #787774)",
                          }}
                        >
                          {variant.frameCount} scenes
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-primary, #111111)" }}>
                      {variant.headline}
                    </div>
                    {variant.relPath && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontFamily: 'var(--font-mono, "Geist Mono", monospace)',
                          color: "var(--text-muted, #787774)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {variant.relPath}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}

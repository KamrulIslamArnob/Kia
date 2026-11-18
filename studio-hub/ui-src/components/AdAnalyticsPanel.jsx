import { useState, useEffect, useMemo, useCallback } from "react";
import { useStudio, Icons } from "../store.jsx";
import { api } from "../api.js";

function normalizeSafeZones(rawZones) {
  if (!rawZones) return [];
  if (Array.isArray(rawZones)) {
    return rawZones.map((item, idx) => {
      const passed =
        item?.passed !== undefined
          ? Boolean(item.passed)
          : String(item?.status || "pass").toLowerCase() === "pass" || Boolean(item?.ok);
      return {
        key: String(item?.id || item?.platform || `platform_${idx}`),
        platform: String(item?.platform || item?.name || "Platform"),
        passed,
        issues: Array.isArray(item?.issues)
          ? item.issues
          : item?.warning
            ? [String(item.warning)]
            : [],
        summary: String(
          item?.summary ||
            (passed ? "Right icon rail and bottom caption band clear" : "Check edge overlap"),
        ),
      };
    });
  }

  if (typeof rawZones === "object") {
    const knownOrder = [
      { keys: ["tiktok", "TikTok"], label: "TikTok" },
      {
        keys: ["instagramReels", "instagram-reels", "reels", "Instagram Reels"],
        label: "Instagram Reels",
      },
      {
        keys: ["youtubeShorts", "youtube-shorts", "shorts", "YouTube Shorts"],
        label: "YouTube Shorts",
      },
    ];
    const results = [];
    for (const def of knownOrder) {
      const matchKey = def.keys.find((k) => rawZones[k] !== undefined);
      if (!matchKey) continue;
      const val = rawZones[matchKey];
      if (typeof val === "boolean") {
        results.push({
          key: def.keys[0],
          platform: def.label,
          passed: val,
          issues: [],
          summary: val ? "Safe zones clear" : "Edge overlap detected",
        });
      } else if (val && typeof val === "object") {
        const passed =
          val.passed !== undefined
            ? Boolean(val.passed)
            : val.ok !== undefined
              ? Boolean(val.ok)
              : String(val.status || "pass").toLowerCase() === "pass";
        results.push({
          key: def.keys[0],
          platform: String(val.platform || def.label),
          passed,
          issues: Array.isArray(val.issues) ? val.issues : val.warning ? [String(val.warning)] : [],
          summary: String(
            val.summary ||
              (passed ? "Right icon rail and bottom caption band clear" : "Check edge overlap"),
          ),
        });
      }
    }
    return results;
  }

  return [];
}

function formatTimeRangeLabel(timeRange, startSec, endSec) {
  if (Array.isArray(timeRange) && timeRange.length >= 2) {
    return `${Number(timeRange[0]).toFixed(1)}s–${Number(timeRange[1]).toFixed(1)}s`;
  }
  if (typeof timeRange === "string" && timeRange.trim()) {
    return timeRange.trim();
  }
  if (startSec !== undefined && endSec !== undefined) {
    return `${Number(startSec).toFixed(1)}s–${Number(endSec).toFixed(1)}s`;
  }
  return "Mid-reel";
}

function getScoreBadgeColors(score) {
  const n = Number(score) || 0;
  if (n >= 82) {
    return { bg: "var(--tag-green-bg, #EDF3EC)", fg: "var(--tag-green-fg, #346538)" };
  }
  if (n >= 68) {
    return { bg: "var(--tag-yellow-bg, #FBF3DB)", fg: "var(--tag-yellow-fg, #956400)" };
  }
  return { bg: "var(--tag-red-bg, #FDEBEC)", fg: "var(--tag-red-fg, #9F2F2D)" };
}

export function AdAnalyticsPanel({ compact = false }) {
  const { theme, activeSlug, storyboard, regenerateShot, notify } = useStudio();
  const isDark = theme === "dark";

  const [analytics, setAnalytics] = useState(null);
  const [pmTip, setPmTip] = useState("");
  const [loading, setLoading] = useState(false);
  const [applyingKey, setApplyingKey] = useState("");
  const [activePointIdx, setActivePointIdx] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const frameCount = Array.isArray(storyboard?.frames) ? storyboard.frames.length : 0;
  const firstFrameId = storyboard?.frames?.[0]?.id || "frame_01";

  const fetchAnalytics = useCallback(
    async (method = "GET") => {
      if (!activeSlug) return null;
      setLoading(true);
      setErrorMsg("");
      try {
        const res = await api(`/api/projects/${encodeURIComponent(activeSlug)}/ad-analytics`, {
          method,
        });
        const report = res?.analytics || res?.report || res;
        if (report && typeof report === "object") {
          setAnalytics(report);
        }
        return report;
      } catch (err) {
        if (method === "POST") {
          setErrorMsg(
            err?.message || "Generate design frames first before running ad retention analytics.",
          );
        }
        return null;
      } finally {
        setLoading(false);
      }
    },
    [activeSlug],
  );

  useEffect(() => {
    if (!activeSlug || frameCount === 0) return;
    fetchAnalytics("GET");
  }, [activeSlug, frameCount, storyboard?.updatedAt, fetchAnalytics]);

  useEffect(() => {
    let cancelled = false;
    api("/api/pm-insights")
      .then((res) => {
        if (cancelled) return;
        const payload = res?.insights || res;
        const headline =
          payload?.topTip ||
          payload?.summary ||
          payload?.recommendations?.[0]?.title ||
          payload?.nextHorizonDifferentiators?.[0]?.title ||
          payload?.differentiators?.[0]?.title ||
          "";
        if (headline) setPmTip(String(headline));
      })
      .catch(() => {
        // Optional PM insights endpoint
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTestHookVariant = async (variant, idx) => {
    if (!variant?.prompt || applyingKey) return;
    const key = variant.id || `variant_${idx}`;
    setApplyingKey(key);
    setErrorMsg("");
    try {
      await regenerateShot?.(firstFrameId, {
        prompt: variant.prompt,
        motionPreset: variant.motionPreset || undefined,
        layout: variant.layout || undefined,
        overrides: variant.headline
          ? {
              title: variant.headline,
              staging: {
                headline: variant.headline,
                ...(variant.badgeText ? { badgeText: variant.badgeText } : {}),
              },
            }
          : undefined,
      });
      await fetchAnalytics("POST");
      notify?.(`Applied "${variant.name || variant.archetype || "hook"}" to Scene 01.`, "success");
    } catch (err) {
      setErrorMsg(err?.message || "Unable to apply hook variant to Scene 01.");
    } finally {
      setApplyingKey("");
    }
  };

  const handleApplyDropOffFix = async (risk, idx) => {
    if (!risk?.fixPrompt || applyingKey) return;
    const targetId =
      risk.frameId ||
      storyboard?.frames?.[Math.min(idx + 1, Math.max(0, frameCount - 1))]?.id ||
      firstFrameId;
    const key = `risk_${idx}`;
    setApplyingKey(key);
    try {
      await regenerateShot?.(targetId, { prompt: risk.fixPrompt });
      await fetchAnalytics("POST");
      notify?.("Applied retention pattern-interrupt fix.", "success");
    } catch (err) {
      setErrorMsg(err?.message || "Unable to apply drop-off fix.");
    } finally {
      setApplyingKey("");
    }
  };

  const curvePoints = useMemo(
    () => (Array.isArray(analytics?.retentionCurve) ? analytics.retentionCurve : []),
    [analytics?.retentionCurve],
  );
  const dropOffRisks = useMemo(
    () => (Array.isArray(analytics?.dropOffRisks) ? analytics.dropOffRisks : []),
    [analytics?.dropOffRisks],
  );
  const safeZones = useMemo(
    () => normalizeSafeZones(analytics?.platformSafeZones),
    [analytics?.platformSafeZones],
  );
  const hookVariants = useMemo(
    () => (Array.isArray(analytics?.hookVariants) ? analytics.hookVariants : []),
    [analytics?.hookVariants],
  );

  // SVG Retention Chart Geometry
  const chartGeom = useMemo(() => {
    const width = 640;
    const height = 156;
    const padLeft = 36;
    const padRight = 16;
    const padTop = 14;
    const padBottom = 26;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    if (curvePoints.length === 0) {
      return {
        width,
        height,
        padLeft,
        padRight,
        padTop,
        padBottom,
        plotW,
        plotH,
        coords: [],
        pathD: "",
        maxSec: 1,
      };
    }

    const maxSec = Math.max(
      1,
      ...curvePoints.map((pt, i) => (Number.isFinite(Number(pt.second)) ? Number(pt.second) : i)),
    );

    const coords = curvePoints.map((pt, i) => {
      const sec = Number.isFinite(Number(pt.second)) ? Number(pt.second) : i;
      const pct = Math.max(0, Math.min(100, Number(pt.retentionPct ?? 100)));
      const x = padLeft + (sec / maxSec) * plotW;
      const y = padTop + ((100 - pct) / 100) * plotH;
      return { x, y, sec, pct, event: pt.event || "", risk: pt.risk || null };
    });

    const pathD = coords
      .map((c, idx) => `${idx === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(" ");

    return {
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      plotW,
      plotH,
      coords,
      pathD,
      maxSec,
    };
  }, [curvePoints]);

  const hookBadge = getScoreBadgeColors(analytics?.thumbstopHookScore);
  const soundOffBadge = getScoreBadgeColors(analytics?.soundOffScore);
  const inspectedPt =
    activePointIdx !== null && chartGeom.coords[activePointIdx]
      ? chartGeom.coords[activePointIdx]
      : chartGeom.coords[0] || null;
  const SparklesIcon = Icons.Sparkles || Icons.Wand || Icons.Star;

  return (
    <section
      className={`studio-card ad-analytics-panel ${compact ? "is-compact" : ""}`}
      aria-label="Pre-publish ad creative and retention analytics"
      style={{
        background: "var(--bg-surface, #FFFFFF)",
        borderRadius: "12px",
        padding: compact ? "14px" : "18px",
        boxShadow:
          "var(--shadow-border, 0px 0px 0px 1px oklch(0 0 0 / 0.06), 0px 1px 2px -1px oklch(0 0 0 / 0.06), 0px 2px 4px 0px oklch(0 0 0 / 0.04))",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      {/* Header Row */}
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
            Ad creative &amp; retention analytics
          </h3>
          <p
            style={{
              margin: "2px 0 0 0",
              fontSize: "12px",
              color: "var(--text-secondary, #6E6D6A)",
            }}
          >
            {analytics?.verdict ||
              "Pre-publish 3s thumbstop hook score, second-by-second retention curve, muted legibility, and TikTok / Reels / Shorts safe zones."}
          </p>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading || !activeSlug}
          onClick={() => fetchAnalytics("POST")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "7px 12px",
            borderRadius: "6px",
            border: "1px solid var(--border-divider, #EAEAEA)",
            background: "var(--bg-surface, #FFFFFF)",
            color: "var(--text-primary, #111111)",
            fontSize: "12px",
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          <Icons.Refresh width={13} height={13} />
          <span>{loading ? "Analyzing creative..." : "Audit ad retention"}</span>
        </button>
      </div>

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

      {!analytics ? (
        <div
          style={{
            padding: "14px",
            borderRadius: "8px",
            background: "var(--bg-subtle, #F4F3EF)",
            border: "1px solid var(--border-divider, #EAEAEA)",
            fontSize: "12px",
            color: "var(--text-secondary, #6E6D6A)",
          }}
        >
          {frameCount === 0
            ? "Generate storyboard frames first to unlock 3s hook scoring, retention modeling, and A/B hook variants."
            : "Click Audit ad retention above to score your 3-second hook, muted legibility, and social safe zones."}
        </div>
      ) : (
        <>
          {/* KPI Score Cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "10px",
            }}
          >
            <div
              style={{
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid var(--border-divider, #EAEAEA)",
                background: "var(--bg-subtle, #F4F3EF)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <div>
                <div style={{ fontSize: "11px", color: "var(--text-muted, #787774)" }}>
                  3s Hook score
                </div>
                <div style={{ fontSize: "12px", fontWeight: 500, marginTop: "2px" }}>
                  Thumbstop energy
                </div>
              </div>
              <span
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  padding: "4px 10px",
                  borderRadius: "9999px",
                  background: hookBadge.bg,
                  color: hookBadge.fg,
                }}
              >
                {Math.round(Number(analytics.thumbstopHookScore ?? 0))}/100
              </span>
            </div>

            <div
              style={{
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid var(--border-divider, #EAEAEA)",
                background: "var(--bg-subtle, #F4F3EF)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <div>
                <div style={{ fontSize: "11px", color: "var(--text-muted, #787774)" }}>
                  Sound-off score
                </div>
                <div style={{ fontSize: "12px", fontWeight: 500, marginTop: "2px" }}>
                  Muted feed clarity
                </div>
              </div>
              <span
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  padding: "4px 10px",
                  borderRadius: "9999px",
                  background: soundOffBadge.bg,
                  color: soundOffBadge.fg,
                }}
              >
                {Math.round(Number(analytics.soundOffScore ?? 0))}/100
              </span>
            </div>

            <div
              style={{
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid var(--border-divider, #EAEAEA)",
                background: "var(--bg-subtle, #F4F3EF)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <div>
                <div style={{ fontSize: "11px", color: "var(--text-muted, #787774)" }}>
                  Drop-off risks
                </div>
                <div style={{ fontSize: "12px", fontWeight: 500, marginTop: "2px" }}>
                  Dwell decay windows
                </div>
              </div>
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  padding: "4px 10px",
                  borderRadius: "9999px",
                  background:
                    dropOffRisks.length === 0
                      ? "var(--tag-green-bg, #EDF3EC)"
                      : "var(--tag-yellow-bg, #FBF3DB)",
                  color:
                    dropOffRisks.length === 0
                      ? "var(--tag-green-fg, #346538)"
                      : "var(--tag-yellow-fg, #956400)",
                }}
              >
                {dropOffRisks.length === 0 ? "0 risks" : `${dropOffRisks.length} flagged`}
              </span>
            </div>
          </div>

          {/* Inline SVG Second-by-Second Retention Curve */}
          {chartGeom.coords.length > 0 && (
            <div
              style={{
                padding: "12px",
                borderRadius: "10px",
                border: "1px solid var(--border-divider, #EAEAEA)",
                background: "var(--bg-surface, #FFFFFF)",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <span style={{ fontSize: "12px", fontWeight: 600 }}>Estimated retention curve</span>
                {inspectedPt && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontFamily: 'var(--font-mono, "Geist Mono", "SF Mono", monospace)',
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--text-secondary, #6E6D6A)",
                    }}
                  >
                    {inspectedPt.sec}s · {Math.round(inspectedPt.pct)}% retained
                    {inspectedPt.event ? ` · ${inspectedPt.event}` : ""}
                  </span>
                )}
              </div>

              <svg
                viewBox={`0 0 ${chartGeom.width} ${chartGeom.height}`}
                role="img"
                aria-label="Second-by-second viewer retention curve"
                style={{ width: "100%", height: "auto", display: "block" }}
              >
                {/* Horizontal Reference Lines (100%, 75%, 50%) */}
                {[100, 75, 50].map((pct) => {
                  const y = chartGeom.padTop + ((100 - pct) / 100) * chartGeom.plotH;
                  return (
                    <g key={pct}>
                      <line
                        x1={chartGeom.padLeft}
                        y1={y}
                        x2={chartGeom.width - chartGeom.padRight}
                        y2={y}
                        stroke={isDark ? "#26262A" : "#EAEAEA"}
                        strokeWidth="1"
                      />
                      <text
                        x={chartGeom.padLeft - 6}
                        y={y + 3}
                        textAnchor="end"
                        fontSize="10"
                        fill={isDark ? "#7D7D86" : "#787774"}
                        fontFamily='"Geist Mono", monospace'
                      >
                        {pct}%
                      </text>
                    </g>
                  );
                })}

                {/* Highlighted Drop-Off Risk Windows */}
                {chartGeom.coords.map((c, idx) => {
                  if (c.risk !== "high" && c.risk !== "medium") return null;
                  const stepW = Math.max(8, chartGeom.plotW / Math.max(1, chartGeom.maxSec));
                  return (
                    <rect
                      key={`risk_band_${idx}`}
                      x={Math.max(chartGeom.padLeft, c.x - stepW * 0.5)}
                      y={chartGeom.padTop}
                      width={stepW}
                      height={chartGeom.plotH}
                      fill={isDark ? "oklch(0.32 0.08 25 / 0.45)" : "#FDEBEC"}
                    />
                  );
                })}

                {/* Crisp Retention Polyline */}
                <path
                  d={chartGeom.pathD}
                  fill="none"
                  stroke={isDark ? "#F4F4F5" : "#111111"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Interactive Second Data Dots */}
                {chartGeom.coords.map((c, idx) => {
                  const isRisky = c.risk === "high" || c.risk === "medium";
                  return (
                    <circle
                      key={`pt_${idx}`}
                      cx={c.x}
                      cy={c.y}
                      r={activePointIdx === idx ? 4.5 : isRisky ? 3.5 : 2.5}
                      fill={isRisky ? "#E03E3E" : isDark ? "#F4F4F5" : "#111111"}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => setActivePointIdx(idx)}
                    />
                  );
                })}

                {/* Start and End X-Axis Time Labels */}
                <text
                  x={chartGeom.padLeft}
                  y={chartGeom.height - 6}
                  fontSize="10"
                  fill={isDark ? "#7D7D86" : "#787774"}
                  fontFamily='"Geist Mono", monospace'
                >
                  0s
                </text>
                <text
                  x={chartGeom.width - chartGeom.padRight}
                  y={chartGeom.height - 6}
                  textAnchor="end"
                  fontSize="10"
                  fill={isDark ? "#7D7D86" : "#787774"}
                  fontFamily='"Geist Mono", monospace'
                >
                  {chartGeom.maxSec}s
                </text>
              </svg>

              {/* Drop-Off Risk Fix Items */}
              {dropOffRisks.length > 0 && (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}
                >
                  {dropOffRisks.map((risk, idx) => {
                    const busy = applyingKey === `risk_${idx}`;
                    return (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          background: "var(--bg-subtle, #F4F3EF)",
                          border: "1px solid var(--border-divider, #EAEAEA)",
                          fontSize: "12px",
                        }}
                      >
                        <div>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono, "Geist Mono", monospace)',
                              fontWeight: 600,
                              marginRight: "8px",
                            }}
                          >
                            {formatTimeRangeLabel(risk.timeRange, risk.startSec, risk.endSec)}
                          </span>
                          <span style={{ color: "var(--text-secondary, #6E6D6A)" }}>
                            {risk.reason}
                          </span>
                        </div>
                        {risk.fixPrompt && (
                          <button
                            type="button"
                            disabled={Boolean(applyingKey)}
                            onClick={() => handleApplyDropOffFix(risk, idx)}
                            style={{
                              padding: "5px 10px",
                              borderRadius: "6px",
                              border: "1px solid var(--border-divider, #EAEAEA)",
                              background: "var(--bg-surface, #FFFFFF)",
                              color: "var(--text-primary, #111111)",
                              fontSize: "11px",
                              fontWeight: 600,
                              cursor: applyingKey ? "wait" : "pointer",
                            }}
                          >
                            {busy ? "Applying..." : "Apply retention fix"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TikTok / Instagram Reels / YouTube Shorts Safe-Zone Checks */}
          {safeZones.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600 }}>
                TikTok, Instagram Reels &amp; YouTube Shorts safe zones
              </span>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                  gap: "8px",
                }}
              >
                {safeZones.map((zone) => (
                  <div
                    key={zone.key}
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
                        gap: "6px",
                      }}
                    >
                      <span style={{ fontSize: "12px", fontWeight: 600 }}>{zone.platform}</span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          padding: "2px 7px",
                          borderRadius: "9999px",
                          background: zone.passed
                            ? "var(--tag-green-bg, #EDF3EC)"
                            : "var(--tag-yellow-bg, #FBF3DB)",
                          color: zone.passed
                            ? "var(--tag-green-fg, #346538)"
                            : "var(--tag-yellow-fg, #956400)",
                        }}
                      >
                        {zone.passed ? "Pass" : "Warning"}
                      </span>
                    </div>
                    <span style={{ fontSize: "11px", color: "var(--text-secondary, #6E6D6A)" }}>
                      {zone.issues.length > 0 ? zone.issues[0] : zone.summary}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3 A/B Hook Variants with 1-Click Test on Scene 1 */}
          {hookVariants.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <span style={{ fontSize: "12px", fontWeight: 600 }}>
                  A/B opening hook variants for Scene 01
                </span>
                {pmTip && (
                  <span style={{ fontSize: "11px", color: "var(--text-muted, #787774)" }}>
                    {pmTip}
                  </span>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                  gap: "10px",
                }}
              >
                {hookVariants.map((variant, idx) => {
                  const key = variant.id || `variant_${idx}`;
                  const busy = applyingKey === key;
                  return (
                    <div
                      key={key}
                      style={{
                        padding: "12px",
                        borderRadius: "8px",
                        border: "1px solid var(--border-divider, #EAEAEA)",
                        background: "var(--bg-surface, #FFFFFF)",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: "10px",
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            color: "var(--text-muted, #787774)",
                          }}
                        >
                          {variant.archetype || variant.name || `Variant ${idx + 1}`}
                        </span>
                        <div style={{ fontSize: "13px", fontWeight: 600, lineHeight: 1.35 }}>
                          {variant.headline || variant.title || variant.name}
                        </div>
                        {variant.motionPreset && (
                          <span
                            style={{
                              fontSize: "11px",
                              fontFamily: 'var(--font-mono, "Geist Mono", monospace)',
                              color: "var(--text-secondary, #6E6D6A)",
                            }}
                          >
                            Camera: {variant.motionPreset}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={Boolean(applyingKey)}
                        onClick={() => handleTestHookVariant(variant, idx)}
                        style={{
                          alignSelf: "flex-start",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "7px 11px",
                          borderRadius: "6px",
                          border: "1px solid var(--cta-bg, #111111)",
                          background: "var(--cta-bg, #111111)",
                          color: "var(--cta-fg, #FFFFFF)",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: applyingKey ? "wait" : "pointer",
                        }}
                      >
                        <SparklesIcon width={12} height={12} />
                        <span>{busy ? "Testing on Scene 1..." : "Test this hook on Scene 1"}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

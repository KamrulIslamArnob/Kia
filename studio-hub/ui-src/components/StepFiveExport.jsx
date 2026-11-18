import { useState, useEffect, useRef, useMemo } from "react";
import { useStudio, Icons } from "../store.jsx";
import { resolveMediaUrl, formatBytes } from "../api.js";
import { AdAnalyticsPanel } from "./AdAnalyticsPanel.jsx";
import { ProToolsBelt } from "./ProToolsBelt.jsx";

const FORMAT_CHOICES = [
  { id: "9:16", label: "9:16 Vertical" },
  { id: "16:9", label: "16:9 Horizontal" },
  { id: "1:1", label: "1:1 Square" },
  { id: "4:5", label: "4:5 Portrait" },
];

const QUALITY_CHOICES = [
  { id: "draft", label: "Fast preview", sub: "Draft" },
  { id: "looks", label: "Standard crisp", sub: "Looks" },
  { id: "delivery", label: "Master high quality", sub: "Delivery" },
];

const RESOLUTION_CHOICES = ["720p", "1080p", "4K"];
const FPS_CHOICES = [24, 30, 60];

const CAPTION_CHOICES = [
  { id: "kinetic", label: "Animated" },
  { id: "rail", label: "Subtitles" },
  { id: "off", label: "Off" },
];

const FALLBACK_COLOR_LOOKS = [
  { id: "clean-commercial", name: "Clean Commercial" },
  { id: "kodak-2383-warm", name: "Kodak 2383 Warm" },
  { id: "emerald-vibrant", name: "Emerald Vibrant" },
  { id: "teal-orange-cinema", name: "Teal & Orange Cinema" },
  { id: "apple-keynote-crisp", name: "Apple Keynote Crisp" },
  { id: "matte-editorial", name: "Matte Editorial" },
];

const COMPILER_STAGES = [
  { id: "slice-clips", label: "1. Trimming & speed-ramping clips" },
  { id: "audio-mix", label: "2. Mixing voiceover & music" },
  { id: "build-compositions", label: "3. Animating scenes" },
  { id: "validate", label: "4. Quality & contrast check" },
  { id: "render", label: "5. Exporting MP4" },
];

function resolveStageOrder(stageName) {
  if (!stageName) return -1;
  const clean = String(stageName).toLowerCase();
  if (clean === "done" || clean === "complete") return COMPILER_STAGES.length;
  if (clean.includes("slice")) return 0;
  if (clean.includes("audio")) return 1;
  if (clean.includes("comp") || clean.includes("scene")) return 2;
  if (clean.includes("valid") || clean.includes("check") || clean.includes("lint")) return 3;
  if (clean.includes("render") || clean.includes("export")) return 4;
  return 0;
}

export function StepFiveExport() {
  const {
    setStep,
    activeSlug,
    project,
    storyboard,
    catalog,
    jobs,
    compileProgress,
    busyMap,
    generateFullVideo,
    runHyperframesGate,
  } = useStudio();

  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [quality, setQuality] = useState("looks");
  const [resolution, setResolution] = useState("1080p");
  const [fps, setFps] = useState(30);
  const [captionsMode, setCaptionsMode] = useState("kinetic");
  const [colorLook, setColorLook] = useState("clean-commercial");
  const [includeVoiceover, setIncludeVoiceover] = useState(true);
  const [includeBgm, setIncludeBgm] = useState(true);
  const [selectedRenderPath, setSelectedRenderPath] = useState("");
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);

  const videoRef = useRef(null);
  const syncedSlugRef = useRef(null);

  useEffect(() => {
    if (!project) return;
    if (syncedSlugRef.current !== project.slug) {
      syncedSlugRef.current = project.slug;
      setAspectRatio(project.aspectRatio || "9:16");
      setFps(Number(project.fps) || 30);
      setSelectedRenderPath("");
    }
  }, [project]);

  const colorLookOptions = useMemo(() => {
    const raw = catalog?.colorLooks;
    return Array.isArray(raw) && raw.length > 0 ? raw : FALLBACK_COLOR_LOOKS;
  }, [catalog]);

  const activeCompileJob = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    return list.find((j) => j.action === "generate-video") || list[0] || null;
  }, [jobs]);

  const effectiveStatus = compileProgress?.status || activeCompileJob?.status || "idle";
  const effectiveStage = compileProgress?.stage || activeCompileJob?.stage || null;
  const effectiveProgress = useMemo(() => {
    if (effectiveStatus === "done") return 100;
    const raw =
      typeof compileProgress?.progress === "number"
        ? compileProgress.progress
        : typeof activeCompileJob?.progress === "number"
          ? activeCompileJob.progress
          : 0;
    return Math.min(100, Math.max(0, Math.round(raw <= 1 ? raw * 100 : raw)));
  }, [compileProgress, activeCompileJob, effectiveStatus]);

  const stageOrder = resolveStageOrder(effectiveStage);

  const availableRenders = useMemo(() => {
    const fromManifest = Array.isArray(project?.files?.renders) ? project.files.renders : [];
    const list = [...fromManifest];
    const freshRel = compileProgress?.outputRelPath || activeCompileJob?.result?.outputRelPath;
    if (freshRel && !list.some((r) => r.relPath === freshRel)) {
      list.unshift({
        name: freshRel.split("/").pop() || freshRel,
        relPath: freshRel,
        url: resolveMediaUrl(activeSlug, freshRel),
      });
    }
    return list;
  }, [project, compileProgress, activeCompileJob, activeSlug]);

  useEffect(() => {
    const freshRel = compileProgress?.outputRelPath || activeCompileJob?.result?.outputRelPath;
    if (freshRel) {
      setSelectedRenderPath(freshRel);
      return;
    }
    if (
      availableRenders.length > 0 &&
      (!selectedRenderPath || !availableRenders.some((r) => r.relPath === selectedRenderPath))
    ) {
      setSelectedRenderPath(availableRenders[0].relPath);
    }
  }, [availableRenders, compileProgress, activeCompileJob, selectedRenderPath]);

  const activeRender = useMemo(
    () =>
      availableRenders.find((r) => r.relPath === selectedRenderPath) || availableRenders[0] || null,
    [availableRenders, selectedRenderPath],
  );

  const activeRenderUrl = activeRender
    ? resolveMediaUrl(
        activeSlug,
        activeRender.url || activeRender.relPath,
        activeRender.mtimeMs || "",
      )
    : "";

  const frames = useMemo(
    () => (Array.isArray(storyboard?.frames) ? storyboard.frames : []),
    [storyboard],
  );

  const sceneStartTimes = useMemo(() => {
    let cursor = 0;
    return frames.map((frame) => {
      const start = cursor;
      cursor += Math.max(0.5, Number(frame.durationSeconds) || 3.5);
      return start;
    });
  }, [frames]);

  const isGenerating = Boolean(busyMap?.generateFullVideo) || effectiveStatus === "running";
  const technicalLog =
    activeCompileJob?.output ||
    compileProgress?.output ||
    compileProgress?.message ||
    "No compiler log output yet.";

  async function handleStartCompile(event) {
    event.preventDefault();
    await generateFullVideo({
      aspectRatio,
      quality,
      resolution,
      fps: Number(fps) || 30,
      captionsMode,
      colorLook,
      includeVoiceover,
      includeBgm,
      renderVideo: true,
    });
  }

  function handleSeekToScene(index) {
    setActiveSceneIndex(index);
    const targetSec = sceneStartTimes[index] || 0;
    const vid = videoRef.current;
    if (vid) {
      try {
        vid.currentTime = targetSec;
        vid.play?.().catch(() => {});
      } catch {
        // Ignore seek before metadata loaded
      }
    }
  }

  return (
    <section className="step-container wide" aria-labelledby="step-five-heading">
      <header className="step-header">
        <div className="step-eyebrow">Step 5 of 5</div>
        <h1 id="step-five-heading" className="step-heading">
          Generate video
        </h1>
        <p className="step-subtitle">
          Choose your final export format, quality preset, captions, and audio mix, then render a
          verified MP4 locally.
        </p>
      </header>

      <div className="export-layout">
        {/* Left Column: Clean Export Configuration Card */}
        <form className="studio-card" onSubmit={handleStartCompile}>
          <div className="card-header">
            <div>
              <h2 className="card-title">Export settings</h2>
              <p className="card-desc">Rendered offline with HyperFrames and Headless Chrome.</p>
            </div>
          </div>

          <div className="field">
            <label htmlFor="export-format-select" className="field-label">
              Format
            </label>
            <select
              id="export-format-select"
              value={aspectRatio}
              onChange={(event) => setAspectRatio(event.target.value)}
            >
              {FORMAT_CHOICES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="field-label">Quality</span>
            <div className="stack-sm" role="radiogroup" aria-label="Render quality">
              {QUALITY_CHOICES.map((q) => {
                const active = quality === q.id;
                return (
                  <button
                    key={q.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={active ? "btn btn-primary" : "btn btn-secondary"}
                    style={{ justifyContent: "space-between", width: "100%" }}
                    onClick={() => setQuality(q.id)}
                  >
                    <span>{q.label}</span>
                    <span className="mono" style={{ fontSize: "11px", opacity: 0.78 }}>
                      {q.id}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="export-resolution-select" className="field-label">
                Resolution
              </label>
              <select
                id="export-resolution-select"
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
              >
                {RESOLUTION_CHOICES.map((res) => (
                  <option key={res} value={res}>
                    {res}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="export-fps-select" className="field-label">
                Frame rate
              </label>
              <select
                id="export-fps-select"
                value={fps}
                onChange={(event) => setFps(Number(event.target.value))}
              >
                {FPS_CHOICES.map((rate) => (
                  <option key={rate} value={rate}>
                    {`${rate} fps`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <span className="field-label">Captions</span>
            <div className="segmented-control" style={{ width: "100%" }}>
              {CAPTION_CHOICES.map((cap) => (
                <button
                  key={cap.id}
                  type="button"
                  style={{ flex: 1 }}
                  className={`seg-btn ${captionsMode === cap.id ? "active" : ""}`}
                  onClick={() => setCaptionsMode(cap.id)}
                >
                  {cap.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="export-color-look-select" className="field-label">
              Color look
            </label>
            <select
              id="export-color-look-select"
              value={colorLook}
              onChange={(event) => setColorLook(event.target.value)}
            >
              {colorLookOptions.map((look) => {
                const id = look.id || look.name;
                return (
                  <option key={id} value={id}>
                    {look.name || id}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="stack-sm">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={includeVoiceover}
                onChange={(event) => setIncludeVoiceover(event.target.checked)}
              />
              <span>Include neural voiceover narration</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={includeBgm}
                onChange={(event) => setIncludeBgm(event.target.checked)}
              />
              <span>Include ducked background music</span>
            </label>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg play-icon"
            style={{ width: "100%" }}
            disabled={isGenerating}
          >
            <Icons.Play size={15} filled />
            <span>{isGenerating ? "Generating video..." : "Generate video"}</span>
          </button>

          <div className="inline-wrap" style={{ justifyContent: "space-between" }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={Boolean(busyMap?.["gate:lint"])}
              onClick={() => runHyperframesGate("lint")}
            >
              Run static lint
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={Boolean(busyMap?.["gate:check"])}
              onClick={() => runHyperframesGate("check")}
            >
              Run browser check
            </button>
          </div>
        </form>

        {/* Right Column: Progress Checklist + Master Video Player */}
        <div className="stack-md" style={{ gap: "24px" }}>
          {/* 5-Stage Progress Checklist */}
          <div className="studio-card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Compilation checklist</h2>
                <p className="card-desc">
                  {effectiveStatus === "running"
                    ? compileProgress?.message || "Running 5-stage compiler..."
                    : effectiveStatus === "done"
                      ? "All five stages passed cleanly."
                      : effectiveStatus === "failed"
                        ? activeCompileJob?.error ||
                          compileProgress?.error ||
                          "Compilation stopped. Expand the technical log for details."
                        : "Ready to compile approved storyboard scenes into an MP4."}
                </p>
              </div>
              {(effectiveStatus === "running" || effectiveStatus === "done") && (
                <span
                  className={`tag-pill tabular ${effectiveStatus === "done" ? "green" : "yellow"}`}
                >
                  {`${effectiveProgress}%`}
                </span>
              )}
            </div>

            {(effectiveStatus === "running" || effectiveStatus === "done") && (
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${effectiveProgress}%` }} />
              </div>
            )}

            <div className="checklist">
              {COMPILER_STAGES.map((stageItem, idx) => {
                let stateClass = "";
                let badgeLabel = "Pending";

                if (effectiveStatus === "done") {
                  stateClass = "done";
                  badgeLabel = "Complete";
                } else if (effectiveStatus === "running") {
                  if (idx < stageOrder) {
                    stateClass = "done";
                    badgeLabel = "Complete";
                  } else if (idx === stageOrder) {
                    stateClass = "running";
                    badgeLabel = "In progress";
                  }
                } else if (effectiveStatus === "failed") {
                  if (idx < stageOrder) {
                    stateClass = "done";
                    badgeLabel = "Complete";
                  } else if (idx === Math.max(0, stageOrder)) {
                    stateClass = "failed";
                    badgeLabel = "Stopped";
                  }
                }

                return (
                  <div key={stageItem.id} className={`checklist-item ${stateClass}`}>
                    <span>{stageItem.label}</span>
                    <span className="inline-row" style={{ gap: "6px" }}>
                      {stateClass === "done" && <Icons.Check size={14} />}
                      <span className="tabular" style={{ fontSize: "12px" }}>
                        {badgeLabel}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>

            <details className="studio-disclosure">
              <summary>
                <span>Show technical log</span>
                <Icons.ChevronRight size={14} className="disclosure-chevron" />
              </summary>
              <div className="disclosure-body">
                <pre className="console-pre">{technicalLog}</pre>
              </div>
            </details>
          </div>

          {/* Master Video Player & Approved Frames Strip */}
          <div className="studio-card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Master video player</h2>
                <p className="card-desc">
                  {activeRender
                    ? [
                        activeRender.name,
                        activeRender.width && activeRender.height
                          ? `${activeRender.width} × ${activeRender.height}`
                          : null,
                        activeRender.duration
                          ? `${Number(activeRender.duration).toFixed(1)}s`
                          : null,
                        activeRender.sizeBytes ? formatBytes(activeRender.sizeBytes) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "Your rendered MP4 will appear here as soon as compilation finishes."}
                </p>
              </div>

              {activeRenderUrl && (
                <a
                  href={activeRenderUrl}
                  download={activeRender?.name || `${activeSlug || "video"}.mp4`}
                  className="btn btn-primary btn-sm btn-leading-icon"
                >
                  <Icons.Download size={14} />
                  <span>Download MP4</span>
                </a>
              )}
            </div>

            {availableRenders.length > 1 && (
              <div className="inline-wrap" role="tablist" aria-label="Rendered video versions">
                {availableRenders.map((item) => {
                  const active = item.relPath === activeRender?.relPath;
                  return (
                    <button
                      key={item.relPath}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`btn btn-sm ${active ? "btn-primary" : "btn-subtle"}`}
                      onClick={() => setSelectedRenderPath(item.relPath)}
                    >
                      {item.name}
                    </button>
                  );
                })}
              </div>
            )}

            {activeRenderUrl ? (
              <div className="concentric-card">
                <video
                  ref={videoRef}
                  key={activeRenderUrl}
                  controls
                  preload="metadata"
                  src={activeRenderUrl}
                  className="final-player-frame"
                />
              </div>
            ) : (
              <div className="empty-state">
                <div className="card-title">No MP4 rendered yet</div>
                <p className="card-desc">
                  Click Generate video on the left to compile your scenes, voiceover, and captions
                  into a finished MP4.
                </p>
              </div>
            )}

            {frames.length > 0 && (
              <div className="stack-sm">
                <div className="card-header">
                  <span className="field-label tabular">
                    {`Storyboard scenes (${frames.length})`}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(4)}>
                    Edit design frames
                  </button>
                </div>
                <div className="sync-strip">
                  {frames.map((frame, index) => {
                    const shotNum = String(frame.index || index + 1).padStart(2, "0");
                    const thumb = resolveMediaUrl(
                      activeSlug,
                      frame.designFrameUrl || frame.currentDesignImage,
                    );
                    return (
                      <button
                        key={frame.id}
                        type="button"
                        className={`sync-scene-btn ${activeSceneIndex === index ? "active" : ""}`}
                        onClick={() => handleSeekToScene(index)}
                      >
                        {thumb && <img src={thumb} alt={`Scene ${shotNum}`} loading="lazy" />}
                        <span className="tabular" style={{ fontSize: "11.5px", fontWeight: 600 }}>
                          {`Scene ${shotNum}`}
                        </span>
                        <span className="field-hint tabular" style={{ fontSize: "11px" }}>
                          {`${sceneStartTimes[index].toFixed(1)}s`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <AdAnalyticsPanel compact={true} />

      <ProToolsBelt mode="export" />

      <footer className="step-footer">
        <button
          type="button"
          className="btn btn-secondary btn-leading-icon"
          onClick={() => setStep(4)}
        >
          <Icons.ChevronLeft size={15} />
          <span>Back to design frames</span>
        </button>
      </footer>
    </section>
  );
}

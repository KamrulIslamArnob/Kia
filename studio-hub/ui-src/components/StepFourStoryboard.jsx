import { useState, useEffect, useRef, useMemo } from "react";
import { useStudio, Icons } from "../store.jsx";
import { resolveMediaUrl } from "../api.js";
import { FrameCanvasEditor } from "./FrameCanvasEditor.jsx";
import { SkillsAndRatingPanel } from "./SkillsAndRatingPanel.jsx";
import { SavedFramesDrawer } from "./SavedFramesDrawer.jsx";
import { WhiteboardCanvas } from "./WhiteboardCanvas.jsx";
import { AdAnalyticsPanel } from "./AdAnalyticsPanel.jsx";
import { ProToolsBelt } from "./ProToolsBelt.jsx";

const SCENE_COUNT_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12];

function resolveRawTriptych(slug, frame) {
  const rk = frame?.rawKeyframes;
  const kf = frame?.keyframes || {};

  if (Array.isArray(rk) && rk.length > 0) {
    return [
      { label: "Start", url: resolveMediaUrl(slug, rk[0]) },
      { label: "Peak", url: resolveMediaUrl(slug, rk[Math.min(1, rk.length - 1)]) },
      { label: "End", url: resolveMediaUrl(slug, rk[rk.length - 1]) },
    ].filter((entry) => Boolean(entry.url));
  }

  const src = rk && typeof rk === "object" ? rk : kf;
  return [
    { label: "Start", url: resolveMediaUrl(slug, src.start || kf.start) },
    { label: "Peak", url: resolveMediaUrl(slug, src.peak || kf.peak) },
    { label: "End", url: resolveMediaUrl(slug, src.end || kf.end) },
  ].filter((entry) => Boolean(entry.url));
}

function formatArchetypeShort(id) {
  if (!id) return "";
  return String(id)
    .split("-")
    .map((word, idx) =>
      idx === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word === "3d" ? "3D" : word,
    )
    .join(" ");
}

export function StepFourStoryboard({ onOpenSavedFrames }) {
  const {
    setStep,
    activeSlug,
    storyboard,
    savedFrames,
    videoRating,
    busyMap,
    generateStoryboardFrames,
    approveAllShots,
    updateShot,
    saveFrameBookmark,
    runVideoRating,
    editingFrameId,
    setEditingFrameId,
    setSavedFramesDrawerOpen,
  } = useStudio();

  const frames = useMemo(
    () => (Array.isArray(storyboard?.frames) ? storyboard.frames : []),
    [storyboard],
  );

  const [showHud, setShowHud] = useState(false);
  const [boardMode, setBoardMode] = useState("grid");
  const [sceneCount, setSceneCount] = useState(6);
  const [showSkillsPanel, setShowSkillsPanel] = useState(true);
  const [showAdAnalytics, setShowAdAnalytics] = useState(false);
  const [localEditingId, setLocalEditingId] = useState(null);
  const [localSavedOpen, setLocalSavedOpen] = useState(false);

  const skillsSectionRef = useRef(null);

  useEffect(() => {
    if (frames.length >= 4 && frames.length <= 12) {
      setSceneCount(frames.length);
    }
  }, [frames.length]);

  const activeEditId = editingFrameId !== undefined ? editingFrameId : localEditingId;
  const openEditorForFrame = (frameId) => {
    if (setEditingFrameId) setEditingFrameId(frameId);
    else setLocalEditingId(frameId);
  };
  const closeEditor = () => {
    if (setEditingFrameId) setEditingFrameId(null);
    else setLocalEditingId(null);
  };

  const editingFrame = useMemo(
    () => frames.find((f) => f.id === activeEditId) || null,
    [frames, activeEditId],
  );

  const frameTimecodes = useMemo(() => {
    let cursor = 0;
    return frames.map((frame) => {
      const dur = Math.max(0.5, Number(frame.durationSeconds) || 3.5);
      const start = cursor;
      const end = cursor + dur;
      cursor = end;
      return `${start.toFixed(1)}s–${end.toFixed(1)}s`;
    });
  }, [frames]);

  const savedCount = Array.isArray(savedFrames) ? savedFrames.length : 0;
  const lockedCount = frames.filter((f) => Boolean(f.locked || f.approved)).length;
  const generatingBusy = Boolean(busyMap?.storyboard);
  const approvingBusy = Boolean(busyMap?.approveAllShots);
  const ratingBusy = Boolean(busyMap?.videoRating);

  function handleOpenSavedVault() {
    if (onOpenSavedFrames) {
      onOpenSavedFrames();
    } else if (setSavedFramesDrawerOpen) {
      setSavedFramesDrawerOpen(true);
    } else {
      setLocalSavedOpen(true);
    }
  }

  async function handleRatingBadgeClick() {
    if (!showSkillsPanel) {
      setShowSkillsPanel(true);
    }
    requestAnimationFrame(() => {
      skillsSectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    });
    if (!videoRating && frames.length > 0 && !ratingBusy) {
      await runVideoRating();
    }
  }

  async function handleToggleFrameLock(event, frame) {
    event.stopPropagation();
    const nextLocked = !frame.locked;
    await updateShot(frame.id, {
      locked: nextLocked,
      approved: nextLocked,
    });
  }

  async function handleBookmarkFrame(event, frame) {
    event.stopPropagation();
    await saveFrameBookmark({
      frameId: frame.id,
      version: frame.currentVersion || 1,
      label: frame.staging?.headline || frame.title || `Scene ${frame.index}`,
    });
  }

  return (
    <section className="step-container wide" aria-labelledby="step-four-heading">
      <header className="step-header-row">
        <div className="step-header">
          <div className="step-eyebrow">Step 4 of 5</div>
          <h1 id="step-four-heading" className="step-heading">
            Design frames
          </h1>
          <p className="step-subtitle">
            Inspect 1080p scene plates, select or install local skills, audit your whole-video
            rating, or click any frame to draw and regenerate specific regions.
          </p>
        </div>

        <div className="inline-wrap">
          <button
            type="button"
            className={`btn btn-sm ${
              videoRating?.overallScore >= 85 ? "btn-secondary" : "btn-subtle"
            }`}
            disabled={ratingBusy}
            onClick={handleRatingBadgeClick}
          >
            <Icons.Star size={14} />
            <span className="tabular">
              {videoRating
                ? `Rating: ${videoRating.overallScore} · ${videoRating.grade}`
                : ratingBusy
                  ? "Rating frames..."
                  : "Rate frames"}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowSkillsPanel((prev) => !prev)}
          >
            <Icons.Sparkles size={14} />
            <span>{showSkillsPanel ? "Hide skills & rating" : "Show skills & rating"}</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowAdAnalytics((prev) => !prev)}
          >
            <Icons.TrendingUp size={14} />
            <span>{showAdAnalytics ? "Hide ad analytics" : "Ad analytics"}</span>
          </button>
        </div>
      </header>

      {/* Top Toolbar */}
      <div className="storyboard-toolbar" role="toolbar" aria-label="Storyboard frame controls">
        <div className="toolbar-group">
          <div className="segmented-control" role="tablist" aria-label="Storyboard workspace view">
            <button
              type="button"
              role="tab"
              aria-selected={boardMode === "grid"}
              className={`seg-btn ${boardMode === "grid" ? "active" : ""}`}
              onClick={() => setBoardMode("grid")}
            >
              <Icons.Layers size={13} />
              <span>Frames grid</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={boardMode === "whiteboard"}
              className={`seg-btn ${boardMode === "whiteboard" ? "active" : ""}`}
              onClick={() => setBoardMode("whiteboard")}
            >
              <Icons.Workflow size={13} />
              <span>Scene whiteboard</span>
            </button>
          </div>

          <div className="segmented-control" role="tablist" aria-label="Frame display mode">
            <button
              type="button"
              role="tab"
              aria-selected={!showHud}
              className={`seg-btn ${!showHud ? "active" : ""}`}
              onClick={() => setShowHud(false)}
            >
              Clean frame
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={showHud}
              className={`seg-btn ${showHud ? "active" : ""}`}
              onClick={() => setShowHud(true)}
            >
              Animation guide
            </button>
          </div>

          <div className="inline-row">
            <label htmlFor="storyboard-scene-count" className="field-hint">
              Scenes
            </label>
            <select
              id="storyboard-scene-count"
              value={sceneCount}
              style={{ width: "72px", paddingBlock: "5px" }}
              onChange={(event) => setSceneCount(Number(event.target.value))}
            >
              {SCENE_COUNT_OPTIONS.map((num) => (
                <option key={num} value={num}>
                  {num}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary btn-sm btn-leading-icon"
              disabled={generatingBusy}
              onClick={() =>
                generateStoryboardFrames({
                  targetScenes: sceneCount,
                  preserveLocked: true,
                })
              }
            >
              <Icons.Refresh size={13} />
              <span>
                {generatingBusy ? "Generating frames..." : "Generate / refresh unlocked frames"}
              </span>
            </button>
          </div>
        </div>

        <div className="toolbar-group">
          <button
            type="button"
            className="btn btn-secondary btn-sm btn-leading-icon"
            onClick={handleOpenSavedVault}
          >
            <Icons.Bookmark size={13} />
            <span className="tabular">{`Saved frames (${savedCount})`}</span>
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm btn-leading-icon"
            disabled={approvingBusy || frames.length === 0}
            onClick={() => approveAllShots({ locked: true, approved: true })}
          >
            <Icons.Check size={13} />
            <span className="tabular">
              {approvingBusy
                ? "Approving..."
                : lockedCount === frames.length && frames.length > 0
                  ? `All ${frames.length} approved`
                  : "Approve all frames"}
            </span>
          </button>
        </div>
      </div>

      {/* Collapsible Skills & Whole-Video Rating Panel */}
      {showSkillsPanel && (
        <div ref={skillsSectionRef}>
          <SkillsAndRatingPanel compact={false} />
        </div>
      )}

      {/* Pre-Publish Ad Creative & Retention Analytics */}
      {showAdAnalytics && <AdAnalyticsPanel compact={false} />}

      {/* Concentric Scene Grid or Spatial Scene Whiteboard */}
      {boardMode === "whiteboard" ? (
        <WhiteboardCanvas compact={false} onSceneCompiled={() => setBoardMode("grid")} />
      ) : frames.length === 0 ? (
        <div className="empty-state">
          <div className="card-title">No design frames generated yet</div>
          <p className="card-desc">
            Generate your initial storyboard frames from your raw footage, brand colors, and
            selected local skills.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-leading-icon"
            disabled={generatingBusy}
            onClick={() =>
              generateStoryboardFrames({
                targetScenes: sceneCount,
                preserveLocked: true,
              })
            }
          >
            <Icons.Sparkles size={15} />
            <span>{generatingBusy ? "Generating frames..." : "Generate design frames"}</span>
          </button>
        </div>
      ) : (
        <div className="storyboard-grid">
          {frames.map((frame, idx) => {
            const shotNum = String(frame.index || idx + 1).padStart(2, "0");
            const heroUrl = showHud
              ? frame.hudFrameUrl || frame.currentBlueprintImage || frame.designFrameUrl
              : frame.designFrameUrl || frame.currentDesignImage || frame.hudFrameUrl;
            const resolvedHero = resolveMediaUrl(activeSlug, heroUrl);
            const triptych = resolveRawTriptych(activeSlug, frame);
            const isLocked = Boolean(frame.locked || frame.approved);
            const isFrameBusy = Boolean(busyMap?.[`frame:${frame.id}`]);
            const motionLabel = frame.cameraMotion?.label || frame.motionPreset || "Dynamic camera";

            return (
              <article
                key={frame.id}
                className={`scene-card ${isLocked ? "locked" : ""} ${
                  activeEditId === frame.id ? "selected" : ""
                }`}
                onClick={() => openEditorForFrame(frame.id)}
              >
                <div className="scene-card-media">
                  {resolvedHero ? (
                    <img
                      src={resolvedHero}
                      alt={`Scene ${shotNum}: ${frame.title || "Design frame"}`}
                      loading="lazy"
                    />
                  ) : (
                    <span className="field-hint">
                      {isFrameBusy ? "Rendering 1080p frame..." : "Preview unavailable"}
                    </span>
                  )}

                  <div className="scene-card-badges">
                    <span className="scene-overlay-pill tabular">
                      {`Scene ${shotNum} · ${frameTimecodes[idx]}`}
                    </span>
                    <span className="inline-wrap" style={{ gap: "4px" }}>
                      <span className="scene-overlay-pill mono">{`v${frame.currentVersion || 1}`}</span>
                      {isLocked && <span className="tag-pill green">Approved</span>}
                    </span>
                  </div>
                </div>

                {triptych.length > 0 && (
                  <div className="raw-triptych" aria-label={`Scene ${shotNum} raw keyframes`}>
                    {triptych.map((kf) => (
                      <div key={kf.label} className="raw-triptych-cell">
                        <img src={kf.url} alt={`${kf.label} keyframe`} loading="lazy" />
                        <span className="raw-triptych-label">{kf.label}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="scene-card-body">
                  <div className="scene-card-header">
                    <h3 className="scene-card-title" title={frame.staging?.headline || frame.title}>
                      {frame.staging?.headline || frame.title || `Scene ${shotNum}`}
                    </h3>
                    <span className="tag-pill tabular">
                      {`${Number(frame.durationSeconds || 3.5).toFixed(1)}s${
                        frame.speedFactor && Number(frame.speedFactor) !== 1
                          ? ` · ${frame.speedFactor}x`
                          : ""
                      }`}
                    </span>
                  </div>

                  <div className="scene-card-meta">
                    {[motionLabel, formatArchetypeShort(frame.layout)].filter(Boolean).join(" · ")}
                  </div>

                  <div className="scene-card-actions">
                    <div className="inline-wrap" style={{ gap: "6px" }}>
                      <button
                        type="button"
                        className={`btn btn-sm btn-leading-icon ${
                          isLocked ? "btn-subtle" : "btn-secondary"
                        }`}
                        disabled={isFrameBusy}
                        onClick={(event) => handleToggleFrameLock(event, frame)}
                      >
                        <span className={`icon-swap ${isLocked ? "is-swapped" : ""}`}>
                          <span className="icon-swap-active">
                            <Icons.Lock size={13} />
                          </span>
                          <span className="icon-swap-inactive">
                            <Icons.Unlock size={13} />
                          </span>
                        </span>
                        <span>{isLocked ? "Locked" : "Approve"}</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-secondary btn-icon btn-sm"
                        title="Save frame to vault"
                        aria-label={`Save Scene ${shotNum} to vault`}
                        onClick={(event) => handleBookmarkFrame(event, frame)}
                      >
                        <Icons.Bookmark size={13} />
                      </button>
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary btn-sm btn-leading-icon"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditorForFrame(frame.id);
                      }}
                    >
                      <Icons.Brush size={13} />
                      <span>Edit / Draw on frame</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Interactive Draw-on-Frame Modal */}
      {editingFrame && (
        <FrameCanvasEditor
          frame={editingFrame}
          slug={activeSlug}
          showHud={showHud}
          onClose={closeEditor}
        />
      )}

      {/* Standalone fallback SavedFramesDrawer if StepFourStoryboard is rendered without App shell handler */}
      {!onOpenSavedFrames && !setSavedFramesDrawerOpen && (
        <SavedFramesDrawer open={localSavedOpen} onClose={() => setLocalSavedOpen(false)} />
      )}

      {/* Default-collapsed Wave 6 Storyboard Pro Tools Belt */}
      <ProToolsBelt mode="storyboard" />

      <footer className="step-footer">
        <button
          type="button"
          className="btn btn-secondary btn-leading-icon"
          onClick={() => setStep(3)}
        >
          <Icons.ChevronLeft size={15} />
          <span>Back to brand</span>
        </button>

        <div className="step-footer-trailing">
          <button
            type="button"
            className="btn btn-primary btn-trailing-icon"
            onClick={() => setStep(5)}
          >
            <span>Continue to generate video</span>
            <Icons.ChevronRight size={15} />
          </button>
        </div>
      </footer>
    </section>
  );
}

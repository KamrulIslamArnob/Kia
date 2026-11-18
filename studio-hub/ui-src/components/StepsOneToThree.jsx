import { useState, useEffect, useRef, useMemo } from "react";
import { useStudio, Icons } from "../store.jsx";
import { api, resolveMediaUrl, formatBytes, sanitizeExternalUrl } from "../api.js";
import { SkillsAndRatingPanel } from "./SkillsAndRatingPanel.jsx";
import { VoiceAndLipSyncCard } from "./VoiceAndLipSyncCard.jsx";
import { WhiteboardCanvas } from "./WhiteboardCanvas.jsx";

const FORMAT_OPTIONS = [
  { id: "9:16", label: "9:16 Vertical", dims: "1080 × 1920" },
  { id: "16:9", label: "16:9 Horizontal", dims: "1920 × 1080" },
  { id: "1:1", label: "1:1 Square", dims: "1080 × 1080" },
  { id: "4:5", label: "4:5 Portrait", dims: "1080 × 1350" },
];

const COLOR_SLOTS = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "accent", label: "Accent" },
  { key: "background", label: "Background" },
];

const LANGUAGE_OPTIONS = [
  "English",
  "Bengali (বাংলা)",
  "Hindi",
  "Spanish",
  "Chinese (Simplified)",
  "Arabic",
  "French",
  "German",
];

const TTS_VOICE_OPTIONS = [
  { id: "en-US-AriaNeural", label: "Aria · English (US)" },
  { id: "en-US-AndrewNeural", label: "Andrew · English (US)" },
  { id: "en-GB-SoniaNeural", label: "Sonia · English (UK)" },
  { id: "bn-BD-NabanitaNeural", label: "Nabanita · Bengali (BD)" },
  { id: "bn-BD-PradeepNeural", label: "Pradeep · Bengali (BD)" },
  { id: "hi-IN-SwaraNeural", label: "Swara · Hindi (IN)" },
  { id: "es-ES-ElviraNeural", label: "Elvira · Spanish (ES)" },
  { id: "zh-CN-XiaoxiaoNeural", label: "Xiaoxiao · Chinese (CN)" },
];

function formatDuration(sec) {
  const value = Number(sec);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 60) return `${value.toFixed(1)}s`;
  const mins = Math.floor(value / 60);
  const rem = Math.round(value % 60);
  return `${mins}:${String(rem).padStart(2, "0")}`;
}

function formatPacingLabel(pacing) {
  if (!pacing) return "Balanced editorial";
  const clean = String(pacing).toLowerCase();
  if (clean.includes("fast")) return "Fast kinetic";
  if (clean.includes("calm")) return "Calm cinematic";
  if (clean.includes("rhythmic")) return "Rhythmic editorial";
  return clean.charAt(0).toUpperCase() + clean.slice(1).replaceAll("-", " ");
}

function checkBusy(busyMap, ...keys) {
  if (!busyMap || typeof busyMap !== "object") return false;
  return keys.some((k) => Boolean(busyMap[k]));
}

/* ============================================================================
 * STEP 1 — RAW FOOTAGE
 * ========================================================================== */

export function StepOneRaw() {
  const {
    setStep,
    status,
    activeSlug,
    project,
    rawAnalysis,
    busyMap,
    importLooseFile,
    scanFolder,
    importScannedFolder,
    uploadFiles,
    ingestUrl,
    analyzeRaw,
    deleteProjectFile,
  } = useStudio();

  const [sourceTab, setSourceTab] = useState("upload");
  const [uploadPct, setUploadPct] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const [folderPath, setFolderPath] = useState("");
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [scanResult, setScanResult] = useState(null);
  const [selectedScanPaths, setSelectedScanPaths] = useState(() => new Set());

  const [videoUrl, setVideoUrl] = useState("");
  const [videoTitle, setVideoTitle] = useState("");

  const fileInputRef = useRef(null);

  const looseFiles = Array.isArray(status?.looseRootFiles) ? status.looseRootFiles : [];

  const rawClips = useMemo(() => {
    const directRaw = Array.isArray(project?.files?.rawVideo) ? project.files.rawVideo : [];
    const seenNames = new Set(directRaw.map((f) => f.name));
    const extraClips = (Array.isArray(project?.files?.clips) ? project.files.clips : []).filter(
      (f) => !seenNames.has(f.name) && !String(f.name || "").startsWith("shot_frame_"),
    );
    return [...directRaw, ...extraClips];
  }, [project]);

  const effectiveRawAnalysis = rawAnalysis || project?.rawAnalysis || null;
  const rawScenes = Array.isArray(effectiveRawAnalysis?.scenes) ? effectiveRawAnalysis.scenes : [];

  async function handlePickedFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    setUploadPct(0);
    try {
      await uploadFiles("raw-video", fileList, (pct) => {
        setUploadPct(pct);
      });
    } finally {
      setUploadPct(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleScanFolder(event, overridePath) {
    event?.preventDefault?.();
    const target = String(overridePath ?? folderPath).trim();
    if (!target) return;
    if (overridePath) setFolderPath(target);
    const res = await scanFolder(target, { recursive: includeSubfolders });
    const unpacked = res?.scan || res;
    if (unpacked && Array.isArray(unpacked.files)) {
      setScanResult(unpacked);
      const videoFiles = unpacked.files.filter((f) => f.mediaType === "video");
      const initialSelection = (videoFiles.length > 0 ? videoFiles : unpacked.files).map(
        (f) => f.relFromFolder || f.absPath || f.name,
      );
      setSelectedScanPaths(new Set(initialSelection));
    }
  }

  function toggleScanFile(key) {
    setSelectedScanPaths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleImportSelected() {
    const targetFolder = scanResult?.folderPath || folderPath.trim();
    if (!targetFolder || selectedScanPaths.size === 0) return;
    await importScannedFolder({
      folderPath: targetFolder,
      category: "raw-video",
      selectedFiles: Array.from(selectedScanPaths),
      recursive: includeSubfolders,
    });
  }

  async function handleIngestVideoLink(event) {
    event.preventDefault();
    const cleanUrl = videoUrl.trim();
    if (!cleanUrl) return;
    await ingestUrl({
      url: cleanUrl,
      category: "raw-video",
      title: videoTitle.trim(),
      download: true,
    });
    setVideoUrl("");
    setVideoTitle("");
  }

  const uploadingBusy = uploadPct !== null || checkBusy(busyMap, "uploadFiles", "upload:raw-video");
  const scanningBusy = checkBusy(busyMap, "scanFolder");
  const importingBusy = checkBusy(busyMap, "importScannedFolder");
  const urlBusy = checkBusy(busyMap, "ingestUrl");
  const analyzeBusy = checkBusy(busyMap, "analyzeRaw");

  return (
    <section
      className={sourceTab === "whiteboard" ? "step-container wide" : "step-container narrow"}
      aria-labelledby="step-one-heading"
    >
      <header className="step-header">
        <div className="step-eyebrow">Step 1 of 5</div>
        <h1 id="step-one-heading" className="step-heading">
          Raw footage
        </h1>
        <p className="step-subtitle">
          Add video clips from your computer, scan a local editing folder, or paste a video link.
          Source files on disk are copied without modification.
        </p>
      </header>

      {looseFiles.length > 0 && (
        <div className="stack-sm" role="region" aria-label="Workspace videos detected">
          {looseFiles.map((item) => {
            const name = typeof item === "string" ? item : item.name || item.filename;
            const bytes = typeof item === "object" ? item.sizeBytes || item.size : 0;
            return (
              <div key={name} className="loose-file-banner">
                <div className="inline-wrap">
                  <strong>Workspace video ready:</strong>
                  <span className="mono">{name}</span>
                  {bytes > 0 && <span className="tag-pill tabular">{formatBytes(bytes)}</span>}
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm btn-leading-icon"
                  onClick={() => importLooseFile(name, "raw-video", false)}
                >
                  <Icons.Plus size={13} />
                  <span>Use this video</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="studio-card">
        <div className="segmented-control" role="tablist" aria-label="Footage source">
          <button
            type="button"
            role="tab"
            aria-selected={sourceTab === "upload"}
            className={`seg-btn ${sourceTab === "upload" ? "active" : ""}`}
            onClick={() => setSourceTab("upload")}
          >
            <Icons.Upload size={14} />
            <span>Upload file</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceTab === "folder"}
            className={`seg-btn ${sourceTab === "folder" ? "active" : ""}`}
            onClick={() => setSourceTab("folder")}
          >
            <Icons.Folder size={14} />
            <span>Local folder path</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceTab === "link"}
            className={`seg-btn ${sourceTab === "link" ? "active" : ""}`}
            onClick={() => setSourceTab("link")}
          >
            <Icons.Link size={14} />
            <span>Video link</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceTab === "whiteboard"}
            className={`seg-btn ${sourceTab === "whiteboard" ? "active" : ""}`}
            onClick={() => setSourceTab("whiteboard")}
          >
            <Icons.Workflow size={14} />
            <span>Scene whiteboard</span>
          </button>
        </div>

        {sourceTab === "upload" && (
          <div className="stack-md">
            <div
              className={`dropzone ${isDragging ? "dragover" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                handlePickedFiles(event.dataTransfer?.files);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mp4,.mov,.mkv,.webm,.m4v"
                multiple
                hidden
                onChange={(event) => handlePickedFiles(event.target.files)}
              />
              <Icons.Upload size={22} />
              <div className="dropzone-title">Drop MP4, MOV, or WebM clips here</div>
              <div className="dropzone-sub">
                Copied into <code>projects/{activeSlug || "project"}/inbox/raw-video/</code> and
                probed locally with FFprobe.
              </div>
              <button
                type="button"
                className="btn btn-primary btn-leading-icon"
                disabled={uploadingBusy}
                onClick={(event) => {
                  event.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <Icons.Upload size={14} />
                <span>{uploadingBusy ? "Uploading..." : "Select video files"}</span>
              </button>
            </div>

            {uploadPct !== null && (
              <div className="upload-progress">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${uploadPct}%` }} />
                </div>
                <span className="progress-caption tabular">{`Uploading (${uploadPct}%)`}</span>
              </div>
            )}
          </div>
        )}

        {sourceTab === "folder" && (
          <div className="stack-md">
            <form className="stack-sm" onSubmit={handleScanFolder}>
              <label htmlFor="raw-folder-path-input" className="field-label">
                Windows or local folder path
              </label>
              <div className="inline-row">
                <input
                  id="raw-folder-path-input"
                  type="text"
                  className="mono"
                  placeholder="C:\Users\Kamru\AppData\Local\CapCut\Videos"
                  value={folderPath}
                  onChange={(event) => setFolderPath(event.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-leading-icon"
                  disabled={scanningBusy || !folderPath.trim()}
                >
                  <Icons.Folder size={14} />
                  <span>{scanningBusy ? "Scanning..." : "Scan folder"}</span>
                </button>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={includeSubfolders}
                  onChange={(event) => setIncludeSubfolders(event.target.checked)}
                />
                <span>Include subfolders when scanning</span>
              </label>
            </form>

            {Array.isArray(project?.sourceFolders) && project.sourceFolders.length > 0 && (
              <div className="inline-wrap">
                <span className="field-hint">Recent folders:</span>
                {project.sourceFolders.map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    className="btn btn-subtle btn-sm"
                    onClick={() => handleScanFolder(null, dir)}
                  >
                    <Icons.Folder size={13} />
                    <span className="mono">{dir}</span>
                  </button>
                ))}
              </div>
            )}

            {scanResult && Array.isArray(scanResult.files) && (
              <div className="stack-md">
                <div className="card-header">
                  <span className="field-label tabular">
                    {scanResult.files.length === 0
                      ? "No compatible media files found in this folder."
                      : `Found ${scanResult.counts?.video || 0} videos (${scanResult.files.length} total media files)`}
                  </span>
                  {scanResult.files.length > 0 && (
                    <div className="inline-wrap">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setSelectedScanPaths(
                            new Set(
                              scanResult.files
                                .filter((f) => f.mediaType === "video")
                                .map((f) => f.relFromFolder || f.absPath || f.name),
                            ),
                          )
                        }
                      >
                        Select all videos
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedScanPaths(new Set())}
                      >
                        Clear selection
                      </button>
                    </div>
                  )}
                </div>

                {scanResult.files.length > 0 && (
                  <>
                    <div className="scan-checklist">
                      {scanResult.files.map((file) => {
                        const key = file.relFromFolder || file.absPath || file.name;
                        const checked = selectedScanPaths.has(key);
                        return (
                          <label key={key} className="scan-row">
                            <span className="inline-row">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleScanFile(key)}
                              />
                              <span className="mono">{file.relFromFolder || file.name}</span>
                            </span>
                            <span className="inline-wrap">
                              <span className="tag-pill">{file.mediaType}</span>
                              <span className="tag-pill tabular">
                                {formatBytes(file.sizeBytes)}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="card-header">
                      <span className="field-hint tabular">
                        {selectedScanPaths.size === 1
                          ? "1 clip selected (original file stays untouched)"
                          : `${selectedScanPaths.size} clips selected (original files stay untouched)`}
                      </span>
                      <button
                        type="button"
                        className="btn btn-primary btn-leading-icon"
                        disabled={importingBusy || selectedScanPaths.size === 0}
                        onClick={handleImportSelected}
                      >
                        <Icons.Check size={14} />
                        <span>
                          {importingBusy ? "Importing clips..." : "Import selected clips"}
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {sourceTab === "link" && (
          <form className="stack-md" onSubmit={handleIngestVideoLink}>
            <div className="field">
              <label htmlFor="raw-video-url-input" className="field-label">
                Video link
              </label>
              <input
                id="raw-video-url-input"
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={videoUrl}
                onChange={(event) => setVideoUrl(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="raw-video-title-input" className="field-label">
                Clip label (optional)
              </label>
              <input
                id="raw-video-title-input"
                type="text"
                placeholder="Product walkthrough take 1"
                value={videoTitle}
                onChange={(event) => setVideoTitle(event.target.value)}
              />
            </div>
            <div className="inline-row">
              <button
                type="submit"
                className="btn btn-primary btn-leading-icon"
                disabled={urlBusy || !videoUrl.trim()}
              >
                <Icons.Download size={14} />
                <span>{urlBusy ? "Downloading video..." : "Import video link"}</span>
              </button>
            </div>
          </form>
        )}

        {sourceTab === "whiteboard" && (
          <WhiteboardCanvas compact={false} onSceneCompiled={() => setStep(4)} />
        )}
      </div>

      <div className="studio-card">
        <div className="card-header">
          <div>
            <h2 className="card-title tabular">
              {rawClips.length === 1 ? "1 uploaded clip" : `Uploaded clips (${rawClips.length})`}
            </h2>
            <p className="card-desc">
              Analyze scenes to extract keyframe moments before generating storyboard frames.
            </p>
          </div>
          {rawClips.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm btn-leading-icon"
              disabled={analyzeBusy}
              onClick={() => analyzeRaw({})}
            >
              <Icons.Sparkles size={13} />
              <span>{analyzeBusy ? "Analyzing..." : "Analyze scenes"}</span>
            </button>
          )}
        </div>

        {rawClips.length === 0 ? (
          <div className="empty-state">
            <div className="card-title">No raw clips added yet</div>
            <p className="card-desc">
              Upload a screen recording or camera take above, scan a local folder, or continue if
              building from brand graphics alone.
            </p>
          </div>
        ) : (
          <div className="clip-list">
            {rawClips.map((clip) => {
              const thumbSrc = resolveMediaUrl(activeSlug, clip.thumbnailUrl);
              const specs = [
                formatDuration(clip.duration),
                clip.width && clip.height ? `${clip.width} × ${clip.height}` : null,
                clip.fps ? `${Math.round(clip.fps)} fps` : null,
                formatBytes(clip.sizeBytes),
                clip.hasAudio ? "Audio" : "Muted",
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <div key={clip.relPath} className="clip-row">
                  <div className="clip-row-leading">
                    {thumbSrc ? (
                      <img src={thumbSrc} alt={clip.name} className="clip-thumb" loading="lazy" />
                    ) : (
                      <div
                        className="clip-thumb play-icon"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icons.Play size={16} />
                      </div>
                    )}
                    <div className="clip-meta">
                      <span className="clip-name" title={clip.name}>
                        {clip.name}
                      </span>
                      <span className="clip-specs tabular">{specs}</span>
                    </div>
                  </div>
                  <div className="clip-row-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm btn-leading-icon"
                      disabled={analyzeBusy}
                      onClick={() => analyzeRaw({ relPath: clip.relPath })}
                    >
                      <Icons.Sliders size={13} />
                      <span>Analyze scenes</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-leading-icon"
                      onClick={() => deleteProjectFile(clip.relPath)}
                    >
                      <Icons.Trash size={13} />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {rawScenes.length > 0 && (
          <div className="stack-sm">
            <div className="inline-wrap">
              <span className="tag-pill green tabular">
                {`Detected ${rawScenes.length} scenes`}
              </span>
              {effectiveRawAnalysis?.videoRelPath && (
                <span className="field-hint mono">{effectiveRawAnalysis.videoRelPath}</span>
              )}
            </div>
            <div className="style-frames-row">
              {rawScenes.map((sc, idx) => {
                const peakUrl = resolveMediaUrl(
                  activeSlug,
                  sc.keyframeUrls?.peak || sc.keyframes?.peak,
                );
                const sceneNum = String(sc.index || idx + 1).padStart(2, "0");
                return (
                  <div key={sceneNum} className="concentric-card">
                    {peakUrl && (
                      <div className="concentric-inner">
                        <img
                          src={peakUrl}
                          alt={`Scene ${sceneNum}`}
                          style={{
                            width: "100%",
                            height: "76px",
                            objectFit: "cover",
                            display: "block",
                          }}
                          loading="lazy"
                        />
                      </div>
                    )}
                    <div className="field-hint tabular" style={{ paddingInline: "2px" }}>
                      <strong>{`S${sceneNum}`}</strong>{" "}
                      {`${Number(sc.startTime || 0).toFixed(1)}s–${Number(sc.endTime || 0).toFixed(1)}s`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <footer className="step-footer">
        <span className="field-hint tabular">
          {rawClips.length > 0
            ? `${rawClips.length} ${rawClips.length === 1 ? "clip" : "clips"} ready`
            : "Optional when generating from brand assets"}
        </span>
        <div className="step-footer-trailing">
          <button
            type="button"
            className="btn btn-primary btn-trailing-icon"
            onClick={() => setStep(2)}
          >
            <span>Continue to inspiration</span>
            <Icons.ChevronRight size={15} />
          </button>
        </div>
      </footer>
    </section>
  );
}

/* ============================================================================
 * STEP 2 — INSPIRATION
 * ========================================================================== */

export function StepTwoInspiration() {
  const {
    setStep,
    activeSlug,
    project,
    busyMap,
    uploadFiles,
    ingestUrl,
    analyzeInspiration,
    deleteProjectFile,
    deleteReferenceLink,
    refreshAll,
    notify,
  } = useStudio();

  const [inspTab, setInspTab] = useState("upload");
  const [uploadPct, setUploadPct] = useState(null);
  const [refUrl, setRefUrl] = useState("");
  const [refNotes, setRefNotes] = useState("");
  const [downloadRefVideo, setDownloadRefVideo] = useState(false);
  const [localReaBreakdown, setLocalReaBreakdown] = useState(null);
  const [reaDecomposing, setReaDecomposing] = useState(false);
  const [applyingStyle, setApplyingStyle] = useState(false);

  const inspFileRef = useRef(null);

  useEffect(() => {
    setLocalReaBreakdown(null);
  }, [activeSlug]);

  const inspirationFiles = useMemo(() => {
    const a = Array.isArray(project?.files?.inspiration) ? project.files.inspiration : [];
    const b = Array.isArray(project?.files?.references) ? project.files.references : [];
    return [...a, ...b];
  }, [project]);

  const referenceLinks = Array.isArray(project?.referenceLinks) ? project.referenceLinks : [];
  const profile = project?.inspirationProfile || null;
  const reaBreakdown =
    localReaBreakdown ||
    profile?.reaBreakdown ||
    (profile?.engine === "rea-video" ? profile : null);

  async function handleUploadInspiration(files) {
    if (!files || files.length === 0) return;
    setUploadPct(0);
    try {
      await uploadFiles("inspiration", files, (pct) => setUploadPct(pct));
    } finally {
      setUploadPct(null);
      if (inspFileRef.current) inspFileRef.current.value = "";
    }
  }

  async function handleSaveRefLink(event) {
    event.preventDefault();
    const clean = refUrl.trim();
    if (!clean) return;
    await ingestUrl({
      url: clean,
      category: "inspiration",
      notes: refNotes.trim(),
      download: downloadRefVideo,
    });
    setRefUrl("");
    setRefNotes("");
  }

  async function handleReaDecompose(relPath) {
    if (!activeSlug || reaDecomposing) return;
    setReaDecomposing(true);
    try {
      const body = typeof relPath === "string" && relPath ? { relPath } : {};
      const res = await api(
        `/api/projects/${encodeURIComponent(activeSlug)}/inspiration/rea-decompose`,
        {
          method: "POST",
          body,
        },
      );
      const nextBreakdown = res.reaBreakdown || res.inspirationProfile?.reaBreakdown || null;
      if (nextBreakdown) {
        setLocalReaBreakdown(nextBreakdown);
      }
      await refreshAll?.(activeSlug);
      notify?.("Deep animation & style breakdown complete.", "success");
    } catch (err) {
      notify?.(err.message || "Unable to run deep animation breakdown.", "error");
    } finally {
      setReaDecomposing(false);
    }
  }

  async function handleApplyStyleToStoryboard() {
    if (!activeSlug || applyingStyle) return;
    setApplyingStyle(true);
    try {
      await api(`/api/projects/${encodeURIComponent(activeSlug)}/inspiration/apply-to-storyboard`, {
        method: "POST",
        body: { reaBreakdown: reaBreakdown || undefined },
      });
      await refreshAll?.(activeSlug);
      notify?.("Applied inspiration style to design frames.", "success");
      setStep(4);
    } catch (err) {
      notify?.(err.message || "Unable to apply inspiration style to frames.", "error");
    } finally {
      setApplyingStyle(false);
    }
  }

  const analyzeBusy = checkBusy(busyMap, "analyzeInspiration");
  const urlBusy = checkBusy(busyMap, "ingestUrl");

  const styleFrames = useMemo(() => {
    if (!profile) return [];
    const list =
      Array.isArray(profile.styleFrameUrls) && profile.styleFrameUrls.length > 0
        ? profile.styleFrameUrls
        : Array.isArray(profile.styleFrames)
          ? profile.styleFrames
          : [];
    return list.map((item) => resolveMediaUrl(activeSlug, item)).filter(Boolean);
  }, [profile, activeSlug]);

  const reaMetrics = useMemo(() => {
    if (!reaBreakdown) return null;
    const shotsList = Array.isArray(reaBreakdown.shots) ? reaBreakdown.shots : [];
    const shotCount = reaBreakdown.editingStyle?.shotCount ?? shotsList.length;
    const avgShotLength = Number(
      reaBreakdown.editingStyle?.avgShotLength ?? profile?.avgShotLength ?? 0,
    );
    const mix = reaBreakdown.productionMix || {};
    const codeMotionPct = Math.min(
      100,
      Math.max(0, Math.round(Number(mix.codeRenderPct || 0) + Number(mix.animationPct || 0))),
    );
    const bpmVal = Number(reaBreakdown.editingStyle?.bpm || 0);
    const pacingText = formatPacingLabel(reaBreakdown.editingStyle?.pacing || profile?.pacing);
    const bpmPacingLabel = bpmVal > 0 ? `${Math.round(bpmVal)} BPM · ${pacingText}` : pacingText;

    const packaging = reaBreakdown.animationPackaging || {};
    const recipe = reaBreakdown.remakeRecipe || {};

    const subtitleStyle =
      packaging.subtitleStyle ||
      recipe.recommendedCaptionStyle ||
      "Clean lower-third editorial subtitles";

    const rawPatterns = packaging.motionPatterns;
    let cameraMovesText = "";
    if (Array.isArray(rawPatterns) && rawPatterns.length > 0) {
      cameraMovesText = rawPatterns.join(", ");
    } else if (typeof rawPatterns === "string" && rawPatterns.trim()) {
      cameraMovesText = rawPatterns.trim();
    } else if (shotsList.length > 0) {
      cameraMovesText = [...new Set(shotsList.map((s) => s.cameraMove).filter(Boolean))]
        .slice(0, 4)
        .join(", ");
    }
    if (!cameraMovesText) {
      cameraMovesText = "Dynamic optical push and editorial cuts";
    }

    const colorLookText =
      recipe.recommendedColorLook || packaging.lightingAndGrade || "Balanced commercial grade";

    const artifacts = reaBreakdown.artifacts || {};
    const storyboardSheetUrl = resolveMediaUrl(
      activeSlug,
      artifacts.storyboardImgUrl || artifacts.storyboardUrl || reaBreakdown.storyboardImgUrl,
    );
    const reportHtmlUrl = resolveMediaUrl(
      activeSlug,
      artifacts.reportHtmlUrl || artifacts.reportUrl || reaBreakdown.reportHtmlUrl,
    );
    const videoMdUrl = resolveMediaUrl(activeSlug, artifacts.videoMdUrl);

    return {
      shotsList,
      shotCount,
      avgShotLength,
      codeMotionPct,
      bpmPacingLabel,
      subtitleStyle,
      cameraMovesText,
      colorLookText,
      storyboardSheetUrl,
      reportHtmlUrl,
      videoMdUrl,
      videoMdPreview: String(reaBreakdown.videoMdPreview || reaBreakdown.videoMd || "").trim(),
    };
  }, [reaBreakdown, profile, activeSlug]);

  return (
    <section className="step-container narrow" aria-labelledby="step-two-heading">
      <header className="step-header">
        <div className="step-eyebrow">Step 2 of 5 · Optional</div>
        <h1 id="step-two-heading" className="step-heading">
          Inspiration
        </h1>
        <p className="step-subtitle">
          Upload a reference style video or add a link to extract cut timing, pacing rhythm, and
          palette mood. You can skip this step anytime.
        </p>
      </header>

      <div className="studio-card">
        <div className="card-header">
          <div className="segmented-control" role="tablist" aria-label="Reference input type">
            <button
              type="button"
              role="tab"
              aria-selected={inspTab === "upload"}
              className={`seg-btn ${inspTab === "upload" ? "active" : ""}`}
              onClick={() => setInspTab("upload")}
            >
              <Icons.Upload size={14} />
              <span>Upload video</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspTab === "link"}
              className={`seg-btn ${inspTab === "link" ? "active" : ""}`}
              onClick={() => setInspTab("link")}
            >
              <Icons.Link size={14} />
              <span>Reference link</span>
            </button>
          </div>

          <div className="inline-wrap">
            {inspirationFiles.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm btn-leading-icon"
                disabled={analyzeBusy}
                onClick={() => analyzeInspiration({})}
              >
                <Icons.Sparkles size={13} />
                <span>{analyzeBusy ? "Analyzing style..." : "Analyze style"}</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm btn-leading-icon"
              disabled={!activeSlug || inspirationFiles.length === 0 || reaDecomposing}
              onClick={() => handleReaDecompose()}
            >
              <Icons.Layers size={13} />
              <span>
                {reaDecomposing
                  ? "Decomposing style..."
                  : "Deep animation & style breakdown (rea-video)"}
              </span>
            </button>
          </div>
        </div>

        {inspTab === "upload" && (
          <div className="dropzone" onClick={() => inspFileRef.current?.click()}>
            <input
              ref={inspFileRef}
              type="file"
              accept="video/*,.mp4,.mov,.webm"
              hidden
              onChange={(event) => handleUploadInspiration(event.target.files)}
            />
            <Icons.Upload size={20} />
            <div className="dropzone-title">Upload a reference edit</div>
            <div className="dropzone-sub">
              Measures average cut length, cuts per minute, and 5 dominant color swatches locally.
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-leading-icon"
              disabled={uploadPct !== null}
              onClick={(event) => {
                event.stopPropagation();
                inspFileRef.current?.click();
              }}
            >
              <Icons.Upload size={14} />
              <span>
                {uploadPct !== null ? `Uploading (${uploadPct}%)` : "Select reference video"}
              </span>
            </button>
          </div>
        )}

        {inspTab === "link" && (
          <form className="stack-md" onSubmit={handleSaveRefLink}>
            <div className="field">
              <label htmlFor="insp-url-input" className="field-label">
                Reference video URL
              </label>
              <input
                id="insp-url-input"
                type="url"
                placeholder="https://www.youtube.com/shorts/..."
                value={refUrl}
                onChange={(event) => setRefUrl(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="insp-notes-input" className="field-label">
                Style notes (optional)
              </label>
              <input
                id="insp-notes-input"
                type="text"
                placeholder="Fast 2-second hook cuts and clean lower-third captions"
                value={refNotes}
                onChange={(event) => setRefNotes(event.target.value)}
              />
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={downloadRefVideo}
                onChange={(event) => setDownloadRefVideo(event.target.checked)}
              />
              <span>Download video locally so Analyze style can measure cuts and colors</span>
            </label>
            <div className="inline-row">
              <button
                type="submit"
                className="btn btn-primary btn-leading-icon"
                disabled={urlBusy || !refUrl.trim()}
              >
                <Icons.Plus size={14} />
                <span>{urlBusy ? "Saving..." : "Add reference link"}</span>
              </button>
            </div>
          </form>
        )}

        {(inspirationFiles.length > 0 || referenceLinks.length > 0) && (
          <div className="clip-list">
            {inspirationFiles.map((file) => {
              const thumb = resolveMediaUrl(activeSlug, file.thumbnailUrl);
              return (
                <div key={file.relPath} className="clip-row">
                  <div className="clip-row-leading">
                    {thumb && <img src={thumb} alt={file.name} className="clip-thumb" />}
                    <div className="clip-meta">
                      <span className="clip-name">{file.name}</span>
                      <span className="clip-specs tabular">
                        {[formatDuration(file.duration), formatBytes(file.sizeBytes)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  </div>
                  <div className="clip-row-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm btn-leading-icon"
                      disabled={analyzeBusy}
                      onClick={() => analyzeInspiration({ relPath: file.relPath })}
                    >
                      <Icons.Sparkles size={13} />
                      <span>Analyze style</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-subtle btn-sm btn-leading-icon"
                      disabled={reaDecomposing}
                      onClick={() => handleReaDecompose(file.relPath)}
                    >
                      <Icons.Layers size={13} />
                      <span>Deep breakdown</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => deleteProjectFile(file.relPath)}
                    >
                      <Icons.Trash size={13} />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              );
            })}

            {referenceLinks.map((link) => {
              const safeHref = sanitizeExternalUrl(link.url);
              return (
                <div key={link.id || link.url} className="clip-row">
                  <div className="clip-row-leading">
                    <Icons.Link size={15} />
                    <div className="clip-meta">
                      {safeHref ? (
                        <a
                          href={safeHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="clip-name"
                        >
                          {link.title || link.url}
                        </a>
                      ) : (
                        <span className="clip-name">{link.title || link.url}</span>
                      )}
                      {link.notes && <span className="clip-specs">{link.notes}</span>}
                    </div>
                  </div>
                  <div className="clip-row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => deleteReferenceLink(link)}
                    >
                      <Icons.Trash size={13} />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {reaBreakdown && reaMetrics && (
        <div className="studio-card" aria-labelledby="rea-breakdown-heading">
          <div className="card-header">
            <div>
              <h2 id="rea-breakdown-heading" className="card-title">
                Animation &amp; editing style breakdown
              </h2>
              <p className="card-desc">
                {reaBreakdown.summary ||
                  "Shot-level motion UI mix, camera choreography, subtitle packaging, and HyperFrames remake recipe."}
              </p>
            </div>
            <div className="inline-wrap">
              {reaMetrics.reportHtmlUrl && (
                <a
                  href={reaMetrics.reportHtmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm btn-trailing-icon"
                >
                  <span>Open full breakdown report</span>
                  <Icons.ArrowUpRight size={13} />
                </a>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm btn-leading-icon"
                disabled={applyingStyle}
                onClick={handleApplyStyleToStoryboard}
              >
                <Icons.Wand size={13} />
                <span>{applyingStyle ? "Applying style..." : "Apply style to design frames"}</span>
              </button>
            </div>
          </div>

          {/* 4-Metric Strip */}
          <div className="grid-4">
            <div className="stat-box">
              <span className="stat-label">Shots</span>
              <span className="stat-value tabular">{reaMetrics.shotCount}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Avg cut</span>
              <span className="stat-value tabular">{`${reaMetrics.avgShotLength.toFixed(1)}s`}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Code / Motion UI %</span>
              <span className="stat-value tabular">{`${reaMetrics.codeMotionPct}%`}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">BPM / Pacing</span>
              <span className="stat-value tabular" style={{ fontSize: "15px" }}>
                {reaMetrics.bpmPacingLabel}
              </span>
            </div>
          </div>

          {/* Detected Animation & Caption Packaging Summary */}
          <div className="grid-3">
            <div className="stat-box">
              <span className="stat-label">Subtitle styling</span>
              <span style={{ fontSize: "13px", fontWeight: 500 }}>{reaMetrics.subtitleStyle}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Camera moves</span>
              <span style={{ fontSize: "13px", fontWeight: 500 }}>
                {reaMetrics.cameraMovesText}
              </span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Color look</span>
              <span style={{ fontSize: "13px", fontWeight: 500 }}>{reaMetrics.colorLookText}</span>
            </div>
          </div>

          {/* Storyboard Contact Sheet Preview (concentric 16px = 8px + 8px, 1px oklch outline) */}
          {reaMetrics.storyboardSheetUrl && (
            <div className="stack-sm">
              <div className="card-header">
                <span className="field-label">Storyboard contact sheet</span>
                {reaMetrics.reportHtmlUrl && (
                  <a
                    href={reaMetrics.reportHtmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="field-hint"
                  >
                    Open full breakdown report
                  </a>
                )}
              </div>
              <div className="concentric-card">
                <div className="concentric-inner">
                  <img
                    src={reaMetrics.storyboardSheetUrl}
                    alt="Inspiration storyboard contact sheet"
                    style={{ width: "100%", height: "auto", display: "block" }}
                    loading="lazy"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Collapsible Shot-by-Shot Timeline & VIDEO.md */}
          <details className="studio-disclosure">
            <summary>
              <span>Shot-by-shot animation timeline &amp; VIDEO.md</span>
              <Icons.ChevronRight size={14} className="disclosure-chevron" />
            </summary>
            <div className="disclosure-body">
              {reaMetrics.shotsList.length > 0 && (
                <div className="simple-table-wrap">
                  <table className="simple-table">
                    <thead>
                      <tr>
                        <th>Shot</th>
                        <th>Timing</th>
                        <th>Production type</th>
                        <th>Camera move</th>
                        <th>HyperFrames archetype</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reaMetrics.shotsList.map((shot, idx) => {
                        const shotNum = String(shot.index || idx + 1).padStart(2, "0");
                        const startSec = Number(shot.start || 0).toFixed(1);
                        const endSec = Number(
                          shot.end ?? Number(shot.start || 0) + Number(shot.duration || 0),
                        ).toFixed(1);
                        return (
                          <tr key={`${shotNum}_${startSec}`}>
                            <td className="mono tabular">{`#${shotNum}`}</td>
                            <td className="mono tabular">{`${startSec}s–${endSec}s`}</td>
                            <td>
                              <span className="tag-pill">{shot.productionType || "motion-ui"}</span>
                            </td>
                            <td>{shot.cameraMove || "hero-lockoff"}</td>
                            <td className="mono">
                              {shot.recommendedArchetype || "device-3d-showcase"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {reaMetrics.videoMdPreview && (
                <div className="stack-sm">
                  <div className="card-header">
                    <span className="field-label">VIDEO.md specification preview</span>
                    {reaMetrics.videoMdUrl && (
                      <a
                        href={reaMetrics.videoMdUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="field-hint"
                      >
                        Open raw VIDEO.md
                      </a>
                    )}
                  </div>
                  <pre className="console-pre">{reaMetrics.videoMdPreview}</pre>
                </div>
              )}
            </div>
          </details>
        </div>
      )}

      {profile && (
        <div className="studio-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Style profile</h2>
              <p className="card-desc">
                Storyboard shot cadence and color mood will align with this profile.
              </p>
            </div>
          </div>

          <div className="stats-3-grid">
            <div className="stat-box">
              <span className="stat-label">Average cut</span>
              <span className="stat-value tabular">
                {`${Number(profile.avgShotLength || 0).toFixed(1)}s`}
              </span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Pacing</span>
              <span className="stat-value">{formatPacingLabel(profile.pacing)}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Cuts/min</span>
              <span className="stat-value tabular">
                {Number(profile.cutsPerMinute || 0).toFixed(1)}
              </span>
            </div>
          </div>

          {Array.isArray(profile.dominantColors) && profile.dominantColors.length > 0 && (
            <div className="stack-sm">
              <span className="field-label">Extracted color swatches</span>
              <div className="swatch-pills-row">
                {profile.dominantColors.map((hex) => (
                  <span key={hex} className="tag-pill mono">
                    <span
                      style={{
                        width: "12px",
                        height: "12px",
                        borderRadius: "3px",
                        backgroundColor: hex,
                        display: "inline-block",
                        boxShadow: "inset 0 0 0 1px oklch(0 0 0 / 0.14)",
                      }}
                    />
                    {hex}
                  </span>
                ))}
              </div>
            </div>
          )}

          {styleFrames.length > 0 && (
            <div className="stack-sm">
              <span className="field-label">Style frame thumbnails</span>
              <div className="style-frames-row">
                {styleFrames.map((src, index) => (
                  <div key={src} className="style-frame-btn">
                    <img src={src} alt={`Style frame ${index + 1}`} loading="lazy" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <footer className="step-footer">
        <button
          type="button"
          className="btn btn-secondary btn-leading-icon"
          onClick={() => setStep(1)}
        >
          <Icons.ChevronLeft size={15} />
          <span>Back</span>
        </button>

        <div className="step-footer-trailing">
          <button type="button" className="btn btn-ghost" onClick={() => setStep(3)}>
            Skip
          </button>
          <button
            type="button"
            className="btn btn-primary btn-trailing-icon"
            onClick={() => setStep(3)}
          >
            <span>Continue to brand</span>
            <Icons.ChevronRight size={15} />
          </button>
        </div>
      </footer>
    </section>
  );
}

/* ============================================================================
 * STEP 3 — BRAND & GOAL
 * ========================================================================== */

export function StepThreeBrand() {
  const {
    setStep,
    activeSlug,
    project,
    busyMap,
    uploadFiles,
    extractBrand,
    saveBrief,
    generateTts,
    deleteProjectFile,
    generateStoryboardFrames,
  } = useStudio();

  const [title, setTitle] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [language, setLanguage] = useState("English");
  const [instructions, setInstructions] = useState("");
  const [headingFont, setHeadingFont] = useState("Geist Sans");
  const [brandColors, setBrandColors] = useState({
    primary: "#1E824C",
    secondary: "#2ECC71",
    accent: "#F59E0B",
    background: "#111111",
  });
  const [activeColorSlot, setActiveColorSlot] = useState("primary");

  const [ttsText, setTtsText] = useState("");
  const [ttsVoice, setTtsVoice] = useState("en-US-AriaNeural");
  const [ttsFilename, setTtsFilename] = useState("voiceover_intro.mp3");
  const [brandUploadPct, setBrandUploadPct] = useState(null);
  const [audioUploadPct, setAudioUploadPct] = useState(null);

  const brandInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const syncedSlugRef = useRef(null);

  useEffect(() => {
    if (!project) return;
    if (syncedSlugRef.current !== project.slug) {
      syncedSlugRef.current = project.slug;
      setTitle(project.title || "");
      setAspectRatio(project.aspectRatio || "9:16");
      setDurationSeconds(Number(project.durationSeconds) || 30);
      setLanguage(project.language || "English");
      setInstructions(project.instructions || "");
      const incomingFont = project.brandKit?.fonts?.heading;
      setHeadingFont(incomingFont || "Geist Sans");
      if (/bengali|বাংলা/i.test(String(project.language || ""))) {
        setTtsVoice("bn-BD-NabanitaNeural");
      }
    }
    if (project.brandColors) {
      setBrandColors((prev) => ({
        ...prev,
        ...project.brandColors,
      }));
    }
  }, [project]);

  const brandFiles = Array.isArray(project?.files?.brand) ? project.files.brand : [];
  const audioFiles = useMemo(() => {
    const inboxAudio = Array.isArray(project?.files?.audio) ? project.files.audio : [];
    const assetAudio = Array.isArray(project?.files?.assetAudio) ? project.files.assetAudio : [];
    const seen = new Set();
    const combined = [];
    for (const f of [...inboxAudio, ...assetAudio]) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      combined.push(f);
    }
    return combined;
  }, [project]);

  const extractedSwatches = useMemo(() => {
    const kitColors = Array.isArray(project?.brandKit?.extractedPalette)
      ? project.brandKit.extractedPalette
      : [];
    const inspColors = Array.isArray(project?.inspirationProfile?.dominantColors)
      ? project.inspirationProfile.dominantColors
      : [];
    return [...new Set([...kitColors, ...inspColors].filter(Boolean))];
  }, [project]);

  function updateColorSlot(slotKey, rawHex) {
    setBrandColors((prev) => ({
      ...prev,
      [slotKey]: rawHex,
    }));
  }

  function buildBriefPatch() {
    return {
      title: title.trim() || project?.title || activeSlug || "Untitled video",
      aspectRatio,
      durationSeconds: Math.max(4, Number(durationSeconds) || 30),
      language,
      instructions,
      brandColors,
      brandKit: {
        ...(project?.brandKit || {}),
        fonts: {
          heading: headingFont.trim() || "Geist Sans",
          body: headingFont.trim() || "Geist Sans",
        },
      },
    };
  }

  async function handleUploadBrandAssets(files) {
    if (!files || files.length === 0) return;
    setBrandUploadPct(0);
    try {
      await uploadFiles("brand", files, (pct) => setBrandUploadPct(pct));
    } finally {
      setBrandUploadPct(null);
      if (brandInputRef.current) brandInputRef.current.value = "";
    }
  }

  async function handleAutoExtractBrand() {
    await extractBrand({ text: instructions });
  }

  async function handleUploadAudio(files) {
    if (!files || files.length === 0) return;
    setAudioUploadPct(0);
    try {
      await uploadFiles("audio", files, (pct) => setAudioUploadPct(pct));
    } finally {
      setAudioUploadPct(null);
      if (audioInputRef.current) audioInputRef.current.value = "";
    }
  }

  async function handleGenerateTts() {
    if (!ttsText.trim()) return;
    await generateTts({
      text: ttsText.trim(),
      voice: ttsVoice,
      filename: ttsFilename.trim() || "voiceover.mp3",
    });
    setTtsText("");
  }

  async function handleSaveAndGenerate() {
    await saveBrief(buildBriefPatch());
    await generateStoryboardFrames({ preserveLocked: true });
    setStep(4);
  }

  const extractingBusy = checkBusy(busyMap, "extractBrand");
  const savingBusy = checkBusy(busyMap, "saveBrief");
  const generatingBusy = checkBusy(busyMap, "storyboard");
  const ttsBusy = checkBusy(busyMap, "generateTts");

  return (
    <section className="step-container narrow" aria-labelledby="step-three-heading">
      <header className="step-header">
        <div className="step-eyebrow">Step 3 of 5</div>
        <h1 id="step-three-heading" className="step-heading">
          Brand &amp; goal
        </h1>
        <p className="step-subtitle">
          Set your brand colors, typography, target format, creative instructions, and active local
          skills before generating design frames.
        </p>
      </header>

      {/* Card 1: Brand Identity */}
      <div className="studio-card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Brand identity</h2>
            <p className="card-desc">
              Upload a logo, brand PDF, or custom font files (<code>.ttf</code>, <code>.otf</code>,{" "}
              <code>.woff2</code>), or auto-fill colors from your brand assets.
            </p>
          </div>
          <div className="inline-wrap">
            <input
              ref={brandInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.svg,.pdf,.md,.txt,.json,.ttf,.otf,.woff,.woff2"
              multiple
              hidden
              onChange={(event) => handleUploadBrandAssets(event.target.files)}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm btn-leading-icon"
              disabled={brandUploadPct !== null}
              onClick={() => brandInputRef.current?.click()}
            >
              <Icons.Upload size={13} />
              <span>
                {brandUploadPct !== null
                  ? `Uploading (${brandUploadPct}%)`
                  : "Upload logo, PDF, or font"}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm btn-leading-icon"
              disabled={extractingBusy}
              onClick={handleAutoExtractBrand}
            >
              <Icons.Wand size={13} />
              <span>{extractingBusy ? "Extracting..." : "Auto-fill colors from brand"}</span>
            </button>
          </div>
        </div>

        {brandFiles.length > 0 && (
          <div className="inline-wrap">
            {brandFiles.map((bf) => {
              const thumb = bf.mediaType === "image" ? resolveMediaUrl(activeSlug, bf.url) : "";
              return (
                <span key={bf.relPath} className="tag-pill">
                  {thumb && (
                    <img
                      src={thumb}
                      alt={bf.name}
                      style={{
                        width: "16px",
                        height: "16px",
                        borderRadius: "3px",
                        objectFit: "cover",
                      }}
                    />
                  )}
                  <span>{bf.name}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    style={{ width: "20px", height: "20px" }}
                    aria-label={`Remove ${bf.name}`}
                    onClick={() => deleteProjectFile(bf.relPath)}
                  >
                    <Icons.X size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        <div className="color-swatches-4">
          {COLOR_SLOTS.map((slot) => {
            const hexVal = brandColors[slot.key] || "#111111";
            const isSelectedSlot = activeColorSlot === slot.key;
            return (
              <div
                key={slot.key}
                className="color-well"
                style={isSelectedSlot ? { boxShadow: "0 0 0 2px var(--text-primary)" } : undefined}
                onClick={() => setActiveColorSlot(slot.key)}
              >
                <input
                  id={`color-${slot.key}`}
                  type="color"
                  aria-label={`${slot.label} color picker`}
                  value={/^#[0-9A-Fa-f]{6}$/.test(hexVal) ? hexVal : "#111111"}
                  onChange={(event) => updateColorSlot(slot.key, event.target.value)}
                />
                <div className="stack-sm" style={{ gap: "2px", minWidth: 0, flex: 1 }}>
                  <label htmlFor={`color-hex-${slot.key}`} className="stat-label">
                    {slot.label}
                  </label>
                  <input
                    id={`color-hex-${slot.key}`}
                    type="text"
                    className="mono"
                    style={{ padding: "3px 6px", fontSize: "12px" }}
                    value={hexVal}
                    onChange={(event) => updateColorSlot(slot.key, event.target.value)}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {extractedSwatches.length > 0 && (
          <div className="stack-sm">
            <span className="field-hint">
              Click an extracted swatch to apply it to <strong>{activeColorSlot}</strong>:
            </span>
            <div className="swatch-pills-row">
              {extractedSwatches.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className="swatch-dot-btn"
                  style={{ backgroundColor: hex }}
                  title={`Apply ${hex} to ${activeColorSlot}`}
                  aria-label={`Apply ${hex} to ${activeColorSlot}`}
                  onClick={() => updateColorSlot(activeColorSlot, hex)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="grid-2">
          <div className="field">
            <label htmlFor="brand-font-input" className="field-label">
              Font family
            </label>
            <input
              id="brand-font-input"
              type="text"
              list="studio-curated-fonts"
              value={headingFont}
              onChange={(event) => setHeadingFont(event.target.value)}
              placeholder="Geist Sans"
            />
            <datalist id="studio-curated-fonts">
              <option value="Geist Sans" />
              <option value="Switzer" />
              <option value="SF Pro Display" />
              <option value="Instrument Serif" />
              <option value="Newsreader" />
              <option value="Playfair Display" />
              <option value="Hind Siliguri" />
              <option value="Noto Sans Bengali" />
            </datalist>
          </div>

          <div className="field">
            <label htmlFor="brand-language-select" className="field-label">
              Language
            </label>
            <select
              id="brand-language-select"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {LANGUAGE_OPTIONS.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Card 2: Video Goal & Active Skills */}
      <div className="studio-card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Video goal &amp; active skills</h2>
            <p className="card-desc">
              Configure aspect ratio, target length, creative instructions, and local skills before
              generating frames.
            </p>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="goal-title-input" className="field-label">
              Project title
            </label>
            <input
              id="goal-title-input"
              type="text"
              placeholder="Winter seed wholesale launch"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="goal-duration-input" className="field-label">
              Target duration (sec)
            </label>
            <input
              id="goal-duration-input"
              type="number"
              min={4}
              max={300}
              step={1}
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(event.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <span className="field-label">Format</span>
          <div className="grid-4" role="radiogroup" aria-label="Video format">
            {FORMAT_OPTIONS.map((fmt) => {
              const selected = aspectRatio === fmt.id;
              return (
                <button
                  key={fmt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? "btn btn-primary" : "btn btn-secondary"}
                  style={{
                    flexDirection: "column",
                    alignItems: "flex-start",
                    padding: "10px 12px",
                    gap: "2px",
                  }}
                  onClick={() => setAspectRatio(fmt.id)}
                >
                  <span>{fmt.label}</span>
                  <span
                    className="tabular"
                    style={{ fontSize: "11px", opacity: selected ? 0.82 : 0.65, fontWeight: 400 }}
                  >
                    {fmt.dims}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label htmlFor="goal-instructions-textarea" className="field-label">
            Instructions
          </label>
          <textarea
            id="goal-instructions-textarea"
            rows={4}
            placeholder="Open with the core customer pain in the first 3 seconds, showcase the product proof points in the middle scenes, and finish with a clear call to action."
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </div>

        <SkillsAndRatingPanel compact={true} />

        <VoiceAndLipSyncCard compact={true} />

        <details className="studio-disclosure">
          <summary>
            <span>Optional: Voiceover &amp; audio files</span>
            <Icons.ChevronRight size={14} className="disclosure-chevron" />
          </summary>
          <div className="disclosure-body">
            <div className="grid-2">
              <div className="field">
                <label htmlFor="tts-voice-select" className="field-label">
                  Neural voice (Edge-TTS, $0 local)
                </label>
                <select
                  id="tts-voice-select"
                  value={ttsVoice}
                  onChange={(event) => setTtsVoice(event.target.value)}
                >
                  {TTS_VOICE_OPTIONS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="tts-filename-input" className="field-label">
                  Audio filename
                </label>
                <input
                  id="tts-filename-input"
                  type="text"
                  className="mono"
                  value={ttsFilename}
                  onChange={(event) => setTtsFilename(event.target.value)}
                  placeholder="voiceover_intro.mp3"
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="tts-script-textarea" className="field-label">
                Voiceover script
              </label>
              <textarea
                id="tts-script-textarea"
                rows={2}
                placeholder="Enter narration text to synthesize into your project audio folder."
                value={ttsText}
                onChange={(event) => setTtsText(event.target.value)}
              />
            </div>

            <div className="inline-wrap">
              <button
                type="button"
                className="btn btn-secondary btn-sm btn-leading-icon"
                disabled={ttsBusy || !ttsText.trim()}
                onClick={handleGenerateTts}
              >
                <Icons.Play size={13} />
                <span>{ttsBusy ? "Generating voiceover..." : "Generate voiceover"}</span>
              </button>

              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg"
                multiple
                hidden
                onChange={(event) => handleUploadAudio(event.target.files)}
              />
              <button
                type="button"
                className="btn btn-subtle btn-sm btn-leading-icon"
                disabled={audioUploadPct !== null}
                onClick={() => audioInputRef.current?.click()}
              >
                <Icons.Upload size={13} />
                <span>
                  {audioUploadPct !== null
                    ? `Uploading (${audioUploadPct}%)`
                    : "Upload music or voiceover"}
                </span>
              </button>
            </div>

            {audioFiles.length > 0 && (
              <div className="clip-list">
                {audioFiles.map((af) => {
                  const src = resolveMediaUrl(activeSlug, af.url);
                  return (
                    <div key={af.relPath} className="clip-row">
                      <div className="clip-meta">
                        <span className="clip-name">{af.name}</span>
                        {af.duration && (
                          <span className="clip-specs tabular">{formatDuration(af.duration)}</span>
                        )}
                      </div>
                      <div className="clip-row-actions">
                        {src && (
                          <audio
                            controls
                            preload="none"
                            src={src}
                            style={{ height: "32px", maxWidth: "220px" }}
                          />
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => deleteProjectFile(af.relPath)}
                        >
                          <Icons.Trash size={13} />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </details>
      </div>

      <footer className="step-footer">
        <div className="inline-wrap">
          <button
            type="button"
            className="btn btn-secondary btn-leading-icon"
            onClick={() => setStep(2)}
          >
            <Icons.ChevronLeft size={15} />
            <span>Back</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={savingBusy}
            onClick={() => saveBrief(buildBriefPatch())}
          >
            <span>{savingBusy ? "Saving..." : "Save brief"}</span>
          </button>
        </div>

        <div className="step-footer-trailing">
          <button
            type="button"
            className="btn btn-primary btn-trailing-icon"
            disabled={savingBusy || generatingBusy}
            onClick={handleSaveAndGenerate}
          >
            <span>
              {generatingBusy ? "Generating design frames..." : "Save & generate design frames"}
            </span>
            <Icons.ChevronRight size={15} />
          </button>
        </div>
      </footer>
    </section>
  );
}

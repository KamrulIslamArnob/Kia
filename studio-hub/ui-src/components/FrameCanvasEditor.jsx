import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useStudio, Icons } from "../store.jsx";
import { resolveMediaUrl } from "../api.js";

const INK_SWATCHES = [
  { name: "Coral", hex: "#E03E3E" },
  { name: "Amber", hex: "#D97706" },
  { name: "Blue", hex: "#2563EB" },
  { name: "Charcoal", hex: "#111111" },
];

const STROKE_SIZES = [
  { id: "small", label: "Small", brushPx: 26, linePx: 4 },
  { id: "medium", label: "Medium", brushPx: 52, linePx: 6 },
  { id: "large", label: "Large", brushPx: 86, linePx: 9 },
];

const QUICK_CHIPS = ["Replace badge", "Zoom here", "Clean background", "Make text bolder"];

const FALLBACK_MOTION_PRESETS = [
  { id: "crash-zoom-in", name: "Crash Zoom In" },
  { id: "dolly-out-reveal", name: "Dolly Out Reveal" },
  { id: "isometric-3d-tilt", name: "Isometric 3D Tilt" },
  { id: "whip-pan-split", name: "Whip Pan Split" },
  { id: "spotlight-cursor-follow", name: "Spotlight Cursor Follow" },
  { id: "bento-triptych", name: "Bento Triptych" },
  { id: "editorial-kinetic-card", name: "Editorial Kinetic Card" },
  { id: "parallax-float", name: "Parallax Float" },
];

const FALLBACK_ARCHETYPES = [
  "device-3d-showcase",
  "split-editorial",
  "fullbleed-cinema",
  "bento-feature-grid",
  "spotlight-cursor-zoom",
  "kinetic-statement-card",
];

const FALLBACK_COLOR_LOOKS = [
  { id: "clean-commercial", name: "Clean Commercial" },
  { id: "kodak-2383-warm", name: "Kodak 2383 Warm Print" },
  { id: "emerald-vibrant", name: "Emerald Vibrant" },
  { id: "teal-orange-cinema", name: "Teal & Orange Cinema" },
  { id: "apple-keynote-crisp", name: "Apple Keynote Crisp" },
];

function RenderIcon({ icon: IconComp, size = 15 }) {
  if (!IconComp) return null;
  return <IconComp size={size} width={size} height={size} aria-hidden="true" />;
}

function formatArchetypeLabel(id) {
  if (!id) return "";
  return String(id)
    .split("-")
    .map((part, idx) =>
      idx === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part === "3d" ? "3D" : part,
    )
    .join(" ");
}

function getSizeConfig(sizeId) {
  return STROKE_SIZES.find((item) => item.id === sizeId) || STROKE_SIZES[1];
}

function classifyZonePreview(strokes, width, height) {
  if (!strokes.length || !width || !height) return "";
  if (strokes.some((s) => s.tool === "arrow")) {
    return "Camera motion vector";
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const pt of stroke.points || []) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  if (!Number.isFinite(minX)) return "";
  const cx = (minX + maxX) / 2 / width;
  const cy = (minY + maxY) / 2 / height;
  if (cy < 0.22) return "Header badge";
  if (cy > 0.76) return "Lower-third copy";
  if (cx < 0.36) return "Left callout";
  if (cx > 0.64) return "Right callout";
  return "Center subject";
}

function drawStrokeVisual(ctx, stroke, scaleFactor, pinNumber) {
  const pts = stroke.points || [];
  if (pts.length === 0) return;

  const sizeCfg = getSizeConfig(stroke.size);
  const color = stroke.color || "#E03E3E";
  ctx.save();

  if (stroke.tool === "brush") {
    const brushWidth = Math.max(8, sizeCfg.brushPx * scaleFactor);
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushWidth;

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, brushWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }
  } else if (stroke.tool === "box") {
    const p0 = pts[0];
    const p1 = pts[pts.length - 1] || p0;
    const x = Math.min(p0.x, p1.x);
    const y = Math.min(p0.y, p1.y);
    const w = Math.max(2, Math.abs(p1.x - p0.x));
    const h = Math.max(2, Math.abs(p1.y - p0.y));
    const lineW = Math.max(2, sizeCfg.linePx * scaleFactor);

    ctx.globalAlpha = 0.14;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);

    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.setLineDash([Math.round(14 * scaleFactor), Math.round(9 * scaleFactor)]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  } else if (stroke.tool === "arrow") {
    const p0 = pts[0];
    const p1 = pts[pts.length - 1] || p0;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dist = Math.hypot(dx, dy);
    const lineW = Math.max(3, (sizeCfg.linePx + 1) * scaleFactor);
    const headLen = Math.max(18 * scaleFactor, lineW * 3.8);
    const angle = Math.atan2(dy, dx);

    ctx.globalAlpha = 0.96;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineW;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.arc(p0.x, p0.y, lineW * 1.15, 0, Math.PI * 2);
    ctx.fill();

    if (dist > 4) {
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(
        p1.x - headLen * Math.cos(angle - Math.PI / 6),
        p1.y - headLen * Math.sin(angle - Math.PI / 6),
      );
      ctx.lineTo(
        p1.x - headLen * Math.cos(angle + Math.PI / 6),
        p1.y - headLen * Math.sin(angle + Math.PI / 6),
      );
      ctx.closePath();
      ctx.fill();
    }
  } else if (stroke.tool === "pin") {
    const p0 = pts[0];
    const radius = Math.max(16, 22 * scaleFactor);
    ctx.globalAlpha = 0.98;
    ctx.fillStyle = color;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = Math.max(2, 3 * scaleFactor);

    ctx.beginPath();
    ctx.arc(p0.x, p0.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#FFFFFF";
    ctx.font = `600 ${Math.round(18 * scaleFactor)}px "Geist Mono", "SF Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(pinNumber || 1), p0.x, p0.y + 1);
  }

  ctx.restore();
}

function drawStrokeBinaryMask(ctx, stroke, scaleFactor) {
  const pts = stroke.points || [];
  if (pts.length === 0) return;

  const sizeCfg = getSizeConfig(stroke.size);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#FFFFFF";
  ctx.fillStyle = "#FFFFFF";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (stroke.tool === "brush") {
    const brushWidth = Math.max(10, sizeCfg.brushPx * scaleFactor);
    ctx.lineWidth = brushWidth;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, brushWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }
  } else if (stroke.tool === "box") {
    const p0 = pts[0];
    const p1 = pts[pts.length - 1] || p0;
    const x = Math.min(p0.x, p1.x);
    const y = Math.min(p0.y, p1.y);
    const w = Math.max(4, Math.abs(p1.x - p0.x));
    const h = Math.max(4, Math.abs(p1.y - p0.y));
    ctx.fillRect(x, y, w, h);
  } else if (stroke.tool === "arrow") {
    const p0 = pts[0];
    const p1 = pts[pts.length - 1] || p0;
    const shaftWidth = Math.max(16, sizeCfg.brushPx * 0.55 * scaleFactor);
    ctx.lineWidth = shaftWidth;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, shaftWidth * 0.75, 0, Math.PI * 2);
    ctx.fill();
  } else if (stroke.tool === "pin") {
    const p0 = pts[0];
    const pinMaskRadius = Math.max(32, 48 * scaleFactor);
    ctx.beginPath();
    ctx.arc(p0.x, p0.y, pinMaskRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function FrameCanvasEditor({ frame, slug, showHud = false, onClose }) {
  const studio = useStudio();
  const activeSlug = slug || studio.activeSlug || studio.project?.slug || "";
  const isDark = studio.theme === "dark";

  const liveFrame = useMemo(() => {
    if (!frame) return null;
    const matched = studio.storyboard?.frames?.find((item) => item.id === frame.id);
    return matched || frame;
  }, [studio.storyboard, frame]);

  const defaultDims = useMemo(
    () => ({
      width: Number(studio.storyboard?.width) || 1080,
      height: Number(studio.storyboard?.height) || 1920,
    }),
    [studio.storyboard?.width, studio.storyboard?.height],
  );

  const [viewMode, setViewMode] = useState(showHud ? "hud" : "clean");
  const [rawSlot, setRawSlot] = useState("peak");
  const [canvasDims, setCanvasDims] = useState(defaultDims);

  const [tool, setTool] = useState("brush");
  const [strokeSize, setStrokeSize] = useState("medium");
  const [inkColor, setInkColor] = useState(INK_SWATCHES[0].hex);
  const [strokes, setStrokes] = useState([]);
  const [draftStroke, setDraftStroke] = useState(null);

  const [prompt, setPrompt] = useState("");
  const [enqueueAiInpaint, setEnqueueAiInpaint] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingBookmark, setSavingBookmark] = useState(false);
  const [applyingFineTune, setApplyingFineTune] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState(null);

  const [headline, setHeadline] = useState("");
  const [subheadline, setSubheadline] = useState("");
  const [badgeText, setBadgeText] = useState("");
  const [voiceoverText, setVoiceoverText] = useState("");
  const [motionPreset, setMotionPreset] = useState("crash-zoom-in");
  const [layoutArchetype, setLayoutArchetype] = useState("device-3d-showcase");
  const [colorLook, setColorLook] = useState("clean-commercial");
  const [speedFactor, setSpeedFactor] = useState("1");
  const [durationSeconds, setDurationSeconds] = useState("4");

  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const promptInputRef = useRef(null);
  const activePointerRef = useRef(null);

  useEffect(() => {
    setViewMode(showHud ? "hud" : "clean");
  }, [showHud]);

  useEffect(() => {
    if (!liveFrame) return;
    setHeadline(liveFrame.staging?.headline ?? liveFrame.title ?? "");
    setSubheadline(liveFrame.staging?.subheadline ?? "");
    setBadgeText(liveFrame.staging?.badgeText ?? "");
    setVoiceoverText(liveFrame.audioSpec?.voiceoverText ?? liveFrame.staging?.captionText ?? "");
    setMotionPreset(liveFrame.motionPreset || "crash-zoom-in");
    setLayoutArchetype(liveFrame.layout || "device-3d-showcase");
    setColorLook(liveFrame.staging?.colorLook || liveFrame.colorLook || "clean-commercial");
    setSpeedFactor(String(liveFrame.speedFactor ?? 1));
    setDurationSeconds(String(liveFrame.durationSeconds ?? 4));
  }, [liveFrame]);

  const rawKeyframeMap = useMemo(() => {
    if (!liveFrame) return { start: "", peak: "", end: "" };
    const rk = liveFrame.rawKeyframes;
    const kf = liveFrame.keyframes || {};
    if (Array.isArray(rk)) {
      return {
        start: resolveMediaUrl(activeSlug, rk[0] || kf.start),
        peak: resolveMediaUrl(activeSlug, rk[1] || rk[0] || kf.peak),
        end: resolveMediaUrl(activeSlug, rk[2] || rk[rk.length - 1] || kf.end),
      };
    }
    const obj = rk && typeof rk === "object" ? rk : kf;
    return {
      start: resolveMediaUrl(activeSlug, obj.start || kf.start),
      peak: resolveMediaUrl(activeSlug, obj.peak || kf.peak || obj.start || kf.start),
      end: resolveMediaUrl(activeSlug, obj.end || kf.end || obj.peak || kf.peak),
    };
  }, [liveFrame, activeSlug]);

  const cleanFrameUrl = useMemo(() => {
    if (!liveFrame) return "";
    return resolveMediaUrl(
      activeSlug,
      liveFrame.designFrameUrl || liveFrame.currentDesignImage || liveFrame.designFramePath,
    );
  }, [liveFrame, activeSlug]);

  const hudFrameUrl = useMemo(() => {
    if (!liveFrame) return "";
    return (
      resolveMediaUrl(
        activeSlug,
        liveFrame.hudFrameUrl ||
          liveFrame.currentBlueprintImage ||
          liveFrame.hudFramePath ||
          liveFrame.designFrameUrl ||
          liveFrame.designFramePath,
      ) || cleanFrameUrl
    );
  }, [liveFrame, activeSlug, cleanFrameUrl]);

  const displayedImageUrl = useMemo(() => {
    if (viewMode === "hud") return hudFrameUrl || cleanFrameUrl;
    if (viewMode === "raw") {
      return (
        rawKeyframeMap[rawSlot] || rawKeyframeMap.peak || rawKeyframeMap.start || cleanFrameUrl
      );
    }
    return cleanFrameUrl;
  }, [viewMode, hudFrameUrl, cleanFrameUrl, rawKeyframeMap, rawSlot]);

  const allStrokesToRender = useMemo(
    () => (draftStroke ? [...strokes, draftStroke] : strokes),
    [strokes, draftStroke],
  );

  const redrawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scaleFactor = Math.max(0.4, canvas.width / 1080);
    let pinIndex = 0;

    for (const stroke of allStrokesToRender) {
      if (stroke.tool === "pin") {
        pinIndex += 1;
      }
      drawStrokeVisual(ctx, stroke, scaleFactor, pinIndex);
    }
  }, [allStrokesToRender]);

  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay, canvasDims]);

  const handleUndo = useCallback(() => {
    setStrokes((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }, []);

  const handleClear = useCallback(() => {
    setDraftStroke(null);
    setStrokes([]);
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
        return;
      }
      const tag = event.target?.tagName?.toLowerCase();
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        event.target?.isContentEditable;
      if (!isEditable && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        handleUndo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, handleUndo]);

  const toCanvasCoords = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const safeW = rect.width || 1;
    const safeH = rect.height || 1;
    const x = Math.round(
      Math.max(0, Math.min(canvas.width, ((event.clientX - rect.left) / safeW) * canvas.width)),
    );
    const y = Math.round(
      Math.max(0, Math.min(canvas.height, ((event.clientY - rect.top) / safeH) * canvas.height)),
    );
    return { x, y };
  }, []);

  const handlePointerDown = useCallback(
    (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      event.preventDefault();

      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Ignore synthetic events where pointer capture is unavailable
      }
      activePointerRef.current = event.pointerId;

      const pt = toCanvasCoords(event);
      if (tool === "pin") {
        const nextPinNumber = strokes.filter((s) => s.tool === "pin").length + 1;
        setStrokes((prev) => [
          ...prev,
          {
            id: `stroke_${prev.length + 1}`,
            tool: "pin",
            size: strokeSize,
            color: inkColor,
            label: `Pin ${nextPinNumber}`,
            points: [pt],
          },
        ]);
        activePointerRef.current = null;
        return;
      }

      setDraftStroke({
        id: `draft_${strokes.length + 1}`,
        tool,
        size: strokeSize,
        color: inkColor,
        label: "",
        points: tool === "brush" ? [pt] : [pt, pt],
      });
    },
    [tool, strokeSize, inkColor, strokes, toCanvasCoords],
  );

  const handlePointerMove = useCallback(
    (event) => {
      if (activePointerRef.current !== event.pointerId) return;
      const pt = toCanvasCoords(event);
      setDraftStroke((prev) => {
        if (!prev) return null;
        if (prev.tool === "brush") {
          const last = prev.points[prev.points.length - 1];
          if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 2) {
            return prev;
          }
          return { ...prev, points: [...prev.points, pt] };
        }
        return { ...prev, points: [prev.points[0], pt] };
      });
    },
    [toCanvasCoords],
  );

  const commitDraftStroke = useCallback((event) => {
    if (activePointerRef.current !== event.pointerId) return;
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        if (canvas.hasPointerCapture(event.pointerId)) {
          canvas.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Safe release fallback
      }
    }
    activePointerRef.current = null;
    setDraftStroke((current) => {
      if (current && current.points.length > 0) {
        setStrokes((prev) => [...prev, { ...current, id: `stroke_${prev.length + 1}` }]);
      }
      return null;
    });
  }, []);

  const handleImageLoad = useCallback((event) => {
    const img = event.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setCanvasDims((prev) => {
        if (prev.width === img.naturalWidth && prev.height === img.naturalHeight) {
          return prev;
        }
        return { width: img.naturalWidth, height: img.naturalHeight };
      });
    }
  }, []);

  const exportMaskAndComposite = useCallback(() => {
    const w = canvasDims.width || 1080;
    const h = canvasDims.height || 1920;
    const scaleFactor = Math.max(0.4, w / 1080);

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = w;
    maskCanvas.height = h;
    const maskCtx = maskCanvas.getContext("2d");
    if (maskCtx) {
      maskCtx.fillStyle = "#000000";
      maskCtx.fillRect(0, 0, w, h);
      for (const stroke of strokes) {
        drawStrokeBinaryMask(maskCtx, stroke, scaleFactor);
      }
    }
    const maskDataUrl = maskCanvas.toDataURL("image/png");

    const renderStrokesOnto = (targetCtx) => {
      let pinIdx = 0;
      for (const stroke of strokes) {
        if (stroke.tool === "pin") pinIdx += 1;
        drawStrokeVisual(targetCtx, stroke, scaleFactor, pinIdx);
      }
    };

    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = w;
    compositeCanvas.height = h;
    const compCtx = compositeCanvas.getContext("2d");
    let compositeDataUrl = "";

    if (compCtx) {
      compCtx.fillStyle = "#111111";
      compCtx.fillRect(0, 0, w, h);
      const imgEl = imgRef.current;
      if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
        try {
          compCtx.drawImage(imgEl, 0, 0, w, h);
        } catch {
          // Proceed with neutral backdrop if image draw fails
        }
      }
      renderStrokesOnto(compCtx);
      try {
        compositeDataUrl = compositeCanvas.toDataURL("image/png");
      } catch {
        const fallbackCanvas = document.createElement("canvas");
        fallbackCanvas.width = w;
        fallbackCanvas.height = h;
        const fbCtx = fallbackCanvas.getContext("2d");
        if (fbCtx) {
          fbCtx.fillStyle = "#111111";
          fbCtx.fillRect(0, 0, w, h);
          renderStrokesOnto(fbCtx);
        }
        compositeDataUrl = fallbackCanvas.toDataURL("image/png");
      }
    }

    const lastBox = [...strokes].reverse().find((s) => s.tool === "box" && s.points?.length >= 2);
    let regionBox = null;
    if (lastBox) {
      const [p0, p1] = lastBox.points;
      const rx = Math.min(p0.x, p1.x) / w;
      const ry = Math.min(p0.y, p1.y) / h;
      const rw = Math.max(0.01, Math.abs(p1.x - p0.x) / w);
      const rh = Math.max(0.01, Math.abs(p1.y - p0.y) / h);
      regionBox = {
        x: Number(rx.toFixed(4)),
        y: Number(ry.toFixed(4)),
        width: Number(rw.toFixed(4)),
        height: Number(rh.toFixed(4)),
      };
    }

    const serializedStrokes = strokes.map((s) => ({
      tool: s.tool,
      size: s.size,
      color: s.color,
      label: s.label || "",
      points: (s.points || []).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    }));

    return {
      maskDataUrl,
      compositeDataUrl,
      strokes: serializedStrokes,
      regionBox,
      canvasWidth: w,
      canvasHeight: h,
    };
  }, [strokes, canvasDims]);

  const handlePrimaryRegenerate = async (event) => {
    event?.preventDefault?.();
    if (!liveFrame || submitting) return;
    setSubmitting(true);
    try {
      const trimmedPrompt = prompt.trim();
      if (strokes.length > 0) {
        const exported = exportMaskAndComposite();
        await studio.regenerateShotRegion?.(liveFrame.id, {
          maskDataUrl: exported.maskDataUrl,
          compositeDataUrl: exported.compositeDataUrl,
          strokes: exported.strokes,
          regionBox: exported.regionBox,
          canvasWidth: exported.canvasWidth,
          canvasHeight: exported.canvasHeight,
          prompt: trimmedPrompt,
          enqueueAiInpaint,
        });
        setStrokes([]);
        setDraftStroke(null);
      } else {
        await studio.regenerateShot?.(liveFrame.id, { prompt: trimmedPrompt });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveBookmark = async () => {
    if (!liveFrame || savingBookmark) return;
    setSavingBookmark(true);
    try {
      await studio.saveFrameBookmark?.({
        frameId: liveFrame.id,
        version: liveFrame.currentVersion || 1,
        label: liveFrame.title || liveFrame.staging?.headline || liveFrame.id,
      });
    } finally {
      setSavingBookmark(false);
    }
  };

  const handleRestoreVersion = async (targetVer) => {
    if (!liveFrame || restoringVersion !== null) return;
    setRestoringVersion(targetVer);
    try {
      await studio.updateShot?.(liveFrame.id, { revertToVersion: targetVer });
      setStrokes([]);
    } finally {
      setRestoringVersion(null);
    }
  };

  const handleToggleLock = async () => {
    if (!liveFrame) return;
    const nextLocked = !liveFrame.locked;
    await studio.updateShot?.(liveFrame.id, {
      locked: nextLocked,
      approved: nextLocked ? true : Boolean(liveFrame.approved),
    });
  };

  const handleApplyFineTune = async (event) => {
    event.preventDefault();
    if (!liveFrame || applyingFineTune) return;
    setApplyingFineTune(true);
    try {
      const parsedDur = Math.max(0.5, Number(durationSeconds) || liveFrame.durationSeconds || 4);
      const parsedSpeed = Math.min(4, Math.max(0.25, Number(speedFactor) || 1));
      await studio.updateShot?.(liveFrame.id, {
        title: headline.trim() || liveFrame.title,
        layout: layoutArchetype,
        motionPreset,
        durationSeconds: parsedDur,
        speedFactor: parsedSpeed,
        staging: {
          ...(liveFrame.staging || {}),
          headline: headline.trim(),
          subheadline: subheadline.trim(),
          badgeText: badgeText.trim(),
          captionText: voiceoverText.trim(),
          colorLook,
        },
        audioSpec: {
          ...(liveFrame.audioSpec || {}),
          voiceoverText: voiceoverText.trim(),
        },
      });
    } finally {
      setApplyingFineTune(false);
    }
  };

  const handleChipClick = (chipText) => {
    setPrompt((prev) => {
      const base = prev.trim();
      if (!base) return chipText;
      if (base.toLowerCase().includes(chipText.toLowerCase())) return base;
      return `${base}; ${chipText.toLowerCase()}`;
    });
    promptInputRef.current?.focus();
  };

  const handlePinNoteChange = (strokeId, nextLabel) => {
    setStrokes((prev) =>
      prev.map((item) => (item.id === strokeId ? { ...item, label: nextLabel } : item)),
    );
  };

  const versionNumbers = useMemo(() => {
    const nums = new Set();
    if (liveFrame?.currentVersion) nums.add(Number(liveFrame.currentVersion));
    for (const snap of liveFrame?.history || []) {
      if (snap?.version) nums.add(Number(snap.version));
    }
    if (nums.size === 0) nums.add(1);
    return Array.from(nums).sort((a, b) => a - b);
  }, [liveFrame?.currentVersion, liveFrame?.history]);

  if (!liveFrame) return null;

  const availableMotionPresets =
    Array.isArray(studio.motionPresets) && studio.motionPresets.length > 0
      ? studio.motionPresets
      : FALLBACK_MOTION_PRESETS;

  const availableArchetypes =
    Array.isArray(studio.layoutArchetypes) && studio.layoutArchetypes.length > 0
      ? studio.layoutArchetypes
      : FALLBACK_ARCHETYPES;

  const availableColorLooks =
    Array.isArray(studio.catalog?.colorLooks) && studio.catalog.colorLooks.length > 0
      ? studio.catalog.colorLooks
      : FALLBACK_COLOR_LOOKS;

  const pinStrokes = strokes.filter((s) => s.tool === "pin");
  const targetZoneLabel = classifyZonePreview(strokes, canvasDims.width, canvasDims.height);
  const downloadFilename = `${activeSlug || "project"}_${liveFrame.id}_v${liveFrame.currentVersion || 1}.png`;
  const imageOutline = isDark ? "1px solid oklch(1 0 0 / 0.1)" : "1px solid oklch(0 0 0 / 0.1)";

  const SparklesIcon = Icons.Sparkles || Icons.Wand || Icons.Star;

  return (
    <div
      className="canvas-editor-backdrop modal-backdrop open is-open"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit design frame ${liveFrame.index || ""}: ${liveFrame.title || liveFrame.id}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: isDark ? "oklch(0 0 0 / 0.72)" : "oklch(0 0 0 / 0.36)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        overflowY: "auto",
      }}
    >
      <div
        className="canvas-editor-dialog studio-card"
        style={{
          width: "min(1180px, 100%)",
          maxHeight: "calc(100vh - 40px)",
          overflowY: "auto",
          background: "var(--bg-surface, #FFFFFF)",
          color: "var(--text-primary, #111111)",
          borderRadius: "16px",
          boxShadow:
            "var(--shadow-border, 0px 0px 0px 1px oklch(0 0 0 / 0.06), 0px 1px 2px -1px oklch(0 0 0 / 0.06), 0px 2px 4px 0px oklch(0 0 0 / 0.04))",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Top Studio Header */}
        <header
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "14px 20px",
            borderBottom: "1px solid var(--border-divider, #EAEAEA)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono, "Geist Mono", "SF Mono", monospace)',
                fontSize: "12px",
                fontVariantNumeric: "tabular-nums",
                padding: "3px 8px",
                borderRadius: "9999px",
                background: "var(--bg-subtle, #F7F6F3)",
                border: "1px solid var(--border-divider, #EAEAEA)",
                color: "var(--text-muted, #787774)",
              }}
            >
              Scene {String(liveFrame.index || 1).padStart(2, "0")} · v
              {liveFrame.currentVersion || 1}
            </span>
            <h2
              style={{
                margin: 0,
                fontSize: "16px",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {liveFrame.title || liveFrame.staging?.headline || liveFrame.id}
            </h2>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <div
              role="tablist"
              aria-label="Frame display mode"
              className="segmented-control"
              style={{
                display: "inline-flex",
                padding: "3px",
                borderRadius: "8px",
                background: "var(--bg-subtle, #F7F6F3)",
                border: "1px solid var(--border-divider, #EAEAEA)",
                gap: "2px",
              }}
            >
              {[
                { id: "clean", label: "Clean frame" },
                { id: "hud", label: "Animation guide" },
                { id: "raw", label: "Raw keyframes" },
              ].map((tab) => {
                const active = viewMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setViewMode(tab.id)}
                    style={{
                      border: "none",
                      borderRadius: "5px",
                      padding: "5px 10px",
                      fontSize: "12px",
                      fontWeight: active ? 600 : 500,
                      background: active ? "var(--bg-surface, #FFFFFF)" : "transparent",
                      color: active ? "var(--text-primary, #111111)" : "var(--text-muted, #787774)",
                      boxShadow: active ? "var(--shadow-border)" : "none",
                      cursor: "pointer",
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleToggleLock}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 11px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 500,
                background: liveFrame.locked ? "#EDF3EC" : "var(--bg-surface, #FFFFFF)",
                color: liveFrame.locked ? "#346538" : "var(--text-primary, #111111)",
                border: "1px solid var(--border-divider, #EAEAEA)",
                cursor: "pointer",
              }}
            >
              <RenderIcon icon={liveFrame.locked ? Icons.Lock : Icons.Unlock} size={14} />
              <span>{liveFrame.locked ? "Approved & locked" : "Approve frame"}</span>
            </button>

            <button
              type="button"
              aria-label="Close frame studio"
              onClick={() => onClose?.()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "32px",
                height: "32px",
                borderRadius: "6px",
                border: "1px solid var(--border-divider, #EAEAEA)",
                background: "var(--bg-surface, #FFFFFF)",
                color: "var(--text-primary, #111111)",
                cursor: "pointer",
              }}
            >
              <RenderIcon icon={Icons.X} size={15} />
            </button>
          </div>
        </header>

        {/* Studio Split Body */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            gap: "20px",
            padding: "20px",
            alignItems: "start",
          }}
        >
          {/* Left Column: Drawing Toolbar + Synchronized Frame Canvas */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Drawing Toolbar */}
            <div
              className="canvas-toolbar"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                padding: "10px 12px",
                borderRadius: "12px",
                background: "var(--bg-subtle, #F7F6F3)",
                border: "1px solid var(--border-divider, #EAEAEA)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "6px",
                }}
              >
                <div
                  role="group"
                  aria-label="Drawing tools"
                  style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}
                >
                  {[
                    { id: "brush", label: "Brush mask", icon: Icons.Brush },
                    { id: "box", label: "Region box", icon: Icons.BoxSelect },
                    { id: "arrow", label: "Motion arrow", icon: Icons.ArrowUpRight },
                    { id: "pin", label: "Pin note", icon: Icons.Pin },
                  ].map((item) => {
                    const active = tool === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setTool(item.id)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "5px 9px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: active ? 600 : 500,
                          border: active
                            ? "1px solid var(--text-primary, #111111)"
                            : "1px solid var(--border-divider, #EAEAEA)",
                          background: active ? "#111111" : "var(--bg-surface, #FFFFFF)",
                          color: active ? "#FFFFFF" : "var(--text-primary, #111111)",
                          cursor: "pointer",
                        }}
                      >
                        <RenderIcon icon={item.icon} size={14} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={strokes.length === 0}
                    title="Undo last mark (Ctrl+Z)"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: "5px 8px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                      opacity: strokes.length === 0 ? 0.45 : 1,
                      cursor: strokes.length === 0 ? "not-allowed" : "pointer",
                    }}
                  >
                    <RenderIcon icon={Icons.Undo} size={13} />
                    <span>Undo</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={strokes.length === 0}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: "5px 8px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                      opacity: strokes.length === 0 ? 0.45 : 1,
                      cursor: strokes.length === 0 ? "not-allowed" : "pointer",
                    }}
                  >
                    <RenderIcon icon={Icons.Trash} size={13} />
                    <span>Clear drawing</span>
                  </button>
                </div>
              </div>

              {/* Stroke Size Pills + Ink Swatches + Live Zone Readout */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}
                >
                  <div
                    role="group"
                    aria-label="Stroke size"
                    style={{ display: "inline-flex", gap: "4px" }}
                  >
                    {STROKE_SIZES.map((sz) => {
                      const active = strokeSize === sz.id;
                      return (
                        <button
                          key={sz.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setStrokeSize(sz.id)}
                          style={{
                            padding: "3px 8px",
                            borderRadius: "9999px",
                            fontSize: "11px",
                            fontWeight: active ? 600 : 500,
                            border: "1px solid var(--border-divider, #EAEAEA)",
                            background: active ? "var(--bg-surface, #FFFFFF)" : "transparent",
                            color: active
                              ? "var(--text-primary, #111111)"
                              : "var(--text-muted, #787774)",
                            boxShadow: active ? "var(--shadow-border)" : "none",
                            cursor: "pointer",
                          }}
                        >
                          {sz.label}
                        </button>
                      );
                    })}
                  </div>

                  <div
                    role="group"
                    aria-label="Ink color"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    {INK_SWATCHES.map((swatch) => {
                      const active = inkColor === swatch.hex;
                      return (
                        <button
                          key={swatch.hex}
                          type="button"
                          aria-label={`${swatch.name} ink`}
                          aria-pressed={active}
                          title={`${swatch.name} (${swatch.hex})`}
                          onClick={() => setInkColor(swatch.hex)}
                          style={{
                            width: "20px",
                            height: "20px",
                            borderRadius: "9999px",
                            background: swatch.hex,
                            border: active ? "2px solid #FFFFFF" : "1px solid oklch(0 0 0 / 0.18)",
                            boxShadow: active ? `0 0 0 2px ${swatch.hex}` : "none",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>

                <span
                  style={{
                    fontSize: "11px",
                    fontFamily: 'var(--font-mono, "Geist Mono", "SF Mono", monospace)',
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--text-muted, #787774)",
                  }}
                >
                  {strokes.length === 0
                    ? "Paint or drag on frame to target an area"
                    : `${strokes.length} ${strokes.length === 1 ? "mark" : "marks"}${
                        targetZoneLabel ? ` · ${targetZoneLabel}` : ""
                      }`}
                </span>
              </div>
            </div>

            {/* Raw Keyframes Slot Selector when in Raw Mode */}
            {viewMode === "raw" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "8px",
                  padding: "8px",
                  borderRadius: "16px",
                  background: "var(--bg-subtle, #F7F6F3)",
                  border: "1px solid var(--border-divider, #EAEAEA)",
                }}
              >
                {[
                  { id: "start", label: "Start keyframe" },
                  { id: "peak", label: "Peak keyframe" },
                  { id: "end", label: "End keyframe" },
                ].map((slot) => {
                  const url = rawKeyframeMap[slot.id];
                  const active = rawSlot === slot.id;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => setRawSlot(slot.id)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        padding: "4px",
                        borderRadius: "8px",
                        border: active
                          ? "1px solid var(--text-primary, #111111)"
                          : "1px solid var(--border-divider, #EAEAEA)",
                        background: "var(--bg-surface, #FFFFFF)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {url ? (
                        <img
                          src={url}
                          alt={slot.label}
                          style={{
                            width: "100%",
                            height: "64px",
                            objectFit: "cover",
                            borderRadius: "5px",
                            outline: imageOutline,
                            outlineOffset: "-1px",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "64px",
                            borderRadius: "5px",
                            background: "var(--bg-subtle, #F7F6F3)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "11px",
                            color: "var(--text-muted, #787774)",
                          }}
                        >
                          No frame
                        </div>
                      )}
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: active ? 600 : 500,
                          color: "var(--text-primary, #111111)",
                        }}
                      >
                        {slot.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Concentric Frame + Synchronized Resolution-Accurate Canvas Stage */}
            <div
              style={{
                padding: "8px",
                borderRadius: "16px",
                background: "var(--bg-subtle, #F7F6F3)",
                border: "1px solid var(--border-divider, #EAEAEA)",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  maxWidth: canvasDims.height > canvasDims.width ? "360px" : "100%",
                  aspectRatio: `${canvasDims.width} / ${canvasDims.height}`,
                  borderRadius: "8px",
                  overflow: "hidden",
                  background: "#111111",
                  userSelect: "none",
                }}
              >
                {displayedImageUrl ? (
                  <img
                    ref={imgRef}
                    src={displayedImageUrl}
                    alt={`${liveFrame.title || liveFrame.id} (${viewMode})`}
                    crossOrigin="anonymous"
                    onLoad={handleImageLoad}
                    draggable={false}
                    style={{
                      display: "block",
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      outline: imageOutline,
                      outlineOffset: "-1px",
                      pointerEvents: "none",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#FFFFFF",
                      fontSize: "13px",
                      padding: "20px",
                      textAlign: "center",
                    }}
                  >
                    Frame image not rendered yet. Click Regenerate whole frame to render.
                  </div>
                )}

                <canvas
                  ref={canvasRef}
                  className="frame-preview"
                  width={canvasDims.width}
                  height={canvasDims.height}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={commitDraftStroke}
                  onPointerCancel={commitDraftStroke}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    touchAction: "none",
                    cursor: "crosshair",
                    outline: imageOutline,
                    outlineOffset: "-1px",
                  }}
                />
              </div>
            </div>

            {/* Optional inline Pin callout notes when pins are placed */}
            {pinStrokes.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "var(--bg-subtle, #F7F6F3)",
                  border: "1px solid var(--border-divider, #EAEAEA)",
                }}
              >
                <span style={{ fontSize: "12px", fontWeight: 600 }}>Callout pin notes</span>
                {pinStrokes.map((pin, idx) => (
                  <div key={pin.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "9999px",
                        background: pin.color || "#E03E3E",
                        color: "#FFFFFF",
                        fontSize: "11px",
                        fontWeight: 600,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      aria-label={`Note for pin ${idx + 1}`}
                      value={pin.label || ""}
                      onChange={(e) => handlePinNoteChange(pin.id, e.target.value)}
                      placeholder={`Note for pin ${idx + 1} (e.g. Highlight discount pill)`}
                      style={{
                        flex: 1,
                        padding: "5px 8px",
                        fontSize: "12px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-divider, #EAEAEA)",
                        background: "var(--bg-surface, #FFFFFF)",
                        color: "var(--text-primary, #111111)",
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Action Bar, Versions, Save/Download & Fine-Tune Disclosure */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Action Bar Card */}
            <form
              onSubmit={handlePrimaryRegenerate}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                padding: "16px",
                borderRadius: "12px",
                border: "1px solid var(--border-divider, #EAEAEA)",
                background: "var(--bg-surface, #FFFFFF)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label htmlFor="frame-canvas-prompt" style={{ fontSize: "13px", fontWeight: 600 }}>
                  {strokes.length > 0 ? "Regional change instruction" : "Frame direction prompt"}
                </label>
                <input
                  id="frame-canvas-prompt"
                  ref={promptInputRef}
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe what to change in the marked area (or whole frame)..."
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    fontSize: "13px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-divider, #EAEAEA)",
                    background: "var(--bg-surface, #FFFFFF)",
                    color: "var(--text-primary, #111111)",
                  }}
                />
              </div>

              {/* Quick Suggestion Chips */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {QUICK_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleChipClick(chip)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "9999px",
                      fontSize: "12px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-subtle, #F7F6F3)",
                      color: "var(--text-primary, #111111)",
                      cursor: "pointer",
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {/* Zero-Cost Antigravity AI Art Inpaint Option */}
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12px",
                  color: "var(--text-muted, #787774)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={enqueueAiInpaint}
                  onChange={(e) => setEnqueueAiInpaint(e.target.checked)}
                />
                <span>Also queue Antigravity AI art inpaint ($0)</span>
              </label>

              {/* Primary Regenerate CTA + Save + Download */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "2px" }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                  style={{
                    flex: "1 1 210px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "7px",
                    padding: "10px 16px",
                    borderRadius: "6px",
                    border: "1px solid var(--cta-bg, #111111)",
                    background: "var(--cta-bg, #111111)",
                    color: "var(--cta-fg, #FFFFFF)",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: submitting ? "wait" : "pointer",
                    opacity: submitting ? 0.72 : 1,
                  }}
                >
                  <RenderIcon icon={SparklesIcon} size={15} />
                  <span>
                    {submitting
                      ? "Regenerating frame..."
                      : strokes.length > 0
                        ? "Regenerate marked area"
                        : "Regenerate whole frame"}
                  </span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={savingBookmark}
                  onClick={handleSaveBookmark}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-divider, #EAEAEA)",
                    background: "var(--bg-surface, #FFFFFF)",
                    color: "var(--text-primary, #111111)",
                    fontSize: "13px",
                    fontWeight: 500,
                    cursor: savingBookmark ? "wait" : "pointer",
                  }}
                >
                  <RenderIcon icon={Icons.Bookmark} size={14} />
                  <span>{savingBookmark ? "Saving..." : "Save frame"}</span>
                </button>

                {cleanFrameUrl && (
                  <a
                    href={displayedImageUrl || cleanFrameUrl}
                    download={downloadFilename}
                    className="btn btn-secondary"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "10px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                      fontSize: "13px",
                      fontWeight: 500,
                      textDecoration: "none",
                    }}
                  >
                    <RenderIcon icon={Icons.Download} size={14} />
                    <span>Download PNG</span>
                  </a>
                )}
              </div>
            </form>

            {/* Version History Pills & 1-Click Restore */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                padding: "14px 16px",
                borderRadius: "12px",
                border: "1px solid var(--border-divider, #EAEAEA)",
                background: "var(--bg-surface, #FFFFFF)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <span style={{ fontSize: "13px", fontWeight: 600 }}>Version history</span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--text-muted, #787774)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {versionNumbers.length === 1
                    ? "1 version saved"
                    : `${versionNumbers.length} versions saved`}
                </span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {versionNumbers.map((ver) => {
                  const isCurrent = Number(liveFrame.currentVersion || 1) === ver;
                  if (isCurrent) {
                    return (
                      <span
                        key={ver}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "5px 10px",
                          borderRadius: "9999px",
                          fontSize: "12px",
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                          background: "#111111",
                          color: "#FFFFFF",
                        }}
                      >
                        <RenderIcon icon={Icons.Check} size={12} />
                        <span>v{ver} · Current</span>
                      </span>
                    );
                  }
                  return (
                    <button
                      key={ver}
                      type="button"
                      disabled={restoringVersion !== null}
                      onClick={() => handleRestoreVersion(ver)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        padding: "5px 10px",
                        borderRadius: "9999px",
                        fontSize: "12px",
                        fontWeight: 500,
                        fontVariantNumeric: "tabular-nums",
                        border: "1px solid var(--border-divider, #EAEAEA)",
                        background: "var(--bg-subtle, #F7F6F3)",
                        color: "var(--text-primary, #111111)",
                        cursor: restoringVersion !== null ? "wait" : "pointer",
                      }}
                    >
                      <RenderIcon icon={Icons.Refresh || Icons.Undo} size={12} />
                      <span>
                        {restoringVersion === ver ? `Restoring v${ver}...` : `Restore v${ver}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Collapsible Fine-Tune Controls */}
            <details
              style={{
                borderRadius: "12px",
                border: "1px solid var(--border-divider, #EAEAEA)",
                background: "var(--bg-surface, #FFFFFF)",
                padding: "12px 16px",
              }}
            >
              <summary
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  listStyle: "none",
                }}
              >
                <RenderIcon icon={Icons.Sliders} size={15} />
                <span>Fine-tune text, camera, color look &amp; timing</span>
              </summary>

              <form
                onSubmit={handleApplyFineTune}
                style={{
                  marginTop: "14px",
                  paddingTop: "14px",
                  borderTop: "1px solid var(--border-divider, #EAEAEA)",
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "10px",
                }}
              >
                <div
                  style={{
                    gridColumn: "1 / -1",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <label htmlFor="ft-headline" style={{ fontSize: "12px", fontWeight: 500 }}>
                    Headline
                  </label>
                  <input
                    id="ft-headline"
                    type="text"
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    placeholder="Zero fare loss this winter"
                    style={{
                      padding: "7px 10px",
                      fontSize: "12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                    }}
                  />
                </div>

                <div
                  style={{
                    gridColumn: "1 / -1",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <label htmlFor="ft-subline" style={{ fontSize: "12px", fontWeight: 500 }}>
                    Subline
                  </label>
                  <input
                    id="ft-subline"
                    type="text"
                    value={subheadline}
                    onChange={(e) => setSubheadline(e.target.value)}
                    placeholder="Direct wholesale delivery with verified germination"
                    style={{
                      padding: "7px 10px",
                      fontSize: "12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                    }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label htmlFor="ft-badge" style={{ fontSize: "12px", fontWeight: 500 }}>
                    Badge
                  </label>
                  <input
                    id="ft-badge"
                    type="text"
                    value={badgeText}
                    onChange={(e) => setBadgeText(e.target.value)}
                    placeholder="FEATURED OFFER"
                    style={{
                      padding: "7px 10px",
                      fontSize: "12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                    }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label htmlFor="ft-color-look" style={{ fontSize: "12px", fontWeight: 500 }}>
                    Color look
                  </label>
                  <select
                    id="ft-color-look"
                    value={colorLook}
                    onChange={(e) => setColorLook(e.target.value)}
                    style={{
                      padding: "7px 10px",
                      fontSize: "12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                    }}
                  >
                    {availableColorLooks.map((look) => {
                      const id = typeof look === "string" ? look : look.id;
                      const name =
                        typeof look === "string" ? formatArchetypeLabel(look) : look.name;
                      return (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div
                  style={{
                    gridColumn: "1 / -1",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <label htmlFor="ft-vo" style={{ fontSize: "12px", fontWeight: 500 }}>
                    Voiceover script
                  </label>
                  <textarea
                    id="ft-vo"
                    rows={2}
                    value={voiceoverText}
                    onChange={(e) => setVoiceoverText(e.target.value)}
                    placeholder="Spoken narration and synchronized subtitle line for this scene"
                    style={{
                      padding: "7px 10px",
                      fontSize: "12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                      resize: "vertical",
                    }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label htmlFor="ft-camera" style={{ fontSize: "12px", fontWeight: 500 }}>
                    Camera motion preset
                  </label>
                  <select
                    id="ft-camera"
                    value={motionPreset}
                    onChange={(e) => setMotionPreset(e.target.value)}
                    style={{
                      padding: "7px 10px",
                      fontSize: "12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                    }}
                  >
                    {availableMotionPresets.map((preset) => {
                      const id = typeof preset === "string" ? preset : preset.id;
                      const name =
                        typeof preset === "string"
                          ? formatArchetypeLabel(preset)
                          : preset.name || formatArchetypeLabel(preset.id);
                      return (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label htmlFor="ft-layout" style={{ fontSize: "12px", fontWeight: 500 }}>
                    Layout archetype
                  </label>
                  <select
                    id="ft-layout"
                    value={layoutArchetype}
                    onChange={(e) => setLayoutArchetype(e.target.value)}
                    style={{
                      padding: "7px 10px",
                      fontSize: "12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                    }}
                  >
                    {availableArchetypes.map((arch) => {
                      const id = typeof arch === "string" ? arch : arch.id;
                      const name =
                        typeof arch === "string"
                          ? formatArchetypeLabel(arch)
                          : arch.name || formatArchetypeLabel(arch.id);
                      return (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label htmlFor="ft-speed" style={{ fontSize: "12px", fontWeight: 500 }}>
                    Speed ramp (x)
                  </label>
                  <input
                    id="ft-speed"
                    type="number"
                    min="0.25"
                    max="4"
                    step="0.05"
                    value={speedFactor}
                    onChange={(e) => setSpeedFactor(e.target.value)}
                    style={{
                      padding: "7px 10px",
                      fontSize: "12px",
                      fontVariantNumeric: "tabular-nums",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                    }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label htmlFor="ft-duration" style={{ fontSize: "12px", fontWeight: 500 }}>
                    Duration (sec)
                  </label>
                  <input
                    id="ft-duration"
                    type="number"
                    min="0.5"
                    max="30"
                    step="0.1"
                    value={durationSeconds}
                    onChange={(e) => setDurationSeconds(e.target.value)}
                    style={{
                      padding: "7px 10px",
                      fontSize: "12px",
                      fontVariantNumeric: "tabular-nums",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                    }}
                  />
                </div>

                <div style={{ gridColumn: "1 / -1", paddingTop: "4px" }}>
                  <button
                    type="submit"
                    disabled={applyingFineTune}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 14px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-subtle, #F7F6F3)",
                      color: "var(--text-primary, #111111)",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: applyingFineTune ? "wait" : "pointer",
                    }}
                  >
                    <RenderIcon icon={Icons.Check} size={14} />
                    <span>
                      {applyingFineTune ? "Applying changes..." : "Apply fine-tune settings"}
                    </span>
                  </button>
                </div>
              </form>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}

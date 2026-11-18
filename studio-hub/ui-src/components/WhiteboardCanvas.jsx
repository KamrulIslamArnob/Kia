import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useStudio, Icons } from "../store.jsx";
import { api, resolveMediaUrl } from "../api.js";

const NODE_WIDTH = 248;
const PORT_OFFSET_Y = 44;
const BOARD_HEIGHT = 460;

function buildCubicBezierPath(x1, y1, x2, y2) {
  const dx = Math.max(56, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function buildStarterGraph(footageItems) {
  const nodes = [];
  const edges = [];

  if (footageItems.length > 0) {
    const first = footageItems[0];
    const dur1 = Math.max(2, Math.min(8, Number(first.duration) || 4.5));
    nodes.push({
      id: "node_footage_1",
      type: "footage",
      x: 28,
      y: 36,
      title: first.name || "Clip 01",
      clipRelPath: first.relPath,
      trimRange: [0, Number(dur1.toFixed(1))],
      promptText: "",
    });
    edges.push({ id: "edge_starter_1", from: "node_footage_1", to: "node_scene_1" });

    if (footageItems.length > 1) {
      const second = footageItems[1];
      const dur2 = Math.max(2, Math.min(8, Number(second.duration) || 4.0));
      nodes.push({
        id: "node_footage_2",
        type: "footage",
        x: 28,
        y: 224,
        title: second.name || "Clip 02",
        clipRelPath: second.relPath,
        trimRange: [0, Number(dur2.toFixed(1))],
        promptText: "",
      });
      edges.push({ id: "edge_starter_2", from: "node_footage_2", to: "node_scene_1" });
    }
  } else {
    nodes.push({
      id: "node_footage_1",
      type: "footage",
      x: 28,
      y: 44,
      title: "Footage clip 01",
      clipRelPath: "",
      trimRange: [0, 4.0],
      promptText: "",
    });
    edges.push({ id: "edge_starter_1", from: "node_footage_1", to: "node_scene_1" });
  }

  nodes.push({
    id: "node_note_1",
    type: "note",
    x: 330,
    y: 44,
    title: "Direction note",
    clipRelPath: null,
    trimRange: null,
    promptText: "Trim dead pauses, bold headline, crisp zoom toward key action",
  });
  edges.push({ id: "edge_starter_note", from: "node_note_1", to: "node_scene_1" });

  nodes.push({
    id: "node_scene_1",
    type: "scene",
    x: 640,
    y: 118,
    title: "Compiled scene",
    clipRelPath: null,
    trimRange: null,
    promptText: "Connect these clips, trim dead pauses, whip-pan transition",
  });

  return { nodes, edges };
}

function normalizeGraphPayload(raw) {
  const g = raw?.graph && typeof raw.graph === "object" ? raw.graph : raw;
  const rawNodes = Array.isArray(g?.nodes) ? g.nodes : Array.isArray(raw?.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(g?.edges) ? g.edges : Array.isArray(raw?.edges) ? raw.edges : [];

  const nodes = rawNodes
    .filter((n) => n && typeof n === "object")
    .map((n, idx) => ({
      id: String(n.id || `node_${idx + 1}`),
      type: n.type === "note" || n.type === "scene" ? n.type : "footage",
      x: Number.isFinite(Number(n.x)) ? Number(n.x) : 32 + idx * 140,
      y: Number.isFinite(Number(n.y)) ? Number(n.y) : 48 + (idx % 2) * 120,
      title: String(n.title || (n.type === "note" ? "Sticky note" : "Node")),
      clipRelPath: n.clipRelPath || n.relPath || null,
      trimRange: Array.isArray(n.trimRange)
        ? [Number(n.trimRange[0]) || 0, Number(n.trimRange[1]) || 4]
        : n.type === "footage"
          ? [0, 4]
          : null,
      promptText: String(n.promptText ?? n.text ?? n.prompt ?? ""),
    }));

  const edges = rawEdges
    .filter((e) => e && (e.from || e.source) && (e.to || e.target))
    .map((e, idx) => ({
      id: String(e.id || `edge_${idx + 1}`),
      from: String(e.from || e.source),
      to: String(e.to || e.target),
    }));

  return { nodes, edges };
}

export function WhiteboardCanvas({ compact = false, onSceneCompiled }) {
  const { theme, activeSlug, project, setStep, refreshAll, notify } = useStudio();
  const isDark = theme === "dark";

  const footageCatalog = useMemo(() => {
    const rawList = Array.isArray(project?.files?.rawVideo) ? project.files.rawVideo : [];
    const clipList = Array.isArray(project?.files?.clips)
      ? project.files.clips.filter((c) => !String(c?.name || "").startsWith("shot_frame_"))
      : [];
    const seen = new Set();
    const out = [];
    for (const item of [...rawList, ...clipList]) {
      if (item?.relPath && !seen.has(item.relPath)) {
        seen.add(item.relPath);
        out.push(item);
      }
    }
    return out;
  }, [project?.files?.rawVideo, project?.files?.clips]);

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedSceneId, setSelectedSceneId] = useState("node_scene_1");
  const [scenePrompt, setScenePrompt] = useState(
    "Connect these clips, trim dead pauses, whip-pan transition",
  );
  const [transition, setTransition] = useState("cut");
  const [linkingFromId, setLinkingFromId] = useState(null);
  const [cursorBoardPt, setCursorBoardPt] = useState({ x: 0, y: 0 });
  const [savingBoard, setSavingBoard] = useState(false);
  const [compilingScene, setCompilingScene] = useState(false);
  const [compileError, setCompileError] = useState("");
  const [compiledResult, setCompiledResult] = useState(null);

  const boardRef = useRef(null);
  const dragStateRef = useRef(null);
  const seqRef = useRef(10);

  useEffect(() => {
    if (!activeSlug) return undefined;
    let cancelled = false;

    api(`/api/projects/${encodeURIComponent(activeSlug)}/whiteboard`)
      .then((res) => {
        if (cancelled) return;
        const parsed = normalizeGraphPayload(res);
        if (parsed.nodes.length > 0) {
          setNodes(parsed.nodes);
          setEdges(parsed.edges);
          const firstScene = parsed.nodes.find((n) => n.type === "scene");
          if (firstScene) {
            setSelectedSceneId(firstScene.id);
            if (firstScene.promptText) setScenePrompt(firstScene.promptText);
          }
        } else {
          const starter = buildStarterGraph(footageCatalog);
          setNodes(starter.nodes);
          setEdges(starter.edges);
          setSelectedSceneId("node_scene_1");
        }
      })
      .catch(() => {
        if (cancelled) return;
        const starter = buildStarterGraph(footageCatalog);
        setNodes(starter.nodes);
        setEdges(starter.edges);
        setSelectedSceneId("node_scene_1");
      });

    return () => {
      cancelled = true;
    };
  }, [activeSlug, footageCatalog]);

  const sceneNodes = useMemo(() => nodes.filter((n) => n.type === "scene"), [nodes]);
  const activeSceneNode = useMemo(
    () => sceneNodes.find((n) => n.id === selectedSceneId) || sceneNodes[0] || null,
    [sceneNodes, selectedSceneId],
  );

  const toBoardCoords = useCallback((clientX, clientY) => {
    const el = boardRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(clientX - rect.left + el.scrollLeft),
      y: Math.round(clientY - rect.top + el.scrollTop),
    };
  }, []);

  const handleNodeDragStart = (event, node) => {
    if (event.button !== undefined && event.button !== 0) return;
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") {
      return;
    }
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Safe fallback
    }
    const pt = toBoardCoords(event.clientX, event.clientY);
    dragStateRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      offsetX: pt.x - node.x,
      offsetY: pt.y - node.y,
    };
  };

  const handleNodeDragMove = (event) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pt = toBoardCoords(event.clientX, event.clientY);
    const nextX = Math.max(12, pt.x - drag.offsetX);
    const nextY = Math.max(12, Math.min(BOARD_HEIGHT - 96, pt.y - drag.offsetY));
    setNodes((prev) => prev.map((n) => (n.id === drag.nodeId ? { ...n, x: nextX, y: nextY } : n)));
  };

  const handleNodeDragEnd = (event) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Safe release
    }
    dragStateRef.current = null;
  };

  const handleBoardPointerMove = (event) => {
    if (!linkingFromId) return;
    setCursorBoardPt(toBoardCoords(event.clientX, event.clientY));
  };

  const updateNodeField = (nodeId, patch) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)));
  };

  const removeNode = (nodeId) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.from !== nodeId && e.to !== nodeId));
    if (linkingFromId === nodeId) setLinkingFromId(null);
  };

  const addNode = (type) => {
    seqRef.current += 1;
    const n = seqRef.current;
    if (type === "footage") {
      const clip =
        footageCatalog[
          nodes.filter((x) => x.type === "footage").length % Math.max(1, footageCatalog.length)
        ];
      const newId = `node_footage_${n}`;
      setNodes((prev) => [
        ...prev,
        {
          id: newId,
          type: "footage",
          x: 36 + ((n * 24) % 140),
          y: 44 + ((n * 38) % 220),
          title: clip?.name || `Footage ${n}`,
          clipRelPath: clip?.relPath || "",
          trimRange: [0, Math.max(2, Math.min(8, Number(clip?.duration) || 4))],
          promptText: "",
        },
      ]);
      if (activeSceneNode) {
        setEdges((prev) => [...prev, { id: `edge_${n}`, from: newId, to: activeSceneNode.id }]);
      }
    } else if (type === "note") {
      const newId = `node_note_${n}`;
      setNodes((prev) => [
        ...prev,
        {
          id: newId,
          type: "note",
          x: 320 + ((n * 20) % 120),
          y: 52 + ((n * 36) % 200),
          title: `Note ${n}`,
          clipRelPath: null,
          trimRange: null,
          promptText: "Highlight offer badge and punch in smoothly",
        },
      ]);
      if (activeSceneNode) {
        setEdges((prev) => [...prev, { id: `edge_${n}`, from: newId, to: activeSceneNode.id }]);
      }
    } else {
      const newId = `node_scene_${n}`;
      setNodes((prev) => [
        ...prev,
        {
          id: newId,
          type: "scene",
          x: 640,
          y: 140 + ((n * 30) % 160),
          title: `Scene ${sceneNodes.length + 1}`,
          clipRelPath: null,
          trimRange: null,
          promptText: scenePrompt,
        },
      ]);
      setSelectedSceneId(newId);
    }
  };

  const handleStartLinkFromPort = (event, fromNode) => {
    event.stopPropagation();
    if (linkingFromId === fromNode.id) {
      setLinkingFromId(null);
      return;
    }
    setLinkingFromId(fromNode.id);
    setCursorBoardPt({ x: fromNode.x + NODE_WIDTH, y: fromNode.y + PORT_OFFSET_Y });
  };

  const handleCompleteLinkAtScenePort = (event, targetSceneNode) => {
    event.stopPropagation();
    if (!linkingFromId || linkingFromId === targetSceneNode.id) return;
    setEdges((prev) => {
      const exists = prev.some((e) => e.from === linkingFromId && e.to === targetSceneNode.id);
      if (exists) return prev;
      seqRef.current += 1;
      return [
        ...prev,
        { id: `edge_${seqRef.current}`, from: linkingFromId, to: targetSceneNode.id },
      ];
    });
    setSelectedSceneId(targetSceneNode.id);
    setLinkingFromId(null);
  };

  const removeEdge = (edgeId) => {
    setEdges((prev) => prev.filter((e) => e.id !== edgeId));
  };

  const persistBoard = async () => {
    if (!activeSlug || savingBoard) return;
    setSavingBoard(true);
    setCompileError("");
    try {
      const syncedNodes = nodes.map((n) =>
        n.id === activeSceneNode?.id ? { ...n, promptText: scenePrompt } : n,
      );
      await api(`/api/projects/${encodeURIComponent(activeSlug)}/whiteboard`, {
        method: "POST",
        body: { nodes: syncedNodes, edges },
      });
      notify?.("Saved scene whiteboard.", "success");
    } catch (err) {
      setCompileError(err?.message || "Unable to save whiteboard.");
    } finally {
      setSavingBoard(false);
    }
  };

  const handleCompileScene = async (event) => {
    event.preventDefault();
    if (!activeSlug || compilingScene) return;

    const targetId = activeSceneNode?.id || null;
    const connectedIds = edges.filter((e) => !targetId || e.to === targetId).map((e) => e.from);

    setCompileError("");
    setCompilingScene(true);
    try {
      const syncedNodes = nodes.map((n) =>
        n.id === targetId ? { ...n, promptText: scenePrompt } : n,
      );
      const graphPayload = { nodes: syncedNodes, edges };

      await api(`/api/projects/${encodeURIComponent(activeSlug)}/whiteboard`, {
        method: "POST",
        body: graphPayload,
      }).catch(() => {
        // compile-scene also accepts graph directly in body
      });

      const res = await api(
        `/api/projects/${encodeURIComponent(activeSlug)}/whiteboard/compile-scene`,
        {
          method: "POST",
          body: {
            sceneNodeId: targetId,
            nodeIds: connectedIds.length > 0 ? connectedIds : syncedNodes.map((n) => n.id),
            prompt: scenePrompt.trim(),
            transition,
            graph: graphPayload,
          },
        },
      );

      setCompiledResult(res);
      await refreshAll?.(activeSlug);
      notify?.("Created storyboard scene from connected whiteboard nodes.", "success");
      onSceneCompiled?.(res);
    } catch (err) {
      setCompileError(
        err?.message ||
          "Unable to create scene from connected nodes. Ensure at least one footage clip is uploaded.",
      );
    } finally {
      setCompilingScene(false);
    }
  };

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const linkingSourceNode = linkingFromId ? nodeMap.get(linkingFromId) : null;

  const connectedCountForActiveScene = useMemo(() => {
    if (!activeSceneNode) return 0;
    return edges.filter((e) => e.to === activeSceneNode.id).length;
  }, [edges, activeSceneNode]);

  const compiledPreviewUrl = resolveMediaUrl(
    activeSlug,
    compiledResult?.frame?.designFrameUrl ||
      compiledResult?.frame?.currentDesignImage ||
      compiledResult?.frame?.designFramePath,
    Date.now(),
  );
  const imageOutline = isDark ? "1px solid oklch(1 0 0 / 0.1)" : "1px solid oklch(0 0 0 / 0.1)";
  const SparklesIcon = Icons.Sparkles || Icons.Wand || Icons.Layers;

  return (
    <section
      className={`studio-card whiteboard-canvas-card ${compact ? "is-compact" : ""}`}
      aria-label="Scene whiteboard builder"
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
      {/* Whiteboard Top Toolbar */}
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
            Scene whiteboard
          </h3>
          <p
            style={{
              margin: "2px 0 0 0",
              fontSize: "12px",
              color: "var(--text-secondary, #6E6D6A)",
            }}
          >
            Arrange footage clips and sticky prompt notes, wire their output ports into a scene
            node, and stitch them into a 1080p storyboard shot.
          </p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          <button
            type="button"
            onClick={() => addNode("footage")}
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
              cursor: "pointer",
            }}
          >
            <Icons.Plus width={13} height={13} />
            <span>Add footage card</span>
          </button>

          <button
            type="button"
            onClick={() => addNode("note")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid var(--border-divider, #EAEAEA)",
              background: "var(--tag-yellow-bg, #FBF3DB)",
              color: "var(--tag-yellow-fg, #956400)",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <Icons.Plus width={13} height={13} />
            <span>Add sticky note</span>
          </button>

          <button
            type="button"
            onClick={() => addNode("scene")}
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
              cursor: "pointer",
            }}
          >
            <Icons.Layers width={13} height={13} />
            <span>Add scene node</span>
          </button>

          <button
            type="button"
            disabled={savingBoard}
            onClick={persistBoard}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid var(--border-divider, #EAEAEA)",
              background: "var(--bg-subtle, #F4F3EF)",
              color: "var(--text-primary, #111111)",
              fontSize: "12px",
              fontWeight: 500,
              cursor: savingBoard ? "wait" : "pointer",
            }}
          >
            <Icons.Check width={13} height={13} />
            <span>{savingBoard ? "Saving..." : "Save board"}</span>
          </button>
        </div>
      </div>

      {linkingFromId && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            borderRadius: "6px",
            background: "var(--tag-blue-bg, #E1F3FE)",
            color: "var(--tag-blue-fg, #1F6C9F)",
            fontSize: "12px",
          }}
        >
          <span>Click any Scene node&apos;s left input port to connect this wire.</span>
          <button
            type="button"
            onClick={() => setLinkingFromId(null)}
            style={{
              border: "none",
              background: "transparent",
              color: "inherit",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel wire
          </button>
        </div>
      )}

      {/* Interactive Dotted-Grid Board + SVG Cubic Bezier Wires */}
      <div
        ref={boardRef}
        onPointerMove={handleBoardPointerMove}
        onClick={() => {
          if (linkingFromId) setLinkingFromId(null);
        }}
        style={{
          position: "relative",
          width: "100%",
          height: `${BOARD_HEIGHT}px`,
          overflow: "auto",
          borderRadius: "10px",
          border: "1px solid var(--border-divider, #EAEAEA)",
          background: "var(--bg-canvas, #FBFBFA)",
        }}
      >
        <div style={{ position: "relative", minWidth: "940px", height: "100%" }}>
          {/* SVG Pattern Dotted Grid + Bezier Wires (Zero CSS Gradients) */}
          <svg
            width="100%"
            height="100%"
            style={{
              position: "absolute",
              inset: 0,
              color: isDark ? "oklch(1 0 0 / 0.14)" : "oklch(0 0 0 / 0.12)",
            }}
          >
            <defs>
              <pattern id="studio-wb-dot-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.15" fill="currentColor" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#studio-wb-dot-grid)" />

            {edges.map((edge) => {
              const src = nodeMap.get(edge.from);
              const dst = nodeMap.get(edge.to);
              if (!src || !dst) return null;
              const x1 = src.x + NODE_WIDTH;
              const y1 = src.y + PORT_OFFSET_Y;
              const x2 = dst.x;
              const y2 = dst.y + PORT_OFFSET_Y;
              const d = buildCubicBezierPath(x1, y1, x2, y2);
              return (
                <g key={edge.id}>
                  <path
                    d={d}
                    fill="none"
                    stroke={isDark ? "#F4F4F5" : "#111111"}
                    strokeWidth="2"
                    strokeOpacity="0.65"
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="12"
                    style={{ cursor: "pointer" }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      removeEdge(edge.id);
                    }}
                  >
                    <title>Click wire to disconnect</title>
                  </path>
                </g>
              );
            })}

            {linkingSourceNode && (
              <path
                d={buildCubicBezierPath(
                  linkingSourceNode.x + NODE_WIDTH,
                  linkingSourceNode.y + PORT_OFFSET_Y,
                  cursorBoardPt.x,
                  cursorBoardPt.y,
                )}
                fill="none"
                stroke="#2563EB"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
            )}
          </svg>

          {/* Draggable Board Nodes */}
          {nodes.map((node) => {
            const isNote = node.type === "note";
            const isScene = node.type === "scene";
            const isActiveScene = isScene && activeSceneNode?.id === node.id;

            return (
              <div
                key={node.id}
                onPointerDown={(ev) => handleNodeDragStart(ev, node)}
                onPointerMove={handleNodeDragMove}
                onPointerUp={handleNodeDragEnd}
                onPointerCancel={handleNodeDragEnd}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (isScene) setSelectedSceneId(node.id);
                }}
                style={{
                  position: "absolute",
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: `${NODE_WIDTH}px`,
                  borderRadius: "10px",
                  padding: "10px 12px",
                  background: isNote
                    ? "var(--tag-yellow-bg, #FBF3DB)"
                    : "var(--bg-surface, #FFFFFF)",
                  color: "var(--text-primary, #111111)",
                  border: isActiveScene
                    ? "1.5px solid var(--cta-bg, #111111)"
                    : "1px solid var(--border-divider, #EAEAEA)",
                  boxShadow: "var(--shadow-border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  cursor: "grab",
                  userSelect: "none",
                }}
              >
                {/* Scene Left Input Port */}
                {isScene && (
                  <button
                    type="button"
                    aria-label={`Connect wire into ${node.title}`}
                    title="Scene input port (click to finish connecting wire)"
                    onClick={(ev) => handleCompleteLinkAtScenePort(ev, node)}
                    style={{
                      position: "absolute",
                      left: "-9px",
                      top: `${PORT_OFFSET_Y - 8}px`,
                      width: "16px",
                      height: "16px",
                      borderRadius: "9999px",
                      border: "2px solid var(--bg-surface, #FFFFFF)",
                      background: linkingFromId ? "#2563EB" : "var(--cta-bg, #111111)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                )}

                {/* Footage / Note Right Output Port */}
                {!isScene && (
                  <button
                    type="button"
                    aria-label={`Start connection wire from ${node.title}`}
                    title="Output port (click, then click a Scene input port)"
                    onClick={(ev) => handleStartLinkFromPort(ev, node)}
                    style={{
                      position: "absolute",
                      right: "-9px",
                      top: `${PORT_OFFSET_Y - 8}px`,
                      width: "16px",
                      height: "16px",
                      borderRadius: "9999px",
                      border: "2px solid var(--bg-surface, #FFFFFF)",
                      background: linkingFromId === node.id ? "#2563EB" : "var(--cta-bg, #111111)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                )}

                {/* Node Card Header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: isNote
                        ? "var(--tag-yellow-fg, #956400)"
                        : "var(--text-muted, #787774)",
                    }}
                  >
                    {isScene ? "Scene node" : isNote ? "Sticky note" : "Footage clip"}
                  </span>

                  <button
                    type="button"
                    aria-label={`Remove ${node.title}`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      removeNode(node.id);
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--text-muted, #787774)",
                      padding: "2px",
                      cursor: "pointer",
                      display: "inline-flex",
                    }}
                  >
                    <Icons.X width={12} height={12} />
                  </button>
                </div>

                {/* Footage Node Controls */}
                {node.type === "footage" && (
                  <>
                    {footageCatalog.length > 0 ? (
                      <select
                        aria-label="Select footage clip"
                        value={node.clipRelPath || ""}
                        onChange={(e) => {
                          const chosen = footageCatalog.find((c) => c.relPath === e.target.value);
                          updateNodeField(node.id, {
                            clipRelPath: e.target.value,
                            title: chosen?.name || node.title,
                          });
                        }}
                        style={{
                          width: "100%",
                          padding: "5px 7px",
                          fontSize: "11px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-input, #DCDBD6)",
                          background: "var(--bg-surface, #FFFFFF)",
                          color: "var(--text-primary, #111111)",
                        }}
                      >
                        <option value="">Choose uploaded clip...</option>
                        {footageCatalog.map((clip) => (
                          <option key={clip.relPath} value={clip.relPath}>
                            {clip.name || clip.relPath}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        aria-label="Clip relative path"
                        value={node.clipRelPath || ""}
                        onChange={(e) => updateNodeField(node.id, { clipRelPath: e.target.value })}
                        placeholder="inbox/raw-video/clip.mp4"
                        style={{
                          width: "100%",
                          padding: "5px 7px",
                          fontSize: "11px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-input, #DCDBD6)",
                          background: "var(--bg-surface, #FFFFFF)",
                          color: "var(--text-primary, #111111)",
                        }}
                      />
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                      <label style={{ fontSize: "10px", color: "var(--text-muted, #787774)" }}>
                        In (s)
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={node.trimRange?.[0] ?? 0}
                          onChange={(e) =>
                            updateNodeField(node.id, {
                              trimRange: [
                                Math.max(0, Number(e.target.value) || 0),
                                node.trimRange?.[1] ?? 4,
                              ],
                            })
                          }
                          style={{
                            width: "100%",
                            marginTop: "2px",
                            padding: "4px 6px",
                            fontSize: "11px",
                            fontVariantNumeric: "tabular-nums",
                            borderRadius: "5px",
                            border: "1px solid var(--border-input, #DCDBD6)",
                            background: "var(--bg-surface, #FFFFFF)",
                            color: "var(--text-primary, #111111)",
                          }}
                        />
                      </label>
                      <label style={{ fontSize: "10px", color: "var(--text-muted, #787774)" }}>
                        Out (s)
                        <input
                          type="number"
                          min="0.5"
                          step="0.1"
                          value={node.trimRange?.[1] ?? 4}
                          onChange={(e) =>
                            updateNodeField(node.id, {
                              trimRange: [
                                node.trimRange?.[0] ?? 0,
                                Math.max(0.5, Number(e.target.value) || 4),
                              ],
                            })
                          }
                          style={{
                            width: "100%",
                            marginTop: "2px",
                            padding: "4px 6px",
                            fontSize: "11px",
                            fontVariantNumeric: "tabular-nums",
                            borderRadius: "5px",
                            border: "1px solid var(--border-input, #DCDBD6)",
                            background: "var(--bg-surface, #FFFFFF)",
                            color: "var(--text-primary, #111111)",
                          }}
                        />
                      </label>
                    </div>
                  </>
                )}

                {/* Sticky Note Controls */}
                {isNote && (
                  <textarea
                    rows={3}
                    aria-label="Sticky note prompt"
                    value={node.promptText || ""}
                    onChange={(e) => updateNodeField(node.id, { promptText: e.target.value })}
                    placeholder="Write camera, trim, or headline direction..."
                    style={{
                      width: "100%",
                      padding: "6px 7px",
                      fontSize: "11px",
                      lineHeight: 1.4,
                      borderRadius: "6px",
                      border: "1px solid oklch(0 0 0 / 0.12)",
                      background: "var(--bg-surface, #FFFFFF)",
                      color: "var(--text-primary, #111111)",
                      resize: "vertical",
                    }}
                  />
                )}

                {/* Scene Target Node Summary */}
                {isScene && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <input
                      type="text"
                      aria-label="Scene node title"
                      value={node.title || ""}
                      onChange={(e) => updateNodeField(node.id, { title: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "5px 7px",
                        fontSize: "12px",
                        fontWeight: 600,
                        borderRadius: "6px",
                        border: "1px solid var(--border-input, #DCDBD6)",
                        background: "var(--bg-surface, #FFFFFF)",
                        color: "var(--text-primary, #111111)",
                      }}
                    />
                    <span
                      style={{
                        fontSize: "11px",
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--text-secondary, #6E6D6A)",
                      }}
                    >
                      {edges.filter((e) => e.to === node.id).length} connected inputs
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scene Prompt & 1-Click Compile Bar */}
      <form
        onSubmit={handleCompileScene}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: "10px",
          padding: "12px",
          borderRadius: "10px",
          background: "var(--bg-subtle, #F4F3EF)",
          border: "1px solid var(--border-divider, #EAEAEA)",
        }}
      >
        <div style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: "4px" }}>
          <label htmlFor="wb-scene-prompt" style={{ fontSize: "12px", fontWeight: 500 }}>
            Scene direction ({connectedCountForActiveScene} connected{" "}
            {connectedCountForActiveScene === 1 ? "node" : "nodes"})
          </label>
          <input
            id="wb-scene-prompt"
            type="text"
            value={scenePrompt}
            onChange={(e) => setScenePrompt(e.target.value)}
            placeholder="Connect these clips, trim dead pauses, whip-pan transition"
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: "12px",
              borderRadius: "6px",
              border: "1px solid var(--border-input, #DCDBD6)",
              background: "var(--bg-surface, #FFFFFF)",
              color: "var(--text-primary, #111111)",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label htmlFor="wb-transition-select" style={{ fontSize: "12px", fontWeight: 500 }}>
            Stitch seam
          </label>
          <select
            id="wb-transition-select"
            value={transition}
            onChange={(e) => setTransition(e.target.value)}
            style={{
              padding: "8px 10px",
              fontSize: "12px",
              borderRadius: "6px",
              border: "1px solid var(--border-input, #DCDBD6)",
              background: "var(--bg-surface, #FFFFFF)",
              color: "var(--text-primary, #111111)",
            }}
          >
            <option value="cut">Hard cut</option>
            <option value="crossfade">Crossfade</option>
          </select>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={compilingScene || !activeSlug}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "7px",
            padding: "9px 14px",
            borderRadius: "6px",
            border: "1px solid var(--cta-bg, #111111)",
            background: "var(--cta-bg, #111111)",
            color: "var(--cta-fg, #FFFFFF)",
            fontSize: "12px",
            fontWeight: 600,
            cursor: compilingScene ? "wait" : "pointer",
          }}
        >
          <SparklesIcon width={14} height={14} />
          <span>
            {compilingScene ? "Stitching connected scene..." : "Create scene from connected nodes"}
          </span>
        </button>
      </form>

      {compileError && (
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
          {compileError}
        </div>
      )}

      {/* Compiled Scene Output Strip */}
      {compiledResult?.frame && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "8px 12px 8px 8px",
            borderRadius: "16px",
            background: "var(--bg-subtle, #F4F3EF)",
            border: "1px solid var(--border-divider, #EAEAEA)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {compiledPreviewUrl && (
              <img
                src={compiledPreviewUrl}
                alt={compiledResult.frame.title || "Compiled scene"}
                style={{
                  width: "56px",
                  height: "76px",
                  objectFit: "cover",
                  borderRadius: "8px",
                  outline: imageOutline,
                  outlineOffset: "-1px",
                }}
              />
            )}
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600 }}>
                {compiledResult.frame.title || compiledResult.frame.id}
              </div>
              <div
                style={{
                  fontSize: "11px",
                  fontFamily: 'var(--font-mono, "Geist Mono", "SF Mono", monospace)',
                  color: "var(--text-secondary, #6E6D6A)",
                }}
              >
                {compiledResult.compiledClipRelPath || "Added to storyboard"}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStep?.(4)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "7px 12px",
              borderRadius: "6px",
              border: "1px solid var(--border-divider, #EAEAEA)",
              background: "var(--bg-surface, #FFFFFF)",
              color: "var(--text-primary, #111111)",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <span>View in Design frames</span>
            <Icons.ChevronRight width={13} height={13} />
          </button>
        </div>
      )}
    </section>
  );
}

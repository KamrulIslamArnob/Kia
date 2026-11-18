import fs from "node:fs";
import path from "node:path";
import {
  PROJECTS_DIR,
  assertValidSlug,
  ensureProjectDirs,
  probeMedia,
  runCommand,
  syncProjectManifest,
} from "./lib.mjs";
import {
  LAYOUT_ARCHETYPES,
  getMotionPreset,
  loadStoryboard,
  parseFramePrompt,
  regenerateFrame,
  saveStoryboard,
} from "./storyboard.mjs";

const VALID_NODE_TYPES = new Set(["footage", "note", "scene"]);
const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

function round3(num) {
  return Math.round(Number(num || 0) * 1000) / 1000;
}

function sanitizeIdToken(raw, fallback = "node_1") {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function resolveProjectRoot(slug, options = {}) {
  if (!slug || !SAFE_SLUG_RE.test(String(slug))) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  if (options?.projectsDir) {
    const base = path.resolve(options.projectsDir);
    const resolved = path.resolve(base, String(slug));
    if (!resolved.startsWith(base + path.sep)) {
      throw new Error(`Unsafe project path: ${slug}`);
    }
    fs.mkdirSync(path.join(resolved, ".studio"), { recursive: true });
    return resolved;
  }
  return assertValidSlug(slug);
}

function ensureWhiteboardProjectRoot(slug, options = {}) {
  if (options?.projectsDir && path.resolve(options.projectsDir) !== path.resolve(PROJECTS_DIR)) {
    const dir = resolveProjectRoot(slug, options);
    for (const sub of [
      "inbox/raw-video",
      "assets/clips",
      ".studio/frames/raw",
      ".studio/frames/design",
      ".studio/frames/tmp",
    ]) {
      fs.mkdirSync(path.join(dir, sub), { recursive: true });
    }
    return dir;
  }
  return ensureProjectDirs(slug);
}

function normalizeRelMediaPath(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!cleaned) return null;
  const segments = cleaned.split("/");
  if (segments.includes("..")) return null;
  return cleaned;
}

function normalizeTrimRange(raw) {
  if (!raw) return null;
  let startVal;
  let endVal;
  if (Array.isArray(raw) && raw.length >= 2) {
    startVal = Number(raw[0]);
    endVal = Number(raw[1]);
  } else if (typeof raw === "object") {
    startVal = Number(raw.start ?? raw.startTime ?? raw[0]);
    endVal = Number(raw.end ?? raw.endTime ?? raw[1]);
  } else {
    return null;
  }

  if (!Number.isFinite(startVal) || !Number.isFinite(endVal)) return null;
  const start = Math.max(0, round3(startVal));
  const end = round3(endVal);
  if (end <= start) return null;
  return [start, end];
}

function defaultTitleForType(type, index) {
  if (type === "footage") return `Footage ${index + 1}`;
  if (type === "scene") return `Scene ${index + 1}`;
  return `Note ${index + 1}`;
}

function normalizeNode(rawNode, index) {
  const n = rawNode && typeof rawNode === "object" ? rawNode : {};
  const clipRelPath = normalizeRelMediaPath(n.clipRelPath ?? n.relPath ?? n.sourceClip ?? null);
  const rawType = String(n.type || "")
    .trim()
    .toLowerCase();
  const type = VALID_NODE_TYPES.has(rawType) ? rawType : clipRelPath ? "footage" : "note";

  const id = sanitizeIdToken(n.id, `node_${type}_${index + 1}`);
  const x = Number.isFinite(Number(n.x)) ? round2(Number(n.x)) : index * 220;
  const y = Number.isFinite(Number(n.y)) ? round2(Number(n.y)) : 120;
  const title =
    String(n.title ?? n.label ?? n.name ?? "").trim() || defaultTitleForType(type, index);
  const trimRange = normalizeTrimRange(n.trimRange);
  const promptText = String(n.promptText ?? n.text ?? n.prompt ?? "");

  const normalized = {
    id,
    type,
    x,
    y,
    title,
    clipRelPath: type === "footage" ? clipRelPath : clipRelPath || null,
    trimRange,
    promptText,
  };

  if (n.frameId && typeof n.frameId === "string") {
    normalized.frameId = sanitizeIdToken(n.frameId, "");
  }
  if (n.compiledClipRelPath && typeof n.compiledClipRelPath === "string") {
    const cleanCompiled = normalizeRelMediaPath(n.compiledClipRelPath);
    if (cleanCompiled) normalized.compiledClipRelPath = cleanCompiled;
  }
  if (n.transition === "cut" || n.transition === "crossfade") {
    normalized.transition = n.transition;
  }
  if (n.trimDeadAir !== undefined) {
    normalized.trimDeadAir = Boolean(n.trimDeadAir);
  }

  return normalized;
}

function normalizeEdges(rawEdges) {
  if (!Array.isArray(rawEdges)) return [];
  const edges = [];
  const seenPairs = new Set();

  for (let i = 0; i < rawEdges.length; i += 1) {
    const e = rawEdges[i];
    if (!e || typeof e !== "object") continue;
    const from = sanitizeIdToken(e.from ?? e.source ?? "", "");
    const to = sanitizeIdToken(e.to ?? e.target ?? "", "");
    if (!from || !to || from === to) continue;

    const pairKey = `${from}->${to}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    edges.push({
      id: sanitizeIdToken(e.id, `edge_${edges.length + 1}`),
      from,
      to,
    });
  }

  return edges;
}

function normalizeGraphPayload(slug, rawGraph = {}) {
  const unwrapped =
    rawGraph && typeof rawGraph === "object" && rawGraph.graph && typeof rawGraph.graph === "object"
      ? rawGraph.graph
      : rawGraph && typeof rawGraph === "object"
        ? rawGraph
        : {};

  const rawNodes = Array.isArray(unwrapped.nodes) ? unwrapped.nodes : [];
  const usedIds = new Set();
  const nodes = [];

  for (let i = 0; i < rawNodes.length; i += 1) {
    const normalized = normalizeNode(rawNodes[i], i);
    let uniqueId = normalized.id;
    let suffix = 2;
    while (usedIds.has(uniqueId)) {
      uniqueId = `${normalized.id}_${suffix}`;
      suffix += 1;
    }
    usedIds.add(uniqueId);
    normalized.id = uniqueId;
    nodes.push(normalized);
  }

  const edges = normalizeEdges(unwrapped.edges);

  return {
    schemaVersion: 1,
    slug,
    nodes,
    edges,
    updatedAt: unwrapped.updatedAt || new Date().toISOString(),
  };
}

export function loadWhiteboardGraph(slug, options = {}) {
  const projectDir = resolveProjectRoot(slug, options);
  const wbPath = path.join(projectDir, ".studio", "whiteboard.json");
  if (!fs.existsSync(wbPath)) {
    return {
      schemaVersion: 1,
      slug,
      nodes: [],
      edges: [],
      updatedAt: new Date().toISOString(),
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(wbPath, "utf8"));
    return normalizeGraphPayload(slug, raw);
  } catch {
    return {
      schemaVersion: 1,
      slug,
      nodes: [],
      edges: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

export function saveWhiteboardGraph(slug, graph = {}, options = {}) {
  const projectDir = ensureWhiteboardProjectRoot(slug, options);
  const normalized = normalizeGraphPayload(slug, {
    ...graph,
    updatedAt: new Date().toISOString(),
  });
  const wbPath = path.join(projectDir, ".studio", "whiteboard.json");
  fs.mkdirSync(path.dirname(wbPath), { recursive: true });
  fs.writeFileSync(wbPath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  return normalized;
}

function collectConnectedInputNodes({ graph, sceneNode, explicitNodeIds }) {
  const nodeById = new Map(graph.nodes.map((n, index) => [n.id, { node: n, index }]));

  const reverseAdj = new Map();
  for (const edge of graph.edges) {
    if (!reverseAdj.has(edge.to)) reverseAdj.set(edge.to, []);
    reverseAdj.get(edge.to).push(edge.from);
  }

  const visited = new Set([sceneNode.id]);
  const upstreamIds = new Set();
  const queue = [...(reverseAdj.get(sceneNode.id) || [])];

  while (queue.length > 0) {
    const curr = queue.shift();
    if (!curr || visited.has(curr)) continue;
    visited.add(curr);
    if (nodeById.has(curr)) {
      upstreamIds.add(curr);
      for (const prev of reverseAdj.get(curr) || []) {
        if (!visited.has(prev)) queue.push(prev);
      }
    }
  }

  if (Array.isArray(explicitNodeIds) && explicitNodeIds.length > 0) {
    for (const rawId of explicitNodeIds) {
      const cleanId = sanitizeIdToken(rawId, "");
      if (cleanId && cleanId !== sceneNode.id && nodeById.has(cleanId)) {
        upstreamIds.add(cleanId);
      }
    }
  }

  if (upstreamIds.size === 0 && graph.edges.length === 0) {
    for (const n of graph.nodes) {
      if (n.id !== sceneNode.id && (n.type === "footage" || n.type === "note")) {
        upstreamIds.add(n.id);
      }
    }
  }

  // Topological sort over the induced upstream subgraph with (x, y, index) tie-breaking
  const inDegree = new Map();
  const forwardAdj = new Map();
  for (const id of upstreamIds) {
    inDegree.set(id, 0);
    forwardAdj.set(id, []);
  }
  for (const edge of graph.edges) {
    if (upstreamIds.has(edge.from) && upstreamIds.has(edge.to)) {
      forwardAdj.get(edge.from).push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }
  }

  const compareIds = (idA, idB) => {
    const a = nodeById.get(idA);
    const b = nodeById.get(idB);
    if (a.node.x !== b.node.x) return a.node.x - b.node.x;
    if (a.node.y !== b.node.y) return a.node.y - b.node.y;
    return a.index - b.index;
  };

  const ready = [...upstreamIds].filter((id) => (inDegree.get(id) || 0) === 0).sort(compareIds);
  const ordered = [];
  const emitted = new Set();

  while (ready.length > 0) {
    const nextId = ready.shift();
    if (!nextId || emitted.has(nextId)) continue;
    emitted.add(nextId);
    ordered.push(nodeById.get(nextId).node);

    for (const neighbor of forwardAdj.get(nextId) || []) {
      const nextDeg = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, nextDeg);
      if (nextDeg === 0 && !emitted.has(neighbor)) {
        ready.push(neighbor);
        ready.sort(compareIds);
      }
    }
  }

  // Fallback for cyclic graphs: append any remaining un-emitted upstream nodes by (x, y)
  if (emitted.size < upstreamIds.size) {
    const remaining = [...upstreamIds].filter((id) => !emitted.has(id)).sort(compareIds);
    for (const id of remaining) {
      ordered.push(nodeById.get(id).node);
    }
  }

  return ordered;
}

function resolveConfinedAssetFile(projectDir, relPath) {
  const cleanRel = normalizeRelMediaPath(relPath);
  if (!cleanRel) return null;
  const abs = path.resolve(projectDir, cleanRel);
  if (!abs.startsWith(projectDir + path.sep)) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return { abs, rel: cleanRel };
}

async function detectNonSilentSegments(absClipPath, totalDuration) {
  const res = await runCommand(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      absClipPath,
      "-af",
      "silencedetect=noise=-35dB:d=0.35",
      "-f",
      "null",
      "-",
    ],
    { shell: false },
  );

  const log = `${res.stderr || ""}\n${res.stdout || ""}`;
  const silences = [];
  let pendingStart = null;

  for (const line of log.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (startMatch) {
      pendingStart = clamp(Number(startMatch[1]) || 0, 0, totalDuration);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (endMatch) {
      const sEnd = clamp(Number(endMatch[1]) || 0, 0, totalDuration);
      const sStart = pendingStart !== null ? pendingStart : 0;
      if (sEnd > sStart + 0.05) {
        silences.push([sStart, sEnd]);
      }
      pendingStart = null;
    }
  }

  if (pendingStart !== null && totalDuration > pendingStart + 0.05) {
    silences.push([pendingStart, totalDuration]);
  }

  if (silences.length === 0) {
    return [{ start: 0, end: round3(totalDuration) }];
  }

  silences.sort((a, b) => a[0] - b[0]);
  const active = [];
  let cursor = 0;

  for (const [sStart, sEnd] of silences) {
    if (sStart > cursor + 0.12) {
      active.push([
        round3(Math.max(0, cursor - 0.05)),
        round3(Math.min(totalDuration, sStart + 0.05)),
      ]);
    }
    cursor = Math.max(cursor, sEnd);
  }
  if (totalDuration > cursor + 0.12) {
    active.push([round3(Math.max(0, cursor - 0.05)), round3(totalDuration)]);
  }

  // Merge adjacent padded intervals and drop tiny blips
  const merged = [];
  for (const [segStart, segEnd] of active) {
    if (segEnd - segStart < 0.18) continue;
    const prev = merged[merged.length - 1];
    if (prev && segStart <= prev.end + 0.12) {
      prev.end = round3(Math.max(prev.end, segEnd));
    } else {
      merged.push({ start: segStart, end: segEnd });
    }
  }

  const activeSum = merged.reduce((acc, s) => acc + (s.end - s.start), 0);
  if (merged.length === 0 || activeSum < 0.25) {
    return [{ start: 0, end: round3(totalDuration) }];
  }

  return merged;
}

async function buildNormalizedSegments({
  projectDir,
  footageNodes,
  targetW,
  targetH,
  targetFps,
  tmpDir,
}) {
  const normalizedSegments = [];
  const vfFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${targetFps},format=yuv420p`;

  let segCounter = 0;
  for (const node of footageNodes) {
    const resolved = resolveConfinedAssetFile(projectDir, node.clipRelPath);
    if (!resolved) {
      throw new Error(
        `Footage node "${node.id}" references missing or invalid clip "${node.clipRelPath}".`,
      );
    }

    const meta = await probeMedia(resolved.abs);
    const clipDuration = Math.max(0.25, Number(meta.duration) || 4.0);
    const hasAudio = Boolean(meta.hasAudio);

    let timeWindows;
    if (Array.isArray(node.trimRange) && node.trimRange.length >= 2) {
      const start = clamp(Number(node.trimRange[0]) || 0, 0, Math.max(0, clipDuration - 0.15));
      const end = clamp(Number(node.trimRange[1]) || clipDuration, start + 0.15, clipDuration);
      timeWindows = [{ start: round3(start), end: round3(end) }];
    } else if (hasAudio && node.trimDeadAir !== false) {
      timeWindows = await detectNonSilentSegments(resolved.abs, clipDuration);
    } else {
      timeWindows = [{ start: 0, end: round3(clipDuration) }];
    }

    for (const win of timeWindows) {
      const winDur = Math.max(0.18, round3(win.end - win.start));
      const segPath = path.join(tmpDir, `seg_${String(segCounter).padStart(3, "0")}.mp4`);
      segCounter += 1;

      const args = hasAudio
        ? [
            "-y",
            "-ss",
            win.start.toFixed(3),
            "-t",
            winDur.toFixed(3),
            "-i",
            resolved.abs,
            "-vf",
            vfFilter,
            "-af",
            "aformat=sample_rates=44100:channel_layouts=stereo",
            "-r",
            String(targetFps),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-t",
            winDur.toFixed(3),
            segPath,
          ]
        : [
            "-y",
            "-ss",
            win.start.toFixed(3),
            "-t",
            winDur.toFixed(3),
            "-i",
            resolved.abs,
            "-f",
            "lavfi",
            "-t",
            winDur.toFixed(3),
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-vf",
            vfFilter,
            "-r",
            String(targetFps),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-shortest",
            segPath,
          ];

      const encRes = await runCommand("ffmpeg", args, { cwd: projectDir, shell: false });
      if (encRes.code !== 0 || !fs.existsSync(segPath)) {
        throw new Error(
          `FFmpeg segment normalization failed for "${node.id}": ${(encRes.stderr || encRes.stdout).slice(-400)}`,
        );
      }

      const segMeta = await probeMedia(segPath);
      normalizedSegments.push({
        filePath: segPath,
        duration: Math.max(0.18, Number(segMeta.duration) || winDur),
      });
    }
  }

  return normalizedSegments;
}

async function stitchSegmentsToMp4({
  projectDir,
  segments,
  outputAbsPath,
  targetFps,
  transitionMode,
}) {
  fs.mkdirSync(path.dirname(outputAbsPath), { recursive: true });

  if (segments.length === 1) {
    const singleRes = await runCommand(
      "ffmpeg",
      [
        "-y",
        "-i",
        segments[0].filePath,
        "-r",
        String(targetFps),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        outputAbsPath,
      ],
      { cwd: projectDir, shell: false },
    );
    if (singleRes.code !== 0 || !fs.existsSync(outputAbsPath)) {
      throw new Error(
        `FFmpeg single-segment output failed: ${(singleRes.stderr || singleRes.stdout).slice(-400)}`,
      );
    }
    return;
  }

  const minSegDur = Math.min(...segments.map((s) => s.duration));
  const fadeDur = round3(clamp(minSegDur * 0.24, 0.12, 0.4));

  if (transitionMode === "crossfade" && minSegDur > fadeDur + 0.08) {
    const inputArgs = ["-y"];
    for (const seg of segments) {
      inputArgs.push("-i", seg.filePath);
    }

    const filterParts = [];
    let cumDur = segments[0].duration;
    let prevV = "0:v";
    let prevA = "0:a";

    for (let i = 1; i < segments.length; i += 1) {
      const offset = Math.max(0.04, round3(cumDur - fadeDur));
      const nextV = `v${i}`;
      const nextA = `a${i}`;
      filterParts.push(
        `[${prevV}][${i}:v]xfade=transition=fade:duration=${fadeDur.toFixed(3)}:offset=${offset.toFixed(3)},format=yuv420p[${nextV}]`,
      );
      filterParts.push(`[${prevA}][${i}:a]acrossfade=d=${fadeDur.toFixed(3)}[${nextA}]`);
      cumDur = cumDur + segments[i].duration - fadeDur;
      prevV = nextV;
      prevA = nextA;
    }

    const xfadeRes = await runCommand(
      "ffmpeg",
      [
        ...inputArgs,
        "-filter_complex",
        filterParts.join(";"),
        "-map",
        `[${prevV}]`,
        "-map",
        `[${prevA}]`,
        "-r",
        String(targetFps),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        outputAbsPath,
      ],
      { cwd: projectDir, shell: false },
    );

    if (xfadeRes.code === 0 && fs.existsSync(outputAbsPath)) {
      return;
    }
  }

  // Hard-cut concat filter (also graceful fallback if xfade failed)
  const concatArgs = ["-y"];
  const streamPairs = [];
  for (let i = 0; i < segments.length; i += 1) {
    concatArgs.push("-i", segments[i].filePath);
    streamPairs.push(`[${i}:v][${i}:a]`);
  }

  const concatFilter = `${streamPairs.join("")}concat=n=${segments.length}:v=1:a=1[outv][outa]`;
  const concatRes = await runCommand(
    "ffmpeg",
    [
      ...concatArgs,
      "-filter_complex",
      concatFilter,
      "-map",
      "[outv]",
      "-map",
      "[outa]",
      "-r",
      String(targetFps),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      outputAbsPath,
    ],
    { cwd: projectDir, shell: false },
  );

  if (concatRes.code !== 0 || !fs.existsSync(outputAbsPath)) {
    throw new Error(
      `FFmpeg concat stitch failed: ${(concatRes.stderr || concatRes.stdout).slice(-400)}`,
    );
  }
}

async function extractCompiledKeyframes({ projectDir, compiledAbsPath, cleanSceneId, duration }) {
  const rawFramesDir = path.join(projectDir, ".studio", "frames", "raw");
  fs.mkdirSync(rawFramesDir, { recursive: true });

  const startRel = `.studio/frames/raw/wb_${cleanSceneId}_start.png`;
  const peakRel = `.studio/frames/raw/wb_${cleanSceneId}_peak.png`;
  const endRel = `.studio/frames/raw/wb_${cleanSceneId}_end.png`;

  const tStart = 0;
  const tPeak = round3(Math.max(0, duration * 0.45));
  const tEnd = round3(Math.max(0, duration - 0.15));

  await Promise.all([
    runCommand(
      "ffmpeg",
      [
        "-y",
        "-ss",
        tStart.toFixed(3),
        "-i",
        compiledAbsPath,
        "-frames:v",
        "1",
        path.join(projectDir, startRel),
      ],
      { cwd: projectDir, shell: false },
    ),
    runCommand(
      "ffmpeg",
      [
        "-y",
        "-ss",
        tPeak.toFixed(3),
        "-i",
        compiledAbsPath,
        "-frames:v",
        "1",
        path.join(projectDir, peakRel),
      ],
      { cwd: projectDir, shell: false },
    ),
    runCommand(
      "ffmpeg",
      [
        "-y",
        "-ss",
        tEnd.toFixed(3),
        "-i",
        compiledAbsPath,
        "-frames:v",
        "1",
        path.join(projectDir, endRel),
      ],
      { cwd: projectDir, shell: false },
    ),
  ]);

  const validRel = (rel) => (fs.existsSync(path.join(projectDir, rel)) ? rel : null);
  const peakValid = validRel(peakRel) || validRel(startRel);
  return {
    start: validRel(startRel) || peakValid,
    peak: peakValid,
    end: validRel(endRel) || peakValid,
  };
}

function createSkeletonFrame({
  frameIndex,
  frameId,
  sceneNodeId,
  title,
  durationSeconds,
  sourceClip,
  keyframes,
}) {
  const preset = getMotionPreset("crash-zoom-in");
  return {
    id: frameId,
    index: frameIndex,
    sceneId: `scene_${String(frameIndex).padStart(2, "0")}`,
    whiteboardSceneNodeId: sceneNodeId,
    title: title || `Scene ${frameIndex}`,
    narrativeBeat: "whiteboard-scene",
    layout: LAYOUT_ARCHETYPES[0],
    motionPreset: preset.id,
    cameraMotion: {
      presetId: preset.id,
      label: preset.name,
      fromScale: preset.fromScale,
      toScale: preset.toScale,
      panX: preset.panX,
      panY: preset.panY,
      tiltDeg: preset.tiltDeg,
      focusX: preset.focusX,
      focusY: preset.focusY,
      ease: preset.ease,
      transitionIn: preset.transitionIn,
      transitionOut: preset.transitionOut,
    },
    durationSeconds,
    speedFactor: 1,
    sourceClip,
    rawTimeRange: [0, durationSeconds],
    keyframes,
    aiBackgroundPlate: null,
    aiVideoClip: null,
    staging: {
      headline: title || "Whiteboard Scene",
      subheadline: "Compiled from connected footage and director notes.",
      badgeText: `SCENE ${String(frameIndex).padStart(2, "0")}`,
      captionText: "Compiled from connected footage and director notes.",
      ctaText: "Explore Now",
      theme: "brand-dark",
      calloutItems: [
        { label: "SOURCE", value: "Whiteboard Graph" },
        { label: "TIMING", value: `${durationSeconds}s @ 1x` },
      ],
      cursorTarget: { x: 50, y: 50, showRipple: true },
    },
    audioSpec: {
      voiceoverText: "",
      voiceoverSrc: null,
      sfx: ["whoosh"],
      bgmMood: "warm-modern",
    },
    locked: false,
    approved: false,
    prompt: "",
    currentVersion: 0,
    designFramePath: "",
    hudFramePath: "",
    designFrameUrl: "",
    hudFrameUrl: "",
    history: [],
  };
}

export async function compileWhiteboardScene({
  slug,
  sceneNodeId = null,
  nodeIds = null,
  prompt = "",
  transition = "cut",
  graph: inlineGraph = null,
  projectsDir = null,
} = {}) {
  const projectDir = ensureWhiteboardProjectRoot(slug, { projectsDir });
  const graph = inlineGraph
    ? saveWhiteboardGraph(slug, inlineGraph, { projectsDir })
    : loadWhiteboardGraph(slug, { projectsDir });

  // Locate or materialize target scene node
  let sceneNode = null;
  if (sceneNodeId) {
    const cleanTarget = sanitizeIdToken(sceneNodeId, "scene_01");
    sceneNode = graph.nodes.find((n) => n.id === cleanTarget) || null;
    if (!sceneNode) {
      sceneNode = normalizeNode(
        { id: cleanTarget, type: "scene", x: 720, y: 180, title: "Compiled Scene" },
        graph.nodes.length,
      );
      graph.nodes.push(sceneNode);
    }
  } else {
    const incomingSet = new Set(graph.edges.map((e) => e.to));
    sceneNode =
      graph.nodes.find((n) => n.type === "scene" && incomingSet.has(n.id)) ||
      graph.nodes.find((n) => n.type === "scene") ||
      null;
    if (!sceneNode) {
      sceneNode = normalizeNode(
        { id: "scene_01", type: "scene", x: 720, y: 180, title: "Scene 1" },
        graph.nodes.length,
      );
      graph.nodes.push(sceneNode);
    }
  }

  const connectedInputs = collectConnectedInputNodes({
    graph,
    sceneNode,
    explicitNodeIds: nodeIds,
  });

  const footageNodes = connectedInputs.filter((n) => n.type === "footage" && n.clipRelPath);
  const noteNodes = connectedInputs.filter((n) => n.type === "note" && n.promptText.trim());

  if (footageNodes.length === 0) {
    throw new Error(
      `No connected footage nodes with valid clipRelPath found for whiteboard scene "${sceneNode.id}".`,
    );
  }

  // Combine note prompts + sceneNode promptText + explicit prompt
  const promptFragments = [
    ...noteNodes.map((n) => n.promptText.trim()),
    String(sceneNode.promptText || "").trim(),
    String(prompt || "").trim(),
  ].filter(Boolean);
  const combinedPrompt = promptFragments.join(" · ");

  const effectiveTransition =
    transition === "crossfade" ||
    sceneNode.transition === "crossfade" ||
    /\bcross[-\s]?fade\b|\bdissolve\b|\bxfade\b/i.test(combinedPrompt)
      ? "crossfade"
      : "cut";

  // Read project brief dimensions
  const briefPath = path.join(projectDir, "PROJECT_BRIEF.json");
  let brief = null;
  if (fs.existsSync(briefPath)) {
    try {
      brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
    } catch {
      brief = null;
    }
  }
  if (!brief && (!projectsDir || path.resolve(projectsDir) === path.resolve(PROJECTS_DIR))) {
    brief = await syncProjectManifest(slug);
  }

  const targetW = Math.max(320, Math.round((Number(brief?.width) || 1080) / 2) * 2);
  const targetH = Math.max(320, Math.round((Number(brief?.height) || 1920) / 2) * 2);
  const targetFps = clamp(Math.round(Number(brief?.fps) || 30), 15, 60);

  const cleanSceneToken = sanitizeIdToken(sceneNode.id, "01");
  const compiledClipRelPath = `assets/clips/wb_scene_${cleanSceneToken}.mp4`;
  const compiledClipAbsPath = path.join(projectDir, compiledClipRelPath);
  const tmpDir = path.join(projectDir, ".studio", "whiteboard-tmp", cleanSceneToken);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const normalizedSegments = await buildNormalizedSegments({
      projectDir,
      footageNodes,
      targetW,
      targetH,
      targetFps,
      tmpDir,
    });

    await stitchSegmentsToMp4({
      projectDir,
      segments: normalizedSegments,
      outputAbsPath: compiledClipAbsPath,
      targetFps,
      transitionMode: effectiveTransition,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }

  const compiledProbe = await probeMedia(compiledClipAbsPath);
  const compiledDuration = Math.max(0.5, round2(Number(compiledProbe.duration) || 3.5));

  const keyframes = await extractCompiledKeyframes({
    projectDir,
    compiledAbsPath: compiledClipAbsPath,
    cleanSceneId: cleanSceneToken,
    duration: compiledDuration,
  });

  // Inject or update scene inside STORYBOARD.json and render 1080p Hero Design Frame PNG
  let existingSb = loadStoryboard(slug);
  if (!existingSb || !Array.isArray(existingSb.frames)) {
    existingSb = {
      schemaVersion: 1,
      slug,
      title: brief?.title || slug,
      aspectRatio: brief?.aspectRatio || (targetW > targetH ? "16:9" : "9:16"),
      width: targetW,
      height: targetH,
      fps: targetFps,
      globalPrompt: combinedPrompt,
      brandColors: brief?.brandColors || {
        primary: "#1E824C",
        secondary: "#2ECC71",
        accent: "#F1C40F",
        background: "#0A1612",
      },
      inspirationProfile: brief?.inspirationProfile || null,
      createdAt: new Date().toISOString(),
      frames: [],
    };
  }

  let targetFrame =
    existingSb.frames.find(
      (f) =>
        (sceneNode.frameId && f.id === sceneNode.frameId) ||
        f.whiteboardSceneNodeId === sceneNode.id ||
        f.id === sceneNode.id,
    ) || null;

  if (!targetFrame) {
    const nextIdx = existingSb.frames.length + 1;
    const newFrameId = `frame_${String(nextIdx).padStart(2, "0")}`;
    targetFrame = createSkeletonFrame({
      frameIndex: nextIdx,
      frameId: newFrameId,
      sceneNodeId: sceneNode.id,
      title: sceneNode.title,
      durationSeconds: compiledDuration,
      sourceClip: compiledClipRelPath,
      keyframes,
    });
    existingSb.frames.push(targetFrame);
    saveStoryboard(slug, existingSb);
  } else {
    targetFrame.whiteboardSceneNodeId = sceneNode.id;
    saveStoryboard(slug, existingSb);
  }

  const promptSources = [
    ...noteNodes.map((n) => n.promptText.trim()),
    String(sceneNode.promptText || "").trim(),
    String(prompt || "").trim(),
  ].filter(Boolean);

  const mergedCues = {
    motionPreset: null,
    layout: null,
    speedFactor: undefined,
    aiBackgroundPlate: undefined,
    camera: {},
    staging: {},
  };
  for (const srcPrompt of promptSources) {
    const stepCues = parseFramePrompt(srcPrompt);
    if (stepCues.motionPreset) mergedCues.motionPreset = stepCues.motionPreset;
    if (stepCues.layout) mergedCues.layout = stepCues.layout;
    if (stepCues.speedFactor !== undefined) mergedCues.speedFactor = stepCues.speedFactor;
    if (stepCues.aiBackgroundPlate !== undefined) {
      mergedCues.aiBackgroundPlate = stepCues.aiBackgroundPlate;
    }
    if (stepCues.camera) Object.assign(mergedCues.camera, stepCues.camera);
    if (stepCues.staging) Object.assign(mergedCues.staging, stepCues.staging);
  }

  const plainNoteFallback = noteNodes
    .map((n) => n.promptText.trim())
    .filter((txt) => !/['"“”]/.test(txt))
    .join(" · ");

  if (!mergedCues.staging.subheadline && plainNoteFallback) {
    mergedCues.staging.subheadline = plainNoteFallback.slice(0, 160);
  }

  const regenerated = await regenerateFrame({
    slug,
    frameId: targetFrame.id,
    prompt: combinedPrompt,
    motionPreset: mergedCues.motionPreset,
    layout: mergedCues.layout,
    overrides: {
      sourceClip: compiledClipRelPath,
      durationSeconds: compiledDuration,
      rawTimeRange: [0, compiledDuration],
      keyframes,
      ...(mergedCues.speedFactor !== undefined ? { speedFactor: mergedCues.speedFactor } : {}),
      ...(mergedCues.aiBackgroundPlate !== undefined
        ? { aiBackgroundPlate: mergedCues.aiBackgroundPlate }
        : {}),
      ...(Object.keys(mergedCues.camera).length > 0 ? { cameraMotion: mergedCues.camera } : {}),
      title: mergedCues.staging.headline || sceneNode.title || targetFrame.title,
      ...(Object.keys(mergedCues.staging).length > 0 ? { staging: mergedCues.staging } : {}),
    },
  });

  // Persist linked frameId & compiledClipRelPath back to whiteboard.json + sync manifest
  sceneNode.frameId = regenerated.frame.id;
  sceneNode.compiledClipRelPath = compiledClipRelPath;
  sceneNode.transition = effectiveTransition;
  const updatedGraph = saveWhiteboardGraph(slug, graph, { projectsDir });

  if (!projectsDir || path.resolve(projectsDir) === path.resolve(PROJECTS_DIR)) {
    await syncProjectManifest(slug);
  }

  return {
    ok: true,
    compiledClipRelPath,
    frame: regenerated.frame,
    storyboard: regenerated.storyboard,
    graph: updatedGraph,
  };
}

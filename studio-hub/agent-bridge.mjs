import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { PROJECTS_DIR, ROOT_DIR, assertValidSlug } from "./lib.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROVIDER_SETTINGS_FILE = path.join(__dirname, ".provider-settings.json");
const CREW_STATE_FILE = path.join(ROOT_DIR, ".hyperframes", "agent-crew-state.json");

export const DEFAULT_PROVIDER_SETTINGS = Object.freeze({
  providerMode: "antigravity-subscription",
  model: "gemini-4-carbon-high",
  zeroCostGuard: true,
  imageBackend: "antigravity-image-generator",
  videoBackend: "google-flow-browser",
  audioBackend: "edge-tts-neural",
  allowFreeTierApiKey: false,
});

const ZERO_COST_PROVIDER_MODES = new Set(["antigravity-subscription", "gemini-free-tier"]);
const ZERO_COST_IMAGE_BACKENDS = new Set([
  "antigravity-image-generator",
  "google-images-reference",
  "local-svg-plate",
]);
const ZERO_COST_VIDEO_BACKENDS = new Set(["google-flow-browser", "ffmpeg-local"]);
const ZERO_COST_AUDIO_BACKENDS = new Set(["edge-tts-neural", "ffmpeg-local"]);

export const VALID_TASK_TYPES = Object.freeze([
  "ai_storyboard_direct",
  "ai_regenerate_frame",
  "ai_generate_image_plate",
  "ai_google_flow_video",
  "ai_full_video_edit",
]);

export const AGENT_CREW_ROSTER = Object.freeze([
  {
    id: "brand-analyst",
    name: "Brand Analyst",
    role: "Palette, typography & reference pacing intelligence",
    toolBackend: "media_intelligence.py (extract-brand / analyze-inspiration)",
    model: "gemini-4-carbon-high",
  },
  {
    id: "storyboard-director",
    name: "Storyboard Director",
    role: "Higgsfield shot staging, camera vectors & speed ramps",
    toolBackend: "storyboard.mjs + Gemini 4 Carbon",
    model: "gemini-4-carbon-high",
  },
  {
    id: "frame-designer",
    name: "Frame Designer",
    role: "1080p clean & HUD design plates",
    toolBackend: "Antigravity image-generator / Google Images",
    model: "gemini-4-carbon-high",
  },
  {
    id: "google-flow-video",
    name: "Google Flow Video",
    role: "Generative motion B-roll via Google Flow",
    toolBackend: "Antigravity browser -> labs.google/fx/tools/flow",
    model: "gemini-4-carbon-high",
  },
  {
    id: "audio-director",
    name: "Audio Director",
    role: "Neural voiceover, Whisper alignment, SFX & harmonic BGM",
    toolBackend: "edge-tts + faster-whisper + FFmpeg mix",
    model: "gemini-4-carbon-high",
  },
  {
    id: "hyperframes-qa",
    name: "HyperFrames QA",
    role: "Gemini 4 Carbon scene builder & zero-error check gate",
    toolBackend: "video-compiler.mjs + npx hyperframes check",
    model: "gemini-4-carbon-high",
  },
]);

const sseSubscribers = new Set();

function writeSseFrame(res, type, dataObj) {
  const serialized = JSON.stringify(dataObj);
  res.write(`event: ${type}\ndata: ${serialized}\n\n`);
}

export function broadcastEvent(type, payload = {}) {
  const timestamp = new Date().toISOString();
  const envelope = {
    type,
    ...(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}),
    payload,
    timestamp,
  };

  let deliveredCount = 0;
  for (const subscriber of [...sseSubscribers]) {
    try {
      writeSseFrame(subscriber.res, type, envelope);
      deliveredCount += 1;
    } catch {
      subscriber.cleanup();
    }
  }

  return { type, payload, timestamp, deliveredCount };
}

export function subscribeSse(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  let closed = false;
  const heartbeat = setInterval(() => {
    if (closed) return;
    try {
      res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    } catch {
      cleanup();
    }
  }, 15000);
  heartbeat.unref?.();

  const subscriber = {
    res,
    cleanup() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      sseSubscribers.delete(subscriber);
    },
  };

  function cleanup() {
    subscriber.cleanup();
  }

  sseSubscribers.add(subscriber);
  req?.on?.("close", cleanup);
  res?.on?.("close", cleanup);

  writeSseFrame(res, "connected", {
    type: "connected",
    crew: getAgentCrewState(),
    providerSettings: getProviderSettings(),
    timestamp: new Date().toISOString(),
  });

  return cleanup;
}

function readPersistedCrewMap() {
  try {
    if (fs.existsSync(CREW_STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CREW_STATE_FILE, "utf8"));
      if (parsed && typeof parsed.byId === "object" && parsed.byId !== null) {
        return parsed.byId;
      }
    }
  } catch {
    // Fall back to fresh defaults
  }
  return {};
}

function writePersistedCrewMap(byId) {
  fs.mkdirSync(path.dirname(CREW_STATE_FILE), { recursive: true });
  fs.writeFileSync(
    CREW_STATE_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), byId }, null, 2) + "\n",
    "utf8",
  );
}

export function getAgentCrewState() {
  const persisted = readPersistedCrewMap();
  const settings = getProviderSettings();
  const agents = AGENT_CREW_ROSTER.map((base) => {
    const saved = persisted[base.id] || {};
    return {
      ...base,
      model: settings.model || base.model,
      status: saved.status || "idle",
      message: saved.message || "Standing by",
      meta: saved.meta && typeof saved.meta === "object" ? saved.meta : {},
      updatedAt: saved.updatedAt || null,
    };
  });

  const byId = {};
  for (const agent of agents) {
    byId[agent.id] = agent;
  }

  return {
    updatedAt: new Date().toISOString(),
    agents,
    byId,
  };
}

export function setAgentStatus(agentId, status, message = "", meta = {}) {
  const rosterEntry = AGENT_CREW_ROSTER.find((a) => a.id === agentId);
  if (!rosterEntry) {
    throw new Error(
      `Unknown crew agent "${agentId}". Expected one of: ${AGENT_CREW_ROSTER.map((a) => a.id).join(", ")}`,
    );
  }

  const validStatuses = new Set(["idle", "working", "waiting", "done", "error"]);
  const normalizedStatus = validStatuses.has(status) ? status : "working";
  const persisted = readPersistedCrewMap();
  const updatedAt = new Date().toISOString();

  persisted[agentId] = {
    status: normalizedStatus,
    message: String(message || "").trim() || (normalizedStatus === "idle" ? "Standing by" : ""),
    meta: meta && typeof meta === "object" ? meta : {},
    updatedAt,
  };

  writePersistedCrewMap(persisted);
  const crewState = getAgentCrewState();
  const updatedAgent = crewState.byId[agentId];

  broadcastEvent("agent-status", {
    agent: updatedAgent,
    crew: crewState,
  });

  return updatedAgent;
}

export function assertZeroCostAllowed(candidate) {
  const merged = { ...DEFAULT_PROVIDER_SETTINGS, ...(candidate || {}) };
  if (!merged.zeroCostGuard) {
    return merged;
  }

  if (!ZERO_COST_PROVIDER_MODES.has(merged.providerMode)) {
    throw new Error(
      `zeroCostGuard blocked paid/unsupported providerMode "${merged.providerMode}". Allowed $0 modes: ${[...ZERO_COST_PROVIDER_MODES].join(", ")}`,
    );
  }
  if (merged.providerMode === "gemini-free-tier" && !merged.allowFreeTierApiKey) {
    throw new Error(`zeroCostGuard blocked "gemini-free-tier" while allowFreeTierApiKey is false.`);
  }
  if (!ZERO_COST_IMAGE_BACKENDS.has(merged.imageBackend)) {
    throw new Error(
      `zeroCostGuard blocked paid/unsupported imageBackend "${merged.imageBackend}".`,
    );
  }
  if (!ZERO_COST_VIDEO_BACKENDS.has(merged.videoBackend)) {
    throw new Error(
      `zeroCostGuard blocked paid/unsupported videoBackend "${merged.videoBackend}".`,
    );
  }
  if (!ZERO_COST_AUDIO_BACKENDS.has(merged.audioBackend)) {
    throw new Error(
      `zeroCostGuard blocked paid/unsupported audioBackend "${merged.audioBackend}".`,
    );
  }

  return merged;
}

export function getProviderSettings() {
  try {
    if (fs.existsSync(PROVIDER_SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PROVIDER_SETTINGS_FILE, "utf8"));
      if (raw && typeof raw === "object") {
        const merged = {
          ...DEFAULT_PROVIDER_SETTINGS,
          providerMode: String(raw.providerMode || DEFAULT_PROVIDER_SETTINGS.providerMode),
          model: String(raw.model || DEFAULT_PROVIDER_SETTINGS.model),
          zeroCostGuard: raw.zeroCostGuard === undefined ? true : Boolean(raw.zeroCostGuard),
          imageBackend: String(raw.imageBackend || DEFAULT_PROVIDER_SETTINGS.imageBackend),
          videoBackend: String(raw.videoBackend || DEFAULT_PROVIDER_SETTINGS.videoBackend),
          audioBackend: String(raw.audioBackend || DEFAULT_PROVIDER_SETTINGS.audioBackend),
          allowFreeTierApiKey: Boolean(raw.allowFreeTierApiKey),
        };
        return assertZeroCostAllowed(merged);
      }
    }
  } catch {
    // Return safe $0 defaults if file is missing or malformed
  }
  return { ...DEFAULT_PROVIDER_SETTINGS };
}

export function saveProviderSettings(patch = {}) {
  const current = getProviderSettings();
  const next = {
    ...current,
    ...(patch.providerMode !== undefined ? { providerMode: String(patch.providerMode) } : {}),
    ...(patch.model !== undefined ? { model: String(patch.model) } : {}),
    ...(patch.zeroCostGuard !== undefined ? { zeroCostGuard: Boolean(patch.zeroCostGuard) } : {}),
    ...(patch.imageBackend !== undefined ? { imageBackend: String(patch.imageBackend) } : {}),
    ...(patch.videoBackend !== undefined ? { videoBackend: String(patch.videoBackend) } : {}),
    ...(patch.audioBackend !== undefined ? { audioBackend: String(patch.audioBackend) } : {}),
    ...(patch.allowFreeTierApiKey !== undefined
      ? { allowFreeTierApiKey: Boolean(patch.allowFreeTierApiKey) }
      : {}),
  };

  assertZeroCostAllowed(next);
  fs.mkdirSync(path.dirname(PROVIDER_SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(PROVIDER_SETTINGS_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");

  broadcastEvent("provider-settings", { providerSettings: next });
  return next;
}

function getTicketsFilePath(slug) {
  const projectDir = assertValidSlug(slug);
  return path.join(projectDir, ".studio", "agent-queue", "tickets.json");
}

function loadTicketStore(slug) {
  const ticketsPath = getTicketsFilePath(slug);
  if (!fs.existsSync(ticketsPath)) {
    return { slug, updatedAt: null, tickets: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(ticketsPath, "utf8"));
    return {
      slug,
      updatedAt: parsed?.updatedAt || null,
      tickets: Array.isArray(parsed?.tickets) ? parsed.tickets : [],
    };
  } catch {
    return { slug, updatedAt: null, tickets: [] };
  }
}

function saveTicketStore(slug, tickets) {
  const ticketsPath = getTicketsFilePath(slug);
  fs.mkdirSync(path.dirname(ticketsPath), { recursive: true });
  const payload = {
    slug,
    updatedAt: new Date().toISOString(),
    tickets,
  };
  fs.writeFileSync(ticketsPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

export function enqueueAgentTask({ slug, type, payload = {} }) {
  assertValidSlug(slug);
  if (!VALID_TASK_TYPES.includes(type)) {
    throw new Error(
      `Unsupported agent task type "${type}". Valid types: ${VALID_TASK_TYPES.join(", ")}`,
    );
  }

  const provider = getProviderSettings();
  if (provider.zeroCostGuard && payload?.forcePaidApi) {
    throw new Error("zeroCostGuard blocked paid API execution request in ticket payload.");
  }

  const store = loadTicketStore(slug);
  const now = new Date().toISOString();
  const ticket = {
    id: `tkt_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    slug,
    type,
    status: "pending",
    payload: payload && typeof payload === "object" ? payload : {},
    providerSnapshot: {
      providerMode: provider.providerMode,
      model: provider.model,
      zeroCostGuard: provider.zeroCostGuard,
    },
    claimedBy: null,
    createdAt: now,
    updatedAt: now,
    claimedAt: null,
    completedAt: null,
    result: null,
    error: null,
  };

  store.tickets.push(ticket);
  saveTicketStore(slug, store.tickets);
  broadcastEvent("ticket-enqueued", { slug, ticket });
  return ticket;
}

export function listAgentTasks(slug = null, { status } = {}) {
  if (slug) {
    const store = loadTicketStore(slug);
    return status ? store.tickets.filter((t) => t.status === status) : store.tickets;
  }

  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const dirs = fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();

  const aggregated = [];
  for (const projectSlug of dirs) {
    try {
      const items = listAgentTasks(projectSlug, { status });
      aggregated.push(...items);
    } catch {
      // Ignore invalid project directory names
    }
  }
  return aggregated;
}

export function claimAgentTask(slug, ticketId, agentId) {
  const store = loadTicketStore(slug);
  const ticket = store.tickets.find((t) => t.id === ticketId);
  if (!ticket) {
    throw new Error(`Ticket "${ticketId}" not found in project "${slug}".`);
  }
  if (ticket.status !== "pending" && ticket.claimedBy !== agentId) {
    throw new Error(`Ticket "${ticketId}" cannot be claimed from status "${ticket.status}".`);
  }

  const now = new Date().toISOString();
  ticket.status = "in_progress";
  ticket.claimedBy = String(agentId || "antigravity-agent");
  ticket.claimedAt = now;
  ticket.updatedAt = now;

  saveTicketStore(slug, store.tickets);
  if (AGENT_CREW_ROSTER.some((a) => a.id === ticket.claimedBy)) {
    setAgentStatus(ticket.claimedBy, "working", `Executing ${ticket.type}`, {
      slug,
      ticketId: ticket.id,
    });
  }
  broadcastEvent("ticket-claimed", { slug, ticket });
  return ticket;
}

export function completeAgentTask(slug, ticketId, result = {}) {
  const store = loadTicketStore(slug);
  const ticket = store.tickets.find((t) => t.id === ticketId);
  if (!ticket) {
    throw new Error(`Ticket "${ticketId}" not found in project "${slug}".`);
  }

  const now = new Date().toISOString();
  ticket.status = "completed";
  ticket.result = result ?? {};
  ticket.error = null;
  ticket.completedAt = now;
  ticket.updatedAt = now;

  saveTicketStore(slug, store.tickets);
  if (ticket.claimedBy && AGENT_CREW_ROSTER.some((a) => a.id === ticket.claimedBy)) {
    setAgentStatus(ticket.claimedBy, "idle", `Completed ${ticket.type}`, {
      slug,
      ticketId: ticket.id,
    });
  }
  broadcastEvent("ticket-completed", { slug, ticket });
  return ticket;
}

export function failAgentTask(slug, ticketId, error) {
  const store = loadTicketStore(slug);
  const ticket = store.tickets.find((t) => t.id === ticketId);
  if (!ticket) {
    throw new Error(`Ticket "${ticketId}" not found in project "${slug}".`);
  }

  const now = new Date().toISOString();
  const errText = error instanceof Error ? error.message : String(error || "Unknown agent error");
  ticket.status = "failed";
  ticket.error = errText;
  ticket.completedAt = now;
  ticket.updatedAt = now;

  saveTicketStore(slug, store.tickets);
  if (ticket.claimedBy && AGENT_CREW_ROSTER.some((a) => a.id === ticket.claimedBy)) {
    setAgentStatus(ticket.claimedBy, "error", `${ticket.type} failed: ${errText}`, {
      slug,
      ticketId: ticket.id,
    });
  }
  broadcastEvent("ticket-failed", { slug, ticket });
  return ticket;
}

async function notifyStudioHubServer(type, payload) {
  const baseUrl = process.env.STUDIO_HUB_URL || "http://localhost:4400";
  try {
    await fetch(`${baseUrl}/api/internal/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload }),
      signal: AbortSignal.timeout(750),
    });
  } catch {
    // Best-effort notification when Studio Hub server is running
  }
}

async function runCli(argv) {
  const args = argv.slice(2);
  if (args.includes("--list-pending")) {
    const slugIdx = args.indexOf("--slug");
    const slug = slugIdx !== -1 ? args[slugIdx + 1] || null : null;
    const tickets = listAgentTasks(slug, { status: "pending" });
    console.log(JSON.stringify({ ok: true, slug, count: tickets.length, tickets }, null, 2));
    return;
  }

  if (args[0] === "--claim") {
    const [, slug, ticketId, agentId] = args;
    if (!slug || !ticketId || !agentId) {
      throw new Error("Usage: --claim <slug> <ticketId> <agentId>");
    }
    const ticket = claimAgentTask(slug, ticketId, agentId);
    await notifyStudioHubServer("ticket-claimed", { slug, ticket, crew: getAgentCrewState() });
    console.log(JSON.stringify({ ok: true, ticket }, null, 2));
    return;
  }

  if (args[0] === "--complete") {
    const [, slug, ticketId, rawJson] = args;
    if (!slug || !ticketId) {
      throw new Error("Usage: --complete <slug> <ticketId> [resultJson]");
    }
    const parsedResult = rawJson ? JSON.parse(rawJson) : { ok: true };
    const ticket = completeAgentTask(slug, ticketId, parsedResult);
    await notifyStudioHubServer("ticket-completed", { slug, ticket, crew: getAgentCrewState() });
    console.log(JSON.stringify({ ok: true, ticket }, null, 2));
    return;
  }

  if (args[0] === "--fail") {
    const [, slug, ticketId, ...rest] = args;
    if (!slug || !ticketId) {
      throw new Error("Usage: --fail <slug> <ticketId> <errorMessage>");
    }
    const ticket = failAgentTask(slug, ticketId, rest.join(" ") || "Task failed");
    await notifyStudioHubServer("ticket-failed", { slug, ticket, crew: getAgentCrewState() });
    console.log(JSON.stringify({ ok: true, ticket }, null, 2));
    return;
  }

  if (args[0] === "--agent-status") {
    const [, agentId, status, ...msgParts] = args;
    if (!agentId || !status) {
      throw new Error("Usage: --agent-status <agentId> <status> [message]");
    }
    const agent = setAgentStatus(agentId, status, msgParts.join(" "));
    await notifyStudioHubServer("agent-status", { agent, crew: getAgentCrewState() });
    console.log(JSON.stringify({ ok: true, agent }, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        crew: getAgentCrewState(),
        providerSettings: getProviderSettings(),
      },
      null,
      2,
    ),
  );
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectExecution) {
  runCli(process.argv).catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message || String(err) }));
    process.exitCode = 1;
  });
}

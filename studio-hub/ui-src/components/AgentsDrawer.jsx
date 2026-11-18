import { useEffect } from "react";
import { useStudio, Icons } from "../store.jsx";

const FALLBACK_CREW = [
  {
    id: "brand-analyst",
    name: "Brand Analyst",
    role: "Palette, typography & reference pacing intelligence",
    toolBackend: "media_intelligence.py (extract-brand / analyze-inspiration)",
    status: "idle",
    message: "Standing by",
  },
  {
    id: "storyboard-director",
    name: "Storyboard Director",
    role: "Shot staging, camera vectors & speed ramps",
    toolBackend: "storyboard.mjs + Gemini 4 Carbon",
    status: "idle",
    message: "Standing by",
  },
  {
    id: "frame-designer",
    name: "Frame Designer",
    role: "1080p clean & animation guide plates",
    toolBackend: "Antigravity image-generator / Headless Chrome",
    status: "idle",
    message: "Standing by",
  },
  {
    id: "google-flow-video",
    name: "Google Flow Video",
    role: "Generative motion B-roll via Google Flow",
    toolBackend: "Antigravity browser -> Google Flow",
    status: "idle",
    message: "Standing by",
  },
  {
    id: "audio-director",
    name: "Audio Director",
    role: "Neural voiceover, Whisper alignment, SFX & ducked BGM",
    toolBackend: "edge-tts + faster-whisper + FFmpeg mix",
    status: "idle",
    message: "Standing by",
  },
  {
    id: "hyperframes-qa",
    name: "HyperFrames QA",
    role: "Scene compiler & browser check gate",
    toolBackend: "video-compiler.mjs + npx hyperframes check",
    status: "idle",
    message: "Standing by",
  },
];

const QUICK_AGENT_TASKS = [
  {
    type: "ai_storyboard_direct",
    label: "Direct storyboard scenes",
    desc: "Queue Storyboard Director to refine shot pacing and copy.",
  },
  {
    type: "ai_generate_image_plate",
    label: "Generate AI background plate",
    desc: "Queue Frame Designer for a custom studio background plate ($0).",
  },
  {
    type: "ai_google_flow_video",
    label: "Generate Google Flow B-roll",
    desc: "Queue Google Flow Video for generative motion B-roll.",
  },
  {
    type: "ai_full_video_edit",
    label: "Run full AI video pass",
    desc: "Queue HyperFrames QA to audit and polish compositions.",
  },
];

function statusBadgeColor(status) {
  switch (status) {
    case "working":
      return "yellow";
    case "done":
      return "green";
    case "error":
      return "red";
    default:
      return "";
  }
}

export function AgentsDrawer({ open, onClose }) {
  const {
    status,
    agentCrew,
    tickets,
    providerSettings,
    sseConnected,
    busyMap,
    enqueueAgentTaskAction,
    updateProviderSettings,
  } = useStudio();

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const agents =
    Array.isArray(agentCrew) && agentCrew.length > 0
      ? agentCrew
      : Array.isArray(agentCrew?.agents) && agentCrew.agents.length > 0
        ? agentCrew.agents
        : FALLBACK_CREW;

  const ticketList = Array.isArray(tickets) ? tickets : [];
  const tools = status?.tools && typeof status.tools === "object" ? status.tools : null;
  const zeroCostGuard = providerSettings?.zeroCostGuard !== false;

  return (
    <>
      <div className="drawer-backdrop open" onClick={() => onClose?.()} aria-hidden="true" />
      <aside
        className="slide-drawer wide open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agents-drawer-title"
      >
        <div className="drawer-header">
          <div>
            <h2 id="agents-drawer-title" className="card-title">
              AI agents &amp; system
            </h2>
            <p className="card-desc">
              6-agent local production crew with $0 subscription &amp; offline CLI guard.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Close AI agents drawer"
            onClick={() => onClose?.()}
          >
            <Icons.X size={16} />
          </button>
        </div>

        <div className="drawer-body">
          {/* $0 Local & Subscription Guard */}
          <div className="guard-banner">
            <div className="stack-sm" style={{ gap: "2px" }}>
              <strong>$0 local &amp; subscription guard active</strong>
              <span>
                {`Model: ${providerSettings?.model || "gemini-4-carbon-high"} · Mode: ${
                  providerSettings?.providerMode || "antigravity-subscription"
                }`}
              </span>
            </div>
            <label className="checkbox-row" style={{ color: "inherit" }}>
              <input
                type="checkbox"
                checked={zeroCostGuard}
                onChange={(event) =>
                  updateProviderSettings({ zeroCostGuard: event.target.checked })
                }
              />
              <span>Enforce $0 guard</span>
            </label>
          </div>

          {tools && (
            <div className="stack-sm">
              <div className="inline-wrap" style={{ justifyContent: "space-between" }}>
                <span className="field-label">Local toolchains</span>
                <span className={`tag-pill ${sseConnected ? "green" : ""}`}>
                  <span className="status-dot" />
                  <span>{sseConnected ? "Live event stream connected" : "Polling mode"}</span>
                </span>
              </div>
              <div className="inline-wrap">
                {Object.entries(tools).map(([toolName, info]) => {
                  const ok = Boolean(info?.ok ?? info);
                  return (
                    <span key={toolName} className={`tag-pill mono ${ok ? "green" : "yellow"}`}>
                      {`${toolName}: ${ok ? "ready" : "missing"}`}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* 6-Agent Crew Roster */}
          <div className="stack-sm">
            <span className="field-label">6-agent production crew</span>
            <div className="agents-list-grid">
              {agents.map((agent) => {
                const st = agent.status || "idle";
                return (
                  <div key={agent.id} className="agent-mini-card">
                    <div className="card-header">
                      <strong style={{ fontSize: "13.5px" }}>{agent.name}</strong>
                      <span className={`tag-pill ${statusBadgeColor(st)}`}>{st}</span>
                    </div>
                    <div className="field-hint">{agent.role}</div>
                    <div className="mono" style={{ fontSize: "11px", opacity: 0.72 }}>
                      {agent.toolBackend}
                    </div>
                    {agent.message && (
                      <div style={{ fontSize: "12px", marginTop: "2px" }}>{agent.message}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 1-Click Antigravity Tasks */}
          <div className="stack-sm">
            <span className="field-label">One-click Antigravity tasks</span>
            <div className="grid-2">
              {QUICK_AGENT_TASKS.map((task) => {
                const taskBusy = Boolean(busyMap?.[`agentTask:${task.type}`]);
                return (
                  <div
                    key={task.type}
                    className="agent-mini-card"
                    style={{ justifyContent: "space-between" }}
                  >
                    <div className="stack-sm" style={{ gap: "4px" }}>
                      <strong style={{ fontSize: "13px" }}>{task.label}</strong>
                      <span className="field-hint">{task.desc}</span>
                    </div>
                    <div style={{ marginTop: "6px" }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm btn-leading-icon"
                        disabled={taskBusy}
                        onClick={() => enqueueAgentTaskAction(task.type, {})}
                      >
                        <Icons.Sparkles size={13} />
                        <span>{taskBusy ? "Queueing..." : task.label}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Tickets */}
          {ticketList.length > 0 && (
            <div className="stack-sm">
              <span className="field-label tabular">{`Agent task queue (${ticketList.length})`}</span>
              <div className="simple-table-wrap">
                <table className="simple-table">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Type</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ticketList.slice(0, 8).map((ticket) => (
                      <tr key={ticket.id}>
                        <td className="mono">{ticket.id}</td>
                        <td className="mono">{ticket.type}</td>
                        <td>
                          <span className={`tag-pill ${statusBadgeColor(ticket.status)}`}>
                            {ticket.status || "queued"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="drawer-footer">
          <button type="button" className="btn btn-primary" onClick={() => onClose?.()}>
            Done
          </button>
        </div>
      </aside>
    </>
  );
}

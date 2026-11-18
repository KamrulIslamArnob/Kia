import { useState, useEffect } from "react";
import { useStudio, Icons } from "../store.jsx";
import { resolveMediaUrl } from "../api.js";

function formatSavedTimestamp(isoValue) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

function formatOriginBadge(frameId, version) {
  const cleanOrigin = frameId
    ? String(frameId).replace(/^frame_0?(\d+)$/i, "Scene $1")
    : "Storyboard frame";
  return version ? `${cleanOrigin} · v${version}` : cleanOrigin;
}

export function SavedFramesDrawer({ open, onClose }) {
  const { theme, activeSlug, savedFrames, removeSavedFrame } = useStudio();
  const [deletingId, setDeletingId] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isDark = theme === "dark";
  const items = Array.isArray(savedFrames) ? savedFrames : [];
  const imageOutline = isDark ? "1px solid oklch(1 0 0 / 0.1)" : "1px solid oklch(0 0 0 / 0.1)";

  const handleDelete = async (savedId) => {
    if (!savedId || deletingId) return;
    setDeletingId(savedId);
    try {
      await removeSavedFrame?.(savedId);
    } finally {
      setDeletingId("");
    }
  };

  return (
    <div
      className="drawer-backdrop saved-frames-backdrop open is-open"
      role="dialog"
      aria-modal="true"
      aria-label="Saved frames"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: isDark ? "oklch(0 0 0 / 0.65)" : "oklch(0 0 0 / 0.28)",
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <aside
        className="drawer-panel saved-frames-drawer"
        style={{
          width: "min(440px, 100vw)",
          height: "100%",
          background: "var(--bg-surface, var(--surface, #FFFFFF))",
          color: "var(--text-primary, var(--text, #111111))",
          borderInlineStart: "1px solid var(--border-divider, #EAEAEA)",
          boxShadow:
            "var(--shadow-border, 0px 0px 0px 1px oklch(0 0 0 / 0.06), 0px 1px 2px -1px oklch(0 0 0 / 0.06), 0px 2px 4px 0px oklch(0 0 0 / 0.04))",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Drawer Header */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-divider, #EAEAEA)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Icons.Bookmark width={16} height={16} />
            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Saved frames</h2>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                padding: "2px 8px",
                borderRadius: "9999px",
                background: "var(--bg-subtle, #F7F6F3)",
                border: "1px solid var(--border-divider, #EAEAEA)",
                color: "var(--text-secondary, #787774)",
              }}
            >
              {items.length}
            </span>
          </div>

          <button
            type="button"
            aria-label="Close saved frames"
            onClick={() => onClose?.()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "30px",
              height: "30px",
              borderRadius: "6px",
              border: "1px solid var(--border-divider, #EAEAEA)",
              background: "var(--bg-surface, var(--surface, #FFFFFF))",
              color: "var(--text-primary, var(--text, #111111))",
              cursor: "pointer",
            }}
          >
            <Icons.X width={14} height={14} />
          </button>
        </header>

        {/* Drawer Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {items.length === 0 ? (
            <div
              style={{
                marginTop: "24px",
                padding: "24px 20px",
                borderRadius: "12px",
                border: "1px solid var(--border-divider, #EAEAEA)",
                background: "var(--bg-subtle, #F7F6F3)",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "8px",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 600 }}>No saved frames yet</div>
              <p
                style={{
                  margin: 0,
                  fontSize: "12px",
                  lineHeight: 1.5,
                  color: "var(--text-secondary, #787774)",
                }}
              >
                Bookmark any scene version in Design frames or the canvas studio to keep a permanent
                PNG snapshot you can compare or download anytime.
              </p>
              <button
                type="button"
                onClick={() => onClose?.()}
                style={{
                  marginTop: "4px",
                  padding: "7px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-divider, #EAEAEA)",
                  background: "var(--bg-surface, var(--surface, #FFFFFF))",
                  color: "var(--text-primary, var(--text, #111111))",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Return to workspace
              </button>
            </div>
          ) : (
            items.map((item) => {
              const savedId = item.savedId || item.id;
              const ownerSlug = item.slug || activeSlug || "";
              const imgUrl = resolveMediaUrl(
                ownerSlug,
                item.imageUrl ||
                  item.savedFrameUrl ||
                  item.url ||
                  item.designFrameUrl ||
                  item.imageRelPath ||
                  item.imagePath ||
                  item.relPath ||
                  item.path,
              );
              const timestamp = formatSavedTimestamp(
                item.createdAt || item.savedAt || item.timestamp,
              );
              const originText = formatOriginBadge(item.frameId, item.version);
              const downloadName = `${ownerSlug || "project"}_${item.frameId || "frame"}_${savedId}.png`;
              const isDeleting = deletingId === savedId;

              return (
                <article
                  key={savedId}
                  style={{
                    borderRadius: "16px",
                    padding: "8px",
                    background: "var(--bg-subtle, #F7F6F3)",
                    border: "1px solid var(--border-divider, #EAEAEA)",
                    display: "flex",
                    gap: "12px",
                    alignItems: "stretch",
                  }}
                >
                  {/* Concentric 8px Inner Thumbnail with 1px oklch(0 0 0 / 0.1) Outline */}
                  <div
                    style={{
                      width: "92px",
                      minHeight: "120px",
                      borderRadius: "8px",
                      overflow: "hidden",
                      background: "#111111",
                      flexShrink: 0,
                    }}
                  >
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={item.label || originText}
                        style={{
                          display: "block",
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          outline: imageOutline,
                          outlineOffset: "-1px",
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
                          fontSize: "11px",
                          color: "#FFFFFF",
                        }}
                      >
                        No preview
                      </div>
                    )}
                  </div>

                  {/* Metadata & Actions */}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "4px 4px 4px 0",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "8px",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.label || item.title || "Saved frame"}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "11px",
                          fontFamily: 'var(--font-mono, "Geist Mono", "SF Mono", monospace)',
                          fontVariantNumeric: "tabular-nums",
                          color: "var(--text-secondary, #787774)",
                        }}
                      >
                        <span>{originText}</span>
                        {timestamp && <span>· {timestamp}</span>}
                      </div>

                      {item.notes && (
                        <p
                          style={{
                            margin: "2px 0 0 0",
                            fontSize: "11px",
                            color: "var(--text-secondary, #787774)",
                            lineHeight: 1.35,
                          }}
                        >
                          {item.notes}
                        </p>
                      )}
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {imgUrl && (
                        <a
                          href={imgUrl}
                          download={downloadName}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "5px 9px",
                            borderRadius: "6px",
                            border: "1px solid var(--border-divider, #EAEAEA)",
                            background: "var(--bg-surface, var(--surface, #FFFFFF))",
                            color: "var(--text-primary, var(--text, #111111))",
                            fontSize: "11px",
                            fontWeight: 500,
                            textDecoration: "none",
                          }}
                        >
                          <Icons.Download width={12} height={12} />
                          <span>Download PNG</span>
                        </a>
                      )}

                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => handleDelete(savedId)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "5px 9px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-divider, #EAEAEA)",
                          background: "var(--bg-surface, var(--surface, #FFFFFF))",
                          color: "#9F2F2D",
                          fontSize: "11px",
                          fontWeight: 500,
                          cursor: isDeleting ? "wait" : "pointer",
                        }}
                      >
                        <Icons.Trash width={12} height={12} />
                        <span>{isDeleting ? "Deleting..." : "Delete"}</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}

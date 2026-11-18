import { useState, useMemo } from "react";
import { useStudio, Icons } from "../store.jsx";

const CATEGORY_BAR_DEFS = [
  { key: "hookAndPacing", altKeys: ["pacing"], label: "Hook & pacing" },
  {
    key: "visualHierarchyAndContrast",
    altKeys: ["visualContrast", "contrast"],
    label: "Visual contrast",
  },
  { key: "motionContinuity", altKeys: ["motion"], label: "Motion continuity" },
  { key: "skillAlignment", altKeys: ["selectedSkills", "skills"], label: "Selected skills" },
  { key: "brandConsistency", altKeys: ["brand"], label: "Brand consistency" },
  { key: "audioAndCaptions", altKeys: ["audio", "captions"], label: "Audio & captions" },
];

function resolveCategoryMetric(videoRating, primaryKey, altKeys = []) {
  if (!videoRating || typeof videoRating !== "object") {
    return { score: 0, detail: "" };
  }
  const containers = [
    videoRating.categories,
    videoRating.subScores,
    videoRating.breakdown,
    videoRating.scores,
    videoRating,
  ];
  const candidateKeys = [primaryKey, ...altKeys];

  for (const bag of containers) {
    if (!bag) continue;
    if (Array.isArray(bag)) {
      const hit = bag.find((entry) => candidateKeys.includes(entry?.id || entry?.key));
      if (hit) {
        return {
          score: Math.max(0, Math.min(100, Math.round(Number(hit.score ?? hit.value ?? 0)))),
          detail: String(hit.detail || hit.summary || ""),
        };
      }
      continue;
    }
    if (typeof bag === "object") {
      for (const k of candidateKeys) {
        const raw = bag[k];
        if (typeof raw === "number") {
          return { score: Math.max(0, Math.min(100, Math.round(raw))), detail: "" };
        }
        if (
          raw &&
          typeof raw === "object" &&
          (raw.score !== undefined || raw.value !== undefined)
        ) {
          return {
            score: Math.max(0, Math.min(100, Math.round(Number(raw.score ?? raw.value ?? 0)))),
            detail: String(raw.detail || raw.summary || ""),
          };
        }
      }
    }
  }

  return { score: 0, detail: "" };
}

function getGradeBadgePalette(grade, isDark) {
  const g = String(grade || "").toUpperCase();
  if (g === "S" || g === "A+" || g === "A") {
    return isDark
      ? { bg: "oklch(0.32 0.06 148)", text: "#BBF7D0" }
      : { bg: "#EDF3EC", text: "#346538" };
  }
  if (g === "B+") {
    return isDark
      ? { bg: "oklch(0.30 0.06 240)", text: "#BAE6FD" }
      : { bg: "#E1F3FE", text: "#1F6C9F" };
  }
  if (g === "B") {
    return isDark
      ? { bg: "oklch(0.32 0.06 85)", text: "#FDE68A" }
      : { bg: "#FBF3DB", text: "#956400" };
  }
  return isDark
    ? { bg: "oklch(0.30 0.07 25)", text: "#FECACA" }
    : { bg: "#FDEBEC", text: "#9F2F2D" };
}

function getScopeTag(sourceScope) {
  if (sourceScope === "project") return "Project";
  if (sourceScope === "workspace-skills") return "Core";
  if (sourceScope === "workspace-agents") return "Studio";
  return "Library";
}

export function SkillsAndRatingPanel({ compact = false }) {
  const {
    theme,
    activeSlug,
    skills,
    selectedSkills,
    videoRating,
    toggleSkillSelection,
    installLocalSkill,
    runVideoRating,
    regenerateShot,
  } = useStudio();

  const isDark = theme === "dark";
  const allSkills = useMemo(() => (Array.isArray(skills) ? skills : []), [skills]);
  const activeSet = useMemo(
    () => new Set(Array.isArray(selectedSkills) ? selectedSkills : []),
    [selectedSkills],
  );

  const installedSkills = useMemo(
    () => allSkills.filter((item) => item && item.installed !== false),
    [allSkills],
  );
  const availableLibrarySkills = useMemo(
    () => allSkills.filter((item) => item && item.installed === false),
    [allSkills],
  );

  const [showInstaller, setShowInstaller] = useState(false);
  const [installerTab, setInstallerTab] = useState("library");
  const [targetScope, setTargetScope] = useState("workspace");
  const [folderPath, setFolderPath] = useState("");
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customRules, setCustomRules] = useState("");
  const [installingId, setInstallingId] = useState("");
  const [installError, setInstallError] = useState("");

  const [ratingBusy, setRatingBusy] = useState(false);
  const [fixingFrameId, setFixingFrameId] = useState("");

  const activeCount = activeSet.size;
  const activeCountText =
    activeCount === 1 ? "1 local skill active" : `${activeCount} local skills active`;

  const handleToggleSkill = async (skillId) => {
    if (!skillId) return;
    await toggleSkillSelection?.(skillId);
  };

  const handleInstallFromLibrary = async (skillId) => {
    if (!skillId || installingId) return;
    setInstallError("");
    setInstallingId(skillId);
    try {
      await installLocalSkill?.({
        globalSkillId: skillId,
        targetScope,
        slug: activeSlug || null,
      });
    } catch (err) {
      setInstallError(err?.message || "Unable to install skill from library. Try again.");
    } finally {
      setInstallingId("");
    }
  };

  const handleInstallFromFolder = async (event) => {
    event.preventDefault();
    const trimmed = folderPath.trim();
    if (!trimmed) {
      setInstallError("Enter the local folder path containing SKILL.md.");
      return;
    }
    setInstallError("");
    setInstallingId("__folder__");
    try {
      await installLocalSkill?.({
        sourcePath: trimmed,
        targetScope,
        slug: activeSlug || null,
      });
      setFolderPath("");
      setShowInstaller(false);
    } catch (err) {
      setInstallError(
        err?.message || "Unable to copy skill folder. Check that SKILL.md exists at that path.",
      );
    } finally {
      setInstallingId("");
    }
  };

  const handleSaveCustomSkill = async (event) => {
    event.preventDefault();
    const trimmedName = customName.trim();
    const trimmedRules = customRules.trim();
    if (!trimmedName) {
      setInstallError("Enter a skill name (for example: luxury-launch-reel).");
      return;
    }
    if (!trimmedRules) {
      setInstallError("Write at least one Markdown rule before saving.");
      return;
    }
    setInstallError("");
    setInstallingId("__custom__");
    try {
      await installLocalSkill?.({
        name: trimmedName,
        description: customDescription.trim() || "Custom local studio skill",
        content: trimmedRules,
        targetScope,
        slug: activeSlug || null,
      });
      setCustomName("");
      setCustomDescription("");
      setCustomRules("");
      setShowInstaller(false);
    } catch (err) {
      setInstallError(err?.message || "Unable to save custom skill. Check the skill name.");
    } finally {
      setInstallingId("");
    }
  };

  const handleRunRating = async () => {
    if (ratingBusy) return;
    setRatingBusy(true);
    try {
      await runVideoRating?.();
    } finally {
      setRatingBusy(false);
    }
  };

  const handleApplyFrameFix = async (frameRating) => {
    if (!frameRating?.frameId || !frameRating?.suggestedFixPrompt || fixingFrameId) return;
    setFixingFrameId(frameRating.frameId);
    try {
      await regenerateShot?.(frameRating.frameId, {
        prompt: frameRating.suggestedFixPrompt,
      });
      await runVideoRating?.();
    } finally {
      setFixingFrameId("");
    }
  };

  const actionableFrameIssues = useMemo(() => {
    const list = Array.isArray(videoRating?.frameRatings) ? videoRating.frameRatings : [];
    return list.filter(
      (fr) =>
        (Array.isArray(fr?.issues) && fr.issues.length > 0) || Boolean(fr?.suggestedFixPrompt),
    );
  }, [videoRating]);

  const SparklesIcon = Icons.Sparkles || Icons.Wand || Icons.Star;
  const gradeColors = getGradeBadgePalette(videoRating?.grade, isDark);

  return (
    <section
      className={`skills-rating-panel ${compact ? "is-compact" : ""}`}
      aria-label="Local skills and video quality audit"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? "12px" : "18px",
      }}
    >
      {/* Part A: Dynamic Local Skills Selector & 1-Click Installer */}
      <div
        className="studio-card"
        style={{
          background: "var(--bg-surface, var(--surface, #FFFFFF))",
          borderRadius: "12px",
          padding: compact ? "14px" : "18px",
          boxShadow:
            "var(--shadow-border, 0px 0px 0px 1px oklch(0 0 0 / 0.06), 0px 1px 2px -1px oklch(0 0 0 / 0.06), 0px 2px 4px 0px oklch(0 0 0 / 0.04))",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: compact ? "14px" : "15px", fontWeight: 600 }}>
              Local creative skills
            </h3>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                padding: "2px 8px",
                borderRadius: "9999px",
                background: activeCount > 0 ? "#EDF3EC" : "var(--bg-subtle, #F7F6F3)",
                color: activeCount > 0 ? "#346538" : "var(--text-secondary, #787774)",
                border: "1px solid var(--border-divider, #EAEAEA)",
              }}
            >
              {activeCountText}
            </span>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-expanded={showInstaller}
            onClick={() => {
              setInstallError("");
              setShowInstaller((prev) => !prev);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "6px 10px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 500,
              border: "1px solid var(--border-divider, #EAEAEA)",
              background: "var(--bg-surface, var(--surface, #FFFFFF))",
              color: "var(--text-primary, var(--text, #111111))",
              cursor: "pointer",
            }}
          >
            {showInstaller ? (
              <Icons.X width={13} height={13} />
            ) : (
              <Icons.Plus width={13} height={13} />
            )}
            <span>{showInstaller ? "Close skill installer" : "Install or create skill"}</span>
          </button>
        </div>

        {!compact && (
          <p
            style={{
              margin: 0,
              fontSize: "12px",
              color: "var(--text-secondary, #787774)",
              lineHeight: 1.5,
            }}
          >
            Toggle workspace or project Markdown skills to guide frame staging, motion seams,
            captions, and quality checks.
          </p>
        )}

        {/* Inline 3-Tab Skill Installer Disclosure */}
        {showInstaller && (
          <div
            style={{
              padding: "14px",
              borderRadius: "10px",
              background: "var(--bg-subtle, var(--surface-muted, #F7F6F3))",
              border: "1px solid var(--border-divider, #EAEAEA)",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
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
              <div
                role="tablist"
                aria-label="Install or create local skill"
                style={{
                  display: "inline-flex",
                  flexWrap: "wrap",
                  gap: "4px",
                  padding: "3px",
                  borderRadius: "8px",
                  background: "var(--bg-surface, var(--surface, #FFFFFF))",
                  border: "1px solid var(--border-divider, #EAEAEA)",
                }}
              >
                {[
                  { id: "library", label: "From available library" },
                  { id: "folder", label: "From local folder path" },
                  { id: "custom", label: "Write custom skill" },
                ].map((tab) => {
                  const active = installerTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        setInstallError("");
                        setInstallerTab(tab.id);
                      }}
                      style={{
                        border: "none",
                        borderRadius: "5px",
                        padding: "5px 10px",
                        fontSize: "12px",
                        fontWeight: active ? 600 : 500,
                        background: active ? "#111111" : "transparent",
                        color: active ? "#FFFFFF" : "var(--text-primary, var(--text, #111111))",
                        cursor: "pointer",
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <label htmlFor="skill-install-scope" style={{ fontSize: "11px", fontWeight: 500 }}>
                  Save to
                </label>
                <select
                  id="skill-install-scope"
                  value={targetScope}
                  onChange={(e) => setTargetScope(e.target.value)}
                  style={{
                    padding: "4px 8px",
                    fontSize: "11px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-divider, #EAEAEA)",
                    background: "var(--bg-surface, var(--surface, #FFFFFF))",
                    color: "var(--text-primary, var(--text, #111111))",
                  }}
                >
                  <option value="workspace">Workspace (.agents/skills)</option>
                  {activeSlug && <option value="project">Current project ({activeSlug})</option>}
                </select>
              </div>
            </div>

            {installError && (
              <div
                role="alert"
                style={{
                  padding: "8px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  background: "#FDEBEC",
                  color: "#9F2F2D",
                  border: "1px solid oklch(0.6 0.15 25 / 0.25)",
                }}
              >
                {installError}
              </div>
            )}

            {/* Tab 1: From available library */}
            {installerTab === "library" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {availableLibrarySkills.length === 0 ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: "12px",
                      color: "var(--text-secondary, #787774)",
                    }}
                  >
                    All discovered local library skills are already installed. Choose another tab to
                    import a skill folder or write a custom SKILL.md.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                      gap: "8px",
                      maxHeight: "220px",
                      overflowY: "auto",
                    }}
                  >
                    {availableLibrarySkills.map((sk) => {
                      const busy = installingId === sk.id;
                      return (
                        <div
                          key={sk.id}
                          style={{
                            padding: "10px",
                            borderRadius: "8px",
                            background: "var(--bg-surface, var(--surface, #FFFFFF))",
                            border: "1px solid var(--border-divider, #EAEAEA)",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            gap: "8px",
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: "12px",
                                fontWeight: 600,
                                marginBottom: "3px",
                              }}
                            >
                              {sk.name || sk.id}
                            </div>
                            <div
                              style={{
                                fontSize: "11px",
                                color: "var(--text-secondary, #787774)",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {sk.description || "Local skill package"}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={Boolean(installingId)}
                            onClick={() => handleInstallFromLibrary(sk.id)}
                            style={{
                              alignSelf: "flex-start",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                              padding: "5px 10px",
                              borderRadius: "6px",
                              border: "1px solid #111111",
                              background: "#111111",
                              color: "#FFFFFF",
                              fontSize: "11px",
                              fontWeight: 600,
                              cursor: installingId ? "wait" : "pointer",
                            }}
                          >
                            <Icons.Plus width={12} height={12} />
                            <span>{busy ? "Installing..." : "Install skill"}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: From local folder path */}
            {installerTab === "folder" && (
              <form
                onSubmit={handleInstallFromFolder}
                style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-end" }}
              >
                <div
                  style={{
                    flex: "1 1 260px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <label
                    htmlFor="local-skill-folder-input"
                    style={{ fontSize: "12px", fontWeight: 500 }}
                  >
                    Local skill folder path
                  </label>
                  <input
                    id="local-skill-folder-input"
                    type="text"
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    placeholder="D:\MySkills\luxury-reel"
                    style={{
                      padding: "8px 10px",
                      fontSize: "12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, var(--surface, #FFFFFF))",
                      color: "var(--text-primary, var(--text, #111111))",
                    }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={Boolean(installingId)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 14px",
                    borderRadius: "6px",
                    border: "1px solid var(--cta-bg, #111111)",
                    background: "var(--cta-bg, #111111)",
                    color: "var(--cta-fg, #FFFFFF)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: installingId ? "wait" : "pointer",
                  }}
                >
                  <Icons.Folder width={13} height={13} />
                  <span>{installingId === "__folder__" ? "Installing..." : "Install skill"}</span>
                </button>
              </form>
            )}

            {/* Tab 3: Write custom skill */}
            {installerTab === "custom" && (
              <form
                onSubmit={handleSaveCustomSkill}
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label
                      htmlFor="custom-skill-name"
                      style={{ fontSize: "12px", fontWeight: 500 }}
                    >
                      Skill name
                    </label>
                    <input
                      id="custom-skill-name"
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="luxury-product-reel"
                      style={{
                        padding: "7px 10px",
                        fontSize: "12px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-divider, #EAEAEA)",
                        background: "var(--bg-surface, var(--surface, #FFFFFF))",
                        color: "var(--text-primary, var(--text, #111111))",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label
                      htmlFor="custom-skill-desc"
                      style={{ fontSize: "12px", fontWeight: 500 }}
                    >
                      Description
                    </label>
                    <input
                      id="custom-skill-desc"
                      type="text"
                      value={customDescription}
                      onChange={(e) => setCustomDescription(e.target.value)}
                      placeholder="Pacing, contrast, and motion rules for product launch videos"
                      style={{
                        padding: "7px 10px",
                        fontSize: "12px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-divider, #EAEAEA)",
                        background: "var(--bg-surface, var(--surface, #FFFFFF))",
                        color: "var(--text-primary, var(--text, #111111))",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label htmlFor="custom-skill-rules" style={{ fontSize: "12px", fontWeight: 500 }}>
                    Rules (Markdown)
                  </label>
                  <textarea
                    id="custom-skill-rules"
                    rows={4}
                    value={customRules}
                    onChange={(e) => setCustomRules(e.target.value)}
                    placeholder={
                      "- Keep opening hook under 3.0 seconds with bold headline.\n- Maintain >= 4.5:1 contrast on all overlays.\n- Use crisp cut-the-curve transitions between shots."
                    }
                    style={{
                      padding: "8px 10px",
                      fontSize: "12px",
                      fontFamily: 'var(--font-mono, "Geist Mono", "SF Mono", monospace)',
                      borderRadius: "6px",
                      border: "1px solid var(--border-divider, #EAEAEA)",
                      background: "var(--bg-surface, var(--surface, #FFFFFF))",
                      color: "var(--text-primary, var(--text, #111111))",
                      resize: "vertical",
                    }}
                  />
                </div>

                <div>
                  <button
                    type="submit"
                    disabled={Boolean(installingId)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 14px",
                      borderRadius: "6px",
                      border: "1px solid #111111",
                      background: "#111111",
                      color: "#FFFFFF",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: installingId ? "wait" : "pointer",
                    }}
                  >
                    <Icons.Check width={13} height={13} />
                    <span>
                      {installingId === "__custom__" ? "Saving SKILL.md..." : "Save custom skill"}
                    </span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Installed Local Skill Cards Grid */}
        {installedSkills.length === 0 ? (
          <div
            style={{
              padding: "14px",
              borderRadius: "8px",
              border: "1px solid var(--border-divider, #EAEAEA)",
              background: "var(--bg-subtle, #F7F6F3)",
              fontSize: "12px",
              color: "var(--text-secondary, #787774)",
            }}
          >
            No local skills detected yet. Click Install or create skill above to add one to
            .agents/skills/.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: compact
                ? "repeat(auto-fill, minmax(200px, 1fr))"
                : "repeat(auto-fill, minmax(240px, 1fr))",
              gap: "8px",
            }}
          >
            {installedSkills.map((sk) => {
              const isSelected = activeSet.has(sk.id);
              const highlights = Array.isArray(sk.ruleHighlights)
                ? sk.ruleHighlights.slice(0, compact ? 2 : 3)
                : [];
              return (
                <button
                  key={sk.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => handleToggleSkill(sk.id)}
                  style={{
                    textAlign: "left",
                    padding: compact ? "9px 11px" : "11px 13px",
                    borderRadius: "8px",
                    border: isSelected
                      ? "1px solid var(--text-primary, #111111)"
                      : "1px solid var(--border-divider, #EAEAEA)",
                    background: isSelected
                      ? "var(--bg-subtle, #F7F6F3)"
                      : "var(--bg-surface, var(--surface, #FFFFFF))",
                    color: "var(--text-primary, var(--text, #111111))",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "6px",
                      width: "100%",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sk.name || sk.id}
                    </span>

                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "10px",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          padding: "1px 6px",
                          borderRadius: "9999px",
                          background: "var(--bg-surface, #FFFFFF)",
                          border: "1px solid var(--border-divider, #EAEAEA)",
                          color: "var(--text-secondary, #787774)",
                        }}
                      >
                        {sk.category || getScopeTag(sk.sourceScope)}
                      </span>
                      {isSelected && (
                        <span
                          style={{
                            width: "16px",
                            height: "16px",
                            borderRadius: "9999px",
                            background: "#111111",
                            color: "#FFFFFF",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Icons.Check width={10} height={10} />
                        </span>
                      )}
                    </span>
                  </div>

                  {!compact && sk.description && (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary, #787774)",
                        lineHeight: 1.4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {sk.description}
                    </span>
                  )}

                  {isSelected && highlights.length > 0 && (
                    <ul
                      style={{
                        margin: "2px 0 0 0",
                        paddingLeft: "14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "3px",
                        fontSize: "11px",
                        color: "var(--text-secondary, #787774)",
                        lineHeight: 1.35,
                      }}
                    >
                      {highlights.map((rule, rIdx) => (
                        <li key={rIdx}>{rule}</li>
                      ))}
                    </ul>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Part B: Whole-Video Quality Rating & Skill Audit Card */}
      {!compact && (
        <div
          className="studio-card"
          style={{
            background: "var(--bg-surface, var(--surface, #FFFFFF))",
            borderRadius: "12px",
            padding: "18px",
            boxShadow:
              "var(--shadow-border, 0px 0px 0px 1px oklch(0 0 0 / 0.06), 0px 1px 2px -1px oklch(0 0 0 / 0.06), 0px 2px 4px 0px oklch(0 0 0 / 0.04))",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>
                  Whole-video quality rating
                </h3>
                <p
                  style={{
                    margin: "2px 0 0 0",
                    fontSize: "12px",
                    color: "var(--text-secondary, #787774)",
                  }}
                >
                  {videoRating?.verdict ||
                    "Audit pacing, WCAG contrast, motion seams, speaking rate, and active skill compliance before rendering."}
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              {videoRating && typeof videoRating.overallScore === "number" && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px 12px",
                    borderRadius: "9999px",
                    background: gradeColors.bg,
                    color: gradeColors.text,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span style={{ fontSize: "14px", fontWeight: 700 }}>
                    {Math.round(videoRating.overallScore)} / 100
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      paddingLeft: "8px",
                      borderLeft: "1px solid currentColor",
                    }}
                  >
                    Grade {videoRating.grade || "A"}
                  </span>
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary"
                disabled={ratingBusy}
                onClick={handleRunRating}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "1px solid #111111",
                  background: "#111111",
                  color: "#FFFFFF",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: ratingBusy ? "wait" : "pointer",
                }}
              >
                <Icons.Star width={14} height={14} />
                <span>{ratingBusy ? "Scoring frames..." : "Rate design frames"}</span>
              </button>
            </div>
          </div>

          {videoRating && typeof videoRating.overallScore === "number" && (
            <>
              {/* 6 Horizontal Category Progress Bars */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                  gap: "12px",
                }}
              >
                {CATEGORY_BAR_DEFS.map((cat) => {
                  const metric = resolveCategoryMetric(videoRating, cat.key, cat.altKeys);
                  return (
                    <div
                      key={cat.key}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "5px",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--border-divider, #EAEAEA)",
                        background: "var(--bg-subtle, #F7F6F3)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          fontSize: "12px",
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{cat.label}</span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono, "Geist Mono", "SF Mono", monospace)',
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: 600,
                          }}
                        >
                          {metric.score}
                        </span>
                      </div>

                      <div
                        role="progressbar"
                        aria-label={cat.label}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={metric.score}
                        style={{
                          width: "100%",
                          height: "6px",
                          borderRadius: "9999px",
                          background: "var(--border-divider, #EAEAEA)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${metric.score}%`,
                            height: "100%",
                            borderRadius: "9999px",
                            background:
                              metric.score >= 85
                                ? "#346538"
                                : metric.score >= 70
                                  ? "var(--text-primary, #111111)"
                                  : "#956400",
                            transitionProperty: "width",
                            transitionDuration: "180ms",
                            transitionTimingFunction: "ease-out",
                          }}
                        />
                      </div>

                      {metric.detail && (
                        <span
                          style={{
                            fontSize: "11px",
                            color: "var(--text-secondary, #787774)",
                            lineHeight: 1.35,
                          }}
                        >
                          {metric.detail}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Per-Frame Issues & 1-Click Fix List */}
              {actionableFrameIssues.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: "#EDF3EC",
                    color: "#346538",
                    fontSize: "12px",
                    fontWeight: 500,
                  }}
                >
                  <Icons.Check width={14} height={14} />
                  <span>All design frames pass current quality and active skill checks.</span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600 }}>
                    Scene refinements ({actionableFrameIssues.length})
                  </div>
                  {actionableFrameIssues.map((fr) => {
                    const isFixing = fixingFrameId === fr.frameId;
                    return (
                      <div
                        key={fr.frameId}
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "10px",
                          padding: "10px 12px",
                          borderRadius: "8px",
                          border: "1px solid var(--border-divider, #EAEAEA)",
                          background: "var(--bg-surface, var(--surface, #FFFFFF))",
                        }}
                      >
                        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              marginBottom: "3px",
                            }}
                          >
                            <span
                              style={{
                                fontFamily: 'var(--font-mono, "Geist Mono", "SF Mono", monospace)',
                                fontSize: "11px",
                                fontVariantNumeric: "tabular-nums",
                                color: "var(--text-secondary, #787774)",
                              }}
                            >
                              Scene {String(fr.index || 1).padStart(2, "0")} ·{" "}
                              {Math.round(Number(fr.score || 0))}/100
                            </span>
                            <span style={{ fontSize: "12px", fontWeight: 600 }}>
                              {fr.title || fr.frameId}
                            </span>
                          </div>

                          {Array.isArray(fr.issues) && fr.issues.length > 0 && (
                            <ul
                              style={{
                                margin: 0,
                                paddingLeft: "16px",
                                fontSize: "12px",
                                color: "var(--text-secondary, #787774)",
                                lineHeight: 1.4,
                              }}
                            >
                              {fr.issues.map((issue, idx) => (
                                <li key={idx}>{issue}</li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {fr.suggestedFixPrompt && (
                          <button
                            type="button"
                            disabled={Boolean(fixingFrameId)}
                            onClick={() => handleApplyFrameFix(fr)}
                            title={fr.suggestedFixPrompt}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "7px 12px",
                              borderRadius: "6px",
                              border: "1px solid #111111",
                              background: "#111111",
                              color: "#FFFFFF",
                              fontSize: "12px",
                              fontWeight: 600,
                              cursor: fixingFrameId ? "wait" : "pointer",
                              flexShrink: 0,
                            }}
                          >
                            <SparklesIcon width={13} height={13} />
                            <span>{isFixing ? "Applying fix..." : "Apply fix"}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

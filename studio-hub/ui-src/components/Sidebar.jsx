import { useStudio, Icons } from "../store.jsx";

const STEP_ITEMS = [
  {
    step: 1,
    title: "Raw footage",
    subtitle: "Videos, folder, or link",
  },
  {
    step: 2,
    title: "Inspiration",
    subtitle: "Reference style videos",
  },
  {
    step: 3,
    title: "Brand & goal",
    subtitle: "Colors, logo, instructions",
  },
  {
    step: 4,
    title: "Design frames",
    subtitle: "Draw, prompt, skills & rating",
  },
  {
    step: 5,
    title: "Generate video",
    subtitle: "Settings & final MP4",
  },
];

function computeStepReady(stepNumber, project, storyboard) {
  if (!project) return false;
  switch (stepNumber) {
    case 1:
      return (
        (Array.isArray(project.files?.rawVideo) && project.files.rawVideo.length > 0) ||
        (Array.isArray(project.files?.clips) &&
          project.files.clips.some((clip) => !String(clip.name || "").startsWith("shot_frame_")))
      );
    case 2:
      return (
        Boolean(project.inspirationProfile) ||
        (Array.isArray(project.files?.inspiration) && project.files.inspiration.length > 0) ||
        (Array.isArray(project.referenceLinks) && project.referenceLinks.length > 0)
      );
    case 3:
      return (
        Boolean(project.instructions && String(project.instructions).trim().length > 0) ||
        (Array.isArray(project.files?.brand) && project.files.brand.length > 0) ||
        Boolean(project.brandKit?.logoRelPath) ||
        (Array.isArray(project.brandKit?.extractedPalette) &&
          project.brandKit.extractedPalette.length > 0)
      );
    case 4:
      return Array.isArray(storyboard?.frames) && storyboard.frames.length > 0;
    case 5:
      return Array.isArray(project.files?.renders) && project.files.renders.length > 0;
    default:
      return false;
  }
}

export function Sidebar({ onOpenSavedFrames, onOpenAgents, onOpenNewProject }) {
  const {
    step,
    setStep,
    theme,
    toggleTheme,
    projects,
    activeSlug,
    project,
    storyboard,
    selectedSkills,
    savedFrames,
    videoRating,
    agentCrew,
    tickets,
    switchProject,
    setSavedFramesDrawerOpen,
    setAgentsDrawerOpen,
    setNewProjectModalOpen,
  } = useStudio();

  const projectList = Array.isArray(projects) ? projects : [];
  const activeSkillCount = Array.isArray(selectedSkills) ? selectedSkills.length : 0;
  const savedFrameCount = Array.isArray(savedFrames) ? savedFrames.length : 0;

  const crewAgents = Array.isArray(agentCrew)
    ? agentCrew
    : Array.isArray(agentCrew?.agents)
      ? agentCrew.agents
      : [];
  const workingAgentsCount = crewAgents.filter((agent) => agent?.status === "working").length;
  const pendingTicketsCount = Array.isArray(tickets)
    ? tickets.filter((t) => t?.status === "queued" || t?.status === "working").length
    : 0;
  const isDark = theme === "dark";

  function handleOpenNewProject() {
    if (onOpenNewProject) onOpenNewProject();
    else setNewProjectModalOpen?.(true);
  }

  function handleOpenSavedFrames() {
    if (onOpenSavedFrames) onOpenSavedFrames();
    else setSavedFramesDrawerOpen?.(true);
  }

  function handleOpenAgents() {
    if (onOpenAgents) onOpenAgents();
    else setAgentsDrawerOpen?.(true);
  }

  return (
    <aside className="studio-sidebar" aria-label="Studio workspace navigation">
      <div className="sidebar-brand">
        <div className="sidebar-brand-identity">
          <span className="brand-mark" aria-hidden="true">
            <Icons.Layers size={15} />
          </span>
          <span className="brand-name">Video Studio</span>
        </div>
        <span className="tag-pill mono">V2</span>
      </div>

      <div className="sidebar-project-box">
        <div className="sidebar-footer-row">
          <label htmlFor="studio-project-select" className="sidebar-label">
            Project
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-leading-icon"
            onClick={handleOpenNewProject}
          >
            <Icons.Plus size={13} />
            <span>New project</span>
          </button>
        </div>

        <select
          id="studio-project-select"
          value={activeSlug || ""}
          onChange={(event) => {
            if (event.target.value) {
              switchProject(event.target.value);
            }
          }}
        >
          {projectList.length === 0 ? (
            <option value={activeSlug || ""}>
              {project?.title || activeSlug || "No projects yet"}
            </option>
          ) : (
            projectList.map((item) => {
              const slug = item.slug || item.id;
              return (
                <option key={slug} value={slug}>
                  {item.title || item.name || slug}
                </option>
              );
            })
          )}
        </select>
      </div>

      <nav className="step-nav" aria-label="5-step production guide">
        <div className="sidebar-label">Production steps</div>
        {STEP_ITEMS.map((item) => {
          const isActive = step === item.step;
          const isReady = computeStepReady(item.step, project, storyboard);
          return (
            <button
              key={item.step}
              type="button"
              className={`step-nav-btn ${isActive ? "active" : ""} ${isReady ? "completed" : ""}`}
              aria-current={isActive ? "step" : undefined}
              onClick={() => setStep(item.step)}
            >
              <span className="step-badge-circle tabular" aria-hidden="true">
                {isReady && !isActive ? <Icons.Check size={12} /> : item.step}
              </span>
              <span className="step-nav-copy">
                <span className="step-nav-title">{item.title}</span>
                <span className="step-nav-desc">{item.subtitle}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-quick-pills">
        <button
          type="button"
          className="system-utility-btn"
          onClick={() => setStep(storyboard?.frames?.length ? 4 : 3)}
        >
          <Icons.Sparkles size={15} />
          <span className="tabular">
            {activeSkillCount === 1 ? "1 skill" : `${activeSkillCount} skills`}
          </span>
          {videoRating?.overallScore != null && (
            <span className="sidebar-count-badge tabular">
              {`${videoRating.overallScore} · ${videoRating.grade}`}
            </span>
          )}
        </button>

        <button type="button" className="system-utility-btn" onClick={handleOpenSavedFrames}>
          <Icons.Bookmark size={15} />
          <span className="tabular">{`Saved frames (${savedFrameCount})`}</span>
        </button>

        <button type="button" className="system-utility-btn" onClick={handleOpenAgents}>
          <Icons.Cpu size={15} />
          <span>AI agents &amp; system</span>
          {(workingAgentsCount > 0 || pendingTicketsCount > 0) && (
            <span className="sidebar-count-badge tabular">
              {workingAgentsCount || pendingTicketsCount}
            </span>
          )}
        </button>
      </div>

      <div className="sidebar-footer">
        <button
          type="button"
          className="system-utility-btn"
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light appearance" : "Switch to dark appearance"}
        >
          <span className={`icon-swap theme-swap ${isDark ? "is-swapped" : ""}`}>
            <span className="icon-swap-active">
              <Icons.Moon size={15} />
            </span>
            <span className="icon-swap-inactive">
              <Icons.Sun size={15} />
            </span>
          </span>
          <span>{isDark ? "Dark appearance" : "Light appearance"}</span>
        </button>
      </div>
    </aside>
  );
}

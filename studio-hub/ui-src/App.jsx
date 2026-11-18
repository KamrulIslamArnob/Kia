import { useState, useEffect } from "react";
import { useStudio, Icons } from "./store.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { StepOneRaw, StepTwoInspiration, StepThreeBrand } from "./components/StepsOneToThree.jsx";
import { StepFourStoryboard } from "./components/StepFourStoryboard.jsx";
import { StepFiveExport } from "./components/StepFiveExport.jsx";
import { SavedFramesDrawer } from "./components/SavedFramesDrawer.jsx";
import { AgentsDrawer } from "./components/AgentsDrawer.jsx";

function slugifyPreview(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function App() {
  const {
    step,
    toasts,
    dismissToast,
    busyMap,
    createNewProject,
    savedFramesDrawerOpen,
    setSavedFramesDrawerOpen,
    agentsDrawerOpen,
    setAgentsDrawerOpen,
    newProjectModalOpen,
    setNewProjectModalOpen,
  } = useStudio();

  const [projectTitle, setProjectTitle] = useState("");
  const [projectFormat, setProjectFormat] = useState("9:16");
  const [projectDuration, setProjectDuration] = useState(30);
  const [projectLanguage, setProjectLanguage] = useState("English");

  useEffect(() => {
    if (!newProjectModalOpen) return undefined;
    function handleEscape(event) {
      if (event.key === "Escape") {
        setNewProjectModalOpen?.(false);
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [newProjectModalOpen, setNewProjectModalOpen]);

  async function handleCreateProjectSubmit(event) {
    event.preventDefault();
    const cleanTitle = projectTitle.trim();
    if (!cleanTitle) return;
    await createNewProject({
      name: cleanTitle,
      title: cleanTitle,
      slug: slugifyPreview(cleanTitle) || undefined,
      aspectRatio: projectFormat,
      durationSeconds: Math.max(4, Number(projectDuration) || 30),
      language: projectLanguage,
    });
    setProjectTitle("");
  }

  const creatingProject = Boolean(busyMap?.createNewProject);
  const toastItems = Array.isArray(toasts) ? toasts : [];

  return (
    <div className="studio-shell">
      <Sidebar
        onOpenSavedFrames={() => setSavedFramesDrawerOpen(true)}
        onOpenAgents={() => setAgentsDrawerOpen(true)}
        onOpenNewProject={() => setNewProjectModalOpen(true)}
      />

      <main className="studio-main" id="studio-main-workspace">
        {step === 1 && <StepOneRaw />}
        {step === 2 && <StepTwoInspiration />}
        {step === 3 && <StepThreeBrand />}
        {step === 4 && (
          <StepFourStoryboard onOpenSavedFrames={() => setSavedFramesDrawerOpen(true)} />
        )}
        {step === 5 && <StepFiveExport />}
      </main>

      <SavedFramesDrawer
        open={Boolean(savedFramesDrawerOpen)}
        onClose={() => setSavedFramesDrawerOpen(false)}
      />

      <AgentsDrawer open={Boolean(agentsDrawerOpen)} onClose={() => setAgentsDrawerOpen(false)} />

      {/* New Project Modal */}
      {newProjectModalOpen && (
        <div
          className="modal-backdrop open"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-project-modal-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setNewProjectModalOpen(false);
            }
          }}
        >
          <form className="modal-card" onSubmit={handleCreateProjectSubmit}>
            <div className="card-header">
              <div>
                <h2 id="new-project-modal-title" className="card-title">
                  Create new project
                </h2>
                <p className="card-desc">
                  Creates a fresh local folder in <code>projects/</code>.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                aria-label="Close modal"
                onClick={() => setNewProjectModalOpen(false)}
              >
                <Icons.X size={15} />
              </button>
            </div>

            <div className="field">
              <label htmlFor="new-project-title-input" className="field-label">
                <span>Project title</span>
                {projectTitle.trim() && (
                  <span className="field-hint mono">{`projects/${slugifyPreview(projectTitle)}/`}</span>
                )}
              </label>
              <input
                id="new-project-title-input"
                type="text"
                autoFocus
                required
                placeholder="Spring product launch reel"
                value={projectTitle}
                onChange={(event) => setProjectTitle(event.target.value)}
              />
            </div>

            <div className="grid-2">
              <div className="field">
                <label htmlFor="new-project-format-select" className="field-label">
                  Format
                </label>
                <select
                  id="new-project-format-select"
                  value={projectFormat}
                  onChange={(event) => setProjectFormat(event.target.value)}
                >
                  <option value="9:16">9:16 Vertical</option>
                  <option value="16:9">16:9 Horizontal</option>
                  <option value="1:1">1:1 Square</option>
                  <option value="4:5">4:5 Portrait</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="new-project-duration-input" className="field-label">
                  Target duration (sec)
                </label>
                <input
                  id="new-project-duration-input"
                  type="number"
                  min={4}
                  max={300}
                  value={projectDuration}
                  onChange={(event) => setProjectDuration(event.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="new-project-lang-select" className="field-label">
                Primary language
              </label>
              <select
                id="new-project-lang-select"
                value={projectLanguage}
                onChange={(event) => setProjectLanguage(event.target.value)}
              >
                <option value="English">English</option>
                <option value="Bengali (বাংলা)">Bengali (বাংলা)</option>
                <option value="Hindi">Hindi</option>
                <option value="Spanish">Spanish</option>
                <option value="Chinese (Simplified)">Chinese (Simplified)</option>
                <option value="Arabic">Arabic</option>
              </select>
            </div>

            <div className="inline-row" style={{ justifyContent: "flex-end", marginTop: "4px" }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setNewProjectModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-leading-icon"
                disabled={creatingProject || !projectTitle.trim()}
              >
                <Icons.Plus size={14} />
                <span>{creatingProject ? "Creating..." : "Create project"}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Toast Notifications */}
      {toastItems.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toastItems.map((item) => (
            <div key={item.id} className={`toast-item ${item.type || "info"}`}>
              <span>{item.message}</span>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                style={{ width: "22px", height: "22px" }}
                aria-label="Dismiss notification"
                onClick={() => dismissToast?.(item.id)}
              >
                <Icons.X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioProvider } from "./store.jsx";
import { App } from "./App.jsx";

const container =
  document.getElementById("studio-root") ||
  document.getElementById("root") ||
  document.getElementById("app");

if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <StudioProvider>
        <App />
      </StudioProvider>
    </StrictMode>,
  );
}

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme, loadMode, loadPalette } from "./lib/theme";

applyTheme(loadPalette(), loadMode());

// Vibrancy is a fact about the host, not a preference: inside Tauri the
// window carries an NSVisualEffectView and the chrome should be a wash
// over it; in a plain browser (dev server, screenshot harness) the same
// token falls back to a solid. Keyed on the Tauri bridge being present,
// which is exactly the condition under which the Rust side applied the
// effect.
// macOS only: the Rust side applies vibrancy nowhere else, and a
// transparent body with nothing behind it is a black window.
if ("__TAURI_INTERNALS__" in window && navigator.userAgent.includes("Mac")) {
  document.documentElement.dataset.vibrancy = "";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

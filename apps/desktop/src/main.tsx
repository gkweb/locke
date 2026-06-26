import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "./styles.css";
import { App } from "./App.js";
import { useStore } from "./state/store.js";
import { applyTheme, DEFAULT_THEME } from "./theme/themes.js";

// Seed every theme variable before the first paint so components reading
// `var(--lk-*)` have values immediately. `loadAgentSettings` later swaps in the
// user's persisted theme (a no-op repaint if it's the default).
applyTheme(DEFAULT_THEME);

// Dev-only: expose the store on window for quick inspection/poking from devtools
// (e.g. simulating an empty/no-repo state). Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __locke?: typeof useStore }).__locke = useStore;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    try {
      invoke("log_error", {
        msg: `[Frontend Error] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}\nStack: ${event.error?.stack || "No stack"}`,
      }).catch(() => {});
    } catch (_) {}
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      invoke("log_error", {
        msg: `[Frontend Unhandled Rejection] Reason: ${event.reason?.stack || event.reason || "Unknown"}`,
      }).catch(() => {});
    } catch (_) {}
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);


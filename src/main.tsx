import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { logger } from "./utils/logger";

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    try {
      const errorObj = event.error || new Error(event.message);
      const loc = `${event.filename || "unknown"}:${event.lineno || 0}:${event.colno || 0}`;
      logger.crash(
        `Uncaught Frontend Exception: ${event.message} at ${loc}`,
        errorObj,
        undefined,
        { filename: event.filename, lineno: event.lineno, colno: event.colno }
      );
    } catch (_) {}
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : String(reason || "Unknown Rejection");
      logger.error("PROMISE", `Unhandled Promise Rejection: ${msg}`, reason);
    } catch (_) {}
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);


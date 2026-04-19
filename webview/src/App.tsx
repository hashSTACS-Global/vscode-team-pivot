import React, { useEffect, useState } from "react";
import type { ExtensionToWebview } from "../../src/webview/protocol";
import type { ThreadDetail } from "../../src/api/types";
import { ThreadDetailView } from "./components/ThreadDetail";
import { vscode } from "./vscode";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; category: string; slug: string }
  | { kind: "detail"; detail: ThreadDetail }
  | { kind: "error"; message: string };

export function App(): JSX.Element {
  const [state, setState] = useState<ViewState>({ kind: "idle" });

  useEffect(() => {
    const listener = (ev: MessageEvent<ExtensionToWebview>) => {
      const msg = ev.data;
      switch (msg.type) {
        case "show-idle":
          setState({ kind: "idle" });
          return;
        case "show-loading":
          setState({ kind: "loading", category: msg.category, slug: msg.slug });
          return;
        case "show-detail":
          setState({ kind: "detail", detail: msg.detail });
          return;
        case "show-error":
          setState({ kind: "error", message: msg.message });
          return;
      }
    };
    window.addEventListener("message", listener);
    vscode().postMessage({ type: "ready" });
    return () => window.removeEventListener("message", listener);
  }, []);

  return (
    <div className="app">
      {state.kind === "idle" && (
        <div className="idle">
          <h2>Pivot</h2>
          <p className="muted">
            Select a thread from the Pivot sidebar to view its discussion.
          </p>
        </div>
      )}
      {state.kind === "loading" && (
        <div className="loading">
          <p className="muted">
            Loading {state.category}/{state.slug}…
          </p>
        </div>
      )}
      {state.kind === "detail" && <ThreadDetailView detail={state.detail} />}
      {state.kind === "error" && (
        <div className="error">
          <h2>Error</h2>
          <pre>{state.message}</pre>
        </div>
      )}
    </div>
  );
}

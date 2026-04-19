import React, { useCallback, useEffect, useState } from "react";
import type {
  DraftSnapshot,
  ExtensionToWebview,
} from "../../src/webview/protocol";
import type { ThreadDetail } from "../../src/api/types";
import { ThreadDetailView } from "./components/ThreadDetail";
import { vscode } from "./vscode";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; category: string; slug: string }
  | { kind: "detail"; detail: ThreadDetail; draft: DraftSnapshot | undefined }
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
          setState({ kind: "detail", detail: msg.detail, draft: msg.draft });
          return;
        case "show-error":
          setState({ kind: "error", message: msg.message });
          return;
        case "draft-updated":
          setState((prev) => {
            if (prev.kind !== "detail" || !prev.draft) return prev;
            if (prev.draft.draft.id !== msg.draft_id) return prev;
            return {
              ...prev,
              draft: { ...prev.draft, body_md: msg.body_md },
            };
          });
          return;
        case "draft-published":
          setState((prev) => {
            if (prev.kind !== "detail") return prev;
            if (prev.draft?.draft.id !== msg.draft_id) return prev;
            return { ...prev, draft: undefined };
          });
          return;
      }
    };
    window.addEventListener("message", listener);
    vscode().postMessage({ type: "ready" });
    return () => window.removeEventListener("message", listener);
  }, []);

  const onStartReply = useCallback(() => {
    if (state.kind !== "detail") return;
    vscode().postMessage({
      type: "request-reply-draft",
      category: state.detail.meta.category,
      slug: state.detail.meta.slug,
    });
  }, [state]);

  const onReviseDraft = useCallback(
    (instruction: string) => {
      if (state.kind !== "detail" || !state.draft) return;
      vscode().postMessage({
        type: "regenerate-draft",
        draft_id: state.draft.draft.id,
        instruction,
      });
    },
    [state],
  );

  const onPublishDraft = useCallback((draft_id: string) => {
    vscode().postMessage({ type: "publish-draft", draft_id });
  }, []);

  const onDiscardDraft = useCallback((draft_id: string) => {
    vscode().postMessage({ type: "discard-draft", draft_id });
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
      {state.kind === "detail" && (
        <ThreadDetailView
          detail={state.detail}
          draft={state.draft}
          onStartReply={onStartReply}
          onReviseDraft={onReviseDraft}
          onPublishDraft={onPublishDraft}
          onDiscardDraft={onDiscardDraft}
        />
      )}
      {state.kind === "error" && (
        <div className="error">
          <h2>Error</h2>
          <pre>{state.message}</pre>
        </div>
      )}
    </div>
  );
}

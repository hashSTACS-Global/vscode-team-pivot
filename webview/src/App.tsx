import React, { useCallback, useEffect, useState } from "react";
import type {
  DraftSnapshot,
  ExtensionToWebview,
  SettingsSnapshot,
} from "../../src/webview/protocol";
import type { Contact, MentionBlock, ThreadDetail } from "../../src/api/types";
import type { DraftMentions } from "../../src/webview/protocol";
import { NewThreadComposer } from "./components/NewThreadComposer";
import { SettingsView } from "./components/SettingsView";
import { ThreadDetailView } from "./components/ThreadDetail";
import { vscode } from "./vscode";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; category: string; slug: string }
  | { kind: "detail"; detail: ThreadDetail; draft: DraftSnapshot | undefined }
  | { kind: "new-thread"; draft: DraftSnapshot }
  | { kind: "error"; message: string };

export function App(): JSX.Element {
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const [activeTab, setActiveTab] = useState<"discussion" | "settings">("discussion");
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [contactResults, setContactResults] = useState<Record<string, Contact[]>>({});
  const [mentionEvent, setMentionEvent] = useState<{ target: string; version: number } | null>(null);

  useEffect(() => {
    const listener = (ev: MessageEvent<ExtensionToWebview>) => {
      const msg = ev.data;
      switch (msg.type) {
        case "show-idle":
          setActiveTab("discussion");
          setState({ kind: "idle" });
          return;
        case "show-settings":
          setActiveTab("settings");
          return;
        case "show-loading":
          setActiveTab("discussion");
          setState({ kind: "loading", category: msg.category, slug: msg.slug });
          return;
        case "show-detail":
          setActiveTab("discussion");
          setState({ kind: "detail", detail: msg.detail, draft: msg.draft });
          return;
        case "show-new-thread-composer":
          setActiveTab("discussion");
          setState({ kind: "new-thread", draft: msg.draft });
          return;
        case "show-error":
          setActiveTab("discussion");
          setState({ kind: "error", message: msg.message });
          return;
        case "settings-data":
          setSettings(msg.settings);
          if (msg.settings.update.blocked) {
            setActiveTab("settings");
          }
          return;
        case "test-connection-result":
          setTestResult({ ok: msg.ok, message: msg.message });
          return;
        case "draft-updated":
          setState((prev) => {
            if (prev.kind === "detail" && prev.draft && prev.draft.id === msg.draft_id) {
              return { ...prev, draft: { ...prev.draft, body_md: msg.body_md } };
            }
            if (prev.kind === "new-thread" && prev.draft.id === msg.draft_id) {
              return { ...prev, draft: { ...prev.draft, body_md: msg.body_md } };
            }
            return prev;
          });
          return;
        case "draft-published":
          setState((prev) => {
            if (prev.kind === "detail" && prev.draft?.id === msg.draft_id) {
              return { ...prev, draft: undefined };
            }
            if (prev.kind === "new-thread" && prev.draft.id === msg.draft_id) {
              return { kind: "idle" };
            }
            return prev;
          });
          return;
        case "contacts-result":
          setContactResults((prev) => ({ ...prev, [msg.target_filename]: msg.items }));
          return;
        case "mention-submitted":
          setMentionEvent((prev) => ({
            target: msg.target_filename,
            version: (prev?.version ?? 0) + 1,
          }));
          return;
      }
    };
    window.addEventListener("message", listener);
    vscode().postMessage({ type: "ready" });
    vscode().postMessage({ type: "request-settings" });
    return () => window.removeEventListener("message", listener);
  }, []);

  const onStartDiscussion = useCallback((reply_to?: string | null) => {
    if (state.kind !== "detail") return;
    vscode().postMessage({
      type: "request-discussion-prompt",
      category: state.detail.meta.category,
      slug: state.detail.meta.slug,
      reply_to: reply_to ?? null,
      references: [],
    });
  }, [state]);

  const onToggleFavorite = useCallback(() => {
    if (state.kind !== "detail") return;
    vscode().postMessage({
      type: "toggle-favorite",
      category: state.detail.meta.category,
      slug: state.detail.meta.slug,
    });
  }, [state]);

  const onStartReply = useCallback((reply_to?: string | null) => {
    if (state.kind !== "detail") return;
    vscode().postMessage({
      type: "request-reply-draft",
      category: state.detail.meta.category,
      slug: state.detail.meta.slug,
      reply_to: reply_to ?? null,
      references: [],
    });
  }, [state]);

  const onSearchContacts = useCallback((target_filename: string, query: string) => {
    vscode().postMessage({ type: "search-contacts", target_filename, query });
  }, []);

  const onSubmitMention = useCallback(
    (target_filename: string, mentions: MentionBlock) => {
      if (state.kind !== "detail") return;
      vscode().postMessage({
        type: "submit-mention",
        category: state.detail.meta.category,
        slug: state.detail.meta.slug,
        target_filename,
        mentions,
      });
    },
    [state],
  );

  const onOpenDraftFile = useCallback((draft_id: string) => {
    vscode().postMessage({ type: "open-draft-file", draft_id });
  }, []);

  const onPublishDraft = useCallback((draft_id: string) => {
    vscode().postMessage({ type: "publish-draft", draft_id });
  }, []);

  const onDiscardDraft = useCallback((draft_id: string) => {
    vscode().postMessage({ type: "discard-draft", draft_id });
  }, []);

  const onPublishNewThreadDraft = useCallback((draft_id: string) => {
    vscode().postMessage({ type: "publish-new-thread-draft", draft_id });
  }, []);

  const onDiscardNewThreadDraft = useCallback((draft_id: string) => {
    vscode().postMessage({ type: "discard-new-thread-draft", draft_id });
  }, []);

  const onRecopyNewThreadPrompt = useCallback((draft_id: string) => {
    vscode().postMessage({ type: "recopy-new-thread-prompt", draft_id });
  }, []);

  const onSaveNewThreadMentions = useCallback(
    (draft_id: string, mentions: DraftMentions | null) => {
      vscode().postMessage({
        type: "update-new-thread-mentions",
        draft_id,
        mentions,
      });
    },
    [],
  );

  const onSaveSettings = useCallback(
    (next: Partial<Omit<SettingsSnapshot, "tokenConfigured">>) => {
      vscode().postMessage({ type: "save-settings", settings: next });
    },
    [],
  );

  const onSaveToken = useCallback((token: string) => {
    vscode().postMessage({ type: "save-token", token });
  }, []);

  const onClearToken = useCallback(() => {
    vscode().postMessage({ type: "clear-token" });
  }, []);

  const onPickDirectory = useCallback((target: "mirrorDir" | "draftsDir") => {
    vscode().postMessage({ type: "pick-directory", target });
  }, []);

  const onTestConnection = useCallback(() => {
    setTestResult(null);
    vscode().postMessage({ type: "test-connection" });
  }, []);

  const onSyncMirror = useCallback(() => {
    vscode().postMessage({ type: "sync-mirror" });
  }, []);

  return (
    <div className="app">
      <header className="page-toolbar">
        <div className="page-tabs">
          <button
            type="button"
            className={activeTab === "discussion" ? "tab-button active" : "tab-button"}
            onClick={() => setActiveTab("discussion")}
            disabled={Boolean(settings?.update.blocked)}
          >
            讨论
          </button>
          <button
            type="button"
            className={activeTab === "settings" ? "tab-button active" : "tab-button"}
            onClick={() => setActiveTab("settings")}
          >
            设置
          </button>
        </div>
      </header>
      {activeTab === "settings" ? (
        <SettingsView
          settings={settings}
          testResult={testResult}
          onSave={onSaveSettings}
          onSaveToken={onSaveToken}
          onClearToken={onClearToken}
          onPickDirectory={onPickDirectory}
          onTestConnection={onTestConnection}
          onCheckUpdates={() => vscode().postMessage({ type: "check-updates" })}
          onInstallUpdate={() => vscode().postMessage({ type: "install-update" })}
          onSyncMirror={onSyncMirror}
        />
      ) : (
        <>
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
            onToggleFavorite={onToggleFavorite}
            onStartDiscussion={onStartDiscussion}
            onStartReply={onStartReply}
            onSearchContacts={onSearchContacts}
            onSubmitMention={onSubmitMention}
            contactResults={contactResults}
            mentionEvent={mentionEvent}
            onOpenDraftFile={onOpenDraftFile}
            onPublishDraft={onPublishDraft}
            onDiscardDraft={onDiscardDraft}
            />
          )}
          {state.kind === "new-thread" && (
            <NewThreadComposer
              draft={state.draft}
              contacts={contactResults[state.draft.id] ?? []}
              mentionEvent={mentionEvent}
              onOpenFile={() => onOpenDraftFile(state.draft.id)}
              onPublish={() => onPublishNewThreadDraft(state.draft.id)}
              onDiscard={() => onDiscardNewThreadDraft(state.draft.id)}
              onRecopyPrompt={() => onRecopyNewThreadPrompt(state.draft.id)}
              onSearchContacts={onSearchContacts}
              onSaveMentions={onSaveNewThreadMentions}
            />
          )}
          {state.kind === "error" && (
            <div className="error">
              <h2>Error</h2>
              <pre>{state.message}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

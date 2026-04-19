import type { Draft, ThreadDetail } from "../api/types";

export interface DraftSnapshot {
  draft: Draft;
  body_md: string;
  file_path: string;
}

export type ExtensionToWebview =
  | { type: "show-idle" }
  | { type: "show-loading"; category: string; slug: string }
  | { type: "show-detail"; detail: ThreadDetail; draft?: DraftSnapshot }
  | { type: "show-error"; message: string }
  | { type: "draft-updated"; draft_id: string; body_md: string }
  | { type: "draft-published"; draft_id: string };

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "load-thread"; category: string; slug: string }
  | { type: "request-reply-draft"; category: string; slug: string }
  | { type: "regenerate-draft"; draft_id: string; instruction: string }
  | { type: "publish-draft"; draft_id: string }
  | { type: "discard-draft"; draft_id: string };

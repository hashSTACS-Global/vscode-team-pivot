import type { ThreadDetail } from "../api/types";

export type ExtensionToWebview =
  | { type: "show-idle" }
  | { type: "show-loading"; category: string; slug: string }
  | { type: "show-detail"; detail: ThreadDetail }
  | { type: "show-error"; message: string };

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "load-thread"; category: string; slug: string };

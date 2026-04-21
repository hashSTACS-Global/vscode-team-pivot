import type { Contact, MentionBlock, ThreadDetail, UpdateSnapshot } from "../api/types";

/**
 * 插件内部使用的 mentions 结构：API 契约仍是 `MentionBlock`（open_ids + comments），
 * 这里额外带一个 `names` 映射仅为本地 UI 编辑时回填显示，发布到服务端前会被剥掉。
 */
export interface DraftMentions extends MentionBlock {
  names?: Record<string, string>; // open_id -> display name
}

export interface DraftSnapshot {
  id: string;
  thread_key: string;
  body_md: string;
  file_path: string;
  reply_to?: string | null;
  references?: string[];
  // 新增：区分回帖草稿 vs 新帖草稿（向后兼容：旧草稿默认 kind = "reply"）
  kind?: "reply" | "new-thread";
  // 仅 new-thread 草稿使用
  title?: string;
  category?: string;
  /** 新帖草稿 UI 选中的提及；publish 时优先覆盖 md frontmatter 里的 mentions */
  mentions?: DraftMentions | null;
}

export interface SettingsSnapshot {
  serverUrl: string;
  mirrorDir: string;
  draftsDir: string;
  autoSyncMirror: boolean;
  tokenConfigured: boolean;
  extensionVersion: string;
  update: UpdateSnapshot;
}

export type ExtensionToWebview =
  | { type: "show-idle" }
  | { type: "show-settings" }
  | { type: "show-loading"; category: string; slug: string }
  | { type: "show-detail"; detail: ThreadDetail; draft?: DraftSnapshot }
  | { type: "show-error"; message: string }
  | { type: "draft-updated"; draft_id: string; body_md: string }
  | { type: "draft-published"; draft_id: string }
  | { type: "contacts-result"; target_filename: string; items: Contact[] }
  | { type: "mention-submitted"; target_filename: string }
  | { type: "settings-data"; settings: SettingsSnapshot }
  | { type: "test-connection-result"; ok: boolean; message: string }
  | { type: "show-new-thread-composer"; draft: DraftSnapshot };

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "request-settings" }
  | { type: "open-settings" }
  | { type: "save-settings"; settings: Partial<Omit<SettingsSnapshot, "tokenConfigured">> }
  | { type: "save-token"; token: string }
  | { type: "clear-token" }
  | { type: "pick-directory"; target: "mirrorDir" | "draftsDir" }
  | { type: "test-connection" }
  | { type: "check-updates" }
  | { type: "install-update" }
  | { type: "sync-mirror" }
  | { type: "load-thread"; category: string; slug: string }
  | { type: "toggle-favorite"; category: string; slug: string }
  | { type: "request-discussion-prompt"; category: string; slug: string; reply_to?: string | null; references?: string[] }
  | { type: "request-reply-draft"; category: string; slug: string; reply_to?: string | null; references?: string[] }
  | { type: "search-contacts"; target_filename: string; query: string }
  | { type: "submit-mention"; category: string; slug: string; target_filename: string; mentions: MentionBlock }
  | { type: "open-draft-file"; draft_id: string }
  | { type: "publish-draft"; draft_id: string }
  | { type: "discard-draft"; draft_id: string }
  | { type: "publish-new-thread-draft"; draft_id: string }
  | { type: "discard-new-thread-draft"; draft_id: string }
  | { type: "recopy-new-thread-prompt"; draft_id: string }
  | { type: "update-new-thread-mentions"; draft_id: string; mentions: DraftMentions | null };

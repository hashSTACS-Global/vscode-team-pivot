import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Contact,
  MentionBlock,
  Post,
  ThreadDetail,
} from "../../../src/api/types";
import type { DraftSnapshot } from "../../../src/webview/protocol";
import { StatusBadge } from "./StatusBadge";
import { DraftCard } from "./DraftCard";
import { MentionComposer } from "./MentionComposer";

const COLLAPSE_HEIGHT = 208;
const REPLY_LAST = "__last__";

interface Props {
  detail: ThreadDetail;
  draft: DraftSnapshot | undefined;
  onToggleFavorite: () => void;
  onStartDiscussion: (reply_to?: string | null) => void;
  onStartReply: (reply_to?: string | null) => void;
  onSearchContacts: (target_filename: string, query: string) => void;
  onSubmitMention: (target_filename: string, mentions: MentionBlock) => void;
  contactResults: Record<string, Contact[]>;
  mentionEvent: { target: string; version: number } | null;
  onOpenDraftFile: (draftId: string) => void;
  onPublishDraft: (draftId: string) => void;
  onDiscardDraft: (draftId: string) => void;
}

export function ThreadDetailView({
  detail,
  draft,
  onToggleFavorite,
  onStartDiscussion,
  onStartReply,
  onSearchContacts,
  onSubmitMention,
  contactResults,
  mentionEvent,
  onOpenDraftFile,
  onPublishDraft,
  onDiscardDraft,
}: Props): JSX.Element {
  const [activeReplyTarget, setActiveReplyTarget] = useState<string | null>(null);
  const [activeMentionTarget, setActiveMentionTarget] = useState<string | null>(null);

  useEffect(() => {
    if (draft) {
      setActiveReplyTarget(draft.reply_to ?? REPLY_LAST);
    }
  }, [draft?.id, draft?.reply_to]);

  return (
    <div className="thread">
      <header className="thread-header">
        <div className="thread-title-row">
          <h1>{detail.meta.title}</h1>
          <button
            type="button"
            className={detail.meta.favorite ? "favorite-button active" : "favorite-button"}
            onClick={onToggleFavorite}
            title={detail.meta.favorite ? "取消收藏" : "收藏"}
          >
            {detail.meta.favorite ? "★ 已收藏" : "☆ 收藏"}
          </button>
        </div>
        <div className="thread-meta">
          <StatusBadge status={detail.meta.status} />
          <span className="muted">{detail.meta.category}</span>
          <span className="muted">·</span>
          <span>{detail.meta.author_display}</span>
          <span className="muted">·</span>
          <span className="muted">{detail.meta.post_count} posts</span>
          <span className="muted">·</span>
          <span className="muted">updated {formatTime(detail.meta.last_updated)}</span>
        </div>
      </header>
      <div className="posts">
        {detail.posts.map((p) => {
          const postDraft = draft && (draft.reply_to ?? REPLY_LAST) === p.filename ? draft : undefined;
          return (
            <div key={p.filename} className="post-block">
              <PostCard
                post={p}
                isReplyOpen={activeReplyTarget === p.filename}
                isMentionOpen={activeMentionTarget === p.filename}
                onToggleReply={() =>
                  setActiveReplyTarget((prev) => (prev === p.filename ? null : p.filename))
                }
                onToggleMention={() =>
                  setActiveMentionTarget((prev) => (prev === p.filename ? null : p.filename))
                }
              />
              {activeReplyTarget === p.filename && (
                <InlineReplyPanel
                  draft={postDraft}
                  onStartDiscussion={() => onStartDiscussion(p.filename)}
                  onStartReply={() => onStartReply(p.filename)}
                  onOpenDraftFile={onOpenDraftFile}
                  onPublishDraft={onPublishDraft}
                  onDiscardDraft={onDiscardDraft}
                />
              )}
              {activeMentionTarget === p.filename && (
                <MentionComposer
                  targetId={p.filename}
                  contacts={contactResults[p.filename] ?? []}
                  mentionEvent={mentionEvent}
                  submitLabel="发送提及"
                  onSearchContacts={onSearchContacts}
                  onSubmit={onSubmitMention}
                  onClose={() => setActiveMentionTarget(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InlineReplyPanel({
  draft,
  title,
  onStartDiscussion,
  onStartReply,
  onOpenDraftFile,
  onPublishDraft,
  onDiscardDraft,
}: {
  draft: DraftSnapshot | undefined;
  title?: string;
  onStartDiscussion: () => void;
  onStartReply: () => void;
  onOpenDraftFile: (draftId: string) => void;
  onPublishDraft: (draftId: string) => void;
  onDiscardDraft: (draftId: string) => void;
}): JSX.Element {
  return (
    <div className="reply-zone-inline">
      {title ? <div className="reply-section-title">{title}</div> : null}
      <div className="reply-actions-panel">
        <div className="reply-action-buttons">
          <button type="button" className="reply-cta secondary" onClick={onStartDiscussion}>
            📋 与 AI 讨论此帖
          </button>
          <button type="button" className="reply-cta primary" onClick={onStartReply}>
            📋 让 AI 生成草稿
          </button>
        </div>
        <p className="reply-help muted">
          先点“与 AI 讨论此帖”，把复制出的提示词粘贴给 AI，并围绕这条回复做互动式讨论。讨论达成一致后，再点“让
          AI 生成草稿”，把新的提示词发给 AI；AI 会按约定把草稿写入本地文件，Pivot 会自动识别并显示这份草稿。
        </p>
      </div>
      {draft ? (
        <DraftCard
          snapshot={draft}
          onCopyReplyPrompt={onStartReply}
          onOpenFile={() => onOpenDraftFile(draft.id)}
          onPublish={() => onPublishDraft(draft.id)}
          onDiscard={() => onDiscardDraft(draft.id)}
        />
      ) : null}
    </div>
  );
}

function PostCard({
  post,
  isReplyOpen,
  isMentionOpen,
  onToggleReply,
  onToggleMention,
}: {
  post: Post;
  isReplyOpen: boolean;
  isMentionOpen: boolean;
  onToggleReply: () => void;
  onToggleMention: () => void;
}): JSX.Element {
  const fm = post.frontmatter as Record<string, unknown>;
  const postType = typeof fm.type === "string" ? fm.type : undefined;
  const timestamp = typeof fm.timestamp === "string" ? fm.timestamp : undefined;
  const replyTo = typeof fm.reply_to === "string" ? fm.reply_to : undefined;
  const autoSummary =
    typeof fm["auto-summary"] === "string" ? fm["auto-summary"] : undefined;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > COLLAPSE_HEIGHT + 2);
  }, [post.body]);

  return (
    <article className={`post post-${postType ?? "unknown"}`}>
      <header className="post-header">
        <span className="post-author">{post.author_display}</span>
        {postType && <span className="post-type-badge">{postType}</span>}
        {timestamp && <span className="muted">{formatTime(timestamp)}</span>}
        {replyTo && <span className="muted">↩ {replyTo.replace(/\.md$/, "")}</span>}
      </header>
      {autoSummary && <div className="auto-summary">{autoSummary}</div>}
      <div
        ref={bodyRef}
        className="post-body"
        style={collapsed ? { maxHeight: COLLAPSE_HEIGHT, overflow: "hidden" } : undefined}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
      </div>
      {(overflows || !collapsed) && (
        <button
          type="button"
          className="post-collapse-toggle"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? "展开全文 ↓" : "收起 ↑"}
        </button>
      )}
      <div className="post-actions">
        <button
          type="button"
          className={isReplyOpen ? "post-action-button active" : "post-action-button"}
          onClick={onToggleReply}
        >
          回复
        </button>
        <button
          type="button"
          className={isMentionOpen ? "post-action-button active" : "post-action-button"}
          onClick={onToggleMention}
        >
          @ 提及
        </button>
      </div>
      {post.mentions.length > 0 && (
        <footer className="mentions">
          {post.mentions.map((m, i) => (
            <div key={i} className="mention">
              <span className="mention-author">{m.author_display ?? "?"}</span>
              <span className="muted">mentioned:</span>
              <span>{m.comments}</span>
            </div>
          ))}
        </footer>
      )}
    </article>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Post, ThreadDetail } from "../../../src/api/types";
import { StatusBadge } from "./StatusBadge";

export function ThreadDetailView({ detail }: { detail: ThreadDetail }): JSX.Element {
  return (
    <div className="thread">
      <header className="thread-header">
        <h1>{detail.meta.title}</h1>
        <div className="thread-meta">
          <StatusBadge status={detail.meta.status} />
          <span className="muted">{detail.meta.category}</span>
          <span className="muted">·</span>
          <span>{detail.meta.author_display}</span>
          <span className="muted">·</span>
          <span className="muted">{detail.meta.post_count} posts</span>
          <span className="muted">·</span>
          <span className="muted">
            updated {formatTime(detail.meta.last_updated)}
          </span>
        </div>
      </header>
      <div className="posts">
        {detail.posts.map((p) => (
          <PostCard key={p.filename} post={p} />
        ))}
      </div>
    </div>
  );
}

function PostCard({ post }: { post: Post }): JSX.Element {
  const fm = post.frontmatter as Record<string, unknown>;
  const postType = typeof fm.type === "string" ? fm.type : undefined;
  const timestamp = typeof fm.timestamp === "string" ? fm.timestamp : undefined;
  const replyTo = typeof fm.reply_to === "string" ? fm.reply_to : undefined;
  const autoSummary =
    typeof fm["auto-summary"] === "string" ? fm["auto-summary"] : undefined;

  return (
    <article className={`post post-${postType ?? "unknown"}`}>
      <header className="post-header">
        <span className="post-author">{post.author_display}</span>
        {postType && <span className="post-type-badge">{postType}</span>}
        {timestamp && <span className="muted">{formatTime(timestamp)}</span>}
        {replyTo && (
          <span className="muted">↩ {replyTo.replace(/\.md$/, "")}</span>
        )}
      </header>
      {autoSummary && <div className="auto-summary">{autoSummary}</div>}
      <div className="post-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
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

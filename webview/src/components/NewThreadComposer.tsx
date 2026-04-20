import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DraftSnapshot } from "../../../src/webview/protocol";

interface Props {
  draft: DraftSnapshot;
  onOpenFile: () => void;
  onPublish: () => void;
  onDiscard: () => void;
}

export function NewThreadComposer({
  draft,
  onOpenFile,
  onPublish,
  onDiscard,
}: Props): JSX.Element {
  const body = draft.body_md.trim();
  const hasBody = body.length > 0;
  const title = draft.title ?? "(未命名新帖)";
  const category = draft.category ?? "?";

  return (
    <section className="new-thread-composer">
      <header className="new-thread-header">
        <div className="new-thread-meta">
          <div className="new-thread-badge">新帖草稿</div>
          <h2 className="new-thread-title">{title}</h2>
          <div className="new-thread-category muted">
            分类: <code>{category}</code>
          </div>
        </div>
      </header>

      <section className="draft-card">
        <header className="draft-card-header">
          <span className="draft-tag">Draft</span>
          <span className="muted draft-path" title={draft.file_path}>
            {draft.file_path}
          </span>
        </header>
        {hasBody ? (
          <div className="draft-body post-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </div>
        ) : (
          <div className="draft-empty muted">
            草稿是空的。粘贴刚才复制的提示词到你的 AI 聊天窗口（Claude Code / Copilot 等），让它把正文写入上面这个文件；或者直接在 VS Code 里打开文件手写。
          </div>
        )}
        <div className="draft-file-row">
          <button type="button" className="draft-file-link" onClick={onOpenFile}>
            在 VS Code 中打开草稿文件
          </button>
        </div>
        <footer className="draft-actions">
          <button
            type="button"
            className="primary"
            onClick={onPublish}
            disabled={!hasBody}
          >
            ✓ 发布
          </button>
          <button type="button" className="danger" onClick={onDiscard}>
            丢弃
          </button>
        </footer>
      </section>
    </section>
  );
}

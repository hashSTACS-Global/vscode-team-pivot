import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DraftSnapshot } from "../../../src/webview/protocol";

interface Props {
  snapshot: DraftSnapshot;
  onCopyReplyPrompt: () => void;
  onOpenFile: () => void;
  onPublish: () => void;
  onDiscard: () => void;
}

export function DraftCard({
  snapshot,
  onCopyReplyPrompt,
  onOpenFile,
  onPublish,
  onDiscard,
}: Props): JSX.Element {
  const body = snapshot.body_md.trim();
  const hasBody = body.length > 0;

  return (
    <section className="draft-card">
      <header className="draft-card-header">
        <span className="draft-tag">Draft</span>
        <span className="muted draft-path" title={snapshot.file_path}>
          {snapshot.file_path}
        </span>
      </header>
      {hasBody ? (
        <div className="draft-body post-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      ) : (
        <div className="draft-empty muted">
          草稿是空的。粘贴提示词到你的 AI 聊天窗口，让它写入文件；或者直接在本地编辑器里写。
        </div>
      )}
      <div className="draft-file-row">
        <button type="button" className="draft-file-link" onClick={onOpenFile}>
          在 VS Code 中打开草稿文件
        </button>
      </div>
      <footer className="draft-actions">
        <button type="button" onClick={onCopyReplyPrompt}>
          📋 复制保存草稿提示词
        </button>
        <button
          type="button"
          className="primary"
          onClick={onPublish}
          disabled={!hasBody}
        >
          ✓ 发布
        </button>
        <button
          type="button"
          className="danger"
          onClick={onDiscard}
        >
          丢弃
        </button>
      </footer>
    </section>
  );
}

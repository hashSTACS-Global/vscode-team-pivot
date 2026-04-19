import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DraftSnapshot } from "../../../src/webview/protocol";

interface Props {
  snapshot: DraftSnapshot;
  onCopyReplyPrompt: () => void;
  onRevise: (instruction: string) => void;
  onPublish: () => void;
  onDiscard: () => void;
}

export function DraftCard({
  snapshot,
  onCopyReplyPrompt,
  onRevise,
  onPublish,
  onDiscard,
}: Props): JSX.Element {
  const [revising, setRevising] = useState(false);
  const [instruction, setInstruction] = useState("");
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
      <footer className="draft-actions">
        <button type="button" onClick={onCopyReplyPrompt}>
          📋 复制起草提示词
        </button>
        <button
          type="button"
          onClick={() => setRevising((v) => !v)}
          disabled={!hasBody}
        >
          ✏️ 要 AI 再改改
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
          onClick={() => {
            if (confirm("丢弃这个草稿？")) onDiscard();
          }}
        >
          丢弃
        </button>
      </footer>
      {revising && (
        <div className="revise-row">
          <input
            type="text"
            value={instruction}
            placeholder="例如：更简短，直接给出结论"
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onRevise(instruction);
                setInstruction("");
                setRevising(false);
              }
            }}
            autoFocus
          />
          <button
            type="button"
            onClick={() => {
              onRevise(instruction);
              setInstruction("");
              setRevising(false);
            }}
          >
            复制提示词
          </button>
        </div>
      )}
    </section>
  );
}

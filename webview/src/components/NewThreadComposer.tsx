import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DraftSnapshot } from "../../../src/webview/protocol";

interface Props {
  draft: DraftSnapshot;
  onOpenFile: () => void;
  onPublish: () => void;
  onDiscard: () => void;
  onRecopyPrompt: () => void;
}

export function NewThreadComposer({
  draft,
  onOpenFile,
  onPublish,
  onDiscard,
  onRecopyPrompt,
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
            <p>
              ✅ 给 AI 的提示词已经自动复制到您的剪贴板了。
              {"  "}
              <button
                type="button"
                className="draft-file-link"
                onClick={onRecopyPrompt}
                title="如果剪贴板被其他内容覆盖了，点这里重新复制"
              >
                重新复制
              </button>
            </p>
            <p><strong>下一步（二选一）</strong>：</p>
            <ul>
              <li>
                切到 Claude Code / Copilot / Cursor 等 AI 聊天面板，粘贴（Ctrl+V）回车，让 AI 把正文写进上面这个文件
              </li>
              <li>
                或点下方「在 VS Code 中打开草稿文件」，自己手写
              </li>
            </ul>
            <p>
              写完后 Webview 会自动预览，点 ✓ 发布；或随时切走，从侧边栏「草稿」打开即可。
            </p>
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

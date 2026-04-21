import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Contact } from "../../../src/api/types";
import type { DraftMentions, DraftSnapshot } from "../../../src/webview/protocol";
import { MentionComposer } from "./MentionComposer";

interface Props {
  draft: DraftSnapshot;
  contacts: Contact[];
  mentionEvent: { target: string; version: number } | null;
  onOpenFile: () => void;
  onPublish: () => void;
  onDiscard: () => void;
  onRecopyPrompt: () => void;
  onSearchContacts: (targetId: string, query: string) => void;
  onSaveMentions: (targetId: string, mentions: DraftMentions | null) => void;
}

export function NewThreadComposer({
  draft,
  contacts,
  mentionEvent,
  onOpenFile,
  onPublish,
  onDiscard,
  onRecopyPrompt,
  onSearchContacts,
  onSaveMentions,
}: Props): JSX.Element {
  const body = draft.body_md.trim();
  const hasBody = body.length > 0;
  const title = draft.title ?? "(未命名新帖)";
  const category = draft.category ?? "?";
  const savedMentions = draft.mentions ?? null;
  const hasMentions = !!savedMentions && savedMentions.open_ids.length > 0;

  const [mentionOpen, setMentionOpen] = useState(false);

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

        {hasMentions && !mentionOpen && (
          <div className="new-thread-mention-summary">
            <span className="muted">已保存 @ 提及：</span>
            <span>{savedMentions!.open_ids.length} 人 · {savedMentions!.comments}</span>
            <button
              type="button"
              className="ghost-link"
              onClick={() => setMentionOpen(true)}
            >
              编辑
            </button>
            <button
              type="button"
              className="ghost-link"
              onClick={() => onSaveMentions(draft.id, null)}
            >
              清除
            </button>
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
            onClick={() => setMentionOpen((prev) => !prev)}
            title="选人并附一句话，发布时随新帖一起发送"
          >
            @ 提及{hasMentions ? `（${savedMentions!.open_ids.length}）` : ""}
          </button>
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

        {mentionOpen && (
          <MentionComposer
            targetId={draft.id}
            contacts={contacts}
            mentionEvent={mentionEvent}
            initial={savedMentions}
            submitLabel="保存提及"
            onSearchContacts={onSearchContacts}
            onSubmit={(targetId, mentions, selected) => {
              const names: Record<string, string> = {};
              for (const c of selected) {
                if (c.name && c.name !== c.open_id) names[c.open_id] = c.name;
              }
              onSaveMentions(targetId, {
                ...mentions,
                ...(Object.keys(names).length > 0 ? { names } : {}),
              });
            }}
            onClose={() => setMentionOpen(false)}
          />
        )}
      </section>
    </section>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import type { Contact, MentionBlock } from "../../../src/api/types";
import type { DraftMentions } from "../../../src/webview/protocol";

interface Props {
  /**
   * 搜索 / 提交回调的关联 ID。回帖场景是被 @ 帖子的 filename；
   * 新帖场景是草稿 id（没有目标帖子）。extension 侧只用它做 round-trip 关联。
   */
  targetId: string;
  contacts: Contact[];
  /**
   * 提交成功事件。version 每次 submit 都会自增——MentionComposer 挂载时快照当时的
   * version，只对**挂载后**发生的新事件触发关闭；避免"上一次的残留值"导致重开面板
   * 时立刻被关掉的闪动 bug。
   */
  mentionEvent: { target: string; version: number } | null;
  /**
   * 初始已选提及（用于"编辑已保存的提及"场景）。若带 `names`，chip 会显示真实姓名；
   * 若没有 names（如只从 open_ids 反推），则用 open_id 兜底。
   */
  initial?: DraftMentions | null;
  /** 提交按钮文案 */
  submitLabel: string;
  onSearchContacts: (targetId: string, query: string) => void;
  /**
   * 提交回调。第三参数 `selected` 给新帖场景用来记录 open_id→name 映射；
   * 回帖场景可忽略。
   */
  onSubmit: (targetId: string, mentions: MentionBlock, selected: Contact[]) => void;
  onClose: () => void;
}

export function MentionComposer({
  targetId,
  contacts,
  mentionEvent,
  initial,
  submitLabel,
  onSearchContacts,
  onSubmit,
  onClose,
}: Props): JSX.Element {
  // 挂载时的事件版本快照（lazy init 只跑一次）
  const [openedAtVersion] = useState(() => mentionEvent?.version ?? 0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Contact[]>(() => {
    if (!initial || initial.open_ids.length === 0) return [];
    // 优先用 initial.names 里保存的真实姓名；没有则用 open_id 兜底（搜索后会被替换）
    const namesMap = initial.names ?? {};
    return initial.open_ids.map((id) => ({
      open_id: id,
      name: namesMap[id] ?? id,
    }));
  });
  const [comments, setComments] = useState(initial?.comments ?? "");

  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => {
      onSearchContacts(targetId, trimmed);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, targetId, onSearchContacts]);

  useEffect(() => {
    if (!mentionEvent) return;
    if (mentionEvent.version === openedAtVersion) return; // 挂载时已有的事件不触发
    if (mentionEvent.target !== targetId) return; // 不是给我的事件
    setQuery("");
    setSelected([]);
    setComments("");
    onClose();
  }, [mentionEvent, openedAtVersion, onClose, targetId]);

  // 当搜索返回的 contacts 里包含已选的 open_id，用真实 name 替换初始占位
  useEffect(() => {
    if (selected.length === 0 || contacts.length === 0) return;
    setSelected((prev) =>
      prev.map((sel) => {
        const fresh = contacts.find((c) => c.open_id === sel.open_id);
        return fresh && fresh.name !== sel.name ? fresh : sel;
      }),
    );
  }, [contacts]);

  const selectedIds = useMemo(() => new Set(selected.map((c) => c.open_id)), [selected]);
  const availableContacts = useMemo(
    () => contacts.filter((contact) => !selectedIds.has(contact.open_id)),
    [contacts, selectedIds],
  );

  return (
    <div className="mention-panel">
      <div className="mention-header">
        <span>@ 提及相关的人</span>
        <button type="button" className="ghost-link" onClick={onClose}>
          关闭
        </button>
      </div>
      <input
        className="mention-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索联系人"
      />
      {selected.length > 0 && (
        <div className="mention-selected">
          {selected.map((contact) => (
            <span key={contact.open_id} className="mention-chip">
              <span>{contact.name}</span>
              <button
                type="button"
                className="mention-chip-remove"
                aria-label={`移除 ${contact.name}`}
                onClick={() =>
                  setSelected((prev) => prev.filter((c) => c.open_id !== contact.open_id))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {availableContacts.length > 0 && (
        <div className="mention-results">
          {availableContacts.map((contact) => (
            <button
              key={contact.open_id}
              type="button"
              className="mention-result"
              onClick={() => {
                setSelected((prev) =>
                  prev.some((c) => c.open_id === contact.open_id) ? prev : [...prev, contact],
                );
              }}
            >
              {contact.name}
            </button>
          ))}
        </div>
      )}
      <textarea
        className="mention-textarea"
        value={comments}
        onChange={(e) => setComments(e.target.value)}
        placeholder="写一句你想补充的话"
      />
      <div className="mention-actions">
        <button
          type="button"
          className="primary"
          disabled={selected.length === 0 || comments.trim().length === 0}
          onClick={() =>
            onSubmit(
              targetId,
              {
                open_ids: selected.map((c) => c.open_id),
                comments: comments.trim(),
              },
              selected,
            )
          }
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

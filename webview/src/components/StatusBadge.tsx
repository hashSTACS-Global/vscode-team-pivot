import React from "react";

const LABELS: Record<string, { text: string; cls: string }> = {
  open: { text: "讨论中", cls: "badge blue" },
  concluded: { text: "已达成结论", cls: "badge green" },
  produced: { text: "已转为项目", cls: "badge purple" },
  closed: { text: "已关闭", cls: "badge gray" },
  pending: { text: "暂时搁置", cls: "badge amber" },
};

export function StatusBadge({ status }: { status: string | null }): JSX.Element | null {
  if (!status) return null;
  const entry = LABELS[status];
  if (!entry) return <span className="badge gray">{status}</span>;
  return <span className={entry.cls}>{entry.text}</span>;
}

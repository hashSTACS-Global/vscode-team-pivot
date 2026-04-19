import type { ThreadDetail } from "../api/types";

export function buildReplyPrompt(args: {
  detail: ThreadDetail;
  draftPath: string;
}): string {
  const { detail, draftPath } = args;
  const posts = detail.posts
    .map((p) => {
      const type = (p.frontmatter.type as string) ?? "post";
      const ts = (p.frontmatter.timestamp as string) ?? "";
      return `### ${type} by ${p.author_display}${ts ? ` (${ts})` : ""}\n\n${p.body.trim()}`;
    })
    .join("\n\n---\n\n");

  return `我正在 Pivot 上起草一个回复，请你帮我写内容。

## 目标讨论
**标题**: ${detail.meta.title}
**分类**: ${detail.meta.category}
**状态**: ${detail.meta.status}
**作者**: ${detail.meta.author_display}

## 现有帖子

${posts}

---

## 你的任务

请基于以上讨论起草一个专业、切题的回复。只写回复正文本身，不要加标题、不要加 frontmatter、不要加多余寒暄。用 Markdown 格式；可以用列表、代码块、引用等。

请把草稿写入这个文件（覆盖现有内容即可）：

\`${draftPath}\`

写完后简单告诉我你写了什么。如果我后续让你修改，请直接编辑同一个文件。`;
}

export function buildReviseReplyPrompt(args: {
  draftPath: string;
  instruction: string;
}): string {
  return `请修改这个 Pivot 回复草稿：

\`${args.draftPath}\`

修改要求：${args.instruction}

请直接编辑文件（覆盖或改写），不要创建新文件。`;
}

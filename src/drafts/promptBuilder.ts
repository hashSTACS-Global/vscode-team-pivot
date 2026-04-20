import type { ThreadDetail } from "../api/types";

export function buildReplyPrompt(args: {
  detail: ThreadDetail;
  primaryPostPath?: string;
  threadDirPath?: string;
  indexPath?: string;
  replyToFilename?: string | null;
}): string {
  const { detail, primaryPostPath, threadDirPath, indexPath, replyToFilename } = args;

  const pathSection = primaryPostPath
    ? `## 先读这些本地文件

1. 主帖文件（先读这个）：
\`${primaryPostPath}\`

2. 当前 thread 目录（如果需要看回复或其他帖子）：
\`${threadDirPath}\`

3. 这个 thread 的 index 文件：
\`${indexPath}\`

index 文件保存了这个讨论前后的上下文信息。如果你认为绝对有必要补充背景，再顺着 index 去查找其他文件；如果没有必要，就不要额外扩展阅读范围。

`
    : `## 当前限制

当前没有可用的本地 mirror 路径，请只根据你能读取到的本地草稿文件和后续用户补充的信息工作。

`;

  return `我正在 Pivot 上讨论一个回复方向，请你先和我一起分析，不要直接保存草稿文件。

## 目标讨论
**标题**: ${detail.meta.title}
**分类**: ${detail.meta.category}
**状态**: ${detail.meta.status}
**作者**: ${detail.meta.author_display}
${replyToFilename ? `**这次要回复的帖子**: ${replyToFilename}` : ""}

${pathSection}## 你的任务

请先阅读主帖文件，理解它的主要内容。

然后请在对话里完成这三件事：

1. 用简洁清晰的语言总结这篇文章的主要内容
2. 给出你的客观观点和建议，不要带预设立场
3. 回答风格要求清晰明确，不要讲黑话，不要故作姿态

如果 index 文件里确实有必要补充的上下文，你可以顺着它继续查找；但只有在绝对必要时才这样做。

- 现在先不要生成草稿文件
- 现在先不要保存到任何路径
- 先和我讨论，等我确认方向以后，再进入写稿阶段
`;
}

export function buildSaveDraftPrompt(args: {
  detail: ThreadDetail;
  draftPath: string;
  replyToFilename?: string | null;
}): string {
  const { detail, draftPath, replyToFilename } = args;
  return `请根据我们刚才围绕这个 Pivot 帖子的讨论结果，生成一版可发布的回复草稿，并直接保存到指定文件。

## 目标讨论
**标题**: ${detail.meta.title}
**分类**: ${detail.meta.category}
**状态**: ${detail.meta.status}
**作者**: ${detail.meta.author_display}
${replyToFilename ? `**回复目标帖子**: ${replyToFilename}` : ""}

## 你的任务

请基于我们刚才已经讨论好的上下文和结论，生成一版正式回复。

这版回复正文要求：

- 只写回复正文本身
- 不要加标题
- 不要加 frontmatter
- 不要加多余寒暄
- 用 Markdown 格式
- 语气专业、直接、清楚

请把草稿写入这个文件（覆盖现有内容即可）：

\`${draftPath}\`

写完后告诉我你已经保存到了这个文件。如果我后续让你修改，请继续编辑同一个文件。`;
}

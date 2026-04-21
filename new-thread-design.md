# 新帖发布功能设计（vscode-team-pivot）

> 姊妹文档：`memo.md`（项目现状权威文档）。本文是 memo §8 中"暂缓项：新建 thread"的正式设计与落地方案。实施完成后需同步更新 memo §4 / §8 / §9。

**版本**：v1.0
**日期**：2026-04-20
**状态**：已实施完成（等待用户验收与部署）

---

## 0. 与 memo.md 的关系

| memo 条目 | 本方案的影响 |
|---|---|
| §4 "AI 协作回复" 工作流 | **完全镜像**到发帖路径（本地 md 草稿 + AI 填写 + FileSystemWatcher + 一键发布） |
| §4 末尾 @mention 设计 | 发帖沿用同样哲学：AI 把 `open_ids` / `comments` 写到草稿 frontmatter，扩展读出来调 API |
| §8 MVP 范围 | 将"新建 thread"从暂缓项移入本期；"@mention 自动补全 UI"继续暂缓 |
| §9 协议契约表 | 新增一行：`POST /api/threads` |
| §10 "本地镜像绝不写入" / "发布后 pull" | 遵守。发布成功后调 `mirror.sync()` |

---

## 1. 背景与目标

### 1.1 现状

- 服务端 `POST /api/threads` 已就绪（[server/api/discussions.py:40-48](../team-pivot-web/server/api/discussions.py)，[server/publish.py:31-82](../team-pivot-web/server/publish.py)），请求体 `{ category, title, body, mentions? }`，PAT 鉴权，与回帖同路径。
- Web 前端 `/new` 页面已上线（[NewThread.tsx](../team-pivot-web/web/src/pages/NewThread.tsx)），**但走的是"服务端草稿 → 发布"两步流程**，不是扩展里现有的"本地文件草稿 + AI"模式。
- 本扩展回帖链路已跑通：`DraftsManager.ensureReplyDraft` → 提示词剪贴板 → AI 填 `~/.pivot-drafts/` → `FileSystemWatcher` 实时预览 → `publish()` 调 `api.replyToThread`。

### 1.2 目标

让用户在不离开 VS Code 的前提下：
1. 从侧边栏（或命令面板）一键发起"新建帖子"。
2. 选好分类 / 输完标题后，让已装的 AI 聊天插件（Claude Code / Copilot 等）帮忙起草正文，写到本地 md 文件。
3. 在 Webview 预览 → 点"发布" → 调 `POST /api/threads` → 自动打开新帖详情。

### 1.3 设计取向（遵循 memo §2）

- **UI 薄**：不内嵌 LLM，AI 工作全部交给外部聊天插件，通过剪贴板提示词 + 本地 md 文件桥接。
- **复用回帖机制**：`DraftsManager` 扩展一层"草稿 kind"字段，不引入新的草稿系统。
- **category 纠错优先**：插件里强制从已有分类选择，新建分类走单独确认路径，避免错别字造成脏分类。

---

## 2. 用户流程

### 2.1 主流程图

```
[侧边栏 "＋" / 命令面板 "Pivot: New Thread"]
              ↓
① showInputBox: 输入标题
   - 必填、≤200 字符
   - 校验通过 → ②
              ↓
② QuickPick: 选 category
   - api.listCategories() 直接取分类清单（服务端新接口，见 §3.1）
   - 选项排序：按该分类下帖子数量降序
   - 列表末尾固定一项: "＋ 新建分类…"
   - 选已有 → ④
   - 选"新建分类" → ③
              ↓
③ showInputBox: 输入新分类名
   - 必填、1–20 字符、不含 / \ : * ? " < > | \t \n \r
   - showWarningMessage 二次确认: "将创建新的顶级分类 '{name}'，确认？"
   - 取消 → 退回 ②; 确认 → ④
              ↓
④ DraftsManager.ensureNewThreadDraft({title, category})
   - 路径: ~/.pivot-drafts/new-threads/{draftId}.md (空正文)
   - meta : ~/.pivot-drafts/new-threads/{draftId}.pivot-meta.json
     { kind: "new-thread", title, category,
       mentions: { open_ids: [], comments: "" } }
   - 已存在同 (title, category) 的草稿则复用
              ↓
⑤ buildNewThreadPrompt() → env.clipboard.writeText()
   - 提示 AI 把正文写入 {draftPath}
   - 附最近活跃联系人 open_id 列表（供 AI 按需在 frontmatter 填 mentions）
   - showInformationMessage("草稿提示词已复制，粘贴给 AI 生成草稿")
              ↓
⑥ 打开 Pivot Webview，展示 NewThreadComposer
   - 顶部: title / category（只读 badge，右侧"丢弃"按钮）
   - 正文: 复用 DraftCard，实时预览本地 md
   - 底部按钮: ✓ 发布 / ✗ 丢弃
              ↓
[外部 AI 写入 md 文件] → FileSystemWatcher → Webview 实时刷新
              ↓
⑦ 用户点"发布"
   → DraftsManager.publish(null, draftId)
     → 读 md 文件（正文）
     → 读 meta 文件（kind / title / category / mentions）
     → api.createThread({ category, title, body, mentions? })
     → 清理本地草稿文件 + meta 文件
   → mirror.sync()
   → commands.executeCommand("pivot.refresh") // 侧边栏刷新
   → commands.executeCommand("pivot.openThread", { category, slug: res.slug })
   → showInformationMessage("Pivot: thread published.")
```

### 2.2 交互入口

| 位置 | 形式 | 标识 |
|---|---|---|
| 侧边栏 pivot.threads TreeView 标题栏 | 按钮 | `$(add)` 图标，tooltip "New Thread" |
| 命令面板 | 命令 | `Pivot: New Thread`（command id `pivot.newThread`） |
| （后续）帖子详情 Webview 顶栏 | — | 暂不加，避免重复入口 |

---

## 3. Category 交互细节

**核心约束**：插件绝不让用户在主输入框里随手敲分类名，必须从已有列表选或走"新建分类"确认路径。

### 3.1 获取现有分类

**数据源**：服务端专用接口 `GET /api/categories`（本期新增，跨项目请求见 [to-team-pivot-web.md](to-team-pivot-web.md) `[7]`）。

预期响应：
```json
{
  "items": [
    { "name": "general",     "post_count": 12, "last_updated": "2026-04-20T10:00:00+08:00" },
    { "name": "engineering", "post_count": 8,  "last_updated": "2026-04-19T14:30:00+08:00" },
    ...
  ]
}
```

扩展侧消费：
```ts
const res = await api.listCategories();
const categories = res.items
  .sort((a, b) => b.post_count - a.post_count)
  .map((c) => ({ label: c.name, description: `${c.post_count} 个帖子` }));
```

**不采用 `listThreads` 聚合的原因**：
- 线程数量增长后，拉全量再在客户端聚合浪费带宽
- 分页场景下客户端聚合不准确
- 服务端可以在未来给 `/api/categories` 加更多元信息（如 owner、icon、description），扩展点更清晰

### 3.2 QuickPick 呈现

```
┌──────────────────────────────────┐
│ 🔍 选择分类（支持搜索）           │
├──────────────────────────────────┤
│ general          12 个帖子        │
│ engineering      8 个帖子         │
│ product          5 个帖子         │
│ ...                              │
│──────────────────────────────────│
│ ＋ 新建分类…                      │  ← 固定最末尾，高亮 label
└──────────────────────────────────┘
```

- `canPickMany: false`
- `matchOnDescription: true` 以便搜索帖子数也能过滤
- 选择"＋ 新建分类…" → 走 3.3

### 3.3 新建分类二次确认

```
showInputBox({
  prompt: "输入新分类名（1–20 字符，支持中文）",
  validateInput: (v) => {
    if (v.length === 0) return "必填";
    if (v.length > 20) return "最长 20 字符";
    if (/[\/\\:*?"<>|\t\n\r]/.test(v)) return "不能包含 / \\ : * ? \" < > | 或换行";
    return null;
  }
})
  → showWarningMessage(
      `将创建新的顶级分类 "${name}"。确认？`,
      { modal: true },
      "确认创建"
    )
```

用户点"确认创建"才推进，否则回到 QuickPick。

---

## 4. @mention 方案

### 4.1 路线选择（本期采用方案 A）

| 方案 | 做法 | 交互成本 | 对齐 memo | 本期 |
|---|---|---|---|---|
| **A** | AI 在草稿 md 的 frontmatter 写 `mentions: { open_ids, comments }`，扩展 publish 时读出来塞 API | 0 额外 UI | §4 & §8 | ✅ |
| B | QuickPick 选联系人 + InputBox 填"说一句话"，在创建草稿前收集 | +2 步 | §8 的暂缓 UI | ❌ |

### 4.2 方案 A 的工作方式

1. `buildNewThreadPrompt` 调用 `api.listContacts()` 取最近 N 个活跃联系人（默认 20）。
2. 提示词中以"如果你要 @ 某人，把他们加到文件顶部的 frontmatter 里"为指引，附上联系人清单（`name` / `open_id`）。
3. AI 生成的草稿 md 示例：

   ```markdown
   ---
   mentions:
     open_ids:
       - ou_xxxxxxxx
       - ou_yyyyyyyy
     comments: 这个方案希望你们 review
   ---
   # （正文以 H1 开头，服务端会用 title 兜底）
   方案内容...
   ```

4. `DraftsManager.publish` 时解析 frontmatter：
   - 有 mentions 且合法（`open_ids.length > 0 ⇒ comments.trim().length > 0`）→ 塞进 API body
   - frontmatter 缺失或非法 → 以"无 mention"方式发布（不阻塞）
   - 从正文中剥去 frontmatter 再作为 body 字段发送

5. 服务端会落盘为 Markdown frontmatter 并推飞书通知——与 Web 版本完全一致。

### 4.3 后续 Follow-up（不在本期）

若用户反馈 AI 填 frontmatter 体验差，再加"方案 B"的 QuickPick，作为可选替代，frontmatter 仍作为底层契约。

---

## 5. 代码改动清单

所有路径均相对 `vscode-team-pivot/` 根目录。

### 5.1 API 客户端 — [src/api/client.ts](src/api/client.ts)

新增两个方法：

```ts
createThread(body: {
  category: string;
  title: string;
  body: string;
  mentions?: MentionBlock;
}): Promise<CreateThreadResponse> {
  return this.request(`/api/threads`, {
    method: "POST",
    body: JSON.stringify(body),
  }) as Promise<CreateThreadResponse>;
}

listCategories(): Promise<ListCategoriesResponse> {
  return this.request(`/api/categories`, {
    method: "GET",
  }) as Promise<ListCategoriesResponse>;
}
```

### 5.2 类型定义 — [src/api/types.ts](src/api/types.ts)

```ts
export interface CreateThreadResponse {
  category: string;
  slug: string;
  filename: string;
}

export interface CategoryEntry {
  name: string;
  post_count: number;
  last_updated: string | null; // ISO 8601
}

export interface ListCategoriesResponse {
  items: CategoryEntry[];
}
```

### 5.3 草稿管理器 — [src/drafts/manager.ts](src/drafts/manager.ts)（改动最大）

#### 5.3.1 扩展 meta schema

**现有**：
```ts
{ reply_to: string | null, references: string[] }
```

**扩展为打标签的 union**：
```ts
type DraftMeta =
  | { kind: "reply";      category: string; slug: string;
      reply_to: string | null; references: string[] }
  | { kind: "new-thread"; category: string; title: string };
```

`publish()` 按 `kind` 分支调不同 API。

#### 5.3.2 新增方法

```ts
ensureNewThreadDraft(args: { title: string; category: string })
  : Promise<DraftSnapshot>
```

- 目录：`draftsDir/new-threads/`
- 文件名：`{uuid}.md` / `{uuid}.pivot-meta.json`（用随机 uuid 防止标题含非法字符）
- 复用策略：扫 `new-threads` 下所有 meta，若存在 `kind === "new-thread" && title === T && category === C` 的草稿则返回现有 DraftSnapshot
- 创建空 md 文件触发一次 `bodyListeners` 广播（保证 Webview 打开时有初始态）

#### 5.3.3 改造 `publish()`

```ts
async publish(detail: ThreadDetail | null, draftId: string): Promise<PublishResult> {
  const meta = await this.readMeta(draftId);
  const rawBody = await fs.readFile(this.mdPath(draftId), "utf8");
  const { body, frontmatter } = parseFrontmatter(rawBody); // 用现有 yaml 依赖

  if (meta.kind === "reply") {
    if (!detail) throw new Error("reply publish requires thread detail");
    await this.api.replyToThread(detail.meta.category, detail.meta.slug, {
      body,
      reply_to: meta.reply_to ?? undefined,
      references: meta.references,
      mentions: extractMentions(frontmatter),
    });
    await this.cleanup(draftId);
    return { kind: "reply" };
  }

  if (meta.kind === "new-thread") {
    const res = await this.api.createThread({
      category: meta.category,
      title: meta.title,
      body,
      mentions: extractMentions(frontmatter),
    });
    await this.cleanup(draftId);
    return { kind: "new-thread", category: res.category, slug: res.slug };
  }

  throw new Error(`unknown draft kind: ${(meta as any).kind}`);
}
```

#### 5.3.4 扩展 `list()` 方法

返回的 `DraftSnapshot[]` 需带上 `kind`、`title?`、`category?`，供 TreeView 分组展示。

### 5.4 提示词构建 — [src/drafts/promptBuilder.ts](src/drafts/promptBuilder.ts)

新增 `buildNewThreadPrompt`：

```ts
export function buildNewThreadPrompt(args: {
  title: string;
  category: string;
  draftPath: string;
  contacts: Contact[]; // 最近活跃联系人
  mirrorDir?: string;  // 如有，可让 AI 参考同类帖子风格
}): string
```

提示词要点：
- 明确"这是新帖，不是回复"
- 目标分类 + 标题
- 强调正文只写 Markdown 正文，可省略 `# 标题`（服务端会用 title 兜底）
- frontmatter 中如何填 mentions（给联系人清单）
- 覆盖写入 `draftPath`，并反馈保存结果

### 5.5 协议层 — [src/webview/protocol.ts](src/webview/protocol.ts)

**Webview → 扩展** 新增：
```ts
| { type: "request-new-thread" }
| { type: "publish-new-thread-draft"; draft_id: string }
| { type: "discard-new-thread-draft"; draft_id: string }
```

**扩展 → Webview** 新增：
```ts
| { type: "show-new-thread-composer"; draft: DraftSnapshot;
    title: string; category: string }
```

`DraftSnapshot` 字段补充：
```ts
kind: "reply" | "new-thread";
title?: string;
category?: string;
```

### 5.6 WebviewHost — [src/webview/host.ts](src/webview/host.ts)

新增两个方法：

- **`startNewThread()`**：承担 §2.1 的 ①-⑥，**入参均在方法内收集**（不从 Webview 传参）
  - 先 check token（无 token 走现有提示流程）
  - showInputBox(title) → QuickPick(category) → (可选 showInputBox + warning)
  - `drafts.ensureNewThreadDraft(...)`
  - 拉联系人 `api.listContacts()`（失败不阻塞，降级为空列表）
  - `buildNewThreadPrompt(...)` → `env.clipboard.writeText(...)`
  - `showInformationMessage("草稿提示词已复制。切到 Claude Code 粘贴即可。")`
  - `panel.reveal()` + `post({ type: "show-new-thread-composer", ... })`

- **`publishNewThreadDraft(draftId)`**：
  - `drafts.publish(null, draftId)` → 拿到 `{kind: "new-thread", category, slug}`
  - `mirror.sync()`
  - `commands.executeCommand("pivot.refresh")`
  - `commands.executeCommand("pivot.openThread", { category, slug })`
  - `showInformationMessage("Pivot: thread published.")`

错误兜底：沿用 `ApiError` 处理（401 清 token、400 profile setup 打开 Web 设置、其他弹错误）。

### 5.7 TreeView — [src/views/threadTree.ts](src/views/threadTree.ts)

"草稿区"分组对 `kind === "new-thread"` 的节点：
- label 用 `draft.title`
- description 用 `draft.category`
- contextValue 设 `pivot-draft-new-thread`（与 reply 草稿的 `pivot-draft` 并列）
- 点击：打开 Pivot Webview 并 `post({ type: "show-new-thread-composer", ... })`

"丢弃草稿"命令继续复用现有 `pivot.discardDraftFromTree`（内部按 meta 读 kind 走对应清理路径）。

### 5.8 命令 & 贡献点 — [package.json](package.json)

新增：

```json
"contributes.commands": [
  { "command": "pivot.newThread", "title": "Pivot: New Thread",
    "icon": "$(add)" }
],
"contributes.menus.view/title": [
  { "command": "pivot.newThread", "when": "view == pivot.threads",
    "group": "navigation@0" }
]
```

### 5.9 扩展入口 — [src/extension.ts](src/extension.ts)

```ts
context.subscriptions.push(
  vscode.commands.registerCommand("pivot.newThread", () => host.startNewThread()),
  vscode.commands.registerCommand(
    "pivot.openThread",
    (ref: { category: string; slug: string }) => host.openThread(ref.category, ref.slug)
  ), // 若尚未导出，本期补上
);
```

### 5.10 Webview UI

**新增**：`webview/src/components/NewThreadComposer.tsx`
- 顶部只读横条：`title` + `category` badge + 右上角丢弃按钮
- 下方直接复用现有 `DraftCard`（已有实时预览、发布、丢弃逻辑，稍作事件路由即可）

**修改**：`webview/src/App.tsx`
- 新增 `case "show-new-thread-composer"` 消息分支，state 走新分支（和 `show-detail` 并列，两者互斥展示）
- 发布按钮点击：`vscode().postMessage({ type: "publish-new-thread-draft", draft_id })`

---

## 6. 数据流与关键状态

```
┌─ Extension Host ──────────────────────────┐
│  DraftsManager                            │
│  ├─ new-threads/{uuid}.md            ← AI 写  │
│  └─ new-threads/{uuid}.pivot-meta.json        │
│          kind: "new-thread"               │
│          title, category                  │
│                │                          │
│  FileSystemWatcher                        │
│          │                                │
│  bodyListeners (EventEmitter)             │
│          │                                │
│  WebviewHost ──────────────── postMessage │
└──────────┼────────────────────────┬───────┘
           │                        │
           ▼                        ▼
     用户在 AI 聊天插件        Pivot Webview (React)
     里贴提示词 / 收到        NewThreadComposer
     回复 / 让 AI 写文件          │
                                 │ 点击"发布"
                                 ▼
                            postMessage ──→ Host
                                                │
                                                ▼
                                       api.createThread
                                                │
                                                ▼
                                       mirror.sync + openThread
```

---

## 7. 边界与错误处理

| 场景 | 处理 |
|---|---|
| 无 PAT | `startNewThread` 开头 check；无 token → 弹"生成 token"提示，中断流程 |
| `listThreads` 失败（取 category 列表）| 降级为空列表 + 强制走"新建分类" |
| `listContacts` 失败（取联系人）| 提示词中以"无可用联系人"提示 AI，仍可发帖 |
| 用户在 showInputBox / QuickPick 取消 | 全流程中断，不创建草稿文件 |
| Category 名冲突规则（服务端接受任意合法字符串）| 插件侧保留现有分类 + 新建分类二次确认，已规避 |
| 发布时 md 为空 | 前端 `hasBody` 校验禁用发布按钮（复用 DraftCard 现有逻辑） |
| 发布时 frontmatter mentions 非法（open_ids 非空但 comments 空）| 丢弃 mentions 字段继续发布，并给用户 `showWarningMessage` 提示"已忽略 @mention" |
| 服务端 400 "profile setup required" | `ApiError` 兜底路径已覆盖（`client.ts:71-75`）|
| 服务端 401 invalid_token | `client.ts:67-70` 自动清 token |
| 网络失败 | `ApiError(0, "network_error")` → 用户可重试，草稿文件保留 |
| 同 (title, category) 重复触发 `startNewThread` | `ensureNewThreadDraft` 复用现有草稿，避免重复文件 |
| 发布成功后草稿清理失败（不太可能）| 记录 `console.error`，不阻塞主流程，用户下次打开扩展会看到"僵尸草稿"，可右键丢弃 |

---

## 8. 测试计划

### 8.1 当前测试基础设施

- 仓库无任何 `.test.ts`
- memo §2 规划了 `@vscode/test-electron + vitest`，但未落地
- **本期策略**：手工测试清单 + **独立的 API 连通性脚本**，vitest 框架搭建留到后续

### 8.2 API 连通性脚本

**位置**：`scripts/test-create-thread.mjs`（新增目录）

**目的**：绕过 VS Code，直接向 PivotServer 发一次 `POST /api/threads`，确认：
- PAT 鉴权通
- 分类 / 标题 / 正文 / mentions 四个字段服务端接受
- 返回格式符合我们声明的 `CreateThreadResponse`

**骨架**：

```js
// scripts/test-create-thread.mjs
// Usage: node scripts/test-create-thread.mjs
//   env: PIVOT_SERVER (default https://pivot.enclaws.ai), PIVOT_TOKEN (required)

import { argv, env, exit } from "node:process";

const SERVER = env.PIVOT_SERVER ?? "https://pivot.enclaws.ai";
const TOKEN  = env.PIVOT_TOKEN;
if (!TOKEN) { console.error("PIVOT_TOKEN env required"); exit(1); }

const dry = argv.includes("--dry-run");

const body = {
  category: "vscode-ext-smoke-test",
  title: `smoke ${new Date().toISOString()}`,
  body: "# Smoke\n\n这是 vscode 扩展发帖连通性测试，若看到此帖可安全删除。",
  // mentions: { open_ids: [], comments: "" },  // 可选
};

console.log("POST", `${SERVER}/api/threads`);
console.log("body:", JSON.stringify(body, null, 2));
if (dry) { console.log("--dry-run, not sending"); exit(0); }

const res = await fetch(`${SERVER}/api/threads`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const json = await res.json().catch(() => null);
console.log("status:", res.status);
console.log("response:", json);

if (!res.ok) exit(1);

// 断言字段
if (!json.category || !json.slug || !json.filename) {
  console.error("❌ response missing expected fields");
  exit(1);
}
console.log("✅ createThread OK:", `${json.category}/${json.slug}`);
```

使用：
```bash
# 先 dry run 看请求体
PIVOT_TOKEN=pvt_xxx node scripts/test-create-thread.mjs --dry-run
# 再真实发
PIVOT_TOKEN=pvt_xxx node scripts/test-create-thread.mjs
```

### 8.3 手工测试清单

按顺序测，每项记录 pass/fail。

#### 8.3.1 入口路径

| # | 步骤 | 期望 |
|---|---|---|
| 1 | 点侧边栏 Pivot TreeView 标题栏的 `＋` | 弹 showInputBox 输标题 |
| 2 | 命令面板输入 "Pivot: New Thread" | 同上 |
| 3 | 未设置 PAT 时触发 | 弹"设置 token"提示，不进入标题输入 |

#### 8.3.2 标题输入

| # | 输入 | 期望 |
|---|---|---|
| 4 | 空字符串，回车 | validator 报"必填"，不推进 |
| 5 | 201 字符 | 报"最长 200 字符" |
| 6 | 合法标题 | 进入 category QuickPick |
| 7 | Esc 取消 | 流程中断，无副作用（无文件生成） |

#### 8.3.3 Category 选择

| # | 步骤 | 期望 |
|---|---|---|
| 8 | QuickPick 展示 | 能看到现有分类 + 帖子数，最末尾有"＋ 新建分类…" |
| 9 | 选已有分类 | 进入草稿创建 |
| 10 | 选"新建分类" → 输入"x/y" | validator 报"不能包含特殊字符" |
| 11 | 选"新建分类" → 输入合法名 → 弹确认 → 取消 | 退回 QuickPick |
| 12 | 选"新建分类" → 合法名 → 确认 | 进入草稿创建 |
| 13 | listCategories 网络失败（离线测试）| QuickPick 无现有分类，只剩"＋ 新建分类…"；降级可用 |

#### 8.3.4 草稿创建与 AI 协作

| # | 步骤 | 期望 |
|---|---|---|
| 14 | 首次对 (title, category) 发起 | `~/.pivot-drafts/new-threads/{uuid}.md` 和 `.pivot-meta.json` 被创建，meta.kind=="new-thread" |
| 15 | 相同 (title, category) 再次发起 | 复用现有草稿，不再复制提示词（或复制同一份）|
| 16 | 剪贴板 | 包含标题 / 分类 / 本地路径 / 联系人 open_ids 的提示词 |
| 17 | Webview 打开 | 展示 NewThreadComposer，title / category 只读显示 |
| 18 | 外部手动往 md 文件写入内容 | Webview 秒刷新显示 |
| 19 | 清空 md 文件 | DraftCard "发布"按钮置灰 |

#### 8.3.5 发布路径

| # | 步骤 | 期望 |
|---|---|---|
| 20 | 有正文、无 frontmatter → 点发布 | `POST /api/threads` 成功，弹"published"，Webview 自动切到新帖详情，侧边栏刷新 |
| 21 | 带合法 mentions frontmatter → 发布 | API body 含 mentions，飞书收到通知（观察测试群）|
| 22 | 带非法 mentions（open_ids 非空 comments 空）→ 发布 | 弹警告"已忽略 mentions"，但帖子正常发布 |
| 23 | 服务端 401 | token 被清，弹"重新设置 token"，草稿保留 |
| 24 | 服务端 400 profile setup | 弹提示并跳转 Web 设置页，草稿保留 |
| 25 | 网络失败 | 弹错误，草稿保留，可重试 |
| 26 | 发布后 | 草稿文件和 meta 文件被清理 |

#### 8.3.6 TreeView 草稿分组

| # | 步骤 | 期望 |
|---|---|---|
| 27 | 有未发布 new-thread 草稿时刷新 | 草稿区出现以 title 为 label、category 为 description 的节点 |
| 28 | 右键"丢弃草稿" | 草稿文件和 meta 删除，TreeView 刷新 |
| 29 | 点草稿节点 | 打开 Webview NewThreadComposer，实时预览 |

#### 8.3.7 跨场景一致性

| # | 步骤 | 期望 |
|---|---|---|
| 30 | 同时有 reply 草稿和 new-thread 草稿 | TreeView 正确区分两者 |
| 31 | 发布新帖后再发回帖 | 回帖路径仍正常工作，不受影响 |
| 32 | 重启 VS Code 后 | 未发布草稿仍在、可继续编辑发布 |

### 8.4 后续单测（不在本期）

搭 vitest 之后重点覆盖：
- `DraftsManager.ensureNewThreadDraft` 的复用 / 新建路径
- `DraftsManager.publish` 按 kind 分支的调用
- `parseFrontmatter` / `extractMentions` 合法/非法 mentions
- `buildNewThreadPrompt` 对不同 contacts 输入的输出

集成层用 `@vscode/test-electron` 驱动命令跑端到端。

---

## 9. 实施顺序

建议按下面顺序切分到 commit，保证每一步可独立 review：

1. **契约层**：`types.ts`（`CreateThreadResponse`、`DraftSnapshot.kind`）+ `protocol.ts` 新消息
2. **DraftsManager**：meta schema 迁移 + `ensureNewThreadDraft` + `publish` 按 kind 分支 + frontmatter 解析
3. **API + 提示词**：`client.ts` 加 `createThread`，`promptBuilder.ts` 加 `buildNewThreadPrompt`
4. **Host**：`startNewThread` / `publishNewThreadDraft`
5. **命令 & 贡献点**：`extension.ts` 注册 + `package.json` commands/menus
6. **Webview UI**：`NewThreadComposer.tsx` + `App.tsx` 消息分支
7. **TreeView**：新草稿 kind 的渲染与点击
8. **测试**：`scripts/test-create-thread.mjs` + 按 §8.3 手工跑一遍
9. **memo 更新**：§4 / §8 / §9 同步本功能的到位状态

---

## 10. 后续 memo.md 更新点

已挪到 §15（实施完成后整合），本节保留为占位以维持历史编号。

---

## 11. 已确认事项（2026-04-20，Ken 裁决）

- [x] **@mention 路线**：方案 A（AI 在草稿 md 的 frontmatter 填 `mentions`，扩展 publish 时读出）
- [x] **分类数据源**：**本期新增服务端接口 `GET /api/categories`**，扩展直接调该接口取分类清单（不再靠 `listThreads` 聚合）。跨项目请求见 [to-team-pivot-web.md](to-team-pivot-web.md) `[7]` 条目。
- [x] **草稿目录命名**：`new-threads/`（不用 `__new__/`）
- [x] **发布成功后自动打开帖子详情**：保持

## 12. 已记录待后期扩展项

- **联系人注入数量调优**：当前提示词中注入的"最近活跃联系人"数量固定为默认 20。后期可能需要：
  - 做成 VS Code 配置项（`pivot.mentionContactsLimit`）
  - 或支持模糊搜索 / 分页加载，让 AI 按 user 指令灵活检索
  - 触发条件：用户反馈"AI 选不到要艾特的人"或"联系人清单太长污染提示词"时
- **方案 B（插件内 QuickPick 选人）**：若方案 A 使用一段时间后 AI 填 frontmatter 的体验差，再加 QuickPick 作为可选替代，底层 frontmatter 契约不变。

---

## 13. 服务端改造（team-pivot-web 侧）

> 本章节是对 `[to-team-pivot-web.md](to-team-pivot-web.md)` 中 `[7]` 条目请求的**具体落地设计**，当扩展侧实施推进时由同一人（或 `pivot-web-ai`）按此方案修改 `team-pivot-web` 代码。

### 13.1 范围

唯一需要新增的服务端能力：`GET /api/categories`——返回所有顶级分类及其帖子数、最后更新时间。不需要任何数据库迁移、不需要新配置项、不需要改写入路径。

### 13.2 契约

#### 路径与方法

```
GET /api/categories
```

#### 鉴权

与其他只读端点一致：
- Cookie `sid`（Web 登录用户）
- `Authorization: Bearer pvt_xxx`（VS Code 扩展用 PAT）
- **不需要** `require_profile`（只读，不涉及写入）

#### 响应（`200 OK`）

```json
{
  "items": [
    {
      "name": "general",
      "post_count": 12,
      "last_updated": "2026-04-20T10:00:00+08:00"
    },
    {
      "name": "engineering",
      "post_count": 8,
      "last_updated": "2026-04-19T14:30:00+08:00"
    }
  ]
}
```

字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `str` | 分类目录名，直接对应 `NewThreadBody.category`，UTF-8，大小写敏感 |
| `post_count` | `int` | 该分类下所有 threads 的**帖子（含回帖）总数**之和（best-effort，不要求强一致） |
| `last_updated` | `str \| null` | 该分类下所有 threads 的 `last_updated` 最大值（ISO 8601），没有任何 thread 时为 `null` |

**空分类情况**：若 workspace 配置了但没有任何 category 目录，返回 `{"items": []}` + `200`（不是 404/503）。

**排序**：按 `last_updated` 降序（空值排最后）。客户端可能会再排一次，所以排序顺序不是契约强保证。

#### 错误

| 状态 | 响应体 | 触发条件 | 抛出位置 |
|---|---|---|---|
| 401 | `{"detail": "invalid_token"}` | PAT 无效 / 过期 | [auth/deps.py:65](../team-pivot-web/server/auth/deps.py) —— 由 `Depends(current_user)` 自动触发 |
| 503 | `{"detail": "workspace_not_configured"}` | 未配置 workspace | [workspace_runtime.py:108](../team-pivot-web/server/workspace_runtime.py) —— 首次访问 `workspace.discussions_dir` 时 `_require()` 自动抛出 |

新端点不需要写任何 `try/except` 或 `raise HTTPException`，完全复用现有依赖链兜底。

### 13.3 代码改动（约 20 行）

**仅改 1 个文件**：[team-pivot-web/server/api/discussions.py](../team-pivot-web/server/api/discussions.py)，在 `build_router()` 内（现有 `@router.get("/threads")` 附近）追加：

```python
@router.get("/categories")
def list_categories(user: User = Depends(current_user)):
    # workspace.discussions_dir 访问失败时 WorkspaceRuntime._require() 自动抛 503
    # Depends(current_user) 自动处理 401
    all_threads = list_threads(workspace.discussions_dir, workspace.index_dir)

    grouped: dict[str, dict] = {}
    for m in all_threads:
        cat = m.category
        if cat not in grouped:
            grouped[cat] = {"name": cat, "post_count": 0, "last_updated": None}
        grouped[cat]["post_count"] += m.post_count
        cur = grouped[cat]["last_updated"]
        if m.last_updated and (cur is None or m.last_updated > cur):
            grouped[cat]["last_updated"] = m.last_updated

    items = sorted(
        grouped.values(),
        key=lambda c: c["last_updated"] or "",
        reverse=True,
    )
    return {"items": items}
```

**关键点**：
- 复用现有 `list_threads(discussions_root, index_dir)`（定义于 [threads.py:66-88](../team-pivot-web/server/threads.py)），无新的文件扫描逻辑
- 分类聚合的聚合方式与 Web 前端 [ThreadListPane.tsx:272-299](../team-pivot-web/web/src/components/ThreadListPane.tsx) 的 `groupThreadsByCategory()` 完全一致（ISO 8601 字符串比较已被生产验证）
- `post_count` 的定义是"分类下所有 thread 的 `ThreadMeta.post_count` 求和"，包含主帖和回帖；扩展侧 QuickPick 里显示为 "N 个帖子"，用户看到的是"活跃度"而不是"主帖数"，语义可接受。**注**：若后续希望改成"主帖数"（即分类下有多少条 thread），改成 `len(all_threads_in_this_cat)` 即可，改动一行。

### 13.4 性能

- 时间复杂度：O(总 thread 数 × 每 thread 的 post 文件数)——和现有 `GET /api/threads` 完全一致
- 单次调用预期耗时：团队内部工具规模下（几十到几百 threads）**50–200ms**
- 是否需要缓存：**本期不加**。若未来单次调用超过 500ms，再加 `functools.lru_cache` 或 TTL 缓存，按 `discussions_dir` mtime invalidate

### 13.5 测试

**位置**：新建 [team-pivot-web/server/tests/test_categories_api.py](../team-pivot-web/server/tests/test_categories_api.py)，复用现有 [test_discussions_api.py](../team-pivot-web/server/tests/test_discussions_api.py) 的模式：

- 使用 `fastapi.testclient.TestClient`（同步，与 repo 惯例一致，不用 `httpx.AsyncClient`）
- 复用 `_WorkspaceStub`（`test_discussions_api.py` 第 18-27 行）和 `_write_post` 辅助（第 30-35 行）
- 复用 `db`、`users` fixture（[conftest.py](../team-pivot-web/server/tests/conftest.py)）

**必须覆盖的用例**（5 个）：

| # | 用例 | 准备 | 断言 |
|---|---|---|---|
| 1 | Bearer PAT 正常访问 | 写入 2 个 category × 2 个 thread × 若干 post | `200` + items 数量 + 每项 `name`/`post_count`/`last_updated` 字段 |
| 2 | Cookie 会话正常访问 | 同上，用 `sid` cookie | `200` 且响应同 #1 |
| 3 | 空 workspace | 只建 `discussions/` 根目录但不放任何子目录 | `200` + `{"items": []}` |
| 4 | 无 workspace 配置 | 工厂传 `None` workspace / 用 `WorkspaceRuntime` 未初始化 | `503` + `{"detail": "workspace_not_configured"}` |
| 5 | 无效 PAT | 传一个随机字符串当 Bearer | `401` + `{"detail": "invalid_token"}` |
| 6 | post_count 聚合正确性 | category A 下 2 个 thread（各 3、5 个 post），category B 下 1 个 thread（2 个 post） | A 的 `post_count == 8`，B 的 `post_count == 2` |
| 7 | last_updated 取最大值 | category A 下两个 thread 的 index 写不同 `last_updated` | 返回的是较新的那个 ISO 字符串 |
| 8 | 排序按 last_updated 降序 | 3 个 category，index 写不同时间 | `items` 顺序与时间降序一致 |

**骨架代码**（首个测试）：

```python
# tests/test_categories_api.py
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.api.discussions import build_router
from server.auth.deps import make_current_user
from server.auth.session import SessionStore
from server.api_tokens import ApiTokenRepo
from server.favorites import FavoriteRepo
from server.read_state import ReadStateRepo

from .test_discussions_api import _WorkspaceStub, _write_post, NoOpNotifier, _StubContacts


def test_categories_bearer_pat_ok(db, users, tmp_path):
    discussions = tmp_path / "discussions"
    index_dir = tmp_path / "index"
    _write_post(
        discussions / "general" / "hello" / "001_x_proposal_abc123.md",
        type_="proposal", author="ou_1", title="Hello",
    )
    _write_post(
        discussions / "general" / "hello" / "002_y_reply_def456.md",
        type_="reply", author="ou_2",
    )
    _write_post(
        discussions / "engineering" / "refactor" / "001_x_proposal_ghi789.md",
        type_="proposal", author="ou_1", title="Refactor",
    )

    token_repo = ApiTokenRepo(db)
    token_plain = token_repo.issue("ou_1", "test", ttl_days=30)
    sessions = SessionStore(db)
    current_user = make_current_user(sessions, users, token_repo)

    app = FastAPI()
    app.include_router(build_router(
        _WorkspaceStub(discussions, index_dir), users, _StubContacts(),
        NoOpNotifier(), ReadStateRepo(db), FavoriteRepo(db), current_user,
    ))
    client = TestClient(app)

    r = client.get(
        "/api/categories",
        headers={"Authorization": f"Bearer {token_plain}"},
    )
    assert r.status_code == 200
    body = r.json()
    names = [it["name"] for it in body["items"]]
    assert set(names) == {"general", "engineering"}
    general = next(it for it in body["items"] if it["name"] == "general")
    assert general["post_count"] == 2  # 主帖+回帖
```

（其他测试按 13.5 表格覆盖，遵循相同 fixture 复用模式。）

**运行**：

```bash
cd team-pivot-web
uv run pytest server/tests/test_categories_api.py -v
```

### 13.6 服务端实施顺序

1. **在 `discussions.py` 里追加 `@router.get("/categories")` 端点**（§13.3 代码）
2. **新建 `tests/test_categories_api.py`** 覆盖 §13.5 表格中的 8 个用例
3. **本地 `uv run pytest` 跑通**
4. **本地 `uv run uvicorn server.app:create_app --factory --reload` 手工 curl 验证**：
   ```bash
   # 用一个已有 PAT
   curl -H "Authorization: Bearer pvt_xxx" http://localhost:8000/api/categories | jq
   ```
5. **部署上线后**，在 [to-team-pivot-web.md](to-team-pivot-web.md) 追加 `[8] Re: [7]` REPLY 条目，记录：
   - 落地的路由路径（应与契约一致）
   - 实际响应字段是否与 §13.2 完全一致（若有偏差说明原因）
   - 对 Q1（`post_count` best-effort）/ Q2（`last_updated` 来源） / Q3（未来元数据扩展计划）的答复

### 13.7 不做的事

- **不加数据库表**：categories 信息完全从文件系统派生，引入 DB 表会带来读写同步问题
- **不加缓存**：性能够用（参见 §13.4）
- **不加分页**：categories 数量预期有限（< 100），分页带来不必要的复杂度
- **不改写入路径**：`POST /api/threads` 仍按现在的方式隐式创建 category 目录；新接口是旁路
- **不动 Web 前端**：`web/src/components/ThreadListPane.tsx` 的客户端 `groupThreadsByCategory` 保留，当前不重构；可以作为后续优化项
- **不加 rate limiting / 访问日志专项**：走现有中间件即可

### 13.8 与扩展侧实施的协调

建议的端到端节奏：

```
[服务端]                              [扩展]
1. 实现 /api/categories + 测试  ──►   （等）
2. 部署到生产 pivot.enclaws.ai
3. 在 to-team-pivot-web.md 写 [8]
                                  ┌── 4. 扩展侧 listCategories() 接入
                                  └── 5. §9 扩展实施步骤继续
```

如果想并行推进，扩展侧可以先实现所有不依赖 categories 数据的部分（见本文档 §9 步骤 1–7），只在步骤 4（`startNewThread` 的 QuickPick）前等服务端就绪——这正是上一轮讨论里的"Path B"。

---

## 14. 交付汇总（实施完成 2026-04-20）

> 本章节记录实际交付的所有改动与测试结果。后续上生产后，需要回来更新 §15 的 memo 同步点。

### 14.1 最终状态

| 项目 | 结果 |
|---|---|
| 服务端 `GET /api/categories` 端点 | ✅ 实现（~20 行，仅 1 个文件改动） |
| 服务端 pytest | ✅ **13/13 通过**（8 新增 + 5 回归均绿） |
| 扩展端 TypeScript 编译 | ✅ **0 error** |
| 扩展端 esbuild 构建 | ✅ 345kb 产物 |
| Webview 端 TypeScript 编译 | ✅ **0 error** |
| Webview 端 vite 构建 | ✅ 288 modules |
| 跨项目通信日志 `[8] Re: [7]` REPLY | ✅ 已追加 |

### 14.2 改动的文件清单

#### team-pivot-web（服务端）

| 文件 | 改动性质 |
|---|---|
| [server/api/discussions.py](../team-pivot-web/server/api/discussions.py) | 修改：+20 行，新增 `GET /api/categories` 端点 |
| **[server/tests/test_categories_api.py](../team-pivot-web/server/tests/test_categories_api.py)** | 新建：8 个测试用例 |

#### vscode-team-pivot（扩展）

**修改**：

| 文件 | 改动 |
|---|---|
| [src/api/types.ts](src/api/types.ts) | 新增 `CreateThreadResponse` / `CategoryEntry` / `ListCategoriesResponse` |
| [src/api/client.ts](src/api/client.ts) | 新增 `createThread()` / `listCategories()` |
| [src/webview/protocol.ts](src/webview/protocol.ts) | `DraftSnapshot` 扩展 `kind/title/category`；新增三个消息类型 |
| [src/drafts/manager.ts](src/drafts/manager.ts) | 大重构：meta union、`ensureNewThreadDraft`、`publish` 按 kind 分支返回 `PublishResult`、frontmatter 解析、mentions 提取 |
| [src/drafts/promptBuilder.ts](src/drafts/promptBuilder.ts) | 新增 `buildNewThreadPrompt` |
| [src/webview/host.ts](src/webview/host.ts) | 新增 `startNewThread` / `openNewThreadComposer` / `pickCategory` / `publishNewThreadDraft` / `discardNewThreadDraft`；pending composer 机制 |
| [src/extension.ts](src/extension.ts) | 注册 `pivot.newThread` / `pivot.openNewThreadDraft` |
| [src/views/threadTree.ts](src/views/threadTree.ts) | 草稿节点按 kind 分流 |
| [package.json](package.json) | 新增命令；`view/title` 菜单加 `＋` 按钮（首位）；`view/item/context` 加新 contextValue |
| [webview/src/App.tsx](webview/src/App.tsx) | `ViewState` 加 `new-thread` 分支；消息路由兼容 |
| [webview/src/index.css](webview/src/index.css) | 新增 `.new-thread-composer` 样式 |
| [to-team-pivot-web.md](to-team-pivot-web.md) | 追加 `[7]` REQUEST + `[8]` REPLY |

**新建**：

| 文件 | 用途 |
|---|---|
| [webview/src/components/NewThreadComposer.tsx](webview/src/components/NewThreadComposer.tsx) | 新帖草稿 Webview 组件 |
| [scripts/test-create-thread.mjs](scripts/test-create-thread.mjs) | API 连通性验证脚本 |
| [new-thread-design.md](new-thread-design.md) | 本设计文档 |

### 14.3 用户验收步骤

#### 步骤 1：服务端部署

将 `team-pivot-web` 推送到生产环境 `pivot.enclaws.ai`：

```bash
cd d:/web3/team-pivot-web
uv run pytest server/tests/       # 确认 pytest 全绿
# 按既有流程部署
```

#### 步骤 2：线上连通性验证

服务端上线后，在扩展仓库用连通性脚本快速验证：

```bash
cd d:/web3/vscode-team-pivot
# 只查分类（只读，不产生副作用）
PIVOT_TOKEN=pvt_xxx node scripts/test-create-thread.mjs --categories-only
# 发一条测试帖（会真的落盘，确认无误后删除）
PIVOT_TOKEN=pvt_xxx node scripts/test-create-thread.mjs
```

#### 步骤 3：扩展端手工测试

在 VS Code 里按 F5 跑 Extension Development Host，按 §8.3 的 32 项手工测试清单走一遍。重点：

- 侧边栏 Pivot 标题栏 `＋` 按钮 + 命令面板 `Pivot: New Thread` 两条入口
- 标题输入校验（空 / 超长 / 取消）
- 分类 QuickPick：已有分类 + "＋ 新建分类…" + 二次确认
- 提示词复制 + Webview 打开 NewThreadComposer
- 外部编辑 md 文件后 Webview 实时预览刷新
- 发布后自动打开新帖详情 + 侧边栏刷新
- TreeView 的"草稿区"区分回帖草稿（📄）与新帖草稿（✏️）
- 右键"丢弃草稿"两种草稿都能丢
- 回帖流程回归未受影响

### 14.4 实施过程中创建的临时产物（可删）

| 路径 | 说明 | 何时可删 |
|---|---|---|
| `team-pivot-web/.venv-test/` | 跑 pytest 用的临时 Python venv（Python 3.14.3 + fastapi/pytest/pyyaml）；被 venv 自身的 .gitignore 忽略 | 随时 |
| `vscode-team-pivot/node_modules/` 和 `vscode-team-pivot/webview/node_modules/` | 用 `npm install --ignore-scripts` 装的依赖，仅为了跑 tsc 和 build 验证；已在 `.gitignore` 中 | 随时 |
| `vscode-team-pivot/dist/` 和 `vscode-team-pivot/webview/dist/` | 本地 build 产物；已在 `.gitignore` 中 | 随时 |

### 14.5 未做（按 Ken 边界约定）

- ❌ 未 `git push`（用户自己 push）
- ❌ 未向生产 `pivot.enclaws.ai` 发测试新帖
- ❌ 未更新 `memo.md`（§15 列了后续需要更新的点，待本功能上生产后再更）

---

## 15. 后续 memo.md 更新点（本功能上生产后执行）

- §4 "核心工作流"：追加一节"AI 协作发新帖"，流程对称于 §4 的"AI 协作回复"
- §8 MVP 范围：把"新建 thread"从"暂缓"挪到"做"；`@mention 自动补全 UI` 继续标"暂缓"，脚注说明"新帖 mentions 由 AI 填 frontmatter"
- §9 协议契约表：新增 `POST /api/threads` 和 `GET /api/categories` 两行
- 如果 `promptBuilder` 的联系人注入体验需要调优，在 §6 附近加一句说明

---

## 16. 上线后迭代（2026-04-21）

本节记录初始实施完成后，在本地联调验收阶段发现并修复的 UX 问题，以及遗留的后续项。

### 16.1 验收时发现并已修复的问题

| # | 问题 | 修复 | 相关提交 |
|---|---|---|---|
| 1 | 空态文案「草稿是空的…」让新用户误以为出错 | 改为三段式正向引导："✅ 提示词已复制" → "下一步（二选一）" → "写完后发布 / 随时切走" | [NewThreadComposer.tsx](webview/src/components/NewThreadComposer.tsx) |
| 2 | `.draft-empty` 原本 `text-align: center`，加入段落 / 列表后居中排版错乱 | 改 `text-align: left`，为 `p` / `ul` / `li` 配置合适的间距与 20px 缩进 | [webview/src/index.css](webview/src/index.css) |
| 3 | `startNewThread` 创建完草稿后，侧边栏「草稿」分组不会自动刷新，必须手动点刷新按钮 | 在方法末尾补一行 `void vscode.commands.executeCommand("pivot.refresh")`，与顶栏手动刷新按钮逻辑一致 | [host.ts:startNewThread](src/webview/host.ts) |
| 4 | 用户若未及时把剪贴板里的提示词粘给 AI，剪贴板被其他内容覆盖后无法再拿到提示词，只能丢弃草稿重建 | 在空态文案首句后追加「重新复制」按钮，协议新增 `recopy-new-thread-prompt` 消息；点击后重拉最新联系人、重建提示词再塞剪贴板 | [protocol.ts](src/webview/protocol.ts) / [host.ts:recopyNewThreadPrompt](src/webview/host.ts) / [NewThreadComposer.tsx](webview/src/components/NewThreadComposer.tsx) / [App.tsx](webview/src/App.tsx) |
| 5 | 发布 / 丢弃时后端调用没有任何可视反馈，用户不知道是否在进行中 | `publishNewThreadDraft` / `publishDraft` / `discardNewThreadDraft` 三处改用 `vscode.window.withProgress`，分阶段显示"发布到服务端…" → "同步本地镜像…" | [host.ts](src/webview/host.ts) |

### 16.2 端到端验收结论

| 环节 | 状态 |
|---|---|
| 新帖入口 `＋` / 命令面板 `Pivot: New Thread` | ✅ |
| 标题校验 + 分类 QuickPick + 新建分类二次确认 | ✅ |
| 草稿文件落盘（`~/.pivot-drafts/new-threads/{uuid}.md|.pivot-meta.json`）+ 剪贴板装提示词 | ✅ |
| 「重新复制」按钮 | ✅ |
| 侧边栏「草稿」分组自动刷新（含 new-thread / reply 区分显示） | ✅（仅 F5 调试路径验证；vsix 路径需"卸载→重装→重载窗口"闭环） |
| Webview 实时预览 AI 写入的草稿 | ✅ |
| 发布 / 丢弃的 withProgress 进度条 | ✅ |
| AI 按约定把 `mentions` 写进 frontmatter，发布后服务端将 mention 正确落到 `index/*.yaml` 的 `timeline` 条目 | ✅（参见 §16.3 实测数据） |

### 16.3 @mention 实测数据（自证链路闭环）

验收帖：`新类目/测试提及/001_liuyu_proposal_dd2ccf.md`。实际服务端行为：

- 主帖 md 文件的 frontmatter **只保留** `type` / `author` / `created` / `index_state`——**不写入 mentions**
- `mentions` 块被服务端 [publish.py](../team-pivot-web/server/publish.py) 中的 `create_thread_index(..., mention=mention_block)` 写入 **index yaml**：

  ```yaml
  # index/测试提及-discuss.index.yaml 节选
  timeline:
  - time: '2026-04-21T13:52:40+08:00'
    event: liuyu created thread
    file: discussions/新类目/测试提及/001_liuyu_proposal_dd2ccf.md
    mention:
      users:
      - user: 刘昱
        open_id: ou_6de589cfddf3f1499f82a9222e5f49aa
      comments: 请自己确认这条通知是否收到
  ```

- 因此**"主帖正文不应出现 mentions frontmatter 原文"是正确设计**，不是 bug。插件侧剥掉 frontmatter、服务端按 mention 路由推飞书通知，两侧职责解耦

### 16.4 遗留待办（不阻塞本功能上线）

- **回帖空态文案同步打磨**：回帖草稿卡（[DraftCard.tsx:38](webview/src/components/DraftCard.tsx#L38)）目前仍是原始一句话 "草稿是空的。粘贴提示词到你的 AI 聊天窗口…"。已有文案建议（§16.1 #1 的结构），但本轮未落地；下一次涉及回帖体验迭代时一并改
- **顶栏两个 refresh 图标视觉混淆**：`pivot.refresh`（`$(refresh)`）与 `pivot.syncMirror`（`$(repo-sync)`）在小图标下难以区分。本轮决定**保持原样**，后续如用户反馈继续增多，可考虑：
  1. 把 `syncMirror` 挪到命令面板（降低曝光）
  2. 或换更不像的图标（如 `$(cloud-download)`）
- **飞书通知送达验证**：仅凭 Pivot 数据已确认 mentions 正确路由；是否真收到飞书卡片取决于飞书 App 权限、bot 成员关系、`.env NOTIFY_ENABLED`，属于运营配置层问题，和新帖功能解耦，不列入本帖验收范围
- **服务端 pytest 在 Windows + 中文 locale 上的 encoding / git branch 失败**：`test_index_files.py` 的 3 个 UTF-8 YAML 读取用例以及 `test_workspace.py::test_ensure_cloned_supports_empty_remote_without_main_branch` 在 Windows 环境下默认失败，设置 `PYTHONUTF8=1` 解掉三个 Unicode 问题；最后那个 `git pull --rebase origin` 问题与本期新帖功能无关，单独建单处理
- **vsix 安装路径的开发循环提示**：验收中反复踩到"改完代码没卸载旧 vsix → Extension Host 跑着老代码"的坑。考虑在 README / 后续脚本 `scripts/dev-install.ps1` 里收敛一个 "build → package → reinstall → reload" 的 one-liner，避免新同学重复踩

### 16.5 本轮未做

- ❌ 未 `git push`（由用户手动 push）
- ❌ 未打新 tag 或动 `package.json` 的 version（本轮仍在 `0.0.2`；如要发版 vsix 可在 push 前 bump 到 `0.0.3`）
- ❌ 未更新 `memo.md`（§15 的更新点保留；本功能上生产后由同一人一起更）

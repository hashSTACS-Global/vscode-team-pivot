# vscode-team-pivot · 构建备忘

新 Claude Code session 先读这个。**这是项目现状的权威文档**，memo 和代码有出入时以代码为准，但请立刻更新 memo。

姊妹项目：[`team-pivot-web`](https://github.com/hashSTACS-Global/team-pivot-web)（服务端 + Web 前端）。本仓库是它的 VS Code 扩展客户端，依赖其 REST API 做所有写入，依赖其数据仓库做所有读取。

## 1. 项目目标

为 `team-pivot-web` 提供一个 VS Code 原生扩展客户端，让用户**不离开编辑器**就能浏览讨论、回复、发表 comments，并借助已安装的 AI 聊天插件（Claude Code / Copilot / ChatGPT 等）深度参与讨论上下文。

核心设计取向：
- **UI 薄**，不内嵌 LLM。AI 工作全部甩给用户在 VS Code 里已经装好的聊天插件。
- **读写分离**：读走本地 git 只读镜像，写走 `team-pivot-web` REST API。
- **文件即载体**：AI 起草的回复落在本地 `.pivot-drafts/` 目录，UI 通过文件系统监听捕获并协助发布。

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 扩展主进程 | TypeScript + Node (VS Code Extension API) |
| 打包 | esbuild（主进程）+ Vite 库模式（Webview bundle） |
| Webview UI | React 18 + TypeScript（复用 `team-pivot-web/web/src` 的组件源码） |
| UI 库 | shadcn/ui + Tailwind（与 web 保持一致） |
| Git | 纯 subprocess 调用（`child_process.execFile`），不用 isomorphic-git / simple-git |
| 状态持久化 | VS Code `globalState` + `SecretStorage`（token 专用） |
| HTTP 客户端 | 原生 `fetch`（Node 20+） |
| 测试 | `@vscode/test-electron` + vitest（纯函数单测） |

## 3. 整体架构

```
┌────────────────────────── VS Code 窗口 ──────────────────────────┐
│                                                                    │
│  ┌─ 左：Explorer ──┐  ┌─ 中：Claude Code 聊天 ──┐  ┌─ 右：Pivot ─┐│
│  │  （原生 VS Code │  │  （用户已装的 AI 插件， │  │  Webview    ││
│  │   TreeView 和   │  │   我们不集成）          │  │  (React)    ││
│  │   我们的 Thread │  │                         │  │             ││
│  │   TreeView）    │  │                         │  │             ││
│  └─────────────────┘  └─────────────────────────┘  └─────────────┘│
│                                                                    │
│  Extension Host (Node/TS)                                          │
│  ├─ GitMirror    ── clone + pull 只读镜像到 globalStorage          │
│  ├─ PostReader   ── 解析 md+frontmatter / index.yaml (TS 版)       │
│  ├─ ApiClient    ── 调 team-pivot-web REST API                     │
│  ├─ AuthProvider ── token 存 SecretStorage                         │
│  ├─ ThreadTree   ── 左栏 TreeView Provider                         │
│  ├─ WebviewHost  ── 右栏 Webview 生命周期 + postMessage 桥         │
│  ├─ DraftWatcher ── 监听 .pivot-drafts/ 触发 UI 弹卡片             │
│  └─ PromptBuilder ── 为各种动作生成复制到剪贴板的提示词            │
└────────────────────────────────────────────────────────────────────┘
         │ pull (read only)          │ REST (write + contacts + drafts)
         ▼                           ▼
   test-team-pivot.git          team-pivot-web server
```

## 4. 核心工作流：AI 协作回复

这是本扩展的招牌体验，务必保留。

```
① 用户在 Pivot Webview 看到某个 post
② 点击 [📋 回复此贴] 按钮
   → 扩展生成提示词复制到剪贴板：
     "请读取 .pivot-mirror/threads/xxx/post-003.md，并参考同目录
      index.yaml 了解上下文。帮我起草一个回复，保存到
      .pivot-drafts/reply-<timestamp>.md。保存后告诉我路径。
      上下文：回复对象 张三 (open_id: ou_xxx)。"
③ 用户切到 Claude Code 面板，Cmd+V + Enter
④ Claude Code 读文件、写草稿到 .pivot-drafts/
⑤ 扩展的 FileSystemWatcher 捕获新文件
   → Pivot Webview 弹出"草稿就绪"卡片（预览 / 重改 / 发布）
⑥ 用户点 [✓ 发布]
   → 扩展 POST /api/.../reply，成功后 git pull 同步本地镜像
```

**关键设计点**：
- 草稿 md 文件用 frontmatter 记录回复目标（`reply_to`、`reply_to_post`、`mentions`），UI 据此知道发到哪
- "要 Claude 再改改" 按钮复制迭代提示词 `请修改 .pivot-drafts/xxx.md，要求：___`
- 动作模板可配置：📋 回复此贴 / 📋 总结此贴 / 📋 翻译此贴 / 📋 针对此贴提问
- @mention：复制提示词时附上最近活跃联系人 open_id 列表，Claude 填到草稿 frontmatter

## 5. 数据同步策略

**本地镜像永远只读**。插件绝不 commit/push，完全规避与服务端两阶段原子写竞争。

镜像位置：`<globalStorage>/pivot-mirror/<repo-name>/`

pull 触发条件：
1. 扩展激活时（首次 clone 或增量 pull）
2. 每次写操作（reply/post/comment）API 返回成功后
3. TreeView 顶栏手动刷新按钮
4. 可选后台轮询（默认关闭）

## 6. 鉴权方案 · 采纳 Personal Access Token

### 决定

插件使用 **PAT (Personal Access Token)** 鉴权。已排除 OAuth loopback 方案，原因：
- 飞书 OAuth 的 `redirect_uri` 是应用后台固定白名单，不支持 `http://127.0.0.1:*` 动态端口；实现 loopback 相当于自己搭一套 OAuth 授权服务器（PKCE/state/CSRF/refresh rotation），约 400 行代码 + 协议正确性审查
- PAT 方案服务端仅需 ~100 行（一张表 + 中间件 + 一个 Web 设置页）
- 一次性登录多两步点击的代价 vs OAuth 授权服务器的实现复杂度和长期维护成本，极不划算
- 先 A 不锁死未来：Bearer 中间件是共用的，未来升级到 OAuth 只是换颁发通道

### token 独立性（重要：回答"Web 登录过期怎么办"）

扫服务端代码确认，Session / 飞书 user_access_token / 插件 PAT **三者完全独立**：

| token 类型 | 生命周期 | 用途 | 对插件的影响 |
|---|---|---|---|
| Web session cookie | 7 天 TTL | 浏览器登录态 | 无 |
| 飞书 user_access_token | 飞书端控制（通常 2 小时） | **仅** `/api/contacts/sync` 手动同步联系人 | 无 |
| 插件 PAT | 90 天（推荐） | 插件所有 API 调用 | 独立过期，走重新颁发 |

关键事实：代码全仓扫描后，飞书 user_access_token 只在 [team-pivot-web/server/api/contacts.py:57](https://github.com/hashSTACS-Global/team-pivot-web/blob/main/server/api/contacts.py#L57) 被消费（手动同步联系人）。所有读写 thread / reply / mention 的路由都只用 `open_id`。所以 **Web 端 session 过期或飞书 token 过期，插件完全无感知**。

### 服务端需要新增（待 `team-pivot-web` 侧实现）

1. 新表：
   ```sql
   api_tokens(
     token_hash PK,        -- 存哈希，不存明文
     user_open_id,         -- 绑用户身份
     name,                 -- 用户命名，如"我的笔记本"
     created_at,
     last_used_at,
     expires_at            -- 默认 90 天
   )
   ```
2. 中间件：请求头带 `Authorization: Bearer <token>` 时查 `api_tokens` → 填充 `user_open_id`，旁路 cookie session
3. 路由：`POST/GET/DELETE /api/tokens`（创建 / 列出 / 吊销）
4. Web 设置页：新建 token（**明文只显示一次**）、列出已有 token（名称 / 最近使用 / 过期时间 / 吊销按钮）

### 插件侧规则

- token 存 `vscode.SecretStorage`，绝不落盘或写日志
- 首启无 token 时弹提示："打开 Pivot Web 设置页生成 token，粘贴到这里"（附带一个"打开 Web 设置页"按钮直接开浏览器）
- API 请求收到 401 → 清本地 token → 重新弹提示
- 到期前 7 天状态栏提示用户去续期

### 联系人同步策略

插件**永远不主动触发** `POST /api/contacts/sync`（会需要飞书 token，插件里没有）。只调 `GET /api/contacts` 读服务端缓存的联系人表。同步这件事继续只在 Web 端由用户手动触发。

## 7. 目录结构（计划）

```
vscode-team-pivot/
├── package.json              # activationEvents / contributes
├── memo.md                   # 本文档
├── README.md
├── src/                      # 扩展主进程
│   ├── extension.ts          # activate / deactivate
│   ├── git/
│   │   └── mirror.ts         # clone/pull 封装
│   ├── data/                 # TS 版解析（对照 team-pivot-web server/posts.py 等）
│   │   ├── posts.ts
│   │   ├── threads.ts
│   │   └── indexFiles.ts
│   ├── api/
│   │   └── client.ts         # fetch 封装 + Bearer 注入
│   ├── auth/
│   │   └── tokenStore.ts     # SecretStorage 读写
│   ├── views/
│   │   └── threadTree.ts     # TreeDataProvider
│   ├── webview/
│   │   └── host.ts           # Webview 创建 + postMessage 协议
│   ├── drafts/
│   │   ├── watcher.ts        # FileSystemWatcher
│   │   └── promptBuilder.ts  # 生成各种动作的提示词模板
│   └── commands/             # 每个命令一个文件
├── webview/                  # Webview bundle 源码（独立打包）
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── components/       # 复用 team-pivot-web 组件（初期 copy，后续抽包）
│   ├── vite.config.ts
│   └── tsconfig.json
├── dist/                     # 打包产物（.gitignored）
└── esbuild.config.mjs
```

## 8. MVP 范围（第一版）

**做：**
- 扩展激活 + token 输入 / 保存
- `git clone` / `pull` 本地镜像
- TreeView：thread 列表（按 `last_updated` 排序，未读红点）
- Webview：thread 详情（复用 web 的 ThreadDetailPane 风格）
- "📋 回复此贴" 按钮 → 复制提示词
- `.pivot-drafts/` FileSystemWatcher → 弹草稿卡片
- "✓ 发布" → POST reply API

**暂缓：**
- 新建 thread / 状态转移 / @mention 自动补全 UI
- 主动 LLM 集成（Chat Participant）
- 多仓库支持 / 多账号切换
- 快捷键（j/k 等）
- 离线队列（网络失败重试）
- Marketplace 发布

## 9. 与 team-pivot-web 的协议契约

本扩展依赖以下 API（详情见 [team-pivot-web/server/api/](https://github.com/hashSTACS-Global/team-pivot-web/tree/main/server/api)）：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/threads` | thread 列表 + unread_count |
| GET | `/api/threads/{key}` | thread 详情 |
| POST | `/api/threads/{key}/reply` | 发回复 |
| GET | `/api/contacts` | 联系人列表（@mention） |
| GET/POST/PATCH | `/api/drafts` | 草稿 CRUD（可选复用） |
| GET | `/api/me` | 当前用户 |

⚠️ 这些当前都用 cookie session 鉴权，MVP 开工前服务端要加 Bearer 支持。

## 10. 约束与边界

- **本地镜像绝不写入**（只 `git pull`）
- **不要主动 push 或改版本号**，等用户指示
- **不替代 Claude Code 插件的功能**：我们不做 LLM 集成、不做代码补全、不做聊天面板
- **写代码前先问方向**
- **不加无关注释**；只写非显然的 why
- **commit 风格**：`feat:` / `fix:` / `chore:` 前缀，简洁一句话

## 11. 相关资源

- 本 repo：`https://github.com/hashSTACS-Global/vscode-team-pivot`（本地：`/Users/ken/Codes/vscode-team-pivot`）
- 服务端 + Web：`https://github.com/hashSTACS-Global/team-pivot-web`（本地：`/Users/ken/Codes/team-pivot-web`）
- 数据仓库：`https://github.com/kellerman-koh/test-team-pivot.git`
- 数据仓库设计文档：`/Users/ken/Codes/teamDocs/CLAUDE.md`
- VS Code Extension API: https://code.visualstudio.com/api
- Webview API: https://code.visualstudio.com/api/extension-guides/webview

## 12. 新 session 起手式

1. 读这份 memo（§4 工作流是灵魂，§6 鉴权未决，§8 知道 MVP 边界）
2. 改代码前看对应模块现有实现
3. 写代码前确认方向（§10 第 4 条）
4. 有 API 契约疑问时，对照 `team-pivot-web/server/api/` 源码

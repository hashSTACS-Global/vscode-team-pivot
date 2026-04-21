import * as vscode from "vscode";
import * as path from "node:path";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import type { CategoryEntry, Contact, ThreadDetail } from "../api/types";
import { clearToken, getToken, setToken } from "../auth/tokenStore";
import { getThreadFromMirror } from "../data/threads";
import { DraftsManager } from "../drafts/manager";
import {
  buildNewThreadPrompt,
  buildReplyPrompt,
  buildSaveDraftPrompt,
} from "../drafts/promptBuilder";
import { GitMirror } from "../git/mirror";
import { UpdateManager } from "../update/manager";
import type { ThreadTreeProvider } from "../views/threadTree";
import type {
  DraftMentions,
  DraftSnapshot,
  ExtensionToWebview,
  SettingsSnapshot,
  WebviewToExtension,
} from "./protocol";

export class WebviewHost {
  private panel: vscode.WebviewPanel | undefined;
  private pending: { category: string; slug: string } | undefined;
  private pendingComposer: DraftSnapshot | undefined;
  private currentDetail: ThreadDetail | undefined;
  private currentDraft: DraftSnapshot | undefined;
  private preferredTab: "discussion" | "settings" = "discussion";
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ApiClient,
    private readonly drafts: DraftsManager,
    private readonly mirror: GitMirror,
    private readonly threads: ThreadTreeProvider,
    private readonly updates: UpdateManager,
  ) {
    this.disposables.push(
      drafts.onBodyChanged((draft_id, body_md) => {
        if (this.currentDraft?.id === draft_id) {
          this.currentDraft = { ...this.currentDraft, body_md };
        }
        this.post({ type: "draft-updated", draft_id, body_md });
      }),
      drafts.onPublished((draft_id) => {
        if (this.currentDraft?.id === draft_id) {
          this.currentDraft = undefined;
        }
        this.post({ type: "draft-published", draft_id });
      }),
    );
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  reveal(): void {
    this.preferredTab = this.updates.isBlocked() ? "settings" : "discussion";
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn, true);
      return;
    }
    this.panel = this.create();
  }

  showThread(category: string, slug: string): void {
    if (this.updates.isBlocked()) {
      this.showSettings();
      return;
    }
    this.preferredTab = "discussion";
    this.pending = { category, slug };
    if (!this.panel) {
      this.panel = this.create();
      return;
    }
    this.panel.reveal(this.panel.viewColumn, true);
    void this.loadPending();
  }

  private create(): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      "pivot.panel",
      "Pivot",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.context.extensionPath, "webview", "dist")),
        ],
      },
    );
    panel.webview.html = this.renderHtml(panel.webview);
    panel.webview.onDidReceiveMessage((msg: WebviewToExtension) =>
      this.onMessage(msg),
    );
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.currentDetail = undefined;
      this.currentDraft = undefined;
    });
    return panel;
  }

  private async onMessage(msg: WebviewToExtension): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.postSettings();
        if (this.preferredTab === "settings") {
          this.post({ type: "show-settings" });
        }
        if (this.pendingComposer) {
          const composerDraft = this.pendingComposer;
          this.pendingComposer = undefined;
          this.post({ type: "show-new-thread-composer", draft: composerDraft });
        } else if (this.pending) {
          await this.loadPending();
        }
        return;
      case "request-settings":
        await this.postSettings();
        return;
      case "open-settings":
        this.post({ type: "show-settings" });
        return;
      case "save-settings":
        await this.saveSettings(msg.settings);
        return;
      case "save-token":
        await this.saveToken(msg.token);
        return;
      case "clear-token":
        await clearToken(this.context);
        await this.postSettings();
        void vscode.window.showInformationMessage("Pivot: API token cleared.");
        return;
      case "pick-directory":
        await this.pickDirectory(msg.target);
        return;
      case "test-connection":
        await this.testConnection();
        return;
      case "check-updates":
        await this.checkUpdates();
        return;
      case "install-update":
        await this.installUpdate();
        return;
      case "sync-mirror":
        await this.syncMirror();
        return;
      case "load-thread":
        this.pending = { category: msg.category, slug: msg.slug };
        await this.loadPending();
        return;
      case "toggle-favorite":
        await this.toggleFavorite(msg.category, msg.slug);
        return;
      case "search-contacts":
        await this.searchContacts(msg.target_filename, msg.query);
        return;
      case "submit-mention":
        await this.submitMention(msg.category, msg.slug, msg.target_filename, msg.mentions);
        return;
      case "request-discussion-prompt":
        await this.copyDiscussionPrompt(msg.category, msg.slug, msg.reply_to ?? null);
        return;
      case "request-reply-draft":
        await this.startReplyDraft(msg.category, msg.slug, msg.reply_to ?? null, msg.references ?? []);
        return;
      case "open-draft-file":
        await this.openDraftFile(msg.draft_id);
        return;
      case "publish-draft":
        await this.publishDraft(msg.draft_id);
        return;
      case "discard-draft":
        await this.discardDraft(msg.draft_id);
        return;
      case "publish-new-thread-draft":
        await this.publishNewThreadDraft(msg.draft_id);
        return;
      case "discard-new-thread-draft":
        await this.discardNewThreadDraft(msg.draft_id);
        return;
      case "recopy-new-thread-prompt":
        await this.recopyNewThreadPrompt(msg.draft_id);
        return;
      case "update-new-thread-mentions":
        await this.updateNewThreadMentions(msg.draft_id, msg.mentions);
        return;
    }
  }

  private post(msg: ExtensionToWebview): void {
    this.panel?.webview.postMessage(msg);
  }

  showSettings(): void {
    this.preferredTab = "settings";
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn, true);
    } else {
      this.panel = this.create();
    }
    this.post({ type: "show-settings" });
    void this.postSettings();
  }

  private async loadPending(): Promise<void> {
    if (this.updates.isBlocked()) {
      this.showSettings();
      return;
    }
    if (!this.pending) return;
    const { category, slug } = this.pending;
    this.post({ type: "show-loading", category, slug });
    try {
      const repoPath = await this.mirror.getReadableRepoPath();
      const detail =
        (repoPath ? await getThreadFromMirror(repoPath, category, slug) : null) ??
        (await this.api.getThread(category, slug));
      const cachedMeta = this.threads.getThreadMeta(category, slug);
      if (cachedMeta) {
        detail.meta = {
          ...detail.meta,
          author_display: cachedMeta.author_display,
          unread_count: cachedMeta.unread_count,
          favorite: cachedMeta.favorite,
          last_updated: cachedMeta.last_updated,
          post_count: cachedMeta.post_count,
          status: cachedMeta.status,
        };
      }
      this.currentDetail = detail;
      if (this.panel) this.panel.title = detail.meta.title;
      const draft = await this.drafts.getExistingReplyDraft(detail);
      this.currentDraft = draft;
      this.post({ type: "show-detail", detail, draft });
      void this.markThreadRead(category, slug);
    } catch (e) {
      this.currentDetail = undefined;
      this.currentDraft = undefined;
      this.post({ type: "show-error", message: this.describe(e) });
    }
  }

  private async startReplyDraft(
    category: string,
    slug: string,
    replyTo: string | null,
    references: string[],
  ): Promise<void> {
    const detail = this.currentDetail;
    if (!detail || detail.meta.category !== category || detail.meta.slug !== slug) {
      void vscode.window.showWarningMessage(
        "Pivot: please open the thread before drafting a reply.",
      );
      return;
    }
    try {
      const ctx = await this.drafts.ensureReplyDraft(detail, {
        reply_to: replyTo,
        references,
      });
      this.currentDraft = ctx.draft;
      this.post({ type: "show-detail", detail, draft: ctx.draft });
      const prompt = buildSaveDraftPrompt({
        detail,
        draftPath: ctx.filePath,
        replyToFilename: replyTo,
      });
      await vscode.env.clipboard.writeText(prompt);
      void vscode.window.showInformationMessage(
        "Pivot: draft prompt copied. Paste into Claude Code (or any AI chat) and let it save the draft.",
      );
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: could not start draft — ${this.describe(e)}`,
      );
    }
  }

  private async copyDiscussionPrompt(
    category: string,
    slug: string,
    replyTo: string | null,
  ): Promise<void> {
    const detail = this.currentDetail;
    if (!detail || detail.meta.category !== category || detail.meta.slug !== slug) {
      void vscode.window.showWarningMessage(
        "Pivot: please open the thread before starting a discussion.",
      );
      return;
    }
    try {
      const mirrorPath = this.mirror.currentRepoPath();
      const targetPost =
        (replyTo ? detail.posts.find((p) => p.filename === replyTo) : undefined) ??
        detail.posts.find((p) => p.frontmatter.type === "proposal") ??
        detail.posts[0];
      const threadDirPath = mirrorPath
        ? path.join(mirrorPath, "discussions", detail.meta.category, detail.meta.slug)
        : undefined;
      const primaryPostPath =
        threadDirPath && targetPost
          ? path.join(threadDirPath, targetPost.filename)
          : undefined;
      const indexPath = mirrorPath
        ? path.join(mirrorPath, "index", `${detail.meta.slug}-discuss.index.yaml`)
        : undefined;
      const prompt = buildReplyPrompt({
        detail,
        primaryPostPath,
        threadDirPath,
        indexPath,
        replyToFilename: replyTo,
      });
      await vscode.env.clipboard.writeText(prompt);
      void vscode.window.showInformationMessage(
        "Pivot: discussion prompt copied. Paste into Claude Code (or any AI chat) to start discussing.",
      );
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: could not copy discussion prompt — ${this.describe(e)}`,
      );
    }
  }

  private async openDraftFile(draftId: string): Promise<void> {
    const filePath = this.drafts.filePathForDraftId(draftId);
    const uri = vscode.Uri.file(filePath);
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: could not open draft file — ${this.describe(e)}`,
      );
    }
  }

  private async markThreadRead(category: string, slug: string): Promise<void> {
    try {
      await this.api.markThreadRead(category, slug);
      this.threads.markRead(category, slug);
    } catch {
      // best effort; don't interrupt thread reading
    }
  }

  private async toggleFavorite(category: string, slug: string): Promise<void> {
    const detail = this.currentDetail;
    if (!detail || detail.meta.category !== category || detail.meta.slug !== slug) {
      return;
    }
    const next = !detail.meta.favorite;
    try {
      await this.threads.persistFavorite(category, slug, next);
      detail.meta = { ...detail.meta, favorite: next };
      this.currentDetail = detail;
      this.post({
        type: "show-detail",
        detail,
        draft: this.currentDraft,
      });
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: favorite update failed — ${this.describe(e)}`,
      );
    }
  }

  private async searchContacts(targetFilename: string, query: string): Promise<void> {
    const q = query.trim();
    if (!q) {
      this.post({ type: "contacts-result", target_filename: targetFilename, items: [] });
      return;
    }
    try {
      const result = await this.api.searchContacts(q, 20);
      this.post({
        type: "contacts-result",
        target_filename: targetFilename,
        items: result.items,
      });
    } catch {
      this.post({ type: "contacts-result", target_filename: targetFilename, items: [] });
    }
  }

  private async submitMention(
    category: string,
    slug: string,
    targetFilename: string,
    mentions: { open_ids: string[]; comments: string },
  ): Promise<void> {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Pivot: 正在发送提及…",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "发送到服务端…" });
          await this.api.addMention(category, slug, targetFilename, mentions);
          progress.report({ message: "刷新帖子详情…" });
          if (this.pending) await this.loadPending();
        },
      );
      this.post({ type: "mention-submitted", target_filename: targetFilename });
      void vscode.window.showInformationMessage("Pivot: mention sent.");
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: mention failed — ${this.describe(e)}`,
      );
    }
  }

  private async publishDraft(draftId: string): Promise<void> {
    if (!this.currentDetail) {
      void vscode.window.showErrorMessage("Pivot: no thread is open for publishing.");
      return;
    }
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Pivot: 正在发布回复…",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "发布到服务端…" });
          await this.drafts.publish(this.currentDetail!, draftId);
          progress.report({ message: "同步本地镜像…" });
          await this.mirror.sync().catch(() => undefined);
          if (this.pending) await this.loadPending();
          await vscode.commands.executeCommand("pivot.refresh");
        },
      );
      void vscode.window.showInformationMessage("Pivot: reply published.");
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: publish failed — ${this.describe(e)}`,
      );
    }
  }

  private async discardDraft(draftId: string): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      "确定要丢弃这个草稿吗？此操作会删除本地草稿文件。",
      { modal: true },
      "丢弃",
    );
    if (choice !== "丢弃") return;

    try {
      await this.drafts.discard(draftId);
      if (this.currentDraft?.id === draftId) {
        this.currentDraft = undefined;
      }
      if (this.currentDetail) {
        this.post({ type: "show-detail", detail: this.currentDetail, draft: undefined });
      }
      void vscode.window.showInformationMessage("Pivot: draft discarded.");
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: discard failed — ${this.describe(e)}`,
      );
    }
  }

  async onDraftDiscardedFromTree(draftId: string): Promise<void> {
    if (this.currentDraft?.id !== draftId) return;
    this.currentDraft = undefined;
    if (this.currentDetail) {
      this.post({ type: "show-detail", detail: this.currentDetail, draft: undefined });
    } else {
      this.post({ type: "show-idle" });
    }
  }

  /**
   * 从侧边栏或命令面板触发：创建新帖草稿。
   * 这里以对话形式收集 title + category，然后创建本地 md 草稿 + meta，
   * 把提示词复制到剪贴板，并打开 Webview 展示 NewThreadComposer。
   */
  async startNewThread(): Promise<void> {
    if (this.updates.isBlocked()) {
      this.showSettings();
      return;
    }
    const token = await getToken(this.context);
    if (!token) {
      const choice = await vscode.window.showWarningMessage(
        "Pivot: 需要先配置 API token 才能发新帖。",
        "Set Token",
      );
      if (choice === "Set Token") {
        await vscode.commands.executeCommand("pivot.setToken");
      }
      return;
    }

    const title = await vscode.window.showInputBox({
      title: "Pivot · 新建帖子",
      prompt: "请输入帖子标题（1–200 字符）",
      validateInput: (value) => {
        const s = value.trim();
        if (!s) return "标题不能为空";
        if (s.length > 200) return "标题最长 200 字符";
        return null;
      },
      ignoreFocusOut: true,
    });
    if (!title) return;
    const titleTrim = title.trim();

    const category = await this.pickCategory();
    if (!category) return;

    try {
      const ctx = await this.drafts.ensureNewThreadDraft({
        title: titleTrim,
        category,
      });
      this.currentDetail = undefined;
      this.currentDraft = ctx.draft;

      let contacts: Contact[] = [];
      try {
        const list = await this.api.listContacts();
        contacts = list.items;
      } catch {
        // 拉联系人失败不阻塞发帖流程
      }

      const mirrorPath = this.mirror.currentRepoPath() ?? undefined;
      const prompt = buildNewThreadPrompt({
        title: titleTrim,
        category,
        draftPath: ctx.filePath,
        contacts,
        mirrorDir: mirrorPath,
      });
      await vscode.env.clipboard.writeText(prompt);

      this.preferredTab = "discussion";
      if (!this.panel) {
        this.pendingComposer = ctx.draft;
        this.panel = this.create();
      } else {
        this.panel.reveal(this.panel.viewColumn, true);
        this.post({ type: "show-new-thread-composer", draft: ctx.draft });
      }

      void vscode.commands.executeCommand("pivot.refresh");

      void vscode.window.showInformationMessage(
        "Pivot: 新帖草稿已就绪，提示词已复制到剪贴板。把它粘贴给 Claude Code / Copilot，让它把正文写进草稿文件，完成后在右侧面板点 ✓ 发布。",
      );
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: 创建新帖草稿失败 — ${this.describe(e)}`,
      );
    }
  }

  /** 供 extension.ts 对 TreeView 上的 new-thread 草稿节点点击使用。 */
  async openNewThreadComposer(draftId: string): Promise<void> {
    try {
      const draft = await this.drafts.getNewThreadDraftById(draftId);
      if (!draft) {
        void vscode.window.showWarningMessage(
          "Pivot: 草稿不存在或已损坏。可从侧边栏右键丢弃。",
        );
        return;
      }
      this.currentDetail = undefined;
      this.currentDraft = draft;
      this.preferredTab = "discussion";
      if (!this.panel) {
        this.pendingComposer = draft;
        this.panel = this.create();
      } else {
        this.panel.reveal(this.panel.viewColumn, true);
        this.post({ type: "show-new-thread-composer", draft });
      }
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: could not open draft — ${this.describe(e)}`,
      );
    }
  }

  private async pickCategory(): Promise<string | null> {
    const CREATE_NEW = "__pivot_create_new_category__";
    let entries: CategoryEntry[] = [];
    try {
      const res = await this.api.listCategories();
      entries = [...res.items].sort((a, b) => b.post_count - a.post_count);
    } catch {
      // 降级：接口不可用时，只允许走新建路径
      entries = [];
    }

    const items: (vscode.QuickPickItem & { _value: string })[] = [
      ...entries.map((c) => ({
        label: c.name,
        description: `${c.post_count} 个帖子`,
        _value: c.name,
      })),
      {
        label: "＋ 新建分类…",
        description: "创建一个新的顶级分类",
        _value: CREATE_NEW,
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: "Pivot · 选择分类",
      placeHolder:
        entries.length > 0
          ? "从已有分类选一个，或新建一个"
          : "（未能读取分类列表）新建一个分类",
      matchOnDescription: true,
      ignoreFocusOut: true,
    });
    if (!picked) return null;
    if (picked._value !== CREATE_NEW) return picked._value;

    const name = await vscode.window.showInputBox({
      title: "Pivot · 新建分类",
      prompt: "输入分类名（1–20 字符，支持中文）",
      validateInput: (value) => {
        const s = value.trim();
        if (!s) return "必填";
        if (s.length > 20) return "最长 20 字符";
        if (/[/\\:*?"<>|\t\n\r]/.test(s)) {
          return "不能包含 / \\ : * ? \" < > | 或换行";
        }
        return null;
      },
      ignoreFocusOut: true,
    });
    if (!name) return null;
    const nameTrim = name.trim();

    const confirm = await vscode.window.showWarningMessage(
      `将创建新的顶级分类 "${nameTrim}"，确认？`,
      { modal: true },
      "确认创建",
    );
    if (confirm !== "确认创建") return null;
    return nameTrim;
  }

  private async publishNewThreadDraft(draftId: string): Promise<void> {
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Pivot: 正在发布新帖…",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "发布到服务端…" });
          const r = await this.drafts.publish(null, draftId);
          if (r.kind === "new-thread") {
            progress.report({ message: "同步本地镜像…" });
            await this.mirror.sync().catch(() => undefined);
            await vscode.commands.executeCommand("pivot.refresh");
          }
          return r;
        },
      );
      if (result.kind !== "new-thread") {
        // 防御：meta 被破坏或传错 draftId
        void vscode.window.showWarningMessage(
          "Pivot: 该草稿不是新帖草稿，无法作为新帖发布。",
        );
        return;
      }
      this.currentDraft = undefined;
      this.showThread(result.category, result.slug);
      void vscode.window.showInformationMessage(
        `Pivot: thread published at ${result.category}/${result.slug}.`,
      );
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: publish failed — ${this.describe(e)}`,
      );
    }
  }

  /**
   * 把 UI 选择的 mentions 存到新帖草稿 meta；发布时作为 createThread body 一并提交。
   * 传 null / 空 open_ids 表示清空。
   */
  private async updateNewThreadMentions(
    draftId: string,
    mentions: DraftMentions | null,
  ): Promise<void> {
    try {
      await this.drafts.updateNewThreadMentions(draftId, mentions);
      // 回发 mention-submitted 以触发 MentionComposer 关闭 + 清状态
      this.post({ type: "mention-submitted", target_filename: draftId });
      // 同时用最新 meta 重新投递 composer，让 NewThreadComposer 展示新的"已保存提及"摘要
      const fresh = await this.drafts.getNewThreadDraftById(draftId);
      if (fresh) {
        this.currentDraft = fresh;
        this.post({ type: "show-new-thread-composer", draft: fresh });
      }
      if (mentions && mentions.open_ids.length > 0) {
        void vscode.window.showInformationMessage(
          `Pivot: 已保存 ${mentions.open_ids.length} 位 @ 提及，发布时一并发送。`,
        );
      } else {
        void vscode.window.showInformationMessage("Pivot: 已清除 @ 提及。");
      }
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: 保存 @ 提及失败 — ${this.describe(e)}`,
      );
    }
  }

  private async recopyNewThreadPrompt(draftId: string): Promise<void> {
    try {
      const draft = await this.drafts.getNewThreadDraftById(draftId);
      if (!draft || draft.kind !== "new-thread" || !draft.title || !draft.category) {
        void vscode.window.showWarningMessage(
          "Pivot: 草稿不存在或已损坏，无法重新生成提示词。",
        );
        return;
      }
      let contacts: Contact[] = [];
      try {
        const list = await this.api.listContacts();
        contacts = list.items;
      } catch {
        // listContacts failure does not block copy
      }
      const prompt = buildNewThreadPrompt({
        title: draft.title,
        category: draft.category,
        draftPath: draft.file_path,
        contacts,
        mirrorDir: this.mirror.currentRepoPath() ?? undefined,
      });
      await vscode.env.clipboard.writeText(prompt);
      void vscode.window.showInformationMessage(
        "Pivot: 提示词已重新复制到剪贴板。",
      );
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: 重新复制提示词失败 — ${this.describe(e)}`,
      );
    }
  }

  private async discardNewThreadDraft(draftId: string): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      "确定要丢弃这个新帖草稿吗？此操作会删除本地草稿文件。",
      { modal: true },
      "丢弃",
    );
    if (choice !== "丢弃") return;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Pivot: 正在丢弃草稿…",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "删除本地草稿文件…" });
          await this.drafts.discard(draftId);
          if (this.currentDraft?.id === draftId) {
            this.currentDraft = undefined;
          }
          this.post({ type: "show-idle" });
          progress.report({ message: "同步本地镜像…" });
          await vscode.commands.executeCommand("pivot.refresh");
        },
      );
      void vscode.window.showInformationMessage("Pivot: draft discarded.");
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: discard failed — ${this.describe(e)}`,
      );
    }
  }

  private describe(e: unknown): string {
    if (e instanceof ApiError) return `${e.code}: ${e.message}`;
    return e instanceof Error ? e.message : String(e);
  }

  private async postSettings(): Promise<void> {
    this.post({ type: "settings-data", settings: await this.getSettingsSnapshot() });
  }

  private async getSettingsSnapshot(): Promise<SettingsSnapshot> {
    const cfg = vscode.workspace.getConfiguration("pivot");
    return {
      serverUrl: cfg.get<string>("serverUrl", "https://pivot.enclaws.ai"),
      mirrorDir: cfg.get<string>("mirrorDir", ""),
      draftsDir: cfg.get<string>("draftsDir", ""),
      autoSyncMirror: cfg.get<boolean>("autoSyncMirror", true),
      tokenConfigured: Boolean(await getToken(this.context)),
      extensionVersion: this.context.extension.packageJSON.version as string,
      update: this.updates.getSnapshot(),
    };
  }

  private async saveSettings(
    settings: Partial<Omit<SettingsSnapshot, "tokenConfigured">>,
  ): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("pivot");
    if (typeof settings.serverUrl === "string") {
      await cfg.update("serverUrl", settings.serverUrl.trim(), vscode.ConfigurationTarget.Global);
    }
    if (typeof settings.mirrorDir === "string") {
      await cfg.update("mirrorDir", settings.mirrorDir.trim(), vscode.ConfigurationTarget.Global);
    }
    if (typeof settings.draftsDir === "string") {
      await cfg.update("draftsDir", settings.draftsDir.trim(), vscode.ConfigurationTarget.Global);
    }
    if (typeof settings.autoSyncMirror === "boolean") {
      await cfg.update("autoSyncMirror", settings.autoSyncMirror, vscode.ConfigurationTarget.Global);
    }
    await this.postSettings();
    await this.checkUpdates(false);
    void vscode.window.showInformationMessage("Pivot: settings saved.");
  }

  private async saveToken(token: string): Promise<void> {
    const cleaned = token.trim();
    if (!cleaned) {
      void vscode.window.showWarningMessage("Pivot: token is empty.");
      return;
    }
    await setToken(this.context, cleaned);
    await this.postSettings();
    await this.checkUpdates(false);
    void vscode.window.showInformationMessage("Pivot: API token saved.");
  }

  private async pickDirectory(target: "mirrorDir" | "draftsDir"): Promise<void> {
    const current = target === "mirrorDir" ? this.mirror.mirrorRootDir() : this.drafts.draftsDir();
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(current),
      openLabel: "Select Directory",
    });
    const uri = picked?.[0];
    if (!uri) return;
    const cfg = vscode.workspace.getConfiguration("pivot");
    await cfg.update(target, uri.fsPath, vscode.ConfigurationTarget.Global);
    await this.postSettings();
    await vscode.commands.executeCommand("pivot.refresh");
  }

  private async testConnection(): Promise<void> {
    try {
      const mirror = await this.api.getWorkspaceMirror();
      const threads = await this.api.listThreads();
      const msg = `Connected · mirror ${mirror.repo_name}@${mirror.branch} · ${threads.items.length} threads visible`;
      this.post({ type: "test-connection-result", ok: true, message: msg });
      void vscode.window.showInformationMessage(`Pivot: ${msg}`);
    } catch (e) {
      const msg = this.describe(e);
      this.post({ type: "test-connection-result", ok: false, message: msg });
      void vscode.window.showErrorMessage(`Pivot: connection test failed — ${msg}`);
    }
  }

  private async syncMirror(): Promise<void> {
    if (this.updates.isBlocked()) {
      this.showSettings();
      return;
    }
    try {
      const repoPath = await this.mirror.sync(true);
      await this.postSettings();
      if (repoPath) {
        void vscode.window.showInformationMessage(`Pivot: local mirror synced at ${repoPath}.`);
      }
    } catch (e) {
      const msg = this.describe(e);
      void vscode.window.showErrorMessage(`Pivot: mirror sync failed — ${msg}`);
    }
  }

  private async checkUpdates(showToast: boolean = true): Promise<void> {
    try {
      const snapshot = await this.updates.refresh();
      await this.postSettings();
      if (snapshot.blocked) {
        this.showSettings();
      }
      if (showToast) {
        void vscode.window.showInformationMessage(`Pivot: ${snapshot.message}`);
      }
    } catch (e) {
      const msg = this.describe(e);
      void vscode.window.showErrorMessage(`Pivot: update check failed — ${msg}`);
    }
  }

  private async installUpdate(): Promise<void> {
    try {
      await this.updates.installLatest();
      const choice = await vscode.window.showInformationMessage(
        "Pivot: 更新已安装，是否立即重新加载 VS Code 窗口？",
        "重新加载",
      );
      if (choice === "重新加载") {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    } catch (e) {
      const msg = this.describe(e);
      void vscode.window.showErrorMessage(`Pivot: update install failed — ${msg}`);
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const distRoot = vscode.Uri.file(
      path.join(this.context.extensionPath, "webview", "dist"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distRoot, "assets", "index.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distRoot, "assets", "main.css"),
    );
    const nonce = randomNonce();
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:;" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Pivot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Buffer.from(bytes).toString("hex");
}

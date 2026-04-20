import * as vscode from "vscode";
import * as path from "node:path";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import type { ThreadDetail } from "../api/types";
import { clearToken, getToken, setToken } from "../auth/tokenStore";
import { getThreadFromMirror } from "../data/threads";
import { DraftsManager } from "../drafts/manager";
import { buildReplyPrompt, buildSaveDraftPrompt } from "../drafts/promptBuilder";
import { GitMirror } from "../git/mirror";
import { UpdateManager } from "../update/manager";
import type { ThreadTreeProvider } from "../views/threadTree";
import type {
  DraftSnapshot,
  ExtensionToWebview,
  SettingsSnapshot,
  WebviewToExtension,
} from "./protocol";

export class WebviewHost {
  private panel: vscode.WebviewPanel | undefined;
  private pending: { category: string; slug: string } | undefined;
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
        if (this.pending) await this.loadPending();
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
      await this.api.addMention(category, slug, targetFilename, mentions);
      if (this.pending) await this.loadPending();
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
      await this.drafts.publish(this.currentDetail, draftId);
      await this.mirror.sync().catch(() => undefined);
      if (this.pending) await this.loadPending();
      await vscode.commands.executeCommand("pivot.refresh");
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

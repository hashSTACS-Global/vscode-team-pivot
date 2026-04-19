import * as vscode from "vscode";
import * as path from "node:path";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import type { ThreadDetail } from "../api/types";
import { DraftsManager } from "../drafts/manager";
import { buildReplyPrompt, buildReviseReplyPrompt } from "../drafts/promptBuilder";
import type {
  DraftSnapshot,
  ExtensionToWebview,
  WebviewToExtension,
} from "./protocol";

export class WebviewHost {
  private panel: vscode.WebviewPanel | undefined;
  private pending: { category: string; slug: string } | undefined;
  private currentDetail: ThreadDetail | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ApiClient,
    private readonly drafts: DraftsManager,
  ) {
    this.disposables.push(
      drafts.onBodyChanged((draft_id, body_md) =>
        this.post({ type: "draft-updated", draft_id, body_md }),
      ),
      drafts.onPublished((draft_id) =>
        this.post({ type: "draft-published", draft_id }),
      ),
    );
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn, true);
      return;
    }
    this.panel = this.create();
  }

  showThread(category: string, slug: string): void {
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
    });
    return panel;
  }

  private async onMessage(msg: WebviewToExtension): Promise<void> {
    switch (msg.type) {
      case "ready":
        if (this.pending) await this.loadPending();
        return;
      case "load-thread":
        this.pending = { category: msg.category, slug: msg.slug };
        await this.loadPending();
        return;
      case "request-reply-draft":
        await this.startReplyDraft(msg.category, msg.slug);
        return;
      case "regenerate-draft":
        await this.copyReviseReplyPrompt(msg.draft_id, msg.instruction);
        return;
      case "publish-draft":
        await this.publishDraft(msg.draft_id);
        return;
      case "discard-draft":
        await this.drafts.discard(msg.draft_id);
        return;
    }
  }

  private post(msg: ExtensionToWebview): void {
    this.panel?.webview.postMessage(msg);
  }

  private async loadPending(): Promise<void> {
    if (!this.pending) return;
    const { category, slug } = this.pending;
    this.post({ type: "show-loading", category, slug });
    try {
      const detail = await this.api.getThread(category, slug);
      this.currentDetail = detail;
      if (this.panel) this.panel.title = detail.meta.title;
      const draft = await this.findExistingReplyDraft(detail);
      this.post({ type: "show-detail", detail, draft });
    } catch (e) {
      this.currentDetail = undefined;
      this.post({ type: "show-error", message: this.describe(e) });
    }
  }

  private async findExistingReplyDraft(
    detail: ThreadDetail,
  ): Promise<DraftSnapshot | undefined> {
    try {
      const { items } = await this.api.listDrafts();
      const key = `${detail.meta.category}/${detail.meta.slug}`;
      const match = items.find((d) => d.type === "reply" && d.thread_key === key);
      if (!match) return undefined;
      return {
        draft: match,
        body_md: match.body_md,
        file_path: this.drafts.filePathFor(match.id),
      };
    } catch {
      return undefined;
    }
  }

  private async startReplyDraft(category: string, slug: string): Promise<void> {
    const detail = this.currentDetail;
    if (!detail || detail.meta.category !== category || detail.meta.slug !== slug) {
      void vscode.window.showWarningMessage(
        "Pivot: please open the thread before drafting a reply.",
      );
      return;
    }
    try {
      const ctx = await this.drafts.ensureReplyDraft(detail);
      const prompt = buildReplyPrompt({ detail, draftPath: ctx.filePath });
      await vscode.env.clipboard.writeText(prompt);
      const snapshot: DraftSnapshot = {
        draft: ctx.draft,
        body_md: ctx.draft.body_md,
        file_path: ctx.filePath,
      };
      this.post({ type: "show-detail", detail, draft: snapshot });
      void vscode.window.showInformationMessage(
        "Pivot: reply prompt copied. Paste into Claude Code (or any AI chat) and press Enter.",
      );
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: could not start draft — ${this.describe(e)}`,
      );
    }
  }

  private async copyReviseReplyPrompt(
    draftId: string,
    instruction: string,
  ): Promise<void> {
    const filePath = this.drafts.filePathFor(draftId);
    const prompt = buildReviseReplyPrompt({
      draftPath: filePath,
      instruction: instruction.trim() || "请再润色一遍，保留原意。",
    });
    await vscode.env.clipboard.writeText(prompt);
    void vscode.window.showInformationMessage(
      "Pivot: revise prompt copied. Paste into your AI chat.",
    );
  }

  private async publishDraft(draftId: string): Promise<void> {
    try {
      await this.drafts.publish(draftId);
      if (this.pending) await this.loadPending();
      await vscode.commands.executeCommand("pivot.refresh");
      void vscode.window.showInformationMessage("Pivot: reply published.");
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Pivot: publish failed — ${this.describe(e)}`,
      );
    }
  }

  private describe(e: unknown): string {
    if (e instanceof ApiError) return `${e.code}: ${e.message}`;
    return e instanceof Error ? e.message : String(e);
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

import * as vscode from "vscode";
import * as path from "node:path";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import type { ExtensionToWebview, WebviewToExtension } from "./protocol";

export class WebviewHost {
  private panel: vscode.WebviewPanel | undefined;
  private pending: { category: string; slug: string } | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ApiClient,
  ) {}

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
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
    this.panel.reveal(vscode.ViewColumn.Beside);
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
    });
    return panel;
  }

  private async onMessage(msg: WebviewToExtension): Promise<void> {
    switch (msg.type) {
      case "ready":
        if (this.pending) void this.loadPending();
        return;
      case "load-thread":
        this.pending = { category: msg.category, slug: msg.slug };
        void this.loadPending();
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
      if (this.panel) this.panel.title = detail.meta.title;
      this.post({ type: "show-detail", detail });
    } catch (e) {
      const message =
        e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
      this.post({ type: "show-error", message });
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

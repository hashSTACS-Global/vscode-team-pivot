import * as vscode from "vscode";
import * as path from "node:path";

export class WebviewHost {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
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
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel = panel;
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;" />
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

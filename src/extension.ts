import * as vscode from "vscode";
import { ThreadTreeProvider } from "./views/threadTree";
import { WebviewHost } from "./webview/host";
import { getToken, promptForToken } from "./auth/tokenStore";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const treeProvider = new ThreadTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("pivot.threads", treeProvider),
  );

  const webviewHost = new WebviewHost(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("pivot.open", () => webviewHost.reveal()),
    vscode.commands.registerCommand("pivot.refresh", () => treeProvider.refresh()),
    vscode.commands.registerCommand("pivot.setToken", () => promptForToken(context)),
  );

  const token = await getToken(context);
  if (!token) {
    vscode.window
      .showInformationMessage(
        "Pivot: No API token found. Set one to enable write operations.",
        "Set Token",
      )
      .then((choice) => {
        if (choice === "Set Token") {
          void promptForToken(context);
        }
      });
  }
}

export function deactivate(): void {}

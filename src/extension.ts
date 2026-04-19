import * as vscode from "vscode";
import { ApiClient } from "./api/client";
import { getToken, promptForToken } from "./auth/tokenStore";
import { DraftsManager } from "./drafts/manager";
import { ThreadTreeProvider } from "./views/threadTree";
import { WebviewHost } from "./webview/host";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const api = new ApiClient(context);
  const drafts = new DraftsManager(context, api);
  await drafts.activate();

  const treeProvider = new ThreadTreeProvider(api);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("pivot.threads", treeProvider),
  );

  const webviewHost = new WebviewHost(context, api, drafts);
  context.subscriptions.push({ dispose: () => webviewHost.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand("pivot.open", () => webviewHost.reveal()),
    vscode.commands.registerCommand("pivot.refresh", () => treeProvider.refresh()),
    vscode.commands.registerCommand("pivot.setToken", async () => {
      await promptForToken(context);
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand(
      "pivot.openThread",
      (category: string, slug: string) => webviewHost.showThread(category, slug),
    ),
  );

  const token = await getToken(context);
  if (!token) {
    void vscode.window
      .showInformationMessage(
        "Pivot: No API token found. Generate one on Pivot Web Settings and paste it here.",
        "Set Token",
      )
      .then((choice) => {
        if (choice === "Set Token") {
          void promptForToken(context).then(() => treeProvider.refresh());
        }
      });
  } else {
    treeProvider.refresh();
  }
}

export function deactivate(): void {}

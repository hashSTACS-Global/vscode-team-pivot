import * as vscode from "vscode";
import { ApiClient } from "./api/client";
import { getToken, promptForToken } from "./auth/tokenStore";
import { DraftsManager } from "./drafts/manager";
import { FavoriteStore } from "./favorites/store";
import { GitMirror } from "./git/mirror";
import { UpdateManager } from "./update/manager";
import { ThreadTreeProvider } from "./views/threadTree";
import { WebviewHost } from "./webview/host";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const api = new ApiClient(context);
  const drafts = new DraftsManager(context, api);
  await drafts.activate();
  const favorites = new FavoriteStore(context);
  const mirror = new GitMirror(api);
  const updates = new UpdateManager(context);

  const treeProvider = new ThreadTreeProvider(api, mirror, favorites, drafts);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("pivot.threads", treeProvider),
  );

  const webviewHost = new WebviewHost(
    context,
    api,
    drafts,
    mirror,
    treeProvider,
    updates,
  );
  context.subscriptions.push({ dispose: () => webviewHost.dispose() });
  const shouldAutoSyncMirror = (): boolean =>
    vscode.workspace.getConfiguration("pivot").get<boolean>("autoSyncMirror", true);
  const scheduleMirrorSync = (delayMs: number): void => {
    const timer = setTimeout(() => {
      void mirror.sync().catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showWarningMessage(`Pivot: mirror sync failed: ${msg}`);
      });
    }, delayMs);
    context.subscriptions.push({ dispose: () => clearTimeout(timer) });
  };
  const applyAccessState = (): void => {
    const snapshot = updates.getSnapshot();
    treeProvider.setAccessBlocked(
      snapshot.blocked ? `插件需要升级：${snapshot.message}` : null,
    );
    if (snapshot.blocked) {
      webviewHost.showSettings();
    }
  };
  context.subscriptions.push(
    updates.onDidChange(() => {
      applyAccessState();
      if (!updates.isBlocked()) {
        treeProvider.refresh();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("pivot.open", () => webviewHost.reveal()),
    vscode.commands.registerCommand("pivot.openSettings", () => webviewHost.showSettings()),
    vscode.commands.registerCommand("pivot.refresh", async () => {
      const snapshot = await updates.refresh();
      applyAccessState();
      if (snapshot.blocked) return;
      if (!shouldAutoSyncMirror()) return;
      await mirror.sync().catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showWarningMessage(`Pivot: mirror sync failed: ${msg}`);
      });
    }),
    vscode.commands.registerCommand("pivot.setToken", async () => {
      await promptForToken(context);
      const snapshot = await updates.refresh();
      applyAccessState();
      if (snapshot.blocked) return;
      if (!shouldAutoSyncMirror()) return;
      scheduleMirrorSync(3000);
    }),
    vscode.commands.registerCommand("pivot.configureMirrorDir", async () => {
      await mirror.configureMirrorDir();
    }),
    vscode.commands.registerCommand("pivot.syncMirror", async () => {
      try {
        const repoPath = await mirror.sync(true);
        if (repoPath) {
          void vscode.window.showInformationMessage(
            `Pivot: local mirror synced at ${repoPath}.`,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Pivot: mirror sync failed — ${msg}`);
      }
    }),
    vscode.commands.registerCommand(
      "pivot.openThread",
      (category: string, slug: string) => webviewHost.showThread(category, slug),
    ),
    vscode.commands.registerCommand("pivot.discardDraftFromTree", async (node?: { data?: { draft?: { id?: string } } } | string) => {
      const draftId =
        typeof node === "string" ? node : node?.data?.draft?.id;
      if (!draftId) return;
      const choice = await vscode.window.showWarningMessage(
        "确定要丢弃这个本地草稿吗？",
        { modal: true },
        "丢弃",
      );
      if (choice !== "丢弃") return;
      await treeProvider.discardDraft(draftId);
      await webviewHost.onDraftDiscardedFromTree(draftId);
      void vscode.window.showInformationMessage("Pivot: draft discarded.");
    }),
  );

  const token = await getToken(context);
  if (!token) {
    applyAccessState();
    void vscode.window
      .showInformationMessage(
        "Pivot: No API token found. Generate one on Pivot Web Settings and paste it here.",
        "Set Token",
      )
      .then((choice) => {
        if (choice === "Set Token") {
          void promptForToken(context).then(() => {
            void updates.refresh().then((snapshot) => {
              applyAccessState();
              if (snapshot.blocked) return;
              if (!shouldAutoSyncMirror()) return;
              scheduleMirrorSync(3000);
            });
          });
        }
      });
  } else {
    const snapshot = await updates.refresh();
    applyAccessState();
    if (snapshot.blocked) return;
    if (!shouldAutoSyncMirror()) return;
    scheduleMirrorSync(3000);
  }
}

export function deactivate(): void {}

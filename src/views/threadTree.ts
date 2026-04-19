import * as vscode from "vscode";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import type { ThreadMeta } from "../api/types";

const STATUS_ICON: Record<string, string> = {
  open: "circle-outline",
  in_progress: "sync",
  blocked: "warning",
  resolved: "check",
  closed: "circle-slash",
};

export class ThreadTreeProvider implements vscode.TreeDataProvider<ThreadNode> {
  private readonly _onDidChange = new vscode.EventEmitter<ThreadNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private threads: ThreadMeta[] = [];
  private loading = false;
  private errorMessage: string | null = null;

  constructor(private readonly api: ApiClient) {}

  refresh(): void {
    void this.load();
  }

  getTreeItem(element: ThreadNode): vscode.TreeItem {
    return element.toTreeItem();
  }

  getChildren(): ThreadNode[] {
    if (this.loading) {
      return [ThreadNode.placeholder("Loading threads…")];
    }
    if (this.errorMessage) {
      return [ThreadNode.placeholder(`Error: ${this.errorMessage}`, "error")];
    }
    if (this.threads.length === 0) {
      return [ThreadNode.placeholder("No threads. Pull to refresh.")];
    }
    return this.threads
      .slice()
      .sort((a, b) => b.last_updated.localeCompare(a.last_updated))
      .map((t) => ThreadNode.forThread(t));
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.errorMessage = null;
    this._onDidChange.fire(undefined);
    try {
      const resp = await this.api.listThreads();
      this.threads = resp.items;
    } catch (e) {
      if (e instanceof ApiError) {
        this.errorMessage = e.code === "no_token" ? "Token not set" : e.message;
      } else {
        this.errorMessage = e instanceof Error ? e.message : String(e);
      }
      this.threads = [];
    } finally {
      this.loading = false;
      this._onDidChange.fire(undefined);
    }
  }
}

class ThreadNode {
  private constructor(
    private readonly label: string,
    private readonly description: string | undefined,
    private readonly tooltip: string | undefined,
    private readonly iconId: string | undefined,
    private readonly command: vscode.Command | undefined,
    private readonly contextValue: string | undefined,
  ) {}

  static placeholder(label: string, iconId: string = "info"): ThreadNode {
    return new ThreadNode(label, undefined, undefined, iconId, undefined, undefined);
  }

  static forThread(t: ThreadMeta): ThreadNode {
    const unread = t.unread_count > 0 ? ` ● ${t.unread_count}` : "";
    return new ThreadNode(
      t.title,
      `${t.category} · ${t.author_display}${unread}`,
      `${t.title}\nStatus: ${t.status}\nPosts: ${t.post_count}\nLast updated: ${t.last_updated}`,
      STATUS_ICON[t.status] ?? "comment",
      {
        command: "pivot.openThread",
        title: "Open Thread",
        arguments: [t.category, t.slug],
      },
      "thread",
    );
  }

  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.None);
    item.description = this.description;
    item.tooltip = this.tooltip;
    if (this.iconId) item.iconPath = new vscode.ThemeIcon(this.iconId);
    if (this.command) item.command = this.command;
    if (this.contextValue) item.contextValue = this.contextValue;
    return item;
  }
}

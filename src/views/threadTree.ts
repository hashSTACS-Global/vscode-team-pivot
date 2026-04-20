import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import type { ThreadMeta } from "../api/types";
import { listThreadsFromMirror } from "../data/threads";
import type { DraftsManager } from "../drafts/manager";
import type { FavoriteStore } from "../favorites/store";
import type { GitMirror } from "../git/mirror";

const STATUS_ICON: Record<string, string> = {
  open: "circle-outline",
  in_progress: "sync",
  blocked: "warning",
  resolved: "check",
  closed: "circle-slash",
};

interface LocalDraftMeta {
  id: string;
  category: string;
  slug: string;
  filePath: string;
  updatedAt: number;
}

type RootSectionKey = "favorites" | "drafts" | "discussions";

type ThreadNodeData =
  | {
      kind: "placeholder";
      label: string;
      iconId?: string;
    }
  | {
      kind: "section";
      section: RootSectionKey;
      label: string;
      count: number;
      iconId: string;
      collapsibleState: vscode.TreeItemCollapsibleState;
    }
  | {
      kind: "category";
      category: string;
      count: number;
      unread: number;
      lastUpdated: string;
    }
  | {
      kind: "thread";
      thread: ThreadMeta;
      nested?: boolean;
    }
  | {
      kind: "draft";
      draft: LocalDraftMeta;
    };

class ThreadNode {
  constructor(readonly data: ThreadNodeData) {}

  toTreeItem(): vscode.TreeItem {
    switch (this.data.kind) {
      case "placeholder": {
        const item = new vscode.TreeItem(
          this.data.label,
          vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon(this.data.iconId ?? "info");
        return item;
      }
      case "section": {
        const item = new vscode.TreeItem(this.data.label, this.data.collapsibleState);
        item.description = String(this.data.count);
        item.iconPath = new vscode.ThemeIcon(this.data.iconId);
        item.contextValue = `pivot-section-${this.data.section}`;
        return item;
      }
      case "category": {
        const item = new vscode.TreeItem(
          this.data.category,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        const unread = this.data.unread > 0 ? ` · ${this.data.unread} unread` : "";
        item.description = `${this.data.count}${unread}`;
        item.tooltip = `${this.data.category}\n${this.data.count} threads\n最近活动: ${formatRelative(
          this.data.lastUpdated,
        )}${this.data.unread > 0 ? `\n未读: ${this.data.unread}` : ""}`;
        item.iconPath = new vscode.ThemeIcon("folder-library");
        item.contextValue = "pivot-category";
        return item;
      }
      case "thread": {
        const t = this.data.thread;
        const item = new vscode.TreeItem(t.title, vscode.TreeItemCollapsibleState.None);
        const unread = t.unread_count > 0 ? ` ● ${t.unread_count}` : "";
        const favorite = t.favorite ? "★ " : "";
        item.description = `${favorite}${t.author_display} · ${t.post_count} posts · ${formatRelative(
          t.last_updated,
        )}${unread}`;
        item.tooltip = `${t.title}\n分类: ${t.category}\n作者: ${t.author_display}\n状态: ${t.status}\nPosts: ${t.post_count}\nLast updated: ${t.last_updated}`;
        item.iconPath = new vscode.ThemeIcon(STATUS_ICON[t.status] ?? "comment");
        item.command = {
          command: "pivot.openThread",
          title: "Open Thread",
          arguments: [t.category, t.slug],
        };
        item.contextValue = this.data.nested ? "pivot-thread-nested" : "pivot-thread";
        return item;
      }
      case "draft": {
        const d = this.data.draft;
        const item = new vscode.TreeItem(
          `${d.category}/${d.slug}`,
          vscode.TreeItemCollapsibleState.None,
        );
        item.description = `本地草稿 · ${formatRelative(new Date(d.updatedAt).toISOString())}`;
        item.tooltip = `${d.category}/${d.slug}\n${d.filePath}`;
        item.iconPath = new vscode.ThemeIcon("file");
        item.command = {
          command: "pivot.openThread",
          title: "Open Thread",
          arguments: [d.category, d.slug],
        };
        item.contextValue = "pivot-draft";
        return item;
      }
    }
  }
}

export class ThreadTreeProvider implements vscode.TreeDataProvider<ThreadNode> {
  private readonly _onDidChange = new vscode.EventEmitter<ThreadNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private threads: ThreadMeta[] = [];
  private drafts: LocalDraftMeta[] = [];
  private loading = false;
  private errorMessage: string | null = null;
  private accessBlockedMessage: string | null = null;

  constructor(
    private readonly api: ApiClient,
    private readonly mirror: GitMirror,
    private readonly favorites: FavoriteStore,
    private readonly draftsManager: DraftsManager,
  ) {}

  refresh(): void {
    if (this.accessBlockedMessage) {
      this.loading = false;
      this.errorMessage = null;
      this._onDidChange.fire(undefined);
      return;
    }
    void this.load();
  }

  setAccessBlocked(message: string | null): void {
    this.accessBlockedMessage = message;
    this.loading = false;
    if (message) {
      this.errorMessage = null;
      this.threads = [];
      this.drafts = [];
    }
    this._onDidChange.fire(undefined);
  }

  markRead(category: string, slug: string): void {
    const idx = this.threads.findIndex((t) => t.category === category && t.slug === slug);
    if (idx < 0 || this.threads[idx]?.unread_count === 0) return;
    this.threads[idx] = { ...this.threads[idx], unread_count: 0 };
    this._onDidChange.fire(undefined);
  }

  getThreadMeta(category: string, slug: string): ThreadMeta | undefined {
    return this.threads.find((t) => t.category === category && t.slug === slug);
  }

  setFavorite(category: string, slug: string, favorite: boolean): void {
    const idx = this.threads.findIndex((t) => t.category === category && t.slug === slug);
    if (idx < 0 || this.threads[idx]?.favorite === favorite) return;
    this.threads[idx] = { ...this.threads[idx], favorite };
    this._onDidChange.fire(undefined);
  }

  async persistFavorite(category: string, slug: string, favorite: boolean): Promise<void> {
    await this.favorites.set(`${category}/${slug}`, favorite);
    this.setFavorite(category, slug, favorite);
  }

  async discardDraft(draftId: string): Promise<void> {
    await this.draftsManager.discard(draftId);
    this.drafts = this.drafts.filter((draft) => draft.id !== draftId);
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: ThreadNode): vscode.TreeItem {
    return element.toTreeItem();
  }

  getChildren(element?: ThreadNode): Thenable<ThreadNode[]> | ThreadNode[] {
    if (!element) {
      if (this.accessBlockedMessage) {
        return [
          new ThreadNode({
            kind: "placeholder",
            label: this.accessBlockedMessage,
            iconId: "lock",
          }),
        ];
      }
      if (this.loading) {
        return [new ThreadNode({ kind: "placeholder", label: "Loading threads…", iconId: "sync" })];
      }
      if (this.errorMessage) {
        return [
          new ThreadNode({
            kind: "placeholder",
            label: `Error: ${this.errorMessage}`,
            iconId: "error",
          }),
        ];
      }
      const sections: ThreadNode[] = [];
      const favorites = this.favoriteThreads();
      if (favorites.length > 0) {
        sections.push(
          new ThreadNode({
            kind: "section",
            section: "favorites",
            label: "收藏",
            count: favorites.length,
            iconId: "star-full",
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          }),
        );
      }
      if (this.drafts.length > 0) {
        sections.push(
          new ThreadNode({
            kind: "section",
            section: "drafts",
            label: "草稿",
            count: this.drafts.length,
            iconId: "file",
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          }),
        );
      }
      sections.push(
        new ThreadNode({
          kind: "section",
          section: "discussions",
          label: "讨论",
          count: this.threads.length,
          iconId: "folder-library",
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        }),
      );
      if (sections.length === 0) {
        return [
          new ThreadNode({
            kind: "placeholder",
            label: "No threads. Pull to refresh.",
            iconId: "info",
          }),
        ];
      }
      return sections;
    }

    if (element.data.kind === "section") {
      switch (element.data.section) {
        case "favorites":
          return this.favoriteThreads().map(
            (thread) => new ThreadNode({ kind: "thread", thread }),
          );
        case "drafts":
          return this.drafts.map((draft) => new ThreadNode({ kind: "draft", draft }));
        case "discussions":
          return buildCategoryNodes(this.threads);
      }
    }

    if (element.data.kind === "category") {
      const category = element.data.category;
      return this.threads
        .filter((t) => t.category === category)
        .sort((a, b) => (b.last_updated ?? "").localeCompare(a.last_updated ?? ""))
        .map((thread) => new ThreadNode({ kind: "thread", thread, nested: true }));
    }

    return [];
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.errorMessage = null;
    this._onDidChange.fire(undefined);
    try {
      const repoPath = await this.mirror.getReadableRepoPath();
      const drafts = await listLocalDrafts();
      this.drafts = drafts;
      if (repoPath) {
        this.threads = applyFavoriteState(
          await listThreadsFromMirror(repoPath),
          this.favorites.list(),
        );
        this.loading = false;
        this._onDidChange.fire(undefined);
        void this.overlayRemoteThreadState();
        return;
      }
      const resp = await this.api.listThreads();
      this.threads = applyFavoriteState(resp.items, this.favorites.list());
    } catch (e) {
      if (e instanceof ApiError) {
        this.errorMessage = e.code === "no_token" ? "Token not set" : e.message;
      } else {
        this.errorMessage = e instanceof Error ? e.message : String(e);
      }
      this.threads = [];
      this.drafts = [];
    } finally {
      this.loading = false;
      this._onDidChange.fire(undefined);
    }
  }

  private async overlayRemoteThreadState(): Promise<void> {
    try {
      const remoteThreads = (await this.api.listThreads()).items;
      this.threads = applyFavoriteState(
        mergeThreadLists(this.threads, remoteThreads),
        this.favorites.list(),
      );
      this._onDidChange.fire(undefined);
    } catch {
      // best effort; local list is already visible
    }
  }

  private favoriteThreads(): ThreadMeta[] {
    return [...this.threads]
      .filter((t) => t.favorite)
      .sort((a, b) => (b.last_updated ?? "").localeCompare(a.last_updated ?? ""));
  }
}

function buildCategoryNodes(threads: ThreadMeta[]): ThreadNode[] {
  const grouped = new Map<string, ThreadMeta[]>();
  for (const thread of threads) {
    const arr = grouped.get(thread.category) ?? [];
    arr.push(thread);
    grouped.set(thread.category, arr);
  }
  return [...grouped.entries()]
    .map(([category, items]) => {
      items.sort((a, b) => (b.last_updated ?? "").localeCompare(a.last_updated ?? ""));
      const unread = items.reduce((sum, t) => sum + (t.unread_count || 0), 0);
      return new ThreadNode({
        kind: "category",
        category,
        count: items.length,
        unread,
        lastUpdated: items[0]?.last_updated ?? "",
      });
    })
    .sort((a, b) => {
      const aa = a.data.kind === "category" ? a.data.lastUpdated : "";
      const bb = b.data.kind === "category" ? b.data.lastUpdated : "";
      return (bb ?? "").localeCompare(aa ?? "");
    });
}

function mergeThreadLists(localThreads: ThreadMeta[], remoteThreads: ThreadMeta[]): ThreadMeta[] {
  const remoteByKey = new Map(remoteThreads.map((t) => [`${t.category}/${t.slug}`, t]));
  const merged = localThreads.map((local) => {
    const key = `${local.category}/${local.slug}`;
    const remote = remoteByKey.get(key);
    if (!remote) return local;
    remoteByKey.delete(key);
    return {
      ...local,
      author_display: remote.author_display || local.author_display,
      unread_count: remote.unread_count,
      favorite: local.favorite,
    };
  });
  merged.push(
    ...[...remoteByKey.values()].map((remote) => ({
      ...remote,
      favorite: false,
    })),
  );
  return merged;
}

function applyFavoriteState(threads: ThreadMeta[], favoriteKeys: string[]): ThreadMeta[] {
  const favorites = new Set(favoriteKeys);
  return threads.map((thread) => ({
    ...thread,
    favorite: favorites.has(`${thread.category}/${thread.slug}`),
  }));
}

async function listLocalDrafts(): Promise<LocalDraftMeta[]> {
  const root = draftsRootDir();
  const results: LocalDraftMeta[] = [];
  const categories = await safeDirents(root);
  for (const categoryDir of categories.filter((d) => d.isDirectory())) {
    const categoryPath = path.join(root, categoryDir.name);
    const files = await safeDirents(categoryPath);
    for (const file of files.filter((d) => d.isFile() && d.name.endsWith(".md"))) {
      const filePath = path.join(categoryPath, file.name);
      try {
        const stat = await fs.stat(filePath);
        results.push({
          id: `${categoryDir.name}/${file.name.replace(/\.md$/, "")}`,
          category: categoryDir.name,
          slug: file.name.replace(/\.md$/, ""),
          filePath,
          updatedAt: stat.mtimeMs,
        });
      } catch {
        // ignore broken files
      }
    }
  }
  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

function draftsRootDir(): string {
  const configured = vscode.workspace.getConfiguration("pivot").get<string>("draftsDir", "");
  return configured ? expandHome(configured) : path.join(os.homedir(), ".pivot-drafts");
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

async function safeDirents(dirPath: string) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function formatRelative(iso: string): string {
  if (!iso) return "unknown";
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return iso;
  const diffSec = Math.round((Date.now() - target) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return `${abs}s ago`;
  if (abs < 3600) return `${Math.round(abs / 60)}m ago`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ago`;
  return `${Math.round(abs / 86400)}d ago`;
}

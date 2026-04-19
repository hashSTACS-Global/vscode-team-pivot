import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import type { Draft, ThreadDetail } from "../api/types";

const PATCH_DEBOUNCE_MS = 2000;

export interface ReplyDraftContext {
  draft: Draft;
  filePath: string;
  detail: ThreadDetail;
}

type BodyListener = (draftId: string, body_md: string) => void;
type PublishListener = (draftId: string) => void;

export class DraftsManager {
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly patchTimers = new Map<string, NodeJS.Timeout>();
  private readonly fileToId = new Map<string, string>();
  private readonly bodyListeners = new Set<BodyListener>();
  private readonly publishListeners = new Set<PublishListener>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ApiClient,
  ) {}

  async activate(): Promise<void> {
    const dir = await this.ensureDir();
    const pattern = new vscode.RelativePattern(dir, "*.md");
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidChange((uri) => this.onFsChange(uri));
    this.watcher.onDidCreate((uri) => this.onFsChange(uri));
    this.context.subscriptions.push(this.watcher);
  }

  onBodyChanged(cb: BodyListener): vscode.Disposable {
    this.bodyListeners.add(cb);
    return { dispose: () => this.bodyListeners.delete(cb) };
  }

  onPublished(cb: PublishListener): vscode.Disposable {
    this.publishListeners.add(cb);
    return { dispose: () => this.publishListeners.delete(cb) };
  }

  draftsDir(): string {
    const configured = vscode.workspace
      .getConfiguration("pivot")
      .get<string>("draftsDir", "");
    return configured
      ? this.expandHome(configured)
      : path.join(os.homedir(), ".pivot-drafts");
  }

  private expandHome(p: string): string {
    if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
    return p;
  }

  private async ensureDir(): Promise<string> {
    const dir = this.draftsDir();
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async ensureReplyDraft(
    detail: ThreadDetail,
  ): Promise<ReplyDraftContext> {
    const threadKey = `${detail.meta.category}/${detail.meta.slug}`;
    const existing = await this.findExistingReply(threadKey);
    const draft = existing ?? (await this.api.createDraft({
      type: "reply",
      thread_key: threadKey,
      body_md: "",
    }));
    const filePath = this.filePathFor(draft.id);
    await fs.writeFile(filePath, draft.body_md, "utf8");
    this.fileToId.set(filePath, draft.id);
    return { draft, filePath, detail };
  }

  private async findExistingReply(threadKey: string): Promise<Draft | null> {
    try {
      const { items } = await this.api.listDrafts();
      return (
        items.find(
          (d) => d.type === "reply" && d.thread_key === threadKey,
        ) ?? null
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === "profile_setup_required") {
        throw e;
      }
      return null;
    }
  }

  filePathFor(draftId: string): string {
    return path.join(this.draftsDir(), `${draftId}.md`);
  }

  async publish(draftId: string): Promise<void> {
    await this.flushPending(draftId);
    await this.api.publishDraft(draftId);
    const filePath = this.filePathFor(draftId);
    this.fileToId.delete(filePath);
    await fs.rm(filePath, { force: true });
    for (const cb of this.publishListeners) cb(draftId);
  }

  async discard(draftId: string): Promise<void> {
    const filePath = this.filePathFor(draftId);
    this.cancelPending(draftId);
    try {
      await this.api.deleteDraft(draftId);
    } catch {
      // ignore — user can retry
    }
    this.fileToId.delete(filePath);
    await fs.rm(filePath, { force: true });
  }

  private onFsChange(uri: vscode.Uri): void {
    const filePath = uri.fsPath;
    const draftId = this.resolveDraftId(filePath);
    if (!draftId) return;
    this.schedulePatch(draftId, filePath);
  }

  private resolveDraftId(filePath: string): string | null {
    const cached = this.fileToId.get(filePath);
    if (cached) return cached;
    const base = path.basename(filePath, ".md");
    if (!base) return null;
    this.fileToId.set(filePath, base);
    return base;
  }

  private schedulePatch(draftId: string, filePath: string): void {
    this.cancelPending(draftId);
    const timer = setTimeout(() => {
      this.patchTimers.delete(draftId);
      void this.doPatch(draftId, filePath);
    }, PATCH_DEBOUNCE_MS);
    this.patchTimers.set(draftId, timer);
  }

  private cancelPending(draftId: string): void {
    const existing = this.patchTimers.get(draftId);
    if (existing) {
      clearTimeout(existing);
      this.patchTimers.delete(draftId);
    }
  }

  private async flushPending(draftId: string): Promise<void> {
    const filePath = this.filePathFor(draftId);
    this.cancelPending(draftId);
    await this.doPatch(draftId, filePath);
  }

  private async doPatch(draftId: string, filePath: string): Promise<void> {
    let body: string;
    try {
      body = await fs.readFile(filePath, "utf8");
    } catch {
      return;
    }
    try {
      await this.api.patchDraft(draftId, { body_md: body });
      for (const cb of this.bodyListeners) cb(draftId, body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showWarningMessage(`Pivot draft sync failed: ${msg}`);
    }
  }
}

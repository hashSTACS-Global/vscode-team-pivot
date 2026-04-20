import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ApiClient } from "../api/client";
import type { ThreadDetail } from "../api/types";
import type { DraftSnapshot } from "../webview/protocol";

export interface ReplyDraftContext {
  draft: DraftSnapshot;
  filePath: string;
  detail: ThreadDetail;
}

interface DraftMeta {
  reply_to?: string | null;
  references?: string[];
}

type BodyListener = (draftId: string, body_md: string) => void;
type PublishListener = (draftId: string) => void;

export class DraftsManager {
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly bodyListeners = new Set<BodyListener>();
  private readonly publishListeners = new Set<PublishListener>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ApiClient,
  ) {}

  async activate(): Promise<void> {
    const dir = await this.ensureDir();
    const pattern = new vscode.RelativePattern(dir, "**/*.md");
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidChange((uri) => void this.onFsChange(uri));
    this.watcher.onDidCreate((uri) => void this.onFsChange(uri));
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

  async getExistingReplyDraft(detail: ThreadDetail): Promise<DraftSnapshot | undefined> {
    const filePath = this.filePathForThread(detail);
    try {
      const body = await fs.readFile(filePath, "utf8");
      const meta = await this.readMetaForThread(detail);
      return {
        id: this.threadKey(detail),
        thread_key: this.threadKey(detail),
        body_md: body,
        file_path: filePath,
        reply_to: meta.reply_to ?? null,
        references: meta.references ?? [],
      };
    } catch {
      return undefined;
    }
  }

  async ensureReplyDraft(
    detail: ThreadDetail,
    opts?: { reply_to?: string | null; references?: string[] },
  ): Promise<ReplyDraftContext> {
    const existing = await this.getExistingReplyDraft(detail);
    const filePath = this.filePathForThread(detail);
    if (!existing) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "", "utf8");
    }
    const reply_to = opts?.reply_to ?? existing?.reply_to ?? null;
    const references = opts?.references ?? existing?.references ?? [];
    await this.writeMetaForThread(detail, { reply_to, references });
    const draft =
      existing ??
      {
        id: this.threadKey(detail),
        thread_key: this.threadKey(detail),
        body_md: "",
        file_path: filePath,
        reply_to,
        references,
      };
    return {
      draft: { ...draft, reply_to, references },
      filePath,
      detail,
    };
  }

  filePathForDraftId(draftId: string): string {
    const [category, slug] = draftId.split("/", 2);
    return path.join(this.draftsDir(), category, `${slug}.md`);
  }

  metaFilePathForDraftId(draftId: string): string {
    const [category, slug] = draftId.split("/", 2);
    return path.join(this.draftsDir(), category, `${slug}.pivot-meta.json`);
  }

  async publish(detail: ThreadDetail, draftId: string): Promise<void> {
    const filePath = this.filePathForDraftId(draftId);
    const body = await fs.readFile(filePath, "utf8");
    const meta = await this.readMetaForDraftId(draftId);
    await this.api.replyToThread(detail.meta.category, detail.meta.slug, {
      body,
      reply_to: meta.reply_to ?? undefined,
      references: meta.references ?? [],
    });
    await fs.rm(filePath, { force: true });
    await fs.rm(this.metaFilePathForDraftId(draftId), { force: true });
    for (const cb of this.publishListeners) cb(draftId);
  }

  async discard(draftId: string): Promise<void> {
    const filePath = this.filePathForDraftId(draftId);
    await fs.rm(filePath, { force: true });
    await fs.rm(this.metaFilePathForDraftId(draftId), { force: true });
  }

  private async onFsChange(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;
    const draftId = this.draftIdFromFilePath(filePath);
    if (!draftId) return;
    try {
      const body = await fs.readFile(filePath, "utf8");
      for (const cb of this.bodyListeners) cb(draftId, body);
    } catch {
      // file may have been removed; ignore
    }
  }

  private filePathForThread(detail: ThreadDetail): string {
    return path.join(
      this.draftsDir(),
      detail.meta.category,
      `${detail.meta.slug}.md`,
    );
  }

  private metaFilePathForThread(detail: ThreadDetail): string {
    return path.join(
      this.draftsDir(),
      detail.meta.category,
      `${detail.meta.slug}.pivot-meta.json`,
    );
  }

  private threadKey(detail: ThreadDetail): string {
    return `${detail.meta.category}/${detail.meta.slug}`;
  }

  private async readMetaForThread(detail: ThreadDetail): Promise<DraftMeta> {
    return this.readMetaForPath(this.metaFilePathForThread(detail));
  }

  private async readMetaForDraftId(draftId: string): Promise<DraftMeta> {
    return this.readMetaForPath(this.metaFilePathForDraftId(draftId));
  }

  private async readMetaForPath(filePath: string): Promise<DraftMeta> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as DraftMeta;
      return {
        reply_to: typeof parsed.reply_to === "string" ? parsed.reply_to : null,
        references: Array.isArray(parsed.references)
          ? parsed.references.filter((value): value is string => typeof value === "string")
          : [],
      };
    } catch {
      return {};
    }
  }

  private async writeMetaForThread(detail: ThreadDetail, meta: DraftMeta): Promise<void> {
    const filePath = this.metaFilePathForThread(detail);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(meta, null, 2), "utf8");
  }

  private draftIdFromFilePath(filePath: string): string | null {
    const relative = path.relative(this.draftsDir(), filePath);
    if (!relative || relative.startsWith("..")) return null;
    const parsed = path.parse(relative);
    if (!parsed.dir || !parsed.name) return null;
    return `${parsed.dir.split(path.sep).join("/")}/${parsed.name}`;
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
}

import * as vscode from "vscode";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ApiClient } from "../api/client";
import type { MentionBlock, ThreadDetail } from "../api/types";
import type { DraftSnapshot } from "../webview/protocol";

export interface ReplyDraftContext {
  draft: DraftSnapshot;
  filePath: string;
  detail: ThreadDetail;
}

export interface NewThreadDraftContext {
  draft: DraftSnapshot;
  filePath: string;
  title: string;
  category: string;
}

export type PublishResult =
  | { kind: "reply" }
  | { kind: "new-thread"; category: string; slug: string; filename: string };

type DraftMetaFile =
  | {
      kind?: "reply";
      reply_to?: string | null;
      references?: string[];
    }
  | {
      kind: "new-thread";
      title: string;
      category: string;
    };

const NEW_THREAD_DIR = "new-threads";

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

  // -------- Reply drafts --------

  async getExistingReplyDraft(detail: ThreadDetail): Promise<DraftSnapshot | undefined> {
    const filePath = this.filePathForThread(detail);
    try {
      const body = await fs.readFile(filePath, "utf8");
      const meta = await this.readMetaForThread(detail);
      if (meta.kind === "new-thread") return undefined;
      return {
        id: this.threadKey(detail),
        thread_key: this.threadKey(detail),
        body_md: body,
        file_path: filePath,
        reply_to: meta.reply_to ?? null,
        references: meta.references ?? [],
        kind: "reply",
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
    await this.writeMetaForThread(detail, {
      kind: "reply",
      reply_to,
      references,
    });
    const draft: DraftSnapshot =
      existing ??
      {
        id: this.threadKey(detail),
        thread_key: this.threadKey(detail),
        body_md: "",
        file_path: filePath,
        reply_to,
        references,
        kind: "reply",
      };
    return {
      draft: { ...draft, reply_to, references, kind: "reply" },
      filePath,
      detail,
    };
  }

  // -------- New-thread drafts --------

  /** 查找是否已存在同 (title, category) 的新帖草稿，若有则复用。 */
  async findNewThreadDraft(
    title: string,
    category: string,
  ): Promise<DraftSnapshot | undefined> {
    const root = path.join(this.draftsDir(), NEW_THREAD_DIR);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith(".pivot-meta.json")) continue;
      const metaPath = path.join(root, ent.name);
      const meta = await this.readMetaPath(metaPath);
      if (meta.kind !== "new-thread") continue;
      if (meta.title !== title || meta.category !== category) continue;
      const uuid = ent.name.replace(/\.pivot-meta\.json$/, "");
      const mdPath = path.join(root, `${uuid}.md`);
      let body = "";
      try {
        body = await fs.readFile(mdPath, "utf8");
      } catch {
        continue;
      }
      return {
        id: `${NEW_THREAD_DIR}/${uuid}`,
        thread_key: `${NEW_THREAD_DIR}/${uuid}`,
        body_md: body,
        file_path: mdPath,
        kind: "new-thread",
        title: meta.title,
        category: meta.category,
      };
    }
    return undefined;
  }

  async ensureNewThreadDraft(args: {
    title: string;
    category: string;
  }): Promise<NewThreadDraftContext> {
    const existing = await this.findNewThreadDraft(args.title, args.category);
    if (existing) {
      return {
        draft: existing,
        filePath: existing.file_path,
        title: args.title,
        category: args.category,
      };
    }
    const uuid = crypto.randomUUID();
    const rootDir = path.join(this.draftsDir(), NEW_THREAD_DIR);
    await fs.mkdir(rootDir, { recursive: true });
    const mdPath = path.join(rootDir, `${uuid}.md`);
    const metaPath = path.join(rootDir, `${uuid}.pivot-meta.json`);
    await fs.writeFile(mdPath, "", "utf8");
    await fs.writeFile(
      metaPath,
      JSON.stringify(
        { kind: "new-thread", title: args.title, category: args.category },
        null,
        2,
      ),
      "utf8",
    );
    const draft: DraftSnapshot = {
      id: `${NEW_THREAD_DIR}/${uuid}`,
      thread_key: `${NEW_THREAD_DIR}/${uuid}`,
      body_md: "",
      file_path: mdPath,
      kind: "new-thread",
      title: args.title,
      category: args.category,
    };
    return { draft, filePath: mdPath, title: args.title, category: args.category };
  }

  async getNewThreadDraftById(draftId: string): Promise<DraftSnapshot | undefined> {
    if (!draftId.startsWith(`${NEW_THREAD_DIR}/`)) return undefined;
    const meta = await this.readMetaForDraftId(draftId);
    if (meta.kind !== "new-thread") return undefined;
    const filePath = this.filePathForDraftId(draftId);
    let body = "";
    try {
      body = await fs.readFile(filePath, "utf8");
    } catch {
      return undefined;
    }
    return {
      id: draftId,
      thread_key: draftId,
      body_md: body,
      file_path: filePath,
      kind: "new-thread",
      title: meta.title,
      category: meta.category,
    };
  }

  // -------- Publish / discard --------

  filePathForDraftId(draftId: string): string {
    const [first, second] = draftId.split("/", 2);
    return path.join(this.draftsDir(), first, `${second}.md`);
  }

  metaFilePathForDraftId(draftId: string): string {
    const [first, second] = draftId.split("/", 2);
    return path.join(this.draftsDir(), first, `${second}.pivot-meta.json`);
  }

  /**
   * 发布草稿。按 meta.kind 分支调用不同 API。
   *
   * - `reply` 要求传入 detail（回帖必须知道目标 thread）
   * - `new-thread` 不需要 detail，title/category 从 meta 读
   */
  async publish(
    detail: ThreadDetail | null,
    draftId: string,
  ): Promise<PublishResult> {
    const filePath = this.filePathForDraftId(draftId);
    const raw = await fs.readFile(filePath, "utf8");
    const meta = await this.readMetaForDraftId(draftId);
    const { body, frontmatter } = splitFrontmatter(raw);
    const mentions = extractMentions(frontmatter);

    if (meta.kind === "new-thread") {
      const res = await this.api.createThread({
        category: meta.category,
        title: meta.title,
        body,
        ...(mentions ? { mentions } : {}),
      });
      await this.cleanup(draftId);
      for (const cb of this.publishListeners) cb(draftId);
      return {
        kind: "new-thread",
        category: res.category,
        slug: res.slug,
        filename: res.filename,
      };
    }

    // reply（兼容旧草稿：无 kind 字段）
    if (!detail) {
      throw new Error("reply publish requires a thread detail");
    }
    await this.api.replyToThread(detail.meta.category, detail.meta.slug, {
      body,
      reply_to: meta.reply_to ?? undefined,
      references: meta.references ?? [],
      ...(mentions ? { mentions } : {}),
    });
    await this.cleanup(draftId);
    for (const cb of this.publishListeners) cb(draftId);
    return { kind: "reply" };
  }

  async discard(draftId: string): Promise<void> {
    await this.cleanup(draftId);
  }

  private async cleanup(draftId: string): Promise<void> {
    const filePath = this.filePathForDraftId(draftId);
    await fs.rm(filePath, { force: true });
    await fs.rm(this.metaFilePathForDraftId(draftId), { force: true });
  }

  // -------- Internal --------

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

  private async readMetaForThread(detail: ThreadDetail): Promise<NormalizedMeta> {
    return this.readMetaPath(this.metaFilePathForThread(detail));
  }

  private async readMetaForDraftId(draftId: string): Promise<NormalizedMeta> {
    return this.readMetaPath(this.metaFilePathForDraftId(draftId));
  }

  private async readMetaPath(filePath: string): Promise<NormalizedMeta> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as DraftMetaFile;
      if (parsed && (parsed as { kind?: string }).kind === "new-thread") {
        const nt = parsed as Extract<DraftMetaFile, { kind: "new-thread" }>;
        if (typeof nt.title === "string" && typeof nt.category === "string") {
          return { kind: "new-thread", title: nt.title, category: nt.category };
        }
      }
      const rp = parsed as Extract<DraftMetaFile, { kind?: "reply" }>;
      return {
        kind: "reply",
        reply_to: typeof rp.reply_to === "string" ? rp.reply_to : null,
        references: Array.isArray(rp.references)
          ? rp.references.filter((v): v is string => typeof v === "string")
          : [],
      };
    } catch {
      return { kind: "reply", reply_to: null, references: [] };
    }
  }

  private async writeMetaForThread(
    detail: ThreadDetail,
    meta: DraftMetaFile,
  ): Promise<void> {
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

type NormalizedMeta =
  | { kind: "reply"; reply_to: string | null; references: string[] }
  | { kind: "new-thread"; title: string; category: string };

// ---- Frontmatter helpers (exported for unit-level usage if needed) ----

export function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown> | null; body: string } {
  // 匹配以 --- 开头，下一组 --- 结束的 YAML frontmatter；宽松接受 CRLF
  const m = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: null, body: raw };
  try {
    const fm = parseYaml(m[1]) as Record<string, unknown> | null;
    return { frontmatter: fm && typeof fm === "object" ? fm : null, body: m[2] };
  } catch {
    return { frontmatter: null, body: raw };
  }
}

export function extractMentions(
  frontmatter: Record<string, unknown> | null,
): MentionBlock | undefined {
  if (!frontmatter) return undefined;
  const raw = frontmatter["mentions"];
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const open_ids_raw = obj["open_ids"];
  const comments_raw = obj["comments"];
  const open_ids = Array.isArray(open_ids_raw)
    ? open_ids_raw.filter((v): v is string => typeof v === "string")
    : [];
  const comments = typeof comments_raw === "string" ? comments_raw : "";
  // 服务端契约：open_ids 非空时 comments 必填且非空
  if (open_ids.length === 0) return undefined;
  if (!comments.trim()) return undefined;
  return { open_ids, comments };
}

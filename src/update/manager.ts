import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { UpdateSnapshot } from "../api/types";

const RELEASE_FILE = "pivot-vscode-release.json";
const CACHE_KEY = "pivot.updateSnapshot";

interface ReleasePolicy {
  schema?: number;
  latest: string;
  minimum_supported: string;
  message: string;
  download_url: string;
  sha256?: string;
  published_at?: string;
}

export class UpdateManager {
  private snapshot: UpdateSnapshot;
  private readonly _onDidChange = new vscode.EventEmitter<UpdateSnapshot>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
  ) {
    this.snapshot =
      context.globalState.get<UpdateSnapshot>(CACHE_KEY) ?? {
        state: "unknown",
        blocked: false,
        currentVersion: this.currentVersion(),
        message: "尚未检查插件更新。",
      };
  }

  getSnapshot(): UpdateSnapshot {
    return this.snapshot;
  }

  isBlocked(): boolean {
    return this.snapshot.blocked;
  }

  async refresh(): Promise<UpdateSnapshot> {
    const currentVersion = this.currentVersion();
    this.setSnapshot({
      ...this.snapshot,
      state: "checking",
      blocked: this.snapshot.blocked,
      currentVersion,
      message: "正在检查插件更新…",
    });

    try {
      const policy = await this.fetchReleasePolicy();
      const next = this.snapshotFromPolicy(policy, currentVersion);
      await this.persist(next);
      return this.setSnapshot(next);
    } catch (e) {
      const cached = this.context.globalState.get<UpdateSnapshot>(CACHE_KEY);
      if (cached) {
        return this.setSnapshot({
          ...cached,
          currentVersion,
          message: `${cached.message}（本次检查失败，使用缓存结果）`,
        });
      }
      const msg = e instanceof Error ? e.message : String(e);
      return this.setSnapshot({
        state: "check_failed",
        blocked: false,
        currentVersion,
        message: `无法验证插件版本：${msg}`,
      });
    }
  }

  async installLatest(): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot.downloadUrl) {
      throw new Error("当前没有可用的下载地址。");
    }
    const downloadUrl = snapshot.downloadUrl;
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`下载失败：HTTP ${res.status}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (snapshot.sha256) {
      const actual = crypto.createHash("sha256").update(bytes).digest("hex");
      if (actual.toLowerCase() !== snapshot.sha256.toLowerCase()) {
        throw new Error("下载文件校验失败，sha256 不匹配。");
      }
    }

    const version = snapshot.latestVersion ?? snapshot.currentVersion;
    const filePath = path.join(os.tmpdir(), `vscode-team-pivot-${version}.vsix`);
    await fs.writeFile(filePath, bytes);

    try {
      await vscode.commands.executeCommand(
        "workbench.extensions.installExtension",
        vscode.Uri.file(filePath),
      );
    } catch (e) {
      void vscode.env.openExternal(vscode.Uri.parse(downloadUrl));
      throw new Error(
        `已为你打开下载链接；VS Code 内自动安装失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private currentVersion(): string {
    return String(this.context.extension.packageJSON.version ?? "0.0.0");
  }

  private async fetchReleasePolicy(): Promise<ReleasePolicy> {
    const repoUrl = this.repositoryUrl();
    const { owner, repo } = parseGithubRepo(repoUrl);
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(RELEASE_FILE)}`;

    const headers = new Headers({
      Accept: "application/vnd.github+json",
      "User-Agent": "vscode-team-pivot",
    });

    const res = await fetch(apiUrl, { headers });
    if (!res.ok) {
      throw new Error(`版本文件读取失败：HTTP ${res.status}`);
    }
    const body = (await res.json()) as { content?: string; encoding?: string };
    if (!body.content || body.encoding !== "base64") {
      throw new Error("版本文件格式异常。");
    }
    const raw = Buffer.from(body.content, "base64").toString("utf8");
    const parsed = JSON.parse(raw) as ReleasePolicy;
    if (!parsed.latest || !parsed.minimum_supported || !parsed.download_url) {
      throw new Error("版本文件缺少必要字段。");
    }
    return parsed;
  }

  private repositoryUrl(): string {
    const repo = this.context.extension.packageJSON.repository;
    if (repo && typeof repo === "object" && typeof repo.url === "string") {
      return repo.url;
    }
    throw new Error("插件 package.json 缺少 repository.url，无法检查更新。");
  }

  private snapshotFromPolicy(policy: ReleasePolicy, currentVersion: string): UpdateSnapshot {
    const latestCompare = compareVersions(currentVersion, policy.latest);
    const minCompare = compareVersions(currentVersion, policy.minimum_supported);
    const base = {
      currentVersion,
      latestVersion: policy.latest,
      minimumSupported: policy.minimum_supported,
      message: policy.message,
      downloadUrl: policy.download_url,
      sha256: policy.sha256,
      checkedAt: new Date().toISOString(),
    };

    if (minCompare < 0) {
      return {
        ...base,
        state: "upgrade_required",
        blocked: true,
      };
    }
    if (latestCompare < 0) {
      return {
        ...base,
        state: "update_available",
        blocked: false,
      };
    }
    return {
      ...base,
      state: "up_to_date",
      blocked: false,
      message: "当前插件已经是最新版本。",
    };
  }

  private async persist(snapshot: UpdateSnapshot): Promise<void> {
    await this.context.globalState.update(CACHE_KEY, snapshot);
  }

  private setSnapshot(snapshot: UpdateSnapshot): UpdateSnapshot {
    this.snapshot = snapshot;
    this._onDidChange.fire(snapshot);
    return snapshot;
  }
}

function parseGithubRepo(repoUrl: string): { owner: string; repo: string } {
  const url = new URL(repoUrl);
  const parts = url.pathname.replace(/^\/+/, "").replace(/\.git$/, "").split("/");
  if (parts.length < 2) {
    throw new Error(`无法从仓库地址解析 owner/repo：${repoUrl}`);
  }
  return { owner: parts[0]!, repo: parts[1]! };
}

function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a);
  const pb = normalizeVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const aa = pa[i] ?? 0;
    const bb = pb[i] ?? 0;
    if (aa > bb) return 1;
    if (aa < bb) return -1;
  }
  return 0;
}

function normalizeVersion(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split("-")[0]!
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

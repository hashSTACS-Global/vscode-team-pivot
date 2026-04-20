import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import type { WorkspaceMirrorInfo } from "../api/types";

const execFileAsync = promisify(execFile);

export class GitMirror {
  private lastInfo: WorkspaceMirrorInfo | undefined;
  private syncPromise: Promise<string | undefined> | undefined;

  constructor(
    private readonly api: ApiClient,
  ) {}

  mirrorRootDir(): string {
    const configured = vscode.workspace
      .getConfiguration("pivot")
      .get<string>("mirrorDir", "");
    return configured
      ? this.expandHome(configured)
      : path.join(os.homedir(), "pivot-mirror");
  }

  async configureMirrorDir(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(this.mirrorRootDir()),
      openLabel: "Select Mirror Directory",
    });
    const uri = picked?.[0];
    if (!uri) return;
    await vscode.workspace
      .getConfiguration("pivot")
      .update("mirrorDir", uri.fsPath, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(
      `Pivot: mirror directory set to ${uri.fsPath}`,
    );
    void this.sync(true).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showWarningMessage(`Pivot: mirror sync failed: ${msg}`);
    });
  }

  currentRepoPath(): string | undefined {
    if (!this.lastInfo) return undefined;
    return path.join(this.mirrorRootDir(), this.lastInfo.repo_name);
  }

  async getReadableRepoPath(): Promise<string | undefined> {
    const existing = this.currentRepoPath();
    if (existing && (await this.isGitRepo(existing))) {
      return existing;
    }
    const discovered = await this.findLocalRepoPath();
    if (discovered) {
      return discovered;
    }
    try {
      const info = await this.api.getWorkspaceMirror();
      this.lastInfo = info;
      const repoPath = path.join(this.mirrorRootDir(), info.repo_name);
      return (await this.isGitRepo(repoPath)) ? repoPath : undefined;
    } catch {
      return undefined;
    }
  }

  async sync(force: boolean = false): Promise<string | undefined> {
    if (!force && this.syncPromise) {
      return this.syncPromise;
    }
    const run = this.doSync().finally(() => {
      if (this.syncPromise === run) this.syncPromise = undefined;
    });
    this.syncPromise = run;
    return run;
  }

  private async doSync(): Promise<string | undefined> {
    let info: WorkspaceMirrorInfo;
    try {
      info = await this.api.getWorkspaceMirror();
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.code === "no_token" ||
          e.code === "invalid_token" ||
          e.code === "profile_setup_required")
      ) {
        return undefined;
      }
      if (e instanceof ApiError && e.code === "workspace_not_configured") {
        void vscode.window.showWarningMessage(
          "Pivot: server workspace is not configured yet. Mirror sync skipped.",
        );
        return undefined;
      }
      throw e;
    }

    this.lastInfo = info;
    const root = this.mirrorRootDir();
    const repoPath = path.join(root, info.repo_name);
    await fs.mkdir(root, { recursive: true });

    if (!(await this.isGitRepo(repoPath))) {
      await this.cloneMirror(info, repoPath);
      return repoPath;
    }

    await this.pullMirror(info, repoPath);
    return repoPath;
  }

  private async isGitRepo(repoPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(path.join(repoPath, ".git"));
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private async findLocalRepoPath(): Promise<string | undefined> {
    try {
      const dirents = await fs.readdir(this.mirrorRootDir(), { withFileTypes: true });
      for (const dirent of dirents) {
        if (!dirent.isDirectory()) continue;
        const repoPath = path.join(this.mirrorRootDir(), dirent.name);
        if (await this.isGitRepo(repoPath)) {
          return repoPath;
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async cloneMirror(info: WorkspaceMirrorInfo, repoPath: string): Promise<void> {
    await execFileAsync("git", [
      "clone",
      "--branch",
      info.branch,
      "--single-branch",
      this.authUrl(info),
      repoPath,
    ]);
  }

  private async pullMirror(info: WorkspaceMirrorInfo, repoPath: string): Promise<void> {
    await execFileAsync("git", ["remote", "set-url", "origin", this.authUrl(info)], {
      cwd: repoPath,
    });
    await execFileAsync("git", ["fetch", "origin", info.branch], { cwd: repoPath });
    await execFileAsync("git", ["checkout", info.branch], { cwd: repoPath });
    await execFileAsync("git", ["pull", "--ff-only", "origin", info.branch], {
      cwd: repoPath,
    });
  }

  private authUrl(info: WorkspaceMirrorInfo): string {
    if (!info.git_token) return info.repo_url;
    const url = new URL(info.repo_url);
    const username = info.git_username ?? "x-access-token";
    url.username = username;
    url.password = info.git_token;
    return url.toString();
  }

  private expandHome(p: string): string {
    if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
    return p;
  }
}

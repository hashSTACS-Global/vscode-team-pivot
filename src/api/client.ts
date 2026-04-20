import * as vscode from "vscode";
import { clearToken, getToken, promptForToken } from "../auth/tokenStore";
import type {
  Contact,
  ContactsResponse,
  MentionBlock,
  Me,
  ThreadDetail,
  ThreadListResponse,
  WorkspaceMirrorInfo,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiClient {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private baseUrl(): string {
    const url = vscode.workspace
      .getConfiguration("pivot")
      .get<string>("serverUrl", "https://pivot.enclaws.ai");
    return url.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken(this.context);
    if (!token) {
      await this.handleNoToken();
      throw new ApiError(401, "no_token", "No API token configured.");
    }

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}${path}`, { ...init, headers });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ApiError(0, "network_error", `Network error: ${msg}`);
    }

    if (res.ok) {
      return (await res.json()) as T;
    }

    let detail = "";
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }

    if (res.status === 401 && detail === "invalid_token") {
      await clearToken(this.context);
      await this.handleInvalidToken();
      throw new ApiError(401, "invalid_token", "Token invalid or expired.");
    }
    if (res.status === 400 && detail.toLowerCase().includes("profile setup")) {
      await this.handleProfileSetup();
      throw new ApiError(400, "profile_setup_required", detail);
    }

    throw new ApiError(res.status, detail || `http_${res.status}`, detail || res.statusText);
  }

  private async handleNoToken(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      "Pivot: No API token configured. Generate one on Pivot Web Settings and paste it here.",
      "Set Token",
    );
    if (choice === "Set Token") {
      await promptForToken(this.context);
    }
  }

  private async handleInvalidToken(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      "Pivot: API token is invalid or expired. Generate a new one and paste it here.",
      "Set Token",
    );
    if (choice === "Set Token") {
      await promptForToken(this.context);
    }
  }

  private async handleProfileSetup(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      "Pivot: Your account needs profile setup. Complete it on the Pivot Web app first.",
      "Open Pivot Web",
    );
    if (choice === "Open Pivot Web") {
      void vscode.env.openExternal(vscode.Uri.parse(this.baseUrl()));
    }
  }

  listThreads(): Promise<ThreadListResponse> {
    return this.request<ThreadListResponse>("/api/threads");
  }

  getThread(category: string, slug: string): Promise<ThreadDetail> {
    return this.request<ThreadDetail>(
      `/api/threads/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`,
    );
  }

  setThreadFavorite(
    category: string,
    slug: string,
    favorite: boolean,
  ): Promise<{ ok: true; thread_key: string; favorite: boolean }> {
    return this.request<{ ok: true; thread_key: string; favorite: boolean }>(
      `/api/threads/${encodeURIComponent(category)}/${encodeURIComponent(slug)}/favorite`,
      {
        method: "POST",
        body: JSON.stringify({ favorite }),
      },
    );
  }

  markThreadRead(category: string, slug: string): Promise<{ ok: boolean; last_read_post_filename?: string }> {
    return this.request<{ ok: boolean; last_read_post_filename?: string }>(
      `/api/threads/${encodeURIComponent(category)}/${encodeURIComponent(slug)}/read`,
      { method: "POST" },
    );
  }

  listContacts(): Promise<ContactsResponse> {
    return this.request<ContactsResponse>("/api/contacts");
  }

  searchContacts(q: string, limit: number = 20): Promise<{ items: Contact[]; total: number }> {
    const params = new URLSearchParams();
    params.set("q", q);
    params.set("limit", String(limit));
    return this.request<{ items: Contact[]; total: number }>(`/api/contacts?${params.toString()}`);
  }

  addMention(
    category: string,
    slug: string,
    targetFilename: string,
    mentions: MentionBlock,
  ): Promise<unknown> {
    return this.request(
      `/api/threads/${encodeURIComponent(category)}/${encodeURIComponent(slug)}/mentions`,
      {
        method: "POST",
        body: JSON.stringify({
          target_filename: targetFilename,
          mentions,
        }),
      },
    );
  }

  me(): Promise<Me> {
    return this.request<Me>("/api/me");
  }

  getWorkspaceMirror(): Promise<WorkspaceMirrorInfo> {
    return this.request<WorkspaceMirrorInfo>("/api/workspace/mirror");
  }

  replyToThread(
    category: string,
    slug: string,
    body: {
      body: string;
      mentions?: MentionBlock;
      reply_to?: string;
      references?: string[];
    },
  ): Promise<unknown> {
    return this.request(
      `/api/threads/${encodeURIComponent(category)}/${encodeURIComponent(slug)}/posts`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }
}

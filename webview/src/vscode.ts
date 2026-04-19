import type { WebviewToExtension } from "../../src/webview/protocol";

interface VsCodeApi {
  postMessage(msg: WebviewToExtension): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let cached: VsCodeApi | null = null;

export function vscode(): VsCodeApi {
  if (!cached) cached = acquireVsCodeApi();
  return cached;
}

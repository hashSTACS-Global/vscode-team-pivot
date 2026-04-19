import * as vscode from "vscode";

const TOKEN_KEY = "pivot.apiToken";

export async function getToken(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  return context.secrets.get(TOKEN_KEY);
}

export async function setToken(
  context: vscode.ExtensionContext,
  token: string,
): Promise<void> {
  await context.secrets.store(TOKEN_KEY, token);
}

export async function clearToken(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(TOKEN_KEY);
}

export async function promptForToken(
  context: vscode.ExtensionContext,
): Promise<void> {
  const input = await vscode.window.showInputBox({
    prompt: "Paste your Pivot API token (generate one on the Pivot Web settings page).",
    password: true,
    ignoreFocusOut: true,
  });
  if (input) {
    await setToken(context, input.trim());
    void vscode.window.showInformationMessage("Pivot: API token saved.");
  }
}

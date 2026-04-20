import * as vscode from "vscode";

const FAVORITES_KEY = "pivot.localFavorites";

export class FavoriteStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  list(): string[] {
    return this.context.globalState.get<string[]>(FAVORITES_KEY, []);
  }

  has(threadKey: string): boolean {
    return this.list().includes(threadKey);
  }

  async set(threadKey: string, favorite: boolean): Promise<void> {
    const next = new Set(this.list());
    if (favorite) next.add(threadKey);
    else next.delete(threadKey);
    await this.context.globalState.update(FAVORITES_KEY, [...next].sort());
  }
}

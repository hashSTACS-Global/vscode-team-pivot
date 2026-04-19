import * as vscode from "vscode";

export class ThreadTreeProvider implements vscode.TreeDataProvider<ThreadItem> {
  private readonly _onDidChange = new vscode.EventEmitter<ThreadItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: ThreadItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ThreadItem[] {
    return [new ThreadItem("(no threads loaded — scaffold placeholder)")];
  }
}

class ThreadItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
  }
}

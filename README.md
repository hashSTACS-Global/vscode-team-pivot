# vscode-team-pivot

VS Code extension client for [`team-pivot-web`](https://github.com/hashSTACS-Global/team-pivot-web). Browse threads, reply inline, and collaborate with AI assistants (Claude Code, Copilot, ChatGPT, etc.) without leaving the editor.

> See [memo.md](memo.md) for design and roadmap; [to-team-pivot-web.md](to-team-pivot-web.md) for the cross-project protocol requests.

## Install

### First-time install

1. Download the latest `.vsix` from the [GitHub Releases](https://github.com/hashSTACS-Global/vscode-team-pivot/releases).
2. Open VS Code.
3. Run `Extensions: Install from VSIX...` from the Command Palette.
4. Select the downloaded `vscode-team-pivot-<version>.vsix`.
5. Reload the VS Code window when prompted.

After installation:

1. Open the Pivot sidebar.
2. Go to `设置`.
3. Configure:
   - `Server URL`
   - `API Token`
   - local mirror directory
   - local drafts directory
4. Click `测试连接` and then `立即同步镜像`.

### Updates

The extension checks `pivot-vscode-release.json` from this repository at startup.

- If your installed version is still supported, Pivot works normally.
- If a newer version is available, the Settings page shows the latest version.
- If your installed version is below `minimum_supported`, Pivot enters upgrade-only mode.

In upgrade-only mode:

1. Open `设置`.
2. Click `下载并安装更新`.
3. Reload the VS Code window after installation completes.

This means users do **not** need to manually hunt for newer VSIX files after the first install; the extension can download and install the required update from the configured release URL.

## Development

```bash
npm install
cd webview && npm install && cd ..
npm run build       # builds both extension and webview bundle
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

MIT

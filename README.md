# vscode-team-pivot

VS Code extension client for [`team-pivot-web`](https://github.com/hashSTACS-Global/team-pivot-web). Browse threads, reply inline, and collaborate with AI assistants (Claude Code, Copilot, ChatGPT, etc.) without leaving the editor.

> Status: early scaffold. See [memo.md](memo.md) for design and roadmap; [to-team-pivot-web.md](to-team-pivot-web.md) for the cross-project protocol requests.

## Development

```bash
npm install
cd webview && npm install && cd ..
npm run build       # builds both extension and webview bundle
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

MIT

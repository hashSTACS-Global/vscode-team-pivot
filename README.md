# vscode-team-pivot

`team-pivot-web` 的 VS Code 客户端。你可以直接在编辑器里浏览讨论、回复帖子，并结合 Claude Code、Copilot、ChatGPT 等 AI 工具协同写作，而不必频繁切回浏览器。

更多设计背景见 [memo.md](memo.md)。如果你在看插件和服务端之间的协作协议，可以继续看 [to-team-pivot-web.md](to-team-pivot-web.md)。

## 安装说明

### 一、首次安装

1. 从 [GitHub Releases](https://github.com/hashSTACS-Global/vscode-team-pivot/releases) 下载最新的 `.vsix` 安装包。
2. 打开 VS Code。
3. 打开命令面板：
   - macOS：`Cmd + Shift + P`
   - Windows：`Ctrl + Shift + P`
4. 输入并执行：`Extensions: Install from VSIX...`
5. 选择刚下载的 `vscode-team-pivot-<version>.vsix`
6. 按提示重新加载 VS Code 窗口。

安装完成后，左侧 Activity Bar 会出现 Pivot 图标。

### 二、首次配置

打开 Pivot 后，进入 `设置` 页面，配置以下内容：

1. `Server URL`
   - 一般使用公司统一地址，例如：`https://pivot.enclaws.ai`
2. `API Token`
   - 由 Pivot Web 侧生成并提供
3. `本地镜像目录`
   - 用于保存只读的讨论仓库 mirror
4. `草稿目录`
   - 用于保存 AI 或你自己编辑的本地草稿文件

配置完成后：

1. 点击 `测试连接`
2. 点击 `立即同步镜像`

### 三、macOS 和 Windows 的目录差异

这两个目录在 macOS 和 Windows 上的默认位置不同，建议按各自系统习惯来选：

#### 1. 本地镜像目录

建议选择一个固定目录，例如：

- macOS：
  - `/Users/<你的用户名>/pivot-mirror`
  - 或 `/Users/<你的用户名>/Codes/pivot-mirror`
- Windows：
  - `C:\Users\<你的用户名>\pivot-mirror`
  - 或 `D:\Work\pivot-mirror`

#### 2. 草稿目录

建议选择一个固定目录，例如：

- macOS：
  - `/Users/<你的用户名>/.pivot-drafts`
- Windows：
  - `C:\Users\<你的用户名>\.pivot-drafts`

说明：

- 你也可以在设置页面直接点“选择目录…”，不需要手动输入路径。
- Windows 同事建议尽量使用英文路径，避免少数工具链对中文路径兼容性不好。

### 四、后续升级

插件启动时会自动检查本仓库里的版本策略文件 `pivot-vscode-release.json`。

可能出现三种情况：

1. 当前版本仍然可用
   - 插件正常工作
2. 有新版本，但当前版本仍被支持
   - 设置页会显示有更新
3. 当前版本低于最低支持版本
   - 插件会进入“仅允许升级”的模式
   - 你不能继续正常使用讨论区功能

如果进入升级模式：

1. 打开 Pivot 的 `设置`
2. 点击 `下载并安装更新`
3. 安装完成后重新加载 VS Code 窗口

也就是说：

- 第一次安装，需要你手动安装 `.vsix`
- 之后如果版本过旧，插件会自动拦住并引导你升级
- 你不需要自己再去手动寻找新的 VSIX 下载地址

### 五、常见问题

#### 1. 安装 `.vsix` 后没有看到 Pivot 图标

- 先重载 VS Code 窗口
- 再确认扩展是否已经安装成功
- 可在扩展面板里搜索 `Team Pivot`

#### 2. 点击“测试连接”失败

优先检查：

- `Server URL` 是否正确
- `API Token` 是否已经保存
- 当前网络是否能访问公司的 Pivot 服务

#### 3. 点击“立即同步镜像”失败

优先检查：

- 本地镜像目录是否有写权限
- 网络是否能访问配置好的仓库地址
- 本机是否装有 `git`

## 开发说明

```bash
npm install
cd webview && npm install && cd ..
npm run build
```

在 VS Code 里按 `F5` 可以启动一个 `Extension Development Host` 进行开发调试。

## License

MIT

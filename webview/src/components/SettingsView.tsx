import React, { useEffect, useState } from "react";
import type { SettingsSnapshot } from "../../../src/webview/protocol";

interface Props {
  settings: SettingsSnapshot | null;
  testResult: { ok: boolean; message: string } | null;
  onSave: (settings: Partial<Omit<SettingsSnapshot, "tokenConfigured">>) => void;
  onSaveToken: (token: string) => void;
  onClearToken: () => void;
  onPickDirectory: (target: "mirrorDir" | "draftsDir") => void;
  onTestConnection: () => void;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  onSyncMirror: () => void;
}

export function SettingsView({
  settings,
  testResult,
  onSave,
  onSaveToken,
  onClearToken,
  onPickDirectory,
  onTestConnection,
  onCheckUpdates,
  onInstallUpdate,
  onSyncMirror,
}: Props): JSX.Element {
  const [serverUrl, setServerUrl] = useState("");
  const [mirrorDir, setMirrorDir] = useState("");
  const [draftsDir, setDraftsDir] = useState("");
  const [autoSyncMirror, setAutoSyncMirror] = useState(true);
  const [token, setToken] = useState("");

  useEffect(() => {
    if (!settings) return;
    setServerUrl(settings.serverUrl);
    setMirrorDir(settings.mirrorDir);
    setDraftsDir(settings.draftsDir);
    setAutoSyncMirror(settings.autoSyncMirror);
  }, [settings]);

  const canTestConnection = Boolean(serverUrl.trim()) && Boolean(settings?.tokenConfigured);

  if (!settings) {
    return (
      <div className="settings-view">
        <section className="settings-section">
          <h2>正在加载设置…</h2>
        </section>
      </div>
    );
  }

  return (
    <div className="settings-view">
      <section className="settings-section">
        <h2>插件升级</h2>
        <div className={`test-result ${settings.update.blocked ? "bad" : "ok"}`}>
          当前版本 {settings.extensionVersion}
          {settings.update.latestVersion ? ` · 最新版本 ${settings.update.latestVersion}` : ""}
          {settings.update.minimumSupported
            ? ` · 最低支持 ${settings.update.minimumSupported}`
            : ""}
        </div>
        <p className="muted settings-upgrade-note">{settings.update.message}</p>
        <div className="settings-row">
          <button type="button" onClick={onCheckUpdates}>
            重新检查版本
          </button>
          <button
            type="button"
            className="primary"
            onClick={onInstallUpdate}
            disabled={!settings.update.downloadUrl}
          >
            下载并安装更新
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>连接设置</h2>
        <label className="settings-field">
          <span>服务器 URL</span>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://pivot.enclaws.ai"
          />
        </label>
        <div className="settings-row">
          <button
            type="button"
            className="primary"
            onClick={() => onSave({ serverUrl })}
          >
            保存服务器地址
          </button>
          <button
            type="button"
            className={canTestConnection ? "primary ready-button" : "danger pending-button"}
            onClick={onTestConnection}
            disabled={!canTestConnection || settings.update.blocked}
            title={
              canTestConnection
                ? "使用当前服务器地址和 Token 测试连接"
                : "请先配置服务器 URL 和 API Token"
            }
          >
            {canTestConnection ? "测试连接" : "请先配置 URL 和 Token"}
          </button>
        </div>
        <label className="settings-field">
          <span>API Token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              settings?.tokenConfigured ? "已保存 Token；重新输入可覆盖" : "粘贴 Pivot PAT"
            }
          />
        </label>
        <div className="settings-row">
          <button
            type="button"
            className="primary"
            onClick={() => {
              onSaveToken(token);
              setToken("");
            }}
          >
            保存 Token
          </button>
          <button type="button" className="danger" onClick={onClearToken}>
            清除 Token
          </button>
          <span className="muted settings-status">
            {settings?.tokenConfigured ? "Token 已保存" : "尚未保存 Token"}
          </span>
        </div>
        {testResult && (
          <div className={`test-result ${testResult.ok ? "ok" : "bad"}`}>
            {testResult.message}
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>本地文件</h2>
        <label className="settings-field">
          <span>本地镜像目录</span>
          <input
            type="text"
            value={mirrorDir}
            onChange={(e) => setMirrorDir(e.target.value)}
            placeholder="留空则默认使用 ~/pivot-mirror"
          />
        </label>
        <div className="settings-row">
          <button type="button" onClick={() => onPickDirectory("mirrorDir")}>
            选择目录…
          </button>
          <button type="button" className="primary" onClick={() => onSave({ mirrorDir })}>
            保存镜像目录
          </button>
          <button type="button" onClick={onSyncMirror}>
            立即同步镜像
          </button>
        </div>

        <label className="settings-field">
          <span>草稿目录</span>
          <input
            type="text"
            value={draftsDir}
            onChange={(e) => setDraftsDir(e.target.value)}
            placeholder="留空则默认使用 ~/.pivot-drafts"
          />
        </label>
        <div className="settings-row">
          <button type="button" onClick={() => onPickDirectory("draftsDir")}>
            选择目录…
          </button>
          <button type="button" className="primary" onClick={() => onSave({ draftsDir })}>
            保存草稿目录
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>同步</h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={autoSyncMirror}
            onChange={(e) => setAutoSyncMirror(e.target.checked)}
          />
          <span>启动和关键操作后自动同步本地镜像</span>
        </label>
        <div className="settings-row">
          <button
            type="button"
            className="primary"
            onClick={() => onSave({ autoSyncMirror })}
          >
            保存同步设置
          </button>
        </div>
      </section>
    </div>
  );
}

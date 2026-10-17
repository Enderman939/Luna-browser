# Apple Silicon 版

在 1.1.0、Electron 44.7.2 基础上增加 macOS arm64 应用，面向 M 系列 Mac。使用 GitHub Actions 的 macOS 15 arm64 环境构建、签名与验证，交付含完整 `luna.app` 的 ZIP 和可拖入 Applications 的 DMG。

- Windows 与 macOS 复用浏览、扩展、下载、收藏、搜索、弹窗和密码库逻辑。下载历史与资料导入适配 POSIX 本地路径，仍拒绝远程路径、目录／文件链接删除；macOS 从当前用户的 Application Support 发现 Chromium 和 Firefox 配置。
- 密码库使用 Electron safeStorage 对接 macOS 钥匙串；其他浏览器的密码通过用户选择并确认的 CSV 导入，不调用 Windows DPAPI 程序。IE 仅在 Windows 提供，Mac 菜单隐藏此入口。
- 原生 macOS 窗口按钮、应用／编辑／窗口菜单、Command 快捷键、关闭最后窗口后保留应用、Dock 重开、确认退出和系统 HTTP/HTTPS 链接投递。默认浏览器由系统接口请求用户选择。
- 构建保留 Electron 的最低系统版本和 ASAR 完整性校验，用本地 ad-hoc 签名保证 Apple Silicon 可执行。当前没有 Developer ID 与 Apple 公证凭据，产物明确标记未公证；首次运行按 macOS 隐私与安全性中的“仍要打开”确认。
- macOS 验证包含单元测试、真实 arm64 成品启动、Command 操作、钥匙串加密、Dock／退出／外部链接、资料导入、搜索、下载删除、扩展与分段下载、无痕隔离，以及 ZIP 解压后的符号链接、可执行权限、代码签名和校验值。Windows 上验证共用代码回归。

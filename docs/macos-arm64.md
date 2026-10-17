# macOS Apple Silicon 版

Luna 1.1.0，Electron 44.7.2，原生 arm64，面向 M1 及后续 M 系列芯片。运行不需要 Node.js 或 Rosetta。

## 安装与启动

从 [1.1.0 Release](https://github.com/Enderman939/Luna-browser/releases/tag/v1.1.0) 下载 `luna-1.1.0-darwin-arm64.dmg`，打开并将 `luna.app` 拖入 **Applications／应用程序**。也可使用 `luna-1.1.0-darwin-arm64.zip`。更新前退出 Luna，再替换应用程序中的整个 `.app`；浏览资料保存在 `~/Library/Application Support/luna`。

当前使用 ad-hoc 本地签名，尚无 Apple Developer ID 签名和公证。首次打开若被系统拦截，在 **系统设置 → 隐私与安全性 → 仍要打开** 中确认。应用内的网站授权与 macOS 的摄像头、麦克风等系统授权分别生效。

`SHA256SUMS-macos-arm64.txt` 同时列出 DMG 与 ZIP 的校验值；在下载目录运行 `shasum -a 256 -c SHA256SUMS-macos-arm64.txt` 可核对两份文件。

## 平台行为

- 使用原生红黄绿窗口按钮和 macOS 应用／编辑／窗口菜单。关闭最后一个窗口后应用保留，点击 Dock 图标重新打开；Command+Q 退出，多标签和未完成下载仍会先确认。
- 常用快捷键使用 Command，例如 Command+L、Command+T、Command+W、Command+F。历史为 Command+Y，Command+H 保留系统隐藏应用行为。Command+, 打开设置，Command+[／Command+] 后退／前进。
- 保留多标签、分屏、收藏、历史、扩展、搜索建议、网页工具、分段下载和无痕会话。IE／Trident 是 Windows 专用功能，Mac 菜单不显示此入口。
- 自动发现当前用户 Application Support 下的 Edge、Chrome、Brave、Vivaldi 和 Firefox 配置，导入收藏、历史与下载记录。其他浏览器的密码请在来源浏览器导出 CSV 后选择导入，Luna 密码库通过当前 macOS 账号的钥匙串加密。
- 设为默认浏览器通过 macOS 系统接口发起，仍需用户确认；先将应用放入 Applications。系统传入的 HTTP／HTTPS 链接交给普通窗口。

## 构建与验证

在 Apple Silicon Mac 上运行：

```sh
npm ci
npm test
npm run build:mac
export LUNA_EXECUTABLE="$PWD/dist/release/luna-darwin-arm64/luna.app/Contents/MacOS/luna"
node tests/macos-smoke.js
node tests/import-search-smoke.js
node tests/features-smoke.js
node tests/private-security-smoke.js
node scripts/verify-macos-package.mjs
```

GitHub Actions 的 **Build macOS arm64** 提供同样的原生构建与验证流程。输出位于 `dist/release`，测试记录保存在 `artifacts`；最低系统版本继承所用 Electron 运行包的声明。构建在 macOS 上完成 ASAR 完整性摘要和本地签名，使用 `ditto` 保存框架符号链接与可执行权限；校验时重新解压 ZIP 检查 arm64 Mach-O、签名、权限、框架链接、应用归档、许可证和哈希。

Mac 版源码使用 [v1.1.0-macos-arm64 标签](https://github.com/Enderman939/Luna-browser/tree/v1.1.0-macos-arm64)，Windows 1.1.0 原标签保留。所有源码和第三方许可同样遵循仓库中的 GPL-3.0-only 与 `THIRD_PARTY_NOTICES.md`。

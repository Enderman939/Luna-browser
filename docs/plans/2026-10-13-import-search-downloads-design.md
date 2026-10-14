# 本地体验版：浏览器导入、搜索建议和下载删除

最初范围为只修改、测试并构建本地体验版，等待用户体验认可后另行发布。2026-10-14 用户已授权将 Electron 升级至 44.7.2，以 1.1.0 正式版提交、推送并发布 GitHub Release；下文保留 Beta 阶段的设计与交付记录。

- 自动发现当前 Windows 用户的 Edge、Chrome、Brave、Vivaldi 和 Firefox 配置。首次使用提供可跳过的入口，设置中可随时导入。用户选择配置和数据类型后确认读取；来源只读，不更改其数据。收藏保留文件夹，历史与下载去重并保留时间，重复导入不覆盖已有密码。逐项反馈成功、跳过和读取失败。
- SQLite 由 Worker 在只读事务中读取，忙碌／锁定时提示关闭来源浏览器后重试。密码经本用户 DPAPI 或 v10/v11 AES-GCM 解密后直接进入 Luna 加密密码库，明文不写临时文件、不进入界面或日志。应用绑定 v20 与 Firefox NSS 密码明确提示 CSV 导入，不绕过加密。
- 下载记录持久保存；支持移除记录、取消并移除未完成任务，以及确认后将实际文件移入回收站。删除按实际记录定位，拒绝目录／文件链接并在确认后复核文件身份。导入下载记录不自动重试或启动任务。
- 地址栏关键词候选先显示当前搜索，再显示当前搜索引擎的在线建议，随后本地历史／收藏／标签；明确网址优先直达。提供候选筛选、匹配词加粗、键盘和鼠标选择。搜索建议独立无 Cookie 会话、可关闭、无痕不联网；请求有防抖、超时、大小限制、过期响应取消和网络失败回退。
- 用合成浏览器 SQLite／收藏配置、Windows 加密凭据、本机下载与受控建议响应验证合并、重复导入、锁定错误、删除／保留文件、建议优先级和异步竞态。所有自动验证使用临时配置，不导入生产密码或历史。

## 本地交付与验证

后续 dist 整理已将最终体验版移动至 `dist/beta`，正式版位于 `dist/release`，本次更新为 1.1.0。下面的 preview 路径是首次交付记录；当前 `start.cmd` 默认启动正式版，`start.cmd beta` 选择保留的体验版。

体验版本 1.1.0-beta.1。最终更新目录为 `dist/preview-update/luna-win32-x64`，ZIP 为 `dist/preview-update/luna-1.1.0-beta.1-win32-x64.zip`；`start.cmd` 优先此目录。首次构建的 `dist/preview` 已正常启动供用户体验，最终更新可在关闭当前窗口后启动。全部改动保持本地，Git HEAD 仍是公开 1.0.0 的提交。

71 项单元测试通过，包含锁定 SQLite 的逐项错误、Firefox places 与新版 downloads.json、来源文件保持不变、重复导入及取消下载清理。最终打包后通过 import-search、essentials、private-security、modal-background、context-menu、features 和 ie-visibility 回归，ZIP CRC、应用归档、原生解密辅助程序和许可检查通过；ZIP 约 142.34 MiB。真实百度和 Bing 建议接口返回非空结果，Google／DuckDuckGo 在本机连接下使用网络失败回退。

验证发现并修复 Chromium 微秒时间戳超过 JavaScript 安全整数范围的问题；在线候选异步增加后，浮层按列表内容高度扩展，避免被旧窗口尺寸截断。移除导入的未完成历史记录不启动任务，关闭窗口也不会把此类历史记录算作正在下载。

记录：`artifacts/preview-validation.json`、`artifacts/import-search-result.json`。界面：`artifacts/browser-import-preview.png`、`artifacts/search-candidates-preview.png`。

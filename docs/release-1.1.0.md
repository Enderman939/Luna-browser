# Luna Browser 1.1.0

Electron 内核升级到 **44.7.2**，此前本地 Beta 的资料导入、搜索候选和下载删除功能进入正式版。提供 Windows x64 免安装包。

## 下载与更新

1. 下载 `luna-1.1.0-win32-x64.zip`。
2. 关闭正在运行的 Luna，将整个压缩包解压到新的程序目录。
3. 双击 `luna-win32-x64/luna.exe`。本机已有的 `%APPDATA%/luna` 浏览资料会继续使用。

需要 Windows 10 或以上的 x64 系统，运行时不需要 Node.js。请保留解压目录里的全部运行文件；`SHA256SUMS.txt` 提供 ZIP 的 SHA-256 校验值。

## 更新内容

- **内核**：Electron 从 44.7.0 升级到 44.7.2。
- **导入浏览资料**：自动发现 Edge、Chrome、Brave、Vivaldi 和 Firefox 的默认配置，可选择收藏、历史、下载记录和密码，确认后导入。保留收藏文件夹，跳过重复记录，只读访问来源资料；新标签页首次提示和设置页均提供入口。
- **密码迁移**：支持当前 Windows 用户可解密的旧 DPAPI 和 Chromium v10/v11 AES-GCM 密码，导入后重新加密保存。应用绑定 v20 密码及 Firefox NSS 密码需在原浏览器导出 CSV 后导入，界面会说明不能直接读取的记录。
- **搜索候选**：关键词优先显示当前搜索，再显示所选引擎的在线建议和本地记录；支持匹配加粗、键盘选择及历史／收藏／标签筛选。在线建议可关闭，无痕不请求在线建议、不读取普通历史；网络不可用时保留本地候选。
- **下载管理**：支持移除记录并保留文件；删除已完成文件需确认实际路径，随后移入 Windows 回收站。已结束的 Chromium 下载记录和导入历史可在下次启动继续查看。
- **本地构建**：正式版与 Beta 分别输出到 `dist/release` 和 `dist/beta`，生成 ZIP 与校验文件；新 ZIP 校验成功后清理同目录旧包。`start.cmd` 默认启动正式版，`start.cmd beta` 选择本地体验版。

## 适用范围

来源浏览器正在使用或数据库锁定时，导入会提示关闭来源浏览器后重试。密码 CSV 含明文，请妥善处理。IE 模式依赖 Windows 的 IE / Trident 组件；部分扩展和网站的兼容性取决于内核与系统环境。浏览器自身自动更新与跨设备同步尚未接入。

详细操作见 [README](https://github.com/Enderman939/Luna-browser/blob/v1.1.0/README.md)。项目采用 GPL-3.0-only；对应源码、依赖锁定与构建脚本位于 [v1.1.0 标签](https://github.com/Enderman939/Luna-browser/tree/v1.1.0)，第三方许可见 `THIRD_PARTY_NOTICES.md`。

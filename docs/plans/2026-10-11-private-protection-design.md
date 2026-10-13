# 2.2.0 无痕扩展授权与隐私保护

用户要求扩展可按需进入无痕，并让无痕自动拦截广告和追踪。默认不授予任何扩展无痕访问权；普通管理页逐项确认授权，授权配置持久保存，不记录无痕网址。

## 会话与权限边界

Electron 44 明确不支持向非持久会话加载原生扩展，因此默认仍使用不持久、禁用磁盘缓存的网站会话。若有已启用且明确授权的扩展，新一轮无痕使用 session.fromPath 创建独立随机临时路径。普通 Cookie、网站数据和扩展 storage 不迁移。首次开启授权不升级现有纯内存会话；新一轮无痕生效。后续临时会话授权可同步，撤销即时卸载，网页中已经执行的脚本需刷新才能移除。

无痕具有独立 ExtensionManager/bridge 与标签注册表。共享 IPC delegate 按真实 Session 分派安全验证，防止创建第二个扩展实例后错误地使用普通 Session 校验；帧和后台 Worker 的扩展 ID、来源、权限、host 仍必须匹配。远程 browserAction 仅信任本会话所属 UI。扩展的 tabs/windows/cookies 只能看到自身会话；新标签与窗口创建保持无痕。声明 not_allowed 的扩展不能授权。无痕不允许管理/安装扩展，不覆盖默认新标签页。

关窗清空网站数据，卸载扩展、关闭连接并移除目录。Windows 中仍被 Chromium 占用的数据库文件不能强行删除：windowless 原生清理程序等待 luna PID 退出，再只删除该 PID 命名的目录。下次启动检查旧 PID 是否仍存活后补清残留。没有整体清理用户数据，也不关闭其他进程。

## 请求保护

随包维护的广告/追踪域名通过完整 hostname 和子域边界匹配。CDP Fetch 在请求发出前取消，避免 session.webRequest 处理器破坏扩展的原生 webRequest；附加 Worker/iframe 目标在启动前安装拦截。初始化先加载空白页，待保护完成后再加载目标网址，避免首次页面请求绕过，也避免空 WebContents 的 Network.enable 等待导致死锁。

DNT:1、Sec-GPC:1 请求头、Network.setCookieControls 第三方 Cookie 限制、disable_non_proxied_udp WebRTC policy 在无痕启用。工具栏显示真实取消计数，可暂停当前标签的域名拦截，其他隐私边界保留。只保存内存计数，不写网址/请求拦截日志。开发者工具断开 CDP 时显示暂停，关闭后恢复并刷新。

此内置规则覆盖已知网络域名，无法承诺屏蔽所有广告、第一方追踪或浏览器指纹，也不是完整 EasyList 引擎。数据源由项目维护，当前不联网更新。网站/网络方仍可观察访问，获准扩展也可向外发送其有权读取的内容。

## 验证

private-security-smoke 使用 127.0.0.1 HTTP 服务器与测试进程限定的 host-resolver-rules，广告/追踪域名只解析至本机，不访问公网。确认普通会话请求正常、无痕拦截请求不达服务器、Worker 和跨域 iframe 拦截、安全脚本继续运行、DNT/GPC 请求头、暂停/恢复、许可取消/确认、原生内容脚本/后台/弹窗、Cookie/storage/tabs/windows 隔离、撤销、关闭重建、正常数据保留和原生退出清理。另跑 59 单测、workspace 及扩展安全回归。

## 交付验证

- 59 单元测试通过；源码 workspace（多窗口、分屏、分组、无痕生命周期）及 security（扩展越权/来源隔离）通过。
- 2.2.0 压缩成品 private-security 测试通过，包含多个无痕窗口共享独立扩展会话、关闭其中一个保留另一个、私有 URL 不进入持久历史/恢复、实际原生退出清理、临时目录重建、调试连接状态和保护恢复。
- 同一成品 features、context-menu、默认 GPU 的 ie-visibility 回归通过；ZIP CRC、原生宿主/清理程序/运行时资源、许可和 ASAR 一致性检查通过。
- 成品逻辑大小 322.92 MiB；NTFS LZX 后实际存储 137.68 MiB；ZIP 142.29 MiB。交付路径 dist/compact/luna-win32-x64，统计在 artifacts/package-size-result.json。
- artifacts/extension-incognito-settings.png 为真实授权界面；private-security-result.json 记录成品验证。测试网站及账号均为本机合成数据，未修改生产扩展授权或浏览数据。

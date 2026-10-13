# IE 兼容模式

用户要求当前网页使用 IE 加载，并让 Cookie 等网站数据互通。

## 决策

采用独立的 Windows WinForms WebBrowser / Trident 宿主进程，通过 HWND 子窗口嵌入当前标签的网页区域。用户系统为 Windows 10 19045，保留了 ieframe.dll、mshtml.dll 和 .NET Framework 编译器。Electron 的 Chromium 不包含 IE 内核；仅修改 User-Agent 不能实现兼容性。外部启动 Edge IE 模式依赖系统企业策略且不能直接控制当前标签或保证 Cookie 同步，因此不采用。

原生宿主源码在项目内，构建为 x86 小型 exe，支持常见 32 位旧控件；正式打包为独立 resources 文件。按宿主 exe 名设置 HKCU FEATURE_BROWSER_EMULATION=11001，不修改系统默认浏览器或其他应用的仿真设置。控制消息使用父子进程 stdin/stdout，网站没有 ObjectForScripting 或 Node/IPC 接口。父窗口消失或管道关闭时宿主退出，异常转换为浏览器状态。

## 数据与边界

使用 InternetGetCookieEx2 / InternetSetCookieEx2 同步实际导航域匹配的 Cookie，保留名称、值、domain、path、Secure、HttpOnly、host-only、SameSite 和有效期。网页导航前同步 Chromium Cookie，IE 修改与删除通过轮询回写 Chromium；Chromium Cookie 变更也推送至已经使用该域的 IE 标签。同步只在主进程与宿主间进行，UI 状态不含 Cookie 值。WebBrowser 使用 Windows IE 网站存储；无痕窗口不开放该模式。

localStorage 与 sessionStorage 按实际协议、主机、端口同步，在模式切换时导入并重载一次，让依赖存储的启动脚本读取新数据。拒绝不同 origin、无效键值和超过容量的数据。IndexedDB、Service Worker、浏览器缓存和已加载页面的 JS 内存状态无法在两个引擎间直接共享，明确记录此限制。

兼容模式沿用标签、地址栏、后退、前进、刷新、停止、缩放和关闭；菜单显示当前模式，提供退出入口。原生子窗口跟随标签可见性、分屏 bounds、窗口缩放和浏览器内弹窗遮挡。IE 模式中的 Chromium 扩展、密码自动填充和开发者工具不可用。恢复仅记录标签的模式和网页地址，Cookie 继续由网站 session 保存。

## 验证

本地页面同时检测 document.documentMode 和 Trident User-Agent，验证真实 IE 内核、原生子窗口布局、普通/IE 双向 Cookie 登录、HttpOnly、同名不同 path、删除、localStorage/sessionStorage 双向切换、同源与跨源界限、POST 导航、刷新与关闭、无痕拒绝、数据清理和会话恢复。测试使用临时 luna profile、唯一 Cookie 名和本机地址，结束后清理测试产生的 IE Cookie。

Windows 的 Cookie 查询对目录路径采用目录边界，因此范围查询使用 `/auth/` 这样的子路径，同时保留真实 Cookie 的 `Path=/auth`。地址栏导航先导出 IE 最新状态，避免旧 Chromium Cookie 覆盖刚收到的 IE 登录更新。IE 的 BeforeNavigate2 表单字节数组包含结尾 NUL，重新 Navigate2 时仅对表单编码去掉该终止符，保留真正的 POST 表单字段。

Cookie 范围账本仅保存名称和范围属性，不保存值；只对 luna 已经同步过的 Cookie 处理删除。进入站点前记录其他 IE 应用已有 Cookie 的基线，未变化的其他 Cookie 不写入 luna。不会整体清空 Windows IE Cookie。清理网站数据时停止轮询回写，等待删除写入 IE，并按相同时间范围清理当前 IE 文档的存储。

源码验证已通过：58 项单元测试、真实 IE 集成（包含 Secure、HttpOnly、SameSite Strict/Lax、有效期、POST 正文、退出登录、两侧网站存储及模式恢复），原有 browser-menu、privacy 和 security 回归。独立截图 `artifacts/ie-compatibility-page.png` 显示实际 IE11 页面与已迁移的测试网站数据。

正式成品 2.1.0 构建完成，`resources/luna-ie-host.exe` 随包部署。以 `LUNA_EXECUTABLE=dist/luna-win32-x64/luna.exe` 运行 IE 集成全部通过，额外验证混合 IE/Chromium 分屏尺寸、比例调整和退出，及无痕拒绝和重启恢复。隐藏原生视图的延迟 focus 通知被可见性校验忽略，避免抢回刚新建的标签。普通 workspace 和 password-dropdown 回归亦通过。结果在 `artifacts/compatibility-result.json`，测试检查主进程异常为空。

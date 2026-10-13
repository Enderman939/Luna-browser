# luna 1.2 下载与扩展

- 收藏、历史、下载各自一个面板，不显示跨功能分类栏；保留独立菜单、按钮和快捷键。
- 多线程下载使用同一 Electron 持久会话的 HTTP Range 请求，验证 Content-Range / 文件总长度 / ETag 或 Last-Modified；不支持分段时安全回退单连接。POST、blob、小文件等保持 Chromium 原生下载。
- 显示 URL、总大小、已下载、速度、ETA、续传能力、真实分段位置与进度；支持暂停、继续、重试、取消、限速、下载完成后操作。
- 分段数据保存在用户目录，检查点写入下载元数据，重启后可恢复分段任务；自动命名防止覆盖其他下载。
- 完成后通过系统 API 获取 exe / msi 等文件图标；未完成使用文件类型图标，不执行下载文件。
- `page-favicon-updated` 获取真实图标，经主进程获取与尺寸转换后向本地 UI 提供 data 图片，并在本机缓存。
- Chrome 扩展使用 Electron 原生扩展与 electron-chrome-extensions 桥接；提供解压目录、CRX 安装、Chrome Web Store 入口与扩展 ID 安装、启停、卸载、选项页、工具栏操作和弹窗。
- 扩展代码运行于隔离的网页会话；本地 UI 桥接仍只对可信 UI 开放。确认安装请求展示扩展名称与申请权限。
- 不使用 Electron webRequest 钩子来统计下载，以免拦截扩展的 chrome.webRequest；通过每页 CDP 网络事件识别下载请求的方法和必要请求头。
- 集成测试验证多连接、Range 校验、暂停恢复、重启续传、文件校验、单连接回退、断连重试、真实 favicon、文件图标、扩展 content script / popup / tabs API / CRX / 启停与重启。

# luna 2.3 第一批基础功能

本批实现网站授权与信息、地址栏本地候选、标签排序/固定/静音及跨窗口移动、收藏文件夹/编辑/HTML 导入导出、Windows 默认浏览器注册。沿用现有多窗口、无痕、浮层和安全 IPC。

- 网站授权由每个实际 Session 的独立管理器处理，仅允许可信 HTTPS 或本机来源，按 origin 区分。跨源嵌入请求不沿用顶层授权。授权提示确认后再次核对页面和窗口生命周期。无痕状态不写普通配置。网站面板显示实际网络安全信息，不绕过证书验证。
- 地址栏候选只读取本地收藏、普通历史及本窗口标签。候选使用独立原生浮层，避免 Chromium 网页遮挡；保持地址栏输入焦点并支持键盘和鼠标选择。
- 标签移动转移真实 WebContentsView，保留导航、登录和运行状态；仅允许同一 Session，禁止普通与无痕混移。事件处理通过标签的当前所有者路由，分组和分屏在移动时合理拆分。固定/静音状态进入恢复布局。
- 收藏继续保留原 URL 查询行为，添加稳定 ID、folderId、排序和独立文件夹列表；迁移旧记录且提高容量。HTML 解析仅识别书签结构，不执行脚本、不加载资源，拒绝危险协议并限制体积与层级。
- 默认浏览器注册由设置页按钮触发，写入当前用户 RegisteredApplications、Capabilities 与 ProgID；通过 Windows 设置让用户决定默认关联。不修改 UserChoice。HTTP/HTTPS 启动参数经严格解析，在现有普通窗口打开。单实例锁随用户目录隔离，测试 profile 不接触生产锁或生产注册。
- 验证包括来源/导入/布局单元测试、临时 profile 的真实 Electron 交互与重启、相关扩展/无痕/分屏回归、精简成品验证。

后续批次：发布源与签名更新机制、在线恶意网站信誉服务，以及其他功能差距。

源码验证：64 单元测试、essentials 集成、原有 workspace、安全与完整密码集成通过。交互检查包括真实媒体授权、跨源拒绝、键盘与原生候选浮层鼠标选择、HTML 标签拖动、跨窗口视图/JS/DOM/导航保持、扩展窗口归属、收藏文件选择/导入/导出、Windows 独立注册表目录测试与第二进程 URL 交接。成品检查结果见 artifacts。

2.3.0 精简成品交付：essentials、private-security、features、context-menu、默认 GPU ie-visibility 均在打包后通过。verify-package 检查 ZIP CRC、ASAR 一致性、许可、原生宿主、运行资源和成品检查时间。逻辑大小 322.97 MiB、NTFS LZX 占用 137.70 MiB、ZIP 142.31 MiB。素材目录中的 Advanced Installer .aip 工程、Luna-SetupFiles 输出和 Luna-cache 缓存留在工作目录，从成品排除。正式启动已核实 luna.exe 路径、luna 窗口与 ProductVersion 2.3.0。

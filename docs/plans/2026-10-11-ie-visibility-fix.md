# IE 空白显示修复 · 2.1.1

用户在 `https://cn.bing.com/` 的 IE 模式下看见空白网页区域。

## 原因与修复

2.1.0 将跨进程 IE WebBrowser HWND 设为 Electron 窗口的 WS_CHILD。Chromium 的 DirectComposition 画面会覆盖原生子窗口。IE 的 DOM、网络请求和独立 PrintWindow 截图都可以正常，仍不代表用户在主窗口看见页面；原集成检查没有覆盖默认 GPU 下的真实桌面显示。

仅将原生窗口提高到 HWND_TOP 可以修复鼠标命中，但默认 GPU 下仍显示空白。因此采用由 luna 窗口拥有的无边框原生网页视图，单独保留渲染表面，并保持 Chromium 的硬件加速。原生视图通过父窗口 client 坐标与 DPI 定位，跟随窗口移动、尺寸、分屏及最小化。切换到其他应用、标签或浏览器内弹窗时隐藏；显示时保持在当前菜单/工具窗口之下，避免遮挡和浮到其他应用上。

原生窗口的实际所有者绑定到 luna HWND，关闭会话仍通过原有管道和宿主生命周期处理。IE 的 Alt+F4 转交 luna 关闭确认，地址栏快捷键聚焦主窗口。IE 网络加载错误返回明确的浏览器错误页，隐藏失败视图，支持重试与切换回普通模式；不会将网络或证书错误视为成功。

## 验证

新增 `test:ie-visibility`，使用默认 GPU 启动，不拼接离屏画面。检查实际桌面像素、WindowFromPoint 是否命中 Internet Explorer_Server，以及真实鼠标点击是否执行网页处理器。覆盖移动、最小化恢复、标签切换、浏览器内弹窗遮挡、加载错误与恢复。

使用独立临时 profile 导航实际 Bing 首页，确认 Trident documentMode=11、页面完成并包含实际内容，截取主窗口桌面画面。证据：`artifacts/ie-visible-desktop.png`、`ie-bing-desktop.png`、`ie-visible-modal.png`、`ie-visible-load-error.png` 和 `ie-visibility-result.json`。

桌面诊断、激活和测试鼠标指令仅在 `LUNA_NATIVE_TESTING=1` 的隔离测试会话启用，不提供网页或普通 UI 调用入口。截图只截取 luna 客户区域，排除窗口阴影中的其他应用内容。

## 交付验证

58 项单元测试与源码 IE 数据同步回归通过。2.1.1 成品使用 `LUNA_EXECUTABLE` 运行完整显示测试及 IE Cookie/存储/POST/恢复回归，均通过。成品显示检查记录 `gpu_compositing=enabled`、WebGL 和视频解码开启；真实 Bing 文档为 IE11，包含 237 个页面元素，实际桌面截图可见搜索框。原生视图的网络错误、真实鼠标点击、移动、最小化恢复、标签和弹窗遮挡都在该成品上验证。

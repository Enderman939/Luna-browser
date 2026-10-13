# 多窗口、无痕、分屏与标签页组

用户要求修复鼠标经过扩展子菜单时的闪烁，并完成菜单中尚未实现的功能。

菜单弹窗固定容纳左右两列，不随 hover 改变原生窗口宽度。子菜单过渡延迟关闭，透明间隔允许鼠标通过；尺寸和位置相同时不调用原生 resize/move。

每个窗口拥有自己的标签、活动页、弹窗和分屏状态。普通窗口共享网站 session、收藏、设置、密码库和下载管理。可信 UI IPC 按真实 sender 所属窗口分派。网页 IPC 保持现有 frame/origin/session 校验。

无痕窗口共享独立的非持久 partition，Cookie、缓存、存储与普通会话隔离。关闭最后一个无痕窗口后清理，下一次无痕使用新 partition。不写入历史、最近访问、网站设置、密码或会话恢复，不加载扩展。下载文件和显式添加的收藏属于用户主动保留的数据，下载记录在窗口关闭后丢弃。

分屏在同一窗口中并排放置两个真实 WebContentsView。支持选择现有网页或新地址、拖动分隔线、键盘调节、切换活动侧、交换与退出。导航、查找、缩放和网页工具针对活动侧；切换到分屏外标签退出分屏。内部设置页不进入分屏。

标签页组支持新建、命名、颜色、折叠、添加/移出标签、解除分组及关闭组。关闭组使用现有浏览器内确认。普通窗口恢复保存标签顺序、活动页、组和分屏布局，无痕状态不进入持久文件。

验证覆盖真实鼠标路径、原生弹窗位置不变、多窗口关闭互不影响、网站 Cookie/localStorage 隔离、无痕退出清理、不写入历史与恢复文件、分屏 bounds/focus/resize/navigation、组折叠与重启恢复及现有安全回归。

窗口关闭先停止延迟状态更新，并在销毁网页前将标签从窗口注册表移除。`WebContentsView.webContents` 在销毁后可能变为 undefined，关闭和状态快照均检查对象生命周期。页面事件不能再向已经关闭的窗口发布状态。

源码验证：54 项单元测试、workspace、browser-menu、security、password-dropdown、passwords、features、privacy 均通过。完整密码测试将未知 WebContents 的断言更新为在 scoped IPC 层直接拒绝；保持调用者校验，不放宽授权。测试清理也销毁创建的攻击窗口，避免测试进程遗留。

正式构建：`npm run build` 生成 `dist/luna-win32-x64/luna.exe`，版本 2.0.0。使用 `LUNA_EXECUTABLE` 指向该成品运行 `test:workspace` 全部通过，包含原生 Ctrl+N / Ctrl+Shift+N、网页焦点切换活动侧、分组编辑和确认关闭、窗口间共享密码库、无痕隔离及多窗口重启恢复。确认关闭后的下一步等待弹窗隐藏及网页重新可见，避免抢在 modal-state 更新前发出操作。

证据：`artifacts/workspace-result.json`、`browser-menu-hover-stable.png`、`workspace-split-dark.png`、`workspace-groups.png` 和 `workspace-private.png`。该测试捕获并断言主进程异常为空，测试用用户目录和网页均独立于正式用户数据。

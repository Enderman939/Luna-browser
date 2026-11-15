# Luna Browser 代码审查与依赖安全报告

- 日期：2026-11-14
- 基线：v1.2.1（Electron 45.2.3 / Chromium 156.0.8078.80 / Node.js 24.22.2）
- 范围：`src/`、`scripts/`、`tests/`、`package.json`、GitHub Advisory Database、Electron Release Notes
- 方法：源码静态审查 + `npm audit` + `npm outdated` + 官方公告比对 + `npm test`

## 结论速览

| 类别 | 结论 | 优先级 |
| --- | --- | --- |
| 已公开 CVE | 当前版本 45.2.3 未命中任何已发布的 Electron / 生产依赖 CVE | — |
| Electron 补丁 | 落后 3 个补丁版（最新 45.3.2），缺少 Chromium 安全回补和新的证书吊销更新 | 高 |
| 生产依赖 | `npm audit --omit=dev` = 0 条 | — |
| 开发依赖 | 4 条（undici 高危 + glob/minimatch 中危），仅构建期使用 | 中 |
| 性能 | 状态全量广播 + 每次导航同步全量写盘，是当前最大瓶颈 | 高 |
| 工程化 | 无 lint / typecheck / Windows CI；`main.js` 单文件 1731 行 | 中 |

---

## 一、CVE 与依赖安全

### 1.1 Electron 45.2.3 的 CVE 状态

查询 GitHub Advisory Database（`GET /advisories?ecosystem=npm&affects=electron@45.2.3`）返回空数组；用 `electron@44.0.0` 验证同一接口会返回多条公告，说明版本过滤有效，不是查询失败。

已发布的 Electron 2026 年公告均已在 45.2.3 之前修复：

| 公告 | CVE | 严重度 | 修复版本 | 45.2.3 状态 |
| --- | --- | --- | --- | --- |
| GHSA-jr5w-w6x2-84p9 | CVE-2026-115570（eMudhra 中间证书） | 高 | 45.0.0-beta.6 | 已修复 |
| GHSA-2p8c-gr87-2676 | CVE-2026-113796（SameSite 新窗口） | 中 | 45.0.0-alpha.6 | 已修复 |
| GHSA-997q-gvvc-jwmx | CVE-2026-114121（openExternal 归属） | 中 | 45.0.0-alpha.5 | 已修复 |
| GHSA-fw47-9c62-h3vw | CVE-2026-113800（HID/USB 归属） | 中 | 45.0.0-alpha.5 | 已修复 |
| GHSA-x562-297c-g43g | CVE-2026-113798（pointerLock 归属） | 中 | 45.0.0-alpha.13 | 已修复 |
| GHSA-98mx-cjp9-gchm | CVE-2026-113797（tabs.query 泄漏） | 低 | 45.0.0-alpha.4 | 已修复 |
| GHSA-3qxv-5xgr-q7w9 | CVE-2026-114122（帧订阅越界） | 低 | 45.0.0-alpha.9 | 已修复 |
| GHSA-h3v5-h239-pg29 | CVE-2026-114124（macOS 离屏渲染） | 低 | 45.0.0-alpha.9 | 已修复 |
| GHSA-vv43-5jgx-7qv8 | CVE-2026-102672（Squirrel.Mac） | 中 | 42.0.0-beta.2 | 已修复 |

结论：**没有未修复的已知 CVE**。但仍建议从 45.2.3 升级到 45.3.2：

- 45.3.1 新增对 eMudhra 已吊销 RSA 中间证书的拦截（PR #55742），45.2.3 不含该更新；该更新目前没有独立 CVE 编号（与 CVE-2026-115570 不是同一批 PR）。
- 45.3.2 将 Chromium 从 156.0.8078.80 提升到 156.0.8078.100，并回补 ANGLE / Chromium / Dawn / Skia / V8 修复（PR #55747）。Chromium 安全修复通常不单独分配 CVE，但会随补丁版发布。
- 45.3.0 修复：`webRequest` 重定向循环导致渲染进程崩溃（#55656）、`setPermissionRequestHandler` 回调在 webview 销毁后触发的主进程崩溃（#55676）、`net.fetch` 上传流错误未处理（#55691）、扩展访问 `chrome.system.storage` 崩溃（#55625）。
- 45.3.2 修复：退出前 Cookie 未落盘（#55773）。

建议操作：

1. `package.json` 中 `electron` 从 `45.2.3` 升到 `45.3.2`（同一大版本补丁升级）。
2. 重新执行 `npm test`、`npm run test:security`、`npm run test:features`、`npm run test:store`。
3. 打包后跑一次冒烟（`npm run test:smoke` / `npm run test:private-security`）。

### 1.2 npm 依赖审计

```
npm audit --omit=dev  → 0 vulnerabilities（生产依赖）
npm audit             → 4 条，全部位于 devDependencies
```

| 包 | 当前 | 目标版本 | 严重度 | 来源 | 说明 |
| --- | --- | --- | --- | --- | --- |
| undici | 7.30.0 | 7.30.1 | 高 | @electron/packager → @electron/get | EventSource 内存 DoS、SRI 绕过、解压 DoS、跨源重定向缓存投毒、TLS 证书校验绕过、TLS 重协商 DoS、WebSocket PONG DoS |
| glob | 13.0.6 | 14.0.6 | 中 | @electron/asar | AbortSignal 取消绕过 |
| minimatch | 10.2.6 | 11.0.8 | 中 | @electron/asar / glob | globparts 放大 DoS |
| @electron/asar | 4.3.1 | 随上游 | 中 | @electron/packager | 上述两项的聚合项 |

这些包只在打包/构建时使用，不进入最终安装包（`scripts/package.mjs` 使用 `prune: true`），对最终用户风险低，但应修复构建环境：

```
npm audit fix
```

`@electron/packager` 已是最新 20.3.0，修复来自传递依赖升级。目标版本已通过 `npm view` 确认存在。

### 1.3 其他依赖

- `adm-zip 0.6.1`、`qrcode 1.5.4`、`@mozilla/readability 0.6.0`、`electron-chrome-web-store 0.13.0`：当前最新，无公告。
- `electron-chrome-extensions 4.9.0 → 4.10.0` 可用。注意 `docs/security-audit-2026-10-11.md` 明确记录扩展安全适配针对 4.9.0 的固定接口；升级前必须重跑 `npm run test:security`、`npm run test:store`、`npm run test:private-security`，并复核 `src/extension-security.js` 的接口断言。
- 开发依赖可更新项：`playwright 1.64.0 → 1.65.1`、`react/react-dom 19.1.1 → 19.3.1`（仅安装器 UI）、`framer-motion 12.23.24 → 14.14.0`（跨大版本，暂不建议）、`motion-dom` / `motion-utils` 跟随 framer-motion。

### 1.4 安全加固建议（非 CVE）

1. **未启用 `@electron/fuses`**。建议在打包后启用：`RunAsNode=false`、`EnableNodeCliInspectArguments=false`、`EnableEmbeddedAsarIntegrityValidation=true`、`OnlyLoadAppFromAsar=true`。当前源码和脚本中没有任何 fuse 配置。
2. **Windows 自动更新只校验 SHA-256**。macOS 侧额外执行 `codesign --verify --deep --strict`（`src/update-installer.js:117`），Windows 侧建议同时验证 ZIP 内 `luna.exe` 的 Authenticode 签名，降低 GitHub 账号或 Release 被攻破的风险。
3. **现有安全基线良好**：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、CSP、权限默认拒绝、扩展路径越界检查、密码库使用 `safeStorage` 且拒绝 `basic_text` 后端。保持现有测试覆盖即可。

---

## 二、性能优化

### 2.1 状态全量广播（高）

`src/main.js:218-259` 的 `snapshot()` 每次都包含：

- `history`：最多 10,000 条，约 1–2 MB
- `icons`：最多 100 个 data URL，栅格图标 1–2 KB，SVG 最大 64 KB，最坏约 6 MB
- `bookmarks`：最多 5,000 条
- downloads / extensions / sitePermissions 等

`queueState()`（`src/main.js:264-275`）只做 25 ms 防抖；`sendState()` 在标签加载、标题变化、favicon、下载进度等事件上频繁触发。下载期间 `nativeTimer` 每 400 ms 调一次 `sendState()`（`src/main.js:891-907`）。多窗口时 `sendState()` 还会遍历所有窗口，每个窗口各发一份全量快照（`src/main.js:260-262`）。

渲染进程基础渲染实际只用到 `state.history.length`、`state.bookmarks.some(...)` 和 `state.icons` 做 favicon 查找（`src/ui/app.js:89`、`209`、`310`、`369`）；历史列表只有打开面板时才需要。

建议：

- 拆分频道：`browser:state` 只发标签/地址栏/下载摘要；`browser:history`、`browser:icons`、`browser:bookmarks` 在面板打开时按需请求或分页返回。
- 或至少在 `snapshot()` 中默认省略 `history` / `icons` / 完整 `bookmarks`。
- 下载进度只发增量字段（`id / received / total / status`），避免 400 ms 一次全量结构化克隆。

预期：大配置下每次状态消息从 MB 级降到几十 KB，主进程与渲染进程 CPU 明显下降。

### 2.2 每次导航同步全量写盘（高）

`src/store.js:26-31` 的 `visit()` 每次导航都会：

1. `filter` 全量历史（最多 10,000 条）
2. 调用 `sanitizeData()`，重新校验全部历史、书签和每个图标的正则（`src/core.js:84-105`）
3. `JSON.stringify` 整个 `browser-data.json`（含图标，最坏 10 MB+）
4. `writeFileSync` + `renameSync` 同步写

同一路径还出现在 favicon 保存（`src/main.js:562-564`）、缩放保存（`src/main.js:738`）、站点设置保存等位置。历史或图标较多时，主进程会明显卡顿。

建议：

- 写盘改为尾部防抖的异步写入（如 300–500 ms），窗口关闭/退出前强制 flush。
- `sanitizeData()` 只在加载时执行；变更入口做局部校验。
- 把 `icons`、`history` 拆到独立文件，避免每次小改动重写全部数据。
- 历史去重改用 `Map` 索引，避免每次 `filter` 10,000 条。

### 2.3 图标体积上限偏大（中）

`src/core.js:102` 允许单个图标 128 KB × 100 个。`src/images.js` 会把栅格图缩到 32×32（约 1–2 KB），但 SVG 分支原样保留到 64 KB。最坏情况 `browser-data.json` 和每次状态消息接近 6–12 MB。

建议：SVG 上限降到 16 KB，或统一转成 16×16 / 32×32 栅格；图标独立存储并按需加载。

### 2.4 下载完成的文件复制（中）

`src/downloads.js:288-293`：`overwrite=false` 时先 `copyFile` 再 `unlink` 临时文件。大文件会多一次完整 I/O，并临时占用双倍磁盘。

建议：优先 `rename`，捕获 `EXDEV` 后再回退到 `copyFile`。

### 2.5 下载恢复的坏记录会中断后续恢复（中）

`src/downloads.js:335-354` 在循环内 `throw` 无效检查点，外层 `catch` 会静默放弃剩余记录。

建议：单条无效记录改为 `continue` 并记录日志，保留其他可恢复任务。

### 2.6 商店页 750 ms 轮询（低）

`src/webstore-preload.js:104` 使用 `setInterval(..., 750)` 轮询 DOM。建议改为 `MutationObserver` 或页面事件，降低空闲 CPU。

### 2.7 标签页全量重建（低）

`src/ui/app.js:238-307` 在签名变化时 `replaceChildren()` 重建全部标签 DOM，并逐个 `getBoundingClientRect()` 做动画。标签很多时可改为 keyed diff；当前标签数量有限，优先级低。

### 2.8 主进程单文件（中，可维护性）

`src/main.js` 为 1,731 行 / 131 KB，包含窗口、标签、下载、IPC、菜单、会话恢复等全部逻辑。建议拆分为 `window-manager`、`tab-manager`、`ipc-router`、`downloads-glue`、`session-restore` 等模块；现有 114 个单元测试可作为拆分回归基线。

---

## 三、工程质量

1. **缺少 lint / format / typecheck**：仓库没有 ESLint、Prettier、tsconfig/jsconfig。建议加入 ESLint flat config + Prettier，并在 CI 执行 `npm run lint`。
2. **只有 macOS CI**：`.github/workflows/macos-arm64.yml` 存在，但 Windows 是主要平台。建议增加 Windows workflow：`npm ci` → `npm test` → `npm run build` → 关键 smoke（`test:security`、`test:features`、`test:store`）。
3. **测试入口手工枚举**：`package.json` 的 `test` 脚本逐条列出 20 个文件。Node 24 可直接使用 `node --test tests/*.test.js`（或 `node --test tests/`），新增测试不会漏跑。
4. **缺少 `engines`**：CI 使用 Node 24，Electron 45 内置 Node 24.22.2。建议增加 `"engines": { "node": ">=24" }`。
5. **仓库杂物**：根目录 `session-ses_edfb.md`（约 555 KB）未跟踪；`packageIgnore` 已排除 `session-*.md`，但建议加入 `.gitignore` 或删除。`src/ui/assets/Luna-SetupFiles/` 与 `Luna-cache/` 约 614 MB（已 gitignore，且不进入安装包），建议移出工作区或放到外部构建缓存，避免备份、杀毒和索引开销。
6. **依赖锁**：`package-lock.json` 已提交，CI 使用 `npm ci`，良好。修复 dev 漏洞后请一并提交新的 lockfile。
7. **构建校验**：`scripts/package.mjs` 已有 `prune: true`、ZIP CRC 校验、SHA-256、安装包体积记录，良好。可考虑在 CI 增加 Windows 版 `verify-package.mjs`。

---

## 四、建议执行顺序

1. `electron` 45.2.3 → 45.3.2，跑完整测试 + 打包冒烟（安全）。
2. `npm audit fix` 修复 undici / glob / minimatch（构建环境安全）。
3. 状态拆分 + 写盘防抖 / 拆分（性能收益最大）。
4. 图标上限与 SVG 处理、下载 rename / 恢复健壮性（小而稳的修复）。
5. 引入 ESLint / Prettier + Windows CI + `node --test tests/*.test.js`（工程化）。
6. 评估 `@electron/fuses` 与 Windows Authenticode 校验（发布安全）。
7. 拆分 `main.js`（长期维护）。

---

## 附：本次验证命令

```
npm test                     # 114 项通过，约 6.5 s
npm audit --omit=dev --json  # 0 vulnerabilities
npm audit --json             # 4 dev-only vulnerabilities
npm outdated --json          # electron 45.3.2 / electron-chrome-extensions 4.10.0 等
```

Electron 公告来源：GitHub Advisory Database（`electron`，npm），查询时间 2026-11-14。

## 五、修复回顾

在本次审查之后已落地的项目：

- Electron 已升级到 45.3.2；生产依赖审计和完整审计均为 0 条。
- 标签栏压缩状态下，关闭按钮固定为独立的 20px 命中区，不再覆盖整个标签，也不会在图标和关闭按钮之间误触；取消拖动、拖出 Luna 窗口、同会话窗口合并和 45 标签恢复均有回归覆盖。
- 启动恢复现在等待必要初始化，捕获 `loadURL()` Promise；未提交的启动取消只重试一次，用户停止、新导航和真实网络失败不会被覆盖，失败页会显示错误。
- 下载完成优先使用同卷 `rename`，恢复检查点逐条跳过坏记录；Store 历史写盘有 400ms 尾部防抖，关闭窗口时强制 flush。
- Web Store Edge 页面轮询改为 MutationObserver、history 状态保留兼容且 favicon 状态默认只保留当前相关来源，图标输入上限已收紧。
- 当前 1.2.3 验证包含 121 项单元测试和打包版回归；实际运行时验证为 Electron 45.3.2 / Chromium 156.0.8078.100 / Node.js 24.22.2。
- 额外修复：状态中的历史列表按需发送，默认只发送 `historyTotal`；本次改动要求历史面板和隐私清理路径使用持久化数据或按需状态，避免把完整历史重新放回每次广播。
- 额外修复：压缩标签的非活动关闭按钮固定隐藏，避免点击一个窄标签时误触相邻标签关闭；活动标签仍保留至少 20px 的关闭命中区。

仍待后续专项处理：完整拆分 `main.js`、真正按频道/分页拆分历史与书签状态协议、Windows Authenticode 更新包校验、@electron/fuses、Windows CI，以及 React 安装器之外的旧 DOM UI 全面类型化。

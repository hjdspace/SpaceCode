# 产物预览改用专用源承载

## Status

Accepted（2026-10-26），收口 Issue [#63](https://github.com/hjdspace/SpaceCode/issues/63)。
上游的桥加固见 [ADR 0017](0017-design-preview-bridge-hardening.md)，卡片侧的源模型见
[ADR 0015](0015-genui-card-sandbox-origin.md)。

## Context

ADR 0017 收口 #62 时实测确认：产物预览页里的脚本**从未执行过**，桥加固因此无法在真实应用里
端到端验证。两条承载各有硬约束：

- **srcdoc 继承宿主 CSP**（`index.html` 的 `script-src 'self'`）：注入的 inline 桥与产物自己的
  inline / module 脚本全部被拦；多文件设计的相对资源也命不中产物目录，`base-uri 'self'`
  又禁止补 `<base>`。meta CSP 只能收紧，无法放宽继承策略。
- **随机 HTTP 端口写不进静态 `frame-src`**：`previewServer` 返回 `http://127.0.0.1:<随机端口>`，
  宿主 CSP 只放行 `'self' http://localhost:5174 spacecode-genui:`，iframe 直接
  `ERR_BLOCKED_BY_CSP`。桌面端只要拿到 `previewUrl`，预览就是空白页，而不是"静态 HTML"。

用仓库内 Electron 43.6.0 补测了几条决定方案的硬事实：

- `protocol.handle` **只作用于被注册的那个 session**。顶层 `protocol` 是默认 session，
  主窗口跑在 `persist:claude-code-desktop`；只注册到默认 session 时，窗口内的自定义
  scheme iframe 报 "Navigation to external protocol blocked by sandbox"。
- 自定义 scheme 配 `sandbox="allow-scripts"`（无 `allow-same-origin`）时，module script 报
  "Cross origin requests are only supported for protocol schemes…"，不执行；加
  `allow-same-origin` 后正常。
- 自定义 scheme 上 `fetch('./x.json')` 需要 `supportFetchAPI: true`（`corsEnabled` 保持 false），
  否则 "Failed to fetch"。
- CSP 的 `sandbox` 指令写在 `<meta>` 里会被忽略，只认响应头；响应头的 sandbox 脚本无法摘除。

## Decision

### 1. 预览 iframe 用 `spacecode-preview://artifact` 专用源

- scheme 注册为 `standard + secure + stream + supportFetchAPI`，`corsEnabled: false`、
  `bypassCSP: false`、`allowServiceWorkers: false`。scheme 在 app ready 之前注册，
  处理器在 ready 之后挂到**主窗口实际使用的 session**（`MAIN_WINDOW_PARTITION`）。
- 宿主 `frame-src` 只增加精确的 `spacecode-preview://artifact`，不再放行
  `http://127.0.0.1:*` 这种宽端口；主窗口 `script-src` 保持 `'self'`。
- 预览文档的脚本执行只发生在它自己的源；它拿不到宿主 DOM、存储与 preload。

### 2. 文件闸门与 HTTP 预览服务共用一份登记

`previewGrants.ts` 抽出 token / grants、词法 + realpath 边界、目录 index 判定与 MIME 白名单，
`previewServer.ts`（webview 用的顶层 HTTP 承载）与 `previewProtocol.ts` 共用。未知扩展名
从"照发 octet-stream"改成 404 —— 脚本真正执行后，预览页能 `fetch` 整个登记根，不能再把
`.env`、无扩展名文件交出去。

### 3. 文档与策略由宿主统一给

- 协议处理器读取 iframe URL 上的 `__sp_nonce` / `__sp_host`，用与渲染端同一份
  `buildBridgedDocument`（`src/shared/previewDocument.ts`）注入桥；同时移除产物自带的
  CSP meta，避免它与响应头取交集。
- HTML 响应头下发 `Content-Security-Policy: sandbox allow-scripts allow-same-origin allow-popups`。
  这是一条**只约束沙箱行为、不限制资源类型**的策略：inline / external / module / eval 由这个源
  自己承担；顶层导航、表单、下载仍被禁止，且脚本无法通过删除 iframe 属性绕过。
- `allow-same-origin` 只给专用源路径。它是跨源 origin，module script、字体与同源 fetch 依赖它；
  srcdoc 回退路径（H5 / 协议不可用）继续不给，避免与宿主同源。

### 4. 无闪烁更新走 MessageChannel

- `DesignPreview` 首次加载 `iframe.src`；后续 HTML 变更在 ready 后经端口 `document.write`
  整份替换。文档 URL 不变，相对资源仍命中产物目录。
- 父层 `DesignFileWorkspace` 在活动 HTML 内容变更时不再递增 `reloadToken` —— 递增就是强制整页
  导航，会把"无闪烁"退化成每次都重载；CSS/JS 同级资源变更与手动刷新仍递增。
- 桥超时（`1.5s`）后退回"换 rev 重新导航"，不是切回 srcdoc。

### 5. HTTP 预览服务保留给 webview

`preview:getUrl` 仍返回 HTTP URL，供右侧 webview 这类顶层文档使用（不受 `frame-src` 约束）。
设计预览的 iframe 走新增的 `preview:getFrameUrl`。两侧共用同一份 grant 登记，但承载不同。

## Consequences

- 桌面设计预览的 inline / external / module 脚本、相对 CSS/JS/字体与同源 fetch 正常执行；
  Console 不再出现宿主 CSP 违规。
- 流式更新不再整页重载；`od:sandbox:ready` 在真实 Electron 里可达，注入走 MessageChannel。
- 宿主策略没有变宽：`script-src` 仍无 `unsafe-inline` / `unsafe-eval`，`frame-src` 只多一个精确源。
- **登记根仍可能是整个工作区**：用户通过 WorkingDirectoryPicker 选择项目目录后，设计产物与
  项目源码同根，产物脚本可读取根内的白名单类型文件。要彻底收口，需要把 grant 收到产物目录
  或做逐文件引用登记；当前保留"同工作区相对引用可用"的产品能力，风险记录在此。
- **`allow-popups` 仍在**：不可信页面可以打开任意外部窗口（继承沙箱，无 preload）。ADR 0017
  计划的"捕获阶段拦截 anchor 点击改走 `openExternal`，然后删掉 `allow-popups`"仍是待办。
- **H5 设计预览仍是静态 srcdoc**：H5 没有 `preview:getUrl`，也拿不到第二个预览源。
  要支持需在 H5 的第二个静态源上加预览路由与按路由 CSP，另行跟踪。
- 打包态的 GenUI 协议处理器目前只注册在默认 session；按本条实测口径，卡片可能加载不了。
  dev 走 `localhost:5174` 掩盖了这一点，需单独验证与修复（与本 ADR 的预览源无关）。

## Alternatives considered

- **`frame-src` 放行 `http://127.0.0.1:*`**：只救回预览服务器路径；srcdoc 仍无脚本，
  module 仍被 opaque origin 的 CORS 拒掉，而且任何本机端口都能被 frame。
- **给 srcdoc 用 nonce / hash 放行注入桥**：桥内的 nonce 每次不同，hash 不稳定；
  即使桥能跑，产物自己的 inline 脚本仍被继承的 `script-src 'self'` 拦掉。
- **`data:` / `blob:` 承载**：属于本地 scheme，同样继承创建者的 CSP。
- **给 iframe 加 `allow-same-origin` 但不换源**：srcdoc 下会与宿主同源，等于拆掉沙箱。

# GenUI 卡片在独立 origin 的沙箱里渲染

## Status

Accepted（2026-10-25）。术语见根目录 `CONTEXT.md` 的 Generative UI 一节。

## Context

助手输出的 GenUI Card 要「全动态」：协议层允许 `JSExpression`、`JSFunction` 与 `state.methods`，渲染器用 `new Function` 执行它们。这意味着卡片文档本质上是**不可信代码**，而它又要和聊天消息一起显示在应用窗口里。

约束：

- 主窗口 CSP 不含 `unsafe-eval`，也不应为了卡片放开（`index.html`）。
- 卡片不能拿到 app 的 DOM、`localStorage`、cookie、preload 暴露的 API。
- 同一份能力要同时服务桌面（Electron）与 H5。
- 官方物料（TinyVue mini）自带样式与较大体积，适合独立构建。
- 卡片需要能提交表单并让结果回到会话，因此不能退化成只读图片。

## Decision

1. **每张卡一个 `<iframe sandbox="allow-scripts">`，不授予 `allow-same-origin`。** 文档因此是 opaque origin，拿不到自身源的存储，也拿不到父文档。
2. **文档来源与主窗口分源：**
   - 桌面生产：自定义协议 `spacecode-genui://`，通过 `registerSchemesAsPrivileged` 注册为 standard + secure。
   - 桌面开发：独立 Vite 实例跑在 `http://localhost:5174`，主窗口是 `http://127.0.0.1:5173`。只换端口不算换 site（拿不到 OOPIF），必须同时换主机名。
     - 票 01 落地备注：沙箱文档用**经典脚本**（不是 `type="module"`）。opaque origin 文档里 module script 一律按 CORS 发起（`Origin: null`），自定义协议要么开 `corsEnabled` 要么直接拒绝，等于把沙箱资源变成可被任意页面跨源读取。因此开发期不跑 Vite dev 实例，改由主进程起静态服务（`localhost:5174`）服务**与打包环境同一份** `dist/genui-sandbox` 产物，构建由 `vite.config.mts` 的开发插件持续 watch。换主机名 + 换端口这两条约束不变，且开发看到的 CSP、断网与禁导航与打包完全一致。
   - H5：独立源（主服务端口 +1），逐响应注入 CSP 与 nonce；父页面的 `frame-src` 只放行该源。
3. **沙箱文档自带 CSP，不与主窗口共享：**

   ```text
   sandbox allow-scripts;
   default-src 'none';
   script-src 'self' 'unsafe-eval';
   style-src 'self' 'unsafe-inline';
   img-src 'self' data:;
   font-src 'self' data:;
   connect-src 'none';
   form-action 'none';
   base-uri 'none';
   frame-src 'none';
   object-src 'none'
   ```

   `unsafe-eval` 只存在于沙箱源。主窗口 CSP 保持原样，仅增加 framing 所需的 `frame-src`。
4. **通信走 `MessageChannel` + 每卡 nonce。** 首次握手由宿主注入 nonce；之后宿主只接受 `event.source === iframe.contentWindow` 且 nonce 匹配的消息。卡片可用动作是固定白名单：submit / copy / expand / open external link。外链只允许 `http:` / `https:`，由主进程 `openExternal` 执行。
5. **卡片不能导航。** 桌面端用 `will-frame-navigate` 拒绝、`setWindowOpenHandler` 返回 deny；沙箱不授予 `allow-top-navigation`。H5 端依赖 CSP 的 `form-action` / `base-uri` 与来源限制。
   - 票 01 落地备注（Electron 43 实测）：子 frame 的 `will-frame-navigate` 事件里 `senderFrame` 为 `undefined`，主进程拿不到"该 frame 当前是什么文档"，因此闸门只能按目标 URL 判定 — 非主 frame 只放行精确的沙箱卡片文档 URL，指向沙箱源的其他目标（换 path、带查询串外泄）一律拒；跨源跳出由主窗口 CSP 的 `frame-src` 拦（实测落到 chrome-error，请求不出本机）。`window.open` 靠 `sandbox="allow-scripts"` 不给 `allow-popups` 拦住，未新增全局 `setWindowOpenHandler` —— 主窗口内既有 `target="_blank"` 链接会被一刀切的 deny 打断，属存量行为，不在本票顺手改。
6. **每卡独立实例，离屏卸载。** 可视区外的卡片销毁 iframe 只保留快照占位；单卡消息大小与单条消息卡片数设上限，超限拒绝渲染而不是拖垮窗口。

## Consequences

- 卡片拿不到 app 的 origin、存储与 preload API；协议层即使执行任意表达式，也只是在自己的 opaque origin 里打转。
- 桌面端有 OOPIF 进程隔离。H5 端不同端口是跨 origin 但**同 site**，没有进程隔离；`connect-src 'none'` 挡住网络回连，但自导航外泄只能部分拦截。这是 H5 端接受的残余风险。
- 多一个沙箱构建产物、一个端口和一套响应级 CSP 注入。H5 部署必须暴露或代理第二个端口，隧道/反代方案要同步更新。
- 卡片不能读主窗口 CSS，主题只能由宿主通过握手消息传「明暗 + token」。
- 任何把卡片渲染搬回主文档的改动，都等价于放开主窗口 CSP；这是本 ADR 的红线。

## Alternatives considered

- **同源 iframe + `allow-same-origin`**：卡片脚本可以移除 sandbox 属性、直接读写父文档，等于没有沙箱。
- **主窗口内直接执行**：必须放宽主窗口 CSP，且卡片与 app 同上下文，一次 XSS 即全盘失守。
- **`<webview>`**：有进程隔离，但 API 面更大、Electron 不推荐，H5 没有对应物。
- **每卡一个独立 `BrowserWindow`**：隔离最好，但交互、布局、焦点成本都不成比例。
- **服务端预渲染成静态 HTML/图片**：最安全，但失去交互与提交，违背「全动态」目标。

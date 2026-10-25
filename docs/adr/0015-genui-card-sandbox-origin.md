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

# 产物预览桥按不可信文档收口

## Status

Accepted（2026-10-26），收口 Issue [#62](https://github.com/hjdspace/SpaceCode/issues/62)。
卡片侧的安全模型见 [ADR 0015](0015-genui-card-sandbox-origin.md)。

## Context

`DesignPreview` 在 `sandbox="allow-scripts allow-popups allow-downloads"` 的 iframe 里渲染
模型生成或设计工作区里的 HTML。这与 GenUI 卡片属于同一信任等级：文档内容不可信，但它
需要把弹窗、外链、渲染错误回传给宿主，流式生成时还要无闪烁地整页替换。

票 09 的发布前审计在卡片链路上做了来源校验、每卡 nonce 与动作白名单，产物预览这条链路
没有跟上：

1. `srcdoc` 传输桥只按 `msg.type` 判定，收到就 `document.open()/write()`；
2. 宿主侧回传处理同样只按 type 分发，`od:sandbox:open` 的 URL 原样交给 `shell:openExternal`；
3. 出站 `postMessage` 目标源是 `'*'`；iframe 还带 `allow-popups allow-downloads`。

修复前用仓库内 Electron v43.6.0 实测了三条会决定方案的硬约束：

- **srcdoc 继承宿主 CSP**（`index.html` 的 `script-src 'self'`），注入的 inline 桥脚本
  被拦掉；同理产物自己的脚本也不执行。桥在当前线上是「写了但没跑」。
- **opaque origin 的 frame 只接受 `targetOrigin='*'`**：向它投 `'file://'` 不送达，
  `'null'` 直接抛 `SyntaxError`。反向 frame → 宿主用宿主 origin（打包态 `file://`）可送达。
- **沙箱 frame 拉起的弹窗持有 `window.opener`，可访问 `opener.parent` 并向宿主发消息**，
  且 `event.source` 不是预览 frame 本身。修复前宿主不看 source，所以「预览里点一个外链」
  就能让远端页面调用宿主的 `openExternal`；主进程又不过滤协议，`file:` 在 Windows 上
  等于执行本地程序。

## Decision

### 1. 每个预览实例一个桥密钥

`DesignPreview` 挂载时用 `createUuid` 生成 nonce，随每次 `buildSrcdoc` 写进两座注入桥。
frame → 宿主的每条消息都带 nonce，宿主先校验 `event.source === iframe.contentWindow`
再校验 nonce。

**nonce 不是授权凭据**：它写在预览文档里，文档自身的脚本读得到。它的价值是来源证明 ——
挡住弹窗、同窗口其他 iframe（如 GenUI 卡片）与 frame 导航后的外来文档。真正的授权是下面的
动作白名单与协议闸门。

### 2. 宿主 → frame 不再用带载荷的 `postMessage`

frame 侧桥在 ready 时创建一个 `MessageChannel`，把 `port2` 转移给宿主；此后宿主只通过该
端口注入 HTML（每条消息仍带 nonce，作为二次校验）。`document.write` 会让文档整体重建，
桥随之重跑并重新握手，宿主每次 ready 换端口。

frame 侧还保留一个窗口兜底通道，但强制 `event.source === window.parent` + nonce 匹配；
宿主不主动走它。于是**没有任何带载荷的 `'*'` 广播**，唯一的 `'*'` 只出现在卡片侧
（ADR 0015）那条已接受的握手上。

### 3. 回传按动作白名单分发

`parsePreviewOutbound` 只认 `ready / alert / confirm / open / error` 五类；未知类型、
非对象、超长文本、缺密钥一律返回 `null`，不落任何通用 IPC。`open` 必须通过
`isSafeExternalUrl`（绝对 `http:` / `https:`），与卡片动作共用同一实现
（`src/utils/safeUrl.ts`）。主进程的 `shell:openExternal` 再用同一闸门兜底一次 ——
任何渲染端 bug / XSS 都不能把 `file:` 交给 OS Shell。

### 4. sandbox 收紧到 `allow-scripts allow-popups`

- `allow-scripts`：预览本身就是网页，脚本是产品能力。
- `allow-popups`：外链新窗口。当前桥脚本被宿主 CSP 拦掉，anchor `target=_blank` 是唯一
  还能工作的外链路径；去掉它会让既有能力失效。来源校验后弹窗已无法冒充预览帧。
  待桥能真正执行后，用 shim 的捕获阶段 click 拦截改走 `openExternal`，再删掉这条。
- 去掉 `allow-downloads`：产物导出条在宿主的 `DesignFileWorkspace` 里，不依赖 iframe
  内下载；保留它只会让不可信页面往磁盘落文件。
- 依旧不给 `allow-same-origin`。

### 5. 桥不可用时的回退

当前宿主 CSP 会拦掉 srcdoc 里的 inline 桥，ready 永远不来。宿主等
`PREVIEW_BRIDGE_READY_TIMEOUT_MS`（1.5s）后确认桥不可用，退回「整文档重设 srcdoc」的
旧行为：宁可闪一下，也不能让预览停在首屏内容。桥正常时，这段时间内的流式 tick 只缓存
最新一版并在 ready 后补发。

## Consequences

- 弹窗、并存的其他 iframe 无法再调用宿主的通知/外链动作；`file:` 与自定义 scheme 不再
  能进系统 Shell。
- 预览文档自身仍可请求白名单内的动作（alert / open http(s)）—— 这是能力，不是漏洞；
  它拿不到通用 IPC、拿不到宿主 DOM 与存储。
- 预览桥的 no-flicker 路径在本 ADR 落地时仍是空转：`srcdoc` 继承 `script-src 'self'`，
  注入桥与产物脚本都不执行；预览服务器 URL 也被 `frame-src` 拒掉。**该问题已由
  [ADR 0018](0018-design-preview-dedicated-origin.md) 收口**：预览改走
  `spacecode-preview://artifact` 专用源，桥由主进程注入，宿主 `script-src` 不变。
  修好之前不要用「桥测试全绿」推断流式渲染可用；现在可以用
  `docs/genui-release-acceptance.md` D9 的桌面用例端到端验证。
- `allow-popups` 保留期的钓鱼面：不可信页面可以打开任意外部窗口（继承沙箱，无 preload）。
  等桥可执行后按上面第 4 条删掉。

## Alternatives considered

- **只加 nonce，保留 `'*'` 的 host → frame 注入**：opaque origin 下 `'*'` 是唯一可达的
  目标源，nonce 能挡住冒充；但带载荷的广播仍会把整份 HTML 交给任何接管 frame 的文档。
  端口方案把这条路径整个去掉，成本只是每次 `document.write` 后多一次握手。
- **给 srcdoc 加 meta CSP 放开 inline**：meta 只能收紧，不能放宽继承来的策略。
- **靠 CSP hash 放行注入脚本**：`index.html` 是静态的，桥一改就要改 CSP；而且产物脚本
  仍然不执行，等于假装修好了预览。
- **`allow-same-origin`**：frame 可以移除 sandbox、直接读写父文档，等于没有沙箱。

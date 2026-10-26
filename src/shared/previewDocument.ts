/**
 * 产物预览文档的桥协议与文档构建 — 渲染端与主进程共用。
 *
 * 两个宿主都需要同一份注入脚本：
 *  - 渲染端在 srcdoc 回退路径与流式 `document.write` 里构建文档；
 *  - 主进程在 `spacecode-preview://` 协议里给登记过的产物注入桥。
 * 协议常量放在 shared 才不会出现"主进程注入的 nonce 渲染端不认识"。
 *
 * 注入的脚本跑在**不可信文档**里，只做两件事：把宿主需要的信号带上本实例的
 * nonce 发回固定 origin，以及只接受宿主持有端口的注入消息。闸门与白名单在宿主侧
 * （`previewBridge.ts` / `DesignPreview.vue`）。
 */

export const PREVIEW_MSG_READY = 'od:sandbox:ready'
export const PREVIEW_MSG_ALERT = 'od:sandbox:alert'
export const PREVIEW_MSG_CONFIRM = 'od:sandbox:confirm'
export const PREVIEW_MSG_OPEN = 'od:sandbox:open'
export const PREVIEW_MSG_ERROR = 'od:sandbox:error'
export const PREVIEW_MSG_TRANSPORT = 'od:srcdoc-transport-activate'

export const PREVIEW_SANDBOX_SHIM_ID = 'od-sandbox-shim'
export const PREVIEW_TRANSPORT_BRIDGE_ID = 'od-transport-bridge'

/** 单次注入的文档上限；预览是整页 HTML，比卡片消息大一个量级。 */
export const PREVIEW_MAX_HTML_CHARS = 5_000_000

export type PreviewBridgeOptions = {
  /** 本预览实例的桥密钥，随每次文档构建重新写入 */
  nonce: string
  /** 宿主 origin；frame 与宿主跨源，只有向宿主发消息时才用得上具体源 */
  hostOrigin: string
}

/**
 * 去掉产物自带的 CSP meta。
 *
 * 预览文档的策略由宿主统一给（协议响应头的 sandbox CSP）；留着产物自己的 meta
 * 会与响应头取交集，把注入桥和产物脚本一起拦掉。meta 里的 `sandbox` 指令本身
 * 又会被浏览器忽略，替换成同一份策略只会造成"看起来有策略"的假象，所以直接移除。
 */
export function stripCspMeta(html: string): string {
  return html.replace(
    /<meta\b(?=[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'])[^>]*>/gi,
    '',
  )
}

export function buildBridgedDocument(html: string, bridge: PreviewBridgeOptions): string {
  let doc = stripCspMeta(html).trim();

  // 1. 补齐基本的 HTML5 结构
  if (!/<html|<!doctype/i.test(doc)) {
    doc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Design Artifact</title>
</head>
<body>
  ${doc}
</body>
</html>`;
  }

  // 2. 注入核心 bridges
  doc = sanitizeTitleInDoc(doc);
  doc = injectSandboxShim(doc, bridge);
  doc = injectSrcdocTransportActivationBridge(doc, bridge);

  return doc;
}

/** 把值嵌进脚本字面量；`<` 转义避免提前闭合 script。 */
function scriptLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** 两个 bridge 共用的变量声明。 */
function bridgeConstants(bridge: PreviewBridgeOptions): string {
  return `var NONCE = ${scriptLiteral(bridge.nonce)};
      var HOST_ORIGIN = ${scriptLiteral(bridge.hostOrigin)};`;
}

/** shim 的出站函数：一律带 nonce、发往固定宿主源。 */
const SEND_TO_HOST = `function sendToHost(payload) {
        payload.nonce = NONCE;
        window.parent.postMessage(payload, HOST_ORIGIN);
      }`;

/**
 * Bridge 1: 清理/截断 Title，防范潜在 XSS
 */
function sanitizeTitleInDoc(html: string): string {
  return html.replace(/<title>([\s\S]*?)<\/title>/gi, (match, titleText) => {
    const cleanText = titleText.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
    return `<title>${cleanText}</title>`;
  });
}

/**
 * Bridge 2: 注入沙箱垫片 (Sandbox Shim)
 * 拦截 iframe 内部的 window.open, alert, confirm 行为并用 postMessage 发送到宿主，
 * 避免沙箱由于无 allow-same-origin 导致原生弹窗失效或报错。
 * 出站消息带 nonce、目标源固定为宿主 origin —— 不再向 `'*'` 广播。
 */
function injectSandboxShim(html: string, bridge: PreviewBridgeOptions): string {
  const shimScript = `
  <script id="${PREVIEW_SANDBOX_SHIM_ID}">
    (function() {
      ${bridgeConstants(bridge)}
      ${SEND_TO_HOST}
      window.alert = function(msg) {
        sendToHost({ type: '${PREVIEW_MSG_ALERT}', message: String(msg) });
      };
      window.confirm = function(msg) {
        sendToHost({ type: '${PREVIEW_MSG_CONFIRM}', message: String(msg) });
        return false;
      };
      window.open = function(url) {
        sendToHost({ type: '${PREVIEW_MSG_OPEN}', url: String(url) });
        return null;
      };
      window.addEventListener('error', function(e) {
        sendToHost({
          type: '${PREVIEW_MSG_ERROR}',
          message: e.message,
          filename: e.filename,
          lineno: e.lineno
        });
      });
    })();
  </script>
  `;

  // 注入到 <head> 开头
  if (/<head>/i.test(html)) {
    return html.replace(/<head>/i, `<head>${shimScript}`);
  }
  return shimScript + html;
}

/**
 * Bridge 3: 注入流式无闪烁渲染传输通道 Bridge (Transport Activation Bridge)
 *
 * 主通道是 MessageChannel：本脚本在 ready 时把 port 转移给宿主，此后宿主只通过
 * 端口注入 HTML，不再有带载荷的 postMessage。窗口通道保留为兜底，但必须同时满足
 * `event.source === window.parent` 与 nonce 匹配 —— 任何能向本 frame 发消息的脚本
 * 都无法重写预览文档。
 *
 * `document.write` 会让本文档整体重建，本脚本随之重跑、重新握手，因此宿主要对
 * 每次 ready 换端口（见 DesignPreview.vue）。
 */
function injectSrcdocTransportActivationBridge(html: string, bridge: PreviewBridgeOptions): string {
  const transportScript = `
  <script id="${PREVIEW_TRANSPORT_BRIDGE_ID}">
    (function() {
      ${bridgeConstants(bridge)}
      var MAX_HTML_CHARS = ${PREVIEW_MAX_HTML_CHARS};

      function inject(msg) {
        if (!msg || msg.type !== '${PREVIEW_MSG_TRANSPORT}' || msg.nonce !== NONCE) return;
        var next = msg.html;
        if (typeof next !== 'string' || next.length === 0 || next.length > MAX_HTML_CHARS) return;

        // 执行无闪烁局部替换
        document.open();
        document.write(next);
        document.close();
      }

      // 兜底通道：来源必须是宿主窗口，且密钥匹配
      window.addEventListener('message', function(event) {
        if (event.source !== window.parent) return;
        inject(event.data);
      });

      // 主通道：文档重建后本脚本会重新执行，届时再转移一个新端口
      var channel = new MessageChannel();
      channel.port1.onmessage = function(event) {
        inject(event.data);
      };
      window.parent.postMessage(
        { type: '${PREVIEW_MSG_READY}', nonce: NONCE },
        HOST_ORIGIN,
        [channel.port2]
      );
    })();
  </script>
  `;

  // 注入到 <body> 结尾前
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${transportScript}</body>`);
  }
  return html + transportScript;
}

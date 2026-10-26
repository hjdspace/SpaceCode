/**
 * 生成 iframe 预览的 srcdoc 内容并注入核心的安全及交互 Bridge
 * 复刻自 open-design apps/web/src/runtime/srcdoc.ts
 *
 * 注入的脚本跑在**不可信文档**里，所以它们只做两件事：把宿主需要的信号带上
 * 本实例的 nonce 发回固定 origin，以及只接受宿主持有端口的注入消息。闸门与
 * 白名单在宿主侧（`previewBridge.ts` / `DesignPreview.vue`）。
 */
import {
  PREVIEW_MAX_HTML_CHARS,
  PREVIEW_MSG_ALERT,
  PREVIEW_MSG_CONFIRM,
  PREVIEW_MSG_ERROR,
  PREVIEW_MSG_OPEN,
  PREVIEW_MSG_READY,
  PREVIEW_MSG_TRANSPORT,
  PREVIEW_SANDBOX_SHIM_ID,
  PREVIEW_TRANSPORT_BRIDGE_ID,
} from './previewBridge'

export type SrcdocBridgeOptions = {
  /** 本预览实例的桥密钥，随每次 srcdoc 构建重新写入文档 */
  nonce: string
  /** 宿主 origin；frame 是 opaque origin，只有向宿主发消息时才用得上具体源 */
  hostOrigin: string
}

export function buildSrcdoc(html: string, bridge: SrcdocBridgeOptions): string {
  let doc = html.trim();

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
function bridgeConstants(bridge: SrcdocBridgeOptions): string {
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
function injectSandboxShim(html: string, bridge: SrcdocBridgeOptions): string {
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
function injectSrcdocTransportActivationBridge(html: string, bridge: SrcdocBridgeOptions): string {
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

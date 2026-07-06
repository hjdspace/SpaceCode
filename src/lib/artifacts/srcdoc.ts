/**
 * 生成 iframe 预览的 srcdoc 内容并注入核心的安全及交互 Bridge
 * 复刻自 open-design apps/web/src/runtime/srcdoc.ts
 */

export function buildSrcdoc(html: string): string {
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
  doc = injectSandboxShim(doc);
  doc = injectSrcdocTransportActivationBridge(doc);

  return doc;
}

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
 */
function injectSandboxShim(html: string): string {
  const shimScript = `
  <script id="od-sandbox-shim">
    (function() {
      // 拦截弹窗并转发
      window.alert = function(msg) {
        window.parent.postMessage({ type: 'od:sandbox:alert', message: String(msg) }, '*');
      };
      window.confirm = function(msg) {
        window.parent.postMessage({ type: 'od:sandbox:confirm', message: String(msg) }, '*');
        return false;
      };
      window.open = function(url) {
        window.parent.postMessage({ type: 'od:sandbox:open', url: String(url) }, '*');
        return null;
      };
      
      // 监听错误
      window.addEventListener('error', function(e) {
        window.parent.postMessage({
          type: 'od:sandbox:error',
          message: e.message,
          filename: e.filename,
          lineno: e.lineno
        }, '*');
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
 * 监听 `od:srcdoc-transport-activate` 消息。
 * 当 Claude Code CLI 持续生成/修改代码时，无需重载 iframe 导致白屏闪烁，
 * 而是直接通过 document.open() / write() 将新代码灌入。
 */
function injectSrcdocTransportActivationBridge(html: string): string {
  const transportScript = `
  <script id="od-transport-bridge">
    window.addEventListener('message', function(event) {
      const msg = event.data;
      if (msg && msg.type === 'od:srcdoc-transport-activate') {
        const newHtml = msg.html;
        if (!newHtml) return;
        
        // 执行无闪烁局部替换
        document.open();
        document.write(newHtml);
        document.close();
      }
    });
    // 向宿主发送已准备就绪事件
    window.parent.postMessage({ type: 'od:sandbox:ready' }, '*');
  </script>
  `;

  // 注入到 <body> 结尾前
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${transportScript}</body>`);
  }
  return html + transportScript;
}

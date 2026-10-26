/**
 * 文档级 CSP 的下发改写 — 主进程两条链路共用（GenUI 沙箱资源、H5 父页面）。
 *
 * 浏览器对同一个文档会**同时执行** `<meta>` 与 `Content-Security-Policy` 响应头里的策略，
 * 取交集。所以逐响应注入的 nonce 必须落到文档自己那条 meta 上：只换响应头，
 * 构建产物里烧死的 meta 会把 nonce 授权的内联脚本连同自身策略一起继续拦着。
 */

/** meta 可能是多行写法（沙箱产物就是），`[^>]*` 能吃掉换行，直到第一个 `>` 收尾。 */
const CSP_META_PATTERN = /<meta\s[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 把文档里的 CSP meta 换成 `csp`；没有 meta 就补一条，而不是静默下发无策略页面。
 * 补的位置：`<head>` 之后；连 `<head>` 都没有时只能放在文档最前，此时 `<!doctype>`
 * 会被挤到策略之后 —— 那种文档本来也不归这条链路服务。
 */
export function withCspMeta(html: string, csp: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}" />`
  if (CSP_META_PATTERN.test(html)) return html.replace(CSP_META_PATTERN, meta)
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (open) => `${open}${meta}`)
  return `${meta}${html}`
}

/**
 * 产物预览专用源的跨端契约（Issue #63）。
 *
 * 预览文档不再挂在渲染端的 srcdoc 或随机 HTTP 端口上：srcdoc 会继承宿主 CSP，
 * 随机端口无法写进静态 `frame-src`。改成固定自定义源后，宿主只需在 CSP 里放行
 * 这一个源，预览文档也拿到自己的 origin 与自己的策略。
 *
 * scheme 必须在 app ready 之前注册为 standard + secure；处理器按**主窗口实际使用的
 * session** 注册（顶层 `protocol` 只覆盖默认 session）。
 */

export const PREVIEW_SCHEME = 'spacecode-preview'

/** standard scheme 的 host 参与 origin 计算，必须固定。 */
export const PREVIEW_HOST = 'artifact'

/** 精确源；宿主 `frame-src` 只放行它，不用 `http://127.0.0.1:*` 这种宽端口。 */
export const PREVIEW_ORIGIN = `${PREVIEW_SCHEME}://${PREVIEW_HOST}`

/**
 * 预览文档自己的策略：只约束"沙箱里能做什么"，不限制资源类型。
 *
 * - `sandbox` 必须走响应头才生效（meta 里的 sandbox 指令会被忽略），且脚本无法摘除；
 *   顶层导航、表单、下载仍然被禁止。
 * - `allow-same-origin` 让文档保住 `spacecode-preview://artifact` 这个跨源 origin：
 *   module script、字体与同源 fetch 都依赖它；它拿不到宿主 DOM / 存储。
 * - 其余指令一概不写，产物里的 inline / external / eval 由这个源自己承担，
 *   宿主 `script-src 'self'` 不受影响。
 */
export const PREVIEW_CSP = 'sandbox allow-scripts allow-same-origin allow-popups'

/** 宿主构建 iframe URL 时带上的桥参数；主进程据此给文档注入桥。 */
export const PREVIEW_NONCE_PARAM = '__sp_nonce'
export const PREVIEW_HOST_ORIGIN_PARAM = '__sp_host'

/** `spacecode-preview://artifact/<token>/<rel>`；rel 已按路径段编码。 */
export function buildPreviewFrameUrl(token: string, relPath: string): string {
  return `${PREVIEW_ORIGIN}/${encodeURIComponent(token)}/${relPath}`
}

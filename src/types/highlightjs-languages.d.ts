/**
 * highlight.js 语言子模块无独立类型声明（exports map 未提供 types），
 * 统一声明为 LanguageFn。
 */
declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js'

  const language: LanguageFn
  export default language
}

/** `lib/common` 子路径同样未提供 types，运行时导出默认 hljs 实例（36 种常用语言）。 */
declare module 'highlight.js/lib/common' {
  import type { HLJSApi } from 'highlight.js'

  const hljs: HLJSApi
  export default hljs
}

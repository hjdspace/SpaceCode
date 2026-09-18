/**
 * highlight.js 语言子模块无独立类型声明（exports map 未提供 types），
 * 统一声明为 LanguageFn。
 */
declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js'

  const language: LanguageFn
  export default language
}

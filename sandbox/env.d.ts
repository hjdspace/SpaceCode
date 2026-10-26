/**
 * 构建期常量，由 `scripts/genui-sandbox-build.mjs` 的 esbuild `define` 注入。
 *
 * 生产产物里它是字面量 `false`，调试卡与承载自检那一整块随之被死代码消除（票 09 第 2 条）；
 * 开发期 watch 构建注入 `true`，`npm run dev` 下仍能用肉眼复核 opaque origin、
 * `connect-src 'none'` 与 `unsafe-eval` 这几条承载前提。
 */
declare const __GENUI_DEBUG__: boolean

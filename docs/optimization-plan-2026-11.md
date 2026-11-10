# SpaceCode 优化方案（2026-11）

工单：ticket-2cb34950 · 分析范围：整个仓库 · 方法：只读分析（构建产物测量 + 源码取证），无代码改动。

## 现状快照（证据）

> 下表是 11-07 的基线。P0-1/2/3 已于 11-08 落地（`dist` CSS 实测已降至 1.2 MB / 86 文件，`:root` 令牌不再逐 chunk 重复），P1 三项的落地结果见文末《落地记录》。

| 指标 | 数值 | 来源 |
|---|---|---|
| dist CSS 总量 | **4.1 MB / 86 个文件** | `dist/assets/*.css` 实测（11-07 构建） |
| 其中 `:root` 设计令牌重复 | **934 KB，85/86 个 CSS 文件各含一份** | 逐文件 `:root{...}` 统计 |
| dist JS 总量 | 8.0 MB；`main` 1.19 MB、`es-*` 921 KB、`stores-chat` 755 KB、cytoscape 435 KB、katex 259 KB | `dist/assets/*.js` 实测 |
| 最大源码文件 | `src/stores/chatSession.ts` 120 KB、`turn/eventHandlers.ts` 84 KB、`ChatPanel.vue` 83 KB、`AgentTimeline.vue` 80 KB、`ChatInput.vue` 75 KB、`turn/index.ts` 71 KB | `wc -c` |
| `any` 使用 | 278 处 / 69 个非测试源文件（`src/**`，正则 `:any`/`<any>`/`as any`/`[any]`）；热点 `turn/eventHandlers` 41、`services/h5Adapter` 24、`turn/index` 22 | grep |
| preload 面 | 单对象 `electronAPI`，309 处 IPC 引用 | `electron/preload.ts:119` |
| 测试规模 | 642 个测试文件；覆盖率棘轮：整体 38% statements / 33% branches（目录级下界 45–88%） | `vitest.config.ts` |
| CI | 仅 `npm run test:coverage`（无类型检查、无构建、无 lint） | `.github/workflows/test.yml` |

## P0 — 高杠杆、低风险

### 1. 消除 CSS 设计令牌重复（-934 KB CSS）
- **根因**：`vite.config.mts` 的 `additionalData` 把 `@use "@/styles/variables" as *` 注入每个 SFC 编译单元，`_variables.scss:54` 的 `:root{}` 令牌块随每个 chunk 的 CSS 重复发射 85 次。
- **方案**：令牌块只进入口 CSS 一次 —— 把 `:root` 令牌从 `@use` 链路挪出（改为独立 CSS/入口 `global.scss` 显式引入），SFC 只消费 `var(--*)`；`additionalData` 保留 mixins（不产 CSS 就不重复）。
- **验证**：`npm run build` 后 `dist/assets/*.css` 总字节应 < 3.3 MB；各 chunk CSS 中 `:root` 仅入口一份；暗色主题下展开下拉弹层确认令牌仍生效（含 `[data-theme='dark']`/`anthropic-dark`）。
- **注意**：共享工作区 `_variables.scss` 有未提交改动，落地前需先核对（可能正是同一问题）。

### 2. CI 补类型检查与构建门禁
- **现状**：PR 只跑 vitest；`vue-tsc --noEmit` 与 vite build 失败不会挡 PR。
- **方案**：`test.yml` 增加 `typecheck`（`npm run typecheck`）与 `build`（`npm run build`）两个 job（可矩阵并行）。
- **验证**：故意引入类型错误的 PR 被 CI 挡下。

### 3. 把性能棘轮接入构建/CI
- **现状**：`scripts/check-build-performance.cjs` 已存在（量入口脚本字节）但无人调用。
- **方案**：build 后执行 `npm run check:performance`，阈值棘轮化（只降不升），并覆盖 P0-1 后的 CSS 总量。
- **验证**：阈值上调的 PR 必须同时提交产物减重。

## P1 — 渲染端与主进程性能

### 4. xterm / highlight.js 等高负载依赖按需装载 ✅ 已落地
- **证据**：`main-*.js` 1.19 MB 内含 xterm（93 处签名），xterm 单独 minify 约 475 KB；静态链路是 `SplitContainer → TerminalHost → TerminalContainer`（`TerminalHost` 为跨 pane 保活而常驻）。
- **补充证据（原文档遗漏）**：全量 highlight.js（190 种语言，899 KB）在独立 `es-*.js` chunk 中，被 `index.html` modulepreload 预载。导入点是 `MarkdownRenderer` / `CodeViewer` / `MarkdownViewer` / `ToolDiffViewer` / `StreamingCodeBlock` 五处 `import hljs from 'highlight.js'`，其中 `MarkdownRenderer` 经 ChatPanel 静态链直接进入首载。
- **方案**：
  - 4a：`TerminalHost` 用 `defineAsyncComponent(() => import('../terminal/TerminalContainer.vue'))`，首个 terminal pane 出现时才拉取 xterm chunk；挂载后常驻，保活语义不变。
  - 4b：五处改为 `import hljs from 'highlight.js/lib/common'`（36 种常用语言，minify 160 KB），并补 `highlight.js/lib/common` 的模块声明。不使用 `resolve.alias` 整包重定向，避免误伤 `highlight.js/lib/languages/*`。
- **收益实测（构建后）**：`main-*.js` 1,193 KB → **839 kB**（-354 KB）；xterm 移入独立懒 chunk `TerminalContainer-*.js`（329 kB）；highlight.js 由 899 KB 的全量 chunk 降为 **151 KB** 的 `common-*.js`（-748 KB）；`es-*.js` 已不存在。
- **验证**：`dist/assets/main-*.js` 降至 < 900 KB；`es-*.js` 从 899 KB 降至约 160 KB；终端首次打开可用、切 pane 不重建；Markdown/代码卡片高亮正常。

### 5. i18n 双语言立即打包 → 仅装载激活语言 ✅ 已落地
- **证据**：`src/i18n/index.ts:2-3` 立即 import 两套 locale（minify 后 zh-CN 263 KB、en-US 180 KB）。实测两份语言包都落在 `stores-chat` chunk（739 KB，约占 60%），而非 main —— 原因是 `chatSession.ts` 直接 `import { messages } from '@/i18n'` 并在模块加载时 `Object.values(messages)` 收集占位标题，被 codeSplitting 归入该 group；`index.html` 预载该 chunk，因此未激活语言确实被白白加载。
- **方案**：
  - 入口只同步打包 zh-CN；`loadLocale()` 在需要时 `import('./locales/en-US/index')` 并 `setLocaleMessage`。
  - `applyLocale` 改为异步；`main.ts` 改为 `bootstrap()` 内先 `await applyLocale(getSavedLanguage())` 再 mount；settings 的语言 watcher 改为 `void applyLocale(next)` 且**去掉 `immediate: true`**（初始语言已由 `main.ts` 在 mount 前应用，watcher 只需响应异步配置读取与用户切换；保留 immediate 会让测试环境在每个 worker 创建 store 时触发 en-US 动态 import，导致超时与 teardown 后仍 import 的报错）。
  - 切断 `chatSession` 对全量 `messages` 的依赖，改为直接读取两份 `locales/*/common` 小模块的 `common.newChat`，保留跨语言占位标题判定。
  - 依赖 locale key 对齐测试（`tests/i18n/localeParity.test.ts`）兜底 fallback 语义。
  - 两个 genui 测试改为直接 import 两套 locale 构造 `messages`；`errorHandler` 英文用例改为 `await loadLocale('en-US')` 后再断言。
- **收益实测（构建后）**：`stores-chat-*.js` 739 KB → **561 kB**（-178 KB）；en-US 不再进入首载图，zh-CN 作为默认语言仍随入口打包。
- **验证**：构建后 `stores-chat` 总量显著下降；中英切换后文案即时正确；`tests/i18n` 全绿。

### 6. 主进程：H5Server 动态导入 ✅ 已落地
- **证据修正**：`electron/main.ts:82` 静态 import `H5Server` 属实，且启动分支（L374-388）确实只在 settings 开启时启动；但 `electron/ipc/h5IpcHandlers.ts:10` **也**静态导入 `H5Server`，而 main.ts 静态导入该 handler —— 只改 main.ts 一处不会移出主包。另外 h5Server 只用 `http` + `ws`，**没有 express**（package.json 中的 express 依赖不被 h5 链路引用）。`ws` 同时被 `mobileIpcHandlers → MobileServer` 与 `imSidecarManager → ImServer` 静态拖住。
- **方案**：
  - `h5IpcHandlers` 改为 `import type { H5Server }`，仅在 `h5:enable` / `h5:regenerateToken` 的异步回调内 `await import('../h5/h5Server')`。
  - `electron/main.ts` 删除静态导入，自动启动分支内动态导入。
  - 不追求移除 `ws`：除非同时懒载 MobileServer / ImServer，否则单改 H5 无法让 ws 离开主包；验证标准相应调整。
- **收益实测（构建后）**：`dist-electron/main.js` 1,149 KB → **1,064 KB**（-85 KB），并新增独立 `h5Server-*.js`（23.5 kB，仅启用时加载）；`ws` 被 rolldown 抽到共享 `wrapper-*.js`（64 KB），因 MobileServer / ImServer 仍静态可达，启动路径净减约 21 KB —— 与「不追求移除 ws」的取舍一致。
- **验证**：`dist-electron` 出现独立 `h5Server-*.js` chunk；H5 未开启时进程不加载该 chunk；开启后服务正常启动。

## P2 — 可维护性

### 7. turn 事件处理器拆分
- `eventHandlers.ts` 84 KB + 40 处 `any`，是全仓最重的单一文件。已做批量化 patch 设计（`flushContentPatch`），保留；按事件域拆为 3–4 个文件（assistant / tool / system），各自导出注册函数。
- 验证：`npm run test:changed` 全绿；行数拆分后单文件 < 40 KB。

### 8. 其他 god 文件
- `chatSession.ts` 120 KB：按「会话生命周期 / 消息操作 / rewind / teammate」切片（注释显示已有四片思路，覆盖率注释同）。
- `App.vue` 32 KB：页面已 `lazyPage` 懒载（好），剩余是全局快捷键 + H5 mirror 初始化，可抽 composable（`useGlobalKeydown`、`useH5Mirror`）。
- `ChatPanel.vue` 83 KB / `AgentTimeline.vue` 80 KB / `ChatInput.vue` 75 KB：各自抽子组件；优先 AgentTimeline（渲染热点）。

### 9. preload 面域分割
- 309 个引用挤在单个 `electronAPI`；`shared/channelMap.ts` 已有类型化 channel 注册。方案：按域拆 preload 注入对象（chat / terminal / settings / tools…），renderer 侧 `services/electronAPI` 同步分域，减少单点回归面。

### 10. 类型收紧与覆盖率棘轮上调
- 热点收敛顺序：`h5Adapter`（24）→ `turn/index`（22）→ `sessionRestore`（21）/`sessionPersistence`（20）。用精确类型替换 `any`，顺带暴露 h5 远程消息契约缺口。
- `noUnusedLocals`/`noUnusedParameters` 开为 true（tsconfig 当前为 false，死代码静默通过）。
- 覆盖率下界按季度各抬 3–5 点，与补测同批提交（AGENTS.md 棘轮规则）。

## 不建议做（评估后排除）

- **mermaid/cytoscape/katex 重组**：已是独立懒载 chunk（mermaid 662 KB 在 `chunk-FOHPRMQF`），无进一步收益。
- **重写流式渲染**：turn store 已有 `flushContentPatch` 批量 patch，不是逐 token 全量重渲染。
- **engine/ 子项目**：只读约束，不进优化范围。

## 落地顺序建议

P0-1（CSS 减重）→ P0-2/3（门禁+棘轮）→ P1-4/5（首载 JS 减重）→ P1-6（主进程）→ P2 随功能迭代顺带做。
P0-1 落地后 P1 项的收益可用 `check:performance` 棘轮钉住不回退。P1 三项已于 2026-11-08 落地，产物见下节。

## 落地记录（2026-11-08）

| 产物 | 落地前 | 落地后 | 变化 |
|---|---|---|---|
| `dist/assets/main-*.js` | 1,193 KB | **839 kB** | -354 KB |
| xterm | 在 main 内 | `TerminalContainer-*.js` 329 kB（懒载） | main 归零 |
| highlight.js | `es-*.js` 899 KB（预载） | `common-*.js` 151 KB（预载） | -748 KB |
| `dist/assets/stores-chat-*.js` | 739 KB | **561 kB** | -178 KB |
| `dist-electron/main.js` | 1,149 KB | **1,064 KB** | -85 KB |
| 主进程 h5Server | 在 main 内 | `h5Server-*.js` 23 kB（按需） | 启动路径净 -21 KB（ws 仍在 `wrapper-*.js`） |

行为校验要求：终端首次打开可用且切 pane 不重建；Markdown/代码卡片高亮正常；中英切换即时生效；H5 开关可正常启动服务。验证命令：`npm run test:changed` + `npm run build`。

## 共享工作区提示

撰写时工作区已有未提交改动（清单随时间增长，实施前以最新 `git status` 为准）：`electron/superAgent/*`（9 文件）、`electron/h5/h5Types.ts`、`src/stores/turn/eventHandlers.ts`、`src/components/superAgent/RouterWorkBadge.vue`、`src/styles/_variables.scss`，以及 `docs/design/super-agent-implementation-plan.md` 与两个 superAgent 相关测试。其中 `_variables.scss` 与 P0-1 直接相关、`eventHandlers.ts` 与 P2-7 相关 —— 实施前先 `git diff` 核对是否已在处理同一问题。

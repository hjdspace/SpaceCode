# GUI 性能优化方案 — 调试追踪 / 技能页面卡顿根治

> 2026-10-16 · 基于对当前代码与 `dist/` 产物的全链路分析  
> 症状：初次打开桌面后，点击「调试追踪」页面白屏十几秒；点击「技能」页面也需较长时间才显示。

---

## 一、结论速览

| # | 问题                                                                                                | 位置                                                                                 | 影响                                        | 优先级 |
| - | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- | --- |
| 1 | `trace:list` 每次请求读**两遍**全部 trace 文件 + 解析 50×5000 条 JSON，且每 5s 轮询重做，全部跑在主进程                        | `electron/infra/logger.ts:257`、`electron/ipc/traceIpc.ts:119`                      | 打开追踪页十几秒白屏；页面开着时主进程周期性阻塞，**整个 GUI 周期性卡顿** | P0  |
| 2 | `TraceViewer` 等异步组件无 `loadingComponent`，chunk 加载期真白屏                                              | `src/App.vue:119` 等                                                                | 白屏观感的直接原因                                 | P0  |
| 3 | 追踪详情页每 1.5s 全量重读文件 + 全量重建 viewModel + 整棵 span 树重渲染                                                | `src/components/debug/TraceSessionPage.vue:343`                                    | 详情页开着时主进程与渲染进程双重周期性负担                     | P0  |
| 4 | 技能管理器 7 个子页面打进单 chunk（194KB JS + 408KB CSS），首次打开一次性加载解析                                           | `src/components/skill_manager/SkillManagerShell.vue:27-34`                         | 点击技能后首屏渲染慢                                | P1  |
| 5 | 技能 store 初始化串行 3 次 IPC，且 `bootstrap()`→`init()` 的返回值被丢弃后又发一次 `getOverview`；重扫描 handler 为同步函数阻塞主进程 | `src/stores/skillManagerStore.ts:132-155`、`electron/skillManagerV2/index.ts:64-79` | 首开技能页多一整轮 IPC 往返 + 主进程阻塞                  | P1  |
| 6 | 主 bundle 1.1MB JS + 678KB CSS                                                                     | `dist/assets/main-*.js/css`                                                        | 首屏*启动成本偏高（与已知 e*xe 启动慢问题叠加）               | P2  |

---

## 二、根因分析

### 2.1 调试追踪页面：十几秒白屏（问题 1 + 2 + 3 叠加）

**数据管道的实际成本**（`trace:list` 一次调用）：

```
TraceListPage.load()                     (每 5s 轮询一次, silent 模式也全量重做)
  └→ ipcMain.handle('trace:list')
       ├→ listTraceSessions()                      ← 第一遍读文件
       │    readdir(traceDir)
       │    for 每个文件:
       │      stat(path)                            OK
       │      readFile(path, 'utf8')               ★ 全文读取，只为数行数
       │      content.split(/\r?\n/).filter(Boolean).length
       │      → eventCount 字段【无任何生产消费者，纯浪费】
       │
       └→ 对分页后 50 个 session 逐个:
            readTraceEvents(sid, 5000)              ← 第二遍读同一个文件
              readFile(filePath, 'utf8')           ★ 全文读取
              content.split(...)                    ★ 同步 CPU（主进程事件循环）
              .slice(-5000).map(JSON.parse)        ★ 5000 行 JSON.parse × 50 个文件
            evts.filter(isLlmCallEvent).map(eventToCallRecord)
            buildTraceSummary(...)
```

- 一次 `trace:list` = **目录内所有文件读一遍 + 前 50 个 session 文件再读一遍并 parse**。  
  每个 trace 文件是整个会话的 JSONL，长会话可达数 MB～数十 MB。几十个 session 累计轻松上百 MB 的读取与数十万行 `JSON.parse`。
- `readFile` 虽是异步，但 `split` / `JSON.parse` / `JSON.stringify`（`eventToCallRecord` 里对 input/output 各做一次）都是**同步 CPU，跑在主进程事件循环里**，单次执行可持续数秒。
- 主进程被阻塞期间：所有 IPC 排队、窗口事件无响应、**渲染进程的 file:// 静态资源请求也被阻塞**（Electron 的 file:// 由主进程侧 network service 处理）——这就是"页面白屏十几秒"而不是"显示 loading 十几秒"的原因之一。
- 前端 `POLL_MS = 5000`：只要追踪列表页在前台，上述全部工作每 5 秒重做一遍 → 即使页面刷出来了，整个 GUI 也会周期性掉帧、输入卡顿。

**白屏的 UI 层原因**：

```ts
// src/App.vue:119 — 无 loadingComponent，chunk 未就绪时渲染空
const TraceViewer = defineAsyncComponent(() => import('./components/debug/TraceViewer.vue'))
```

同样缺 `loadingComponent` 的还有：`AgentManager`、`McpManager`、`CronManager`、`WorkAssistantGallery`、`DesignPage`、`WorkspaceOnboarding`、`ConnectMobileDialog`、`FileQuickOpen`（`SettingsPanel` / `SkillsManager` / `OldSkillsManager` / `InfoPanel` 已正确配置）。

**详情页的持续负担**（`TraceSessionPage.vue`）：

```ts
pollTimer = setInterval(() => { loadData() }, 1500)   // :343
```

`loadData()` 每次：主进程全文重读 + parse 5000 条 → 渲染进程 `buildTraceViewModel(result.events)` 全量重建 viewModel → 整棵 turn/span 树重新 diff 渲染。数据没有任何变化时也照做，1.5s 一轮。

### 2.2 技能页面（问题 4 + 5）

1. **单 chunk 全量打包**：`SkillManagerShell.vue` 同步 import 7 个子页面（Settings/Library/DetailSlider/Install/Diagnosis/AgentManagement/Pack/BuiltinPacks），产物为 194KB JS + **408KB CSS**，首次点击需一次性下载、解析、构建样式表，再一次性渲染。  
   （`App.vue` onMounted 已有 `void loadSkillsManager()` 预热 chunk，但 408KB CSS 的解析与首屏组件树的构建仍在点击时发生。）
2. **初始化串行链**：`store.init()` = `await sm.bootstrap()` → `await sm.init()` → `await loadOverview()`，三次 IPC 串行往返；且 `sm.init()`（`initScan()`）**本身返回完整 overview，但返回值被丢弃**，紧接着又发一次 `getOverview` —— 白白多一整轮。
3. **主进程同步 handler**：`skill-manager:*` 的 handler 全部是同步函数。`initScan()`（扫描中心库目录）、`refresh()`（对每个 agent 的技能目录做 hash 全扫，注释自述 "heavier"）、`SkillManagerService.bootstrap()`（`mkdirSync` + better-sqlite3 同步建库/seed）都直接占住主进程事件循环。渲染端的 `refreshAgentInventoryInBackground()` 所谓"后台"只是渲染端不 await，**主进程 handler 依旧同步阻塞**——技能页首次打开后，主进程仍会被后台全量扫描卡住数秒，殃及所有窗口交互。

### 2.3 全局（问题 6）

- `dist/assets/main-*.js` 1.1MB + `main.css` 678KB（以 chat/terminal 样式为主）。本地 file:// 下不算致命，但与已知的 exe 启动慢问题叠加，推迟首屏可交互时间。
- `stores-chat` 502KB chunk、`chunk-FOHPRMQF` 646KB（highlight/markdown 族）均被首屏聊天主界面同步需要，属合理但可继续瘦身。
- mermaid（899KB es-parser + 各 diagram 子包）与 cytoscape（424KB）已通过动态 import 懒加载，**不是**本次卡顿的因素。

---

## 三、优化方案（按优先级，均不影响功能）

### P0-1 重构 trace 读取管道：缓存 + 免重复读 + 摘要侧车（核心，预期 `trace:list` 从十几秒 → <100ms）

改动集中在 `electron/infra/logger.ts` + `electron/ipc/traceIpc.ts`：

1. **删除 `listTraceSessions` 里的全文读取**：`eventCount` 无消费者，`readFile + split` 整段删掉，只保留 `readdir + stat`（毫秒级）。
2. **请求内去重**：`trace:list` 中 `listTraceSessions` 与 `readTraceEvents` 目前各读一遍同一文件，改为共享同一次读取结果（传入 content 或按 sessionId 一次性读）。
3. **跨请求缓存（mtime+size 失效）**：主进程维护
   ```ts
   Map<sessionId, { mtimeMs: number; size: number; summary: TraceSummary }>
   ```
   轮询命中缓存时只做 `stat` 比对，未变化直接返回缓存 summary，零读取零解析。
4. **摘要侧车（中期，进一步治本）**：trace 事件落盘时（`logger.ts` 写入点）同步维护 `session-<id>.summary.json`（apiCalls/failedCalls/duration/tokens/models，增量更新）。`trace:list` 彻底不再解析事件文件，只读几百字节的 sidecar。此步依赖写侧改造，可单独成 PR。
5. **解析移出主进程事件循环**：把「读文件 → split → JSON.parse → 聚合」整体挪进 `worker_threads`（或 Electron `utilityProcess`）。主进程只做调度，保证 trace 页面再重也**绝不冻结全局 UI**。文件本身较大时按行分批 parse、`setImmediate` 让步可作为过渡方案，但 worker 是正解。

### P0-2 轮询策略修复

- `TraceListPage`（`src/components/debug/TraceListPage.vue:215`）：
  - `POLL_MS` 5000 → 至少 15000~30000；
  - 或改为**主进程 `fs.watch(traceDir)` 推送**（`webContents.send('trace:changed')`），前端仅在收到变更后刷新——与 P0-1 缓存配合后，轮询成本只剩 `stat`。
  - `document.hidden`（窗口最小化/切后台）时暂停轮询。
- `TraceSessionPage`（`:343`）：
  - 1500ms 全量重拉改为：先 `stat` 比对 mtime/size（新增轻量 `trace:statSession` IPC），没变直接跳过；变了再全量读。
  - `buildTraceViewModel` 支持增量：只 append 新事件对应的 turn/span，避免整棵树重建重渲染。
  - 轮询间隔放宽至 3~5s 或同样改 watcher 推送。

### P0-3 异步组件统一 loading/error 组件（消除一切"chunk 期白屏"）

`src/App.vue` 中为所有 `defineAsyncComponent` 补齐配置，建议抽一个 helper：

```ts
function lazyPage(loader: () => Promise<Component>) {
  return defineAsyncComponent({
    loader,
    loadingComponent: AsyncLoadingState,   // 复用现有的
    delay: 0,
    timeout: 15000,
    errorComponent: AsyncLoadError,        // 新增：加载失败给重试入口
  })
}
```

覆盖：`TraceViewer`、`AgentManager`、`McpManager`、`CronManager`、`WorkAssistantGallery`、`DesignPage`、`WorkspaceOnboarding`、`ConnectMobileDialog`、`FileQuickOpen`。  
另参照 `loadInfoPanel` 的空闲预热模式，把 `TraceViewer`（仅 38KB，依赖的 stores-chat 首屏已加载）也加入 `requestIdleCallback` 预热列表——白屏窗口直接归零。

### P1-1 技能管理器子页面按需加载

`SkillManagerShell.vue`：左栏 7 个 tab 对应的子页面改为 `defineAsyncComponent`（或 `component :is` + 静态映射）。首次打开只加载 `SkillLibraryPage` 一页的 JS+CSS，其余 tab 首次点击时加载（chunk 均为本地文件，点击后亚秒级）。408KB CSS 随之拆散。

### P1-2 技能初始化链路收敛

1. `skillManagerStore.init()`：删除独立的 `sm.bootstrap()` 调用（`BOOTSTRAP` handler 只做 `getService()`，可与 `INIT` 合并），**直接使用 `sm.init()` 返回的 overview**，删掉紧随的 `loadOverview()` —— 3 次 IPC → 1 次。
2. `electron/skillManagerV2/index.ts`：`refresh`（hash 全扫）等重 handler 移入 `worker_threads`/`utilityProcess` 执行，主进程 handler 变成真正的异步等待；或至少在扫描循环中插入 `setImmediate` 让步，避免数秒级独占事件循环。

### P2 全局体积（可与已知启动优化合并）

- 主 bundle 审计：将非首屏必需的模块（如 `CronManager` 相关 store、design 工具等）继续懒加载化。
- `stores-chat` 502KB：检查其中是否混入可拆的历史消息构建/工具渲染逻辑。
- 上述均为收益递减项，建议在 P0/P1 落地、用真实 profile 数据验证后再动。

---

## 四、验证方式

1. **基线测量**：在 `trace:list` handler 计时打点（用户惯用时间戳日志），记录当前 P50/P95。
2. 每项改动后：
   ```sh
   npm run build   # 含 vue-tsc 类型检查
   npm run test    # vitest 全量（注意：electron 侧 fs 重测试需单文件复核，避免沙箱并行假超时）
   ```
   trace 相关已有测试：`electron/ipc/__tests__/traceIpc.duration.test.ts`、`src/lib/trace/__tests__`，缓存改动需补「mtime 未变命中缓存 / 变化后失效」用例。
3. **手工场景**：
   - 构造 ≥50 个 session、单文件 ≥5MB 的 trace 目录，打开追踪页应 <1s 出列表，且打开期间聊天窗口打字不掉帧；
   - 追踪页停留 1 分钟，观察主进程 CPU（任务管理器）无 5s 周期尖峰；
   - 详情页停留期间，未产生新事件的会话不再触发重渲染（Vue devtools 高亮不闪）；
   - 技能页首开时间对比；切各 tab 功能正常。

## 五、建议实施顺序

```
PR-1 (P0-3): 异步组件 loading 统一 + TraceViewer 预热          —— 半天，立竿见影消除白屏
PR-2 (P0-1a): listTraceSessions 删全文读 + 请求内去重 + 缓存    —— 一天，消除十几秒根因
PR-3 (P0-2): 轮询节流 / mtime 前置检查                         —— 半天
PR-4 (P1-2): 技能初始化 3→1 次 IPC + 重扫描异步化               —— 一天
PR-5 (P1-1): 技能子页面按 tab 懒加载                            —— 一天
PR-6 (P0-1b): worker 化解析 + summary 侧车（可拆两个 PR）       —— 两天，彻底根治
```

PR-1 + PR-2 合入即可让"点击调试追踪白屏十几秒"降为"亚秒级出 loading、一两秒出数据"；PR-6 之后数据侧达到 <100ms。


---

## 六、实施记录

| PR | 状态 | 说明 |
| -- | ---- | ---- |
| PR-1 | ✅ 2026-10-17 | lazyPage() helper + 9 组件统一 loading + TraceViewer 空闲预热 |
| PR-2 | ✅ 2026-10-17 | listTraceSessions 删全文读 + trace:statSession |
| PR-3 | ✅ 2026-10-17 | 列表页 5s→15s + hidden 暂停；详情页 stat 前置比对 |
| PR-4 | ✅ 2026-10-17 | 技能初始化 3 次 IPC → 1 次 |
| PR-5 | ✅ 2026-10-17 | 技能子页面按 tab 懒加载（408KB CSS → 72KB 首开） |
| PR-6 | ✅ 2026-10-17 | traceAggregate（增量=全量同源）/ traceParseWorker（eval 内联，spawn 失败回退主线程）/ traceSidecar（内存态+磁盘侧车+stat 校验+截断重建）。trace:list 命中内存态时零读取零解析；冷启动走 worker 全量回填一次后归零。侧车口径为完整历史（长会话 >5000 条时 list 的 totalDurationMs 不再被截断缩小，属修正而非回归）。 |

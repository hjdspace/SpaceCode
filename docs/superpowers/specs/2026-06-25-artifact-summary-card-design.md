# 产物汇总卡片（办公模式）设计

> 状态：已与用户确认设计，待评审 spec 后进入实现计划。
> 日期：2026-06-25

## 1. 背景与目标

办公模式（`session.mode === 'work'`）下，专业助手完成任务后会把成果文件写入 `<cwd>/outputs/`。
目前用户只能在右侧 `ArtifactsPanel`（"产物"标签）里看到这些文件。

**目标**：在对话流里，每个**产生了产物的助手回合**结束后，内联插入一张"产物汇总"卡片，
列出本回合新生成/修改的产物文件，用户**一键点击即可打开**：

- `.html` / `.htm` → 在右侧内置浏览器（`InfoPanel` 的 `<webview>`）面板打开。
- `.pptx` / `.docx` / `.xlsx` / `.pdf` 等 → 调用系统默认程序打开。

## 2. 范围（已确认）

- **卡片粒度**：每个回合一张卡片。只在该回合**实际产生了产物**时渲染。
- **产物判定**：对比 `outputs/` 目录的 mtime 快照（基于回合开始时间），而非解析工具调用。
- **仅办公模式**：`code` 模式不采集、不渲染。
- **不改动** 现有 `ArtifactsPanel` 的轮询/自动预览逻辑（避免越界改动）。

## 3. 复用的现有基础设施（无需新建）

| 能力 | 位置 |
|---|---|
| 列产物 `api.artifacts.list(dir)` → `{ artifacts: ArtifactEntry[] }` | `src/services/electronAPI.ts:398`，IPC `electron/artifactsService.ts:81` |
| 外部程序打开 `api.artifacts.open(path)` → `shell.openPath` | `electron/artifactsService.ts:85` |
| 在文件夹显示 `api.artifacts.reveal(path)` → `shell.showItemInFolder` | `electron/artifactsService.ts:91` |
| HTML 内置浏览器打开 `appStore.openFileInWebview(path)` | `src/stores/app.ts` |
| `ArtifactEntry { name, path, ext, size, mtime }` | `src/services/electronAPI.ts:10` |
| 回合开始时间 `ts.sendStartTime`、回合助手消息 `ts.assistantMessageId` | `src/stores/chatStream.ts:182` `beginTurn` |
| 回合完成钩子 `handleResult`（已设置 `msg.metadata`、调用 `saveToStorage()`） | `src/stores/chatStream.ts:644` |
| 内联卡片渲染范式 `buildDisplayItems` + `DisplayItem` | `src/components/chat/MessageList.vue:157` |
| 卡片视觉范式 | `src/components/chat/CurrentTurnChangeCard.vue` |

## 4. 详细设计

### 4.1 数据模型（持久化随消息走）

在 `src/types/index.ts` 的 `MessageMetadata`（line 116）新增可选字段：

```ts
export interface MessageMetadata {
  // ... 现有字段 ...
  /** 办公模式：本回合新生成/修改的产物文件（仅 work 模式会话写入）。 */
  artifacts?: ArtifactSummaryEntry[]
}

/** 产物汇总卡片的单条文件项（ArtifactEntry 的精简快照，随消息持久化）。 */
export interface ArtifactSummaryEntry {
  name: string
  path: string
  ext: string
  size: number
  mtime: number
}
```

> 字段为可选，旧消息无该字段时不渲染卡片，向后兼容。
> 形态与 `electronAPI.ts` 的 `ArtifactEntry` 一致，可直接赋值。

### 4.2 产物采集（`chatStream.ts handleResult`）

在 `handleResult` 内、`msg.metadata = { ... }` 之后、`saveToStorage()` 之前/附近，
增加一段**仅办公模式**执行的异步采集（fire-and-forget，不阻塞回合结束）：

逻辑：
1. 判定 `s.mode === 'work'`，否则跳过。
2. 取工作目录（`s.cwd` / `chatStore.workingDirectory`）。
3. `const { artifacts } = await api.artifacts.list(workingDir)`。
4. 过滤 `a.mtime >= ts.sendStartTime - 1000`（1s 容差，与 `ArtifactsPanel` 现有约定一致）
   → 即"本回合新生成或被修改"的产物（旧回合产物 mtime 早于本回合开始，自然排除）。
5. 若结果非空：`msg.metadata.artifacts = list`，再 `saveToStorage()`。

> 采集为异步：`handleResult` 当前是同步函数，采集逻辑放进一个 `void (async () => { ... })()`，
> 完成后回写并持久化即可。回合结束时工具已全部完成，`outputs/` 文件已落盘。

边界：
- `list` 为空或无 work 模式 → 不写 `artifacts`，不渲染卡片。
- `api.artifacts.list` 失败 → `catch` 后静默（与 `ArtifactsPanel` 一致），不影响回合。

### 4.3 卡片渲染（`MessageList.vue`）

- `DisplayItem` 类型新增 `'artifact-card'`，并携带产物数据：

```ts
interface DisplayItem {
  type: 'user-group' | 'assistant-group' | 'turn-card' | 'artifact-card'
  key: string
  group?: MessageGroup
  card?: TurnChangeCardData
  artifacts?: ArtifactSummaryEntry[]   // for 'artifact-card'
}
```

- **关键**：`buildDisplayItems` 当前在 `cards.length === 0` 时短路为纯分组。产物卡片**不依赖** `turnChangeCards`，
  必须独立于 turn-card 逻辑。改造方式：在生成 assistant-group 项后，检查该组内是否有消息带
  `metadata.artifacts?.length`，若有则紧随其后 `push` 一个 `'artifact-card'` 项。
  此检查在 `cards.length === 0` 的短路分支与正常分支**都要执行**（提取成一个公共的"追加产物卡片"小函数，避免重复）。
- 仅在 `chatStore.currentSession?.mode === 'work'` 时追加（双保险，正常情况下 `code` 模式消息也不会有 `metadata.artifacts`）。
- 模板渲染循环新增分支：`<ArtifactSummaryCard v-else-if="item.type === 'artifact-card'" :artifacts="item.artifacts" />`。
- `key`：`artifact-card-${assistantGroup.id}`。

### 4.4 新组件 `src/components/chat/ArtifactSummaryCard.vue`

- Props：`artifacts: ArtifactSummaryEntry[]`。
- 视觉沿用 `CurrentTurnChangeCard.vue` 的卡片外框与设计变量（`--bg-elevated`、`--border-default`、`--radius-lg` 等）。
- 头部：图标 + 标题 `t('artifacts.summaryTitle')`（"产物汇总"）+ 文件数。
- 列表：每个文件一行 —— 图标（复用 `ArtifactsPanel.iconFor` 的 ext→emoji 映射）、文件名、`大小 · 类型`。
- 行为：
  - 点击文件行 / "打开"按钮 → `openArtifact(f)`：
    - `['html','htm'].includes(f.ext)` → `appStore.openFileInWebview(f.path)`。
    - 否则 → `api.artifacts.open(f.path)`（`shell.openPath`，系统默认程序）。
  - 次要按钮"在文件夹中显示" → `api.artifacts.reveal(f.path)`。

> `iconFor` / `formatSize` 目前是 `ArtifactsPanel.vue` 内部函数。为避免重复，可抽到一个小工具模块
> （如 `src/utils/artifactFormat.ts`）供两个组件共用；若评审认为抽取属于越界改动，则在新组件内复制这两个纯函数。
> **倾向**：抽取共享，因属于本需求引入的第二个消费者，符合 DRY 且改动可追溯。

### 4.5 i18n

`src/i18n/locales/zh-CN.ts` 与 `en-US.ts` 的 `artifacts` 块新增：

```ts
// zh-CN
artifacts: {
  // ... 现有 ...
  summaryTitle: '产物汇总',
  summaryCount: '{count} 个文件',   // 可选，用于头部计数
}
// en-US
artifacts: {
  // ...
  summaryTitle: 'Deliverables',
  summaryCount: '{count} files',
}
```

## 5. 数据流

```
beginTurn(sendStartTime) ──► 助手执行（写文件到 outputs/） ──► handleResult
                                                                  │
                                          [work 模式] api.artifacts.list + mtime 过滤
                                                                  │
                                       msg.metadata.artifacts = 本回合产物 → saveToStorage()
                                                                  │
   MessageList.buildDisplayItems 检测 metadata.artifacts ──► 插入 'artifact-card'
                                                                  │
                              ArtifactSummaryCard 渲染 ──► 点击：html→webview / 其它→shell.openPath
```

## 6. 改动清单

| 文件 | 改动 |
|---|---|
| `src/types/index.ts` | `MessageMetadata` 加 `artifacts?`；新增 `ArtifactSummaryEntry` |
| `src/stores/chatStream.ts` | `handleResult` 内新增 work 模式产物采集，回写 `msg.metadata.artifacts` |
| `src/components/chat/MessageList.vue` | `DisplayItem` 加 `'artifact-card'`；`buildDisplayItems` 追加卡片项；模板新增渲染分支 |
| `src/components/chat/ArtifactSummaryCard.vue` | **新增**组件 |
| `src/utils/artifactFormat.ts` | **新增**（可选）抽取 `iconFor`/`formatSize`，供 `ArtifactsPanel` 与新卡片共用 |
| `src/components/work/ArtifactsPanel.vue` | （若抽取工具函数）改为 import 共享函数 |
| `src/i18n/locales/zh-CN.ts`、`en-US.ts` | `artifacts.summaryTitle`、`summaryCount` |

> 原则（遵循 CLAUDE.md）：每行改动可追溯本需求；新增字段全部缺省兼容旧数据；不重构无关代码。

## 7. 验收标准

1. 办公模式下，助手回合生成一个 `.html` 产物 → 对话流出现"产物汇总"卡片，点击在右侧内置浏览器打开。
2. 生成 `.pptx`/`.docx` → 点击调用系统默认程序打开；"在文件夹中显示"能定位文件。
3. 同一会话多个回合，各自只显示**本回合**新增/修改的产物，不串台。
4. 未产生产物的回合不渲染卡片；`code` 模式任何回合都不渲染卡片。
5. 关闭并重开会话，历史回合的产物卡片仍在（随消息持久化）。
6. `npm run typecheck` 通过。

## 8. 未决/已知边界

- 若 `outputs/` 被 `.gitignore`，turn-checkpoint 的 git diff 抓不到这些文件——这正是采用目录快照方案的原因，本设计不依赖 git。
- 与 `ArtifactsPanel` 现有"新 HTML 自动预览"可能对同一文件重复触发 webview 打开；属现有行为，不在本次改动范围。

# 产物汇总卡片（办公模式）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 办公模式下助手回合结束后，在对话流内联一张"产物汇总"卡片，列出本回合新生成/修改的产物文件，点击 HTML 在右侧内置浏览器打开、其它格式用系统默认程序打开。

**Architecture:** 回合完成钩子 `handleResult` 中（仅 work 模式）异步对 `outputs/` 做 mtime 快照对比，把本回合产物写入该助手消息的 `metadata.artifacts` 并持久化；`MessageList.buildDisplayItems` 检测到带产物的助手回合后插入一张 `ArtifactSummaryCard`。全部打开能力复用现有 `api.artifacts.*` 与 `appStore.openFileInWebview`。

**Tech Stack:** Vue 3 (`<script setup>`) + Pinia + Electron IPC，TypeScript，vitest（仅纯函数单测），i18n（vue-i18n）。

---

## 测试说明（重要）

本仓库 vitest 仅收集 `electron/__tests__/**` 与 `tests/composables/**`，**没有 Vue 组件/Store 的单元测试基建**。因此：

- **纯函数**（`iconFor`/`formatSize`）走 TDD：vitest 单测放在 `tests/composables/artifactFormat.test.ts`（该路径已被 `vitest.config.ts` 的 include 覆盖，无需改配置）。
- **Store 采集逻辑 / Vue 组件 / MessageList 接线**：无组件测试基建，采用 `npm run typecheck` + 真机手动验证（在办公模式跑一次产生 `.html` 与 `.docx` 的任务并观察）。每个相关任务给出明确的手动验收步骤与预期现象。

运行单测：`npx vitest run tests/composables/artifactFormat.test.ts`
类型检查：`npm run typecheck`

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/types/index.ts` | 新增 `ArtifactSummaryEntry` 类型；`MessageMetadata` 加 `artifacts?` | Modify |
| `src/i18n/locales/zh-CN.ts` / `en-US.ts` | 新增 `artifacts.summaryTitle` / `summaryCount` | Modify |
| `src/utils/artifactFormat.ts` | 共享纯函数 `iconFor`/`formatSize` | Create |
| `tests/composables/artifactFormat.test.ts` | 纯函数单测 | Create |
| `src/components/work/ArtifactsPanel.vue` | 改用共享 `iconFor`/`formatSize` | Modify |
| `src/stores/chatStream.ts` | `handleResult` 内 work 模式产物采集 | Modify |
| `src/components/chat/ArtifactSummaryCard.vue` | 新卡片组件 | Create |
| `src/components/chat/MessageList.vue` | `DisplayItem` 加 `artifact-card`，接线渲染 | Modify |

---

## Task 1: 类型定义

**Files:**
- Modify: `src/types/index.ts:116`（`MessageMetadata`）

- [ ] **Step 1: 在 `MessageMetadata` 之前新增 `ArtifactSummaryEntry` 类型**

在 `src/types/index.ts` 中 `export interface MessageMetadata {` 这一行（约 line 116）的**正上方**插入：

```ts
/** 产物汇总卡片的单条文件项（与 electronAPI 的 ArtifactEntry 形态一致，随消息持久化）。 */
export interface ArtifactSummaryEntry {
  name: string
  path: string
  ext: string
  size: number
  mtime: number
}
```

- [ ] **Step 2: 给 `MessageMetadata` 增加可选字段 `artifacts`**

在 `MessageMetadata` 接口体内（任意字段后、闭合 `}` 前）加入：

```ts
  /** 办公模式：本回合新生成/修改的产物文件（仅 work 模式会话写入）。 */
  artifacts?: ArtifactSummaryEntry[]
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 通过（无新错误）。

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add ArtifactSummaryEntry and MessageMetadata.artifacts"
```

---

## Task 2: i18n 文案

**Files:**
- Modify: `src/i18n/locales/zh-CN.ts:67-73`
- Modify: `src/i18n/locales/en-US.ts:67-73`

- [ ] **Step 1: zh-CN 的 `artifacts` 块加键**

把 `src/i18n/locales/zh-CN.ts` 的：

```ts
  artifacts: {
    title: '产物',
    refresh: '刷新',
    empty: '暂无成果文件',
    open: '打开',
    reveal: '在文件夹中显示',
  },
```

改为：

```ts
  artifacts: {
    title: '产物',
    refresh: '刷新',
    empty: '暂无成果文件',
    open: '打开',
    reveal: '在文件夹中显示',
    summaryTitle: '产物汇总',
    summaryCount: '{count} 个文件',
  },
```

- [ ] **Step 2: en-US 的 `artifacts` 块加键**

把 `src/i18n/locales/en-US.ts` 的：

```ts
  artifacts: {
    title: 'Artifacts',
    refresh: 'Refresh',
    empty: 'No deliverables yet',
    open: 'Open',
    reveal: 'Show in folder',
  },
```

改为：

```ts
  artifacts: {
    title: 'Artifacts',
    refresh: 'Refresh',
    empty: 'No deliverables yet',
    open: 'Open',
    reveal: 'Show in folder',
    summaryTitle: 'Deliverables',
    summaryCount: '{count} files',
  },
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat(i18n): add artifact summary card strings"
```

---

## Task 3: 共享格式化工具（TDD）

**Files:**
- Create: `src/utils/artifactFormat.ts`
- Test: `tests/composables/artifactFormat.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `tests/composables/artifactFormat.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { iconFor, formatSize } from '@/utils/artifactFormat'

describe('iconFor', () => {
  it('maps known extensions to emoji', () => {
    expect(iconFor('pptx')).toBe('📊')
    expect(iconFor('docx')).toBe('📝')
    expect(iconFor('xlsx')).toBe('📈')
    expect(iconFor('html')).toBe('🌐')
    expect(iconFor('pdf')).toBe('📄')
  })

  it('falls back to a generic icon for unknown extensions', () => {
    expect(iconFor('xyz')).toBe('📁')
    expect(iconFor('')).toBe('📁')
  })
})

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(512)).toBe('512 B')
  })
  it('formats kilobytes', () => {
    expect(formatSize(2048)).toBe('2.0 KB')
  })
  it('formats megabytes', () => {
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/composables/artifactFormat.test.ts`
Expected: FAIL（`Failed to resolve import "@/utils/artifactFormat"` / 模块不存在）。

- [ ] **Step 3: 实现工具模块**

创建 `src/utils/artifactFormat.ts`（逻辑与 `ArtifactsPanel.vue` 现有实现逐字一致，仅迁移位置）：

```ts
/** 产物文件展示用的纯函数：扩展名→图标、字节→可读大小。供 ArtifactsPanel 与 ArtifactSummaryCard 共用。 */

export function iconFor(ext: string): string {
  const map: Record<string, string> = {
    pptx: '📊', ppt: '📊',
    docx: '📝', doc: '📝',
    xlsx: '📈', xls: '📈', csv: '📈',
    pdf: '📄',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    md: '📋', txt: '📋',
    html: '🌐', htm: '🌐',
    json: '🔧',
  }
  return map[ext] || '📁'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/composables/artifactFormat.test.ts`
Expected: PASS（全部用例通过）。

- [ ] **Step 5: 重构 `ArtifactsPanel.vue` 改用共享函数**

在 `src/components/work/ArtifactsPanel.vue`：

1. 在 `<script setup>` import 区加：

```ts
import { iconFor, formatSize } from '@/utils/artifactFormat'
```

2. 删除组件内本地定义的 `function iconFor(...) {...}`（约 line 110-122）与 `function formatSize(...) {...}`（约 line 124-128）。模板中对 `iconFor`/`formatSize` 的调用保持不变（现在解析到 import 的函数）。

- [ ] **Step 6: 类型检查 + 单测**

Run: `npm run typecheck && npx vitest run tests/composables/artifactFormat.test.ts`
Expected: 均通过。

- [ ] **Step 7: Commit**

```bash
git add src/utils/artifactFormat.ts tests/composables/artifactFormat.test.ts src/components/work/ArtifactsPanel.vue
git commit -m "refactor(artifacts): extract shared iconFor/formatSize util"
```

---

## Task 4: 回合产物采集（chatStream）

**Files:**
- Modify: `src/stores/chatStream.ts:766`（`handleResult` 内 `sessionStore.saveToStorage()` 之后、`void sessionStore.loadTurnCheckpoints(sessionId)` 之前）

> `api` 已在该文件 line 6 导入（`import { api } from '@/services/electronAPI'`）。`s`（session）、`ts`（TurnState，含 `sendStartTime`、`assistantMessageId`）、`sessionId` 均在此作用域内可用。

- [ ] **Step 1: 在 `saveToStorage()` 后插入采集块**

在 `src/stores/chatStream.ts` 的 `handleResult` 中，找到（约 line 766-768）：

```ts
        sessionStore.saveToStorage()

        void sessionStore.loadTurnCheckpoints(sessionId)
```

改为：

```ts
        sessionStore.saveToStorage()

        // 产物汇总：仅办公模式，回合结束后对 outputs/ 做 mtime 快照对比，
        // 把本回合新生成/修改的产物写入该助手消息元数据并持久化。
        if (s.mode === 'work' && s.workingDirectory) {
          const workingDir = s.workingDirectory
          const turnStart = ts.sendStartTime
          const targetMsgId = ts.assistantMessageId
          void (async () => {
            try {
              const { artifacts } = await api.artifacts.list(workingDir)
              // 1s 容差，与 ArtifactsPanel 现有约定一致；mtime>=回合开始即本回合新增/修改
              const produced = (artifacts || []).filter(a => a.mtime >= turnStart - 1000)
              if (produced.length === 0) return
              const sess = sessionStore.sessions.find(x => x.id === sessionId)
              const target = sess?.messages.find(m => m.id === targetMsgId)
              if (!sess || !target) return
              target.metadata = { ...(target.metadata || {}), artifacts: produced }
              // 触发 MessageList 重建（其分组缓存按数组引用失效）
              sess.messages = [...sess.messages]
              sessionStore.saveToStorage()
            } catch (err) {
              console.error('[Artifacts] turn summary collect failed:', err)
            }
          })()
        }

        void sessionStore.loadTurnCheckpoints(sessionId)
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 通过。`produced` 为 `ArtifactEntry[]`，形态与 `ArtifactSummaryEntry[]` 一致，可直接赋值给 `metadata.artifacts`。

- [ ] **Step 3: Commit**

```bash
git add src/stores/chatStream.ts
git commit -m "feat(chat): collect per-turn artifacts in office mode"
```

> 本任务的运行时验收在 Task 7 与 Task 6 完成后一起做（需要卡片才能观察）。

---

## Task 5: 卡片组件 `ArtifactSummaryCard.vue`

**Files:**
- Create: `src/components/chat/ArtifactSummaryCard.vue`

- [ ] **Step 1: 创建组件**

创建 `src/components/chat/ArtifactSummaryCard.vue`：

```vue
<template>
  <div class="artifact-summary-card">
    <div class="card-header">
      <span class="card-icon" aria-hidden="true">
        <PackageCheck :size="14" :stroke-width="2" />
      </span>
      <h3 class="title">{{ t('artifacts.summaryTitle') }}</h3>
      <span class="count">{{ t('artifacts.summaryCount', { count: artifacts.length }) }}</span>
    </div>

    <ul class="file-list">
      <li
        v-for="f in artifacts"
        :key="f.path"
        class="file-item"
        @click="openArtifact(f)"
      >
        <span class="file-icon">{{ iconFor(f.ext) }}</span>
        <div class="file-meta">
          <div class="file-name" :title="f.name">{{ f.name }}</div>
          <div class="file-sub">{{ formatSize(f.size) }} · {{ f.ext.toUpperCase() || 'FILE' }}</div>
        </div>
        <div class="file-actions">
          <button class="act-btn" :title="t('artifacts.open')" @click.stop="openArtifact(f)">
            <ExternalLink :size="13" />
          </button>
          <button class="act-btn" :title="t('artifacts.reveal')" @click.stop="reveal(f)">
            <FolderOpen :size="13" />
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { PackageCheck, ExternalLink, FolderOpen } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import { iconFor, formatSize } from '@/utils/artifactFormat'
import type { ArtifactSummaryEntry } from '@/types'

defineProps<{
  artifacts: ArtifactSummaryEntry[]
}>()

const { t } = useI18n()
const appStore = useAppStore()

const PREVIEWABLE = new Set(['html', 'htm'])

async function openArtifact(f: ArtifactSummaryEntry) {
  if (PREVIEWABLE.has(f.ext)) {
    appStore.openFileInWebview(f.path)
  } else {
    await api.artifacts.open(f.path)
  }
}

async function reveal(f: ArtifactSummaryEntry) {
  await api.artifacts.reveal(f.path)
}
</script>

<style lang="scss" scoped>
.artifact-summary-card {
  background: var(--bg-elevated, #2a2928);
  border: 1px solid var(--border-default, rgba(255, 255, 255, 0.09));
  border-left: 3px solid var(--accent-primary, #d97757);
  border-radius: var(--radius-lg, 10px);
  margin: 16px 0;
  overflow: hidden;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.2));
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05));

  .card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: rgba(217, 119, 87, 0.12);
    color: var(--accent-primary, #d97757);
    flex-shrink: 0;
  }

  .title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #faf9f5);
    line-height: 1.3;
  }

  .count {
    font-size: 11px;
    color: var(--text-muted, rgba(255, 255, 255, 0.5));
  }
}

.file-list { list-style: none; margin: 0; padding: 4px; }

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 150ms ease;

  &:hover {
    background: var(--surface-glass-hover, rgba(255, 255, 255, 0.07));
    .file-actions { opacity: 1; }
  }
}

.file-icon { font-size: 20px; flex-shrink: 0; }

.file-meta { flex: 1; min-width: 0; }
.file-name {
  font-size: 13px;
  color: var(--text-primary, #faf9f5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-sub { font-size: 11px; color: var(--text-muted, rgba(255, 255, 255, 0.5)); margin-top: 2px; }

.file-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 150ms ease; }

.act-btn {
  display: flex;
  background: none;
  border: none;
  color: var(--text-muted, rgba(255, 255, 255, 0.5));
  cursor: pointer;
  padding: 5px;
  border-radius: var(--radius-sm, 4px);
  &:hover { color: var(--accent-primary, #d97757); background: var(--surface-glass, rgba(255, 255, 255, 0.04)); }
}
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 通过。

> 若 `PackageCheck` 在当前 `lucide-vue-next` 版本不存在导致类型/导入报错，改用 `PackageOpen`（`ArtifactsPanel.vue` 已在用，确认可用）。

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ArtifactSummaryCard.vue
git commit -m "feat(chat): add ArtifactSummaryCard component"
```

---

## Task 6: MessageList 接线

**Files:**
- Modify: `src/components/chat/MessageList.vue`（模板 line 10-31；`DisplayItem` line 76-81；`buildDisplayItems` line 157-205；import 区）

- [ ] **Step 1: import 新组件**

在 `src/components/chat/MessageList.vue` 的 import 区（`import CurrentTurnChangeCard from './CurrentTurnChangeCard.vue'` 之后）加：

```ts
import ArtifactSummaryCard from './ArtifactSummaryCard.vue'
```

- [ ] **Step 2: 扩展 `DisplayItem` 类型**

把 `DisplayItem` 接口（约 line 76-81）：

```ts
interface DisplayItem {
  type: 'user-group' | 'assistant-group' | 'turn-card'
  key: string
  group?: MessageGroup
  card?: TurnChangeCardData
}
```

改为：

```ts
interface DisplayItem {
  type: 'user-group' | 'assistant-group' | 'turn-card' | 'artifact-card'
  key: string
  group?: MessageGroup
  card?: TurnChangeCardData
  artifacts?: import('@/types').ArtifactSummaryEntry[]
}
```

- [ ] **Step 3: 新增"产物卡片"辅助函数**

在 `buildDisplayItems` 函数（约 line 157）**正上方**插入：

```ts
// 若某助手分组的回合产生了产物（仅办公模式），返回对应的产物卡片项，否则 null
function artifactCardItem(group: MessageGroup): DisplayItem | null {
  if (chatStore.currentSession?.mode !== 'work') return null
  const withArtifacts = group.messages.find(
    m => m.metadata?.artifacts && m.metadata.artifacts.length > 0
  )
  if (!withArtifacts) return null
  return {
    type: 'artifact-card',
    key: `artifact-card-${group.id}`,
    artifacts: withArtifacts.metadata!.artifacts,
  }
}
```

- [ ] **Step 4: 在 `cards.length === 0` 短路分支插入产物卡片**

把 `buildDisplayItems` 开头的短路分支（约 line 161-167）：

```ts
  if (cards.length === 0) {
    return groups.map(g => ({
      type: g.type === 'user' ? 'user-group' : 'assistant-group',
      key: g.id,
      group: g,
    }))
  }
```

改为：

```ts
  if (cards.length === 0) {
    const items: DisplayItem[] = []
    for (const g of groups) {
      items.push({
        type: g.type === 'user' ? 'user-group' : 'assistant-group',
        key: g.id,
        group: g,
      })
      if (g.type === 'assistant') {
        const ac = artifactCardItem(g)
        if (ac) items.push(ac)
      }
    }
    return items
  }
```

- [ ] **Step 5: 在主循环的两处 assistant-group 之后插入产物卡片**

在主循环里，user 分支内推入 assistant-group 处（约 line 183-184）：

```ts
        const assistantGroup = groups[i]
        items.push({ type: 'assistant-group', key: assistantGroup.id, group: assistantGroup })
```

其后紧接着加：

```ts
        const acUser = artifactCardItem(assistantGroup)
        if (acUser) items.push(acUser)
```

再在 else 分支（约 line 199-201）：

```ts
    } else {
      items.push({ type: 'assistant-group', key: group.id, group })
    }
```

改为：

```ts
    } else {
      items.push({ type: 'assistant-group', key: group.id, group })
      const acElse = artifactCardItem(group)
      if (acElse) items.push(acElse)
    }
```

- [ ] **Step 6: 模板渲染分支**

在模板 `<CurrentTurnChangeCard ... />`（约 line 26-30）之后、`</template>` 循环闭合前加：

```vue
        <ArtifactSummaryCard
          v-else-if="item.type === 'artifact-card'"
          :artifacts="item.artifacts!"
        />
```

- [ ] **Step 7: 类型检查**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 8: Commit**

```bash
git add src/components/chat/MessageList.vue
git commit -m "feat(chat): render ArtifactSummaryCard after office-mode turns"
```

---

## Task 7: 集成验证（手动）

**Files:** 无（验证任务）

- [ ] **Step 1: 类型检查全量通过**

Run: `npm run typecheck`
Expected: 0 错误。

- [ ] **Step 2: 单测通过**

Run: `npx vitest run tests/composables/artifactFormat.test.ts`
Expected: PASS。

- [ ] **Step 3: 启动应用，办公模式手动验收**

Run: `npm run dev`（按项目惯例启动 Electron 开发环境）

依次验证（对应 spec §7 验收标准）：

1. 切到**办公模式**，选一个会写 `outputs/` 的助手，让它产出一个 `.html` 文件。
   预期：助手回合结束后，对话流中该回合下方出现"产物汇总"卡片，列出该 `.html`。
2. 点击该 HTML 文件行 → 预期：右侧 `InfoPanel` 内置浏览器打开该文件。
3. 让助手产出 `.docx`/`.pptx` → 点击 → 预期：调用系统默认程序打开；点击"在文件夹中显示"→ 资源管理器定位到该文件。
4. 同一会话发起第二个回合并产出新文件 → 预期：新卡片只列**本回合**的新文件，不含上一个回合的产物。
5. 未产生任何产物的回合 → 预期：不出现卡片。
6. 切到**编码模式**跑一个回合 → 预期：不出现产物汇总卡片。
7. 关闭并重新打开该会话 → 预期：历史回合的产物卡片仍在。

- [ ] **Step 4: 最终提交（如验证中有微调）**

```bash
git add -A
git commit -m "chore: finalize artifact summary card feature"
```

---

## Self-Review（作者已核对）

- **Spec 覆盖**：§4.1 类型→Task 1；§4.5 i18n→Task 2；§4.4 共享工具+卡片→Task 3/5；§4.2 采集→Task 4；§4.3 渲染→Task 6；§7 验收→Task 7。无遗漏。
- **类型一致性**：`ArtifactSummaryEntry`（Task 1 定义）在 Task 4（赋值）、Task 5（props）、Task 6（DisplayItem）一致引用；`iconFor`/`formatSize` 名称跨 Task 3/5/ArtifactsPanel 一致；`artifacts.summaryTitle`/`summaryCount` 跨 Task 2/5 一致。
- **占位符**：无 TBD/TODO；所有代码步骤含完整代码。
- **已知边界**：`outputs/` 若被 .gitignore 不影响本方案（不依赖 git）；与 ArtifactsPanel 的自动预览可能对同一 HTML 重复触发 webview，属现有行为，不在本次范围。

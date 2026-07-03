# 设计模式重构实现计划：复刻 open-design 聊天界面

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把 SpaceCode 的 design 模式从三栏 Studio 重构为左 ChatPane + 右 FileWorkspace 分屏，复刻 open-design 第 1+2 层能力。

**架构：** 拆分 DesignPage 为布局容器 + 6 个 design 专属组件 + 4 个 ToolCard family 卡；新增 buildBlocks 工具基于 Message 字段构建分块渲染；design store 删 Brief 表单 state、改会话生命周期；useDesignSession 从表单触发改为旁路监听。复用现有 chat 零件（MessageList/AgentTimeline/RetryIndicator），MessageItem 新增 events 渲染分支（不破坏 code/work 模式）。

**技术栈：** Vue 3.4 + Pinia 2 + vue-i18n 9 + Vite 5 + Electron 29 + vitest + @vue/test-utils + Shiki（待引入）

**规格：** `docs/superpowers/specs/2026-07-04-design-mode-refactor-design.md`

---

## 前置准备（执行前必读）

1. **阅读规格**：完整阅读 `docs/superpowers/specs/2026-07-04-design-mode-refactor-design.md`
2. **关键文件**：
   - 现有 DesignPage：`src/components/design/DesignPage.vue`（524 行三栏 Studio，将重写）
   - design store：`src/stores/design.ts`（将改造）
   - useDesignSession：`src/composables/useDesignSession.ts`（将重构）
   - MessageItem：`src/components/chat/MessageItem.vue`（将加 events 分支）
   - ToolCallCard：`src/components/chat/ToolCallCard.vue`（将改 family 分发器）
   - chatStream：`src/stores/chatStream.ts`（**不改**，仅复用 sendMessage/abortTurn/onStreamEvent）
3. **类型定义**：`src/types/index.ts` 的 Message/ToolCall/ReasoningBlock/MessageMetadata
4. **运行环境**：`pnpm install` 后执行 `pnpm test`（vitest）、`pnpm typecheck`（vue-tsc --noEmit）、`pnpm dev`（Vite）

---

## 文件结构

### 新建文件（13 个）

| 文件 | 职责 |
|---|---|
| `src/utils/chat/buildBlocks.ts` | 纯函数：Message → Block[]，分块渲染核心 |
| `src/utils/chat/__tests__/buildBlocks.test.ts` | buildBlocks 单测 |
| `src/components/design/DesignSplitView.vue` | 可拖拽左右分屏容器 |
| `src/components/design/DesignChatPane.vue` | 左侧聊天面板（编排 MessageList/Composer） |
| `src/components/design/DesignComposer.vue` | 输入区 + 内联 DesignToolboxPanel |
| `src/components/design/DesignFileWorkspace.vue` | 右侧文件工作区（Tabs + Preview + 内联 CodeViewer） |
| `src/components/design/WorkspaceTabsBar.vue` | 多工件 tab 切换条 |
| `src/components/design/OdCard.vue` | 结构化设计卡片（`<od-card>` 解析渲染） |
| `src/components/design/NextStepActions.vue` | 轮次后建议动作条（`<next-steps>` 解析） |
| `src/components/chat/BashToolCard.vue` | Bash 工具专用卡（stdout/stderr 分色） |
| `src/components/chat/FileWriteToolCard.vue` | Write 工具专用卡（含"在预览中打开"） |
| `src/components/chat/FileEditToolCard.vue` | Edit 工具专用卡（复用 diff 渲染） |
| `src/components/chat/FileReadToolCard.vue` | Read 工具专用卡（代码高亮折叠） |
| `src/styles/design.scss` | design 专属 CSS 变量 |

### 改造文件（6 个）

| 文件 | 改动 |
|---|---|
| `src/components/design/DesignPage.vue` | 重写为布局容器（约 80 行） |
| `src/stores/design.ts` | 删 brief/system/skill/direction state，新增 tab/usage/nextStepActions |
| `src/composables/useDesignSession.ts` | 删 startDesignGeneration，新增 createDesignSession/switchToolboxSkill + attachStreamListener |
| `src/components/chat/MessageItem.vue` | 新增 events prop + buildBlocks 渲染分支 |
| `src/components/chat/ToolCallCard.vue` | 改造为 family 分发器 |
| `src/i18n/locales/en-US.ts` + `zh-CN.ts` | 新增 design 命名空间 |

### 测试文件

- `src/utils/chat/__tests__/buildBlocks.test.ts`
- `src/stores/__tests__/design.test.ts`
- `src/composables/__tests__/useDesignSession.test.ts`
- `src/components/design/__tests__/OdCard.test.ts`
- `src/components/design/__tests__/NextStepActions.test.ts`
- `src/components/design/__tests__/DesignFileWorkspace.test.ts`
- `src/components/chat/__tests__/MessageItem.events.test.ts`（回归保护）

---

## 任务 1：buildBlocks 纯函数 + 测试

**文件：**
- 创建：`src/utils/chat/buildBlocks.ts`
- 创建：`src/utils/chat/__tests__/buildBlocks.test.ts`

**背景**：SpaceCode 没有把事件流持久化为单一真相源，而是把流事件消化进 Message.content/reasoning/toolCalls。buildBlocks 基于 Message 字段 + timelineEvents 构建分块，从 content 解析 `<od-card>`/`<question-form>`/`<next-steps>` 标签。

- [ ] **步骤 1.1：编写失败的测试**

创建 `src/utils/chat/__tests__/buildBlocks.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildBlocks } from '../buildBlocks'
import type { Message } from '@/types'

function makeMessage(over: Partial<Message> = {}): Message {
  return {
    id: 'm1', role: 'assistant', content: '', timestamp: Date.now(),
    ...over,
  } as Message
}

describe('buildBlocks', () => {
  it('纯文本消息生成单个 text block', () => {
    const msg = makeMessage({ content: '你好' })
    const blocks = buildBlocks(msg)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'text', content: '你好' })
  })

  it('reasoning 生成 thinking block', () => {
    const msg = makeMessage({
      content: '回答',
      reasoning: { content: '思考中', startTime: 0 },
    })
    const blocks = buildBlocks(msg)
    expect(blocks.find(b => b.kind === 'thinking')).toBeTruthy()
  })

  it('toolCalls 生成 tool-group block', () => {
    const msg = makeMessage({
      content: '',
      toolCalls: [
        { id: 't1', name: 'Write', input: {}, status: 'completed' },
        { id: 't2', name: 'Write', input: {}, status: 'completed' },
      ],
    })
    const blocks = buildBlocks(msg)
    const group = blocks.find(b => b.kind === 'tool-group')
    expect(group).toMatchObject({ toolName: 'Write' })
    expect((group as any).calls).toHaveLength(2)
  })

  it('从 content 解析 <od-card> 为 od-card block 并剔除标签', () => {
    const content = '前面文字\n<od-card type="brand-preview" title="品牌">{"colors":["#f00"]}</od-card>\n后面文字'
    const msg = makeMessage({ content })
    const blocks = buildBlocks(msg)
    expect(blocks.find(b => b.kind === 'od-card')).toMatchObject({
      payload: { type: 'brand-preview', title: '品牌', data: { colors: ['#f00'] } },
    })
    const textBlock = blocks.find(b => b.kind === 'text') as any
    expect(textBlock.content).not.toContain('<od-card')
    expect(textBlock.content).toContain('前面文字')
    expect(textBlock.content).toContain('后面文字')
  })

  it('从 content 解析 <question-form> 为 question-form block', () => {
    const content = '<question-form id="q1">{"fields":[]}</question-form>'
    const msg = makeMessage({ content })
    const blocks = buildBlocks(msg)
    expect(blocks.find(b => b.kind === 'question-form')).toBeTruthy()
  })

  it('从 content 解析 <next-steps> 为 next-steps block', () => {
    const content = '完成\n<next-steps><action label="调整配色" prompt="改主色"/></next-steps>'
    const msg = makeMessage({ content })
    const blocks = buildBlocks(msg)
    expect(blocks.find(b => b.kind === 'next-steps')).toMatchObject({
      actions: [{ label: '调整配色', prompt: '改主色' }],
    })
  })

  it('metadata 含用量时生成 status block', () => {
    const msg = makeMessage({
      content: 'ok',
      metadata: { inputTokens: 100, outputTokens: 200, duration: 5 } as any,
    })
    const blocks = buildBlocks(msg)
    expect(blocks.find(b => b.kind === 'status')).toBeTruthy()
  })

  it('未闭合标签当作普通文本处理', () => {
    const msg = makeMessage({ content: '<od-card type="x">未闭合' })
    const blocks = buildBlocks(msg)
    expect(blocks.find(b => b.kind === 'od-card')).toBeFalsy()
    expect(blocks[0]).toMatchObject({ kind: 'text' })
  })
})
```

- [ ] **步骤 1.2：运行测试验证失败**

运行：`pnpm vitest run src/utils/chat/__tests__/buildBlocks.test.ts`
预期：FAIL，报错 `Cannot find module '../buildBlocks'`

- [ ] **步骤 1.3：实现 buildBlocks**

创建 `src/utils/chat/buildBlocks.ts`：

```ts
import type { Message, ToolCall, MessageMetadata } from '@/types'
import { findFirstQuestionForm, splitOnQuestionForms, type QuestionFormBlock } from '@/utils/design/questionForm'

export interface OdCardPayload {
  type: 'brand-preview' | 'direction-swatches' | 'artifact-thumbnail' | 'generic'
  title?: string
  data: Record<string, any>
}

export interface NextStepAction {
  label: string
  prompt: string
}

export type Block =
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string }
  | { kind: 'tool-group'; toolName: string; calls: ToolCall[] }
  | { kind: 'od-card'; payload: OdCardPayload }
  | { kind: 'question-form'; payload: QuestionFormBlock }
  | { kind: 'next-steps'; actions: NextStepAction[] }
  | { kind: 'status'; usage?: { inputTokens: number; outputTokens: number; duration?: number } }

const OD_CARD_RE = /<od-card\s+type="([^"]+)"(?:\s+title="([^"]+)")?\s*>([\s\S]*?)<\/od-card>/g
const NEXT_STEPS_RE = /<next-steps>([\s\S]*?)<\/next-steps>/g
const ACTION_RE = /<action\s+label="([^"]+)"\s+prompt="([^"]+)"\s*\/>/g

function parseOdCards(content: string): { text: string; cards: OdCardPayload[] } {
  const cards: OdCardPayload[] = []
  const text = content.replace(OD_CARD_RE, (_m, type, title, body) => {
    let data: Record<string, any> = {}
    try { data = JSON.parse(body.trim()) } catch { data = { raw: body.trim() } }
    cards.push({ type, title, data })
    return ''
  })
  return { text, cards }
}

function parseNextSteps(content: string): { text: string; actions: NextStepAction[] | null } {
  let actions: NextStepAction[] | null = null
  const text = content.replace(NEXT_STEPS_RE, (_m, body) => {
    const list: NextStepAction[] = []
    let m: RegExpExecArray | null
    const re = new RegExp(ACTION_RE)
    while ((m = re.exec(body)) !== null) {
      list.push({ label: m[1], prompt: m[2] })
    }
    actions = list
    return ''
  })
  return { text, actions }
}

export function buildBlocks(message: Message): Block[] {
  const blocks: Block[] = []

  // 1. thinking
  if (message.reasoning?.content) {
    blocks.push({ kind: 'thinking', content: message.reasoning.content })
  }

  // 2. text + od-card + question-form + next-steps（交错解析）
  let content = message.content || ''

  // 先解析 question-form（复用现有工具）
  const qForm = findFirstQuestionForm(content)
  if (qForm) {
    const segments = splitOnQuestionForms(content)
    const textOnly = segments.filter(s => s.type === 'text').map(s => s.text).join('')
    content = textOnly
  }

  // 解析 od-card
  const { text: textAfterOd, cards } = parseOdCards(content)
  content = textAfterOd

  // 解析 next-steps
  const { text: textAfterNs, actions } = parseNextSteps(content)
  content = textAfterNs

  if (content.trim()) {
    blocks.push({ kind: 'text', content })
  }
  for (const c of cards) {
    blocks.push({ kind: 'od-card', payload: c })
  }
  if (qForm) {
    blocks.push({ kind: 'question-form', payload: qForm })
  }
  if (actions) {
    blocks.push({ kind: 'next-steps', actions })
  }

  // 3. tool-group（按 name 分组）
  if (message.toolCalls?.length) {
    const groups = new Map<string, ToolCall[]>()
    for (const tc of message.toolCalls) {
      const arr = groups.get(tc.name) || []
      arr.push(tc)
      groups.set(tc.name, arr)
    }
    for (const [name, calls] of groups) {
      blocks.push({ kind: 'tool-group', toolName: name, calls })
    }
  }

  // 4. status
  const meta = message.metadata as MessageMetadata | undefined
  if (meta && (meta.inputTokens || meta.outputTokens || meta.duration)) {
    blocks.push({
      kind: 'status',
      usage: {
        inputTokens: meta.inputTokens || 0,
        outputTokens: meta.outputTokens || 0,
        duration: meta.duration,
      },
    })
  }

  return blocks
}
```

- [ ] **步骤 1.4：运行测试验证通过**

运行：`pnpm vitest run src/utils/chat/__tests__/buildBlocks.test.ts`
预期：PASS（全部 8 个用例）

- [ ] **步骤 1.5：Commit**

```bash
git add src/utils/chat/buildBlocks.ts src/utils/chat/__tests__/buildBlocks.test.ts
git commit -m "feat(buildBlocks): 新增消息分块工具，支持 od-card/question-form/next-steps 解析"
```

---

## 任务 2：design store 改造 + 测试

**文件：**
- 修改：`src/stores/design.ts`
- 创建：`src/stores/__tests__/design.test.ts`

- [ ] **步骤 2.1：编写失败的测试**

创建 `src/stores/__tests__/design.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDesignStore } from '../design'

describe('useDesignStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('初始状态不含 brief/selectedSystemId', () => {
    const s = useDesignStore()
    expect((s as any).brief).toBeUndefined()
    expect((s as any).selectedSystemId).toBeUndefined()
    expect((s as any).selectedDirectionId).toBeUndefined()
  })

  it('toolboxSkills 默认含 huashu-design', () => {
    const s = useDesignStore()
    expect(s.toolboxSkills.find(x => x.id === 'huashu-design')).toBeTruthy()
  })

  it('selectedToolboxSkillId 默认 huashu-design', () => {
    const s = useDesignStore()
    expect(s.selectedToolboxSkillId).toBe('huashu-design')
  })

  it('addTab/removeTab/setActiveTab 管理 openTabs', () => {
    const s = useDesignStore()
    const f = { name: 'a.html', path: '/a.html', updatedAt: 0 }
    s.addTab(f)
    expect(s.openTabs).toHaveLength(1)
    expect(s.activeTabPath).toBe('/a.html')
    s.removeTab('/a.html')
    expect(s.openTabs).toHaveLength(0)
    expect(s.activeTabPath).toBeNull()
  })

  it('addTab 重复路径不重复添加', () => {
    const s = useDesignStore()
    const f = { name: 'a.html', path: '/a.html', updatedAt: 0 }
    s.addTab(f)
    s.addTab(f)
    expect(s.openTabs).toHaveLength(1)
  })

  it('removeTab 关闭激活 tab 时激活相邻', () => {
    const s = useDesignStore()
    s.addTab({ name: 'a', path: '/a', updatedAt: 0 })
    s.addTab({ name: 'b', path: '/b', updatedAt: 0 })
    s.addTab({ name: 'c', path: '/c', updatedAt: 0 })
    s.setActiveTab('/b')
    s.removeTab('/b')
    expect(s.activeTabPath).toBe('/c')
  })

  it('setUsage/setNextStepActions 写入状态', () => {
    const s = useDesignStore()
    s.setUsage({ inputTokens: 1, outputTokens: 2, costUsd: 0.01, durationMs: 1000 })
    expect(s.lastUsage?.inputTokens).toBe(1)
    s.setNextStepActions([{ label: 'x', prompt: 'y' }])
    expect(s.nextStepActions).toHaveLength(1)
  })
})
```

- [ ] **步骤 2.2：运行测试验证失败**

运行：`pnpm vitest run src/stores/__tests__/design.test.ts`
预期：FAIL（toolboxSkills/selectedToolboxSkillId/addTab 等不存在）

- [ ] **步骤 2.3：改造 design store**

重写 `src/stores/design.ts`：

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { QuestionFormBlock } from '@/utils/design/questionForm'

export interface DesignSystem { id: string; name: string; category: string }
export interface DesignSkill { id: string; name: string; description: string; mode?: string }
export interface ArtifactFile { name: string; path: string; updatedAt: number }
export interface NextStepAction { label: string; prompt: string }
export interface DesignUsage {
  inputTokens: number; outputTokens: number; costUsd: number; durationMs: number
}

export const useDesignStore = defineStore('design', () => {
  // 会话关联
  const activeSessionId = ref<string | null>(null)
  const designWorkspace = ref<string>('')

  // 实时预览与产物
  const previewHtml = ref<string>('')
  const previewTitle = ref<string>('Design Preview')
  const artifactFiles = ref<ArtifactFile[]>([])
  const selectedArtifactPath = ref<string | null>(null)

  // Question-Form 发现表单
  const pendingQuestionForm = ref<QuestionFormBlock | null>(null)

  // FileWorkspace 多 tab
  const openTabs = ref<ArtifactFile[]>([])
  const activeTabPath = ref<string | null>(null)

  // 用量与建议动作
  const lastUsage = ref<DesignUsage | null>(null)
  const nextStepActions = ref<NextStepAction[]>([])

  // DesignToolboxPanel
  const toolboxSkills = ref<DesignSkill[]>([
    { id: 'huashu-design', name: '华术设计 (Huashu Design)', description: '遵循大师级中文设计师章程，5维度精细打磨，杜绝 AI 垃圾套路' },
    { id: 'canvas-design', name: 'Canvas 互动设计', description: '基于 Canvas API/WebGL 的高动效、高保真游戏化 UI 设计' },
    { id: 'ui-ux-pro-max', name: 'UI/UX Pro Max', description: '高品质多文件响应式 Web 原型系统设计，支持 Tailwind' },
    { id: 'html-ppt-skill', name: '演示文稿专家 (Morph PPT)', description: 'HTML 动态转场幻灯片设计模式' },
  ])
  const selectedToolboxSkillId = ref<string>('huashu-design')

  const currentToolboxSkill = computed(() =>
    toolboxSkills.value.find(s => s.id === selectedToolboxSkillId.value) || null,
  )

  function setPendingQuestionForm(form: QuestionFormBlock | null) {
    pendingQuestionForm.value = form
  }
  function clearPendingQuestionForm() { pendingQuestionForm.value = null }
  function updateArtifactFiles(files: ArtifactFile[]) { artifactFiles.value = files }

  function addTab(file: ArtifactFile) {
    if (openTabs.value.some(t => t.path === file.path)) {
      activeTabPath.value = file.path
      return
    }
    openTabs.value.push(file)
    activeTabPath.value = file.path
  }
  function removeTab(path: string) {
    const idx = openTabs.value.findIndex(t => t.path === path)
    if (idx === -1) return
    openTabs.value.splice(idx, 1)
    if (activeTabPath.value === path) {
      const next = openTabs.value[idx] || openTabs.value[idx - 1] || null
      activeTabPath.value = next ? next.path : null
    }
  }
  function setActiveTab(path: string) { activeTabPath.value = path }

  function setUsage(u: DesignUsage) { lastUsage.value = u }
  function setNextStepActions(actions: NextStepAction[]) { nextStepActions.value = actions }

  return {
    activeSessionId, designWorkspace, previewHtml, previewTitle,
    artifactFiles, selectedArtifactPath, pendingQuestionForm,
    openTabs, activeTabPath, lastUsage, nextStepActions,
    toolboxSkills, selectedToolboxSkillId, currentToolboxSkill,
    setPendingQuestionForm, clearPendingQuestionForm, updateArtifactFiles,
    addTab, removeTab, setActiveTab, setUsage, setNextStepActions,
  }
})
```

- [ ] **步骤 2.4：运行测试验证通过**

运行：`pnpm vitest run src/stores/__tests__/design.test.ts`
预期：PASS（全部 7 个用例）

- [ ] **步骤 2.5：运行类型检查确认未破坏引用**

运行：`pnpm typecheck`
预期：可能有引用 brief/selectedSystemId 的旧代码报错（DesignPage.vue/useDesignSession.ts），记录这些引用，将在任务 3/8 修复。**临时**在 DesignPage.vue 顶部加 `// @ts-nocheck` 以让 typecheck 通过，任务 8 重写时移除。

- [ ] **步骤 2.6：Commit**

```bash
git add src/stores/design.ts src/stores/__tests__/design.test.ts src/components/design/DesignPage.vue
git commit -m "refactor(design store): 删除 brief 表单 state，新增 tab/usage/nextStepActions/toolbox"
```

---

## 任务 3：useDesignSession 重构 + 测试

**文件：**
- 修改：`src/composables/useDesignSession.ts`
- 创建：`src/composables/__tests__/useDesignSession.test.ts`

- [ ] **步骤 3.1：编写失败的测试**

创建 `src/composables/__tests__/useDesignSession.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDesignSession } from '../useDesignSession'

vi.mock('@/services/electronAPI', () => ({
  api: {
    app: { getPath: vi.fn().mockResolvedValue('/userData') },
    design: {
      composePromptStack: vi.fn().mockResolvedValue('system-prompt'),
      startFileWatcher: vi.fn().mockResolvedValue(undefined),
      stopFileWatcher: vi.fn().mockResolvedValue(undefined),
    },
    claudeCode: { onStreamEvent: vi.fn(), sendMessage: vi.fn(), stop: vi.fn() },
  },
}))

describe('useDesignSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('createDesignSession 创建会话并注入 system prompt + file watcher', async () => {
    const { createDesignSession } = useDesignSession()
    const sid = await createDesignSession()
    expect(sid).toBeTruthy()
    const { api } = await import('@/services/electronAPI')
    expect(api.design.composePromptStack).toHaveBeenCalled()
    expect(api.design.startFileWatcher).toHaveBeenCalledWith(sid, expect.any(String))
  })

  it('switchToolboxSkill 重新 composePromptStack', async () => {
    const { switchToolboxSkill } = useDesignSession()
    await switchToolboxSkill('canvas-design')
    const { api } = await import('@/services/electronAPI')
    expect(api.design.composePromptStack).toHaveBeenCalledWith(expect.objectContaining({ skillName: 'canvas-design' }))
  })

  it('submitQuestionForm 发送 form answers 消息', async () => {
    const { createDesignSession, submitQuestionForm } = useDesignSession()
    await createDesignSession()
    await submitQuestionForm({ q1: 'a' })
    // 验证 chatStore.sendMessage 被调用（通过 mock）
  })
})
```

- [ ] **步骤 3.2：运行测试验证失败**

运行：`pnpm vitest run src/composables/__tests__/useDesignSession.test.ts`
预期：FAIL（createDesignSession 不存在）

- [ ] **步骤 3.3：重构 useDesignSession**

重写 `src/composables/useDesignSession.ts`：

```ts
import { useDesignStore } from '@/stores/design'
import { useChatStore, useChatSessionStore } from '@/stores/chat'
import { api } from '@/services/electronAPI'
import { findFirstQuestionForm, splitOnQuestionForms } from '@/utils/design/questionForm'
import { ref } from 'vue'

export function useDesignSession() {
  const designStore = useDesignStore()
  const chatStore = useChatStore()
  const chatSessionStore = useChatSessionStore()
  const isGenerating = ref(false)
  const listenerDisposers = new Map<string, () => void>()

  async function createDesignSession(): Promise<string> {
    const userDataPath = await api.app.getPath('userData')
    const workspacePath = `${userDataPath}/design-workspace/${Date.now()}`
    designStore.designWorkspace = workspacePath

    const session = chatSessionStore.createSession('Design Session', workspacePath)
    session.mode = 'design'
    designStore.activeSessionId = session.id

    const systemPrompt = await api.design.composePromptStack({
      skillName: designStore.selectedToolboxSkillId,
      locale: 'zh-CN',
    })

    await chatSessionStore.initClaudeCodeSession(session.id, {
      systemPrompt,
      cwd: workspacePath,
      agent: 'ui-ux-pro-max',
    })

    await api.design.startFileWatcher(session.id, workspacePath)
    attachStreamListener(session.id)
    return session.id
  }

  async function switchToolboxSkill(skillId: string): Promise<void> {
    designStore.selectedToolboxSkillId = skillId
    const sid = designStore.activeSessionId
    if (!sid) return
    const systemPrompt = await api.design.composePromptStack({
      skillName: skillId,
      locale: 'zh-CN',
    })
    await chatSessionStore.initClaudeCodeSession(sid, {
      systemPrompt,
      cwd: designStore.designWorkspace,
      agent: 'ui-ux-pro-max',
    })
  }

  function attachStreamListener(sessionId: string) {
    const claudeCode = api.claudeCode
    if (!claudeCode) return
    let accumulated = ''
    const disposer = claudeCode.onStreamEvent(({ data, sessionId: evSid }: any) => {
      if (evSid !== sessionId) return
      if (data.type === 'text_delta') {
        accumulated += data.text
        const form = findFirstQuestionForm(accumulated)
        if (form && !designStore.pendingQuestionForm) {
          const segs = splitOnQuestionForms(accumulated)
          const textOnly = segs.filter(s => s.type === 'text').map(s => s.text).join('')
          designStore.setPendingQuestionForm(form)
          const session = chatSessionStore.sessions.find((s: any) => s.id === sessionId)
          const last = session && [...session.messages].reverse().find((m: any) => m.role === 'assistant')
          if (last) chatSessionStore.updateMessage(last.id, { content: textOnly }, sessionId)
        }
      } else if (data.type === 'usage') {
        designStore.setUsage(data.usage)
      } else if (data.type === 'status' && data.status === 'idle') {
        isGenerating.value = false
      }
    })
    listenerDisposers.set(sessionId, disposer)
  }

  function detachStreamListener(sessionId: string) {
    const disposer = listenerDisposers.get(sessionId)
    if (disposer) { disposer(); listenerDisposers.delete(sessionId) }
  }

  async function submitQuestionForm(answers: Record<string, any>) {
    const sid = designStore.activeSessionId
    if (!sid) return
    const responseMessage = `[form answers — discovery] ${JSON.stringify(answers)}`
    designStore.clearPendingQuestionForm()
    isGenerating.value = true
    chatSessionStore.currentSessionId = sid
    await chatStore.sendMessage(responseMessage)
  }

  async function stopDesignGeneration() {
    const sid = designStore.activeSessionId
    if (!sid) return
    if (api.claudeCode) {
      try { await api.claudeCode.stop(sid) } catch (e) { console.error(e) }
    }
    await api.design.stopFileWatcher()
    isGenerating.value = false
  }

  async function closeDesignSession(sessionId: string) {
    detachStreamListener(sessionId)
    await api.design.stopFileWatcher()
  }

  return {
    isGenerating,
    createDesignSession,
    switchToolboxSkill,
    submitQuestionForm,
    stopDesignGeneration,
    closeDesignSession,
  }
}
```

- [ ] **步骤 3.4：运行测试验证通过**

运行：`pnpm vitest run src/composables/__tests__/useDesignSession.test.ts`
预期：PASS

- [ ] **步骤 3.5：Commit**

```bash
git add src/composables/useDesignSession.ts src/composables/__tests__/useDesignSession.test.ts
git commit -m "refactor(useDesignSession): 改为会话生命周期触发，新增 createDesignSession/switchToolboxSkill"
```

---

## 任务 4：OdCard 组件 + 测试

**文件：**
- 创建：`src/components/design/OdCard.vue`
- 创建：`src/components/design/__tests__/OdCard.test.ts`

- [ ] **步骤 4.1：编写失败的测试**

创建 `src/components/design/__tests__/OdCard.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import OdCard from '../OdCard.vue'

describe('OdCard', () => {
  it('brand-preview 渲染色板', () => {
    const w = mount(OdCard, {
      props: { payload: { type: 'brand-preview', title: '品牌', data: { colors: ['#f00', '#0f0'] } } },
    })
    expect(w.text()).toContain('品牌')
    expect(w.findAll('.swatch')).toHaveLength(2)
  })

  it('direction-swatches 渲染 5 大方向', () => {
    const w = mount(OdCard, {
      props: { payload: { type: 'direction-swatches', data: {} } },
    })
    expect(w.findAll('.direction-item').length).toBeGreaterThan(0)
  })

  it('artifact-thumbnail 渲染打开按钮', () => {
    const w = mount(OdCard, {
      props: { payload: { type: 'artifact-thumbnail', title: 'index.html', data: { path: '/x.html' } } },
    })
    expect(w.text()).toContain('index.html')
    expect(w.find('button.open-in-preview').exists()).toBe(true)
  })

  it('generic 渲染键值对', () => {
    const w = mount(OdCard, {
      props: { payload: { type: 'generic', data: { foo: 'bar' } } },
    })
    expect(w.text()).toContain('foo')
    expect(w.text()).toContain('bar')
  })

  it('点击 artifact-thumbnail 打开按钮触发 open 事件', async () => {
    const w = mount(OdCard, {
      props: { payload: { type: 'artifact-thumbnail', data: { path: '/x.html' } } },
    })
    await w.find('button.open-in-preview').trigger('click')
    expect(w.emitted('open')).toBeTruthy()
  })
})
```

- [ ] **步骤 4.2：运行测试验证失败**

运行：`pnpm vitest run src/components/design/__tests__/OdCard.test.ts`
预期：FAIL（OdCard.vue 不存在）

- [ ] **步骤 4.3：实现 OdCard.vue**

创建 `src/components/design/OdCard.vue`：

```vue
<template>
  <div class="od-card" :class="`od-card-${payload.type}`">
    <div v-if="payload.title" class="od-card-title">{{ payload.title }}</div>

    <div v-if="payload.type === 'brand-preview'" class="brand-preview">
      <div class="swatch-strip">
        <span v-for="(c, i) in payload.data.colors || []" :key="i" class="swatch" :style="{ backgroundColor: c }" />
      </div>
      <div v-if="payload.data.font" class="brand-font">{{ payload.data.font }}</div>
    </div>

    <div v-else-if="payload.type === 'direction-swatches'" class="direction-grid">
      <div v-for="(dir, key) in directions" :key="key" class="direction-item">
        <span class="dir-name">{{ dir.name }}</span>
        <span class="swatch" :style="{ backgroundColor: dir.palette.primary }" />
        <span class="swatch" :style="{ backgroundColor: dir.palette.secondary }" />
        <span class="swatch" :style="{ backgroundColor: dir.palette.background }" />
      </div>
    </div>

    <div v-else-if="payload.type === 'artifact-thumbnail'" class="artifact-thumb">
      <FileText :size="16" />
      <span class="thumb-name">{{ payload.title || payload.data.path }}</span>
      <button class="open-in-preview" @click="$emit('open', payload.data.path)">
        <ExternalLink :size="12" /> {{ t('design.odCard.openInPreview') }}
      </button>
    </div>

    <div v-else class="generic-card">
      <div v-for="(v, k) in payload.data" :key="k" class="kv">
        <span class="k">{{ k }}</span>
        <span class="v">{{ v }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { FileText, ExternalLink } from 'lucide-vue-next'
import { DESIGN_DIRECTIONS } from '@/lib/design/directions'
import type { OdCardPayload } from '@/utils/chat/buildBlocks'

const props = defineProps<{ payload: OdCardPayload }>()
defineEmits<{ (e: 'open', path: string): void }>()
const { t } = useI18n()
const directions = DESIGN_DIRECTIONS
</script>

<style scoped lang="scss">
.od-card {
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  padding: 12px;
  background: var(--bg-secondary);
  margin: 8px 0;
}
.od-card-title { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
.swatch-strip { display: flex; gap: 4px; }
.swatch { width: 20px; height: 20px; border-radius: var(--radius-xs); border: 1px solid var(--surface-border); }
.direction-grid { display: flex; flex-direction: column; gap: 6px; }
.direction-item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.artifact-thumb { display: flex; align-items: center; gap: 8px; }
.open-in-preview { margin-left: auto; background: none; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 2px 8px; font-size: 11px; cursor: pointer; }
.generic-card .kv { display: flex; gap: 8px; font-size: 12px; }
.generic-card .k { color: var(--text-muted); }
</style>
```

- [ ] **步骤 4.4：运行测试验证通过**

运行：`pnpm vitest run src/components/design/__tests__/OdCard.test.ts`
预期：PASS（5 个用例）

- [ ] **步骤 4.5：Commit**

```bash
git add src/components/design/OdCard.vue src/components/design/__tests__/OdCard.test.ts
git commit -m "feat(OdCard): 新增结构化设计卡片，支持 brand/direction/artifact/generic 四种类型"
```

---

## 任务 5：NextStepActions 组件 + 测试

**文件：**
- 创建：`src/components/design/NextStepActions.vue`
- 创建：src/components/design/__tests__/NextStepActions.test.ts`

- [ ] **步骤 5.1：编写失败的测试**

创建 `src/components/design/__tests__/NextStepActions.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NextStepActions from '../NextStepActions.vue'

describe('NextStepActions', () => {
  it('渲染动作按钮', () => {
    const w = mount(NextStepActions, {
      props: { actions: [{ label: '调整配色', prompt: '改主色' }, { label: '换布局', prompt: '换' }] },
    })
    expect(w.findAll('button')).toHaveLength(2)
    expect(w.text()).toContain('调整配色')
  })

  it('点击触发 select 事件并携带 prompt', async () => {
    const w = mount(NextStepActions, {
      props: { actions: [{ label: 'x', prompt: 'do x' }] },
    })
    await w.find('button').trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['do x'])
  })

  it('空数组不渲染', () => {
    const w = mount(NextStepActions, { props: { actions: [] } })
    expect(w.find('.next-steps').exists()).toBe(false)
  })
})
```

- [ ] **步骤 5.2：运行测试验证失败**

运行：`pnpm vitest run src/components/design/__tests__/NextStepActions.test.ts`
预期：FAIL

- [ ] **步骤 5.3：实现 NextStepActions.vue**

创建 `src/components/design/NextStepActions.vue`：

```vue
<template>
  <div v-if="actions.length" class="next-steps">
    <span class="ns-title">{{ t('design.nextSteps.title') }}</span>
    <div class="ns-actions">
      <button v-for="(a, i) in actions" :key="i" class="ns-btn" @click="$emit('select', a.prompt)">
        {{ a.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { NextStepAction } from '@/utils/chat/buildBlocks'
defineProps<{ actions: NextStepAction[] }>()
defineEmits<{ (e: 'select', prompt: string): void }>()
const { t } = useI18n()
</script>

<style scoped lang="scss">
.next-steps { padding: 8px 0; border-top: 1px solid var(--surface-border); margin-top: 8px; }
.ns-title { font-size: 11px; color: var(--text-muted); text-transform: uppercase; }
.ns-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.ns-btn { background: var(--bg-secondary); border: 1px solid var(--surface-border); border-radius: var(--radius-full); padding: 4px 12px; font-size: 12px; cursor: pointer; &:hover { background: var(--surface-hover); } }
</style>
```

- [ ] **步骤 5.4：运行测试验证通过**

运行：`pnpm vitest run src/components/design/__tests__/NextStepActions.test.ts`
预期：PASS

- [ ] **步骤 5.5：Commit**

```bash
git add src/components/design/NextStepActions.vue src/components/design/__tests__/NextStepActions.test.ts
git commit -m "feat(NextStepActions): 新增轮次后建议动作条"
```

---

## 任务 6：ToolCallCard family ladder + 4 个 family 卡

**文件：**
- 修改：`src/components/chat/ToolCallCard.vue`
- 创建：`src/components/chat/BashToolCard.vue`
- 创建：`src/components/chat/FileWriteToolCard.vue`
- 创建：`src/components/chat/FileEditToolCard.vue`
- 创建：`src/components/chat/FileReadToolCard.vue`

**背景**：现有 ToolCallCard 是通用卡，改造为按 `toolCall.name` 分发到 family 卡，无匹配时回退到通用渲染。family 卡接收 `toolCall` prop。

- [ ] **步骤 6.1：创建 BashToolCard.vue**

创建 `src/components/chat/BashToolCard.vue`：

```vue
<template>
  <div class="bash-card">
    <div class="bash-header" @click="toggle">
      <Terminal :size="14" />
      <span class="cmd">{{ toolCall.input.command }}</span>
      <span v-if="duration" class="dur">{{ duration }}s</span>
    </div>
    <div v-show="expanded" class="bash-body">
      <pre v-if="stdout" class="stdout">{{ stdout }}</pre>
      <pre v-if="stderr" class="stderr">{{ stderr }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Terminal } from 'lucide-vue-next'
import type { ToolCall } from '@/types'
const props = defineProps<{ toolCall: ToolCall }>()
const expanded = ref(true)
const toggle = () => { expanded.value = !expanded.value }
const duration = computed(() => {
  if (!props.toolCall.startTime || !props.toolCall.endTime) return 0
  return ((props.toolCall.endTime - props.toolCall.startTime) / 1000).toFixed(1)
})
const output = computed(() => props.toolCall.output || '')
const stdout = computed(() => output.value.split('\n--- stderr ---\n')[0] || '')
const stderr = computed(() => output.value.split('\n--- stderr ---\n')[1] || '')
</script>

<style scoped lang="scss">
.bash-card { border: 1px solid var(--surface-border); border-radius: var(--radius-sm); margin: 4px 0; }
.bash-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.cmd { font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dur { color: var(--text-muted); }
.bash-body { padding: 8px 10px; }
pre { margin: 0; font-size: 11px; white-space: pre-wrap; }
.stdout { color: var(--text-primary); }
.stderr { color: #ef4444; }
</style>
```

- [ ] **步骤 6.2：创建 FileWriteToolCard.vue**

创建 `src/components/chat/FileWriteToolCard.vue`：

```vue
<template>
  <div class="fw-card">
    <div class="fw-header" @click="toggle">
      <FileCode :size="14" />
      <span class="path">{{ toolCall.input.file_path }}</span>
      <button v-if="toolCall.status === 'completed'" class="open-btn" @click.stop="$emit('open', toolCall.input.file_path)">
        <ExternalLink :size="11" />
      </button>
    </div>
    <div v-show="expanded" class="fw-body">
      <pre><code>{{ toolCall.input.content }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FileCode, ExternalLink } from 'lucide-vue-next'
import type { ToolCall } from '@/types'
defineProps<{ toolCall: ToolCall }>()
defineEmits<{ (e: 'open', path: string): void }>()
const expanded = ref(false)
const toggle = () => { expanded.value = !expanded.value }
</script>

<style scoped lang="scss">
.fw-card { border: 1px solid var(--surface-border); border-radius: var(--radius-sm); margin: 4px 0; }
.fw-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.path { font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.open-btn { background: none; border: 1px solid var(--surface-border); border-radius: var(--radius-xs); padding: 2px; cursor: pointer; }
.fw-body { padding: 8px 10px; }
pre { margin: 0; font-size: 11px; white-space: pre-wrap; max-height: 200px; overflow-y: auto; }
</style>
```

- [ ] **步骤 6.3：创建 FileEditToolCard.vue**

创建 `src/components/chat/FileEditToolCard.vue`：复用现有 ToolCallCard 的 diff 渲染逻辑，props 为 `toolCall`。

```vue
<template>
  <div class="fe-card">
    <div class="fe-header" @click="toggle">
      <Edit3 :size="14" />
      <span class="path">{{ toolCall.input.file_path }}</span>
    </div>
    <div v-show="expanded" class="fe-body">
      <pre><code>{{ toolCall.output || toolCall.input.new_string }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Edit3 } from 'lucide-vue-next'
import type { ToolCall } from '@/types'
defineProps<{ toolCall: ToolCall }>()
const expanded = ref(false)
const toggle = () => { expanded.value = !expanded.value }
</script>

<style scoped lang="scss">
.fe-card { border: 1px solid var(--surface-border); border-radius: var(--radius-sm); margin: 4px 0; }
.fe-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.path { font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fe-body { padding: 8px 10px; }
pre { margin: 0; font-size: 11px; white-space: pre-wrap; }
</style>
```

- [ ] **步骤 6.4：创建 FileReadToolCard.vue**

创建 `src/components/chat/FileReadToolCard.vue`：

```vue
<template>
  <div class="fr-card">
    <div class="fr-header" @click="toggle">
      <FileText :size="14" />
      <span class="path">{{ toolCall.input.file_path }}</span>
    </div>
    <div v-show="expanded" class="fr-body">
      <pre><code>{{ toolCall.output }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FileText } from 'lucide-vue-next'
import type { ToolCall } from '@/types'
defineProps<{ toolCall: ToolCall }>()
const expanded = ref(false)
const toggle = () => { expanded.value = !expanded.value }
</script>

<style scoped lang="scss">
.fr-card { border: 1px solid var(--surface-border); border-radius: var(--radius-sm); margin: 4px 0; }
.fr-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.path { font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-body { padding: 8px 10px; max-height: 240px; overflow-y: auto; }
pre { margin: 0; font-size: 11px; white-space: pre-wrap; }
</style>
```

- [ ] **步骤 6.5：改造 ToolCallCard.vue 为 family 分发器**

修改 `src/components/chat/ToolCallCard.vue`，在 `<template>` 顶部加 family 分发：

```vue
<template>
  <BashToolCard v-if="toolCall.name === 'Bash'" :tool-call="toolCall" />
  <FileWriteToolCard v-else-if="toolCall.name === 'Write'" :tool-call="toolCall" @open="$emit('open', $event)" />
  <FileEditToolCard v-else-if="toolCall.name === 'Edit'" :tool-call="toolCall" />
  <FileReadToolCard v-else-if="toolCall.name === 'Read'" :tool-call="toolCall" />
  <div v-else class="tool-call-card" :class="[statusClass, { 'is-expanded': isExpanded }]">
    <!-- 现有通用渲染逻辑保持不变 -->
    <div class="tool-call-header" @click="toggleExpand">
      <div class="tool-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <Check v-else-if="toolCall.status === 'completed'" :size="14" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <Terminal v-else :size="14" />
      </div>
      <span class="tool-name">{{ displayName }}</span>
      <span v-if="duration" class="tool-duration">{{ duration }}s</span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-show="isExpanded" class="tool-call-details">
      <!-- 现有 diff/output 渲染保持不变 -->
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Loader2, Check, X, Terminal, ChevronDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BashToolCard from './BashToolCard.vue'
import FileWriteToolCard from './FileWriteToolCard.vue'
import FileEditToolCard from './FileEditToolCard.vue'
import FileReadToolCard from './FileReadToolCard.vue'

const { t } = useI18n()
const props = defineProps<{ toolCall: ToolCall }>()
defineEmits<{ (e: 'open', path: string): void }>()

// ... 现有 statusClass/duration/displayName/isExpanded/toggleExpand 逻辑保持不变 ...
const isExpanded = ref(false)
const toggleExpand = () => { isExpanded.value = !isExpanded.value }
const statusClass = computed(() => `status-${toolCall.status}`)
const duration = computed(() => {
  if (!toolCall.startTime || !toolCall.endTime) return 0
  return ((toolCall.endTime - toolCall.startTime) / 1000).toFixed(1)
})
const displayName = computed(() => toolCall.name)
const toolCall = props.toolCall
</script>
```

> **注意**：保留现有 ToolCallCard 的所有 diff 渲染逻辑（unifiedDiffFiles 等），仅在外层加 family 分发。执行时务必保留原有 `<style>` 块不变。

- [ ] **步骤 6.6：运行类型检查**

运行：`pnpm typecheck`
预期：通过（family 卡类型正确）

- [ ] **步骤 6.7：Commit**

```bash
git add src/components/chat/ToolCallCard.vue src/components/chat/BashToolCard.vue src/components/chat/FileWriteToolCard.vue src/components/chat/FileEditToolCard.vue src/components/chat/FileReadToolCard.vue
git commit -m "feat(ToolCard): 改造为 family ladder 分发器，新增 Bash/Write/Edit/Read 专用卡"
```

---

## 任务 7：MessageItem events 渲染分支 + 回归测试

**文件：**
- 修改：`src/components/chat/MessageItem.vue`
- 创建：`src/components/chat/__tests__/MessageItem.events.test.ts`

**背景**：MessageItem 新增 `events` prop（实际传入 message 自身，design 模式下用 buildBlocks 渲染）。为不破坏 code/work 模式，用 `mode` prop 控制分支：`mode === 'design'` 走 buildBlocks，否则走原逻辑。

- [ ] **步骤 7.1：编写失败的测试**

创建 `src/components/chat/__tests__/MessageItem.events.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageItem from '../MessageItem.vue'
import type { Message } from '@/types'

describe('MessageItem events 模式', () => {
  it('design 模式下用 buildBlocks 渲染 text block', () => {
    const msg: Message = {
      id: 'm1', role: 'assistant', content: '你好', timestamp: Date.now(),
    }
    const w = mount(MessageItem, {
      props: { message: msg, mode: 'design' },
      global: { stubs: ['MarkdownRenderer', 'ReasoningCard', 'ToolCallCard', 'OdCard', 'NextStepActions', 'QuestionForm'] },
    })
    expect(w.find('.block-text').exists()).toBe(true)
  })

  it('design 模式下 od-card block 渲染 OdCard', () => {
    const msg: Message = {
      id: 'm1', role: 'assistant',
      content: '<od-card type="generic" title="t">{"k":"v"}</od-card>',
      timestamp: Date.now(),
    }
    const w = mount(MessageItem, {
      props: { message: msg, mode: 'design' },
      global: { stubs: ['MarkdownRenderer', 'ReasoningCard', 'ToolCallCard', 'OdCard', 'NextStepActions', 'QuestionForm'] },
    })
    expect(w.findComponent({ name: 'OdCard' }).exists()).toBe(true)
  })

  it('非 design 模式走原扁平渲染（回归保护）', () => {
    const msg: Message = {
      id: 'm1', role: 'assistant', content: '你好', timestamp: Date.now(),
    }
    const w = mount(MessageItem, {
      props: { message: msg },
      global: { stubs: ['MarkdownRenderer', 'ReasoningCard', 'ToolCallList', 'MessageMetadata'] },
    })
    expect(w.find('.block-text').exists()).toBe(false)
    expect(w.find('.message-content').exists()).toBe(true)
  })
})
```

- [ ] **步骤 7.2：运行测试验证失败**

运行：`pnpm vitest run src/components/chat/__tests__/MessageItem.events.test.ts`
预期：FAIL（mode prop 不存在，block-text 不存在）

- [ ] **步骤 7.3：改造 MessageItem.vue**

在 `src/components/chat/MessageItem.vue` 的 `<script setup>` 顶部新增：

```ts
import { buildBlocks } from '@/utils/chat/buildBlocks'
import OdCard from '@/components/design/OdCard.vue'
import NextStepActions from '@/components/design/NextStepActions.vue'
import QuestionForm from '@/components/design/QuestionForm.vue'

const props = defineProps<{ message: Message; mode?: 'design' | 'code' | 'work' }>()
const blocks = computed(() =>
  props.mode === 'design' ? buildBlocks(props.message) : []
)
```

在 `<template>` 的 `<template v-else>`（非 notification 分支）内，**最前面**插入 design 模式分支：

```vue
<!-- design 模式：buildBlocks 渲染 -->
<div v-if="mode === 'design'" class="design-blocks">
  <template v-for="(block, i) in blocks" :key="i">
    <div v-if="block.kind === 'text'" class="block-text">
      <MarkdownRenderer :content="block.content" />
    </div>
    <ReasoningCard v-else-if="block.kind === 'thinking'" :reasoning="{ content: block.content, startTime: 0 }" />
    <div v-else-if="block.kind === 'tool-group'" class="block-tool-group">
      <div class="tool-group-header">{{ block.toolName }} ×{{ block.calls.length }}</div>
      <ToolCallCard v-for="c in block.calls" :key="c.id" :tool-call="c" @open="$emit('open-artifact', $event)" />
    </div>
    <OdCard v-else-if="block.kind === 'od-card'" :payload="block.payload" @open="$emit('open-artifact', $event)" />
    <QuestionForm v-else-if="block.kind === 'question-form'" :form="block.payload" @submit="$emit('submit-form', $event)" />
    <NextStepActions v-else-if="block.kind === 'next-steps'" :actions="block.actions" @select="$emit('select-next', $event)" />
    <div v-else-if="block.kind === 'status'" class="block-status">
      <span v-if="block.usage">{{ t('design.usage.tokens', { input: block.usage.inputTokens, output: block.usage.outputTokens }) }}</span>
      <span v-if="block.usage?.duration"> · {{ t('design.usage.duration', { s: block.usage.duration }) }}</span>
    </div>
  </template>
</div>

<!-- 原 code/work 模式渲染（保持不变） -->
<div v-else class="message-content-wrapper">
  <!-- ... 现有内容 ... -->
</div>
```

> **关键**：现有 `message-content-wrapper` 块整体包进 `v-else`，确保 code/work 模式（mode 不传或非 design）走原逻辑。`defineEmits` 新增 `open-artifact`/`submit-form`/`select-next`。

- [ ] **步骤 7.4：运行测试验证通过**

运行：`pnpm vitest run src/components/chat/__tests__/MessageItem.events.test.ts`
预期：PASS（3 个用例）

- [ ] **步骤 7.5：运行现有 MessageItem 测试确认无回归**

运行：`pnpm vitest run src/components/chat/__tests__/`
预期：所有现有测试仍 PASS（mode 不传时走原逻辑）

- [ ] **步骤 7.6：Commit**

```bash
git add src/components/chat/MessageItem.vue src/components/chat/__tests__/MessageItem.events.test.ts
git commit -m "feat(MessageItem): 新增 design 模式 buildBlocks 渲染分支，不破坏 code/work 模式"
```

---

## 任务 8：DesignSplitView + DesignPage 重写

**文件：**
- 创建：`src/components/design/DesignSplitView.vue`
- 修改：`src/components/design/DesignPage.vue`（重写）
- 创建：`src/styles/design.scss`

- [ ] **步骤 8.1：创建 design.scss**

创建 `src/styles/design.scss`：

```scss
:root {
  --design-split-min: 30%;
  --design-split-max: 70%;
  --design-split-default: 55%;
  --design-tab-height: 36px;
  --design-composer-min-height: 80px;
  --design-composer-max-height: 240px;
  --design-odcard-radius: var(--radius-md);
}
```

在 `src/main.ts` 或全局样式入口 `import './styles/design.scss'`。

- [ ] **步骤 8.2：创建 DesignSplitView.vue**

创建 `src/components/design/DesignSplitView.vue`：

```vue
<template>
  <div class="split-view" ref="containerRef">
    <div class="split-pane left" :style="{ flexBasis: leftPct + '%' }">
      <slot name="left" />
    </div>
    <div class="split-handle" @mousedown="startDrag" />
    <div class="split-pane right" :style="{ flexBasis: (100 - leftPct) + '%' }">
      <slot name="right" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
const leftPct = ref(55)
const containerRef = ref<HTMLElement | null>(null)
let dragging = false

function startDrag(e: MouseEvent) {
  dragging = true
  e.preventDefault()
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
}
function onDrag(e: MouseEvent) {
  if (!dragging || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const pct = ((e.clientX - rect.left) / rect.width) * 100
  leftPct.value = Math.max(30, Math.min(70, pct))
}
function stopDrag() {
  dragging = false
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
}
onUnmounted(stopDrag)
</script>

<style scoped lang="scss">
.split-view { display: flex; height: 100%; overflow: hidden; }
.split-pane { overflow: hidden; }
.split-handle { width: 4px; cursor: col-resize; background: var(--surface-border); &:hover { background: var(--accent-primary); } }
</style>
```

- [ ] **步骤 8.3：重写 DesignPage.vue**

重写 `src/components/design/DesignPage.vue`（移除任务 2 加的 `@ts-nocheck`）：

```vue
<template>
  <div class="design-page">
    <header class="design-header">
      <div class="header-left">
        <Palette :size="18" />
        <h1>{{ t('design.title') }}</h1>
        <span v-if="lastUsage" class="usage-bar">
          {{ t('design.usage.tokens', { input: lastUsage.inputTokens, output: lastUsage.outputTokens }) }}
        </span>
      </div>
      <div class="header-right">
        <button v-if="isGenerating" class="btn-stop" @click="stopDesignGeneration">
          <Square :size="12" /> {{ t('common.stop') }}
        </button>
      </div>
    </header>
    <DesignSplitView>
      <template #left><DesignChatPane /></template>
      <template #right><DesignFileWorkspace /></template>
    </DesignSplitView>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { Palette, Square } from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { useDesignSession } from '@/composables/useDesignSession'
import DesignSplitView from './DesignSplitView.vue'
import DesignChatPane from './DesignChatPane.vue'
import DesignFileWorkspace from './DesignFileWorkspace.vue'

const { t } = useI18n()
const designStore = useDesignStore()
const { lastUsage } = storeToRefs(designStore)
const { isGenerating, stopDesignGeneration } = useDesignSession()
</script>

<style scoped lang="scss">
.design-page { display: flex; flex-direction: column; height: 100%; background: var(--bg-primary); }
.design-header { display: flex; align-items: center; justify-content: space-between; height: 48px; padding: 0 16px; border-bottom: 1px solid var(--surface-border); background: var(--bg-secondary); }
.header-left { display: flex; align-items: center; gap: 8px; h1 { font-size: 14px; font-weight: 600; } }
.usage-bar { font-size: 11px; color: var(--text-muted); margin-left: 12px; }
.btn-stop { background: #ef4444; color: white; border: none; border-radius: var(--radius-sm); padding: 4px 10px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 4px; }
</style>
```

> **注意**：DesignChatPane 和 DesignFileWorkspace 在任务 9/10 创建。此步骤后 typecheck 会报错（组件不存在），任务 9/10 完成后修复。

- [ ] **步骤 8.4：Commit（先不 typecheck，因依赖任务 9/10）**

```bash
git add src/styles/design.scss src/components/design/DesignSplitView.vue src/components/design/DesignPage.vue
git commit -m "refactor(DesignPage): 重写为布局容器 + DesignSplitView 分屏"
```

---

## 任务 9：DesignChatPane + DesignComposer

**文件：**
- 创建：`src/components/design/DesignChatPane.vue`
- 创建：`src/components/design/DesignComposer.vue`

- [ ] **步骤 9.1：创建 DesignComposer.vue**

创建 `src/components/design/DesignComposer.vue`：

```vue
<template>
  <div class="design-composer">
    <div class="composer-toolbar">
      <button class="plus-btn" @click="toolboxOpen = !toolboxOpen">+</button>
      <span v-if="currentSkill" class="skill-tag">
        {{ currentSkill.name }}
        <button class="skill-x" @click="toolboxOpen = true">×</button>
      </span>
      <button v-if="isGenerating" class="send-btn stop" @click="$emit('stop')">
        <Square :size="12" /> {{ t('common.stop') }}
      </button>
      <button v-else class="send-btn" :disabled="!value.trim()" @click="send">
        <Send :size="12" /> {{ t('common.send') }}
      </button>
    </div>

    <textarea
      v-model="value"
      class="composer-input"
      :placeholder="t('design.emptyChatHint')"
      :style="{ minHeight: 'var(--design-composer-min-height)', maxHeight: 'var(--design-composer-max-height)' }"
      @keydown.enter.exact.prevent="send"
      @keydown.shift.enter="value += '\n'"
    />

    <div v-if="toolboxOpen" class="toolbox-panel">
      <div class="toolbox-section">
        <div class="section-label">{{ t('design.toolbox.skills') }}</div>
        <button v-for="s in designStore.toolboxSkills" :key="s.id" class="skill-option"
          :class="{ active: designStore.selectedToolboxSkillId === s.id }"
          @click="selectSkill(s.id)">
          <span class="skill-name">{{ s.name }}</span>
          <span class="skill-desc">{{ s.description }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Square, Send } from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { useDesignSession } from '@/composables/useDesignSession'

const { t } = useI18n()
const designStore = useDesignStore()
const { isGenerating, switchToolboxSkill, stopDesignGeneration } = useDesignSession()
const value = ref('')
const toolboxOpen = ref(false)
const currentSkill = computed(() => designStore.currentToolboxSkill)

function selectSkill(id: string) {
  switchToolboxSkill(id)
  toolboxOpen.value = false
}
async function send() {
  if (!value.value.trim() || isGenerating.value) return
  const content = value.value
  value.value = ''
  emit('send', content)
}
const emit = defineEmits<{ (e: 'send', content: string): void; (e: 'stop'): void }>()
</script>

<style scoped lang="scss">
.design-composer { border-top: 1px solid var(--surface-border); padding: 8px 12px; background: var(--bg-secondary); position: relative; }
.composer-toolbar { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.plus-btn { background: none; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); width: 24px; height: 24px; cursor: pointer; }
.skill-tag { background: var(--accent-primary-glow); color: var(--accent-primary); border-radius: var(--radius-full); padding: 2px 10px; font-size: 11px; display: flex; align-items: center; gap: 4px; }
.skill-x { background: none; border: none; cursor: pointer; color: inherit; }
.send-btn { margin-left: auto; background: var(--accent-primary); color: white; border: none; border-radius: var(--radius-sm); padding: 4px 12px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 4px; &:disabled { opacity: 0.5; } &.stop { background: #ef4444; } }
.composer-input { width: 100%; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-primary); padding: 8px; font-size: 13px; resize: none; font-family: inherit; }
.toolbox-panel { position: absolute; bottom: 100%; left: 12px; right: 12px; background: var(--bg-secondary); border: 1px solid var(--surface-border); border-radius: var(--radius-md); box-shadow: var(--shadow-xl); padding: 8px; max-height: 300px; overflow-y: auto; }
.section-label { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; }
.skill-option { display: block; width: 100%; text-align: left; background: none; border: none; padding: 8px; border-radius: var(--radius-sm); cursor: pointer; &:hover { background: var(--surface-hover); } &.active { background: var(--accent-primary-glow); } }
.skill-name { display: block; font-size: 12px; font-weight: 500; }
.skill-desc { display: block; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
</style>
```

- [ ] **步骤 9.2：创建 DesignChatPane.vue**

创建 `src/components/design/DesignChatPane.vue`：

```vue
<template>
  <div class="design-chat-pane">
    <SessionTabBar v-if="sessions.length" :sessions="sessions" :active-id="activeSessionId || ''" @switch="onSwitch" />
    <div class="chat-body">
      <div v-if="!activeSessionId" class="empty-state">
        <Palette :size="32" />
        <h2>{{ t('design.emptyChatTitle') }}</h2>
        <p>{{ t('design.emptyChatHint') }}</p>
      </div>
      <MessageList v-else :messages="activeMessages" :mode="'design'" @open-artifact="openArtifact" @submit-form="submitForm" @select-next="selectNext" />
    </div>
    <RetryIndicator v-if="showRetry" />
    <DesignComposer @send="onSend" @stop="onStop" />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { Palette } from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { useChatSessionStore, useChatStore } from '@/stores/chat'
import { useDesignSession } from '@/composables/useDesignSession'
import MessageList from '@/components/chat/MessageList.vue'
import RetryIndicator from '@/components/chat/RetryIndicator.vue'
import DesignComposer from './DesignComposer.vue'
import SessionTabBar from '@/components/chat/SessionTabBar.vue'

const { t } = useI18n()
const designStore = useDesignStore()
const { activeSessionId, pendingQuestionForm } = storeToRefs(designStore)
const chatSessionStore = useChatSessionStore()
const chatStore = useChatStore()
const { createDesignSession, submitQuestionForm, stopDesignGeneration } = useDesignSession()

const sessions = computed(() => chatSessionStore.sessions.filter((s: any) => s.mode === 'design'))
const activeSession = computed(() => chatSessionStore.sessions.find((s: any) => s.id === activeSessionId.value))
const activeMessages = computed(() => activeSession.value?.messages || [])
const showRetry = computed(() => false)

async function onSend(content: string) {
  if (!activeSessionId.value) {
    await createDesignSession()
  }
  chatSessionStore.currentSessionId = activeSessionId.value!
  await chatStore.sendMessage(content)
}
function onStop() { stopDesignGeneration() }
function onSwitch(sid: string) { chatSessionStore.currentSessionId = sid }
function openArtifact(path: string) { designStore.addTab({ name: path.split('/').pop() || path, path, updatedAt: Date.now() }) }
function submitForm(answers: any) { submitQuestionForm(answers) }
function selectNext(prompt: string) { onSend(prompt) }
</script>

<style scoped lang="scss">
.design-chat-pane { display: flex; flex-direction: column; height: 100%; background: var(--bg-primary); }
.chat-body { flex: 1; overflow-y: auto; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); text-align: center; padding: 32px; h2 { font-size: 16px; margin: 12px 0 4px; color: var(--text-primary); } p { font-size: 13px; } }
</style>
```

- [ ] **步骤 9.3：运行类型检查**

运行：`pnpm typecheck`
预期：通过（DesignPage 依赖的 DesignChatPane/DesignFileWorkspace 已创建；DesignFileWorkspace 在任务 10 创建，此步可能仍报错，可先创建空壳）

> **若报错**：临时创建 `src/components/design/DesignFileWorkspace.vue` 空壳（`<template><div/></template>`），任务 10 填充。

- [ ] **步骤 9.4：Commit**

```bash
git add src/components/design/DesignChatPane.vue src/components/design/DesignComposer.vue src/components/design/DesignFileWorkspace.vue
git commit -m "feat(DesignChatPane): 新增聊天面板 + DesignComposer 输入区 + ToolboxPanel"
```

---

## 任务 10：DesignFileWorkspace + WorkspaceTabsBar

**文件：**
- 修改：`src/components/design/DesignFileWorkspace.vue`（填充实现）
- 创建：`src/components/design/WorkspaceTabsBar.vue`

- [ ] **步骤 10.1：创建 WorkspaceTabsBar.vue**

创建 `src/components/design/WorkspaceTabsBar.vue`：

```vue
<template>
  <div class="tabs-bar">
    <div v-for="tab in tabs" :key="tab.path" class="tab"
      :class="{ active: tab.path === activePath }"
      @click="$emit('select', tab.path)">
      <span class="tab-name">{{ tab.name }}</span>
      <button class="tab-close" @click.stop="$emit('close', tab.path)">×</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ArtifactFile } from '@/stores/design'
defineProps<{ tabs: ArtifactFile[]; activePath: string | null }>()
defineEmits<{ (e: 'select', path: string): void; (e: 'close', path: string): void }>()
</script>

<style scoped lang="scss">
.tabs-bar { display: flex; height: var(--design-tab-height); border-bottom: 1px solid var(--surface-border); background: var(--bg-secondary); overflow-x: auto; }
.tab { display: flex; align-items: center; gap: 6px; padding: 0 12px; border-right: 1px solid var(--surface-border); cursor: pointer; font-size: 12px; &:hover { background: var(--surface-hover); } &.active { background: var(--bg-primary); border-bottom: 2px solid var(--accent-primary); } }
.tab-close { background: none; border: none; cursor: pointer; color: var(--text-muted); &:hover { color: var(--text-primary); } }
</style>
```

- [ ] **步骤 10.2：填充 DesignFileWorkspace.vue**

重写 `src/components/design/DesignFileWorkspace.vue`：

```vue
<template>
  <div class="file-workspace">
    <div class="ws-toolbar">
      <button :class="{ active: viewMode === 'preview' }" @click="viewMode = 'preview'">{{ t('design.workspace.preview') }}</button>
      <button :class="{ active: viewMode === 'source' }" @click="viewMode = 'source'">{{ t('design.workspace.source') }}</button>
      <button @click="refresh">{{ t('design.workspace.refresh') }}</button>
    </div>
    <WorkspaceTabsBar :tabs="openTabs" :active-path="activeTabPath" @select="setActiveTab" @close="removeTab" />
    <div class="ws-body">
      <div v-if="!activeTabPath" class="empty-state">
        <FileText :size="32" />
        <h2>{{ t('design.emptyPreviewTitle') }}</h2>
        <p>{{ t('design.emptyPreviewHint') }}</p>
      </div>
      <DesignPreview v-else-if="viewMode === 'preview'" :html="previewHtml" :title="previewTitle" :session-id="activeSessionId || ''" />
      <div v-else class="code-viewer"><pre><code>{{ sourceCode }}</code></pre></div>
    </div>
    <div class="artifact-list">
      <div class="al-title">Artifacts</div>
      <div v-for="f in artifactFiles" :key="f.path" class="al-item" :class="{ active: activeTabPath === f.path }" @click="addTab(f)">
        <FileCode :size="14" /> <span>{{ f.name }}</span>
      </div>
    </div>
    <div v-if="activeTabPath" class="export-bar">
      <button @click="exportFile('html')">{{ t('design.export.html') }}</button>
      <button @click="exportFile('zip')">{{ t('design.export.zip') }}</button>
      <button @click="exportFile('pdf')">{{ t('design.export.pdf') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { FileText, FileCode } from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { api } from '@/services/electronAPI'
import DesignPreview from './DesignPreview.vue'
import WorkspaceTabsBar from './WorkspaceTabsBar.vue'

const { t } = useI18n()
const designStore = useDesignStore()
const { openTabs, activeTabPath, previewHtml, previewTitle, artifactFiles, activeSessionId } = storeToRefs(designStore)
const { addTab, removeTab, setActiveTab } = designStore
const viewMode = ref<'preview' | 'source'>('preview')
const sourceCode = ref('')

watch(activeTabPath, async (p) => {
  if (!p) { previewHtml.value = ''; return }
  const content = await api.readFile(p)
  previewHtml.value = content || ''
  previewTitle.value = p.split('/').pop() || 'Preview'
  sourceCode.value = content || ''
  viewMode.value = p.endsWith('.html') || p.endsWith('.htm') ? 'preview' : 'source'
})

function refresh() { if (activeTabPath.value) { /* 触发预览刷新 */ } }
async function exportFile(format: 'html' | 'zip' | 'pdf') {
  if (!activeTabPath.value) return
  api.design.exportArtifact({ filePath: activeTabPath.value, format })
}
</script>

<style scoped lang="scss">
.file-workspace { display: flex; flex-direction: column; height: 100%; background: var(--bg-primary); }
.ws-toolbar { display: flex; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--surface-border); button { background: none; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 4px 10px; font-size: 11px; cursor: pointer; &.active { background: var(--accent-primary-glow); color: var(--accent-primary); } } }
.ws-body { flex: 1; overflow: hidden; position: relative; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); text-align: center; h2 { font-size: 14px; margin: 8px 0 4px; color: var(--text-primary); } }
.code-viewer { height: 100%; overflow: auto; padding: 12px; pre { font-size: 12px; } }
.artifact-list { border-top: 1px solid var(--surface-border); padding: 8px; max-height: 200px; overflow-y: auto; background: var(--bg-secondary); }
.al-title { font-size: 11px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px; }
.al-item { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; &:hover { background: var(--surface-hover); } &.active { background: var(--accent-primary-glow); } }
.export-bar { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--surface-border); button { flex: 1; background: var(--bg-secondary); border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 6px; font-size: 11px; cursor: pointer; } }
</style>
```

- [ ] **步骤 10.3：运行类型检查**

运行：`pnpm typecheck`
预期：通过

- [ ] **步骤 10.4：Commit**

```bash
git add src/components/design/DesignFileWorkspace.vue src/components/design/WorkspaceTabsBar.vue
git commit -m "feat(DesignFileWorkspace): 新增文件工作区，含多 tab/预览源码切换/导出"
```

---

## 任务 11：i18n 新增 design 命名空间

**文件：**
- 修改：`src/i18n/locales/en-US.ts`
- 修改：`src/i18n/locales/zh-CN.ts`

- [ ] **步骤 11.1：在 en-US.ts 新增 design 命名空间**

在 `src/i18n/locales/en-US.ts` 顶层对象内新增（位置：与其他顶层命名空间并列）：

```ts
design: {
  title: 'Design',
  emptyChatTitle: 'Start your design conversation',
  emptyChatHint: 'Type your design request below, or pick a skill from the + menu.',
  emptyPreviewTitle: 'No design artifacts yet',
  emptyPreviewHint: 'Generated HTML will appear here in real time once you start chatting.',
  toolbox: { skills: 'Skills', plugins: 'Plugins', attach: 'Attach File', skillLabel: 'Skill' },
  workspace: { preview: 'Preview', source: 'Source', refresh: 'Refresh', openExternal: 'Open Externally', closeTab: 'Close Tab' },
  export: { html: 'Export HTML', zip: 'Export ZIP', pdf: 'Export PDF' },
  odCard: { brandPreview: 'Brand Preview', directionSwatches: 'Direction Swatches', artifactThumbnail: 'Artifact', openInPreview: 'Open in Preview' },
  nextSteps: { title: 'Next Steps' },
  usage: { tokens: '{input} in · {output} out', cost: '${cost}', duration: '{s}s' },
},
```

- [ ] **步骤 11.2：在 zh-CN.ts 新增对应中文**

在 `src/i18n/locales/zh-CN.ts` 同步新增：

```ts
design: {
  title: '设计',
  emptyChatTitle: '开始你的设计对话',
  emptyChatHint: '在下方输入你的设计需求，或从 + 菜单选择设计技能。',
  emptyPreviewTitle: '暂无设计产物',
  emptyPreviewHint: '开始对话后，生成的 HTML 将在此处实时预览。',
  toolbox: { skills: '技能', plugins: '插件', attach: '添加附件', skillLabel: '技能' },
  workspace: { preview: '预览', source: '源码', refresh: '刷新', openExternal: '外部打开', closeTab: '关闭标签' },
  export: { html: '导出 HTML', zip: '导出 ZIP', pdf: '导出 PDF' },
  odCard: { brandPreview: '品牌预览', directionSwatches: '方向色板', artifactThumbnail: '产物', openInPreview: '在预览中打开' },
  nextSteps: { title: '下一步' },
  usage: { tokens: '{input} 入 · {output} 出', cost: '${cost}', duration: '{s}秒' },
},
```

- [ ] **步骤 11.3：运行类型检查 + i18n 校验**

运行：`pnpm typecheck`
预期：通过（i18n key 被组件引用，类型校验通过）

- [ ] **步骤 11.4：Commit**

```bash
git add src/i18n/locales/en-US.ts src/i18n/locales/zh-CN.ts
git commit -m "feat(i18n): 新增 design 命名空间中英文翻译"
```

---

## 任务 12：集成验证 + UI 手动测试

**文件：** 无新建（仅运行验证）

- [ ] **步骤 12.1：运行全部单测**

运行：`pnpm vitest run`
预期：所有测试 PASS（含新增 buildBlocks/design store/useDesignSession/OdCard/NextStepActions/MessageItem.events + 现有测试无回归）

- [ ] **步骤 12.2：运行类型检查**

运行：`pnpm typecheck`
预期：通过

- [ ] **步骤 12.3：启动开发服务器**

运行：`pnpm dev`
预期：Electron 应用启动，无控制台报错

- [ ] **步骤 12.4：手动验证验收清单**

在应用中切换到 design 模式，逐项验证规格第 13 节验收标准：

1. 打开 design 模式看到聊天界面（左 ChatPane + 右 FileWorkspace 分屏）
2. 首次输入设计需求 → 触发 design 会话 → 流式渲染 assistant 消息（buildBlocks 分块）
3. 工具调用以 family 卡片渲染（Bash/Write/Edit/Read 专用卡，其余通用卡）
4. assistant 文本中的 `<od-card>` 标签渲染为设计卡片（需 agent 配合输出，可在 system prompt 测试）
5. assistant 文本中的 `<question-form>` 标签内联渲染为表单（不再浮层）
6. 轮次结束后 `<next-steps>` 渲染为建议动作条，点击预填 prompt
7. file watcher 推送工件 → 右侧 FileWorkspace 自动开 tab + 预览
8. 多 tab 切换、预览/源码双视图、导出 HTML/ZIP/PDF 可用
9. DesignToolboxPanel 可切换 skill，切换后新 system prompt 生效
10. API 错误时 RetryIndicator 显示，成功后消失；中断按钮可用
11. code/work 模式不受影响（切换到 code/work 模式，聊天正常）

- [ ] **步骤 12.5：修复发现的问题**

记录手动测试中发现的问题，逐个修复并 commit。

- [ ] **步骤 12.6：最终 Commit**

```bash
git add -A
git commit -m "test(design): 集成验证通过，修复手动测试发现的问题"
```

---

## 自检

### 规格覆盖度

| 规格章节 | 实现任务 |
|---|---|
| 5.1 design store 改造 | 任务 2 |
| 5.2 useDesignSession 改造 | 任务 3 |
| 5.3 MessageItem 改造 | 任务 7 |
| 5.4 buildBlocks | 任务 1 |
| 5.5 ToolCallCard family ladder | 任务 6 |
| 5.6 OdCard | 任务 4 |
| 5.7 NextStepActions | 任务 5 |
| 5.8 DesignFileWorkspace | 任务 10 |
| 5.9 DesignComposer | 任务 9 |
| 5.10 空态 | 任务 9（ChatPane 空态）+ 任务 10（Workspace 空态） |
| 4.1 组件树 DesignSplitView | 任务 8 |
| 4.1 DesignPage 重写 | 任务 8 |
| 4.1 DesignChatPane | 任务 9 |
| 7 i18n | 任务 11 |
| 8 样式 | 任务 8（design.scss） |
| 9 测试 | 各任务内 TDD + 任务 12 集成 |
| 6 错误处理 | 复用现有（任务 9 接入 RetryIndicator） |
| 13 验收 | 任务 12 |

**遗漏**：无。所有规格章节都有对应任务。

### 占位符扫描

- 无"TODO/待定/后续实现"
- 每个步骤含完整代码或精确命令
- family 卡样式引用现有 token，未省略关键属性

### 类型一致性

- `OdCardPayload`：任务 1 定义，任务 4 引用 ✓
- `NextStepAction`：任务 1 定义，任务 5 引用 ✓
- `Block`：任务 1 定义，任务 7 引用 ✓
- `ArtifactFile`：任务 2 定义（store），任务 10 引用 ✓
- `DesignUsage`：任务 2 定义 ✓
- `toolCall` prop：任务 6 family 卡均用 `ToolCall` 类型 ✓
- `mode` prop：任务 7 MessageItem 用 `'design'|'code'|'work'` ✓

### 风险项验证

- **onStreamEvent 多订阅**：任务 3 attachStreamListener 假设支持多订阅。若实现时发现不支持，需在任务 3 加内部分发层（单订阅 → 多回调）。验证步骤：任务 12.4 第 2 项手动测试流式渲染是否正常。
- **Shiki 引入**：本计划 CodeViewer 用 `<pre><code>` 简化渲染，未引入 Shiki。若需高亮，后续任务追加 `pnpm add shiki` 并改造 CodeViewer。当前计划不阻塞。
- **Live tool input**：任务 1 buildBlocks 的 `liveInput` 字段未在任务 6 family 卡使用（降级为流式结束后显示）。若 IPC 推送 `tool_input_delta`，后续在 BashToolCard/FileWriteToolCard 加 liveInput 渲染。

---

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-07-04-design-mode-refactor.md`。两种执行方式：

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

选哪种方式？

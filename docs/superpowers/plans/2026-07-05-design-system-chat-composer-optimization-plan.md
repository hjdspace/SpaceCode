# SpaceCode 设计系统与聊天输入框优化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。
> 依赖规格：[`docs/superpowers/specs/2026-07-05-design-system-chat-composer-optimization-design.md`](file:///d:/AI/SpaceCode/docs/superpowers/specs/2026-07-05-design-system-chat-composer-optimization-design.md)

**目标：** 重构 `DesignComposer.vue` 布局，使模板选择器内置于输入框、`+` 按钮作为更多功能入口、设计系统与工作目录位于输入框下方；保持并微调设计系统下拉与预览弹窗。

**架构：** `DesignComposer` 改为"输入框容器 + 底部工具栏"两层结构；`TemplatePicker` 提供紧凑触发形态以嵌入输入框；新增 `WorkingDirectoryPicker` 复用现有 `selectFolder` IPC；`+` 菜单合并原 toolbox skill 入口。

**技术栈：** Vue 3 + TypeScript + Pinia + Electron IPC + Vitest + vue-i18n + SCSS

---

## 文件结构

### 新建文件

- `src/components/design/WorkingDirectoryPicker.vue` — 工作目录选择/展示按钮
- `src/components/design/__tests__/DesignComposer.test.ts` — DesignComposer 组件测试
- `src/components/design/__tests__/WorkingDirectoryPicker.test.ts` — 工作目录选择器测试

### 修改文件

- `src/components/design/DesignComposer.vue` — 布局重构、+ 菜单、移除顶部 skill 弹窗
- `src/components/design/TemplatePicker.vue` — 支持紧凑触发形态与内部定位
- `src/i18n/locales/zh-CN.ts` — 新增 + 菜单、工作目录相关翻译键
- `src/i18n/locales/en-US.ts` — 对应英文翻译
- `src/components/design/__tests__/TemplatePicker.test.ts` — 更新断言适配新触发形态

---

## 任务 1：新增 `WorkingDirectoryPicker.vue`

**文件：**
- 创建：`src/components/design/WorkingDirectoryPicker.vue`
- 测试：`src/components/design/__tests__/WorkingDirectoryPicker.test.ts`

### 步骤 1：编写失败的测试

创建 `src/components/design/__tests__/WorkingDirectoryPicker.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import WorkingDirectoryPicker from '../WorkingDirectoryPicker.vue'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/electronAPI', () => ({
  api: {
    selectFolder: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/new/project'] }),
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

describe('WorkingDirectoryPicker', () => {
  beforeEach(() => {
    config.global.plugins = [i18n]
  })

  it('渲染当前目录名', () => {
    const w = mount(WorkingDirectoryPicker, { props: { modelValue: '/users/project' } })
    expect(w.text()).toContain('project')
  })

  it('点击触发 selectFolder 并回传路径', async () => {
    const { api } = await import('@/services/electronAPI')
    const w = mount(WorkingDirectoryPicker, { props: { modelValue: '' } })
    await w.find('[data-testid="working-dir-trigger"]').trigger('click')
    expect(api.selectFolder).toHaveBeenCalled()
    const events = w.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual(['/new/project'])
  })
})
```

运行测试：

```bash
npx vitest run src/components/design/__tests__/WorkingDirectoryPicker.test.ts
```

预期：FAIL — 组件不存在。

### 步骤 2：实现组件

创建 `src/components/design/WorkingDirectoryPicker.vue`：

```vue
<template>
  <button
    type="button"
    class="working-dir-picker"
    data-testid="working-dir-trigger"
    :title="modelValue || t('design.workingDirectory.none')"
    @click="pick"
  >
    <Folder :size="13" />
    <span class="working-dir-value">{{ displayName }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Folder } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', path: string): void }>()

const { t } = useI18n()

const displayName = computed(() => {
  if (!props.modelValue) return t('design.workingDirectory.none')
  const parts = props.modelValue.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || props.modelValue
})

async function pick() {
  const result = await api.selectFolder()
  if (!result.canceled && result.filePaths.length > 0) {
    emit('update:modelValue', result.filePaths[0])
  }
}
</script>

<style scoped lang="scss">
.working-dir-picker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full);
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-primary);
  transition: background var(--transition-fast), border-color var(--transition-fast);
  max-width: 180px;
}
.working-dir-picker:hover {
  background: var(--bg-hover);
  border-color: var(--surface-border-strong);
}
.working-dir-value {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

### 步骤 3：运行测试验证

```bash
npx vitest run src/components/design/__tests__/WorkingDirectoryPicker.test.ts
```

预期：PASS

### 步骤 4：Commit

```bash
git add src/components/design/WorkingDirectoryPicker.vue src/components/design/__tests__/WorkingDirectoryPicker.test.ts
git commit -m "feat(design): 新增 WorkingDirectoryPicker 工作目录选择器"
```

---

## 任务 2：调整 `TemplatePicker.vue` 以支持输入框内紧凑触发

**文件：**
- 修改：`src/components/design/TemplatePicker.vue`
- 测试：`src/components/design/__tests__/TemplatePicker.test.ts`

### 步骤 1：更新组件支持 `inline` 模式

修改 `TemplatePicker.vue`：

1. 在 `<script setup>` 中新增 prop：

```ts
const props = defineProps<{
  modelValue: string | null
  inline?: boolean
}>()
```

2. 在模板中给根容器添加 class 绑定：

```vue
<div ref="wrapRef" class="template-picker" :class="{ 'is-open': open, 'has-value': active, 'is-inline': inline }">
```

3. 给触发按钮添加 `inline` class：

```vue
<button
  type="button"
  class="template-picker-trigger"
  :class="{ 'is-inline': inline }"
  data-testid="template-picker-trigger"
  @click="open = !open"
>
```

4. 在 `<style>` 底部添加 inline 样式：

```scss
.template-picker-trigger.is-inline {
  background: transparent;
  border-color: transparent;
  padding-left: 4px;
  padding-right: 4px;
}
.template-picker-trigger.is-inline:hover {
  background: var(--surface-hover);
  border-color: var(--surface-border);
}
.template-picker.is-inline .template-picker-menu {
  left: 0;
  bottom: calc(100% + 8px);
}
```

### 步骤 2：更新测试

在 `src/components/design/__tests__/TemplatePicker.test.ts` 中添加 inline 模式断言：

```ts
it('inline 模式下触发器使用透明背景', async () => {
  const w = mount(TemplatePicker, { props: { modelValue: null, inline: true } })
  expect(w.find('.template-picker-trigger.is-inline').exists()).toBe(true)
})
```

### 步骤 3：运行测试验证

```bash
npx vitest run src/components/design/__tests__/TemplatePicker.test.ts
```

预期：PASS

### 步骤 4：Commit

```bash
git add src/components/design/TemplatePicker.vue src/components/design/__tests__/TemplatePicker.test.ts
git commit -m "feat(design): TemplatePicker 支持 inline 紧凑模式"
```

---

## 任务 3：重构 `DesignComposer.vue` 布局

**文件：**
- 修改：`src/components/design/DesignComposer.vue`
- 测试：`src/components/design/__tests__/DesignComposer.test.ts`

### 步骤 1：编写失败的测试

创建 `src/components/design/__tests__/DesignComposer.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import DesignComposer from '../DesignComposer.vue'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/electronAPI', () => ({
  api: {
    design: { listSystems: vi.fn().mockResolvedValue([]) },
    selectFolder: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

describe('DesignComposer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    config.global.plugins = [i18n]
  })

  it('渲染 + 按钮、模板选择器、发送按钮', () => {
    const w = mount(DesignComposer)
    expect(w.find('[data-testid="composer-plus-btn"]').exists()).toBe(true)
    expect(w.find('[data-testid="template-picker-trigger"]').exists()).toBe(true)
    expect(w.find('[data-testid="composer-send-btn"]').exists()).toBe(true)
  })

  it('底部渲染设计系统选择器和工作目录选择器', () => {
    const w = mount(DesignComposer)
    expect(w.find('[data-testid="ds-picker-trigger"]').exists()).toBe(true)
    expect(w.find('[data-testid="working-dir-trigger"]').exists()).toBe(true)
  })

  it('点击 + 按钮展开更多功能菜单', async () => {
    const w = mount(DesignComposer)
    expect(w.find('[data-testid="composer-plus-menu"]').exists()).toBe(false)
    await w.find('[data-testid="composer-plus-btn"]').trigger('click')
    expect(w.find('[data-testid="composer-plus-menu"]').exists()).toBe(true)
  })

  it('输入内容后点击发送触发 send 事件', async () => {
    const w = mount(DesignComposer)
    const textarea = w.find('textarea')
    await textarea.setValue('hello')
    await w.find('[data-testid="composer-send-btn"]').trigger('click')
    expect(w.emitted('send')).toBeTruthy()
    expect(w.emitted('send')![0]).toEqual(['hello'])
  })
})
```

运行测试：

```bash
npx vitest run src/components/design/__tests__/DesignComposer.test.ts
```

预期：FAIL — 组件不存在对应 data-testid 与布局。

### 步骤 2：重构 DesignComposer.vue

完全替换 `src/components/design/DesignComposer.vue` 模板与脚本：

```vue
<template>
  <div class="design-composer">
    <div class="composer-input-wrap">
      <button
        type="button"
        class="plus-btn"
        data-testid="composer-plus-btn"
        @click="plusMenuOpen = !plusMenuOpen"
      >
        <Plus :size="14" />
      </button>

      <TemplatePicker
        v-model="designStore.selectedTemplateId"
        inline
        data-testid="composer-template-picker"
      />

      <textarea
        v-model="value"
        class="composer-input"
        :placeholder="t('design.emptyChatHint')"
        :style="{ minHeight: 'var(--design-composer-min-height)', maxHeight: 'var(--design-composer-max-height)' }"
        @keydown.enter.exact.prevent="send"
        @keydown.shift.enter="value += '\n'"
      />

      <button
        v-if="isGenerating"
        type="button"
        class="send-btn stop"
        data-testid="composer-send-btn"
        @click="$emit('stop')"
      >
        <Square :size="12" /> {{ t('common.stop') }}
      </button>
      <button
        v-else
        type="button"
        class="send-btn"
        data-testid="composer-send-btn"
        :disabled="!value.trim()"
        @click="send"
      >
        <Send :size="12" /> {{ t('common.send') }}
      </button>

      <div v-if="plusMenuOpen" class="plus-menu" data-testid="composer-plus-menu">
        <div class="plus-menu-section">
          <div class="section-label">{{ t('design.toolbox.skills') }}</div>
          <button
            v-for="s in designStore.toolboxSkills"
            :key="s.id"
            type="button"
            class="skill-option"
            :class="{ active: designStore.selectedToolboxSkillId === s.id }"
            @click="selectSkill(s.id)"
          >
            <span class="skill-name">{{ s.name }}</span>
            <span class="skill-desc">{{ s.description }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="composer-toolbar-bottom">
      <DesignSystemPicker
        v-model="designStore.selectedDesignSystemId"
        :systems="designSystems"
        @update:model-value="onDesignSystemChange"
      />
      <WorkingDirectoryPicker v-model="workingDirectory" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Square, Send } from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { useChatSessionStore } from '@/stores/chat'
import { useDesignSession } from '@/composables/useDesignSession'
import { api } from '@/services/electronAPI'
import type { DesignSystemSummary } from '@/services/electronAPI'
import TemplatePicker from './TemplatePicker.vue'
import DesignSystemPicker from './DesignSystemPicker.vue'
import WorkingDirectoryPicker from './WorkingDirectoryPicker.vue'

const emit = defineEmits<{ (e: 'send', content: string): void; (e: 'stop'): void }>()

const { t } = useI18n()
const designStore = useDesignStore()
const chatSessionStore = useChatSessionStore()
const { isGenerating, switchToolboxSkill, switchDesignSystem, buildDesignMessage } = useDesignSession()
const value = ref('')
const plusMenuOpen = ref(false)
const designSystems = ref<DesignSystemSummary[]>([])

const workingDirectory = computed({
  get: () => designStore.designWorkspace || chatSessionStore.workingDirectory || '',
  set: (path: string) => {
    designStore.designWorkspace = path
    chatSessionStore.currentProjectRoot = path
  },
})

onMounted(async () => {
  designSystems.value = await api.design.listSystems()
})

function selectSkill(id: string) {
  switchToolboxSkill(id)
  plusMenuOpen.value = false
}

function onDesignSystemChange(systemId: string | null) {
  const system = designSystems.value.find(s => s.id === systemId) || null
  switchDesignSystem(systemId, system?.name || null)
}

async function send() {
  if (!value.value.trim() || isGenerating.value) return
  const content = buildDesignMessage(value.value.trim())
  value.value = ''
  emit('send', content)
}
</script>

<style scoped lang="scss">
.design-composer {
  border-top: 1px solid var(--surface-border);
  padding: 8px 12px;
  background: var(--bg-secondary);
  position: relative;
}

.composer-input-wrap {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-xl);
  background: var(--bg-primary);
  padding: 6px 6px 6px 8px;
  position: relative;
}

.plus-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.plus-btn:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.composer-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  padding: 6px 4px;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  font-family: inherit;
  outline: none;
}
.composer-input::placeholder { color: var(--text-disabled); }

.send-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  background: var(--accent-primary);
  color: white;
  border: none;
  border-radius: var(--radius-full);
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: opacity var(--transition-fast);
}
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.send-btn.stop { background: #ef4444; }

.composer-toolbar-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  gap: 8px;
}

.plus-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 220px;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-xl);
  padding: 8px;
  z-index: 100;
}

.plus-menu-section .section-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.skill-option {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-primary);
}
.skill-option:hover { background: var(--surface-hover); }
.skill-option.active { background: var(--accent-primary-glow); }

.skill-name { display: block; font-size: 12px; font-weight: 500; }
.skill-desc { display: block; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
</style>
```

注意：`chatSessionStore.workingDirectory` 与 `currentSession` 均为 computed，不可直接赋值。setter 更新 `designStore.designWorkspace` 与 `chatSessionStore.currentProjectRoot`。

### 步骤 3：运行测试验证

```bash
npx vitest run src/components/design/__tests__/DesignComposer.test.ts
```

预期：PASS

### 步骤 4：运行 TypeScript 检查

```bash
npx vue-tsc --noEmit
```

预期：无错误。

### 步骤 5：Commit

```bash
git add src/components/design/DesignComposer.vue src/components/design/__tests__/DesignComposer.test.ts
git commit -m "feat(design): 重构 DesignComposer 布局，模板与 + 按钮内置输入框"
```

---

## 任务 4：更新 i18n 翻译

**文件：**
- 修改：`src/i18n/locales/zh-CN.ts`
- 修改：`src/i18n/locales/en-US.ts`

### 步骤 1：更新 `zh-CN.ts`

在 `design` 命名空间内新增：

```ts
workingDirectory: {
  none: '选择工作目录',
  label: '工作目录',
},
```

### 步骤 2：更新 `en-US.ts`

对应新增：

```ts
workingDirectory: {
  none: 'Select working directory',
  label: 'Working directory',
},
```

### 步骤 3：运行测试

```bash
npx vitest run src/components/design/__tests__/DesignComposer.test.ts src/components/design/__tests__/WorkingDirectoryPicker.test.ts src/components/design/__tests__/TemplatePicker.test.ts src/components/design/__tests__/DesignSystemPicker.test.ts
```

预期：PASS

### 步骤 4：Commit

```bash
git add src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat(i18n): 补全工作目录与 + 菜单翻译"
```

---

## 任务 5：完整测试套件与类型检查

**文件：** 全局

### 步骤 1：运行所有相关测试

```bash
npx vitest run src/components/design/__tests__/DesignComposer.test.ts src/components/design/__tests__/WorkingDirectoryPicker.test.ts src/components/design/__tests__/TemplatePicker.test.ts src/components/design/__tests__/DesignSystemPicker.test.ts src/components/design/__tests__/DesignSystemPreviewModal.test.ts src/composables/__tests__/useDesignSession.test.ts
```

注意：若 `DesignSystemPreviewModal.test.ts` 不存在则跳过。

预期：全部 PASS

### 步骤 2：运行 TypeScript 检查

```bash
npx vue-tsc --noEmit
```

预期：无错误

### 步骤 3：Commit

```bash
git add .
git commit -m "chore(design): 聊天输入框优化完整测试与类型检查通过"
```

---

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-07-05-design-system-chat-composer-optimization-plan.md`。

**两种执行方式：**

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代。使用 `superpowers:subagent-driven-development` 技能。

**2. 内联执行** - 在当前会话中使用 `superpowers:executing-plans` 执行任务，批量执行并设有检查点供审查。

**选哪种方式？**

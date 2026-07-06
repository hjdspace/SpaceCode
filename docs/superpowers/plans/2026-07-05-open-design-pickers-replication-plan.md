# SpaceCode 复刻 open-design 首页选择器实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。
> 依赖规格：[`docs/superpowers/specs/2026-07-05-open-design-pickers-replication-design.md`](file:///d:/AI/SpaceCode/docs/superpowers/specs/2026-07-05-open-design-pickers-replication-design.md)

**目标：** 在 SpaceCode 设计模式的 `DesignComposer` 中完整复刻 open-design 首页的模板选择器与设计系统选择器，包括 open-design 风格的模板映射、SVG 场景艺术图、设计系统 iframe 预览。

**架构：** 底部工具栏新增 `TemplatePicker` + `DesignSystemPicker`；`+` 按钮降级为 skill 入口；后端扩展 `design:list-systems` 并新增 `design:get-system-preview`；模板数据与 skill 映射集中存放在 `src/lib/design/templates.ts`。

**技术栈：** Vue 3 + TypeScript + Pinia + Electron IPC + Vitest + vue-i18n + SCSS

---

## 文件结构

### 新建文件

- `src/lib/design/templates.ts` — 模板定义、open-design 映射、前置提示词构建
- `src/components/design/TemplateScenarioArt.vue` — 10 个模板的 SVG 场景艺术图
- `src/components/design/TemplatePicker.vue` — 模板选择器浮层
- `src/components/design/DesignSystemPicker.vue` — 设计系统选择器浮层
- `src/utils/design/__tests__/templateMap.test.ts` — 模板数据单元测试
- `src/components/design/__tests__/TemplateScenarioArt.test.ts` — 场景图组件测试
- `src/components/design/__tests__/TemplatePicker.test.ts` — 模板选择器组件测试
- `src/components/design/__tests__/DesignSystemPicker.test.ts` — 设计系统选择器组件测试
- `electron/design/__tests__/promptStack.test.ts` — IPC handler 单元测试
- `src/composables/__tests__/useDesignSession.test.ts` — 集成测试

### 修改文件

- `electron/design/promptStack.ts` — 扩展 `design:list-systems`，新增 `design:get-system-preview`
- `electron/preload.ts` — 暴露 `getSystemPreview`
- `src/services/electronAPI.ts` — 同步类型与 API 封装
- `src/stores/design.ts` — 新增 `selectedTemplateId`、`selectedDesignSystemId`
- `src/composables/useDesignSession.ts` — `createDesignSession` 传入 designSystemId；新增 `switchDesignSystem`；模板前置提示词拼接
- `src/components/design/DesignComposer.vue` — 底部工具栏重构为 TemplatePicker + DesignSystemPicker
- `src/i18n/locales/zh-CN.ts` — 新增模板/设计系统相关翻译键
- `src/i18n/locales/en-US.ts` — 新增模板/设计系统相关翻译键

---

## 任务 1：扩展后端 `design:list-systems` 并新增 `design:get-system-preview`

**文件：**
- 修改：`electron/design/promptStack.ts`
- 测试：`electron/design/__tests__/promptStack.test.ts`

### 步骤 1：编写失败的测试

创建 `electron/design/__tests__/promptStack.test.ts`：

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { registerPromptStackHandlers } from '../promptStack'
import * as path from 'path'

const extraResourcesPath = path.resolve(__dirname, '../../../')

describe('design:list-systems', () => {
  beforeAll(() => {
    registerPromptStackHandlers(extraResourcesPath)
  })

  it('返回 agentic 系统并包含 description 和 previewPages', async () => {
    const result = await globalThis.electronTestAPI.invoke('design:list-systems')
    const agentic = result.find((s: any) => s.id === 'agentic')
    expect(agentic).toBeTruthy()
    expect(agentic.name).toBe('Agentic')
    expect(agentic.category).toBe('Themed & Unique')
    expect(agentic.description).toContain('Conversational AI-first interface')
    expect(agentic.previewPages).toBeInstanceOf(Array)
    expect(agentic.previewPages.length).toBeGreaterThan(0)
  })
})

describe('design:get-system-preview', () => {
  beforeAll(() => {
    registerPromptStackHandlers(extraResourcesPath)
  })

  it('返回 agentic colors.html 且包含色板标记', async () => {
    const html = await globalThis.electronTestAPI.invoke('design:get-system-preview', 'agentic', 'preview/colors.html')
    expect(html).toContain('Color roles')
    expect(html).toContain('--accent')
  })
})
```

运行测试：

```bash
npx vitest run electron/design/__tests__/promptStack.test.ts
```

预期：FAIL — `globalThis.electronTestAPI` 未定义且 handler 未注册。

### 步骤 2：实现 handler 扩展

修改 `electron/design/promptStack.ts`：

1. 在文件顶部新增类型：

```ts
export interface PreviewPage {
  path: string
  role: string
  title: string
}

export interface DesignSystemSummary {
  id: string
  name: string
  category: string
  description?: string
  previewPages: PreviewPage[]
}
```

2. 新增 `getSystemPreviewPath` 辅助函数（在 `registerPromptStackHandlers` 之前）：

```ts
export async function getSystemPreviewHtml(
  extraResourcesPath: string,
  systemId: string,
  pagePath: string
): Promise<string> {
  const systemsLibDir = path.join(extraResourcesPath, 'design-systems-lib')
  const fullPath = path.join(systemsLibDir, systemId, pagePath)
  let html = await fs.readFile(fullPath, 'utf-8').catch(() => '')
  if (!html) return ''

  // 将 ../tokens.css 等相对路径替换为 file:// 绝对路径
  const systemDir = path.join(systemsLibDir, systemId)
  html = html.replace(
    /(href|src)="([^"]+)"/g,
    (_match, attr, rel) => {
      if (/^[a-z][a-z0-9+.-]:/i.test(rel)) return `${attr}="${rel}"`
      const resolved = path.resolve(systemDir, rel)
      return `${attr}="file://${resolved.replace(/\\/g, '/')}"`
    }
  )
  return html
}
```

3. 在 `registerPromptStackHandlers` 内部，修改 `design:list-systems` 返回：

```ts
ipcMain.handle('design:list-systems', async () => {
  const systemsLibDir = path.join(extraResourcesPath, 'design-systems-lib')
  try {
    const dirs = await fs.readdir(systemsLibDir, { withFileTypes: true })
    const systems: DesignSystemSummary[] = []
    for (const dir of dirs) {
      if (dir.isDirectory() && !dir.name.startsWith('.')) {
        let manifest: any = { name: dir.name, category: 'General', previewPages: [] }
        try {
          const manifestStr = await fs.readFile(path.join(systemsLibDir, dir.name, 'manifest.json'), 'utf-8')
          manifest = JSON.parse(manifestStr)
        } catch {
          // No manifest, fallback to folder name
        }
        systems.push({
          id: dir.name,
          name: manifest.name || dir.name,
          category: manifest.category || 'General',
          description: manifest.description,
          previewPages: manifest.preview?.pages || [],
        })
      }
    }
    return systems
  } catch {
    return [
      { id: 'stripe', name: 'Stripe', category: 'Fintech', previewPages: [] },
      { id: 'linear-app', name: 'Linear', category: 'Productivity', previewPages: [] },
      { id: 'vercel', name: 'Vercel', category: 'Developer', previewPages: [] },
      { id: 'apple', name: 'Apple iOS', category: 'Corporate', previewPages: [] }
    ]
  }
})
```

4. 新增 handler：

```ts
ipcMain.handle('design:get-system-preview', async (_event, systemId: string, pagePath: string) => {
  return getSystemPreviewHtml(extraResourcesPath, systemId, pagePath)
})
```

### 步骤 3：运行测试验证

```bash
npx vitest run electron/design/__tests__/promptStack.test.ts
```

预期：PASS

### 步骤 4：Commit

```bash
git add electron/design/promptStack.ts electron/design/__tests__/promptStack.test.ts
git commit -m "feat(design): 扩展 listSystems 并新增 getSystemPreview IPC" -m "- listSystems 返回 description 与 previewPages" -m "- getSystemPreview 解析相对路径为 file:// 绝对路径"
```

---

## 任务 2：更新 preload 与 electronAPI 类型

**文件：**
- 修改：`electron/preload.ts`
- 修改：`src/services/electronAPI.ts`

### 步骤 1：更新 `electron/preload.ts`

在 `design:` 对象中新增：

```ts
getSystemPreview: (systemId: string, pagePath: string): Promise<string> =>
  ipcRenderer.invoke('design:get-system-preview', systemId, pagePath),
```

并修改 `listSystems` 返回类型为包含 `description` 和 `previewPages`：

```ts
listSystems: (): Promise<Array<{ id: string; name: string; category: string; description?: string; previewPages: Array<{ path: string; role: string; title: string }> }>> =>
  ipcRenderer.invoke('design:list-systems'),
```

### 步骤 2：更新 `src/services/electronAPI.ts`

在文件顶部新增类型（放在 `ArtifactEntry` 附近）：

```ts
export interface PreviewPage {
  path: string
  role: string
  title: string
}

export interface DesignSystemSummary {
  id: string
  name: string
  category: string
  description?: string
  previewPages: PreviewPage[]
}
```

修改 `design` 对象：

```ts
design: {
  listSystems: (): Promise<DesignSystemSummary[]> =>
    electronAPI?.design?.listSystems() || Promise.resolve([]),
  getSystemPreview: (systemId: string, pagePath: string): Promise<string> =>
    electronAPI?.design?.getSystemPreview(systemId, pagePath) || Promise.resolve(''),
  composePromptStack: (input: {
    designSystemId?: string;
    skillBody?: string;
    skillName?: string;
    locale: string;
  }): Promise<string> =>
    electronAPI?.design?.composePromptStack(input) || Promise.resolve(''),
  // ... 其余保持不变
}
```

### 步骤 3：TypeScript 检查

```bash
npx vue-tsc --noEmit
```

预期：无错误

### 步骤 4：Commit

```bash
git add electron/preload.ts src/services/electronAPI.ts
git commit -m "feat(api): 暴露 getSystemPreview 并同步 DesignSystemSummary 类型"
```

---

## 任务 3：创建模板数据文件 `src/lib/design/templates.ts`

**文件：**
- 创建：`src/lib/design/templates.ts`
- 测试：`src/utils/design/__tests__/templateMap.test.ts`

### 步骤 1：编写失败的测试

创建 `src/utils/design/__tests__/templateMap.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  DESIGN_TEMPLATES,
  buildPreamble,
  getTemplateById,
  ProjectKind,
} from '@/lib/design/templates'
import { useDesignStore } from '@/stores/design'

describe('DESIGN_TEMPLATES', () => {
  it('每个模板都有 pluginId 和 projectKind', () => {
    for (const t of DESIGN_TEMPLATES) {
      expect(t.pluginId).toBeTruthy()
      expect(t.projectKind).toBeTruthy()
    }
  })

  it('每个模板的 defaultSkillId 都存在于 toolboxSkills', () => {
    const store = useDesignStore()
    const skillIds = new Set(store.toolboxSkills.map(s => s.id))
    for (const t of DESIGN_TEMPLATES) {
      expect(skillIds.has(t.defaultSkillId)).toBe(true)
    }
  })

  it('wireframe 使用 example-web-prototype + fidelity wireframe', () => {
    const wireframe = getTemplateById('wireframe')!
    expect(wireframe.pluginId).toBe('example-web-prototype')
    expect(wireframe.projectMetadata?.fidelity).toBe('wireframe')
  })

  it('deck 使用 example-simple-deck', () => {
    const deck = getTemplateById('deck')!
    expect(deck.pluginId).toBe('example-simple-deck')
    expect(deck.projectKind).toBe('deck')
  })
})

describe('buildPreamble', () => {
  it('返回包含模板前缀、设计系统名称和元信号的文本', () => {
    const text = buildPreamble('wireframe', 'agentic')
    expect(text).toContain('低保真线框图')
    expect(text).toContain('Agentic')
    expect(text).toContain('wireframe')
  })

  it('未知 templateId 返回空字符串', () => {
    expect(buildPreamble('unknown', null)).toBe('')
  })
})
```

运行测试：

```bash
npx vitest run src/utils/design/__tests__/templateMap.test.ts
```

预期：FAIL — 模块不存在。

### 步骤 2：实现模板数据文件

创建 `src/lib/design/templates.ts`：

```ts
export type ProjectKind = 'prototype' | 'deck' | 'other' | 'video' | 'image' | 'audio'

export interface ProjectMetadata {
  kind?: ProjectKind
  fidelity?: 'wireframe' | 'high-fidelity'
  platform?: 'auto'
  platformTargets?: string[]
  intent?: string
}

export interface DesignTemplate {
  id: string
  labelKey: string
  descriptionKey: string
  icon: string
  pluginId: string
  projectKind: ProjectKind
  projectMetadata?: ProjectMetadata
  inputs?: Record<string, unknown>
  defaultSkillId: string
  defaultDesignSystemId?: string
  preambleTemplate: string
}

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: 'prototype',
    labelKey: 'design.template.prototype',
    descriptionKey: 'design.template.prototypeDesc',
    icon: 'palette',
    pluginId: 'example-web-prototype',
    projectKind: 'prototype',
    defaultSkillId: 'ui-ux-pro-max',
    preambleTemplate: '请生成交互式 Web 应用原型，包含可点击的页面流程。',
  },
  {
    id: 'wireframe',
    labelKey: 'design.template.wireframe',
    descriptionKey: 'design.template.wireframeDesc',
    icon: 'layout',
    pluginId: 'example-web-prototype',
    projectKind: 'prototype',
    projectMetadata: { kind: 'prototype', fidelity: 'wireframe' },
    defaultSkillId: 'ui-ux-pro-max',
    preambleTemplate: '请生成低保真线框图，只关注信息结构与页面流程，不要高保真视觉。',
  },
  {
    id: 'mobile',
    labelKey: 'design.template.mobile',
    descriptionKey: 'design.template.mobileDesc',
    icon: 'smartphone',
    pluginId: 'example-web-prototype',
    projectKind: 'prototype',
    projectMetadata: { kind: 'prototype', platform: 'auto', platformTargets: ['mobile-ios', 'mobile-android'] },
    defaultSkillId: 'ui-ux-pro-max',
    preambleTemplate: '请生成 iOS 与 Android 移动应用界面设计。',
  },
  {
    id: 'deck',
    labelKey: 'design.template.deck',
    descriptionKey: 'design.template.deckDesc',
    icon: 'presentation',
    pluginId: 'example-simple-deck',
    projectKind: 'deck',
    defaultSkillId: 'html-ppt-skill',
    preambleTemplate: '请生成一套幻灯片演示文稿。',
  },
  {
    id: 'document',
    labelKey: 'design.template.document',
    descriptionKey: 'design.template.documentDesc',
    icon: 'file-text',
    pluginId: 'od-new-generation',
    projectKind: 'other',
    inputs: { artifactKind: 'document', audience: 'readers', topic: 'the user brief' },
    projectMetadata: { kind: 'other', intent: 'document' },
    defaultSkillId: 'officecli-docx',
    preambleTemplate: '请生成一份文档（简历、报告或 PDF）。',
  },
  {
    id: 'hyperframes',
    labelKey: 'design.template.hyperframes',
    descriptionKey: 'design.template.hyperframesDesc',
    icon: 'orbit',
    pluginId: 'example-hyperframes',
    projectKind: 'video',
    defaultSkillId: 'canvas-design',
    preambleTemplate: '请生成基于 HTML 的动态图形或循环动画。',
  },
  {
    id: 'live-artifact',
    labelKey: 'design.template.liveArtifact',
    descriptionKey: 'design.template.liveArtifactDesc',
    icon: 'activity',
    pluginId: 'example-live-artifact',
    projectKind: 'prototype',
    projectMetadata: { kind: 'prototype', intent: 'live-artifact', fidelity: 'high-fidelity' },
    defaultSkillId: 'ui-ux-pro-max',
    preambleTemplate: '请生成一个数据驱动的实时看板。',
  },
  {
    id: 'image',
    labelKey: 'design.template.image',
    descriptionKey: 'design.template.imageDesc',
    icon: 'image',
    pluginId: 'od-media-generation',
    projectKind: 'image',
    inputs: { mediaKind: 'image', subject: 'a polished product concept', style: 'cinematic, high-quality, on-brand', aspect: '16:9' },
    defaultSkillId: 'huashu-design',
    preambleTemplate: '请生成一张海报、图形或插画。',
  },
  {
    id: 'video',
    labelKey: 'design.template.video',
    descriptionKey: 'design.template.videoDesc',
    icon: 'video',
    pluginId: 'od-media-generation',
    projectKind: 'video',
    inputs: { mediaKind: 'video', subject: 'a short product reveal', style: 'cinematic, high-quality, on-brand', aspect: '16:9' },
    defaultSkillId: 'huashu-design',
    preambleTemplate: '请生成一个短视频、Reels 或宣传片。',
  },
  {
    id: 'audio',
    labelKey: 'design.template.audio',
    descriptionKey: 'design.template.audioDesc',
    icon: 'audio-waveform',
    pluginId: 'od-media-generation',
    projectKind: 'audio',
    inputs: { mediaKind: 'audio', subject: 'a concise audio identity for a product', style: 'clear, polished, modern', aspect: '16:9' },
    defaultSkillId: 'huashu-design',
    preambleTemplate: '请生成音频相关设计或配音脚本。',
  },
]

export function getTemplateById(id: string | null): DesignTemplate | undefined {
  return DESIGN_TEMPLATES.find(t => t.id === id)
}

export function buildPreamble(
  templateId: string | null,
  designSystemName: string | null,
): string {
  const template = getTemplateById(templateId)
  if (!template) return ''
  const meta = template.projectMetadata
  const signals: string[] = []
  if (meta?.fidelity) signals.push(`fidelity=${meta.fidelity}`)
  if (meta?.platformTargets?.length) signals.push(`platform=${meta.platformTargets.join(',')}`)
  if (meta?.intent) signals.push(`intent=${meta.intent}`)
  if (template.inputs) {
    for (const [k, v] of Object.entries(template.inputs)) {
      signals.push(`${k}=${v}`)
    }
  }
  const metaPart = signals.length ? ` [${signals.join('; ')}]` : ''
  const systemPart = designSystemName ? ` 使用 ${designSystemName} 设计系统。` : ''
  return `${template.preambleTemplate}${metaPart}${systemPart}`
}
```

### 步骤 3：运行测试验证

```bash
npx vitest run src/utils/design/__tests__/templateMap.test.ts
```

预期：PASS

### 步骤 4：Commit

```bash
git add src/lib/design/templates.ts src/utils/design/__tests__/templateMap.test.ts
git commit -m "feat(design): 新增模板数据与 open-design 映射" -m "- 10 个模板对齐 open-design HOME_HERO_CHIPS" -m "- 提供 buildPreamble 用于发送时注入模板上下文"
```

---

## 任务 4：创建 `TemplateScenarioArt.vue`

**文件：**
- 创建：`src/components/design/TemplateScenarioArt.vue`
- 测试：`src/components/design/__tests__/TemplateScenarioArt.test.ts`

### 步骤 1：编写失败的测试

创建 `src/components/design/__tests__/TemplateScenarioArt.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TemplateScenarioArt from '../TemplateScenarioArt.vue'

describe('TemplateScenarioArt', () => {
  it.each([
    'prototype', 'wireframe', 'mobile', 'deck', 'document',
    'hyperframes', 'live-artifact', 'image', 'video', 'audio',
  ])('%s 渲染非空 SVG', (id) => {
    const w = mount(TemplateScenarioArt, { props: { templateId: id } })
    const svg = w.find('svg')
    expect(svg.exists()).toBe(true)
    expect(svg.attributes('viewBox')).toBe('0 0 60 42')
  })

  it('未知 id 渲染问号图标', () => {
    const w = mount(TemplateScenarioArt, { props: { templateId: 'unknown' } })
    expect(w.find('svg').exists()).toBe(true)
  })
})
```

运行测试：

```bash
npx vitest run src/components/design/__tests__/TemplateScenarioArt.test.ts
```

预期：FAIL — 组件不存在。

### 步骤 2：实现组件

创建 `src/components/design/TemplateScenarioArt.vue`：

```vue
<template>
  <svg class="template-scenario-art" viewBox="0 0 60 42" width="60" height="42" fill="none" aria-hidden="true">
    <component :is="art" v-if="art" />
    <g v-else>
      <circle cx="30" cy="21" r="8" :stroke="ink" stroke-width="2" />
      <text x="30" y="25" text-anchor="middle" font-size="10" :fill="ink">?</text>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ templateId: string }>()

const ink = 'var(--text-muted)'
const accent = 'var(--accent)'
const surface = 'var(--bg-panel)'

const art = computed(() => {
  const map: Record<string, any> = {
    prototype: PrototypeArt,
    wireframe: WireframeArt,
    mobile: MobileArt,
    deck: DeckArt,
    document: DocumentArt,
    hyperframes: HyperFramesArt,
    'live-artifact': LiveArtifactArt,
    image: ImageArt,
    video: VideoArt,
    audio: AudioArt,
  }
  return map[props.templateId] || null
})

function PrototypeArt() {
  return [
    <rect x="6" y="7" width="48" height="28" rx="4" stroke={ink} stroke-width="2" />,
    <line x1="6" y1="15" x2="54" y2="15" stroke={ink} stroke-width="2" />,
    <circle cx="10.5" cy="11" r="1.1" fill={ink} />,
    <circle cx="14.5" cy="11" r="1.1" fill={ink} />,
    <circle cx="18.5" cy="11" r="1.1" fill={ink} />,
    <rect x="11" y="20" width="13" height="5" rx="1.5" fill={accent} />,
    <line x1="28" y1="21" x2="48" y2="21" stroke={ink} stroke-width="2" />,
    <line x1="28" y1="26" x2="42" y2="26" stroke={ink} stroke-width="2" />,
    <line x1="11" y1="30" x2="48" y2="30" stroke={ink} stroke-width="2" />,
  ]
}

function WireframeArt() {
  return [
    <rect x="6" y="7" width="48" height="28" rx="4" stroke={ink} stroke-width="2" stroke-dasharray="3.5 3" />,
    <rect x="11" y="12" width="38" height="6" rx="1.5" fill={ink} fill-opacity="0.16" />,
    <rect x="11" y="22" width="16" height="9" rx="1.5" fill={ink} fill-opacity="0.16" />,
    <rect x="31" y="22" width="11" height="5" rx="1.5" fill={accent} />,
    <line x1="31" y1="30" x2="49" y2="30" stroke={ink} stroke-width="2" />,
  ]
}

function MobileArt() {
  return [
    <rect x="22" y="4" width="16" height="34" rx="3.5" stroke={ink} stroke-width="2" />,
    <line x1="27.5" y1="7.5" x2="32.5" y2="7.5" stroke={ink} stroke-width="1.6" />,
    <line x1="26" y1="14" x2="34" y2="14" stroke={ink} stroke-width="2" />,
    <line x1="26" y1="19" x2="34" y2="19" stroke={ink} stroke-width="2" />,
    <line x1="26" y1="24" x2="31" y2="24" stroke={ink} stroke-width="2" />,
    <rect x="26" y="29" width="8" height="4" rx="1.5" fill={accent} />,
  ]
}

function DeckArt() {
  return [
    <rect x="15" y="6" width="38" height="24" rx="3" stroke={ink} stroke-width="2" stroke-opacity="0.45" />,
    <rect x="7" y="11" width="38" height="24" rx="3" fill={surface} stroke={ink} stroke-width="2" />,
    <rect x="11" y="15" width="14" height="5" rx="1.5" fill={accent} />,
    <line x1="11" y1="25" x2="41" y2="25" stroke={ink} stroke-width="2" />,
    <line x1="11" y1="30" x2="34" y2="30" stroke={ink} stroke-width="2" />,
  ]
}

function DocumentArt() {
  return [
    <path d="M17 5 H37 L43 11 V37 H17 Z" fill={surface} stroke={ink} stroke-width="2" />,
    <path d="M37 5 V11 H43" stroke={ink} stroke-width="2" />,
    <line x1="21" y1="17" x2="38" y2="17" stroke={accent} stroke-width="2" />,
    <line x1="21" y1="22" x2="39" y2="22" stroke={ink} stroke-width="2" />,
    <line x1="21" y1="27" x2="39" y2="27" stroke={ink} stroke-width="2" />,
    <line x1="21" y1="32" x2="33" y2="32" stroke={ink} stroke-width="2" />,
  ]
}

function HyperFramesArt() {
  return [
    <rect x="9" y="12" width="33" height="21" rx="3" fill={surface} stroke={ink} stroke-width="2" stroke-opacity="0.45" />,
    <rect x="18" y="8" width="33" height="21" rx="3" fill={surface} stroke={ink} stroke-width="2" />,
    <path d="M31 13 V23 L39 18 Z" fill={accent} />,
  ]
}

function LiveArtifactArt() {
  return [
    <rect x="6" y="7" width="48" height="28" rx="4" stroke={ink} stroke-width="2" />,
    <line x1="14" y1="29" x2="14" y2="23" stroke={ink} stroke-width="3" />,
    <line x1="22" y1="29" x2="22" y2="18" stroke={ink} stroke-width="3" />,
    <line x1="30" y1="29" x2="30" y2="25" stroke={ink} stroke-width="3" />,
    <line x1="38" y1="29" x2="38" y2="14" stroke={accent} stroke-width="3" />,
    <line x1="46" y1="29" x2="46" y2="21" stroke={ink} stroke-width="3" />,
  ]
}

function ImageArt() {
  return [
    <rect x="8" y="8" width="44" height="26" rx="4" stroke={ink} stroke-width="2" />,
    <circle cx="19" cy="16" r="3" fill={accent} />,
    <path d="M11 31 L22 20 L29 26 L37 17 L49 31" stroke={ink} stroke-width="2" />,
  ]
}

function VideoArt() {
  return [
    <rect x="6" y="7" width="48" height="28" rx="4" stroke={ink} stroke-width="2" />,
    <path d="M26 15 V25 L35 20 Z" fill={accent} />,
    <line x1="11" y1="30" x2="49" y2="30" stroke={ink} stroke-width="2" />,
    <circle cx="22" cy="30" r="2" fill={ink} />,
  ]
}

function AudioArt() {
  return [
    <line x1="12" y1="17" x2="12" y2="25" stroke={ink} stroke-width="3" />,
    <line x1="18" y1="13" x2="18" y2="29" stroke={ink} stroke-width="3" />,
    <line x1="24" y1="9" x2="24" y2="33" stroke={ink} stroke-width="3" />,
    <line x1="30" y1="6" x2="30" y2="36" stroke={accent} stroke-width="3" />,
    <line x1="36" y1="11" x2="36" y2="31" stroke={ink} stroke-width="3" />,
    <line x1="42" y1="14" x2="42" y2="28" stroke={ink} stroke-width="3" />,
    <line x1="48" y1="17" x2="48" y2="25" stroke={ink} stroke-width="3" />,
  ]
}
</script>

<style scoped lang="scss">
.template-scenario-art {
  display: block;
}
</style>
```

### 步骤 3：运行测试验证

```bash
npx vitest run src/components/design/__tests__/TemplateScenarioArt.test.ts
```

预期：PASS

### 步骤 4：Commit

```bash
git add src/components/design/TemplateScenarioArt.vue src/components/design/__tests__/TemplateScenarioArt.test.ts
git commit -m "feat(design): 新增 TemplateScenarioArt SVG 场景艺术图"
```

---

## 任务 5：创建 `TemplatePicker.vue`

**文件：**
- 创建：`src/components/design/TemplatePicker.vue`
- 测试：`src/components/design/__tests__/TemplatePicker.test.ts`
- 依赖：`src/components/design/TemplateScenarioArt.vue`、`src/lib/design/templates.ts`

### 步骤 1：编写失败的测试

创建 `src/components/design/__tests__/TemplatePicker.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TemplatePicker from '../TemplatePicker.vue'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

describe('TemplatePicker', () => {
  beforeEach(() => {
    config.global.plugins = [i18n]
  })

  it('点击触发按钮后打开浮层并渲染 10 个卡片', async () => {
    const w = mount(TemplatePicker, { props: { modelValue: null } })
    await w.find('[data-testid="template-picker-trigger"]').trigger('click')
    expect(w.find('[data-testid="template-picker-menu"]').exists()).toBe(true)
    expect(w.findAll('[data-testid^="template-card-"]')).toHaveLength(10)
  })

  it('搜索过滤模板', async () => {
    const w = mount(TemplatePicker, { props: { modelValue: null } })
    await w.find('[data-testid="template-picker-trigger"]').trigger('click')
    const input = w.find('[data-testid="template-picker-search"]')
    await input.setValue('幻灯片')
    expect(w.findAll('[data-testid^="template-card-"]')).toHaveLength(1)
  })

  it('选择模板触发 update:modelValue', async () => {
    const w = mount(TemplatePicker, { props: { modelValue: null } })
    await w.find('[data-testid="template-picker-trigger"]').trigger('click')
    await w.find('[data-testid="template-card-deck"]').trigger('click')
    const events = w.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual(['deck'])
  })
})
```

运行测试：

```bash
npx vitest run src/components/design/__tests__/TemplatePicker.test.ts
```

预期：FAIL — 组件不存在。

### 步骤 2：实现组件

创建 `src/components/design/TemplatePicker.vue`：

```vue
<template>
  <div ref="wrapRef" class="template-picker" :class="{ 'is-open': open }">
    <button
      type="button"
      class="template-picker-trigger"
      data-testid="template-picker-trigger"
      @click="open = !open"
    >
      <span v-if="active" class="template-picker-thumb">
        <TemplateScenarioArt :template-id="active.id" />
      </span>
      <Grid3x3 v-else :size="13" />
      <span class="template-picker-kicker">{{ t('design.templatePicker.label') }}</span>
      <span class="template-picker-value">{{ active ? t(active.labelKey) : t('common.none') }}</span>
      <ChevronDown :size="12" />
    </button>

    <button
      v-if="active"
      type="button"
      class="template-picker-clear"
      data-testid="template-picker-clear"
      @click.stop="clear"
    >
      <X :size="11" stroke-width="2.2" />
    </button>

    <div v-if="open" class="template-picker-menu" data-testid="template-picker-menu" role="listbox">
      <div class="template-picker-head">
        <div class="template-picker-search">
          <Search :size="12" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            :placeholder="t('design.templatePicker.searchPlaceholder')"
            data-testid="template-picker-search"
          />
        </div>
        <button type="button" class="template-picker-clear-text" @click="clearQuery">
          {{ t('common.clear') }}
        </button>
      </div>
      <div class="template-picker-group-label">{{ t('design.templatePicker.projectTypes') }}</div>
      <div v-if="filtered.length === 0" class="template-picker-empty">{{ t('design.templatePicker.noMatches') }}</div>
      <div v-else class="template-picker-grid">
        <button
          v-for="templ in filtered"
          :key="templ.id"
          type="button"
          class="template-card"
          :class="{ 'is-active': modelValue === templ.id }"
          :data-testid="`template-card-${templ.id}`"
          role="option"
          :aria-selected="modelValue === templ.id"
          :title="t(templ.descriptionKey)"
          @click="pick(templ.id)"
        >
          <span class="template-card-art">
            <TemplateScenarioArt :template-id="templ.id" />
          </span>
          <span class="template-card-copy">
            <span class="template-card-label">{{ t(templ.labelKey) }}</span>
            <span class="template-card-desc">{{ t(templ.descriptionKey) }}</span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Grid3x3, ChevronDown, X, Search } from 'lucide-vue-next'
import { DESIGN_TEMPLATES, getTemplateById } from '@/lib/design/templates'
import TemplateScenarioArt from './TemplateScenarioArt.vue'

const props = defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', id: string | null): void }>()

const { t } = useI18n()
const open = ref(false)
const query = ref('')
const wrapRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

const active = computed(() => getTemplateById(props.modelValue))

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return DESIGN_TEMPLATES
  return DESIGN_TEMPLATES.filter((tpl) => {
    const text = `${t(tpl.labelKey)} ${t(tpl.descriptionKey)}`.toLowerCase()
    return text.includes(q)
  })
})

function pick(id: string) {
  emit('update:modelValue', id)
  open.value = false
  query.value = ''
}

function clear() {
  emit('update:modelValue', null)
  query.value = ''
  inputRef.value?.focus()
}

function clearQuery() {
  query.value = ''
  inputRef.value?.focus()
}

function onPointer(event: MouseEvent) {
  if (wrapRef.value?.contains(event.target as Node)) return
  open.value = false
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

watch(open, (val) => {
  if (val) nextTick(() => inputRef.value?.focus())
  else query.value = ''
})

onMounted(() => {
  document.addEventListener('mousedown', onPointer)
  document.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onPointer)
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped lang="scss">
.template-picker { position: relative; display: inline-flex; align-items: center; gap: 4px; }
.template-picker-trigger { display: inline-flex; align-items: center; gap: 6px; background: var(--bg-primary); border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 4px 8px; font-size: 12px; cursor: pointer; color: var(--text-primary); }
.template-picker-thumb { display: flex; }
.template-picker-kicker { color: var(--text-muted); }
.template-picker-value { font-weight: 500; }
.template-picker-clear { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: none; border: none; cursor: pointer; color: var(--text-muted); }
.template-picker-menu { position: absolute; bottom: calc(100% + 6px); left: 0; width: 360px; background: var(--bg-secondary); border: 1px solid var(--surface-border); border-radius: var(--radius-md); box-shadow: var(--shadow-xl); padding: 10px; z-index: 100; }
.template-picker-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.template-picker-search { flex: 1; display: flex; align-items: center; gap: 6px; background: var(--bg-primary); border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 4px 8px; }
.template-picker-search input { flex: 1; border: none; background: transparent; outline: none; font-size: 12px; color: var(--text-primary); }
.template-picker-clear-text { font-size: 11px; color: var(--text-muted); background: none; border: none; cursor: pointer; }
.template-picker-group-label { font-size: 11px; color: var(--text-muted); margin-bottom: 8px; }
.template-picker-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.template-card { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; background: var(--bg-primary); border: 1px solid var(--surface-border); border-radius: var(--radius-md); padding: 10px; cursor: pointer; text-align: left; }
.template-card.is-active { border-color: var(--accent-primary); background: var(--accent-primary-glow); }
.template-card-art { margin-bottom: 4px; }
.template-card-label { display: block; font-size: 12px; font-weight: 500; color: var(--text-primary); }
.template-card-desc { display: block; font-size: 11px; color: var(--text-muted); line-height: 1.3; }
.template-picker-empty { font-size: 12px; color: var(--text-muted); padding: 12px; text-align: center; }
</style>
```

### 步骤 3：运行测试验证

```bash
npx vitest run src/components/design/__tests__/TemplatePicker.test.ts
```

预期：PASS

### 步骤 4：Commit

```bash
git add src/components/design/TemplatePicker.vue src/components/design/__tests__/TemplatePicker.test.ts
git commit -m "feat(design): 新增 TemplatePicker 模板选择器"
```

---

## 任务 6：创建 `DesignSystemPicker.vue`

**文件：**
- 创建：`src/components/design/DesignSystemPicker.vue`
- 测试：`src/components/design/__tests__/DesignSystemPicker.test.ts`

### 步骤 1：编写失败的测试

创建 `src/components/design/__tests__/DesignSystemPicker.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DesignSystemPicker from '../DesignSystemPicker.vue'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import { api } from '@/services/electronAPI'

vi.mock('@/services/electronAPI', () => ({
  api: {
    design: {
      getSystemPreview: vi.fn().mockResolvedValue('<html>preview</html>'),
    },
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

describe('DesignSystemPicker', () => {
  const systems = [
    { id: 'agentic', name: 'Agentic', category: 'Themed & Unique', description: 'AI-first', previewPages: [{ path: 'preview/colors.html', role: 'colors', title: 'Colors' }] },
    { id: 'apple', name: 'Apple', category: 'Corporate', description: 'Apple iOS', previewPages: [] },
  ]

  it('打开后渲染系统列表', async () => {
    const w = mount(DesignSystemPicker, { props: { systems, modelValue: null } })
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    expect(w.findAll('[data-testid^="ds-option-"]')).toHaveLength(2)
  })

  it('选择系统触发 update:modelValue', async () => {
    const w = mount(DesignSystemPicker, { props: { systems, modelValue: null } })
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    await w.find('[data-testid="ds-option-agentic"]').trigger('mousedown')
    const events = w.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual(['agentic'])
  })

  it('悬停带预览的系统调用 getSystemPreview', async () => {
    const w = mount(DesignSystemPicker, { props: { systems, modelValue: null } })
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    await w.find('[data-testid="ds-option-agentic"]').trigger('mouseenter')
    expect(api.design.getSystemPreview).toHaveBeenCalledWith('agentic', 'preview/colors.html')
  })
})
```

运行测试：

```bash
npx vitest run src/components/design/__tests__/DesignSystemPicker.test.ts
```

预期：FAIL — 组件不存在。

### 步骤 2：实现组件

创建 `src/components/design/DesignSystemPicker.vue`：

```vue
<template>
  <div ref="wrapRef" class="ds-picker" :class="{ 'is-open': open }">
    <button
      type="button"
      class="ds-picker-trigger"
      data-testid="ds-picker-trigger"
      @click="open = !open"
    >
      <Palette :size="13" />
      <span class="ds-picker-value">{{ selectedName }}</span>
      <ChevronDown :size="12" />
    </button>

    <div v-if="open" class="ds-picker-menu" data-testid="ds-picker-menu">
      <div class="ds-picker-search">
        <Search :size="12" />
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          :placeholder="t('design.designSystemPicker.searchPlaceholder')"
          data-testid="ds-picker-search"
        />
        <button type="button" class="ds-picker-action" @click="clear">
          {{ t('common.clear') }}
        </button>
        <button type="button" class="ds-picker-action ds-picker-action--primary" disabled :title="t('design.designSystemPicker.createDisabled')">
          <Plus :size="12" stroke-width="2" />
          <span>{{ t('common.create') }}</span>
        </button>
      </div>
      <div class="ds-picker-body">
        <div class="ds-picker-list" role="listbox">
          <button
            type="button"
            class="ds-picker-option"
            :class="{ active: modelValue == null }"
            role="option"
            :aria-selected="modelValue == null"
            data-testid="ds-option-none"
            @mouseenter="hoverNone"
            @focus="hoverNone"
            @mousedown.prevent="pick(null)"
          >
            <span class="ds-picker-option-title">{{ t('design.designSystemPicker.none') }}</span>
            <Check v-if="modelValue == null" :size="13" stroke-width="2" />
          </button>
          <template v-if="filtered.length">
            <div v-for="system in filtered" :key="system.id">
              <button
                type="button"
                class="ds-picker-option"
                :class="{ active: modelValue === system.id }"
                :data-testid="`ds-option-${system.id}`"
                role="option"
                :aria-selected="modelValue === system.id"
                @mouseenter="hoverSystem(system)"
                @focus="hoverSystem(system)"
                @mousedown.prevent="pick(system.id)"
              >
                <span class="ds-picker-option-title">{{ system.name }}</span>
                <Check v-if="modelValue === system.id" :size="13" stroke-width="2" />
              </button>
            </div>
          </template>
          <div v-else class="ds-picker-empty">{{ t('design.designSystemPicker.noMatches') }}</div>
        </div>
        <div class="ds-picker-preview" data-testid="ds-picker-preview">
          <template v-if="previewSystem">
            <div class="ds-picker-preview-head">{{ previewSystem.name }}</div>
            <div class="ds-picker-preview-meta">{{ previewSystem.category }}</div>
            <p class="ds-picker-preview-desc">{{ previewSystem.description }}</p>
            <div v-if="previewSystem.previewPages.length" class="ds-picker-preview-tabs">
              <button
                v-for="page in previewSystem.previewPages"
                :key="page.path"
                type="button"
                class="ds-preview-tab"
                :class="{ active: activePage === page.path }"
                @click="activePage = page.path"
              >
                {{ page.title }}
              </button>
            </div>
            <iframe
              v-if="previewHtml && activePage"
              class="ds-preview-frame"
              :srcdoc="previewHtml"
              sandbox="allow-scripts"
              data-testid="ds-preview-frame"
            />
          </template>
          <template v-else>
            <div class="ds-picker-preview-head">{{ t('design.designSystemPicker.none') }}</div>
            <p class="ds-picker-preview-desc">{{ t('design.designSystemPicker.noneDesc') }}</p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Palette, ChevronDown, Search, Plus, Check } from 'lucide-vue-next'
import type { DesignSystemSummary } from '@/services/electronAPI'
import { api } from '@/services/electronAPI'

const props = defineProps<{
  systems: DesignSystemSummary[]
  modelValue: string | null
}>()
const emit = defineEmits<{ (e: 'update:modelValue', id: string | null): void }>()

const { t } = useI18n()
const open = ref(false)
const query = ref('')
const wrapRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const hovered = ref<DesignSystemSummary | null>(null)
const hoveredNone = ref(false)
const previewHtml = ref('')
const activePage = ref<string | null>(null)

const selected = computed(() => props.systems.find(s => s.id === props.modelValue) || null)
const selectedName = computed(() => selected.value?.name || t('design.designSystemPicker.none'))

const previewSystem = computed(() => {
  if (hovered.value) return hovered.value
  if (hoveredNone.value) return null
  if (selected.value) return selected.value
  return null
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.systems
  return props.systems.filter(s =>
    `${s.name} ${s.category} ${s.description || ''}`.toLowerCase().includes(q)
  )
})

async function loadPreview(system: DesignSystemSummary) {
  const page = system.previewPages[0]
  if (!page) {
    previewHtml.value = ''
    activePage.value = null
    return
  }
  activePage.value = page.path
  previewHtml.value = await api.design.getSystemPreview(system.id, page.path)
}

function hoverSystem(system: DesignSystemSummary) {
  hovered.value = system
  hoveredNone.value = false
  loadPreview(system)
}

function hoverNone() {
  hovered.value = null
  hoveredNone.value = true
  previewHtml.value = ''
  activePage.value = null
}

function pick(id: string | null) {
  emit('update:modelValue', id)
  open.value = false
}

function clear() {
  emit('update:modelValue', null)
  query.value = ''
  inputRef.value?.focus()
}

function onPointer(event: MouseEvent) {
  if (wrapRef.value?.contains(event.target as Node)) return
  open.value = false
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

watch(open, async (val) => {
  if (val) {
    nextTick(() => inputRef.value?.focus())
    if (selected.value) await loadPreview(selected.value)
    else hoverNone()
  } else {
    query.value = ''
    hovered.value = null
    hoveredNone.value = false
    previewHtml.value = ''
    activePage.value = null
  }
})

onMounted(() => {
  document.addEventListener('mousedown', onPointer)
  document.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onPointer)
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped lang="scss">
.ds-picker { position: relative; display: inline-flex; align-items: center; }
.ds-picker-trigger { display: inline-flex; align-items: center; gap: 6px; background: var(--bg-primary); border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 4px 8px; font-size: 12px; cursor: pointer; color: var(--text-primary); }
.ds-picker-value { font-weight: 500; }
.ds-picker-menu { position: absolute; bottom: calc(100% + 6px); right: 0; width: 560px; background: var(--bg-secondary); border: 1px solid var(--surface-border); border-radius: var(--radius-md); box-shadow: var(--shadow-xl); padding: 10px; z-index: 100; display: flex; flex-direction: column; }
.ds-picker-search { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.ds-picker-search input { flex: 1; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); background: var(--bg-primary); padding: 4px 8px; font-size: 12px; color: var(--text-primary); }
.ds-picker-action { font-size: 11px; color: var(--text-muted); background: none; border: none; cursor: pointer; white-space: nowrap; }
.ds-picker-action--primary { color: var(--accent-primary); display: inline-flex; align-items: center; gap: 4px; }
.ds-picker-action:disabled { opacity: 0.5; cursor: not-allowed; }
.ds-picker-body { display: flex; gap: 10px; min-height: 240px; }
.ds-picker-list { width: 45%; max-height: 320px; overflow-y: auto; border-right: 1px solid var(--surface-border); padding-right: 8px; }
.ds-picker-option { display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; background: none; border: none; padding: 6px 8px; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-primary); }
.ds-picker-option:hover, .ds-picker-option.active { background: var(--surface-hover); }
.ds-picker-option-title { font-size: 12px; }
.ds-picker-empty { font-size: 12px; color: var(--text-muted); padding: 12px; }
.ds-picker-preview { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.ds-picker-preview-head { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.ds-picker-preview-meta { font-size: 11px; color: var(--text-muted); }
.ds-picker-preview-desc { font-size: 11px; color: var(--text-secondary); line-height: 1.4; margin: 0; }
.ds-picker-preview-tabs { display: flex; gap: 6px; }
.ds-preview-tab { font-size: 11px; padding: 2px 6px; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-muted); cursor: pointer; }
.ds-preview-tab.active { border-color: var(--accent-primary); color: var(--accent-primary); }
.ds-preview-frame { flex: 1; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); background: white; min-height: 160px; }
</style>
```

### 步骤 3：运行测试验证

```bash
npx vitest run src/components/design/__tests__/DesignSystemPicker.test.ts
```

预期：PASS

### 步骤 4：Commit

```bash
git add src/components/design/DesignSystemPicker.vue src/components/design/__tests__/DesignSystemPicker.test.ts
git commit -m "feat(design): 新增 DesignSystemPicker 设计系统选择器" -m "- 支持搜索、分组、悬停预览" -m "- 使用 iframe srcdoc 加载 manifest preview HTML"
```

---

## 任务 7：更新 `src/stores/design.ts`

**文件：**
- 修改：`src/stores/design.ts`

### 步骤 1：新增状态

在 `selectedToolboxSkillId` 附近新增：

```ts
const selectedTemplateId = ref<string | null>(null)
const selectedDesignSystemId = ref<string | null>(null)
```

并新增 computed：

```ts
const currentTemplate = computed(() =>
  selectedTemplateId.value ? getTemplateById(selectedTemplateId.value) : null,
)
```

需要导入 `getTemplateById`：

```ts
import { getTemplateById } from '@/lib/design/templates'
```

在 return 中暴露：

```ts
selectedTemplateId,
selectedDesignSystemId,
currentTemplate,
```

### 步骤 2：TypeScript 检查

```bash
npx vue-tsc --noEmit
```

预期：无错误

### 步骤 3：Commit

```bash
git add src/stores/design.ts
git commit -m "feat(store): design store 新增模板与设计系统选择状态"
```

---

## 任务 8：更新 `src/composables/useDesignSession.ts`

**文件：**
- 修改：`src/composables/useDesignSession.ts`
- 测试：`src/composables/__tests__/useDesignSession.test.ts`

### 步骤 1：编写失败的测试

创建 `src/composables/__tests__/useDesignSession.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDesignStore } from '@/stores/design'
import { useDesignSession } from '@/composables/useDesignSession'
import { api } from '@/services/electronAPI'

vi.mock('@/services/electronAPI', () => ({
  api: {
    app: { getPath: vi.fn().mockResolvedValue('/tmp') },
    design: {
      composePromptStack: vi.fn().mockResolvedValue('system prompt'),
      startFileWatcher: vi.fn().mockResolvedValue(undefined),
      stopFileWatcher: vi.fn().mockResolvedValue(undefined),
      getSystemPreview: vi.fn().mockResolvedValue('<html></html>'),
    },
    claudeCode: null,
  },
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    sendMessage: vi.fn().mockResolvedValue(undefined),
  }),
  useChatSessionStore: () => ({
    createSession: vi.fn().mockReturnValue({ id: 'sid-1', mode: '', messages: [] }),
    initClaudeCodeSession: vi.fn().mockResolvedValue(undefined),
    sessions: [],
  }),
}))

describe('useDesignSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('createDesignSession 传入 designSystemId', async () => {
    const store = useDesignStore()
    store.selectedToolboxSkillId = 'ui-ux-pro-max'
    store.selectedDesignSystemId = 'agentic'
    const { createDesignSession } = useDesignSession()
    await createDesignSession()
    expect(api.design.composePromptStack).toHaveBeenCalledWith({
      skillName: 'ui-ux-pro-max',
      designSystemId: 'agentic',
      locale: 'zh-CN',
    })
  })

  it('switchDesignSystem 重新 init session', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sid-1'
    store.designWorkspace = '/tmp/ws'
    const { switchDesignSystem } = useDesignSession()
    await switchDesignSystem('apple')
    expect(store.selectedDesignSystemId).toBe('apple')
    expect(api.design.composePromptStack).toHaveBeenCalledWith({
      skillName: expect.any(String),
      designSystemId: 'apple',
      locale: 'zh-CN',
    })
  })
})
```

运行测试：

```bash
npx vitest run src/composables/__tests__/useDesignSession.test.ts
```

预期：FAIL — `switchDesignSystem` 不存在。

### 步骤 2：修改 `useDesignSession.ts`

1. 导入 `buildPreamble`：

```ts
import { buildPreamble } from '@/lib/design/templates'
```

2. 修改 `createDesignSession`：

```ts
const systemPrompt = await api.design.composePromptStack({
  skillName: designStore.selectedToolboxSkillId,
  designSystemId: designStore.selectedDesignSystemId || undefined,
  locale: 'zh-CN',
})
```

3. 新增 `switchDesignSystem`：

```ts
async function switchDesignSystem(systemId: string | null): Promise<void> {
  designStore.selectedDesignSystemId = systemId
  const systemPrompt = await api.design.composePromptStack({
    skillName: designStore.selectedToolboxSkillId,
    designSystemId: systemId || undefined,
    locale: 'zh-CN',
  })
  const sid = designStore.activeSessionId
  if (!sid) return
  await chatSessionStore.initClaudeCodeSession(sid, {
    systemPrompt,
    cwd: designStore.designWorkspace,
    agent: 'ui-ux-pro-max',
  })
}
```

4. 修改 `send` 相关逻辑？实际上发送在 `DesignComposer.vue` 中通过 `emit('send')` 触发，最终由父组件调用 `chatStore.sendMessage`。为了拼接模板前置提示词，有两种选择：

- 在 `DesignComposer.vue` 的 `send()` 中拼接
- 在 `useDesignSession` 中提供 `sendWithTemplate(message)` 方法

根据设计文档，在 `chatStore.sendMessage` 前拼接。因为 `sendMessage` 不在 `useDesignSession` 中直接调用，所以更好的方式是在 `DesignComposer.vue` 中拼接，或者由 `useDesignSession` 暴露一个方法。

为了测试方便，在 `useDesignSession` 中新增 `buildDesignMessage(userMessage: string): string`：

```ts
function buildDesignMessage(userMessage: string): string {
  const templateId = designStore.selectedTemplateId
  const systemName = designStore.selectedDesignSystemId
    ? designStore.systems?.find((s: any) => s.id === designStore.selectedDesignSystemId)?.name || null
    : null
  const preamble = buildPreamble(templateId, systemName)
  if (!preamble) return userMessage
  return `${preamble}\n\n${userMessage}`
}
```

但这需要 design store 中有 `systems`。实际上 design store 当前没有缓存 systems。为了避免复杂化，可以在 `DesignComposer.vue` 中获取系统名，或者 `buildPreamble` 只使用 system id。不过 `buildPreamble` 当前接收 systemName。我们可以改为在 `buildPreamble` 中根据 `designSystemId` 查找系统名。

修改 `templates.ts` 中的 `buildPreamble` 签名：

```ts
export function buildPreamble(
  templateId: string | null,
  designSystemId: string | null,
  systems: DesignSystemSummary[] = [],
): string
```

这样更合理。但会导致之前的测试需要更新。

实际上，为了避免循环依赖，`buildPreamble` 可以只接收 systemName。在 `useDesignSession` 中，我们可以通过 `api.design.listSystems()` 获取系统名，但这会多一次 IPC 调用。

更简单的方案：在 `DesignSystemPicker` 选择时，把系统名也存到 design store（例如 `selectedDesignSystemName`）。

让我调整设计：
- design store 新增 `selectedDesignSystemName: string | null`
- `switchDesignSystem` 更新 `selectedDesignSystemId` 和 `selectedDesignSystemName`
- `buildPreamble` 使用 `selectedDesignSystemName`

我会在计划中加入这个调整。

修改 `buildPreamble` 调用为：

```ts
function buildDesignMessage(userMessage: string): string {
  const preamble = buildPreamble(
    designStore.selectedTemplateId,
    designStore.selectedDesignSystemName,
  )
  if (!preamble) return userMessage
  return `${preamble}\n\n${userMessage}`
}
```

5. 在 return 中暴露：

```ts
buildDesignMessage,
switchDesignSystem,
```

### 步骤 3：运行测试验证

```bash
npx vitest run src/composables/__tests__/useDesignSession.test.ts
```

预期：PASS

### 步骤 4：Commit

```bash
git add src/composables/useDesignSession.ts src/composables/__tests__/useDesignSession.test.ts
git commit -m "feat(design): useDesignSession 支持设计系统切换与模板前置提示词" -m "- createDesignSession 传入 designSystemId" -m "- 新增 switchDesignSystem 与 buildDesignMessage"
```

---

## 任务 9：更新 `src/components/design/DesignComposer.vue`

**文件：**
- 修改：`src/components/design/DesignComposer.vue`

### 步骤 1：重构底部工具栏

修改模板部分：

```vue
<template>
  <div class="design-composer">
    <div class="composer-toolbar-top">
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

    <div class="composer-toolbar-bottom">
      <TemplatePicker v-model="designStore.selectedTemplateId" />
      <DesignSystemPicker v-model="designStore.selectedDesignSystemId" :systems="designSystems" />
    </div>

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
```

### 步骤 2：更新脚本

导入新增组件和 API：

```ts
import { ref, computed, onMounted } from 'vue'
import { api } from '@/services/electronAPI'
import type { DesignSystemSummary } from '@/services/electronAPI'
import TemplatePicker from './TemplatePicker.vue'
import DesignSystemPicker from './DesignSystemPicker.vue'
```

新增状态：

```ts
const designSystems = ref<DesignSystemSummary[]>([])

onMounted(async () => {
  designSystems.value = await api.design.listSystems()
})
```

修改 `send` 函数：

```ts
const { isGenerating, switchToolboxSkill, buildDesignMessage } = useDesignSession()

async function send() {
  if (!value.value.trim() || isGenerating.value) return
  const content = buildDesignMessage(value.value.trim())
  value.value = ''
  emit('send', content)
}
```

### 步骤 3：更新样式

在 `<style>` 中新增/修改：

```scss
.composer-toolbar-top { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.composer-toolbar-bottom { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
```

并修改 `.composer-toolbar` 为 `.composer-toolbar-top`。

### 步骤 4：TypeScript 检查

```bash
npx vue-tsc --noEmit
```

预期：无错误

### 步骤 5：Commit

```bash
git add src/components/design/DesignComposer.vue
git commit -m "feat(design): DesignComposer 底部新增模板与设计系统选择器" -m "- 顶部保留 + 按钮与发送区" -m "- 底部使用 TemplatePicker + DesignSystemPicker"
```

---

## 任务 10：更新 i18n 翻译

**文件：**
- 修改：`src/i18n/locales/zh-CN.ts`
- 修改：`src/i18n/locales/en-US.ts`

### 步骤 1：更新 `zh-CN.ts`

在 `design` 命名空间内新增：

```ts
templatePicker: {
  label: '模板',
  searchPlaceholder: '搜索模板',
  projectTypes: '项目类型',
  noMatches: '未找到匹配模板',
},
designSystemPicker: {
  label: '设计系统',
  none: '不指定设计系统',
  noneDesc: 'AI 将使用通用设计方向生成界面。',
  searchPlaceholder: '搜索设计系统',
  noMatches: '未找到匹配设计系统',
  createDisabled: '暂不支持创建设计系统',
},
template: {
  prototype: '原型',
  prototypeDesc: '可交互的应用原型',
  wireframe: '线框图',
  wireframeDesc: '低保真屏幕与流程',
  mobile: '移动应用',
  mobileDesc: 'iOS 与安卓界面',
  deck: '幻灯片',
  deckDesc: '演示文稿与路演稿',
  document: '文档',
  documentDesc: '简历、报告与 PDF',
  hyperframes: 'HyperFrames',
  hyperframesDesc: '动态图形与循环动画',
  liveArtifact: '实时看板',
  liveArtifactDesc: '数据驱动的实时仪表盘',
  image: '图片',
  imageDesc: '海报、图形与插画',
  video: '视频',
  videoDesc: '短片、Reels 与宣传片',
  audio: '音频',
  audioDesc: '配音、音乐与音效',
},
```

### 步骤 2：更新 `en-US.ts`

对应新增英文翻译。

### 步骤 3：运行测试

```bash
npx vitest run src/components/design/__tests__/TemplatePicker.test.ts src/components/design/__tests__/DesignSystemPicker.test.ts
```

预期：PASS

### 步骤 4：Commit

```bash
git add src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat(i18n): 补全模板与设计系统选择器翻译"
```

---

## 任务 11：调整 `buildPreamble` 以接收 designSystemName（如需要）

**文件：**
- 修改：`src/lib/design/templates.ts`
- 修改：`src/utils/design/__tests__/templateMap.test.ts`

### 步骤 1：更新 `buildPreamble` 签名

已在任务 3 中实现为接收 `designSystemName`。若测试需要，更新测试：

```ts
it('返回包含模板前缀、设计系统名称和元信号的文本', () => {
  const text = buildPreamble('wireframe', 'Agentic')
  expect(text).toContain('低保真线框图')
  expect(text).toContain('Agentic')
  expect(text).toContain('wireframe')
})
```

### 步骤 2：运行测试

```bash
npx vitest run src/utils/design/__tests__/templateMap.test.ts
```

预期：PASS

---

## 任务 12：完整测试套件与 lint

**文件：** 全局

### 步骤 1：运行所有相关测试

```bash
npx vitest run src/utils/design/__tests__/templateMap.test.ts src/components/design/__tests__/TemplateScenarioArt.test.ts src/components/design/__tests__/TemplatePicker.test.ts src/components/design/__tests__/DesignSystemPicker.test.ts src/composables/__tests__/useDesignSession.test.ts electron/design/__tests__/promptStack.test.ts
```

预期：全部 PASS

### 步骤 2：运行 lint

```bash
npx eslint . --ext .ts,.vue
```

预期：无新增错误

### 步骤 3：运行 TypeScript 检查

```bash
npx vue-tsc --noEmit
```

预期：无错误

### 步骤 4：Commit

```bash
git add .
git commit -m "chore(design): 选择器复刻完整测试与类型检查通过"
```

---

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-07-05-open-design-pickers-replication-plan.md`。

**两种执行方式：**

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代。使用 `superpowers:subagent-driven-development` 技能。

**2. 内联执行** - 在当前会话中使用 `superpowers:executing-plans` 执行任务，批量执行并设有检查点供审查。

**选哪种方式？**

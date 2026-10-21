/**
 * EditToolCard — 多段编辑（pi edits[] / MultiEdit）的 diff 呈现.
 * Seam: toolCall.input 形状 → diff 结构（单一容器 / 块间 ⋯ 分隔行 / 段落标签）。
 * 多段共用一个外框并用 ⋯ 衔接，避免独立间距被误读为同一改动展示两遍。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import EditToolCard from '@/components/chat/tools/EditToolCard.vue'
import type { ToolCall } from '@/types'

vi.mock('@/services/electronAPI', () => ({ api: {} }))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    getLanguageFromPath: () => 'typescript',
    resolveSessionPath: (p: string) => p,
    projectRoot: null,
  }),
}))

// @git-diff-view 用 canvas 2d 量算行号列宽，jsdom 不提供该上下文
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({
    font: '',
    measureText: (text: string) => ({ width: text.length * 7 }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
  globalInjection: true,
})

function makeToolCall(input: Record<string, unknown>): ToolCall {
  return { id: 'tc-1', name: 'edit', input, status: 'completed' }
}

function mountCard(toolCall: ToolCall): VueWrapper {
  return mount(EditToolCard, {
    props: { toolCall },
    global: { plugins: [i18n] },
  })
}

async function expand(wrapper: VueWrapper) {
  await wrapper.find('.tool-header').trigger('click')
}

describe('EditToolCard 多段编辑 diff 结构', () => {
  it('edits[] 多段：单一容器 + 块间 ⋯ 分隔行 + 段落标签', async () => {
    const wrapper = mountCard(makeToolCall({
      file_path: 'src/a.ts',
      edits: [
        { oldText: 'const a = 1', newText: 'const a = 2' },
        { oldText: 'const b = 1', newText: 'const b = 2' },
        { oldText: 'const c = 1', newText: 'const c = 2' },
      ],
    }))
    await expand(wrapper)

    expect(wrapper.find('.git-diff-stack').exists()).toBe(true)
    expect(wrapper.findAll('.git-diff-container')).toHaveLength(3)
    expect(wrapper.findAll('.diff-separator')).toHaveLength(2)
    const labels = wrapper.findAll('.diff-segment-label')
    expect(labels).toHaveLength(3)
    expect(labels[0]!.text()).toBe('编辑 1/3')
    expect(labels[2]!.text()).toBe('编辑 3/3')
  })

  it('单段 old/new：无分隔行、无段落标签', async () => {
    const wrapper = mountCard(makeToolCall({
      file_path: 'src/a.ts',
      old_string: 'const a = 1',
      new_string: 'const a = 2',
    }))
    await expand(wrapper)

    expect(wrapper.find('.git-diff-stack').exists()).toBe(true)
    expect(wrapper.findAll('.git-diff-container')).toHaveLength(1)
    expect(wrapper.findAll('.diff-separator')).toHaveLength(0)
    expect(wrapper.findAll('.diff-segment-label')).toHaveLength(0)
  })

  it('无可渲染编辑时回退到 empty-diff（v-if/v-else 结构不被改坏）', async () => {
    const wrapper = mountCard(makeToolCall({ file_path: 'src/a.ts' }))
    await expand(wrapper)

    expect(wrapper.find('.git-diff-stack').exists()).toBe(false)
    expect(wrapper.find('.empty-diff').exists()).toBe(true)
  })
})

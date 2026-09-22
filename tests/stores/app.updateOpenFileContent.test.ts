/**
 * app store updateOpenFileContent 测试 — 同步更新同路径 file/markdown tab。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/electronAPI', () => ({
  api: {
    // settings store 创建时会触发 loadFromGuiSettingsFile，缺失会导致 Unhandled Rejection
    loadGuiSettings: vi.fn(() => Promise.resolve({ success: true, data: null })),
  },
}))

import { useAppStore } from '@/stores/app'

describe('app store — updateOpenFileContent', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function openTabs(appStore: ReturnType<typeof useAppStore>) {
    appStore.openInfoTab({
      id: 'file::/repo/a.ts',
      type: 'file',
      title: 'a.ts',
      icon: null,
      data: { path: '/repo/a.ts', name: 'a.ts', content: 'old content', language: 'typescript' },
      closeable: true,
    })
    appStore.openInfoTab({
      id: 'markdown::/repo/a.ts',
      type: 'markdown',
      title: 'a.ts',
      icon: null,
      data: { path: '/repo/a.ts', name: 'a.ts', content: 'old content', language: 'typescript' },
      closeable: true,
    })
    appStore.openInfoTab({
      id: 'file::/repo/b.ts',
      type: 'file',
      title: 'b.ts',
      icon: null,
      data: { path: '/repo/b.ts', name: 'b.ts', content: 'other file', language: 'typescript' },
      closeable: true,
    })
  }

  it('更新同路径的 file 与 markdown tab', () => {
    const appStore = useAppStore()
    openTabs(appStore)

    appStore.updateOpenFileContent('/repo/a.ts', 'new content')

    const fileTab = appStore.infoPanelTabs.find(t => t.id === 'file::/repo/a.ts')
    const mdTab = appStore.infoPanelTabs.find(t => t.id === 'markdown::/repo/a.ts')
    expect((fileTab?.data as { content: string }).content).toBe('new content')
    expect((mdTab?.data as { content: string }).content).toBe('new content')
  })

  it('不影响其他路径的 tab', () => {
    const appStore = useAppStore()
    openTabs(appStore)

    appStore.updateOpenFileContent('/repo/a.ts', 'new content')

    const bTab = appStore.infoPanelTabs.find(t => t.id === 'file::/repo/b.ts')
    expect((bTab?.data as { content: string }).content).toBe('other file')
  })

  it('currentFile computed 反映新内容', () => {
    const appStore = useAppStore()
    openTabs(appStore)
    appStore.activeInfoTabId = 'file::/repo/a.ts'

    appStore.updateOpenFileContent('/repo/a.ts', 'new content')

    expect(appStore.currentFile?.content).toBe('new content')
  })

  it('路径不匹配时不做任何修改', () => {
    const appStore = useAppStore()
    openTabs(appStore)

    appStore.updateOpenFileContent('/repo/missing.ts', 'new content')

    expect(appStore.infoPanelTabs.every(t => (t.data as { content: string }).content !== 'new content')).toBe(true)
  })
})

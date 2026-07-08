import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useDesignStore } from '@/stores/design'

// ── Hoisted spies: accessible both in mock factory and test body ──
const { onFileChangedSpy, readFileSpy, fileChangedCallback } = vi.hoisted(() => {
  let cb: ((event: { sessionId: string; filepath: string }) => void) | null = null
  return {
    onFileChangedSpy: vi.fn((callback: (event: { sessionId: string; filepath: string }) => void) => {
      cb = callback
      return () => { cb = null }
    }),
    readFileSpy: vi.fn().mockResolvedValue('<html><body>mock</body></html>'),
    fileChangedCallback: {
      get current() { return cb },
      trigger(event: { sessionId: string; filepath: string }) {
        cb?.(event)
      },
    },
  }
})

vi.mock('@/services/electronAPI', () => ({
  api: {
    design: {
      onFileChanged: onFileChangedSpy,
      exportArtifact: vi.fn(),
    },
    readFile: readFileSpy,
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

// Stub child components to avoid mounting their dependencies
vi.mock('../DesignPreview.vue', () => ({
  default: { template: '<div class="design-preview-stub" />' },
}))
vi.mock('../WorkspaceTabsBar.vue', () => ({
  default: { template: '<div class="tabs-bar-stub" />' },
}))

import DesignFileWorkspace from '../DesignFileWorkspace.vue'

describe('DesignFileWorkspace — onFileChanged regression', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // Reset readFileSpy default
    readFileSpy.mockResolvedValue('<html><body>mock</body></html>')
  })

  it('挂载时注册 onFileChanged 监听器', () => {
    mount(DesignFileWorkspace)
    expect(onFileChangedSpy).toHaveBeenCalledOnce()
  })

  it('HTML 文件变更：更新 artifactFiles 并自动打开 tab', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'

    mount(DesignFileWorkspace)

    // 模拟 LLM 写入 index.html
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })
    await vi.waitFor(() => {
      expect(store.artifactFiles).toHaveLength(1)
    })

    expect(store.artifactFiles[0].name).toBe('index.html')
    expect(store.artifactFiles[0].path).toBe('/workspace/index.html')
    // 自动打开 tab
    expect(store.openTabs).toHaveLength(1)
    expect(store.activeTabPath).toBe('/workspace/index.html')
  })

  it('CSS 文件变更：更新 artifactFiles 但不自动打开 tab', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'

    mount(DesignFileWorkspace)

    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/style.css' })
    await vi.waitFor(() => {
      expect(store.artifactFiles).toHaveLength(1)
    })

    expect(store.artifactFiles[0].name).toBe('style.css')
    // CSS 不自动开 tab
    expect(store.openTabs).toHaveLength(0)
    expect(store.activeTabPath).toBeNull()
  })

  it('不同 sessionId 的事件被忽略', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'

    mount(DesignFileWorkspace)

    fileChangedCallback.trigger({ sessionId: 'other-session', filepath: '/workspace/index.html' })
    // 给 async handler 一点时间确保不执行
    await new Promise(r => setTimeout(r, 50))

    expect(store.artifactFiles).toHaveLength(0)
    expect(store.openTabs).toHaveLength(0)
  })

  it('已打开 tab 的 HTML 文件被修改时刷新预览内容', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'

    // 预设已打开的 tab
    store.addTab({ name: 'index.html', path: '/workspace/index.html', updatedAt: 0 })

    readFileSpy.mockResolvedValue('<html><body>updated</body></html>')

    mount(DesignFileWorkspace)

    // 触发同一文件的修改事件
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })
    await vi.waitFor(() => {
      expect(store.previewHtml).toBe('<html><body>updated</body></html>')
    })

    // 不应重复添加 tab
    expect(store.openTabs).toHaveLength(1)
    // artifactFiles 应有该文件
    expect(store.artifactFiles).toHaveLength(1)
  })

  it('卸载时注销 onFileChanged 监听器', () => {
    const wrapper = mount(DesignFileWorkspace)
    expect(fileChangedCallback.current).not.toBeNull()

    wrapper.unmount()
    expect(fileChangedCallback.current).toBeNull()
  })
})

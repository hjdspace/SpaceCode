/**
 * CurrentTurnChangeCard — 折叠文件列表与 hover diff 弹层.
 * Seam: cardData prop + session diff API + review panel 打开动作.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import CurrentTurnChangeCard from '@/components/chat/CurrentTurnChangeCard.vue'
import type { TurnChangeCardData } from '@/types'

const mocks = vi.hoisted(() => ({
  getTurnCheckpointDiff: vi.fn(),
  openReviewWithFile: vi.fn(),
  openReviewPanel: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: { session: { getTurnCheckpointDiff: mocks.getTurnCheckpointDiff } },
}))

vi.mock('@/stores/chatSession', () => ({
  useChatSessionStore: () => ({
    currentSessionId: 'session-1',
    workingDirectory: 'D:/proj',
    rewindingTurnId: null,
    undoTurn: vi.fn(),
  }),
}))

vi.mock('@/stores/sessionContext', () => ({
  useSessionContext: () => mocks,
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ isDark: false }),
}))

// @git-diff-view 用 canvas 2d 量算行号列宽，jsdom 不提供该上下文
HTMLCanvasElement.prototype.getContext = (() => ({
  font: '',
  measureText: (text: string) => ({ width: text.length * 7 }),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
  globalInjection: true,
})

function makeCardData(fileCount: number): TurnChangeCardData {
  const filesChanged = Array.from({ length: fileCount }, (_, i) => ({
    path: `src/mod${i}.ts`,
    insertions: i + 1,
    deletions: i,
  }))
  return {
    checkpoint: {
      target: {
        targetUserMessageId: 'engine-uuid-1',
        userMessageIndex: 0,
        userMessageCount: 1,
        turnStartedAt: Date.parse('2026-09-27T10:00:00.004Z'),
      },
      code: { available: true, filesChanged, insertions: 15, deletions: 10 },
    },
    workDir: 'D:/proj',
    isLatest: true,
    targetUserMessageId: 'engine-uuid-1',
  }
}

let mounted: VueWrapper | null = null

function mountCard(fileCount = 5) {
  mounted = mount(CurrentTurnChangeCard, {
    props: { cardData: makeCardData(fileCount) },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  return mounted
}

describe('CurrentTurnChangeCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    mocks.getTurnCheckpointDiff.mockResolvedValue({
      state: 'ok',
      path: 'src/mod0.ts',
      diff: [
        'diff --git a/src/mod0.ts b/src/mod0.ts',
        '--- a/src/mod0.ts',
        '+++ b/src/mod0.ts',
        '@@ -0,0 +1,2 @@',
        '+export const a = 1',
        '+export const b = 2',
      ].join('\n'),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    // 先卸载，让 Teleport 自己回收弹层，再清空 body；
    // 否则 DiffView 的异步高亮回填会在已摘除的 DOM 上打补丁
    mounted?.unmount()
    mounted = null
    document.body.innerHTML = ''
  })

  it('collapses the file list to three rows with a show-more toggle', async () => {
    const wrapper = mountCard(5)

    expect(wrapper.findAll('.file-row')).toHaveLength(3)
    expect(wrapper.find('.list-toggle').text()).toContain('再显示 2 个文件')

    wrapper.find('.list-toggle').trigger('click')
    await nextTick()

    expect(wrapper.findAll('.file-row')).toHaveLength(5)
    expect(wrapper.find('.list-toggle').text()).toContain('收起')
  })

  it('hides the toggle when every file already fits', () => {
    const wrapper = mountCard(3)

    expect(wrapper.findAll('.file-row')).toHaveLength(3)
    expect(wrapper.find('.list-toggle').exists()).toBe(false)
  })

  it('sums insertions and deletions across all files, not just visible ones', () => {
    const wrapper = mountCard(5)
    const stats = wrapper.find('.card-header .stats').text()

    expect(stats).toContain('+15')
    expect(stats).toContain('-10')
  })

  it('renders the popup diff with the review-panel renderer, without a @@ hunk row', async () => {
    const wrapper = mountCard(5)

    wrapper.findAll('.file-row')[0].trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()

    const popup = document.body.querySelector('.turn-diff-popup')
    expect(popup).not.toBeNull()
    expect(popup!.textContent).toContain('src/mod0.ts')
    expect(popup!.querySelector('[data-component="git-diff-view"]')).not.toBeNull()
    expect(popup!.querySelector('.diff-line-hunk')).toBeNull()
    expect(popup!.textContent).toContain('export const a = 1')
    expect(mocks.getTurnCheckpointDiff).toHaveBeenCalledWith(
      'session-1',
      'engine-uuid-1',
      'src/mod0.ts',
      0,
      'D:/proj'
    )
  })

  it('stays open when the diff itself is scrolled but closes on any other scroll', async () => {
    const wrapper = mountCard(5)

    wrapper.findAll('.file-row')[0].trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()

    const scroller = document.body.querySelector('.turn-diff-popup .popup-diff')
    expect(scroller).not.toBeNull()

    scroller!.dispatchEvent(new Event('scroll', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('.turn-diff-popup')).not.toBeNull()

    // 消息列表滚动
    document.body.dispatchEvent(new Event('scroll', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('.turn-diff-popup')).toBeNull()
  })

  it('closes when the scroll event targets window instead of a node', async () => {
    const wrapper = mountCard(5)

    wrapper.findAll('.file-row')[0].trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()

    expect(document.body.querySelector('.turn-diff-popup')).not.toBeNull()

    // Node.contains(window) 会抛 TypeError，不能让异常吞掉关闭动作
    window.dispatchEvent(new Event('scroll'))
    await flushPromises()

    expect(document.body.querySelector('.turn-diff-popup')).toBeNull()
  })

  it('closes the popup when the pointer leaves before the hover delay elapses', async () => {
    const wrapper = mountCard(5)

    wrapper.findAll('.file-row')[0].trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(50)
    wrapper.findAll('.file-row')[0].trigger('mouseleave')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    expect(document.body.querySelector('.turn-diff-popup')).toBeNull()
    expect(mocks.getTurnCheckpointDiff).not.toHaveBeenCalled()
  })

  it('opens the review panel for the clicked file', async () => {
    const wrapper = mountCard(5)

    wrapper.findAll('.file-row')[1].trigger('click')
    await flushPromises()

    expect(mocks.openReviewWithFile).toHaveBeenCalledWith('src/mod1.ts')
  })
})

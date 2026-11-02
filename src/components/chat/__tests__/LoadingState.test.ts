/**
 * 常驻活动指示器的文案轮询与计时锚点。
 *
 * 轮询下标由「已耗时」推导而不是组件自己的计数：MessageList 与 AgentTimeline 都传
 * 回合发起时刻，指示行因页面切换被卸载重建时，计时与文案位置都要保持连续。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import LoadingState from '../LoadingState.vue'

const LABELS = ['思考中…', '推理中…', '整理信息中…']

function mountState(props: Record<string, unknown> = {}) {
  return mount(LoadingState, { props: { labels: LABELS, rotateMs: 2400, ...props } })
}

describe('LoadingState 文案轮询', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(10_000))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function labelOf(wrapper: ReturnType<typeof mountState>): string {
    return wrapper.find('.loading-label').text()
  }

  it('挂载即取池首', () => {
    expect(labelOf(mountState())).toBe('思考中…')
  })

  it('每过 rotateMs 换下一条，池尾回到池首', async () => {
    const wrapper = mountState()

    // 异步推进：DOM 由 Vue 在微任务里刷新，同步 advance 会读到上一帧
    await vi.advanceTimersByTimeAsync(2400)
    expect(labelOf(wrapper)).toBe('推理中…')

    await vi.advanceTimersByTimeAsync(2400)
    expect(labelOf(wrapper)).toBe('整理信息中…')

    await vi.advanceTimersByTimeAsync(2400)
    expect(labelOf(wrapper)).toBe('思考中…')
  })

  it('未给 labels 时固定显示 label', async () => {
    const wrapper = mountState({ labels: undefined, label: '正在启动引擎' })

    await vi.advanceTimersByTimeAsync(5000)
    expect(labelOf(wrapper)).toBe('正在启动引擎')
  })

  it('传入 startTime 时计时从该时刻起算，轮询位置随之连续', () => {
    // 挂载点 10_000，回合发起于 2_000 → 已经跑了 8s，落在池内第 8000/2400 = 3 条（取模回第 0 条）
    const wrapper = mountState({ startTime: 2_000 })

    expect(wrapper.find('.elapsed').text()).toBe('8.0s')
    expect(labelOf(wrapper)).toBe('思考中…')
  })

  it('note 渲染为状态行下方的补充说明', () => {
    const wrapper = mountState({ note: 'MCP 连接失败：foo' })

    expect(wrapper.find('.loading-note').text()).toBe('MCP 连接失败：foo')
  })

  it('aria-label 跟随当前文案，读屏不会读到池里其它项', async () => {
    const wrapper = mountState()
    await vi.advanceTimersByTimeAsync(2400)

    expect(wrapper.find('[role="status"]').attributes('aria-label')).toBe('推理中…, 2.4s')
  })
})

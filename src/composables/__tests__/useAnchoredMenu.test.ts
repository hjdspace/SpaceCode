import { describe, it, expect } from 'vitest'
import { effectScope, nextTick, ref, type Ref } from 'vue'
import { useAnchoredMenu } from '../useAnchoredMenu'

// jsdom 的视口尺寸不由我们设定，断言一律基于实测的 innerWidth/innerHeight
function fakeAnchor(left: number, top: number, bottom: number) {
  const el = {
    getBoundingClientRect: () =>
      ({ left, top, bottom, right: left + 120, width: 120, height: bottom - top }) as DOMRect,
  }
  return el as unknown as HTMLElement
}

function toRef(el: HTMLElement): Ref<HTMLElement | null> {
  return ref<HTMLElement | null>(el)
}

function withMenu(
  anchor: Ref<HTMLElement | null>,
  open: Ref<boolean>,
  options: { width: number; gap?: number; maxHeight?: number }
) {
  let api!: ReturnType<typeof useAnchoredMenu>
  const scope = effectScope()
  scope.run(() => {
    api = useAnchoredMenu(anchor, open, options)
  })
  return { api, scope }
}

const OPTIONS = { width: 560, gap: 14, maxHeight: 400 }

describe('useAnchoredMenu', () => {
  it('未打开时不产生定位样式', () => {
    const { api, scope } = withMenu(toRef(fakeAnchor(300, 600, 630)), ref(false), OPTIONS)
    expect(api.menuStyle.value).toEqual({})
    scope.stop()
  })

  it('打开后给出 fixed 的视口坐标，底边锚在触发元素上方', () => {
    const { api, scope } = withMenu(toRef(fakeAnchor(300, 600, 630)), ref(true), OPTIONS)
    expect(api.menuStyle.value).toMatchObject({
      position: 'fixed',
      left: '300px',
      width: '560px',
      bottom: `${window.innerHeight - 600 + OPTIONS.gap}px`,
      'max-height': '400px',
    })
    scope.stop()
  })

  it('窗口缩放后按触发元素的新位置重算，并保证整块在视口内', async () => {
    const anchor = toRef(fakeAnchor(300, 600, 630))
    const { api, scope } = withMenu(anchor, ref(true), OPTIONS)
    await nextTick()
    expect(api.menuStyle.value.left).toBe('300px')

    // 触发元素右移到贴近视口右沿（等价于中心栏被拉宽后下拉挪到了右半区）
    anchor.value = fakeAnchor(window.innerWidth - 40, 600, 630)
    window.dispatchEvent(new Event('resize'))
    await nextTick()

    const left = Number(api.menuStyle.value.left.replace('px', ''))
    const width = Number(api.menuStyle.value.width.replace('px', ''))
    expect(left).toBeGreaterThan(300) // 确实跟随触发元素右移，没停在旧坐标
    expect(left + width).toBeLessThanOrEqual(window.innerWidth)
    scope.stop()
  })

  it('关闭后清空样式，重新打开时按最新位置计算', async () => {
    const open = ref(true)
    const anchor = toRef(fakeAnchor(300, 600, 630))
    const { api, scope } = withMenu(anchor, open, OPTIONS)

    open.value = false
    await nextTick()
    expect(api.menuStyle.value).toEqual({})

    anchor.value = fakeAnchor(120, 500, 530)
    open.value = true
    await nextTick()
    expect(api.menuStyle.value.left).toBe('120px')
    scope.stop()
  })
})

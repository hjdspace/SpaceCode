/**
 * 右键删除穿过 FileTree 的真实关闭行为：确认弹窗 Teleport 到 body，按下「确认」的
 * mousedown 会先被菜单的「点击外部」监听接住并 emit('close')，父组件随即把 node 置
 * null。删除必须仍作用在点击菜单时选中的那个节点上，失败时把原因带给用户。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import FileContextMenu from '../FileContextMenu.vue'

const probe = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  showAlert: vi.fn(async () => {}),
  resolveConfirm: (_v: boolean) => {},
}))

vi.mock('@/services/electronAPI', () => ({
  api: { openInEditor: vi.fn(), deleteFile: probe.deleteFile },
}))
vi.mock('@/composables/useDialog', () => ({
  useDialog: () => ({
    showAlert: probe.showAlert,
    showConfirm: () => new Promise<boolean>((resolve) => { probe.resolveConfirm = resolve }),
  }),
}))
vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ projectRoot: '/proj' }),
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, named?: Record<string, unknown>) => (named ? `${key}|${JSON.stringify(named)}` : key),
  }),
}))

const DELETE_LABEL = 'fileTree.delete'
const TARGET = { name: 'apcpu_sw_build', path: '/proj/apcpu_sw_build', type: 'directory' as const }

/** 复刻 FileTree 的单例菜单状态：closeContextMenu 会把 visible 和 node 一起清掉。 */
function mountMenu() {
  const node = ref<typeof TARGET | null>({ ...TARGET })
  const visible = ref(true)
  const Host = defineComponent({
    render: () => h(FileContextMenu, {
      visible: visible.value,
      node: node.value,
      x: 10,
      y: 10,
      onClose: () => {
        visible.value = false
        node.value = null
      },
    }),
  })
  const wrapper = mount(Host, { global: { stubs: { Teleport: true } } })
  return { menu: wrapper.findComponent(FileContextMenu) }
}

async function openConfirm(menu: ReturnType<typeof mountMenu>['menu']) {
  const button = menu.findAll('.menu-item').find((btn) => btn.text().includes(DELETE_LABEL))!
  await button.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FileContextMenu delete', () => {
  it('按确认时菜单已被外部点击关闭，删除仍落在快照节点上', async () => {
    const { menu } = mountMenu()
    probe.deleteFile.mockResolvedValue({ success: true })
    await openConfirm(menu)

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(menu.props('node')).toBeNull()

    probe.resolveConfirm(true)
    await flushPromises()

    expect(probe.deleteFile).toHaveBeenCalledWith(TARGET.path)
    expect(menu.emitted('delete')).toEqual([[TARGET]])
  })

  it('取消确认时不发起删除', async () => {
    const { menu } = mountMenu()
    await openConfirm(menu)

    probe.resolveConfirm(false)
    await flushPromises()

    expect(probe.deleteFile).not.toHaveBeenCalled()
    expect(probe.showAlert).not.toHaveBeenCalled()
  })

  it('主进程返回失败时把原因显示出来', async () => {
    const { menu } = mountMenu()
    probe.deleteFile.mockResolvedValue({ success: false, error: 'Operation not supported' })
    await openConfirm(menu)

    probe.resolveConfirm(true)
    await flushPromises()

    expect(probe.showAlert).toHaveBeenCalledWith('explorer.deleteFailed|{"error":"Operation not supported"}')
  })

  it('IPC 抛错时同样带上真实原因，不再只说请重试', async () => {
    const { menu } = mountMenu()
    probe.deleteFile.mockRejectedValue(new Error('No handler registered for \'fs:delete\''))
    await openConfirm(menu)

    probe.resolveConfirm(true)
    await flushPromises()

    expect(probe.showAlert).toHaveBeenCalledWith(
      'explorer.deleteFailed|{"error":"No handler registered for \'fs:delete\'"}',
    )
  })
})

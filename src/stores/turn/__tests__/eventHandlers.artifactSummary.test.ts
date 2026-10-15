// @vitest-environment jsdom
/**
 * 回合产物收集 — `result` 事件结算后写 message.metadata.artifacts。
 *
 * 这张卡片是用户找回 agent 生成文件（例如 python 脚本写出的 xlsx）的唯一入口。
 * 它曾经只在 `mode === 'work'` 时收集，于是 design / code 会话里的产物彻底
 * 没有入口。这里按会话模式钉住三件事：
 *  - 任何模式都会收集，只要会话有工作目录
 *  - 所有模式都要求主进程连工作区一起扫（officecli 技能族没有 outputs/ 约定，
 *    LLM 会把表格写在工作目录任意位置）
 *  - 只收本轮时间窗内被写入的文件，历史文件不算本轮产物
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '@/stores/chatSession'

const WORKING_DIR = 'D:\\doc\\AI\\ws'

function makeFakeApi(list: ReturnType<typeof vi.fn>) {
  const handlers: Record<string, (...args: any[]) => void> = {}
  const noopSubscribe = (key: string) => (cb: any) => {
    handlers[key] = cb
    return () => {}
  }
  return {
    claudeCode: {
      onStreamEvent: noopSubscribe('onStreamEvent'),
      onAssistant: noopSubscribe('onAssistant'),
      onToolUse: noopSubscribe('onToolUse'),
      onToolResult: noopSubscribe('onToolResult'),
      onUser: noopSubscribe('onUser'),
      onSystem: noopSubscribe('onSystem'),
      onResult: noopSubscribe('onResult'),
      onExit: noopSubscribe('onExit'),
      onError: noopSubscribe('onError'),
      onPermissionRequest: noopSubscribe('onPermissionRequest'),
      onPermissionRequestCancelled: noopSubscribe('onPermissionRequestCancelled'),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      allowPermission: vi.fn().mockResolvedValue(undefined),
      denyPermission: vi.fn().mockResolvedValue(undefined),
      submitToolAnswer: vi.fn().mockResolvedValue(undefined),
      skipToolAnswer: vi.fn().mockResolvedValue(undefined),
    },
    artifacts: { list },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    _handlers: handlers,
  }
}

function artifact(name: string, mtime: number) {
  return { name, path: `${WORKING_DIR}\\${name}`, ext: name.split('.').pop()!, size: 1024, mtime }
}

function assistantOf(sessionId: string) {
  return useChatSessionStore()
    .getSessionMessages(sessionId)
    .find(m => m.role === 'assistant')
}

/** 跑一个完整回合：message_start → result 结算。 */
function settleTurn(sessionId: string, fake: ReturnType<typeof makeFakeApi>) {
  fake._handlers.onStreamEvent({
    sessionId,
    data: { type: 'message_start', message: { model: 'test-model' } },
  })
  fake._handlers.onResult({
    sessionId,
    data: { result: '已生成考勤表', usage: { input_tokens: 1, output_tokens: 1 } },
  })
}

/** 产物是结算后异步补写的，等到它出现在消息上为止。 */
async function waitForArtifacts(sessionId: string) {
  await vi.waitFor(() => {
    expect(assistantOf(sessionId)?.metadata?.artifacts).toBeDefined()
  })
}

async function setupSession(mode: 'work' | 'design' | 'code', list: ReturnType<typeof vi.fn>) {
  const fake = makeFakeApi(list)
  const { useTurnStore } = await import('@/stores/turn')
  useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()
  const session = sessionStore.createSession('Test', WORKING_DIR, `sess-${mode}`)
  session.mode = mode
  sessionStore.currentSessionId = `sess-${mode}`
  sessionStore.addMessage({ role: 'user', content: '做一个考勤表' }, `sess-${mode}`)
  return fake
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('回合产物收集', () => {
  it.each(['design', 'code'] as const)(
    '%s 会话把本轮写出的交付物挂到助手消息上，并要求扫工作区',
    async (mode) => {
      const list = vi.fn().mockResolvedValue({ artifacts: [artifact('考勤表.xlsx', Date.now())] })
      const fake = await setupSession(mode, list)

      settleTurn(`sess-${mode}`, fake)
      await waitForArtifacts(`sess-${mode}`)

      expect(list).toHaveBeenCalledWith(WORKING_DIR, { scanWorkspaceRoot: true })
      expect(assistantOf(`sess-${mode}`)?.metadata?.artifacts?.map(a => a.name)).toEqual(['考勤表.xlsx'])
    },
  )

  it('work 会话也扫工作区根目录 —— officecli 技能没有 outputs/ 约定', async () => {
    const list = vi.fn().mockResolvedValue({ artifacts: [artifact('deck.pptx', Date.now())] })
    const fake = await setupSession('work', list)

    settleTurn('sess-work', fake)
    await waitForArtifacts('sess-work')

    expect(list).toHaveBeenCalledWith(WORKING_DIR, { scanWorkspaceRoot: true })
  })

  it('本轮之前就在的文件不算本轮产物', async () => {
    const stale = artifact('old-index.html', Date.now() - 60 * 60 * 1000)
    const list = vi.fn().mockResolvedValue({ artifacts: [stale] })
    const fake = await setupSession('code', list)

    settleTurn('sess-code', fake)
    await vi.waitFor(() => expect(list).toHaveBeenCalled())
    // 收集确实跑过了，只是时间窗把它挡在卡片之外
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(assistantOf('sess-code')?.metadata?.artifacts).toBeUndefined()
  })
})

// issue #40 问题 4：办公模式生成的 Excel 看不到右侧实时预览。
// 自动预览原来住在 ArtifactsPanel 里，而它只在产物 tab 挂载时存在 —— 没挂载就永远不打开。
describe('交付物自动进入右侧预览', () => {
  it('work 会话生成 xlsx 后直接开预览，不等用户点卡片，且默认 watch 实时模式', async () => {
    const xlsx = artifact('考勤表.xlsx', Date.now())
    const list = vi.fn().mockResolvedValue({ artifacts: [xlsx] })
    const fake = await setupSession('work', list)
    const { useAppStore } = await import('@/stores/app')

    settleTurn('sess-work', fake)
    await vi.waitFor(() => expect(useAppStore().officePreviewFile).toBe(xlsx.path))

    expect(useAppStore().officePreviewFile).toBe(xlsx.path)
    // watch 模式由 officecli 实时服务器承载：LLM 编辑文档过程中右侧自动刷新
    expect(useAppStore().officePreviewMode).toBe('watch')
  })

  it('自动预览 pdf 时回退 html 模式（pdf 不支持 watch）', async () => {
    const pdf = artifact('简历.pdf', Date.now())
    const list = vi.fn().mockResolvedValue({ artifacts: [pdf] })
    const fake = await setupSession('work', list)
    const { useAppStore } = await import('@/stores/app')

    settleTurn('sess-work', fake)
    await vi.waitFor(() => expect(useAppStore().officePreviewFile).toBe(pdf.path))

    expect(useAppStore().officePreviewMode).toBe('html')
  })

  it('一轮写出多个交付物时预览最新的那一个', async () => {
    const older = artifact('draft.xlsx', Date.now() - 5_000)
    const newer = artifact('final.xlsx', Date.now())
    const list = vi.fn().mockResolvedValue({ artifacts: [older, newer] })
    const fake = await setupSession('work', list)
    const { useAppStore } = await import('@/stores/app')

    settleTurn('sess-work', fake)
    await vi.waitFor(() => expect(useAppStore().officePreviewFile).toBe(newer.path))
  })

  it('design 会话不抢 DesignFileWorkspace 自己的预览区', async () => {
    const xlsx = artifact('spec.xlsx', Date.now())
    const list = vi.fn().mockResolvedValue({ artifacts: [xlsx] })
    const fake = await setupSession('design', list)
    const { useAppStore } = await import('@/stores/app')

    settleTurn('sess-design', fake)
    await waitForArtifacts('sess-design')
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(useAppStore().officePreviewFile).toBe('')
  })
})

// 创建即打开：officecli 技能没有输出目录约定，LLM 可能把表格写在工作目录根 ——
// 等 turn 结束的产物扫描再打开既滞后也可能扫不到（文件名不在交付物白名单时）。
// 工具刚完成就解析目标文件，立即送预览。
describe('工具完成即打开预览（不等回合结束）', () => {
  function sendToolUse(fake: ReturnType<typeof makeFakeApi>, sessionId: string, tool: { id: string; name: string; input: Record<string, unknown> }) {
    fake._handlers.onStreamEvent({
      sessionId,
      data: { type: 'message_start', message: { model: 'test-model' } },
    })
    fake._handlers.onToolUse({ sessionId, data: tool })
  }

  function sendToolSuccess(fake: ReturnType<typeof makeFakeApi>, sessionId: string, toolId: string) {
    fake._handlers.onUser({
      sessionId,
      data: { message: { content: [{ type: 'tool_result', tool_use_id: toolId, is_error: false, content: 'ok' }] } },
    })
  }

  it('Bash 跑 officecli create 表格 → 工具完成立即开 watch 预览', async () => {
    const fake = await setupSession('work', vi.fn().mockResolvedValue({ artifacts: [] }))
    const { useAppStore } = await import('@/stores/app')

    sendToolUse(fake, 'sess-work', {
      id: 'tu-1',
      name: 'Bash',
      input: { command: 'officecli create "考勤表.xlsx" --type workbook' },
    })
    sendToolSuccess(fake, 'sess-work', 'tu-1')

    await vi.waitFor(() => expect(useAppStore().officePreviewFile).toBe(`${WORKING_DIR}\\考勤表.xlsx`))
    expect(useAppStore().officePreviewMode).toBe('watch')
  })

  it('Write 写出 xlsx → 立即开预览', async () => {
    const fake = await setupSession('code', vi.fn().mockResolvedValue({ artifacts: [] }))
    const { useAppStore } = await import('@/stores/app')

    sendToolUse(fake, 'sess-code', {
      id: 'tu-2',
      name: 'Write',
      input: { file_path: 'D:\\doc\\AI\\ws\\报价单.xlsx' },
    })
    sendToolSuccess(fake, 'sess-code', 'tu-2')

    await vi.waitFor(() => expect(useAppStore().officePreviewFile).toBe('D:\\doc\\AI\\ws\\报价单.xlsx'))
  })

  it('失败的工具调用不触发预览', async () => {
    const fake = await setupSession('work', vi.fn().mockResolvedValue({ artifacts: [] }))
    const { useAppStore } = await import('@/stores/app')

    sendToolUse(fake, 'sess-work', {
      id: 'tu-3',
      name: 'Bash',
      input: { command: 'officecli create 报表.xlsx' },
    })
    fake._handlers.onUser({
      sessionId: 'sess-work',
      data: { message: { content: [{ type: 'tool_result', tool_use_id: 'tu-3', is_error: true, content: 'error' }] } },
    })
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(useAppStore().officePreviewFile).toBe('')
  })

  it('同一文件只弹一次：工具已开预览，回合结算不再重复打开', async () => {
    const xlsx = artifact('考勤表.xlsx', Date.now())
    const list = vi.fn().mockResolvedValue({ artifacts: [xlsx] })
    const fake = await setupSession('work', list)
    const { useAppStore } = await import('@/stores/app')

    sendToolUse(fake, 'sess-work', {
      id: 'tu-4',
      name: 'Bash',
      input: { command: `officecli create "${WORKING_DIR}\\考勤表.xlsx"` },
    })
    sendToolSuccess(fake, 'sess-work', 'tu-4')
    await vi.waitFor(() => expect(useAppStore().officePreviewFile).toBe(xlsx.path))

    // result 结算走产物收集；文件已进 autoPreviewedPaths，不应再次打开
    fake._handlers.onResult({
      sessionId: 'sess-work',
      data: { result: '已生成考勤表', usage: { input_tokens: 1, output_tokens: 1 } },
    })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(useAppStore().officePreviewFile).toBe(xlsx.path)
  })
})

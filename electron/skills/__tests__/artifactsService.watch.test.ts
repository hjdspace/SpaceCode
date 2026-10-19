// @vitest-environment node
/**
 * startArtifactsWatch / stopArtifactsWatch — watcher 生命周期契约（issue #44）。
 *
 *  - outputs/ 尚不存在时不再“零 watcher 假成功”：在工作区顶层挂占位监听并如实
 *    回报 watching=true（占位监听计入 watchCount）
 *  - 占位监听发现 outputs/ 出现后自动补建真正的监听，agent 随后的写入会推送
 *    artifacts:changed（mkdir 与首个写入挤在同一批事件里的竞态由重建后的补推兜住）
 *  - outputs/ 已存在时直接建立监听，写入即推送
 *  - 空 workingDir 回报 watching=false
 *  - stopWatch 拆掉全部 watcher，此后写入不再推送
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const sendMock = vi.fn()
const fakeWindows = [{ webContents: { send: sendMock } }]

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => fakeWindows) },
}))

import { ipcMain } from 'electron'
import {
  registerArtifactsIPCHandlers,
  stopArtifactsWatch,
} from '@electron/skills/artifactsService'

let workspace = ''

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'artifacts-watch-'))
  sendMock.mockClear()
})

afterEach(() => {
  // 先关 watcher 再删临时目录，否则 Windows 上句柄未释放会 rmSync 失败
  stopArtifactsWatch()
  rmSync(workspace, { recursive: true, force: true })
})

afterAll(() => {
  stopArtifactsWatch()
})

/** 从被 mock 的 ipcMain.handle 里取回注册进来的 handler */
function registeredHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
  const call = [...calls].reverse().find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not registered: ${channel}`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

/** notifyArtifactsChanged 有 300ms 防抖，轮询等待事件送达 */
async function waitForChanged(timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (sendMock.mock.calls.length === 0) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('artifacts:changed was not delivered in time')
    }
    await new Promise(r => setTimeout(r, 50))
  }
}

describe('startArtifactsWatch（outputs/ 尚不存在：占位监听 + 自动补建）', () => {
  it('reports watching=true via the provisional root watch instead of a fake success', async () => {
    registerArtifactsIPCHandlers()
    const startWatch = registeredHandler('artifacts:startWatch')

    // outputs/ 不存在：回报的是真实状态（占位监听已挂上），而不是无条件的 true
    const status = await startWatch(undefined, workspace)
    expect(status).toEqual({ watching: true, watchCount: 1 })
  })

  it('upgrades to a real watch once outputs/ appears and pushes the first file', async () => {
    registerArtifactsIPCHandlers()
    const startWatch = registeredHandler('artifacts:startWatch')
    await startWatch(undefined, workspace)

    // agent 创建 outputs/ 并写出第一个产物
    mkdirSync(join(workspace, 'outputs'))
    writeFileSync(join(workspace, 'outputs', 'report.xlsx'), 'x')

    // 无论 mkdir 与写入是否挤在同一批事件里（写入事件可能无人接收），
    // 重建后的补推都必须让面板拿到至少一次 artifacts:changed
    await waitForChanged()
    expect(sendMock).toHaveBeenCalledWith(
      'artifacts:changed',
      { eventType: 'change', filename: '' },
    )
  })
})

describe('startArtifactsWatch（outputs/ 已存在）', () => {
  it('watches outputs/ directly and pushes on write', async () => {
    mkdirSync(join(workspace, 'outputs'))
    registerArtifactsIPCHandlers()
    const startWatch = registeredHandler('artifacts:startWatch')

    const status = await startWatch(undefined, workspace)
    expect(status).toEqual({ watching: true, watchCount: 1 })

    writeFileSync(join(workspace, 'outputs', '考勤表.xlsx'), 'x')
    await waitForChanged()
  })
})

describe('startArtifactsWatch（异常输入）', () => {
  it('reports watching=false for an empty working directory', async () => {
    registerArtifactsIPCHandlers()
    const startWatch = registeredHandler('artifacts:startWatch')

    expect(await startWatch(undefined, '')).toEqual({ watching: false, watchCount: 0 })
  })
})

describe('stopArtifactsWatch', () => {
  it('tears down all watchers so later writes no longer push', async () => {
    mkdirSync(join(workspace, 'outputs'))
    registerArtifactsIPCHandlers()
    const startWatch = registeredHandler('artifacts:startWatch')
    const stopWatch = registeredHandler('artifacts:stopWatch')
    await startWatch(undefined, workspace)
    await stopWatch()

    writeFileSync(join(workspace, 'outputs', 'later.xlsx'), 'x')
    // 防抖 300ms，等一个明显超出防抖窗口的时间确认无事件
    await new Promise(r => setTimeout(r, 800))
    expect(sendMock).not.toHaveBeenCalled()
  })
})

// @vitest-environment node
/**
 * editorLauncher 的生产契约（此前 0% 覆盖 —— "Open in Editor" 的跨平台启动器）：
 *
 * 1. 启动器表：8 个 editor 的 command/args 形状与 raw 标志（raw=false ⇒ shell:true）。
 * 2. 跨平台分支：isWin/isMac 在模块加载时求值，故用 process.platform 重定义 +
 *    resetModules + 动态 import 分别测 win32 / darwin / linux 的
 *    fileExplorer、terminal、gitBash、androidStudio 分支。
 * 3. WSL 路径转换（私有 toWslPath 经 EDITOR_LAUNCHERS.wsl.args 间接测）：
 *    C:\foo\bar → /mnt/c/foo/bar；大小写 drive；POSIX 透传；反斜杠归一。
 * 4. openPathInEditor 异步生命周期：路径不存在 / 未知编辑器拒绝；spawn 以
 *    launcher 的 command/args 与 shell 标志调用；spawn 事件 → unref + 100ms 后
 *    resolve success；error 事件 → resolve failure + logger.error；settle 守卫
 *    保证 error+spawn 只 resolve 一次。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExternalEditor } from '../editorLauncher'

/** 假 ChildProcess：once 登记事件，测试侧手动 emit 驱动。 */
function makeChild() {
  const listeners = new Map<string, Array<(payload?: any) => void>>()
  return {
    unref: vi.fn(),
    once: vi.fn((ev: string, cb: (payload?: any) => void) => {
      const arr = listeners.get(ev) ?? []
      arr.push(cb)
      listeners.set(ev, arr)
    }),
    emit(ev: string, payload?: any) {
      for (const cb of listeners.get(ev) ?? []) cb(payload)
    },
  }
}

const probe = vi.hoisted(() => {
  let child: ReturnType<typeof makeChild> | null = null
  return {
    setChild: (c: ReturnType<typeof makeChild> | null) => {
      child = c
    },
    getChild: () => child,
    spawn: vi.fn((..._args: unknown[]) => child),
    existsSync: vi.fn<(p: string) => boolean>(() => true),
    loggerError: vi.fn(),
  }
})

vi.mock('child_process', () => ({ spawn: probe.spawn }))
vi.mock('fs', () => ({ existsSync: probe.existsSync }))
vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: probe.loggerError,
}))

// 静态导入 = 当前平台（win32 / linux / darwin 之一）下的模块实例
import { EDITOR_LAUNCHERS, openPathInEditor } from '../editorLauncher'

const originalPlatform = process.platform

/** 以指定平台重载模块（isWin/isMac 是模块级常量） */
async function loadWithPlatform(platform: string) {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  return await import('../editorLauncher')
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
  vi.useRealTimers()
})

beforeEach(() => {
  probe.setChild(null)
  probe.spawn.mockClear()
  probe.existsSync.mockReset().mockReturnValue(true)
  probe.loggerError.mockClear()
})

describe('启动器表（当前平台）', () => {
  it('平台无关的 editor：命令与参数形状固定', () => {
    const p = '/proj/a.ts'
    expect(EDITOR_LAUNCHERS.vscode.command(p)).toBe('code')
    expect(EDITOR_LAUNCHERS.vscode.args(p)).toEqual(['-r', p])
    expect(EDITOR_LAUNCHERS.cursor.command(p)).toBe('cursor')
    expect(EDITOR_LAUNCHERS.cursor.args(p)).toEqual([p])
    expect(EDITOR_LAUNCHERS.wsl.command(p)).toBe('wsl.exe')
    expect(EDITOR_LAUNCHERS.visualstudio.args(p)).toEqual([p])
    expect(EDITOR_LAUNCHERS.androidStudio.args(p)).toEqual([p])
  })

  it('raw 标志与 shell 语义：raw=true 的 editor 会得到 shell:false', async () => {
    vi.useFakeTimers()
    const p = '/proj/a.ts'
    const launcher = EDITOR_LAUNCHERS.fileExplorer
    probe.setChild(makeChild())
    const promise = openPathInEditor('fileExplorer', p)
    expect(probe.spawn).toHaveBeenCalledWith(launcher.command(p), launcher.args(p), {
      detached: true,
      stdio: 'ignore',
      shell: !launcher.raw,
    })
    const child = probe.getChild()!
    child.emit('spawn')
    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).resolves.toEqual({ success: true })
  })
})

describe('WSL 路径转换（经 wsl.args 间接测私有 toWslPath）', () => {
  it('Windows 盘符路径 → /mnt/<drive>/<rest>，盘符小写、反斜杠归一', () => {
    expect(EDITOR_LAUNCHERS.wsl.args('C:\\foo\\bar.txt')).toEqual(['--cd', '/mnt/c/foo/bar.txt'])
    expect(EDITOR_LAUNCHERS.wsl.args('c:/foo/bar.txt')).toEqual(['--cd', '/mnt/c/foo/bar.txt'])
  })

  it('非盘符路径透传，仅把反斜杠归一为正斜杠', () => {
    expect(EDITOR_LAUNCHERS.wsl.args('/home/u/a')).toEqual(['--cd', '/home/u/a'])
    expect(EDITOR_LAUNCHERS.wsl.args('a\\b\\c')).toEqual(['--cd', 'a/b/c'])
    expect(EDITOR_LAUNCHERS.wsl.args('')).toEqual(['--cd', ''])
  })
})

describe('跨平台分支（win32 / darwin / linux）', () => {
  it('win32：explorer.exe + raw、cmd.exe start 参数、git-bash.exe、studio64.exe、devenv', async () => {
    const mod = await loadWithPlatform('win32')
    const p = 'C:\\proj'
    expect(mod.EDITOR_LAUNCHERS.fileExplorer.command(p)).toBe('explorer.exe')
    expect(mod.EDITOR_LAUNCHERS.fileExplorer.raw).toBe(true)
    expect(mod.EDITOR_LAUNCHERS.terminal.command(p)).toBe('cmd.exe')
    expect(mod.EDITOR_LAUNCHERS.terminal.args(p)).toEqual(['/c', 'start', '""', '/D', p, 'cmd.exe', '/K', 'cd', '/d', p])
    expect(mod.EDITOR_LAUNCHERS.gitBash.command(p)).toBe('C:\\Program Files\\Git\\git-bash.exe')
    expect(mod.EDITOR_LAUNCHERS.gitBash.args(p)).toEqual([`--cd=${p}`])
    expect(mod.EDITOR_LAUNCHERS.androidStudio.command(p)).toBe('studio64.exe')
    expect(mod.EDITOR_LAUNCHERS.visualstudio.command(p)).toBe('devenv')
  })

  it('darwin：open 命令、Terminal -a 参数、GitHub Desktop git-bash、studio 绝对路径', async () => {
    const mod = await loadWithPlatform('darwin')
    const p = '/proj'
    expect(mod.EDITOR_LAUNCHERS.fileExplorer.command(p)).toBe('open')
    expect(mod.EDITOR_LAUNCHERS.fileExplorer.raw).toBe(false)
    expect(mod.EDITOR_LAUNCHERS.terminal.command(p)).toBe('open')
    expect(mod.EDITOR_LAUNCHERS.terminal.args(p)).toEqual(['-a', 'Terminal', p])
    expect(mod.EDITOR_LAUNCHERS.gitBash.command(p)).toBe('/Applications/GitHub Desktop.app/Contents/Resources/git-bash')
    expect(mod.EDITOR_LAUNCHERS.gitBash.args(p)).toEqual(['-c', `cd '${p}' && exec $SHELL`])
    expect(mod.EDITOR_LAUNCHERS.androidStudio.command(p)).toBe('/Applications/Android Studio.app/Contents/MacOS/studio')
    expect(mod.EDITOR_LAUNCHERS.visualstudio.command(p)).toBe('visualstudio')
  })

  it('linux：xdg-open、x-terminal-emulator --working-directory、git-bash、studio', async () => {
    const mod = await loadWithPlatform('linux')
    const p = '/proj'
    expect(mod.EDITOR_LAUNCHERS.fileExplorer.command(p)).toBe('xdg-open')
    expect(mod.EDITOR_LAUNCHERS.fileExplorer.raw).toBe(false)
    expect(mod.EDITOR_LAUNCHERS.terminal.command(p)).toBe('x-terminal-emulator')
    expect(mod.EDITOR_LAUNCHERS.terminal.args(p)).toEqual(['--working-directory', p])
    expect(mod.EDITOR_LAUNCHERS.gitBash.command(p)).toBe('git-bash')
    expect(mod.EDITOR_LAUNCHERS.gitBash.args(p)).toEqual(['-c', `cd '${p}' && exec $SHELL`])
    expect(mod.EDITOR_LAUNCHERS.androidStudio.command(p)).toBe('studio')
  })
})

describe('openPathInEditor 分支与边界', () => {
  it('路径不存在 → Path does not exist，spawn 不被调用', async () => {
    probe.existsSync.mockReturnValue(false)
    await expect(openPathInEditor('vscode', '/nope.ts')).resolves.toEqual({
      success: false,
      error: 'Path does not exist',
    })
    expect(probe.spawn).not.toHaveBeenCalled()
  })

  it('空路径字符串同样拒绝，spawn 不被调用', async () => {
    await expect(openPathInEditor('vscode', '')).resolves.toEqual({
      success: false,
      error: 'Path does not exist',
    })
    expect(probe.spawn).not.toHaveBeenCalled()
  })

  it('未知编辑器 → Unsupported editor，spawn 不被调用', async () => {
    await expect(openPathInEditor('notepad' as ExternalEditor, '/a.ts')).resolves.toEqual({
      success: false,
      error: 'Unsupported editor: notepad',
    })
    expect(probe.spawn).not.toHaveBeenCalled()
  })

  it('成功路径：spawn 事件 → unref + 100ms 后 resolve success', async () => {
    vi.useFakeTimers()
    const p = '/a.ts'
    const launcher = EDITOR_LAUNCHERS.vscode
    probe.setChild(makeChild())
    const promise = openPathInEditor('vscode', p)
    const child = probe.getChild()!

    expect(probe.spawn).toHaveBeenCalledWith(launcher.command(p), launcher.args(p), {
      detached: true,
      stdio: 'ignore',
      shell: !launcher.raw,
    })

    child.emit('spawn')
    expect(child.unref).toHaveBeenCalled()
    // 100ms 到点前不 resolve
    let resolved = false
    promise.then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(50)
    await expect(promise).resolves.toEqual({ success: true })
  })

  it('失败路径：error 事件 → resolve failure 并记 logger.error，不 unref', async () => {
    probe.setChild(makeChild())
    const promise = openPathInEditor('vscode', '/a.ts')
    const child = probe.getChild()!
    child.emit('error', new Error('ENOENT'))

    await expect(promise).resolves.toEqual({ success: false, error: 'ENOENT' })
    expect(probe.loggerError).toHaveBeenCalledWith('IPC', 'app:openInEditor failed', expect.objectContaining({
      editor: 'vscode',
      targetPath: '/a.ts',
    }))
    expect(child.unref).not.toHaveBeenCalled()
  })

  it('settle 守卫：error 之后再来 spawn，只 resolve 一次（保持失败结果）', async () => {
    vi.useFakeTimers()
    probe.setChild(makeChild())
    const promise = openPathInEditor('vscode', '/a.ts')
    const child = probe.getChild()!

    child.emit('error', new Error('boom'))
    child.emit('spawn') // 此时已 settled，timer 回调应空转
    await vi.advanceTimersByTimeAsync(200)

    await expect(promise).resolves.toEqual({ success: false, error: 'boom' })
    expect(child.unref).toHaveBeenCalled() // spawn 处理器仍跑（unref），但不改结果
  })
})

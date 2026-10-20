// @vitest-environment node
/**
 * coreIpcHandlers 的生产契约（此文件此前 0% 覆盖 —— 全部"杂项" IPC 的主进程入口）：
 *
 * 1. handler 注册面：registerCoreIPCHandlers 把 handle/on 两类 handler 都挂到
 *    ipcMain 上，channel 名来自真实的 channelNames(terminalNamespace) 派生 ——
 *    这里用真实派生值断言注册面，防止 preload bridge 与 handler 拼写脱钩。
 * 2. fs 失败语义：读失败回 null/[]（渲染层依赖"空"而不是 reject），写失败回
 *    { success:false, error: message }。错误不能抛穿 IPC 边界。
 * 3. fs:searchFiles 排序契约：空 query = 顶层列表（跳过隐藏目录但保留 .claude、
 *    跳过 node_modules 等 ignoreDirs、目录优先）；带 query = 递归走目录（深度 8、
 *    maxResults 提前剪枝、跳过隐藏目录），按 精确名 > 前缀 > 包含 排序。
 * 4. fs:delete 双路径：permanent=true 走 rmSync(recursive,force)，
 *    false 走 shell.trashItem。
 * 5. image:save/load 的 id 白名单 /^[0-9a-f-]+$/ —— 不合法 id 直接拒绝，不落盘。
 * 6. session:getTurnCheckpoints 的 projectPath 兜底链：显式参数 > sender URL >
 *    executeJavaScript 兜底（兜底为空时报 'Project path not available'）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join, resolve } from 'path'

interface FakeDirent {
  name: string
  isDirectory: () => boolean
  isFile: () => boolean
}

const probe = vi.hoisted(() => {
  return {
    handlers: {} as Record<string, (...args: any[]) => any>,
    mainWindow: null as any,
    isPackaged: false,
    electron: {
      appGetPath: vi.fn((name: string) => ({ documents: '/documents-dir', home: '/home-dir', userData: '/user-data-dir' }[name] ?? '/fallback')),
      shellOpenExternal: vi.fn(async () => {}),
      shellOpenPath: vi.fn(async () => {}),
      shellTrashItem: vi.fn(async () => {}),
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/picked'] })),
      netFetch: vi.fn(async () => ({ ok: true, status: 200, text: async () => 'body' })),
    },
    fs: {
      readFileSync: vi.fn<(...args: any[]) => any>(() => 'file-content'),
      readdirSync: vi.fn<(p: string, opts?: unknown) => FakeDirent[]>(() => []),
      statSync: vi.fn<(...args: any[]) => any>(() => ({ size: 10, isDirectory: () => false, isFile: () => true, mtime: new Date(0) })),
      existsSync: vi.fn<(p: string) => boolean>(() => false),
      writeFileSync: vi.fn<(...args: any[]) => any>(),
      mkdirSync: vi.fn<(...args: any[]) => any>(),
      copyFileSync: vi.fn<(...args: any[]) => any>(),
      renameSync: vi.fn<(...args: any[]) => any>(),
      rmSync: vi.fn<(...args: any[]) => any>(),
    },
    execSync: vi.fn<(cmd: string) => string>(() => {
      throw new Error('command not found')
    }),
    execFileSync: vi.fn<(cmd: string, args: string[]) => string>(() => {
      throw new Error('command not found')
    }),
    logger: {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      listDebugFiles: vi.fn(() => ['debug-1.log']),
      readDebugFile: vi.fn(() => 'debug body'),
      listTraceSessions: vi.fn(() => ['trace-1']),
      readTraceEvents: vi.fn(() => [{ type: 'x' }]),
      traceEvent: vi.fn(),
    },
    editorLaunchers: { vscode: vi.fn() } as Record<string, unknown>,
    openPathInEditor: vi.fn(async () => ({ success: true })),
    checkpoints: {
      listSessionTurnCheckpoints: vi.fn(async () => [{ id: 'cp-1' }]),
      getTurnRewindPreviewFiles: vi.fn(async () => ({ ok: true, files: ['a.ts'] })),
      getTurnCheckpointDiff: vi.fn(async () => ({ state: 'changed', path: 'a.ts' })),
      getSessionFileDiff: vi.fn(async () => ({ state: 'changed', path: 'a.ts' })),
      rewindTurn: vi.fn(async () => ({ ok: true })),
    },
    terminalManager: {
      create: vi.fn(() => ({ id: 'term-1', shell: 'bash' })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    } as any,
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      probe.handlers[channel] = handler
    }),
    on: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      probe.handlers[channel] = handler
    }),
  },
  app: {
    getPath: probe.electron.appGetPath,
    get isPackaged() {
      return probe.isPackaged
    },
  },
  shell: {
    openExternal: probe.electron.shellOpenExternal,
    openPath: probe.electron.shellOpenPath,
    trashItem: probe.electron.shellTrashItem,
  },
  dialog: { showOpenDialog: probe.electron.showOpenDialog },
  net: { fetch: probe.electron.netFetch },
}))

vi.mock('fs', () => ({
  readFileSync: probe.fs.readFileSync,
  readdirSync: probe.fs.readdirSync,
  statSync: probe.fs.statSync,
  existsSync: probe.fs.existsSync,
  writeFileSync: probe.fs.writeFileSync,
  mkdirSync: probe.fs.mkdirSync,
  copyFileSync: probe.fs.copyFileSync,
  renameSync: probe.fs.renameSync,
  rmSync: probe.fs.rmSync,
}))

vi.mock('child_process', () => ({ execSync: probe.execSync, execFileSync: probe.execFileSync }))

vi.mock('../../infra/logger', () => probe.logger)

vi.mock('../../infra/terminalManager', () => ({ TerminalManager: class {} }))

vi.mock('../../windows/mainWindow', () => ({
  getMainWindow: () => probe.mainWindow,
}))

vi.mock('../../ipc/editorLauncher', () => ({
  EDITOR_LAUNCHERS: probe.editorLaunchers,
  openPathInEditor: probe.openPathInEditor,
}))

vi.mock('../../session/turnCheckpointService', () => ({
  listSessionTurnCheckpoints: probe.checkpoints.listSessionTurnCheckpoints,
  getTurnRewindPreviewFiles: probe.checkpoints.getTurnRewindPreviewFiles,
  getTurnCheckpointDiff: probe.checkpoints.getTurnCheckpointDiff,
  getSessionFileDiff: probe.checkpoints.getSessionFileDiff,
  rewindTurn: probe.checkpoints.rewindTurn,
}))

import { registerCoreIPCHandlers } from '../coreIpcHandlers'
import { channelNames } from '@/shared/channelMap'
import { terminalNamespace } from '@/shared/channels/terminal'

const TERM = channelNames(terminalNamespace.channels, 'terminal:')

/** 取已注册的 handler；未注册直接 fail */
function H(channel: string): (...args: any[]) => any {
  const fn = probe.handlers[channel]
  expect(fn, `handler ${channel} 未注册`).toBeTruthy()
  return fn
}

/** ipcMain.handle 的第一参数，sender 按 turn checkpoints 的需要可加 getURL/executeJavaScript */
function ev(sender?: Partial<{ getURL: () => string; executeJavaScript: (code: string) => Promise<string> }>): any {
  return { sender }
}

/** 把 readdirSync 变成按 path 查目录项的假文件树 */
function fakeTree(tree: Record<string, FakeDirent[]>): void {
  probe.fs.readdirSync.mockImplementation((p: string) => {
    const entries = tree[p]
    if (!entries) throw new Error(`ENOENT: ${p}`)
    return entries
  })
}

function dir(name: string): FakeDirent {
  return { name, isDirectory: () => true, isFile: () => false }
}

function file(name: string): FakeDirent {
  return { name, isDirectory: () => false, isFile: () => true }
}

beforeEach(() => {
  probe.handlers = {}
  probe.mainWindow = null
  probe.isPackaged = false
  probe.fs.readFileSync.mockReset().mockImplementation(() => 'file-content')
  probe.fs.readdirSync.mockReset().mockImplementation(() => [])
  probe.fs.statSync.mockReset().mockImplementation(() => ({ size: 10, isDirectory: () => false, isFile: () => true, mtime: new Date(0) }))
  probe.fs.existsSync.mockReset().mockImplementation(() => false)
  probe.fs.writeFileSync.mockReset()
  probe.fs.mkdirSync.mockReset()
  probe.fs.copyFileSync.mockReset()
  probe.fs.renameSync.mockReset()
  probe.fs.rmSync.mockReset()
  probe.electron.appGetPath.mockReset().mockImplementation(
    (name: string) => ({ documents: '/documents-dir', home: '/home-dir', userData: '/user-data-dir' }[name] ?? '/fallback'),
  )
  probe.electron.shellOpenExternal.mockClear().mockResolvedValue(undefined)
  probe.electron.shellOpenPath.mockClear().mockResolvedValue(undefined)
  probe.electron.shellTrashItem.mockClear().mockResolvedValue(undefined)
  probe.electron.showOpenDialog.mockClear().mockResolvedValue({ canceled: false, filePaths: ['/picked'] })
  probe.electron.netFetch.mockClear().mockImplementation(async () => ({ ok: true, status: 200, text: async () => 'body' }))
  probe.execSync.mockClear().mockImplementation(() => {
    throw new Error('command not found')
  })
  probe.execFileSync.mockClear().mockImplementation(() => {
    throw new Error('command not found')
  })
  for (const fn of Object.values(probe.logger)) (fn as any).mockClear()
  probe.openPathInEditor.mockClear().mockResolvedValue({ success: true })
  for (const fn of Object.values(probe.checkpoints)) (fn as any).mockClear()
  probe.terminalManager.create.mockClear().mockImplementation(() => ({ id: 'term-1', shell: 'bash' }))
  probe.terminalManager.write.mockClear()
  probe.terminalManager.resize.mockClear()
  probe.terminalManager.kill.mockClear()
  registerCoreIPCHandlers(probe.terminalManager)
})

describe('注册面与 terminal channel 派生名', () => {
  it('terminal:* 五个 channel 全部按真实派生名注册', () => {
    for (const name of [TERM.create, TERM.write, TERM.resize, TERM.kill, TERM.runCommand]) {
      expect(probe.handlers[name], name).toBeTruthy()
    }
  })

  it('cli:sendMessage 原样回显', async () => {
    await expect(H('cli:sendMessage')(ev(), 'hello')).resolves.toEqual({ success: true, message: 'hello' })
  })

  it('cli:getAppState 返回空会话骨架', async () => {
    await expect(H('cli:getAppState')(ev())).resolves.toEqual({ sessions: [], currentSessionId: null, theme: 'dark' })
  })
})

describe('window 控制', () => {
  it('minimize/close 委托给主窗口；无窗口时不抛', () => {
    const win = { minimize: vi.fn(), close: vi.fn() }
    probe.mainWindow = win
    H('window:minimize')(ev())
    H('window:close')(ev())
    expect(win.minimize).toHaveBeenCalled()
    expect(win.close).toHaveBeenCalled()

    probe.mainWindow = null
    expect(() => H('window:minimize')(ev())).not.toThrow()
    expect(() => H('window:close')(ev())).not.toThrow()
  })

  it('toggleMaximize：已最大化 → unmaximize，未最大化 → maximize', () => {
    const win = { isMaximized: vi.fn(() => true), unmaximize: vi.fn(), maximize: vi.fn() }
    probe.mainWindow = win
    H('window:toggleMaximize')(ev())
    expect(win.unmaximize).toHaveBeenCalled()
    expect(win.maximize).not.toHaveBeenCalled()

    win.isMaximized.mockReturnValue(false)
    H('window:toggleMaximize')(ev())
    expect(win.maximize).toHaveBeenCalled()
  })

  it('isMaximized：无窗口回 false，有窗口回实际值', async () => {
    probe.mainWindow = { isMaximized: () => true }
    expect(await H('window:isMaximized')(ev())).toBe(true)
    probe.mainWindow = null
    expect(await H('window:isMaximized')(ev())).toBe(false)
  })
})

describe('fs 读路径：失败回"空"而不是抛', () => {
  it('fs:readDir 映射目录项；读失败回 []', async () => {
    fakeTree({ '/proj': [file('a.ts'), dir('sub')] })
    await expect(H('fs:readDir')(ev(), '/proj')).resolves.toEqual([
      { name: 'a.ts', path: join('/proj', 'a.ts'), isDirectory: false, isFile: true },
      { name: 'sub', path: join('/proj', 'sub'), isDirectory: true, isFile: false },
    ])

    probe.fs.readdirSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    await expect(H('fs:readDir')(ev(), '/nope')).resolves.toEqual([])
  })

  it('fs:readFile / fs:readFileAsBase64：失败回 null', async () => {
    await expect(H('fs:readFile')(ev(), '/a.txt')).resolves.toBe('file-content')
    probe.fs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    await expect(H('fs:readFile')(ev(), '/a.txt')).resolves.toBeNull()
    await expect(H('fs:readFileAsBase64')(ev(), '/a.txt')).resolves.toBeNull()
  })

  it('fs:readFileAsBase64 走 Buffer.toString(base64)', async () => {
    probe.fs.readFileSync.mockImplementation(() => Buffer.from('hello'))
    await expect(H('fs:readFileAsBase64')(ev(), '/bin.dat')).resolves.toBe(Buffer.from('hello').toString('base64'))
  })

  it('fs:writeFile：成功/失败两个出口', async () => {
    await expect(H('fs:writeFile')(ev(), '/a.txt', 'x')).resolves.toEqual({ success: true })
    probe.fs.writeFileSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    await expect(H('fs:writeFile')(ev(), '/a.txt', 'x')).resolves.toEqual({ success: false, error: 'EACCES' })
  })

  it('fs:stat 摘要 size/isDirectory/isFile/mtime；失败回 null', async () => {
    const stat = { size: 42, isDirectory: () => true, isFile: () => false, mtime: new Date(1234) }
    probe.fs.statSync.mockImplementation(() => stat)
    await expect(H('fs:stat')(ev(), '/a')).resolves.toEqual({
      size: 42, isDirectory: true, isFile: false, mtime: 1234,
    })
    probe.fs.statSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    await expect(H('fs:stat')(ev(), '/a')).resolves.toBeNull()
  })
})

describe('fs:searchFiles', () => {
  it('空 query：顶层列表，跳过隐藏目录与 ignoreDirs，目录优先', async () => {
    fakeTree({
      '/proj': [dir('zeta'), file('mango.txt'), dir('alpha'), file('banana.md'), dir('.hidden'), dir('node_modules')],
    })
    const results = await H('fs:searchFiles')(ev(), '/proj', '')
    expect(results.map((r: any) => r.name)).toEqual(['alpha', 'zeta', 'banana.md', 'mango.txt'])
    expect(results[0]).toMatchObject({ relativePath: 'alpha', isDirectory: true })
  })

  it('空 query：.claude 目录不被当隐藏目录跳过', async () => {
    fakeTree({ '/proj': [dir('.claude')] })
    const results = await H('fs:searchFiles')(ev(), '/proj', '')
    expect(results.map((r: any) => r.name)).toEqual(['.claude'])
  })

  it('空 query：maxResults 截断', async () => {
    fakeTree({
      '/proj': [dir('alpha'), dir('zeta'), file('banana.md'), file('mango.txt')],
    })
    const results = await H('fs:searchFiles')(ev(), '/proj', '', { maxResults: 2 })
    expect(results.map((r: any) => r.name)).toEqual(['alpha', 'zeta'])
  })

  it('带 query：递归匹配文件名（大小写不敏感）与相对路径', async () => {
    fakeTree({
      '/proj': [dir('src'), file('readme.md')],
      [join('/proj', 'src')]: [file('App.tsx')],
    })
    const results = await H('fs:searchFiles')(ev(), '/proj', 'app')
    expect(results.map((r: any) => r.relativePath)).toEqual(['src/App.tsx'])
    // 相对路径也能命中（name 不含 src/app）
    const byPath = await H('fs:searchFiles')(ev(), '/proj', 'src/app')
    expect(byPath.map((r: any) => r.relativePath)).toContain('src/App.tsx')
  })

  it('带 query：排序为 前缀名 > 包含名（目录优先仅在同级 tier 内）', async () => {
    fakeTree({
      '/proj': [file('apple.txt'), dir('lib')],
      [join('/proj', 'lib')]: [file('pineapple.md')],
    })
    const results = await H('fs:searchFiles')(ev(), '/proj', 'apple')
    expect(results.map((r: any) => r.name)).toEqual(['apple.txt', 'pineapple.md'])
  })

  it('带 query：深度超过 8 层不再下探', async () => {
    const tree: Record<string, FakeDirent[]> = {}
    let p = '/proj'
    for (let i = 1; i <= 9; i++) {
      const next = join(p, `d${i}`)
      tree[p] = [dir(`d${i}`)]
      p = next
    }
    tree[join('/proj', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9')] = [file('deepmatch.txt')]
    const results = await H('fs:searchFiles')(ev(), '/proj', 'deepmatch')
    expect(results).toEqual([])
  })

  it('带 query：maxResults 提前剪枝；隐藏目录内容不进结果', async () => {
    fakeTree({
      '/proj': [file('match1.txt'), file('match2.txt'), file('match3.txt'), dir('.claude')],
      [join('/proj', '.claude')]: [file('match-hidden.txt')],
    })
    const results = await H('fs:searchFiles')(ev(), '/proj', 'match', { maxResults: 2 })
    expect(results).toHaveLength(2)
    expect(results.map((r: any) => r.name)).not.toContain('match-hidden.txt')

    const full = await H('fs:searchFiles')(ev(), '/proj', 'match')
    expect(full.map((r: any) => r.name)).toEqual(['match1.txt', 'match2.txt', 'match3.txt'])
  })

  it('根目录读失败回 []', async () => {
    probe.fs.readdirSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    await expect(H('fs:searchFiles')(ev(), '/nope', 'x')).resolves.toEqual([])
  })
})

describe('env / ui relay / shell / editor', () => {
  it('env:get 透传 process.env', async () => {
    process.env.IPC_TEST_VAR_XYZ = 'val-xyz'
    try {
      await expect(H('env:get')(ev(), 'IPC_TEST_VAR_XYZ')).resolves.toBe('val-xyz')
      await expect(H('env:get')(ev(), 'NOPE_NOT_SET')).resolves.toBeUndefined()
    } finally {
      delete process.env.IPC_TEST_VAR_XYZ
    }
  })

  it('ui:* 转发给主窗口 webContents.send', () => {
    const send = vi.fn()
    probe.mainWindow = { webContents: { send } }
    H('ui:showDiff')(ev(), { path: 'a.ts' })
    H('ui:showInfoPanel')(ev(), 'diff')
    H('ui:hideInfoPanel')(ev())
    expect(send).toHaveBeenNthCalledWith(1, 'ui:showDiff', { path: 'a.ts' })
    expect(send).toHaveBeenNthCalledWith(2, 'ui:showInfoPanel', 'diff')
    expect(send).toHaveBeenNthCalledWith(3, 'ui:hideInfoPanel')
  })

  it('shell:openExternal / openPath 透传参数', async () => {
    await H('shell:openExternal')(ev(), 'https://x.dev')
    await H('shell:openPath')(ev(), '/folder')
    expect(probe.electron.shellOpenExternal).toHaveBeenCalledWith('https://x.dev')
    expect(probe.electron.shellOpenPath).toHaveBeenCalledWith('/folder')
  })

  it('app:openInEditor：未知编辑器拒绝；已知编辑器透传结果', async () => {
    await expect(H('app:openInEditor')(ev(), 'notepad' as any, '/a.ts'))
      .resolves.toEqual({ success: false, error: 'Unsupported editor' })
    await expect(H('app:openInEditor')(ev(), 'vscode' as any, '/a.ts'))
      .resolves.toEqual({ success: true })
    expect(probe.openPathInEditor).toHaveBeenCalledWith('vscode', '/a.ts')
  })
})

describe('fs 写操作', () => {
  it('fs:copy 文件走 copyFileSync，目录走递归复制', async () => {
    probe.fs.statSync.mockImplementation(() => ({ isDirectory: () => false }))
    await H('fs:copy')(ev(), '/src/a.ts', '/dst/a.ts')
    expect(probe.fs.copyFileSync).toHaveBeenCalledWith('/src/a.ts', '/dst/a.ts')

    probe.fs.statSync.mockImplementation(() => ({ isDirectory: () => true }))
    fakeTree({
      '/src': [file('a.ts'), dir('sub')],
      [join('/src', 'sub')]: [file('b.ts')],
    })
    await H('fs:copy')(ev(), '/src', '/dst')
    expect(probe.fs.mkdirSync).toHaveBeenCalledWith('/dst', { recursive: true })
    expect(probe.fs.copyFileSync).toHaveBeenCalledWith(join('/src', 'a.ts'), join('/dst', 'a.ts'))
    expect(probe.fs.copyFileSync).toHaveBeenCalledWith(join('/src', 'sub', 'b.ts'), join('/dst', 'sub', 'b.ts'))
  })

  it('fs:copy 失败回 { success:false, error }', async () => {
    probe.fs.statSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    await expect(H('fs:copy')(ev(), '/src', '/dst')).resolves.toEqual({ success: false, error: 'EACCES' })
  })

  it('fs:move 与 fs:rename（rename 回 newPath）', async () => {
    await expect(H('fs:move')(ev(), '/a', '/b')).resolves.toEqual({ success: true })
    expect(probe.fs.renameSync).toHaveBeenCalledWith('/a', '/b')
    await expect(H('fs:rename')(ev(), '/dir/a.txt', 'b.txt')).resolves.toEqual({ success: true, newPath: join('/dir', 'b.txt') })

    probe.fs.renameSync.mockImplementation(() => {
      throw new Error('EBUSY')
    })
    await expect(H('fs:move')(ev(), '/a', '/b')).resolves.toEqual({ success: false, error: 'EBUSY' })
    await expect(H('fs:rename')(ev(), '/dir/a.txt', 'b.txt')).resolves.toEqual({ success: false, error: 'EBUSY' })
  })

  it('fs:delete：permanent 走 rmSync(recursive,force)，否则走回收站', async () => {
    await H('fs:delete')(ev(), '/a', true)
    expect(probe.fs.rmSync).toHaveBeenCalledWith('/a', { recursive: true, force: true })
    expect(probe.electron.shellTrashItem).not.toHaveBeenCalled()

    await H('fs:delete')(ev(), '/a', false)
    expect(probe.electron.shellTrashItem).toHaveBeenCalledWith('/a')

    probe.electron.shellTrashItem.mockRejectedValueOnce(new Error('trash full'))
    await expect(H('fs:delete')(ev(), '/a', false)).resolves.toEqual({ success: false, error: 'trash full' })
  })
})

describe('http:fetch', () => {
  it('默认 GET，透传 method/headers/body，返回 { ok, status, data }', async () => {
    await expect(H('http:fetch')(ev(), 'https://x.dev', { method: 'POST', headers: { a: 'b' }, body: 'hi' }))
      .resolves.toEqual({ ok: true, status: 200, data: 'body' })
    expect(probe.electron.netFetch).toHaveBeenCalledWith('https://x.dev', expect.objectContaining({
      method: 'POST', headers: { a: 'b' }, body: 'hi',
    }))
  })

  it('AbortError 归一为 "Request timed out (Ns)"', async () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    probe.electron.netFetch.mockRejectedValueOnce(abortErr)
    await expect(H('http:fetch')(ev(), 'https://x.dev', { timeoutMs: 5000 }))
      .resolves.toEqual({ ok: false, status: 0, error: 'Request timed out (5s)' })
  })

  it('其他错误回 error message', async () => {
    probe.electron.netFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(H('http:fetch')(ev(), 'https://x.dev'))
      .resolves.toEqual({ ok: false, status: 0, error: 'ECONNREFUSED' })
  })
})

describe('workspace', () => {
  it('ensureDefaultWork：documents 优先，失败回退 home，mkdir 失败仍返回目录', async () => {
    await expect(H('workspace:ensureDefaultWork')(ev())).resolves.toBe(join('/documents-dir', 'SpaceCode'))
    expect(probe.fs.mkdirSync).toHaveBeenCalledWith(join('/documents-dir', 'SpaceCode'), { recursive: true })

    probe.electron.appGetPath.mockImplementation((name: string) => {
      if (name === 'documents') throw new Error('no documents')
      return '/home-dir'
    })
    await expect(H('workspace:ensureDefaultWork')(ev())).resolves.toBe(join('/home-dir', 'SpaceCode'))

    probe.fs.mkdirSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    await expect(H('workspace:ensureDefaultWork')(ev())).resolves.toBe(join('/home-dir', 'SpaceCode'))
  })

  it('ensureDir：非字符串/空串拒绝；成功 true；失败 false', async () => {
    await expect(H('workspace:ensureDir')(ev(), '/a/b')).resolves.toBe(true)
    await expect(H('workspace:ensureDir')(ev(), '')).resolves.toBe(false)
    await expect(H('workspace:ensureDir')(ev(), null)).resolves.toBe(false)
    probe.fs.mkdirSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    await expect(H('workspace:ensureDir')(ev(), '/a/b')).resolves.toBe(false)
  })
})

describe('dialogs', () => {
  it('无主窗口回 canceled；有窗口时透传 dialog 结果与 properties', async () => {
    await expect(H('dialog:selectFolder')(ev())).resolves.toEqual({ canceled: true, filePaths: [] })
    expect(probe.electron.showOpenDialog).not.toHaveBeenCalled()

    probe.mainWindow = {}
    await expect(H('dialog:selectFolder')(ev())).resolves.toEqual({ canceled: false, filePaths: ['/picked'] })
    expect(probe.electron.showOpenDialog).toHaveBeenCalledWith(probe.mainWindow, expect.objectContaining({
      properties: ['openDirectory'],
    }))
    await expect(H('dialog:selectFiles')(ev())).resolves.toEqual({ canceled: false, filePaths: ['/picked'] })
    expect(probe.electron.showOpenDialog).toHaveBeenLastCalledWith(probe.mainWindow, expect.objectContaining({
      properties: ['openFile', 'multiSelections'],
    }))
  })
})

describe('terminal', () => {
  it('create 成功回 { id, shell }，失败回 { id: null, error }', async () => {
    await expect(H(TERM.create)(ev(), { cwd: '/w', env: { A: '1' } })).resolves.toEqual({ id: 'term-1', shell: 'bash' })
    expect(probe.terminalManager.create).toHaveBeenCalledWith('/w', undefined, { A: '1' })

    probe.terminalManager.create.mockImplementationOnce(() => {
      throw new Error('pty gone')
    })
    await expect(H(TERM.create)(ev(), {})).resolves.toEqual({ id: null, error: 'Error: pty gone' })
  })

  it('create 未传 cwd 时回退 process.cwd()', async () => {
    await H(TERM.create)(ev(), {})
    expect(probe.terminalManager.create).toHaveBeenCalledWith(process.cwd(), undefined, undefined)
  })

  it('write/resize/kill 原样转发；runCommand 附加回车', () => {
    H(TERM.write)(ev(), 'term-1', 'ls')
    expect(probe.terminalManager.write).toHaveBeenCalledWith('term-1', 'ls')
    H(TERM.resize)(ev(), 'term-1', 120, 40)
    expect(probe.terminalManager.resize).toHaveBeenCalledWith('term-1', 120, 40)
    H(TERM.kill)(ev(), 'term-1')
    expect(probe.terminalManager.kill).toHaveBeenCalledWith('term-1')
    H(TERM.runCommand)(ev(), 'term-1', 'npm test')
    expect(probe.terminalManager.write).toHaveBeenLastCalledWith('term-1', 'npm test\r')
  })
})

describe('app:getClaudeCliPath 优先级阶梯', () => {
  const cliRoot = resolve(__dirname, '..', '..', 'engine')

  it('dist-desktop/cli.js 存在且 bun 可用 → bun "dist-desktop/cli.js"', async () => {
    probe.fs.existsSync.mockImplementation((p: string) => p === resolve(cliRoot, join('dist-desktop', 'cli.js')))
    probe.execSync.mockImplementation(() => '')
    await expect(H('app:getClaudeCliPath')(ev())).resolves.toBe(
      `bun "${resolve(cliRoot, join('dist-desktop', 'cli.js'))}"`,
    )
  })

  it('bun 不可用但打包了 bun 可执行文件 → 用 bundled bun 拉起', async () => {
    const bunExe = resolve(cliRoot, 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun')
    probe.fs.existsSync.mockImplementation((p: string) => p === bunExe || p === resolve(cliRoot, join('dist-desktop', 'cli.js')))
    await expect(H('app:getClaudeCliPath')(ev())).resolves.toBe(
      `"${bunExe}" "${resolve(cliRoot, join('dist-desktop', 'cli.js'))}"`,
    )
  })

  it('desktop bundle 缺失 → 回退 dist/cli.js', async () => {
    probe.fs.existsSync.mockImplementation((p: string) => p === resolve(cliRoot, join('dist', 'cli.js')))
    probe.execSync.mockImplementation((cmd: string) => {
      if (cmd === 'bun --version') return ''
      throw new Error('not found')
    })
    await expect(H('app:getClaudeCliPath')(ev())).resolves.toBe(
      `bun "${resolve(cliRoot, join('dist', 'cli.js'))}"`,
    )
  })

  it('只有源码 → bun "scripts/dev.ts"', async () => {
    probe.fs.existsSync.mockImplementation((p: string) => p === resolve(cliRoot, join('src', 'entrypoints', 'cli.tsx')))
    probe.execSync.mockImplementation(() => '')
    await expect(H('app:getClaudeCliPath')(ev())).resolves.toBe(
      `bun "${resolve(cliRoot, join('scripts', 'dev.ts'))}"`,
    )
  })

  it('全都没有但全局装了 ccb → "ccb"', async () => {
    probe.execSync.mockImplementation((cmd: string) => {
      if (cmd === 'bun --version') throw new Error('no bun')
      return ''
    })
    await expect(H('app:getClaudeCliPath')(ev())).resolves.toBe('ccb')
  })

  it('一切皆无 → null', async () => {
    await expect(H('app:getClaudeCliPath')(ev())).resolves.toBeNull()
  })
})

describe('app:getPiCliPath 优先级阶梯', () => {
  it('全局 pi 可用 → "pi"（命中路径须在盘上，再探针核验版本）', async () => {
    const piPath = process.platform === 'win32' ? 'C:\\tools\\pi.cmd' : '/usr/local/bin/pi'
    probe.execSync.mockImplementation((cmd: string) => {
      if (cmd === (process.platform === 'win32' ? 'where pi' : 'which pi')) return piPath
      throw new Error('not found')
    })
    probe.execFileSync.mockImplementation(() => '1.3.0\n')
    probe.fs.existsSync.mockImplementation((p: string) => p === piPath)
    await expect(H('app:getPiCliPath')(ev())).resolves.toBe('pi')
  })

  it('一切皆无 → null（#52：不再退回 bunx/npx 拉第三份版本）', async () => {
    probe.execSync.mockImplementation(() => {
      throw new Error('not found')
    })
    await expect(H('app:getPiCliPath')(ev())).resolves.toBeNull()
  })
})

describe('渲染进程日志桥', () => {
  it('log:* 加 RENDERER: 前缀转给 logger', () => {
    H('log:debug')(ev(), 'Scope', 'msg', { a: 1 })
    H('log:info')(ev(), 'Scope', 'msg')
    H('log:warn')(ev(), 'Scope', 'msg')
    H('log:error')(ev(), 'Scope', 'msg')
    expect(probe.logger.debug).toHaveBeenCalledWith('RENDERER:Scope', 'msg', { a: 1 })
    expect(probe.logger.info).toHaveBeenCalledWith('RENDERER:Scope', 'msg', undefined)
    expect(probe.logger.warn).toHaveBeenCalledWith('RENDERER:Scope', 'msg', undefined)
    expect(probe.logger.error).toHaveBeenCalledWith('RENDERER:Scope', 'msg', undefined)
  })

  it('trace:event 缺 source 时补 "renderer"，已有 source 保留', () => {
    H('trace:event')(ev(), { type: 'click' })
    expect(probe.logger.traceEvent).toHaveBeenLastCalledWith({ type: 'click', source: 'renderer' })
    H('trace:event')(ev(), { type: 'click', source: 'mobile' })
    expect(probe.logger.traceEvent).toHaveBeenLastCalledWith({ type: 'click', source: 'mobile' })
  })

  it('debug:readFile / debug:listTraceSessions / debug:readTraceEvents 透传参数', async () => {
    await expect(H('debug:listFiles')(ev())).resolves.toEqual(['debug-1.log'])
    await expect(H('debug:readFile')(ev(), '/log', 1024)).resolves.toBe('debug body')
    expect(probe.logger.readDebugFile).toHaveBeenCalledWith('/log', 1024)
    await expect(H('debug:listTraceSessions')(ev())).resolves.toEqual(['trace-1'])
    await expect(H('debug:readTraceEvents')(ev(), 'trace-1', 50)).resolves.toEqual([{ type: 'x' }])
    expect(probe.logger.readTraceEvents).toHaveBeenCalledWith('trace-1', 50)
  })
})

describe('image 持久化：id 白名单', () => {
  const imagesDir = join('/user-data-dir', 'chat-images')

  it('save：合法 id 写入 userData/chat-images/<id>.txt；非法 id 拒绝', async () => {
    probe.fs.existsSync.mockImplementation(() => true)
    await expect(H('image:save')(ev(), 'abc-123', 'data:image/png;base64,x'))
      .resolves.toEqual({ success: true })
    expect(probe.fs.writeFileSync).toHaveBeenCalledWith(join(imagesDir, 'abc-123.txt'), 'data:image/png;base64,x', 'utf-8')

    for (const bad of ['', 'bad id!', 'a/b', null, undefined]) {
      await expect(H('image:save')(ev(), bad as any, 'x')).resolves.toEqual({ success: false, error: 'Invalid image id' })
    }
    expect(probe.fs.writeFileSync).toHaveBeenCalledTimes(1)
  })

  it('save：目录不存在时先建；写失败回 error', async () => {
    await H('image:save')(ev(), 'abc-123', 'x')
    expect(probe.fs.mkdirSync).toHaveBeenCalledWith(imagesDir, { recursive: true })

    probe.fs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full')
    })
    await expect(H('image:save')(ev(), 'abc-123', 'x')).resolves.toEqual({ success: false, error: 'disk full' })
  })

  it('load：非法 id / 文件缺失 → null；存在 → 内容', async () => {
    await expect(H('image:load')(ev(), 'bad id!')).resolves.toBeNull()
    probe.fs.existsSync.mockImplementation(() => false)
    await expect(H('image:load')(ev(), 'abc-123')).resolves.toBeNull()

    probe.fs.existsSync.mockImplementation((p: string) => p === join(imagesDir, 'abc-123.txt'))
    await expect(H('image:load')(ev(), 'abc-123')).resolves.toBe('file-content')

    probe.fs.readFileSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    await expect(H('image:load')(ev(), 'abc-123')).resolves.toBeNull()
  })
})

describe('turn checkpoints 与 rewind', () => {
  it('getTurnCheckpoints：projectPath 透传给 listSessionTurnCheckpoints', async () => {
    const sender = { getURL: () => 'http://localhost:5173/' }
    await expect(H('session:getTurnCheckpoints')(ev(sender), 's1', '/proj'))
      .resolves.toEqual({ ok: true, checkpoints: [{ id: 'cp-1' }], error: null })
    expect(probe.checkpoints.listSessionTurnCheckpoints).toHaveBeenCalledWith('s1', '/proj')
  })

  it('getTurnCheckpoints：无 projectPath 时经 executeJavaScript 兜底后仍以 "" 调用', async () => {
    const sender = { executeJavaScript: vi.fn(async () => '/from-store') }
    await H('session:getTurnCheckpoints')(ev(sender), 's1')
    expect(sender.executeJavaScript).toHaveBeenCalled()
    expect(probe.checkpoints.listSessionTurnCheckpoints).toHaveBeenCalledWith('s1', '')
  })

  it('getTurnCheckpoints：URL 与 projectPath 都拿不到 → 明确报错', async () => {
    const sender = { executeJavaScript: vi.fn(async () => '') }
    await expect(H('session:getTurnCheckpoints')(ev(sender), 's1'))
      .resolves.toEqual({ ok: false, checkpoints: [], error: 'Project path not available' })
  })

  it('getTurnCheckpoints：服务抛错归一为 { ok:false, error }', async () => {
    probe.checkpoints.listSessionTurnCheckpoints.mockRejectedValueOnce(new Error('boom'))
    await expect(H('session:getTurnCheckpoints')(ev({ getURL: () => 'http://x/' }), 's1', '/proj'))
      .resolves.toEqual({ ok: false, checkpoints: [], error: 'boom' })
  })

  it('getTurnRewindPreviewFiles / getTurnCheckpointDiff / getSessionFileDiff 透传参数', async () => {
    await H('session:getTurnRewindPreviewFiles')(ev(), 's1', 'msg-1', 2, '/proj')
    expect(probe.checkpoints.getTurnRewindPreviewFiles).toHaveBeenCalledWith('s1', '/proj', 'msg-1', 2)

    await H('session:getTurnCheckpointDiff')(ev(), 's1', 'msg-1', 'a.ts', 3, '/proj')
    expect(probe.checkpoints.getTurnCheckpointDiff).toHaveBeenCalledWith('s1', '/proj', 'msg-1', 'a.ts', 3)

    await H('session:getSessionFileDiff')(ev(), 's1', 'a.ts', '/proj')
    expect(probe.checkpoints.getSessionFileDiff).toHaveBeenCalledWith('s1', '/proj', 'a.ts')
  })

  it('rewindTurn 透传 options 并归一错误', async () => {
    await H('session:rewindTurn')(ev(), 's1', { targetUserMessageId: 'msg-1', userMessageIndex: 1 }, '/proj')
    expect(probe.checkpoints.rewindTurn).toHaveBeenCalledWith('s1', '/proj', 'msg-1', 1)

    probe.checkpoints.rewindTurn.mockRejectedValueOnce(new Error('rewind boom'))
    await expect(H('session:rewindTurn')(ev(), 's1', { targetUserMessageId: 'msg-1' }))
      .resolves.toEqual({ ok: false, error: 'rewind boom' })
  })

  it('rewind 系列 handler 的错误归一（files/diff）', async () => {
    probe.checkpoints.getTurnRewindPreviewFiles.mockRejectedValueOnce(new Error('nope'))
    await expect(H('session:getTurnRewindPreviewFiles')(ev(), 's1', 'm', 0, '/p'))
      .resolves.toEqual({ ok: false, files: [], error: 'nope' })

    probe.checkpoints.getTurnCheckpointDiff.mockRejectedValueOnce(new Error('nope'))
    await expect(H('session:getTurnCheckpointDiff')(ev(), 's1', 'm', 'a.ts', 0, '/p'))
      .resolves.toEqual({ state: 'error', path: 'a.ts', error: 'nope', diff: undefined })

    probe.checkpoints.getSessionFileDiff.mockRejectedValueOnce(new Error('nope'))
    await expect(H('session:getSessionFileDiff')(ev(), 's1', 'a.ts', '/p'))
      .resolves.toEqual({ state: 'error', path: 'a.ts', error: 'nope' })
  })
})

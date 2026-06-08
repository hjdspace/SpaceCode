/**
 * Tests for the centralized electronAPI service wrapper.
 * Run with:
 *   node --experimental-strip-types --test tests/services/electronAPI.test.ts
 *
 * The test recreates the same wrapper pattern used in src/services/electronAPI.ts
 * so we can test both the forwarding behavior and the safe fallback behavior
 * without depending on window.electronAPI.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// Helper: build the api wrapper using the exact same pattern as electronAPI.ts
// but with an injectable electronAPI reference instead of reading from window.
// ---------------------------------------------------------------------------

function createApi(electronAPI: any) {
  return {
    sendMessage: (text: string) => electronAPI?.sendMessage(text) || Promise.resolve({ success: false }),
    onMessage: (callback: (msg: any) => void) => electronAPI?.onMessage(callback),
    getAppState: () => electronAPI?.getAppState() || Promise.resolve({ sessions: [], currentSessionId: null, theme: 'dark' }),
    readDir: (dirPath: string) => electronAPI?.readDir(dirPath) || Promise.resolve([]),
    readFile: (filePath: string) => electronAPI?.readFile(filePath) || Promise.resolve(null),
    writeFile: (filePath: string, content: string) =>
      electronAPI?.writeFile(filePath, content) || Promise.resolve({ success: false, error: 'writeFile not available' }),
    stat: (filePath: string) => electronAPI?.stat(filePath) || Promise.resolve(null),
    searchFiles: (dirPath: string, query: string, options?: { maxResults?: number }) => {
      if (electronAPI?.searchFiles) {
        return electronAPI.searchFiles(dirPath, query, options)
      }
      return Promise.resolve([])
    },
    copyFile: (srcPath: string, destPath: string) =>
      electronAPI?.copyFile(srcPath, destPath) || Promise.resolve({ success: false, error: 'copyFile not available' }),
    moveFile: (srcPath: string, destPath: string) =>
      electronAPI?.moveFile(srcPath, destPath) || Promise.resolve({ success: false, error: 'moveFile not available' }),
    renameFile: (filePath: string, newName: string) =>
      electronAPI?.renameFile(filePath, newName) || Promise.resolve({ success: false, error: 'renameFile not available' }),
    deleteFile: (filePath: string, permanent?: boolean) =>
      electronAPI?.deleteFile(filePath, permanent) || Promise.resolve({ success: false, error: 'deleteFile not available' }),
    getEnv: (key: string) => {
      if (electronAPI?.getEnv) {
        return electronAPI.getEnv(key)
      }
      return Promise.resolve(undefined)
    },
    showDiff: (diff: any) => electronAPI?.showDiff(diff),
    onDiffRequested: (callback: (diff: any) => void) => electronAPI?.onDiffRequested(callback),
    showInfoPanel: (mode: string) => electronAPI?.showInfoPanel(mode),
    hideInfoPanel: () => electronAPI?.hideInfoPanel(),
    onShowInfoPanel: (callback: (mode: string) => void) => electronAPI?.onShowInfoPanel(callback),
    onHideInfoPanel: (callback: () => void) => electronAPI?.onHideInfoPanel(callback),
    onToolResult: (callback: (result: any) => void) => electronAPI?.onToolResult(callback),
    onMenuNewChat: (callback: () => void) => {
      if (electronAPI?.onMenuNewChat) {
        electronAPI.onMenuNewChat(callback)
      }
    },
    onMenuOpenFolder: (callback: (path: string) => void) => {
      if (electronAPI?.onMenuOpenFolder) {
        electronAPI.onMenuOpenFolder(callback)
      }
    },
    onMenuCloseFolder: (callback: () => void) => {
      if (electronAPI?.onMenuCloseFolder) {
        electronAPI.onMenuCloseFolder(callback)
      }
    },
    openExternal: (url: string) => electronAPI?.openExternal(url) || Promise.resolve(),
    openInEditor: (editor: string, targetPath: string) => {
      if (electronAPI?.openInEditor) {
        return electronAPI.openInEditor(editor, targetPath)
      }
      return Promise.resolve({ success: false, error: 'openInEditor not available' })
    },
    httpFetch: (url: string, options?: any) => {
      if (electronAPI?.httpFetch) {
        return electronAPI.httpFetch(url, options)
      }
      return Promise.resolve(null)
    },
    getClaudeCliPath: () => {
      if (electronAPI?.getClaudeCliPath) {
        return electronAPI.getClaudeCliPath()
      }
      return Promise.resolve(null)
    },
    getPiCliPath: () => {
      if (electronAPI?.getPiCliPath) {
        return electronAPI.getPiCliPath()
      }
      return Promise.resolve(null)
    },
    injectGuiModelsToSettings: (models: any) => {
      if (electronAPI?.injectGuiModelsToSettings) {
        return electronAPI.injectGuiModelsToSettings(models)
      }
      return Promise.resolve({ success: false, error: 'injectGuiModelsToSettings not available' })
    },
    saveGuiSettings: (data: string) => {
      if (electronAPI?.saveGuiSettings) {
        return electronAPI.saveGuiSettings(data)
      }
      return Promise.resolve({ success: false, error: 'saveGuiSettings not available' })
    },
    loadGuiSettings: () => {
      if (electronAPI?.loadGuiSettings) {
        return electronAPI.loadGuiSettings()
      }
      return Promise.resolve({ success: false, data: null, error: 'loadGuiSettings not available' })
    },
    loadHooksSettings: (scope?: string) => {
      if (electronAPI?.loadHooksSettings) {
        return electronAPI.loadHooksSettings(scope)
      }
      return Promise.resolve({ success: false, data: null, error: 'loadHooksSettings not available' })
    },
    saveHooksSettings: (hooksJson: string, scope?: string) => {
      if (electronAPI?.saveHooksSettings) {
        return electronAPI.saveHooksSettings(hooksJson, scope)
      }
      return Promise.resolve({ success: false, error: 'saveHooksSettings not available' })
    },
    getTokenUsageStats: () => {
      if (electronAPI?.getTokenUsageStats) {
        return electronAPI.getTokenUsageStats()
      }
      return Promise.resolve({ success: false, error: 'getTokenUsageStats not available' })
    },
    selectFolder: () => {
      if (electronAPI?.selectFolder) {
        return electronAPI.selectFolder()
      }
      return Promise.resolve({ canceled: true, filePaths: [] })
    },
    selectFiles: () => {
      if (electronAPI?.selectFiles) {
        return electronAPI.selectFiles()
      }
      return Promise.resolve({ canceled: true, filePaths: [] })
    },
    optimizePrompt: (prompt: string, options?: any) => {
      if (electronAPI?.optimizePrompt) {
        return electronAPI.optimizePrompt(prompt, options)
      }
      return Promise.resolve({ success: false, error: 'Prompt optimizer not available' })
    },
    updateThinkingLevel: (sessionId: string, enabled: boolean) => {
      if (electronAPI?.claudeCode?.updateThinkingLevel) {
        return electronAPI.claudeCode.updateThinkingLevel(sessionId, enabled)
      }
      return Promise.resolve()
    },
    getContextUsage: (sessionId: string) => {
      if (electronAPI?.claudeCode?.getContextUsage) {
        return electronAPI.claudeCode.getContextUsage(sessionId)
      }
      return Promise.resolve(undefined)
    },
    detectInstalledCli: () => {
      if (electronAPI?.claudeCode?.detectInstalledCli) {
        return electronAPI.claudeCode.detectInstalledCli()
      }
      return Promise.resolve(null)
    },
    checkEnvironment: () => {
      if (electronAPI?.claudeCode?.checkEnvironment) {
        return electronAPI.claudeCode.checkEnvironment()
      }
      return Promise.resolve(null)
    },
    installCli: () => {
      if (electronAPI?.claudeCode?.installCli) {
        return electronAPI.claudeCode.installCli()
      }
      return Promise.resolve(null)
    },
    onInstallProgress: (callback: (progress: any) => void) => {
      if (electronAPI?.claudeCode?.onInstallProgress) {
        return electronAPI.claudeCode.onInstallProgress(callback)
      }
      return () => {}
    },
    getProxyStatus: () => {
      if (electronAPI?.claudeCode?.getProxyStatus) {
        return electronAPI.claudeCode.getProxyStatus()
      }
      return Promise.resolve(null)
    },
    isProxyRunning: () => {
      if (electronAPI?.claudeCode?.isProxyRunning) {
        return electronAPI.claudeCode.isProxyRunning()
      }
      return Promise.resolve(false)
    },
    notifyEngineSourceChanged: (source: string) => {
      if (electronAPI?.claudeCode?.notifyEngineSourceChanged) {
        return electronAPI.claudeCode.notifyEngineSourceChanged(source)
      }
      return Promise.resolve()
    },

    git: {
      isRepo: (cwd: string) => electronAPI?.git?.isRepo(cwd) || Promise.resolve(false),
      getRoot: (cwd: string) => electronAPI?.git?.getRoot(cwd) || Promise.resolve(null),
      getStatus: (cwd: string) => electronAPI?.git?.getStatus(cwd) || Promise.resolve(null),
      stage: (cwd: string, paths: string[]) => electronAPI?.git?.stage(cwd, paths) || Promise.resolve(false),
      unstage: (cwd: string, paths: string[]) => electronAPI?.git?.unstage(cwd, paths) || Promise.resolve(false),
      stageAll: (cwd: string) => electronAPI?.git?.stageAll(cwd) || Promise.resolve(false),
      unstageAll: (cwd: string) => electronAPI?.git?.unstageAll(cwd) || Promise.resolve(false),
      commit: (cwd: string, message: string, amend?: boolean) =>
        electronAPI?.git?.commit(cwd, message, amend) || Promise.resolve({ success: false, error: 'Git API not available' }),
      getDiff: (cwd: string, path: string, staged?: boolean) =>
        electronAPI?.git?.getDiff(cwd, path, staged) || Promise.resolve(null),
      getFullDiff: (cwd: string) => electronAPI?.git?.getFullDiff(cwd) || Promise.resolve(null),
      getStagedDiff: (cwd: string) => electronAPI?.git?.getStagedDiff(cwd) || Promise.resolve(''),
      showFile: (cwd: string, path: string) => electronAPI?.git?.showFile(cwd, path) || Promise.resolve(null),
      getBranches: (cwd: string) => electronAPI?.git?.getBranches(cwd) || Promise.resolve([]),
      checkout: (cwd: string, ref: string) =>
        electronAPI?.git?.checkout(cwd, ref) || Promise.resolve({ success: false, error: 'Git API not available' }),
      createBranch: (cwd: string, name: string, checkoutTo?: boolean) =>
        electronAPI?.git?.createBranch(cwd, name, checkoutTo) || Promise.resolve({ success: false, error: 'Git API not available' }),
      deleteBranch: (cwd: string, name: string, force?: boolean) =>
        electronAPI?.git?.deleteBranch(cwd, name, force) || Promise.resolve({ success: false, error: 'Git API not available' }),
      getLog: (cwd: string, count?: number) => electronAPI?.git?.getLog(cwd, count) || Promise.resolve([]),
      discardChanges: (cwd: string, paths: string[]) => electronAPI?.git?.discardChanges(cwd, paths) || Promise.resolve(false),
      pull: (cwd: string) => electronAPI?.git?.pull(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
      push: (cwd: string) => electronAPI?.git?.push(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
      stash: (cwd: string) => electronAPI?.git?.stash(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
      stashPop: (cwd: string) => electronAPI?.git?.stashPop(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
      fetchAll: (cwd: string) => electronAPI?.git?.fetchAll(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
    },

    agents: {
      listAgents: (cwd?: string) => {
        if (electronAPI?.claudeCode?.listAgents) {
          return electronAPI.claudeCode.listAgents(cwd)
        }
        return Promise.resolve([])
      },
    },

    debug: {
      listFiles: () => electronAPI?.debug?.listFiles() || Promise.resolve([]),
      readFile: (filePath: string, maxBytes?: number) =>
        electronAPI?.debug?.readFile(filePath, maxBytes) || Promise.resolve({ success: false, error: 'Debug API not available' }),
      listTraceSessions: () => electronAPI?.debug?.listTraceSessions() || Promise.resolve([]),
      readTraceEvents: (sessionId: string, maxEvents?: number) =>
        electronAPI?.debug?.readTraceEvents(sessionId, maxEvents) || Promise.resolve({ success: false, error: 'Debug API not available' }),
    },

    trace: {
      event: (event: any) => electronAPI?.trace?.event(event),
    },

    terminal: {
      create: (options?: any) => {
        if (electronAPI?.terminal) {
          return electronAPI.terminal.create(options)
        }
        return Promise.resolve({ id: null, error: 'Terminal API not available' })
      },
      write: (id: string, data: string) => electronAPI?.terminal?.write(id, data),
      resize: (id: string, cols: number, rows: number) => electronAPI?.terminal?.resize(id, cols, rows),
      kill: (id: string) => electronAPI?.terminal?.kill(id),
      runCommand: (id: string, command: string) => electronAPI?.terminal?.runCommand(id, command),
      onData: (callback: (id: string, data: string) => void) => {
        if (electronAPI?.terminal) {
          return electronAPI.terminal.onData(callback)
        }
        return () => {}
      },
      onExit: (callback: (id: string, exitCode: number) => void) => {
        if (electronAPI?.terminal) {
          return electronAPI.terminal.onExit(callback)
        }
        return () => {}
      },
    },

    session: {
      getTurnCheckpoints: (sessionId: string, projectPath?: string) =>
        electronAPI?.session?.getTurnCheckpoints(sessionId, projectPath) ||
        Promise.resolve({ ok: false, checkpoints: [], error: 'Session API not available' }),
      getTurnRewindPreviewFiles: (sessionId: string, targetUserMessageId: string, userMessageIndex?: number, projectPath?: string) =>
        electronAPI?.session?.getTurnRewindPreviewFiles(sessionId, targetUserMessageId, userMessageIndex, projectPath) ||
        Promise.resolve({ ok: false, files: [], error: 'Session API not available' }),
      getTurnCheckpointDiff: (sessionId: string, targetUserMessageId: string, filePath: string, userMessageIndex?: number, projectPath?: string) =>
        electronAPI?.session?.getTurnCheckpointDiff(sessionId, targetUserMessageId, filePath, userMessageIndex, projectPath) ||
        Promise.resolve({ state: 'error', path: filePath, error: 'Session API not available' }),
      rewindTurn: (sessionId: string, options: any, projectPath?: string) =>
        electronAPI?.session?.rewindTurn(sessionId, options, projectPath) ||
        Promise.resolve({ ok: false, error: 'Session API not available' }),
    },

    mobile: {
      startServer: () => {
        if (electronAPI?.mobile?.startServer) {
          return electronAPI.mobile.startServer()
        }
        return Promise.resolve({ url: '', token: '', port: 0, ip: '' })
      },
      stopServer: () => {
        if (electronAPI?.mobile?.stopServer) {
          return electronAPI.mobile.stopServer()
        }
        return Promise.resolve()
      },
      getStatus: () => {
        if (electronAPI?.mobile?.getStatus) {
          return electronAPI.mobile.getStatus()
        }
        return Promise.resolve({ running: false, connected: false })
      },
      onConnected: (cb: (clientInfo: string) => void) =>
        electronAPI?.mobile?.onConnected(cb) ?? (() => {}),
      onDisconnected: (cb: () => void) =>
        electronAPI?.mobile?.onDisconnected(cb) ?? (() => {}),
    },
  }
}

// ---------------------------------------------------------------------------
// File Operations — forwarding
// ---------------------------------------------------------------------------

describe('electronAPI - File Operations (forwarding)', () => {
  let mockApi: any
  let api: ReturnType<typeof createApi>

  beforeEach(() => {
    mockApi = {
      readFile: (filePath: string) => {
        mockApi._lastCall = { method: 'readFile', args: [filePath] }
        return Promise.resolve('file content from ' + filePath)
      },
      writeFile: (filePath: string, content: string) => {
        mockApi._lastCall = { method: 'writeFile', args: [filePath, content] }
        return Promise.resolve({ success: true })
      },
      readDir: (dirPath: string) => {
        mockApi._lastCall = { method: 'readDir', args: [dirPath] }
        return Promise.resolve([{ name: 'a.ts', path: dirPath + '/a.ts', isDirectory: false, isFile: true }])
      },
      stat: (filePath: string) => {
        mockApi._lastCall = { method: 'stat', args: [filePath] }
        return Promise.resolve({ size: 1024, isDirectory: false, isFile: true, mtime: 1234567890 })
      },
      searchFiles: (dirPath: string, query: string, options?: any) => {
        mockApi._lastCall = { method: 'searchFiles', args: [dirPath, query, options] }
        return Promise.resolve([{ name: 'match.ts', path: dirPath + '/match.ts', relativePath: 'match.ts', isDirectory: false, isFile: true }])
      },
      copyFile: (src: string, dest: string) => {
        mockApi._lastCall = { method: 'copyFile', args: [src, dest] }
        return Promise.resolve({ success: true })
      },
      moveFile: (src: string, dest: string) => {
        mockApi._lastCall = { method: 'moveFile', args: [src, dest] }
        return Promise.resolve({ success: true })
      },
      renameFile: (filePath: string, newName: string) => {
        mockApi._lastCall = { method: 'renameFile', args: [filePath, newName] }
        return Promise.resolve({ success: true, newPath: '/new/' + newName })
      },
      deleteFile: (filePath: string, permanent?: boolean) => {
        mockApi._lastCall = { method: 'deleteFile', args: [filePath, permanent] }
        return Promise.resolve({ success: true })
      },
      _lastCall: null as any,
    }
    api = createApi(mockApi)
  })

  it('readFile forwards to electronAPI and returns content', async () => {
    const result = await api.readFile('/test/file.ts')
    assert.strictEqual(result, 'file content from /test/file.ts')
    assert.deepStrictEqual(mockApi._lastCall, { method: 'readFile', args: ['/test/file.ts'] })
  })

  it('writeFile forwards to electronAPI with filePath and content', async () => {
    const result = await api.writeFile('/test/file.ts', 'hello')
    assert.deepStrictEqual(result, { success: true })
    assert.deepStrictEqual(mockApi._lastCall, { method: 'writeFile', args: ['/test/file.ts', 'hello'] })
  })

  it('readDir forwards to electronAPI and returns entries', async () => {
    const result = await api.readDir('/project/src')
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].name, 'a.ts')
    assert.deepStrictEqual(mockApi._lastCall, { method: 'readDir', args: ['/project/src'] })
  })

  it('stat forwards to electronAPI and returns file stat', async () => {
    const result = await api.stat('/test/file.ts')
    assert.strictEqual(result!.size, 1024)
    assert.strictEqual(result!.isFile, true)
    assert.deepStrictEqual(mockApi._lastCall, { method: 'stat', args: ['/test/file.ts'] })
  })

  it('searchFiles forwards to electronAPI with dirPath, query, and options', async () => {
    const result = await api.searchFiles('/project', '*.ts', { maxResults: 10 })
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].name, 'match.ts')
    assert.deepStrictEqual(mockApi._lastCall, { method: 'searchFiles', args: ['/project', '*.ts', { maxResults: 10 }] })
  })

  it('copyFile forwards to electronAPI with src and dest', async () => {
    const result = await api.copyFile('/a.ts', '/b.ts')
    assert.deepStrictEqual(result, { success: true })
    assert.deepStrictEqual(mockApi._lastCall, { method: 'copyFile', args: ['/a.ts', '/b.ts'] })
  })

  it('moveFile forwards to electronAPI with src and dest', async () => {
    const result = await api.moveFile('/a.ts', '/b.ts')
    assert.deepStrictEqual(result, { success: true })
    assert.deepStrictEqual(mockApi._lastCall, { method: 'moveFile', args: ['/a.ts', '/b.ts'] })
  })

  it('renameFile forwards to electronAPI with filePath and newName', async () => {
    const result = await api.renameFile('/old.ts', 'new.ts')
    assert.deepStrictEqual(result, { success: true, newPath: '/new/new.ts' })
    assert.deepStrictEqual(mockApi._lastCall, { method: 'renameFile', args: ['/old.ts', 'new.ts'] })
  })

  it('deleteFile forwards to electronAPI with filePath and permanent flag', async () => {
    const result = await api.deleteFile('/test.ts', true)
    assert.deepStrictEqual(result, { success: true })
    assert.deepStrictEqual(mockApi._lastCall, { method: 'deleteFile', args: ['/test.ts', true] })
  })
})

// ---------------------------------------------------------------------------
// File Operations — fallbacks
// ---------------------------------------------------------------------------

describe('electronAPI - File Operations (fallbacks)', () => {
  const api = createApi(null)

  it('readFile returns null when electronAPI not available', async () => {
    const result = await api.readFile('/test/file.ts')
    assert.strictEqual(result, null)
  })

  it('writeFile returns failure with error message', async () => {
    const result = await api.writeFile('/test/file.ts', 'content')
    assert.deepStrictEqual(result, { success: false, error: 'writeFile not available' })
  })

  it('readDir returns empty array', async () => {
    const result = await api.readDir('/project')
    assert.deepStrictEqual(result, [])
  })

  it('stat returns null', async () => {
    const result = await api.stat('/test/file.ts')
    assert.strictEqual(result, null)
  })

  it('searchFiles returns empty array', async () => {
    const result = await api.searchFiles('/project', 'query')
    assert.deepStrictEqual(result, [])
  })

  it('copyFile returns failure with error message', async () => {
    const result = await api.copyFile('/a', '/b')
    assert.deepStrictEqual(result, { success: false, error: 'copyFile not available' })
  })

  it('moveFile returns failure with error message', async () => {
    const result = await api.moveFile('/a', '/b')
    assert.deepStrictEqual(result, { success: false, error: 'moveFile not available' })
  })

  it('renameFile returns failure with error message', async () => {
    const result = await api.renameFile('/old', 'new')
    assert.deepStrictEqual(result, { success: false, error: 'renameFile not available' })
  })

  it('deleteFile returns failure with error message', async () => {
    const result = await api.deleteFile('/test')
    assert.deepStrictEqual(result, { success: false, error: 'deleteFile not available' })
  })
})

// ---------------------------------------------------------------------------
// Git Operations — forwarding
// ---------------------------------------------------------------------------

describe('electronAPI - Git Operations (forwarding)', () => {
  let mockApi: any
  let api: ReturnType<typeof createApi>

  beforeEach(() => {
    mockApi = {
      git: {
        isRepo: (cwd: string) => {
          mockApi._lastCall = { method: 'git.isRepo', args: [cwd] }
          return Promise.resolve(true)
        },
        getRoot: (cwd: string) => {
          mockApi._lastCall = { method: 'git.getRoot', args: [cwd] }
          return Promise.resolve('/project')
        },
        getStatus: (cwd: string) => {
          mockApi._lastCall = { method: 'git.getStatus', args: [cwd] }
          return Promise.resolve({ staged: [], unstaged: [] })
        },
        stage: (cwd: string, paths: string[]) => {
          mockApi._lastCall = { method: 'git.stage', args: [cwd, paths] }
          return Promise.resolve(true)
        },
        unstage: (cwd: string, paths: string[]) => {
          mockApi._lastCall = { method: 'git.unstage', args: [cwd, paths] }
          return Promise.resolve(true)
        },
        stageAll: (cwd: string) => {
          mockApi._lastCall = { method: 'git.stageAll', args: [cwd] }
          return Promise.resolve(true)
        },
        unstageAll: (cwd: string) => {
          mockApi._lastCall = { method: 'git.unstageAll', args: [cwd] }
          return Promise.resolve(true)
        },
        commit: (cwd: string, message: string, amend?: boolean) => {
          mockApi._lastCall = { method: 'git.commit', args: [cwd, message, amend] }
          return Promise.resolve({ success: true, hash: 'abc123' })
        },
        getDiff: (cwd: string, path: string, staged?: boolean) => {
          mockApi._lastCall = { method: 'git.getDiff', args: [cwd, path, staged] }
          return Promise.resolve('diff content')
        },
        getFullDiff: (cwd: string) => {
          mockApi._lastCall = { method: 'git.getFullDiff', args: [cwd] }
          return Promise.resolve('full diff')
        },
        getStagedDiff: (cwd: string) => {
          mockApi._lastCall = { method: 'git.getStagedDiff', args: [cwd] }
          return Promise.resolve('staged diff')
        },
        showFile: (cwd: string, path: string) => {
          mockApi._lastCall = { method: 'git.showFile', args: [cwd, path] }
          return Promise.resolve('file content at HEAD')
        },
        getBranches: (cwd: string) => {
          mockApi._lastCall = { method: 'git.getBranches', args: [cwd] }
          return Promise.resolve([{ name: 'main', current: true }])
        },
        checkout: (cwd: string, ref: string) => {
          mockApi._lastCall = { method: 'git.checkout', args: [cwd, ref] }
          return Promise.resolve({ success: true })
        },
        createBranch: (cwd: string, name: string, checkoutTo?: boolean) => {
          mockApi._lastCall = { method: 'git.createBranch', args: [cwd, name, checkoutTo] }
          return Promise.resolve({ success: true })
        },
        deleteBranch: (cwd: string, name: string, force?: boolean) => {
          mockApi._lastCall = { method: 'git.deleteBranch', args: [cwd, name, force] }
          return Promise.resolve({ success: true })
        },
        getLog: (cwd: string, count?: number) => {
          mockApi._lastCall = { method: 'git.getLog', args: [cwd, count] }
          return Promise.resolve([{ hash: 'abc123', message: 'init' }])
        },
        discardChanges: (cwd: string, paths: string[]) => {
          mockApi._lastCall = { method: 'git.discardChanges', args: [cwd, paths] }
          return Promise.resolve(true)
        },
        pull: (cwd: string) => {
          mockApi._lastCall = { method: 'git.pull', args: [cwd] }
          return Promise.resolve({ success: true })
        },
        push: (cwd: string) => {
          mockApi._lastCall = { method: 'git.push', args: [cwd] }
          return Promise.resolve({ success: true })
        },
        stash: (cwd: string) => {
          mockApi._lastCall = { method: 'git.stash', args: [cwd] }
          return Promise.resolve({ success: true })
        },
        stashPop: (cwd: string) => {
          mockApi._lastCall = { method: 'git.stashPop', args: [cwd] }
          return Promise.resolve({ success: true })
        },
        fetchAll: (cwd: string) => {
          mockApi._lastCall = { method: 'git.fetchAll', args: [cwd] }
          return Promise.resolve({ success: true })
        },
      },
      _lastCall: null as any,
    }
    api = createApi(mockApi)
  })

  it('git.isRepo forwards and returns boolean', async () => {
    const result = await api.git.isRepo('/project')
    assert.strictEqual(result, true)
    assert.deepStrictEqual(mockApi._lastCall, { method: 'git.isRepo', args: ['/project'] })
  })

  it('git.getRoot forwards and returns root path', async () => {
    const result = await api.git.getRoot('/project')
    assert.strictEqual(result, '/project')
    assert.deepStrictEqual(mockApi._lastCall, { method: 'git.getRoot', args: ['/project'] })
  })

  it('git.getStatus forwards and returns status object', async () => {
    const result = await api.git.getStatus('/project')
    assert.deepStrictEqual(result, { staged: [], unstaged: [] })
  })

  it('git.stage forwards with paths array', async () => {
    const result = await api.git.stage('/project', ['a.ts', 'b.ts'])
    assert.strictEqual(result, true)
    assert.deepStrictEqual(mockApi._lastCall, { method: 'git.stage', args: ['/project', ['a.ts', 'b.ts']] })
  })

  it('git.unstage forwards with paths array', async () => {
    const result = await api.git.unstage('/project', ['a.ts'])
    assert.strictEqual(result, true)
  })

  it('git.commit forwards with message and amend flag', async () => {
    const result = await api.git.commit('/project', 'fix: bug', true)
    assert.deepStrictEqual(result, { success: true, hash: 'abc123' })
    assert.deepStrictEqual(mockApi._lastCall, { method: 'git.commit', args: ['/project', 'fix: bug', true] })
  })

  it('git.getDiff forwards with path and staged flag', async () => {
    const result = await api.git.getDiff('/project', 'src/a.ts', true)
    assert.strictEqual(result, 'diff content')
    assert.deepStrictEqual(mockApi._lastCall, { method: 'git.getDiff', args: ['/project', 'src/a.ts', true] })
  })

  it('git.getBranches forwards and returns branch list', async () => {
    const result = await api.git.getBranches('/project')
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].name, 'main')
  })

  it('git.checkout forwards with ref', async () => {
    const result = await api.git.checkout('/project', 'feature')
    assert.deepStrictEqual(result, { success: true })
  })

  it('git.createBranch forwards with name and checkoutTo', async () => {
    const result = await api.git.createBranch('/project', 'feature', true)
    assert.deepStrictEqual(result, { success: true })
    assert.deepStrictEqual(mockApi._lastCall, { method: 'git.createBranch', args: ['/project', 'feature', true] })
  })

  it('git.deleteBranch forwards with name and force flag', async () => {
    const result = await api.git.deleteBranch('/project', 'old-branch', true)
    assert.deepStrictEqual(result, { success: true })
    assert.deepStrictEqual(mockApi._lastCall, { method: 'git.deleteBranch', args: ['/project', 'old-branch', true] })
  })

  it('git.getLog forwards with count', async () => {
    const result = await api.git.getLog('/project', 10)
    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual(mockApi._lastCall, { method: 'git.getLog', args: ['/project', 10] })
  })

  it('git.discardChanges forwards with paths', async () => {
    const result = await api.git.discardChanges('/project', ['a.ts'])
    assert.strictEqual(result, true)
  })

  it('git.pull forwards', async () => {
    const result = await api.git.pull('/project')
    assert.deepStrictEqual(result, { success: true })
  })

  it('git.push forwards', async () => {
    const result = await api.git.push('/project')
    assert.deepStrictEqual(result, { success: true })
  })

  it('git.stash forwards', async () => {
    const result = await api.git.stash('/project')
    assert.deepStrictEqual(result, { success: true })
  })

  it('git.stashPop forwards', async () => {
    const result = await api.git.stashPop('/project')
    assert.deepStrictEqual(result, { success: true })
  })

  it('git.fetchAll forwards', async () => {
    const result = await api.git.fetchAll('/project')
    assert.deepStrictEqual(result, { success: true })
  })

  it('git.stageAll forwards', async () => {
    const result = await api.git.stageAll('/project')
    assert.strictEqual(result, true)
  })

  it('git.unstageAll forwards', async () => {
    const result = await api.git.unstageAll('/project')
    assert.strictEqual(result, true)
  })

  it('git.getFullDiff forwards', async () => {
    const result = await api.git.getFullDiff('/project')
    assert.strictEqual(result, 'full diff')
  })

  it('git.getStagedDiff forwards', async () => {
    const result = await api.git.getStagedDiff('/project')
    assert.strictEqual(result, 'staged diff')
  })

  it('git.showFile forwards', async () => {
    const result = await api.git.showFile('/project', 'src/a.ts')
    assert.strictEqual(result, 'file content at HEAD')
  })
})

// ---------------------------------------------------------------------------
// Git Operations — fallbacks
// ---------------------------------------------------------------------------

describe('electronAPI - Git Operations (fallbacks)', () => {
  const api = createApi(null)

  it('git.isRepo returns false', async () => {
    assert.strictEqual(await api.git.isRepo('/project'), false)
  })

  it('git.getRoot returns null', async () => {
    assert.strictEqual(await api.git.getRoot('/project'), null)
  })

  it('git.getStatus returns null', async () => {
    assert.strictEqual(await api.git.getStatus('/project'), null)
  })

  it('git.stage returns false', async () => {
    assert.strictEqual(await api.git.stage('/project', ['a.ts']), false)
  })

  it('git.unstage returns false', async () => {
    assert.strictEqual(await api.git.unstage('/project', ['a.ts']), false)
  })

  it('git.stageAll returns false', async () => {
    assert.strictEqual(await api.git.stageAll('/project'), false)
  })

  it('git.unstageAll returns false', async () => {
    assert.strictEqual(await api.git.unstageAll('/project'), false)
  })

  it('git.commit returns failure with error', async () => {
    assert.deepStrictEqual(await api.git.commit('/project', 'msg'), { success: false, error: 'Git API not available' })
  })

  it('git.getDiff returns null', async () => {
    assert.strictEqual(await api.git.getDiff('/project', 'a.ts'), null)
  })

  it('git.getFullDiff returns null', async () => {
    assert.strictEqual(await api.git.getFullDiff('/project'), null)
  })

  it('git.getStagedDiff returns empty string', async () => {
    assert.strictEqual(await api.git.getStagedDiff('/project'), '')
  })

  it('git.showFile returns null', async () => {
    assert.strictEqual(await api.git.showFile('/project', 'a.ts'), null)
  })

  it('git.getBranches returns empty array', async () => {
    assert.deepStrictEqual(await api.git.getBranches('/project'), [])
  })

  it('git.checkout returns failure with error', async () => {
    assert.deepStrictEqual(await api.git.checkout('/project', 'main'), { success: false, error: 'Git API not available' })
  })

  it('git.createBranch returns failure with error', async () => {
    assert.deepStrictEqual(await api.git.createBranch('/project', 'feat'), { success: false, error: 'Git API not available' })
  })

  it('git.deleteBranch returns failure with error', async () => {
    assert.deepStrictEqual(await api.git.deleteBranch('/project', 'old'), { success: false, error: 'Git API not available' })
  })

  it('git.getLog returns empty array', async () => {
    assert.deepStrictEqual(await api.git.getLog('/project'), [])
  })

  it('git.discardChanges returns false', async () => {
    assert.strictEqual(await api.git.discardChanges('/project', ['a.ts']), false)
  })

  it('git.pull returns failure with error', async () => {
    assert.deepStrictEqual(await api.git.pull('/project'), { success: false, error: 'Git API not available' })
  })

  it('git.push returns failure with error', async () => {
    assert.deepStrictEqual(await api.git.push('/project'), { success: false, error: 'Git API not available' })
  })

  it('git.stash returns failure with error', async () => {
    assert.deepStrictEqual(await api.git.stash('/project'), { success: false, error: 'Git API not available' })
  })

  it('git.stashPop returns failure with error', async () => {
    assert.deepStrictEqual(await api.git.stashPop('/project'), { success: false, error: 'Git API not available' })
  })

  it('git.fetchAll returns failure with error', async () => {
    assert.deepStrictEqual(await api.git.fetchAll('/project'), { success: false, error: 'Git API not available' })
  })
})

// ---------------------------------------------------------------------------
// Session Operations — forwarding
// ---------------------------------------------------------------------------

describe('electronAPI - Session Operations (forwarding)', () => {
  let mockApi: any
  let api: ReturnType<typeof createApi>

  beforeEach(() => {
    mockApi = {
      session: {
        getTurnCheckpoints: (sessionId: string, projectPath?: string) => {
          mockApi._lastCall = { method: 'session.getTurnCheckpoints', args: [sessionId, projectPath] }
          return Promise.resolve({ ok: true, checkpoints: [{ turnIndex: 1 }], error: null })
        },
        getTurnRewindPreviewFiles: (sessionId: string, targetUserMessageId: string, userMessageIndex?: number, projectPath?: string) => {
          mockApi._lastCall = { method: 'session.getTurnRewindPreviewFiles', args: [sessionId, targetUserMessageId, userMessageIndex, projectPath] }
          return Promise.resolve({ ok: true, files: ['a.ts'], error: null })
        },
        getTurnCheckpointDiff: (sessionId: string, targetUserMessageId: string, filePath: string, userMessageIndex?: number, projectPath?: string) => {
          mockApi._lastCall = { method: 'session.getTurnCheckpointDiff', args: [sessionId, targetUserMessageId, filePath, userMessageIndex, projectPath] }
          return Promise.resolve({ state: 'modified', path: filePath, diff: '--- a\n+++ b' })
        },
        rewindTurn: (sessionId: string, options: any, projectPath?: string) => {
          mockApi._lastCall = { method: 'session.rewindTurn', args: [sessionId, options, projectPath] }
          return Promise.resolve({ ok: true, error: null })
        },
      },
      _lastCall: null as any,
    }
    api = createApi(mockApi)
  })

  it('session.getTurnCheckpoints forwards with sessionId and projectPath', async () => {
    const result = await api.session.getTurnCheckpoints('sess-1', '/project')
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.checkpoints.length, 1)
    assert.deepStrictEqual(mockApi._lastCall, { method: 'session.getTurnCheckpoints', args: ['sess-1', '/project'] })
  })

  it('session.getTurnRewindPreviewFiles forwards with all arguments', async () => {
    const result = await api.session.getTurnRewindPreviewFiles('sess-1', 'msg-1', 0, '/project')
    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(result.files, ['a.ts'])
    assert.deepStrictEqual(mockApi._lastCall, { method: 'session.getTurnRewindPreviewFiles', args: ['sess-1', 'msg-1', 0, '/project'] })
  })

  it('session.getTurnCheckpointDiff forwards with all arguments', async () => {
    const result = await api.session.getTurnCheckpointDiff('sess-1', 'msg-1', 'a.ts', 0, '/project')
    assert.strictEqual(result.state, 'modified')
    assert.deepStrictEqual(mockApi._lastCall, { method: 'session.getTurnCheckpointDiff', args: ['sess-1', 'msg-1', 'a.ts', 0, '/project'] })
  })

  it('session.rewindTurn forwards with sessionId, options, and projectPath', async () => {
    const result = await api.session.rewindTurn('sess-1', { targetUserMessageId: 'msg-1', userMessageIndex: 0 }, '/project')
    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(mockApi._lastCall, { method: 'session.rewindTurn', args: ['sess-1', { targetUserMessageId: 'msg-1', userMessageIndex: 0 }, '/project'] })
  })
})

// ---------------------------------------------------------------------------
// Session Operations — fallbacks
// ---------------------------------------------------------------------------

describe('electronAPI - Session Operations (fallbacks)', () => {
  const api = createApi(null)

  it('session.getTurnCheckpoints returns failure', async () => {
    const result = await api.session.getTurnCheckpoints('sess-1')
    assert.strictEqual(result.ok, false)
    assert.deepStrictEqual(result.checkpoints, [])
    assert.strictEqual(result.error, 'Session API not available')
  })

  it('session.getTurnRewindPreviewFiles returns failure', async () => {
    const result = await api.session.getTurnRewindPreviewFiles('sess-1', 'msg-1')
    assert.strictEqual(result.ok, false)
    assert.deepStrictEqual(result.files, [])
    assert.strictEqual(result.error, 'Session API not available')
  })

  it('session.getTurnCheckpointDiff returns error state', async () => {
    const result = await api.session.getTurnCheckpointDiff('sess-1', 'msg-1', 'a.ts')
    assert.strictEqual(result.state, 'error')
    assert.strictEqual(result.path, 'a.ts')
    assert.strictEqual(result.error, 'Session API not available')
  })

  it('session.rewindTurn returns failure', async () => {
    const result = await api.session.rewindTurn('sess-1', { targetUserMessageId: 'msg-1' })
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.error, 'Session API not available')
  })
})

// ---------------------------------------------------------------------------
// Terminal Operations — forwarding
// ---------------------------------------------------------------------------

describe('electronAPI - Terminal Operations (forwarding)', () => {
  let mockApi: any
  let api: ReturnType<typeof createApi>

  beforeEach(() => {
    mockApi = {
      terminal: {
        create: (options?: any) => {
          mockApi._lastCall = { method: 'terminal.create', args: [options] }
          return Promise.resolve({ id: 'term-1', shell: '/bin/bash' })
        },
        write: (id: string, data: string) => {
          mockApi._lastCall = { method: 'terminal.write', args: [id, data] }
        },
        resize: (id: string, cols: number, rows: number) => {
          mockApi._lastCall = { method: 'terminal.resize', args: [id, cols, rows] }
        },
        kill: (id: string) => {
          mockApi._lastCall = { method: 'terminal.kill', args: [id] }
        },
        runCommand: (id: string, command: string) => {
          mockApi._lastCall = { method: 'terminal.runCommand', args: [id, command] }
        },
        onData: (callback: (id: string, data: string) => void) => {
          mockApi._lastCall = { method: 'terminal.onData', args: [callback] }
          return () => {}
        },
        onExit: (callback: (id: string, exitCode: number) => void) => {
          mockApi._lastCall = { method: 'terminal.onExit', args: [callback] }
          return () => {}
        },
      },
      _lastCall: null as any,
    }
    api = createApi(mockApi)
  })

  it('terminal.create forwards with options', async () => {
    const result = await api.terminal.create({ cwd: '/project', command: 'npm test' })
    assert.strictEqual(result.id, 'term-1')
    assert.strictEqual(result.shell, '/bin/bash')
    assert.deepStrictEqual(mockApi._lastCall, { method: 'terminal.create', args: [{ cwd: '/project', command: 'npm test' }] })
  })

  it('terminal.write forwards with id and data', () => {
    api.terminal.write('term-1', 'ls\n')
    assert.deepStrictEqual(mockApi._lastCall, { method: 'terminal.write', args: ['term-1', 'ls\n'] })
  })

  it('terminal.resize forwards with id, cols, rows', () => {
    api.terminal.resize('term-1', 120, 40)
    assert.deepStrictEqual(mockApi._lastCall, { method: 'terminal.resize', args: ['term-1', 120, 40] })
  })

  it('terminal.kill forwards with id', () => {
    api.terminal.kill('term-1')
    assert.deepStrictEqual(mockApi._lastCall, { method: 'terminal.kill', args: ['term-1'] })
  })

  it('terminal.runCommand forwards with id and command', () => {
    api.terminal.runCommand('term-1', 'git status')
    assert.deepStrictEqual(mockApi._lastCall, { method: 'terminal.runCommand', args: ['term-1', 'git status'] })
  })

  it('terminal.onData registers callback and returns unsubscribe', () => {
    const cb = (_id: string, _data: string) => {}
    const unsub = api.terminal.onData(cb)
    assert.strictEqual(typeof unsub, 'function')
  })

  it('terminal.onExit registers callback and returns unsubscribe', () => {
    const cb = (_id: string, _exitCode: number) => {}
    const unsub = api.terminal.onExit(cb)
    assert.strictEqual(typeof unsub, 'function')
  })
})

// ---------------------------------------------------------------------------
// Terminal Operations — fallbacks
// ---------------------------------------------------------------------------

describe('electronAPI - Terminal Operations (fallbacks)', () => {
  const api = createApi(null)

  it('terminal.create returns id null with error', async () => {
    const result = await api.terminal.create()
    assert.strictEqual(result.id, null)
    assert.strictEqual(result.error, 'Terminal API not available')
  })

  it('terminal.write returns undefined (no-op)', () => {
    const result = api.terminal.write('term-1', 'data')
    assert.strictEqual(result, undefined)
  })

  it('terminal.resize returns undefined (no-op)', () => {
    const result = api.terminal.resize('term-1', 80, 24)
    assert.strictEqual(result, undefined)
  })

  it('terminal.kill returns undefined (no-op)', () => {
    const result = api.terminal.kill('term-1')
    assert.strictEqual(result, undefined)
  })

  it('terminal.runCommand returns undefined (no-op)', () => {
    const result = api.terminal.runCommand('term-1', 'cmd')
    assert.strictEqual(result, undefined)
  })

  it('terminal.onData returns no-op unsubscribe', () => {
    const unsub = api.terminal.onData(() => {})
    assert.strictEqual(typeof unsub, 'function')
  })

  it('terminal.onExit returns no-op unsubscribe', () => {
    const unsub = api.terminal.onExit(() => {})
    assert.strictEqual(typeof unsub, 'function')
  })
})

// ---------------------------------------------------------------------------
// Debug Operations — forwarding
// ---------------------------------------------------------------------------

describe('electronAPI - Debug Operations (forwarding)', () => {
  let mockApi: any
  let api: ReturnType<typeof createApi>

  beforeEach(() => {
    mockApi = {
      debug: {
        listFiles: () => {
          mockApi._lastCall = { method: 'debug.listFiles', args: [] }
          return Promise.resolve([{ name: 'log.txt', path: '/debug/log.txt', size: 100, modifiedAt: 123, kind: 'app' }])
        },
        readFile: (filePath: string, maxBytes?: number) => {
          mockApi._lastCall = { method: 'debug.readFile', args: [filePath, maxBytes] }
          return Promise.resolve({ success: true, content: 'debug content' })
        },
        listTraceSessions: () => {
          mockApi._lastCall = { method: 'debug.listTraceSessions', args: [] }
          return Promise.resolve([{ sessionId: 's1', path: '/trace/s1', size: 50, modifiedAt: 456, eventCount: 10 }])
        },
        readTraceEvents: (sessionId: string, maxEvents?: number) => {
          mockApi._lastCall = { method: 'debug.readTraceEvents', args: [sessionId, maxEvents] }
          return Promise.resolve({ success: true, events: [{ type: 'start', sessionId }] })
        },
      },
      _lastCall: null as any,
    }
    api = createApi(mockApi)
  })

  it('debug.listFiles forwards and returns file entries', async () => {
    const result = await api.debug.listFiles()
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].name, 'log.txt')
    assert.strictEqual(result[0].kind, 'app')
  })

  it('debug.readFile forwards with filePath and maxBytes', async () => {
    const result = await api.debug.readFile('/debug/log.txt', 1024)
    assert.strictEqual(result.success, true)
    assert.strictEqual(result.content, 'debug content')
    assert.deepStrictEqual(mockApi._lastCall, { method: 'debug.readFile', args: ['/debug/log.txt', 1024] })
  })

  it('debug.listTraceSessions forwards and returns session entries', async () => {
    const result = await api.debug.listTraceSessions()
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].sessionId, 's1')
    assert.strictEqual(result[0].eventCount, 10)
  })

  it('debug.readTraceEvents forwards with sessionId and maxEvents', async () => {
    const result = await api.debug.readTraceEvents('s1', 100)
    assert.strictEqual(result.success, true)
    assert.strictEqual(result.events!.length, 1)
    assert.deepStrictEqual(mockApi._lastCall, { method: 'debug.readTraceEvents', args: ['s1', 100] })
  })
})

// ---------------------------------------------------------------------------
// Debug Operations — fallbacks
// ---------------------------------------------------------------------------

describe('electronAPI - Debug Operations (fallbacks)', () => {
  const api = createApi(null)

  it('debug.listFiles returns empty array', async () => {
    const result = await api.debug.listFiles()
    assert.deepStrictEqual(result, [])
  })

  it('debug.readFile returns failure with error', async () => {
    const result = await api.debug.readFile('/debug/log.txt')
    assert.deepStrictEqual(result, { success: false, error: 'Debug API not available' })
  })

  it('debug.listTraceSessions returns empty array', async () => {
    const result = await api.debug.listTraceSessions()
    assert.deepStrictEqual(result, [])
  })

  it('debug.readTraceEvents returns failure with error', async () => {
    const result = await api.debug.readTraceEvents('s1')
    assert.deepStrictEqual(result, { success: false, error: 'Debug API not available' })
  })
})

// ---------------------------------------------------------------------------
// Miscellaneous APIs — forwarding and fallbacks
// ---------------------------------------------------------------------------

describe('electronAPI - Misc APIs (forwarding)', () => {
  let mockApi: any
  let api: ReturnType<typeof createApi>

  beforeEach(() => {
    mockApi = {
      sendMessage: (text: string) => {
        mockApi._lastCall = { method: 'sendMessage', args: [text] }
        return Promise.resolve({ success: true })
      },
      getAppState: () => {
        mockApi._lastCall = { method: 'getAppState', args: [] }
        return Promise.resolve({ sessions: [{ id: '1' }], currentSessionId: '1', theme: 'dark' })
      },
      getEnv: (key: string) => {
        mockApi._lastCall = { method: 'getEnv', args: [key] }
        return Promise.resolve('value')
      },
      openExternal: (url: string) => {
        mockApi._lastCall = { method: 'openExternal', args: [url] }
        return Promise.resolve()
      },
      openInEditor: (editor: string, targetPath: string) => {
        mockApi._lastCall = { method: 'openInEditor', args: [editor, targetPath] }
        return Promise.resolve({ success: true })
      },
      httpFetch: (url: string, options?: any) => {
        mockApi._lastCall = { method: 'httpFetch', args: [url, options] }
        return Promise.resolve({ ok: true, status: 200, data: 'response' })
      },
      selectFolder: () => {
        mockApi._lastCall = { method: 'selectFolder', args: [] }
        return Promise.resolve({ canceled: false, filePaths: ['/chosen'] })
      },
      selectFiles: () => {
        mockApi._lastCall = { method: 'selectFiles', args: [] }
        return Promise.resolve({ canceled: false, filePaths: ['/file.ts'] })
      },
      optimizePrompt: (prompt: string, options?: any) => {
        mockApi._lastCall = { method: 'optimizePrompt', args: [prompt, options] }
        return Promise.resolve({ success: true, result: 'optimized' })
      },
      getClaudeCliPath: () => {
        mockApi._lastCall = { method: 'getClaudeCliPath', args: [] }
        return Promise.resolve('/usr/bin/claude')
      },
      getPiCliPath: () => {
        mockApi._lastCall = { method: 'getPiCliPath', args: [] }
        return Promise.resolve('/usr/bin/pi')
      },
      _lastCall: null as any,
    }
    api = createApi(mockApi)
  })

  it('sendMessage forwards and returns result', async () => {
    const result = await api.sendMessage('hello')
    assert.deepStrictEqual(result, { success: true })
  })

  it('getAppState forwards and returns state', async () => {
    const result = await api.getAppState()
    assert.strictEqual(result.currentSessionId, '1')
    assert.strictEqual(result.theme, 'dark')
  })

  it('getEnv forwards and returns value', async () => {
    const result = await api.getEnv('HOME')
    assert.strictEqual(result, 'value')
  })

  it('openExternal forwards', async () => {
    await api.openExternal('https://example.com')
    assert.deepStrictEqual(mockApi._lastCall, { method: 'openExternal', args: ['https://example.com'] })
  })

  it('openInEditor forwards with editor and targetPath', async () => {
    const result = await api.openInEditor('vscode', '/file.ts')
    assert.deepStrictEqual(result, { success: true })
  })

  it('httpFetch forwards with url and options', async () => {
    const result = await api.httpFetch('https://api.example.com', { method: 'POST' })
    assert.strictEqual(result!.ok, true)
    assert.strictEqual(result!.status, 200)
  })

  it('selectFolder forwards and returns chosen path', async () => {
    const result = await api.selectFolder()
    assert.strictEqual(result.canceled, false)
    assert.deepStrictEqual(result.filePaths, ['/chosen'])
  })

  it('selectFiles forwards and returns chosen files', async () => {
    const result = await api.selectFiles()
    assert.strictEqual(result.canceled, false)
    assert.deepStrictEqual(result.filePaths, ['/file.ts'])
  })

  it('optimizePrompt forwards and returns result', async () => {
    const result = await api.optimizePrompt('test prompt', { workingDirectory: '/project' })
    assert.strictEqual(result.success, true)
    assert.strictEqual(result.result, 'optimized')
  })

  it('getClaudeCliPath forwards and returns path', async () => {
    const result = await api.getClaudeCliPath()
    assert.strictEqual(result, '/usr/bin/claude')
  })

  it('getPiCliPath forwards and returns path', async () => {
    const result = await api.getPiCliPath()
    assert.strictEqual(result, '/usr/bin/pi')
  })
})

describe('electronAPI - Misc APIs (fallbacks)', () => {
  const api = createApi(null)

  it('sendMessage returns failure', async () => {
    assert.deepStrictEqual(await api.sendMessage('hello'), { success: false })
  })

  it('getAppState returns default state', async () => {
    const result = await api.getAppState()
    assert.deepStrictEqual(result, { sessions: [], currentSessionId: null, theme: 'dark' })
  })

  it('getEnv returns undefined', async () => {
    assert.strictEqual(await api.getEnv('HOME'), undefined)
  })

  it('openExternal resolves undefined', async () => {
    const result = await api.openExternal('https://example.com')
    assert.strictEqual(result, undefined)
  })

  it('openInEditor returns failure with error', async () => {
    assert.deepStrictEqual(await api.openInEditor('vscode', '/file'), { success: false, error: 'openInEditor not available' })
  })

  it('httpFetch returns null', async () => {
    assert.strictEqual(await api.httpFetch('https://example.com'), null)
  })

  it('getClaudeCliPath returns null', async () => {
    assert.strictEqual(await api.getClaudeCliPath(), null)
  })

  it('getPiCliPath returns null', async () => {
    assert.strictEqual(await api.getPiCliPath(), null)
  })

  it('selectFolder returns canceled', async () => {
    assert.deepStrictEqual(await api.selectFolder(), { canceled: true, filePaths: [] })
  })

  it('selectFiles returns canceled', async () => {
    assert.deepStrictEqual(await api.selectFiles(), { canceled: true, filePaths: [] })
  })

  it('optimizePrompt returns failure with error', async () => {
    assert.deepStrictEqual(await api.optimizePrompt('test'), { success: false, error: 'Prompt optimizer not available' })
  })
})

// ---------------------------------------------------------------------------
// Settings APIs — fallbacks
// ---------------------------------------------------------------------------

describe('electronAPI - Settings APIs (fallbacks)', () => {
  const api = createApi(null)

  it('injectGuiModelsToSettings returns failure', async () => {
    const result = await api.injectGuiModelsToSettings({ primaryModel: 'claude-3' })
    assert.deepStrictEqual(result, { success: false, error: 'injectGuiModelsToSettings not available' })
  })

  it('saveGuiSettings returns failure', async () => {
    const result = await api.saveGuiSettings('{}')
    assert.deepStrictEqual(result, { success: false, error: 'saveGuiSettings not available' })
  })

  it('loadGuiSettings returns failure with null data', async () => {
    const result = await api.loadGuiSettings()
    assert.deepStrictEqual(result, { success: false, data: null, error: 'loadGuiSettings not available' })
  })

  it('loadHooksSettings returns failure with null data', async () => {
    const result = await api.loadHooksSettings()
    assert.deepStrictEqual(result, { success: false, data: null, error: 'loadHooksSettings not available' })
  })

  it('saveHooksSettings returns failure', async () => {
    const result = await api.saveHooksSettings('{}')
    assert.deepStrictEqual(result, { success: false, error: 'saveHooksSettings not available' })
  })

  it('getTokenUsageStats returns failure', async () => {
    const result = await api.getTokenUsageStats()
    assert.deepStrictEqual(result, { success: false, error: 'getTokenUsageStats not available' })
  })
})

// ---------------------------------------------------------------------------
// ClaudeCode / Agent APIs — fallbacks
// ---------------------------------------------------------------------------

describe('electronAPI - ClaudeCode/Agent APIs (fallbacks)', () => {
  const api = createApi(null)

  it('updateThinkingLevel resolves undefined', async () => {
    const result = await api.updateThinkingLevel('sess-1', true)
    assert.strictEqual(result, undefined)
  })

  it('getContextUsage returns undefined', async () => {
    const result = await api.getContextUsage('sess-1')
    assert.strictEqual(result, undefined)
  })

  it('detectInstalledCli returns null', async () => {
    assert.strictEqual(await api.detectInstalledCli(), null)
  })

  it('checkEnvironment returns null', async () => {
    assert.strictEqual(await api.checkEnvironment(), null)
  })

  it('installCli returns null', async () => {
    assert.strictEqual(await api.installCli(), null)
  })

  it('onInstallProgress returns no-op unsubscribe', () => {
    const unsub = api.onInstallProgress(() => {})
    assert.strictEqual(typeof unsub, 'function')
  })

  it('getProxyStatus returns null', async () => {
    assert.strictEqual(await api.getProxyStatus(), null)
  })

  it('isProxyRunning returns false', async () => {
    assert.strictEqual(await api.isProxyRunning(), false)
  })

  it('notifyEngineSourceChanged resolves undefined', async () => {
    const result = await api.notifyEngineSourceChanged('local')
    assert.strictEqual(result, undefined)
  })

  it('agents.listAgents returns empty array', async () => {
    const result = await api.agents.listAgents()
    assert.deepStrictEqual(result, [])
  })
})

// ---------------------------------------------------------------------------
// Mobile APIs — fallbacks
// ---------------------------------------------------------------------------

describe('electronAPI - Mobile APIs (fallbacks)', () => {
  const api = createApi(null)

  it('mobile.startServer returns empty defaults', async () => {
    const result = await api.mobile.startServer()
    assert.deepStrictEqual(result, { url: '', token: '', port: 0, ip: '' })
  })

  it('mobile.stopServer resolves undefined', async () => {
    const result = await api.mobile.stopServer()
    assert.strictEqual(result, undefined)
  })

  it('mobile.getStatus returns not running', async () => {
    const result = await api.mobile.getStatus()
    assert.deepStrictEqual(result, { running: false, connected: false })
  })

  it('mobile.onConnected returns no-op unsubscribe', () => {
    const unsub = api.mobile.onConnected(() => {})
    assert.strictEqual(typeof unsub, 'function')
  })

  it('mobile.onDisconnected returns no-op unsubscribe', () => {
    const unsub = api.mobile.onDisconnected(() => {})
    assert.strictEqual(typeof unsub, 'function')
  })
})

// ---------------------------------------------------------------------------
// Trace API — forwarding and fallbacks
// ---------------------------------------------------------------------------

describe('electronAPI - Trace API', () => {
  it('forwards trace.event to electronAPI', () => {
    let called = false
    const api = createApi({
      trace: {
        event: (evt: any) => { called = true },
      },
    })
    api.trace.event({ type: 'test' })
    assert.strictEqual(called, true)
  })

  it('returns undefined when electronAPI not available', () => {
    const api = createApi(null)
    const result = api.trace.event({ type: 'test' })
    assert.strictEqual(result, undefined)
  })
})

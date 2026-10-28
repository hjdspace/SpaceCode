import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { MCPServer } from '../mcp'

/**
 * MCP 服务器 store 契约：数据归一化 / 内置预设合并 / CRUD 持久化 / 依赖安装 / probe。
 *
 * 这些是最容易被误改的行为，且大多带隐藏边界：
 *  - normalizeServers 要吞掉双层 {mcpServers:{...}} 包装、非对象条目与内层
 *    mcpServers key；enabled 缺失视为 true，显式 false 必须保留。
 *  - 内置预设合并的约定是「不覆盖用户状态」：已存在的记录只补 _source 标记；
 *    仅当预设 configVersion 递增时才覆盖 command/args/env，且保留 enabled/id。
 *    DEPRECATED 别名迁移必须先于预设合并 —— 旧 key（如 'computer-use'）残留
 *    会被 buildEnabledMcpConfig 注入 CLI，触发引擎保留名检查 exit(1)。
 *  - 持久化走 toPlain（JSON 深拷贝）剥离 Vue Proxy，否则 Electron IPC
 *    structured clone 抛 "An object could not be cloned"。
 *  - installDependency 的订阅句柄是闭包私有：成功/失败路径都必须在 finally
 *    退订并复位 installingDependency，重入要被拒绝。
 *  - 内置服务器不允许删除（删了下次 fetch 会重新注入，等于"删不掉"），
 *    必须在 IPC 之前拦截。
 *
 * electronAPI 与 builtinMcp 都 mock：预设列表用受控 fixture 原地增删，
 * 测的是 store 的合并算法而不是预设数据本身。
 */

const mocks = vi.hoisted(() => ({
  unsub: vi.fn(),
  getServers: vi.fn(),
  updateServers: vi.fn(),
  addServer: vi.fn(),
  deleteServer: vi.fn(),
  toggleEnabled: vi.fn(),
  reconnectServer: vi.fn(),
  toggleServerRuntime: vi.fn(),
  probeServer: vi.fn(),
  checkDependency: vi.fn(),
  installDependency: vi.fn(),
  localizeBuiltin: vi.fn(),
  getActiveMcpNames: vi.fn(),
  onInstallProgress: vi.fn(),
  getActiveSessions: vi.fn(),
  getMcpStatus: vi.fn(),
}))

const H = vi.hoisted(() => ({
  presets: [] as any[],
  aliases: {} as Record<string, string>,
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    mcp: {
      getServers: mocks.getServers,
      updateServers: mocks.updateServers,
      addServer: mocks.addServer,
      deleteServer: mocks.deleteServer,
      toggleEnabled: mocks.toggleEnabled,
      reconnectServer: mocks.reconnectServer,
      toggleServerRuntime: mocks.toggleServerRuntime,
      probeServer: mocks.probeServer,
      checkDependency: mocks.checkDependency,
      installDependency: mocks.installDependency,
      localizeBuiltin: mocks.localizeBuiltin,
      getActiveMcpNames: mocks.getActiveMcpNames,
      onInstallProgress: mocks.onInstallProgress,
    },
    claudeCode: {
      getActiveSessions: mocks.getActiveSessions,
      getMcpStatus: mocks.getMcpStatus,
    },
  },
}))

vi.mock('@/lib/builtinMcp', () => ({
  BUILTIN_MCP_PRESETS: H.presets,
  BUILTIN_MCP_SOURCE: 'builtin',
  DEPRECATED_BUILTIN_KEY_ALIASES: H.aliases,
  isBuiltinServer: (s: any) => !!s && s._source === 'builtin',
}))

const MCP_STORAGE_KEY = 'claude_desktop_mcp_servers'

function makeServer(overrides: Partial<MCPServer> = {}): MCPServer {
  return {
    id: 'srv-id',
    name: 'srv',
    command: 'cmd',
    args: [],
    env: {},
    enabled: true,
    ...overrides,
  }
}

function makePreset(overrides: Record<string, any> = {}) {
  return {
    key: 'demo',
    name: 'Demo Preset',
    description: '',
    homepage: '',
    config: { command: '', args: [], env: {} },
    ...overrides,
  }
}

function setPresets(list: any[]) {
  H.presets.length = 0
  H.presets.push(...list)
}

function setAliases(map: Record<string, string>) {
  for (const k of Object.keys(H.aliases)) delete H.aliases[k]
  Object.assign(H.aliases, map)
}

const getStored = () => JSON.parse(localStorage.getItem(MCP_STORAGE_KEY) || 'null')

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.getServers.mockResolvedValue(null)
  mocks.updateServers.mockResolvedValue(undefined)
  mocks.addServer.mockResolvedValue(undefined)
  mocks.deleteServer.mockResolvedValue(undefined)
  mocks.toggleEnabled.mockResolvedValue(undefined)
  mocks.probeServer.mockResolvedValue({ status: 'connected', serverInfo: { name: 'x', version: '1' }, tools: [] })
  mocks.checkDependency.mockResolvedValue({ available: true, version: '1.0.0', path: '/usr/bin/x' })
  mocks.installDependency.mockResolvedValue({ success: true })
  mocks.localizeBuiltin.mockResolvedValue({ status: 'not-applicable' })
  mocks.getActiveMcpNames.mockResolvedValue([])
  mocks.onInstallProgress.mockReturnValue(mocks.unsub)
  mocks.getActiveSessions.mockResolvedValue([])
  mocks.getMcpStatus.mockResolvedValue({ mcpServers: [] })
})

async function loadStore() {
  const { useMcpStore } = await import('../mcp')
  return useMcpStore()
}

describe('mcp fetchServers — 数据源与归一化', () => {
  it('IPC 返回 mcpServers 时归一化字段并跳过非法条目', async () => {
    mocks.getServers.mockResolvedValue({
      mcpServers: {
        command: 'stray',
        mcpServers: { hidden: {} },
        junk: 'x',
        ok: { command: 'c' },
      },
    })
    const store = await loadStore()
    await store.fetchServers()

    // 外层带 command 使双重 unwrap 不触发；仅 'ok' 是合法 server 条目
    expect(store.serverCount).toBe(1)
    expect(store.servers.ok).toMatchObject({
      name: 'ok',
      command: 'c',
      args: [],
      env: {},
      enabled: true,
    })
    expect(store.servers.ok?.id).toBeTruthy()
    expect(store.servers.command).toBeUndefined()
    expect(store.servers.junk).toBeUndefined()
    expect(store.servers.mcpServers).toBeUndefined()
    expect(mocks.updateServers).not.toHaveBeenCalled()
  })

  it('IPC 无数据时回退 localStorage 并展开双层 mcpServers 包装', async () => {
    localStorage.setItem(
      MCP_STORAGE_KEY,
      JSON.stringify({
        mcpServers: {
          foo: { command: 'x', enabled: false, type: 'http', url: 'http://a', headers: { A: '1' }, _source: 'settings.json' },
        },
      }),
    )
    const store = await loadStore()
    await store.fetchServers()

    expect(store.servers.foo).toMatchObject({
      name: 'foo',
      command: 'x',
      enabled: false,
      type: 'http',
      url: 'http://a',
      headers: { A: '1' },
      _source: 'settings.json',
    })
  })

  it('内置预设缺失时以 disabled 注入并持久化 plain 副本', async () => {
    setPresets([makePreset({ key: 'demo', config: { command: 'uvx', args: ['x'] } })])
    const store = await loadStore()
    await store.fetchServers()

    expect(store.servers.demo).toMatchObject({
      enabled: false,
      command: 'uvx',
      args: ['x'],
      _source: 'builtin',
    })
    expect(store.servers.demo?.id).toBeTruthy()

    // toPlain 契约：与 store 状态深等但非同引用（结构化克隆安全）
    expect(mocks.updateServers).toHaveBeenCalledTimes(1)
    const arg = mocks.updateServers.mock.calls[0][0]
    expect(arg).toEqual(store.servers)
    expect(arg).not.toBe(store.servers)
    expect(getStored()?.demo).toBeDefined()
  })

  it('getServers 抛错时 error 置位、loading 复位、不写入任何状态', async () => {
    mocks.getServers.mockRejectedValueOnce(new Error('down'))
    const store = await loadStore()
    await store.fetchServers()

    expect(store.error).toBe('Failed to connect to API')
    expect(store.loading).toBe(false)
    expect(store.serverCount).toBe(0)
    expect(mocks.updateServers).not.toHaveBeenCalled()
    expect(localStorage.getItem(MCP_STORAGE_KEY)).toBeNull()
  })
})

describe('mcp 内置预设合并 syncBuiltinServers', () => {
  it('已存在的内置服务器保留用户状态，仅补 _source 标记', async () => {
    setPresets([makePreset({ key: 'demo', config: { command: 'uvx', args: ['new'] } })])
    localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify({ demo: { command: 'custom', enabled: true } }))
    const store = await loadStore()
    await store.fetchServers()

    expect(store.servers.demo).toMatchObject({
      command: 'custom',
      enabled: true,
      _source: 'builtin',
    })
    expect(store.servers.demo?._configVersion).toBeUndefined()
    expect(mocks.updateServers).toHaveBeenCalledTimes(1)
  })

  it('预设 configVersion 变更时覆盖配置但保留 enabled/id/name', async () => {
    setPresets([makePreset({
      key: 'demo',
      configVersion: 2,
      config: { command: 'cua-driver', args: ['--new'], env: { V: '1' } },
    })])
    localStorage.setItem(
      MCP_STORAGE_KEY,
      JSON.stringify({ demo: { id: 'keep-id', enabled: true, command: 'old-cmd', _configVersion: 1 } }),
    )
    const store = await loadStore()
    await store.fetchServers()

    expect(store.servers.demo).toMatchObject({
      id: 'keep-id',
      name: 'demo',
      enabled: true,
      command: 'cua-driver',
      args: ['--new'],
      env: { V: '1' },
      _configVersion: 2,
      _source: 'builtin',
    })
  })

  it('configVersion 匹配且已标记时不重复持久化，用户 env 保留', async () => {
    setPresets([makePreset({ key: 'demo', configVersion: 2, config: { command: 'cua-driver' } })])
    localStorage.setItem(
      MCP_STORAGE_KEY,
      JSON.stringify({ demo: { command: 'user-cmd', env: { TOKEN: 'keep' }, _source: 'builtin', _configVersion: 2 } }),
    )
    // spy 必须在种子写入之后创建，否则会把测试自己的 seed 调用计入
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const store = await loadStore()
    await store.fetchServers()

    expect(store.servers.demo).toMatchObject({ command: 'user-cmd', env: { TOKEN: 'keep' } })
    expect(mocks.updateServers).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    setItemSpy.mockRestore()
  })

  it('DEPRECATED 别名迁移：旧 key 状态搬到新 key；新 key 已存在时旧 key 直接丢弃', async () => {
    setAliases({ 'computer-use': 'sc-computer-use' })
    setPresets([makePreset({ key: 'sc-computer-use', config: { command: 'cua-driver', args: ['serve'] } })])
    const store = await loadStore()

    // 场景一：只有旧 key → 状态搬家（残留旧 key 会被注入 CLI 触发保留名 exit(1)）
    localStorage.setItem(
      MCP_STORAGE_KEY,
      JSON.stringify({ 'computer-use': { command: 'npx', args: ['legacy'], enabled: true } }),
    )
    await store.fetchServers()
    expect(store.servers['computer-use']).toBeUndefined()
    expect(store.servers['sc-computer-use']).toMatchObject({
      command: 'npx',
      args: ['legacy'],
      enabled: true,
      _source: 'builtin',
    })

    // 场景二：新旧并存 → 新 key（用户最新状态）优先，旧 key 丢弃
    localStorage.setItem(
      MCP_STORAGE_KEY,
      JSON.stringify({
        'computer-use': { command: 'old', enabled: false },
        'sc-computer-use': { command: 'new', enabled: true },
      }),
    )
    await store.fetchServers()
    expect(store.servers['computer-use']).toBeUndefined()
    expect(store.servers['sc-computer-use']).toMatchObject({ command: 'new', enabled: true })
  })
})

describe('mcp server CRUD 与持久化', () => {
  it('addServer 写入状态并持久化；IPC 失败时抛错且状态不变', async () => {
    const store = await loadStore()
    await store.addServer('alpha', { command: 'c', args: [], env: { K: 'V' }, enabled: true })

    expect(mocks.addServer).toHaveBeenCalledWith('alpha', { command: 'c', args: [], env: { K: 'V' }, enabled: true })
    expect(store.servers.alpha).toMatchObject({ name: 'alpha', command: 'c' })
    expect(store.servers.alpha?.id).toBeTruthy()
    expect(getStored()?.alpha).toBeDefined()

    mocks.addServer.mockRejectedValueOnce(new Error('ipc'))
    await expect(store.addServer('beta', { command: 'd', args: [], env: {}, enabled: true })).rejects.toThrow('ipc')
    expect(store.servers.beta).toBeUndefined()
    expect(store.serverCount).toBe(1)
  })

  it('updateServer 重命名时删除旧 key 并沿用原 id/_source；同名更新沿用原 id', async () => {
    const store = await loadStore()
    store.servers = { old: makeServer({ id: 'orig-id', name: 'old', _source: 'builtin' }) }

    await store.updateServer('new', { command: 'y', args: [], env: {}, enabled: true }, 'old')

    expect(store.servers.old).toBeUndefined()
    expect(store.servers.new).toMatchObject({ id: 'orig-id', name: 'new', command: 'y', _source: 'builtin' })
    expect(mocks.updateServers).toHaveBeenCalledTimes(1)

    // 同名更新：沿用原 id
    await store.updateServer('new', { command: 'z', args: [], env: {}, enabled: true })
    expect(store.servers.new?.id).toBe('orig-id')
    expect(store.servers.new?.command).toBe('z')
  })

  it('deleteServer 拒绝删除内置服务器且不调 IPC', async () => {
    setPresets([makePreset({ key: 'demo', config: { command: 'uvx' } })])
    const store = await loadStore()
    await store.fetchServers()

    await expect(store.deleteServer('demo')).rejects.toThrow('builtinServerCannotDelete')
    expect(mocks.deleteServer).not.toHaveBeenCalled()
    expect(store.servers.demo).toBeDefined()
  })

  it('deleteServer 正常删除并持久化；IPC 失败抛错且状态不变', async () => {
    const store = await loadStore()
    store.servers = { mine: makeServer({ name: 'mine' }), mine2: makeServer({ name: 'mine2' }) }

    await expect(store.deleteServer('mine')).resolves.toBe(true)
    expect(mocks.deleteServer).toHaveBeenCalledWith('mine')
    expect(store.servers.mine).toBeUndefined()
    expect(getStored()?.mine).toBeUndefined()

    mocks.deleteServer.mockRejectedValueOnce(new Error('nope'))
    await expect(store.deleteServer('mine2')).rejects.toThrow('nope')
    expect(store.servers.mine2).toBeDefined()
  })

  it('toggleServerEnabled 成功路径：走 toggleEnabled、持久化并刷新 activeMcpNames', async () => {
    mocks.getActiveMcpNames.mockResolvedValue(['app'])
    const store = await loadStore()
    store.servers = { app: makeServer({ name: 'app' }) }

    await store.toggleServerEnabled('app', true)

    expect(mocks.toggleEnabled).toHaveBeenCalledWith('app', true)
    expect(store.servers.app?.enabled).toBe(true)
    expect(getStored()?.app?.enabled).toBe(true)
    // 启用/禁用会改变 CLI 实际加载的 MCP 列表，floating 刷新需要 waitFor
    await vi.waitFor(() => expect(store.activeMcpNames).toEqual(['app']))
  })

  it('toggleServerEnabled 降级链：toggleEnabled 失败回退 updateServers，再失败触发 fetchServers 自愈', async () => {
    const store = await loadStore()
    store.servers = { app: makeServer({ name: 'app' }) }

    mocks.toggleEnabled.mockRejectedValueOnce(new Error('toggle failed'))
    await store.toggleServerEnabled('app', false)
    expect(mocks.updateServers).toHaveBeenCalledTimes(1)
    expect(mocks.updateServers.mock.calls[0][0]).toMatchObject({ app: { enabled: false } })
    expect(store.servers.app?.enabled).toBe(false)

    mocks.toggleEnabled.mockRejectedValueOnce(new Error('x'))
    mocks.updateServers.mockRejectedValueOnce(new Error('y'))
    const before = mocks.getServers.mock.calls.length
    await store.toggleServerEnabled('app', true)
    expect(mocks.getServers.mock.calls.length).toBe(before + 1)
  })
})

describe('mcp 依赖检测与一键安装', () => {
  it('checkAllBuiltinDependencies 按命令去重检测；checkDependency 空结果返回 null 且不写入', async () => {
    setPresets([
      makePreset({ key: 'a', dependency: { command: 'uvx' } }),
      makePreset({ key: 'b', dependency: { command: 'uvx' } }),
      makePreset({ key: 'c', dependency: { command: 'npx' } }),
    ])
    const store = await loadStore()
    await store.checkAllBuiltinDependencies()

    const cmds = mocks.checkDependency.mock.calls.map(c => c[0]).sort()
    expect(cmds).toEqual(['npx', 'uvx'])
    expect(store.dependencyStatus.uvx).toMatchObject({ available: true })
    expect(store.dependencyStatus.npx).toMatchObject({ available: true })

    mocks.checkDependency.mockResolvedValueOnce(undefined)
    await expect(store.checkDependency('ghost-cmd')).resolves.toBeNull()
    expect(store.dependencyStatus['ghost-cmd']).toBeUndefined()
  })

  it('installDependency 重入被拒绝', async () => {
    const store = await loadStore()
    let resolveInstall!: (v: { success: boolean }) => void
    mocks.installDependency.mockImplementation(
      () => new Promise<{ success: boolean }>(resolve => { resolveInstall = resolve }),
    )

    const first = store.installDependency('uv')
    await expect(store.installDependency('uv')).resolves.toEqual({
      success: false,
      error: 'Another installation is in progress',
    })
    expect(mocks.installDependency).toHaveBeenCalledTimes(1)

    resolveInstall({ success: true })
    await first
  })

  it('installDependency 订阅进度、回调生效、结束退订并复位状态', async () => {
    const store = await loadStore()
    let progressCb!: (p: any) => void
    let resolveInstall!: (v: { success: boolean }) => void
    mocks.onInstallProgress.mockImplementation((cb: any) => { progressCb = cb; return mocks.unsub })
    mocks.installDependency.mockImplementation(
      () => new Promise<{ success: boolean }>(resolve => { resolveInstall = resolve }),
    )

    const pending = store.installDependency('uv')
    expect(mocks.onInstallProgress).toHaveBeenCalledTimes(1)
    expect(store.installingDependency).toBe('uv')

    progressCb({ stage: 'installing', message: '50%', percent: 50 })
    expect(store.installProgress).toEqual({ stage: 'installing', message: '50%', percent: 50 })

    resolveInstall({ success: true })
    await pending
    expect(mocks.unsub).toHaveBeenCalledTimes(1)
    expect(store.installingDependency).toBeNull()
  })

  it('installDependency 成功后重检依赖并对匹配 installer 的预设触发 probe', async () => {
    setPresets([
      makePreset({ key: 'browser', dependency: { command: 'uvx', installer: 'uv' } }),
      makePreset({ key: 'other', dependency: { command: 'python' } }),
    ])
    const store = await loadStore()
    store.servers = { browser: makeServer({ id: 'b1', name: 'browser', command: 'uvx', args: ['m'] }) }

    await store.installDependency('uv')

    expect(mocks.checkDependency).toHaveBeenCalledWith('uvx')
    expect(mocks.checkDependency).toHaveBeenCalledWith('python')
    // probe 只对 installer 匹配的预设触发；'other' 未匹配
    expect(mocks.probeServer).toHaveBeenCalledTimes(1)
    expect(mocks.probeServer).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'stdio', command: 'uvx', args: ['m'] }),
    )
    await vi.waitFor(() => expect(store.getProbeResult('browser')?.status).toBe('connected'))
  })

  it('installDependency 失败写入 installError、不 probe、仍退订', async () => {
    setPresets([makePreset({ key: 'browser', dependency: { command: 'uvx', installer: 'uv' } })])
    const store = await loadStore()

    mocks.installDependency.mockResolvedValueOnce({ success: false, error: 'boom' })
    await expect(store.installDependency('uv')).resolves.toEqual({ success: false, error: 'boom' })
    expect(store.installError).toBe('boom')
    expect(mocks.probeServer).not.toHaveBeenCalled()
    expect(mocks.unsub).toHaveBeenCalledTimes(1)

    mocks.installDependency.mockRejectedValueOnce(new Error('net'))
    await expect(store.installDependency('uv')).resolves.toEqual({ success: false, error: 'net' })
    expect(store.installError).toBe('net')
    expect(mocks.probeServer).not.toHaveBeenCalled()
    expect(mocks.unsub).toHaveBeenCalledTimes(2)
  })
})

describe('mcp probe 与 runtime 状态', () => {
  it('probeServer 按 server 构造探测配置并写入结果；目标不存在时是 no-op', async () => {
    const store = await loadStore()
    store.servers = { web: makeServer({ name: 'web', command: 'uvx', args: ['m'], env: { A: '1' } }) }

    await store.probeServer('ghost')
    expect(mocks.probeServer).not.toHaveBeenCalled()
    expect(store.getProbeResult('ghost')).toBeUndefined()

    await store.probeServer('web')
    expect(mocks.probeServer).toHaveBeenCalledWith({
      type: 'stdio',
      command: 'uvx',
      args: ['m'],
      env: { A: '1' },
      headers: {},
    })
    const result = store.getProbeResult('web')
    expect(result?.status).toBe('connected')
    expect(typeof result?.probedAt).toBe('number')
  })

  it('probeServer 返回空或抛错时落 failed 并记录原因', async () => {
    const store = await loadStore()
    store.servers = { web: makeServer({ name: 'web' }) }

    mocks.probeServer.mockResolvedValueOnce(null)
    await store.probeServer('web')
    expect(store.getProbeResult('web')).toMatchObject({ status: 'failed', error: 'No response from probe' })

    mocks.probeServer.mockRejectedValueOnce(new Error('timeout'))
    await store.probeServer('web')
    expect(store.getProbeResult('web')).toMatchObject({ status: 'failed', error: 'timeout' })
  })

  it('probeAllServers 只探测 enabled !== false 的服务器', async () => {
    const store = await loadStore()
    store.servers = {
      on: makeServer({ name: 'on' }),
      off: makeServer({ name: 'off', enabled: false }),
      unset: makeServer({ name: 'unset', enabled: true }),
    }

    await store.probeAllServers()

    const probed = mocks.probeServer.mock.calls.map(c => c[0])
    expect(probed).toHaveLength(2)
  })

  it('allMcpTools 合并 probe 与 runtime 工具并按 server::tool 去重，probe 来源优先', async () => {
    const store = await loadStore()
    store.probeResults = {
      alpha: { status: 'connected', tools: [{ name: 'read', description: 'probe版' }, { name: 'shared' }] },
      beta: { status: 'failed', tools: [{ name: 'nope' }] },
    }
    store.runtimeStatus = [
      { name: 'alpha', status: 'connected', tools: [{ name: 'shared', description: 'runtime版' }, { name: 'write' }] },
    ]

    const tools = store.allMcpTools
    expect(tools).toHaveLength(3)
    expect(tools.map(t => `${t.serverName}::${t.tool.name}`)).toEqual(['alpha::read', 'alpha::shared', 'alpha::write'])
    // probe 版先注册占位：runtime 的同名 'shared' 被去重跳过，不再覆盖
    expect(tools[1].tool.description).toBeUndefined()
    expect(tools[0].tool.description).toBe('probe版')
    // failed probe 的工具不进入列表
    expect(tools.some(t => t.tool.name === 'nope')).toBe(false)
  })

  it('fetchRuntimeStatus 三分支：无会话清空 / 有会话写入 / 缺 mcpServers 只清列表', async () => {
    const store = await loadStore()

    mocks.getActiveSessions.mockResolvedValueOnce([])
    await store.fetchRuntimeStatus()
    expect(store.activeSessionId).toBeNull()
    expect(store.runtimeStatus).toEqual([])
    expect(mocks.getMcpStatus).not.toHaveBeenCalled()

    mocks.getActiveSessions.mockResolvedValueOnce([{ id: 'sid1' }])
    mocks.getMcpStatus.mockResolvedValueOnce({ mcpServers: [{ name: 'alpha', status: 'connected', tools: [] }] })
    await store.fetchRuntimeStatus()
    expect(store.activeSessionId).toBe('sid1')
    expect(store.getRuntimeStatusForServer('alpha')).toMatchObject({ name: 'alpha' })

    mocks.getActiveSessions.mockResolvedValueOnce([{ sessionId: 'sid2' }])
    mocks.getMcpStatus.mockResolvedValueOnce({})
    await store.fetchRuntimeStatus()
    expect(store.activeSessionId).toBe('sid2')
    expect(store.runtimeStatus).toEqual([])
  })

  it('reconnectServer / toggleServerRuntime 无活动会话直接跳过；有会话透传并吞错', async () => {
    const store = await loadStore()

    await store.reconnectServer('web')
    await store.toggleServerRuntime('web', false)
    expect(mocks.reconnectServer).not.toHaveBeenCalled()
    expect(mocks.toggleServerRuntime).not.toHaveBeenCalled()

    store.activeSessionId = 'sid1'
    await store.reconnectServer('web')
    expect(mocks.reconnectServer).toHaveBeenCalledWith('sid1', 'web')
    await store.toggleServerRuntime('web', false)
    expect(mocks.toggleServerRuntime).toHaveBeenCalledWith('sid1', 'web', false)

    mocks.reconnectServer.mockRejectedValueOnce(new Error('down'))
    await expect(store.reconnectServer('web')).resolves.toBeUndefined()
  })
})

describe('mcp saveJsonConfig', () => {
  it('保留 claude.json/builtin 来源的服务器，新条目打 settings.json 标记', async () => {
    const store = await loadStore()
    store.servers = {
      managed: makeServer({ id: 'm1', name: 'managed', _source: 'claude.json' }),
      builtinOne: makeServer({ id: 'b1', name: 'builtinOne', _source: 'builtin' }),
      userOne: makeServer({ id: 'u1', name: 'userOne' }),
    }

    await store.saveJsonConfig(
      JSON.stringify({ fresh: { command: 'c', args: [], env: {}, enabled: true } }),
    )

    expect(mocks.updateServers).toHaveBeenCalledTimes(1)
    const arg = mocks.updateServers.mock.calls[0][0]
    expect(Object.keys(arg).sort()).toEqual(['builtinOne', 'fresh', 'managed'])
    expect(arg.fresh).toMatchObject({ name: 'fresh', command: 'c', _source: 'settings.json' })
    expect(arg.fresh.id).toBeTruthy()
    expect(store.servers.fresh).toBeDefined()
    expect(store.servers.userOne).toBeUndefined()
  })

  it('非法 JSON 抛错且状态不变', async () => {
    const store = await loadStore()
    store.servers = { kept: makeServer({ id: 'k1', name: 'kept' }) }

    await expect(store.saveJsonConfig('{not json')).rejects.toThrow()
    expect(store.servers.kept).toBeDefined()
    expect(mocks.updateServers).not.toHaveBeenCalled()
  })
})

describe('mcp 内置预设本地化（启用即后台一次性安装）', () => {
  const builtinCdp = () =>
    makeServer({
      name: 'cdp-bridge',
      _source: 'builtin',
      type: 'stdio',
      command: 'uvx',
      args: ['cdp-bridge@latest'],
      enabled: false,
    })

  it('启用内置预设时带着面板上的启动形态触发；禁用与用户自建项不触发', async () => {
    const store = await loadStore()
    store.servers = {
      'cdp-bridge': builtinCdp(),
      mine: makeServer({ name: 'mine', command: 'npx', args: ['-y', 'x'], enabled: false }),
    }

    await store.toggleServerEnabled('cdp-bridge', true)
    expect(mocks.localizeBuiltin).toHaveBeenCalledWith('cdp-bridge', {
      type: 'stdio',
      command: 'uvx',
      args: ['cdp-bridge@latest'],
    })

    // 用户自建的 npx 条目不归内置预设管，不该被装上机器
    mocks.localizeBuiltin.mockClear()
    await store.toggleServerEnabled('mine', true)
    expect(mocks.localizeBuiltin).not.toHaveBeenCalled()

    // 关掉开关不是授权安装的信号
    await store.toggleServerEnabled('cdp-bridge', false)
    expect(mocks.localizeBuiltin).not.toHaveBeenCalled()
  })

  it('装上后刷新依赖状态并 probe 这一条，标记已本地化；后续启用不再重活', async () => {
    mocks.localizeBuiltin.mockResolvedValue({ status: 'localized' })
    const store = await loadStore()
    store.servers = { 'cdp-bridge': builtinCdp() }

    await store.toggleServerEnabled('cdp-bridge', true)
    await vi.waitFor(() => {
      expect(store.localizedPresets['cdp-bridge']).toBe(true)
      // probeServer 把面板那条配置直接送进 IPC，参数是 config 而不是 key
      expect(mocks.probeServer).toHaveBeenCalledWith(expect.objectContaining({ command: 'uvx' }))
    })
    expect(store.localizingPresets['cdp-bridge']).toBeUndefined()

    mocks.localizeBuiltin.mockClear()
    await store.toggleServerEnabled('cdp-bridge', false)
    await store.toggleServerEnabled('cdp-bridge', true)
    expect(mocks.localizeBuiltin).not.toHaveBeenCalled()
  })

  it('already-local 只标记，不重复 probe 一遍', async () => {
    mocks.localizeBuiltin.mockResolvedValue({ status: 'already-local' })
    const store = await loadStore()
    store.servers = { 'cdp-bridge': builtinCdp() }

    await store.toggleServerEnabled('cdp-bridge', true)
    await vi.waitFor(() => expect(store.localizedPresets['cdp-bridge']).toBe(true))
    expect(mocks.probeServer).not.toHaveBeenCalled()
  })

  it('装失败保持静默：不写 installError、不 probe、开关状态一个字不改', async () => {
    // 这条链路是纯增益路径 —— 失败的唯一后果是下次 spawn 继续走钉版本 launcher，
    // 冒出一条红字反而是在告诉用户一件根本没发生的事。
    mocks.localizeBuiltin.mockResolvedValue({ status: 'failed', error: 'uv not found' })
    const store = await loadStore()
    store.servers = { 'cdp-bridge': builtinCdp() }

    await store.toggleServerEnabled('cdp-bridge', true)
    await vi.waitFor(() => expect(mocks.localizeBuiltin).toHaveBeenCalledTimes(1))

    expect(store.installError).toBeNull()
    expect(store.localizedPresets['cdp-bridge']).toBeUndefined()
    expect(store.servers['cdp-bridge']?.enabled).toBe(true)
    expect(mocks.probeServer).not.toHaveBeenCalled()
  })

  it('IPC 抛错也不冒泡到开关', async () => {
    mocks.localizeBuiltin.mockRejectedValue(new Error('ipc gone'))
    const store = await loadStore()
    store.servers = { 'cdp-bridge': builtinCdp() }

    await store.toggleServerEnabled('cdp-bridge', true)
    await vi.waitFor(() => expect(mocks.localizeBuiltin).toHaveBeenCalledTimes(1))

    expect(store.localizingPresets['cdp-bridge']).toBeUndefined()
    expect(store.servers['cdp-bridge']?.enabled).toBe(true)
  })

  it('同一预设并发触发只装一次，结束后释放闸门', async () => {
    let release: (v: { status: string }) => void = () => {}
    mocks.localizeBuiltin.mockImplementation(
      () => new Promise(res => { release = res }),
    )
    const store = await loadStore()
    store.servers = { 'cdp-bridge': builtinCdp() }

    const a = store.localizeBuiltinPreset('cdp-bridge')
    const b = store.localizeBuiltinPreset('cdp-bridge')
    expect(store.localizingPresets['cdp-bridge']).toBe(true)

    release({ status: 'localized' })
    await Promise.all([a, b])
    expect(mocks.localizeBuiltin).toHaveBeenCalledTimes(1)
    expect(store.localizingPresets['cdp-bridge']).toBeUndefined()

    // 标记已置位，后续调用直接短路
    await store.localizeBuiltinPreset('cdp-bridge')
    expect(mocks.localizeBuiltin).toHaveBeenCalledTimes(1)
  })

  it('不存在的服务器是 no-op；非内置 key 交给主进程判不适用', async () => {
    const store = await loadStore()
    store.servers = { ghost: undefined as never }
    delete store.servers.ghost

    await store.localizeBuiltinPreset('ghost')
    expect(mocks.localizeBuiltin).not.toHaveBeenCalled()

    store.servers.mine = makeServer({ name: 'mine', command: 'npx' })
    await store.localizeBuiltinPreset('mine')
    expect(mocks.localizeBuiltin).toHaveBeenCalledWith('mine', {
      type: undefined,
      command: 'npx',
      args: [],
    })
  })
})

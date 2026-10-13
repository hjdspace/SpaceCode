// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'
import { pathToFileURL } from 'url'
import type { ProxyConfig } from '../../proxy/types'

/**
 * Which file gets spawned, and with what argv. The proxy script exists in three
 * shapes — the compiled bundle next to the main process, the TypeScript source
 * (dev, needs the tsx loader because the child runs under
 * `ELECTRON_RUN_AS_NODE=1`, which cannot resolve asar paths), and the unpacked
 * copy inside an installed app. Picking wrong does not fail loudly: the child
 * either cannot be parsed or cannot be found, and `start()` reports that only as
 * a 10s startup timeout.
 *
 * Path expressions below mirror the module's own, one directory level down — under
 * Vitest `__dirname` is the source directory, not `dist-electron`.
 */

vi.mock('child_process', async () => {
  const kit = await import('./proxyTestKit')
  return { spawn: kit.fakeSpawn }
})

vi.mock('net', async () => {
  const kit = await import('./proxyTestKit')
  return { createServer: kit.fakeCreateServer }
})

vi.mock('http', async () => {
  const kit = await import('./proxyTestKit')
  return { get: kit.fakeHttpGet }
})

vi.mock('fs', async () => {
  const kit = await import('./proxyTestKit')
  return { existsSync: kit.fakeExistsSync }
})

vi.mock('electron', async () => {
  const kit = await import('./proxyTestKit')
  return {
    app: {
      get isPackaged() {
        return kit.appState.isPackaged
      },
      getPath: () => kit.appState.userData,
    },
  }
})

vi.mock('../logger', async () => {
  const kit = await import('./proxyTestKit')
  return kit.loggerState
})

const { appState, fsState, loggerState, netState, spawnState } = await import('./proxyTestKit')
const { ProxyManager } = await import('../proxyManager')

const INFRA_DIR = path.join(__dirname, '..')
const COMPILED_SCRIPT = path.join(INFRA_DIR, 'proxy', 'index.js')
const SOURCE_SCRIPT = path.join(path.resolve(INFRA_DIR, '..', 'electron', 'proxy'), 'index.ts')
const TSX_LOADER = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs')
const TSX_BIN = path.join(process.cwd(), 'node_modules', '.bin', 'tsx')
const RESOURCES = path.join(process.cwd(), 'packed', 'resources')
const UNPACKED_SCRIPT = path.join(RESOURCES, 'app.asar.unpacked', 'dist-electron', 'proxy', 'index.js')

function makeConfig(port = 34567): ProxyConfig {
  return {
    host: '127.0.0.1',
    port,
    upstreamProvider: 'openai_compatible',
    upstreamBaseUrl: 'https://o.test/v1',
    upstreamApiKey: 'o-key',
    modelMapping: { sonnetModel: 'mid-k', defaultModel: 'mid-k' },
  }
}

interface CapturedSpawn {
  args: string[]
  script: string
  sentConfig: ProxyConfig
}

/** start once, then read back what the child was really handed */
async function startAndCapture(config = makeConfig()): Promise<CapturedSpawn> {
  spawnState.autoReadyPort = config.port
  await manager.start(config)
  const args = spawnState.calls[0]!.args
  const portIndex = args.indexOf('--port')
  const configIndex = args.indexOf('--config')
  return {
    args,
    script: args[portIndex - 1] as string,
    sentConfig: JSON.parse(Buffer.from(args[configIndex + 1] as string, 'base64').toString('utf8')) as ProxyConfig,
  }
}

let manager!: InstanceType<typeof ProxyManager>
const originalResourcesPath = (process as { resourcesPath?: string }).resourcesPath

beforeEach(() => {
  spawnState.reset()
  netState.reset()
  fsState.reset()
  loggerState.reset()
  appState.isPackaged = false
  appState.userData = path.join(process.cwd(), 'userdata')
  ;(process as { resourcesPath?: string }).resourcesPath = RESOURCES
  manager = new ProxyManager()
})

afterEach(() => {
  ;(process as { resourcesPath?: string }).resourcesPath = originalResourcesPath
  appState.isPackaged = false
})

describe('resolveProxyScript — dev (unpacked app)', () => {
  it('runs the compiled bundle as soon as it exists, without consulting the source', async () => {
    fsState.existing.add(COMPILED_SCRIPT)
    fsState.existing.add(SOURCE_SCRIPT)

    const spawn = await startAndCapture()

    expect(spawn.script).toBe(COMPILED_SCRIPT)
    expect(spawn.args).not.toContain('--import')
    expect(fsState.touched).toEqual([COMPILED_SCRIPT])
  })

  it('falls back to the TypeScript source when the bundle was not built', async () => {
    fsState.existing.add(SOURCE_SCRIPT)
    fsState.existing.add(TSX_LOADER)

    const spawn = await startAndCapture()

    expect(spawn.script).toBe(SOURCE_SCRIPT)
    expect(fsState.touched.slice(0, 2)).toEqual([COMPILED_SCRIPT, SOURCE_SCRIPT])
  })

  it('loads the tsx ESM loader through --import so the child can parse the source', async () => {
    fsState.existing.add(SOURCE_SCRIPT)
    fsState.existing.add(TSX_LOADER)

    const spawn = await startAndCapture()

    expect(spawn.args).toEqual([
      '--import',
      pathToFileURL(TSX_LOADER).href,
      SOURCE_SCRIPT,
      '--port',
      '34567',
      '--config',
      expect.any(String),
    ])
  })

  it('prefers the loader entry point over the tsx bin wrapper, which --import cannot load', async () => {
    fsState.existing.add(SOURCE_SCRIPT)
    fsState.existing.add(TSX_LOADER)
    fsState.existing.add(TSX_BIN)

    const spawn = await startAndCapture()

    expect(spawn.args[1]).toBe(pathToFileURL(TSX_LOADER).href)
  })

  it('settles for the .bin wrapper when the loader entry is missing', async () => {
    fsState.existing.add(SOURCE_SCRIPT)
    fsState.existing.add(TSX_BIN)

    const spawn = await startAndCapture()

    expect(spawn.args[1]).toBe(pathToFileURL(TSX_BIN).href)
  })

  it('spawns a TypeScript file through bare node when tsx is not installed', async () => {
    // node cannot run .ts; the child dies on a syntax error and the only signal
    // the app gets is a 10s startup timeout.
    fsState.existing.add(SOURCE_SCRIPT)

    const spawn = await startAndCapture()

    expect(spawn.script).toBe(SOURCE_SCRIPT)
    expect(spawn.args).not.toContain('--import')
  })

  it('reports the compiled bundle path when neither it nor the source exists', async () => {
    const spawn = await startAndCapture()

    expect(spawn.script).toBe(COMPILED_SCRIPT)
    expect(fsState.touched).toEqual([COMPILED_SCRIPT, SOURCE_SCRIPT])
  })
})

describe('resolveProxyScript — packaged app', () => {
  beforeEach(() => {
    appState.isPackaged = true
  })

  it('reaches for the asar.unpacked copy first, because the child cannot read asar paths', async () => {
    fsState.existing.add(UNPACKED_SCRIPT)
    fsState.existing.add(COMPILED_SCRIPT)

    const spawn = await startAndCapture()

    expect(spawn.script).toBe(UNPACKED_SCRIPT)
    expect(fsState.touched).toEqual([UNPACKED_SCRIPT])
  })

  it('accepts the asar-internal bundle when no unpacked copy was shipped', async () => {
    fsState.existing.add(COMPILED_SCRIPT)

    const spawn = await startAndCapture()

    expect(spawn.script).toBe(COMPILED_SCRIPT)
    expect(fsState.touched).toEqual([UNPACKED_SCRIPT, COMPILED_SCRIPT])
  })

  it('still names the unpacked candidate when nothing on disk matches', async () => {
    const spawn = await startAndCapture()

    expect(spawn.script).toBe(UNPACKED_SCRIPT)
    expect(fsState.touched).toEqual([UNPACKED_SCRIPT, COMPILED_SCRIPT, COMPILED_SCRIPT])
  })

  it('never wires up the tsx loader in a packaged build', async () => {
    fsState.existing.add(SOURCE_SCRIPT)
    fsState.existing.add(TSX_LOADER)

    const spawn = await startAndCapture()

    expect(spawn.args).not.toContain('--import')
    expect(spawn.script).toBe(UNPACKED_SCRIPT)
  })
})

describe('spawn argv — the config handoff', () => {
  it('base64-encodes the whole config, credentials recoverable from the process list', async () => {
    const spawn = await startAndCapture()

    expect(spawn.sentConfig).toEqual(makeConfig())
    expect(spawn.sentConfig.upstreamApiKey).toBe('o-key')
    expect(Buffer.from(spawn.args[spawn.args.indexOf('--config') + 1] as string, 'base64').toString('utf8')).toContain('o-key')
  })

  it('agrees with itself when the requested port was taken', async () => {
    netState.busyPorts.add(34567)

    const spawn = await startAndCapture()

    expect(spawn.args).toContain('34568')
    expect(spawn.sentConfig.port).toBe(34568)
    expect(spawn.sentConfig.host).toBe('127.0.0.1')
  })

  it('keeps the model mapping intact through the encode round-trip', async () => {
    const config = makeConfig()
    config.modelMapping = { haikuModel: 'h', sonnetModel: 's', opusModel: 'o', defaultModel: 's' }

    const spawn = await startAndCapture(config)

    expect(spawn.sentConfig.modelMapping).toEqual({ haikuModel: 'h', sonnetModel: 's', opusModel: 'o', defaultModel: 's' })
  })
})

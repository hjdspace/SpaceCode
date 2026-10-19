// @vitest-environment node
/**
 * 「这台机器上的 Pi 到底能不能用」的回话处 (issue #52)。
 *
 * 界面只有这一条路拿到结论，所以四件事都得钉住：
 *   - 版本低于下限、或版本问不出来 → available:false，选择器据此置灰，不能空口声称能力可用
 *   - 原因要一路传到界面，否则「置灰」和「为什么置灰」只能各猜一半
 *   - 打包版找不到 bundled pi 时不给「装一下」的入口：装的是全局副本，打包版根本不看它
 *   - EngineFactory 的转发不得把结论压回成布尔
 *
 * piCliResolver 本身（候选序列、版本判定）钉在 piCliResolver.test.ts；这里只钉它上面的
 * 那层策略 —— 所以把解析结果注入进来，逐条看界面会拿到什么。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const H = vi.hoisted(() => ({
  isPackaged: false,
  cli: {
    entry: null as string | null,
    source: null as 'bundled' | 'dev' | 'installed' | null,
    version: null as string | null,
    available: false,
    reason: 'not-found' as 'ok' | 'not-found' | 'version-unknown' | 'version-too-old',
  },
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return H.isPackaged
    },
    getAppPath: () => '/app/root',
    getPath: () => '/home/u',
  },
  BrowserWindow: class {},
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

vi.mock('../piCliResolver', () => ({
  detectPiCli: () => H.cli,
  MIN_PI_VERSION: '1.0.0',
  resetPiCliProbeCache: vi.fn(),
}))

import { PiEngine } from '../PiEngine'
import { EngineFactory } from '../EngineFactory'

function setCli(cli: Partial<typeof H.cli>): void {
  H.cli = { ...H.cli, entry: null, source: null, version: null, available: false, reason: 'not-found', ...cli }
}

beforeEach(() => {
  H.isPackaged = false
  setCli({})
})

describe('PiEngine.getAvailability', () => {
  it('版本低于下限时回不可用，并把读到的版本与原因一起回给界面', () => {
    setCli({ entry: 'C:\\Users\\me\\AppData\\Roaming\\npm\\pi.cmd', source: 'installed', version: '0.73.0', available: false, reason: 'version-too-old' })

    expect(PiEngine.getAvailability()).toEqual({
      available: false,
      reason: 'version-too-old',
      version: '0.73.0',
      installable: false,
    })
  })

  it('版本问不出来时也回不可用，version 留 null 而不是编一个', () => {
    setCli({ entry: 'pi', source: 'installed', version: null, available: false, reason: 'version-unknown' })

    expect(PiEngine.getAvailability()).toEqual({
      available: false,
      reason: 'version-unknown',
      version: null,
      installable: false,
    })
  })

  it('dev 里什么都没找到才建议装 SDK', () => {
    setCli({ reason: 'not-found', available: false })

    expect(PiEngine.getAvailability()).toMatchObject({ reason: 'not-found', installable: true })
  })

  it('打包态缺 bundled 副本是产物坏了，装全局 pi 修不了它', () => {
    H.isPackaged = true
    setCli({ reason: 'not-found', available: false })

    expect(PiEngine.getAvailability()).toMatchObject({ available: false, reason: 'not-found', installable: false })
  })

  it('版本达标才算可用', () => {
    setCli({ entry: '/app/resources/pi/dist/bundle/cli.js', source: 'bundled', version: '1.3.0', available: true, reason: 'ok' })

    expect(PiEngine.getAvailability()).toEqual({
      available: true,
      reason: 'ok',
      version: '1.3.0',
      installable: false,
    })
  })
})

describe('EngineFactory.getEngineAvailability', () => {
  it('Pi 的原因与版本原样转发，不压回成布尔', async () => {
    setCli({ entry: 'pi', source: 'installed', version: '0.73.0', reason: 'version-too-old', available: false })

    await expect(EngineFactory.getEngineAvailability('pi')).resolves.toEqual({
      available: false,
      reason: 'version-too-old',
      version: '0.73.0',
      installable: false,
    })
  })

  it('claude-code 仍算可用，但不谎报版本、也不引导安装', async () => {
    await expect(EngineFactory.getEngineAvailability('claude-code')).resolves.toEqual({
      available: true,
      reason: 'ok',
      version: null,
      installable: false,
    })
  })
})

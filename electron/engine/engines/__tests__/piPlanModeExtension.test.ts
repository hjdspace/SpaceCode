// @vitest-environment node
import * as path from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * issue #45：plan 模式的权限闸来自这个扩展，宿主只认「盘上真在的入口」——
 * 加载不到的时候 Pi 不会报错，它只是安静地没有闸，而界面照样显示「计划模式」。
 *
 * 两条契约：
 *   - packaged 只认 extraResources 搬到 resources/pi-extensions 下的那份；
 *     dev 只认 node_modules 里的副本。asar 路径一概不算（子进程读不进去）。
 *   - 找不到就返回 null，由调用方决定怎么 fail closed，这里不做任何兜底查找。
 */

const SRC_DIR = path.resolve(__dirname, '..')
const ENTRY_SEGMENTS = path.join('node_modules', '@narumitw', 'pi-plan-mode', 'dist', 'index.ts')
const REPO_ENTRY = path.join(SRC_DIR, '..', '..', ENTRY_SEGMENTS)
const PARENT_ENTRY = path.join(SRC_DIR, '..', '..', '..', ENTRY_SEGMENTS)
const CWD_ENTRY = path.join(process.cwd(), ENTRY_SEGMENTS)
const APP_ENTRY = path.join('/app/root', ENTRY_SEGMENTS)
const PACKAGED_ENTRY = path.join('/app/resources', 'pi-extensions', ENTRY_SEGMENTS)

const H = vi.hoisted(() => ({
  existing: new Set<string>(),
  isPackaged: false,
  appPath: '/app/root',
  resourcesPath: '/app/resources',
}))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => H.existing.has(String(p)),
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return H.isPackaged
    },
    getAppPath: () => H.appPath,
  },
}))

vi.mock('../../../infra/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}))

import { resolvePlanModeExtensionPath, PLAN_MODE_ENTER_COMMAND, PLAN_MODE_EXIT_COMMAND } from '../piPlanModeExtension'

beforeEach(() => {
  H.existing.clear()
  H.isPackaged = false
  H.appPath = '/app/root'
  vi.stubEnv('ELECTRON_RESOURCES_PATH', '')
  Object.defineProperty(process, 'resourcesPath', { value: '', configurable: true, writable: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolvePlanModeExtensionPath', () => {
  it('dev 态按候选序列取第一个在盘的入口', () => {
    H.existing.add(REPO_ENTRY)
    expect(resolvePlanModeExtensionPath()).toBe(REPO_ENTRY)
  })

  it('仓库根的副本不在盘上时退回上一个候选', () => {
    H.existing.add(PARENT_ENTRY)
    expect(resolvePlanModeExtensionPath()).toBe(PARENT_ENTRY)
  })

  it('appPath 指向 asar 时改用它的目录，子进程读得到真实路径', () => {
    H.appPath = '/app/root/app.asar'
    H.existing.add(path.join('/app/root', ENTRY_SEGMENTS))
    expect(resolvePlanModeExtensionPath()).toBe(APP_ENTRY)
  })

  it('packaged 态只认 extraResources 搬过去的那份，node_modules 副本一概不看', () => {
    H.isPackaged = true
    Object.defineProperty(process, 'resourcesPath', { value: '/app/resources', configurable: true, writable: true })
    H.existing.add(REPO_ENTRY)
    expect(resolvePlanModeExtensionPath()).toBeNull()

    H.existing.add(PACKAGED_ENTRY)
    expect(resolvePlanModeExtensionPath()).toBe(PACKAGED_ENTRY)
  })

  it('哪一份都不在盘上时返回 null，不去凑一个能跑的副本', () => {
    H.existing.add(CWD_ENTRY.replace('index.ts', 'other.ts'))
    expect(resolvePlanModeExtensionPath()).toBeNull()
  })

  it('进出模式的命令是扩展注册的 /plan 子命令', () => {
    expect(PLAN_MODE_ENTER_COMMAND).toBe('/plan start')
    expect(PLAN_MODE_EXIT_COMMAND).toBe('/plan exit')
  })
})

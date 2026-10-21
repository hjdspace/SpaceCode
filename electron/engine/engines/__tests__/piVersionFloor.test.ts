// @vitest-environment node

/**
 * 宿主下限、随产物分发的 pi、以及强制加载的扩展 peer 范围必须互相覆盖：
 *
 *   max(扩展 peer 下限) <= MIN_PI_VERSION <= 已安装/打包的 pi 版本
 *
 * 这条约束是 #47「名单漂移」的同型防线：只改 piCliResolver 的常量、只升级扩展、
 * 或只升级 bundled pi，都会在这里变红，而不是等到某台 dev 机器上静默降级。
 */
import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

import { MIN_PI_VERSION, isVersionGte } from '../piCliResolver'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const PI_MANIFEST = path.join(REPO_ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json')
const SUBAGENTS_MANIFEST = path.join(REPO_ROOT, 'node_modules', '@tintinweb', 'pi-subagents', 'package.json')
const ROOT_MANIFEST = path.join(REPO_ROOT, 'package.json')

interface PackageManifest {
  version?: unknown
  devDependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
}

function readManifest(file: string): PackageManifest {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as PackageManifest
  } catch (err) {
    throw new Error(
      `无法读取 ${file}：先执行 npm install，版本下限守卫依赖已安装的清单（${err instanceof Error ? err.message : String(err)}）`,
    )
  }
}

/** 只处理 `>=1.1.0` / `^1.3.0` / `~1.3.0` / `1.3.0` 这类以下限开头的范围；读不出来就失败，不猜。 */
function lowerBound(range: unknown, label: string): string {
  if (typeof range !== 'string') throw new Error(`${label}: 版本范围缺失`)
  const match = range.match(/(?:>=|\^|~)?\s*(\d+\.\d+\.\d+)/)
  if (!match) throw new Error(`${label}: 无法从 "${range}" 读出下限`)
  return match[1]
}

describe('Pi 版本下限不变量', () => {
  it('随产物分发的 pi 不低于宿主下限', () => {
    const version = readManifest(PI_MANIFEST).version
    if (typeof version !== 'string') throw new Error('pi package.json: version 缺失')

    expect(
      isVersionGte(version, MIN_PI_VERSION),
      `bundled pi ${version} 低于 MIN_PI_VERSION ${MIN_PI_VERSION}`,
    ).toBe(true)
  })

  it('package.json 声明的 pi 下限不低于宿主下限', () => {
    const range = readManifest(ROOT_MANIFEST).devDependencies?.['@earendil-works/pi-coding-agent']
    const floor = lowerBound(range, 'package.json devDependencies["@earendil-works/pi-coding-agent"]')

    expect(
      isVersionGte(floor, MIN_PI_VERSION),
      `devDependency 下限 ${floor} 低于 MIN_PI_VERSION ${MIN_PI_VERSION}`,
    ).toBe(true)
  })

  it('宿主下限覆盖强制加载扩展的 peer 下限', () => {
    const range = readManifest(SUBAGENTS_MANIFEST).peerDependencies?.['@earendil-works/pi-coding-agent']
    const floor = lowerBound(range, '@tintinweb/pi-subagents peerDependencies["@earendil-works/pi-coding-agent"]')

    expect(
      isVersionGte(MIN_PI_VERSION, floor),
      `MIN_PI_VERSION ${MIN_PI_VERSION} 低于 pi-subagents peer 下限 ${floor}`,
    ).toBe(true)
  })

  it('plan-mode 的文档下限被覆盖（它的 peer 是 *，无法从清单读取）', () => {
    expect(isVersionGte(MIN_PI_VERSION, '0.80.6')).toBe(true)
  })
})

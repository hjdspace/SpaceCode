// @vitest-environment node
import * as path from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * issue #46：Pi 的 agent 体系来自这个扩展，和 #45 的权限闸扩展一样只能靠 `--extension`
 * 强行装进来。加载失败时 pi 不报错，它只是安静地没有子代理 —— 而界面照样显示选了 agent。
 *
 * 这里同时钉住一件事：两个扩展必须读同一份候选序列。#52 的根因就是「可用性判断」与
 * 「实际 spawn」各算一套候选，于是声称有能力而子进程跑的是另一份；扩展入口不能再分叉。
 */

const SRC_DIR = path.resolve(__dirname, '..')
const SUBAGENTS_SEGMENTS = path.join('node_modules', '@tintinweb', 'pi-subagents', 'src', 'index.ts')
const PLAN_MODE_SEGMENTS = path.join('node_modules', '@narumitw', 'pi-plan-mode', 'dist', 'index.ts')
const REPO_ROOT = path.join(SRC_DIR, '..', '..')
const PARENT_ROOT = path.join(SRC_DIR, '..', '..', '..')
const PACKAGED_ROOT = path.join('/app/resources', 'pi-extensions')

const H = vi.hoisted(() => ({
  existing: new Set<string>(),
  isPackaged: false,
  appPath: '/app/root',
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

import { resolveSubagentsExtensionPath } from '../piSubagentsExtension'
import { resolvePlanModeExtensionPath } from '../piPlanModeExtension'

beforeEach(() => {
  H.existing.clear()
  H.isPackaged = false
  H.appPath = '/app/root'
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveSubagentsExtensionPath', () => {
  it('dev 态取 node_modules 里在盘的那份', () => {
    H.existing.add(path.join(REPO_ROOT, SUBAGENTS_SEGMENTS))
    expect(resolveSubagentsExtensionPath()).toBe(path.join(REPO_ROOT, SUBAGENTS_SEGMENTS))
  })

  it('与权限闸扩展读同一套候选序列：仓库根不在盘上时两者都退到上一层', () => {
    H.existing.add(path.join(PARENT_ROOT, SUBAGENTS_SEGMENTS))
    H.existing.add(path.join(PARENT_ROOT, PLAN_MODE_SEGMENTS))

    expect(resolveSubagentsExtensionPath()).toBe(path.join(PARENT_ROOT, SUBAGENTS_SEGMENTS))
    expect(resolvePlanModeExtensionPath()).toBe(path.join(PARENT_ROOT, PLAN_MODE_SEGMENTS))
  })

  it('packaged 态只认 extraResources 搬过去的那份，node_modules 副本一概不看', () => {
    H.isPackaged = true
    Object.defineProperty(process, 'resourcesPath', { value: '/app/resources', configurable: true, writable: true })
    H.existing.add(path.join(REPO_ROOT, SUBAGENTS_SEGMENTS))
    expect(resolveSubagentsExtensionPath()).toBeNull()

    H.existing.add(path.join(PACKAGED_ROOT, SUBAGENTS_SEGMENTS))
    expect(resolveSubagentsExtensionPath()).toBe(path.join(PACKAGED_ROOT, SUBAGENTS_SEGMENTS))
  })

  it('哪一份都不在盘上时返回 null，不去凑一个能跑的副本', () => {
    H.existing.add(path.join(REPO_ROOT, SUBAGENTS_SEGMENTS.replace('index.ts', 'other.ts')))
    expect(resolveSubagentsExtensionPath()).toBeNull()
  })
})

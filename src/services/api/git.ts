/**
 * Git renderer API — invoke channels 从 channel 定义表驱动生成；
 * onStatusChanged 是事件订阅（非 invoke），保留手写。
 *
 * 取代逐个手写 `electronAPI?.git?.method() || Promise.resolve(default)` 的模式。
 * 类型从 gitChannels 定义自动派生，与 preload bridge 和 handler 共享同一份类型真相源。
 */
import { gitChannels } from '@/shared/channels/git'
import type { GitRendererApi } from '@/shared/channels/git'
import { createRendererApi } from '@/shared/rendererApi'
import { electronAPI } from './_context'

type GitApi = GitRendererApi & {
  onStatusChanged: (callback: () => void) => () => void
}

const invokeApi = createRendererApi(
  gitChannels,
  'git',
  electronAPI as unknown as Record<string, Record<string, ((...a: unknown[]) => Promise<unknown>) | undefined> | undefined> | null | undefined,
  {
  isRepo: () => false,
  getRoot: () => null,
  getStatus: () => null,
  stage: () => false,
  unstage: () => false,
  stageAll: () => false,
  unstageAll: () => false,
  commit: () => ({ success: false, error: 'Git API not available' }),
  getDiff: () => null,
  getFullDiff: () => null,
  getStagedDiff: () => '',
  showFile: () => null,
  getBranches: () => [],
  checkout: () => ({ success: false, error: 'Git API not available' }),
  createBranch: () => ({ success: false, error: 'Git API not available' }),
  deleteBranch: () => ({ success: false, error: 'Git API not available' }),
  getLog: () => [],
  discardChanges: () => false,
  pull: () => ({ success: false, error: 'Git API not available' }),
  push: () => ({ success: false, error: 'Git API not available' }),
  stash: () => ({ success: false, error: 'Git API not available' }),
  stashPop: () => ({ success: false, error: 'Git API not available' }),
  fetchAll: () => ({ success: false, error: 'Git API not available' }),
  watchProject: () => false,
  stopWatch: () => false,
  },
)

export const git: GitApi = {
  ...invokeApi,
  onStatusChanged: (callback: () => void): (() => void) => {
    if (electronAPI?.git?.onStatusChanged) {
      return electronAPI.git.onStatusChanged(callback)
    }
    return () => {}
  },
}

import { electronAPI } from './_context'
import type {
  GitStatus,
  GitDiffResult,
  GitFullDiffResult,
  GitBranch,
  GitLogEntry,
} from '../electronAPI'

export const git = {
  isRepo: (cwd: string): Promise<boolean> =>
    electronAPI?.git?.isRepo(cwd) || Promise.resolve(false),
  getRoot: (cwd: string): Promise<string | null> =>
    electronAPI?.git?.getRoot(cwd) || Promise.resolve(null),
  getStatus: (cwd: string): Promise<GitStatus | null> =>
    electronAPI?.git?.getStatus(cwd) || Promise.resolve(null),
  stage: (cwd: string, paths: string[]): Promise<boolean> =>
    electronAPI?.git?.stage(cwd, paths) || Promise.resolve(false),
  unstage: (cwd: string, paths: string[]): Promise<boolean> =>
    electronAPI?.git?.unstage(cwd, paths) || Promise.resolve(false),
  stageAll: (cwd: string): Promise<boolean> =>
    electronAPI?.git?.stageAll(cwd) || Promise.resolve(false),
  unstageAll: (cwd: string): Promise<boolean> =>
    electronAPI?.git?.unstageAll(cwd) || Promise.resolve(false),
  commit: (cwd: string, message: string, amend?: boolean): Promise<{ success: boolean; hash?: string; error?: string }> =>
    electronAPI?.git?.commit(cwd, message, amend) || Promise.resolve({ success: false, error: 'Git API not available' }),
  getDiff: (cwd: string, path: string, staged?: boolean): Promise<GitDiffResult | null> =>
    electronAPI?.git?.getDiff(cwd, path, staged) || Promise.resolve(null),
  getFullDiff: (cwd: string): Promise<GitFullDiffResult | null> =>
    electronAPI?.git?.getFullDiff(cwd) || Promise.resolve(null),
  getStagedDiff: (cwd: string): Promise<string> =>
    electronAPI?.git?.getStagedDiff(cwd) || Promise.resolve(''),
  showFile: (cwd: string, path: string): Promise<string | null> =>
    electronAPI?.git?.showFile(cwd, path) || Promise.resolve(null),
  getBranches: (cwd: string): Promise<GitBranch[]> =>
    electronAPI?.git?.getBranches(cwd) || Promise.resolve([]),
  checkout: (cwd: string, ref: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.git?.checkout(cwd, ref) || Promise.resolve({ success: false, error: 'Git API not available' }),
  createBranch: (cwd: string, name: string, checkoutTo?: boolean): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.git?.createBranch(cwd, name, checkoutTo) || Promise.resolve({ success: false, error: 'Git API not available' }),
  deleteBranch: (cwd: string, name: string, force?: boolean): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.git?.deleteBranch(cwd, name, force) || Promise.resolve({ success: false, error: 'Git API not available' }),
  getLog: (cwd: string, count?: number): Promise<GitLogEntry[]> =>
    electronAPI?.git?.getLog(cwd, count) || Promise.resolve([]),
  discardChanges: (cwd: string, paths: string[]): Promise<boolean> =>
    electronAPI?.git?.discardChanges(cwd, paths) || Promise.resolve(false),
  pull: (cwd: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.git?.pull(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
  push: (cwd: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.git?.push(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
  stash: (cwd: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.git?.stash(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
  stashPop: (cwd: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.git?.stashPop(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
  fetchAll: (cwd: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.git?.fetchAll(cwd) || Promise.resolve({ success: false, error: 'Git API not available' }),
  watchProject: (cwd: string): Promise<boolean> =>
    electronAPI?.git?.watchProject(cwd) || Promise.resolve(false),
  stopWatch: (): Promise<boolean> =>
    electronAPI?.git?.stopWatch() || Promise.resolve(false),
  onStatusChanged: (callback: () => void): (() => void) => {
    if (electronAPI?.git?.onStatusChanged) {
      return electronAPI.git.onStatusChanged(callback)
    }
    return () => {}
  },
}

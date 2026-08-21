/**
 * Git Channel 定义 — git 命名空间 IPC 的单一真相源。
 *
 * 本文件定义了所有 `git:*` channel 的三要素（名、参数类型、返回类型），
 * preload bridge、renderer API 类型、handler 注册均从此派生。
 *
 * 迁移自：
 *   - preload.ts 中 git: {...} 的手写 ipcRenderer.invoke（25 个方法）
 *   - electron.d.ts 中 ElectronGitAPI 接口的手写签名
 *   - api/git.ts 中 null-check 转发的类型导入
 *   - gitService.ts 中内联字符串 channel 名
 */
import type {
  GitStatus,
  GitDiffResult,
  GitFullDiffResult,
  GitBranch,
  GitLogEntry,
} from '@/services/electronAPI'
import { defineChannels } from '@/shared/channelMap'

export const gitChannels = defineChannels({
  isRepo: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as boolean,
  },
  getRoot: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as string | null,
  },
  getStatus: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as GitStatus | null,
  },
  stage: {
    req: [] as unknown as [cwd: string, paths: string[]],
    res: null as unknown as boolean,
  },
  unstage: {
    req: [] as unknown as [cwd: string, paths: string[]],
    res: null as unknown as boolean,
  },
  stageAll: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as boolean,
  },
  unstageAll: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as boolean,
  },
  commit: {
    req: [] as unknown as [cwd: string, message: string, amend?: boolean],
    res: null as unknown as { success: boolean; hash?: string; error?: string },
  },
  getDiff: {
    req: [] as unknown as [cwd: string, path: string, staged?: boolean],
    res: null as unknown as GitDiffResult | null,
  },
  getFullDiff: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as GitFullDiffResult | null,
  },
  getStagedDiff: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as string,
  },
  showFile: {
    req: [] as unknown as [cwd: string, path: string],
    res: null as unknown as string | null,
  },
  getBranches: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as GitBranch[],
  },
  checkout: {
    req: [] as unknown as [cwd: string, ref: string],
    res: null as unknown as { success: boolean; error?: string },
  },
  createBranch: {
    req: [] as unknown as [cwd: string, name: string, checkoutTo?: boolean],
    res: null as unknown as { success: boolean; error?: string },
  },
  deleteBranch: {
    req: [] as unknown as [cwd: string, name: string, force?: boolean],
    res: null as unknown as { success: boolean; error?: string },
  },
  getLog: {
    req: [] as unknown as [cwd: string, count?: number],
    res: null as unknown as GitLogEntry[],
  },
  discardChanges: {
    req: [] as unknown as [cwd: string, paths: string[]],
    res: null as unknown as boolean,
  },
  pull: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as { success: boolean; error?: string },
  },
  push: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as { success: boolean; error?: string },
  },
  stash: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as { success: boolean; error?: string },
  },
  stashPop: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as { success: boolean; error?: string },
  },
  fetchAll: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as { success: boolean; error?: string },
  },
  watchProject: {
    req: [] as unknown as [cwd: string],
    res: null as unknown as boolean,
  },
  stopWatch: {
    req: [] as unknown as [],
    res: null as unknown as boolean,
  },
})

export type GitChannelMap = typeof gitChannels
export type GitRendererApi = import('@/shared/channelMap').DeriveRendererApi<GitChannelMap>
export type GitHandlerMap = import('@/shared/channelMap').DeriveHandler<GitChannelMap>

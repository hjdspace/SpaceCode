/**
 * Factory（AI 流水线）Channel 定义 — factory 命名空间 IPC 的单一真相源。
 *
 * preload bridge、renderer API 类型、主进程 handler 注册均从这份定义派生。
 * 凭据只通过 saveGithubToken 交给主进程，任何 invoke 都不会把 token 读回渲染层。
 */
import { defineNamespace } from '@/shared/channelMap'
import type {
  FactoryGithubAuthResult,
  FactoryPreflightResult,
  FactorySaveResult,
  FactorySecretSaveResult,
  FactorySetupContext,
  FactorySetupDraft,
  FactoryState,
} from '@/shared/factory'

export const factoryNamespace = defineNamespace({
  channels: {
    state: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as FactoryState,
    },
    context: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as FactorySetupContext,
    },
    preflight: {
      req: [] as unknown as [repoRoot: string, draft: FactorySetupDraft],
      res: null as unknown as FactoryPreflightResult,
    },
    save: {
      req: [] as unknown as [repoRoot: string, draft: FactorySetupDraft],
      res: null as unknown as FactorySaveResult,
    },
    testGithubToken: {
      req: [] as unknown as [repoRoot: string, token: string, repo: string],
      res: null as unknown as FactoryGithubAuthResult,
    },
    checkGhAuth: {
      req: [] as unknown as [],
      res: null as unknown as FactoryGithubAuthResult,
    },
    saveGithubToken: {
      req: [] as unknown as [token: string],
      res: null as unknown as FactorySecretSaveResult,
    },
    clearGithubToken: {
      req: [] as unknown as [],
      res: null as unknown as { ok: boolean },
    },
  },
  events: {},
})

export type FactoryChannelMap = typeof factoryNamespace.channels
export type FactoryRendererApi = import('@/shared/channelMap').DeriveRendererApi<FactoryChannelMap>
export type FactoryHandlerMap = import('@/shared/channelMap').DeriveHandler<FactoryChannelMap>

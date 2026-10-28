/**
 * Factory（AI 流水线）Channel 定义 — factory 命名空间 IPC 的单一真相源。
 *
 * preload bridge、renderer API 类型、主进程 handler 注册均从这份定义派生。
 * 凭据只通过 saveGithubToken 交给主进程，任何 invoke 都不会把 token 读回渲染层。
 */
import { defineNamespace } from '@/shared/channelMap'
import type {
  FactoryBacklogInput,
  FactoryBacklogItem,
  FactoryBacklogResult,
  FactoryBacklogUpdate,
  FactoryGithubAuthResult,
  FactoryPreflightResult,
  FactoryRunCreateInput,
  FactoryRunCreateResult,
  FactoryRunSnapshot,
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
    backlogList: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as FactoryBacklogItem[],
    },
    backlogCreate: {
      req: [] as unknown as [repoRoot: string, input: FactoryBacklogInput],
      res: null as unknown as FactoryBacklogResult,
    },
    backlogUpdate: {
      req: [] as unknown as [repoRoot: string, input: FactoryBacklogUpdate],
      res: null as unknown as FactoryBacklogResult,
    },
    backlogDelete: {
      req: [] as unknown as [repoRoot: string, id: string],
      res: null as unknown as FactoryBacklogResult,
    },
    backlogMove: {
      req: [] as unknown as [repoRoot: string, id: string, direction: 'up' | 'down'],
      res: null as unknown as FactoryBacklogResult,
    },
    runCreate: {
      req: [] as unknown as [repoRoot: string, input: FactoryRunCreateInput],
      res: null as unknown as FactoryRunCreateResult,
    },
    runGet: {
      req: [] as unknown as [repoRoot: string, runId: string],
      res: null as unknown as FactoryRunSnapshot | null,
    },
    runLatest: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as FactoryRunSnapshot | null,
    },
  },
  events: {},
})

export type FactoryChannelMap = typeof factoryNamespace.channels
export type FactoryRendererApi = import('@/shared/channelMap').DeriveRendererApi<FactoryChannelMap>
export type FactoryHandlerMap = import('@/shared/channelMap').DeriveHandler<FactoryChannelMap>

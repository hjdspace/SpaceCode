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
  FactoryConfigSaveInput,
  FactoryConfigSaveResult,
  FactoryEvent,
  FactoryEventPush,
  FactoryGithubAuthResult,
  FactoryGithubClaimInput,
  FactoryGithubClaimResult,
  FactoryGithubListInput,
  FactoryGithubListResult,
  FactoryGithubReposResult,
  FactoryGithubWritebackRetryResult,
  FactoryGhLoginResult,
  FactoryMergeExecuteInput,
  FactoryMergePreflightResult,
  FactoryMergeResult,
  FactoryPreflightResult,
  FactoryReviewCommentInput,
  FactoryRun,
  FactoryRunControlResult,
  FactoryRunCreateInput,
  FactoryRunCreateResult,
  FactoryRunSnapshot,
  FactoryRunStopResult,
  FactorySaveResult,
  FactorySecretSaveResult,
  FactorySetupContext,
  FactorySetupDraft,
  FactoryReturnResult,
  FactoryState,
  FactoryTakeoverResult,
  FactoryTaskActionResult,
  FactoryTaskRetryInput,
  FactoryTaskStartInput,
  FactoryTaskStartResult,
  FactoryWorktreeRevealResult,
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
    startGhLogin: {
      req: [] as unknown as [],
      res: null as unknown as FactoryGhLoginResult,
    },
    githubRepos: {
      req: [] as unknown as [source: 'gh' | 'token', token?: string],
      res: null as unknown as FactoryGithubReposResult,
    },
    saveGithubToken: {
      req: [] as unknown as [token: string],
      res: null as unknown as FactorySecretSaveResult,
    },
    clearGithubToken: {
      req: [] as unknown as [],
      res: null as unknown as { ok: boolean },
    },
    githubIssues: {
      req: [] as unknown as [repoRoot: string, input?: FactoryGithubListInput],
      res: null as unknown as FactoryGithubListResult,
    },
    githubClaim: {
      req: [] as unknown as [repoRoot: string, input: FactoryGithubClaimInput],
      res: null as unknown as FactoryGithubClaimResult,
    },
    githubRetryWriteback: {
      req: [] as unknown as [repoRoot: string, runId: string, taskId: string],
      res: null as unknown as FactoryGithubWritebackRetryResult,
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
    runList: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as FactoryRun[],
    },
    runLatest: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as FactoryRunSnapshot | null,
    },
    taskStart: {
      req: [] as unknown as [repoRoot: string, runId: string, taskId: string, input?: FactoryTaskStartInput],
      res: null as unknown as FactoryTaskStartResult,
    },
    taskStop: {
      req: [] as unknown as [repoRoot: string, runId: string, taskId: string],
      res: null as unknown as FactoryTaskActionResult,
    },
    taskCancel: {
      req: [] as unknown as [repoRoot: string, runId: string, taskId: string],
      res: null as unknown as FactoryTaskActionResult,
    },
    taskApprove: {
      req: [] as unknown as [repoRoot: string, runId: string, taskId: string],
      res: null as unknown as FactoryTaskActionResult,
    },
    taskRequestChanges: {
      req: [] as unknown as [repoRoot: string, runId: string, taskId: string],
      res: null as unknown as FactoryTaskActionResult,
    },
    taskFix: {
      req: [] as unknown as [repoRoot: string, runId: string, taskId: string],
      res: null as unknown as FactoryTaskActionResult,
    },
    taskTakeover: {
      req: [] as unknown as [repoRoot: string, runId: string, taskId: string],
      res: null as unknown as FactoryTakeoverResult,
    },
    taskReturn: {
      req: [] as unknown as [repoRoot: string, runId: string, taskId: string],
      res: null as unknown as FactoryReturnResult,
    },
    taskRetry: {
      req: [] as unknown as [
        repoRoot: string,
        runId: string,
        taskId: string,
        input?: FactoryTaskRetryInput,
      ],
      res: null as unknown as FactoryTaskActionResult,
    },
    taskCommentUpdate: {
      req: [] as unknown as [
        repoRoot: string,
        runId: string,
        taskId: string,
        input: FactoryReviewCommentInput,
      ],
      res: null as unknown as FactoryTaskActionResult,
    },
    mergePreflight: {
      req: [] as unknown as [repoRoot: string, runId: string, taskId: string],
      res: null as unknown as FactoryMergePreflightResult,
    },
    mergeExecute: {
      req: [] as unknown as [
        repoRoot: string,
        runId: string,
        taskId: string,
        input: FactoryMergeExecuteInput,
      ],
      res: null as unknown as FactoryMergeResult,
    },
    runStop: {
      req: [] as unknown as [repoRoot: string, runId: string],
      res: null as unknown as FactoryRunStopResult,
    },
    runPause: {
      req: [] as unknown as [repoRoot: string, runId: string],
      res: null as unknown as FactoryRunControlResult,
    },
    runResume: {
      req: [] as unknown as [repoRoot: string, runId: string],
      res: null as unknown as FactoryRunControlResult,
    },
    configSave: {
      req: [] as unknown as [repoRoot: string, input: FactoryConfigSaveInput],
      res: null as unknown as FactoryConfigSaveResult,
    },
    taskEvents: {
      req: [] as unknown as [repoRoot: string, runId: string, taskId?: string | null],
      res: null as unknown as FactoryEvent[],
    },
    worktreeReveal: {
      req: [] as unknown as [repoRoot: string, runId: string, taskId: string],
      res: null as unknown as FactoryWorktreeRevealResult,
    },
  },
  events: {
    onEvent: {
      channel: 'event',
      args: [] as unknown as [push: FactoryEventPush],
    },
  },
})

export type FactoryChannelMap = typeof factoryNamespace.channels
export type FactoryEventMap = typeof factoryNamespace.events
export type FactoryRendererApi = import('@/shared/channelMap').DeriveRendererApi<FactoryChannelMap>
export type FactoryEventApi = import('@/shared/channelMap').DeriveEventApi<FactoryEventMap>
export type FactoryHandlerMap = import('@/shared/channelMap').DeriveHandler<FactoryChannelMap>

/**
 * Factory（AI 流水线）renderer API — 从共享 channel 定义表派生。
 */
import { factoryNamespace } from '@/shared/channels/factory'
import type { FactoryRendererApi, FactoryEventApi } from '@/shared/channels/factory'
import type {
  FactoryBacklogResult,
  FactoryConfigSaveResult,
  FactoryRunControlResult,
  FactoryGithubAuthResult,
  FactoryGithubClaimResult,
  FactoryGithubListResult,
  FactoryGithubReposResult,
  FactoryGithubWritebackRetryResult,
  FactoryGhLoginResult,
  FactoryMergePreflightResult,
  FactoryMergeResult,
  FactoryPlanResult,
  FactoryPreflightResult,
  FactoryReturnResult,
  FactoryRunCreateResult,
  FactorySaveResult,
  FactorySecretSaveResult,
  FactorySetupContext,
  FactoryState,
  FactoryTakeoverResult,
  FactoryTaskActionResult,
  FactoryTaskStartResult,
  FactoryWorktreeRevealResult,
} from '@/shared/factory'
import { createRendererApi, createEventApi } from '@/shared/rendererApi'
import type { AnyElectronAPI } from '@/shared/rendererApi'
import { electronAPI } from './_context'

const emptyContext: FactorySetupContext = {
  repo: { isGitRepo: false, root: '', baseBranch: 'main', dirty: false, gitVersion: null },
  engines: [],
  modelProfile: { configured: false },
  models: { selectable: [] },
  dockerAvailable: false,
  encryptionAvailable: false,
  ghLoggedIn: false,
  existingConfig: null,
}

const emptyPreflight: FactoryPreflightResult = {
  items: [],
  blocking: false,
}

const failedAuth: FactoryGithubAuthResult = { ok: false, reason: 'network' }
const failedGhLogin: FactoryGhLoginResult = { ok: false, reason: 'unsupported' }
const failedRepos: FactoryGithubReposResult = { ok: false, reason: 'unsupported' }

const emptyBacklog: FactoryBacklogResult = { ok: true, items: [] }
const failedRun: FactoryRunCreateResult = { ok: false, error: 'empty-tasks' }
const failedStart: FactoryTaskStartResult = { ok: false, error: 'task-not-found' }
const failedAction: FactoryTaskActionResult = { ok: false, error: 'task-not-found' }
const failedTakeover: FactoryTakeoverResult = { ok: false, error: 'task-not-found' }
const failedReturn: FactoryReturnResult = { ok: false, error: 'task-not-found' }
const failedReveal: FactoryWorktreeRevealResult = { ok: false, error: 'task-not-found' }
const failedMergePreflight: FactoryMergePreflightResult = { ok: false, error: 'task-not-found' }
const failedMerge: FactoryMergeResult = { ok: false, error: 'task-not-found' }
const failedIssueList: FactoryGithubListResult = { ok: false, reason: 'unsupported' }
const failedIssueClaim: FactoryGithubClaimResult = { ok: false, reason: 'config-missing' }
const failedWritebackRetry: FactoryGithubWritebackRetryResult = { ok: false, reason: 'not-applicable' }
const failedControl: FactoryRunControlResult = { ok: false, error: 'run-not-found' }
const failedConfigSave: FactoryConfigSaveResult = { ok: false, error: 'write-failed' }
const failedPlan: FactoryPlanResult = { ok: false, error: 'agent-error' }

const invokeApi = createRendererApi(
  factoryNamespace.channels,
  'factory',
  electronAPI as unknown as AnyElectronAPI,
  {
    state: (): FactoryState => ({
      configured: false,
      config: null,
      configPath: '.spacecode/factory/config.json',
    }),
    context: () => emptyContext,
    preflight: () => emptyPreflight,
    save: (): FactorySaveResult => ({ ok: false, error: 'write-failed' }),
    testGithubToken: () => failedAuth,
    checkGhAuth: () => failedAuth,
    startGhLogin: () => failedGhLogin,
    githubRepos: () => failedRepos,
    saveGithubToken: (): FactorySecretSaveResult => ({ ok: false, reason: 'write-failed' }),
    clearGithubToken: () => ({ ok: false }),
    githubIssues: () => failedIssueList,
    githubClaim: () => failedIssueClaim,
    githubRetryWriteback: () => failedWritebackRetry,
    backlogList: () => [],
    backlogCreate: () => emptyBacklog,
    backlogUpdate: () => emptyBacklog,
    backlogDelete: () => emptyBacklog,
    backlogMove: () => emptyBacklog,
    plan: () => failedPlan,
    runCreate: () => failedRun,
    runGet: () => null,
    runList: () => [],
    runLatest: () => null,
    taskStart: () => failedStart,
    taskStop: () => failedAction,
    taskCancel: () => failedAction,
    taskApprove: () => failedAction,
    taskRequestChanges: () => failedAction,
    taskFix: () => failedAction,
    taskTakeover: () => failedTakeover,
    taskReturn: () => failedReturn,
    taskRetry: () => failedAction,
    taskCommentUpdate: () => failedAction,
    mergePreflight: () => failedMergePreflight,
    mergeExecute: () => failedMerge,
    runStop: () => failedAction,
    runPause: () => failedControl,
    runResume: () => failedControl,
    configSave: () => failedConfigSave,
    taskEvents: () => [],
    worktreeReveal: () => failedReveal,
  },
)

const eventApi = createEventApi(factoryNamespace.events, 'factory', electronAPI as unknown as AnyElectronAPI)

export const factory: FactoryRendererApi & FactoryEventApi = {
  ...invokeApi,
  ...eventApi,
}

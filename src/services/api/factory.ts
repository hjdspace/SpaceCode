/**
 * Factory（AI 流水线）renderer API — 从共享 channel 定义表派生。
 */
import { factoryNamespace } from '@/shared/channels/factory'
import type { FactoryRendererApi } from '@/shared/channels/factory'
import type {
  FactoryBacklogResult,
  FactoryGithubAuthResult,
  FactoryPreflightResult,
  FactoryRunCreateResult,
  FactorySaveResult,
  FactorySecretSaveResult,
  FactorySetupContext,
  FactoryState,
} from '@/shared/factory'
import { createRendererApi } from '@/shared/rendererApi'
import type { AnyElectronAPI } from '@/shared/rendererApi'
import { electronAPI } from './_context'

const emptyContext: FactorySetupContext = {
  repo: { isGitRepo: false, root: '', baseBranch: 'main', dirty: false, gitVersion: null },
  engines: [],
  modelProfile: { configured: false },
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

const emptyBacklog: FactoryBacklogResult = { ok: true, items: [] }
const failedRun: FactoryRunCreateResult = { ok: false, error: 'empty-tasks' }

export const factory: FactoryRendererApi = createRendererApi(
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
    saveGithubToken: (): FactorySecretSaveResult => ({ ok: false, reason: 'write-failed' }),
    clearGithubToken: () => ({ ok: false }),
    backlogList: () => [],
    backlogCreate: () => emptyBacklog,
    backlogUpdate: () => emptyBacklog,
    backlogDelete: () => emptyBacklog,
    backlogMove: () => emptyBacklog,
    runCreate: () => failedRun,
    runGet: () => null,
    runLatest: () => null,
  },
)

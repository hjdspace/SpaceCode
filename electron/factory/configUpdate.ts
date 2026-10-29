/**
 * 运行中修改配置：校验阶段策略、解析模型别名、乐观并发与原子保存。
 *
 * 保存只影响此后领取的任务；在跑任务读取自己的配置快照（见 scheduler/runner）。
 */
import {
  FACTORY_STAGE_PERMISSIONS,
  type FactoryConfig,
  type FactoryConfigSaveInput,
  type FactoryConfigSaveResult,
  type FactoryEngineType,
} from '@/shared/factory'
import { readFactoryConfig, STAGE_KEYS, validateFactoryConfig, writeFactoryConfigAtomic } from './config'
import { clampConcurrency } from './scheduler'

/** 按引擎解析模型；无法解析返回 null。 */
export type FactoryModelResolver = (model: string, engineType: FactoryEngineType) => string | null

export interface ConfigUpdateDeps {
  resolveModel?: FactoryModelResolver
}

/** 阶段策略：验证阶段只跑命令，不接受 Agent；权限组合必须落在白名单内。 */
export function validateStagePolicies(config: FactoryConfig): string[] {
  const errors: string[] = []
  for (const key of STAGE_KEYS) {
    const stage = config.stages[key]
    if (!FACTORY_STAGE_PERMISSIONS[key].includes(stage.permissionMode)) {
      errors.push(`stages.${key}.permissionMode`)
    }
    if (key === 'verify' && stage.model) errors.push('stages.verify.model')
  }
  return errors
}

/** 模型别名必须先按引擎类型解析成功，避免运行到一半才静默回落到默认模型。 */
export function validateStageModels(
  config: FactoryConfig,
  resolve: FactoryModelResolver,
): string[] {
  const errors: string[] = []
  if (config.agent.model && resolve(config.agent.model, config.agent.engineType) === null) {
    errors.push('agent.model')
  }
  for (const key of STAGE_KEYS) {
    if (key === 'verify') continue
    const model = config.stages[key].model
    if (model && resolve(model, config.agent.engineType) === null) {
      errors.push(`stages.${key}.model`)
    }
  }
  return errors
}

function normalize(config: FactoryConfig, revision: number): FactoryConfig {
  return {
    ...config,
    revision,
    agent: { ...config.agent, maxConcurrency: clampConcurrency(config.agent.maxConcurrency) },
  }
}

export function updateFactoryConfig(
  repoRoot: string,
  input: FactoryConfigSaveInput,
  deps: ConfigUpdateDeps = {},
): FactoryConfigSaveResult {
  const existing = readFactoryConfig(repoRoot)
  if (existing && input.expectedRevision !== undefined && existing.revision !== input.expectedRevision) {
    return { ok: false, error: 'revision-conflict', current: existing.revision }
  }

  const revision = existing ? existing.revision + 1 : Math.max(1, input.config.revision || 1)
  const normalized = normalize(input.config, revision)
  const validated = validateFactoryConfig(normalized)
  if (!validated.ok) return { ok: false, error: 'invalid-config', errors: validated.errors }

  const config = validated.config
  const policyErrors = validateStagePolicies(config)
  if (policyErrors.length > 0) return { ok: false, error: 'invalid-config', errors: policyErrors }

  const resolve = deps.resolveModel ?? ((model: string) => model)
  const modelErrors = validateStageModels(config, resolve)
  if (modelErrors.length > 0) return { ok: false, error: 'invalid-config', errors: modelErrors }

  const gateClosed = config.stages.merge.humanGate === false
  const wasOpen = existing ? existing.stages.merge.humanGate !== false : true
  if (gateClosed && wasOpen && input.confirmGateOff !== true) {
    return { ok: false, error: 'confirm-required' }
  }

  try {
    writeFactoryConfigAtomic(repoRoot, config)
    return { ok: true, config }
  } catch {
    return { ok: false, error: 'write-failed' }
  }
}

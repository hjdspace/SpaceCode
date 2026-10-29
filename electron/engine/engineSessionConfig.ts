import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { warn } from '../infra/logger'
import { resolveContextWindowOverrides } from '@/utils/contextUsage'
import { resolveModelAliasForEngine } from '@/utils/engineModel'
import type { FactoryModelTier } from '@/shared/factory'
import { isEffortLevel } from '@/shared/effort'
import type { EngineSessionConfig, EngineType } from './engines/types'

interface PersistedProviderConfig {
  baseUrl?: string
  apiKey?: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
}

interface PersistedModelCapability {
  contextWindow?: number
}

interface PersistedGuiSettings {
  authMethod?: 'anthropic_compatible' | 'openai_compatible' | 'gemini_api' | 'claudeai' | 'console'
  anthropicConfig?: PersistedProviderConfig
  openaiConfig?: PersistedProviderConfig
  geminiConfig?: PersistedProviderConfig
  thinkingEnabled?: boolean
  effortLevel?: string
  engineType?: EngineSessionConfig['engineType']
  engineSource?: EngineSessionConfig['engineSource']
  installedCliPath?: string
  /** 旧版载体，仅可能来自历史持久化数据 */
  modelContextWindows?: Record<string, number>
  /** 设置页当前写入的模型能力覆盖，contextWindow 以此为准 */
  modelCapabilities?: Record<string, PersistedModelCapability>
  rtkEnabled?: boolean
}

/** authMethod → 引擎会话 provider（与 main.ts 写设置时的划分一致） */
const PROVIDER_BY_AUTH_METHOD: Record<NonNullable<PersistedGuiSettings['authMethod']>, string> = {
  anthropic_compatible: 'anthropic',
  claudeai: 'anthropic',
  console: 'anthropic',
  openai_compatible: 'openai',
  gemini_api: 'gemini',
}

/**
 * 设置文件由 main.ts 写在用户主目录的 .claude 下；CLAUDE_CONFIG_DIR 存在时优先看
 * 那里（调用方用它注入配置），没有再回落到写入位置。读不到返回 null。
 */
function readPersistedGuiSettings(): PersistedGuiSettings | null {
  try {
    const candidates: string[] = []
    if (process.env.CLAUDE_CONFIG_DIR) {
      candidates.push(join(process.env.CLAUDE_CONFIG_DIR, 'gui-settings.json'))
    }
    candidates.push(join(homedir(), '.claude', 'gui-settings.json'))

    const settingsPath = candidates.find((p) => existsSync(p))
    if (!settingsPath) return null
    return JSON.parse(readFileSync(settingsPath, 'utf-8')) as PersistedGuiSettings
  } catch (err) {
    warn('EngineSessionConfig', `Failed to load GUI settings for background session: ${String(err)}`)
    return null
  }
}

/**
 * 当前 authMethod 的 haiku/sonnet/opus 槽位配置。
 * claudeai / console 用订阅登录，没有可配的模型槽位，返回 undefined。
 */
function activeProviderConfig(settings: PersistedGuiSettings): PersistedProviderConfig | undefined {
  switch (settings.authMethod) {
    case 'anthropic_compatible':
      return settings.anthropicConfig
    case 'openai_compatible':
      return settings.openaiConfig
    case 'gemini_api':
      return settings.geminiConfig
  }
  return undefined
}

/**
 * 无渲染进程参与时（IM / cron 这类后台触发方）构建引擎会话配置。
 * 读不到设置文件只返回 { cwd }，让引擎按自身默认值启动。
 */
export function loadEngineSessionConfig(cwd: string): EngineSessionConfig {
  const config: EngineSessionConfig = { cwd }

  const settings = readPersistedGuiSettings()
  if (!settings) return config

  if (settings.authMethod) config.provider = PROVIDER_BY_AUTH_METHOD[settings.authMethod]
  const providerConfig = activeProviderConfig(settings)

  if (providerConfig?.sonnetModel) config.model = providerConfig.sonnetModel
  // pi 的 compat provider 要在 spawn 前登记全部可切换模型（见 PiSessionProcess.compatRegistrableModelIds）
  const selectableModels = [...new Set(
    [providerConfig?.haikuModel, providerConfig?.sonnetModel, providerConfig?.opusModel]
      .filter((m): m is string => typeof m === 'string' && m.trim() !== ''),
  )]
  if (selectableModels.length > 0) config.selectableModels = selectableModels
  if (providerConfig?.apiKey) config.apiKey = providerConfig.apiKey
  if (providerConfig?.baseUrl) config.baseUrl = providerConfig.baseUrl
  if (typeof settings.thinkingEnabled === 'boolean') config.thinkingEnabled = settings.thinkingEnabled
  // 磁盘上可能是历史/手写值；只认得 CLI 有效档位才下发，否则留给引擎自己的默认
  if (isEffortLevel(settings.effortLevel)) config.effortLevel = settings.effortLevel
  if (settings.engineType) config.engineType = settings.engineType
  if (settings.engineSource) config.engineSource = settings.engineSource
  if (settings.installedCliPath) config.installedCliPath = settings.installedCliPath
  const contextWindowOverrides = resolveContextWindowOverrides(
    settings.modelCapabilities,
    settings.modelContextWindows,
  )
  if (Object.keys(contextWindowOverrides).length > 0) config.modelContextWindows = contextWindowOverrides
  if (typeof settings.rtkEnabled === 'boolean') config.rtkEnabled = settings.rtkEnabled

  return config
}

/**
 * 当前 provider 的槽位 → 真实模型名映射。
 * 界面用它给模型打档位标记，而不是把 haiku/sonnet/opus 这些档位名当成模型选项。
 */
export function loadModelTiers(): Record<string, FactoryModelTier> {
  const settings = readPersistedGuiSettings()
  if (!settings) return {}
  const providerConfig = activeProviderConfig(settings)
  const tiers: Record<string, FactoryModelTier> = {}
  const assign = (model: string | undefined, tier: FactoryModelTier): void => {
    const trimmed = model?.trim()
    if (trimmed) tiers[trimmed] = tier
  }
  assign(providerConfig?.haikuModel, 'haiku')
  assign(providerConfig?.sonnetModel, 'sonnet')
  assign(providerConfig?.opusModel, 'opus')
  return tiers
}

/**
 * 按引擎解析任务/会话指定的模型：规则与渲染进程同源，见 src/utils/engineModel。
 *
 * claude-code 要别名：代理模式下 sessionProcess 只按别名挑路由（含 opus/haiku 子串
 * 才走对应路由），其余一律落到 sonnet 路由，再由代理把路由映射回槽位模型。直接传
 * 真名等于没传 —— 指定的模型被静默丢弃。
 *
 * pi 要真名：PiSessionProcess 把 config.model 原样拼进 --model，别名对它是个不存在
 * 的模型，任务里选的 qwen-model 会被换成 sonnet。
 *
 * engineType 未落定时按 claude-code 处理（engineGateway 的默认引擎）。
 */
export function resolveEngineModelAlias(modelValue: string, engineType?: EngineType): string {
  const settings = readPersistedGuiSettings()
  return resolveModelAliasForEngine(modelValue, settings ? activeProviderConfig(settings) : undefined, engineType)
}

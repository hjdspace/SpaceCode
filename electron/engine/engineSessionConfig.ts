import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { warn } from '../infra/logger'
import type { EngineSessionConfig } from './engines/types'

interface PersistedProviderConfig {
  baseUrl?: string
  apiKey?: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
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
  modelContextWindows?: Record<string, number>
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
  if (providerConfig?.apiKey) config.apiKey = providerConfig.apiKey
  if (providerConfig?.baseUrl) config.baseUrl = providerConfig.baseUrl
  if (typeof settings.thinkingEnabled === 'boolean') config.thinkingEnabled = settings.thinkingEnabled
  if (settings.effortLevel) config.effortLevel = settings.effortLevel
  if (settings.engineType) config.engineType = settings.engineType
  if (settings.engineSource) config.engineSource = settings.engineSource
  if (settings.installedCliPath) config.installedCliPath = settings.installedCliPath
  if (settings.modelContextWindows) config.modelContextWindows = settings.modelContextWindows
  if (typeof settings.rtkEnabled === 'boolean') config.rtkEnabled = settings.rtkEnabled

  return config
}

/**
 * 把实际模型名反查成引擎别名 haiku/sonnet/opus，命中不到槽位时原样返回。
 *
 * 与渲染进程 chatSession.resolveModelAliasFromConfig 同规则：代理模式下 sessionProcess
 * 只按别名挑路由（含 opus/haiku 子串才走对应路由），其余一律落到 sonnet 路由，再由
 * 代理把路由映射回槽位模型。直接传任务里存的真名等于没传 —— 指定的模型被静默丢弃。
 */
export function resolveEngineModelAlias(modelValue: string): string {
  const settings = readPersistedGuiSettings()
  const slots = settings ? activeProviderConfig(settings) : undefined
  if (!slots) return modelValue
  if (slots.haikuModel && slots.haikuModel === modelValue) return 'haiku'
  if (slots.sonnetModel && slots.sonnetModel === modelValue) return 'sonnet'
  if (slots.opusModel && slots.opusModel === modelValue) return 'opus'
  return modelValue
}

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { warn } from '../infra/logger'
import type { EngineSessionConfig } from './engines/types'

interface PersistedProviderConfig {
  baseUrl?: string
  apiKey?: string
  sonnetModel?: string
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

/**
 * 无渲染进程参与时（IM / cron 这类后台触发方）构建引擎会话配置。
 *
 * 设置文件由 main.ts 写在用户主目录的 .claude 下；CLAUDE_CONFIG_DIR 存在时优先看
 * 那里（调用方用它注入配置），没有再回落到写入位置。
 * 读不到只返回 { cwd }，让引擎按自身默认值启动。
 */
export function loadEngineSessionConfig(cwd: string): EngineSessionConfig {
  const config: EngineSessionConfig = { cwd }

  try {
    const candidates: string[] = []
    if (process.env.CLAUDE_CONFIG_DIR) {
      candidates.push(join(process.env.CLAUDE_CONFIG_DIR, 'gui-settings.json'))
    }
    candidates.push(join(homedir(), '.claude', 'gui-settings.json'))

    const settingsPath = candidates.find((p) => existsSync(p))
    if (!settingsPath) return config

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as PersistedGuiSettings
    let providerConfig: PersistedProviderConfig | undefined

    switch (settings.authMethod) {
      case 'anthropic_compatible':
        config.provider = 'anthropic'
        providerConfig = settings.anthropicConfig
        break
      case 'openai_compatible':
        config.provider = 'openai'
        providerConfig = settings.openaiConfig
        break
      case 'gemini_api':
        config.provider = 'gemini'
        providerConfig = settings.geminiConfig
        break
      case 'claudeai':
      case 'console':
        config.provider = 'anthropic'
        break
    }

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
  } catch (err) {
    warn('EngineSessionConfig', `Failed to load GUI settings for background session: ${String(err)}`)
  }

  return config
}

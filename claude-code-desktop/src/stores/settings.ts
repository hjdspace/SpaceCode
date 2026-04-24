import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type AuthMethod = 'anthropic_compatible' | 'openai_compatible' | 'gemini_api' | 'claudeai' | 'console'

export interface ProviderConfig {
  baseUrl: string
  apiKey: string
  haikuModel: string
  sonnetModel: string
  opusModel: string
}

export interface OAuthAccountInfo {
  email: string
  subscription?: string
}

export interface AuthSettings {
  authMethod: AuthMethod
  anthropicConfig: ProviderConfig
  openaiConfig: ProviderConfig
  geminiConfig: ProviderConfig
  oauthAccount: OAuthAccountInfo | null
  projectRoot: string
}

const SETTINGS_STORAGE_KEY = 'claude_desktop_settings'
const LEGACY_STORAGE_KEY = 'llm_settings'

const electronAPI = (window as any).electronAPI

function createDefaultProviderConfig(): ProviderConfig {
  return {
    baseUrl: '',
    apiKey: '',
    haikuModel: '',
    sonnetModel: '',
    opusModel: ''
  }
}

function loadSavedSettings(): Partial<AuthSettings> {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (e) {
    console.error('[Settings] Failed to load saved settings')
  }
  return {}
}

function loadLegacySettings(): Partial<AuthSettings> {
  try {
    const saved = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      const settings: Partial<AuthSettings> = {}

      if (parsed.provider === 'anthropic') {
        settings.authMethod = 'anthropic_compatible'
        settings.anthropicConfig = {
          ...createDefaultProviderConfig(),
          baseUrl: parsed.baseUrl || parsed.apiUrl || '',
          apiKey: parsed.apiKey || ''
        }
      } else if (parsed.provider === 'openai') {
        settings.authMethod = 'openai_compatible'
        settings.openaiConfig = {
          ...createDefaultProviderConfig(),
          baseUrl: parsed.baseUrl || parsed.apiUrl || '',
          apiKey: parsed.apiKey || '',
          sonnetModel: parsed.model || ''
        }
      }

      settings.projectRoot = parsed.projectRoot
      return settings
    }
  } catch (e) {
    console.error('[Settings] Failed to load legacy settings')
  }
  return {}
}

async function loadEnvSettings(): Promise<Partial<AuthSettings>> {
  try {
    if (!electronAPI?.getEnv) return {}

    const llmProvider = await electronAPI.getEnv('LLM_PROVIDER')
    const anthropicKey = await electronAPI.getEnv('ANTHROPIC_API_KEY')
    const openaiKey = await electronAPI.getEnv('OPENAI_API_KEY')
    const openaiBaseUrl = await electronAPI.getEnv('OPENAI_BASE_URL')
    const anthropicBaseUrl = await electronAPI.getEnv('ANTHROPIC_BASE_URL')
    const openaiModel = await electronAPI.getEnv('OPENAI_MODEL')
    const geminiKey = await electronAPI.getEnv('GEMINI_API_KEY')
    const geminiBaseUrl = await electronAPI.getEnv('GEMINI_BASE_URL')

    // 优先根据 LLM_PROVIDER 环境变量判断
    if (llmProvider === 'openai' || llmProvider === 'openai_compatible') {
      if (openaiKey || openaiBaseUrl) {
        return {
          authMethod: 'openai_compatible',
          openaiConfig: {
            ...createDefaultProviderConfig(),
            baseUrl: openaiBaseUrl || '',
            apiKey: openaiKey || '',
            sonnetModel: openaiModel || ''
          }
        }
      }
    } else if (llmProvider === 'anthropic' || llmProvider === 'anthropic_compatible') {
      if (anthropicKey || anthropicBaseUrl) {
        return {
          authMethod: 'anthropic_compatible',
          anthropicConfig: {
            ...createDefaultProviderConfig(),
            baseUrl: anthropicBaseUrl || '',
            apiKey: anthropicKey || ''
          }
        }
      }
    } else if (llmProvider === 'gemini' || llmProvider === 'gemini_api') {
      if (geminiKey || geminiBaseUrl) {
        return {
          authMethod: 'gemini_api',
          geminiConfig: {
            ...createDefaultProviderConfig(),
            baseUrl: geminiBaseUrl || '',
            apiKey: geminiKey || ''
          }
        }
      }
    }

    // 如果没有 LLM_PROVIDER，按原有逻辑自动检测
    if (geminiKey || geminiBaseUrl) {
      return {
        authMethod: 'gemini_api',
        geminiConfig: {
          ...createDefaultProviderConfig(),
          baseUrl: geminiBaseUrl || '',
          apiKey: geminiKey || ''
        }
      }
    } else if (openaiKey || openaiBaseUrl) {
      return {
        authMethod: 'openai_compatible',
        openaiConfig: {
          ...createDefaultProviderConfig(),
          baseUrl: openaiBaseUrl || '',
          apiKey: openaiKey || '',
          sonnetModel: openaiModel || ''
        }
      }
    } else if (anthropicKey || anthropicBaseUrl) {
      return {
        authMethod: 'anthropic_compatible',
        anthropicConfig: {
          ...createDefaultProviderConfig(),
          baseUrl: anthropicBaseUrl || '',
          apiKey: anthropicKey || ''
        }
      }
    }
  } catch (e) {
    console.error('[Settings] Failed to load env settings')
  }
  return {}
}

export const useSettingsStore = defineStore('settings', () => {
  const saved = { ...loadLegacySettings(), ...loadSavedSettings() }

  const authMethod = ref<AuthMethod>(saved.authMethod || 'openai_compatible')
  const anthropicConfig = ref<ProviderConfig>({
    ...createDefaultProviderConfig(),
    ...(saved.anthropicConfig || {})
  })
  const openaiConfig = ref<ProviderConfig>({
    ...createDefaultProviderConfig(),
    ...(saved.openaiConfig || {})
  })
  const geminiConfig = ref<ProviderConfig>({
    ...createDefaultProviderConfig(),
    ...(saved.geminiConfig || {})
  })
  const oauthAccount = ref<OAuthAccountInfo | null>(saved.oauthAccount || null)
  const projectRoot = ref(saved.projectRoot || '')

  // Computed: current provider for LLM service compatibility
  const provider = computed(() => {
    switch (authMethod.value) {
      case 'anthropic_compatible':
      case 'claudeai':
      case 'console':
        return 'anthropic' as const
      case 'openai_compatible':
        return 'openai' as const
      case 'gemini_api':
        return 'gemini' as const
      default:
        return 'openai' as const
    }
  })

  // Computed: legacy config format for backward compatibility
  const config = computed(() => {
    let apiKey = ''
    let baseUrl = ''
    let model = ''

    switch (authMethod.value) {
      case 'anthropic_compatible':
        apiKey = anthropicConfig.value.apiKey
        baseUrl = anthropicConfig.value.baseUrl
        model = anthropicConfig.value.sonnetModel
        break
      case 'openai_compatible':
        apiKey = openaiConfig.value.apiKey
        baseUrl = openaiConfig.value.baseUrl
        model = openaiConfig.value.sonnetModel
        break
      case 'gemini_api':
        apiKey = geminiConfig.value.apiKey
        baseUrl = geminiConfig.value.baseUrl
        model = geminiConfig.value.sonnetModel
        break
      case 'claudeai':
      case 'console':
        // OAuth-based, no direct API key
        break
    }

    return {
      provider: provider.value,
      apiKey,
      apiUrl: baseUrl || undefined,
      model: model || undefined
    }
  })

  const isConfigured = computed(() => {
    switch (authMethod.value) {
      case 'anthropic_compatible':
        return !!anthropicConfig.value.apiKey
      case 'openai_compatible':
        return !!openaiConfig.value.apiKey
      case 'gemini_api':
        return !!geminiConfig.value.apiKey
      case 'claudeai':
      case 'console':
        return !!oauthAccount.value
      default:
        return false
    }
  })

  // Get individual models from GUI config (for injecting into settings.json)
  function getHaikuModel(): string | undefined {
    switch (authMethod.value) {
      case 'anthropic_compatible': return anthropicConfig.value.haikuModel || undefined
      case 'openai_compatible': return openaiConfig.value.haikuModel || undefined
      case 'gemini_api': return geminiConfig.value.haikuModel || undefined
      default: return undefined
    }
  }

  function getSonnetModel(): string | undefined {
    switch (authMethod.value) {
      case 'anthropic_compatible': return anthropicConfig.value.sonnetModel || undefined
      case 'openai_compatible': return openaiConfig.value.sonnetModel || undefined
      case 'gemini_api': return geminiConfig.value.sonnetModel || undefined
      default: return undefined
    }
  }

  function getOpusModel(): string | undefined {
    switch (authMethod.value) {
      case 'anthropic_compatible': return anthropicConfig.value.opusModel || undefined
      case 'openai_compatible': return openaiConfig.value.opusModel || undefined
      case 'gemini_api': return geminiConfig.value.opusModel || undefined
      default: return undefined
    }
  }

  // Get the primary model from GUI config (legacy, kept for compatibility)
  function getPrimaryModel(): string | undefined {
    return getSonnetModel()
  }

  // Build environment variables for the CLI process
  // NOTE: We intentionally do NOT set OPENAI_DEFAULT_SONNET_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL,
  // ANTHROPIC_MODEL, etc. Those env vars are used by the CLI's getDefaultSonnetModel() as the
  // "default model", which effectively locks the model and prevents /model from working correctly.
  // Instead, we pass the user's chosen model via --model CLI flag (see Sidebar.vue handleOpenClaudeCLI),
  // which sets mainLoopModelOverride and can be freely overridden by /model at runtime.
  function buildEnvVars(): Record<string, string> {
    const env: Record<string, string> = {}

    switch (authMethod.value) {
      case 'anthropic_compatible': {
        const c = anthropicConfig.value
        if (c.baseUrl) env.ANTHROPIC_BASE_URL = c.baseUrl
        if (c.apiKey) env.ANTHROPIC_AUTH_TOKEN = c.apiKey
        break
      }
      case 'openai_compatible': {
        const c = openaiConfig.value
        env.CLAUDE_CODE_USE_OPENAI = '1'
        if (c.baseUrl) env.OPENAI_BASE_URL = c.baseUrl
        if (c.apiKey) env.OPENAI_API_KEY = c.apiKey
        break
      }
      case 'gemini_api': {
        const c = geminiConfig.value
        env.CLAUDE_CODE_USE_GEMINI = '1'
        if (c.baseUrl) env.GEMINI_BASE_URL = c.baseUrl
        if (c.apiKey) env.GEMINI_API_KEY = c.apiKey
        break
      }
      case 'claudeai': {
        env.CLAUDE_CODE_USE_CLAUDE_AI = '1'
        break
      }
      case 'console': {
        env.CLAUDE_CODE_USE_CONSOLE = '1'
        break
      }
    }

    return env
  }

  function saveSettings() {
    const data: AuthSettings = {
      authMethod: authMethod.value,
      anthropicConfig: { ...anthropicConfig.value },
      openaiConfig: { ...openaiConfig.value },
      geminiConfig: { ...geminiConfig.value },
      oauthAccount: oauthAccount.value,
      projectRoot: projectRoot.value
    }

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data))

    // Also save legacy format for backward compatibility
    const legacyConfig = config.value
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({
      provider: legacyConfig.provider,
      apiKey: legacyConfig.apiKey || '',
      baseUrl: legacyConfig.apiUrl || '',
      model: legacyConfig.model || '',
      projectRoot: projectRoot.value
    }))
  }

  function updateFromSettingsPanel(settings: AuthSettings) {
    authMethod.value = settings.authMethod
    anthropicConfig.value = { ...settings.anthropicConfig }
    openaiConfig.value = { ...settings.openaiConfig }
    geminiConfig.value = { ...settings.geminiConfig }
    oauthAccount.value = settings.oauthAccount
    projectRoot.value = settings.projectRoot
    saveSettings()
  }

  async function loadFromEnv() {
    const envSettings = await loadEnvSettings()

    // 始终从 .env 加载 baseUrl 和 apiKey（如果 .env 中有定义）
    // 这确保 API 端点配置始终来自 .env
    if (envSettings.authMethod) {
      authMethod.value = envSettings.authMethod
    }
    if (envSettings.anthropicConfig) {
      for (const [key, value] of Object.entries(envSettings.anthropicConfig)) {
        if (value) (anthropicConfig.value as any)[key] = value
      }
    }
    if (envSettings.openaiConfig) {
      for (const [key, value] of Object.entries(envSettings.openaiConfig)) {
        if (value) (openaiConfig.value as any)[key] = value
      }
    }
    if (envSettings.geminiConfig) {
      for (const [key, value] of Object.entries(envSettings.geminiConfig)) {
        if (value) (geminiConfig.value as any)[key] = value
      }
    }
  }

  // Auto-load from env on init
  loadFromEnv()

  return {
    authMethod,
    anthropicConfig,
    openaiConfig,
    geminiConfig,
    oauthAccount,
    projectRoot,
    provider,
    config,
    isConfigured,
    buildEnvVars,
    getPrimaryModel,
    getHaikuModel,
    getSonnetModel,
    getOpusModel,
    saveSettings,
    updateFromSettingsPanel,
    loadFromEnv
  }
})

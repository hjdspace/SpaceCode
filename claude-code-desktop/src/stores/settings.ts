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

    const anthropicKey = await electronAPI.getEnv('ANTHROPIC_API_KEY')
    const openaiKey = await electronAPI.getEnv('OPENAI_API_KEY')
    const openaiBaseUrl = await electronAPI.getEnv('OPENAI_BASE_URL')
    const anthropicBaseUrl = await electronAPI.getEnv('ANTHROPIC_BASE_URL')
    const openaiModel = await electronAPI.getEnv('OPENAI_MODEL')
    const geminiKey = await electronAPI.getEnv('GEMINI_API_KEY')
    const geminiBaseUrl = await electronAPI.getEnv('GEMINI_BASE_URL')

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
  const saved = loadSavedSettings() || loadLegacySettings()

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

  // Build environment variables for the CLI process
  function buildEnvVars(): Record<string, string> {
    const env: Record<string, string> = {}

    switch (authMethod.value) {
      case 'anthropic_compatible': {
        const c = anthropicConfig.value
        if (c.baseUrl) env.ANTHROPIC_BASE_URL = c.baseUrl
        if (c.apiKey) env.ANTHROPIC_AUTH_TOKEN = c.apiKey
        if (c.haikuModel) env.ANTHROPIC_DEFAULT_FAST_MODEL = c.haikuModel
        if (c.sonnetModel) env.ANTHROPIC_DEFAULT_MODEL = c.sonnetModel
        if (c.opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = c.opusModel
        break
      }
      case 'openai_compatible': {
        const c = openaiConfig.value
        if (c.baseUrl) env.OPENAI_BASE_URL = c.baseUrl
        if (c.apiKey) env.OPENAI_API_KEY = c.apiKey
        if (c.haikuModel) env.OPENAI_DEFAULT_FAST_MODEL = c.haikuModel
        if (c.sonnetModel) env.OPENAI_DEFAULT_MODEL = c.sonnetModel
        if (c.opusModel) env.OPENAI_DEFAULT_OPUS_MODEL = c.opusModel
        break
      }
      case 'gemini_api': {
        const c = geminiConfig.value
        if (c.baseUrl) env.GEMINI_BASE_URL = c.baseUrl
        if (c.apiKey) env.GEMINI_API_KEY = c.apiKey
        if (c.haikuModel) env.GEMINI_DEFAULT_FAST_MODEL = c.haikuModel
        if (c.sonnetModel) env.GEMINI_DEFAULT_MODEL = c.sonnetModel
        if (c.opusModel) env.GEMINI_DEFAULT_OPUS_MODEL = c.opusModel
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
    if (!authMethod.value || authMethod.value === 'openai_compatible') {
      if (envSettings.authMethod) authMethod.value = envSettings.authMethod
    }
    if (envSettings.anthropicConfig) {
      Object.assign(anthropicConfig.value, envSettings.anthropicConfig)
    }
    if (envSettings.openaiConfig) {
      Object.assign(openaiConfig.value, envSettings.openaiConfig)
    }
    if (envSettings.geminiConfig) {
      Object.assign(geminiConfig.value, envSettings.geminiConfig)
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
    saveSettings,
    updateFromSettingsPanel,
    loadFromEnv
  }
})

/**
 * useModelSelector - Model selection logic extracted from ChatInput.vue
 *
 * Manages:
 * - Model list (fetched → configured → default fallback)
 * - Model search filtering
 * - Model selection and effort level
 * - Dropdown menu state
 */
import { ref, computed, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { api } from '@/services/electronAPI'
import { isH5Mode } from '@/services/h5ApiClient'
import { normalizeApiUrl } from '@/utils/apiUrl'

export interface ModelOption {
  label: string
  value: string
}

const AVAILABLE_MODES = ['low', 'medium', 'high', 'max'] as const
export type EffortMode = typeof AVAILABLE_MODES[number]

export function useModelSelector(options?: {
  initialModelValue?: string
  onUpdateModel?: (model: string) => void
  onUpdateEffort?: (effort: string) => void
}) {
  const settingsStore = useSettingsStore()

  // ── State ──────────────────────────────────────────────────────
  const selectedModel = ref('')
  const selectedMode = ref<EffortMode>(settingsStore.effortLevel || 'high')
  const showModelDropdown = ref(false)
  const showModelSubmenu = ref(false)
  const modelSearchQuery = ref('')
  const highlightedModel = ref<string | null>(null)
  const isLoadingModels = ref(false)
  const modelLoadError = ref<string | null>(null)
  const fetchedModels = ref<ModelOption[]>([])

  // Refs for DOM elements (set by the component)
  const modelSearchInput = ref<HTMLInputElement | null>(null)
  const modelSelectorRef = ref<HTMLElement | null>(null)
  const modelListRef = ref<HTMLElement | null>(null)
  const modelSubmenuRef = ref<HTMLElement | null>(null)
  const mainDropdownRef = ref<HTMLElement | null>(null)
  const modelTriggerRowRef = ref<HTMLElement | null>(null)

  let submenuCloseTimer: ReturnType<typeof setTimeout> | null = null

  // ── Pure logic (exported for testing) ──────────────────────────

  /** Get models configured in settings for the current provider */
  function getConfiguredProviderModels(): ModelOption[] {
    const config = getProviderModelConfig()
    if (!config) return []

    const result: ModelOption[] = []
    const seen = new Set<string>()
    for (const value of [config.haikuModel, config.sonnetModel, config.opusModel]) {
      if (value && !seen.has(value)) {
        seen.add(value)
        result.push({ label: value, value })
      }
    }
    return result
  }

  /** Get the raw haiku/sonnet/opus config for the current provider */
  function getProviderModelConfig(): { haikuModel: string; sonnetModel: string; opusModel: string } | null {
    switch (settingsStore.authMethod) {
      case 'anthropic_compatible':
        return settingsStore.anthropicConfig
      case 'openai_compatible':
        return settingsStore.openaiConfig
      case 'gemini_api':
        return settingsStore.geminiConfig
      default:
        return null
    }
  }

  /**
   * Maps a user-selected model value back to its claude-code alias.
   *
   * The claude-code engine uses `haiku` / `sonnet` / `opus` aliases internally.
   * When the user configures `haikuModel=deepseek-v4-flash`, the env var
   * `ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash` is set. Sending the
   * `haiku` alias via set_model control_request causes the engine to resolve
   * it through `getDefaultHaikuModel()`, which reads that env var and returns
   * the correct model. Sending the raw model name (`deepseek-v4-flash`)
   * bypasses alias resolution entirely and may not work correctly.
   *
   * If the same model is configured for multiple slots, the first matching
   * slot is returned (precedence: haiku > sonnet > opus).
   *
   * If no matching slot is found (e.g. a fetched model not in the config),
   * the raw model value is returned as-is — the engine will use it directly.
   */
  function getModelAlias(modelValue: string): string {
    const config = getProviderModelConfig()
    if (!config) return modelValue

    if (config.haikuModel && config.haikuModel === modelValue) return 'haiku'
    if (config.sonnetModel && config.sonnetModel === modelValue) return 'sonnet'
    if (config.opusModel && config.opusModel === modelValue) return 'opus'

    // Not a configured slot model — return as-is for direct passthrough
    return modelValue
  }

  /** Hardcoded default models as last fallback */
  function getDefaultModels(): ModelOption[] {
    const models: ModelOption[] = []
    switch (settingsStore.authMethod) {
      case 'anthropic_compatible':
      case 'claudeai':
      case 'console':
        models.push(
          { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
          { label: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' },
          { label: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
          { label: 'Claude 3 Sonnet', value: 'claude-3-sonnet-20240229' },
          { label: 'Claude 3 Haiku', value: 'claude-3-haiku-20240307' }
        )
        break
      case 'openai_compatible':
        models.push(
          { label: 'GPT-4', value: 'gpt-4' },
          { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
          { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' }
        )
        break
      case 'gemini_api':
        models.push(
          { label: 'Gemini Pro', value: 'gemini-pro' },
          { label: 'Gemini Pro Vision', value: 'gemini-pro-vision' }
        )
        break
    }
    return models
  }

  // ── Computed ───────────────────────────────────────────────────

  /** Available models — configured models (haiku/sonnet/opus) take priority.
   *
   *  Issue 2 fix: Previously, fetched models from API took priority, causing
   *  a mismatch between the input-box model list and the actual model used
   *  by the engine. Now configured models always take priority. If no models
   *  are configured, the list is empty and the UI should prompt the user to
   *  configure models in the settings page.
   */
  const availableModels = computed<ModelOption[]>(() => {
    const configured = getConfiguredProviderModels()
    if (configured.length > 0) return configured
    // Edge case: user has API access but hasn't configured haiku/sonnet/opus yet.
    // Show fetched models so they can still pick one.
    if (fetchedModels.value.length > 0) return [...fetchedModels.value]
    return []
  })

  /** Whether the user has configured at least one model in settings.
   *  Used by the UI to show a "please configure models" prompt.
   */
  const hasConfiguredModels = computed(() => {
    const configured = getConfiguredProviderModels()
    return configured.length > 0
  })

  /** Search-filtered model list */
  const filteredModels = computed<ModelOption[]>(() => {
    if (!modelSearchQuery.value) return availableModels.value
    const query = modelSearchQuery.value.toLowerCase()
    return availableModels.value.filter(model =>
      model.label.toLowerCase().includes(query) ||
      model.value.toLowerCase().includes(query)
    )
  })

  /** Whether we can refresh the model list from API */
  const canRefreshModels = computed(() => {
    if (isH5Mode()) return false
    switch (settingsStore.authMethod) {
      case 'anthropic_compatible':
        return !!(settingsStore.anthropicConfig.baseUrl && settingsStore.anthropicConfig.apiKey)
      case 'openai_compatible':
        return !!(settingsStore.openaiConfig.baseUrl && settingsStore.openaiConfig.apiKey)
      case 'gemini_api':
        return !!(settingsStore.geminiConfig.baseUrl && settingsStore.geminiConfig.apiKey)
      default:
        return false
    }
  })

  /** Display label for the currently selected model */
  const selectedModelLabel = computed(() => {
    const model = availableModels.value.find(m => m.value === selectedModel.value)
    return model?.label || selectedModel.value || 'Select Model'
  })

  const availableModes = AVAILABLE_MODES

  // ── Actions ────────────────────────────────────────────────────

  /** Fetch model list from the provider's BASE_URL */
  async function fetchModelsFromBaseUrl() {
    if (!canRefreshModels.value) return

    isLoadingModels.value = true
    modelLoadError.value = null

    try {
      let baseUrl = ''
      let apiKey = ''
      let provider = ''

      switch (settingsStore.authMethod) {
        case 'anthropic_compatible':
          baseUrl = settingsStore.anthropicConfig.baseUrl || 'https://api.anthropic.com'
          apiKey = settingsStore.anthropicConfig.apiKey
          provider = 'anthropic'
          break
        case 'openai_compatible':
          baseUrl = settingsStore.openaiConfig.baseUrl || 'https://api.openai.com/v1'
          apiKey = settingsStore.openaiConfig.apiKey
          provider = 'openai'
          break
        case 'gemini_api':
          baseUrl = settingsStore.geminiConfig.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
          apiKey = settingsStore.geminiConfig.apiKey
          provider = 'gemini'
          break
      }

      if (!apiKey) {
        modelLoadError.value = 'Please configure API key first'
        return
      }

      const normalizedUrl = normalizeApiUrl(baseUrl, provider)
      const url = `${normalizedUrl}/models`
      const result = await api.httpFetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      })

      if (!result) {
        modelLoadError.value = 'HTTP proxy unavailable'
        return
      }

      if (result.ok) {
        const data = JSON.parse(result.data)
        let models: any[] = []

        if (Array.isArray(data)) {
          models = data
        } else if (data.data && Array.isArray(data.data)) {
          models = data.data
        } else if (data.models && Array.isArray(data.models)) {
          models = data.models
        }

        if (models.length > 0) {
          fetchedModels.value = models.map((m: any) => ({
            label: m.name || m.id || String(m),
            value: m.id || m.name || String(m)
          }))
        }
      } else {
        modelLoadError.value = `Fetch failed (status ${result.status})`
      }
    } catch (error) {
      console.error('[useModelSelector] Failed to fetch models:', error)
      modelLoadError.value = error instanceof Error ? error.message : 'Network error'
    } finally {
      isLoadingModels.value = false
    }
  }

  function refreshModels() {
    fetchModelsFromBaseUrl()
  }

  function selectModel(modelValue: string) {
    selectedModel.value = modelValue
    showModelSubmenu.value = false
    showModelDropdown.value = false
    modelSearchQuery.value = ''
    options?.onUpdateModel?.(modelValue)
  }

  function selectMode(mode: EffortMode) {
    selectedMode.value = mode
    options?.onUpdateEffort?.(mode)
  }

  function modeLabel(mode: EffortMode): string {
    switch (mode) {
      case 'low': return 'Low'
      case 'medium': return 'Medium'
      case 'high': return 'High'
      case 'max': return 'Extra High'
    }
  }

  function closeModelDropdown() {
    showModelDropdown.value = false
    showModelSubmenu.value = false
    modelSearchQuery.value = ''
  }

  function toggleModelDropdown() {
    showModelDropdown.value = !showModelDropdown.value
    if (!showModelDropdown.value) {
      showModelSubmenu.value = false
    }
  }

  function toggleModelSubmenu() {
    showModelSubmenu.value = !showModelSubmenu.value
  }

  function onCurrentModelRowLeave() {
    if (submenuCloseTimer) {
      clearTimeout(submenuCloseTimer)
      submenuCloseTimer = null
    }
    submenuCloseTimer = setTimeout(() => {
      showModelSubmenu.value = false
    }, 120)
  }

  function onModelSubmenuEnter() {
    if (submenuCloseTimer) {
      clearTimeout(submenuCloseTimer)
      submenuCloseTimer = null
    }
  }

  function onModelSubmenuLeave() {
    if (submenuCloseTimer) clearTimeout(submenuCloseTimer)
    submenuCloseTimer = setTimeout(() => {
      showModelSubmenu.value = false
    }, 120)
  }

  function closeModelSubmenu() {
    showModelSubmenu.value = false
  }

  function navigateModels(direction: number) {
    const models = filteredModels.value
    if (models.length === 0) return

    const currentIndex = models.findIndex(m => m.value === highlightedModel.value)
    let newIndex = currentIndex + direction

    if (newIndex < 0) newIndex = models.length - 1
    if (newIndex >= models.length) newIndex = 0

    highlightedModel.value = models[newIndex].value
  }

  function handleModelKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement

    if (!showModelDropdown.value) {
      const isModelSelectorFocused = modelSelectorRef.value?.contains(target)
      const isInSearchInput = target === modelSearchInput.value

      if ((event.key === 'Enter' || event.key === ' ') && (isModelSelectorFocused || isInSearchInput)) {
        event.preventDefault()
        toggleModelDropdown()
      }
      return
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        closeModelDropdown()
        break
      case 'ArrowDown':
        event.preventDefault()
        navigateModels(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        navigateModels(-1)
        break
      case 'Enter':
        event.preventDefault()
        if (highlightedModel.value) {
          selectModel(highlightedModel.value)
        }
        break
    }
  }

  /** Initialize with the given or default model value.
   *  If no model is configured, selectedModel stays empty — the UI should
   *  detect hasConfiguredModels === false and show a prompt.
   */
  function initialize(modelValue?: string) {
    const config = settingsStore.config
    selectedModel.value = modelValue || config.model || availableModels.value[0]?.value || ''
    // Still fetch models from API as a background supplement, but configured
    // models will always take priority in availableModels.
    fetchModelsFromBaseUrl()
  }

  // ── Watchers ───────────────────────────────────────────────────

  watch(() => settingsStore.authMethod, () => {
    fetchedModels.value = []
    modelLoadError.value = null
    fetchModelsFromBaseUrl()
  })

  watch(() => settingsStore.effortLevel, (newLevel) => {
    if (newLevel && newLevel !== selectedMode.value) {
      selectedMode.value = newLevel
    }
  }, { immediate: true })

  watch(showModelDropdown, (open) => {
    if (!open) modelSearchQuery.value = ''
  })

  watch(showModelSubmenu, (open) => {
    if (open) {
      // Auto-focus search input when submenu opens
      // (caller should use nextTick + modelSearchInput.focus())
    } else {
      modelSearchQuery.value = ''
    }
  })

  return {
    // State
    selectedModel,
    selectedMode,
    showModelDropdown,
    showModelSubmenu,
    modelSearchQuery,
    highlightedModel,
    isLoadingModels,
    modelLoadError,
    fetchedModels,

    // DOM refs (to be bound by the component)
    modelSearchInput,
    modelSelectorRef,
    modelListRef,
    modelSubmenuRef,
    mainDropdownRef,
    modelTriggerRowRef,

    // Computed
    availableModels,
    hasConfiguredModels,
    filteredModels,
    canRefreshModels,
    selectedModelLabel,
    availableModes,

    // Actions
    selectModel,
    selectMode,
    modeLabel,
    closeModelDropdown,
    toggleModelDropdown,
    toggleModelSubmenu,
    onCurrentModelRowLeave,
    onModelSubmenuEnter,
    onModelSubmenuLeave,
    closeModelSubmenu,
    navigateModels,
    handleModelKeydown,
    fetchModelsFromBaseUrl,
    refreshModels,
    initialize,
    getConfiguredProviderModels,
    getDefaultModels,
    getModelAlias,
  }
}

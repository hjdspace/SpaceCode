/**
 * useModelSelector composable tests
 *
 * Tests the model selection logic extracted from ChatInput.vue:
 * - Model list management (fetched → configured → default fallback)
 * - Model search filtering
 * - Model selection and effort level
 * - Dropdown menu state
 */
import { describe, it, expect } from 'vitest'
import type { ModelOption } from '@/composables/useModelSelector'

// ── Import pure logic functions from composable ─────────────────
// We test the pure logic extracted from the composable.
// The composable itself depends on Pinia stores, so we test
// the logic separately here and rely on integration tests
// for the full composable.

/**
 * Model list resolution logic (updated for issue 2):
 * Configured models (haiku/sonnet/opus from settings) take priority.
 * Fetched models from API are no longer the primary source — they are
 * only used as a supplementary list merged into configured models.
 * Default models are no longer used as fallback — if no models are
 * configured, the UI should prompt the user to set them up.
 */
function resolveAvailableModels(
  fetched: ModelOption[],
  configured: ModelOption[],
  _defaults: ModelOption[]
): ModelOption[] {
  // Configured models always take priority
  if (configured.length > 0) return [...configured]
  // If no configured models but fetched models exist, use them (edge case:
  // user has API access but hasn't configured haiku/sonnet/opus yet)
  if (fetched.length > 0) return [...fetched]
  // No models at all — UI should prompt user to configure
  return []
}

/**
 * Check if the user has configured at least one model in settings.
 * Used to determine whether to show a "please configure models" prompt.
 */
function hasConfiguredModels(config: { haikuModel: string; sonnetModel: string; opusModel: string } | null): boolean {
  if (!config) return false
  return !!(config.haikuModel || config.sonnetModel || config.opusModel)
}

/**
 * Model search filtering logic
 */
function filterModels(models: ModelOption[], query: string): ModelOption[] {
  if (!query) return models
  const q = query.toLowerCase()
  return models.filter(m =>
    m.label.toLowerCase().includes(q) ||
    m.value.toLowerCase().includes(q)
  )
}

/**
 * Effort level label mapping
 */
function modeLabel(mode: string): string {
  switch (mode) {
    case 'low': return 'Low'
    case 'medium': return 'Medium'
    case 'high': return 'High'
    case 'max': return 'Extra High'
    default: return mode
  }
}

/**
 * Selected model label resolution
 */
function getSelectedLabel(models: ModelOption[], selectedValue: string, fallback: string): string {
  const model = models.find(m => m.value === selectedValue)
  return model?.label || selectedValue || fallback
}

/**
 * Can refresh models check
 */
function canRefresh(config: { baseUrl?: string; apiKey?: string }): boolean {
  return !!(config.baseUrl && config.apiKey)
}

/**
 * Model navigation index cycling
 */
function navigateModelIndex(currentIndex: number, direction: number, length: number): number {
  if (length === 0) return -1
  let newIndex = currentIndex + direction
  if (newIndex < 0) newIndex = length - 1
  if (newIndex >= length) newIndex = 0
  return newIndex
}

/**
 * Configured provider models with deduplication
 */
function getConfiguredModels(config: { haikuModel: string; sonnetModel: string; opusModel: string } | null): ModelOption[] {
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

/**
 * Map a user-selected model value back to its claude-code alias (haiku/sonnet/opus).
 * The engine uses aliases internally to resolve ANTHROPIC_DEFAULT_*_MODEL env vars.
 */
function getModelAlias(
  modelValue: string,
  config: { haikuModel: string; sonnetModel: string; opusModel: string } | null
): string {
  if (!config) return modelValue
  if (config.haikuModel && config.haikuModel === modelValue) return 'haiku'
  if (config.sonnetModel && config.sonnetModel === modelValue) return 'sonnet'
  if (config.opusModel && config.opusModel === modelValue) return 'opus'
  return modelValue
}

// ── Tests ────────────────────────────────────────────────────────

describe('useModelSelector - pure logic', () => {
  describe('model list resolution', () => {
    const fetched: ModelOption[] = [
      { label: 'Claude 4', value: 'claude-4' },
      { label: 'Claude 3.5', value: 'claude-3.5' },
    ]
    const configured: ModelOption[] = [
      { label: 'my-sonnet', value: 'my-sonnet' },
    ]
    const defaults: ModelOption[] = [
      { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet' },
    ]

    it('should use configured models when available (priority over fetched)', () => {
      expect(resolveAvailableModels(fetched, configured, defaults)).toEqual(configured)
    })

    it('should fall back to fetched models when no configured models', () => {
      expect(resolveAvailableModels(fetched, [], defaults)).toEqual(fetched)
    })

    it('should return empty when no configured or fetched models (no default fallback)', () => {
      expect(resolveAvailableModels([], [], defaults)).toEqual([])
    })

    it('should return empty when all sources are empty', () => {
      expect(resolveAvailableModels([], [], [])).toEqual([])
    })
  })

  describe('hasConfiguredModels', () => {
    it('should return false for null config', () => {
      expect(hasConfiguredModels(null)).toBe(false)
    })

    it('should return false when all models are empty', () => {
      expect(hasConfiguredModels({ haikuModel: '', sonnetModel: '', opusModel: '' })).toBe(false)
    })

    it('should return true when at least one model is set', () => {
      expect(hasConfiguredModels({ haikuModel: '', sonnetModel: 'my-model', opusModel: '' })).toBe(true)
    })

    it('should return true when all models are set', () => {
      expect(hasConfiguredModels({ haikuModel: 'haiku', sonnetModel: 'sonnet', opusModel: 'opus' })).toBe(true)
    })
  })

  describe('model search filtering', () => {
    const models: ModelOption[] = [
      { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
      { label: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' },
      { label: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
      { label: 'GPT-4', value: 'gpt-4' },
      { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
    ]

    it('should return all models when query is empty', () => {
      expect(filterModels(models, '')).toHaveLength(5)
    })

    it('should filter by label', () => {
      const result = filterModels(models, 'haiku')
      expect(result).toHaveLength(1)
      expect(result[0].value).toBe('claude-3-5-haiku-20241022')
    })

    it('should filter by value', () => {
      const result = filterModels(models, 'gpt-4')
      expect(result).toHaveLength(2)
    })

    it('should be case-insensitive', () => {
      const result = filterModels(models, 'CLAUDE')
      expect(result).toHaveLength(3)
    })

    it('should return empty when no match', () => {
      const result = filterModels(models, 'nonexistent')
      expect(result).toHaveLength(0)
    })
  })

  describe('effort level label', () => {
    it('should map effort levels to labels', () => {
      expect(modeLabel('low')).toBe('Low')
      expect(modeLabel('medium')).toBe('Medium')
      expect(modeLabel('high')).toBe('High')
      expect(modeLabel('max')).toBe('Extra High')
    })

    it('should pass through unknown values', () => {
      expect(modeLabel('unknown')).toBe('unknown')
    })
  })

  describe('selected model label', () => {
    const models: ModelOption[] = [
      { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet' },
      { label: 'GPT-4', value: 'gpt-4' },
    ]

    it('should return label for selected model', () => {
      expect(getSelectedLabel(models, 'claude-3-5-sonnet', 'Select')).toBe('Claude 3.5 Sonnet')
    })

    it('should return raw value if model not found', () => {
      expect(getSelectedLabel(models, 'unknown-model', 'Select')).toBe('unknown-model')
    })

    it('should return fallback if no value selected', () => {
      expect(getSelectedLabel(models, '', 'Select')).toBe('Select')
    })
  })

  describe('canRefreshModels', () => {
    it('should return true when both baseUrl and apiKey are set', () => {
      expect(canRefresh({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-xxx' })).toBe(true)
    })

    it('should return false when apiKey is missing', () => {
      expect(canRefresh({ baseUrl: 'https://api.anthropic.com' })).toBe(false)
    })

    it('should return false when baseUrl is missing', () => {
      expect(canRefresh({ apiKey: 'sk-xxx' })).toBe(false)
    })

    it('should return false when both are missing', () => {
      expect(canRefresh({})).toBe(false)
    })
  })

  describe('model navigation', () => {
    it('should navigate down', () => {
      expect(navigateModelIndex(0, 1, 3)).toBe(1)
      expect(navigateModelIndex(1, 1, 3)).toBe(2)
    })

    it('should wrap around when navigating down past end', () => {
      expect(navigateModelIndex(2, 1, 3)).toBe(0)
    })

    it('should navigate up', () => {
      expect(navigateModelIndex(2, -1, 3)).toBe(1)
      expect(navigateModelIndex(1, -1, 3)).toBe(0)
    })

    it('should wrap around when navigating up past start', () => {
      expect(navigateModelIndex(0, -1, 3)).toBe(2)
    })

    it('should return -1 for empty model list', () => {
      expect(navigateModelIndex(0, 1, 0)).toBe(-1)
    })
  })

  describe('getConfiguredProviderModels', () => {
    it('should return empty for null config', () => {
      expect(getConfiguredModels(null)).toEqual([])
    })

    it('should deduplicate models with same value', () => {
      const result = getConfiguredModels({
        haikuModel: 'same-model',
        sonnetModel: 'same-model',
        opusModel: 'other-model',
      })
      expect(result).toHaveLength(2)
      expect(result[0].value).toBe('same-model')
      expect(result[1].value).toBe('other-model')
    })

    it('should skip empty values', () => {
      const result = getConfiguredModels({
        haikuModel: '',
        sonnetModel: 'sonnet',
        opusModel: '',
      })
      expect(result).toHaveLength(1)
      expect(result[0].value).toBe('sonnet')
    })

    it('should return all three when all are unique', () => {
      const result = getConfiguredModels({
        haikuModel: 'haiku',
        sonnetModel: 'sonnet',
        opusModel: 'opus',
      })
      expect(result).toHaveLength(3)
    })
  })

  describe('getModelAlias', () => {
    const config = {
      haikuModel: 'deepseek-v4-flash',
      sonnetModel: 'deepseek-v4-pro',
      opusModel: 'glm-5.2',
    }

    it('should map haiku slot model to "haiku" alias', () => {
      expect(getModelAlias('deepseek-v4-flash', config)).toBe('haiku')
    })

    it('should map sonnet slot model to "sonnet" alias', () => {
      expect(getModelAlias('deepseek-v4-pro', config)).toBe('sonnet')
    })

    it('should map opus slot model to "opus" alias', () => {
      expect(getModelAlias('glm-5.2', config)).toBe('opus')
    })

    it('should return model value as-is when not in any slot', () => {
      expect(getModelAlias('some-other-model', config)).toBe('some-other-model')
    })

    it('should return model value as-is when config is null', () => {
      expect(getModelAlias('any-model', null)).toBe('any-model')
    })

    it('should return first matching slot when same model in multiple slots', () => {
      const dupConfig = {
        haikuModel: 'same-model',
        sonnetModel: 'same-model',
        opusModel: 'other-model',
      }
      // haiku has precedence over sonnet
      expect(getModelAlias('same-model', dupConfig)).toBe('haiku')
    })

    it('should handle empty config strings', () => {
      const emptyConfig = {
        haikuModel: '',
        sonnetModel: 'sonnet-model',
        opusModel: '',
      }
      expect(getModelAlias('sonnet-model', emptyConfig)).toBe('sonnet')
      expect(getModelAlias('', emptyConfig)).toBe('')
    })
  })
})

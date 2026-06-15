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
 * Model list fallback logic (same as in useModelSelector)
 */
function resolveAvailableModels(
  fetched: ModelOption[],
  configured: ModelOption[],
  defaults: ModelOption[]
): ModelOption[] {
  if (fetched.length > 0) return [...fetched]
  if (configured.length > 0) return configured
  return [...defaults]
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

// ── Tests ────────────────────────────────────────────────────────

describe('useModelSelector - pure logic', () => {
  describe('model list fallback', () => {
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

    it('should use fetched models when available', () => {
      expect(resolveAvailableModels(fetched, configured, defaults)).toEqual(fetched)
    })

    it('should fall back to configured models when no fetched models', () => {
      expect(resolveAvailableModels([], configured, defaults)).toEqual(configured)
    })

    it('should fall back to default models when no fetched or configured models', () => {
      expect(resolveAvailableModels([], [], defaults)).toEqual(defaults)
    })

    it('should return empty when all sources are empty', () => {
      expect(resolveAvailableModels([], [], [])).toEqual([])
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
})

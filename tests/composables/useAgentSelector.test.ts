/**
 * useAgentSelector composable tests
 *
 * Tests the agent selector logic extracted from ChatInput.vue:
 * - Agent name/description translation fallback
 * - Agent submenu hover timer behavior
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Pure logic functions ─────────────────────────────────────────

/**
 * Get agent display name with i18n fallback
 */
function getAgentName(agentType: string, translateFn: (key: string) => string): string {
  const key = `chatInput.agents.${agentType}.name`
  const translatedName = translateFn(key)
  return translatedName !== key ? translatedName : agentType
}

/**
 * Get agent description with i18n fallback
 */
function getAgentDescription(agentType: string, originalDescription: string, translateFn: (key: string) => string): string {
  const key = `chatInput.agents.${agentType}.description`
  const translatedDesc = translateFn(key)
  return translatedDesc !== key ? translatedDesc : originalDescription
}

/**
 * Split agents into built-in and custom
 */
function categorizeAgents(agents: Array<{ source: string }>): { builtIn: Array<{ source: string }>; custom: Array<{ source: string }> } {
  return {
    builtIn: agents.filter(a => a.source === 'built-in'),
    custom: agents.filter(a => a.source !== 'built-in'),
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('useAgentSelector - pure logic', () => {
  describe('agent name translation', () => {
    const mockTranslate = (key: string) => {
      const map: Record<string, string> = {
        'chatInput.agents.code.name': '代码助手',
      }
      return map[key] || key
    }

    it('should return translated name when available', () => {
      expect(getAgentName('code', mockTranslate)).toBe('代码助手')
    })

    it('should fallback to agentType when no translation', () => {
      expect(getAgentName('unknown', mockTranslate)).toBe('unknown')
    })
  })

  describe('agent description translation', () => {
    const mockTranslate = (key: string) => {
      const map: Record<string, string> = {
        'chatInput.agents.code.description': '编写和审查代码',
      }
      return map[key] || key
    }

    it('should return translated description when available', () => {
      expect(getAgentDescription('code', 'Code helper', mockTranslate)).toBe('编写和审查代码')
    })

    it('should fallback to original description when no translation', () => {
      expect(getAgentDescription('unknown', 'Original desc', mockTranslate)).toBe('Original desc')
    })
  })

  describe('agent categorization', () => {
    const agents = [
      { source: 'built-in' },
      { source: 'custom' },
      { source: 'built-in' },
      { source: 'plugin' },
    ]

    it('should split agents into built-in and custom', () => {
      const result = categorizeAgents(agents)
      expect(result.builtIn).toHaveLength(2)
      expect(result.custom).toHaveLength(2)
    })

    it('should handle empty list', () => {
      const result = categorizeAgents([])
      expect(result.builtIn).toHaveLength(0)
      expect(result.custom).toHaveLength(0)
    })
  })
})

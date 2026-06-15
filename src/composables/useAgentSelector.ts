/**
 * useAgentSelector - Agent selector logic extracted from ChatInput.vue
 *
 * Manages:
 * - Agent selection state
 * - Agent submenu hover timer
 * - Agent name/description i18n helpers
 */
import { ref, computed, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useI18n } from 'vue-i18n'

// ── Pure logic (exported for testing) ──────────────────────────

/** Get agent display name with i18n fallback */
export function getAgentName(agentType: string, translateFn: (key: string) => string): string {
  const key = `chatInput.agents.${agentType}.name`
  const translatedName = translateFn(key)
  return translatedName !== key ? translatedName : agentType
}

/** Get agent description with i18n fallback */
export function getAgentDescription(agentType: string, originalDescription: string, translateFn: (key: string) => string): string {
  const key = `chatInput.agents.${agentType}.description`
  const translatedDesc = translateFn(key)
  return translatedDesc !== key ? translatedDesc : originalDescription
}

/** Split agents into built-in and custom */
export function categorizeAgents<T extends { source: string }>(agents: T[]): { builtIn: T[]; custom: T[] } {
  return {
    builtIn: agents.filter(a => a.source === 'built-in'),
    custom: agents.filter(a => a.source !== 'built-in'),
  }
}

// ── Composable ─────────────────────────────────────────────────

export function useAgentSelector(options?: {
  onUpdateAgent?: (agent: string) => void
}) {
  const chatStore = useChatStore()
  const { t } = useI18n()

  const selectedAgent = ref<string>(chatStore.currentAgent || '')
  const showAgentSubmenu = ref(false)
  let agentSubmenuTimer: ReturnType<typeof setTimeout> | null = null

  // Sync with chat store
  watch(() => chatStore.currentAgent, (newAgent) => {
    selectedAgent.value = newAgent || ''
  })

  // Computed agent lists
  const builtInAgents = computed(() => chatStore.availableAgents.filter(a => a.source === 'built-in'))
  const customAgents = computed(() => chatStore.availableAgents.filter(a => a.source !== 'built-in'))

  // Hover timer management
  function handleTriggerEnter() {
    if (agentSubmenuTimer) {
      clearTimeout(agentSubmenuTimer)
      agentSubmenuTimer = null
    }
    showAgentSubmenu.value = true
  }

  function handleTriggerLeave() {
    agentSubmenuTimer = setTimeout(() => {
      showAgentSubmenu.value = false
    }, 150)
  }

  function handleSubmenuEnter() {
    if (agentSubmenuTimer) {
      clearTimeout(agentSubmenuTimer)
      agentSubmenuTimer = null
    }
    showAgentSubmenu.value = true
  }

  function handleSubmenuLeave() {
    agentSubmenuTimer = setTimeout(() => {
      showAgentSubmenu.value = false
    }, 150)
  }

  function selectAgent(agentType: string) {
    selectedAgent.value = agentType
    showAgentSubmenu.value = false
    options?.onUpdateAgent?.(agentType)
  }

  // i18n helpers
  function getAgentDisplayName(agentType: string): string {
    return getAgentName(agentType, t)
  }

  function getAgentDisplayDescription(agentType: string, originalDescription: string): string {
    return getAgentDescription(agentType, originalDescription, t)
  }

  return {
    selectedAgent,
    showAgentSubmenu,
    builtInAgents,
    customAgents,
    handleTriggerEnter,
    handleTriggerLeave,
    handleSubmenuEnter,
    handleSubmenuLeave,
    selectAgent,
    getAgentDisplayName,
    getAgentDisplayDescription,
  }
}

<template>
  <Transition name="ws-fade">
    <div v-if="visible" class="work-shortcuts">
      <div class="ws-header">
        <span class="ws-title">{{ t('work.shortcutsTitle') }}</span>
        <button class="ws-more" @click="openGallery">
          <LayoutGrid :size="13" />
          <span>{{ t('work.shortcutsMore') }}</span>
        </button>
      </div>
      <div class="ws-cards">
        <button
          v-for="a in shortcuts"
          :key="a.name"
          class="ws-card"
          :disabled="starting"
          @click="selectAssistant(a)"
        >
          <div class="ws-avatar" :style="workAvatarStyle(a.category)">
            <component :is="workAssistantIcon(a.avatar)" :size="18" />
          </div>
          <span class="ws-name">{{ workDisplayName(a.name) }}</span>
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { LayoutGrid } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useAgentsStore, type AgentDef } from '@/stores/agents'
import { workAssistantIcon, workAvatarStyle, workDisplayName } from '@/utils/workAssistant'

const { t } = useI18n()
const appStore = useAppStore()
const chatStore = useChatStore()
const agentsStore = useAgentsStore()

const starting = ref(false)

const workAssistants = computed(() => agentsStore.libraryAgents.filter(a => a.mode === 'work'))

/**
 * 常用快捷卡片：按分类去重取代表，最多 6 个，保证视觉多样性。
 * 若去重后不足 6 个，回补剩余助手。
 */
const shortcuts = computed<AgentDef[]>(() => {
  const list = workAssistants.value
  const seen = new Set<string>()
  const picked: AgentDef[] = []
  for (const a of list) {
    const cat = a.category || 'general'
    if (seen.has(cat)) continue
    seen.add(cat)
    picked.push(a)
    if (picked.length >= 6) break
  }
  if (picked.length < 6) {
    for (const a of list) {
      if (picked.includes(a)) continue
      picked.push(a)
      if (picked.length >= 6) break
    }
  }
  return picked
})

/** 空会话且未选助手时展示；选中助手后让位给 RecommendedPrompts */
const visible = computed(() =>
  appStore.mode === 'work' &&
  chatStore.currentSession?.mode === 'work' &&
  chatStore.displayMessages.length === 0 &&
  !chatStore.currentSession?.assistantId &&
  shortcuts.value.length > 0
)

function openGallery() {
  appStore.showWorkGallery = true
}

async function selectAssistant(a: AgentDef) {
  if (starting.value) return
  starting.value = true
  try {
    // 当前已是空的 work 会话且未选助手时，直接在当前会话上切换助手，
    // 而不是新开一个会话（符合用户在输入框上方快速选择的直觉）。
    await chatStore.switchWorkAssistant({
      name: a.name,
      skills: a.skills,
      permission: a.permission,
    })
  } catch (err) {
    console.error('[WorkShortcuts] Failed to switch assistant:', err)
  } finally {
    starting.value = false
  }
}

onMounted(() => {
  if (agentsStore.libraryAgents.length === 0) {
    agentsStore.fetchLibrary(appStore.workWorkspace || appStore.projectRoot || undefined)
  }
})
</script>

<style lang="scss" scoped>
.work-shortcuts {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 12px;
  margin: 0 auto;
  max-width: 720px;
  padding: 14px 18px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-md);
}

.ws-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.ws-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ws-more {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 11.5px;
  color: var(--text-secondary);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full, 999px);
  cursor: pointer;
  font-family: inherit;
  transition: all var(--transition-fast);
  &:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
}

.ws-cards {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}

.ws-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 12px 6px;
  background: var(--bg-secondary, var(--bg-primary));
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-family: inherit;
  transition: all var(--transition-fast);
  &:hover:not(:disabled) {
    border-color: var(--accent-primary);
    background: var(--surface-glass-hover);
    transform: translateY(-1px);
  }
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.ws-avatar {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
}

.ws-name {
  font-size: 11.5px;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.ws-fade-enter-active,
.ws-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.ws-fade-enter-from,
.ws-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 640px) {
  .ws-cards {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>

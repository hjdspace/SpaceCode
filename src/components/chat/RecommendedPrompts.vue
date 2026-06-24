<template>
  <Transition name="rp-fade">
    <div v-if="visible" class="recommended-prompts">
      <div class="rp-header">
        <span class="rp-avatar" :style="assistant ? workAvatarStyle(assistant.category) : {}">
          <component :is="workAssistantIcon(assistant?.avatar)" :size="18" />
        </span>
        <div class="rp-titles">
          <div class="rp-name">{{ assistantName }}</div>
          <div class="rp-hint">{{ t('work.promptHint') }}</div>
        </div>
      </div>
      <div class="rp-chips">
        <button
          v-for="(p, i) in prompts"
          :key="i"
          class="rp-chip"
          @click="usePrompt(p)"
        >
          {{ p }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useAgentsStore } from '@/stores/agents'
import { workAssistantIcon, workAvatarStyle, workDisplayName } from '@/utils/workAssistant'

const { t, locale } = useI18n()
const appStore = useAppStore()
const chatStore = useChatStore()
const agentsStore = useAgentsStore()

const assistant = computed(() => {
  const id = chatStore.currentSession?.assistantId || chatStore.currentAgent
  if (!id) return undefined
  return agentsStore.libraryAgents.find(a => a.name === id && a.mode === 'work')
})

const isZh = computed(() => String(locale.value).toLowerCase().startsWith('zh'))

const assistantName = computed(() => {
  const a = assistant.value
  if (!a) return ''
  return workDisplayName(a.name)
})

const prompts = computed<string[]>(() => {
  const a = assistant.value
  if (!a) return []
  const zh = a.recommendedPromptsZh
  return (isZh.value && zh && zh.length ? zh : a.recommendedPrompts) || []
})

const visible = computed(() =>
  appStore.mode === 'work' &&
  chatStore.currentSession?.mode === 'work' &&
  chatStore.displayMessages.length === 0 &&
  prompts.value.length > 0
)

function usePrompt(p: string) {
  appStore.pushToInput({ text: p })
}

onMounted(() => {
  if (agentsStore.libraryAgents.length === 0) {
    agentsStore.fetchLibrary(appStore.workWorkspace || appStore.projectRoot || undefined)
  }
})
</script>

<style lang="scss" scoped>
.recommended-prompts {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 12px;
  margin: 0 auto;
  max-width: 720px;
  padding: 16px 18px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-md);
}

.rp-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.rp-avatar {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
}

.rp-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.rp-hint { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

.rp-chips { display: flex; flex-wrap: wrap; gap: 8px; }

.rp-chip {
  padding: 8px 12px;
  font-size: 12.5px;
  color: var(--text-secondary);
  background: var(--bg-secondary, var(--bg-primary));
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: all var(--transition-fast);
  &:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: var(--surface-glass-hover);
  }
}

.rp-fade-enter-active, .rp-fade-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.rp-fade-enter-from, .rp-fade-leave-to { opacity: 0; transform: translateY(8px); }
</style>

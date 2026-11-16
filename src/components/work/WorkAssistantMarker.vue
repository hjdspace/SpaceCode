<template>
  <div
    ref="rootRef"
    class="work-assistant-marker"
    :class="{ 'is-open': open }"
    data-test="work-assistant-marker"
  >
    <button
      type="button"
      class="wam-trigger"
      :class="{ open }"
      :disabled="readonly"
      :aria-expanded="open"
      :title="readonly ? undefined : t('work.routeChange')"
      data-test="work-assistant-marker-trigger"
      @click="toggle"
    >
      <Sparkles :size="13" />
      <span class="wam-text">{{ markerText }}</span>
      <ChevronDown v-if="!readonly" :size="12" class="wam-chevron" :class="{ open }" />
    </button>

    <div v-if="open" class="wam-popover" data-test="work-assistant-marker-popover">
      <p class="wam-hint">{{ t('work.routeReselectHint') }}</p>
      <div class="wam-search">
        <Search :size="13" />
        <input
          v-model="query"
          :placeholder="t('work.searchAssistants')"
          data-test="work-assistant-marker-search"
          @keydown.escape="close"
        />
      </div>
      <div class="wam-list">
        <div v-if="loading" class="wam-empty">{{ t('common.loading') }}</div>
        <div v-else-if="!filtered.length" class="wam-empty">{{ t('work.noAssistants') }}</div>
        <button
          v-for="assistant in filtered"
          :key="assistant.name"
          type="button"
          class="wam-option"
          :class="{ current: assistant.name === routing.assistant }"
          :disabled="busy"
          data-test="work-assistant-marker-option"
          @click="choose(assistant)"
        >
          <span class="wam-avatar" :style="workAvatarStyle(assistant.category)">
            <component :is="workAssistantIcon(assistant.avatar)" :size="15" />
          </span>
          <span class="wam-option-body">
            <span class="wam-option-name">{{ workDisplayName(assistant.name) }}</span>
            <span v-if="displayDesc(assistant)" class="wam-option-desc">{{ displayDesc(assistant) }}</span>
          </span>
          <Check v-if="assistant.name === routing.assistant" :size="14" class="wam-check" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, Search, Sparkles } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useAgentsStore, type AgentDef } from '@/stores/agents'
import type { WorkRoutingState } from '@/types/workRouting'
import {
  workAssistantIcon,
  workAvatarStyle,
  workDisplayName,
  workAssistantDescription,
  matchesWorkAssistantQuery,
} from '@/utils/workAssistant'

const props = defineProps<{
  routing: WorkRoutingState
  readonly?: boolean
  busy?: boolean
  /** 来源会话的工作目录：改选出的新会话与技能安装都跟着它走。 */
  workspace?: string
}>()

const emit = defineEmits<{
  reselect: [name: string]
}>()

const { t, locale } = useI18n()
const appStore = useAppStore()
const agentsStore = useAgentsStore()

const rootRef = ref<HTMLElement | null>(null)
const open = ref(false)
const query = ref('')
const loading = ref(false)

const markerText = computed(() => {
  if (props.routing.outcome === 'general') return t('work.routeMarkerGeneral')
  if (!props.routing.assistant) return ''
  const key = props.routing.outcome === 'auto' ? 'work.routeMarkerAuto' : 'work.routeMarkerPicked'
  return t(key, { name: workDisplayName(props.routing.assistant) })
})

const isZh = computed(() => String(locale.value).toLowerCase().startsWith('zh'))

function displayDesc(agent: AgentDef): string {
  return workAssistantDescription(agent, isZh.value)
}

/** 与路由候选集同口径：库内 ∪ 已安装，已安装版本优先（带本机真实技能与权限）。 */
const workAssistants = computed<AgentDef[]>(() => {
  const byName = new Map<string, AgentDef>()
  for (const agent of agentsStore.libraryAgents) {
    if (agent.mode === 'work' && agent.name) byName.set(agent.name, agent)
  }
  for (const agent of agentsStore.installedAgents) {
    if (agent.mode === 'work' && agent.name) byName.set(agent.name, agent)
  }
  return [...byName.values()]
})

const filtered = computed(() => {
  if (!query.value.trim()) return workAssistants.value
  return workAssistants.value.filter(agent =>
    matchesWorkAssistantQuery(agent, query.value, isZh.value)
  )
})

async function loadAgents() {
  loading.value = agentsStore.libraryAgents.length === 0
  const workspace = props.workspace || appStore.workWorkspace || appStore.projectRoot || undefined
  try {
    if (agentsStore.libraryAgents.length === 0) await agentsStore.fetchLibrary(workspace)
    await agentsStore.fetchInstalled(workspace)
  } catch (err) {
    console.warn('[WorkAssistantMarker] Failed to load assistants:', err)
  } finally {
    loading.value = false
  }
}

async function toggle() {
  if (props.readonly || props.busy) return
  if (open.value) {
    close()
    return
  }
  open.value = true
  query.value = ''
  await loadAgents()
}

function close() {
  open.value = false
  query.value = ''
}

function choose(agent: AgentDef) {
  if (props.busy) return
  if (agent.name === props.routing.assistant) {
    close()
    return
  }
  close()
  emit('reselect', agent.name)
}

function onPointerDown(event: PointerEvent) {
  const root = rootRef.value
  if (root && !root.contains(event.target as Node)) close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

watch(open, isOpen => {
  if (isOpen) {
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style lang="scss" scoped>
.work-assistant-marker {
  position: relative;
  align-self: center;
  flex-shrink: 0;
  margin: 10px 0 2px;
  z-index: 30;
}

.wam-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-family: inherit;
  font-size: var(--text-2xs);
  color: var(--text-muted);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full, 999px);
  cursor: pointer;
  transition: color 150ms ease, border-color 150ms ease;

  > svg:first-child {
    color: var(--accent-primary);
  }

  &:hover:not(:disabled),
  &.open {
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }

  &:disabled {
    cursor: default;
  }
}

.wam-text {
  white-space: nowrap;
}

.wam-chevron {
  transition: transform 150ms ease;

  &.open {
    transform: rotate(180deg);
  }
}

.wam-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  width: 360px;
  max-width: min(360px, calc(100vw - 48px));
  padding: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
}

.wam-hint {
  margin: 0;
  padding: 2px 4px 8px;
  font-size: var(--text-2xs);
  color: var(--text-muted);
  line-height: 1.5;
}

.wam-search {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 8px;

  > svg {
    position: absolute;
    left: 9px;
    color: var(--text-muted);
    pointer-events: none;
  }

  input {
    width: 100%;
    padding: 7px 10px 7px 30px;
    font-family: inherit;
    font-size: var(--text-sm);
    color: var(--text-primary);
    background: var(--bg-secondary, var(--surface-glass));
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);

    &:focus {
      outline: none;
      border-color: var(--accent-primary);
    }

    &::placeholder {
      color: var(--text-disabled);
    }
  }
}

.wam-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 300px;
  overflow-y: auto;
  @include scrollbar-overlay;
}

.wam-empty {
  padding: 18px 8px;
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-align: center;
}

.wam-option {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  width: 100%;
  padding: 8px 9px;
  font-family: inherit;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;

  &:hover:not(:disabled) {
    background: var(--surface-glass-hover);
    border-color: var(--surface-border);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &.current {
    background: var(--accent-primary-glow);
  }
}

.wam-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 6px;
  margin-top: 1px;
}

.wam-option-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wam-option-name {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wam-option-desc {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wam-check {
  flex-shrink: 0;
  margin-top: 4px;
  color: var(--accent-primary);
}
</style>

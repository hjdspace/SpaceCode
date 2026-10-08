<template>
  <div class="reasoning-card" :class="{ 'is-thinking': isThinking }">
    <button
      type="button"
      class="reasoning-header"
      :aria-expanded="isExpanded"
      @click="toggleExpand"
    >
      <span class="reasoning-indicator" :class="{ active: isThinking }" aria-hidden="true">
        <Brain v-if="!isThinking" :size="13" />
        <span v-else class="thinking-orb"></span>
      </span>
      <span class="reasoning-label">{{ t('chat.reasoning') }}</span>
      <span class="reasoning-summary" :title="summary">{{ summary }}</span>
      <span class="reasoning-chevron" :class="{ expanded: isExpanded }" aria-hidden="true">
        <ChevronDown :size="13" />
      </span>
    </button>

    <Transition name="reasoning-reveal">
      <div v-if="isExpanded" class="reasoning-content">
        <div class="reasoning-clip">
          <div ref="contentRef" class="reasoning-text">{{ reasoning.content }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Brain, ChevronDown } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { ReasoningBlock } from '@/types'

const props = defineProps<{
  reasoning: ReasoningBlock
  isThinking?: boolean
}>()

const { t } = useI18n()
const isThinking = computed(() => props.isThinking ?? props.reasoning.endTime == null)
const isExpanded = ref(isThinking.value)
const userToggled = ref(false)
const contentRef = ref<HTMLElement | null>(null)

const summary = computed(() => {
  const lines = props.reasoning.content.split('\n').filter(line => line.trim())
  return isThinking.value ? (lines[lines.length - 1] ?? '') : (lines[0] ?? '')
})

watch(isThinking, async active => {
  if (!userToggled.value) isExpanded.value = active
  if (active && isExpanded.value) {
    await nextTick()
    contentRef.value?.scrollTo({ top: contentRef.value.scrollHeight })
  }
})

watch(() => props.reasoning.content, async () => {
  if (!isThinking.value || !isExpanded.value) return
  await nextTick()
  contentRef.value?.scrollTo({ top: contentRef.value.scrollHeight })
})

function toggleExpand() {
  userToggled.value = true
  isExpanded.value = !isExpanded.value
}
</script>

<style lang="scss" scoped>
.reasoning-card {
  position: relative;
  margin: 4px 0;
  border-radius: 8px;
  overflow: hidden;
}

.reasoning-card.is-thinking::before {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(100deg, transparent 20%, rgba(var(--accent-primary-rgb, 59, 130, 246), 0.07) 50%, transparent 80%);
  content: '';
  pointer-events: none;
  animation: reasoning-sweep 2.6s ease-in-out infinite;
}

.reasoning-header {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 28px;
  align-items: center;
  gap: 7px;
  padding: 4px 7px;
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: var(--text-muted);
  text-align: left;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-secondary);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
  }
}

.reasoning-indicator {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);

  &.active {
    color: var(--accent-primary);
  }
}

.thinking-orb {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb, 59, 130, 246), 0.12);
  animation: reasoning-breathe 1.6s ease-in-out infinite;
}

.reasoning-label {
  flex: 0 0 auto;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: inherit;
}

.reasoning-summary {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reasoning-chevron {
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--text-muted);
  opacity: 0.7;
  transition: transform 180ms ease;

  &.expanded {
    transform: rotate(180deg);
  }
}

.reasoning-content {
  display: grid;
  grid-template-rows: 1fr;
  overflow: hidden;
  padding: 2px 4px 4px 23px;
}

.reasoning-clip {
  min-height: 0;
  overflow: hidden;
}

.reasoning-text {
  max-height: 240px;
  overflow-y: auto;
  @include scrollbar-overlay;
  padding: 8px 10px;
  border-radius: 7px;
  background: var(--bg-secondary);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: var(--leading-chat);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.reasoning-reveal-enter-active,
.reasoning-reveal-leave-active {
  display: grid;
  transition: grid-template-rows 180ms ease, opacity 180ms ease;
}

.reasoning-reveal-enter-from,
.reasoning-reveal-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

.reasoning-reveal-enter-to,
.reasoning-reveal-leave-from {
  grid-template-rows: 1fr;
  opacity: 1;
}

@keyframes reasoning-breathe {
  0%, 100% { transform: scale(0.82); opacity: 0.72; }
  50% { transform: scale(1); opacity: 1; }
}

@keyframes reasoning-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

@media (prefers-reduced-motion: reduce) {
  .reasoning-card.is-thinking::before,
  .thinking-orb {
    animation: none;
  }

  .reasoning-header,
  .reasoning-chevron,
  .reasoning-reveal-enter-active,
  .reasoning-reveal-leave-active {
    transition: none;
  }
}
</style>

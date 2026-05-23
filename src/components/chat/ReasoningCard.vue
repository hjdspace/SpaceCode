<template>
  <div class="reasoning-card" :class="{ 'is-thinking': isThinking, 'is-expanded': isExpanded }">
    <div class="reasoning-header" @click="toggleExpand">
      <span class="reasoning-title">
          <template v-if="isThinking">
            {{ t('chat.thinking') }}
            <span class="thinking-dots">{{ dots }}</span>
          </template>
          <template v-else>
            {{ t('chat.thoughtFor', { duration: duration }) }}
          </template>
        </span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-show="isExpanded" class="reasoning-content">
      <MarkdownRenderer :content="reasoning.content" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ReasoningBlock } from '@/types'
import { ChevronDown } from 'lucide-vue-next'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import { computed, ref, watch, onUnmounted, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  reasoning: ReasoningBlock
}>()

const isExpanded = ref(!props.reasoning.endTime)
const isThinking = computed(() => !props.reasoning.endTime)

// thinking 开始时自动展开，完成时自动折叠
watch(isThinking, (thinking) => {
  if (thinking) {
    isExpanded.value = true
  } else {
    isExpanded.value = false
  }
})

const duration = computed(() => {
  if (!props.reasoning.endTime) return '0.0'
  return ((props.reasoning.endTime - props.reasoning.startTime) / 1000).toFixed(1)
})

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

// 动画dots
const dots = ref('')
let dotsInterval: number | null = null

onMounted(() => {
  if (isThinking.value) {
    let count = 0
    dotsInterval = window.setInterval(() => {
      count = (count + 1) % 4
      dots.value = '.'.repeat(count)
    }, 500)
  }
})

onUnmounted(() => {
  if (dotsInterval) {
    clearInterval(dotsInterval)
  }
})
</script>

<style lang="scss" scoped>
.reasoning-card {
  margin: 6px 0;
  border-radius: 6px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  overflow: hidden;
  font-size: 13px;
}

.reasoning-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  color: var(--text-muted);
  transition: all var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-secondary);
  }
}

.reasoning-title {
  flex: 1;
  font-size: 13px;
  font-weight: 450;
  display: flex;
  align-items: center;
  gap: 4px;
}

.thinking-dots {
  font-family: var(--font-mono);
  opacity: 0.7;
  min-width: 24px;
}

.expand-icon {
  flex-shrink: 0;
  opacity: 0.5;
  transition: transform var(--transition-fast), opacity var(--transition-fast);

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.reasoning-header:hover .expand-icon {
  opacity: 0.8;
}

.reasoning-content {
  padding: 8px 12px 12px 34px;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.6;
  border-top: 1px solid var(--surface-border);
  background: var(--bg-secondary);

  // 穿透 MarkdownRenderer 的 color: var(--text-primary) 覆盖
  :deep(.markdown-renderer) {
    color: var(--text-muted);

    .md-heading {
      color: var(--text-muted);
    }

    strong {
      color: var(--text-muted);
    }

    .code-block code {
      color: var(--text-muted);
    }
  }
}

.is-thinking .reasoning-header {
  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-secondary);
  }
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
</style>

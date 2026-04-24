<template>
  <div class="reasoning-card" :class="{ 'is-thinking': isThinking, 'is-expanded': isExpanded }">
    <div class="reasoning-header" @click="toggleExpand">
      <Lightbulb :size="16" class="reasoning-icon" />
      <span class="reasoning-title">
        <template v-if="isThinking">
          思考中...
          <span class="thinking-time">({{ elapsedTime }}s)</span>
        </template>
        <template v-else>
          思考了 {{ duration }} 秒
        </template>
      </span>
      <ChevronDown v-if="!isThinking" :size="16" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-show="isExpanded || isThinking" class="reasoning-content">
      <MarkdownRenderer :content="reasoning.content" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ReasoningBlock } from '@/types'
import { Lightbulb, ChevronDown } from 'lucide-vue-next'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import { computed, ref, watch, onUnmounted } from 'vue'

const props = defineProps<{
  reasoning: ReasoningBlock
}>()

const isExpanded = ref(props.reasoning.isExpanded ?? true)
const isThinking = computed(() => !props.reasoning.endTime)

const elapsedTime = computed(() => {
  const now = Date.now()
  const start = props.reasoning.startTime
  return ((now - start) / 1000).toFixed(1)
})

const duration = computed(() => {
  if (!props.reasoning.endTime) return '0.0'
  return ((props.reasoning.endTime - props.reasoning.startTime) / 1000).toFixed(1)
})

function toggleExpand() {
  if (!isThinking.value) {
    isExpanded.value = !isExpanded.value
  }
}

// 思考中时自动刷新时间
let interval: number | null = null
watch(isThinking, (thinking) => {
  if (thinking) {
    interval = window.setInterval(() => {}, 100)
  } else if (interval) {
    clearInterval(interval)
    interval = null
  }
}, { immediate: true })

onUnmounted(() => {
  if (interval) {
    clearInterval(interval)
  }
})
</script>

<style lang="scss" scoped>
.reasoning-card {
  margin: 8px 0;
  border-radius: 8px;
  border-left: 3px solid #6366f1;
  background: rgba(99, 102, 241, 0.05);
  overflow: hidden;
}

.reasoning-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: rgba(99, 102, 241, 0.08);
  }
}

.reasoning-icon {
  color: #6366f1;
  flex-shrink: 0;
}

.reasoning-title {
  flex: 1;
  font-size: 14px;
  color: #4b5563;
  font-weight: 500;
}

.thinking-time {
  color: #6b7280;
  font-weight: normal;
}

.expand-icon {
  color: #9ca3af;
  transition: transform 0.3s ease;

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.reasoning-content {
  padding: 0 12px 12px 36px;
  font-size: 14px;
  color: #4b5563;
  line-height: 1.6;
}

.is-thinking .reasoning-header {
  cursor: default;
}
</style>

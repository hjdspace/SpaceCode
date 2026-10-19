<template>
  <div v-if="quotes.length > 0" class="quote-attachments">
    <div
      v-for="quote in quotes"
      :key="quote.id"
      class="quote-chip"
      @mouseenter="showTooltip(quote, $event)"
      @mouseleave="hideTooltip"
    >
      <Quote :size="13" class="quote-chip-icon" />
      <span class="quote-chip-text">{{ quote.text }}</span>
      <button class="quote-chip-delete" :title="t('common.delete')" @click="remove(quote.id)">
        <X :size="12" />
      </button>
    </div>
  </div>

  <!-- 引用文本附件悬停提示（主题化浮窗，替代原生 title） -->
  <Teleport to="body">
    <Transition name="quote-tooltip">
      <div
        v-if="tooltip.visible"
        ref="tooltipRef"
        class="quote-tooltip"
        :style="tooltip.style"
      >{{ tooltip.text }}</div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 引用文本附件条：选中文本"添加到对话"后挂在输入框上方的 chip 列表。
 *
 * 附件本身由宿主持有 —— 发送时要把引用序列化成 blockquote 前缀，草稿与 stash
 * 也得读写它。悬停浮窗是纯视图，只需要 chip 的几何信息，所以连同定位一起留在这里。
 */
import { nextTick, ref } from 'vue'
import { Quote, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { TextQuoteAttachment } from '@/composables/types'

defineProps<{ quotes: TextQuoteAttachment[] }>()

const emit = defineEmits<{ remove: [id: string] }>()

const { t } = useI18n()

const tooltipRef = ref<HTMLElement | null>(null)
const tooltip = ref<{ visible: boolean; text: string; style: Record<string, string> }>({
  visible: false,
  text: '',
  style: {},
})

function showTooltip(quote: TextQuoteAttachment, e: MouseEvent) {
  const chip = e.currentTarget as HTMLElement
  tooltip.value = { visible: true, text: quote.text, style: { visibility: 'hidden' } }
  nextTick(() => positionTooltip(chip))
}

function hideTooltip() {
  tooltip.value = { ...tooltip.value, visible: false }
}

// 删掉正在悬停的 chip 时 mouseleave 不会触发，浮窗要自己收掉
function remove(id: string) {
  hideTooltip()
  emit('remove', id)
}

function positionTooltip(chip: HTMLElement) {
  const el = tooltipRef.value
  if (!el) return
  const rect = chip.getBoundingClientRect()
  const gap = 6
  const margin = 8
  const width = el.offsetWidth
  const height = el.offsetHeight
  const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin)
  let top = rect.top - height - gap
  if (top < margin) top = rect.bottom + gap
  tooltip.value = {
    visible: true,
    text: tooltip.value.text,
    style: { position: 'fixed', top: `${top}px`, left: `${left}px`, visibility: 'visible' },
  }
}
</script>

<style lang="scss" scoped>
// 引用文本附件条
.quote-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

// 引用附件悬停提示（Teleport 到 body, 不受 scoped 限制需用 :global 或直接写在全局选择器下）
.quote-tooltip {
  position: fixed;
  z-index: 9999;
  max-width: 320px;
  max-height: 180px;
  padding: 8px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  box-shadow: var(--shadow-lg);
  overflow-y: auto;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  pointer-events: none;
  @include scrollbar;
}

.quote-tooltip-enter-active,
.quote-tooltip-leave-active {
  transition: opacity 0.12s ease-out, transform 0.12s ease-out;
}

.quote-tooltip-enter-from,
.quote-tooltip-leave-to {
  opacity: 0;
  transform: translateY(2px);
}

.quote-chip {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  cursor: default;
  user-select: none;

  .quote-chip-icon {
    flex-shrink: 0;
    color: var(--text-secondary);
  }

  .quote-chip-text {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
  }

  .quote-chip-delete {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 50%;

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
  }
}
</style>

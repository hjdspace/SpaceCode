<template>
  <Teleport to="body">
    <Transition name="sa-dialog">
      <div v-if="visible" class="sa-dialog-overlay" @click.self="emit('close')">
        <section
          ref="panelRef"
          class="sa-dialog"
          :class="size"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          tabindex="-1"
          @keydown="onKeydown"
        >
          <header class="dialog-header">
            <div class="heading">
              <h2 :id="titleId">{{ title }}</h2>
              <div v-if="$slots.subtitle" class="subtitle">
                <slot name="subtitle" />
              </div>
            </div>
            <button type="button" class="close-btn" :aria-label="t('common.close')" @click="emit('close')">
              <X :size="16" />
            </button>
          </header>

          <div class="dialog-body">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="dialog-footer">
            <slot name="footer" />
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * Super Agent 弹窗外壳。
 *
 * 必须 Teleport + fixed：页面里悬浮工卡是 z-index 30 的绝对定位元素，
 * 而 .super-agent-view 不构成层叠上下文，任何内联在这条带上的面板都会被它压住。
 */
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title: string
    size?: 'md' | 'lg'
  }>(),
  { size: 'md' },
)

const emit = defineEmits<{ (event: 'close'): void }>()

const { t } = useI18n()
const titleId = useId()

const panelRef = ref<HTMLElement | null>(null)
let opener: HTMLElement | null = null

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusables(): HTMLElement[] {
  const panel = panelRef.value
  if (!panel) return []
  const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
  // 先落在正文里的第一个控件：头部关闭键不该抢第一眼焦点。
  const body = panel.querySelector('.dialog-body')
  const inBody = nodes.filter((node) => body?.contains(node))
  return inBody.length > 0 ? inBody : nodes
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const nodes = focusables()
  if (nodes.length === 0) return
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (event.shiftKey && (active === first || active === panelRef.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.visible,
  (visible, previous) => {
    if (visible) {
      opener = document.activeElement as HTMLElement | null
      void nextTick(() => focusables()[0]?.focus())
      return
    }
    // 只在 true -> false 的收起过程归还焦点，首屏 visible=false 不误动物理焦点。
    if (previous && opener?.isConnected) opener.focus()
    opener = null
  },
)

onBeforeUnmount(() => {
  if (props.visible && opener?.isConnected) opener.focus()
})
</script>

<style scoped lang="scss">
@use '@/styles/variables' as *;
@use '@/styles/mixins' as *;

.sa-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay-scrim);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.sa-dialog {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 100%;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  box-shadow: var(--shadow-xl);
  overflow: hidden;

  &.md {
    max-width: 560px;
  }

  &.lg {
    max-width: 720px;
  }

  &:focus {
    outline: none;
  }
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex: none;
  padding: 14px 18px;
  border-bottom: 1px solid var(--surface-border);

  .heading {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: var(--text-base-plus);
    font-weight: var(--font-weight-semibold);
    line-height: var(--leading-tight);
    color: var(--text-primary);
  }

  .subtitle {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
}

.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  @include focus-ring;
}

.dialog-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;

  @include scrollbar;
}

.dialog-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 12px 18px;
  border-top: 1px solid var(--surface-border);
  background: var(--bg-elevated);
  font-size: var(--text-sm);
}

.sa-dialog-enter-active,
.sa-dialog-leave-active {
  transition: opacity var(--transition-fast);
}

.sa-dialog-enter-from,
.sa-dialog-leave-to {
  opacity: 0;
}

.sa-dialog-enter-active .sa-dialog,
.sa-dialog-leave-active .sa-dialog {
  transition: transform var(--transition-fast);
}

.sa-dialog-enter-from .sa-dialog,
.sa-dialog-leave-to .sa-dialog {
  transform: translateY(8px) scale(0.98);
}
</style>

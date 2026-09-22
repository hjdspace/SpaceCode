<template>
  <Teleport to="body">
    <!-- 解释卡片 -->
    <Transition name="selection-pop">
      <div
        v-if="store.showExplainCard"
        ref="cardRef"
        class="selection-explain-card"
        :style="cardStyle"
        role="dialog"
        :aria-label="t('selectionActions.explainTitle')"
      >
        <div class="explain-header">
          <span class="explain-title">{{ t('selectionActions.explainTitle') }}</span>
          <div class="explain-actions">
            <button
              type="button"
              class="explain-icon-btn"
              :aria-label="copied ? t('selectionActions.copied') : t('selectionActions.copy')"
              @mousedown.prevent
              @click="copyExplain"
            >
              <Check v-if="copied" :size="14" />
              <Copy v-else :size="14" />
            </button>
            <button
              type="button"
              class="explain-icon-btn"
              :aria-label="t('common.close')"
              @mousedown.prevent
              @click="actions.closeExplainCard()"
            >
              <X :size="14" />
            </button>
          </div>
        </div>
        <div class="explain-body">{{ revealedExplain }}</div>
      </div>
    </Transition>

    <!-- 浮动操作条 -->
    <Transition name="selection-pop">
      <div
        v-if="store.visible && !store.showExplainCard"
        ref="barRef"
        class="selection-bar"
        :style="barStyle"
        role="toolbar"
        :aria-label="t('selectionActions.explain')"
        @mousedown.stop
      >
        <!-- busy -->
        <div v-if="store.phase === 'busy'" class="bar-busy">
          <span class="bar-spinner" />
          <span class="bar-shimmer">{{ t(store.busyKey) }}</span>
        </div>

        <!-- result: Keep / Discard / Try again -->
        <template v-else-if="store.phase === 'result'">
          <button type="button" class="bar-control bar-control--primary" @mousedown.prevent @click="actions.keep()">
            <Check :size="14" />{{ t('selectionActions.keep') }}
          </button>
          <button type="button" class="bar-control" @mousedown.prevent @click="actions.discard()">
            <X :size="14" />{{ t('selectionActions.discard') }}
          </button>
          <span class="bar-divider" />
          <button type="button" class="bar-icon-btn" :aria-label="t('selectionActions.tryAgain')" @mousedown.prevent @click="actions.tryAgain()">
            <RotateCw :size="14" />
          </button>
        </template>

        <!-- error -->
        <template v-else-if="store.phase === 'error'">
          <span class="bar-error">{{ store.error }}</span>
          <span class="bar-divider" />
          <button type="button" class="bar-icon-btn" :aria-label="t('selectionActions.tryAgain')" @mousedown.prevent @click="actions.tryAgain()">
            <RotateCw :size="14" />
          </button>
          <button type="button" class="bar-icon-btn" :aria-label="t('common.close')" @mousedown.prevent @click="store.close()">
            <X :size="14" />
          </button>
        </template>

        <!-- idle -->
        <template v-else>
          <!-- chat 场景: 仅解释 + 添加到对话 -->
          <template v-if="store.context === 'chat'">
            <button type="button" class="bar-control" @mousedown.prevent @click="actions.runAction('explain')">
              <MessageCircle :size="14" />{{ t('selectionActions.explain') }}
            </button>
            <button type="button" class="bar-control" @mousedown.prevent @click="actions.addToConversation()">
              <Quote :size="14" />{{ t('selectionActions.addToConversation') }}
            </button>
          </template>

          <!-- file 场景: 全功能 -->
          <template v-else>
            <form class="bar-prompt" :class="{ 'is-hidden': store.expanded, 'has-value': hasDraft }" @submit.prevent="actions.submitDraft()">
              <input
                v-model="store.draft"
                :placeholder="t('selectionActions.describeEdits')"
                :aria-label="t('selectionActions.describeEdits')"
              >
            </form>

            <div class="bar-actions" :class="{ 'is-hidden': hasDraft }">
              <span v-if="!store.expanded" class="bar-divider" />
              <button type="button" class="bar-control" @mousedown.prevent @click="actions.runAction('explain')">
                <MessageCircle :size="14" />{{ t('selectionActions.explain') }}
              </button>
              <button type="button" class="bar-control" @mousedown.prevent @click="actions.runAction('improve')">
                <Sparkles :size="14" />{{ t('selectionActions.improve') }}
              </button>
              <div class="bar-more" :class="{ 'is-expanded': store.expanded }">
                <button type="button" class="bar-control" @mousedown.prevent @click="actions.runAction('shorten')">
                  <Scissors :size="14" />{{ t('selectionActions.shorten') }}
                </button>
                <button type="button" class="bar-control" @mousedown.prevent @click="actions.runAction('tone')">
                  <Smile :size="14" />{{ t('selectionActions.changeTone') }}
                </button>
                <button type="button" class="bar-control" @mousedown.prevent @click="actions.runAction('grammar')">
                  <SpellCheck :size="14" />{{ t('selectionActions.fixGrammar') }}
                </button>
              </div>
              <span class="bar-divider" />
              <button
                type="button"
                class="bar-icon-btn"
                :aria-label="store.expanded ? t('selectionActions.fewerActions') : t('selectionActions.moreActions')"
                :aria-expanded="store.expanded"
                @mousedown.prevent
                @click="store.expanded = !store.expanded"
              >
                <ChevronRight :size="14" :style="{ transform: store.expanded ? 'rotate(90deg)' : 'rotate(0deg)' }" />
              </button>
            </div>

            <div class="bar-send" :class="{ 'is-visible': hasDraft }">
              <button type="button" :aria-label="t('selectionActions.send')" @mousedown.prevent @click="actions.submitDraft()">
                <ArrowUp :size="14" />
              </button>
            </div>

            <span class="bar-divider" />
            <button type="button" class="bar-control" @mousedown.prevent @click="actions.addToConversation()">
              <Quote :size="14" />{{ t('selectionActions.addToConversation') }}
            </button>
          </template>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUp, Check, ChevronRight, Copy, MessageCircle, Quote, RotateCw, Scissors, Smile, Sparkles, SpellCheck, X } from 'lucide-vue-next'
import { useSelectionBarStore } from '@/stores/selectionBar'
import { useSelectionActions } from '@/composables/useSelectionActions'

const { t } = useI18n()
const store = useSelectionBarStore()
const actions = useSelectionActions()

const barRef = ref<HTMLElement | null>(null)
const cardRef = ref<HTMLElement | null>(null)
const copied = ref(false)
const revealedLen = ref(0)
let revealTimer: ReturnType<typeof setInterval> | undefined
let copyResetTimer: ReturnType<typeof setTimeout> | undefined
let resizeObserver: ResizeObserver | undefined

const hasDraft = computed(() => store.draft.trim().length > 0)

/** 解释卡片逐字显示; reduced-motion 时直接完整显示 */
const revealedExplain = computed(() => {
  const full = store.explainText
  if (prefersReducedMotion()) return full
  return full.slice(0, revealedLen.value)
})

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function stopReveal() {
  if (revealTimer !== undefined) {
    clearInterval(revealTimer)
    revealTimer = undefined
  }
}

watch(() => store.showExplainCard, (show) => {
  stopReveal()
  if (show) {
    revealedLen.value = prefersReducedMotion() ? store.explainText.length : 0
    if (!prefersReducedMotion()) {
      revealTimer = setInterval(() => {
        revealedLen.value = Math.min(store.explainText.length, revealedLen.value + 3)
        if (revealedLen.value >= store.explainText.length) stopReveal()
      }, 16)
    }
  }
})

watch(() => store.explainText, () => {
  revealedLen.value = prefersReducedMotion() ? store.explainText.length : 0
})

async function copyExplain() {
  try {
    await navigator.clipboard.writeText(store.explainText)
    copied.value = true
    if (copyResetTimer !== undefined) clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => { copied.value = false }, 1500)
  } catch { /* clipboard unavailable */ }
}

// ── 定位: 视口钳位 + 上下翻转 ──────────────────────────────────────
const BAR_HEIGHT_ESTIMATE = 40
const CARD_WIDTH = 360
const CARD_HEIGHT_ESTIMATE = 200

const barStyle = computed(() => {
  const a = store.anchor
  if (!a) return { display: 'none' }
  const barW = barWidth.value
  const barH = BAR_HEIGHT_ESTIMATE
  const gap = 6
  let top = a.bottom + gap
  if (top + barH > window.innerHeight - 8) {
    top = Math.max(8, a.top - barH - gap)
  }
  const left = Math.min(Math.max(8, a.left + a.width / 2 - barW / 2), window.innerWidth - barW - 8)
  return { top: `${top}px`, left: `${left}px` }
})

const cardStyle = computed(() => {
  const a = store.anchor
  if (!a) return { display: 'none' }
  const left = Math.min(Math.max(8, a.left + a.width / 2 - CARD_WIDTH / 2), window.innerWidth - CARD_WIDTH - 8)
  let top = a.bottom + 6
  if (top + CARD_HEIGHT_ESTIMATE > window.innerHeight - 8) {
    top = Math.max(8, a.top - CARD_HEIGHT_ESTIMATE - 8)
  }
  return { top: `${top}px`, left: `${left}px` }
})

// 浮条宽度随相位/场景形变, 用于水平钳位
const barWidth = ref(320)
function measureBar() {
  if (barRef.value) barWidth.value = barRef.value.offsetWidth
}
watch([() => store.phase, () => store.context, () => store.expanded, () => store.visible], () => {
  nextTick(measureBar)
})
watch(() => store.draft, () => nextTick(measureBar))

function onWindowResize() {
  if (store.visible && store.phase === 'idle') store.close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && store.visible && store.phase === 'idle') store.close()
  if (e.key === 'Escape' && store.showExplainCard) actions.closeExplainCard()
}

function onDocMousedown(e: MouseEvent) {
  const target = e.target as Node
  if (store.showExplainCard) {
    if (cardRef.value && !cardRef.value.contains(target)) actions.closeExplainCard()
    return
  }
  if (store.visible && store.phase === 'idle' && barRef.value && !barRef.value.contains(target)) {
    store.close()
  }
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('mousedown', onDocMousedown)
  if (barRef.value) {
    resizeObserver = new ResizeObserver(measureBar)
    resizeObserver.observe(barRef.value)
  }
})

onBeforeUnmount(() => {
  stopReveal()
  if (copyResetTimer !== undefined) clearTimeout(copyResetTimer)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousedown', onDocMousedown)
})
</script>

<style lang="scss" scoped>
.selection-bar {
  position: fixed;
  z-index: 9999;
  display: flex;
  height: 36px;
  max-width: calc(100vw - 48px);
  align-items: center;
  gap: 2px;
  overflow: hidden;
  padding: 4px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  animation: selection-pop 0.22s cubic-bezier(0.23, 1, 0.32, 1) both;
}

.bar-control {
  display: inline-flex;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-xs);
  font-weight: 400;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s, transform 0.15s;

  &:hover {
    background: var(--surface-glass-hover);
  }

  &:active {
    transform: scale(0.96);
  }

  svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  &--primary {
    background: var(--accent-primary);
    color: #fff;

    &:hover {
      background: var(--accent-primary-hover);
    }

    svg :deep(path) {
      stroke-width: 2.3;
    }
  }
}

.bar-icon-btn {
  display: flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s, transform 0.15s;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-secondary);
  }

  &:active {
    transform: scale(0.96);
  }

  svg {
    transition: transform 0.4s cubic-bezier(0.23, 1, 0.32, 1);
  }
}

.bar-divider {
  width: 1px;
  height: 16px;
  flex: 0 0 1px;
  margin: 0 2px;
  background: var(--surface-border-strong);
}

.bar-busy {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.bar-spinner {
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
  border: 1.5px solid var(--surface-border-strong);
  border-top-color: var(--text-secondary);
  border-radius: 50%;
  animation: selection-spin 0.7s linear infinite;
}

.bar-shimmer {
  background: linear-gradient(90deg, var(--text-muted) 30%, var(--text-primary) 50%, var(--text-muted) 70%);
  background-size: 200% 100%;
  background-clip: text;
  color: transparent;
  animation: selection-shimmer 1.4s linear infinite;
}

.bar-error {
  display: inline-flex;
  align-items: center;
  max-width: 320px;
  padding: 0 10px;
  overflow: hidden;
  color: var(--error);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-prompt {
  display: flex;
  width: 145px;
  min-width: 0;
  height: 28px;
  align-items: center;
  overflow: hidden;
  transition: width 0.4s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.4s, transform 0.4s;

  &.is-hidden {
    width: 0;
    opacity: 0;
    transform: translateX(-8px);
  }

  &.has-value {
    flex: 1;
    width: auto;
  }

  input {
    width: 100%;
    height: 28px;
    padding: 0 10px 0 12px;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--text-xs);

    &::placeholder {
      color: var(--text-muted);
    }
  }
}

.bar-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 2px;
  overflow: hidden;
  opacity: 1;
  transition: max-width 0.4s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.4s, transform 0.4s;

  &.is-hidden {
    max-width: 0;
    opacity: 0;
    transform: translateX(-8px);
  }
}

.bar-more {
  display: flex;
  max-width: 0;
  align-items: center;
  gap: 2px;
  overflow: hidden;
  opacity: 0;
  transition: max-width 0.4s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.4s, margin 0.4s;

  &.is-expanded {
    max-width: 280px;
    margin-left: 2px;
    opacity: 1;
  }
}

.bar-send {
  display: flex;
  max-width: 0;
  align-items: center;
  overflow: hidden;
  opacity: 0;
  transform: scale(0.88);
  transition: max-width 0.4s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.4s, transform 0.4s;

  &.is-visible {
    max-width: 30px;
    opacity: 1;
    transform: scale(1);
  }

  button {
    display: flex;
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--accent-primary);
    color: #fff;
    cursor: pointer;

    &:active {
      transform: scale(0.94);
    }
  }
}

// ── 解释卡片 ──────────────────────────────────────────────────────
.selection-explain-card {
  position: fixed;
  z-index: 9998;
  display: flex;
  width: 360px;
  max-height: 320px;
  flex-direction: column;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  animation: selection-pop 0.22s cubic-bezier(0.23, 1, 0.32, 1) both;
}

.explain-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 8px 14px;
  border-bottom: 1px solid var(--surface-border);

  .explain-title {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .explain-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
}

.explain-icon-btn {
  display: flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
}

.explain-body {
  padding: 12px 14px;
  overflow-y: auto;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  @include scrollbar;
}

@keyframes selection-pop {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(3px);
  }

  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes selection-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes selection-shimmer {
  from {
    background-position: 150% 0;
  }

  to {
    background-position: -50% 0;
  }
}

@media (max-width: 560px) {
  .selection-bar {
    transform: scale(0.9);
    transform-origin: top center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .selection-bar,
  .selection-explain-card,
  .selection-bar *,
  .selection-explain-card * {
    animation: none !important;
    transition: none !important;
  }
}
</style>

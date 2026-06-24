<template>
  <Transition name="wp-fade">
    <div v-if="visible" class="picker-overlay" @click.self="handleCancel">
      <div class="picker-card">
        <div class="picker-head">
          <div class="picker-icon">
            <HelpCircle :size="18" />
          </div>
          <h2 class="picker-title">{{ t('work.askTitle') }}</h2>
          <button class="picker-close" @click="handleCancel" :aria-label="t('common.close')">
            <X :size="16" />
          </button>
        </div>

        <p class="picker-question">{{ t('work.askQuestion') }}</p>

        <div class="picker-options">
          <button
            v-for="a in candidates"
            :key="a.name"
            class="picker-option"
            :class="{ selected: selected === a.name }"
            @click="selected = a.name"
          >
            <div class="op-avatar" :style="workAvatarStyle(a.category)">
              <component :is="workAssistantIcon(a.avatar)" :size="18" />
            </div>
            <div class="op-body">
              <div class="op-name">{{ workDisplayName(a.name) }}</div>
              <div class="op-desc">{{ displayDesc(a) }}</div>
            </div>
            <div class="op-radio"></div>
          </button>
        </div>

        <div class="picker-footer">
          <button class="btn-secondary" @click="handleCancel">{{ t('work.askCancel') }}</button>
          <button class="btn-primary" :disabled="!selected" @click="handleConfirm">
            {{ t('work.askConfirm') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { HelpCircle, X } from 'lucide-vue-next'
import type { AgentDef } from '@/stores/agents'
import { workAssistantIcon, workAvatarStyle, workDisplayName } from '@/utils/workAssistant'

const props = defineProps<{
  visible: boolean
  candidates: AgentDef[]
}>()

const emit = defineEmits<{
  'update:visible': [v: boolean]
  confirm: [a: AgentDef]
  cancel: []
}>()

const { t, locale } = useI18n()

const selected = ref<string>('')

const isZh = computed(() => String(locale.value).toLowerCase().startsWith('zh'))

function displayDesc(a: AgentDef): string {
  return (isZh.value && a.descriptionZh) ? a.descriptionZh : a.description
}

// 弹窗打开时重置选择
watch(() => props.visible, (v) => {
  if (v) selected.value = ''
})

function handleConfirm() {
  const a = props.candidates.find(c => c.name === selected.value)
  if (!a) return
  emit('confirm', a)
  emit('update:visible', false)
}

function handleCancel() {
  emit('cancel')
  emit('update:visible', false)
}
</script>

<style lang="scss" scoped>
.picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px);
}

.picker-card {
  width: 460px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  background: var(--bg-elevated, var(--bg-primary));
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  padding: 22px;
  box-shadow: var(--shadow-lg);
}

.picker-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.picker-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  color: var(--accent-primary);
}

.picker-title {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.picker-close {
  display: flex;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  &:hover {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }
}

.picker-question {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 14px;
}

.picker-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.picker-option {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 13px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: all var(--transition-fast);
  &:hover {
    border-color: var(--accent-primary);
    background: var(--surface-glass-hover);
  }
  &.selected {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }
}

.op-avatar {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
}

.op-body {
  flex: 1;
  min-width: 0;
}

.op-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.op-desc {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 2px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.op-radio {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--text-muted);
  border-radius: 50%;
  transition: all var(--transition-fast);
}

.picker-option.selected .op-radio {
  border-color: var(--accent-primary);
  background: radial-gradient(circle, var(--accent-primary) 45%, transparent 50%);
}

.picker-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.btn-primary,
.btn-secondary {
  padding: 7px 16px;
  font-size: 12.5px;
  font-weight: 600;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-family: inherit;
  border: 1px solid transparent;
  transition: all var(--transition-fast);
}

.btn-primary {
  background: var(--accent-primary);
  color: #fff;
  border-color: var(--accent-primary);
  &:hover:not(:disabled) {
    background: var(--accent-primary-hover, var(--accent-primary));
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border-color: var(--surface-border);
  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
}

.wp-fade-enter-active,
.wp-fade-leave-active {
  transition: opacity 0.18s ease;
}
.wp-fade-enter-from,
.wp-fade-leave-to {
  opacity: 0;
}
</style>

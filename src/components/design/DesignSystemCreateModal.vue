<template>
  <Teleport to="body">
    <div
      class="ds-create-scrim"
      role="dialog"
      aria-modal="true"
      :aria-label="t('design.designSystemCreate.title')"
      data-testid="ds-create-modal"
      @click.self="requestClose"
    >
      <form class="ds-create-card" data-testid="ds-create-card" @submit.prevent="submit">
        <header class="ds-create-head">
          <div>
            <div class="ds-create-title">{{ t('design.designSystemCreate.title') }}</div>
            <p class="ds-create-hint">{{ t('design.designSystemCreate.hint') }}</p>
          </div>
          <button
            type="button"
            class="ds-create-close"
            :aria-label="t('common.close')"
            data-testid="ds-create-close"
            @click="requestClose"
          >
            <X :size="15" />
          </button>
        </header>

        <label class="ds-create-field">
          <span class="ds-create-label">
            {{ t('design.designSystemCreate.name') }}
            <em class="ds-create-required">*</em>
          </span>
          <input
            ref="titleRef"
            v-model="title"
            type="text"
            maxlength="80"
            :placeholder="t('design.designSystemCreate.namePlaceholder')"
            data-testid="ds-create-name"
          />
        </label>

        <label class="ds-create-field">
          <span class="ds-create-label">{{ t('design.designSystemCreate.category') }}</span>
          <input
            v-model="category"
            type="text"
            maxlength="40"
            :placeholder="t('design.designSystemCreate.categoryPlaceholder')"
            data-testid="ds-create-category"
          />
        </label>

        <label class="ds-create-field">
          <span class="ds-create-label">{{ t('design.designSystemCreate.summary') }}</span>
          <textarea
            v-model="summary"
            rows="3"
            maxlength="400"
            :placeholder="t('design.designSystemCreate.summaryPlaceholder')"
            data-testid="ds-create-summary"
          />
        </label>

        <div class="ds-create-field ds-create-color-row">
          <span class="ds-create-label">{{ t('design.designSystemCreate.accent') }}</span>
          <div class="ds-create-color-input">
            <input
              v-model="accentColor"
              type="color"
              class="ds-create-color-well"
              :aria-label="t('design.designSystemCreate.accent')"
              data-testid="ds-create-accent"
            />
            <code class="ds-create-color-value">{{ accentColor }}</code>
          </div>
        </div>

        <p v-if="errorMessage" class="ds-create-error" role="alert" data-testid="ds-create-error">
          {{ errorMessage }}
        </p>

        <footer class="ds-create-actions">
          <button type="button" class="ds-create-btn" :disabled="busy" @click="requestClose">
            {{ t('common.cancel') }}
          </button>
          <button
            type="submit"
            class="ds-create-btn ds-create-btn--primary"
            :disabled="busy || !title.trim()"
            data-testid="ds-create-submit"
          >
            <Loader2 v-if="busy" :size="13" class="ds-create-spin" />
            {{ t(busy ? 'design.designSystemCreate.creating' : 'common.create') }}
          </button>
        </footer>
      </form>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, X } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import type { DesignSystemSummary } from '@/services/electronAPI'

const emit = defineEmits<{
  (e: 'created', system: DesignSystemSummary): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const title = ref('')
const category = ref('')
const summary = ref('')
const accentColor = ref('#d66f4d')
const busy = ref(false)
const errorMessage = ref('')
const titleRef = ref<HTMLInputElement | null>(null)

function requestClose() {
  if (busy.value) return
  emit('cancel')
}

async function submit() {
  if (busy.value || !title.value.trim()) return
  busy.value = true
  errorMessage.value = ''
  try {
    const created = await api.design.createSystem({
      title: title.value.trim(),
      category: category.value.trim() || undefined,
      summary: summary.value.trim() || undefined,
      accentColor: accentColor.value,
    })
    emit('created', created)
  } catch {
    errorMessage.value = t('design.designSystemCreate.failed')
    busy.value = false
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    requestClose()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  titleRef.value?.focus()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped lang="scss">
.ds-create-scrim {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay-scrim);
  backdrop-filter: blur(2px);
}

.ds-create-card {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: 14px;
  box-shadow: var(--shadow-xl);
  animation: dsCreateIn 140ms cubic-bezier(0.23, 1, 0.32, 1);
}

@keyframes dsCreateIn {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: none; }
}

.ds-create-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ds-create-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--text-primary);
}

.ds-create-hint {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.ds-create-close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.ds-create-close:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.ds-create-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ds-create-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.ds-create-required {
  font-style: normal;
  color: var(--error);
}

.ds-create-field input[type='text'],
.ds-create-field textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  border-radius: 9px;
  outline: none;
  resize: vertical;
  transition: border-color var(--transition-fast);
}

.ds-create-field input:focus,
.ds-create-field textarea:focus {
  border-color: var(--accent-primary);
}

.ds-create-field ::placeholder {
  color: var(--text-disabled);
}

.ds-create-color-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ds-create-color-input {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ds-create-color-well {
  width: 34px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.ds-create-color-value {
  font-size: 11px;
  color: var(--text-muted);
}

.ds-create-error {
  margin: 0;
  font-size: 12px;
  color: var(--error);
}

.ds-create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 2px;
}

.ds-create-btn {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.ds-create-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.ds-create-btn--primary {
  color: #fff;
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}

.ds-create-btn--primary:hover:not(:disabled) {
  background: var(--accent-primary-hover);
  color: #fff;
}

.ds-create-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ds-create-spin {
  animation: dsCreateSpin 900ms linear infinite;
}

@keyframes dsCreateSpin {
  to { transform: rotate(360deg); }
}
</style>

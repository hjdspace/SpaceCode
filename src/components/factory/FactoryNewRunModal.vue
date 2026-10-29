<template>
  <div
    class="factory-overlay"
    role="dialog"
    aria-modal="true"
    data-new-run-modal
    @click.self="requestClose"
  >
    <div class="plan-dialog">
      <header class="dialog-header">
        <div>
          <h2>{{ t('factory.newRun.title') }}</h2>
          <p>{{ t('factory.newRun.subtitle') }}</p>
        </div>
        <button
          class="icon-btn"
          data-new-run-close
          :disabled="creating"
          :aria-label="t('factory.cancel')"
          @click="requestClose"
        >
          <X :size="16" />
        </button>
      </header>

      <div class="dialog-body">
        <div v-if="loading" class="state" data-new-run-loading>
          {{ t('factory.newRun.loading') }}
        </div>
        <div v-else-if="!candidates.length" class="state" data-new-run-empty>
          {{ source === 'github-issues' ? t('factory.github.empty') : t('factory.backlog.empty') }}
        </div>
        <ul v-else class="plan-list" data-new-run-list>
          <li
            v-for="candidate in candidates"
            :key="candidate.id"
            class="plan-item"
            :class="{ skipped: candidate.claimed }"
            :data-new-run-item="candidate.id"
          >
            <label class="item-main">
              <input
                v-model="selected"
                type="checkbox"
                :value="candidate.id"
                :disabled="candidate.claimed || creating"
                :data-new-run-check="candidate.id"
              />
              <span class="item-text">
                <span class="item-title">{{ candidate.title }}</span>
                <span v-if="candidate.detail" class="item-detail">{{ candidate.detail }}</span>
                <span
                  v-if="candidate.claimed"
                  class="item-skip"
                  :data-new-run-skip="candidate.id"
                >
                  {{ t('factory.newRun.skipClaimed') }}
                </span>
              </span>
            </label>
          </li>
        </ul>

        <p v-if="skippedCount" class="plan-note" data-new-run-note>
          <AlertTriangle :size="13" />
          <span>{{ t('factory.newRun.skipNote') }}</span>
        </p>

        <div class="plan-row">
          <label class="field">
            <span>{{ t('factory.newRun.concurrency') }}</span>
            <input
              v-model.number="concurrency"
              type="number"
              min="1"
              max="20"
              :disabled="creating"
              data-new-run-concurrency
            />
          </label>
          <span class="field">
            <span>{{ t('factory.newRun.verify') }}</span>
            <code data-new-run-verify>{{ verifyCommand || t('factory.newRun.verifyEmpty') }}</code>
          </span>
        </div>

        <p v-if="errorText" class="error-text" data-new-run-error>{{ errorText }}</p>
      </div>

      <footer class="dialog-footer">
        <span class="selected-count" data-new-run-selected>
          {{ t('factory.newRun.selected', { count: selected.length }) }}
        </span>
        <span class="spacer" />
        <button class="ghost-btn" data-new-run-cancel :disabled="creating" @click="requestClose">
          {{ t('factory.cancel') }}
        </button>
        <button
          class="primary-btn"
          data-new-run-confirm
          :disabled="!selected.length || creating"
          @click="submit"
        >
          <Play :size="13" />
          {{ creating ? t('factory.newRun.creating') : t('factory.newRun.confirm') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Play, X } from 'lucide-vue-next'
import type { FactoryGithubActionError, FactoryRunError } from '@/stores/factory'
import type { NewRunCandidate } from '@/stores/factory/newRun'

const props = defineProps<{
  source: 'local' | 'github-issues'
  candidates: NewRunCandidate[]
  verifyCommand: string
  defaultConcurrency: number
  creating: boolean
  loading: boolean
  error: FactoryRunError | FactoryGithubActionError | null
}>()

const emit = defineEmits<{
  close: []
  create: [input: { ids: string[]; concurrency: number }]
}>()

const { t } = useI18n()

const selected = ref<string[]>([])
const concurrency = ref<number | ''>(props.defaultConcurrency)

// 刷新后已被领取的任务不能再留在选择里，否则确认会直接撞上重复领取。
watch(
  () => props.candidates,
  (candidates) => {
    const selectable = new Set(
      candidates.filter((candidate) => !candidate.claimed).map((candidate) => candidate.id),
    )
    selected.value = selected.value.filter((id) => selectable.has(id))
  },
)

const skippedCount = computed(
  () => props.candidates.filter((candidate) => candidate.claimed).length,
)

const errorText = computed(() => {
  const error = props.error
  if (!error) return null
  if ('reason' in error) {
    const numbers = (error.failed ?? []).map((failure) => `#${failure.number}`).join(', ')
    return numbers
      ? t(`factory.github.errors.${error.reason}`, { numbers })
      : t(`factory.github.errors.${error.reason}`)
  }
  return error.params
    ? t(`factory.run.errors.${error.code}`, error.params)
    : t(`factory.run.errors.${error.code}`)
})

/** 输入框清空或非法时回退到配置的默认并发，再收敛到服务端接受的区间。 */
function normalizedConcurrency(): number {
  const value = concurrency.value
  if (typeof value !== 'number' || !Number.isFinite(value)) return props.defaultConcurrency
  return Math.min(20, Math.max(1, Math.round(value)))
}

function requestClose(): void {
  if (props.creating) return
  emit('close')
}

function submit(): void {
  if (props.creating || selected.value.length === 0) return
  emit('create', { ids: [...selected.value], concurrency: normalizedConcurrency() })
}
</script>

<style lang="scss" scoped>
.factory-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.plan-dialog {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: 100%;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-xl);
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--surface-border);

  h2 {
    margin: 0 0 3px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }

  p {
    margin: 0;
    font-size: var(--text-2xs, 11px);
    line-height: 1.5;
    color: var(--text-muted);
  }
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
  @include scrollbar-overlay;
}

.state {
  padding: 20px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--text-2xs, 11px);
}

.plan-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  @include scrollbar-overlay;
}

.plan-item {
  padding: 8px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);

  &.skipped {
    opacity: 0.65;
  }
}

.item-main {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;

  input[type='checkbox'] {
    margin-top: 2px;
    accent-color: var(--accent-primary);

    &:disabled {
      cursor: not-allowed;
    }
  }
}

.item-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.item-title {
  font-size: var(--text-sm, 12px);
  color: var(--text-primary);
  word-break: break-word;
}

.item-detail {
  font-size: var(--text-2xs, 11px);
  line-height: 1.5;
  color: var(--text-muted);
  word-break: break-word;
}

.item-skip {
  font-size: var(--text-2xs, 11px);
  color: var(--warning);
}

.plan-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 7px 10px;
  border: 1px solid var(--warning);
  border-radius: var(--radius-md, 8px);
  background: var(--warning-glow);
  color: var(--warning);
  font-size: var(--text-2xs, 11px);
}

.plan-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);

  input {
    width: 64px;
    padding: 4px 6px;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--text-2xs, 11px);

    &:focus {
      outline: none;
      border-color: var(--accent-primary);
    }
  }

  code {
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    background: var(--surface-glass);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-2xs, 11px);
    word-break: break-all;
  }
}

.error-text {
  margin: 0;
  font-size: var(--text-2xs, 11px);
  line-height: 1.5;
  color: var(--error);
}

.dialog-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--surface-border);
}

.selected-count {
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);
}

.spacer {
  flex: 1;
}

.ghost-btn,
.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: var(--radius-md, 8px);
  font-size: 12px;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.ghost-btn {
  border: 1px solid var(--surface-border);
  background: transparent;
  color: var(--text-secondary);
}

.primary-btn {
  border: 1px solid var(--accent-primary);
  background: var(--accent-primary);
  color: #fff;
}
</style>

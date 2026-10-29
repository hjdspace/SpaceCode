<template>
  <div class="factory-overlay" role="dialog" aria-modal="true" data-merge-dialog @click.self="emit('close')">
    <div class="merge-dialog">
      <header class="dialog-header">
        <div>
          <h2>{{ t('factory.merge.title', { title: task?.title ?? '' }) }}</h2>
          <p>{{ t('factory.merge.subtitle', { target }) }}</p>
        </div>
        <button class="icon-btn" :aria-label="t('factory.cancel')" @click="emit('close')">
          <X :size="16" />
        </button>
      </header>

      <div class="dialog-body">
        <div v-if="checking" class="state-line" data-merge-checking>
          <Loader2 :size="16" class="spin" />
          <span>{{ t('factory.merge.checking') }}</span>
        </div>

        <div v-else-if="error && !preflight" class="state-line error" data-merge-preflight-error>
          <AlertTriangle :size="16" />
          <span>{{ errorText }}</span>
        </div>

        <template v-else-if="preflight">
          <div class="preview" data-merge-preview>
            <div class="pv-row">
              <span>{{ t('factory.merge.branch') }}</span>
              <b>{{ preflight.branch }}</b>
            </div>
            <div class="pv-row">
              <span>{{ t('factory.merge.target') }}</span>
              <b>{{ preflight.targetBranch }}</b>
            </div>
            <div class="pv-row">
              <span>{{ t('factory.merge.commits') }}</span>
              <b>{{ t('factory.merge.commitCount', { count: preflight.commits }) }}</b>
            </div>
            <div class="pv-row">
              <span>{{ t('factory.merge.changes') }}</span>
              <b>
                <span class="add">+{{ preflight.diff.additions }}</span>
                <span class="del">−{{ preflight.diff.deletions }}</span>
              </b>
            </div>
            <div class="pv-row">
              <span>{{ t('factory.merge.verify') }}</span>
              <b v-if="preflight.verify" :class="verifyClass" data-merge-verify>
                {{ t(`factory.tests.status.${preflight.verify.status}`) }}
              </b>
              <b v-else class="muted">{{ t('factory.inspector.pending') }}</b>
            </div>
            <div class="pv-row">
              <span>{{ t('factory.merge.review') }}</span>
              <b v-if="preflight.review" :class="preflight.review.verdict === 'approved' ? 'ok' : 'warn'">
                {{ t(`factory.review.verdict.${preflight.review.verdict}`) }}
              </b>
              <b v-else class="muted">{{ t('factory.inspector.reviewPending') }}</b>
            </div>
            <div class="pv-row">
              <span>{{ t('factory.merge.base') }}</span>
              <b :class="preflight.baseAdvanced ? 'warn' : 'ok'" data-merge-base>
                {{ preflight.baseAdvanced ? t('factory.merge.baseAdvanced') : t('factory.merge.baseCurrent') }}
              </b>
            </div>
            <div class="pv-row">
              <span>{{ t('factory.merge.conflicts') }}</span>
              <b :class="preflight.conflicts ? 'warn' : 'ok'" data-merge-conflicts>
                {{ preflight.conflicts ? t('factory.merge.conflictFound') : t('factory.merge.conflictNone') }}
              </b>
            </div>
            <div class="pv-row">
              <span>{{ t('factory.merge.worktree') }}</span>
              <b :class="preflight.worktreeClean ? 'ok' : 'warn'" data-merge-worktree>
                {{ preflight.worktreeClean ? t('factory.merge.clean') : t('factory.merge.dirty') }}
              </b>
            </div>
            <div class="pv-row">
              <span>{{ t('factory.merge.workspace') }}</span>
              <b :class="preflight.workspaceClean ? 'ok' : 'warn'" data-merge-workspace>
                {{ preflight.workspaceClean ? t('factory.merge.clean') : t('factory.merge.dirty') }}
              </b>
            </div>
          </div>

          <ul v-if="preflight.conflictFiles.length" class="conflict-files" data-merge-conflict-files>
            <li v-for="file in preflight.conflictFiles" :key="file">
              <code>{{ file }}</code>
            </li>
          </ul>

          <ul v-if="preflight.blockers.length" class="blocker-list" data-merge-blockers>
            <li v-for="blocker in preflight.blockers" :key="blocker" class="blocker" :data-merge-blocker="blocker">
              <XCircle :size="14" />
              <span>{{ t(`factory.merge.blockers.${blocker}`) }}</span>
            </li>
          </ul>

          <p v-if="preflight.detail" class="detail" data-merge-detail>{{ preflight.detail }}</p>

          <div v-if="deliveryMode === 'local'" class="radios">
            <label
              v-for="item in MERGE_MODES"
              :key="item.mode"
              class="radio"
              :class="{ selected: mode === item.mode }"
            >
              <input
                type="radio"
                name="factory-merge-mode"
                :value="item.mode"
                :checked="mode === item.mode"
                :disabled="merging"
                :data-merge-mode="item.mode"
                @change="emit('update:mode', item.mode)"
              />
              <span class="radio-main">
                <b>{{ t(`factory.merge.modes.${item.mode}`) }}</b>
                <small>{{ t(`factory.merge.modeHints.${item.mode}`) }}</small>
              </span>
            </label>
          </div>

          <label class="ack">
            <input
              type="checkbox"
              :checked="confirmed"
              :disabled="merging"
              data-merge-confirm-checkbox
              @change="emit('update:confirmed', ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ deliveryMode === 'pr' ? t('factory.merge.ackPr', { target }) : t('factory.merge.ack', { target }) }}</span>
          </label>

          <p class="note" data-merge-note>
            <AlertTriangle :size="13" />
            <span>{{ deliveryMode === 'pr' ? t('factory.merge.prNote') : t('factory.merge.verifyNote') }}</span>
          </p>
        </template>
      </div>

      <footer class="dialog-footer">
        <p v-if="error" class="action-error" data-merge-error>{{ errorText }}</p>
        <div class="footer-row">
          <button class="ghost-btn" data-merge-refresh :disabled="checking || merging" @click="emit('refresh')">
            {{ checking ? t('factory.merge.checkingShort') : t('factory.merge.refresh') }}
          </button>
          <span class="spacer"></span>
          <button class="ghost-btn" :disabled="merging" @click="emit('close')">
            {{ t('factory.cancel') }}
          </button>
          <button class="primary-btn" data-merge-confirm :disabled="!canConfirm" @click="emit('confirm')">
            {{
              merging
                ? deliveryMode === 'pr'
                  ? t('factory.merge.prCreating')
                  : t('factory.merge.merging')
                : deliveryMode === 'pr'
                  ? t('factory.merge.prConfirm')
                  : t('factory.merge.confirm')
            }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Loader2, X, XCircle } from 'lucide-vue-next'
import { FACTORY_MERGE_MODES, type FactoryMergeMode, type FactoryMergePreflight, type FactoryTask } from '@/shared/factory'
import type { FactoryActionError } from '@/stores/factory'

const props = withDefaults(
  defineProps<{
    task: FactoryTask | null
    target: string
    preflight: FactoryMergePreflight | null
    checking: boolean
    error: FactoryActionError | null
    mode: FactoryMergeMode
    confirmed: boolean
    merging: boolean
    canConfirm: boolean
    deliveryMode?: 'local' | 'pr'
  }>(),
  {
    task: null,
    target: 'main',
    preflight: null,
    checking: false,
    error: null,
    mode: 'merge',
    confirmed: false,
    merging: false,
    canConfirm: false,
    deliveryMode: 'local',
  },
)

const emit = defineEmits<{
  close: []
  refresh: []
  confirm: []
  'update:mode': [mode: FactoryMergeMode]
  'update:confirmed': [value: boolean]
}>()

const { t } = useI18n()

const MERGE_MODES: Array<{ mode: FactoryMergeMode }> = FACTORY_MERGE_MODES.map((mode) => ({ mode }))

const verifyClass = computed(() => (props.preflight?.verify?.status === 'pass' ? 'ok' : 'warn'))

const errorText = computed(() => {
  const err = props.error
  if (!err) return ''
  return t(`factory.errors.${err.code}`, err.detail ? { detail: err.detail } : {})
})
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

.merge-dialog {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: 100%;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-secondary, #1a1a2e);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  overflow: hidden;
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
    font-size: 12px;
    color: var(--text-muted);
  }
}

.icon-btn {
  display: inline-flex;
  padding: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
  @include scrollbar-overlay;
}

.state-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  color: var(--text-muted);
  font-size: 12px;

  &.error {
    color: var(--error);
  }
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--surface-glass);
}

.pv-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--text-muted);

  b {
    font-family: var(--font-mono);
    font-weight: 500;
    color: var(--text-secondary);
  }

  b.ok {
    color: var(--success);
  }

  b.warn {
    color: var(--warning);
  }

  b.muted {
    color: var(--text-disabled);
  }

  .add {
    color: var(--success);
  }

  .del {
    margin-left: 6px;
    color: var(--error);
  }
}

.conflict-files {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0 0 0 4px;
  list-style: none;

  code {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--warning);
  }
}

.blocker-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  padding: 8px 10px;
  list-style: none;
  border-left: 2px solid var(--warning);
  border-radius: var(--radius-md);
  background: var(--surface-glass);
}

.blocker {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--warning);
}

.detail {
  margin: 0;
  padding: 8px;
  border-radius: var(--radius-md);
  background: var(--surface-glass);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.radios {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.radio {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  cursor: pointer;

  &.selected {
    border-color: var(--accent-primary);
    background: var(--surface-glass);
  }

  input {
    flex: none;
  }

  .radio-main {
    display: flex;
    flex-direction: column;
    gap: 2px;

    b {
      font-size: 12px;
      color: var(--text-primary);
    }

    small {
      font-size: 11px;
      color: var(--text-muted);
    }
  }
}

.ack {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;

  input {
    flex: none;
  }
}

.note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.dialog-footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 20px;
  border-top: 1px solid var(--surface-border);
}

.action-error {
  margin: 0;
  font-size: 11px;
  color: var(--error);
  overflow-wrap: anywhere;
}

.footer-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spacer {
  flex: 1;
}

.ghost-btn,
.primary-btn {
  padding: 6px 14px;
  border-radius: var(--radius-md, 8px);
  font-size: 12px;
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.ghost-btn {
  border: 1px solid var(--surface-border);
  background: transparent;
  color: var(--text-primary);
}

.primary-btn {
  border: 1px solid var(--accent-primary);
  background: var(--accent-primary);
  color: #fff;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

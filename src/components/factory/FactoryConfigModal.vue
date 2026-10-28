<template>
  <div class="factory-overlay" role="dialog" aria-modal="true" data-config-modal @click.self="emit('close')">
    <div class="config-dialog">
      <header class="dialog-header">
        <div>
          <h2>{{ t('factory.config.title') }}</h2>
          <p>{{ t('factory.config.subtitle') }}</p>
        </div>
        <button class="icon-btn" :aria-label="t('factory.cancel')" @click="emit('close')">
          <X :size="16" />
        </button>
      </header>

      <div class="dialog-body">
        <p class="fixed-hint" data-config-fixed-hint>
          <Workflow :size="13" />
          <span>{{ t('factory.config.fixedHint') }}</span>
        </p>

        <table class="stage-table">
          <thead>
            <tr>
              <th>{{ t('factory.config.columns.enabled') }}</th>
              <th>{{ t('factory.config.columns.stage') }}</th>
              <th>{{ t('factory.config.columns.model') }}</th>
              <th>{{ t('factory.config.columns.permission') }}</th>
              <th>{{ t('factory.config.columns.gate') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="stage in STAGES" :key="stage.key" :data-config-row="stage.key">
              <td>
                <label class="switch">
                  <input
                    type="checkbox"
                    :checked="props.config.stages[stage.key].enabled"
                    :disabled="saving"
                    :data-config-enabled="stage.key"
                    @change="setEnabled(stage.key, ($event.target as HTMLInputElement).checked)"
                  />
                </label>
              </td>
              <td>
                <b>{{ t(stage.labelKey) }}</b>
                <small>{{ t(stage.hintKey) }}</small>
                <label v-if="stage.key === 'implement'" class="iterations">
                  <span>{{ t('factory.config.iterations') }}</span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    :value="props.config.stages.implement.maxIterations ?? props.config.agent.maxIterations"
                    :disabled="saving"
                    data-config-iterations
                    @change="setIterations(($event.target as HTMLInputElement).value)"
                  />
                </label>
              </td>
              <td>
                <span v-if="stage.key === 'verify'" class="muted" data-config-no-agent>
                  {{ t('factory.config.noAgent') }}
                </span>
                <input
                  v-else
                  type="text"
                  class="model-input"
                  :value="props.config.stages[stage.key].model ?? ''"
                  :placeholder="t('factory.config.defaultModel')"
                  :disabled="saving"
                  :data-config-model="stage.key"
                  @change="setModel(stage.key, ($event.target as HTMLInputElement).value)"
                />
              </td>
              <td>
                <span v-if="stage.key === 'verify'" class="muted">{{ t('factory.config.noPermission') }}</span>
                <select
                  v-else
                  :value="props.config.stages[stage.key].permissionMode"
                  :disabled="saving"
                  :data-config-permission="stage.key"
                  @change="setPermission(stage.key, ($event.target as HTMLSelectElement).value as FactoryPermissionMode)"
                >
                  <option
                    v-for="mode in FACTORY_STAGE_PERMISSIONS[stage.key]"
                    :key="mode"
                    :value="mode"
                  >
                    {{ t(`factory.config.permissions.${mode}`) }}
                  </option>
                </select>
              </td>
              <td>
                <label
                  v-if="stage.key === 'review' || stage.key === 'merge'"
                  class="gate"
                  :class="{ off: !props.config.stages[stage.key].humanGate }"
                >
                  <input
                    type="checkbox"
                    :checked="props.config.stages[stage.key].humanGate"
                    :disabled="saving"
                    :data-config-gate="stage.key"
                    @change="setGate(stage.key, ($event.target as HTMLInputElement).checked)"
                  />
                  <span>
                    {{ props.config.stages[stage.key].humanGate
                      ? t('factory.config.gateOn')
                      : t('factory.config.gateOff') }}
                  </span>
                </label>
                <span v-else class="muted">{{ t('factory.config.noPermission') }}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="props.config.tracker.type === 'github-issues'" class="global-row">
          <span class="field">
            <span>{{ t('factory.mergeModeLabel') }}</span>
            <span class="segmented">
              <button
                :class="{ active: props.config.tracker.mergeMode === 'local' }"
                :disabled="saving"
                data-config-merge-local
                @click="emit('update:mergeMode', 'local')"
              >
                {{ t('factory.mergeLocal') }}
              </button>
              <button
                :class="{ active: props.config.tracker.mergeMode === 'pr' }"
                :disabled="saving"
                data-config-merge-pr
                @click="emit('update:mergeMode', 'pr')"
              >
                {{ t('factory.mergePr') }}
              </button>
            </span>
          </span>
          <span class="muted">{{ t('factory.mergeModeHint') }}</span>
        </div>

        <div class="global-row">
          <label class="field">
            <span>{{ t('factory.config.concurrency') }}</span>
            <input
              type="number"
              min="1"
              max="20"
              :value="props.config.agent.maxConcurrency"
              :disabled="saving"
              data-config-concurrency
              @change="setConcurrency(($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="field wide">
            <span>{{ t('factory.config.verifyCommand') }}</span>
            <input
              type="text"
              :value="props.config.commands.verify"
              :disabled="saving"
              data-config-verify
              @change="emit('update:verify', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <span class="field">
            <span>{{ t('factory.config.totalSpend') }}</span>
            <b data-config-spend>
              {{ props.hasCost ? `$${props.costUsd.toFixed(2)}` : t('factory.run.tokenCount', { count: props.totalTokens }) }}
            </b>
          </span>
        </div>

        <p class="note">
          <AlertTriangle :size="13" />
          <span>{{ t('factory.config.verifyHint') }}</span>
        </p>

        <div v-if="gateOff" class="gate-warning" data-config-gate-warning>
          <p>{{ t('factory.config.gateWarning') }}</p>
          <label class="ack">
            <input
              type="checkbox"
              :checked="props.confirmGateOff"
              :disabled="saving"
              data-config-gate-confirm
              @change="emit('update:gateConfirm', ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ t('factory.config.gateConfirm') }}</span>
          </label>
        </div>

        <div v-if="error" class="error-block" data-config-error>
          <p>{{ errorText }}</p>
          <ul v-if="fieldErrors.length" data-config-field-errors>
            <li v-for="field in fieldErrors" :key="field">
              {{ fieldText(field) }}
            </li>
          </ul>
        </div>
      </div>

      <footer class="dialog-footer">
        <span class="spacer" />
        <button class="ghost-btn" :disabled="saving" @click="emit('close')">
          {{ t('factory.cancel') }}
        </button>
        <button class="primary-btn" data-config-save :disabled="saving" @click="emit('save')">
          {{ saving ? t('factory.config.saving') : t('factory.config.save') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Workflow, X } from 'lucide-vue-next'
import {
  FACTORY_STAGE_PERMISSIONS,
  type FactoryConfig,
  type FactoryPermissionMode,
  type FactoryStageConfig,
  type FactoryStageKey,
} from '@/shared/factory'

const props = withDefaults(
  defineProps<{
    config: FactoryConfig
    totalTokens: number
    costUsd: number
    hasCost: boolean
    saving: boolean
    error: string | null
    fieldErrors: string[]
    conflictRevision: number | null
    confirmGateOff: boolean
  }>(),
  {
    totalTokens: 0,
    costUsd: 0,
    hasCost: false,
    saving: false,
    error: null,
    fieldErrors: () => [],
    conflictRevision: null,
    confirmGateOff: false,
  },
)

const emit = defineEmits<{
  close: []
  save: []
  'update:stage': [key: FactoryStageKey, patch: Partial<FactoryStageConfig>]
  'update:concurrency': [value: number]
  'update:verify': [value: string]
  'update:gateConfirm': [value: boolean]
  'update:mergeMode': [mode: 'local' | 'pr']
}>()

const { t } = useI18n()

/** 固定流水线的阶段顺序；不做 DAG 编辑器，只按此表渲染。 */
const STAGES: readonly { key: FactoryStageKey; labelKey: string; hintKey: string }[] = [
  { key: 'plan', labelKey: 'factory.config.stages.plan', hintKey: 'factory.config.stageHints.plan' },
  { key: 'implement', labelKey: 'factory.config.stages.implement', hintKey: 'factory.config.stageHints.implement' },
  { key: 'verify', labelKey: 'factory.config.stages.verify', hintKey: 'factory.config.stageHints.verify' },
  { key: 'review', labelKey: 'factory.config.stages.review', hintKey: 'factory.config.stageHints.review' },
  { key: 'merge', labelKey: 'factory.config.stages.merge', hintKey: 'factory.config.stageHints.merge' },
]

const gateOff = computed(() => props.config.stages.merge.humanGate === false)

const errorText = computed(() =>
  props.error
    ? t(`factory.config.errors.${props.error}`, {
        ...(props.conflictRevision !== null ? { current: props.conflictRevision } : {}),
      })
    : '',
)

function fieldText(field: string): string {
  return t(`factory.config.fields.${field}`)
}

function setEnabled(key: FactoryStageKey, value: boolean): void {
  emit('update:stage', key, { enabled: value })
}

function setModel(key: FactoryStageKey, value: string): void {
  const model = value.trim()
  emit('update:stage', key, model ? { model } : { model: undefined })
}

function setPermission(key: FactoryStageKey, value: FactoryPermissionMode): void {
  emit('update:stage', key, { permissionMode: value })
}

function setGate(key: FactoryStageKey, value: boolean): void {
  emit('update:stage', key, { humanGate: value })
}

function setIterations(raw: string): void {
  const value = Number.parseInt(raw, 10)
  emit('update:stage', 'implement', {
    ...(Number.isFinite(value) && value > 0 ? { maxIterations: value } : {}),
  })
}

function setConcurrency(raw: string): void {
  const value = Number.parseInt(raw, 10)
  if (Number.isFinite(value)) emit('update:concurrency', value)
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

.config-dialog {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
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

.fixed-hint,
.note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.stage-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th {
    padding: 6px 8px;
    border-bottom: 1px solid var(--surface-border);
    text-align: left;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
  }

  td {
    padding: 7px 8px;
    border-bottom: 1px solid var(--surface-border);
    vertical-align: top;
    color: var(--text-secondary);
  }

  b {
    display: block;
    font-weight: 600;
    color: var(--text-primary);
  }

  small {
    display: block;
    margin-top: 2px;
    font-size: 10px;
    color: var(--text-muted);
  }
}

.switch {
  display: inline-flex;

  input {
    cursor: pointer;
  }
}

.iterations {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 5px;
  font-size: 10px;
  color: var(--text-muted);

  input {
    width: 48px;
  }
}

.model-input,
.field input,
select {
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--surface-glass);
  color: var(--text-primary);
  font-size: 11px;
}

.model-input {
  width: 100%;
  box-sizing: border-box;
}

.gate {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--success);
  cursor: pointer;

  &.off {
    color: var(--warning);
  }
}

.muted {
  color: var(--text-disabled);
}

.global-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--text-muted);

  b {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
  }

  input {
    width: 96px;
  }

  &.wide {
    flex: 1;

    input {
      width: 100%;
      box-sizing: border-box;
    }
  }
}

.segmented {
  display: inline-flex;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  overflow: hidden;

  button {
    padding: 5px 12px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;

    &.active {
      background: var(--surface-glass);
      color: var(--text-primary);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }
}

.gate-warning {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-left: 2px solid var(--warning);
  border-radius: var(--radius-md);
  background: var(--surface-glass);

  p {
    margin: 0;
    font-size: 11px;
    color: var(--warning);
  }
}

.ack {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
}

.error-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  border-left: 2px solid var(--error);
  border-radius: var(--radius-md);
  background: var(--surface-glass);

  p {
    margin: 0;
    font-size: 11px;
    color: var(--error);
  }

  ul {
    margin: 0;
    padding-left: 16px;
    font-size: 11px;
    color: var(--error);
  }
}

.dialog-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--surface-border);
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
</style>

<template>
  <section class="authorization-policy" data-testid="super-agent-authorization-policy">
    <header class="panel-header">
      <span class="panel-title">{{ t('superAgent.authorization.title') }}</span>
      <span v-if="policy" class="policy-version" data-testid="authorization-version">
        {{ t('superAgent.authorization.version', { version: policy.version }) }}
      </span>
    </header>

    <p v-if="loading" class="panel-state" data-testid="authorization-loading">
      {{ t('superAgent.authorization.loading') }}
    </p>
    <p v-else-if="!policy" class="panel-state" data-testid="authorization-empty">
      {{ t('superAgent.authorization.empty') }}
    </p>

    <template v-else>
      <div class="field">
        <label class="field-label" for="authorization-accept-mode">
          {{ t('superAgent.authorization.acceptMode') }}
        </label>
        <select
          id="authorization-accept-mode"
          v-model="acceptMode"
          class="field-control"
          data-testid="authorization-accept-mode"
        >
          <option value="off">{{ t('superAgent.authorization.modes.off') }}</option>
          <option value="observe">{{ t('superAgent.authorization.modes.observe') }}</option>
          <option value="auto">{{ t('superAgent.authorization.modes.auto') }}</option>
        </select>
        <p class="field-hint" data-testid="authorization-accept-mode-hint">{{ modeHint }}</p>
      </div>

      <div class="subsection" data-testid="authorization-rules">
        <div class="subsection-head">
          <span class="subsection-title">{{ t('superAgent.authorization.rules.title') }}</span>
          <button
            type="button"
            class="add-button"
            data-testid="authorization-rule-add"
            @click="addRule"
          >
            {{ t('superAgent.authorization.rules.add') }}
          </button>
        </div>
        <p class="subsection-hint">{{ t('superAgent.authorization.rules.hint') }}</p>
        <p v-if="rules.length === 0" class="subsection-empty" data-testid="authorization-rules-empty">
          {{ t('superAgent.authorization.rules.empty') }}
        </p>
        <div
          v-for="(rule, index) in rules"
          :key="index"
          class="edit-row"
          :data-testid="`authorization-rule-${index}`"
        >
          <input
            v-model="rule.name"
            class="edit-input name"
            :data-testid="`authorization-rule-name-${index}`"
            :placeholder="t('superAgent.authorization.rules.name')"
          />
          <input
            v-model="rule.instruction"
            class="edit-input instruction"
            :data-testid="`authorization-rule-instruction-${index}`"
            :placeholder="t('superAgent.authorization.rules.instruction')"
          />
          <button
            type="button"
            class="remove-button"
            :data-testid="`authorization-rule-remove-${index}`"
            :aria-label="t('superAgent.authorization.rules.remove')"
            @click="removeRule(index)"
          >
            ✕
          </button>
        </div>
      </div>

      <div class="subsection" data-testid="authorization-admissions">
        <div class="subsection-head">
          <span class="subsection-title">{{ t('superAgent.authorization.admissions.title') }}</span>
          <button
            type="button"
            class="add-button"
            data-testid="authorization-admission-add"
            @click="addAdmission"
          >
            {{ t('superAgent.authorization.admissions.add') }}
          </button>
        </div>
        <p class="subsection-hint">{{ t('superAgent.authorization.admissions.hint') }}</p>
        <p
          v-if="admissions.length === 0"
          class="subsection-empty"
          data-testid="authorization-admissions-empty"
        >
          {{ t('superAgent.authorization.admissions.empty') }}
        </p>
        <div
          v-for="(admission, index) in admissions"
          :key="index"
          class="admission-card"
          :data-testid="`authorization-admission-${index}`"
        >
          <div class="admission-head">
            <input
              v-model="admission.source"
              class="edit-input source"
              :data-testid="`authorization-admission-source-${index}`"
              :placeholder="t('superAgent.authorization.admissions.source')"
            />
            <button
              type="button"
              class="remove-button"
              :data-testid="`authorization-admission-remove-${index}`"
              :aria-label="t('superAgent.authorization.admissions.remove')"
              @click="removeAdmission(index)"
            >
              ✕
            </button>
          </div>
          <input
            v-model="admission.channels"
            class="edit-input"
            :data-testid="`authorization-admission-channels-${index}`"
            :placeholder="t('superAgent.authorization.admissions.channels')"
          />
          <input
            v-model="admission.allowlist"
            class="edit-input"
            :data-testid="`authorization-admission-allowlist-${index}`"
            :placeholder="t('superAgent.authorization.admissions.allowlist')"
          />
          <input
            v-model="admission.bots"
            class="edit-input"
            :data-testid="`authorization-admission-bots-${index}`"
            :placeholder="t('superAgent.authorization.admissions.bots')"
          />
        </div>
      </div>

      <footer class="save-bar">
        <span
          v-if="invalid"
          class="bar-hint invalid"
          data-testid="authorization-invalid"
        >
          {{ t('superAgent.authorization.invalidHint') }}
        </span>
        <span
          v-else-if="dirty"
          class="bar-hint dirty"
          data-testid="authorization-dirty"
        >
          {{ t('superAgent.authorization.dirty') }}
        </span>
        <span v-else class="bar-hint" />
        <button
          type="button"
          class="bar-button"
          data-testid="authorization-reset"
          :disabled="saving"
          @click="resetDraft"
        >
          {{ t('superAgent.authorization.reset') }}
        </button>
        <button
          type="button"
          class="bar-button primary"
          data-testid="authorization-save"
          :disabled="saving || invalid"
          @click="save"
        >
          {{ saving ? t('superAgent.authorization.saving') : t('superAgent.authorization.save') }}
        </button>
      </footer>

      <p
        v-if="hint"
        class="action-hint"
        :class="{ failed: hintFailed }"
        data-testid="authorization-hint"
      >
        {{ hint }}
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  SuperAgentAcceptMode,
  SuperAgentAuthorizationPolicy,
  SuperAgentAuthorizationPolicySetCommand,
} from '@/shared/channels/superAgent'

interface RuleDraft {
  name: string
  instruction: string
}

interface AdmissionDraft {
  source: string
  channels: string
  allowlist: string
  bots: string
}

const props = defineProps<{
  policy: SuperAgentAuthorizationPolicy | null
  loading?: boolean
  saving?: boolean
  hint?: string
  hintFailed?: boolean
}>()

const emit = defineEmits<{
  (event: 'save', command: SuperAgentAuthorizationPolicySetCommand): void
}>()

const { t } = useI18n()

const acceptMode = ref<SuperAgentAcceptMode>('off')
const rules = ref<RuleDraft[]>([])
const admissions = ref<AdmissionDraft[]>([])

const modeHint = computed(() => t(`superAgent.authorization.modeHints.${acceptMode.value}`))

/** 任一必填项为空时禁止保存，避免把半成品交给入口校验。 */
const invalid = computed(
  () =>
    rules.value.some((rule) => rule.name.trim() === '' || rule.instruction.trim() === '') ||
    admissions.value.some((admission) => admission.source.trim() === ''),
)

const savedCommand = computed<SuperAgentAuthorizationPolicySetCommand>(() => ({
  acceptMode: props.policy?.acceptMode ?? 'off',
  rules: (props.policy?.rules ?? []).map((rule) => ({
    name: rule.name,
    instruction: rule.instruction,
  })),
  admissions: (props.policy?.admissions ?? []).map((admission) => ({
    source: admission.source,
    channels: [...admission.channels],
    allowlist: [...admission.allowlist],
    bots: [...admission.bots],
  })),
}))

const dirty = computed(
  () => JSON.stringify(buildCommand()) !== JSON.stringify(savedCommand.value),
)

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function joinList(values: string[]): string {
  return values.join(', ')
}

function buildCommand(): SuperAgentAuthorizationPolicySetCommand {
  return {
    acceptMode: acceptMode.value,
    rules: rules.value.map((rule) => ({
      name: rule.name.trim(),
      instruction: rule.instruction.trim(),
    })),
    admissions: admissions.value.map((admission) => ({
      source: admission.source.trim(),
      channels: splitList(admission.channels),
      allowlist: splitList(admission.allowlist),
      bots: splitList(admission.bots),
    })),
  }
}

/** 草稿是保存快照的投影：父级回填新 version 后必须整体重置。 */
function resetDraft(): void {
  const policy = props.policy
  acceptMode.value = policy?.acceptMode ?? 'off'
  rules.value = (policy?.rules ?? []).map((rule) => ({
    name: rule.name,
    instruction: rule.instruction,
  }))
  admissions.value = (policy?.admissions ?? []).map((admission) => ({
    source: admission.source,
    channels: joinList(admission.channels),
    allowlist: joinList(admission.allowlist),
    bots: joinList(admission.bots),
  }))
}

watch(() => props.policy, resetDraft, { immediate: true })

function addRule(): void {
  rules.value.push({ name: '', instruction: '' })
}

function removeRule(index: number): void {
  rules.value.splice(index, 1)
}

function addAdmission(): void {
  admissions.value.push({ source: '', channels: '', allowlist: '', bots: '' })
}

function removeAdmission(index: number): void {
  admissions.value.splice(index, 1)
}

function save(): void {
  if (invalid.value) return
  emit('save', buildCommand())
}
</script>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.authorization-policy {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-elevated);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  .panel-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .policy-version {
    font-size: 12px;
    color: var(--text-muted);
  }
}

.panel-state {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;

  .field-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .field-control {
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 12px;
  }

  .field-hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }
}

.subsection {
  display: flex;
  flex-direction: column;
  gap: 6px;

  .subsection-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .subsection-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .subsection-hint,
  .subsection-empty {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }
}

.add-button,
.remove-button,
.bar-button {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.add-button {
  padding: 2px 8px;
}

.remove-button {
  width: 24px;
  height: 24px;
  flex: none;
}

.edit-row {
  display: grid;
  grid-template-columns: minmax(80px, 1fr) minmax(0, 2fr) auto;
  gap: 6px;
  align-items: center;
}

.admission-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--surface-hover);

  .admission-head {
    display: flex;
    gap: 6px;
    align-items: center;
  }
}

.edit-input {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
}

.save-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);

  .bar-hint {
    flex: 1;
    font-size: 12px;
    color: var(--text-muted);

    &.invalid {
      color: var(--danger, #d93025);
    }
  }

  .bar-button {
    padding: 4px 10px;

    &.primary {
      border-color: var(--accent-primary);
      background: var(--accent-primary);
      color: var(--bg-elevated);
    }
  }
}

.action-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);

  &.failed {
    color: var(--danger, #d93025);
  }
}
</style>

<template>
  <SuperAgentDialog
    :visible="visible"
    :title="t('superAgent.authorization.title')"
    size="lg"
    @close="requestClose"
  >
    <template #subtitle>
      <span class="scope-tag">{{ t('superAgent.authorization.scope') }}</span>
      <code v-if="repoRoot" class="scope-path">{{ repoRoot }}</code>
      <span v-if="policy" class="policy-version" data-testid="authorization-version">
        {{ t('superAgent.authorization.version', { version: policy.version }) }}
      </span>
    </template>

    <div v-if="loading" class="skeleton-stack" data-testid="authorization-loading">
      <span class="skeleton-row" />
      <span class="skeleton-row" />
      <span class="skeleton-row" />
    </div>

    <p v-else-if="!policy" class="panel-state" data-testid="authorization-empty">
      {{ t('superAgent.authorization.empty') }}
    </p>

    <div v-else class="policy-form" data-testid="super-agent-authorization-policy">
      <!-- 自动接受模式：三档互斥用单选组，说明随行切换 -->
      <section class="group">
        <h3 class="group-title">{{ t('superAgent.authorization.acceptMode') }}</h3>
        <div
          class="segments"
          role="radiogroup"
          :aria-label="t('superAgent.authorization.acceptMode')"
          data-testid="authorization-accept-mode"
        >
          <label v-for="mode in acceptModes" :key="mode" class="segment">
            <input
              v-model="acceptMode"
              type="radio"
              name="authorization-accept-mode"
              :value="mode"
              class="segment-input"
              :data-testid="`authorization-accept-mode-${mode}`"
            />
            <span class="segment-label">{{ t(`superAgent.authorization.modes.${mode}`) }}</span>
          </label>
        </div>
        <p class="group-hint" data-testid="authorization-accept-mode-hint">{{ modeHint }}</p>
      </section>

      <section class="group" data-testid="authorization-rules">
        <div class="group-head">
          <h3 class="group-title">{{ t('superAgent.authorization.rules.title') }}</h3>
          <button
            type="button"
            class="add-button"
            data-testid="authorization-rule-add"
            @click="addRule"
          >
            <Plus :size="13" />
            <span>{{ t('superAgent.authorization.rules.add') }}</span>
          </button>
        </div>
        <p class="group-hint">{{ t('superAgent.authorization.rules.hint') }}</p>

        <p v-if="rules.length === 0" class="group-empty" data-testid="authorization-rules-empty">
          {{ t('superAgent.authorization.rules.empty') }}
        </p>

        <div
          v-for="(rule, index) in rules"
          :key="index"
          class="rule-row"
          :data-testid="`authorization-rule-${index}`"
        >
          <input
            v-model="rule.name"
            class="text-input name"
            :class="{ 'is-invalid': rule.name.trim() === '' }"
            :aria-label="t('superAgent.authorization.rules.name')"
            :placeholder="t('superAgent.authorization.rules.name')"
            :data-testid="`authorization-rule-name-${index}`"
          />
          <input
            v-model="rule.instruction"
            class="text-input instruction"
            :class="{ 'is-invalid': rule.instruction.trim() === '' }"
            :aria-label="t('superAgent.authorization.rules.instruction')"
            :placeholder="t('superAgent.authorization.rules.instruction')"
            :data-testid="`authorization-rule-instruction-${index}`"
          />
          <button
            type="button"
            class="icon-button"
            :data-testid="`authorization-rule-remove-${index}`"
            :aria-label="t('superAgent.authorization.rules.remove')"
            @click="removeRule(index)"
          >
            <Trash2 :size="14" />
          </button>
        </div>

        <p
          v-if="rules.some((rule) => !ruleComplete(rule))"
          class="group-error"
          data-testid="authorization-rules-error"
        >
          {{ t('superAgent.authorization.rules.incomplete') }}
        </p>
      </section>

      <section class="group" data-testid="authorization-admissions">
        <div class="group-head">
          <h3 class="group-title">{{ t('superAgent.authorization.admissions.title') }}</h3>
          <button
            type="button"
            class="add-button"
            data-testid="authorization-admission-add"
            @click="addAdmission"
          >
            <Plus :size="13" />
            <span>{{ t('superAgent.authorization.admissions.add') }}</span>
          </button>
        </div>
        <p class="group-hint">{{ t('superAgent.authorization.admissions.hint') }}</p>

        <p
          v-if="admissions.length === 0"
          class="group-empty"
          data-testid="authorization-admissions-empty"
        >
          {{ t('superAgent.authorization.admissions.empty') }}
        </p>

        <article
          v-for="(admission, index) in admissions"
          :key="index"
          class="admission-card"
          :data-testid="`authorization-admission-${index}`"
        >
          <div class="admission-head">
            <input
              v-model="admission.source"
              class="text-input"
              :class="{ 'is-invalid': admission.source.trim() === '' }"
              :aria-label="t('superAgent.authorization.admissions.source')"
              :placeholder="t('superAgent.authorization.admissions.source')"
              :data-testid="`authorization-admission-source-${index}`"
            />
            <button
              type="button"
              class="icon-button"
              :data-testid="`authorization-admission-remove-${index}`"
              :aria-label="t('superAgent.authorization.admissions.remove')"
              @click="removeAdmission(index)"
            >
              <Trash2 :size="14" />
            </button>
          </div>

          <div class="admission-grid">
            <label v-for="field in listFields" :key="field" class="list-field">
              <span class="list-field-label">
                {{ t(`superAgent.authorization.admissions.fields.${field}`) }}
              </span>
              <input
                v-model="admission[field]"
                class="text-input"
                :placeholder="t(`superAgent.authorization.admissions.examples.${field}`)"
                :data-testid="`authorization-admission-${field}-${index}`"
              />
            </label>
          </div>
          <p class="list-hint">{{ t('superAgent.authorization.admissions.listHint') }}</p>
        </article>

        <p
          v-if="admissions.some((item) => item.source.trim() === '')"
          class="group-error"
          data-testid="authorization-admissions-error"
        >
          {{ t('superAgent.authorization.admissions.sourceRequired') }}
        </p>
      </section>
    </div>

    <template #footer>
      <div class="footer-status">
        <span
          v-if="hint"
          class="status-hint"
          :class="{ failed: hintFailed }"
          data-testid="authorization-hint"
        >
          {{ hint }}
        </span>
        <span v-else-if="invalid" class="status-hint failed" data-testid="authorization-invalid">
          {{ t('superAgent.authorization.invalidHint') }}
        </span>
        <span v-else-if="dirty" class="status-hint dirty" data-testid="authorization-dirty">
          <span class="dirty-dot" aria-hidden="true" />
          {{ t('superAgent.authorization.dirty') }}
        </span>
      </div>
      <div class="footer-actions">
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
      </div>
    </template>
  </SuperAgentDialog>
</template>

<script setup lang="ts">
/**
 * 授权策略弹窗（T25 #96）。
 *
 * 弹窗承载而非内联展开：主区顶部那条带里有 z-index 30 的悬浮工卡，内联必被压住。
 * 关闭时若有未保存改动要走确认 —— 丢一次表单改动比多点一次鼠标贵。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2 } from 'lucide-vue-next'
import { useDialog } from '@/composables/useDialog'
import type {
  SuperAgentAcceptMode,
  SuperAgentAuthorizationPolicy,
  SuperAgentAuthorizationPolicySetCommand,
} from '@/shared/channels/superAgent'
import SuperAgentDialog from './SuperAgentDialog.vue'

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
  visible: boolean
  policy: SuperAgentAuthorizationPolicy | null
  repoRoot?: string
  loading?: boolean
  saving?: boolean
  hint?: string
  hintFailed?: boolean
}>()

const emit = defineEmits<{
  (event: 'save', command: SuperAgentAuthorizationPolicySetCommand): void
  (event: 'close'): void
}>()

const { t } = useI18n()
const { showConfirm } = useDialog()

const acceptModes = ['off', 'observe', 'auto'] as const
const listFields = ['channels', 'allowlist', 'bots'] as const

const acceptMode = ref<SuperAgentAcceptMode>('off')
const rules = ref<RuleDraft[]>([])
const admissions = ref<AdmissionDraft[]>([])

const modeHint = computed(() => t(`superAgent.authorization.modeHints.${acceptMode.value}`))

function ruleComplete(rule: RuleDraft): boolean {
  return rule.name.trim() !== '' && rule.instruction.trim() !== ''
}

/** 任一必填项为空时禁止保存，避免把半成品交给入口校验。 */
const invalid = computed(
  () =>
    rules.value.some((rule) => !ruleComplete(rule)) ||
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

async function requestClose(): Promise<void> {
  if (!dirty.value) {
    emit('close')
    return
  }
  const confirmed = await showConfirm(t('superAgent.authorization.closeConfirm'))
  if (confirmed) emit('close')
}

function save(): void {
  if (invalid.value) return
  emit('save', buildCommand())
}
</script>

<style scoped lang="scss">
@use '@/styles/variables' as *;
@use '@/styles/mixins' as *;

.scope-tag {
  padding: 1px 7px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-full);
  background: var(--surface-glass);
  color: var(--text-secondary);
  font-size: var(--text-2xs);
}

.scope-path {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  word-break: break-all;
}

.policy-version {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.panel-state {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.policy-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.skeleton-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.skeleton-row {
  display: block;
  height: 30px;
  border-radius: var(--radius-sm);

  @include shimmer-loading;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.group-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
  color: var(--text-primary);
}

.group-hint,
.group-empty {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.group-empty {
  padding: 8px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
}

.group-error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--error);
}

/* ── 自动接受模式：分段单选组 ─────────────────────────── */
.segments {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-glass);
}

.segment {
  position: relative;
  display: inline-flex;
  flex: 1;
}

.segment-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.segment-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.segment-input:hover + .segment-label {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.segment-input:checked + .segment-label {
  background: var(--bg-elevated);
  box-shadow: 0 0 0 1px var(--accent-primary) inset;
  color: var(--accent-primary);
  font-weight: var(--font-weight-medium);
}

.segment-input:focus-visible + .segment-label {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

/* ── 规则行 ─────────────────────────────────────────── */
.rule-row {
  display: grid;
  grid-template-columns: minmax(112px, 176px) minmax(0, 1fr) 28px;
  align-items: center;
  gap: 8px;
}

.add-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  @include focus-ring;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);

  &:hover {
    border-color: var(--border-light);
    background: var(--surface-hover);
    color: var(--error);
  }

  @include focus-ring;
}

.text-input {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: var(--text-sm);
  transition: border-color var(--transition-fast);

  &::placeholder {
    color: var(--text-disabled);
  }

  &:hover {
    border-color: var(--text-disabled);
  }

  &.is-invalid {
    border-color: var(--error);
  }

  @include focus-ring;
}

/* ── Source 准入卡 ──────────────────────────────────── */
.admission-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-glass);
}

.admission-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  align-items: center;
  gap: 8px;
}

.admission-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(176px, 1fr));
  gap: 8px 10px;
}

.list-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.list-field-label {
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
}

.list-hint {
  margin: 0;
  font-size: var(--text-2xs);
  color: var(--text-muted);
}

/* ── 底栏 ───────────────────────────────────────────── */
.footer-status {
  flex: 1;
  min-width: 0;
}

.status-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--text-secondary);

  &.failed {
    color: var(--error);
  }
}

.dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--accent-primary);
}

.footer-actions {
  display: inline-flex;
  gap: 8px;
  flex: none;
}

.bar-button {
  padding: 5px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast), border-color var(--transition-fast);

  &:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  &.primary {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: var(--bg-elevated);

    &:hover:not(:disabled) {
      background: var(--accent-primary-hover);
    }
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  @include focus-ring;
}
</style>

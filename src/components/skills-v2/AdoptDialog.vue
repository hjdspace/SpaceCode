<script setup lang="ts">
/**
 * Skill Manager V2 — Adopt Dialog
 *
 * Preview an unmanaged skill, choose an adoption option, then execute.
 * Reference: AgentBro `src/components/skills-v2/AdoptDialog.tsx`
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { AdoptOption, AdoptPreview } from '@/types/skillManagerV2'

const props = defineProps<{
  visible: boolean
  agentId: string
  unmanagedId: string
  skillPath?: string
}>()

const emit = defineEmits<{
  close: []
  adopted: []
}>()

const { t } = useI18n()
const store = useSkillManagerStore()

const preview = ref<AdoptPreview | null>(null)
const selectedOption = ref<AdoptOption | null>(null)
const renamedId = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

/** Legacy aliases normalize to these canonical options in the backend. */
const CANONICAL_OPTION: Partial<Record<AdoptOption, AdoptOption>> = {
  import_to_center: 'import_keep',
  replace_with_link: 'import_link',
  replace_with_copy: 'import_copy',
}

const DESTRUCTIVE_OPTIONS: ReadonlySet<AdoptOption> = new Set([
  'import_link',
  'import_copy',
  'import_cleanup',
  'center_over_agent',
  'overwrite_center',
])

interface OptionCopy {
  title: string
  desc: string
  badge: string
  impact: string
  destructive: boolean
}

const skillName = computed(() => preview.value?.inferredSkillId || t('skillManagerV2.install.adoptUnnamed'))
const conflictNotice = computed(() => {
  const reason = preview.value?.conflictReason
  if (!reason) return null
  const match = reason.match(/^Center library has a skill with id '(.+)' but content differs\./)
  return match ? t('skillManagerV2.install.adoptConflictNotice', { skill: match[1] }) : reason
})

const displayOptions = computed<AdoptOption[]>(() => {
  const options = preview.value?.options ?? []
  const filtered = options.filter((option) => {
    const canonical = CANONICAL_OPTION[option]
    return !canonical || !options.includes(canonical)
  })
  return filtered.length > 0 ? filtered : options
})

/** AgentBro preferredAdoptOption: center wins > cleanup > link > first. */
function preferredAdoptOption(options: AdoptOption[]): AdoptOption | null {
  return (
    options.find((o) => o === 'center_over_agent') ??
    options.find((o) => o === 'import_cleanup') ??
    options.find((o) => o === 'import_link') ??
    options[0] ??
    null
  )
}

function optionCopy(option: AdoptOption): OptionCopy {
  const k = 'skillManagerV2.install'
  const canonical = CANONICAL_OPTION[option] ?? option
  switch (canonical) {
    case 'import_keep':
      return { title: t(`${k}.adoptImportKeepTitle`), desc: t(`${k}.adoptImportKeepDesc`), badge: t(`${k}.adoptBadgeKeep`), impact: t(`${k}.adoptImportKeepImpact`), destructive: false }
    case 'import_link':
      return { title: t(`${k}.adoptImportLinkTitle`), desc: t(`${k}.adoptImportLinkDesc`), badge: t(`${k}.adoptRecommended`), impact: t(`${k}.adoptImportLinkImpact`), destructive: true }
    case 'import_copy':
      return { title: t(`${k}.adoptImportCopyTitle`), desc: t(`${k}.adoptImportCopyDesc`), badge: t(`${k}.adoptBadgeCopy`), impact: t(`${k}.adoptImportCopyImpact`), destructive: true }
    case 'import_cleanup':
      return { title: t(`${k}.adoptCleanupTitle`), desc: t(`${k}.adoptCleanupDesc`), badge: t(`${k}.adoptRecommended`), impact: t(`${k}.adoptCleanupImpact`), destructive: true }
    case 'center_over_agent':
      return { title: t(`${k}.adoptCenterOverAgentTitle`), desc: t(`${k}.adoptCenterOverAgentDesc`), badge: t(`${k}.adoptRecommended`), impact: t(`${k}.adoptCenterOverAgentImpact`), destructive: true }
    case 'overwrite_center':
      return { title: t(`${k}.adoptOverwriteCenterTitle`), desc: t(`${k}.adoptOverwriteCenterDesc`), badge: t(`${k}.adoptBadgeOverwrite`), impact: t(`${k}.adoptOverwriteCenterImpact`), destructive: true }
    case 'rename':
      return { title: t(`${k}.adoptRenameTitle`), desc: t(`${k}.adoptRenameDesc`), badge: t(`${k}.adoptBadgeRename`), impact: t(`${k}.adoptRenameImpact`), destructive: false }
    case 'skip':
      return { title: t(`${k}.adoptSkipTitle`), desc: t(`${k}.adoptSkipDesc`), badge: t(`${k}.adoptBadgeSkip`), impact: t(`${k}.adoptSkipImpact`), destructive: false }
    default:
      return { title: option, desc: '', badge: '', impact: '', destructive: DESTRUCTIVE_OPTIONS.has(option) }
  }
}

const selectedCopy = computed(() =>
  selectedOption.value ? optionCopy(selectedOption.value) : null
)
const changesFiles = computed(() => selectedCopy.value?.destructive ?? false)
const effectiveRenamedId = computed(() => renamedId.value.trim() || `${preview.value?.inferredSkillId ?? ''}-import`)
const renameInvalid = computed(
  () => selectedOption.value === 'rename' && !renamedId.value.trim()
)

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return
    preview.value = null
    selectedOption.value = null
    renamedId.value = ''
    error.value = null
    busy.value = true
    try {
      const result = await store.previewAdopt(props.agentId, props.unmanagedId)
      if (!result) {
        error.value = store.error ?? t('skillManagerV2.install.adoptFailed')
        return
      }
      preview.value = result
      selectedOption.value = preferredAdoptOption(
        displayOptionsFor(result.options)
      )
    } finally {
      busy.value = false
    }
  }
)

function displayOptionsFor(options: AdoptOption[]): AdoptOption[] {
  const filtered = options.filter((option) => {
    const canonical = CANONICAL_OPTION[option]
    return !canonical || !options.includes(canonical)
  })
  return filtered.length > 0 ? filtered : options
}

function selectOption(option: AdoptOption): void {
  selectedOption.value = option
  if (option === 'rename' && !renamedId.value.trim() && preview.value) {
    renamedId.value = `${preview.value.inferredSkillId}-import`
  }
}

async function onExecute(): Promise<void> {
  if (!selectedOption.value || busy.value) return
  if (renameInvalid.value) {
    error.value = t('skillManagerV2.install.adoptRenameRequired')
    return
  }
  busy.value = true
  error.value = null
  try {
    await store.executeAdopt(
      props.agentId,
      props.unmanagedId,
      selectedOption.value,
      selectedOption.value === 'rename' ? effectiveRenamedId.value : undefined
    )
    if (store.error) {
      error.value = store.error
      return
    }
    emit('adopted')
    emit('close')
  } finally {
    busy.value = false
  }
}

function onClose(): void {
  if (!busy.value) emit('close')
}
</script>

<template>
  <div v-if="visible" class="ad-overlay" @click.self="onClose">
    <section class="ad-dialog" role="dialog" aria-modal="true">
      <header class="ad-header">
        <h2>{{ t('skillManagerV2.install.adoptTitle', { skill: skillName }) }}</h2>
        <button type="button" :disabled="busy" :title="t('common.close')" @click="onClose">
          <X :size="20" />
        </button>
      </header>

      <div class="ad-body">
        <div v-if="!preview && !error" class="ad-loading">{{ t('common.loading') }}</div>

        <template v-else-if="preview">
          <div class="ad-summary">
            <div>
              <span>{{ t('skillManagerV2.install.adoptSkill') }}</span>
              <strong>{{ skillName }}</strong>
            </div>
            <div>
              <span>{{ t('skillManagerV2.install.adoptCenterName') }}</span>
              <strong :class="{ warn: preview.centerHasSameName }">
                {{ preview.centerHasSameName
                  ? t('skillManagerV2.install.adoptExists')
                  : t('skillManagerV2.install.adoptNoConflict') }}
              </strong>
            </div>
            <div class="ad-summary-path">
              <span>{{ t('skillManagerV2.install.adoptAgentPath') }}</span>
              <code :title="skillPath ?? ''">{{ skillPath || '—' }}</code>
            </div>
          </div>

          <div v-if="conflictNotice" class="ad-conflict">{{ conflictNotice }}</div>

          <section class="ad-section">
            <div class="ad-section-head">
              <strong>{{ t('skillManagerV2.install.adoptMethod') }}</strong>
              <span>{{ conflictNotice
                ? t('skillManagerV2.install.adoptNeedsConflict')
                : t('skillManagerV2.install.adoptCanImport') }}</span>
            </div>
            <div class="ad-options" role="radiogroup" :aria-label="t('skillManagerV2.install.adoptMethod')">
              <button
                v-for="option in displayOptions"
                :key="option"
                type="button"
                role="radio"
                :aria-checked="selectedOption === option"
                class="ad-option"
                :class="{
                  active: selectedOption === option,
                  destructive: optionCopy(option).destructive,
                }"
                @click="selectOption(option)"
              >
                <span class="ad-radio" aria-hidden="true" />
                <span class="ad-option-main">
                  <strong>{{ optionCopy(option).title }}</strong>
                  <span>{{ optionCopy(option).desc }}</span>
                </span>
                <em v-if="optionCopy(option).badge">{{ optionCopy(option).badge }}</em>
              </button>
            </div>
          </section>

          <div v-if="selectedOption === 'rename'" class="ad-rename">
            <label for="ad-rename-input">{{ t('skillManagerV2.install.adoptRenameLabel') }}</label>
            <input
              id="ad-rename-input"
              v-model="renamedId"
              type="text"
              :placeholder="t('skillManagerV2.install.adoptRenamePlaceholder', { skill: preview.inferredSkillId })"
            />
            <span>{{ t('skillManagerV2.install.adoptRenameHint', { id: effectiveRenamedId }) }}</span>
          </div>

          <div v-if="selectedCopy" class="ad-impact" :class="{ warn: changesFiles }">
            <strong>{{ changesFiles
              ? t('skillManagerV2.install.adoptImpactDestructive')
              : t('skillManagerV2.install.adoptImpactSafe') }}</strong>
            <span>{{ selectedCopy.impact }}</span>
          </div>
        </template>

        <div v-if="error" class="ad-error">{{ error }}</div>
      </div>

      <footer class="ad-footer">
        <button class="ad-btn" type="button" :disabled="busy" @click="onClose">
          {{ t('skillManagerV2.actions.cancel') }}
        </button>
        <button
          class="ad-btn ad-btn-primary"
          :class="{ danger: changesFiles && selectedOption !== 'skip' }"
          type="button"
          :disabled="busy || !selectedOption || renameInvalid"
          @click="onExecute"
        >
          {{ busy
            ? t('common.processing')
            : selectedOption === 'skip'
              ? t('skillManagerV2.install.adoptKeepUnmanaged')
              : t('skillManagerV2.install.adoptConfirm') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped lang="scss">
.ad-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: grid;
  place-items: center;
  padding: 22px;
  background: rgba(8, 13, 24, 0.62);
  backdrop-filter: blur(5px);
}

.ad-dialog {
  width: min(640px, 100%);
  max-height: min(88vh, 820px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: 16px;
  background: var(--bg-primary);
  box-shadow: 0 30px 80px rgba(5, 10, 20, 0.36);
}

.ad-header {
  min-height: 72px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-elevated);

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 21px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;

    &:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.ad-body {
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px 26px;
}

.ad-loading {
  padding: 40px 0;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.ad-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) minmax(0, 1.4fr);
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);

  span {
    display: block;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  strong {
    display: block;
    margin-top: 5px;
    font-size: 13px;
    overflow-wrap: anywhere;

    &.warn { color: var(--warning); }
  }

  code {
    display: block;
    margin-top: 5px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.ad-conflict {
  margin-top: 12px;
  padding: 9px 12px;
  border: 1px solid rgba(217, 119, 6, 0.25);
  border-radius: var(--radius-md);
  background: rgba(217, 119, 6, 0.07);
  color: var(--warning);
  font-size: 11px;
}

.ad-section {
  margin-top: 14px;
  padding: 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}

.ad-section-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;

  strong { font-size: 13px; }
  span { color: var(--text-muted); font-size: 11px; }
}

.ad-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ad-option {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 11px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.16s, background 0.16s;

  &:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }

  &.active {
    border-color: var(--accent-primary);
    background: var(--accent-primary-glow);
  }

  em {
    padding: 2px 7px;
    border-radius: var(--radius-full);
    background: var(--surface-card);
    color: var(--text-secondary);
    font-size: 10px;
    font-style: normal;
    font-weight: 700;
    white-space: nowrap;
  }

  &.active em {
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
  }

  &.destructive.active {
    border-color: rgba(220, 38, 38, 0.4);
    background: rgba(220, 38, 38, 0.06);

    em {
      background: var(--error);
      color: #fff;
    }
  }
}

.ad-radio {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-strong);
  border-radius: 50%;
  transition: border-color 0.16s, box-shadow 0.16s;

  .ad-option.active & {
    border-color: var(--accent-primary);
    box-shadow: inset 0 0 0 3px var(--bg-elevated);
    background: var(--accent-primary);
  }

  .ad-option.destructive.active & {
    border-color: var(--error);
    background: var(--error);
  }
}

.ad-option-main {
  min-width: 0;

  strong {
    display: block;
    font-size: 12px;
    font-weight: 700;
  }

  span {
    display: block;
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }
}

.ad-rename {
  margin-top: 14px;
  padding: 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);

  label {
    display: block;
    font-size: 12px;
    font-weight: 700;
  }

  input {
    width: 100%;
    height: 36px;
    margin-top: 8px;
    padding: 0 12px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 12px;
    outline: none;

    &:focus { border-color: var(--accent-primary); }
  }

  span {
    display: block;
    margin-top: 8px;
    color: var(--text-muted);
    font-size: 10px;
  }
}

.ad-impact {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 14px;
  padding: 11px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--success) 7%, var(--bg-elevated));

  strong {
    color: var(--success);
    font-size: 11px;
  }

  span {
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.5;
  }

  &.warn {
    border-color: rgba(217, 119, 6, 0.25);
    background: rgba(217, 119, 6, 0.06);

    strong { color: var(--warning); }
  }
}

.ad-error {
  padding: 10px 12px;
  margin-top: 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--error) 12%, transparent);
  color: var(--error);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.ad-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 24px;
  border-top: 1px solid var(--border-default);
  background: var(--bg-elevated);
}

.ad-btn {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
}

.ad-btn-primary {
  border-color: transparent;
  background: var(--accent-primary);
  color: var(--text-on-accent, #fff);

  &.danger {
    background: var(--error);
  }
}

@media (max-width: 620px) {
  .ad-overlay { padding: 0; }
  .ad-dialog {
    height: 100%;
    max-height: none;
    border-radius: 0;
  }
  .ad-body { padding: 16px; }
  .ad-summary { grid-template-columns: 1fr; }
  .ad-footer .ad-btn { flex: 1; }
}
</style>

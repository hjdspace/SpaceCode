<script setup lang="ts">
/**
 * Skill Manager V2 — Import Dialog (Slice 3)
 *
 * Dialog for importing an external skill folder into the center library.
 * Flow: Select folder → Preview → Resolve conflicts → Execute.
 *
 * Reference: AgentBro `src/components/skills-v2/InstallPage.tsx` (local import section)
 */

import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type {
  AddCenterSkillInput,
  AddCenterSkillPreview,
  AddCenterSkillCandidate,
  AddCenterSkillDecision,
} from '@/types/skillManagerV2'

const { t } = useI18n()
const store = useSkillManagerStore()

// ── State ──────────────────────────────────────────────────────────

const visible = ref(false)
const selectedPath = ref('')
const preview = ref<AddCenterSkillPreview | null>(null)
const loading = ref(false)
const executing = ref(false)
const error = ref<string | null>(null)

/** Decisions for blocked candidates, keyed by skillId. */
const blockerDecisions = ref<Map<string, { resolution: 'update' | 'create' | 'skip'; renamedId: string }>>(new Map())

// ── Computed ───────────────────────────────────────────────────────

const hasPreview = computed(() => preview.value !== null)
const hasCandidates = computed(() => (preview.value?.candidates.length ?? 0) > 0)
const hasBlockers = computed(() => (preview.value?.blockers.length ?? 0) > 0)
const hasUnchanged = computed(() => (preview.value?.unchangedCount ?? 0) > 0)

const canExecute = computed(() => {
  if (!preview.value) return false
  if (executing.value) return false
  // All blockers must have a decision
  for (const blocker of preview.value.blockers) {
    const dec = blockerDecisions.value.get(blocker.skillId)
    if (!dec) return false
    if (dec.resolution === 'create' && !dec.renamedId.trim()) return false
  }
  // Must have at least one action to perform
  const hasAction = hasCandidates.value || hasBlockers.value
  return hasAction
})

// ── Actions ────────────────────────────────────────────────────────

function open(): void {
  visible.value = true
  reset()
}

function close(): void {
  visible.value = false
  reset()
}

function reset(): void {
  selectedPath.value = ''
  preview.value = null
  error.value = null
  blockerDecisions.value = new Map()
}

async function selectFolder(): Promise<void> {
  const result = await api.selectFolder()
  if (result.canceled || result.filePaths.length === 0) return

  selectedPath.value = result.filePaths[0]
  await doPreview()
}

async function doPreview(): Promise<void> {
  if (!selectedPath.value) return

  loading.value = true
  error.value = null
  preview.value = null
  blockerDecisions.value = new Map()

  try {
    const input: AddCenterSkillInput = {
      sourcePath: selectedPath.value,
      sourceType: 'local_folder',
      sourceUri: selectedPath.value,
    }
    const result = await store.previewAddCenterSkill(input)
    if (result) {
      preview.value = result
      // Initialize default decisions for blockers
      for (const blocker of result.blockers) {
        blockerDecisions.value.set(blocker.skillId, {
          resolution: 'skip',
          renamedId: `${blocker.skillId}-import`,
        })
      }
    } else {
      error.value = store.error ?? t('skillManagerV2.import.previewFailed')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function getBlockerDecision(skillId: string): { resolution: 'update' | 'create' | 'skip'; renamedId: string } | undefined {
  return blockerDecisions.value.get(skillId)
}

function setBlockerResolution(skillId: string, resolution: 'update' | 'create' | 'skip'): void {
  const existing = blockerDecisions.value.get(skillId)
  blockerDecisions.value.set(skillId, {
    resolution,
    renamedId: existing?.renamedId ?? `${skillId}-import`,
  })
}

function setBlockerRenamedId(skillId: string, renamedId: string): void {
  const existing = blockerDecisions.value.get(skillId)
  if (existing) {
    existing.renamedId = renamedId
  }
}

async function executeImport(): Promise<void> {
  if (!preview.value || !selectedPath.value) return

  executing.value = true
  error.value = null

  try {
    const input: AddCenterSkillInput = {
      sourcePath: selectedPath.value,
      sourceType: 'local_folder',
      sourceUri: selectedPath.value,
    }

    const decisions: AddCenterSkillDecision[] = []
    for (const [skillId, dec] of blockerDecisions.value) {
      decisions.push({
        skillId,
        proposedSkillId: dec.resolution === 'create' ? dec.renamedId : undefined,
        resolution: dec.resolution,
      })
    }

    const result = await store.executeAddCenterSkill(input, decisions)
    if (result) {
      close()
    } else {
      error.value = store.error ?? t('skillManagerV2.import.executeFailed')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    executing.value = false
  }
}

function getActionLabel(action: string): string {
  switch (action) {
    case 'create': return t('skillManagerV2.import.actionCreate')
    case 'update': return t('skillManagerV2.import.actionUpdate')
    case 'blocked': return t('skillManagerV2.import.actionBlocked')
    default: return action
  }
}

defineExpose({ open, close })
</script>

<template>
  <div v-if="visible" class="import-dialog-overlay" @click.self="close">
    <div class="import-dialog">
      <!-- Header -->
      <div class="import-dialog-header">
        <h2>{{ t('skillManagerV2.import.title') }}</h2>
        <button class="import-dialog-close" @click="close">×</button>
      </div>

      <!-- Body -->
      <div class="import-dialog-body">
        <!-- Step 1: Folder selection -->
        <div class="import-step">
          <label class="import-label">{{ t('skillManagerV2.import.selectFolder') }}</label>
          <div class="import-folder-row">
            <input
              type="text"
              class="import-folder-input"
              :value="selectedPath"
              :placeholder="t('skillManagerV2.import.folderPlaceholder')"
              readonly
            />
            <button
              class="import-folder-btn"
              :disabled="loading || executing"
              @click="selectFolder"
            >
              {{ t('skillManagerV2.import.browse') }}
            </button>
          </div>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="import-loading">
          {{ t('skillManagerV2.import.loading') }}
        </div>

        <!-- Error -->
        <div v-if="error" class="import-error">
          {{ error }}
        </div>

        <!-- Preview Results -->
        <div v-if="preview" class="import-preview">
          <!-- Unchanged -->
          <div v-if="hasUnchanged" class="import-unchanged">
            {{ t('skillManagerV2.import.unchanged', { count: preview.unchangedCount }) }}
          </div>

          <!-- Candidates (create / update) -->
          <div v-if="hasCandidates" class="import-section">
            <h3 class="import-section-title">{{ t('skillManagerV2.import.candidates') }}</h3>
            <div
              v-for="cand in preview.candidates"
              :key="cand.skillId"
              class="import-candidate"
            >
              <div class="import-candidate-info">
                <span class="import-candidate-name">{{ cand.name }}</span>
                <span class="import-candidate-id">({{ cand.skillId }})</span>
              </div>
              <span class="import-action-badge" :class="cand.action">
                {{ getActionLabel(cand.action) }}
              </span>
            </div>
          </div>

          <!-- Blockers (conflicts) -->
          <div v-if="hasBlockers" class="import-section">
            <h3 class="import-section-title">{{ t('skillManagerV2.import.blockers') }}</h3>
            <div
              v-for="blocker in preview.blockers"
              :key="blocker.skillId"
              class="import-blocker"
            >
              <div class="import-blocker-info">
                <span class="import-blocker-name">{{ blocker.name }}</span>
                <span class="import-blocker-id">({{ blocker.skillId }})</span>
                <p class="import-blocker-reason">{{ blocker.reason }}</p>
              </div>
              <div class="import-blocker-decision">
                <label class="import-radio">
                  <input
                    type="radio"
                    :name="`blocker-${blocker.skillId}`"
                    value="skip"
                    :checked="getBlockerDecision(blocker.skillId)?.resolution === 'skip'"
                    @change="setBlockerResolution(blocker.skillId, 'skip')"
                  />
                  {{ t('skillManagerV2.import.skip') }}
                </label>
                <label class="import-radio">
                  <input
                    type="radio"
                    :name="`blocker-${blocker.skillId}`"
                    value="update"
                    :checked="getBlockerDecision(blocker.skillId)?.resolution === 'update'"
                    @change="setBlockerResolution(blocker.skillId, 'update')"
                  />
                  {{ t('skillManagerV2.import.overwrite') }}
                </label>
                <label class="import-radio">
                  <input
                    type="radio"
                    :name="`blocker-${blocker.skillId}`"
                    value="create"
                    :checked="getBlockerDecision(blocker.skillId)?.resolution === 'create'"
                    @change="setBlockerResolution(blocker.skillId, 'create')"
                  />
                  {{ t('skillManagerV2.import.rename') }}
                </label>
                <input
                  v-if="getBlockerDecision(blocker.skillId)?.resolution === 'create'"
                  type="text"
                  class="import-rename-input"
                  :value="getBlockerDecision(blocker.skillId)?.renamedId"
                  :placeholder="t('skillManagerV2.import.newIdPlaceholder')"
                  @input="setBlockerRenamedId(blocker.skillId, ($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>
          </div>

          <!-- No actions needed -->
          <div v-if="!hasCandidates && !hasBlockers && !hasUnchanged" class="import-empty">
            {{ t('skillManagerV2.import.noSkills') }}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="import-dialog-footer">
        <button class="import-btn import-btn-cancel" @click="close">
          {{ t('skillManagerV2.actions.cancel') }}
        </button>
        <button
          class="import-btn import-btn-confirm"
          :disabled="!canExecute"
          @click="executeImport"
        >
          {{ executing ? t('skillManagerV2.import.importing') : t('skillManagerV2.import.import') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.import-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.import-dialog {
  background: var(--bg-primary, #1e1e1e);
  color: var(--text-primary, #e0e0e0);
  border-radius: 8px;
  width: 600px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color, #333);
}

.import-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #333);

  h2 {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
  }
}

.import-dialog-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  opacity: 0.7;

  &:hover {
    opacity: 1;
  }
}

.import-dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.import-step {
  margin-bottom: 16px;
}

.import-label {
  display: block;
  font-size: 13px;
  margin-bottom: 6px;
  opacity: 0.9;
}

.import-folder-row {
  display: flex;
  gap: 8px;
}

.import-folder-input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--border-color, #555);
  border-radius: 4px;
  background: var(--bg-input, #2a2a2a);
  color: inherit;
  font-size: 13px;
}

.import-folder-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color, #555);
  border-radius: 4px;
  background: var(--bg-hover, #2a2a2a);
  color: inherit;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;

  &:hover {
    background: var(--bg-active, #094771);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.import-loading,
.import-error {
  padding: 12px;
  text-align: center;
  font-size: 13px;
}

.import-error {
  color: var(--error-color, #f48771);
}

.import-unchanged {
  padding: 8px 12px;
  background: var(--bg-badge, #333);
  border-radius: 4px;
  font-size: 12px;
  opacity: 0.8;
  margin-bottom: 12px;
}

.import-section {
  margin-bottom: 16px;
}

.import-section-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 8px;
}

.import-candidate,
.import-blocker {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
  margin-bottom: 6px;
}

.import-candidate-info,
.import-blocker-info {
  flex: 1;
}

.import-candidate-name,
.import-blocker-name {
  font-weight: 600;
  font-size: 13px;
}

.import-candidate-id,
.import-blocker-id {
  font-size: 12px;
  opacity: 0.6;
  margin-left: 6px;
}

.import-blocker-reason {
  font-size: 12px;
  opacity: 0.7;
  margin: 4px 0 0;
}

.import-action-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 3px;
  white-space: nowrap;

  &.create {
    background: #4ec9b0;
    color: #fff;
  }

  &.update {
    background: #75beff;
    color: #fff;
  }

  &.blocked {
    background: #f48771;
    color: #fff;
  }
}

.import-blocker-decision {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.import-radio {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}

.import-rename-input {
  width: 120px;
  padding: 4px 8px;
  border: 1px solid var(--border-color, #555);
  border-radius: 3px;
  background: var(--bg-input, #2a2a2a);
  color: inherit;
  font-size: 12px;
}

.import-empty {
  padding: 24px;
  text-align: center;
  opacity: 0.5;
  font-size: 13px;
}

.import-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #333);
}

.import-btn {
  padding: 8px 20px;
  border: 1px solid var(--border-color, #555);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.import-btn-cancel {
  background: transparent;
  color: inherit;

  &:hover {
    background: var(--bg-hover, #2a2a2a);
  }
}

.import-btn-confirm {
  background: var(--accent-color, #007acc);
  color: #fff;
  border-color: var(--accent-color, #007acc);

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>

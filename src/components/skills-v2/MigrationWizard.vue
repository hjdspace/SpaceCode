<template>
  <div v-if="visible" class="migration-wizard-overlay" @click.self="onClose">
    <div class="migration-wizard">
      <div class="wizard-header">
        <h2>{{ t('skillManager.migrationWizardTitle') }}</h2>
        <button class="close-btn" @click="onClose">&times;</button>
      </div>

      <div class="wizard-body">
        <!-- Step 1: Scan -->
        <div v-if="step === 1" class="step">
          <p class="step-desc">{{ t('skillManager.migrationStep1Desc') }}</p>
          <button class="btn-primary" @click="scanAllAgents" :disabled="scanning">
            {{ scanning ? t('common.processing') : t('skillManager.scanAllAgents') }}
          </button>
        </div>

        <!-- Step 2: Review discovered skills -->
        <div v-if="step === 2" class="step">
          <p class="step-desc">{{ t('skillManager.migrationStep2Desc') }}</p>

          <div v-if="discoveredItems.length === 0" class="empty-state">
            {{ t('skillManager.noUnmanagedSkills') }}
          </div>

          <div v-else class="discovered-list">
            <div
              v-for="item in discoveredItems"
              :key="item.id"
              class="discovered-item"
              :class="{
                conflict: item.isConflict,
                selected: item.isConflict ? false : selectedIds.includes(item.id),
              }"
              @click="!item.isConflict ? toggleSelect(item.id) : null"
            >
              <input
                v-if="!item.isConflict"
                type="checkbox"
                :checked="selectedIds.includes(item.id)"
                @click.stop
                @change="toggleSelect(item.id)"
              />
              <span v-else class="conflict-badge">⚠</span>
              <div class="item-info">
                <span class="item-name">{{ item.inferredSkillId }}</span>
                <span class="item-agent">{{ item.agentName }}</span>
              </div>
              <span v-if="item.isConflict" class="item-status conflict">
                {{ t('skillManager.conflict') }}
              </span>
              <span v-else class="item-status ok">
                {{ t('skillManager.adoptable') }}
              </span>
            </div>
          </div>

          <div v-if="conflictItems.length > 0" class="conflicts-section">
            <p class="section-label">
              {{ t('skillManager.conflictNeedsConfirmation') }}
            </p>
          </div>
        </div>

        <!-- Step 3: Batch adopt non-conflicting -->
        <div v-if="step === 3" class="step">
          <p class="step-desc">{{ t('skillManager.migrationStep3Desc') }}</p>

          <div class="batch-options">
            <label class="batch-option">
              <input type="radio" value="import_to_center" v-model="batchOption" />
              <span>{{ t('skillManager.optionImportToCenter') }}</span>
            </label>
            <label class="batch-option">
              <input type="radio" value="replace_with_link" v-model="batchOption" />
              <span>{{ t('skillManager.optionReplaceWithLink') }}</span>
            </label>
            <label class="batch-option">
              <input type="radio" value="replace_with_copy" v-model="batchOption" />
              <span>{{ t('skillManager.optionReplaceWithCopy') }}</span>
            </label>
          </div>

          <div class="selected-count">
            {{ t('skillManager.selectedCount', { count: selectedIds.length }) }}
          </div>
        </div>

        <!-- Step 4: Conflict resolution -->
        <div v-if="step === 4" class="step">
          <p class="step-desc">{{ t('skillManager.migrationStep4Desc') }}</p>
          <div v-if="currentConflict" class="conflict-detail">
            <div class="info-row">
              <span class="info-label">{{ t('skillManager.skillId') }}:</span>
              <span class="info-value">{{ currentConflict.inferredSkillId }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t('skillManager.agentName') }}:</span>
              <span class="info-value">{{ currentConflict.agentName }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t('skillManager.reason') }}:</span>
              <span class="info-value">{{ currentConflict.reason }}</span>
            </div>
            <div class="conflict-actions">
              <button class="btn-secondary" @click="skipConflict(currentConflict.id)">
                {{ t('skillManager.skip') }}
              </button>
              <button class="btn-secondary" @click="renameConflict(currentConflict.id)">
                {{ t('skillManager.rename') }}
              </button>
            </div>
          </div>
          <div v-else class="empty-state">
            {{ t('skillManager.allConflictsResolved') }}
          </div>
        </div>

        <!-- Step 5: Results -->
        <div v-if="step === 5" class="step">
          <p class="step-desc">{{ t('skillManager.migrationStep5Desc') }}</p>
          <div class="results-summary">
            <div class="result-row success">
              ✓ {{ t('skillManager.adoptedCount', { count: batchResult?.successCount ?? 0 }) }}
            </div>
            <div v-if="(batchResult?.failureCount ?? 0) > 0" class="result-row failure">
              ✕ {{ t('skillManager.failedCount', { count: batchResult?.failureCount ?? 0 }) }}
            </div>
          </div>
        </div>
      </div>

      <div class="wizard-footer">
        <button v-if="step > 1 && step < 5" class="btn-secondary" @click="step--" :disabled="busy">
          {{ t('common.previous') }}
        </button>
        <button v-if="step === 2 && selectedIds.length > 0" class="btn-primary" @click="step = 3">
          {{ t('common.next') }}
        </button>
        <button v-if="step === 3" class="btn-primary" @click="executeBatch" :disabled="busy || selectedIds.length === 0">
          {{ busy ? t('common.processing') : t('skillManager.executeBatchAdopt') }}
        </button>
        <button v-if="step === 4 && conflictItems.length === 0" class="btn-primary" @click="step = 5">
          {{ t('common.finish') }}
        </button>
        <button v-if="step === 5" class="btn-primary" @click="onClose">
          {{ t('common.done') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { AdoptOption, AdoptBatchItem, AdoptBatchResult, UnmanagedItemDto } from '@/types/skillManagerV2'

const { t } = useI18n()
const store = useSkillManagerStore()

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  completed: []
}>()

const step = ref(1)
const scanning = ref(false)
const busy = ref(false)
const discoveredItems = ref<Array<UnmanagedItemDto & { agentName: string; isConflict: boolean }>>([])
const selectedIds = ref<string[]>([])
const batchOption = ref<AdoptOption>('replace_with_link')
const batchResult = ref<AdoptBatchResult | null>(null)
const conflictResolutions = ref<Map<string, 'skip' | 'rename'>>(new Map())
const renamedIds = ref<Map<string, string>>(new Map())

const conflictItems = computed(() =>
  discoveredItems.value.filter((item) => item.isConflict && !conflictResolutions.value.has(item.id))
)

const currentConflict = computed(() => conflictItems.value[0] ?? null)

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      step.value = 1
      discoveredItems.value = []
      selectedIds.value = []
      batchResult.value = null
      conflictResolutions.value.clear()
      renamedIds.value.clear()
    }
  }
)

async function scanAllAgents(): Promise<void> {
  scanning.value = true
  try {
    const allItems: Array<UnmanagedItemDto & { agentName: string; isConflict: boolean }> = []

    for (const agent of store.agents) {
      if (!agent.enabled) continue
      const result = await store.scanAgentInventory(agent.id)
      if (result) {
        for (const item of result.unmanaged) {
          allItems.push({ ...item, agentName: agent.displayName, isConflict: false })
        }
        for (const item of result.conflicts) {
          allItems.push({ ...item, agentName: agent.displayName, isConflict: true })
        }
      }
    }

    discoveredItems.value = allItems
    // Auto-select non-conflicting items
    selectedIds.value = allItems.filter((item) => !item.isConflict).map((item) => item.id)
    step.value = 2
  } finally {
    scanning.value = false
  }
}

function toggleSelect(id: string): void {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) {
    selectedIds.value.splice(idx, 1)
  } else {
    selectedIds.value.push(id)
  }
}

async function executeBatch(): Promise<void> {
  busy.value = true
  try {
    const items: AdoptBatchItem[] = selectedIds.value.map((id) => {
      const item = discoveredItems.value.find((d) => d.id === id)!
      return {
        agentId: item.agentId!,
        unmanagedId: id,
        option: batchOption.value,
      }
    })

    batchResult.value = await store.executeAdoptBatch(items)

    // Move to conflict resolution if there are conflicts
    if (conflictItems.value.length > 0) {
      step.value = 4
    } else {
      step.value = 5
    }
  } finally {
    busy.value = false
  }
}

function skipConflict(id: string): void {
  conflictResolutions.value.set(id, 'skip')
  if (conflictItems.value.length === 0) {
    step.value = 5
  }
}

function renameConflict(id: string): void {
  const item = discoveredItems.value.find((d) => d.id === id)
  if (!item) return
  const renamedId = `${item.inferredSkillId}-imported`
  renamedIds.value.set(id, renamedId)
  conflictResolutions.value.set(id, 'rename')

  // Execute this single adopt with rename
  store.executeAdopt(item.agentId!, id, 'import_to_center', renamedId)

  if (conflictItems.value.length === 0) {
    step.value = 5
  }
}

function onClose(): void {
  emit('close')
}
</script>

<style scoped lang="scss">
.migration-wizard-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.migration-wizard {
  background: var(--bg-primary, #1e1e2e);
  border-radius: 12px;
  width: 640px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.wizard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));

  h2 {
    margin: 0;
    font-size: 18px;
  }
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-secondary, #888);

  &:hover {
    color: var(--text-primary, #fff);
  }
}

.wizard-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.step-desc {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary, #aaa);
  line-height: 1.5;
}

.discovered-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 300px;
  overflow-y: auto;
}

.discovered-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;

  &:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  }

  &.selected {
    border-color: var(--accent-primary, #6c5ce7);
    background: rgba(108, 92, 231, 0.05);
  }

  &.conflict {
    cursor: default;
    background: rgba(255, 152, 0, 0.05);
  }
}

.item-info {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.item-name {
  font-size: 14px;
  font-weight: 500;
}

.item-agent {
  font-size: 12px;
  color: var(--text-tertiary, #666);
}

.item-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;

  &.ok {
    background: rgba(76, 175, 80, 0.1);
    color: #4caf50;
  }

  &.conflict {
    background: rgba(255, 152, 0, 0.1);
    color: #ff9800;
  }
}

.conflict-badge {
  color: #ff9800;
}

.empty-state {
  text-align: center;
  padding: 32px;
  color: var(--text-tertiary, #666);
  font-size: 14px;
}

.batch-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.batch-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
}

.selected-count {
  font-size: 13px;
  color: var(--text-secondary, #aaa);
}

.conflicts-section {
  margin-top: 16px;
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  color: #ff9800;
}

.conflict-detail {
  background: var(--bg-secondary, #2a2a3e);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-row {
  display: flex;
  gap: 8px;
  font-size: 13px;
}

.info-label {
  color: var(--text-tertiary, #666);
}

.info-value {
  color: var(--text-primary, #fff);
}

.conflict-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.results-summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-row {
  font-size: 14px;
  padding: 8px 12px;
  border-radius: 6px;

  &.success {
    background: rgba(76, 175, 80, 0.1);
    color: #4caf50;
  }

  &.failure {
    background: rgba(244, 67, 54, 0.1);
    color: #f44336;
  }
}

.wizard-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 14px;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-primary {
  background: var(--accent-primary, #6c5ce7);
  color: white;

  &:hover:not(:disabled) {
    filter: brightness(1.1);
  }
}

.btn-secondary {
  background: var(--bg-secondary, #2a2a3e);
  color: var(--text-primary, #fff);

  &:hover:not(:disabled) {
    filter: brightness(1.1);
  }
}
</style>

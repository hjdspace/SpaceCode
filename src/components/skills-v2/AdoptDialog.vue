<template>
  <div v-if="visible" class="adopt-dialog-overlay" @click.self="onClose">
    <div class="adopt-dialog">
      <div class="dialog-header">
        <h3>{{ t('skillManager.adoptTitle') }}</h3>
        <button class="close-btn" @click="onClose">&times;</button>
      </div>

      <div class="dialog-body">
        <!-- Skill info -->
        <div class="section">
          <div class="info-row">
            <span class="info-label">{{ t('skillManager.skillId') }}:</span>
            <span class="info-value">{{ preview?.inferredSkillId ?? '—' }}</span>
          </div>
          <div v-if="preview?.centerHasSameName" class="info-row warning">
            <span class="info-label">{{ t('skillManager.centerLibrary') }}:</span>
            <span class="info-value">
              {{ t('skillManager.sameNameExists') }}
            </span>
          </div>
          <div v-if="preview?.conflictReason" class="conflict-warning">
            ⚠ {{ preview.conflictReason }}
          </div>
        </div>

        <!-- Option selection -->
        <div class="section">
          <div class="section-label">{{ t('skillManager.adoptOption') }}</div>
          <div class="option-list">
            <label
              v-for="option in preview?.options ?? []"
              :key="option"
              class="option-item"
              :class="{ selected: selectedOption === option }"
            >
              <input
                type="radio"
                :value="option"
                :checked="selectedOption === option"
                @change="selectedOption = option as AdoptOption"
              />
              <div class="option-content">
                <span class="option-name">{{ optionLabel(option) }}</span>
                <span class="option-desc">{{ optionDescription(option) }}</span>
              </div>
            </label>
          </div>
        </div>

        <!-- Rename field (for conflict cases) -->
        <div v-if="preview?.conflictReason && selectedOption === 'import_to_center'" class="section">
          <div class="section-label">{{ t('skillManager.renamedId') }}</div>
          <input
            type="text"
            v-model="renamedId"
            class="rename-input"
            :placeholder="preview.inferredSkillId + '-imported'"
          />
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn-secondary" @click="onClose" :disabled="busy">
          {{ t('common.cancel') }}
        </button>
        <button
          class="btn-primary"
          @click="onExecute"
          :disabled="busy || !selectedOption"
        >
          {{ busy ? t('common.processing') : t('skillManager.adoptButton') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { AdoptOption, AdoptPreview } from '@/types/skillManagerV2'

const { t } = useI18n()
const store = useSkillManagerStore()

const props = defineProps<{
  visible: boolean
  agentId: string
  unmanagedId: string
}>()

const emit = defineEmits<{
  close: []
  adopted: []
}>()

const preview = ref<AdoptPreview | null>(null)
const selectedOption = ref<AdoptOption | null>(null)
const renamedId = ref('')
const busy = ref(false)

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      preview.value = null
      selectedOption.value = null
      renamedId.value = ''
      busy.value = true
      try {
        preview.value = await store.previewAdopt(props.agentId, props.unmanagedId)
        if (preview.value && preview.value.options.length > 0) {
          selectedOption.value = preview.value.options[0]
        }
      } finally {
        busy.value = false
      }
    }
  }
)

function optionLabel(option: AdoptOption): string {
  switch (option) {
    case 'import_to_center':
      return t('skillManager.optionImportToCenter')
    case 'replace_with_link':
      return t('skillManager.optionReplaceWithLink')
    case 'replace_with_copy':
      return t('skillManager.optionReplaceWithCopy')
    default:
      return option
  }
}

function optionDescription(option: AdoptOption): string {
  switch (option) {
    case 'import_to_center':
      return t('skillManager.optionImportToCenterDesc')
    case 'replace_with_link':
      return t('skillManager.optionReplaceWithLinkDesc')
    case 'replace_with_copy':
      return t('skillManager.optionReplaceWithCopyDesc')
    default:
      return ''
  }
}

async function onExecute(): Promise<void> {
  if (!selectedOption.value) return
  busy.value = true
  try {
    await store.executeAdopt(
      props.agentId,
      props.unmanagedId,
      selectedOption.value,
      renamedId.value || undefined
    )
    emit('adopted')
    emit('close')
  } finally {
    busy.value = false
  }
}

function onClose(): void {
  emit('close')
}
</script>

<style scoped lang="scss">
.adopt-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.adopt-dialog {
  background: var(--bg-primary, #1e1e2e);
  border-radius: 12px;
  width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));

  h3 {
    margin: 0;
    font-size: 16px;
  }
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-secondary, #888);
  padding: 0 4px;

  &:hover {
    color: var(--text-primary, #fff);
  }
}

.dialog-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.section {
  margin-bottom: 16px;
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-secondary, #aaa);
}

.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 4px;

  &.warning {
    color: #ff9800;
  }
}

.info-label {
  color: var(--text-tertiary, #666);
}

.info-value {
  color: var(--text-primary, #fff);
}

.conflict-warning {
  background: rgba(255, 152, 0, 0.1);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: #ff9800;
  margin-top: 8px;
}

.option-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  cursor: pointer;

  &:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  }

  &.selected {
    border-color: var(--accent-primary, #6c5ce7);
    background: rgba(108, 92, 231, 0.1);
  }
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.option-name {
  font-size: 14px;
  font-weight: 500;
}

.option-desc {
  font-size: 12px;
  color: var(--text-tertiary, #666);
}

.rename-input {
  width: 100%;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  background: var(--bg-secondary, #2a2a3e);
  color: var(--text-primary, #fff);
  font-size: 14px;

  &:focus {
    outline: none;
    border-color: var(--accent-primary, #6c5ce7);
  }
}

.dialog-footer {
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

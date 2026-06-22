<template>
  <Teleport to="body">
    <div v-if="modelValue" class="modal-overlay" @click.self="$emit('update:modelValue', false)">
      <div class="modal-container">
        <div class="modal-header">
          <h2 class="modal-title">{{ t('skills.directoryManager.title') }}</h2>
          <button class="close-btn" @click="$emit('update:modelValue', false)">
            <X :size="20" />
          </button>
        </div>

        <div class="modal-body">
          <div class="section">
            <h3 class="section-title">
              <Lock :size="14" />
              {{ t('skills.directoryManager.builtinDir') }}
            </h3>
            <div class="builtin-path">skills-lib/</div>
          </div>

          <div class="section">
            <h3 class="section-title">
              <FolderOpen :size="14" />
              {{ t('skills.directoryManager.customDirs') }}
            </h3>

            <div v-if="customDirectories.length === 0" class="empty-list">
              {{ t('skills.noCustomDirectories') }}
            </div>

            <div v-else class="dir-list">
              <div
                v-for="dir in customDirectories"
                :key="dir"
                class="dir-item"
              >
                <Folder :size="16" />
                <span class="dir-path">{{ dir }}</span>
                <button
                  class="remove-dir-btn"
                  @click="handleRemove(dir)"
                  :title="t('skills.directoryManager.removeConfirm')"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </div>
          </div>

          <div class="add-section">
            <div class="input-group">
              <input
                v-model="newDirPath"
                type="text"
                :placeholder="t('skills.directoryManager.pathPlaceholder')"
                class="path-input"
                @keyup.enter="handleAdd"
              />
              <button
                class="browse-btn"
                @click="handleBrowse"
                :title="t('skills.directoryManager.selectFolder')"
              >
                <FolderSearch :size="16" />
              </button>
              <button
                class="add-btn"
                @click="handleAdd"
                :disabled="!newDirPath.trim()"
              >
                <Plus :size="16" />
              </button>
            </div>
            <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
          </div>
        </div>

        <div class="modal-footer">
          <button class="cancel-btn" @click="$emit('update:modelValue', false)">
            {{ t('common.close') || 'Close' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  X,
  Lock,
  FolderOpen,
  Folder,
  FolderSearch,
  Trash2,
  Plus
} from 'lucide-vue-next'
import { useDialog } from '@/composables/useDialog'

const props = defineProps<{
  modelValue: boolean
  customDirectories: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'add', dirPath: string): void
  (e: 'remove', dirPath: string): void
}>()

const { t } = useI18n()
const { showConfirm } = useDialog()
const newDirPath = ref('')
const errorMessage = ref('')

function handleBrowse() {
  const electronAPI = (window as any).electronAPI

  if (electronAPI?.selectFolder) {
    electronAPI.selectFolder().then((result: { canceled: boolean; filePaths?: string[] }) => {
      if (!result.canceled && result.filePaths?.length) {
        newDirPath.value = result.filePaths[0]
        errorMessage.value = ''
      }
    })
  }
}

async function handleAdd() {
  errorMessage.value = ''

  if (!newDirPath.value.trim()) return

  try {
    emit('add', newDirPath.value.trim())
    newDirPath.value = ''
  } catch (err: any) {
    errorMessage.value = err.message || t('skills.directoryManager.invalidPath')
  }
}

async function handleRemove(dirPath: string) {
  if (await showConfirm(t('skills.directoryManager.removeConfirm'), { variant: 'danger' })) {
    emit('remove', dirPath)
  }
}
</script>

<style scoped lang="scss">
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-container {
  width: 560px;
  max-height: 80vh;
  background: var(--bg-primary);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-default);
}

.modal-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.2s;

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}

.builtin-path {
  padding: 10px 12px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  font-family: monospace;
  font-size: 13px;
  color: var(--text-secondary);
}

.dir-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dir-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  font-size: 13px;

  .dir-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: monospace;
  }

  .remove-dir-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    opacity: 0;
    transition: all 0.2s;

    &:hover {
      background: var(--error);
      color: white;
    }
  }

  &:hover .remove-dir-btn {
    opacity: 1;
  }
}

.empty-list {
  padding: 12px;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
  font-style: italic;
}

.add-section {
  padding-top: 16px;
  border-top: 1px solid var(--border-default);
}

.input-group {
  display: flex;
  gap: 8px;
}

.path-input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;

  &::placeholder {
    color: var(--text-tertiary);
  }

  &:focus {
    border-color: var(--accent-primary);
  }
}

.browse-btn,
.add-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid var(--surface-border);
  background: var(--bg-secondary);

  &:hover:not(:disabled) {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.add-btn:hover:not(:disabled) {
  background: var(--accent-primary);
  color: white;
  border-color: var(--accent-primary);
}

.error-message {
  margin: 8px 0 0 0;
  font-size: 12px;
  color: var(--error);
}

.modal-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border-default);
  display: flex;
  justify-content: flex-end;
}

.cancel-btn {
  padding: 8px 20px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--bg-tertiary);
  }
}
</style>

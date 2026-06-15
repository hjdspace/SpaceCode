<template>
  <Teleport to="body">
    <Transition name="commit-dialog">
      <div
        v-if="sessionContext.showCommitDialog"
        class="commit-overlay"
        @click.self="handleClose"
      >
        <div class="commit-dialog" @click.stop>
          <!-- Header -->
          <div class="commit-header">
            <span class="commit-title">{{ t('sessionContext.commitChanges') }}</span>
            <button class="commit-close" @click="handleClose">
              <X :size="16" />
            </button>
          </div>

          <!-- Body -->
          <div class="commit-body">
            <p class="commit-desc">
              {{ t('sessionContext.commitDesc') }}
            </p>

            <!-- Info rows -->
            <div class="info-row">
              <span class="info-label">{{ t('sessionContext.currentBranch') }}</span>
              <span class="info-value">
                <GitBranch :size="12" />
                {{ scmStore.branch || 'HEAD' }}
              </span>
            </div>

            <div class="info-row">
              <span class="info-label">{{ t('sessionContext.changes') }}</span>
              <span class="info-value">
                {{ t('sessionContext.fileCount', { count: totalFileCount }) }}
                <span class="stat-add">+{{ sessionContext.gitAdditions }}</span>
                <span class="stat-del">-{{ sessionContext.gitDeletions }}</span>
              </span>
            </div>

            <!-- Commit message -->
            <div class="commit-msg-section">
              <label class="commit-msg-label">{{ t('sessionContext.commitMessage') }}</label>
              <textarea
                ref="commitTextarea"
                v-model="localMessage"
                class="commit-textarea"
                :placeholder="t('sessionContext.commitMessagePlaceholder')"
                rows="3"
                @keydown.ctrl.enter="handleGenerateAndCommit"
              />
              <div class="commit-hint">
                {{ t('sessionContext.commitHint') }}
              </div>

              <!-- Error -->
              <div v-if="errorMsg" class="commit-error">
                <AlertCircle :size="14" />
                {{ errorMsg }}
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="commit-footer">
            <button class="btn-cancel" @click="handleClose">{{ t('sessionContext.cancel') }}</button>
            <button
              class="btn-primary"
              :disabled="isSubmitting || isGenerating"
              @click="handleGenerateAndCommit"
            >
              <Loader2 v-if="isGenerating || isSubmitting" :size="14" class="spin-icon" />
              <Sparkles v-else :size="14" />
              {{ isGenerating ? t('sessionContext.generating') : isSubmitting ? t('sessionContext.submitting') : t('sessionContext.generateAndCommit') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  X, GitBranch, AlertCircle, Loader2, Sparkles
} from 'lucide-vue-next'
import { useSessionContext } from '@/stores/sessionContext'
import { useScmStore } from '@/stores/scm'

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const sessionContext = useSessionContext()
const scmStore = useScmStore()

const commitTextarea = ref<HTMLTextAreaElement | null>(null)
const localMessage = ref('')
const errorMsg = ref('')
const isGenerating = ref(false)
const isSubmitting = ref(false)

const totalFileCount = computed(() => {
  return scmStore.staged.length + scmStore.unstaged.length + scmStore.untracked.length
})

function handleClose() {
  errorMsg.value = ''
  localMessage.value = ''
  sessionContext.closeCommitDialog()
  emit('close')
}

async function handleGenerateAndCommit() {
  errorMsg.value = ''
  isGenerating.value = true

  try {
    // Auto-stage all files if nothing is staged
    if (scmStore.stagedCount === 0 && totalFileCount.value > 0) {
      await scmStore.stageAllFiles()
    }

    // Generate message if empty
    let message = localMessage.value.trim()
    if (!message) {
      try {
        message = await scmStore.generateCommitMessage()
        localMessage.value = message
      } catch (e: any) {
        errorMsg.value = t('sessionContext.generateCommitFailed')
        isGenerating.value = false
        return
      }
    }

    // Commit
    isGenerating.value = false
    isSubmitting.value = true
    await scmStore.commitChanges(message)
    handleClose()
  } catch (e: any) {
    errorMsg.value = e.message || t('sessionContext.commitFailed')
  } finally {
    isGenerating.value = false
    isSubmitting.value = false
  }
}

// Focus textarea when dialog opens
watch(() => sessionContext.showCommitDialog, (show) => {
  if (show) {
    nextTick(() => {
      commitTextarea.value?.focus()
    })
  }
})
</script>

<style lang="scss" scoped>
.commit-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.commit-dialog {
  width: 480px;
  max-width: 90vw;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border-strong, rgba(255,255,255,0.14));
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
}

.commit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}

.commit-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.commit-close {
  width: 28px; height: 28px;
  border: none; border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms ease;

  &:hover { background: var(--bg-hover); color: var(--text-primary); }
}

.commit-body {
  padding: 0 20px 16px;
}

.commit-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 16px;
  line-height: 1.5;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
}

.info-label {
  font-size: 13px;
  color: var(--text-muted);
}

.info-value {
  font-size: 13px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat-add { color: var(--success); font-family: var(--font-mono); font-size: 12px; }
.stat-del { color: var(--error); font-family: var(--font-mono); font-size: 12px; }

.commit-msg-section {
  margin-top: 16px;
}

.commit-msg-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.commit-textarea {
  width: 100%;
  min-height: 80px;
  padding: 10px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  resize: vertical;
  outline: none;
  transition: border-color 150ms ease;

  &:focus { border-color: var(--accent-primary); }
  &::placeholder { color: var(--text-muted); }
}

.commit-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 6px;
  line-height: 1.4;
}

.commit-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--error);
}

.commit-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--surface-border);
}

.btn-cancel {
  height: 34px;
  padding: 0 16px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: all 150ms ease;

  &:hover { background: var(--bg-hover); color: var(--text-primary); }
}

.btn-primary {
  height: 34px;
  padding: 0 16px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--text-primary);
  color: var(--bg-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 150ms ease;

  &:hover { opacity: 0.9; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// Transition
.commit-dialog-enter-active { transition: all 0.2s ease-out; }
.commit-dialog-leave-active { transition: all 0.15s ease-in; }
.commit-dialog-enter-from { opacity: 0; transform: scale(0.95); }
.commit-dialog-leave-to { opacity: 0; transform: scale(0.95); }
</style>

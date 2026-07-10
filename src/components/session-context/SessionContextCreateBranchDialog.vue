<template>
  <Teleport to="body">
    <Transition name="branch-dialog">
      <div
        v-if="sessionContext.showCreateBranchDialog"
        class="branch-overlay"
        @click.self="handleClose"
      >
        <div class="branch-dialog" @click.stop>
          <!-- Header -->
          <div class="branch-header">
            <span class="branch-title">{{ t('sessionContext.createBranchTitle') }}</span>
            <button class="branch-close" @click="handleClose">
              <X :size="16" />
            </button>
          </div>

          <!-- Body -->
          <div class="branch-body">
            <p class="branch-desc">
              {{ t('sessionContext.createBranchDesc') }}
            </p>

            <!-- Branch name input -->
            <div class="branch-input-section">
              <label class="branch-input-label">{{ t('sessionContext.branchNameLabel') }}</label>
              <input
                ref="branchNameInput"
                v-model="branchName"
                class="branch-input"
                type="text"
                :placeholder="t('sessionContext.branchNamePlaceholder')"
                @keydown.enter="handleCreateAndSwitch"
              />
              <div class="branch-hint">
                {{ t('sessionContext.createBranchHint') }}
              </div>

              <!-- Error -->
              <div v-if="errorMsg" class="branch-error">
                <AlertCircle :size="14" />
                {{ errorMsg }}
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="branch-footer">
            <button class="btn-cancel" @click="handleClose">{{ t('sessionContext.cancel') }}</button>
            <button
              class="btn-primary"
              :disabled="isSubmitting || !branchName.trim()"
              @click="handleCreateAndSwitch"
            >
              <Loader2 v-if="isSubmitting" :size="14" class="spin-icon" />
              <GitBranch v-else :size="14" />
              {{ isSubmitting ? t('sessionContext.submitting') : t('sessionContext.createAndSwitch') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  X, GitBranch, AlertCircle, Loader2
} from 'lucide-vue-next'
import { useSessionContext } from '@/stores/sessionContext'
import { useScmStore } from '@/stores/scm'

const { t } = useI18n()
const sessionContext = useSessionContext()
const scmStore = useScmStore()

const branchNameInput = ref<HTMLInputElement | null>(null)
const branchName = ref('')
const errorMsg = ref('')
const isSubmitting = ref(false)

function handleClose() {
  errorMsg.value = ''
  branchName.value = ''
  isSubmitting.value = false
  sessionContext.closeCreateBranchDialog()
}

async function handleCreateAndSwitch() {
  const name = branchName.value.trim()
  if (!name) {
    errorMsg.value = t('sessionContext.branchNameRequired')
    return
  }

  errorMsg.value = ''
  isSubmitting.value = true

  try {
    const result = await scmStore.createBranch(name, true)
    if (result?.success) {
      // Close branch dropdown if open
      sessionContext.closeBranchDropdown()
      handleClose()
    } else {
      errorMsg.value = result?.error || t('sessionContext.createBranchFailed')
    }
  } catch (e: any) {
    errorMsg.value = e.message || t('sessionContext.createBranchFailed')
  } finally {
    isSubmitting.value = false
  }
}

// Focus input when dialog opens
watch(() => sessionContext.showCreateBranchDialog, (show) => {
  if (show) {
    nextTick(() => {
      branchNameInput.value?.focus()
    })
  }
}, { immediate: true })
</script>

<style lang="scss" scoped>
.branch-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.branch-dialog {
  width: 480px;
  max-width: 90vw;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border-strong, rgba(255,255,255,0.14));
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
}

.branch-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}

.branch-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.branch-close {
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

.branch-body {
  padding: 0 20px 16px;
}

.branch-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 16px;
  line-height: 1.5;
}

.branch-input-section {
  margin-top: 4px;
}

.branch-input-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.branch-input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  outline: none;
  transition: border-color 150ms ease;

  &:focus { border-color: var(--accent-primary); }
  &::placeholder { color: var(--text-muted); }
}

.branch-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 6px;
  line-height: 1.4;
}

.branch-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--error);
}

.branch-footer {
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
.branch-dialog-enter-active { transition: all 0.2s ease-out; }
.branch-dialog-leave-active { transition: all 0.15s ease-in; }
.branch-dialog-enter-from { opacity: 0; transform: scale(0.95); }
.branch-dialog-leave-to { opacity: 0; transform: scale(0.95); }
</style>

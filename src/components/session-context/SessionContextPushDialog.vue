<template>
  <Teleport to="body">
    <Transition name="push-dialog">
      <div
        v-if="sessionContext.showPushDialog"
        class="push-overlay"
        @click.self="handleClose"
      >
        <div class="push-dialog" @click.stop>
          <!-- Header -->
          <div class="push-header">
            <span class="push-title">{{ t('sessionContext.pushChanges') }}</span>
            <button class="push-close" @click="handleClose">
              <X :size="16" />
            </button>
          </div>

          <!-- Body -->
          <div class="push-body">
            <p class="push-desc">
              {{ t('sessionContext.pushDesc') }}
            </p>

            <!-- Info card -->
            <div class="info-card">
              <!-- Branch -->
              <div class="info-row">
                <span class="info-label">{{ t('sessionContext.currentBranch') }}</span>
                <span class="info-value">
                  <GitBranch :size="12" class="info-icon" />
                  {{ scmStore.branch || 'HEAD' }}
                </span>
              </div>

              <!-- Remote Branch -->
              <div class="info-row">
                <span class="info-label">{{ t('sessionContext.remoteBranch') }}</span>
                <span class="info-value">
                  {{ scmStore.upstream || `origin/${scmStore.branch || 'main'}` }}
                </span>
              </div>

              <!-- Sync Status -->
              <div class="info-row">
                <span class="info-label">{{ t('sessionContext.syncStatus') }}</span>
                <span class="info-value sync-value">
                  <span class="ahead">{{ t('sessionContext.aheadCount', { count: scmStore.ahead }) }}</span>
                  <span class="separator">/</span>
                  <span class="behind">{{ t('sessionContext.behindCount', { count: scmStore.behind }) }}</span>
                </span>
              </div>

              <!-- Next Step -->
              <div class="info-row">
                <span class="info-label">{{ t('sessionContext.nextStep') }}</span>
                <span class="info-value action-hint">
                  <ArrowUp :size="13" />
                  {{ t('sessionContext.pushAction') }}
                </span>
              </div>
            </div>

            <!-- Error / Success -->
            <div v-if="errorMsg" class="push-error">
              <AlertCircle :size="14" />
              {{ errorMsg }}
            </div>
            <div v-if="successMsg" class="push-success">
              <CheckCircle2 :size="14" />
              {{ successMsg }}
            </div>
          </div>

          <!-- Footer -->
          <div class="push-footer">
            <button class="btn-cancel" @click="handleClose">{{ t('sessionContext.cancel') }}</button>
            <button
              class="btn-primary"
              :disabled="isPushing"
              @click="handlePush"
            >
              <Loader2 v-if="isPushing" :size="14" class="spin-icon" />
              <ArrowUp v-else :size="14" />
              {{ isPushing ? t('sessionContext.pushing') : t('sessionContext.pushAction') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  X, GitBranch, AlertCircle, Loader2, ArrowUp, CheckCircle2
} from 'lucide-vue-next'
import { useSessionContext } from '@/stores/sessionContext'
import { useScmStore } from '@/stores/scm'

const { t } = useI18n()
const sessionContext = useSessionContext()
const scmStore = useScmStore()

const errorMsg = ref('')
const successMsg = ref('')
const isPushing = ref(false)

function handleClose() {
  errorMsg.value = ''
  successMsg.value = ''
  isPushing.value = false
  sessionContext.closePushDialog()
}

async function handlePush() {
  errorMsg.value = ''
  successMsg.value = ''
  isPushing.value = true

  try {
    const result = await scmStore.push()
    if (result?.success) {
      successMsg.value = t('sessionContext.pushSuccess')
      // Auto-close after 1 second
      setTimeout(() => {
        handleClose()
      }, 1000)
    } else {
      errorMsg.value = result?.error || t('sessionContext.pushFailed')
    }
  } catch (e: any) {
    errorMsg.value = e.message || t('sessionContext.pushFailed')
  } finally {
    isPushing.value = false
  }
}

// Reset state when dialog opens
watch(() => sessionContext.showPushDialog, (show) => {
  if (show) {
    errorMsg.value = ''
    successMsg.value = ''
    isPushing.value = false
    // Refresh status to get latest ahead/behind info
    scmStore.refresh()
  }
}, { immediate: true })
</script>

<style lang="scss" scoped>
.push-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.push-dialog {
  width: 480px;
  max-width: 90vw;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border-strong, rgba(255,255,255,0.14));
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
}

.push-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}

.push-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.push-close {
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

.push-body {
  padding: 0 20px 16px;
}

.push-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 16px;
  line-height: 1.5;
}

.info-card {
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  padding: 4px 14px;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 0;

  & + .info-row {
    border-top: 1px solid rgba(255,255,255,0.04);
  }
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

.info-icon {
  color: var(--text-muted);
}

.sync-value {
  .ahead { color: var(--success, #4ade80); }
  .separator { color: var(--text-muted); margin: 0 2px; }
  .behind { color: var(--text-secondary); }
}

.action-hint {
  color: var(--accent-primary);
  font-weight: 500;
}

.push-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  font-size: 12px;
  color: var(--error);
}

.push-success {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  font-size: 12px;
  color: var(--success, #4ade80);
}

.push-footer {
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
.push-dialog-enter-active { transition: all 0.2s ease-out; }
.push-dialog-leave-active { transition: all 0.15s ease-in; }
.push-dialog-enter-from { opacity: 0; transform: scale(0.95); }
.push-dialog-leave-to { opacity: 0; transform: scale(0.95); }
</style>

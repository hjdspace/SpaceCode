<template>
  <Transition name="modal-fade">
    <div v-if="appStore.showWorkOnboarding" class="onboarding-overlay" @click.self="handleClose">
      <div class="onboarding-card">
        <div class="onboarding-header">
          <div class="onboarding-icon"><Briefcase :size="22" /></div>
          <h2 class="onboarding-title">{{ t('work.onboardingTitle') }}</h2>
          <button class="onboarding-close" @click="handleClose" :aria-label="t('common.close')">
            <X :size="18" />
          </button>
        </div>

        <p class="onboarding-desc">{{ t('work.onboardingDesc') }}</p>

        <div class="workspace-suggestion">
          <FolderOpen :size="16" />
          <span class="workspace-path">{{ defaultPath || '~/Documents/SpaceCode' }}</span>
        </div>

        <div class="onboarding-actions">
          <button class="btn-primary" :disabled="busy" @click="useDefault">
            {{ t('work.useDefault') }}
          </button>
          <button class="btn-secondary" :disabled="busy" @click="chooseFolder">
            {{ t('work.chooseFolder') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Briefcase, FolderOpen, X } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'

const { t } = useI18n()
const appStore = useAppStore()

const defaultPath = ref('')
const busy = ref(false)

// 打开时解析默认目录用于展示
watch(() => appStore.showWorkOnboarding, async (visible) => {
  if (visible && !defaultPath.value) {
    try {
      defaultPath.value = await api.ensureDefaultWorkspace()
    } catch { /* ignore */ }
  }
})

function finish() {
  appStore.showWorkOnboarding = false
  // 设置完成后打开助手画廊，引导用户选择专业助手
  appStore.showWorkGallery = true
}

async function useDefault() {
  busy.value = true
  try {
    const path = defaultPath.value || (await api.ensureDefaultWorkspace())
    if (path) {
      appStore.setWorkWorkspace(path)
      finish()
    }
  } finally {
    busy.value = false
  }
}

async function chooseFolder() {
  busy.value = true
  try {
    const result = await api.selectFolder()
    if (!result.canceled && result.filePaths[0]) {
      const path = result.filePaths[0]
      await api.ensureDir(path)
      appStore.setWorkWorkspace(path)
      finish()
    }
  } finally {
    busy.value = false
  }
}

function handleClose() {
  appStore.showWorkOnboarding = false
}
</script>

<style lang="scss" scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
}

.onboarding-card {
  width: 460px;
  max-width: 90vw;
  background: var(--bg-elevated, var(--bg-primary));
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow-lg);
}

.onboarding-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.onboarding-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--surface-glass-active);
  color: var(--accent-primary);
}

.onboarding-title {
  flex: 1;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.onboarding-close {
  display: flex;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  &:hover { color: var(--text-primary); background: var(--surface-glass-hover); }
}

.onboarding-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 16px;
}

.workspace-suggestion {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 12px;
  margin-bottom: 20px;

  .workspace-path {
    font-family: var(--font-mono, monospace);
    word-break: break-all;
  }
}

.onboarding-actions {
  display: flex;
  gap: 10px;
}

.btn-primary,
.btn-secondary {
  flex: 1;
  height: 38px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all var(--transition-fast);
  &:disabled { opacity: 0.6; cursor: not-allowed; }
}

.btn-primary {
  background: var(--accent-primary);
  color: #fff;
  border: 1px solid var(--accent-primary);
  &:hover:not(:disabled) { background: var(--accent-primary-hover, var(--accent-primary)); }
}

.btn-secondary {
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--surface-border);
  &:hover:not(:disabled) { background: var(--surface-glass-hover); border-color: var(--accent-primary); }
}

.modal-fade-enter-active,
.modal-fade-leave-active { transition: opacity 0.18s ease; }
.modal-fade-enter-from,
.modal-fade-leave-to { opacity: 0; }
</style>

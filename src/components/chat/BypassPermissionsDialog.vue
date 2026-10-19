<template>
  <Teleport to="body">
    <Transition name="bypass-dialog">
      <div
        v-if="show"
        class="bypass-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="t('permission.bypassDialog.title')"
        @click.self="emit('cancel')"
      >
        <div class="bypass-card">
          <div class="bypass-header">
            <AlertTriangle :size="20" class="bypass-header-icon" />
            <h3 class="bypass-title">{{ t('permission.bypassDialog.title') }}</h3>
          </div>

          <p class="bypass-lede">{{ t('permission.bypassDialog.lede') }}</p>

          <div class="bypass-scopes">
            <div v-for="scope in scopes" :key="scope.titleKey" class="bypass-scope">
              <component :is="scope.icon" :size="20" class="bypass-scope-icon" />
              <div class="bypass-scope-text">
                <span class="bypass-scope-title">{{ t(scope.titleKey) }}</span>
                <span class="bypass-scope-desc">{{ t(scope.descKey) }}</span>
              </div>
            </div>
          </div>

          <p class="bypass-caution">{{ t('permission.bypassDialog.caution') }}</p>

          <div class="bypass-actions">
            <button class="bypass-btn cancel" @click="emit('cancel')">
              {{ t('common.cancel') }}
            </button>
            <button class="bypass-btn confirm" @click="emit('confirm')">
              {{ t('common.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Folder, Globe, Terminal } from 'lucide-vue-next'

defineProps<{ show: boolean }>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useI18n()

const scopes = [
  {
    icon: Folder,
    titleKey: 'permission.bypassDialog.files',
    descKey: 'permission.bypassDialog.filesDesc',
  },
  {
    icon: Terminal,
    titleKey: 'permission.bypassDialog.commands',
    descKey: 'permission.bypassDialog.commandsDesc',
  },
  {
    icon: Globe,
    titleKey: 'permission.bypassDialog.network',
    descKey: 'permission.bypassDialog.networkDesc',
  },
]
</script>

<style scoped lang="scss">
.bypass-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.bypass-card {
  width: 90%;
  max-width: 520px;
  max-height: 86vh;
  overflow-y: auto;
  padding: 28px 32px;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  @include scrollbar-overlay;
}

.bypass-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bypass-header-icon {
  flex-shrink: 0;
  color: var(--text-primary);
}

.bypass-title {
  margin: 0;
  font-size: var(--text-lg-plus);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
  color: var(--text-primary);
}

.bypass-lede,
.bypass-caution {
  margin: 14px 0 0;
  font-size: var(--text-base);
  line-height: var(--leading-prose);
  color: var(--text-secondary);
}

.bypass-scopes {
  margin-top: 20px;
  padding: 0 20px;
  background: var(--surface-soft);
  border-radius: var(--radius-lg);
}

.bypass-scope {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 18px 0;

  & + & {
    border-top: 1px dashed var(--surface-border-strong);
  }
}

.bypass-scope-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--text-primary);
}

.bypass-scope-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.bypass-scope-title {
  font-size: var(--text-base-plus);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-normal);
  color: var(--text-primary);
}

.bypass-scope-desc {
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  color: var(--text-muted);
}

.bypass-caution {
  margin-top: 20px;
}

.bypass-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

.bypass-btn {
  padding: 10px 24px;
  border: none;
  border-radius: var(--radius-lg);
  font-size: var(--text-base);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background-color var(--transition-fast), opacity var(--transition-fast);

  &.cancel {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-default);

    &:hover {
      background: var(--bg-tertiary);
    }
  }

  &.confirm {
    background: var(--error);
    color: #fff;

    &:hover {
      opacity: 0.9;
    }
  }
}

.bypass-dialog-enter-active,
.bypass-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.bypass-dialog-enter-from,
.bypass-dialog-leave-to {
  opacity: 0;
}
</style>

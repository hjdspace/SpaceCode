<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="dialog-overlay" @click.self="handleCancel">
        <div class="dialog-content">
          <div class="dialog-header">
            <h3 class="dialog-title">{{ t('skills.installScopeTitle') }}</h3>
            <p class="dialog-desc">{{ t('skills.installScopeDesc', { name: skillName }) }}</p>
          </div>

          <div class="dialog-body">
            <button
              class="scope-option"
              :class="{ active: selectedScope === 'project' }"
              @click="selectedScope = 'project'"
            >
              <FolderOpen :size="20" />
              <div class="scope-info">
                <span class="scope-name">{{ t('skills.installToProject') }}</span>
                <span class="scope-path">{{ t('skills.installToProjectDesc') }}</span>
              </div>
            </button>

            <button
              class="scope-option"
              :class="{ active: selectedScope === 'global' }"
              @click="selectedScope = 'global'"
            >
              <Globe :size="20" />
              <div class="scope-info">
                <span class="scope-name">{{ t('skills.installToGlobal') }}</span>
                <span class="scope-path">{{ t('skills.installToGlobalDesc') }}</span>
              </div>
            </button>
          </div>

          <div class="dialog-footer">
            <button class="btn btn-secondary" @click="handleCancel">
              {{ t('common.cancel') }}
            </button>
            <button class="btn btn-primary" @click="handleConfirm">
              <Download :size="14" />
              {{ t('skills.install') }}
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
import { FolderOpen, Globe, Download } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  skillName: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm', scope: 'global' | 'project'): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const selectedScope = ref<'global' | 'project'>('project')

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    selectedScope.value = 'project'
  }
})

function handleConfirm() {
  emit('confirm', selectedScope.value)
  emit('update:open', false)
}

function handleCancel() {
  emit('cancel')
  emit('update:open', false)
}
</script>

<style lang="scss" scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.dialog-content {
  width: 100%;
  max-width: 400px;
  background: var(--bg-primary);
  border-radius: 12px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

.dialog-header {
  padding: 20px 20px 0;
}

.dialog-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.dialog-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

.dialog-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.scope-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;

  &:hover {
    border-color: var(--accent-primary);
  }

  &.active {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.1);
    color: var(--accent-primary);
  }
}

.scope-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.scope-name {
  font-size: 14px;
  font-weight: 500;
}

.scope-path {
  font-size: 11px;
  color: var(--text-muted);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 20px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s;

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }

  &.btn-secondary {
    background: var(--bg-secondary);
    border: 1px solid var(--border-default);
    color: var(--text-primary);

    &:hover {
      background: var(--bg-hover);
    }
  }
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>

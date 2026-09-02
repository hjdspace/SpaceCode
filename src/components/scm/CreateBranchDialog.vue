<template>
  <div class="create-branch-dialog" @click.self="$emit('close')">
    <div class="dialog-content">
      <h4>{{ t('scm.createBranch') }}</h4>
      <input
        ref="branchInput"
        v-model="name"
        class="branch-name-input"
        :placeholder="t('scm.branchNamePlaceholder')"
        @keydown.enter="handleCreate"
      />
      <div class="dialog-actions">
        <button class="dialog-btn cancel" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="dialog-btn create" :disabled="!name.trim()" @click="handleCreate">
          {{ t('scm.createAndSwitch') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useScmActions } from '@/composables/useScmActions'

const emit = defineEmits<{
  close: []
  created: []
}>()

const { t } = useI18n()
const actions = useScmActions()

const name = ref('')
const branchInput = ref<HTMLInputElement | null>(null)

onMounted(() => {
  nextTick(() => branchInput.value?.focus())
})

async function handleCreate(): Promise<void> {
  if (!name.value.trim()) return
  await actions.createBranch(name.value)
  name.value = ''
  emit('created')
}
</script>

<style lang="scss" scoped>
.create-branch-dialog {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 200;
}

.dialog-content {
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  padding: 14px;
  width: 88%;
  box-shadow: var(--shadow-lg);
  h4 { font-size: 13px; font-weight: 600; margin-bottom: 10px; }
}

.branch-name-input {
  width: 100%;
  padding: 7px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 11px;
  outline: none;
  &:focus { border-color: var(--accent-primary); }
}

.dialog-actions {
  display: flex; justify-content: flex-end; gap: 6px;
  margin-top: 10px;
}

.dialog-btn {
  @include reset-button;
  padding: 5px 12px;
  border-radius: var(--radius-sm);
  font-size: 11px; font-weight: 500;

  &.cancel { color: var(--text-muted); &:hover { background: var(--surface-glass-hover); } }
  &.create  { background: var(--accent-primary); color: white; &:hover:not(:disabled) { opacity: 0.9; } &:disabled { opacity: 0.5; cursor: not-allowed; } }
}
</style>

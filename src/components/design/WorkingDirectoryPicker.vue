<template>
  <div ref="wrapRef" class="working-dir-wrap" :class="{ 'is-open': open }">
    <button
      type="button"
      class="working-dir-picker"
      data-testid="working-dir-trigger"
      :title="modelValue || t('design.workingDirectory.none')"
      :aria-expanded="open"
      @click="toggleOpen"
    >
      <Folder :size="15" />
      <span class="working-dir-value">{{ displayName }}</span>
      <ChevronDown :size="13" />
    </button>

    <div v-if="open" class="working-dir-panel" data-testid="working-dir-panel" role="menu">
      <button
        type="button"
        class="working-dir-item"
        data-testid="working-dir-pick"
        role="menuitem"
        @click="pickDirectory"
      >
        <Folder :size="18" />
        <span>{{ modelValue ? t('design.workingDirectory.replace') : t('design.workingDirectory.pick') }}</span>
      </button>

      <div
        class="working-dir-submenu"
        @mouseenter="recentOpen = true"
        @mouseleave="recentOpen = false"
      >
        <button
          type="button"
          class="working-dir-item has-caret"
          data-testid="working-dir-recent"
          role="menuitem"
          aria-haspopup="menu"
          :aria-expanded="recentOpen"
          @click="recentOpen = !recentOpen"
        >
          <History :size="18" />
          <span>{{ t('design.workingDirectory.recent') }}</span>
          <ChevronRight :size="15" class="working-dir-item-caret" />
        </button>

        <div v-if="recentOpen" class="working-dir-flyout" data-testid="working-dir-recent-list" role="menu">
          <div v-if="recentDirs.length === 0" class="working-dir-empty">
            {{ t('design.workingDirectory.recentEmpty') }}
          </div>
          <button
            v-for="dir in recentDirs"
            :key="dir"
            type="button"
            class="working-dir-recent-item"
            role="menuitem"
            :title="dir"
            @click="selectRecent(dir)"
          >
            <Folder :size="14" />
            <span class="recent-name">{{ basename(dir) }}</span>
            <span class="recent-path">{{ dir }}</span>
          </button>
        </div>
      </div>

      <button
        v-if="modelValue"
        type="button"
        class="working-dir-item"
        data-testid="working-dir-clear"
        role="menuitem"
        @click="clearDirectory"
      >
        <X :size="17" />
        <span>{{ t('common.clear') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, Folder, History, X } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { getRecentProjectRoots, recordRecentProjectRoot, pathsEqual } from '@/utils/recentProjectRoots'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', path: string): void }>()

const { t } = useI18n()
const open = ref(false)
const recentOpen = ref(false)
const recentDirs = ref<string[]>([])
const wrapRef = ref<HTMLElement | null>(null)

const displayName = computed(() => {
  if (!props.modelValue) return t('design.workingDirectory.none')
  return basename(props.modelValue)
})

function basename(dir: string): string {
  const normalized = dir.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : dir
}

function loadRecentDirs() {
  recentDirs.value = getRecentProjectRoots().filter((dir) =>
    props.modelValue ? !pathsEqual(dir, props.modelValue) : true
  )
}

function toggleOpen() {
  open.value = !open.value
  if (open.value) loadRecentDirs()
}

async function pickDirectory() {
  try {
    const result = await api.selectFolder()
    if (!result.canceled && result.filePaths.length > 0) {
      const path = result.filePaths[0]
      recordRecentProjectRoot(path)
      emit('update:modelValue', path)
      open.value = false
    }
  } catch (error) {
    console.error('Failed to select working directory:', error)
  }
}

function selectRecent(path: string) {
  recordRecentProjectRoot(path)
  emit('update:modelValue', path)
  open.value = false
}

function clearDirectory() {
  emit('update:modelValue', '')
  open.value = false
}

function onPointer(event: MouseEvent) {
  if (wrapRef.value?.contains(event.target as Node)) return
  open.value = false
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onPointer)
  document.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onPointer)
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped lang="scss">
.working-dir-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.working-dir-picker {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 260px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: 6px 8px;
  font-size: 14px;
  cursor: pointer;
  color: var(--text-primary);
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.working-dir-picker:hover,
.working-dir-wrap.is-open .working-dir-picker {
  background: rgba(24, 25, 31, 0.04);
  border-color: var(--surface-border);
}

.working-dir-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.working-dir-panel,
.working-dir-flyout {
  position: absolute;
  z-index: 125;
  display: flex;
  flex-direction: column;
  padding: 8px;
  border: 1px solid #d8e0eb;
  border-radius: 13px;
  background: #fff;
  box-shadow: 0 18px 44px rgba(24, 25, 31, 0.16);
}

.working-dir-panel {
  left: 0;
  top: calc(100% + 8px);
  min-width: 260px;
  animation: panelIn 150ms cubic-bezier(0.23, 1, 0.32, 1);
}

.working-dir-item {
  width: 100%;
  min-height: 42px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  padding: 0 10px;
  transition: background var(--transition-fast);
}

.working-dir-item:hover {
  background: var(--surface-soft);
}

.working-dir-item:not(.has-caret) {
  grid-template-columns: 24px minmax(0, 1fr);
}

.working-dir-item-caret {
  color: var(--text-muted);
}

.working-dir-submenu {
  position: relative;
}

.working-dir-flyout {
  top: -8px;
  left: calc(100% + 6px);
  width: 320px;
}

.working-dir-flyout::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 -8px;
  width: 8px;
}

.working-dir-recent-item {
  width: 100%;
  min-height: 44px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 9px;
  align-items: center;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  padding: 6px 9px;
  transition: background var(--transition-fast);
}

.working-dir-recent-item:hover {
  background: var(--surface-soft);
}

.working-dir-recent-item svg {
  grid-row: 1 / span 2;
}

.recent-name,
.recent-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-name {
  font-size: 14px;
  font-weight: 700;
}

.recent-path {
  font-size: 11px;
  color: var(--text-muted);
}

.working-dir-empty {
  padding: 11px 12px;
  color: var(--text-muted);
  font-size: 13px;
  white-space: nowrap;
}

@keyframes panelIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 720px) {
  .working-dir-panel {
    min-width: min(260px, calc(100vw - 24px));
  }
  .working-dir-flyout {
    left: 0;
    top: calc(100% + 6px);
    width: min(320px, calc(100vw - 24px));
  }
}
</style>

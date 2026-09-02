<template>
  <!-- Changes group -->
  <div class="change-group">
    <div class="group-header" @click="stagedCollapsed = !stagedCollapsed">
      <ChevronRight :size="12" :class="{ rotated: !stagedCollapsed }" />
      <span class="group-title">{{ t('scm.changes') }}</span>
      <div class="group-actions-right">
        <button
          class="group-icon-btn"
          :class="{ active: scmStore.viewMode === 'list' }"
          :title="t('scm.viewModeList')"
          :aria-label="t('scm.viewModeList')"
          @click.stop="scmStore.setViewMode('list')"
        >
          <List :size="13" />
        </button>
        <button
          class="group-icon-btn"
          :class="{ active: scmStore.viewMode === 'tree' }"
          :title="t('scm.viewModeTree')"
          :aria-label="t('scm.viewModeTree')"
          @click.stop="scmStore.setViewMode('tree')"
        >
          <FolderTree :size="13" />
        </button>
        <button class="group-icon-btn" :title="t('scm.discardAllChanges')" @click.stop="actions.discardAll()" :aria-label="t('scm.discardAllAria')">
          <Trash2 :size="14" />
        </button>
        <button class="group-icon-btn" :title="t('scm.stageAllChanges')" @click.stop="actions.stageAll()" :aria-label="t('scm.stageAllAria')">
          <Check :size="14" />
        </button>
        <button class="group-icon-btn" :title="t('scm.refresh')" @click.stop="actions.refresh()" :aria-label="t('scm.refreshAria')">
          <RefreshCw :size="14" />
        </button>
        <button class="group-icon-btn more" :title="t('scm.moreActions')" @click.stop="showMoreMenu = !showMoreMenu" :aria-label="t('scm.moreActionsAria')">
          <MoreHorizontal :size="14" />
        </button>
      </div>
    </div>
    <div
      v-show="!stagedCollapsed"
      class="group-content"
      tabindex="0"
      @keydown="handleKeydown"
    >
      <ScmChangeList @contextmenu="openContextMenu" />
      <div v-if="scmStore.totalChanges === 0 && scmStore.isRepo && !scmStore.isLoading" class="no-changes">
        {{ t('scm.noChanges') }}
      </div>
    </div>
  </div>

  <!-- Conflicts -->
  <div v-if="scmStore.conflicted.length > 0" class="change-group conflicts">
    <div class="group-header" @click="conflictsCollapsed = !conflictsCollapsed">
      <ChevronRight :size="12" :class="{ rotated: !conflictsCollapsed }" />
      <span class="group-title conflict-title">{{ t('scm.mergeConflicts') }}</span>
      <span class="group-count conflict-count">{{ scmStore.conflicted.length }}</span>
    </div>
    <div v-show="!conflictsCollapsed" class="group-content">
      <div
        v-for="file in scmStore.conflicted"
        :key="'conflict-' + file.path"
        class="change-file-row conflict"
        @click="onSelectConflict(file)"
        @contextmenu.prevent="openContextMenu({ file, isStaged: false, x: $event.clientX, y: $event.clientY })"
      >
        <span class="file-status-badge conflict">C</span>
        <span class="file-name" :title="file.path">{{ getFileName(file.path) }}</span>
        <span class="file-path-truncated" :title="file.path">{{ truncatePath(file.path) }}</span>
      </div>
    </div>
  </div>

  <!-- More Actions Dropdown Menu -->
  <div v-if="showMoreMenu" class="more-menu" @click.stop>
    <button class="more-menu-item" @click="runMenuAction(actions.stageAll())">
      <Check :size="12" /> {{ t('scm.stageAllChanges') }}
    </button>
    <button class="more-menu-item" @click="runMenuAction(actions.unstageAll())">
      <Undo2 :size="12" /> {{ t('scm.unstageAll') }}
    </button>
    <button class="more-menu-item danger" @click="runMenuAction(actions.discardAll())">
      <Trash2 :size="12" /> {{ t('scm.discardAll') }}
    </button>
    <div class="more-menu-divider"></div>
    <button class="more-menu-item" @click="runMenuAction(actions.refresh())">
      <RefreshCw :size="12" /> {{ t('scm.refreshStatus') }}
    </button>
  </div>

  <!-- File context menu -->
  <ScmContextMenu
    :visible="contextMenu.visible"
    :file="contextMenu.file"
    :is-staged="contextMenu.isStaged"
    :x="contextMenu.x"
    :y="contextMenu.y"
    @close="closeContextMenu"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronRight, FolderTree, List, MoreHorizontal, RefreshCw, Trash2, Undo2 } from 'lucide-vue-next'
import { useScmStore } from '@/stores/scm'
import { useScmActions } from '@/composables/useScmActions'
import { useScmKeyboardNav } from '@/composables/useScmKeyboardNav'
import type { ScmNavEntry } from '@/composables/useScmKeyboardNav'
import { getFileName, truncatePath } from './scmViewUtils'
import type { ScmFile } from '@/stores/scm'
import ScmChangeList from './ScmChangeList.vue'
import ScmContextMenu from './ScmContextMenu.vue'

const scmStore = useScmStore()
const { t } = useI18n()
const actions = useScmActions()

const stagedCollapsed = ref(false)
const conflictsCollapsed = ref(false)
const showMoreMenu = ref(false)

const contextMenu = ref<{
  visible: boolean
  file: ScmFile | null
  isStaged: boolean
  x: number
  y: number
}>({ visible: false, file: null, isStaged: false, x: 0, y: 0 })

function openContextMenu(payload: { file: ScmFile; isStaged: boolean; x: number; y: number }): void {
  contextMenu.value = { visible: true, ...payload }
}

function closeContextMenu(): void {
  contextMenu.value.visible = false
}

// Keyboard navigation over all visible change entries
const navEntries = computed<ScmNavEntry[]>(() => [
  ...scmStore.staged.map(file => ({ file, isStaged: true })),
  ...scmStore.unstaged.map(file => ({ file, isStaged: false })),
  ...scmStore.untracked.map(file => ({ file, isStaged: false })),
  ...scmStore.conflicted.map(file => ({ file, isStaged: false })),
])

const { handleKeydown } = useScmKeyboardNav(() => navEntries.value)

function onSelectConflict(file: ScmFile): void {
  actions.openFileDiff(file, false)
}

async function runMenuAction(action: Promise<void>): Promise<void> {
  showMoreMenu.value = false
  await action
}

// Click outside to close the more menu
function handleClickOutside(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (!target.closest('.more-menu') && !target.closest('.group-icon-btn.more')) {
    showMoreMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style lang="scss" scoped>
.change-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 5px 8px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
  min-height: 26px;

  &:hover { background: var(--surface-glass-hover); }

  .rotated { transform: rotate(90deg); }
  svg:first-child { transition: transform var(--transition-fast); color: var(--text-muted); }
}

.group-title {
  flex: 1;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
}

.group-actions-right {
  display: flex;
  align-items: center;
  gap: 1px;
  margin-left: auto;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.group-header:hover .group-actions-right {
  opacity: 1;
}

.group-icon-btn {
  @include reset-button;
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  transition: all var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); color: var(--text-primary); }
  &.more:hover { background: transparent; }
  &.active { color: var(--accent-primary); }
}

.group-content {
  flex: 1;
  overflow-y: auto;
  @include scrollbar-thin;
  padding: 0 2px 3px;
  outline: none;

  &:focus-visible {
    box-shadow: inset 0 0 0 1px var(--accent-primary);
    border-radius: var(--radius-sm);
  }
}

.no-changes {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 8px;
}

// --- Conflict rows (rendered inline, minimal) ---
.change-file-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
  min-height: 26px;

  &:hover { background: var(--surface-glass-hover); }
  &.conflict .file-name { color: var(--error); }
}

.file-status-badge {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  width: 16px; height: 16px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 2px;
  flex-shrink: 0;
  letter-spacing: 0.02em;

  &.conflict { color: #dc2626; background: rgba(220,38,38,0.15); }
}

.file-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 90px;
  flex-shrink: 0;
}

.file-path-truncated {
  flex: 1;
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.conflict-title { color: var(--error) !important; }
.conflict-count { background: rgba(220,53,69,0.15) !important; color: var(--error) !important; }

// --- More Actions Menu ---
.more-menu {
  position: absolute;
  top: auto;
  right: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 150;
  min-width: 160px;
  padding: 3px;
}

.more-menu-item {
  @include reset-button;
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 6px 8px;
  border-radius: var(--radius-xs);
  font-size: 11px; color: var(--text-primary);
  text-align: left;

  &:hover { background: var(--surface-glass-hover); }
  &.danger { color: var(--error); &:hover { background: rgba(220,53,69,0.08); } }

  svg { flex-shrink: 0; color: var(--text-muted); }
  &.danger svg { color: var(--error); opacity: 0.7; }
}

.more-menu-divider {
  height: 1px;
  background: var(--surface-border);
  margin: 2px 4px;
}
</style>

<template>
  <div class="diff-viewer">
    <div class="diff-header">
      <FileDiff :size="14" />
      <span v-if="target">{{ target.filePath }}</span>
      <span v-else>Code Changes</span>
      <div class="diff-header-actions">
        <span class="diff-stats" v-if="stats.additions || stats.deletions">
          <span class="stat-additions">+{{ stats.additions }}</span>
          <span class="stat-deletions">-{{ stats.deletions }}</span>
        </span>
        <div class="dropdown-wrapper" v-if="hunkCount > 0 && !target?.commitHash">
          <button class="tool-btn" @click.stop="showHunkMenu = !showHunkMenu" :title="t('scm.hunks')">
            <Layers :size="13" />
            <span>{{ hunkCount }}</span>
            <ChevronDown :size="11" />
          </button>
          <div v-if="showHunkMenu" class="hunk-dropdown-menu" @click.stop>
            <button
              v-for="(header, i) in hunkHeaders"
              :key="i"
              class="hunk-menu-item"
              @click="applyHunkAction(i)"
            >
              <component :is="target?.staged ? Undo2 : Plus" :size="12" />
              <span class="hunk-action">{{ target?.staged ? t('scm.unstageHunk') : t('scm.stageHunk') }}</span>
              <span class="hunk-header-text">{{ header }}</span>
            </button>
          </div>
        </div>
        <button
          class="tool-btn"
          :class="{ active: diffMode === DiffModeEnum.Split }"
          @click="diffMode = DiffModeEnum.Split"
          :title="t('scm.diffSplitView')"
          :aria-label="t('scm.diffSplitView')"
        >
          <Columns2 :size="13" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: diffMode === DiffModeEnum.Unified }"
          @click="diffMode = DiffModeEnum.Unified"
          :title="t('scm.diffUnifiedView')"
          :aria-label="t('scm.diffUnifiedView')"
        >
          <Rows3 :size="13" />
        </button>
      </div>
    </div>

    <div class="diff-content" v-if="rawPatch && !isBinary" :key="diffKey">
      <DiffView
        :data="diffViewData"
        :diff-view-mode="diffMode"
        :diff-view-theme="theme"
        :diff-view-highlight="true"
        :diff-view-font-size="12"
      />
    </div>

    <div class="diff-loading" v-else-if="isLoading">
      <span>{{ t('scm.diffLoading') }}</span>
    </div>

    <div class="binary-notice" v-else-if="isBinary">
      <FileWarning :size="16" />
      <span>{{ t('scm.binaryFile') }}</span>
    </div>

    <div class="empty-diff" v-else>
      <p>{{ emptyMessage }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Columns2, FileDiff, FileWarning, Layers, Plus, Rows3, Undo2 } from 'lucide-vue-next'
import { DiffView, DiffModeEnum } from '@git-diff-view/vue'
import '@git-diff-view/vue/styles/diff-view.css'
import { useScmStore } from '@/stores/scm'
import { useAppStore } from '@/stores/app'
import { useDiffViewerTarget } from '@/composables/useDiffViewerTarget'
import { createDiffViewData } from '@/services/diffFileBuilder'

const scmStore = useScmStore()
const appStore = useAppStore()
const { t } = useI18n()

const {
  target,
  isBinary,
  rawPatch,
  isLoading,
  oldContent,
  newContent,
  stats,
  hunkHeaders,
  hunkCount,
  load,
  stageHunk,
  unstageHunk,
} = useDiffViewerTarget()

const showHunkMenu = ref(false)
const storedDiffMode = typeof localStorage !== 'undefined' ? localStorage.getItem('scm.diffMode') : null
const diffMode = ref<number>(
  Number(storedDiffMode) === DiffModeEnum.Unified ? DiffModeEnum.Unified : DiffModeEnum.Split
)

watch(diffMode, (mode) => {
  try { localStorage.setItem('scm.diffMode', String(mode)) } catch {}
})

const theme = computed<'light' | 'dark'>(() => (appStore.isDark ? 'dark' : 'light'))

const diffViewData = computed(() =>
  createDiffViewData(rawPatch.value, target.value?.filePath ?? '', {
    oldContent: oldContent.value ?? undefined,
    newContent: newContent.value ?? undefined,
  })
)

// Force the DiffView to rebuild when the target or view mode changes
const diffKey = computed(() => `${target.value?.filePath ?? ''}:${target.value?.staged}:${diffMode.value}`)

const emptyMessage = computed(() => {
  if (!target.value) return t('scm.diffSelectFile')
  if (!scmStore.isRepo) return t('scm.diffNotRepo')
  return t('scm.diffNoChanges')
})

function applyHunkAction(index: number): void {
  showHunkMenu.value = false
  if (target.value?.staged) unstageHunk(index)
  else stageHunk(index)
}

function handleClickOutside(e: MouseEvent): void {
  const el = e.target as HTMLElement
  if (!el.closest('.hunk-dropdown-menu') && !el.closest('.dropdown-wrapper')) {
    showHunkMenu.value = false
  }
}

// Reload when the active tab changes (switching / closing tabs in the panel)
watch(
  () => appStore.activeInfoTabId,
  () => {
    if (appStore.infoPanelMode === 'diff') load()
  }
)

// Reload when the SCM panel selection changes (clicking a file in source control)
watch(
  () => [scmStore.selectedFile, scmStore.selectedFileStaged],
  () => load()
)

onMounted(() => {
  load()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style lang="scss" scoped>
.diff-viewer {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.diff-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--surface-border);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);

  > span:first-of-type {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11px;
  }
}

.diff-header-actions {
  display: flex;
  align-items: center;
  gap: 3px;
}

.tool-btn {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 3px;
  height: 22px;
  padding: 0 5px;
  border-radius: var(--radius-xs);
  font-size: 11px;
  color: var(--text-muted);
  transition: all var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); color: var(--text-primary); }
  &.active { color: var(--accent-primary); background: rgba(var(--accent-primary-rgb, 59,130,246), 0.08); }
}

.dropdown-wrapper {
  position: relative;
}

.hunk-dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 150;
  min-width: 240px;
  max-height: 260px;
  overflow-y: auto;
  padding: 3px;
  @include scrollbar-thin;
}

.hunk-menu-item {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border-radius: var(--radius-xs);
  font-size: 11px;
  color: var(--text-primary);
  text-align: left;

  &:hover { background: var(--surface-glass-hover); }
  svg { flex-shrink: 0; color: var(--text-muted); }

  .hunk-action { flex-shrink: 0; }

  .hunk-header-text {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.diff-stats {
  display: flex;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  margin-right: 4px;

  .stat-additions { color: var(--success); }
  .stat-deletions { color: var(--error); }
}

.diff-content {
  flex: 1;
  overflow: auto;
  @include scrollbar;
}

.diff-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
}

.binary-notice {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.empty-diff {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-muted);
  font-size: 12px;
}
</style>

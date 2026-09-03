<template>
  <div
    class="change-file-row"
    :class="{ selected, untracked: isUntracked, conflict: file.status === 'conflict' }"
    @click="$emit('select', file)"
    @contextmenu.prevent="$emit('contextmenu', { file, isStaged, x: $event.clientX, y: $event.clientY })"
  >
    <span class="file-status-badge" :class="badgeClass">{{ statusLetter }}</span>
    <span class="file-lang-icon">{{ langIcon }}</span>
    <span class="file-name" :title="file.path">{{ fileName }}</span>
    <span v-if="isRenamed" class="rename-arrow">→</span>
    <span v-if="isRenamed && originalFileName" class="file-original-name" :title="file.originalPath">{{ originalFileName }}</span>
    <span class="file-path-truncated" :title="file.path">{{ truncatedPath }}</span>
    <span class="file-stats" v-if="stats && (stats.additions || stats.deletions)">
      <span class="stat-add" v-if="stats.additions">+{{ stats.additions }}</span>
      <span class="stat-del" v-if="stats.deletions">-{{ stats.deletions }}</span>
    </span>
    <div class="file-actions">
      <button class="file-action-btn" @click.stop="$emit('copyPath', file)" :title="t('scm.copyPath')" :aria-label="t('scm.copyPathAria')"><Copy :size="12" /></button>
      <button
        v-if="!isStaged && file.status !== 'untracked'"
        class="file-action-btn discard"
        @click.stop="$emit('discard', file)"
        :title="t('scm.discardChanges')"
        :aria-label="t('scm.discardChangesAria')"
      ><Undo2 :size="12" /></button>
      <button v-if="!isStaged" class="file-action-btn" @click.stop="$emit('stage', file)" :title="t('scm.stage')" :aria-label="t('scm.stageAria')"><Plus :size="12" /></button>
      <button v-if="isStaged" class="file-action-btn" @click.stop="$emit('unstage', file)" :title="t('scm.unstage')" :aria-label="t('scm.unstageAria')"><Undo2 :size="12" /></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, Plus, Undo2 } from 'lucide-vue-next'
import type { ScmFile, ScmFileStat } from '@/stores/scm'
import { getLangIcon, getFileName, truncatePath, getStatusLetter } from './scmViewUtils'

const props = defineProps<{
  file: ScmFile
  isStaged: boolean
  selected?: boolean
  stats?: ScmFileStat | null
}>()

const emit = defineEmits<{
  select: [file: ScmFile]
  stage: [file: ScmFile]
  unstage: [file: ScmFile]
  discard: [file: ScmFile]
  copyPath: [file: ScmFile]
  contextmenu: [payload: { file: ScmFile; isStaged: boolean; x: number; y: number }]
}>()

const { t } = useI18n()

const isUntracked = computed(() => props.file.status === 'untracked')
const isRenamed = computed(() => props.file.status === 'renamed' && !!props.file.originalPath)
const originalFileName = computed(() =>
  props.file.originalPath ? getFileName(props.file.originalPath) : ''
)

const langIcon = computed(() => getLangIcon(props.file.path))
const fileName = computed(() => getFileName(props.file.path))
const truncatedPath = computed(() => truncatePath(props.file.path))
const statusLetter = computed(() => getStatusLetter(props.file))
const badgeClass = computed(() => (props.isStaged ? 'staged' : props.file.status))
</script>

<style lang="scss" scoped>
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
  &.selected { background: var(--surface-glass-active); }
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

  &.modified { color: #d97706; background: rgba(217,119,6,0.12); }
  &.added   { color: #16a34a; background: rgba(22,163,74,0.12); }
  &.deleted { color: #dc2626; background: rgba(220,38,38,0.12); }
  &.renamed { color: #2563eb; background: rgba(37,99,235,0.12); }
  &.untracked { color: #16a34a; background: rgba(22,163,74,0.12); }
  &.conflict { color: #dc2626; background: rgba(220,38,38,0.15); }
  &.staged { color: #16a34a; background: rgba(22,163,74,0.15); }
}

.file-lang-icon {
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  color: var(--text-muted);
  background: var(--surface-glass);
  padding: 1px 3px;
  border-radius: 2px;
  flex-shrink: 0;
  min-width: 20px;
  text-align: center;
  letter-spacing: 0.01em;
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

.rename-arrow {
  color: var(--text-muted);
  flex-shrink: 0;
}

.file-original-name {
  font-size: 11px;
  color: var(--text-muted);
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

.file-stats {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 9px;
}

.stat-add { color: #16a34a; }
.stat-del { color: #dc2626; }

.file-actions {
  display: flex;
  gap: 1px;
  opacity: 0;
  transition: opacity var(--transition-fast);

  .change-file-row:hover & { opacity: 1; }
}

.file-action-btn {
  @include reset-button;
  width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  transition: all var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); color: var(--accent-primary); }
  &.discard:hover { color: var(--error); }
}
</style>

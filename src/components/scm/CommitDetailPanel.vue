<template>
  <div class="commit-detail-panel">
    <div class="detail-header">
      <button class="back-btn" @click="scmStore.selectCommit(null)" :title="t('scm.backToGraph')" :aria-label="t('scm.backToGraph')">
        <ArrowLeft :size="13" />
      </button>
      <div class="detail-summary">
        <div class="detail-subject" :title="commit.subject">{{ commit.subject }}</div>
        <div class="detail-meta">
          <span v-if="commit.refs" class="commit-refs">
            <span v-for="(ref, ri) in parseRefs(commit.refs).filter(r => r.type === 'tag')" :key="ri" class="ref-tag tag">
              <Tag :size="10" /> {{ ref.name }}
            </span>
            <span v-for="(ref, ri) in parseRefs(commit.refs).filter(r => r.type === 'remote')" :key="'r'+ri" class="ref-tag remote">
              <Cloud :size="10" /> {{ ref.name }}
            </span>
            <span v-for="(ref, ri) in parseRefs(commit.refs).filter(r => r.type === 'local')" :key="'l'+ri" class="ref-tag head">
              <GitBranch :size="10" /> {{ ref.name }}
            </span>
          </span>
          <span class="meta-author">{{ commit.author }}</span>
          <span class="meta-date">{{ formatDate(commit.date) }}</span>
          <span class="meta-hash">{{ commit.shortHash }}</span>
        </div>
      </div>
      <div class="detail-actions">
        <button class="action-btn" @click="handleCheckout" :title="t('scm.checkoutCommit')" :aria-label="t('scm.checkoutCommit')">
          <GitBranch :size="12" /> {{ t('scm.checkoutCommitShort') }}
        </button>
        <div class="dropdown-wrapper">
          <button class="action-btn" @click.stop="showResetMenu = !showResetMenu" :title="t('scm.resetHere')" :aria-label="t('scm.resetHere')">
            <Undo2 :size="12" /> {{ t('scm.resetHereShort') }}
            <ChevronDown :size="10" />
          </button>
          <div v-if="showResetMenu" class="reset-dropdown-menu" @click.stop>
            <button class="reset-menu-item" @click="handleReset('soft')">{{ t('scm.resetSoft') }}</button>
            <button class="reset-menu-item" @click="handleReset('mixed')">{{ t('scm.resetMixed') }}</button>
            <button class="reset-menu-item danger" @click="handleReset('hard')">{{ t('scm.resetHard') }}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="detail-files-header">
      <span>{{ t('scm.commitFiles') }}</span>
      <span class="files-count" v-if="scmStore.commitFiles.length">{{ scmStore.commitFiles.length }}</span>
    </div>

    <div class="detail-files" v-if="scmStore.commitFilesLoading">
      <span class="files-loading">{{ t('scm.diffLoading') }}</span>
    </div>
    <div class="detail-files" v-else-if="scmStore.commitFiles.length > 0">
      <div
        v-for="file in scmStore.commitFiles"
        :key="file.path"
        class="commit-file-row"
        @click="openFileDiff(file)"
      >
        <span class="file-status-badge" :class="statusClass(file.statusCode)">{{ statusLetter(file.statusCode) }}</span>
        <span class="file-name" :title="file.path">{{ getFileName(file.path) }}</span>
        <span class="file-path-truncated" :title="file.path">{{ truncatePath(file.path) }}</span>
        <span class="file-stats" v-if="!file.isBinary && (file.additions || file.deletions)">
          <span class="stat-add" v-if="file.additions">+{{ file.additions }}</span>
          <span class="stat-del" v-if="file.deletions">-{{ file.deletions }}</span>
        </span>
      </div>
    </div>
    <div class="detail-files" v-else>
      <span class="files-loading">
        {{ isMerge ? t('scm.mergeCommitHint') : t('scm.noCommitFiles') }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ChevronDown, Cloud, GitBranch, Tag, Undo2 } from 'lucide-vue-next'
import { useScmStore } from '@/stores/scm'
import { useAppStore } from '@/stores/app'
import { useDialog } from '@/composables/useDialog'
import { parseRefs, getFileName, truncatePath } from './scmViewUtils'
import type { ScmCommitFileStat } from '@/stores/scm'

const scmStore = useScmStore()
const appStore = useAppStore()
const { t } = useI18n()
const { showConfirm } = useDialog()

const showResetMenu = ref(false)

const commit = computed(() => scmStore.selectedCommit!)
const isMerge = computed(() => (commit.value.parents?.length ?? 0) > 1)

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString()
  } catch {
    return dateStr
  }
}

function statusLetter(code: string): string {
  return code || 'M'
}

function statusClass(code: string): string {
  const map: Record<string, string> = {
    M: 'modified', A: 'added', D: 'deleted',
    R: 'renamed', C: 'added', U: 'untracked',
  }
  return map[code] ?? 'modified'
}

function openFileDiff(file: ScmCommitFileStat): void {
  appStore.openCommitDiff(commit.value.hash, file.path)
}

async function handleCheckout(): Promise<void> {
  showResetMenu.value = false
  const ok = await showConfirm(
    t('scm.confirmCheckoutCommit', { hash: commit.value.shortHash }),
    { variant: 'danger' }
  )
  if (!ok) return
  await scmStore.checkoutBranch(commit.value.hash)
  scmStore.selectCommit(null)
}

async function handleReset(mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
  showResetMenu.value = false
  const ok = await showConfirm(
    t('scm.confirmReset', { hash: commit.value.shortHash, mode: t(`scm.reset${mode[0]!.toUpperCase()}${mode.slice(1)}`) }),
    { variant: mode === 'hard' ? 'danger' : 'default' }
  )
  if (!ok) return
  await scmStore.resetTo(commit.value.hash, mode)
  scmStore.selectCommit(null)
}

function handleClickOutside(e: MouseEvent): void {
  const el = e.target as HTMLElement
  if (!el.closest('.reset-dropdown-menu') && !el.closest('.dropdown-wrapper')) {
    showResetMenu.value = false
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
.commit-detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 8px 6px;
  border-bottom: 1px solid var(--surface-border);
}

.back-btn {
  @include reset-button;
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  flex-shrink: 0;

  &:hover { background: var(--surface-glass-hover); color: var(--text-primary); }
}

.detail-summary {
  flex: 1;
  min-width: 0;
}

.detail-subject {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  flex-wrap: wrap;
  font-size: 10px;
  color: var(--text-muted);
}

.meta-hash {
  font-family: var(--font-mono);
  color: var(--accent-primary);
}

.commit-refs {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-wrap: wrap;
}

.ref-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 9px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: var(--radius-full);
  line-height: 1.5;

  &.head { color: var(--accent-primary); background: rgba(59,130,246,0.12); }
  &.tag  { color: #d97706; background: rgba(217,119,6,0.12); }
  &.remote { color: #7c3aed; background: rgba(124,58,237,0.12); }
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.action-btn {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 3px;
  height: 22px;
  padding: 0 6px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  color: var(--text-muted);
  transition: all var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); color: var(--text-primary); }
}

.dropdown-wrapper {
  position: relative;
}

.reset-dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 150;
  min-width: 130px;
  padding: 3px;
}

.reset-menu-item {
  @include reset-button;
  display: block;
  width: 100%;
  padding: 5px 9px;
  border-radius: var(--radius-xs);
  font-size: 11px;
  color: var(--text-primary);
  text-align: left;

  &:hover { background: var(--surface-glass-hover); }
  &.danger { color: var(--error); &:hover { background: rgba(220,53,69,0.08); } }
}

.detail-files-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px 3px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-secondary, var(--text-muted));
  text-transform: uppercase;
  letter-spacing: 0.3px;

  .files-count {
    color: var(--accent-primary);
  }
}

.detail-files {
  flex: 1;
  overflow-y: auto;
  @include scrollbar-thin;
  padding: 0 2px 4px;
}

.files-loading {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 12px 8px;
}

.commit-file-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
  min-height: 24px;

  &:hover { background: var(--surface-glass-hover); }
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
}

.file-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100px;
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
</style>

<template>
  <div class="graph-header" @click="graphCollapsed = !graphCollapsed">
    <ChevronRight :size="12" :class="{ rotated: !graphCollapsed }" />
    <span class="graph-title">{{ t('scm.graph') }}</span>
    <div class="graph-toolbar">
      <button class="graph-tool-btn" :class="{ active: graphViewMode === 'auto' }" @click.stop="graphViewMode = 'auto'" :title="t('scm.auto')">
        <GitMerge :size="13" />
        <span>{{ t('scm.auto') }}</span>
      </button>
      <button class="graph-tool-btn" :class="{ active: graphViewMode === 'linear' }" @click.stop="graphViewMode = 'linear'" :title="t('scm.linearViewAria')" :aria-label="t('scm.linearViewAria')">
        <CircleDot :size="13" />
      </button>
      <button class="graph-tool-btn" @click.stop="actions.fetchAll()" :title="t('scm.fetchAllAria')" :aria-label="t('scm.fetchAllAria')">
        <ArrowDownToLine :size="13" />
      </button>
      <button class="graph-tool-btn" @click.stop="actions.pull()" :title="t('scm.pullAria2')" :aria-label="t('scm.pullAria2')">
        <ArrowDown :size="13" />
      </button>
      <button class="graph-tool-btn" @click.stop="actions.push()" :title="t('scm.pushAria2')" :aria-label="t('scm.pushAria2')">
        <ArrowUp :size="13" />
      </button>
      <button class="graph-tool-btn" @click.stop="handleRefreshGraph" :title="t('scm.refreshGraphAria')" :aria-label="t('scm.refreshGraphAria')">
        <RefreshCw :size="13" :class="{ spinning: graphLoading }" />
      </button>
    </div>
  </div>

  <!-- Commit detail view -->
  <div v-if="!graphCollapsed && scmStore.selectedCommit" class="graph-content">
    <CommitDetailPanel />
  </div>

  <!-- Commit graph list -->
  <div v-show="!graphCollapsed && !scmStore.selectedCommit" class="graph-content">
    <div v-if="graphLoading" class="graph-loading">{{ t('scm.loadingCommits') }}</div>
    <div v-else-if="scmStore.log.length === 0 && scmStore.isRepo" class="no-commits">{{ t('scm.noCommits') }}</div>
    <div v-else class="commit-graph-list">
      <div
        v-for="(row, idx) in graphRows"
        :key="row.entry.hash"
        class="commit-row"
        :class="{ selected: scmStore.selectedCommit?.hash === row.entry.hash }"
        @click="selectCommit(row)"
      >
        <GitGraph :rows="[row]" />
        <div class="commit-info">
          <div class="commit-line">
            <span class="commit-subject" :title="row.entry.subject">{{ row.entry.subject }}</span>
            <span class="commit-date">{{ getRelativeDate(row.entry.date) }}</span>
          </div>
          <div v-if="row.entry.refs" class="commit-refs">
            <span v-if="row.entry.refs.includes('HEAD')" class="ref-tag head">
              <CircleDot :size="10" /> {{ scmStore.branch }}
            </span>
            <span v-for="(ref, ri) in parseRefs(row.entry.refs).filter(r => r.type === 'tag')" :key="ri" class="ref-tag tag">
              <Tag :size="10" /> {{ ref.name }}
            </span>
            <span v-for="(ref, ri) in parseRefs(row.entry.refs).filter(r => r.type === 'remote')" :key="'r'+ri" class="ref-tag remote">
              <Cloud :size="10" /> {{ ref.name }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronRight, RefreshCw, ArrowUp, ArrowDown,
  Tag, Cloud, CircleDot, GitMerge, ArrowDownToLine
} from 'lucide-vue-next'
import { useScmStore } from '@/stores/scm'
import { useScmActions } from '@/composables/useScmActions'
import { assignLanes, type GraphRow } from '@/composables/useGitGraphLayout'
import { parseRefs, getRelativeDate } from './scmViewUtils'
import type { ScmLogEntry } from '@/stores/scm'
import GitGraph from './GitGraph.vue'
import CommitDetailPanel from './CommitDetailPanel.vue'

const scmStore = useScmStore()
const { t } = useI18n()
const actions = useScmActions()

const graphCollapsed = ref(false)
const graphLoading = ref(false)
const graphViewMode = ref<'auto' | 'linear'>('auto')

const graphRows = computed<GraphRow<ScmLogEntry>[]>(() => assignLanes(scmStore.log))

function selectCommit(row: GraphRow<ScmLogEntry>): void {
  scmStore.selectCommit(row.entry)
}

async function handleRefreshGraph(): Promise<void> {
  graphLoading.value = true
  await scmStore.refreshLog(50)
  graphLoading.value = false
}
</script>

<style lang="scss" scoped>
.graph-header {
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

.graph-title {
  flex: 1;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
}

.graph-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.graph-tool-btn {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 5px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  color: var(--text-muted);
  transition: all var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); color: var(--text-primary); }
  &.active { color: var(--accent-primary); background: rgba(var(--accent-primary-rgb, 59,130,246), 0.08); }

  .spinning { animation: spin 1s linear infinite; }
}

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.graph-content {
  flex: 1;
  overflow-y: auto;
  @include scrollbar-thin;
}

.graph-loading, .no-commits {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 16px 8px;
}

.commit-graph-list { padding: 0 4px 4px; }

.commit-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 0 4px 0 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); }
  &.selected { background: var(--surface-glass-active); }
}

.commit-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.commit-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.commit-subject {
  font-size: 11px;
  color: var(--text-primary);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.commit-date {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.commit-refs {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-wrap: nowrap;
  flex-shrink: 0;
  overflow: hidden;
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
  white-space: nowrap;

  &.head { color: var(--accent-primary); background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.3); }
  &.tag  { color: #d97706; background: rgba(217,119,6,0.12); }
  &.remote { color: #7c3aed; background: rgba(124,58,237,0.12); }
}
</style>

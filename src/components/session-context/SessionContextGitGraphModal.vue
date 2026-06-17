<template>
  <Teleport to="body">
    <Transition name="graph-modal">
      <div
        v-if="sessionContext.showGitGraphModal"
        class="graph-overlay"
        @click.self="handleClose"
      >
        <div class="graph-modal" @click.stop>
          <!-- Header -->
          <div class="graph-header">
            <span class="graph-title">{{ t('sessionContext.gitGraphTitle') }}</span>
            <div class="graph-header-actions">
              <button class="graph-action-btn" :title="t('sessionContext.refreshGraph')" @click="loadGraph">
                <RefreshCw :size="14" :class="{ spinning: isLoading }" />
              </button>
              <button class="graph-close" @click="handleClose">
                <X :size="16" />
              </button>
            </div>
          </div>

          <!-- Body -->
          <div class="graph-body">
            <!-- Loading state -->
            <div v-if="isLoading" class="graph-loading">
              <Loader2 :size="24" class="spin-icon" />
              <span>{{ t('sessionContext.loadingGraph') }}</span>
            </div>

            <!-- Empty state -->
            <div v-else-if="!entries.length" class="graph-empty">
              <GitCommit :size="32" />
              <span>{{ errorMsg || t('sessionContext.noCommits') }}</span>
            </div>

            <!-- Commit graph -->
            <div v-else class="graph-content">
              <table class="graph-table">
                <thead>
                  <tr>
                    <th class="col-graph"></th>
                    <th class="col-subject">{{ t('sessionContext.commitSubject') }}</th>
                    <th class="col-date">{{ t('sessionContext.commitDate') }}</th>
                    <th class="col-author">{{ t('sessionContext.commitAuthor') }}</th>
                    <th class="col-hash">{{ t('sessionContext.commitHash') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(entry, index) in entries"
                    :key="entry.hash"
                    class="graph-row"
                  >
                    <!-- Timeline column -->
                    <td class="col-graph">
                      <div class="timeline-cell">
                        <div class="timeline-line" :class="{ first: index === 0, last: index === entries.length - 1 }" />
                        <div
                          class="timeline-node"
                          :class="{ head: isHead(entry) }"
                        />
                      </div>
                    </td>

                    <!-- Subject with refs -->
                    <td class="col-subject">
                      <div class="subject-cell">
                        <!-- Ref badges -->
                        <span
                          v-for="ref in parseRefs(entry.refs)"
                          :key="ref"
                          class="ref-badge"
                          :class="refClass(ref)"
                        >
                          {{ ref }}
                        </span>
                        <span class="subject-text">{{ entry.subject }}</span>
                      </div>
                    </td>

                    <!-- Date -->
                    <td class="col-date">
                      <span class="date-text">{{ formatDate(entry.date) }}</span>
                    </td>

                    <!-- Author -->
                    <td class="col-author">
                      <span class="author-text">{{ entry.author }}</span>
                    </td>

                    <!-- Short hash -->
                    <td class="col-hash">
                      <code class="hash-text">{{ entry.shortHash }}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  X, RefreshCw, Loader2, GitCommit
} from 'lucide-vue-next'
import { useSessionContext } from '@/stores/sessionContext'
import { useScmStore } from '@/stores/scm'

interface LogEntry {
  hash: string
  shortHash: string
  subject: string
  author: string
  date: string
  refs: string
}

const { t } = useI18n()
const sessionContext = useSessionContext()
const scmStore = useScmStore()

const entries = ref<LogEntry[]>([])
const isLoading = ref(false)
const errorMsg = ref('')

function isHead(entry: LogEntry): boolean {
  return entry.refs.includes('HEAD') || entry === entries.value[0]
}

function parseRefs(refs: string): string[] {
  if (!refs) return []
  return refs.split(',').map(r => r.trim()).filter(Boolean)
}

function refClass(ref: string): string {
  if (ref === 'HEAD') return 'ref-head'
  if (ref.startsWith('origin/')) return 'ref-remote'
  if (ref === 'main' || ref === 'master') return 'ref-main'
  if (ref.startsWith('tag:')) return 'ref-tag'
  return 'ref-branch'
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr.slice(0, 16)
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${month}/${day} ${hours}:${minutes}`
  } catch {
    return dateStr.slice(0, 16)
  }
}

async function loadGraph() {
  isLoading.value = true
  errorMsg.value = ''
  entries.value = []

  try {
    await scmStore.refreshLog(100)
    entries.value = scmStore.log.map(entry => ({
      hash: entry.hash,
      shortHash: entry.shortHash,
      subject: entry.subject,
      author: entry.author,
      date: entry.date,
      refs: entry.refs,
    }))
  } catch (e: any) {
    errorMsg.value = t('sessionContext.loadGraphFailed')
    console.error('[GitGraph] Failed to load log:', e)
  } finally {
    isLoading.value = false
  }
}

function handleClose() {
  sessionContext.closeGitGraphModal()
}

// Load when modal opens
watch(() => sessionContext.showGitGraphModal, (show) => {
  if (show) {
    loadGraph()
  } else {
    entries.value = []
    errorMsg.value = ''
  }
})
</script>

<style lang="scss" scoped>
.graph-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.graph-modal {
  width: 920px;
  max-width: 94vw;
  height: 80vh;
  max-height: 700px;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border-strong, rgba(255,255,255,0.14));
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.graph-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;
}

.graph-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.graph-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.graph-action-btn {
  width: 28px; height: 28px;
  border: none; border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms ease;

  &:hover { background: var(--bg-hover); color: var(--text-primary); }
}

.spinning {
  animation: spin 1s linear infinite;
}

.graph-close {
  width: 28px; height: 28px;
  border: none; border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms ease;

  &:hover { background: var(--bg-hover); color: var(--text-primary); }
}

.graph-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.graph-loading,
.graph-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}

.graph-content {
  height: 100%;
  overflow-y: auto;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
}

.graph-table {
  width: 100%;
  border-collapse: collapse;
}

.graph-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-secondary);
}

.graph-table th {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  text-align: left;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--surface-border);
  white-space: nowrap;
}

.graph-table td {
  padding: 0 12px;
  font-size: 12px;
  vertical-align: middle;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.graph-row {
  transition: background 150ms ease;

  &:hover {
    background: var(--bg-hover);
  }
}

// Column widths
.col-graph { width: 44px; min-width: 44px; text-align: center; }
.col-subject { width: auto; }
.col-date { width: 100px; min-width: 100px; }
.col-author { width: 120px; min-width: 120px; }
.col-hash { width: 80px; min-width: 80px; }

// Timeline
.timeline-cell {
  position: relative;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.timeline-line {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent-primary, #f59e0b);
  transform: translateX(-50%);
  opacity: 0.5;

  &.first { top: 50%; }
  &.last { bottom: 50%; }
}

.timeline-node {
  position: relative;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent-primary, #f59e0b);
  z-index: 1;
  box-shadow: 0 0 0 2px var(--bg-secondary);

  &.head {
    width: 12px;
    height: 12px;
    background: #f59e0b;
    box-shadow: 0 0 0 2px var(--bg-secondary), 0 0 8px rgba(245, 158, 11, 0.4);
  }
}

// Subject cell
.subject-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  min-width: 0;
}

.ref-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.ref-head {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.25);
}

.ref-main {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.25);
}

.ref-branch {
  background: rgba(59, 130, 246, 0.12);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.2);
}

.ref-remote {
  background: rgba(168, 85, 247, 0.12);
  color: #a855f7;
  border: 1px solid rgba(168, 85, 247, 0.2);
}

.ref-tag {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.subject-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  line-height: 1.4;
}

.date-text,
.author-text {
  color: var(--text-secondary);
  white-space: nowrap;
  font-size: 11px;
}

.hash-text {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// Transition
.graph-modal-enter-active { transition: all 0.2s ease-out; }
.graph-modal-leave-active { transition: all 0.15s ease-in; }
.graph-modal-enter-from { opacity: 0; transform: scale(0.95); }
.graph-modal-leave-to { opacity: 0; transform: scale(0.95); }
</style>

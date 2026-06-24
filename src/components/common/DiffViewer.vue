<template>
  <div class="diff-viewer">
    <div class="diff-header">
      <FileDiff :size="14" />
      <span v-if="diffData?.path">{{ diffData.path }}</span>
      <span v-else-if="diffTarget">{{ diffTarget.filePath }}</span>
      <span v-else>Code Changes</span>
      <div class="diff-header-actions" v-if="diffData">
        <span class="diff-stats" v-if="diffData.additions || diffData.deletions">
          <span class="stat-additions">+{{ diffData.additions }}</span>
          <span class="stat-deletions">-{{ diffData.deletions }}</span>
        </span>
      </div>
    </div>

    <div class="diff-content" v-if="diffLines.length > 0">
      <div
        v-for="(line, index) in diffLines"
        :key="index"
        class="diff-line"
        :class="line.type"
      >
        <span class="line-number old">{{ line.oldNumber || '' }}</span>
        <span class="line-number new">{{ line.newNumber || '' }}</span>
        <span class="line-prefix">{{ line.prefix }}</span>
        <span class="line-content">{{ line.content }}</span>
      </div>
    </div>

    <div class="diff-loading" v-else-if="isLoading">
      <span>Loading diff...</span>
    </div>

    <div class="empty-diff" v-else>
      <p>{{ emptyMessage }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { FileDiff } from 'lucide-vue-next'
import { useScmStore } from '@/stores/scm'
import { useAppStore, type ScmDiffTabData } from '@/stores/app'
import { api } from '@/services/electronAPI'

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header'
  content: string
  oldNumber?: number
  newNumber?: number
  prefix: string
}

const scmStore = useScmStore()
const appStore = useAppStore()

const diffData = ref<any>(null)
const isLoading = ref(false)

// Resolve the diff target from the active diff tab; fall back to the SCM panel
// selection so the viewer also reacts to clicks in the source control panel.
const diffTarget = computed<{ filePath: string; staged: boolean } | null>(() => {
  const tab = appStore.activeInfoTab
  if (tab && tab.type === 'diff' && tab.data) {
    const d = tab.data as ScmDiffTabData
    return { filePath: d.filePath, staged: d.staged }
  }
  if (scmStore.selectedFile) {
    return { filePath: scmStore.selectedFile.path, staged: scmStore.selectedFileStaged }
  }
  return null
})

const emptyMessage = computed(() => {
  if (!diffTarget.value) return 'Select a file to view changes'
  if (!scmStore.isRepo) return 'Not a git repository'
  return 'No changes to display'
})

const diffLines = computed<DiffLine[]>(() => {
  if (!diffData.value?.hunks) return []

  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const hunk of diffData.value.hunks) {
    oldLine = hunk.oldStart
    newLine = hunk.newStart

    // Hunk header
    lines.push({
      type: 'header',
      content: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      prefix: '',
    })

    if (hunk.content) {
      const contentLines = hunk.content.split('\n')
      for (const line of contentLines) {
        if (line.startsWith('+')) {
          lines.push({
            type: 'add',
            content: line.substring(1),
            newNumber: newLine++,
            prefix: '+',
          })
        } else if (line.startsWith('-')) {
          lines.push({
            type: 'remove',
            content: line.substring(1),
            oldNumber: oldLine++,
            prefix: '-',
          })
        } else {
          lines.push({
            type: 'context',
            content: line.startsWith(' ') ? line.substring(1) : line,
            oldNumber: oldLine++,
            newNumber: newLine++,
            prefix: ' ',
          })
        }
      }
    }
  }

  return lines
})

async function loadDiff() {
  const target = diffTarget.value
  if (!target || !appStore.projectRoot) {
    diffData.value = null
    return
  }

  isLoading.value = true
  try {
    const result = await api.git.getDiff(
      appStore.projectRoot,
      target.filePath,
      target.staged
    )
    diffData.value = result
  } catch (e) {
    console.error('Failed to load diff:', e)
    diffData.value = null
  } finally {
    isLoading.value = false
  }
}

// Reload when the active tab changes (switching / closing tabs in the panel)
watch(
  () => appStore.activeInfoTabId,
  () => {
    if (appStore.infoPanelMode === 'diff') {
      loadDiff()
    }
  }
)

// Reload when the SCM panel selection changes (clicking a file in source control)
watch(
  () => [scmStore.selectedFile, scmStore.selectedFileStaged],
  () => {
    loadDiff()
  }
)

onMounted(() => {
  loadDiff()
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
  padding: 10px 12px;
  border-bottom: 1px solid var(--surface-border);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);

  span:first-of-type {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11px;
  }
}

.diff-stats {
  display: flex;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;

  .stat-additions {
    color: var(--success);
  }
  .stat-deletions {
    color: var(--error);
  }
}

.diff-content {
  flex: 1;
  overflow: auto;
  @include scrollbar;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
}

.diff-line {
  display: flex;
  align-items: stretch;
  min-height: 20px;

  .line-number {
    min-width: 40px;
    padding: 0 8px;
    text-align: right;
    color: var(--text-muted);
    user-select: none;
    background: var(--bg-secondary, var(--surface-glass));
    font-size: 11px;
    flex-shrink: 0;
  }

  .line-prefix {
    width: 16px;
    text-align: center;
    user-select: none;
    flex-shrink: 0;
    font-weight: 700;
  }

  .line-content {
    flex: 1;
    padding: 0 8px;
    white-space: pre;
    overflow-x: auto;
  }

  &.context {
    .line-content {
      color: var(--text-secondary);
    }
  }

  &.add {
    background: rgba(40, 167, 69, 0.08);

    .line-number {
      background: rgba(40, 167, 69, 0.12);
    }

    .line-prefix {
      color: var(--success);
    }

    .line-content {
      color: var(--success);
    }
  }

  &.remove {
    background: rgba(220, 53, 69, 0.08);

    .line-number {
      background: rgba(220, 53, 69, 0.12);
    }

    .line-prefix {
      color: var(--error);
    }

    .line-content {
      color: var(--error);
    }
  }

  &.header {
    background: rgba(77, 166, 255, 0.06);
    color: rgba(77, 166, 255, 0.8);
    font-size: 11px;

    .line-content {
      color: rgba(77, 166, 255, 0.8);
    }
  }
}

.diff-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
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

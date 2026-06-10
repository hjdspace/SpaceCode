<template>
  <div class="diff-explorer">
    <!-- 头部信息 -->
    <div class="diff-explorer-header">
      <div class="diff-explorer-title">
        <FileDiff :size="16" />
        <span>Uncommitted changes</span>
        <span class="diff-explorer-subtitle">(git diff HEAD)</span>
      </div>
      <div class="diff-explorer-stats" v-if="diffData?.stats">
        <span class="stat-files">{{ diffData.stats.filesCount }} files changed</span>
        <span class="stat-additions" v-if="diffData.stats.linesAdded > 0">+{{ diffData.stats.linesAdded }}</span>
        <span class="stat-deletions" v-if="diffData.stats.linesRemoved > 0">-{{ diffData.stats.linesRemoved }}</span>
      </div>
    </div>

    <!-- 主体区域 -->
    <div class="diff-explorer-body" v-if="diffData && diffData.files.length > 0">
      <!-- 文件列表 -->
      <div class="diff-file-list">
        <div
          v-for="(file, index) in diffData.files"
          :key="file.path"
          class="diff-file-item"
          :class="{ selected: selectedIndex === index }"
          @click="selectedIndex = index"
        >
          <div class="diff-file-path" :title="file.path">
            <File :size="14" />
            <span>{{ file.path }}</span>
          </div>
          <div class="diff-file-stats">
            <template v-if="file.isUntracked">
              <span class="untracked-label">untracked</span>
            </template>
            <template v-else-if="file.isBinary">
              <span class="binary-label">Binary file</span>
            </template>
            <template v-else>
              <span class="stat-additions" v-if="file.linesAdded > 0">+{{ file.linesAdded }}</span>
              <span class="stat-deletions" v-if="file.linesRemoved > 0">-{{ file.linesRemoved }}</span>
            </template>
          </div>
        </div>
      </div>

      <!-- Diff 详情 -->
      <div class="diff-detail">
        <!-- 详情头部 -->
        <div class="diff-detail-header">
          <FileDiff :size="14" />
          <span class="diff-detail-path">{{ selectedFile?.path }}</span>
          <template v-if="selectedFile && !selectedFile.isUntracked && !selectedFile.isBinary">
            <span class="stat-additions" v-if="selectedFile.linesAdded > 0">+{{ selectedFile.linesAdded }}</span>
            <span class="stat-deletions" v-if="selectedFile.linesRemoved > 0">-{{ selectedFile.linesRemoved }}</span>
          </template>
        </div>

        <!-- Diff 内容 -->
        <div class="diff-detail-content">
          <!-- 未跟踪文件 -->
          <div class="diff-notice" v-if="selectedFile?.isUntracked">
            <p>New file not yet staged.</p>
            <p>Run <code>git add {{ selectedFile.path }}</code> to see line counts.</p>
          </div>
          <!-- 二进制文件 -->
          <div class="diff-notice" v-else-if="selectedFile?.isBinary">
            <p>Binary file - cannot display diff</p>
          </div>
          <!-- 无 hunks（大文件等情况） -->
          <div class="diff-notice" v-else-if="selectedHunks.length === 0 && selectedFile">
            <p>Large file - diff exceeds 1 MB limit</p>
          </div>
          <!-- 空 diff -->
          <div class="diff-notice" v-else-if="selectedHunks.length === 0">
            <p>No diff content</p>
          </div>
          <!-- Diff 行 -->
          <div class="diff-lines" v-else>
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
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div class="diff-explorer-empty" v-else-if="diffData">
      <p>{{ emptyMessage }}</p>
    </div>

    <!-- 加载中 -->
    <div class="diff-explorer-loading" v-else>
      <p>Loading diff...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { FileDiff, File } from 'lucide-vue-next'

interface GitDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  content: string
}

interface GitFullDiffFileStats {
  path: string
  linesAdded: number
  linesRemoved: number
  isBinary: boolean
  isUntracked?: boolean
}

interface GitFullDiffResult {
  stats: {
    filesCount: number
    linesAdded: number
    linesRemoved: number
  }
  files: GitFullDiffFileStats[]
  hunks: Record<string, GitDiffHunk[]>
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header'
  content: string
  oldNumber?: number
  newNumber?: number
  prefix: string
}

const props = defineProps<{
  diffData: GitFullDiffResult | null
}>()

const selectedIndex = ref(0)

const selectedFile = computed(() => {
  if (!props.diffData?.files) return null
  return props.diffData.files[selectedIndex.value] || null
})

const selectedHunks = computed(() => {
  if (!selectedFile.value || !props.diffData?.hunks) return []
  return props.diffData.hunks[selectedFile.value.path] || []
})

const diffLines = computed<DiffLine[]>(() => {
  if (selectedHunks.value.length === 0) return []

  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const hunk of selectedHunks.value) {
    oldLine = hunk.oldStart
    newLine = hunk.newStart

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

const emptyMessage = computed(() => {
  if (props.diffData?.stats && props.diffData.stats.filesCount === 0) {
    return 'Working tree is clean'
  }
  return 'No changes to display'
})
</script>

<style lang="scss" scoped>
.diff-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: none;
  border-radius: 0;
  overflow: hidden;
  background: var(--bg-primary);
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
}

.diff-explorer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-soft);
  flex-shrink: 0;
}

.diff-explorer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--text-primary);
}

.diff-explorer-subtitle {
  color: var(--text-muted);
  font-weight: 400;
  font-size: 11px;
}

.diff-explorer-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--text-muted);
}

.stat-files {
  color: var(--text-muted);
}

.stat-additions {
  color: #16a34a;
  font-weight: 600;

  :global([data-theme="dark"]) &,
  :global([data-theme="anthropic-dark"]) & {
    color: #4ade80;
  }
}

.stat-deletions {
  color: #dc2626;
  font-weight: 600;

  :global([data-theme="dark"]) &,
  :global([data-theme="anthropic-dark"]) & {
    color: #f87171;
  }
}

.diff-explorer-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

// 文件列表
.diff-file-list {
  width: 260px;
  min-width: 200px;
  border-right: 1px solid var(--surface-border);
  overflow-y: auto;
  background: var(--surface-soft);
  flex-shrink: 0;
}

.diff-file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  gap: 8px;
  border-bottom: 1px solid var(--surface-border);
  color: var(--text-secondary);

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  &.selected {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
    border-left: 3px solid var(--accent-primary);
  }
}

.diff-file-path {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  flex: 1;
  min-width: 0;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
  }

  svg {
    flex-shrink: 0;
    color: var(--text-muted);
  }
}

.diff-file-stats {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  flex-shrink: 0;
}

.untracked-label {
  color: var(--text-muted);
  font-style: italic;
  font-size: 10px;
}

.binary-label {
  color: #eab308;
  font-style: italic;
  font-size: 10px;
}

// Diff 详情
.diff-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--bg-primary);
}

.diff-detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-soft);
  font-weight: 500;
  font-size: 12px;
  flex-shrink: 0;
  color: var(--text-primary);
}

.diff-detail-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-detail-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.diff-notice {
  padding: 20px;
  color: var(--text-muted);
  font-style: italic;
  font-size: 12px;
  line-height: 1.6;

  code {
    background: var(--surface-hover);
    padding: 1px 6px;
    border-radius: 3px;
    font-style: normal;
    color: var(--text-primary);
  }
}

// Diff 行
.diff-lines {
  font-size: 12px;
  line-height: 1.6;
  tab-size: 4;
}

.diff-line {
  display: flex;
  align-items: flex-start;
  min-height: 22px;

  &.header {
    background: var(--surface-hover);
    color: #1e40af;
    font-weight: 500;

    :global([data-theme="dark"]) &,
    :global([data-theme="anthropic-dark"]) & {
      color: #60a5fa;
    }

    .line-prefix,
    .line-content {
      color: #1e40af;

      :global([data-theme="dark"]) &,
      :global([data-theme="anthropic-dark"]) & {
        color: #60a5fa;
      }
    }
  }

  &.add {
    background: #f0fdf4;

    :global([data-theme="dark"]) &,
    :global([data-theme="anthropic-dark"]) & {
      background: #0f1f1a;
    }

    .line-number.new {
      background: #dcfce7;

      :global([data-theme="dark"]) &,
      :global([data-theme="anthropic-dark"]) & {
        background: #1a3528;
      }
    }

    .line-content {
      color: #15803d;

      :global([data-theme="dark"]) &,
      :global([data-theme="anthropic-dark"]) & {
        color: #4ade80;
      }
    }
  }

  &.remove {
    background: #fef2f2;

    :global([data-theme="dark"]) &,
    :global([data-theme="anthropic-dark"]) & {
      background: #2d1417;
    }

    .line-number.old {
      background: #fee2e2;

      :global([data-theme="dark"]) &,
      :global([data-theme="anthropic-dark"]) & {
        background: #421f22;
      }
    }

    .line-content {
      color: #dc2626;

      :global([data-theme="dark"]) &,
      :global([data-theme="anthropic-dark"]) & {
        color: #f87171;
      }
    }
  }

  &.context {
    background: transparent;
  }
}

.line-number {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  width: 50px;
  min-width: 50px;
  padding: 0 8px;
  text-align: right;
  color: var(--text-muted);
  user-select: none;
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.6;

  &.old {
    border-right: 1px solid var(--surface-border);
  }
}

.line-prefix {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  min-width: 18px;
  text-align: center;
  color: var(--text-muted);
  user-select: none;
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.6;
}

.line-content {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  padding: 0 8px;
  min-width: 0;
  color: var(--text-primary);
  line-height: 1.6;
}

.diff-explorer-empty,
.diff-explorer-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
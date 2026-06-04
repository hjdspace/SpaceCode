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
  background: #ffffff;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;

  :global(.dark) & {
    background: #1a1a2e;
  }
}

.diff-explorer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  flex-shrink: 0;

  :global(.dark) & {
    border-bottom-color: #2d3748;
    background: #16213e;
  }
}

.diff-explorer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #1a202c;

  :global(.dark) & {
    color: #e2e8f0;
  }
}

.diff-explorer-subtitle {
  color: #94a3b8;
  font-weight: 400;
  font-size: 11px;

  :global(.dark) & {
    color: #64748b;
  }
}

.diff-explorer-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: #64748b;

  :global(.dark) & {
    color: #94a3b8;
  }
}

.stat-files {
  color: #64748b;

  :global(.dark) & {
    color: #94a3b8;
  }
}

.stat-additions {
  color: #16a34a;
  font-weight: 600;
}

.stat-deletions {
  color: #dc2626;
  font-weight: 600;
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
  border-right: 1px solid #e2e8f0;
  overflow-y: auto;
  background: #f8fafc;
  flex-shrink: 0;

  :global(.dark) & {
    border-right-color: #2d3748;
    background: #16213e;
  }
}

.diff-file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  gap: 8px;
  border-bottom: 1px solid #e2e8f0;
  color: #4a5568;

  :global(.dark) & {
    border-bottom-color: #2d3748;
    color: #94a3b8;
  }

  &:hover {
    background: #e2e8f0;
    color: #1a202c;

    :global(.dark) & {
      background: #2d3748;
      color: #e2e8f0;
    }
  }

  &.selected {
    background: #dbeafe;
    color: #1e40af;
    border-left: 3px solid #3b82f6;

    :global(.dark) & {
      background: #1e3a5f;
      color: #60a5fa;
      border-left-color: #3b82f6;
    }
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
    color: #94a3b8;

    :global(.dark) & {
      color: #64748b;
    }
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
  color: #94a3b8;
  font-style: italic;
  font-size: 10px;

  :global(.dark) & {
    color: #64748b;
  }
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
  background: #ffffff;

  :global(.dark) & {
    background: #1a1a2e;
  }
}

.diff-detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  font-weight: 500;
  font-size: 12px;
  flex-shrink: 0;
  color: #1a202c;

  :global(.dark) & {
    border-bottom-color: #2d3748;
    background: #16213e;
    color: #e2e8f0;
  }
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
  color: #94a3b8;
  font-style: italic;
  font-size: 12px;
  line-height: 1.6;

  :global(.dark) & {
    color: #64748b;
  }

  code {
    background: #f1f5f9;
    padding: 1px 6px;
    border-radius: 3px;
    font-style: normal;
    color: #334155;

    :global(.dark) & {
      background: #2d3748;
      color: #e2e8f0;
    }
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
    background: #f1f5f9;
    color: #1e40af;
    font-weight: 500;

    :global(.dark) & {
      background: #1e293b;
      color: #60a5fa;
    }

    .line-prefix,
    .line-content {
      color: #1e40af;

      :global(.dark) & {
        color: #60a5fa;
      }
    }
  }

  &.add {
    background: #f0fdf4;

    :global(.dark) & {
      background: #0f1f1a;
    }

    .line-number.new {
      background: #dcfce7;

      :global(.dark) & {
        background: #1a3528;
      }
    }

    .line-content {
      color: #15803d;

      :global(.dark) & {
        color: #4ade80;
      }
    }
  }

  &.remove {
    background: #fef2f2;

    :global(.dark) & {
      background: #2d1417;
    }

    .line-number.old {
      background: #fee2e2;

      :global(.dark) & {
        background: #421f22;
      }
    }

    .line-content {
      color: #dc2626;

      :global(.dark) & {
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
  color: #94a3b8;
  user-select: none;
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.6;

  :global(.dark) & {
    color: #64748b;
  }

  &.old {
    border-right: 1px solid #e2e8f0;

    :global(.dark) & {
      border-right-color: #2d3748;
    }
  }
}

.line-prefix {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  min-width: 18px;
  text-align: center;
  color: #94a3b8;
  user-select: none;
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.6;

  :global(.dark) & {
    color: #64748b;
  }
}

.line-content {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  padding: 0 8px;
  min-width: 0;
  color: #334155;
  line-height: 1.6;

  :global(.dark) & {
    color: #cbd5e1;
  }
}

.diff-explorer-empty,
.diff-explorer-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: #94a3b8;
  font-size: 13px;

  :global(.dark) & {
    color: #64748b;
  }
}
</style>
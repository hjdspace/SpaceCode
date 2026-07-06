<template>
  <BashToolCard v-if="toolCall.name === 'Bash'" :tool-call="toolCall" />
  <FileWriteToolCard v-else-if="toolCall.name === 'Write'" :tool-call="toolCall" @open="$emit('open', $event)" />
  <FileEditToolCard v-else-if="toolCall.name === 'Edit'" :tool-call="toolCall" />
  <FileReadToolCard v-else-if="toolCall.name === 'Read'" :tool-call="toolCall" />
  <div v-else class="tool-call-card" :class="[statusClass, { 'is-expanded': isExpanded }]">
    <div class="tool-call-header" @click="toggleExpand">
      <div class="tool-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <Check v-else-if="toolCall.status === 'completed'" :size="14" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <Terminal v-else :size="14" />
      </div>
      <span class="tool-name">{{ displayName }}</span>
      <span v-if="duration" class="tool-duration">{{ duration }}s</span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    
    <div v-show="isExpanded" class="tool-call-details">
      <div class="tool-section">
        <div class="section-label">{{ t('chat.input') }}</div>
        <pre class="code-block"><code>{{ formattedInput }}</code></pre>
      </div>
      
      <div v-if="toolCall.output || hasUnifiedDiff" class="tool-section">
        <div class="section-label">{{ t('chat.output') }}</div>
        <div v-if="hasUnifiedDiff" class="diff-output">
          <div v-for="(file, fileIndex) in unifiedDiffFiles" :key="`${toolCall.id}-${file.path}-${fileIndex}`" class="diff-file">
            <div class="diff-file-header">
              <span class="diff-lang">{{ file.languageTag }}</span>
              <span class="diff-path">{{ file.path }}</span>
              <div class="diff-stats">
                <span v-if="file.additions" class="diff-additions">+{{ file.additions }}</span>
                <span v-if="file.deletions" class="diff-deletions">-{{ file.deletions }}</span>
              </div>
            </div>

            <div class="diff-lines">
              <div
                v-for="(line, lineIndex) in file.lines"
                :key="`${toolCall.id}-${fileIndex}-${lineIndex}`"
                class="diff-line"
                :class="`line-${line.type}`"
              >
                <template v-if="line.type === 'collapsed'">
                  <span class="collapsed-label">{{ t('chat.hiddenLines', { count: line.hiddenCount }) }}</span>
                </template>
                <template v-else>
                  <span class="diff-prefix">{{ linePrefix(line) }}</span>
                  <span class="diff-content">{{ line.content }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>
        <pre v-else class="code-block"><code>{{ formattedOutput }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// 本组件为 design 模式专用（Task 7 MessageItem.events 接入），
// code/work 模式仍走 ToolCallList + tools/*ToolCard 路径。
import type { ToolCall } from '@/types'
import { Loader2, Check, X, Terminal, ChevronDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BashToolCard from './BashToolCard.vue'
import FileWriteToolCard from './FileWriteToolCard.vue'
import FileEditToolCard from './FileEditToolCard.vue'
import FileReadToolCard from './FileReadToolCard.vue'

defineEmits<{ (e: 'open', path: string): void }>()

const { t } = useI18n()

type DiffLineType = 'add' | 'remove' | 'context' | 'hunk' | 'meta' | 'collapsed'

interface ParsedDiffLine {
  type: DiffLineType
  content: string
  hiddenCount?: number
}

interface ParsedDiffFile {
  path: string
  additions: number
  deletions: number
  languageTag: string
  lines: ParsedDiffLine[]
}

const props = defineProps<{
  toolCall: ToolCall
}>()

const isExpanded = ref(false)

const statusClass = computed(() => `status-${props.toolCall.status}`)

// 简化工具名称显示
const displayName = computed(() => {
  const name = props.toolCall.name
  // 移除常见的工具前缀
  return name
    .replace(/^(Read|Edit|Write|Glob|Grep|Bash|Search|CodebaseSearch)_?/i, '')
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim() || name
})

const duration = computed(() => {
  if (!props.toolCall.startTime) return null
  const end = props.toolCall.endTime || Date.now()
  return ((end - props.toolCall.startTime) / 1000).toFixed(1)
})

const unifiedDiffFiles = computed<ParsedDiffFile[]>(() => {
  const diffText = extractDiffText(props.toolCall)
  if (!diffText) return []

  const parsed = parseUnifiedDiff(diffText)
  return parsed.filter(file => file.lines.length > 0)
})

const hasUnifiedDiff = computed(() => unifiedDiffFiles.value.length > 0)

const formattedInput = computed(() => {
  // 简化显示，对于简单输入
  const input = props.toolCall.input
  if (input.path && Object.keys(input).length <= 2) {
    return input.path
  }
  if (input.command && Object.keys(input).length <= 2) {
    return input.command
  }
  if (input.query && Object.keys(input).length <= 2) {
    return input.query
  }
  if (hasUnifiedDiff.value) {
    return 'Patch payload (rendered as unified diff below)'
  }
  return JSON.stringify(input, null, 2)
})

const formattedOutput = computed(() => {
  if (!props.toolCall.output) return ''
  // 截断过长的输出
  const maxLen = 500
  let output = props.toolCall.output
  try {
    const parsed = JSON.parse(output)
    output = JSON.stringify(parsed, null, 2)
  } catch {
    // 保持原样
  }
  if (output.length > maxLen) {
    return output.slice(0, maxLen) + '\n... (truncated)'
  }
  return output
})

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

function linePrefix(line: ParsedDiffLine): string {
  if (line.type === 'add') return '+'
  if (line.type === 'remove') return '-'
  if (line.type === 'context') return ' '
  return ''
}

function extractDiffText(toolCall: ToolCall): string | null {
  const candidates: string[] = []

  if (typeof toolCall.output === 'string') {
    candidates.push(toolCall.output)
  }

  const inputValues = Object.values(toolCall.input || {})
  for (const value of inputValues) {
    if (typeof value === 'string') {
      candidates.push(value)
    }
  }

  for (const candidate of candidates) {
    if (looksLikeUnifiedDiff(candidate)) {
      return candidate
    }
  }

  return null
}

function looksLikeUnifiedDiff(text: string): boolean {
  if (!text) return false
  return /(^|\n)(diff --git |--- |\+\+\+ |@@ |\*\*\* Begin Patch|\*\*\* Update File:)/m.test(text)
}

function parseUnifiedDiff(text: string): ParsedDiffFile[] {
  if (text.includes('*** Begin Patch')) {
    return parseApplyPatchDiff(text)
  }

  const parsedStandard = parseStandardUnifiedDiff(text)
  if (parsedStandard.length > 0) {
    return parsedStandard
  }

  return parseApplyPatchDiff(text)
}

function parseStandardUnifiedDiff(text: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = []
  const lines = text.split(/\r?\n/)
  let current: ParsedDiffFile | null = null

  const pushCurrent = () => {
    if (!current) return
    current.lines = foldContextLines(current.lines)
    files.push(current)
    current = null
  }

  for (const line of lines) {
    const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/)
    if (diffMatch) {
      pushCurrent()
      current = createDiffFile(diffMatch[2])
      continue
    }

    if (line.startsWith('+++ ')) {
      const nextPath = normalizeDiffPath(line.slice(4).trim())
      if (!current) {
        current = createDiffFile(nextPath)
      } else if (nextPath && nextPath !== '/dev/null') {
        current.path = nextPath
        current.languageTag = getLanguageTag(nextPath)
      }
      continue
    }

    if (line.startsWith('--- ')) {
      continue
    }

    if (line.startsWith('@@')) {
      if (!current) {
        current = createDiffFile('Patch')
      }
      current.lines.push({ type: 'hunk', content: line })
      continue
    }

    if (!current) {
      if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
        current = createDiffFile('Patch')
      } else {
        continue
      }
    }

    if (line.startsWith('+')) {
      current.additions += 1
      current.lines.push({ type: 'add', content: line.slice(1) })
      continue
    }

    if (line.startsWith('-')) {
      current.deletions += 1
      current.lines.push({ type: 'remove', content: line.slice(1) })
      continue
    }

    if (line.startsWith(' ')) {
      current.lines.push({ type: 'context', content: line.slice(1) })
      continue
    }

    if (line.trim()) {
      current.lines.push({ type: 'meta', content: line })
    }
  }

  pushCurrent()
  return files
}

function parseApplyPatchDiff(text: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = []
  const lines = text.split(/\r?\n/)
  let current: ParsedDiffFile | null = null

  const pushCurrent = () => {
    if (!current) return
    current.lines = foldContextLines(current.lines)
    files.push(current)
    current = null
  }

  for (const line of lines) {
    const fileHeader = line.match(/^\*\*\* (Update|Add|Delete) File: (.+)$/)
    if (fileHeader) {
      pushCurrent()
      current = createDiffFile(fileHeader[2].trim())
      continue
    }

    if (!current) continue

    if (line.startsWith('@@')) {
      current.lines.push({ type: 'hunk', content: line })
      continue
    }

    if (line.startsWith('+')) {
      current.additions += 1
      current.lines.push({ type: 'add', content: line.slice(1) })
      continue
    }

    if (line.startsWith('-')) {
      current.deletions += 1
      current.lines.push({ type: 'remove', content: line.slice(1) })
      continue
    }

    if (line.startsWith('*** End Patch')) {
      continue
    }

    if (line.startsWith('***')) {
      current.lines.push({ type: 'meta', content: line })
      continue
    }

    current.lines.push({ type: 'context', content: line })
  }

  pushCurrent()
  return files
}

function foldContextLines(lines: ParsedDiffLine[]): ParsedDiffLine[] {
  const collapsed: ParsedDiffLine[] = []
  const maxContextRun = 8
  const keepEdgeContext = 3

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.type !== 'context') {
      collapsed.push(line)
      continue
    }

    let runEnd = i
    while (runEnd < lines.length && lines[runEnd].type === 'context') {
      runEnd += 1
    }

    const runLength = runEnd - i
    if (runLength > maxContextRun) {
      collapsed.push(...lines.slice(i, i + keepEdgeContext))
      collapsed.push({
        type: 'collapsed',
        content: '',
        hiddenCount: runLength - keepEdgeContext * 2
      })
      collapsed.push(...lines.slice(runEnd - keepEdgeContext, runEnd))
    } else {
      collapsed.push(...lines.slice(i, runEnd))
    }

    i = runEnd - 1
  }

  return collapsed
}

function createDiffFile(path: string): ParsedDiffFile {
  const normalizedPath = normalizeDiffPath(path)
  return {
    path: normalizedPath,
    additions: 0,
    deletions: 0,
    languageTag: getLanguageTag(normalizedPath),
    lines: []
  }
}

function normalizeDiffPath(path: string): string {
  return path.replace(/^(a|b)\//, '').trim() || 'Patch'
}

function getLanguageTag(path: string): string {
  const extension = path.split('.').pop()?.toUpperCase() || 'FILE'
  return extension.length <= 4 ? extension : 'FILE'
}
</script>

<style lang="scss" scoped>
.tool-call-card {
  border-radius: 4px;
  background: transparent;
  overflow: hidden;
  transition: all var(--transition-fast);
  font-size: 13px;

  &.is-expanded {
    background: var(--bg-secondary);
    border: 1px solid var(--surface-border);
  }

  &:not(.is-expanded) {
    .tool-call-header:hover {
      background: var(--surface-glass-hover);
    }
  }
}

.tool-call-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  transition: all var(--transition-fast);
}

.tool-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: 0.6;

  .status-running & {
    color: var(--accent-primary);
    opacity: 0.8;
  }

  .status-completed & {
    color: var(--success);
    opacity: 0.7;
  }

  .status-error & {
    color: var(--error);
    opacity: 0.8;
  }
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.tool-name {
  flex: 1;
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 450;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-duration {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  opacity: 0.7;
}

.expand-icon {
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0.5;
  transition: transform var(--transition-fast), opacity var(--transition-fast);

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.tool-call-header:hover .expand-icon {
  opacity: 0.8;
}

.tool-call-details {
  padding: 8px 8px 12px 28px;
  border-top: 1px solid var(--surface-border);
}

.tool-section {
  margin-top: 10px;

  &:first-child {
    margin-top: 0;
  }
}

.section-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.code-block {
  background: var(--surface-glass);
  border-radius: 4px;
  padding: 8px 10px;
  margin: 0;
  font-size: 12px;
  font-family: var(--font-mono);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  border: 1px solid var(--surface-border);
  line-height: 1.5;
}

.diff-output {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.diff-file {
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--surface-glass);
  overflow: hidden;
}

.diff-file-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--bg-secondary);
}

.diff-lang {
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  padding: 4px 5px;
  border-radius: 3px;
  color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  letter-spacing: 0.3px;
}

.diff-path {
  flex: 1;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 12px;
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.diff-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
}

.diff-additions {
  color: var(--success);
}

.diff-deletions {
  color: var(--error);
}

.diff-lines {
  max-height: 320px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.45;
}

.diff-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 1px 10px;
  white-space: pre;
}

.diff-prefix {
  width: 10px;
  flex-shrink: 0;
  color: var(--text-muted);
  user-select: none;
}

.diff-content {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  color: var(--text-secondary);
}

.line-add {
  background: rgba(40, 167, 69, 0.1);

  .diff-prefix,
  .diff-content {
    color: var(--success);
  }
}

.line-remove {
  background: rgba(220, 53, 69, 0.1);

  .diff-prefix,
  .diff-content {
    color: var(--error);
  }
}

.line-hunk {
  background: rgba(77, 166, 255, 0.08);

  .diff-content {
    color: var(--accent-primary);
    font-size: 11px;
  }
}

.line-meta {
  .diff-content {
    color: var(--text-muted);
    font-size: 11px;
  }
}

.line-collapsed {
  justify-content: center;
  padding: 3px 10px;
  background: var(--bg-secondary);
}

.collapsed-label {
  color: var(--text-muted);
  font-size: 11px;
  font-style: italic;
}
</style>

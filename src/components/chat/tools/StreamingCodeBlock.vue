<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import hljs from 'highlight.js'
import { useAppStore } from '@/stores/app'

/**
 * 流式代码块 —— 基于 Beautiful UI Vue「Code Block」视觉方案改造:
 * Agent 产出代码逐行流入带行号的语法高亮块, 流式期间末行显示光标。
 * 原组件为内置演示数据的 demo, 此处改为受控组件接收真实流式内容,
 * 并用项目已有的 highlight.js 替代手写 token 着色。
 */
const props = withDefaults(
  defineProps<{
    code: string
    filePath?: string
    language?: string
    streaming?: boolean
    /** 内容首行对应的真实行号 (Read 分段读取时输出不从文件头开始) */
    startLine?: number
    /** 流式期间可视窗口的最大行数 (长文件只保留末尾, 避免 DOM 爆炸) */
    maxVisibleLines?: number
    /** 完成后展示的最大行数 */
    maxDoneLines?: number
  }>(),
  {
    filePath: '',
    language: '',
    streaming: false,
    startLine: 1,
    maxVisibleLines: 12,
    maxDoneLines: 200,
  },
)

const { t } = useI18n()
const appStore = useAppStore()

const fileName = computed(() => {
  if (!props.filePath) return ''
  const normalized = props.filePath.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
})

const languageLabel = computed(() => {
  const lang = props.language || appStore.getLanguageFromPath(props.filePath)
  return lang ? lang.toUpperCase() : ''
})

/** hljs 高亮整个内容后按 \n 切行, 重新平衡跨行未闭合的 <span>。
 * 流式期间增量更新可达 ~10Hz, 长文件若每次全量 highlight 会拖垮主线程,
 * 因此流式时只高亮末尾窗口(覆盖可视行数), 完成后一次性全量高亮。 */
const highlightedLines = computed(() => {
  const content = props.code
  if (!content) return [] as string[]
  const highlightWindow = props.maxVisibleLines + 16
  const lines = content.split('\n')
  const source = props.streaming && lines.length > highlightWindow
    ? lines.slice(-highlightWindow).join('\n')
    : content
  let html: string
  try {
    const lang = props.language || appStore.getLanguageFromPath(props.filePath)
    if (lang && hljs.getLanguage(lang)) {
      html = hljs.highlight(source, { language: lang }).value
    } else {
      html = hljs.highlightAuto(source).value
    }
  } catch (error) {
    console.error('Highlight error:', error)
    html = escapeHtml(source)
  }
  return splitHighlightedLines(html)
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function splitHighlightedLines(html: string): string[] {
  const lines: string[] = []
  const stack: string[] = []
  let buf = ''
  let i = 0
  while (i < html.length) {
    if (html[i] === '<') {
      const gt = html.indexOf('>', i)
      if (gt === -1) {
        buf += html.slice(i)
        break
      }
      const tag = html.slice(i, gt + 1)
      buf += tag
      if (tag.startsWith('</')) stack.pop()
      else if (!tag.endsWith('/>')) stack.push(tag)
      i = gt + 1
    } else {
      const lt = html.indexOf('<', i)
      const nl = html.indexOf('\n', i)
      const next = lt === -1 ? nl : nl === -1 ? lt : Math.min(lt, nl)
      if (next === -1) {
        buf += html.slice(i)
        i = html.length
      } else if (html[next] === '\n') {
        lines.push(buf + stack.slice().reverse().map(() => '</span>').join(''))
        buf = stack.join('')
        i = next + 1
      } else {
        buf += html.slice(i, next)
        i = next
      }
    }
  }
  lines.push(buf + stack.slice().reverse().map(() => '</span>').join(''))
  return lines
}

/** 真实行数 — 行号窗口与完成后的行数统计以此为准 (流式期间高亮的只是末尾窗口) */
const totalLines = computed(() => (props.code ? props.code.split('\n').length : 0))

const doneLines = computed(() => {
  if (props.streaming) return highlightedLines.value
  return highlightedLines.value.slice(0, props.maxDoneLines)
})

const isWindowed = computed(
  () => props.streaming && doneLines.value.length > props.maxVisibleLines,
)

const visibleLines = computed(() => {
  if (isWindowed.value) return doneLines.value.slice(-props.maxVisibleLines)
  return doneLines.value
})

const startLineNumber = computed(() => {
  const firstVisible = isWindowed.value ? totalLines.value - visibleLines.value.length + 1 : 1
  return props.startLine + firstVisible - 1
})

const isDone = computed(() => !props.streaming)

const scrollBody = ref<HTMLElement | null>(null)
const copied = ref(false)
let copyTimer: number | undefined

watch(
  // 窗口化后 doneLines.length 封顶不再增长, 改看内容长度才能持续跟随滚动
  () => props.code.length,
  async () => {
    if (!props.streaming) return
    await nextTick()
    const el = scrollBody.value
    if (el) el.scrollTop = el.scrollHeight
  },
  { immediate: true },
)

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.code)
  } catch {
    const area = document.createElement('textarea')
    area.value = props.code
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  copied.value = true
  if (copyTimer !== undefined) window.clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    copied.value = false
  }, 1500)
}

onBeforeUnmount(() => {
  if (copyTimer !== undefined) window.clearTimeout(copyTimer)
})
</script>

<template>
  <div class="stream-code">
    <header class="stream-code__header">
      <span class="stream-code__meta">
        <strong v-if="fileName">{{ fileName }}</strong>
        <span v-if="languageLabel">{{ languageLabel }}</span>
        <span v-if="isDone" class="stream-code__count">{{ t('toolCards.codeLines', { count: totalLines }) }}</span>
      </span>
      <button type="button" :aria-label="t('toolCards.codeCopy')" :class="{ 'is-copied': copied }" @click="copyCode">
        <Check v-if="copied" :size="11" />
        <Copy v-else :size="11" />
        {{ copied ? t('toolCards.codeCopied') : t('toolCards.codeCopy') }}
      </button>
    </header>

    <div ref="scrollBody" class="stream-code__body">
      <span
        v-for="(line, idx) in visibleLines"
        :key="startLineNumber + idx"
        class="stream-code__line"
      >
        <span class="stream-code__number">{{ startLineNumber + idx }}</span>
        <span class="stream-code__content">
          <span v-if="line" v-html="line" />
          <i v-if="streaming && idx === visibleLines.length - 1" class="stream-code__caret" />
        </span>
      </span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.stream-code {
  width: 100%;
  overflow: hidden;
  border-radius: 6px;
  border: 1px solid var(--surface-border);
  background: var(--code-bg, #0d1117);
}

.stream-code__header {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px 5px 12px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-glass);
}

.stream-code__meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;

  strong {
    color: var(--code-fg, #c9d1d9);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  > span {
    color: var(--text-disabled);
    font-size: 11px;
    flex-shrink: 0;
  }

  .stream-code__count {
    font-variant-numeric: tabular-nums;
  }
}

.stream-code__header button {
  display: flex;
  height: 22px;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.1s, color 0.1s, transform 0.1s;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }

  &:active {
    transform: scale(0.96);
  }

  &.is-copied {
    color: var(--success);
  }
}

.stream-code__body {
  display: block;
  margin: 0;
  padding: 10px 0;
  overflow: auto;
  max-height: 280px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
}

.stream-code__line {
  display: flex;
  animation: stream-code-line 0.25s cubic-bezier(0.23, 1, 0.32, 1) both;
}

.stream-code__number {
  width: 36px;
  padding-right: 12px;
  flex: 0 0 36px;
  color: var(--text-disabled);
  opacity: 0.7;
  font-size: 10.5px;
  line-height: inherit;
  text-align: right;
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.stream-code__content {
  padding-left: 10px;
  padding-right: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  min-width: 0;
  flex: 1;
  color: var(--code-fg, #c9d1d9);
}

/* highlight.js 主题 (与 WriteToolCard 保持一致的 GitHub Dark 配色) */
.stream-code__content :deep(.hljs-keyword),
.stream-code__content :deep(.hljs-selector-tag) {
  color: #ff7b72;
}
.stream-code__content :deep(.hljs-string),
.stream-code__content :deep(.hljs-regexp) {
  color: #a5d6ff;
}
.stream-code__content :deep(.hljs-title),
.stream-code__content :deep(.hljs-section),
.stream-code__content :deep(.hljs-name),
.stream-code__content :deep(.hljs-selector-id),
.stream-code__content :deep(.hljs-selector-class) {
  color: #d2a8ff;
}
.stream-code__content :deep(.hljs-attribute),
.stream-code__content :deep(.hljs-attr),
.stream-code__content :deep(.hljs-variable),
.stream-code__content :deep(.hljs-template-variable),
.stream-code__content :deep(.hljs-type) {
  color: #79c0ff;
}
.stream-code__content :deep(.hljs-built_in) {
  color: #ffa657;
}
.stream-code__content :deep(.hljs-literal) {
  color: #79c0ff;
}
.stream-code__content :deep(.hljs-comment),
.stream-code__content :deep(.hljs-quote) {
  color: #6a737d;
  font-style: italic;
}
.stream-code__content :deep(.hljs-addition) {
  color: #aff5b4;
}
.stream-code__content :deep(.hljs-deletion) {
  color: #ffd8d3;
}

.stream-code__caret {
  display: inline-block;
  width: 3px;
  height: 12px;
  margin-left: 2px;
  border-radius: 999px;
  background: var(--accent-primary);
  transform: translateY(2px);
  animation: stream-code-caret 1s ease-in-out infinite;
}

@keyframes stream-code-line {
  from {
    opacity: 0;
    transform: translateY(5px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes stream-code-caret {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.25;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stream-code__line {
    animation: none;
  }

  .stream-code__caret {
    animation: none;
  }
}
</style>

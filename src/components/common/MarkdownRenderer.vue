<template>
  <div 
    class="markdown-renderer" 
    v-html="renderedContent" 
    @click="handleLinkClick"
    ref="containerRef"
  ></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import { useAppStore } from '@/stores/app'
import { escapeHtml, replaceMentionChipMarkers } from '@/utils/mention-chips'
import { 
  initializeMermaid, 
  generateMermaidId, 
  createMermaidContainerHtml,
  renderAllMermaidDiagrams 
} from '@/utils/mermaidRenderer'

const containerRef = ref<HTMLElement | null>(null)

const props = defineProps<{
  content: string
}>()

const appStore = useAppStore()

function transformFileLinks(html: string): string {
  const fileExtensions = [
    'ts', 'tsx', 'js', 'jsx', 'vue', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'cc', 'cxx',
    'h', 'hpp', 'v', 'sv', 'svh', 'svi', 'md', 'json', 'yaml', 'yml', 'xml', 'html',
    'css', 'scss', 'less', 'sh', 'bash', 'sql', 'rb', 'php', 'swift', 'kt', 'txt',
    'toml', 'ini', 'cfg', 'conf', 'log', 'gitignore', 'env', 'dockerfile', 'makefile'
  ]

  const extPattern = fileExtensions.join('|')

  // Match a file-ish path:
  //   - optional Windows drive or UNC prefix
  //   - segments separated by / or \
  //   - known extension
  //   - optional ":line" or ":startLine-endLine" suffix
  // We capture the prefix separately so the replacement preserves surrounding text.
  const filePathRegex = new RegExp(
    '(^|[\\s\\(\\[\\{\'"`,;:!?])' +
    '(' +
      '(?:[A-Za-z]:[\\\\/]|\\.{1,2}[\\\\/]|[\\\\/])?' +
      '(?:[\\w.\\-]+[\\\\/])+' +
      '[\\w.\\-]+\\.(?:' + extPattern + ')' +
    ')' +
    '(?::(\\d+)(?:-(\\d+))?)?' +
    '(?=[\\s\\)\\]\\}\'"`,;:!?]|$)',
    'gi'
  )

  // Walk only text nodes; skip existing anchors, code blocks, chips and already-linked spans.
  const container = document.createElement('div')
  container.innerHTML = html

  const SKIP_TAGS = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE'])
  const SKIP_CLASSES = ['mention-chip', 'file-link']

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent: HTMLElement | null = node.parentElement
      while (parent && parent !== container) {
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
        for (const cls of SKIP_CLASSES) {
          if (parent.classList.contains(cls)) return NodeFilter.FILTER_REJECT
        }
        parent = parent.parentElement
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })

  const textNodes: Text[] = []
  let current: Node | null = walker.nextNode()
  while (current) {
    textNodes.push(current as Text)
    current = walker.nextNode()
  }

  for (const node of textNodes) {
    const text = node.nodeValue || ''
    if (!filePathRegex.test(text)) continue
    filePathRegex.lastIndex = 0

    const replaced = text.replace(
      filePathRegex,
      (_match, prefix: string, filePath: string, startLine: string | undefined, endLine: string | undefined) => {
        const displayName = filePath.split(/[\\/]/).pop() || filePath
        const suffix = startLine
          ? (endLine ? `:${startLine}-${endLine}` : `:${startLine}`)
          : ''
        const startAttr = startLine ? ` data-line-number="${startLine}"` : ''
        const endAttr = endLine ? ` data-end-line-number="${endLine}"` : ''
        return `${prefix}<span class="file-link" data-file-path="${escapeHtml(filePath)}"${startAttr}${endAttr} title="${escapeHtml(filePath + suffix)}">${escapeHtml(displayName + suffix)}</span>`
      }
    )

    if (replaced !== text) {
      const template = document.createElement('template')
      template.innerHTML = replaced
      node.replaceWith(template.content)
    }
  }

  return container.innerHTML
}

const renderer = new marked.Renderer()

renderer.code = function(code, language) {
  const lang = language || 'text'
  
  if (lang.toLowerCase() === 'mermaid') {
    const mermaidId = generateMermaidId()
    return createMermaidContainerHtml(code, mermaidId)
  }
  
  const validLang = hljs.getLanguage(lang) ? lang : 'plaintext'
  let highlighted: string
  try {
    highlighted = hljs.highlight(code, { language: validLang }).value
  } catch {
    highlighted = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  return `<pre class="code-block"><code class="hljs language-${lang}">${highlighted}</code></pre>`
}

renderer.heading = function(text, level) {
  const tag = `h${level}`
  return `<${tag} class="md-heading md-h${level}">${text}</${tag}>`
}

renderer.list = function(body, ordered) {
  const tag = ordered ? 'ol' : 'ul'
  return `<${tag} class="md-list">${body}</${tag}>`
}

renderer.paragraph = function(text) {
  return `<p class="md-paragraph">${text}</p>`
}

renderer.blockquote = function(quote) {
  return `<blockquote class="md-blockquote">${quote}</blockquote>`
}

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true
})

// ========== 流式渲染节流 ==========
// 背景: 在长任务(尤其 Linux AppImage)中, props.content 在流式输出期间会
// 被高频更新(每个 text_delta 触发一次). 同步执行 marked.parse + hljs +
// transformFileLinks(创建 <div>/TreeWalker) 会产生 O(N^2) 的 CPU/内存压力,
// 触发 V8 OOM, 导致渲染进程崩溃 (Linux exitCode=133 / SIGTRAP).
// 修复: 通过 rAF + 最小时间间隔节流重渲染, 并将昂贵的文件链接 DOM 遍历
// 推迟到尾随帧执行, 同时保证最终内容与未节流版本完全一致.
const renderedContent = ref('')
const STREAM_RENDER_INTERVAL_MS = 80
let renderScheduled = false
let lastRenderAt = 0
let trailingTimer: number | null = null
let pendingFinalize = false
let isUnmounted = false

function renderMarkdown(content: string, withFileLinks: boolean): string {
  if (!content) return ''
  try {
    const contentWithChips = replaceMentionChipMarkers(content)
    const rendered = marked.parse(contentWithChips) as string
    // 仅在尾随/最终渲染时执行 transformFileLinks: 它需要构造完整的临时 DOM
    // 并遍历所有文本节点, 在流式高频更新中重复执行是渲染进程崩溃的主要诱因.
    return withFileLinks ? transformFileLinks(rendered) : rendered
  } catch {
    return content
  }
}

function performRender(withFileLinks: boolean) {
  if (isUnmounted) return
  lastRenderAt = Date.now()
  renderedContent.value = renderMarkdown(props.content, withFileLinks)
}

function scheduleRender() {
  if (isUnmounted) return
  const now = Date.now()
  const elapsed = now - lastRenderAt

  if (elapsed >= STREAM_RENDER_INTERVAL_MS && !renderScheduled) {
    renderScheduled = true
    // 使用 rAF 把渲染合并到下一帧, 避免 N 次 delta -> N 次 parse.
    requestAnimationFrame(() => {
      renderScheduled = false
      performRender(true)
      // 之后再用一个尾随定时器, 在内容稳定后做一次"完整"渲染(含 file-link).
      armTrailingFinalize()
    })
    return
  }

  // 在节流窗口内: 仅注册尾随渲染, 不立即执行.
  armTrailingFinalize()
}

function armTrailingFinalize() {
  pendingFinalize = true
  if (trailingTimer !== null) return
  trailingTimer = window.setTimeout(() => {
    trailingTimer = null
    if (!pendingFinalize) return
    pendingFinalize = false
    performRender(true)
    // 内容稳定后再尝试渲染 mermaid 图.
    if (!isUnmounted) {
      setTimeout(renderMermaidDiagrams, 0)
    }
  }, STREAM_RENDER_INTERVAL_MS)
}

function isExternalURL(url: string): boolean {
  try {
    if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
      return false
    }
    
    const parsed = new URL(url, window.location.origin)

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false
    }

    // localhost / 127.0.0.1 也在右侧微型浏览器中打开(本地开发预览的主场景)
    return true
  } catch {
    return false
  }
}

function handleLinkClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  
  const fileLink = target.closest('.file-link') as HTMLElement
  if (fileLink) {
    event.preventDefault()
    event.stopPropagation()
    
    const filePath = fileLink.getAttribute('data-file-path')
    const lineNumberStr = fileLink.getAttribute('data-line-number')
    const endLineStr = fileLink.getAttribute('data-end-line-number')
    const lineNumber = lineNumberStr ? parseInt(lineNumberStr, 10) : undefined
    const endLineNumber = endLineStr ? parseInt(endLineStr, 10) : undefined

    if (filePath) {
      appStore.openFile(filePath, lineNumber, endLineNumber)
      return
    }
  }
  
  const anchor = target.tagName === 'A' 
    ? target as HTMLAnchorElement 
    : target.closest('a') as HTMLAnchorElement
  
  if (!anchor) return
  
  const href = anchor.getAttribute('href')
  if (!href) return
  
  if (isExternalURL(href)) {
    event.preventDefault()
    event.stopPropagation()
    
    appStore.openWebview(href)
    
    console.log('[MarkdownRenderer] External link opened in webview:', href)
  }
}

initializeMermaid()

async function renderMermaidDiagrams() {
  if (!containerRef.value) return
  await renderAllMermaidDiagrams(containerRef.value)
}

onMounted(() => {
  // 首次挂载: 立即同步渲染一次(含 file-link), 保证初始内容可点击.
  performRender(true)
  renderMermaidDiagrams()
})

onBeforeUnmount(() => {
  isUnmounted = true
  if (trailingTimer !== null) {
    clearTimeout(trailingTimer)
    trailingTimer = null
  }
})

watch(() => props.content, (newVal, oldVal) => {
  if (newVal === oldVal) return
  scheduleRender()
}, { flush: 'post' })
</script>

<style lang="scss" scoped>
.markdown-renderer {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-primary);
  word-wrap: break-word;
  
  :deep(.md-heading) {
    margin: 16px 0 8px;
    font-weight: 600;
    color: var(--text-primary);
    
    &.md-h1 { font-size: 20px; }
    &.md-h2 { font-size: 18px; }
    &.md-h3 { font-size: 16px; }
    &.md-h4 { font-size: 15px; }
  }
  
  :deep(.md-paragraph) {
    margin: 8px 0;
  }
  
  :deep(.md-list) {
    padding-left: 20px;
    margin: 8px 0;
    
    li {
      margin: 4px 0;
    }
  }
  
  :deep(.md-blockquote) {
    border-left: 3px solid var(--accent-primary);
    padding: 8px 12px;
    margin: 12px 0;
    background: var(--bg-secondary);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    color: var(--text-secondary);
  }
  
  :deep(.code-block) {
    background: var(--code-bg);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    overflow-x: auto;
    margin: 12px 0;

    code {
      font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
      font-size: 13px;
      line-height: 1.5;
      background: transparent;
    }
  }
  
  :deep(p code),
  :deep(li code) {
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 13px;
  }
  
  :deep(strong) {
    font-weight: 600;
    color: var(--text-primary);
  }
  
  :deep(a) {
    color: var(--accent-primary);
    text-decoration: underline;
    
    &:hover {
      color: var(--accent-secondary);
    }
    
    &[href^="http"] {
      position: relative;
      
      &::after {
        content: '↗';
        font-size: 10px;
        margin-left: 3px;
        opacity: 0.6;
      }
      
      &:hover::after {
        opacity: 1;
      }
    }
  }
  
  :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;

    th, td {
      border: 1px solid var(--surface-border);
      padding: 8px 12px;
      text-align: left;
    }

    th {
      background: var(--bg-secondary);
      font-weight: 600;
    }
  }

  :deep(.hljs) {
    color: var(--code-fg);
    background: transparent;
  }
  :deep(.hljs-keyword) { color: var(--code-keyword); }
  :deep(.hljs-string) { color: var(--code-string); }
  :deep(.hljs-number) { color: var(--code-number); }
  :deep(.hljs-comment) { color: var(--code-comment); font-style: italic; }
  :deep(.hljs-function) { color: var(--code-function); }
  :deep(.hljs-title) { color: var(--code-function); }
  :deep(.hljs-params) { color: var(--code-fg); }
  :deep(.hljs-built_in) { color: var(--code-builtin); }
  :deep(.hljs-type) { color: var(--code-builtin); }
  :deep(.hljs-attr) { color: var(--code-attr); }
  :deep(.hljs-variable) { color: var(--code-builtin); }
  :deep(.hljs-literal) { color: var(--code-number); }
  :deep(.hljs-meta) { color: var(--code-meta); }
  :deep(.hljs-tag) { color: var(--code-tag); }
  :deep(.hljs-name) { color: var(--code-tag); }
  :deep(.hljs-selector-class) { color: var(--code-tag); }
  :deep(.hljs-selector-id) { color: var(--code-tag); }
  :deep(.hljs-property) { color: var(--code-attr); }
  :deep(.hljs-punctuation) { color: var(--code-punctuation); }

  :deep(.mention-chip) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    margin: 0 2px;
    background: var(--bg-secondary);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.4;
    vertical-align: baseline;

    .chip-icon {
      font-size: 12px;
      line-height: 1;
      flex-shrink: 0;
    }

    .chip-name {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &.is-folder {
      background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.08);
      border-color: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.3);
      color: var(--accent-primary);
    }
  }

  :deep(.file-link) {
    color: var(--accent-primary);
    text-decoration: underline;
    cursor: pointer;
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
    font-size: 0.95em;
    padding: 0 2px;
    border-radius: 2px;
    transition: all 0.15s ease;

    &:hover {
      color: var(--accent-secondary);
      background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.1);
    }

    &:active {
      background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.15);
      transform: scale(0.98);
    }
  }

  :deep(.mermaid-container) {
    background: var(--code-bg);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 16px;
    margin: 12px 0;
    overflow-x: auto;
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
    font-size: 13px;
    color: var(--text-primary);
    
    &.rendered {
      background: transparent;
      border: none;
      padding: 8px 0;
      overflow: visible;
      
      svg {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 0 auto;
      }
    }
  }

  :deep(.mermaid-error) {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: var(--radius-md);
    padding: 12px;
    color: #ef4444;
    font-size: 13px;
    margin: 12px 0;
  }
}
</style>

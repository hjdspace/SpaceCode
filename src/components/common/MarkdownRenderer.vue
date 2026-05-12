<template>
  <div 
    class="markdown-renderer" 
    v-html="renderedContent" 
    @click="handleLinkClick"
    ref="containerRef"
  ></div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import mermaid from 'mermaid'
import { useAppStore } from '@/stores/app'
import { escapeHtml, replaceMentionChipMarkers } from '@/utils/mention-chips'

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

let mermaidIdCounter = 0

renderer.code = function(code, language) {
  const lang = language || 'text'
  
  if (lang.toLowerCase() === 'mermaid') {
    const mermaidId = `mermaid-${++mermaidIdCounter}`
    return `<div class="mermaid-container" id="${mermaidId}">${escapeHtml(code)}</div>`
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

const renderedContent = computed(() => {
  if (!props.content) return ''

  try {
    const contentWithChips = replaceMentionChipMarkers(props.content)
    const rendered = marked.parse(contentWithChips) as string
    // Run file-link detection after markdown rendering so we can safely skip
    // code blocks, inline code and existing anchors via DOM traversal.
    return transformFileLinks(rendered)
  } catch {
    return props.content
  }
})

function isExternalURL(url: string): boolean {
  try {
    if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
      return false
    }
    
    const parsed = new URL(url, window.location.origin)
    
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false
    }
    
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return false
    }
    
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

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict',
  flowchart: {
    htmlLabels: true
  }
})

async function renderMermaidDiagrams() {
  if (!containerRef.value) return
  
  const containers = containerRef.value.querySelectorAll('.mermaid-container')
  for (const container of containers) {
    try {
      const code = container.textContent || ''
      const { svg } = await mermaid.render(`mermaid-svg-${container.id}`, code)
      container.innerHTML = svg
      container.classList.add('rendered')
    } catch (error) {
      console.error('[MarkdownRenderer] Mermaid render error:', error)
      container.innerHTML = `<div class="mermaid-error">Failed to render mermaid diagram: ${error instanceof Error ? error.message : 'Unknown error'}</div>`
    }
  }
}

onMounted(() => {
  renderMermaidDiagrams()
})

watch(() => props.content, () => {
  setTimeout(renderMermaidDiagrams, 0)
})
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

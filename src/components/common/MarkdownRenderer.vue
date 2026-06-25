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
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
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

// 无扩展名的已知文件名（LLM 常引用但无后缀）
const EXTENSIONLESS_FILES = new Set([
  'Dockerfile', 'Makefile', 'Rakefile', 'Gemfile', 'Vagrantfile',
  'Jenkinsfile', '.gitignore', '.env', '.eslintrc', '.prettierrc',
  '.babelrc', '.npmrc', '.editorconfig', '.stylelintrc', '.npmignore',
  '.tsconfig', '.mocharc', '.nycrc', '.lock', '.gitmodules'
])

function getDisplayName(filePath: string): string {
  const segments = filePath.split(/[\\/]/)
  // 当 basename 可能有歧义时（如 index.ts），显示最后 2 段
  if (segments.length >= 2) {
    return segments.slice(-2).join('/')
  }
  return segments[segments.length - 1] || filePath
}

/**
 * 将 LLM 输出的各种行号格式统一为 `:lineNumber` 后缀，
 * 便于后续正则统一匹配。
 * 支持: "第42行" / "line 42" / "L42" / "(line 42)"
 */
function normalizeLineReferences(text: string): string {
  // "path 第42行" → "path:42"
  text = text.replace(/([\w.\-\\/]+)\s+第(\d+)\s*行/g, '$1:$2')
  // "path (line 42)" → "path:42"
  text = text.replace(/([\w.\-\\/]+)\s+\([Ll]ine\s+(\d+)\)/g, '$1:$2')
  // "path line 42" → "path:42"
  text = text.replace(/([\w.\-\\/]+)\s+[Ll]ine\s+(\d+)/g, '$1:$2')
  // "path L42" → "path:42"（L 后紧跟数字，前面有空格分隔）
  text = text.replace(/([\w.\-\\/]+)\s+L(\d+)\b/g, '$1:$2')
  return text
}

function transformFileLinks(html: string): string {
  const fileExtensions = [
    'ts', 'tsx', 'js', 'jsx', 'vue', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'cc', 'cxx',
    'h', 'hpp', 'v', 'sv', 'svh', 'svi', 'md', 'json', 'yaml', 'yml', 'xml', 'html',
    'css', 'scss', 'less', 'sh', 'bash', 'sql', 'rb', 'php', 'swift', 'kt', 'txt',
    'toml', 'ini', 'cfg', 'conf', 'log', 'gitignore', 'env', 'dockerfile', 'makefile',
    'd.ts', 'd.mts', 'mts', 'mjs', 'cjs', 'cts'
  ]

  // 按长度降序排列，确保正则交替优先匹配更长的扩展名（如 html 先于 h、d.ts 先于 ts），
  // 否则 'interactive.html' 会被截断为 'interactive.h'
  const extPattern = [...fileExtensions]
    .sort((a, b) => b.length - a.length)
    .join('|')
    .replace(/\./g, '\\.')

  // 无扩展名文件正则片段
  const extlessNames = Array.from(EXTENSIONLESS_FILES)
    .map(n => n.replace(/\./g, '\\.'))
    .join('|')

  // 改进后的路径正则:
  //   1. 有前缀的路径（绝对路径 / ./  / ../）+ 已知扩展名或无扩展名文件
  //   2. 裸相对路径（至少1个目录段 + 文件名，如 src/utils/helper.ts）
  //   3. 可选行号后缀 :line 或 :startLine-endLine
  const filePathRegex = new RegExp(
    '(^|[\\s\\(\\[\\{\'"`,;:!?])' +
    '(' +
      // 组A: 有前缀的路径
      '(?:' +
        '(?:[A-Za-z]:[\\\\/]|\\.{1,2}[\\\\/]|[\\\\/])' +
        '(?:[\\w.\\-\\@]+[\\\\/])+' +
        '(?:[\\w.\\-\\@]+\\.(?:' + extPattern + ')|(?:' + extlessNames + '))' +
      ')' +
      '|' +
      // 组B: 裸相对路径（至少1个目录段，如 src/utils/helper.ts）
      '(?:' +
        '(?:[\\w.\\-\\@]+[\\\\/]){1,}' +
        '(?:[\\w.\\-\\@]+\\.(?:' + extPattern + ')|(?:' + extlessNames + '))' +
      ')' +
    ')' +
    '(?::(\\d+)(?:-(\\d+))?)?' +
    '(?=[\\s\\)\\]\\}\'"`,;:!?]|$)',
    'gi'
  )

  // 行内代码路径正则（简化版，用于 <code> 标签内文本）
  const inlineCodePathRegex = new RegExp(
    '(' +
      // 有前缀或裸相对路径
      '(?:(?:[A-Za-z]:[\\\\/]|\\.{1,2}[\\\\/]|[\\\\/])?(?:[\\w.\\-\\@]+[\\\\/])*' +
      '[\\w.\\-\\@]+\\.(?:' + extPattern + '))' +
      '|' +
      '(?:(?:[\\w.\\-\\@]+[\\\\/]){1,}[\\w.\\-\\@]+\\.(?:' + extPattern + '))' +
      '|' +
      '(?:(?:[\\w.\\-\\@]+[\\\\/])+(?:' + extlessNames + '))' +
    ')' +
    '(?::(\\d+)(?:-(\\d+))?)?',
    'gi'
  )

  // Walk text nodes; 区分 <pre><code>（跳过）和单独 <code>（处理）
  const container = document.createElement('div')
  container.innerHTML = html

  const SKIP_TAGS = new Set(['A', 'PRE', 'SCRIPT', 'STYLE'])
  const SKIP_CLASSES = ['mention-chip', 'file-link']

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent: HTMLElement | null = node.parentElement
      let isInInlineCode = false
      while (parent && parent !== container) {
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
        // 单独的 <code>（不在 <pre> 内）允许处理
        if (parent.tagName === 'CODE') {
          isInInlineCode = true
        }
        for (const cls of SKIP_CLASSES) {
          if (parent.classList.contains(cls)) return NodeFilter.FILTER_REJECT
        }
        parent = parent.parentElement
      }
      // 行内代码中的文本节点也接受（使用不同的正则）
      if (isInInlineCode) return NodeFilter.FILTER_ACCEPT
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
    // 判断是否在行内 <code> 中（不在 <pre> 内）
    let isInInlineCode = false
    let isInPre = false
    let parent: HTMLElement | null = node.parentElement
    while (parent && parent !== container) {
      if (parent.tagName === 'CODE') isInInlineCode = true
      if (parent.tagName === 'PRE') isInPre = true
      parent = parent.parentElement
    }
    const inInlineCode = isInInlineCode && !isInPre

    const regex = inInlineCode ? inlineCodePathRegex : filePathRegex
    if (!regex.test(text)) continue
    regex.lastIndex = 0

    const replaced = text.replace(
      regex,
      (_match, p1: string, p2: string, p3: string | undefined, p4: string | undefined) => {
        // 行内代码正则无 prefix 捕获组；普通正则第 1 组是 prefix
        const hasPrefixGroup = !inInlineCode
        const prefix = hasPrefixGroup ? p1 : ''
        const filePath = hasPrefixGroup ? p2 : p1
        const startLine = hasPrefixGroup ? p3 : p2
        const endLine = hasPrefixGroup ? p4 : p3
        const displayName = getDisplayName(filePath)
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
  let lang = language || 'text'

  if (lang.toLowerCase() === 'mermaid') {
    const mermaidId = generateMermaidId()
    return createMermaidContainerHtml(code, mermaidId)
  }

  // Vue SFC 不在 hljs 默认包中，回退到 xml（template/script/style 标签仍能高亮）
  if (lang.toLowerCase() === 'vue' && !hljs.getLanguage('vue')) {
    lang = 'xml'
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
    // 在 Markdown 解析前，将 LLM 输出的各种行号格式统一为 `:lineNumber`
    const normalized = normalizeLineReferences(content)
    const contentWithChips = replaceMentionChipMarkers(normalized)
    const rendered = marked.parse(contentWithChips) as string
    // XSS 防护: 对 marked 输出进行 HTML 净化，保留文件链接所需的自定义属性
    // 同时禁止 <s>/<del>/<strike> 删除线标签，避免 LLM 误用 Markdown/HTML 删除线语法导致正常文本被划线
    const sanitized = DOMPurify.sanitize(rendered, {
      ADD_ATTR: ['data-file-path', 'data-line-number', 'data-end-line-number'],
      FORBID_TAGS: ['s', 'del', 'strike']
    })
    // 仅在尾随/最终渲染时执行 transformFileLinks: 它需要构造完整的临时 DOM
    // 并遍历所有文本节点, 在流式高频更新中重复执行是渲染进程崩溃的主要诱因.
    return withFileLinks ? transformFileLinks(sanitized) : sanitized
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
      // 异步校验文件链接有效性
      setTimeout(validateFileLinks, 100)
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

    // 无效路径不响应点击
    if (fileLink.classList.contains('file-link--invalid')) return
    
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

// 异步校验 file-link 的文件是否存在，标记无效路径
async function validateFileLinks() {
  if (!containerRef.value || !api.readFile) return
  const links = containerRef.value.querySelectorAll('.file-link:not(.file-link--checked)')
  for (const link of links) {
    const filePath = link.getAttribute('data-file-path')
    if (!filePath) continue
    link.classList.add('file-link--checked')
    try {
      const content = await api.readFile(filePath)
      if (content === null) {
        // 尝试拼接项目根路径
        const root = appStore.projectRoot
        if (root && !/^([A-Za-z]:[\\/]|\.?[\\/])/.test(filePath)) {
          const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
          const resolved = root.replace(/[\\/]+$/, '') + sep + filePath
          const content2 = await api.readFile(resolved)
          if (content2 === null) {
            link.classList.add('file-link--invalid')
          }
        } else {
          link.classList.add('file-link--invalid')
        }
      }
    } catch {
      link.classList.add('file-link--invalid')
    }
  }
}

watch(() => props.content, (newVal, oldVal) => {
  if (newVal === oldVal) return
  scheduleRender()
}, { flush: 'post' })
</script>

<style lang="scss" scoped>
.markdown-renderer {
  font-size: var(--font-size-base);
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
      font-family: var(--font-mono);
      font-size: calc(var(--font-size-base) - 1px);
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
    font-family: var(--font-mono);
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

    &.file-link--invalid {
      color: var(--text-secondary);
      text-decoration: none;
      cursor: default;

      &:hover {
        background: none;
        color: var(--text-secondary);
      }
    }
  }

  :deep(.mermaid-container) {
    background: var(--code-bg);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    padding: 16px;
    margin: 12px 0;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: calc(var(--font-size-base) - 1px);
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
    font-size: calc(var(--font-size-base) - 1px);
    margin: 12px 0;
  }
}
</style>

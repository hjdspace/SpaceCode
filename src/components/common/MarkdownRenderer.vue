<template>
  <div
    class="markdown-renderer"
    @click="handleLinkClick"
    ref="containerRef"
  >
    <div v-for="(html, index) in blocks" :key="index" v-html="html"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { marked, type RendererObject, type Tokens } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import { escapeHtml, replaceMentionChipMarkers } from '@/utils/mention-chips'
import {
  generateMermaidId,
  createMermaidContainerHtml,
  renderAllMermaidDiagrams
} from '@/utils/mermaidRenderer'
import {
  resolveImagePath,
  getImageMimeType,
  toDataUrl
} from '@/utils/markdownImagePath'

const containerRef = ref<HTMLElement | null>(null)

const props = defineProps<{
  content: string
  /**
   * 当前 markdown 文件的绝对路径（可选）。
   * 用于解析图片相对路径：渲染后会把本地图片读为 base64 data URL 注入 <img>，
   * 绕过 CSP 对 file: 协议的限制。仅在文件预览场景传入；聊天消息渲染时不传。
   */
  filePath?: string
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

/** 单个文件路径匹配结果（相对所在文本节点起始的字符偏移） */
interface FileLinkMatch {
  start: number
  end: number
  filePath: string
  startLine?: string
  endLine?: string
}

/**
 * 构建路径匹配正则（组件实例级，只构建一次）。
 * 返回两个正则，捕获组布局不同：
 *   filePathRegex:       1=prefix, 2=filePath, 3=startLine, 4=endLine
 *   inlineCodePathRegex: 1=filePath, 2=startLine, 3=endLine
 */
function buildPathRegexes() {
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

  return { filePathRegex, inlineCodePathRegex }
}

/** 在文本中收集全部文件路径匹配（只读，不修改文本）。 */
function collectFileLinkMatches(text: string, regex: RegExp, hasPrefixGroup: boolean): FileLinkMatch[] {
  const matches: FileLinkMatch[] = []
  for (const m of text.matchAll(regex)) {
    const index = m.index ?? 0
    if (hasPrefixGroup) {
      matches.push({
        start: index + m[1].length,
        end: index + m[0].length,
        filePath: m[2],
        startLine: m[3],
        endLine: m[4],
      })
    } else {
      matches.push({
        start: index,
        end: index + m[0].length,
        filePath: m[1],
        startLine: m[2],
        endLine: m[3],
      })
    }
  }
  return matches
}

const renderer: RendererObject = {
  code({ text, lang: language }: Tokens.Code) {
    let lang = language || 'text'

    if (lang.toLowerCase() === 'mermaid') {
      const mermaidId = generateMermaidId()
      return createMermaidContainerHtml(text, mermaidId)
    }

    // Vue SFC 不在 hljs 默认包中，回退到 xml（template/script/style 标签仍能高亮）
    if (lang.toLowerCase() === 'vue' && !hljs.getLanguage('vue')) {
      lang = 'xml'
    }

    const validLang = hljs.getLanguage(lang) ? lang : 'plaintext'
    let highlighted: string
    try {
      highlighted = hljs.highlight(text, { language: validLang }).value
    } catch {
      highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
    return `<pre class="code-block"><code class="hljs language-${lang}">${highlighted}</code></pre>`
  },

  heading({ tokens, depth }: Tokens.Heading) {
    const tag = `h${depth}`
    const text = this.parser.parseInline(tokens)
    return `<${tag} class="md-heading md-h${depth}">${text}</${tag}>`
  },

  list({ items, ordered }: Tokens.List) {
    const body = items.map(item => this.listitem(item)).join('')
    const tag = ordered ? 'ol' : 'ul'
    return `<${tag} class="md-list">${body}</${tag}>`
  },

  listitem({ tokens }: Tokens.ListItem) {
    const text = this.parser.parse(tokens)
    return `<li>${text}</li>`
  },

  paragraph({ tokens }: Tokens.Paragraph) {
    const text = this.parser.parseInline(tokens)
    return `<p class="md-paragraph">${text}</p>`
  },

  blockquote({ tokens }: Tokens.Blockquote) {
    const body = this.parser.parse(tokens)
    return `<blockquote class="md-blockquote">${body}</blockquote>`
  }
}

marked.use({
  renderer,
  gfm: true,
  breaks: true
})

// ========== 文件链接（DOM 级增强） ==========
// v-html 只负责注入净化后的 markdown HTML; file-link 在脏块渲染后的
// nextTick(浏览器绘制前)直接在真实 DOM 上构建。配合块级稳定渲染:
//   1. 内容未变化的块 DOM 完全保留, 其中的链接/hover 态/tooltip/校验标记
//      不被销毁重建 → 修复流式期间 hover 链接持续闪烁;
//   2. 每帧只对新增/变化的脏块做 TreeWalker 遍历与正则匹配, 稳定块零开销,
//      不回归 OOM 修复(ba229c1d);
//   3. 匹配结果按"文本节点内容 + 上下文"缓存(LRU), 持续增长的块(如流式中的
//      列表/表格)内已完成条目 O(1) 命中, 只有尾部新增文本真正执行正则;
//   4. span 通过 DOM API 构建, 文本节点中的字面 '<' 不会被重新解析为 HTML。
const fileLinkMatchCache = new Map<string, FileLinkMatch[]>()
const FILE_LINK_CACHE_MAX = 400
// 已验证不存在的路径: 块重渲染重建 span 时直接恢复 invalid 样式,
// 避免校验结果在"链接蓝→置灰"之间反复闪烁。
// 仅用于样式恢复; validateFileLinks 对这些路径仍会重查 —— AI 会话中
// 文件常在被提及后才被创建, 重查让新建文件的链接恢复可点击。
const knownInvalidPaths = new Set<string>()

const SKIP_TAGS = new Set(['A', 'PRE', 'SCRIPT', 'STYLE'])
const { filePathRegex, inlineCodePathRegex } = buildPathRegexes()

function getCachedMatches(text: string, inInlineCode: boolean): FileLinkMatch[] {
  // 上下文(是否行内代码)决定使用哪个正则, 必须参与缓存键
  const key = (inInlineCode ? 'c\u0000' : 'p\u0000') + text
  const cached = fileLinkMatchCache.get(key)
  if (cached) {
    // LRU: 命中后移到末尾, 淘汰时从最旧的死键(流式尾部的历史版本)开始
    fileLinkMatchCache.delete(key)
    fileLinkMatchCache.set(key, cached)
    return cached
  }
  const matches = collectFileLinkMatches(
    text,
    inInlineCode ? inlineCodePathRegex : filePathRegex,
    !inInlineCode
  )
  fileLinkMatchCache.set(key, matches)
  if (fileLinkMatchCache.size > FILE_LINK_CACHE_MAX) {
    const oldest = fileLinkMatchCache.keys().next().value
    if (oldest !== undefined) fileLinkMatchCache.delete(oldest)
  }
  return matches
}

function buildFileLinkSpan(match: FileLinkMatch): HTMLSpanElement {
  const suffix = match.startLine
    ? (match.endLine ? `:${match.startLine}-${match.endLine}` : `:${match.startLine}`)
    : ''
  const span = document.createElement('span')
  span.className = 'file-link'
  span.title = match.filePath + suffix
  span.textContent = getDisplayName(match.filePath) + suffix
  span.setAttribute('data-file-path', match.filePath)
  if (match.startLine) span.setAttribute('data-line-number', match.startLine)
  if (match.endLine) span.setAttribute('data-end-line-number', match.endLine)
  if (knownInvalidPaths.has(match.filePath)) {
    span.classList.add('file-link--checked', 'file-link--invalid')
  }
  return span
}

/** 对指定块元素内的文本节点应用 file-link 增强(调用方保证只在脏块上调用)。 */
function applyFileLinks(root: HTMLElement) {
  // 收集可处理文本节点: 跳过 <a>/<pre>/<script>/<style>/svg 子树, 以及
  // mention-chip / file-link 内的文本(否则 file-link 显示名会被嵌套包裹)。
  // walker 已拒绝 <pre> 子树, 因此被接受的节点只会处于"行内 <code>"或普通文本两种上下文。
  const textNodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent: HTMLElement | null = node.parentElement
      while (parent && parent !== root) {
        const tag = parent.tagName
        // SVG 元素的 tagName 保留小写; 已渲染的 mermaid 图内文本不处理
        if (SKIP_TAGS.has(tag) || tag === 'svg') return NodeFilter.FILTER_REJECT
        if (parent.classList.contains('mention-chip') || parent.classList.contains('file-link')) {
          return NodeFilter.FILTER_REJECT
        }
        parent = parent.parentElement
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })
  let current: Node | null = walker.nextNode()
  while (current) {
    textNodes.push(current as Text)
    current = walker.nextNode()
  }

  for (const node of textNodes) {
    const text = node.nodeValue || ''
    if (!text) continue

    let isInInlineCode = false
    let parent: HTMLElement | null = node.parentElement
    while (parent && parent !== root) {
      if (parent.tagName === 'CODE') isInInlineCode = true
      parent = parent.parentElement
    }

    const matches = getCachedMatches(text, isInInlineCode)
    if (matches.length === 0) continue

    const fragment = document.createDocumentFragment()
    let cursor = 0
    for (const match of matches) {
      if (match.start > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)))
      }
      fragment.appendChild(buildFileLinkSpan(match))
      cursor = match.end
    }
    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)))
    }
    node.replaceWith(fragment)
  }
}

// ========== 块级稳定渲染 + 流式节流 ==========
// 背景: 在长任务(尤其 Linux AppImage)中, props.content 在流式输出期间会
// 被高频更新(每个 text_delta 触发一次). 同步执行 marked.parse + hljs 会产生
// O(N^2) 的 CPU/内存压力, 触发 V8 OOM, 导致渲染进程崩溃 (Linux exitCode=133 / SIGTRAP).
// 修复: 通过 rAF + 最小时间间隔节流重渲染; 消毒后的 HTML 按顶层块拆分、
// 逐块 v-html —— 内容未变的块 Vue 跳过 patch(v-html 字符串相等), 其 DOM
// (含 file-link/hover/tooltip)原样保留, 每帧只有变化中的尾块被重新 parse
// 与增强; 尾随帧只补充 mermaid/链接校验/图片等异步增强。
const blocks = shallowRef<string[]>([])
const STREAM_RENDER_INTERVAL_MS = 80
let renderScheduled = false
let lastRenderAt = 0
let lastRenderedContent = ''
let pendingDirtyBlocks: number[] = []
let trailingTimer: number | null = null
let pendingFinalize = false
let isUnmounted = false

/**
 * 将 markdown 渲染为「顶层块 HTML 数组」(供逐块 v-html)。
 * 使用 DOMPurify 的 RETURN_DOM_FRAGMENT 直接取净化后的 DOM 按顶层节点切分,
 * 避免为切分引入第二次全量 parse; 顶层空白文本节点不产生盒模型, 直接丢弃。
 */
function renderMarkdownBlocks(content: string): string[] {
  if (!content) return []
  try {
    // 在 Markdown 解析前，将 LLM 输出的各种行号格式统一为 `:lineNumber`
    const normalized = normalizeLineReferences(content)
    const contentWithChips = replaceMentionChipMarkers(normalized)
    const rendered = marked.parse(contentWithChips) as string
    // XSS 防护: 对 marked 输出进行 HTML 净化
    // 同时禁止 <s>/<del>/<strike> 删除线标签，避免 LLM 误用 Markdown/HTML 删除线语法导致正常文本被划线
    // (file-link span 在净化后通过 DOM API 注入, 不经过 v-html 字符串)
    const fragment = DOMPurify.sanitize(rendered, {
      RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ['s', 'del', 'strike']
    })
    const htmls: string[] = []
    for (const node of Array.from(fragment.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue || ''
        if (!text.trim()) continue
        htmls.push(escapeHtml(text))
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        htmls.push((node as Element).outerHTML)
      }
    }
    return htmls
  } catch {
    return [content]
  }
}

function performRender() {
  if (isUnmounted) return
  lastRenderAt = Date.now()
  lastRenderedContent = props.content
  const htmls = renderMarkdownBlocks(props.content)
  const prev = blocks.value
  // 脏块 = 新增或内容变化的顶层块(含中间移位); 其余块的 DOM 原样保留。
  for (let i = 0; i < htmls.length; i++) {
    if (prev[i] !== htmls[i]) pendingDirtyBlocks.push(i)
  }
  blocks.value = htmls
  // v-for 的 DOM patch 在 nextTick flush 中完成, 而浏览器绘制发生在微任务
  // 检查点之后, 因此 file-link 与新内容同帧上屏, 不存在纯文本中间态。
  nextTick(() => {
    if (isUnmounted) return
    enhanceDirtyBlocks()
  })
}

/** 只对脏块(本轮新增/变化的顶层块)应用 file-link 增强, 稳定块零遍历。 */
function enhanceDirtyBlocks() {
  const root = containerRef.value
  if (!root || pendingDirtyBlocks.length === 0) return
  // 容器内仅有 v-for 渲染的块级包装 div, children[i] 与 blocks[i] 一一对应
  const wrappers = root.children
  for (const index of pendingDirtyBlocks) {
    const wrapper = wrappers[index]
    if (wrapper) applyFileLinks(wrapper as HTMLElement)
  }
  pendingDirtyBlocks = []
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
      performRender()
      // 之后再用一个尾随定时器, 在内容稳定后补充异步增强.
      armTrailingFinalize()
    })
    return
  }

  // 在节流窗口内: 仅注册尾随增强, 不立即执行.
  armTrailingFinalize()
}

function armTrailingFinalize() {
  pendingFinalize = true
  if (trailingTimer !== null) {
    clearTimeout(trailingTimer)
  }
  trailingTimer = window.setTimeout(() => {
    trailingTimer = null
    if (!pendingFinalize || isUnmounted) return
    pendingFinalize = false
    // 节流窗口内到达的尾部内容在此补渲染(同样含 file-link, 无闪烁);
    // 内容与上次渲染一致时跳过, 避免重复 parse.
    if (props.content !== lastRenderedContent) {
      performRender()
    }
    // 增强逻辑必须在 DOM patch 与 file-link 就位之后执行;
    // 若上方触发了渲染, 此 nextTick 排在 applyFileLinks 之后.
    nextTick().then(() => {
      if (isUnmounted) return
      renderMermaidDiagrams()
      validateFileLinks()
      resolveLocalImages()
    })
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

async function renderMermaidDiagrams() {
  if (!containerRef.value) return
  await renderAllMermaidDiagrams(containerRef.value)
}

onMounted(() => {
  // 首次挂载: 立即渲染, file-link 在 DOM patch 后的同帧内就位, 初始内容即可点击.
  performRender()
  nextTick().then(() => {
    if (isUnmounted) return
    renderMermaidDiagrams()
    // 首屏链接同样需要校验有效性, 不等第一次内容变更触发尾随帧
    validateFileLinks()
    // 异步解析本地图片相对路径 → base64 data URL
    resolveLocalImages()
  })
})

onBeforeUnmount(() => {
  isUnmounted = true
  if (trailingTimer !== null) {
    clearTimeout(trailingTimer)
    trailingTimer = null
  }
})

// 异步校验 file-link 的文件是否存在，标记无效路径。
// 已判无效的链接不跳过重查: AI 会话中文件常在被提及后才被创建, 文件
// 出现后需撤销置灰恢复可点击。校验只在挂载/尾随帧触发(内容稳定后),
// IPC 频率受节流, 重查开销可忽略。
async function validateFileLinks() {
  if (!containerRef.value || !api.readFile) return
  // 含已置灰的链接: 校验为存在的链接一次后跳过, 无效链接每次重查
  const links = containerRef.value.querySelectorAll('.file-link')
  for (const link of links) {
    const filePath = link.getAttribute('data-file-path')
    if (!filePath) continue
    if (link.classList.contains('file-link--checked') && !link.classList.contains('file-link--invalid')) continue
    link.classList.add('file-link--checked')
    try {
      const content = await api.readFile(filePath)
      let exists = content !== null
      if (!exists) {
        // 尝试拼接项目根路径
        const root = appStore.projectRoot
        if (root && !/^([A-Za-z]:[\\/]|\.?[\\/])/.test(filePath)) {
          const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
          const resolved = root.replace(/[\\/]+$/, '') + sep + filePath
          exists = (await api.readFile(resolved)) !== null
        }
      }
      if (exists) {
        if (knownInvalidPaths.delete(filePath) && containerRef.value) {
          // 此前判无效的文件现已存在(会话期间被创建): 撤销同路径所有链接的置灰
          for (const other of containerRef.value.querySelectorAll('.file-link--invalid')) {
            if (other.getAttribute('data-file-path') === filePath) {
              other.classList.remove('file-link--invalid')
            }
          }
        }
      } else {
        knownInvalidPaths.add(filePath)
        link.classList.add('file-link--invalid')
      }
    } catch {
      knownInvalidPaths.add(filePath)
      link.classList.add('file-link--invalid')
    }
  }
}

/**
 * 异步将本地图片相对路径解析为绝对路径，读取为 base64 data URL 后注入 <img src>。
 *
 * 必要性：marked 默认输出 <img src="./docs/a.png">，浏览器按当前页面 URL 解析
 * 相对路径 → 404；且 index.html 的 CSP `img-src 'self' data: https:` 禁止 file:
 * 协议。通过 readFileAsBase64 把本地图片转 data URL 注入，可同时解决这两个问题。
 *
 * 幂等性：用 data-img-resolved 属性标记已处理的 img，避免重复 IPC 调用。
 * 每次 v-html 重新渲染会清空标记，需重新处理（内容可能已变）。
 */
async function resolveLocalImages() {
  if (!containerRef.value) return
  // 无 readFileAsBase64 API（如 H5 模式未适配）时跳过，保留原 src
  if (!api.readFileAsBase64) return

  const imgs = containerRef.value.querySelectorAll('img:not([data-img-resolved])')
  if (imgs.length === 0) return

  await Promise.all(Array.from(imgs).map(async (img) => {
    const src = img.getAttribute('src')
    // 无论能否处理都标记，避免重复扫描
    img.setAttribute('data-img-resolved', '1')
    if (!src) return

    const absPath = resolveImagePath(props.filePath, src)
    if (!absPath) return // 远程 URL / 锚点 / 无 filePath 的相对路径：交由浏览器处理

    try {
      let base64 = await api.readFileAsBase64(absPath)
      let resolvedPath = absPath

      // 回退：若 src 是相对路径且 markdown 目录解析失败，尝试相对 projectRoot
      if (base64 === null) {
        const root = appStore.projectRoot
        // 检查原始 src 是否为相对路径（resolveImagePath 已将 URL/锚点过滤为 null 并 return，
        // 这里只需排除绝对路径）。absPath 已是绝对路径，不能用作判断依据。
        const isRelativeSrc = !/^[A-Za-z]:[\\/]/.test(src) && !src.startsWith('/')
        if (root && isRelativeSrc) {
          const rel = src.trim().replace(/^\.\//, '').replace(/\\/g, '/')
          const rootResolved = (root.replace(/[\\/]+$/, '') + '/' + rel).replace(/\\/g, '/')
          const b2 = await api.readFileAsBase64(rootResolved)
          if (b2 !== null) {
            base64 = b2
            resolvedPath = rootResolved
          }
        }
      }

      if (base64 !== null) {
        const mime = getImageMimeType(resolvedPath)
        img.setAttribute('src', toDataUrl(mime, base64))
      }
    } catch {
      // 读取失败：保留原 src（可能显示 broken icon）
    }
  }))
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
    // 不加 transition: 流式期间变化中的尾块仍会整块重建, 过渡动画每帧重启
    // 会造成 hover 色/背景持续脉动闪烁; 即时切换样式在视觉上保持稳定.

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

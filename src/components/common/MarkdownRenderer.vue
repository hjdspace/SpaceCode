<template>
  <div 
    class="markdown-renderer" 
    v-html="renderedContent" 
    @click="handleLinkClick"
  ></div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import { useAppStore } from '@/stores/app'

const props = defineProps<{
  content: string
}>()

const appStore = useAppStore()

const renderer = new marked.Renderer()

renderer.code = function(code, language) {
  const lang = language || 'text'
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
    return marked.parse(props.content) as string
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
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    overflow-x: auto;
    margin: 12px 0;

    code {
      font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', Consolas, monospace;
      font-size: 13px;
      line-height: 1.5;
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
    color: #c9d1d9;
    background: #0d1117;
  }
  :deep(.hljs-keyword) { color: #ff7b72; }
  :deep(.hljs-string) { color: #a5d6ff; }
  :deep(.hljs-number) { color: #79c0ff; }
  :deep(.hljs-comment) { color: #8b949e; font-style: italic; }
  :deep(.hljs-function) { color: #d2a8ff; }
  :deep(.hljs-title) { color: #d2a8ff; }
  :deep(.hljs-params) { color: #c9d1d9; }
  :deep(.hljs-built_in) { color: #ffa657; }
  :deep(.hljs-type) { color: #ffa657; }
  :deep(.hljs-attr) { color: #79c0ff; }
  :deep(.hljs-variable) { color: #ffa657; }
  :deep(.hljs-literal) { color: #79c0ff; }
  :deep(.hljs-meta) { color: #8b949e; }
  :deep(.hljs-tag) { color: #7ee787; }
  :deep(.hljs-name) { color: #7ee787; }
  :deep(.hljs-selector-class) { color: #7ee787; }
  :deep(.hljs-selector-id) { color: #7ee787; }
  :deep(.hljs-property) { color: #79c0ff; }
  :deep(.hljs-punctuation) { color: #c9d1d9; }
}
</style>
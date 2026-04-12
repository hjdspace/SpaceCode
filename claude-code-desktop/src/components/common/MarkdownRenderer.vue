<template>
  <div class="markdown-renderer" v-html="renderedContent"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'

const props = defineProps<{
  content: string
}>()

const renderer = new marked.Renderer()

renderer.code = function(code, language) {
  const lang = language || 'text'
  const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<pre class="code-block"><code class="language-${lang}">${escaped}</code></pre>`
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
      color: var(--text-primary);
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
}
</style>
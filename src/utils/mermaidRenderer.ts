// 全局唯一的 mermaid ID 计数器
let mermaidIdCounter = 0
let mermaidPromise: Promise<(typeof import('mermaid'))['default']> | null = null

function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'strict',
        flowchart: {
          htmlLabels: true
        }
      })
      return mermaid
    })
  }
  return mermaidPromise
}

// 初始化 mermaid
export async function initializeMermaid() {
  await getMermaid()
}

// 生成唯一的 mermaid 容器 ID
export function generateMermaidId(): string {
  return `mermaid-${++mermaidIdCounter}`
}

// 创建 mermaid 容器 HTML
export function createMermaidContainerHtml(code: string, id: string): string {
  return `<div class="mermaid-container" id="${id}">${escapeHtml(code)}</div>`
}

// 渲染单个 mermaid 图表
export async function renderMermaidDiagram(container: HTMLElement, id: string): Promise<void> {
  try {
    const mermaid = await getMermaid()
    const code = container.textContent || ''
    const { svg } = await mermaid.render(`mermaid-svg-${id}`, code)
    container.innerHTML = svg
    container.classList.add('rendered')
  } catch (error) {
    console.error('[MermaidRenderer] Render error:', error)
    container.innerHTML = `<div class="mermaid-error">Failed to render mermaid diagram: ${error instanceof Error ? error.message : 'Unknown error'}</div>`
  }
}

// 渲染容器内的所有 mermaid 图表
export async function renderAllMermaidDiagrams(container: HTMLElement): Promise<void> {
  const mermaidContainers = container.querySelectorAll('.mermaid-container:not(.rendered)') as NodeListOf<HTMLElement>

  if (mermaidContainers.length === 0) return

  for (const mermaidContainer of mermaidContainers) {
    const id = mermaidContainer.id
    await renderMermaidDiagram(mermaidContainer, id)
  }
}

// 辅助函数：转义 HTML
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

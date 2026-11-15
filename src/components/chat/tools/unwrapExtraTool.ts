import type { ToolCall } from '@/types'

/**
 * 内置生图 MCP 的完整工具名。与 TOOL_COMPONENT_MAP / PROMOTED_TOOL_NAMES 同源，
 * 由 tests/imagegen-tool-card-registration.test.ts 钉住与主进程常量一致。
 */
export const IMAGEGEN_TOOL_FULL_NAMES = [
  'mcp__spacecode-imagegen__generate_image',
  'mcp__spacecode-imagegen__edit_image',
  'mcp__spacecode-imagegen__generate_batch',
] as const

const IMAGEGEN_NAME_SET: ReadonlySet<string> = new Set(IMAGEGEN_TOOL_FULL_NAMES)

export function isImageGenToolName(name: unknown): name is string {
  return typeof name === 'string' && IMAGEGEN_NAME_SET.has(name)
}

interface TextBlock {
  type: string
  text: string
}

function isTextBlock(block: unknown): block is TextBlock {
  return (
    !!block &&
    typeof block === 'object' &&
    (block as TextBlock).type === 'text' &&
    typeof (block as TextBlock).text === 'string'
  )
}

/**
 * 把 ExecuteExtraTool 的 `{result:[{type:'text',text}]}` 外壳剥成内层文本 ——
 * 生图工具自身的 JSON（成功）或错误原文（失败）。不是包裹形状就原样返回，
 * 交给卡片按整次失败处理。
 */
function unwrapResultText(output?: string): string | undefined {
  if (!output) return output
  try {
    const parsed = JSON.parse(output) as { result?: unknown }
    if (Array.isArray(parsed?.result)) {
      const texts = parsed.result.filter(isTextBlock).map(block => block.text)
      if (texts.length) return texts.join('\n')
    }
  } catch {
    // 整次失败时输出可能是纯文本，解析不动就保留原文。
  }
  return output
}

/**
 * Claude Code 引擎把生图 MCP 工具藏在 ToolSearch 后面：真实 tool_use 名是
 * `ExecuteExtraTool`，真工具名在 `input.tool_name`、参数在 `input.params`、
 * 结果包在 `output.result[].text` 里。渲染层必须先还原成生图工具本身，
 * 折叠分组（PROMOTED）、卡片解析（TOOL_COMPONENT_MAP）与卡片入参才能命中 ——
 * 否则用户只看到「1 个工具调用」，图片被吞进折叠组（#113 后续实测缺陷）。
 *
 * 非生图的 ExecuteExtraTool 与其它工具原样返回，不影响通用额外工具卡片。
 */
export function unwrapExtraToolCall(tool: ToolCall): ToolCall {
  if (tool.name !== 'ExecuteExtraTool') return tool
  const target: unknown = tool.input?.tool_name
  if (!isImageGenToolName(target)) return tool
  const params = tool.input?.params as Record<string, unknown> | undefined
  return {
    ...tool,
    name: target,
    input: params && typeof params === 'object' ? params : {},
    output: unwrapResultText(tool.output),
  }
}
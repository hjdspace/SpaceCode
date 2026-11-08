// src/stores/turn/eventHandlers/helpers.ts
// 无状态纯函数：协议帧解析、部分 JSON 解码、交付物路径提取。
// 原先与 createEventHandlers 同文件，拆分后独立成模块。

import { FILE_TOOLS, COMMAND_TOOLS, MAX_INMEMORY_TOOL_OUTPUT } from '../types'
import { isAutoPreviewPath } from '@/utils/artifactFormat'
import { normalizeAbsolutePath } from '@/utils/normalizePath'

/** Synthetic assistant records emitted by the engine for retryable API errors. */
export function isSyntheticApiErrorAssistant(assistant: any): boolean {
  if (assistant?.isApiErrorMessage === true) return true
  const content = assistant?.message?.content
  if (typeof content === 'string') return /^\s*API Error:/i.test(content)
  return Array.isArray(content) && content.length > 0 && content.every((block: any) =>
    block?.type === 'text' && typeof block.text === 'string' && /^\s*API Error:/i.test(block.text),
  )
}

export function remoteUserContent(data: any): string {
  if (typeof data?.content === 'string') return data.content
  const blocks = data?.message?.content
  if (Array.isArray(blocks)) {
    return blocks
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('')
  }
  return ''
}

/**
 * 解码部分 JSON 字符串值（值可能尚未传输完毕）。
 * 优先直接 JSON.parse；仅当值末尾挂着不完整的转义序列（落单的反斜杠、
 * 未满 4 位的 \uXX）导致解析失败时，剪掉后重试。
 * Write 工具的代码以 \n 等转义形式传输，必须完整反转义才能按行流式渲染。
 */
function decodePartialJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`)
  } catch {
    let s = raw
    let end = s.length
    while (end > 0 && s[end - 1] === '\\') end--
    if ((s.length - end) % 2 === 1) {
      s = s.slice(0, -1)
    } else {
      s = s.replace(/\\u[0-9a-fA-F]{0,3}$/, '')
    }
    try {
      return JSON.parse(`"${s}"`)
    } catch {
      return s
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
    }
  }
}

/**
 * 路径字段只能取引号闭合的完整值。流式分片可能停在任意字符上（例如
 * `src/composables/__`），而会话文件归属会把第一次看到的路径当成最终路径；
 * 半截值一旦进了 input，后续补全不会改变「有路径的写调用数」，悬浮条就会
 * 一直显示截断的文件名。content / command 等纯展示字段仍允许半截值。
 */
const EARLY_INPUT_COMPLETE_ONLY_FIELDS = new Set(['file_path', 'path'])

/**
 * 从部分 JSON 字符串中尝试提取关键工具输入字段（file_path / path / command / query / pattern / url / content），
 * 让 UI 能在 LLM 流式生成工具参数时就显示工具目标与流式代码块。
 * 支持两种匹配模式：
 * 1. 完整字符串值（引号已闭合）：`"file_path": "/path/to/file.html"`
 * 2. 部分字符串值（引号尚未闭合）：`"content": "const x = 1`
 */
export function tryExtractEarlyInput(partialJson: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {}
  let found = false

  // content 为 Write/FileWrite 的代码本体，纳入早期提取驱动逐行流式渲染
  const fields = ['file_path', 'path', 'command', 'query', 'pattern', 'url', 'content']
  for (const field of fields) {
    // 先尝试匹配引号闭合的完整值
    const closedRegex = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)
    const closedMatch = partialJson.match(closedRegex)
    if (closedMatch) {
      result[field] = decodePartialJsonString(closedMatch[1])
      found = true
      continue
    }

    if (EARLY_INPUT_COMPLETE_ONLY_FIELDS.has(field)) continue

    // 再尝试匹配引号尚未闭合的部分值（值正在流式传输中）。
    // 末尾可选的裸反斜杠容纳「转义序列只传了一半」的瞬间（如 "abc\ ），
    // 由 decodePartialJsonString 剪掉后解码。
    const partialRegex = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*\\\\?)$`)
    const partialMatch = partialJson.match(partialRegex)
    if (partialMatch) {
      result[field] = decodePartialJsonString(partialMatch[1])
      found = true
    }
  }

  return found ? result : null
}

/**
 * pi 的 tool_execution_update 带的是 partialResult 快照，不是增量：
 * bash 形如 { content: [{ type: 'text', text }], details }。取文本供卡片流式展示。
 */
export function partialToolResultText(result: any): string {
  if (result === undefined || result === null) return ''
  if (typeof result === 'string') return result
  if (typeof result.content === 'string') return result.content
  if (Array.isArray(result.content)) {
    return result.content
      .map((block: any) => (block?.type === 'text' ? String(block.text ?? '') : ''))
      .join('')
  }
  if (typeof result.text === 'string') return result.text
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

/**
 * 实时工具输出是「最新快照」，超上限时必须保留尾部。
 * 头部截断会让运行中的终端在输出超过上限后永久冻结在早期内容上 ——
 * 引擎仍在推新快照，界面却一个字都不再变化。
 */
export function truncateLiveToolOutput(text: string): string {
  if (text.length <= MAX_INMEMORY_TOOL_OUTPUT) return text
  const tail = text.slice(-MAX_INMEMORY_TOOL_OUTPUT)
  const firstNewline = tail.indexOf('\n')
  const aligned = firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail
  return '[Output truncated to the most recent output]\n' + aligned
}

/**
 * 从工具输入里提取值得自动预览的交付物绝对路径（无则 null）。
 *
 * Write/Edit 看 file_path / path；Bash 解析 officecli 命令的目标文档
 * （`officecli <verb> <file>`，路径允许带引号）。相对路径按会话工作目录补全。
 * 只有命中 isAutoPreviewPath（office 四件套 + html）的路径才算交付物。
 */
const OFFICE_CMD_TARGET_RE =
  /officecli(?:\.exe)?\s+[a-z-]+\s+"?([^"\n]+?\.(?:xlsx|docx|pptx|pdf|html?))"?/i

export function extractAutoPreviewTarget(
  toolName: string,
  input: any,
  workingDir?: string
): string | null {
  if (!input) return null
  let raw: string | undefined
  if (FILE_TOOLS.has(toolName)) {
    raw = typeof input.file_path === 'string' ? input.file_path : undefined
    if (!raw && typeof input.path === 'string') raw = input.path
  } else if (COMMAND_TOOLS.has(toolName) && typeof input.command === 'string') {
    raw = input.command.match(OFFICE_CMD_TARGET_RE)?.[1]
  }
  if (!raw) return null

  const target = raw.trim().replace(/^["']|["']$/g, '')
  if (!target || !isAutoPreviewPath(target)) return null

  const isAbsolute = /^[a-zA-Z]:[/\\]/.test(target) || target.startsWith('\\\\') || target.startsWith('/')
  const fullPath = isAbsolute ? target : workingDir ? `${workingDir}/${target}` : null
  if (!fullPath) return null
  return normalizeAbsolutePath(fullPath)
}

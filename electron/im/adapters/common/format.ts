/**
 * Format — Message formatting utilities for IM platforms
 *
 * - splitMessage: Split long text by paragraph → newline → period → space → hard cut
 * - convertMarkdownTablesToBullets: Convert GFM tables to bullet lists
 * - formatToolUse: Format tool usage for display
 * - formatPermissionRequest: Format permission request for display
 * - formatImHelp: Format help text for IM commands
 * - formatImStatus: Format session status for display
 */

import type { ServerMessage } from './types'

// ──────────────────────────────────────────────────────────────────────────
// splitMessage
// ──────────────────────────────────────────────────────────────────────────

/**
 * Split a long text into chunks that fit within IM platform limits.
 * Priority: paragraph → newline → period → space → hard cut
 */
export function splitMessage(text: string, maxLen: number = 4096): string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > maxLen) {
    let splitIdx = -1

    // 1. Try paragraph break (double newline)
    const paraIdx = remaining.lastIndexOf('\n\n', maxLen)
    if (paraIdx > maxLen * 0.3) {
      splitIdx = paraIdx + 2
    }

    // 2. Try single newline
    if (splitIdx === -1) {
      const nlIdx = remaining.lastIndexOf('\n', maxLen)
      if (nlIdx > maxLen * 0.3) {
        splitIdx = nlIdx + 1
      }
    }

    // 3. Try period (sentence boundary)
    if (splitIdx === -1) {
      const periodIdx = remaining.lastIndexOf('. ', maxLen)
      if (periodIdx > maxLen * 0.3) {
        splitIdx = periodIdx + 2
      }
    }

    // 4. Try space
    if (splitIdx === -1) {
      const spaceIdx = remaining.lastIndexOf(' ', maxLen)
      if (spaceIdx > maxLen * 0.3) {
        splitIdx = spaceIdx + 1
      }
    }

    // 5. Hard cut
    if (splitIdx === -1) {
      splitIdx = maxLen
    }

    chunks.push(remaining.slice(0, splitIdx).trim())
    remaining = remaining.slice(splitIdx).trim()
  }

  if (remaining) {
    chunks.push(remaining)
  }

  return chunks.filter(Boolean)
}

// ──────────────────────────────────────────────────────────────────────────
// convertMarkdownTablesToBullets
// ──────────────────────────────────────────────────────────────────────────

const FENCED_CODE_RE = /```[\s\S]*?```/g
const TABLE_RE = /^\|(.+)\|\s*\n\|[-:\s|]+\|\s*\n((?:\|.*\|\s*\n?)+)/gm

/**
 * Convert GFM markdown tables to bullet lists.
 * Skips tables inside fenced code blocks.
 */
export function convertMarkdownTablesToBullets(text: string): string {
  // Extract code blocks to protect them
  const codeBlocks: string[] = []
  let protected_ = text.replace(FENCED_CODE_RE, (match) => {
    codeBlocks.push(match)
    return `\x00CODEBLOCK${codeBlocks.length - 1}\x00`
  })

  // Convert tables to bullets
  protected_ = protected_.replace(TABLE_RE, (_match, headerRow: string, bodyRows: string) => {
    const headers = headerRow.split('|').map((h: string) => h.trim()).filter(Boolean)
    const rows = bodyRows.trim().split('\n').filter((r: string) => r.trim())

    let result = ''
    headers.forEach((h: string) => {
      result += `**${h}**: `
    })
    result = result.trimEnd() + '\n'

    for (const row of rows) {
      const cells = row.split('|').map((c: string) => c.trim()).filter(Boolean)
      const parts: string[] = []
      headers.forEach((h: string, i: number) => {
        if (cells[i]) {
          parts.push(`${h}: ${cells[i]}`)
        }
      })
      result += `• ${parts.join(' | ')}\n`
    }

    return result
  })

  // Restore code blocks
  protected_ = protected_.replace(/\x00CODEBLOCK(\d+)\x00/g, (_match, idx: string) => {
    return codeBlocks[parseInt(idx, 10)]
  })

  return protected_
}

// ──────────────────────────────────────────────────────────────────────────
// formatToolUse
// ──────────────────────────────────────────────────────────────────────────

export function formatToolUse(toolName: string, input: Record<string, unknown>): string {
  const inputPreview = Object.entries(input)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 100) : JSON.stringify(v)?.slice(0, 100)}`)
    .join(', ')

  return `🔧 ${toolName}(${inputPreview})`
}

// ──────────────────────────────────────────────────────────────────────────
// formatPermissionRequest
// ──────────────────────────────────────────────────────────────────────────

export function formatPermissionRequest(
  toolName: string,
  input: Record<string, unknown>,
  description?: string
): string {
  const inputStr = Object.entries(input)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 200) : JSON.stringify(v)?.slice(0, 200)}`)
    .join('\n')

  const desc = description ? `\n📝 ${description}` : ''

  return `🔐 权限请求\n\n工具: ${toolName}${desc}\n\n参数:\n${inputStr}\n\n回复:\n1️⃣ 允许  2️⃣ 永久允许  3️⃣ 拒绝`
}

// ──────────────────────────────────────────────────────────────────────────
// formatImHelp
// ──────────────────────────────────────────────────────────────────────────

export interface ImCommand {
  command: string
  description: string
}

const DEFAULT_COMMANDS: ImCommand[] = [
  { command: '/new', description: '创建新会话' },
  { command: '/projects', description: '列出并切换项目' },
  { command: '/status', description: '查看当前会话状态' },
  { command: '/stop', description: '停止生成' },
  { command: '/clear', description: '清空上下文' },
  { command: '/resume', description: '恢复历史会话' },
  { command: '/provider', description: '切换 LLM Provider' },
  { command: '/model', description: '切换模型' },
  { command: '/skills', description: '列出技能' },
  { command: '/help', description: '显示帮助' },
]

export function formatImHelp(commands: ImCommand[] = DEFAULT_COMMANDS): string {
  const lines = commands.map((c) => `  ${c.command.padEnd(12)} ${c.description}`)
  return `📋 可用命令\n\n${lines.join('\n')}`
}

// ──────────────────────────────────────────────────────────────────────────
// formatImStatus
// ──────────────────────────────────────────────────────────────────────────

export function formatImStatus(
  state: string,
  sessionId: string,
  workDir?: string,
  title?: string
): string {
  const stateEmoji: Record<string, string> = {
    idle: '💤',
    thinking: '💭',
    streaming: '✍️',
    tool_executing: '🔧',
    permission_pending: '🔐',
    compacting: '📦',
  }

  const emoji = stateEmoji[state] ?? '❓'
  const lines = [
    `${emoji} 会话状态: ${state}`,
    `🆔 Session: ${sessionId.slice(0, 8)}...`,
  ]

  if (title) lines.push(`📝 标题: ${title}`)
  if (workDir) lines.push(`📁 目录: ${workDir}`)

  return lines.join('\n')
}

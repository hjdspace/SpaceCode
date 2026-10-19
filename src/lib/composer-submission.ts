/**
 * 提交决策 —— 把"编辑器此刻的全部事实"映射成"composer 该做什么"。
 *
 * DOM 读取、store 写入、emit 都留在调用方（ChatInput），这里只做分支判断，
 * 因此每一条分支都能穷举测试。分支语义与抽取前的 ChatInput.handleSend 逐字对齐：
 * AI 回复期间的排队/插话、command-chip 的三种派发、直接输入斜杠的三种派发。
 */
import { dispatchCommandChip, resolveDirectSlash, type CommandChipData } from '@/lib/message-input-logic'
import type { AllAttachments, SendOptions } from '@/composables/types'

export interface ComposerSubmissionInput {
  /** 编辑器纯文本（chip 已序列化为 /cmd:"name":kind:source marker），已 trim */
  content: string
  /** 引用附件序列化出的 blockquote 文本，无引用时为空串 */
  quoteBlock: string
  /** 已由编辑器收集好的附件：files 来自内联 mention chip，images 来自附件列表 */
  attachments: AllAttachments
  /** 编辑器里的命令 chip，按 DOM 顺序 */
  chips: CommandChipData[]
  isSending: boolean
  /** Ctrl/Cmd+Enter：回复期间立即插话而不是排队 */
  steerMode: boolean
  disabled: boolean
  /** 斜杠命令面板或 @ 上下文菜单正开着，Enter 属于菜单而不是发送 */
  menuOpen: boolean
  hasContent: boolean
  sessionId: string | null
}

export type ComposerSubmission =
  | { kind: 'none' }
  | { kind: 'send'; content: string; attachments: AllAttachments; options?: SendOptions }
  | { kind: 'slash'; command: string; args: string; attachments: AllAttachments; displayLabel?: string }
  | { kind: 'queue'; content: string; attachments: AllAttachments; displayLabel: string }

/** 引用块作为正文前缀；两者都为空时返回空串 */
export function composeSendContent(content: string, quoteBlock: string): string {
  if (!quoteBlock) return content
  return content ? `${quoteBlock}\n\n${content}` : quoteBlock
}

const CHIP_MARKER_RE = /\/cmd:"[^"]+":\w+:\w+\s*/g

/** 剥掉 chip marker，剩下用户真正提的诉求 */
export function stripChipMarkers(content: string): string {
  return content.replace(CHIP_MARKER_RE, '').trim()
}

function chipMarkerOf(chip: CommandChipData): string {
  // marker 里的命令名不带前导斜杠，与 useContentEditor.serializeCommandChip 一致
  return `/cmd:"${chip.label}":${chip.kind}:${chip.source}`
}

/** 已插入 chip 的提交：单枚 immediate/sdk 命令直接派发，其余展开成提示词后发送 */
function resolveFromChips(chips: CommandChipData[], content: string, attachments: AllAttachments): ComposerSubmission {
  const userContent = stripChipMarkers(content)
  const [only] = chips

  if (chips.length === 1 && (only.kind === 'sdk_command' || only.kind === 'immediate')) {
    const marker = chipMarkerOf(only)
    return {
      kind: 'slash',
      command: only.label,
      args: userContent,
      attachments,
      displayLabel: userContent ? `${marker} ${userContent}` : marker,
    }
  }

  const result = dispatchCommandChip(chips, userContent)
  return { kind: 'send', content: result.prompt, attachments, options: { displayLabel: result.displayLabel } }
}

/** 没插 chip、但直接敲了 "/command args" 的提交 */
function resolveFromDirectSlash(content: string, sendContent: string, attachments: AllAttachments): ComposerSubmission {
  const slashResult = resolveDirectSlash(content)

  if (slashResult.action === 'immediate_command') {
    const commandName = content.slice(1).split(/\s+/)[0]
    return { kind: 'slash', command: commandName, args: content.slice(1 + commandName.length).trim(), attachments }
  }

  const chip = slashResult.action === 'insert_chip' ? slashResult.chip : undefined
  if (chip) {
    const commandArgs = content.slice(1 + chip.label.length).trim()
    // sdk 命令与 chip 路径行为一致：作为斜杠命令派发（如 /goal <objective>）
    if (chip.kind === 'sdk_command') {
      return { kind: 'slash', command: chip.label, args: commandArgs, attachments }
    }
    const result = dispatchCommandChip([chip], commandArgs)
    return { kind: 'send', content: result.prompt, attachments, options: { displayLabel: result.displayLabel } }
  }

  return { kind: 'send', content: sendContent, attachments }
}

export function resolveComposerSubmission(input: ComposerSubmissionInput): ComposerSubmission {
  const { content, quoteBlock, attachments, chips } = input
  const sendContent = composeSendContent(content, quoteBlock)

  if (input.isSending) {
    // 回复期间仍可编辑：有内容就排队，插话则立即发送；没有会话 id 时排队无处可去。
    const hasAnything = !!sendContent || attachments.files.length > 0 || attachments.images.length > 0
    if (!hasAnything || !input.sessionId) return { kind: 'none' }
    return input.steerMode
      ? { kind: 'send', content: sendContent, attachments }
      : {
          kind: 'queue',
          content: sendContent,
          attachments,
          displayLabel: sendContent.slice(0, 80),
        }
  }

  if (input.disabled || input.menuOpen || !input.hasContent) return { kind: 'none' }

  if (chips.length > 0) return resolveFromChips(chips, content, attachments)

  return resolveFromDirectSlash(content, sendContent, attachments)
}

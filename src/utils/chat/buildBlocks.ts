import type { Message, ToolCall, MessageMetadata } from '@/types'
import { findFirstQuestionForm, splitOnQuestionForms, type QuestionFormBlock } from '@/utils/design/questionForm'

export interface OdCardPayload {
  type: 'brand-preview' | 'direction-swatches' | 'artifact-thumbnail' | 'generic'
  title?: string
  data: Record<string, any>
}

export interface NextStepAction {
  label: string
  prompt: string
}

export type Block =
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string; startTime: number; endTime?: number }
  | { kind: 'tool-group'; toolName: string; calls: ToolCall[] }
  | { kind: 'od-card'; payload: OdCardPayload }
  | { kind: 'question-form'; payload: QuestionFormBlock }
  | { kind: 'next-steps'; actions: NextStepAction[] }
  | { kind: 'status'; usage?: { inputTokens: number; outputTokens: number; duration?: number } }

const OD_CARD_RE = /<od-card\s+type="([^"]+)"(?:\s+title="([^"]+)")?\s*>([\s\S]*?)<\/od-card>/g
const NEXT_STEPS_RE = /<next-steps>([\s\S]*?)<\/next-steps>/g
const ACTION_RE = /<action\s+label="([^"]+)"\s+prompt="([^"]+)"\s*\/>/g

function parseOdCards(content: string): { text: string; cards: OdCardPayload[] } {
  const cards: OdCardPayload[] = []
  const text = content.replace(OD_CARD_RE, (_m, type, title, body) => {
    let data: Record<string, any> = {}
    try { data = JSON.parse(body.trim()) } catch { data = { raw: body.trim() } }
    cards.push({ type, title, data })
    return ''
  })
  return { text, cards }
}

function parseNextSteps(content: string): { text: string; actions: NextStepAction[] | null } {
  let actions: NextStepAction[] | null = null
  const text = content.replace(NEXT_STEPS_RE, (_m, body) => {
    const list: NextStepAction[] = []
    let m: RegExpExecArray | null
    const re = new RegExp(ACTION_RE)
    while ((m = re.exec(body)) !== null) {
      list.push({ label: m[1], prompt: m[2] })
    }
    actions = list
    return ''
  })
  return { text, actions }
}

/**
 * 剥离设计模式专用的 XML 标签（od-card / next-steps / question-form），
 * 使剩余的纯文本可以安全地交给 AgentTimeline 的 MarkdownRenderer 渲染。
 *
 * 设计模式下助手消息内容可能内嵌这些标签，如果不剥离，
 * AgentTimeline 的 text 事件会把原始 XML 标签当作正文展示给用户。
 */
export function stripDesignTags(content: string): string {
  let result = content
  // 1. 剥离 question-form / ask-question 标签
  if (findFirstQuestionForm(result)) {
    const segments = splitOnQuestionForms(result)
    result = segments.filter(s => s.type === 'text').map(s => s.text).join('')
  }
  // 2. 剥离 od-card 标签
  result = result.replace(OD_CARD_RE, '')
  // 3. 剥离 next-steps 标签
  result = result.replace(NEXT_STEPS_RE, '')
  return result
}

export function buildBlocks(message: Message): Block[] {
  const blocks: Block[] = []

  // 1. thinking
  if (message.reasoning?.content) {
    blocks.push({
      kind: 'thinking',
      content: message.reasoning.content,
      startTime: message.reasoning.startTime,
      endTime: message.reasoning.endTime,
    })
  }

  // 2. text + od-card + question-form + next-steps（交错解析）
  let content = message.content || ''

  // 先解析 question-form（复用现有工具）
  const qForm = findFirstQuestionForm(content)
  if (qForm) {
    const segments = splitOnQuestionForms(content)
    const textOnly = segments.filter(s => s.type === 'text').map(s => s.text).join('')
    content = textOnly
  }

  // 解析 od-card
  const { text: textAfterOd, cards } = parseOdCards(content)
  content = textAfterOd

  // 解析 next-steps
  const { text: textAfterNs, actions } = parseNextSteps(content)
  content = textAfterNs

  if (content.trim()) {
    blocks.push({ kind: 'text', content })
  }
  for (const c of cards) {
    blocks.push({ kind: 'od-card', payload: c })
  }
  if (qForm) {
    blocks.push({ kind: 'question-form', payload: qForm })
  }
  if (actions) {
    blocks.push({ kind: 'next-steps', actions })
  }

  // 3. tool-group（按 name 分组）
  if (message.toolCalls?.length) {
    const groups = new Map<string, ToolCall[]>()
    for (const tc of message.toolCalls) {
      const arr = groups.get(tc.name) || []
      arr.push(tc)
      groups.set(tc.name, arr)
    }
    for (const [name, calls] of groups) {
      blocks.push({ kind: 'tool-group', toolName: name, calls })
    }
  }

  // 4. status
  const meta = message.metadata as MessageMetadata | undefined
  if (meta && (meta.inputTokens || meta.outputTokens || meta.duration)) {
    blocks.push({
      kind: 'status',
      usage: {
        inputTokens: meta.inputTokens || 0,
        outputTokens: meta.outputTokens || 0,
        duration: meta.duration,
      },
    })
  }

  return blocks
}

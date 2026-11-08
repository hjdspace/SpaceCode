// src/components/chat/timelineEvents.ts
// AgentTimeline 的纯装配逻辑 — 把 messages / 扩展对话框 / 特殊工具卡合成时间线事件。
//
// 从 AgentTimeline.vue 抽出：这里只做事件装配与缓存键计算，不碰组件状态与渲染。
// 缓存按实例持有（工厂返回的 build 闭包），与抽取前 `<script setup>` 内的模块级变量
// 语义一致 —— 多 pane 各自的时间线不能互相命中对方的缓存。

import type { Component } from 'vue'
import { markRaw } from 'vue'
import type { ClassifiedError, Message, MessageMetadata } from '@/types'
import type { ExtensionDialog } from '@/services/extensionDialogService'
import { stripDesignTags } from '@/utils/chat/buildBlocks'
import { stripSuperAgentRouterProtocol } from '@/utils/chat/stripRouterProtocol'
import {
  AlertCircle,
  Bot,
  Code,
  FileEdit,
  FileText,
  Folder,
  Globe,
  Info,
  MessageCircle,
  Search,
  Terminal,
  Wand2,
} from 'lucide-vue-next'

export interface TimelineEvent {
  id: string
  type: 'reasoning' | 'text' | 'tool_call' | 'metadata' | 'error' | 'extension_dialog'
  status: 'running' | 'completed' | 'error' | 'pending'
  icon: Component
  label: string
  content: string
  /** 工具事件只存身份，toolCall 本体在渲染时从 messages 解析 —— 缓存里存对象引用会握住被替换掉的旧 input */
  toolCallId?: string
  /** reasoning 事件的耗时（秒）。工具耗时由 toolCall 实时计算，不进缓存 */
  duration?: string
  messageId?: string
  metadata?: MessageMetadata
  specialComponent?: Component
  classifiedError?: ClassifiedError
  /** type 为 extension_dialog 时的那条 pi 扩展对话框；它不属于任何 message，只属于会话 */
  dialog?: ExtensionDialog
}

const EmptyIcon = () => null

const TOOL_ICON_MAP: Record<string, Component> = {
  Bash: Terminal,
  Read: FileText,
  FileRead: FileText,
  Write: FileEdit,
  FileWrite: FileEdit,
  Edit: FileEdit,
  FileEdit: FileEdit,
  MultiEdit: FileEdit,
  Glob: Folder,
  Grep: Search,
  Agent: Bot,
  Skill: Wand2,
  WebFetch: Globe,
  WebSearch: Globe,
  CodebaseSearch: Search,
}

/**
 * 一次 build 所需的全部入参。组件侧以 getter 形式提供，保证每次 build 都读到最新 props。
 */
export interface TimelineBuildContext {
  messages: Message[]
  dialogs?: ExtensionDialog[]
  mode?: 'design'
  presentation?: 'im'
  loading?: boolean
  /** 已异步解析完毕的特殊工具卡（按工具名索引） */
  specialComponents: Record<string, Component>
  getToolLabel: (tool: string) => string
  translate: (key: string) => string
}

/**
 * 就地归一化 events[from..] —— 一个 assistant 轮次产出的事件片段。
 *
 * 1. 丢弃已收口的空 reasoning 事件。上游兼容层会在 text 块之间夹入没有
 *    任何 thinking_delta 的占位 thinking 块，渲染出来是一行空白折叠卡片，
 *    把答复切成一段段插在中间。运行中的空块保留 —— 那是"思考中"动画的首帧。
 * 2. 把相邻的 text 事件合并成一个 Markdown 文档。Anthropic 一轮内只会有一个
 *    连续 text 块，多个相邻 text 事件是兼容层按帧切块的产物；逐块渲染会把
 *    `**粗体**`、列表、表格的语法边界截断成互不相干的碎片。
 * 3. 合并之后才剥离设计专用标签，保证跨帧的 <od-card> 仍能整体匹配。
 */
function normalizeMessageEvents(
  events: TimelineEvent[],
  from: number,
  designMode: boolean,
  imMode: boolean,
): void {
  const normalized: TimelineEvent[] = []
  let textRun: TimelineEvent[] = []

  const flushTextRun = () => {
    if (!textRun.length) return
    const raw = textRun.map(event => event.content).join('')
    const stripped = designMode ? stripDesignTags(raw) : raw
    // 合并之后才剥协议块：跨帧的围栏要整体匹配，逐块剥会把半截 JSON 留下。
    const content = imMode ? stripSuperAgentRouterProtocol(stripped) : stripped
    if (content.trim()) {
      normalized.push({
        ...textRun[0],
        content,
        status: textRun.some(event => event.status === 'running') ? 'running' : 'completed',
      })
    }
    textRun = []
  }

  for (const event of events.slice(from)) {
    if (event.type === 'text') {
      textRun.push(event)
      continue
    }
    // 先判丢弃再 flush：空占位块被打断的正是同一段答复，若先 flush 就会把
    // 一个 text run 拆成多块，合并等于没做。
    if (event.type === 'reasoning' && event.status !== 'running' && !event.content.trim()) continue
    flushTextRun()
    normalized.push(event)
  }
  flushTextRun()

  events.splice(from, events.length - from, ...normalized)
}

function toDialogEvent(dialog: ExtensionDialog): TimelineEvent {
  return {
    id: `extension-dialog-${dialog.dialogId}`,
    type: 'extension_dialog',
    status: dialog.state === 'pending' ? 'running' : 'completed',
    icon: markRaw(MessageCircle),
    label: dialog.title,
    content: '',
    dialog,
  }
}

/**
 * 把这一轮问出来的扩展对话框插回它发生的位置 (issue #54)。
 *
 * 游标是 store 在收到帧的那一刻记下的（当时该消息最后一个 timeline 事件，通常就是触发
 * 提问的那个工具行）。`anchorAtStart` 表示提问发生时消息还没有事件，卡片要排在本消息
 * 全部事件之前；只有事件游标已经不存在时才退到消息末尾 —— 关键是别退到全局末尾：
 * 卡片吊在最后，用户答完之后 LLM 的续写就全被它压在下面，看着像这张卡永远挂在底部。
 *
 * 必须在 normalizeMessageEvents 之前插：归一化会把相邻 text 块并成一个文档，插在那之后
 * 游标就对不上了；插在那之前，卡片本身成为两个 text run 的边界，答复不会被错并成一坨。
 */
function insertDialogEvents(
  events: TimelineEvent[],
  from: number,
  messageId: string,
  dialogs: ExtensionDialog[],
  placed: Set<string>,
): void {
  const startAnchored = dialogs.filter(dialog =>
    !placed.has(dialog.dialogId) &&
    dialog.anchorAtStart &&
    dialog.anchorMessageId === messageId,
  )
  for (const dialog of startAnchored) {
    placed.add(dialog.dialogId)
  }

  const byAnchorEvent = new Map<string, ExtensionDialog[]>()
  for (const dialog of dialogs) {
    if (dialog.anchorAtStart || !dialog.anchorEventId || placed.has(dialog.dialogId)) continue
    const bucket = byAnchorEvent.get(dialog.anchorEventId)
    if (bucket) bucket.push(dialog)
    else byAnchorEvent.set(dialog.anchorEventId, [dialog])
  }

  const merged: TimelineEvent[] = startAnchored.map(toDialogEvent)
  for (const event of events.slice(from)) {
    merged.push(event)
    for (const dialog of byAnchorEvent.get(event.id) ?? []) {
      if (placed.has(dialog.dialogId)) continue
      placed.add(dialog.dialogId)
      merged.push(toDialogEvent(dialog))
    }
  }

  for (const dialog of dialogs) {
    if (placed.has(dialog.dialogId) || dialog.anchorMessageId !== messageId) continue
    placed.add(dialog.dialogId)
    merged.push(toDialogEvent(dialog))
  }

  events.splice(from, events.length - from, ...merged)
}

export function hasFinalMetadata(metadata?: MessageMetadata): boolean {
  return !!(metadata?.model || metadata?.inputTokens || metadata?.outputTokens || metadata?.duration)
}

export function getFinalMetadataMessageId(msgs: Message[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (hasFinalMetadata(msg.metadata)) return msg.id
  }
  return ''
}

/**
 * 创建按实例持有缓存的时间线构建器。
 *
 * @param getContext 每次 build 时调用的上下文读取器（保证读到最新 props）
 */
export function createTimelineEventsBuilder(
  getContext: () => TimelineBuildContext,
): { build: () => TimelineEvent[] } {
  let cachedEvents: TimelineEvent[] | null = null
  let cachedKey = ''

  const build = (): TimelineEvent[] => {
    const ctx = getContext()
    const msgs = ctx.messages
    const specialComponents = ctx.specialComponents

    // 只把结构字段放进键：input/output 的更新由 toolOf() 在渲染时解析，不需要重建事件数组
    const toolStateKey = msgs
      .flatMap(msg => (msg.toolCalls || []).map(tool => [
        tool.id,
        tool.name,
        tool.status,
        specialComponents[tool.name] ? 1 : 0,
      ].join(':')))
      .join(',')
    const metadataStateKey = msgs
      .map(msg => [
        msg.id,
        msg.metadata?.model || '',
        msg.metadata?.inputTokens || '',
        msg.metadata?.outputTokens || '',
        msg.metadata?.duration || '',
      ].join(':'))
      .join(',')
    // 必须把流式文本/推理内容也纳入缓存键, 否则纯 text_delta 流式更新时
    // (msg 数量/ID/工具状态都不变) 缓存命中 -> 返回旧的 TimelineEvent[] ->
    // MarkdownRenderer 拿到同一份 content 字符串, watch 不触发, 界面卡住,
    // 直到用户切走再切回 (组件 remount, 缓存重置) 才看到完整答复.
    const contentStateKey = msgs.map(msg => {
      const tlKey = (msg.timelineEvents || [])
        .map(e => {
          if (e.type === 'text' || e.type === 'reasoning') {
            return `${e.id}:${e.status}:${(e.content || '').length}`
          }
          return `${e.id}:${e.type}`
        })
        .join('|')
      return [
        msg.id,
        (msg.content || '').length,
        (msg.reasoning?.content || '').length,
        msg.reasoning?.endTime ? 1 : 0,
        msg.metadata ? 1 : 0,
        tlKey,
      ].join(':')
    }).join(';')
    // pi 的扩展对话框属于会话而不是某条消息（它不带 toolCallId，也没有对应工具条目），
    // 所以只能作为视图层合成的事件插进时间线 —— 与 ErrorCard 同一条路子 (#54)。
    // 会话/分组归属已由 MessageList 分配；这里再按消息 id 兜一层：锚在别组消息上的
    // 卡片即使被误传进来，也不能挂到本组末尾。
    const messageIds = new Set(msgs.map(msg => msg.id))
    const dialogs = (ctx.dialogs ?? []).filter(dialog =>
      !dialog.anchorMessageId || messageIds.has(dialog.anchorMessageId))
    // 卡片状态一变（答了、超时了、下一轮菜单来了）就要重算，因此必须进缓存键，
    // 否则命中旧数组、卡片停在原地不动。
    const dialogStateKey = dialogs
      .map(dialog => [dialog.dialogId, dialog.state, dialog.outcomeText ?? '', dialog.closedReason ?? ''].join(':'))
      .join('|')
    // 插到「问出来那一刻」的位置，而不是统统吊在末尾：存的是已插入的 dialogId (#54)
    const placedDialogIds = new Set<string>()

    const finalMetadataMessageId = ctx.loading ? '' : getFinalMetadataMessageId(msgs)
    // 展示模式并入缓存键：IM 模式剥了协议块与工具事件，切模式若命中旧缓存
    // 就会继续看到上一个展示面的内容（同类事故见本文件下方注释）。
    const modeKey = `${ctx.mode || 'default'}-${ctx.presentation || 'default'}`
    const key = msgs.length > 0
      ? `${modeKey}-${msgs.length}-${msgs[0]?.id}-${msgs[msgs.length - 1]?.id}-${toolStateKey}-${metadataStateKey}-${contentStateKey}-${finalMetadataMessageId}-${dialogStateKey}`
      : `empty-${modeKey}-${dialogStateKey}`

    if (cachedEvents && cachedKey === key) {
      return cachedEvents
    }

    const events: TimelineEvent[] = []
    const timelineToolCallIds = new Set<string>()

    for (const msg of msgs) {
      const msgEventsStart = events.length
      const hasTimeline = msg.timelineEvents?.length

      if (hasTimeline) {
        for (const event of msg.timelineEvents!) {
          // 纯空白文本块（LLM 在工具调用间常输出 "\n"）若不过滤，
          // 会渲染成 min-height:28px 的空白占位行，导致卡片间距异常大。
          if (event.type === 'text' && !event.content?.trim()) continue
          if (event.type === 'tool_call') {
            const tool = msg.toolCalls?.find(toolCall => toolCall.id === event.toolCallId)
            if (!tool) continue
            timelineToolCallIds.add(tool.id)
            const icon = TOOL_ICON_MAP[tool.name] || Code
            events.push({
              id: event.id,
              type: 'tool_call',
              status: tool.status,
              icon: markRaw(icon),
              label: ctx.getToolLabel(tool.name),
              content: '',
              toolCallId: tool.id,
              messageId: msg.id,
              specialComponent: specialComponents[tool.name] ? markRaw(specialComponents[tool.name]) : undefined,
            })
            continue
          }
          if (event.type === 'reasoning') {
            events.push({
              id: event.id,
              type: 'reasoning',
              status: event.status,
              icon: markRaw(EmptyIcon),
              label: ctx.translate('timeline.thinking'),
              content: event.content || '',
            })
            continue
          }
          if (event.type === 'text') {
            events.push({
              id: event.id,
              type: 'text',
              status: event.status,
              icon: markRaw(MessageCircle),
              label: ctx.translate('timeline.response'),
              content: event.content || '',
            })
            continue
          }
        }
      }

      if (msg.toolCalls?.length) {
        for (const tool of msg.toolCalls) {
          if (timelineToolCallIds.has(tool.id)) continue
          const icon = TOOL_ICON_MAP[tool.name] || Code
          events.push({
            id: tool.id,
            type: 'tool_call',
            status: tool.status,
            icon: markRaw(icon),
            label: ctx.getToolLabel(tool.name),
            content: '',
            toolCallId: tool.id,
            messageId: msg.id,
            specialComponent: specialComponents[tool.name] ? markRaw(specialComponents[tool.name]) : undefined,
          })
        }
      }

      if (!hasTimeline) {
        if (msg.reasoning) {
          const isThinking = !msg.reasoning.endTime
          const duration = msg.reasoning.endTime
            ? ((msg.reasoning.endTime - msg.reasoning.startTime) / 1000).toFixed(1)
            : null
          events.push({
            id: `${msg.id}-reasoning`,
            type: 'reasoning',
            status: isThinking ? 'running' : 'completed',
            icon: markRaw(EmptyIcon),
            label: ctx.translate('timeline.thinking'),
            content: msg.reasoning.content || '',
            duration: duration || undefined,
          })
        }

        if (msg.content) {
          events.push({
            id: `${msg.id}-text`,
            type: 'text',
            status: 'completed',
            icon: markRaw(MessageCircle),
            label: ctx.translate('timeline.response'),
            content: msg.content,
          })
        }
      }

      insertDialogEvents(events, msgEventsStart, msg.id, dialogs, placedDialogIds)
      normalizeMessageEvents(events, msgEventsStart, ctx.mode === 'design', ctx.presentation === 'im')

      if (msg.id === finalMetadataMessageId && hasFinalMetadata(msg.metadata)) {
        events.push({
          id: `${msg.id}-meta`,
          type: 'metadata',
          status: 'completed',
          icon: markRaw(Info),
          label: ctx.translate('timeline.info'),
          content: '',
          metadata: msg.metadata,
        })
      }

      if (msg.metadata?.error) {
        events.push({
          id: `${msg.id}-error`,
          type: 'error',
          status: 'error',
          icon: markRaw(AlertCircle),
          label: ctx.translate('timeline.error'),
          content: '',
          classifiedError: msg.metadata.error,
        })
      }
    }

    // 没锚到任何一条消息的（会话刚起就来的确认框、或那一轮的消息已被换掉）才落到末尾。
    // pi 的菜单是连着问的（选一项→再问一轮），答过的收成一行既让出视线，
    // 也保住「问过什么、答了什么」这条痕迹。
    for (const dialog of dialogs) {
      if (placedDialogIds.has(dialog.dialogId)) continue
      events.push(toDialogEvent(dialog))
    }

    cachedEvents = events
    cachedKey = key
    return events
  }

  return { build }
}

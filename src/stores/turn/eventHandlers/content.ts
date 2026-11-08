// src/stores/turn/eventHandlers/content.ts
// 正文与时间线写入的公共工具：卡片投影、节流落盘、工具输入早期提取。
// 这些函数被 stream / assistant / turnEnd 三个域共用，故独立成模块。

import type { Ref } from 'vue'
import type { SessionSink } from '../../turnSink'
import type { TurnState } from '../types'
import type { TimelineAssembler } from '../timelineAssembler'
import type { Message } from '@/types'
import { mergeGenuiCardRecords, projectGenuiCards } from '@/lib/genui/cardProjection'
import { applyGenuiCardBudget } from '@/lib/genui/cardLifecycle'
import { tryExtractEarlyInput } from './helpers'
import type { ContentHelpers } from './types'

interface ContentContext {
  sink: SessionSink
  streamingContents: Ref<Map<string, string>>
  timeline: TimelineAssembler
}

export function createContentHelpers(c: ContentContext): ContentHelpers {
  const { sink, streamingContents, timeline } = c
  const { getAssistantMessage } = timeline

  // Renderer IPC can continue delivering text deltas while the window is hidden.
  // Coalesce message writes so a burst accumulated during background throttling
  // does not turn into one reactive update per delta when the window is restored.
  const pendingContentPatches = new Map<string, { timer: ReturnType<typeof setTimeout>; turn: TurnState }>()
  const CONTENT_PATCH_INTERVAL_MS = 50

  // 卡片记录只在 id 集合变化时才写 metadata：流式期间每个节流窗口都会重投影，
  // 逐次替换对象会让消息无谓地失效重渲染。缺字段与空数组视为同一份「没有」。
  const sameRecordIds = (next: { id: string }[], current: { id: string }[] | undefined): boolean => {
    if ((current?.length ?? 0) !== next.length) return false
    return next.every((record, index) => record.id === current?.[index]?.id)
  }

  /** 单个 text 块的可见正文：与整条消息同一套围栏判定，只是不产卡片记录。 */
  const visibleBlock = (ts: TurnState, rawBlock: string, final = false): string =>
    projectGenuiCards(rawBlock, ts.assistantMessageId, { final }).text

  /**
   * 助手正文里的 ` ```schemaJson ` 围栏投影成卡片：可见正文去掉已成卡的围栏，
   * 卡片记录与降级说明写进消息 metadata（口径见 docs/prd/genui-cards.md §1/§2）。
   *
   * 只喂**原始累计文本**：拿投影后的正文再投影会让剩余围栏的序号漂移，卡片 id 因此不稳。
   * metadata 仅在 id 集合变化时改写，普通文本回复完全不碰 metadata，也不多出空数组。
   * 返回值是给消息与当前 text 事件用的可见正文。
   */
  function syncCardProjection(sessionId: string, ts: TurnState, message: Message, final: boolean): { content: string; blockText: string } {
    const projection = projectGenuiCards(ts.accumulatedContent, ts.assistantMessageId, { final })
    const cards = projection.cards.length
      ? mergeGenuiCardRecords(message.metadata?.genUiCards, projection.cards)
      : message.metadata?.genUiCards

    if (cards?.length && !sameRecordIds(cards, message.metadata?.genUiCards)) {
      message.metadata = { ...message.metadata, genUiCards: cards }
      // 会话卡片配额当场生效：新卡片把预算顶穿时，最旧那张立刻退成可见占位。
      // 内存里看到的因此就是即将落盘的那份，不留「界面还有、存下来已过期」的分裂状态。
      const session = sink.get(sessionId)
      if (session) applyGenuiCardBudget(session)
    }
    // 降级说明按整份替换：它没有需要保留的状态，而一条消息里可以先后出现多条降级
    // （两张坏围栏、或第 9 张卡超限），只比「有没有」会让第二条永远不上屏。
    if (!sameRecordIds(projection.fallbacks, message.metadata?.genUiCardFallbacks)) {
      message.metadata = {
        ...message.metadata,
        genUiCardFallbacks: projection.fallbacks.length ? projection.fallbacks : undefined,
      }
    }

    // 时间线按 text 块各自去围栏。跨块的 ` ```schemaJson `（模型在 JSON 中间插了一次工具调用）
    // 在整条消息上闭合、在单块里闭合不了，因此那种围栏会既成卡又在块里留下残段 ——
    // 表现是「卡片 + 一段降级文本」，消息其余部分不受影响（tests 里钉住了这个行为）。
    // 反过来不成立：收口只回补**当前**块，更早的块在流式期间藏起的未闭合围栏不会再被重写
    // （块的原文没留档），它只回到 msg.content。已知缺口，见 DEFECT 用例。
    const blockText = ts.currentTextContent
      ? projectGenuiCards(ts.currentTextContent, ts.assistantMessageId, { final }).text
      : ''

    return { content: projection.text, blockText }
  }

  /**
   * 把累计文本落到消息与当前 text 事件上。
   *
   * `final` 表示这条消息**已经不会再有文本来**：result 收口、报错与中止都算。
   * 只有收口时才该把「仍未闭合的围栏」放回正文当代码块显示 —— 流式期间它必须藏着，
   * 否则用户会看见半张卡闪一下；而收口后还藏着就等于把内容吞掉。
   */
  function flushContentPatch(sessionId: string, ts: TurnState, final = false): void {
    const pending = pendingContentPatches.get(sessionId)
    if (pending) clearTimeout(pending.timer)
    pendingContentPatches.delete(sessionId)

    const message = getAssistantMessage(sessionId, ts)
    if (!message) return

    const { content, blockText } = syncCardProjection(sessionId, ts, message, final)

    const textEvent = ts.currentTextEventId
      ? message.timelineEvents?.find(event => event.id === ts.currentTextEventId)
      : undefined
    // 时间线 text 事件只承载当前块的内容：accumulatedContent 是整轮全文
    // （跨工具调用的所有 text 块拼接），写入会把工具调用前的文本在
    // 工具后的 text 事件里重复渲染一遍。
    if (textEvent && textEvent.content !== blockText) {
      textEvent.content = blockText
    }
    const reasoningEvent = ts.currentReasoningEventId
      ? message.timelineEvents?.find(event => event.id === ts.currentReasoningEventId)
      : undefined
    if (reasoningEvent && reasoningEvent.content !== ts.currentReasoningContent) {
      reasoningEvent.content = ts.currentReasoningContent
    }

    const updates: Partial<typeof message> = {}
    if (message.content !== content) updates.content = content
    if (message.reasoning && message.reasoning.content !== ts.accumulatedReasoning) {
      updates.reasoning = { ...message.reasoning, content: ts.accumulatedReasoning }
    }
    if (Object.keys(updates).length > 0) sink.patchMessage(sessionId, ts.assistantMessageId, updates)
    streamingContents.value.set(sessionId, ts.accumulatedContent)
  }

  function scheduleContentPatch(sessionId: string, ts: TurnState): void {
    const pending = pendingContentPatches.get(sessionId)
    if (pending?.turn === ts) return
    if (pending) clearTimeout(pending.timer)
    const timer = setTimeout(() => {
      pendingContentPatches.delete(sessionId)
      if (ts.settled) return
      flushContentPatch(sessionId, ts)
    }, CONTENT_PATCH_INTERVAL_MS)
    pendingContentPatches.set(sessionId, { timer, turn: ts })
  }

  // 工具输入早期提取节流：input_json_delta 每秒可达数十次，content 字段的每次
  // 更新都会触发 WriteToolCard 全量语法高亮，按 ~10Hz 合并刷新避免卡顿。
  const pendingEarlyInputPatches = new Map<string, { timer: ReturnType<typeof setTimeout>; turn: TurnState; toolId: string }>()
  const EARLY_INPUT_PATCH_INTERVAL_MS = 100

  function scheduleEarlyInputPatch(sessionId: string, ts: TurnState, toolId: string): void {
    const pending = pendingEarlyInputPatches.get(sessionId)
    if (pending) {
      if (pending.turn === ts) {
        pending.toolId = toolId
        return
      }
      clearTimeout(pending.timer)
    }
    const timer = setTimeout(() => {
      pendingEarlyInputPatches.delete(sessionId)
      flushEarlyInputPatch(sessionId, ts, toolId)
    }, EARLY_INPUT_PATCH_INTERVAL_MS)
    pendingEarlyInputPatches.set(sessionId, { timer, turn: ts, toolId })
  }

  function flushEarlyInputPatch(sessionId: string, ts: TurnState, toolId: string): void {
    // content_block_stop 已整体解析并清空分片，勿用迟到的部分提取覆盖完整 input
    const accumulated = ts.streamingToolJson.get(toolId)
    if (accumulated === undefined) return
    const earlyInput = tryExtractEarlyInput(accumulated)
    if (!earlyInput) return
    const s = sink.get(sessionId)
    const msg = s?.messages.find(m => m.id === ts.assistantMessageId)
    if (!msg?.toolCalls) return
    const idx = msg.toolCalls.findIndex(tc => tc.id === toolId)
    if (idx < 0) return
    const updatedToolCalls = [...msg.toolCalls]
    updatedToolCalls[idx] = {
      ...updatedToolCalls[idx],
      input: { ...updatedToolCalls[idx].input, ...earlyInput }
    }
    msg.toolCalls = updatedToolCalls
  }

  return {
    syncCardProjection,
    flushContentPatch,
    scheduleContentPatch,
    scheduleEarlyInputPatch,
    flushEarlyInputPatch,
    visibleBlock,
  }
}

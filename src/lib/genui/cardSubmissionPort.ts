/**
 * 提交端口的生产接线（票 04）：把 cardSubmission 的纯规则接到真实 store 与 i18n 上。
 *
 * host 在首次提交时才组装 —— 卡片分组在单测里可以不带 Pinia 挂载（那些用例不点提交），
 * 这条懒路径因此不把整条消息区绑死在 store 生命周期上。
 * 一份 host 走到底：卡片 id 自带消息前缀，跨会话不会撞，而「同一张卡在飞」的判定
 * 必须全局唯一，否则切走再回来提交同一张卡会发出第二条消息。
 */
import { i18n } from '@/i18n'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import {
  createGenuiCardSubmissionHost,
  type GenuiCardSubmissionHost,
  type GenuiCardSubmissionResult,
} from './cardSubmission'
import type { GenuiCardRecord } from '@/types/genui'

/** vue-i18n 的 global.t 重载太多，这里只要「key + 具名参数」这一条形状。 */
function translate(key: string, params?: Record<string, unknown>): string {
  const globalT = i18n.global.t as unknown as (k: string, named?: Record<string, unknown>) => string
  return globalT(key, params ?? {})
}

let host: GenuiCardSubmissionHost | null = null

function submissionHost(): GenuiCardSubmissionHost {
  if (host) return host
  const sessionStore = useChatSessionStore()
  host = createGenuiCardSubmissionHost({
    sessionId: () => sessionStore.currentSessionId ?? undefined,
    // 卡片属于产生它的助手消息，提交时按当前会话的消息列表反查那张卡。
    messages: () => sessionStore.getSessionMessages(sessionStore.currentSessionId),
    translate,
    updateMessage: (messageId, patch, sessionId) =>
      sessionStore.updateMessage(messageId, patch, sessionId),
    turn: useTurnStore(),
    now: () => Date.now(),
  })
  return host
}

export type CardSubmissionPort = (
  card: GenuiCardRecord,
  payload: Record<string, unknown>,
) => Promise<GenuiCardSubmissionResult>

/** 交给卡片外壳的提交函数：外壳只知道「这张卡 + 这份 payload」。 */
export function createCardSubmissionPort(): CardSubmissionPort {
  return (card, payload) => submissionHost().submit(card, payload)
}

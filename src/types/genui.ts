/**
 * 生成式 UI 卡片的渲染端类型（术语见根目录 `CONTEXT.md` 的 Generative UI 一节）。
 * 票 01 只需要承载链路：卡片记录 + 宿主注入的沙箱源。
 */
import type { GenuiTheme } from '@/shared/genuiSandbox'
import type { SandboxSource } from '@/lib/genui/sandboxUrl'

export type { GenuiTheme, SandboxSource }

/** 卡片提交后的只读标记：摘要与时刻随 metadata 一起持久化（票 04/05）。 */
export type GenuiCardSubmittedMark = {
  summary: string
  submittedAt: number
}

/**
 * 提交时随用户消息落库的 metadata 形状。turn store 的发送选项与提交 host 共用这一份，
 * 避免两处各写一份而漂移成「存得下但读不出来」。
 */
export type GenuiSubmissionUserMessageMetadata = {
  genUiSubmission: GenuiCardSubmissionMeta
}

/**
 * 挂在提交用户消息 metadata 上的提交详情（票 04）。
 * 正文里留着摘要 + 完整围栏 JSON，气泡据此只渲染摘要；payload 因此仍在模型上下文中。
 */
export type GenuiCardSubmissionMeta = {
  cardId: string
  summary: string
  payload: Record<string, unknown>
  collapsed: true
}

/**
 * 挂在 assistant 消息 metadata 上的卡片记录。
 * id 由「消息 id + 围栏序号」决定，重投影时用于去重（票 02/05 接入）。
 */
export type GenuiCardRecord = {
  id: string
  /**
   * 卡片渲染所需的 schema；null = payload 已被会话预算丢弃（见 `expired`），
   * 或被兜底判定为不可渲染。记录本身仍在，位置与顺序不变。
   */
  schema: Record<string, unknown> | null
  protocolVersion: number
  /** 已提交：卡片转为只读，重复提交被忽略 */
  submitted?: GenuiCardSubmittedMark
  /** 超出会话卡片预算后只留可见占位，正文与提交结果不受影响 */
  expired?: true
}

/** 卡片没能成卡的原因。每条都对应正文里保留下来的原样围栏。 */
export type GenuiCardFallbackReason =
  | 'malformed-json'
  | 'not-an-object'
  | 'missing-component-name'
  | 'unsupported-component'
  | 'protocol-version'
  | 'oversized-schema'
  | 'too-many-cards'

/**
 * 降级为文本的卡片：围栏原文仍在正文里，这条记录只负责给出可见说明，
 * 让用户知道内容没有被静默丢弃（PRD §1「超限按后面的卡降级为文本处理」）。
 */
export type GenuiCardFallback = {
  id: string
  reason: GenuiCardFallbackReason
  /** 根组件名；无法解析时为空串 */
  componentName: string
}

/** 宿主注入的调试入口：只渲染内置 fixture，不接受外部 Schema。 */
export type GenuiDebugApi = {
  addFixtureCard: () => { ok: boolean; reason?: string }
}

declare global {
  interface Window {
    __SPACECODE_GENUI_DEBUG__?: GenuiDebugApi
    /**
     * H5 服务端逐响应写进文档的卡片沙箱源（票 06）。与同一次响应的 `frame-src` 出自
     * 同一个计算；桌面两个宿主不会带它。属性名的权威定义是
     * `src/shared/genuiSandbox.ts` 的 `GENUI_H5_SANDBOX_GLOBAL`（接口里只能用字面量）。
     */
    __SPACECODE_GENUI_SANDBOX__?: string
  }
}

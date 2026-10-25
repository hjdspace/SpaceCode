/**
 * 生成式 UI 卡片的渲染端类型（术语见根目录 `CONTEXT.md` 的 Generative UI 一节）。
 * 票 01 只需要承载链路：卡片记录 + 宿主注入的沙箱源。
 */
import type { GenuiTheme } from '@/shared/genuiSandbox'
import type { SandboxSource } from '@/lib/genui/sandboxUrl'

export type { GenuiTheme, SandboxSource }

/**
 * 挂在 assistant 消息 metadata 上的卡片记录。
 * id 由「消息 id + 围栏序号」决定，重投影时用于去重（票 02/05 接入）。
 */
export type GenuiCardRecord = {
  id: string
  schema: Record<string, unknown>
  protocolVersion: number
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
  }
}

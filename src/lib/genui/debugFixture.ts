/**
 * 内置调试 fixture（票 01：只验证承载链路，不属于正式技能输出）。
 *
 * 入口挂在 `window.__SPACECODE_GENUI_DEBUG__.addFixtureCard()`，不接受外部 Schema ——
 * 它能做的事情和一张真实卡片完全一样（在沙箱里渲染），不会成为新的能力面。
 */
import { GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'
import type { GenuiCardRecord, GenuiDebugApi } from '@/types/genui'

/**
 * fixture 卡片的根组件名。沙箱据此走「承载自检」渲染分支 —— 它不在物料白名单里，
 * 真实技能输出永远不会用到（宿主投影会把它降级成文本）。
 */
export const GENUI_FIXTURE_COMPONENT_NAME = 'FixtureCard'

export type GenuiDebugDeps = {
  /** 把 fixture 卡片挂到当前会话的一条调试消息上；无可写入会话时返回 false */
  appendFixtureMessage: (card: GenuiCardRecord) => boolean
  /** 由调用方给的本地化文案（卡片正文属于宿主文案） */
  fixtureLabels: () => { title: string; rows: { label: string; value: string }[] }
}

export function createGenuiDebugApi(deps: GenuiDebugDeps): GenuiDebugApi {
  let sequence = 0

  return {
    addFixtureCard() {
      sequence += 1
      const { title, rows } = deps.fixtureLabels()
      const card: GenuiCardRecord = {
        // 每次调用都是新的一条卡，方便连点观察；真实卡片的确定性 id 由票 02 的投影给出
        id: `genui-debug:card:${sequence}`,
        protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
        schema: { componentName: GENUI_FIXTURE_COMPONENT_NAME, title, rows },
      }
      if (!deps.appendFixtureMessage(card)) {
        return { ok: false, reason: 'no-active-session' }
      }
      return { ok: true }
    },
  }
}

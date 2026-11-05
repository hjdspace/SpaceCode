/**
 * 程序层 Gate / 准入 Fast Path（T16 #86，设计 §6.1）。
 *
 * 纯函数：只依据 Policy 与 Trigger 事实做同步判定，不调用模型、不碰引擎端口、
 * 不创建 shell、不执行代码。矩阵：scope（channel 允许列表）× 名单（allowlist）
 * × @Agent（addressed）→ explicit / inferred / 不进入（filtered 带稳定原因码）。
 *
 * bot 名单优先于事件自述的 human 标记：身份由 Policy 拥有，事件不能冒充。
 * 名单只在 Trigger 自己的 Source 内生效，跨 Source 不做身份映射。
 */
import type {
  SuperAgentMandateBasis,
  SuperAgentMandateStrength,
  SuperAgentPolicy,
  SuperAgentSourceAdmission,
  SuperAgentTrigger,
} from './model'

/** 未配置准入表的 Source 走保守默认：只有 addressed 的人消息成为 explicit 候选。 */
export const DEFAULT_SUPER_AGENT_POLICY: SuperAgentPolicy = {
  version: 1,
  acceptMode: 'off',
  rules: [],
  admissions: [],
}

/** Gate 的稳定过滤原因码，落 Trigger.disposition.filtered。 */
export const GATE_FILTER_OUT_OF_SCOPE = 'out-of-scope'
export const GATE_FILTER_NOT_ADMITTED = 'not-admitted'

export type SuperAgentGateResult =
  | {
      admitted: true
      strength: SuperAgentMandateStrength
      basis: SuperAgentMandateBasis
      bot: boolean
    }
  | { admitted: false; filtered: string }

/** 准入分支（admitted: true）的判定结果。 */
export type SuperAgentGateAdmission = Extract<SuperAgentGateResult, { admitted: true }>

export function gateTrigger(policy: SuperAgentPolicy, trigger: SuperAgentTrigger): SuperAgentGateResult {
  const entry: SuperAgentSourceAdmission | null =
    policy.admissions.find((candidate) => candidate.source === trigger.source) ?? null

  // scope：配置了 channel 允许列表时，不在列表内的 channel 一律不进入。
  if (
    entry &&
    entry.channels.length > 0 &&
    (trigger.channel === null || !entry.channels.includes(trigger.channel))
  ) {
    return { admitted: false, filtered: GATE_FILTER_OUT_OF_SCOPE }
  }

  // bot 名单：身份由 Policy 拥有，最多 inferred，不能显式请求（即使被 @）。
  if (entry && entry.bots.includes(trigger.actor)) {
    return { admitted: true, strength: 'inferred', basis: 'bot', bot: true }
  }

  // @Agent 的人消息 → explicit。
  if (trigger.addressed !== null && trigger.human) {
    return { admitted: true, strength: 'explicit', basis: 'addressed', bot: false }
  }

  // 名单内的人消息（未 @）→ inferred/admission。
  if (entry && trigger.human && entry.allowlist.includes(trigger.actor)) {
    return { admitted: true, strength: 'inferred', basis: 'admission', bot: false }
  }

  return { admitted: false, filtered: GATE_FILTER_NOT_ADMITTED }
}

/** 深拷贝 Policy 规则列表，避免外部可变引用渗入领域状态。 */
export function clonePolicyRules(rules: SuperAgentPolicy['rules']): SuperAgentPolicy['rules'] {
  return rules.map((rule) => ({ name: rule.name, instruction: rule.instruction }))
}

/** 深拷贝每 Source 准入表，避免外部可变引用渗入领域状态。 */
export function clonePolicyAdmissions(
  admissions: SuperAgentPolicy['admissions'],
): SuperAgentPolicy['admissions'] {
  return admissions.map((entry) => ({
    source: entry.source,
    channels: [...entry.channels],
    allowlist: [...entry.allowlist],
    bots: [...entry.bots],
  }))
}

/** 深拷贝 Policy，避免外部可变引用渗入领域状态。 */
export function cloneSuperAgentPolicy(policy: SuperAgentPolicy): SuperAgentPolicy {
  return {
    version: policy.version,
    acceptMode: policy.acceptMode,
    rules: clonePolicyRules(policy.rules),
    admissions: clonePolicyAdmissions(policy.admissions),
  }
}

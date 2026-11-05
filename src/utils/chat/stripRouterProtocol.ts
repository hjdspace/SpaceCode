/**
 * 剥掉 Router 与宿主之间的建单协议块（IM 展示模式用）。
 *
 * ```super-agent:route 块里是给宿主解析的 JSON：它的结果已经变成工单卡片
 * 出现在同一条时间线里，把协议本身贴给人看只会造成噪音。
 *
 * 流式过程中围栏可能还没闭合，所以除了成对块，还要把「已开栏但未闭合」的尾巴
 * 一并吞掉 —— 否则人会先看到半截 JSON，收口时它又突然消失。
 */
import { SUPER_AGENT_ROUTE_FENCE } from '@/shared/channels/superAgent'

/**
 * 成对的协议块（已闭合）。
 *
 * 前导换行与尾随换行一起吃掉：块夹在两段正文中间时，只删前半会让上下各留一个
 * 空行，气泡里凭空多出一道空白。
 */
const CLOSED_PATTERN = new RegExp(
  `(^|\\n)[ \\t]*\`{3}${SUPER_AGENT_ROUTE_FENCE}[\\s\\S]*?\`{3}[ \\t]*\\n?`,
  'g',
)

/** 只开了栏、还没闭合的协议块（流式中）。 */
const OPEN_PATTERN = new RegExp(
  `(^|\\n)[ \\t]*\`{3}${SUPER_AGENT_ROUTE_FENCE}[\\s\\S]*$`,
)

export function stripSuperAgentRouterProtocol(text: string): string {
  const withoutClosed = text.replace(CLOSED_PATTERN, '')
  const openMatch = OPEN_PATTERN.exec(withoutClosed)
  const cut = openMatch ? withoutClosed.slice(0, openMatch.index) : withoutClosed
  return cut.replace(/[\s]+$/, '')
}

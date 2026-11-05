/**
 * Router 的路由协议严格解析（与 reportParser 同一取向，T06 #76 的做法复用）。
 *
 * Router 的回复里最多一个 ```super-agent:route 围栏块，块内是一份 JSON：
 *   {"version":2,"routes":[
 *     {"kind":"accept","title":"…","note":"路由说明"},
 *     {"kind":"attach","ticketId":"…","note":"路由说明"},
 *     {"kind":"stop","ticketId":"…"},
 *     {"kind":"ignore","reason":"…"}]}
 *
 * 工单目标不在这个协议里：宿主把本轮人的原话无条件带给 Worker（见 routerRunner），
 * `note` 只放路由背景或人明确给出的约束 —— 转述与扩写进不了 Worker 的视野。
 *
 * 严格校验，失败一律抛稳定错误码（refused 类），不猜意图：
 *   routeNotUnique   — 出现多个块（相互矛盾的路由指令不能任选其一执行）
 *   routeUnparsable  — JSON 无法解析
 *   routeInvalid     — 字段缺失/类型不符/越界条数/未知字段
 * 没有块是正常路径（纯闲聊），返回空 routes，不报错。
 *
 * 授权边界：解析出来的只是「建议路由」，实际建单仍走 Domain.dispatch ——
 * Decision/Mandate 与幂等键都由领域侧生成，模型拿不到授权（设计 §8.4）。
 */
import { SUPER_AGENT_ROUTE_FENCE } from '@/shared/channels/superAgent'
import { superAgentError } from './errors'

/** 一次回复最多给出的路由指令数：再多说明 Router 在拆碎一件事，宁可退回给人看。 */
export const MAX_ROUTER_ROUTES = 4

/**
 * 路由说明的长度上限（设计 §B.11「路由说明 ≤30 字」）。
 * 卡这个字数不是为了排版：装得下实现计划的字段一定会被拿来写实现计划。
 */
export const MAX_ROUTE_NOTE_CHARS = 30

const ROUTE_BLOCK_PATTERN = new RegExp(
  `(^|\\n)[ \\t]*\`\`\`${SUPER_AGENT_ROUTE_FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?\`\`\``,
  'g',
)

const ROOT_FIELDS = new Set(['version', 'routes'])
/** 每种 kind 允许的字段；多一个就按 routeInvalid 拒，不静默忽略。 */
const ROUTE_FIELDS: Record<SuperAgentRouteKind, ReadonlySet<string>> = {
  accept: new Set(['kind', 'title', 'note']),
  attach: new Set(['kind', 'ticketId', 'note']),
  stop: new Set(['kind', 'ticketId', 'note']),
  ignore: new Set(['kind', 'reason']),
}

export type SuperAgentRouteKind = 'accept' | 'attach' | 'stop' | 'ignore'

export type SuperAgentRouteAction =
  | { kind: 'accept'; title: string; note: string | null }
  | { kind: 'attach'; ticketId: string; note: string | null }
  | { kind: 'stop'; ticketId: string; note: string | null }
  | { kind: 'ignore'; reason: string | null }

export interface ParsedSuperAgentRoute {
  routes: SuperAgentRouteAction[]
  /** 命中的原文块（审计用；不进入任何 UI 投影）。 */
  raw: string | null
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw superAgentError('routeInvalid', { field })
  }
  return value.trim()
}

/** `note` 可缺省；给了就必须是有界的路由说明，不是任务书。 */
function optionalNote(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  const note = requireNonEmptyString(value, field)
  if (note.length > MAX_ROUTE_NOTE_CHARS) {
    throw superAgentError('routeInvalid', { field: `${field}.length` })
  }
  return note
}

function optionalReason(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  return requireNonEmptyString(value, field)
}

/** 提取回复中的全部块原文。 */
export function findSuperAgentRouteBlocks(text: string): string[] {
  const blocks: string[] = []
  for (const match of text.matchAll(ROUTE_BLOCK_PATTERN)) {
    blocks.push((match[2] ?? '').trim())
  }
  return blocks
}

function toRouteAction(value: unknown, index: number): SuperAgentRouteAction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw superAgentError('routeInvalid', { field: `routes[${index}]` })
  }
  const route = value as Record<string, unknown>
  // kind 是判别式，不是内容：多余的空白来自 JSON 排版，trim 它不算猜意图。
  const kind = typeof route.kind === 'string' ? route.kind.trim() : route.kind
  if (kind !== 'accept' && kind !== 'attach' && kind !== 'stop' && kind !== 'ignore') {
    throw superAgentError('routeInvalid', { field: `routes[${index}].kind` })
  }
  for (const field of Object.keys(route)) {
    if (!ROUTE_FIELDS[kind].has(field)) {
      throw superAgentError('routeInvalid', { field: `routes[${index}].${field}` })
    }
  }
  const note = optionalNote(route.note, `routes[${index}].note`)
  if (kind === 'accept') {
    return { kind, title: requireNonEmptyString(route.title, `routes[${index}].title`), note }
  }
  if (kind === 'ignore') {
    return { kind, reason: optionalReason(route.reason, `routes[${index}].reason`) }
  }
  return {
    kind,
    ticketId: requireNonEmptyString(route.ticketId, `routes[${index}].ticketId`),
    note,
  }
}

/**
 * 解析整条 Router 回复。
 *
 * 无块 → `{routes: [], raw: null}`（纯对话，正常路径）；
 * 有块 → 严格校验后返回路由指令清单。
 */
export function parseSuperAgentRouteText(text: string): ParsedSuperAgentRoute {
  const blocks = findSuperAgentRouteBlocks(text)
  if (blocks.length === 0) return { routes: [], raw: null }
  if (blocks.length > 1) throw superAgentError('routeNotUnique')

  const raw = blocks[0]
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw superAgentError('routeUnparsable')
  }

  const record = value as Record<string, unknown>
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw superAgentError('routeInvalid', { field: 'root' })
  }
  for (const field of Object.keys(record)) {
    if (!ROOT_FIELDS.has(field)) throw superAgentError('routeInvalid', { field })
  }
  if (record.version !== 2) throw superAgentError('routeInvalid', { field: 'version' })

  const routesRaw = record.routes
  if (!Array.isArray(routesRaw) || routesRaw.length === 0) {
    throw superAgentError('routeInvalid', { field: 'routes' })
  }
  if (routesRaw.length > MAX_ROUTER_ROUTES) {
    throw superAgentError('routeInvalid', { field: 'routes.length' })
  }

  return { routes: routesRaw.map(toRouteAction), raw }
}

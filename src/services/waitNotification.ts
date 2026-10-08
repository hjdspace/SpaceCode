// src/services/waitNotification.ts
// 会话因"等用户处理"而停住时的桌面系统通知。
// 三类中断（工具授权 / AskUserQuestion 提问 / ExitPlanMode 计划确认）都经
// permission_request 到达（见 src/stores/turn/index.ts 的 onPermissionRequest），
// 本模块只负责分类、文案与去重；发送通道与任务完成通知完全一致（api.showNotification）。

import { api } from '@/services/electronAPI'
import { i18n } from '@/i18n'
import type { PermissionRequest } from '@/services/permissionService'

export type WaitingKind = 'question' | 'plan' | 'permission'
/** 通知决策结果，供调用方打日志（渲染层日志不落盘，出问题时靠它定位） */
export type WaitingNotifyResult = 'sent' | 'disabled' | 'deduped'

export interface WaitingNotifyEnv {
  /** 用户是否开启了"等待处理"桌面通知 */
  enabled: () => boolean
  /** 用于通知标题的会话显示名 */
  sessionTitle: () => string
}

/** 同一 session 同一类别在该窗口内只通知一次，避免并行工具审批刷屏 */
const NOTIFY_DEDUPE_MS = 5_000
/** 通知正文里问题/授权摘要的最大长度 */
const MAX_SUMMARY_LENGTH = 60

const notifiedAt = new Map<string, number>()

export function classifyWaitingRequest(toolName: string): WaitingKind {
  if (toolName === 'AskUserQuestion') return 'question'
  if (toolName === 'ExitPlanMode') return 'plan'
  return 'permission'
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= MAX_SUMMARY_LENGTH) return flat
  return `${flat.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
}

/** 引擎权限卡上的工具中文名缺失时回退到原始工具名（与 PermissionRequestCard 一致） */
function toolLabel(request: PermissionRequest): string {
  if (request.displayName) return request.displayName
  const key = `permission.card.toolNames.${request.toolName}`
  const translated = i18n.global.t(key)
  return translated === key ? request.toolName : String(translated)
}

function firstQuestion(request: PermissionRequest): string {
  const questions = request.input?.questions
  if (!Array.isArray(questions)) return ''
  const first = questions[0] as { question?: unknown; header?: unknown } | undefined
  const text = typeof first?.question === 'string' ? first.question : String(first?.header ?? '')
  return truncate(text)
}

export function buildWaitingMessage(request: PermissionRequest): string {
  const t = i18n.global.t
  const kind = classifyWaitingRequest(request.toolName)

  if (kind === 'plan') {
    return String(t('chat.waitingPlanNotifyBody'))
  }
  if (kind === 'question') {
    const question = firstQuestion(request)
    return question
      ? String(t('chat.waitingQuestionNotifyBody', { detail: question }))
      : String(t('chat.waitingQuestionNotifyBodyPlain'))
  }

  const detail = request.description ? truncate(request.description) : toolLabel(request)
  return String(t('chat.waitingPermissionNotifyBody', { detail }))
}

/**
 * 会话进入"等待用户回答/授权"状态时弹出系统通知。
 * 已在该 session 同类别去重窗口内通知过则跳过（引擎对同一轮可能连发多条 permission_request）。
 */
export function notifyWaitingForUser(
  sessionId: string,
  request: PermissionRequest,
  env: WaitingNotifyEnv,
): WaitingNotifyResult {
  if (!env.enabled()) return 'disabled'

  const key = `${sessionId}:${classifyWaitingRequest(request.toolName)}`
  const now = Date.now()
  const last = notifiedAt.get(key)
  if (last && now - last < NOTIFY_DEDUPE_MS) return 'deduped'
  notifiedAt.set(key, now)

  api.showNotification({
    title: String(i18n.global.t('chat.waitingNotifyTitle', { session: env.sessionTitle() })),
    message: buildWaitingMessage(request),
  })
  return 'sent'
}

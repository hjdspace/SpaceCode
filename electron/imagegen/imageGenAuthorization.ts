/**
 * 生图的宿主授权闸门。
 *
 * 这是本功能第一次真的往外发计费请求，所以授权由宿主自持：不挂任一引擎的权限管线
 * （两个引擎的管线形态不同，挂上去就等于把「有没有问过用户」交给引擎决定）。
 *
 * 复用既有的宿主问答通道（select 形态的扩展对话框），没有新卡片、没有新 IPC 通道。
 * 本模块零 fs、零 electron：发帧、读权限模式、语言与计时都由调用方注入。
 */
import { randomUUID } from 'crypto'
import { EXTENSION_DIALOG_WATCHDOG_MS } from '@/shared/channels/claudeCode'
import type {
  ExtensionDialogAnswer,
  ExtensionDialogClosedEvent,
  ExtensionDialogRequest,
  PermissionMode,
} from '@/shared/channels/claudeCode'

export type ImageGenDecision = 'allow' | 'always' | 'deny'

export interface ImageGenAuthorizationRequest {
  sessionId: string | null
  provider: string
  model: string
  count: number
  prompt: string
  /** 有值即为改图：卡片要让用户看出这次是在改他们那张图，以及送出去几张参考图。 */
  referenceCount?: number
}

export interface ImageGenAuthorizationDeps {
  sendDialog: (sessionId: string, request: ExtensionDialogRequest) => void
  sendClosed: (sessionId: string, event: ExtensionDialogClosedEvent) => void
  permissionMode: (sessionId: string | null) => PermissionMode | undefined
  locale?: () => string
  mintId?: () => string
  trace?: (message: string) => void
  watchdogMs?: number
}

export interface ImageGenAuthorization {
  authorize: (request: ImageGenAuthorizationRequest) => Promise<ImageGenDecision>
  /** 命中宿主自铸的对话框就地结算并返回 true；未命中返回 false，调用方原样透传给引擎。 */
  respond: (dialogId: string, answer: ExtensionDialogAnswer) => boolean
}

type Locale = 'zh-CN' | 'en-US'

/** 选项顺序即决议顺序：allow / always / deny。应答按序号认，语言中途换了也不会错位。 */
const DECISIONS: ImageGenDecision[] = ['allow', 'always', 'deny']

const TEXT: Record<
  Locale,
  { title: string; editTitle: string; options: string[]; billing: string; reference: string; labels: [string, string, string, string] }
> = {
  'zh-CN': {
    title: '允许这次生图吗？',
    editTitle: '允许这次改图吗？',
    options: ['允许一次', '本会话总是允许', '拒绝'],
    billing: '这会向供应商发出一次计费请求，费用计入你自己的账号。',
    reference: '参考图：{count} 张',
    labels: ['供应商：', '模型：', '张数：', '提示词：'],
  },
  'en-US': {
    title: 'Allow this image generation?',
    editTitle: 'Allow this image edit?',
    options: ['Allow once', 'Always allow for this session', 'Deny'],
    billing: 'This sends a billable request to the provider; the cost is charged to your own account.',
    reference: 'Reference images: {count}',
    labels: ['Provider: ', 'Model: ', 'Images: ', 'Prompt: '],
  },
}

/** 提示词可能很长也可能带换行：折成一行摘要，卡片上不该出现第二段落。 */
function promptSummary(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim()
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat
}

interface PendingDialog {
  sessionId: string
  options: string[]
  timer: NodeJS.Timeout
  settle: (decision: ImageGenDecision) => void
}

export function createImageGenAuthorization(deps: ImageGenAuthorizationDeps): ImageGenAuthorization {
  const pending = new Map<string, PendingDialog>()
  // 「本会话总是允许」只活在这份内存里：不写配置、不跨重启，换个会话重新问。
  const alwaysAllowed = new Set<string>()
  const mintId = deps.mintId ?? (() => `imagegen-${randomUUID()}`)
  const watchdogMs = deps.watchdogMs ?? EXTENSION_DIALOG_WATCHDOG_MS

  function close(entry: PendingDialog, dialogId: string, reason: ExtensionDialogClosedEvent['reason']): void {
    deps.sendClosed(entry.sessionId, { dialogId, method: 'select', reason })
  }

  return {
    authorize(request) {
      const sessionId = request.sessionId
      // 没有会话就没有能应答的卡片：这一步要花钱，问不到人就不发。
      if (!sessionId) return Promise.resolve('deny')
      if (alwaysAllowed.has(sessionId)) return Promise.resolve('allow')
      // 免问只认用户自己选的那个模式：引擎报上来的 permissionMode 就是用户意图，
      // 不是宿主替用户放宽的口径。留痕是为了事后能查「这次为什么没问」。
      if (deps.permissionMode(sessionId) === 'bypassPermissions') {
        deps.trace?.(`Image generation auto-allowed by permissionMode=bypassPermissions (session ${sessionId})`)
        return Promise.resolve('allow')
      }
      const locale: Locale = deps.locale?.() === 'en-US' ? 'en-US' : 'zh-CN'
      const text = TEXT[locale]
      const dialogId = mintId()
      const options = [...text.options]
      const dialog: ExtensionDialogRequest = {
        dialogId,
        method: 'select',
        title: request.referenceCount ? text.editTitle : text.title,
        message: [
          `${text.labels[0]}${request.provider}`,
          `${text.labels[1]}${request.model}`,
          `${text.labels[2]}${request.count}`,
          ...(request.referenceCount
            ? [text.reference.replace('{count}', String(request.referenceCount))]
            : []),
          `${text.labels[3]}${promptSummary(request.prompt)}`,
          text.billing,
        ].join('\n'),
        options,
      }

      return new Promise<ImageGenDecision>(resolve => {
        // 无人应答就拒绝：这是要花钱的一步，等不到答案时绝不能默认放行，也不能把 MCP 调用挂死。
        const timer = setTimeout(() => {
          const expired = pending.get(dialogId)
          if (!expired) return
          pending.delete(dialogId)
          close(expired, dialogId, 'watchdog')
          expired.settle('deny')
        }, watchdogMs)
        pending.set(dialogId, { sessionId, options, timer, settle: resolve })
        deps.sendDialog(sessionId, dialog)
      })
    },

    respond(dialogId, answer) {
      const entry = pending.get(dialogId)
      if (!entry) return false
      pending.delete(dialogId)
      clearTimeout(entry.timer)
      const index = answer.kind === 'value' ? entry.options.indexOf(answer.value) : -1
      // 认不出的值与「关闭卡片」都算拒绝：这是要花钱的一步，存疑就不发。
      const decision = index >= 0 ? DECISIONS[index] : 'deny'
      if (decision === 'always') alwaysAllowed.add(entry.sessionId)
      close(entry, dialogId, 'answered')
      entry.settle(decision)
      return true
    },
  }
}

// ── 宿主登记表：网关在把答案交给引擎之前先问这里 ──────────────────────
//
// 登记表放在这个零依赖模块里，是为了让 engineGateway 能 import 它而不成环：
// 闸门实例由应用启动时接线（那一步才碰 electron 与引擎），网关只认这个查询口。

let hostAuthorization: ImageGenAuthorization | null = null

export function setImageGenAuthorization(instance: ImageGenAuthorization | null): void {
  hostAuthorization = instance
}

/** 命中 = 宿主自铸的授权卡，已就地结算；未命中 = 引擎自己的对话框，调用方原样透传。 */
export function respondImageGenDialog(dialogId: string, answer: ExtensionDialogAnswer): boolean {
  return hostAuthorization?.respond(dialogId, answer) ?? false
}
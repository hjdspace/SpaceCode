/**
 * 沙箱侧动作接线（票 03）。
 *
 * 官方渲染器把 schema 里的 action 交给 `customActions[name].execute(params, context)`。
 * 这里只做参数规范化：渲染器允许 `copy` / `openLink` 直接传字符串，也允许传
 * `{ text }` / `{ url }`；缺值时干脆不发动作。白名单、协议与限额的判定全在宿主桥，
 * 沙箱不复制那套规则 —— 否则两边漂移时以谁为准就说不清了。
 */
import type { GenuiCardActionName } from '@/shared/genuiSandbox'
import type { CardActionRequest } from '@/lib/genui/cardRenderer'

export type SandboxCardAction = {
  execute: (params: unknown, context: Record<string, unknown>) => void
}

type RequestAction = (request: CardActionRequest) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `copy` / `openLink` 的渲染器参数：字符串或带字段的对象。 */
function readString(params: unknown, key: 'text' | 'url'): string | null {
  if (typeof params === 'string') return params
  if (!isRecord(params)) return null
  const value = params[key]
  return typeof value === 'string' ? value : null
}

export function createSandboxCardActions(
  requestAction: RequestAction,
): Record<GenuiCardActionName, SandboxCardAction> {
  return {
    copy: {
      execute(params) {
        const text = readString(params, 'text')
        if (text === null) return
        requestAction({ action: 'copy', payload: { text } })
      },
    },
    expand: {
      execute() {
        requestAction({ action: 'expand' })
      },
    },
    openLink: {
      execute(params) {
        const url = readString(params, 'url')
        if (url === null) return
        requestAction({ action: 'openLink', payload: { url } })
      },
    },
    submit: {
      execute(params) {
        requestAction({ action: 'submit', payload: isRecord(params) ? params : {} })
      },
    },
  }
}

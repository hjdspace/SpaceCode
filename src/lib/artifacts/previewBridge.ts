/**
 * 产物预览桥的宿主侧闸门（Issue #62）。
 *
 * 预览 iframe 里跑的是**不可信 HTML**（模型生成或设计工作区产物），因此回传消息
 * 必须先证来源、再按动作白名单分发：
 *   1. 窗口通道：`event.source === 本 iframe.contentWindow` 且 nonce 匹配；
 *   2. 动作白名单：只有 alert / confirm / open / error / ready 五类，其余丢弃，
 *      绝不落到通用 IPC；
 *   3. 外链只放行绝对 `http:` / `https:`，`file:` 等协议不进 `shell.openExternal`。
 *
 * nonce 的语义边界要说清：它写进了预览文档，文档自身的脚本读得到，所以它**不是**
 * 授权凭据，而是一份"这个 frame 仍是我们写入的那份文档"的来源证明 —— 挡住弹窗、
 * 同窗口其他 iframe（如 GenUI 卡片）与 frame 导航后的外来文档。真正的授权是上面的
 * 动作白名单与协议闸门。
 */
import { createUuid } from '@/utils/uuid'
import { isSafeExternalUrl } from '@/utils/safeUrl'
import {
  PREVIEW_MAX_HTML_CHARS,
  PREVIEW_MSG_ALERT,
  PREVIEW_MSG_CONFIRM,
  PREVIEW_MSG_ERROR,
  PREVIEW_MSG_OPEN,
  PREVIEW_MSG_READY,
  PREVIEW_MSG_TRANSPORT,
  PREVIEW_SANDBOX_SHIM_ID,
  PREVIEW_TRANSPORT_BRIDGE_ID,
} from '@/shared/previewDocument'

// 协议常量与主进程共用一份，渲染端既有调用点仍从这里取
export {
  PREVIEW_MAX_HTML_CHARS,
  PREVIEW_MSG_ALERT,
  PREVIEW_MSG_CONFIRM,
  PREVIEW_MSG_ERROR,
  PREVIEW_MSG_OPEN,
  PREVIEW_MSG_READY,
  PREVIEW_MSG_TRANSPORT,
  PREVIEW_SANDBOX_SHIM_ID,
  PREVIEW_TRANSPORT_BRIDGE_ID,
}

/** 通知/错误文本上限：只用于展示与日志，超限直接丢弃。 */
export const PREVIEW_MAX_TEXT_CHARS = 8_192

/**
 * 等 frame 侧桥开口的时限。srcdoc 里注入的脚本可能被宿主 CSP 拦掉（当前线上就是
 * 这样），此时永远收不到 ready；超时后退回整文档重载，至少保证预览内容继续更新。
 */
export const PREVIEW_BRIDGE_READY_TIMEOUT_MS = 1_500

export type PreviewBridgeAction =
  | { type: 'ready' }
  | { type: 'alert'; message: string }
  | { type: 'confirm'; message: string }
  | { type: 'open'; url: string }
  | { type: 'error'; message: string; filename: string; lineno: number }

export function createPreviewNonce(): string {
  return createUuid()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bridgeText(value: unknown): string | null {
  return typeof value === 'string' && value.length <= PREVIEW_MAX_TEXT_CHARS ? value : null
}

/**
 * 把一条来自预览 frame 的消息归一成宿主可执行的动作。
 * 来源（event.source）由调用方先校验；这里只管密钥、类型白名单与 payload。
 */
export function parsePreviewOutbound(data: unknown, nonce: string): PreviewBridgeAction | null {
  if (!isRecord(data) || data.nonce !== nonce || typeof data.type !== 'string') return null

  switch (data.type) {
    case PREVIEW_MSG_READY:
      return { type: 'ready' }

    case PREVIEW_MSG_ALERT: {
      const message = bridgeText(data.message)
      return message === null ? null : { type: 'alert', message }
    }

    case PREVIEW_MSG_CONFIRM: {
      const message = bridgeText(data.message)
      return message === null ? null : { type: 'confirm', message }
    }

    case PREVIEW_MSG_OPEN:
      return isSafeExternalUrl(data.url) ? { type: 'open', url: data.url } : null

    case PREVIEW_MSG_ERROR: {
      const message = bridgeText(data.message)
      if (message === null) return null
      return {
        type: 'error',
        message,
        filename: bridgeText(data.filename) ?? '',
        lineno: typeof data.lineno === 'number' && Number.isFinite(data.lineno) ? data.lineno : 0,
      }
    }

    default:
      return null
  }
}

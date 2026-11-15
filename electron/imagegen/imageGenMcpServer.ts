/**
 * 生图 MCP 服务器 —— 协议与安全外壳在 tools/loopbackMcpServer，这一层只提供
 * 生图的工具表、说明书、宿主授权闸门的接线与单例生命周期。
 *
 * 内置服务器不写进 mcp-servers.json：它只作为 spawn 时的额外条目存在，
 * 所以用户的 MCP 设置列表里看不到它，也就无从误删。
 */
import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { claudeCodeNamespace } from '@/shared/channels/claudeCode'
import type { ExtensionDialogClosedEvent, ExtensionDialogRequest, PermissionMode } from '@/shared/channels/claudeCode'
import type { ImageGenConfig } from '@/shared/imageGenReference'
import { createImageGenAuthorization, setImageGenAuthorization } from './imageGenAuthorization'
import { cancelAllImageGenWork } from './imageGenWork'
import { callImageGenTool, IMAGEGEN_MAX_BATCH, IMAGEGEN_MAX_INPUT_IMAGES, IMAGEGEN_MAX_VARIANTS, IMAGEGEN_MCP_SERVER_KEY, IMAGEGEN_MCP_TOOLS } from './imageGenTools'
import { loadImageGenConfig } from './imageGenConfig'
import { info, warn } from '../infra/logger'
import { createLoopbackMcpServer, type LoopbackMcpEntry, type LoopbackMcpServer } from '../tools/loopbackMcpServer'

const SERVER_INSTRUCTIONS = [
  'generate_image produces a raster image from a text prompt and saves it into the workspace image output directory.',
  `edit_image changes existing workspace images (1-${IMAGEGEN_MAX_INPUT_IMAGES} references) and saves the result as a new file; it never overwrites the sources. When the user points at an image they want changed, use edit_image rather than generate_image.`,
  `generate_image and edit_image take n (1-${IMAGEGEN_MAX_VARIANTS}) for variants of one prompt; generate_batch takes prompts (1-${IMAGEGEN_MAX_BATCH}) for a set of different assets. Over either limit the call is rejected — split it yourself, never expect truncation.`,
  'If editing is refused because the provider does not support it, report that and stop. Never substitute a fresh generate_image call for a failed edit.',
  'Generation is billable: the host asks the user for authorization before the request goes out, stating how many images this call will generate. A denial is a final answer for that call — do not retry it without the user asking again.',
  'Never retry a cancelled, timed-out or failed image request on your own. Report what happened and let the user decide.',
  'Results come back in input order with a per-image status: succeeded, failed or cancelled. Report those separately — a cancelled image was not a failure, and images already saved stay on disk.',
  'Cancelling aborts the local request only. It cannot guarantee the provider stops working or stops billing for requests already sent.',
  'The tool result carries the absolute file path, the size and the model that actually ran. Report that path to the user; never paste base64 image data.',
  'You cannot see the generated image. Do not claim to have inspected it.',
].join('\n')

const DIALOG_REQUEST_CHANNEL = `claude-code:${claudeCodeNamespace.events.onExtensionDialogRequest.channel}`
const DIALOG_CLOSED_CHANNEL = `claude-code:${claudeCodeNamespace.events.onExtensionDialogClosed.channel}`

export interface ImageGenMcpHostOptions {
  /** 用户自己选的每会话权限模式；由调用方注入，避免这一层与引擎网关互相 import 成环。 */
  permissionMode: (sessionId: string | null) => PermissionMode | undefined
  loadConfig?: () => ImageGenConfig | null
  fetchImpl?: typeof fetch
  locale?: () => string
}

function broadcast(channel: string, sessionId: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, { sessionId, data })
  }
}

/** 界面语言存在渲染层写下的 gui-settings.json 里，主进程只读取，不维护第二份状态。 */
function readGuiLocale(): string {
  try {
    const path = join(app.getPath('home'), '.claude', 'gui-settings.json')
    if (!existsSync(path)) return 'zh-CN'
    return JSON.parse(readFileSync(path, 'utf-8'))?.language === 'en-US' ? 'en-US' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

let instance: LoopbackMcpServer | null = null
let starting: Promise<LoopbackMcpServer> | null = null

export function startImageGenMcpServer(options: ImageGenMcpHostOptions): Promise<LoopbackMcpServer> {
  if (instance) return Promise.resolve(instance)
  if (!starting) {
    const authorization = createImageGenAuthorization({
      sendDialog: (sessionId, request: ExtensionDialogRequest) => broadcast(DIALOG_REQUEST_CHANNEL, sessionId, request),
      sendClosed: (sessionId, event: ExtensionDialogClosedEvent) => broadcast(DIALOG_CLOSED_CHANNEL, sessionId, event),
      permissionMode: options.permissionMode,
      locale: options.locale ?? readGuiLocale,
      trace: message => info('ImageGen', message),
    })
    setImageGenAuthorization(authorization)

    const created = createLoopbackMcpServer({
      serverKey: IMAGEGEN_MCP_SERVER_KEY,
      instructions: SERVER_INSTRUCTIONS,
      logTag: 'ImageGenMcp',
      tools: IMAGEGEN_MCP_TOOLS,
      dispatch: (context, name, args) => callImageGenTool(name, args, context, {
        loadConfig: options.loadConfig ?? loadImageGenConfig,
        authorize: authorization.authorize,
        fetchImpl: options.fetchImpl,
      }),
      unexpectedErrorPrefix: 'The image tool failed unexpectedly',
    })
    starting = created
      .start()
      .then(() => {
        instance = created
        starting = null
        return created
      })
      .catch(err => {
        starting = null
        setImageGenAuthorization(null)
        warn('ImageGenMcp', 'Failed to start; agent image tools will be unavailable', { error: String(err) })
        throw err
      })
  }
  return starting
}

/**
 * 注入给引擎的 MCP 条目。服务器还没起来时返回 null —— 这一轮会话不带生图工具，
 * 而不是给引擎一个连不上的 URL 让它在握手阶段白等到超时。
 */
export function getImageGenMcpEntry(sessionId: string | null, projectRoot?: string | null): LoopbackMcpEntry | null {
  if (!instance || instance.port === 0) return null
  return instance.entry(sessionId, projectRoot)
}

export async function stopImageGenMcpServer(): Promise<void> {
  const current = instance
  instance = null
  starting = null
  // 先掐在途工作再关服务器：连接一断，工具层就没人替这些计费请求收尾了。
  cancelAllImageGenWork('shutdown')
  setImageGenAuthorization(null)
  if (current) await current.stop()
}
import type { Component } from 'vue'
import { BellRing } from 'lucide-vue-next'
import type { HookEventType } from './hooks'

/**
 * 内置 Hook 配置字段定义
 */
export interface BuiltinHookConfigField {
  key: string
  label: string
  placeholder?: string
  hint?: string
  default?: string
  type?: 'text' | 'password' | 'url'
  required?: boolean
}

/**
 * 内置 Hook 提供方（实现具体推送/执行逻辑）
 */
export interface BuiltinHookProvider {
  id: string
  label: string
  description: string
  docsUrl?: string
  configFields: BuiltinHookConfigField[]
  /**
   * 根据配置构建最终写入 hook 的 shell 命令
   * 必须返回单行命令（必要时用 ; 或 && 组合）
   */
  buildCommand: (config: Record<string, string>) => string
}

/**
 * 内置 Hook 定义
 */
export interface BuiltinHookDefinition {
  id: string
  name: string
  description: string
  icon: Component
  category: 'notification' | 'safety' | 'workflow'
  event: HookEventType
  matcher?: string
  timeout?: number
  providers: BuiltinHookProvider[]
}

/* -------------------------------------------------------------------------- */
/* 辅助函数                                                                    */
/* -------------------------------------------------------------------------- */

/** 转义双引号，用于 shell 内嵌 JSON 字符串 */
function escDq(s: string): string {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** URL 编码 */
function enc(s: string): string {
  return encodeURIComponent(String(s ?? ''))
}

/* -------------------------------------------------------------------------- */
/* 第一个内置 Hook：任务完成后发送微信通知（Stop 事件）                          */
/* -------------------------------------------------------------------------- */

const wechatTaskCompleteProviders: BuiltinHookProvider[] = [
  {
    id: 'pushplus',
    label: 'PushPlus',
    description: '通过 PushPlus 推送到微信，需要在 pushplus.plus 申请 token',
    docsUrl: 'https://www.pushplus.plus/',
    configFields: [
      {
        key: 'token',
        label: 'Token',
        placeholder: '在 pushplus.plus 个人中心获取',
        type: 'password',
        required: true,
      },
      {
        key: 'title',
        label: '通知标题',
        placeholder: 'SpaceCode 任务已完成',
        default: 'SpaceCode 任务已完成',
        type: 'text',
      },
      {
        key: 'content',
        label: '通知内容',
        placeholder: '会话已结束，请查看 SpaceCode',
        default: '会话已结束，请查看 SpaceCode',
        type: 'text',
      },
    ],
    buildCommand: (cfg) => {
      const token = enc(cfg.token)
      const title = enc(cfg.title || 'SpaceCode 任务已完成')
      const content = enc(cfg.content || '会话已结束，请查看 SpaceCode')
      // PushPlus 支持 GET 调用，跨平台 curl 兼容
      return `curl -s -o /dev/null "https://www.pushplus.plus/send?token=${token}&title=${title}&content=${content}&template=txt"`
    },
  },
  {
    id: 'server-chan',
    label: 'Server 酱',
    description: '通过 Server 酱（sct.ftqq.com）推送到微信，需要 SendKey',
    docsUrl: 'https://sct.ftqq.com/',
    configFields: [
      {
        key: 'sendKey',
        label: 'SendKey',
        placeholder: '形如 SCTxxxx... 的 key',
        type: 'password',
        required: true,
      },
      {
        key: 'title',
        label: '通知标题',
        placeholder: 'SpaceCode 任务已完成',
        default: 'SpaceCode 任务已完成',
        type: 'text',
      },
      {
        key: 'desp',
        label: '通知描述',
        placeholder: '会话已结束，请查看 SpaceCode',
        default: '会话已结束，请查看 SpaceCode',
        type: 'text',
      },
    ],
    buildCommand: (cfg) => {
      const key = (cfg.sendKey || '').trim()
      const title = enc(cfg.title || 'SpaceCode 任务已完成')
      const desp = enc(cfg.desp || '会话已结束，请查看 SpaceCode')
      return `curl -s -o /dev/null "https://sctapi.ftqq.com/${key}.send?title=${title}&desp=${desp}"`
    },
  },
  {
    id: 'wxwork-webhook',
    label: '企业微信群机器人',
    description: '通过企业微信群机器人 webhook 推送文本消息',
    docsUrl: 'https://developer.work.weixin.qq.com/document/path/91770',
    configFields: [
      {
        key: 'webhookUrl',
        label: 'Webhook 地址',
        placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...',
        type: 'url',
        required: true,
      },
      {
        key: 'content',
        label: '通知内容',
        placeholder: 'SpaceCode 任务已完成 ✅',
        default: 'SpaceCode 任务已完成 ✅',
        type: 'text',
      },
    ],
    buildCommand: (cfg) => {
      const url = (cfg.webhookUrl || '').trim()
      const content = escDq(cfg.content || 'SpaceCode 任务已完成 ✅')
      const body = `{\\"msgtype\\":\\"text\\",\\"text\\":{\\"content\\":\\"${content}\\"}}`
      return `curl -s -o /dev/null -H "Content-Type: application/json" -X POST -d "${body}" "${url}"`
    },
  },
]

/* -------------------------------------------------------------------------- */
/* 内置 Hook 注册表                                                            */
/* -------------------------------------------------------------------------- */

export const BUILTIN_HOOKS: BuiltinHookDefinition[] = [
  {
    id: 'wechat-task-complete',
    name: '任务完成微信通知',
    description: '当 Agent 完成任务时（Stop 事件），通过微信推送通知，方便挂机长任务',
    icon: BellRing,
    category: 'notification',
    event: 'Stop',
    timeout: 10,
    providers: wechatTaskCompleteProviders,
  },
]

export function getBuiltinHook(id: string): BuiltinHookDefinition | undefined {
  return BUILTIN_HOOKS.find(h => h.id === id)
}

export function getBuiltinProvider(
  builtinId: string,
  providerId: string,
): BuiltinHookProvider | undefined {
  return getBuiltinHook(builtinId)?.providers.find(p => p.id === providerId)
}

/** 内置 Hook 写入到 HookFlatItem.name 时使用的前缀，便于识别 */
export const BUILTIN_HOOK_NAME_PREFIX = '[内置]'

/** 生成内置 hook 的展示名 */
export function buildBuiltinHookName(def: BuiltinHookDefinition, provider: BuiltinHookProvider): string {
  return `${BUILTIN_HOOK_NAME_PREFIX} ${def.name} · ${provider.label}`
}

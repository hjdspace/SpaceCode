import type { Component } from 'vue'
import {
  BellRing,
  Shield,
  Sparkles,
  Workflow,
  FileWarning,
  Wrench,
  Archive,
  CheckCircle2,
  Bug,
  AlertOctagon,
  Wand2,
  Database,
} from 'lucide-vue-next'
import type { HookEventType } from './hooks'
import { api as electronAPIService } from '@/services/electronAPI'

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
 * 内置 Hook 提供方
 */
export interface BuiltinHookProvider {
  id: string
  label: string
  description: string
  docsUrl?: string
  configFields: BuiltinHookConfigField[]
  /** 同步构建命令（适用于无需异步资源的 provider，如微信推送） */
  buildCommand?: (config: Record<string, string>) => string
  /** 异步构建命令（适用于需要查询内置脚本根路径的 ECC 类 hook） */
  buildCommandAsync?: (config: Record<string, string>) => Promise<string>
  /** 是否依赖系统 node */
  requiresNode?: boolean
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
  /** 来源标签（'SpaceCode' / 'ECC'），用于分组展示 */
  source?: string
  event: HookEventType
  matcher?: string
  timeout?: number
  providers: BuiltinHookProvider[]
}

/* -------------------------------------------------------------------------- */
/* 通用辅助                                                                    */
/* -------------------------------------------------------------------------- */

function escDq(s: string): string {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function enc(s: string): string {
  return encodeURIComponent(String(s ?? ''))
}

/* -------------------------------------------------------------------------- */
/* 任务完成微信通知（多 provider）                                              */
/* -------------------------------------------------------------------------- */

const wechatTaskCompleteProviders: BuiltinHookProvider[] = [
  {
    id: 'pushplus',
    label: 'PushPlus',
    description: '通过 PushPlus 推送到微信，需要在 pushplus.plus 申请 token',
    docsUrl: 'https://www.pushplus.plus/',
    configFields: [
      { key: 'token', label: 'Token', placeholder: '在 pushplus.plus 个人中心获取', type: 'password', required: true },
      { key: 'title', label: '通知标题', default: 'SpaceCode 任务已完成', type: 'text' },
      { key: 'content', label: '通知内容', default: '会话已结束，请查看 SpaceCode', type: 'text' },
    ],
    buildCommand: (cfg) => {
      const token = enc(cfg.token)
      const title = enc(cfg.title || 'SpaceCode 任务已完成')
      const content = enc(cfg.content || '会话已结束，请查看 SpaceCode')
      return `curl -s -o /dev/null "http://www.pushplus.plus/send?token=${token}&title=${title}&content=${content}&template=txt"`
    },
  },
  {
    id: 'server-chan',
    label: 'Server 酱',
    description: '通过 Server 酱（sct.ftqq.com）推送到微信，需要 SendKey',
    docsUrl: 'https://sct.ftqq.com/',
    configFields: [
      { key: 'sendKey', label: 'SendKey', placeholder: '形如 SCTxxxx... 的 key', type: 'password', required: true },
      { key: 'title', label: '通知标题', default: 'SpaceCode 任务已完成', type: 'text' },
      { key: 'desp', label: '通知描述', default: '会话已结束，请查看 SpaceCode', type: 'text' },
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
      { key: 'webhookUrl', label: 'Webhook 地址', placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...', type: 'url', required: true },
      { key: 'content', label: '通知内容', default: 'SpaceCode 任务已完成 ✅', type: 'text' },
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
/* ECC 内置 Hook（已剔除强依赖 ECC 生态的脚本）                                  */
/* -------------------------------------------------------------------------- */

interface EccHookSpec {
  id: string
  hookId: string
  name: string
  description: string
  icon: Component
  category: 'notification' | 'safety' | 'workflow'
  event: HookEventType
  matcher?: string
  timeout?: number
  /** 是否经过 run-with-flags 包装（带 profile 过滤） */
  wrapped: boolean
  /** 相对内置脚本根的脚本路径 */
  relScript: string
  /** 仅在 wrapped 模式下生效 */
  profiles?: string
}

/**
 * 把内置脚本根路径序列化为单引号字符串内容，转义反斜杠/单引号。
 * 路径会进入 node -e "..."，需要兼容 Windows 反斜杠。
 */
function escSingleQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * 构建 ECC hook 的最终命令。在用户启用 hook 时调用，root 路径由 electron
 * 主进程 IPC 解析（开发模式与打包后路径不同）。
 */
async function buildEccCommand(spec: EccHookSpec): Promise<string> {
  const res = await electronAPIService.getBuiltinHooksRoot()
  if (!res.success || !res.path) {
    throw new Error(res.error || '无法定位内置脚本目录')
  }
  // 统一使用正斜杠路径，跨平台兼容（Windows 也接受）
  const root = res.path.replace(/\\/g, '/').replace(/\/+$/, '')
  const bootstrap = `${root}/scripts/hooks/plugin-hook-bootstrap.js`

  // 在 node -e 内显式调用 bootstrap.main()，并预置 CLAUDE_PLUGIN_ROOT
  const rootLit = escSingleQuoted(root)
  const bootstrapLit = escSingleQuoted(bootstrap)
  const setup =
    `process.env.CLAUDE_PLUGIN_ROOT='${rootLit}';` +
    `process.env.ECC_PLUGIN_ROOT='${rootLit}';` +
    `require('${bootstrapLit}').main()`

  if (spec.wrapped) {
    const profiles = spec.profiles || 'standard,strict'
    return `node -e "${setup}" node scripts/hooks/run-with-flags.js ${spec.hookId} ${spec.relScript} ${profiles}`
  }
  return `node -e "${setup}" node ${spec.relScript}`
}

function makeEccProvider(spec: EccHookSpec): BuiltinHookProvider {
  return {
    id: 'ecc-builtin',
    label: '内置脚本',
    description: '使用 SpaceCode 自带的脚本执行（需要系统已安装 Node.js）',
    configFields: [],
    requiresNode: true,
    buildCommandAsync: () => buildEccCommand(spec),
  }
}

function defineEcc(spec: EccHookSpec): BuiltinHookDefinition {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    icon: spec.icon,
    category: spec.category,
    source: 'ECC',
    event: spec.event,
    matcher: spec.matcher,
    timeout: spec.timeout ?? 30,
    providers: [makeEccProvider(spec)],
  }
}

/* -------------------------- ECC: PreToolUse ------------------------------- */

const eccPreToolUse: BuiltinHookDefinition[] = [
  defineEcc({
    id: 'ecc-pre-bash-dispatcher',
    hookId: 'pre:bash:dispatcher',
    name: 'Bash 前置调度器',
    description: '在 Bash 命令执行前做 dev-server 拦截、tmux 提醒、commit 质量检查等综合校验',
    icon: Workflow,
    category: 'safety',
    event: 'PreToolUse',
    matcher: 'Bash',
    timeout: 30,
    wrapped: false,
    relScript: 'scripts/hooks/pre-bash-dispatcher.js',
  }),
  defineEcc({
    id: 'ecc-pre-write-doc-warning',
    hookId: 'pre:write:doc-file-warning',
    name: '文档文件写入警告',
    description: '在写入 Markdown/文本文件时提醒避免创建临时文档（仅警告，不拦截）',
    icon: FileWarning,
    category: 'workflow',
    event: 'PreToolUse',
    matcher: 'Write',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/doc-file-warning.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-pre-suggest-compact',
    hookId: 'pre:edit-write:suggest-compact',
    name: '上下文压缩建议',
    description: '在合适的节奏点提示手动执行 /compact 释放上下文',
    icon: Archive,
    category: 'workflow',
    event: 'PreToolUse',
    matcher: 'Edit|Write',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/suggest-compact.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-pre-config-protection',
    hookId: 'pre:config-protection',
    name: '配置文件保护',
    description: '拦截对 linter/formatter 配置文件的修改，避免通过弱化规则掩盖代码问题',
    icon: Shield,
    category: 'safety',
    event: 'PreToolUse',
    matcher: 'Write|Edit|MultiEdit',
    timeout: 5,
    wrapped: true,
    relScript: 'scripts/hooks/config-protection.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-pre-gateguard-fact-force',
    hookId: 'pre:edit-write:gateguard-fact-force',
    name: 'GateGuard 事实强制',
    description: '阻止首次 Edit/Write，要求先调研引用方、数据 schema 与用户指令',
    icon: AlertOctagon,
    category: 'safety',
    event: 'PreToolUse',
    matcher: 'Edit|Write|MultiEdit',
    timeout: 5,
    wrapped: true,
    relScript: 'scripts/hooks/gateguard-fact-force.js',
    profiles: 'standard,strict',
  }),
]

/* -------------------------- ECC: PostToolUse ------------------------------ */

const eccPostToolUse: BuiltinHookDefinition[] = [
  defineEcc({
    id: 'ecc-post-bash-dispatcher',
    hookId: 'post:bash:dispatcher',
    name: 'Bash 后置调度器',
    description: 'Bash 命令执行后做日志记录、PR 链接提示、build 通知等综合处理',
    icon: Workflow,
    category: 'workflow',
    event: 'PostToolUse',
    matcher: 'Bash',
    timeout: 30,
    wrapped: false,
    relScript: 'scripts/hooks/post-bash-dispatcher.js',
  }),
  defineEcc({
    id: 'ecc-post-quality-gate',
    hookId: 'post:quality-gate',
    name: '质量门禁',
    description: '编辑文件后运行轻量质量检查',
    icon: CheckCircle2,
    category: 'workflow',
    event: 'PostToolUse',
    matcher: 'Edit|Write|MultiEdit',
    timeout: 30,
    wrapped: true,
    relScript: 'scripts/hooks/quality-gate.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-post-design-quality-check',
    hookId: 'post:edit:design-quality-check',
    name: '设计质量检查',
    description: '当前端编辑趋向模板化通用 UI 时给出警告',
    icon: Wand2,
    category: 'workflow',
    event: 'PostToolUse',
    matcher: 'Edit|Write|MultiEdit',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/design-quality-check.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-post-edit-accumulator',
    hookId: 'post:edit:accumulator',
    name: '编辑文件累积器',
    description: '记录本次响应中编辑过的 JS/TS 文件，供 Stop 时统一格式化和类型检查',
    icon: Database,
    category: 'workflow',
    event: 'PostToolUse',
    matcher: 'Edit|Write|MultiEdit',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/post-edit-accumulator.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-post-edit-console-warn',
    hookId: 'post:edit:console-warn',
    name: 'console.log 警告',
    description: '编辑后提醒文件中包含 console.log 语句',
    icon: Bug,
    category: 'workflow',
    event: 'PostToolUse',
    matcher: 'Edit',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/post-edit-console-warn.js',
    profiles: 'standard,strict',
  }),
]

/* -------------------------- ECC: Stop ------------------------------------- */

const eccStop: BuiltinHookDefinition[] = [
  defineEcc({
    id: 'ecc-stop-format-typecheck',
    hookId: 'stop:format-typecheck',
    name: '格式化与类型检查',
    description: '每次响应结束时，对本次编辑过的 JS/TS 文件批量执行 Biome/Prettier 格式化与 tsc 类型检查',
    icon: Wrench,
    category: 'workflow',
    event: 'Stop',
    matcher: '*',
    timeout: 300,
    wrapped: true,
    relScript: 'scripts/hooks/stop-format-typecheck.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-stop-check-console-log',
    hookId: 'stop:check-console-log',
    name: 'console.log 巡检',
    description: '每次响应结束时检查本次修改的文件是否残留 console.log',
    icon: Bug,
    category: 'workflow',
    event: 'Stop',
    matcher: '*',
    timeout: 30,
    wrapped: true,
    relScript: 'scripts/hooks/check-console-log.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-stop-desktop-notify',
    hookId: 'stop:desktop-notify',
    name: '桌面通知',
    description: '响应结束时发送 macOS / Linux / Windows 桌面通知，带任务摘要',
    icon: BellRing,
    category: 'notification',
    event: 'Stop',
    matcher: '*',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/desktop-notify.js',
    profiles: 'standard,strict',
  }),
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
    source: 'SpaceCode',
    event: 'Stop',
    timeout: 10,
    providers: wechatTaskCompleteProviders,
  },
  ...eccPreToolUse,
  ...eccPostToolUse,
  ...eccStop,
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

/** 内置 Hook 写入到 HookFlatItem.name 时使用的前缀 */
export const BUILTIN_HOOK_NAME_PREFIX = '[内置]'

export function buildBuiltinHookName(def: BuiltinHookDefinition, provider: BuiltinHookProvider): string {
  return `${BUILTIN_HOOK_NAME_PREFIX} ${def.name} · ${provider.label}`
}

/**
 * 异步构建命令：统一封装同步/异步两种 provider
 */
export async function buildProviderCommand(
  provider: BuiltinHookProvider,
  config: Record<string, string>,
): Promise<string> {
  if (provider.buildCommandAsync) {
    return await provider.buildCommandAsync(config)
  }
  if (provider.buildCommand) {
    return provider.buildCommand(config)
  }
  throw new Error(`Provider "${provider.id}" 未实现 buildCommand 或 buildCommandAsync，至少需要实现其中一个`)
}

export function providerRequiresNode(provider: BuiltinHookProvider): boolean {
  return provider.requiresNode === true
}

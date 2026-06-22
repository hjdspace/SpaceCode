import type { Component } from 'vue'
import {
  BellRing,
  Shield,
  ShieldAlert,
  Sparkles,
  Activity,
  Power,
  Workflow,
  FileWarning,
  Wrench,
  Eye,
  BarChart3,
  Archive,
  CheckCircle2,
  Gauge,
  StopCircle,
  PlayCircle,
  Brain,
  Bug,
  PackageCheck,
  AlertOctagon,
  Wand2,
  Database,
} from 'lucide-vue-next'
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
   * 根据配置构建最终写入 hook 的 shell 命令。必须返回单行命令。
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
  /** 用于分组展示的来源标签（如 'ECC' / 'SpaceCode'） */
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
/* 第一个内置 Hook：任务完成微信通知（多 provider）                              */
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
/* ECC 内置 Hook 集（来源：D:\\AI\\ECC）                                         */
/* -------------------------------------------------------------------------- */

/**
 * ECC Hook 共享配置 key，便于在多个 ECC Hook 之间共享同一个 ECC 仓库路径。
 * 配置弹窗在打开时会读取这个 key 自动填充 eccRoot 字段。
 */
export const ECC_ROOT_STORAGE_KEY = 'builtin_hooks_ecc_root'
export const ECC_ROOT_DEFAULT = 'D:/AI/ECC'

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
  /** 是否经过 run-with-flags 包装（带 profile 过滤）。多数 ECC hook 都用这个模式 */
  wrapped: boolean
  /** 相对 ECC 仓库根的脚本路径 */
  relScript: string
  /** 仅在 wrapped 模式下生效，传给 run-with-flags 的 profile 列表 */
  profiles?: string
}

/**
 * 将路径规范化为可嵌入 JS 字符串的形式：统一为正斜杠并去尾部斜杠，
 * 同时拒绝包含单引号的路径以避免命令注入。
 */
function sanitizeEccRoot(input: string): string {
  const root = (input || ECC_ROOT_DEFAULT).trim()
  const normalized = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized.includes("'")) {
    throw new Error('ECC root path cannot contain single quotes')
  }
  return normalized
}

/**
 * 构建 ECC hook 的最终命令。统一通过 plugin-hook-bootstrap.js 入口，
 * 由它负责设置 CLAUDE_PLUGIN_ROOT、stdin 转发、跨平台 spawn 等。
 */
function buildEccCommand(eccRoot: string, spec: EccHookSpec): string {
  const root = sanitizeEccRoot(eccRoot)
  const bootstrap = `${root}/scripts/hooks/plugin-hook-bootstrap.js`
  // 内联 JS：设置 plugin root 并显式调用 bootstrap 的 main()。
  // 这样无须依赖 Node 21+ 的 require.main 行为，老版本 Node 也能正确触发。
  const setup =
    `process.env.CLAUDE_PLUGIN_ROOT='${root}';` +
    `process.env.ECC_PLUGIN_ROOT='${root}';` +
    `require('${bootstrap}').main()`

  if (spec.wrapped) {
    const profiles = spec.profiles || 'standard,strict'
    return `node -e "${setup}" node scripts/hooks/run-with-flags.js ${spec.hookId} ${spec.relScript} ${profiles}`
  }
  return `node -e "${setup}" node ${spec.relScript}`
}

function makeEccProvider(spec: EccHookSpec): BuiltinHookProvider {
  return {
    id: 'ecc',
    label: 'ECC 本地仓库',
    description: '通过本地 ECC 仓库的脚本执行该 hook',
    docsUrl: 'https://github.com/everything-claude-code',
    configFields: [
      {
        key: 'eccRoot',
        label: 'ECC 仓库路径',
        placeholder: ECC_ROOT_DEFAULT,
        default: ECC_ROOT_DEFAULT,
        hint: '指向你本地 ECC 仓库根目录（包含 scripts/hooks/ 子目录）',
        type: 'text',
        required: true,
      },
    ],
    buildCommand: (cfg) => buildEccCommand(cfg.eccRoot || ECC_ROOT_DEFAULT, spec),
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
    name: 'ECC · Bash 前置调度器',
    description: '在 Bash 命令执行前进行 dev-server 拦截、tmux 提醒、commit 质量检查等综合校验',
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
    name: 'ECC · 文档文件警告',
    description: '在写入 Markdown/文本文件时提醒避免非标准文档文件（仅警告，不拦截）',
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
    name: 'ECC · 上下文压缩建议',
    description: '在合适的节奏点（约每 50 次工具调用）提示手动执行 /compact 释放上下文',
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
    id: 'ecc-pre-observe',
    hookId: 'pre:observe:continuous-learning',
    name: 'ECC · 工具调用观察（前）',
    description: '记录每次工具调用的输入，用于持续学习与 ECC2 指标采集',
    icon: Eye,
    category: 'workflow',
    event: 'PreToolUse',
    matcher: '*',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/observe-runner.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-pre-governance-capture',
    hookId: 'pre:governance-capture',
    name: 'ECC · 治理事件捕获（前）',
    description: '捕获密钥、策略违规、审批请求等治理事件（需设置 ECC_GOVERNANCE_CAPTURE=1）',
    icon: ShieldAlert,
    category: 'safety',
    event: 'PreToolUse',
    matcher: 'Bash|Write|Edit|MultiEdit',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/governance-capture.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-pre-config-protection',
    hookId: 'pre:config-protection',
    name: 'ECC · 配置文件保护',
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
    id: 'ecc-pre-mcp-health-check',
    hookId: 'pre:mcp-health-check',
    name: 'ECC · MCP 健康检查（前）',
    description: 'MCP 工具调用前检查服务器健康，拦截到达不健康 MCP 的请求',
    icon: PackageCheck,
    category: 'safety',
    event: 'PreToolUse',
    matcher: '*',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/mcp-health-check.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-pre-gateguard-fact-force',
    hookId: 'pre:edit-write:gateguard-fact-force',
    name: 'ECC · GateGuard 事实强制',
    description: '阻止对同一文件的首次 Edit/Write/MultiEdit，要求先调研引用方、数据 schema 与用户指令',
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

/* -------------------------- ECC: PreCompact ------------------------------- */

const eccPreCompact: BuiltinHookDefinition[] = [
  defineEcc({
    id: 'ecc-pre-compact',
    hookId: 'pre:compact',
    name: 'ECC · 压缩前快照',
    description: '在上下文压缩前保存会话状态，便于压缩后恢复',
    icon: Brain,
    category: 'workflow',
    event: 'PreCompact',
    matcher: '*',
    timeout: 30,
    wrapped: true,
    relScript: 'scripts/hooks/pre-compact.js',
    profiles: 'standard,strict',
  }),
]

/* -------------------------- ECC: SessionStart ----------------------------- */

const eccSessionStart: BuiltinHookDefinition[] = [
  defineEcc({
    id: 'ecc-session-start',
    hookId: 'session:start',
    name: 'ECC · 会话启动引导',
    description: '会话开始时加载上次的上下文并探测包管理器、项目结构等',
    icon: PlayCircle,
    category: 'workflow',
    event: 'SessionStart',
    matcher: '*',
    timeout: 30,
    wrapped: false,
    relScript: 'scripts/hooks/session-start-bootstrap.js',
  }),
]

/* -------------------------- ECC: PostToolUse ------------------------------ */

const eccPostToolUse: BuiltinHookDefinition[] = [
  defineEcc({
    id: 'ecc-post-bash-dispatcher',
    hookId: 'post:bash:dispatcher',
    name: 'ECC · Bash 后置调度器',
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
    name: 'ECC · 质量门禁',
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
    name: 'ECC · 设计质量检查',
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
    name: 'ECC · 编辑文件累积器',
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
    name: 'ECC · console.log 警告',
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
  defineEcc({
    id: 'ecc-post-governance-capture',
    hookId: 'post:governance-capture',
    name: 'ECC · 治理事件捕获（后）',
    description: '从工具输出中提取治理事件（需 ECC_GOVERNANCE_CAPTURE=1）',
    icon: ShieldAlert,
    category: 'safety',
    event: 'PostToolUse',
    matcher: 'Bash|Write|Edit|MultiEdit',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/governance-capture.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-post-session-activity-tracker',
    hookId: 'post:session-activity-tracker',
    name: 'ECC · 会话活动追踪',
    description: '记录每个会话的工具调用次数与文件活动，用于 ECC2 指标',
    icon: Activity,
    category: 'workflow',
    event: 'PostToolUse',
    matcher: '*',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/session-activity-tracker.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-post-observe',
    hookId: 'post:observe:continuous-learning',
    name: 'ECC · 工具调用观察（后）',
    description: '记录每次工具调用的结果，用于持续学习',
    icon: Eye,
    category: 'workflow',
    event: 'PostToolUse',
    matcher: '*',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/observe-runner.js',
    profiles: 'standard,strict',
  }),
  defineEcc({
    id: 'ecc-post-metrics-bridge',
    hookId: 'post:ecc-metrics-bridge',
    name: 'ECC · 指标聚合',
    description: '维护会话级运行指标，供 statusline 与上下文监控使用',
    icon: BarChart3,
    category: 'workflow',
    event: 'PostToolUse',
    matcher: '*',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/ecc-metrics-bridge.js',
    profiles: 'minimal,standard,strict',
  }),
  defineEcc({
    id: 'ecc-post-context-monitor',
    hookId: 'post:ecc-context-monitor',
    name: 'ECC · 上下文监控',
    description: '在上下文耗尽、成本飙升、范围漂移或工具循环时注入告警',
    icon: Gauge,
    category: 'safety',
    event: 'PostToolUse',
    matcher: '*',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/ecc-context-monitor.js',
    profiles: 'standard,strict',
  }),
]

/* -------------------------- ECC: Stop ------------------------------------- */

const eccStop: BuiltinHookDefinition[] = [
  defineEcc({
    id: 'ecc-stop-format-typecheck',
    hookId: 'stop:format-typecheck',
    name: 'ECC · 格式化与类型检查',
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
    name: 'ECC · console.log 巡检',
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
    id: 'ecc-stop-session-end',
    hookId: 'stop:session-end',
    name: 'ECC · 会话状态持久化',
    description: '响应结束时持久化会话状态（依据 transcript_path）',
    icon: StopCircle,
    category: 'workflow',
    event: 'Stop',
    matcher: '*',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/session-end.js',
    profiles: 'minimal,standard,strict',
  }),
  defineEcc({
    id: 'ecc-stop-evaluate-session',
    hookId: 'stop:evaluate-session',
    name: 'ECC · 会话模式提取',
    description: '响应结束时分析会话内容，提取可复用模式',
    icon: Sparkles,
    category: 'workflow',
    event: 'Stop',
    matcher: '*',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/evaluate-session.js',
    profiles: 'minimal,standard,strict',
  }),
  defineEcc({
    id: 'ecc-stop-cost-tracker',
    hookId: 'stop:cost-tracker',
    name: 'ECC · 成本追踪',
    description: '响应结束时记录 token 与成本指标',
    icon: BarChart3,
    category: 'workflow',
    event: 'Stop',
    matcher: '*',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/cost-tracker.js',
    profiles: 'minimal,standard,strict',
  }),
  defineEcc({
    id: 'ecc-stop-desktop-notify',
    hookId: 'stop:desktop-notify',
    name: 'ECC · 桌面通知',
    description: '响应结束时发送 macOS / WSL 桌面通知，带任务摘要',
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

/* -------------------------- ECC: SessionEnd ------------------------------- */

const eccSessionEnd: BuiltinHookDefinition[] = [
  defineEcc({
    id: 'ecc-session-end-marker',
    hookId: 'session:end:marker',
    name: 'ECC · 会话结束标记',
    description: '会话结束时记录生命周期标记并清理（非阻塞）',
    icon: Power,
    category: 'workflow',
    event: 'SessionEnd',
    matcher: '*',
    timeout: 10,
    wrapped: true,
    relScript: 'scripts/hooks/session-end-marker.js',
    profiles: 'minimal,standard,strict',
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
    event: 'Stop',
    timeout: 10,
    providers: wechatTaskCompleteProviders,
  },
  ...eccPreToolUse,
  ...eccPreCompact,
  ...eccSessionStart,
  ...eccPostToolUse,
  ...eccStop,
  ...eccSessionEnd,
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

export function buildBuiltinHookName(def: BuiltinHookDefinition, provider: BuiltinHookProvider): string {
  return `${BUILTIN_HOOK_NAME_PREFIX} ${def.name} · ${provider.label}`
}

/* ----------------------------- 共享 ECC root ------------------------------ */

export function getSharedEccRoot(): string {
  try {
    const v = localStorage.getItem(ECC_ROOT_STORAGE_KEY)
    if (v && v.trim()) return v
  } catch {
    /* ignore */
  }
  return ECC_ROOT_DEFAULT
}

export function setSharedEccRoot(value: string): void {
  try {
    localStorage.setItem(ECC_ROOT_STORAGE_KEY, value)
  } catch {
    /* ignore */
  }
}

export function isEccProvider(providerId: string): boolean {
  return providerId === 'ecc'
}

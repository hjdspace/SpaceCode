/**
 * Pi 引擎的 MCP 投影层 (issue #53)。
 *
 * `mcp-servers.json` 仍是唯一真相源；这里把它**投影**成 pi 认识的
 * `~/.pi/agent/mcp.json`。方向是单向的：面板改的是前者，后者是派生产物，
 * 每次 pi 会话 spawn 前重算，所以永远不会和面板漂移。
 *
 * 为什么不走 Claude 那条 `--mcp-config` 路：pi 1.3 没有这个旗子，也没有
 * 只作用于 mcp 配置文件的 env（`PI_CODING_AGENT_DIR` 会连 settings/models/auth/
 * sessions 一起搬走）。它读 MCP 的唯一入口就是这个文件。
 *
 * 为什么必须做归属合并而不是整份覆盖：这个文件同时属于用户自己跑的独立
 * `pi` CLI，里面可能有手写的 server 和 `$schema` 键。覆盖等于删别人的东西。
 * pi 的校验器对未知字段是原样保留的（core/mcp-servers.js 的
 * validateMcpServerConfig 直接 `return {...value}`），所以我们才能在条目里
 * 打自己的标记 —— 这是"接管共享文件"唯一安全的记账方式。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { debug, info, warn } from '../infra/logger'
import { resolvePiAgentDir } from '../engine/engines/agentDefinitions'
import { builtinNameFromServerKey, resolveBuiltinMcp } from './mcpConfigResolver'
import { loadMcpConfig, type PersistedMcpServer } from './mcpConfigStore'

const TAG = 'PiMcpProjection'

/** 条目里的归属标记键；pi 不认识的键会被原样保留 */
const OWNER_KEY = '_spacecode'

/** pi 里只差 `-` 和 `_` 的名字算同一个命名空间，重复的会被拒绝 */
function nameNamespace(name: string): string {
  return name.replace(/-/g, '_')
}

/** pi 的一条 server 配置；除已知字段外原样透传 */
export interface PiMcpServerEntry {
  type?: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
  exposure?: 'codemode' | 'deferred' | 'direct' | 'hidden'
  description?: string
  timeout?: number
  [OWNER_KEY]?: { key: string }
  [key: string]: unknown
}

export interface PiMcpProjectedEntry {
  /** 写进文件的 server 名，可能与面板里的 key 不同（名字被清洗过） */
  name: string
  /** mcp-servers.json 里的原始 key */
  sourceKey: string
  entry: PiMcpServerEntry
}

export type PiMcpSkipReason =
  /** pi 硬拒 legacy SSE transport，只能告知用户，不做猜测式转换 */
  | 'unsupported-transport'
  | 'invalid-name'
  | 'missing-target'
  /** 与用户自有（非本项目写入）的同命名空间条目撞名 */
  | 'name-conflict'

export interface PiMcpSkipped {
  key: string
  reason: PiMcpSkipReason
  detail?: string
}

export interface PiMcpProjection {
  entries: PiMcpProjectedEntry[]
  skipped: PiMcpSkipped[]
}

/** 合并后的落盘结果 */
export interface PiMcpMergeResult {
  /** 最终写出去的 JSON 对象 */
  json: Record<string, unknown>
  /** 实际进入 `mcpServers` 的条目（撞名被丢弃的不在此列） */
  written: PiMcpProjectedEntry[]
  /** 本轮从文件里摘掉的、上一版本项目写入的条目 */
  prunedOwned: string[]
  skipped: PiMcpSkipped[]
}

export interface PiMcpSyncResult extends PiMcpMergeResult {
  path: string
  /** false = 一个字节都没动（文件损坏、或投影结果与磁盘完全一致之外的失败） */
  wrote: boolean
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 这个条目是不是上一次本项目写进去的 */
export function isSpaceCodeOwned(value: unknown): boolean {
  return isRecord(value) && isRecord(value[OWNER_KEY]) && typeof value[OWNER_KEY]!.key === 'string'
}

/**
 * 面板 key → pi 合法 server 名。
 *
 * 不做这层的话，带空格或点号的用户自建名字会被 pi 直接拒掉，表现为
 * 「面板里启用了、对话里调不到」。撞名时加数字后缀而不是覆盖，因为
 * 被覆盖那一个同样是用户启用的 server，谁也不该被静默挤掉。
 */
function toPiServerName(key: string, taken: Set<string>): string | null {
  const cleaned = key
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  if (!cleaned) return null

  if (!taken.has(nameNamespace(cleaned))) return cleaned
  for (let i = 2; i < 1000; i++) {
    const candidate = `${cleaned}-${i}`
    if (!taken.has(nameNamespace(candidate))) return candidate
  }
  return null
}

/** 面板条目 → pi 条目；返回 null 表示这条不该进文件（原因写进 skipped 由调用方收集） */
function toPiEntry(
  key: string,
  server: PersistedMcpServer,
): { entry: PiMcpServerEntry } | { reason: PiMcpSkipReason; detail?: string } {
  const type = server.type ?? 'stdio'
  const entry: PiMcpServerEntry = {
    // 显式写 enabled：pi 对 `enabled: false` 的条目保留但不连接，
    // 这比从文件里删掉更好 —— `pi mcp list` 能看到它被谁关了。
    enabled: server.enabled !== false,
    // 直接声明给模型，等价于 Claude Code 那边的 MCP 工具形态。
    // 留空的话 pi 默认 codemode，而 codemode 会被 pi 自动激活成一个
    // 我们既没有卡片、权限闸也不拦的工具（docs/mcp.md:200-204）。
    exposure: 'direct',
    [OWNER_KEY]: { key },
  }

  if (typeof server.description === 'string' && server.description) {
    entry.description = server.description
  }

  if (type === 'sse') {
    // pi 硬拒 legacy SSE（core/mcp-servers.js:168），而「把 /sse 换成 /mcp」是需要用户
    // 确认的事实，不是我们能猜的转换。原因码上面板，detail 只进日志。
    return { reason: 'unsupported-transport', detail: 'pi rejects the legacy SSE transport; use the streamable HTTP url' }
  }

  if (type === 'http') {
    if (!server.url) return { reason: 'missing-target', detail: 'no url configured' }
    entry.type = 'http'
    entry.url = server.url
    if (isRecord(server.headers)) entry.headers = server.headers as Record<string, string>
    return { entry }
  }

  if (!server.command) return { reason: 'missing-target', detail: 'no command configured' }
  entry.type = 'stdio'
  entry.command = server.command
  if (Array.isArray(server.args) && server.args.length > 0) entry.args = server.args.map(String)
  if (isRecord(server.env)) entry.env = server.env as Record<string, string>
  if (typeof server.cwd === 'string' && server.cwd) entry.cwd = server.cwd

  // 内置 server 的真路径由 resolver 给（和 Claude 的 --mcp-config 同一份口径）
  const builtin = builtinNameFromServerKey(key)
  if (builtin) {
    const resolution = resolveBuiltinMcp(builtin)
    if (resolution.status === 'resolved') {
      entry.command = resolution.config.command
      if (resolution.config.args?.length) entry.args = resolution.config.args
      if (resolution.config.env) entry.env = { ...entry.env, ...resolution.config.env }
    }
  }

  return { entry }
}

/**
 * 纯函数：把面板里的 MCP 配置投影成 pi 的 mcp.json 条目集合。
 *
 * 不读磁盘、不碰 electron，因此可单测 —— 顺序跟着 Object.entries，
 * 撞名后缀的分配才有确定性可言。
 */
export function projectMcpForPi(
  servers: Record<string, PersistedMcpServer>,
): PiMcpProjection {
  const taken = new Set<string>()

  const entries: PiMcpProjectedEntry[] = []
  const skipped: PiMcpSkipped[] = []

  for (const [key, server] of Object.entries(servers)) {
    if (!isRecord(server)) continue
    const name = toPiServerName(key, taken)
    if (!name) {
      skipped.push({ key, reason: 'invalid-name', detail: `not usable as a pi server name: ${key}` })
      continue
    }
    const converted = toPiEntry(key, server as PersistedMcpServer)
    if ('reason' in converted) {
      skipped.push({ key, reason: converted.reason, detail: converted.detail })
      continue
    }
    taken.add(nameNamespace(name))
    entries.push({ name, sourceKey: key, entry: converted.entry })
  }

  return { entries, skipped }
}

/**
 * 纯函数：把投影结果合并进已有的 mcp.json 内容。
 *
 * 只增删改带归属标记的条目；用户自有的 server、`$schema`、
 * `autoEnableCodemode` 这些顶层键一律原样留着。与用户自有条目撞命名空间时
 * 丢弃我们自己的一条 —— 用户的文件里谁在手写，谁就拥有那个名字。
 */
export function mergeIntoPiFile(
  existing: unknown,
  projection: PiMcpProjection,
): PiMcpMergeResult {
  const json: Record<string, unknown> = isRecord(existing) ? { ...existing } : {}
  const servers = isRecord(json.mcpServers) ? json.mcpServers : {}
  const merged: Record<string, unknown> = {}
  const foreignNames = new Set<string>()
  const prunedOwned: string[] = []

  for (const [name, value] of Object.entries(servers)) {
    // 上次写的条目先摘掉：本轮没再投影出来（被删、被禁用改名）就等于该消失
    if (isSpaceCodeOwned(value)) {
      prunedOwned.push(name)
      continue
    }
    merged[name] = value
    foreignNames.add(nameNamespace(name))
  }

  const written: PiMcpProjectedEntry[] = []
  const skipped: PiMcpSkipped[] = [...projection.skipped]

  for (const item of projection.entries) {
    if (foreignNames.has(nameNamespace(item.name))) {
      skipped.push({
        key: item.sourceKey,
        reason: 'name-conflict',
        detail: `mcp.json already defines "${item.name}" outside SpaceCode; that entry keeps the name`,
      })
      continue
    }
    merged[item.name] = item.entry
    written.push(item)
  }

  json.mcpServers = merged
  return { json, written, prunedOwned, skipped }
}

/** pi 用户级 mcp.json 的位置，跟着 pi 自己的 `PI_CODING_AGENT_DIR` 口径 */
export function piMcpJsonPath(homeDir?: string): string {
  return join(resolvePiAgentDir(homeDir), 'mcp.json')
}

/** 缩进跟着现有文件，别把用户手写的 4 空格风格改掉 */
function detectIndent(raw: string): number {
  const secondLine = raw.split(/\r?\n/)[1]
  if (!secondLine) return 2
  const leading = secondLine.length - secondLine.trimStart().length
  const width = secondLine.slice(0, leading).replace(/\t/g, '  ').length
  return width > 0 && width <= 8 ? width : 2
}

function readExisting(path: string): { raw?: string; json?: unknown; corrupt: boolean; missing: boolean } {
  if (!existsSync(path)) return { missing: true, corrupt: false }
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    warn(TAG, `Failed to read ${path}: ${err}`)
    // 读不动就当作损坏：宁可什么都不写，也不能凭猜测覆盖别人的文件
    return { corrupt: true, missing: false }
  }
  if (!raw.trim()) return { raw, json: {}, corrupt: false, missing: false }
  try {
    return { raw, json: JSON.parse(raw), corrupt: false, missing: false }
  } catch (err) {
    warn(TAG, `mcp.json is not valid JSON, leaving it untouched | path=${path} err=${err}`)
    return { raw, corrupt: true, missing: false }
  }
}

function writePiMcpFile(path: string, text: string): void {
  // 单次 writeFileSync，和 mcpConfigStore / models.json 那两个写入口径一致。
  // 真正的保护不在写入姿势上，而在上面那道「解析不了就不写」的闸：那份闸保证
  // 我们只会在读得懂的内容上做增删改。
  writeFileSync(path, text, 'utf-8')
}

/**
 * 把当前面板的 MCP 配置落到 pi 的用户级 mcp.json。
 *
 * 幂等：重复调用只有在内容变化时才写盘。失败不抛 —— 调用方在会话 spawn
 * 路径上，一次写盘失败不该让整个会话起不来，但它必须能在日志里看见。
 */
export function syncPiMcpConfig(servers: Record<string, PersistedMcpServer>, homeDir?: string): PiMcpSyncResult {
  const path = piMcpJsonPath(homeDir)
  const current = readExisting(path)

  if (current.corrupt) {
    return {
      path,
      json: {},
      written: [],
      prunedOwned: [],
      skipped: [],
      wrote: false,
      error: `refused to write: ${path} is not valid JSON (would destroy the user's own servers)`,
    }
  }

  const projection = projectMcpForPi(servers)
  const merged = mergeIntoPiFile(current.json, projection)

  // 没东西要写、也没有要摘掉的旧条目时，别凭空造一份全局配置 ——
  // 一个不用 MCP 的 pi 用户不该因为我们而多出 mcp.json。
  if (current.missing && merged.written.length === 0 && merged.prunedOwned.length === 0) {
    debug(TAG, 'Nothing to project for pi, mcp.json left as absent')
    return { path, ...merged, wrote: false }
  }

  const text = `${JSON.stringify(merged.json, null, detectIndent(current.raw ?? ''))}\n`

  if (current.raw === text) {
    debug(TAG, `mcp.json already up to date | path=${path} | servers=${merged.written.map(w => w.name).join(',') || '(none)'}`)
    return { path, ...merged, wrote: false }
  }

  try {
    mkdirSync(join(path, '..'), { recursive: true })
    writePiMcpFile(path, text)
  } catch (err) {
    warn(TAG, `Failed to write mcp.json | path=${path} err=${err}`)
    return { path, ...merged, wrote: false, error: String(err) }
  }

  info(
    TAG,
    `Synced pi mcp.json | path=${path} | servers=${merged.written.map(w => w.name).join(',') || '(none)'} | skipped=${merged.skipped.map(s => `${s.key}:${s.reason}`).join(',') || '(none)'}`,
  )
  return { path, ...merged, wrote: true }
}

/** 从真相源 `mcp-servers.json` 投影并落盘，pi 会话 spawn 前调用 */
export function syncPiMcpConfigFromStore(homeDir?: string): PiMcpSyncResult {
  return syncPiMcpConfig(loadMcpConfig(), homeDir)
}

/** 面板要展示的「别人写的」pi server（本项目管理的条目不在其中） */
export interface PiForeignServer {
  name: string
  enabled: boolean
  transport: 'stdio' | 'http' | 'unknown'
  target: string
  description?: string
  /** pi 会拒掉这一条的原因码；null = 看起来合法。文案由渲染层出 (#53) */
  invalid: PiMcpInvalidCode | null
}

export type PiMcpInvalidCode =
  | 'legacy-sse'
  | 'missing-target'
  | 'stdio-type-conflict'
  | 'http-type-unsupported'
  | 'not-an-object'

/**
 * 读出 mcp.json 里不由本项目管理的 server (issue #53 后果 1)。
 *
 * 这些 server 在 pi 会话里是会真的 spawn 子进程的。不把它们列进面板，
 * 用户看到的就是「一个没被任何界面认领的外部进程」，开关也够不着。
 */
export function readPiForeignServers(homeDir?: string): PiForeignServer[] {
  const path = piMcpJsonPath(homeDir)
  const current = readExisting(path)
  if (current.corrupt || current.missing || !isRecord(current.json)) return []
  const servers = isRecord(current.json.mcpServers) ? current.json.mcpServers : {}

  const result: PiForeignServer[] = []
  for (const [name, value] of Object.entries(servers)) {
    if (isSpaceCodeOwned(value)) continue
    if (!isRecord(value)) {
      result.push({ name, enabled: false, transport: 'unknown', target: '', invalid: 'not-an-object' })
      continue
    }
    const command = typeof value.command === 'string' ? value.command : ''
    const url = typeof value.url === 'string' ? value.url : ''
    const type = typeof value.type === 'string' ? value.type : ''
    const args = Array.isArray(value.args) ? (value.args as unknown[]).map(String) : []

    let transport: PiForeignServer['transport'] = 'unknown'
    let target = command || url
    let invalid: PiMcpInvalidCode | null = null

    if (type === 'sse') {
      invalid = 'legacy-sse'
    } else if (command) {
      transport = 'stdio'
      target = args.length ? `${command} ${args.join(' ')}` : command
      if (type && type !== 'stdio') invalid = 'stdio-type-conflict'
    } else if (url) {
      transport = 'http'
      target = url
      if (type && type !== 'http' && type !== 'streamable-http') invalid = 'http-type-unsupported'
    } else {
      invalid = 'missing-target'
    }

    result.push({
      name,
      enabled: value.enabled !== false,
      transport,
      target,
      description: typeof value.description === 'string' ? value.description : undefined,
      invalid,
    })
  }
  return result
}

/** 开关外部条目的失败原因码；文案由渲染层出 */
export type PiForeignToggleFailure = 'unreadable' | 'not-found' | 'managed-by-panel' | 'write-failed'

/**
 * 就地改一条用户自有 server 的 enabled，只碰这一个键。
 *
 * 口径跟着 pi 自己的 `/mcp`：开关保存回定义该 server 的文件，
 * 不替换无关内容。我们不去拥有它的 command/env。
 */
export function setPiForeignServerEnabled(
  name: string,
  enabled: boolean,
  homeDir?: string,
): { ok: boolean; reason?: PiForeignToggleFailure } {
  const path = piMcpJsonPath(homeDir)
  const current = readExisting(path)
  if (!isRecord(current.json)) {
    warn(TAG, `Cannot toggle "${name}": mcp.json missing or unreadable | path=${path}`)
    return { ok: false, reason: 'unreadable' }
  }
  const servers = isRecord(current.json.mcpServers) ? current.json.mcpServers : null
  const entry = servers?.[name]
  if (!isRecord(entry)) return { ok: false, reason: 'not-found' }
  if (isSpaceCodeOwned(entry)) return { ok: false, reason: 'managed-by-panel' }

  entry.enabled = enabled
  current.json.mcpServers = servers
  try {
    writePiMcpFile(path, `${JSON.stringify(current.json, null, detectIndent(current.raw ?? ''))}\n`)
  } catch (err) {
    warn(TAG, `Failed to persist toggle for "${name}" | path=${path} err=${err}`)
    return { ok: false, reason: 'write-failed' }
  }
  info(TAG, `Toggled foreign pi server | name=${name} | enabled=${enabled} | path=${path}`)
  return { ok: true }
}

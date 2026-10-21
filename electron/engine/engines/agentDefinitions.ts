import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { AgentInfo } from './types'

/**
 * Agent 定义文件的扫描口径 (issue #46)。
 *
 * 「选了 agent 却没生效」的根因之一是名单与能力无关：两个引擎各自手抄一套目录规则，
 * 于是界面上能选的东西，落到引擎里可能压根没有对应定义。名单和注入用的是同一份扫描结果，
 * 才能保证「列得出来 = 用得上」。
 */

/** 定义来源的引擎方言：claude = `.claude/agents`，pi = pi 原生位置 */
export type AgentDefinitionKind = 'claude' | 'pi'

export interface AgentDefinition extends AgentInfo {
  /** 定义文件的绝对路径 */
  file: string
  /** 去掉 frontmatter 的正文 —— 也就是能当作 persona 交给模型的那段文字 */
  body: string
}

export interface AgentDiscoveryOptions {
  /** 要扫的方言集合：Claude 引擎只认自己的目录，Pi 引擎两个都认 */
  kinds: AgentDefinitionKind[]
  /** 项目根；缺省只扫用户级 */
  cwd?: string
  /** 注入以便测试，避免就地读环境变量 */
  homeDir?: string
  /** pi 的全局 agent 目录，缺省见 resolvePiAgentDir() */
  piAgentDir?: string
}

/**
 * pi 的全局 agent 目录。上游认 `PI_CODING_AGENT_DIR`（subagents 扩展的 getAgentDir() 也是），
 * 所以这里跟着它，而不是另算一份 —— 否则用户在 pi 里放的定义，名单看不见。
 */
export function resolvePiAgentDir(homeDir: string = os.homedir()): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(homeDir, '.pi', 'agent')
}

/**
 * 目录扫描顺序，即同名去重的优先级：项目级压用户级，同层里 pi 原生位置压 `.claude`。
 *
 * 这一条跟着 @tintinweb/pi-subagents 的口径（`.pi/agents` 是项目权威位置）—— 那份文件既能被
 * 注入，也能被它自己发现去委派，两边看到的是同一个定义。扩展另外还认 `.agents/agents` 与
 * pi 包声明的目录，本模块不扫：
 *   - `.agents/agents`：技术上可以注入（就是一段 md 正文），不纳入是产品口径 —— 跨工具
 *     共享目录不是 SpaceCode 的配置面（issue #58）；
 *   - pi 包声明目录：目录根由 pi 的包管理器从 settings.json 的 packages[] 解析，宿主不复刻
 *     这套解析器；扩展内置的 general-purpose/Explore/Plan 也没有可注入的 md 正文。
 * 两者都属于「扩展可委派、宿主不列」的边界；列出来就会造出「看得见、点下去没反应」。
 */
function scanDirs(opts: AgentDiscoveryOptions): Array<{ dir: string; source: AgentInfo['source']; kind: AgentDefinitionKind }> {
  const homeDir = opts.homeDir ?? os.homedir()
  const piAgentDir = opts.piAgentDir ?? resolvePiAgentDir(homeDir)
  // project 是相对 cwd 的路径，user 是绝对路径
  const byKind: Record<AgentDefinitionKind, { project: string; user: string }> = {
    pi: { project: path.join('.pi', 'agents'), user: path.join(piAgentDir, 'agents') },
    claude: { project: path.join('.claude', 'agents'), user: path.join(homeDir, '.claude', 'agents') },
  }
  const dirs: Array<{ dir: string; source: AgentInfo['source']; kind: AgentDefinitionKind }> = []
  for (const scope of ['project', 'user'] as const) {
    for (const kind of ['pi', 'claude'] as const) {
      if (!opts.kinds.includes(kind)) continue
      const entry = byKind[kind][scope]
      if (scope === 'project') {
        if (!opts.cwd) continue
        dirs.push({ dir: path.join(opts.cwd, entry), source: 'project', kind })
      } else {
        dirs.push({ dir: entry, source: 'user', kind })
      }
    }
  }
  return dirs
}

interface ParsedAgentFile {
  name?: string
  description?: string
  model?: string
  color?: string
  enabled?: boolean
}

const FRONTMATTER = /^---\s*\n([\s\S]*?)\n---/

/** 编辑器（尤其 Windows/CJK 环境）常写 UTF-8 BOM；pi 侧解析前会剥掉它。 */
function stripBom(content: string): string {
  return content.startsWith('\uFEFF') ? content.slice(1) : content
}

function field(frontmatter: string, key: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*['"]?([^'"\n]+)['"]?`, 'm'))
  return match?.[1]?.trim()
}

/**
 * YAML 布尔只认未加引号的 true/false（含大小写变体）。带引号的 "false" 是字符串，
 * pi 侧 `fm.enabled !== false` 同样视为启用；0/no/off 也不是布尔。
 */
function yamlBoolean(frontmatter: string, key: string): boolean | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))
  if (!match) return undefined
  const raw = match[1].trim()
  if (raw.startsWith('"') || raw.startsWith("'")) return undefined
  const value = raw.replace(/[ \t]+#.*$/, '').trim()
  if (value === 'true' || value === 'True' || value === 'TRUE') return true
  if (value === 'false' || value === 'False' || value === 'FALSE') return false
  return undefined
}

function parseFrontmatter(content: string): ParsedAgentFile {
  const block = FRONTMATTER.exec(stripBom(content))?.[1]
  if (!block) return {}
  return {
    name: field(block, 'name'),
    description: field(block, 'description'),
    model: field(block, 'model'),
    color: field(block, 'color'),
    enabled: yamlBoolean(block, 'enabled'),
  }
}

/** 正文 = 去掉 frontmatter 的剩余部分。Claude 的 getSystemPrompt() 给的也是这一段。 */
function personaBody(content: string): string {
  const normalized = stripBom(content)
  const block = FRONTMATTER.exec(normalized)
  return block ? normalized.slice(block[0].length).trim() : normalized.trim()
}

type AgentFileRead =
  | { status: 'definition'; definition: AgentDefinition }
  | { status: 'disabled'; agentType: string }

/**
 * 读一个定义文件；目录项、空名、读不动的都算不是定义（null），跳过而不是让整次扫描失败。
 *
 * `piDialect` 时跟随 @tintinweb/pi-subagents 的加载规则：`enabled: false` 禁用、含冒号的
 * `name:` 直接不加载。两条都只对 pi 目录生效 —— `.claude/agents` 仍按 Claude 的口径，
 * 那边既不认 `enabled`，也不把冒号当作保留字符。
 */
function readAgentFile(
  filePath: string,
  source: AgentInfo['source'],
  allowFilenameName: boolean,
  piDialect: boolean,
): AgentFileRead | null {
  try {
    if (!fs.statSync(filePath).isFile()) return null
    const content = fs.readFileSync(filePath, 'utf8')
    const parsed = parseFrontmatter(content)
    if (piDialect && parsed.name?.includes(':')) return null
    // 命名规则跟着引擎：pi 的扩展允许文件名兜底（README: `name` 缺省用 filename），
    // 而 Claude 侧历来只认 frontmatter 的 `name:` —— 名单里不得出现那个引擎不认的名字。
    const agentType = parsed.name
      || (allowFilenameName ? path.basename(filePath).replace(/\.md$/i, '') : '')
    if (!agentType) return null
    if (piDialect && parsed.enabled === false) return { status: 'disabled', agentType }
    return {
      status: 'definition',
      definition: {
        agentType,
        description: parsed.description ?? '',
        source,
        model: parsed.model,
        color: parsed.color,
        file: filePath,
        body: personaBody(content),
      },
    }
  } catch {
    return null
  }
}

/**
 * 列出真实可用的 agent 定义。同名只留优先级最高的那一个，顺序即扫描顺序，
 * 让界面与注入拿到同一个定义。
 */
export function discoverAgentDefinitions(opts: AgentDiscoveryOptions): AgentDefinition[] {
  const allowFilenameName = opts.kinds.includes('pi')
  const found: AgentDefinition[] = []
  const seen = new Set<string>()
  for (const { dir, source, kind } of scanDirs(opts)) {
    let entries: string[]
    try {
      if (!fs.existsSync(dir)) continue
      entries = fs.readdirSync(dir).filter(name => name.toLowerCase().endsWith('.md'))
    } catch {
      continue
    }
    for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
      const result = readAgentFile(path.join(dir, entry), source, allowFilenameName, kind === 'pi')
      if (!result) continue
      const agentType = result.status === 'definition' ? result.definition.agentType : result.agentType
      if (seen.has(agentType)) continue
      // 禁用也占名：扩展的注册表先按优先级覆盖、再由派发侧拒绝；这里若直接跳过，
      // 低优先级的同名定义会顶上来，界面就会展示一个扩展明确拒绝的类型。
      seen.add(agentType)
      if (result.status === 'disabled') continue
      found.push(result.definition)
    }
  }
  return found
}

/** 按名字取定义；null = 这个名字没有任何可用定义（引擎侧不得声称已应用）。 */
export function findAgentDefinition(name: string, opts: AgentDiscoveryOptions): AgentDefinition | null {
  if (!name) return null
  return discoverAgentDefinitions(opts).find(agent => agent.agentType === name) ?? null
}

/** 名单只带界面要用的字段 —— 定义正文和定义文件绝对路径不下给渲染层与 H5 客户端。 */
export function toAgentInfos(definitions: AgentDefinition[]): AgentInfo[] {
  return definitions.map(({ agentType, description, source, model, color }) => ({ agentType, description, source, model, color }))
}

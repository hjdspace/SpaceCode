import type { Session, Message, ToolCall, AgentColor, TeammateStatus } from '@/types'
import { api } from '@/services/electronAPI'
import { parseSubagentTranscript } from '@/utils/sessionRestore'

interface RawTeammateMessage {
  type?: string
  isSidechain?: boolean
  agentTaskId?: string
  taskId?: string
  agentId?: string
  agentName?: string
  agentType?: string
  subagent_type?: string
  name?: string
  teamName?: string
  team_name?: string
  team?: string
  status?: string
  state?: string
  event?: string
  subtype?: string
  message?: unknown
  content?: unknown
  text?: string
  output?: unknown
  result?: unknown
  parent_tool_use_id?: string
  parentToolUseId?: string
}

type ContentBlock = string | { type: string; text?: string; [key: string]: unknown }

export const AGENT_COLORS: AgentColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']

export function stableTeammateId(raw: RawTeammateMessage): string {
  const value = raw?.agentTaskId || raw?.taskId || raw?.agentId || raw?.agentName || raw?.subagent_type || raw?.name || 'teammate'
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/gi, '-') || 'teammate'
}

export function getRawTeammateName(raw: RawTeammateMessage): string {
  return String(raw?.agentName || raw?.name || raw?.subagent_type || raw?.agentType || 'teammate')
}

export function getRawTeamName(raw: RawTeammateMessage): string {
  return String(raw?.teamName || raw?.team_name || raw?.team || 'Agent Team')
}

/**
 * 判断是否为真正的 teammate 消息（Agent Team 机制）。
 * 只有带 type='teammate' 或显式 team/teamName 字段的消息才是 teammate。
 * 参考：engine/docs/agent/sub-agents.mdx — name+team_name 是独立分支，
 * 调用 spawnTeammate() 返回 teammate_spawned，与普通 Agent tool 子智能体完全不同。
 */
export function isTeammateRawMessage(raw: RawTeammateMessage): boolean {
  return !!raw && typeof raw === 'object' && (
    raw.type === 'teammate' ||
    !!raw.teamName ||
    !!raw.team_name ||
    !!raw.team
  )
}

/**
 * 判断是否为子智能体（Agent tool）的 sidechain 消息。
 * 这些消息带 parent_tool_use_id / isSidechain / subagent_type / agentName，
 * 属于普通 Agent 工具调用的子智能体进度，不是 teammate。
 * 需要拦截以避免污染主时间线，但不应纳入 agent team 机制。
 */
export function isSidechainMessage(raw: any): boolean {
  return !!raw && typeof raw === 'object' && (
    !!raw.isSidechain ||
    !!raw.parent_tool_use_id ||
    !!raw.parentToolUseId ||
    !!raw.subagent_type ||
    !!raw.agentName
  )
}

/** 统一的 teammateId 归一化：小写 + 仅保留 [a-z0-9_-]。 */
export function normalizeTeammateId(value: string | number | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/gi, '-') || 'teammate'
}

// 父 Agent 工具调用 id → 该子代理转录所用的规范 teammateId。
// 实时子代理消息只带 parent_tool_use_id，通过此映射归并到与 Agent 工具卡片相同的 teammate。
// key 形如 `${sessionId}:${parentToolUseId}`。
const parentToolUseToTeammate = new Map<string, string>()

export function registerTeammateForToolUse(sessionId: string, toolUseId: string, teammateId: string): void {
  if (!toolUseId) return
  parentToolUseToTeammate.set(`${sessionId}:${toolUseId}`, teammateId)
}

export function teammateIdForParentToolUse(sessionId: string, parentToolUseId: string): string | undefined {
  if (!parentToolUseId) return undefined
  return parentToolUseToTeammate.get(`${sessionId}:${parentToolUseId}`)
}

/**
 * 清理某个会话在 parentToolUseToTeammate 中的全部映射条目。
 * 必须在会话销毁时调用，否则模块级 Map 会随会话更替持续增长（内存泄漏）。
 */
export function clearSessionToolUseMappings(sessionId: string): void {
  if (!sessionId) return
  const prefix = `${sessionId}:`
  for (const key of parentToolUseToTeammate.keys()) {
    if (key.startsWith(prefix)) parentToolUseToTeammate.delete(key)
  }
}

/**
 * 解析 raw 消息归属的 teammateId。
 * 优先用 parent_tool_use_id（实时子代理消息）经映射归并；映射缺失时回退为
 * normalizeTeammateId(parentToolUseId)，该回退值与 recordAgentToolCall 对同步子代理的
 * teammateId（normalizeTeammateId(toolCall.id)）一致，保证实时消息与工具卡片落到同一 teammate。
 */
export function resolveTeammateId(sessionId: string, raw: RawTeammateMessage): string {
  const parentId = raw?.parent_tool_use_id || raw?.parentToolUseId
  if (parentId) {
    return teammateIdForParentToolUse(sessionId, parentId) || normalizeTeammateId(parentId)
  }
  return stableTeammateId(raw)
}

export function inferTeammateStatus(raw: RawTeammateMessage): TeammateStatus {
  const value = String(raw?.status || raw?.state || raw?.event || raw?.subtype || '').toLowerCase()
  if (/fail|error|reject|cancel/.test(value)) return 'failed'
  if (/complete|done|finish|success|result/.test(value)) return 'completed'
  if (/idle|wait/.test(value)) return 'idle'
  return 'running'
}

/** Extract readable text from an array of content blocks (Anthropic message format). */
function extractTextFromContentBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map((part: ContentBlock) => {
      if (typeof part === 'string') return part
      if (part?.type === 'text' && typeof part.text === 'string') return part.text
      if (part?.text) return String(part.text)
      // Skip non-text content blocks (tool_use, tool_result, image, etc.)
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/** Try to parse a string that might be JSON into an object; return null on failure. */
function tryParseJson(value: string): unknown {
  if (!value || value[0] !== '{' && value[0] !== '[') return null
  try { return JSON.parse(value) } catch { return null }
}

export function stringifyRawContent(raw: RawTeammateMessage): string {
  if (raw == null) return ''

  // If raw.message is a JSON string (not an object), try to parse it first.
  // This handles cases where the engine message was double-serialized.
  let message: unknown = raw.message
  if (typeof message === 'string') {
    const parsed = tryParseJson(message)
    if (parsed) message = parsed
  }

  const msgObj = message as Record<string, unknown> | null | undefined
  const content = msgObj?.content ?? raw?.content ?? raw?.text ?? raw?.output ?? raw?.result

  if (typeof content === 'string') {
    // If the string looks like a JSON array of content blocks, try to parse it
    const parsed = tryParseJson(content)
    if (Array.isArray(parsed)) {
      const extracted = extractTextFromContentBlocks(parsed)
      if (extracted) return extracted
    }
    return content
  }
  if (Array.isArray(content)) {
    return extractTextFromContentBlocks(content)
  }
  if (content == null) return ''
  // For plain objects, try to extract text field before JSON.stringify fallback
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.result === 'string') return obj.result
    // Handle nested content blocks: {type:'text', text:'...'}
    if (Array.isArray(obj.content)) return extractTextFromContentBlocks(obj.content as ContentBlock[])
  }
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

export function parseAgentToolOutput(output: string): { displayText: string; outputFile?: string; agentId?: string } {
  try {
    const parsed = JSON.parse(output)
    let text: string
    if (Array.isArray(parsed)) {
      text = parsed.map((part: ContentBlock) => typeof part === 'string' ? part : part?.text || '').filter(Boolean).join('\n')
    } else if (typeof parsed?.text === 'string') {
      text = parsed.text
    } else {
      // Handle engine internal message format: {message: {content: [...]}, type: 'user'/'assistant', ...}
      // Use stringifyRawContent to extract text from the complex object structure.
      text = stringifyRawContent(parsed)
      // If extraction produced nothing useful, fall back to raw output
      if (!text) text = output
    }
    const outputFile = text.match(/output_file:\s*([^\n]+)/)?.[1]?.trim()
    const agentId = text.match(/agentId:\s*([^\s]+)/)?.[1]?.trim()
    return {
      displayText: agentId
        ? `Agent launched successfully.\n\nAgent ID: ${agentId}\n${outputFile ? `Output file: ${outputFile}` : ''}`.trim()
        : text,
      outputFile,
      agentId,
    }
  } catch {
    const outputFile = output.match(/output_file:\s*([^\n]+)/)?.[1]?.trim()
    const agentId = output.match(/agentId:\s*([^\s]+)/)?.[1]?.trim()
    return { displayText: output, outputFile, agentId }
  }
}

/**
 * 从子代理输出文本中剥离引擎元数据（agentId、usage、token 计数等）。
 * 参考 cc-haha 的 stripAgentResultMetadata。
 */
export function stripAgentResultMetadata(text: string): string {
  return text
    .replace(/^\s*agentId:.*(?:\r?\n)?/gm, '')
    .replace(/<usage>[\s\S]*?<\/usage>/g, '')
    .replace(/^\s*(?:total_tokens|tool_uses|duration_ms):\s*\d+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 判断子代理输出是否为"启动成功"消息（异步 agent 启动后的占位输出）。
 * 这类输出不包含实际结果，不应展示为子代理输出。
 * 也用于检测 handleToolResult / handleUser 中的异步启动 tool_result，
 * 防止将仍在后台运行的子代理标记为 'completed'。
 */
export function isAgentLaunchResult(content: unknown): boolean {
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) return false
  return (
    text.startsWith('Agent launched successfully.') ||
    text.startsWith('Async agent launched successfully.') ||
    text.startsWith('Spawned successfully.') ||
    text.startsWith('Remote agent launched in CCR.') ||
    text.includes('The agent is now running and will receive instructions via mailbox.') ||
    text.includes('The agent is working in the background. You will be notified automatically when it completes.') ||
    text.includes('The agent is running remotely. You will be notified automatically when it completes.')
  )
}

/**
 * 提取子代理的可显示文本，剥离元数据后返回。
 * 参考 cc-haha 的 extractAgentDisplayText。
 */
export function extractAgentDisplayText(content: unknown): string {
  if (!content) return ''
  const raw = typeof content === 'string' ? content : stringifyRawContent(content as RawTeammateMessage)
  return stripAgentResultMetadata(raw)
}

/**
 * 生成子代理输出的摘要预览（折叠态使用）。
 * 截取前 ~220 字符，保持可读性。
 * 参考 cc-haha 的 getAgentOutputSummary。
 */
export function getAgentOutputSummary(content: string): string {
  const text = content.replace(/\s+\n/g, '\n').trim()
  if (!text) return ''
  return text.length > 220 ? `${text.slice(0, 220)}...` : text
}

/**
 * 格式化单个工具调用的摘要文本（折叠态最近活动使用）。
 * 返回形如 "Bash · npm test • done" 的简短描述。
 * 参考 cc-haha 的 formatRecentToolUseSummary。
 */
export function formatToolCallSummary(toolCall: { name: string; input: Record<string, unknown>; status: string; output?: string }): string {
  const input = toolCall.input || {}
  let detail = ''

  switch (toolCall.name) {
    case 'Bash':
      detail = typeof input.command === 'string' ? input.command : ''
      break
    case 'Read':
    case 'FileRead':
      detail = typeof input.file_path === 'string' ? String(input.file_path).split('/').pop() || 'file' : 'file'
      break
    case 'Write':
    case 'FileWrite':
      detail = typeof input.file_path === 'string' ? String(input.file_path).split('/').pop() || 'file' : 'file'
      break
    case 'Edit':
    case 'FileEdit':
      detail = typeof input.file_path === 'string' ? String(input.file_path).split('/').pop() || 'file' : 'file'
      break
    case 'Glob':
      detail = typeof input.pattern === 'string' ? input.pattern : ''
      break
    case 'Grep':
      detail = typeof input.pattern === 'string' ? input.pattern : ''
      break
    case 'Agent':
      detail = typeof input.description === 'string' ? input.description : ''
      break
    case 'WebSearch':
      detail = typeof input.query === 'string' ? input.query : ''
      break
    case 'WebFetch':
      detail = typeof input.url === 'string' ? input.url : ''
      break
    default:
      detail = ''
  }

  const statusSuffix = toolCall.status === 'error' ? ' • failed' :
    toolCall.status === 'completed' ? ' • done' :
    toolCall.status === 'running' ? ' • running' : ''

  return detail ? `${toolCall.name} · ${detail}${statusSuffix}` : `${toolCall.name}${statusSuffix}`
}

export function ensureTeamContext(session: Session, teamName: string): void {
  if (!session.teamContext) {
    session.teamContext = {
      teamName,
      isLeader: true,
      teammates: {}
    }
  } else if (!session.teamContext.teamName) {
    session.teamContext.teamName = teamName
  }
  session.expandedView = session.expandedView || 'none'
  session.teammateTranscripts = session.teammateTranscripts || {}
}

/**
 * 确保子智能体转录存储已初始化，但不创建 teamContext。
 * 普通 Agent tool 子智能体不应纳入 agent team 机制。
 */
export function ensureSubagentTranscripts(session: Session): void {
  if (!session.teammateTranscripts) {
    session.teammateTranscripts = {}
  }
}

// 记录"以输出文件为权威来源"的子代理（异步 agent）：key = `${sessionId}:${teammateId}`。
// 这类子代理的转录完全由 transcript 文件解析得到，实时 sidechain 事件不再另写转录（避免重复）。
// agentId 用于在 Windows（符号链接失败）时直接解析 transcript JSONL 路径，绕过 .output 空文件。
const agentOutputFiles = new Map<string, { filePath: string; name: string; status: TeammateStatus; agentId?: string }>()

/** 该 teammate 的转录是否由输出文件托管（若是，则 recordTeammateMessage 不应再追加，以免重复）。 */
export function isFileBackedTeammate(sessionId: string, teammateId: string): boolean {
  return agentOutputFiles.has(`${sessionId}:${teammateId}`)
}

/**
 * 重新唤起某个文件托管子代理的输出文件轮询。
 * 用于：主回合的事件监听被拆除后，异步子代理仍在后台运行——收到该会话的 sidechain
 * 事件时调用此函数，让轮询链复活，从而近实时跟随子代理输出。若轮询仍在进行则为无操作。
 */
export function rekickAgentTranscriptPoll(session: Session, sessionId: string, teammateId: string): void {
  const info = agentOutputFiles.get(`${sessionId}:${teammateId}`)
  if (!info) return
  void hydrateAgentTranscriptFromFile(session, teammateId, info.filePath, info.name, info.status, info.agentId)
}

export function recordAgentToolCall(session: Session, toolCall: ToolCall, status: TeammateStatus = 'running'): void {
  if (toolCall.name !== 'Agent') return
  // ★ 不再创建 teamContext：普通 Agent tool 子智能体不属于 agent team 机制。
  // 仅初始化转录存储，供 AgentToolCard 读取。
  ensureSubagentTranscripts(session)

  const input = toolCall.input || {}
  const parsedOutput = toolCall.output ? parseAgentToolOutput(toolCall.output) : null
  const fallbackId = normalizeTeammateId(toolCall.id || input.agentTaskId || input.taskId || crypto.randomUUID())
  const teammateId = parsedOutput?.agentId ? normalizeTeammateId(parsedOutput.agentId) : fallbackId
  const agentType = String(input.agentType || input.type || 'general-purpose')
  const name = String(input.name || input.agentName || (agentType === 'general-purpose' ? 'Agent' : agentType))

  // 若之前以 toolCall.id 建过占位条目，重新以 agentId 归并时迁移并清理。
  if (parsedOutput?.agentId && fallbackId !== teammateId) {
    const ghost = session.teammateTranscripts![fallbackId]
    if (ghost?.length) {
      session.teammateTranscripts![teammateId] = [
        ...(session.teammateTranscripts![teammateId] || []),
        ...ghost,
      ]
    }
    delete session.teammateTranscripts![fallbackId]
    parentToolUseToTeammate.delete(`${session.id}:${fallbackId}`)
  }

  // 注册映射：实时子代理消息（parent_tool_use_id = toolCall.id）据此归并到本条目。
  registerTeammateForToolUse(session.id, String(toolCall.id), teammateId)

  const transcript = session.teammateTranscripts![teammateId] || []

  if (toolCall.output && parsedOutput) {
    if (!parsedOutput.agentId && transcript.length === 0) {
      session.teammateTranscripts![teammateId] = [...transcript, {
        id: `${toolCall.id}-result`,
        role: 'assistant',
        content: parsedOutput.displayText,
        timestamp: toolCall.endTime || Date.now(),
        metadata: {
          agentTaskId: teammateId,
          agentName: name,
          teamName: 'Agent Team',
          status,
        }
      }]
    }
    if (parsedOutput.outputFile) {
      agentOutputFiles.set(`${session.id}:${teammateId}`, { filePath: parsedOutput.outputFile, name, status, agentId: parsedOutput.agentId })
      void hydrateAgentTranscriptFromFile(session, teammateId, parsedOutput.outputFile, name, status, parsedOutput.agentId)
    }
  }
}

// 防止同一 (session, teammate, file) 同时启动多条轮询链。
const activeAgentFilePolls = new Set<string>()

/**
 * 从子代理输出文件（JSONL 转录）补全并持续跟随 teammate 的转录。
 *
 * 旧实现把整份文件内容当作一条 assistant 消息（content = 原始 JSONL），导致子代理页面
 * 直接显示原始 JSON、未渲染 markdown；且读到内容后即停止，异步子代理运行期间不再更新（无实时）。
 *
 * 现在：
 *  1. 用 parseSubagentTranscript 把 JSONL 解析为标准 Message[]（文本走 MarkdownRenderer、
 *     工具调用走工具卡片、思考走时间线），整体替换该 teammate 的转录。
 *  2. 以 1.5s 间隔轮询文件，内容仍在增长时持续重新解析替换 —— 近实时跟随子代理输出；
 *     连续约 12s 无变化（或达到兜底上限）后停止。轮询链独立于主回合的事件监听，
 *     因此异步后台子代理在主回合结束后仍能被跟随。
 *  3. 当 agentId 可用时，优先通过 IPC 解析真实 transcript JSONL 路径进行轮询，
 *     绕过 .output 符号链接（Windows 上符号链接创建失败导致空文件）。
 */
async function hydrateAgentTranscriptFromFile(session: Session, teammateId: string, filePath: string, name: string, status: TeammateStatus, agentId?: string) {
  const pollKey = `${session.id}:${teammateId}:${filePath}`
  if (activeAgentFilePolls.has(pollKey)) return
  activeAgentFilePolls.add(pollKey)

  // 解析真实 transcript JSONL 路径，绕过 .output 符号链接。
  // Windows 上符号链接创建失败时 .output 是空普通文件，真实转录在
  // ~/.claude/projects/{sanitized-cwd}/{sessionId}/subagents/agent-{agentId}.jsonl
  let transcriptPath = filePath
  if (agentId && session.workingDirectory) {
    try {
      const resolved = await api.claudeCode?.resolveAgentTranscriptPath(
        session.workingDirectory,
        session.id,
        agentId,
      )
      if (typeof resolved === 'string') transcriptPath = resolved
    } catch {
      // 解析失败时回退到 .output 文件路径
    }
  }

  let lastLength = -1
  let stableTicks = 0
  let remainingTicks = 800 // ~20min 兜底；正常会因内容长时间停止增长而提前结束
  // 子代理在两次写入之间可能有较长间隔（等待 LLM 首字、长时间工具执行）。
  // 容忍 ~45s 无变化再停止，避免轮询在子代理仍活跃时过早结束导致"看不到实时输出"。
  const MAX_STABLE_TICKS = 30

  const applyParsed = (text: string) => {
    if (!session?.teammateTranscripts) return
    const parsed = parseSubagentTranscript(text)
    if (parsed.length === 0) return
    const baseTime = Date.now()
    session.teammateTranscripts[teammateId] = parsed.map((m, idx) => ({
      ...m,
      id: m.id || `${teammateId}-file-${idx}`,
      timestamp: baseTime + idx,
      metadata: {
        ...(m.metadata || {}),
        agentTaskId: teammateId,
        agentName: name,
        teamName: 'Agent Team',
        status,
      },
    })) as Message[]
    const teammate = session.teamContext?.teammates[teammateId]
    if (teammate) teammate.messageCount = session.teammateTranscripts[teammateId].length
  }

  const tick = async () => {
    let text = ''
    try {
      text = (await api.readFile(transcriptPath)) || ''
    } catch {
      // 文件暂不可读，下一轮重试
    }
    // 仅在内容增长时重新解析并替换，避免无谓的重渲染
    if (text.trim() && text.length !== lastLength) {
      applyParsed(text)
    }
    if (text.length !== lastLength) {
      lastLength = text.length
      stableTicks = 0
    } else {
      stableTicks += 1
    }
    remainingTicks -= 1
    if (remainingTicks > 0 && stableTicks < MAX_STABLE_TICKS) {
      setTimeout(() => { void tick() }, 1500)
    } else {
      activeAgentFilePolls.delete(pollKey)
    }
  }

  void tick()
}

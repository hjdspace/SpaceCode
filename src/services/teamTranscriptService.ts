import type { Session, Message, ToolCall, AgentColor, TeammateStatus } from '@/types'
import { api } from '@/services/electronAPI'

export const AGENT_COLORS: AgentColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']

export function stableTeammateId(raw: any): string {
  const value = raw?.agentTaskId || raw?.taskId || raw?.agentId || raw?.agentName || raw?.subagent_type || raw?.name || 'teammate'
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/gi, '-') || 'teammate'
}

export function getRawTeammateName(raw: any): string {
  return String(raw?.agentName || raw?.name || raw?.subagent_type || raw?.agentType || 'teammate')
}

export function getRawTeamName(raw: any): string {
  return String(raw?.teamName || raw?.team_name || raw?.team || 'Agent Team')
}

export function isTeammateRawMessage(raw: any): boolean {
  return !!raw && typeof raw === 'object' && (raw.type === 'teammate' || raw.isSidechain || raw.agentName || raw.subagent_type)
}

export function inferTeammateStatus(raw: any): TeammateStatus {
  const value = String(raw?.status || raw?.state || raw?.event || raw?.subtype || '').toLowerCase()
  if (/fail|error|reject|cancel/.test(value)) return 'failed'
  if (/complete|done|finish|success|result/.test(value)) return 'completed'
  if (/idle|wait/.test(value)) return 'idle'
  return 'running'
}

export function stringifyRawContent(raw: any): string {
  const content = raw?.message?.content ?? raw?.content ?? raw?.text ?? raw?.output ?? raw?.result
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part
        if (part?.type === 'text' && typeof part.text === 'string') return part.text
        if (part?.text) return String(part.text)
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content == null) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

export function parseAgentToolOutput(output: string): { displayText: string; outputFile?: string; agentId?: string } {
  try {
    const parsed = JSON.parse(output)
    const text = Array.isArray(parsed)
      ? parsed.map((part: any) => typeof part === 'string' ? part : part?.text || '').filter(Boolean).join('\n')
      : typeof parsed?.text === 'string' ? parsed.text : output
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

export function recordAgentToolCall(session: Session, toolCall: ToolCall, status: TeammateStatus = 'running'): void {
  if (toolCall.name !== 'Agent') return
  ensureTeamContext(session, 'Agent Team')

  const input = toolCall.input || {}
  // 异步启动的子代理，其真实输出通过 sidechain 消息记录，并以引擎生成的 agentId 作为 key。
  // 这里解析工具输出中的 agentId，优先用它作为 teammateId，使工具卡片与 sidechain 转录合并到同一 teammate，
  // 否则历史会话重建时会出现“只显示 Output file 占位、看不到子代理输出”的现象。
  const parsedOutput = toolCall.output ? parseAgentToolOutput(toolCall.output) : null
  const normalizeId = (v: any) => String(v).trim().toLowerCase().replace(/[^a-z0-9_-]+/gi, '-') || 'teammate'
  const fallbackId = String(toolCall.id || input.agentTaskId || input.taskId || crypto.randomUUID())
  const teammateId = parsedOutput?.agentId ? normalizeId(parsedOutput.agentId) : fallbackId
  const agentType = String(input.agentType || input.type || 'general-purpose')
  // 与引擎 UI 层 userFacingName() 保持一致：general-purpose 显示为 "Agent"
  const name = String(input.name || input.agentName || (agentType === 'general-purpose' ? 'Agent' : agentType))

  // 若之前以 toolCall.id 建过占位 teammate（如实时流在 tool_use 阶段先建后补 output），
  // 重新以 agentId 归并时迁移并清理旧的占位条目，避免出现空的“幽灵”子代理。
  if (parsedOutput?.agentId && fallbackId !== teammateId) {
    const ghost = session.teammateTranscripts![fallbackId]
    if (ghost?.length) {
      session.teammateTranscripts![teammateId] = [
        ...(session.teammateTranscripts![teammateId] || []),
        ...ghost,
      ]
    }
    delete session.teammateTranscripts![fallbackId]
    delete session.teamContext!.teammates[fallbackId]
  }

  const existing = session.teamContext!.teammates[teammateId]
  const color = existing?.color || AGENT_COLORS[Object.keys(session.teamContext!.teammates).length % AGENT_COLORS.length]
  const transcript = session.teammateTranscripts![teammateId] || []

  if (toolCall.output && parsedOutput) {
    // 异步启动（带 agentId）的工具结果只是“已启动”占位，真实内容来自 sidechain，无需写入占位消息。
    if (!parsedOutput.agentId && !transcript.some(m => m.id === `${toolCall.id}-result`)) {
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
      void hydrateAgentTranscriptFromFile(session, teammateId, parsedOutput.outputFile, name, status)
    }
  }

  session.teamContext!.teammates[teammateId] = {
    name,
    agentType,
    status,
    color,
    messageCount: session.teammateTranscripts![teammateId]?.length || 0
  }
}

async function hydrateAgentTranscriptFromFile(session: Session, teammateId: string, filePath: string, name: string, status: TeammateStatus, attempts = 8) {
  try {
    const content = await api.readFile(filePath)
    if (!content?.trim()) {
      if (attempts > 0) {
        setTimeout(() => {
          void hydrateAgentTranscriptFromFile(session, teammateId, filePath, name, status, attempts - 1)
        }, 1500)
      }
      return
    }
    if (!session?.teammateTranscripts) return
    const transcript = session.teammateTranscripts[teammateId] || []
    const fileMessageId = `${teammateId}-output-file`
    const fileMessage: Message = {
      id: fileMessageId,
      role: 'assistant',
      content,
      timestamp: Date.now(),
      metadata: {
        agentTaskId: teammateId,
        agentName: name,
        teamName: 'Agent Team',
        status,
      }
    }
    session.teammateTranscripts[teammateId] = transcript.some(m => m.id === fileMessageId)
      ? transcript.map(m => m.id === fileMessageId ? fileMessage : m)
      : [...transcript, fileMessage]
    const teammate = session.teamContext?.teammates[teammateId]
    if (teammate) teammate.messageCount = session.teammateTranscripts[teammateId].length
  } catch (error) {
    // Silently ignore — the store's version logs the error via logger
  }
}

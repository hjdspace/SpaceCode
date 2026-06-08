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

export function parseAgentToolOutput(output: string): { displayText: string; outputFile?: string } {
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
    }
  } catch {
    const outputFile = output.match(/output_file:\s*([^\n]+)/)?.[1]?.trim()
    return { displayText: output, outputFile }
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
  const teammateId = String(toolCall.id || input.agentTaskId || input.taskId || crypto.randomUUID())
  const agentType = String(input.agentType || input.type || 'general-purpose')
  const name = String(input.name || input.agentName || agentType)
  const existing = session.teamContext!.teammates[teammateId]
  const color = existing?.color || AGENT_COLORS[Object.keys(session.teamContext!.teammates).length % AGENT_COLORS.length]
  const transcript = session.teammateTranscripts![teammateId] || []

  if (toolCall.output && !transcript.some(m => m.id === `${toolCall.id}-result`)) {
    const parsedOutput = parseAgentToolOutput(toolCall.output)
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

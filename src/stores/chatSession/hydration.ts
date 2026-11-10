import type { Session, Message, MessageMetadata, SessionEngineType, TeammateStatus } from '@/types'
import { api } from '@/services/electronAPI'
import { createUuid } from '@/utils/uuid'
import { buildMessagesFromHistory } from '@/utils/sessionRestore'
import { mergeGenuiCardRecords } from '@/lib/genui/cardProjection'
import {
  recordAgentToolCall,
  ensureTeamContext,
  AGENT_COLORS,
} from '@/services/teamTranscriptService'

// 单会话在内存中保留的最大消息数。
// 长时间运行的 agent 任务会不断追加消息（每轮 LLM 调用 + 工具调用 + 工具结果），
// 没有上限时 session.messages 会无限增长，导致响应式系统遍历开销增大、
// saveToStorage 的 JSON.stringify 分配超大字符串触发 V8 OOM。
// 引擎自身持有完整对话历史，前端仅保留最近消息用于 UI 展示。
export const MAX_MESSAGES_PER_SESSION = 500

// 从 JSONL 恢复历史时，工具输出的最大长度。
// 与 chatStream.ts 的 MAX_INMEMORY_TOOL_OUTPUT 保持一致，
// 防止超长会话恢复时将数十 MB 的工具输出加载到内存。
const MAX_INMEMORY_TOOL_OUTPUT_HYDRATE = 30_000

export async function hydrateImageAttachments(sessions: Session[]): Promise<void> {
  const imageLoad = api.image?.load
  if (!imageLoad) return

  for (const session of sessions) {
    for (const msg of session.messages) {
      if (msg.imageAttachments?.length) {
        for (let i = 0; i < msg.imageAttachments.length; i++) {
          const img = msg.imageAttachments[i]
          if (img.id && !img.previewUrl && !img.data) {
            try {
              const dataUrl = await imageLoad(img.id)
              if (dataUrl) {
                msg.imageAttachments[i] = { ...img, previewUrl: dataUrl, data: dataUrl }
              }
            } catch {
              // 磁盘文件不存在，保持占位状态
            }
          }
        }
      }
      if (Array.isArray(msg.attachments)) {
        for (let i = 0; i < msg.attachments.length; i++) {
          const att = msg.attachments[i] as any
          if (att?.type === 'image' && att.id && !att.previewUrl && !att.data) {
            try {
              const dataUrl = await imageLoad(att.id)
              if (dataUrl) {
                msg.attachments[i] = { ...att, previewUrl: dataUrl, data: dataUrl }
              }
            } catch {
              // 同上
            }
          }
        }
      }
    }
  }
}

export async function hydrateSessionsFromJsonl(sessions: Session[], messageIdsAtStart?: Set<string>): Promise<void> {
  const claudeCode = api.claudeCode
  if (!claudeCode?.getFullSession) return

  for (const session of sessions) {
    const projectPath = session.workingDirectory
    if (!projectPath) continue

    const hasTruncated = session.messages.some(
      msg => typeof msg.content === 'string' && msg.content.includes('[Truncated for storage]')
    )
    try {
      // engineType 必须显式下发：Claude 与 pi 的 JSONL 根目录/文件名规则不同，
      // 让主进程按会话自己的引擎取历史，老会话缺字段时才回退到自动识别。
      const fullSession = await claudeCode.getFullSession(projectPath, session.id, session.engineType)
      if (!(fullSession?.messages as unknown[] | undefined)?.length) continue

      const fullEngineType = fullSession.engineType as SessionEngineType | undefined
      if (fullEngineType && !session.engineType) session.engineType = fullEngineType

      const restoredMessages = buildMessagesFromHistory(fullSession.messages as any[])
      if (restoredMessages.length === 0) continue

      // ★ 竞态保护：hydrate 是 selectSession 中 fire-and-forget 的异步任务，getFullSession
      // 读取 + 解析 635KB+ JSONL 的耗时窗口内，用户可能已经发送了新消息（turn 启动会同步把
      // processStatus 置为 'active'/'starting'）。此时本地消息比 JSONL 快照新（快照甚至是在
      // 引擎写入该用户消息之前读取的），整体覆盖会把刚发送的消息气泡从 UI 抹掉——表现为
      // "发送的消息变成了历史旧消息"。turn 进行中一律跳过覆盖，保留本地最新状态。
      if (session.processStatus === 'starting' || session.processStatus === 'active') {
        continue
      }

      // ★ 竞态保护 2：hydrate 启动后新追加的消息（非 turn 路径的窄窗口追加）不在快照里，
      // 从旧数组中挑出来，重建后合并回末尾，避免被覆盖丢失。
      // 以 role+content 匹配去重：引擎写入的同一条消息与本地消息 UUID 不同（引擎 UUID），
      // 但若快照已包含该内容则无需重复保留。
      const appendedDuringHydrate = messageIdsAtStart
        ? session.messages.filter(m => !m.id || !messageIdsAtStart.has(m.id))
        : []
      const restoredKeys = new Set(restoredMessages.map(m => `${m.role}|${m.content}`))
      const survivors = appendedDuringHydrate.filter(m => !restoredKeys.has(`${m.role}|${m.content}`))

      // ── 保留 SpaceCode 前端特有的 metadata 字段 ──
      // JSONL 转录文件由引擎写入，不包含 SpaceCode 前端在运行时计算的字段：
      //   • metadata.duration     — 每轮助手回复的用时（result 事件时 Date.now() - msg.timestamp）
      //   • metadata.apiCallUsage — 最后一次 API 调用的 token 明细
      //   • metadata.artifacts    — 办公模式产物汇总
      //   • metadata.warning     — 前端生成的警告信息
      //   • metadata.commandFiles — 回合窗口内观测到的间接改动（会话 review 的文件清单）
      //   • metadata.genUiCards   — 卡片记录与它的提交只读状态（票 05）
      // buildMessagesFromHistory 从 JSONL 重建消息时会丢失这些字段，导致重开后
      // 用时统计变为 0、产物汇总卡片消失、已提交的卡片又能改。此处从 localStorage 保存的
      // 旧消息中按助手消息位置提取这些字段，重建后按位置合并回去
      // （旧/新消息的 SpaceCode UUID 与引擎 UUID 不同，无法按 id 匹配）。
      const oldExtraMetaByAssistantIdx = new Map<number, Partial<MessageMetadata>>()
      let oldAssistantIdx = 0
      for (const oldMsg of session.messages) {
        if (oldMsg.role !== 'assistant') continue
        const md = oldMsg.metadata
        if (md) {
          const extra: Partial<MessageMetadata> = {}
          if (typeof md.duration === 'number') extra.duration = md.duration
          if (md.apiCallUsage) extra.apiCallUsage = md.apiCallUsage
          if (md.artifacts?.length) extra.artifacts = md.artifacts
          if (md.warning) extra.warning = md.warning
          if (md.commandFiles?.length) extra.commandFiles = md.commandFiles
          // 卡片按 id 合并的入口：已有记录优先，提交状态与已驱逐的占位都不能被重投影冲掉。
          if (md.genUiCards?.length) extra.genUiCards = md.genUiCards
          if (Object.keys(extra).length > 0) {
            oldExtraMetaByAssistantIdx.set(oldAssistantIdx, extra)
          }
        }
        oldAssistantIdx++
      }

      // 提交气泡的折叠标记同样是前端特有，而用户消息没有「按位置」可对：
      // JSONL 里混着 tool_result 之类的 user 记录，位置对齐会把标记贴到别的消息上，
      // 表现就是一条无辜的消息被折叠成别人的摘要。所以按正文精确认领、认领一条消耗一条
      // —— 正文一致才是同一条提交消息的可靠证据，宁可漏折叠也不认错。
      const submissionMetaByContent = new Map<string, MessageMetadata['genUiSubmission'][]>()
      for (const oldMsg of session.messages) {
        const submission = oldMsg.metadata?.genUiSubmission
        if (oldMsg.role !== 'user' || !submission) continue
        const pending = submissionMetaByContent.get(oldMsg.content) ?? []
        pending.push(submission)
        submissionMetaByContent.set(oldMsg.content, pending)
      }

      session.messages = restoredMessages.map(msg => ({
        ...msg,
        id: msg.id || createUuid(),
        // ★ 保留 JSONL 记录的原始时间戳；缺失时才回退到当前时间。
        // 此前无条件用 Date.now()，导致历史消息在 UI 上伪装成"刚发送"，
        // 掩盖了消息被覆盖丢失的问题。
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
        // 截断从 JSONL 加载的历史工具输出，与流式期间 MAX_INMEMORY_TOOL_OUTPUT 保持一致
        ...(msg.toolCalls?.length ? {
          toolCalls: msg.toolCalls.map(tc => ({
            ...tc,
            output: typeof tc.output === 'string' && tc.output.length > MAX_INMEMORY_TOOL_OUTPUT_HYDRATE
              ? tc.output.slice(0, MAX_INMEMORY_TOOL_OUTPUT_HYDRATE) + '\n\n[Output truncated to prevent memory overflow]'
              : tc.output,
          }))
        } : {}),
      })) as Message[]

      // ★ 追加 hydrate 期间用户新发送且快照中不存在的消息
      if (survivors.length > 0) {
        session.messages.push(...survivors as Message[])
      }

      // 将旧消息中保存的前端特有 metadata 按助手消息位置合并回重建后的消息
      if (oldExtraMetaByAssistantIdx.size > 0) {
        let newAssistantIdx = 0
        for (const newMsg of session.messages) {
          if (newMsg.role !== 'assistant') continue
          const savedMeta = oldExtraMetaByAssistantIdx.get(newAssistantIdx)
          if (savedMeta) {
            // 卡片是**合并**而不是覆盖：重投影会带出旧记录里没有的新卡，
            // 而已有记录（含提交状态与已驱逐的占位）按 id 优先留下。
            const savedCards = savedMeta.genUiCards
            newMsg.metadata = {
              ...(newMsg.metadata || {}),
              ...savedMeta,
              ...(savedCards
                ? { genUiCards: mergeGenuiCardRecords(savedCards, newMsg.metadata?.genUiCards ?? []) }
                : {}),
            }
          }
          newAssistantIdx++
        }
      }

      // 提交气泡：按正文认回折叠标记，认不到就原样显示全文（内容不会被折叠吞掉）。
      if (submissionMetaByContent.size > 0) {
        for (const newMsg of session.messages) {
          if (newMsg.role !== 'user' || newMsg.metadata?.genUiSubmission) continue
          const pending = submissionMetaByContent.get(newMsg.content)
          if (!pending?.length) continue
          newMsg.metadata = { ...(newMsg.metadata || {}), genUiSubmission: pending.shift()! }
        }
      }

      session.teamContext = undefined
      session.teammateTranscripts = {}

      for (const msg of session.messages) {
        if (msg.toolCalls) {
          for (const toolCall of msg.toolCalls) {
            if (toolCall.name === 'Agent') {
              recordAgentToolCall(session, toolCall, toolCall.status === 'completed' ? 'completed' : toolCall.status === 'error' ? 'failed' : 'running')
            }
          }
        }
      }

      const teammateMsgIndices: number[] = []
      for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i]
        if (msg.role === 'system' && msg.metadata?.kind === 'teammate-message') {
          const teammateId = msg.metadata.agentTaskId!
          const agentName = msg.metadata.agentName || 'teammate'
          const teamName = msg.metadata.teamName || 'Agent Team'
          const status = (msg.metadata.status || 'running') as TeammateStatus

          ensureTeamContext(session, teamName)

          const transcript = session.teammateTranscripts![teammateId] || []
          const cleanContent = msg.content.replace(/^\[.*?\]\s*/, '')
          const transcriptMsg: Message = {
            id: msg.id || createUuid(),
            role: 'assistant',
            content: cleanContent,
            timestamp: msg.timestamp || Date.now(),
            metadata: {
              agentTaskId: teammateId,
              agentName,
              teamName,
              status,
            },
          }

          if (!transcript.some(m => m.id === transcriptMsg.id)) {
            session.teammateTranscripts![teammateId] = [...transcript, transcriptMsg]
          }

          if (session.teamContext?.teammates[teammateId]) {
            session.teamContext.teammates[teammateId].status = status
            session.teamContext.teammates[teammateId].messageCount = session.teammateTranscripts![teammateId]?.length || 0
          } else {
            const color = AGENT_COLORS[Object.keys(session.teamContext?.teammates || {}).length % AGENT_COLORS.length]
            if (!session.teamContext) {
              session.teamContext = { teamName: '', isLeader: false, teammates: {} }
            }
            session.teamContext.teammates[teammateId] = {
              name: agentName,
              status,
              color,
              messageCount: session.teammateTranscripts![teammateId]?.length || 0,
            }
          }

          teammateMsgIndices.push(i)
        }
      }

      if (teammateMsgIndices.length > 0) {
        session.messages = session.messages.filter((_, i) => !teammateMsgIndices.includes(i))
      }

      if (session.teammateTranscripts) {
        for (const teammateId of Object.keys(session.teammateTranscripts)) {
          session.teammateTranscripts[teammateId].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        }
      }

      if (hasTruncated) {
        console.log(`[ChatStore] Hydrated truncated session ${session.id} from JSONL (${restoredMessages.length} messages)`)
      }
    } catch {
      // JSONL 文件不存在或解析失败，保持 localStorage 数据
    }
  }
}

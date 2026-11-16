/**
 * 办公助手首消息路由的编排：Store 持有可观察状态，assistantRouter 负责决策。
 * 这里把两者接起来 —— 扣住消息 → 决策 → 自动绑定/候选卡/失败形态 → 点选后发送。
 * 扣住的消息只活在内存里（重启后未决会话下次发送重新路由）。
 */
import { useAppStore } from '@/stores/app'
import { useAgentsStore, type AgentDef } from '@/stores/agents'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import {
  buildRoutingCandidates,
  createLlmRouterAdapter,
  routeFirstMessage,
} from '@/services/assistantRouter'
import type {
  PendingWorkRouting,
  RankedCandidate,
  RoutingSuggestion,
  WorkAssistantBinding,
  WorkRoutingFailure,
} from '@/types/workRouting'

export interface StartWorkRoutingInput {
  sessionId: string
  content: string
  messageContent: string
  userContent?: string
  attachments: PendingWorkRouting['attachments']
  isZh: boolean
  workspace?: string
}

/** 失败形态的库序候选数量：不空手，也别把卡片撑爆。 */
const SUGGESTION_LIMIT = 4

export function useWorkRouting() {
  const sessionStore = useChatSessionStore()
  const agentsStore = useAgentsStore()
  const turnStore = useTurnStore()
  const appStore = useAppStore()

  function findWorkAssistant(name: string): AgentDef | undefined {
    return agentsStore.installedAgents.find(a => a.name === name && a.mode === 'work')
      || agentsStore.libraryAgents.find(a => a.name === name && a.mode === 'work')
  }

  function toBinding(agent: AgentDef): WorkAssistantBinding {
    return {
      name: agent.name,
      skills: agent.skills,
      permission: agent.permission,
      skillRuntime: agent.skillRuntime,
      skillsRequired: agent.skillsRequired,
    }
  }

  async function ensureAgentsLoaded(workspace?: string) {
    try {
      if (agentsStore.libraryAgents.length === 0) await agentsStore.fetchLibrary(workspace)
      await agentsStore.fetchInstalled(workspace)
    } catch (err) {
      console.warn('[WorkRouting] Failed to load work assistants:', err)
    }
  }

  function buildSuggestions(isZh: boolean): RoutingSuggestion[] {
    const seen = new Set<string>()
    const list: RoutingSuggestion[] = []
    const push = (agent: AgentDef) => {
      if (agent.mode !== 'work' || !agent.name || seen.has(agent.name)) return
      seen.add(agent.name)
      list.push({
        name: agent.name,
        description: isZh && agent.descriptionZh ? agent.descriptionZh : agent.description,
      })
    }
    for (const agent of agentsStore.libraryAgents) push(agent)
    for (const agent of agentsStore.installedAgents) push(agent)
    return list.slice(0, SUGGESTION_LIMIT)
  }

  async function sendHeldMessage(pending: PendingWorkRouting) {
    try {
      await turnStore.sendMessage(
        pending.messageContent,
        pending.userContent,
        {
          files: pending.attachments.files.map(file => ({ ...file })),
          images: pending.attachments.images.map(image => ({ ...image })),
        },
        { sessionId: pending.sessionId },
      )
    } catch (error) {
      console.error('[WorkRouting] Failed to send held first message:', error)
    }
  }

  async function finishWithAssistant(
    sessionId: string,
    attempt: number,
    isZh: boolean,
    outcome: 'auto' | 'picked',
    assistant: WorkAssistantBinding,
    ranked: RankedCandidate[],
  ) {
    const pending = sessionStore.getPendingWorkRouting(sessionId)
    if (!pending) return
    if (!sessionStore.tryLockWorkRoutingCompletion(sessionId)) return
    try {
      const completed = await sessionStore.completeWorkRouting(sessionId, {
        attempt,
        outcome,
        assistant,
        ranked,
      })
      if (!completed) {
        // 收口被取消/切换会话抢先：失败形态不能空手，补上库序候选。
        const latest = sessionStore.getPendingWorkRouting(sessionId)
        if (latest && latest.phase === 'candidates' && latest.suggestions.length === 0) {
          sessionStore.setWorkRoutingCandidates(sessionId, {
            attempt,
            suggestions: buildSuggestions(isZh),
          })
        }
        return
      }
      appStore.openArtifactsPanel()
      await sendHeldMessage(pending)
    } finally {
      sessionStore.unlockWorkRoutingCompletion(sessionId)
    }
  }

  /**
   * 首消息路由入口：先扣住消息（时间线内联显示 + composer 禁用），再异步决策。
   * 决策结果只有三种去向：自动绑定、候选卡、失败形态候选卡 —— 永远不静默丢消息。
   */
  async function startFirstMessageRouting(input: StartWorkRoutingInput): Promise<void> {
    const { sessionId, isZh } = input
    const { signal, attempt } = sessionStore.beginWorkRouting({
      sessionId,
      content: input.content,
      messageContent: input.messageContent,
      userContent: input.userContent,
      attachments: input.attachments,
    })

    await ensureAgentsLoaded(input.workspace)

    const candidates = buildRoutingCandidates({
      library: agentsStore.libraryAgents,
      installed: agentsStore.installedAgents,
      isZh,
    })

    const outcome = await routeFirstMessage({
      message: input.content,
      candidates,
      isZh,
      adapter: createLlmRouterAdapter(),
      signal,
    })

    if (outcome.kind === 'auto') {
      const assistant = findWorkAssistant(outcome.assistant)
      if (assistant) {
        await finishWithAssistant(sessionId, attempt, isZh, 'auto', toBinding(assistant), outcome.ranked)
        return
      }
      // 决策给出的名字在候选集里找不到（理论上不可能）：退失败形态，消息仍扣着。
      sessionStore.setWorkRoutingCandidates(sessionId, {
        attempt,
        failure: 'error',
        suggestions: buildSuggestions(isZh),
      })
      return
    }

    if (outcome.kind === 'candidates') {
      sessionStore.setWorkRoutingCandidates(sessionId, { attempt, ranked: outcome.ranked })
      return
    }

    const failure: WorkRoutingFailure = outcome.kind === 'none' ? 'none' : outcome.reason
    sessionStore.setWorkRoutingCandidates(sessionId, {
      attempt,
      failure,
      suggestions: buildSuggestions(isZh),
    })
  }

  /** 候选卡点选：就地绑定（switchWorkAssistant）后把扣住的消息原样发出。 */
  async function pickCandidate(sessionId: string, name: string): Promise<boolean> {
    const pending = sessionStore.getPendingWorkRouting(sessionId)
    if (!pending || pending.phase !== 'candidates') return false
    const assistant = findWorkAssistant(name)
    if (!assistant) {
      console.warn('[WorkRouting] Picked assistant is not in the candidate set:', name)
      return false
    }
    if (!sessionStore.tryLockWorkRoutingCompletion(sessionId)) return false
    try {
      const completed = await sessionStore.completeWorkRouting(sessionId, {
        attempt: pending.attempt,
        outcome: 'picked',
        assistant: toBinding(assistant),
        ranked: pending.ranked,
      })
      if (!completed) return false
      appStore.openArtifactsPanel()
      await sendHeldMessage(pending)
      return true
    } finally {
      sessionStore.unlockWorkRoutingCompletion(sessionId)
    }
  }

  /** 「通用对话」出口：不绑定助手，直接以通用会话发送扣住的消息。 */
  async function chooseGeneral(sessionId: string): Promise<boolean> {
    const pending = sessionStore.getPendingWorkRouting(sessionId)
    if (!pending || pending.phase !== 'candidates') return false
    if (!sessionStore.tryLockWorkRoutingCompletion(sessionId)) return false
    try {
      const completed = sessionStore.completeGeneralWorkRouting(sessionId, { attempt: pending.attempt })
      if (!completed) return false
      await sendHeldMessage(pending)
      return true
    } finally {
      sessionStore.unlockWorkRoutingCompletion(sessionId)
    }
  }

  /** 取消匹配：中止在途请求，卡片转为失败形态等待点选。 */
  function cancelRouting(sessionId: string) {
    sessionStore.abortWorkRouting(sessionId)
  }

  /** 失败形态候选卡的「从画廊选择」：让画廊点选落回当前会话而非新建。 */
  function openGalleryForRouting(sessionId: string) {
    const pending = sessionStore.getPendingWorkRouting(sessionId)
    if (!pending || pending.phase !== 'candidates') return
    sessionStore.setRoutingGalleryTarget(sessionId)
    appStore.showWorkGallery = true
  }

  /**
   * 画廊点选的交接：命中路由目标会话时走与卡片点选完全相同的收口路径。
   * 存在交接目标就返回 true（哪怕本次点选没落地），避免画廊再新建会话、
   * 把原会话的扣住消息晾在一边。
   */
  async function completeGalleryPick(name: string): Promise<boolean> {
    const sessionId = sessionStore.routingGalleryTarget
    if (!sessionId) return false
    const handled = await pickCandidate(sessionId, name)
    if (handled) sessionStore.setRoutingGalleryTarget(null)
    return true
  }

  return {
    startFirstMessageRouting,
    pickCandidate,
    chooseGeneral,
    cancelRouting,
    openGalleryForRouting,
    completeGalleryPick,
  }
}

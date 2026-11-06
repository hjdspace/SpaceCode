/**
 * Worker 首轮消息的上下文组装（T05 #75）：contextReader/contextBudget。
 *
 * 预算集中在 SUPER_AGENT_CONTEXT_BUDGETS（设计 §8.1：卡片 preview 160、
 * Worker Trigger 600、文本页 4000/8000、列表 20/50）。超预算内容落 Spill
 * 文件，首轮消息只留占位：标注 total_chars/read 与落盘路径，不把截断
 * 文本伪装成完整事实。
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { renderSuperAgentRoutingNote } from './prompts'
import type {
  SuperAgentDecision,
  SuperAgentMandate,
  SuperAgentPolicyRule,
  SuperAgentTicket,
  SuperAgentTrigger,
} from './model'
import type { SuperAgentWorkspaceStatus } from './workspace'

export const SUPER_AGENT_CONTEXT_BUDGETS = Object.freeze({
  /** Trigger 卡片 preview。 */
  triggerPreviewChars: 160,
  /** Worker 首轮消息内联的目标描述上限。 */
  workerTriggerChars: 600,
  /** Assignment 摘要预算。 */
  assignmentChars: 1500,
  /** 文本页默认/最大 UTF-16 code units。 */
  textPageChars: 4000,
  textPageMaxChars: 8000,
  /** 列表默认/最大条数。 */
  listDefault: 20,
  listMax: 50,
})

/** Spill 落盘接缝：(ticketId, 文件名, 内容) => 绝对路径。 */
export type SpillWriter = (ticketId: string, name: string, content: string) => string

export interface WorkerFirstMessageInput {
  ticket: SuperAgentTicket
  mandate: SuperAgentMandate
  decision: SuperAgentDecision
  trigger: SuperAgentTrigger
  workspace: SuperAgentWorkspaceStatus
  /** 派工时携带的 @ 上下文（相对路径）。 */
  contextPaths: string[]
  attachments: string[]
  /** Router 的路由说明（≤30 字）；只是旁注，不授权也不替代目标原文。 */
  note?: string | null
  /** 当前 Policy 的规则表：把 Mandate 里命中的规则名翻成必须遵守的约束。 */
  policyRules?: SuperAgentPolicyRule[]
  spillWriter: SpillWriter
}

export interface WorkerFirstMessage {
  text: string
  /** 本次组装产生的 Spill 文件路径（供审计与测试）。 */
  spillFiles: string[]
}

/** 截断占位：标注完整长度与内联长度，附 Spill 路径。 */
function truncatePlaceholder(totalChars: number, readChars: number, spillPath: string): string {
  return `[内容超出首轮预算已截断：total_chars=${totalChars} read=${readChars}，完整内容见 ${spillPath}]`
}

function spillMarkdown(title: string, content: string): string {
  return `# ${title}\n\n${content}\n`
}

export function assembleWorkerFirstMessage(input: WorkerFirstMessageInput): WorkerFirstMessage {
  const {
    ticket, mandate, decision, trigger, workspace, contextPaths, attachments, note, policyRules,
    spillWriter,
  } = input
  const spillFiles: string[] = []

  const sections: string[] = []

  // ── 工单与授权卡片（审计链：Decision → Mandate 的字段对齐）──
  const scopeText =
    mandate.scope.paths.length > 0 ? mandate.scope.paths.join(', ') : '整个仓库'
  sections.push(
    [
      `# 工单指派：${ticket.title}`,
      '',
      `- ticket: ${ticket.ticketId}`,
      `- 授权（Mandate ${mandate.mandateId}）：policy v${mandate.policyVersion} · strength=${mandate.strength} · basis=${mandate.basis}`,
      `- 决策（Decision ${decision.decisionId}）：${decision.action}（source=${decision.source}, actor=${decision.actor}）`,
      `- 工作目录：${mandate.scope.repoRoot}（scope: ${scopeText}）`,
    ].join('\n'),
  )

  // ── 目标（Trigger）：超预算内联截断 + Spill 完整原文 ──
  const goalText = trigger.text
  let goalSection = `## 目标\n\n${goalText}`
  if (goalText.length > SUPER_AGENT_CONTEXT_BUDGETS.workerTriggerChars) {
    const read = SUPER_AGENT_CONTEXT_BUDGETS.workerTriggerChars
    const spillPath = spillWriter(
      ticket.ticketId,
      'goal.md',
      spillMarkdown('工单目标（完整原文）', goalText),
    )
    spillFiles.push(spillPath)
    goalSection = `## 目标\n\n${goalText.slice(0, read)}\n${truncatePlaceholder(goalText.length, read, spillPath)}`
  }
  sections.push(goalSection)

  // ── Router 的路由说明：紧跟目标，位置本身就说明了它的从属 ──
  const noteSection = renderSuperAgentRoutingNote(note)
  if (noteSection !== '') sections.push(noteSection)

  // ── 命中的 Policy 规则：规则名 → 必须遵守的约束指令 ──
  // Mandate 只存规则名；执行时按当前 Policy 的规则表翻译成 Worker 能直接遵守的指令。
  const matchedRules = mandate.matchedRules
    .map((name) => policyRules?.find((rule) => rule.name === name))
    .filter((rule): rule is SuperAgentPolicyRule => rule !== undefined)
  if (matchedRules.length > 0) {
    sections.push(
      [
        '## 命中的授权规则（必须遵守）',
        '',
        ...matchedRules.map((rule) => `- 「${rule.name}」：${rule.instruction}`),
      ].join('\n'),
    )
  }

  // ── 共享工作区现状：launch 前脏区检查结果注入首条消息 ──
  const workspaceText = workspace.dirty
    ? `共享目录存在未提交改动，执行前请先核对现状，禁止自动 reset/stash：\n${workspace.statusText}`
    : '工作区干净。'
  sections.push(`## 共享工作区现状\n\n${workspaceText}`)

  // ── 派工上下文：@ 路径与附件；列表超预算内联前 listDefault 项 + Spill 全量 ──
  const contextEntries = [
    ...contextPaths.map((path) => `@${path}`),
    ...attachments.map((file) => `附件：${file}`),
  ]
  let contextSection: string
  if (contextEntries.length === 0) {
    contextSection = '## 派工上下文\n\n（无）'
  } else if (contextEntries.length <= SUPER_AGENT_CONTEXT_BUDGETS.listDefault) {
    contextSection = `## 派工上下文\n\n${contextEntries.join('\n')}`
  } else {
    const spillPath = spillWriter(
      ticket.ticketId,
      'context-list.md',
      spillMarkdown('派工上下文（完整列表）', contextEntries.join('\n')),
    )
    spillFiles.push(spillPath)
    const inlined = contextEntries.slice(0, SUPER_AGENT_CONTEXT_BUDGETS.listDefault)
    contextSection = `## 派工上下文\n\n${inlined.join('\n')}\n${truncatePlaceholder(contextEntries.length, inlined.length, spillPath)}`
  }
  sections.push(contextSection)

  return { text: sections.join('\n\n'), spillFiles }
}

/** 把 Spill 文件写进 `<baseDir>/<ticketId>/<name>`；返回绝对路径。 */
export function createFileSpillWriter(baseDir: string): SpillWriter {
  return (ticketId, name, content) => {
    const dir = join(baseDir, ticketId)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, name)
    writeFileSync(path, content, 'utf8')
    return path
  }
}

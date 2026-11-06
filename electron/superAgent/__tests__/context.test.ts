// @vitest-environment node
/**
 * Worker 首轮消息的上下文组装（T05 #75）：contextReader/contextBudget。
 * 覆盖：Mandate 卡片与 Trigger 卡片内联、共享目录现状注入、
 * @ 上下文与附件注入、超预算内容落 Spill 文件并在首轮消息留占位。
 */
import { describe, expect, it } from 'vitest'
import { SUPER_AGENT_CONTEXT_BUDGETS, assembleWorkerFirstMessage } from '../context'
import { createSuperAgentDomain } from '../domain'
import type { SuperAgentWorkspaceStatus } from '../workspace'
import type { SuperAgentPolicyRule, SuperAgentTrigger } from '../model'

const AT = '2026-01-01T00:00:00.000Z'

const CLEAN: SuperAgentWorkspaceStatus = { dirty: false, statusText: '', head: 'main', entries: [] }
const DIRTY: SuperAgentWorkspaceStatus = {
  dirty: true,
  statusText: ' M src/a.ts\n?? notes.md',
  head: 'main',
  entries: [' M src/a.ts', '?? notes.md'],
}

interface Fixture {
  domain: ReturnType<typeof createSuperAgentDomain>
  trigger: SuperAgentTrigger
  ticketId: string
  mandateId: string
  spillFiles: { name: string; content: string }[]
  spillPaths: string[]
  spillWriter: (ticketId: string, name: string, content: string) => string
}

function makeFixture(overrides: { text?: string; contextPaths?: string[]; attachments?: string[] } = {}): Fixture {
  let counter = 0
  const domain = createSuperAgentDomain({
    now: () => new Date(AT),
    newId: (kind) => `${kind}-${++counter}`,
  })
  const dispatch = domain.dispatch({
    requestId: 'dispatch-1',
    title: '修复登录',
    repoRoot: '/repo',
    text: overrides.text ?? '登录按钮点击后无响应，请排查并修复',
    actor: 'alice',
    contextPaths: overrides.contextPaths ?? ['src/login.ts'],
    attachments: overrides.attachments ?? ['docs/需求.md'],
  })

  const spillFiles: { name: string; content: string }[] = []
  const spillPaths: string[] = []
  const spillWriter = (ticketId: string, name: string, content: string) => {
    spillFiles.push({ name, content })
    const path = `/spill/${ticketId}/${name}`
    spillPaths.push(path)
    return path
  }

  return {
    domain,
    trigger: domain.state.triggers[dispatch.ticket.origin.triggerId],
    ticketId: dispatch.ticket.ticketId,
    mandateId: dispatch.ticket.mandateId,
    spillFiles,
    spillPaths,
    spillWriter,
  }
}

function assemble(
  fixture: Fixture,
  workspace: SuperAgentWorkspaceStatus,
  overrides: {
    contextPaths?: string[]
    attachments?: string[]
    note?: string | null
    policyRules?: SuperAgentPolicyRule[]
  } = {},
) {
  const state = fixture.domain.state
  return assembleWorkerFirstMessage({
    ticket: state.tickets[fixture.ticketId],
    mandate: state.mandates[fixture.mandateId],
    decision: state.decisions[fixture.ticketId],
    trigger: fixture.trigger,
    workspace,
    contextPaths: overrides.contextPaths ?? ['src/login.ts'],
    attachments: overrides.attachments ?? ['docs/需求.md'],
    note: overrides.note,
    policyRules: overrides.policyRules,
    spillWriter: fixture.spillWriter,
  })
}

describe('assembleWorkerFirstMessage', () => {
  it('inlines the mandate card, goal, workspace status and dispatch context', () => {
    const fixture = makeFixture()
    const message = assemble(fixture, DIRTY)

    const text = message.text
    expect(text).toContain('修复登录')
    expect(text).toContain('登录按钮点击后无响应，请排查并修复')
    // Mandate 卡片：授权与决策审计链
    expect(text).toContain('explicit')
    expect(text).toContain('addressed')
    expect(text).toContain('/repo')
    // 共享目录现状注入
    expect(text).toContain(' M src/a.ts')
    expect(text).toContain('?? notes.md')
    // @ 上下文与附件
    expect(text).toContain('@src/login.ts')
    expect(text).toContain('docs/需求.md')
    expect(message.spillFiles).toEqual([])
  })

  it('renders the routing note right after the goal and marks it non-authorizing', () => {
    const fixture = makeFixture()
    const withNote = assemble(fixture, CLEAN, { note: '人点名了设置页' })

    expect(withNote.text).toContain('## 路由说明')
    expect(withNote.text).toContain('不授权、不替代上面的目标原文')
    expect(withNote.text).toContain('人点名了设置页')
    // 位置本身就是从属关系：紧跟目标，排在现状与派工上下文之前
    expect(withNote.text.indexOf('## 路由说明')).toBeLessThan(
      withNote.text.indexOf('## 共享工作区现状'),
    )
    // 没有旁注就不该留一个空标题
    expect(assemble(fixture, CLEAN).text).not.toContain('## 路由说明')
  })

  it('把 Mandate 命中的 Policy 规则翻成必须遵守的约束指令', () => {
    const fixture = makeFixture()
    fixture.domain.setPolicy({
      acceptMode: 'auto',
      rules: [
        { name: 'rule-a', instruction: '先看日志再改代码' },
        { name: 'rule-b', instruction: '不要碰 engine/' },
      ],
      admissions: [],
    })
    fixture.domain.state.mandates[fixture.mandateId]!.matchedRules = ['rule-a']

    const message = assemble(fixture, CLEAN, {
      policyRules: fixture.domain.state.policy.rules,
    })
    expect(message.text).toContain('## 命中的授权规则（必须遵守）')
    expect(message.text).toContain('先看日志再改代码')
    expect(message.text).not.toContain('不要碰 engine/')
  })

  it('没有命中规则时不产出授权规则段', () => {
    const fixture = makeFixture()
    fixture.domain.setPolicy({
      acceptMode: 'auto',
      rules: [{ name: 'rule-a', instruction: '先看日志再改代码' }],
      admissions: [],
    })

    const message = assemble(fixture, CLEAN, {
      policyRules: fixture.domain.state.policy.rules,
    })
    expect(message.text).not.toContain('## 命中的授权规则')
  })

  it('injects a clean-workspace note when the repository is clean', () => {
    const fixture = makeFixture()
    const message = assemble(fixture, CLEAN)

    expect(message.text).toContain('干净')
    expect(message.spillFiles).toEqual([])
  })

  it('spills an oversized goal text and leaves a placeholder with total_chars and read marker', () => {
    const longText = 'x'.repeat(SUPER_AGENT_CONTEXT_BUDGETS.workerTriggerChars + 100)
    const fixture = makeFixture({ text: longText })
    const message = assemble(fixture, DIRTY)

    // 首轮消息只内联预算内的内容，且标注截断事实（不得把截断文本伪装成完整事实）
    expect(message.text).not.toContain(longText)
    expect(message.text).toContain(`total_chars=${longText.length}`)
    expect(message.text).toContain(`read=${SUPER_AGENT_CONTEXT_BUDGETS.workerTriggerChars}`)
    // Spill 文件承载完整原文，占位引用指向落盘路径
    expect(message.spillFiles).toEqual(fixture.spillPaths)
    expect(message.text).toContain(fixture.spillPaths[0])
    expect(fixture.spillFiles[0].content).toContain(longText)
  })

  it('spills the context list when dispatch context paths exceed the list budget', () => {
    const manyPaths = Array.from(
      { length: SUPER_AGENT_CONTEXT_BUDGETS.listDefault + 5 },
      (_, i) => `src/file-${i}.ts`,
    )
    const fixture = makeFixture({ contextPaths: manyPaths, attachments: [] })
    const message = assemble(fixture, DIRTY, { contextPaths: manyPaths, attachments: [] })

    // 前 listDefault 项内联，其余落 Spill
    expect(message.text).toContain('@src/file-0.ts')
    expect(message.text).not.toContain(`@src/file-${SUPER_AGENT_CONTEXT_BUDGETS.listDefault}.ts`)
    expect(message.spillFiles).toEqual(fixture.spillPaths)
    expect(fixture.spillFiles[0].content).toContain(
      `@src/file-${SUPER_AGENT_CONTEXT_BUDGETS.listDefault}.ts`,
    )
  })
})

import { describe, expect, it } from 'vitest'
import {
  findDialogForQuestion,
  matchDialogToQuestion,
  matchEditorDialogToQuestion,
  matchPlanActionDialog,
  optionRowLabel,
  otherRowLabel,
  parseQuestionnaireOutput,
  questionDialogTitle,
  type PlanModeQuestion,
} from '@/lib/planModeDialogMatcher'
import type { ExtensionDialog } from '@/services/extensionDialogService'

/** 与 pi-tui-kit formatRpcOption 同构的题目样例（em dash U+2014） */
const QUESTION: PlanModeQuestion = {
  header: '预览范围',
  question: '主题预览应该覆盖哪些界面？',
  options: [
    { label: '仅设置页', description: '实现最简单，预览只出现在设置页内' },
    { label: '设置页 + 侧栏', description: '预览延伸到侧栏，覆盖最高频区域' },
    { label: '全局浮窗', description: '任意界面悬浮预览，需窗口层级改造' },
  ],
}

function makeDialog(overrides: Partial<ExtensionDialog>): ExtensionDialog {
  return {
    dialogId: 'uuid-1',
    method: 'select',
    title: questionDialogTitle(QUESTION),
    sessionId: 'sid-1',
    state: 'pending',
    ...overrides,
  } as ExtensionDialog
}

describe('optionRowLabel 与 pi-tui-kit formatRpcOption 逐字符一致', () => {
  it('带 description 的行是 `N. label — description`（em dash U+2014）', () => {
    expect(optionRowLabel(QUESTION, 0)).toBe('1. 仅设置页 \u2014 实现最简单，预览只出现在设置页内')
    expect(optionRowLabel(QUESTION, 2)).toBe('3. 全局浮窗 \u2014 任意界面悬浮预览，需窗口层级改造')
    // 行分隔符必须是 em dash（U+2014），不能是连字符或 en dash
    expect(optionRowLabel(QUESTION, 0)).toContain('\u2014')
    expect(optionRowLabel(QUESTION, 0)).not.toContain(' - ')
    expect(optionRowLabel(QUESTION, 0)).not.toContain('\u2013')
  })

  it('Other 行的行号 = 选项数 + 1，后缀逐字符一致', () => {
    expect(otherRowLabel(QUESTION)).toBe('4. Other (free-form)')
  })

  it('description 缺席时退化为 `N. label`', () => {
    const q: PlanModeQuestion = { header: 'h', question: 'q', options: [{ label: 'A' }] }
    expect(optionRowLabel(q, 0)).toBe('1. A')
  })
})

describe('select 帧标题配对', () => {
  it('标题与 `header: question` 完全一致 → exact', () => {
    const dialog = makeDialog({})
    expect(matchDialogToQuestion(dialog, QUESTION)).toBe('exact')
  })

  it('标题以 `header: question` 开头（扩展追加了内容）→ prefix', () => {
    const dialog = makeDialog({ title: `${questionDialogTitle(QUESTION)}（单选）` })
    expect(matchDialogToQuestion(dialog, QUESTION)).toBe('prefix')
  })

  it('无关标题不命中', () => {
    expect(matchDialogToQuestion(makeDialog({ title: 'Allow dangerous command?' }), QUESTION)).toBeNull()
    // 一道题是另一道题的延续时，不能拿别的题的帧充数
    const other: PlanModeQuestion = { header: '预览范围', question: '主题预览要保留历史吗？', options: [] }
    expect(matchDialogToQuestion(makeDialog({}), other)).toBeNull()
  })

  it('非 select 方法不命中', () => {
    expect(matchDialogToQuestion(makeDialog({ method: 'confirm' }), QUESTION)).toBeNull()
    expect(matchDialogToQuestion(undefined, QUESTION)).toBeNull()
  })
})

describe('findDialogForQuestion 在候选中挑帧', () => {
  it('exact 优先于 prefix：一题是另一题前缀时不抢错帧', () => {
    const shorter: PlanModeQuestion = { header: 'H', question: 'Add tests', options: [] }
    const longer: PlanModeQuestion = { header: 'H', question: 'Add tests for X', options: [] }
    const dialogs = [
      makeDialog({ dialogId: 'd-long', title: questionDialogTitle(longer) }),
      makeDialog({ dialogId: 'd-short', title: questionDialogTitle(shorter) }),
    ]
    expect(findDialogForQuestion(dialogs, shorter)?.dialogId).toBe('d-short')
    expect(findDialogForQuestion(dialogs, longer)?.dialogId).toBe('d-long')
  })

  it('prefix 命中多个时取最新打开的，其余留给 ExtensionDialogCard', () => {
    const other: PlanModeQuestion = { header: '预览范围', question: '主题预览要保留历史吗？', options: [] }
    const dialogs = [
      makeDialog({ dialogId: 'd-old', title: `${questionDialogTitle(other)}（旧）` }),
      makeDialog({ dialogId: 'd-new', title: `${questionDialogTitle(other)}（新）` }),
    ]
    expect(findDialogForQuestion(dialogs, other)?.dialogId).toBe('d-new')
  })

  it('没有命中时返回 undefined（降级路径）', () => {
    expect(findDialogForQuestion([makeDialog({ title: 'unrelated' })], QUESTION)).toBeUndefined()
  })
})

describe('editor 帧与行动菜单配对', () => {
  it('Other 之后的 editor 帧标题就是题目原文', () => {
    expect(matchEditorDialogToQuestion(makeDialog({ method: 'editor', title: QUESTION.question }), QUESTION)).toBe('exact')
    expect(matchEditorDialogToQuestion(makeDialog({ method: 'editor', title: '别的编辑' }), QUESTION)).toBeNull()
  })

  it('plan-action 菜单：标题含 Plan mode 的 select', () => {
    expect(matchPlanActionDialog(makeDialog({ title: 'Plan mode — what next?', options: ['Start', 'Settings'] }))).toBe(true)
    expect(matchPlanActionDialog(makeDialog({ title: questionDialogTitle(QUESTION) }))).toBe(false)
    expect(matchPlanActionDialog(makeDialog({ method: 'confirm', title: 'Plan mode?' }))).toBe(false)
  })
})

describe('parseQuestionnaireOutput 宽松解析 tool_result', () => {
  it('合法 JSON 对象原样返回', () => {
    const output = JSON.stringify({ cancelled: false, answers: [{ question: 'q1', answer: 'a1' }] })
    const parsed = parseQuestionnaireOutput(output)
    expect(parsed).not.toBeNull()
    expect(parsed!.cancelled).toBe(false)
    expect(parsed!.answers).toHaveLength(1)
  })

  it('截断 / 非 JSON / 空串 / 数组都返回 null，不抛异常', () => {
    expect(parseQuestionnaireOutput('{"cancelled": false, "answers": [{"ques')).toBeNull()
    expect(parseQuestionnaireOutput('not json at all')).toBeNull()
    expect(parseQuestionnaireOutput('')).toBeNull()
    expect(parseQuestionnaireOutput(undefined)).toBeNull()
    expect(parseQuestionnaireOutput('[1,2,3]')).toBeNull()
  })
})

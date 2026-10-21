import type { ExtensionDialog } from '@/services/extensionDialogService'

/**
 * pi plan-mode 问卷的渲染层数据形态。与 pi-tui-kit `runRpcQuestionnaire` 的
 * questions 数组同构（扩展 schema 保证 description 必有，这里仍做存在性守卫）。
 */
export interface PlanModeQuestionOption {
  label: string
  description?: string
}

export interface PlanModeQuestion {
  question: string
  header: string
  options: PlanModeQuestionOption[]
}

/**
 * plan_mode_question 的 tool_result 形态（JSON 文本）。宽松解析：
 * 字段齐不齐不保证，解析失败时调用方显示「已结束」，不造数据。
 */
export interface QuestionnaireOutput {
  cancelled?: boolean
  answers?: Array<Record<string, unknown>>
}

/** pi-tui-kit 固定追加在选项末尾的自由作答行 */
export const OTHER_ROW_SUFFIX = 'Other (free-form)'

/**
 * 生成与 pi-tui-kit `formatRpcOption` 逐字符一致的选项行：
 * `"1. label — description"`（em dash U+2014，两边都有空格）。
 * 引擎按这条原文认账，所以拼接规则不能有任何出入。
 */
export function optionRowLabel(question: PlanModeQuestion, index: number): string {
  const option = question.options[index]
  if (!option) return `${index + 1}.`
  return option.description
    ? `${index + 1}. ${option.label} — ${option.description}`
    : `${index + 1}. ${option.label}`
}

/** Other 行的行号 = 选项数 + 1（扩展在所有 formatRpcOption 行之后固定追加） */
export function otherRowLabel(question: PlanModeQuestion): string {
  return `${question.options.length + 1}. ${OTHER_ROW_SUFFIX}`
}

/** 这道题对应的 select 帧标题：`"{header}: {question}"` */
export function questionDialogTitle(question: PlanModeQuestion): string {
  return `${question.header}: ${question.question}`
}

export type DialogMatch = 'exact' | 'prefix'

/**
 * select 帧是否属于这道题。title 以 `"{header}: {question}"` 开头即配对：
 * header/question 都来自同一个 questions 数组，重复概率趋零；exact 表示标题
 * 与预期完全一致，prefix 允许扩展在标题后面追加内容（版本演进容忍）。
 * 消费侧应 exact 优先（findDialogForQuestion），避免「一道题是另一道题前缀」时
 * 抢错帧。
 */
export function matchDialogToQuestion(
  dialog: Pick<ExtensionDialog, 'method' | 'title'> | undefined,
  question: PlanModeQuestion,
): DialogMatch | null {
  if (!dialog || dialog.method !== 'select' || typeof dialog.title !== 'string') return null
  const expected = questionDialogTitle(question)
  if (dialog.title === expected) return 'exact'
  if (dialog.title.startsWith(expected)) return 'prefix'
  return null
}

/** Other 流程的 editor 帧：标题就是题目原文（runRpcQuestionnaire 的 free-form 编辑帧） */
export function matchEditorDialogToQuestion(
  dialog: Pick<ExtensionDialog, 'method' | 'title'> | undefined,
  question: PlanModeQuestion,
): DialogMatch | null {
  if (!dialog || dialog.method !== 'editor' || typeof dialog.title !== 'string') return null
  if (dialog.title === question.question) return 'exact'
  if (dialog.title.startsWith(question.question)) return 'prefix'
  return null
}

/**
 * plan_mode_complete 之后的行动菜单：标题含 "Plan mode" 的 select 帧
 * （实测形如 `Plan mode — what next?`，选项为菜单项原文）。
 */
export function matchPlanActionDialog(
  dialog: Pick<ExtensionDialog, 'method' | 'title'> | undefined,
): boolean {
  if (!dialog || dialog.method !== 'select' || typeof dialog.title !== 'string') return false
  return dialog.title.includes('Plan mode')
}

/**
 * 从候选里挑这道题的对话框：exact 优先；prefix 命中多个时取最新打开的
 * （候选按到达序排列，后者更新），其余的留给 ExtensionDialogCard 独立渲染 ——
 * 这是「卡片与对话框同屏」对策的一半，应答后原对话框自然变成已答回执。
 */
export function findDialogForQuestion(
  candidates: ExtensionDialog[],
  question: PlanModeQuestion,
): ExtensionDialog | undefined {
  let prefixHit: ExtensionDialog | undefined
  for (const dialog of candidates) {
    const match = matchDialogToQuestion(dialog, question)
    if (match === 'exact') return dialog
    if (match === 'prefix') prefixHit = dialog
  }
  return prefixHit
}

/**
 * 宽松解析 plan_mode_question 的 tool_result。合法 JSON 对象原样返回；
 * 截断、非 JSON、数组、空串都返回 null —— 调用方据此显示「已结束」，不造数据。
 */
export function parseQuestionnaireOutput(output?: string): QuestionnaireOutput | null {
  if (!output) return null
  try {
    const parsed: unknown = JSON.parse(output)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as QuestionnaireOutput
  } catch {
    return null
  }
}

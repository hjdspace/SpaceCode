/**
 * pi-plan-mode 扩展固定文案的宿主侧本地化。
 *
 * 行动菜单（plan_mode_complete 之后那帧 select）是扩展包里写死的英文 —— 不是
 * 模型生成的，改扩展又触碰只读禁区，所以翻译只能做在渲染层：**显示译文，
 * 应答回传原文**（引擎按选项原文认账，译文绝不能进 IPC）。
 *
 * 已知字符串之外的输入（模型自由生成的问卷题、未来版本的措辞变更）一律
 * 原样透传 —— 宁可显示英文，也不猜语义造错译文。
 */

/** 扩展行动菜单的已知字符串 → zh-CN。选项名与说明行里的引用保持一致。 */
const PLAN_ACTION_ZH: Record<string, string> = {
  'Proposed plan ready. What next?': '计划已就绪，接下来做什么？',

  'Implement here': '在本会话实施',
  'Start fresh and implement': '转到新会话实施',
  'Export plan…': '导出计划…',
  'Export plan...': '导出计划…',
  'Save for later': '保存计划，稍后使用',
  'Stay in Plan mode': '留在计划模式',
  'Discard plan and exit': '放弃计划并退出',

  'Implement here keeps this planning conversation.': '「在本会话实施」将继续当前的规划对话。',
  'Start fresh transfers only the approved plan to a new session.':
    '「转到新会话实施」只会把已批准的计划带进一个新会话。',
  'Plan reinjection: Off; use conversation history only.': '计划回注：关闭，仅使用对话历史。',
}

/**
 * 单条文案本地化：整串精确匹配已知表，命中给译文，未命中原样返回。
 * 用于 select 的选项 —— 选项原文就是应答值，显示层换、值不换。
 */
export function localizePlanActionText(text: string, locale: string): string {
  if (locale !== 'zh-CN') return text
  return PLAN_ACTION_ZH[text] ?? text
}

/**
 * 整段文案本地化：pi 把「标题 + 若干说明行」拼在 title 里一次发来，
 * 逐行匹配后原样拼回；说明行里的未知行保留原文，不丢行。
 */
export function localizePlanActionBlock(text: string, locale: string): string {
  if (locale !== 'zh-CN') return text
  return text
    .split('\n')
    .map(line => PLAN_ACTION_ZH[line] ?? line)
    .join('\n')
}

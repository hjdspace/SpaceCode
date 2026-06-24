import { useAgentsStore, type AgentDef } from '@/stores/agents'

export interface WorkRouteResult {
  /** match=单命中直接路由；ask=多命中/模糊需用户选择；none=无可用助手 */
  type: 'match' | 'ask' | 'none'
  /** type=match 时的目标助手 */
  assistant?: AgentDef
  /** type=ask 时的候选助手列表 */
  candidates: AgentDef[]
}

/** 中文停用词，分词时忽略 */
const STOP_WORDS = new Set([
  '的', '了', '和', '是', '在', '我', '你', '他', '她', '它', '们',
  '一个', '一些', '这个', '那个', '可以', '能够', '需要', '想要',
  '帮', '帮我', '请', '一下', '帮', 'the', 'a', 'an', 'to', 'for', 'me', 'please',
])

/** 触发"模糊咨询"的弱意图词：命中且无明确助手时，弹出选择 */
const FUZZY_TRIGGERS = [
  '处理', '弄', '搞', '帮', '一下', '看看', '弄一下', '搞一下',
  '做', '整', '整一下', 'help', 'do', 'something',
]

/**
 * 从助手定义提取匹配关键词集合。
 * 来源：name 拆词、skills、category、description（中英）分词。
 */
function extractKeywords(a: AgentDef): string[] {
  const kws = new Set<string>()

  // name 拆词（kebab-case / 空格 / 下划线）
  a.name.split(/[-_\s]+/).forEach(w => {
    const lw = w.toLowerCase().trim()
    if (lw && lw.length >= 2) kws.add(lw)
  })

  // skills
  ;(a.skills || []).forEach(s => {
    const lw = s.toLowerCase().trim()
    if (lw) kws.add(lw)
  })

  // category
  if (a.category) kws.add(a.category.toLowerCase())

  // description 分词（中英混合，按标点/空格切分，保留 2 字以上词）
  const desc = `${a.descriptionZh || ''} ${a.description || ''}`.toLowerCase()
  desc.split(/[\s,，。、;；:：()（）/\\]+/).forEach(w => {
    const lw = w.trim()
    if (lw && lw.length >= 2 && !STOP_WORDS.has(lw)) kws.add(lw)
  })

  return Array.from(kws)
}

/**
 * Work 模式自动路由：根据用户输入文本匹配专业助手。
 *
 * 路由策略：
 * - 关键词包含匹配，按命中关键词长度加权打分
 * - 单助手命中、或最高分显著领先 → match（直接路由）
 * - 多助手命中且分数接近 → ask（弹出选择）
 * - 无命中 + 弱意图词 → ask（取前 N 个候选）
 * - 无命中 + 无弱意图词 → none（交由调用方兜底）
 */
export function useWorkRouter() {
  const agentsStore = useAgentsStore()

  function route(text: string): WorkRouteResult {
    const q = text.toLowerCase().trim()
    const list = agentsStore.libraryAgents.filter(a => a.mode === 'work')
    if (list.length === 0) return { type: 'none', candidates: [] }

    if (!q) return { type: 'none', candidates: [] }

    const scored = list
      .map(a => {
        const kws = extractKeywords(a)
        let score = 0
        for (const kw of kws) {
          if (q.includes(kw)) score += kw.length
        }
        return { a, score }
      })
      .filter(s => s.score > 0)
      .sort((x, y) => y.score - x.score)

    if (scored.length === 0) {
      // 无明确命中：弱意图词触发咨询
      if (FUZZY_TRIGGERS.some(w => q.includes(w.toLowerCase()))) {
        return { type: 'ask', candidates: list.slice(0, 4) }
      }
      return { type: 'none', candidates: [] }
    }

    // 单命中，或最高分显著领先次高（1.5 倍）→ 直接路由
    if (scored.length === 1 || (scored[1] && scored[0].score >= scored[1].score * 1.5)) {
      return { type: 'match', assistant: scored[0].a, candidates: [] }
    }

    // 多命中且分数接近 → 咨询
    return { type: 'ask', candidates: scored.slice(0, 4).map(s => s.a) }
  }

  return { route }
}

/**
 * 路由评测 fixture — 30–50 条标注样例，驱动 prompt/解析/处置回归。
 *
 * 每条样例包含：
 * - message：用户首消息
 * - isZh：语言
 * - category：分类（PPT 歧义、多语言、寒暄、跨域、自定义、含 routingHints 前后对照）
 * - expectedOutcome：预期处置结果
 * - modelOutput：模拟模型返回的 JSON（用于 parseRoutingDecision + resolveRoutingOutcome 回归）
 * - expectedRankedNames：预期 ranked 的 name 序列（仅校验模型输出解析后）
 * - hasRoutingHints：是否在该样例的候选集中包含 routingHints
 */
export interface RoutingFixture {
  /** 唯一标识 */
  id: string
  /** 用户首消息 */
  message: string
  /** 语言 */
  isZh: boolean
  /** 分类标签 */
  category: 'ppt-ambiguity' | 'multilingual' | 'greeting' | 'off-domain' | 'custom-agent' | 'routing-hints-contrast'
  /** 预期处置结果 */
  expectedOutcome: 'auto' | 'candidates' | 'none' | 'failed'
  /** 模拟的模型 JSON 输出 */
  modelOutput: string
  /** 预期解析后 ranked 的 name 序列（顺序敏感） */
  expectedRankedNames: string[]
  /** 是否在候选集中包含 routingHints */
  hasRoutingHints: boolean
}

/**
 * 候选集（与实际助手库一致的最小子集）。
 * 在含 routingHints 的版本里，ppt-creator 等助手会带 routingHints 字段。
 */
export interface FixtureCandidate {
  name: string
  description: string
  routingHints?: string
}

export const FIXTURE_CANDIDATES: FixtureCandidate[] = [
  { name: 'ppt-creator', description: '根据大纲、文档或想法生成可编辑的 PPT 演示文稿（.pptx）' },
  { name: 'ppt-office-assistant', description: '全流程 PPT 创作助手，含 HTML 预览、版式匹配和自动质检' },
  { name: 'html-ppt-creator', description: '制作专业 HTML 演示文稿，内置 36 主题、31 布局、动效与演讲者模式' },
  { name: 'magazine-ppt-creator', description: '制作杂志风或瑞士国际主义风的单文件 HTML 演示文稿' },
  { name: 'morph-ppt', description: '制作带平滑过渡动效的视觉化演示文稿' },
  { name: 'morph-ppt-3d', description: '制作富有立体感与动态视觉的 3D 风格演示文稿' },
  { name: 'pitch-deck-creator', description: '制作投资人级别的融资路演 PPT' },
  { name: 'word-creator', description: '生成专业、可编辑的 Word 文档' },
  { name: 'excel-creator', description: '生成可编辑的 Excel 表格' },
  { name: 'docx-writer', description: '撰写 Word 文档' },
]

/** 含 routingHints 的候选集版本（PPT 七兄弟带 hints） */
export const FIXTURE_CANDIDATES_WITH_HINTS: FixtureCandidate[] = FIXTURE_CANDIDATES.map(c => {
  const hints: Record<string, string> = {
    'ppt-creator': '输出可编辑的 .pptx 文件，适合需要后续修改、二次编辑或在 PowerPoint 中打开的场景。不提供 HTML 预览或动效过渡。',
    'ppt-office-assistant': '全流程：内容规划 → HTML 预览 → 版式匹配 → PPTX 转换 → QA。适合需要先预览再转 .pptx 的场景，比 ppt-creator 多了预览和质检环节。',
    'html-ppt-creator': '输出单文件 .html，不生成 .pptx。适合网页分享、在线演示、需要丰富主题和动效的场景。产物不可在 PowerPoint 中编辑。',
    'magazine-ppt-creator': '输出单文件 .html，主打杂志风/瑞士国际主义风视觉语言（衬线排版、WebGL 背景）。不输出 .pptx。适合追求强烈编辑美学风格的演示。',
    'morph-ppt': '输出 .pptx，强调幻灯片间平滑过渡（morph）动效和视觉冲击力。适合需要动效演示的场景，不是 HTML 也不是杂志风。',
    'morph-ppt-3d': '输出 .pptx，主打 3D 立体视觉风格（分层形状、透视、动态装饰）。适合需要强 3D 视觉冲击的演示，不是普通 morph 过渡也不是 HTML。',
    'pitch-deck-creator': '输出 .pptx，专为融资路演设计，具备投资人叙事结构。适合创业融资场景，不是通用 PPT 也不是 HTML。',
  }
  return hints[c.name] ? { ...c, routingHints: hints[c.name] } : c
})

export const FIXTURES: RoutingFixture[] = [
  // ── PPT 歧义（7 条） ──
  {
    id: 'ppt-001',
    message: '做个PPT',
    isZh: true,
    category: 'ppt-ambiguity',
    expectedOutcome: 'candidates',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-creator', score: 0.5, reason: '通用 PPT' },
        { name: 'html-ppt-creator', score: 0.45, reason: 'HTML 备选' },
      ],
    }),
    expectedRankedNames: ['ppt-creator', 'html-ppt-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'ppt-002',
    message: '做个PPT',
    isZh: true,
    category: 'routing-hints-contrast',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-creator', score: 0.85, reason: '用户要可编辑 PPTX' },
        { name: 'html-ppt-creator', score: 0.3, reason: 'HTML 不匹配' },
      ],
    }),
    expectedRankedNames: ['ppt-creator', 'html-ppt-creator'],
    hasRoutingHints: true,
  },
  {
    id: 'ppt-003',
    message: '帮我做一个可编辑的演示文稿',
    isZh: true,
    category: 'ppt-ambiguity',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-creator', score: 0.92, reason: '明确要可编辑 .pptx' },
      ],
    }),
    expectedRankedNames: ['ppt-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'ppt-004',
    message: '做一个网页上能分享的幻灯片',
    isZh: true,
    category: 'ppt-ambiguity',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'html-ppt-creator', score: 0.88, reason: '明确要网页分享' },
      ],
    }),
    expectedRankedNames: ['html-ppt-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'ppt-005',
    message: '生成一份杂志风的行业观察分享PPT',
    isZh: true,
    category: 'ppt-ambiguity',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'magazine-ppt-creator', score: 0.9, reason: '杂志风明确' },
      ],
    }),
    expectedRankedNames: ['magazine-ppt-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'ppt-006',
    message: '做一个带3D效果的发布会PPT',
    isZh: true,
    category: 'ppt-ambiguity',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'morph-ppt-3d', score: 0.87, reason: '3D 风格明确' },
      ],
    }),
    expectedRankedNames: ['morph-ppt-3d'],
    hasRoutingHints: false,
  },
  {
    id: 'ppt-007',
    message: '帮我做一份种子轮融资路演PPT',
    isZh: true,
    category: 'ppt-ambiguity',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'pitch-deck-creator', score: 0.91, reason: '融资路演明确' },
      ],
    }),
    expectedRankedNames: ['pitch-deck-creator'],
    hasRoutingHints: false,
  },

  // ── 多语言（5 条） ──
  {
    id: 'i18n-001',
    message: 'Make a presentation deck',
    isZh: false,
    category: 'multilingual',
    expectedOutcome: 'candidates',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-creator', score: 0.5, reason: 'generic deck' },
        { name: 'html-ppt-creator', score: 0.4, reason: 'web deck' },
      ],
    }),
    expectedRankedNames: ['ppt-creator', 'html-ppt-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'i18n-002',
    message: 'Create an editable PowerPoint file',
    isZh: false,
    category: 'multilingual',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-creator', score: 0.9, reason: 'editable PPTX' },
      ],
    }),
    expectedRankedNames: ['ppt-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'i18n-003',
    message: 'プレゼンを作って',
    isZh: false,
    category: 'multilingual',
    expectedOutcome: 'candidates',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-creator', score: 0.5, reason: 'generic' },
        { name: 'html-ppt-creator', score: 0.35, reason: 'web' },
      ],
    }),
    expectedRankedNames: ['ppt-creator', 'html-ppt-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'i18n-004',
    message: '做一个PPT，要能在PowerPoint里编辑的',
    isZh: true,
    category: 'multilingual',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-creator', score: 0.88, reason: 'PowerPoint 编辑 = .pptx' },
      ],
    }),
    expectedRankedNames: ['ppt-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'i18n-005',
    message: 'I need a slide deck for my investor pitch',
    isZh: false,
    category: 'multilingual',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'pitch-deck-creator', score: 0.86, reason: 'investor pitch' },
      ],
    }),
    expectedRankedNames: ['pitch-deck-creator'],
    hasRoutingHints: false,
  },

  // ── 寒暄 → none（5 条） ──
  {
    id: 'greet-001',
    message: '你好',
    isZh: true,
    category: 'greeting',
    expectedOutcome: 'none',
    modelOutput: JSON.stringify({ none: true, candidates: [] }),
    expectedRankedNames: [],
    hasRoutingHints: false,
  },
  {
    id: 'greet-002',
    message: 'hi there',
    isZh: false,
    category: 'greeting',
    expectedOutcome: 'none',
    modelOutput: JSON.stringify({ none: true, candidates: [] }),
    expectedRankedNames: [],
    hasRoutingHints: false,
  },
  {
    id: 'greet-003',
    message: '今天天气怎么样',
    isZh: true,
    category: 'greeting',
    expectedOutcome: 'none',
    modelOutput: JSON.stringify({ none: true, candidates: [] }),
    expectedRankedNames: [],
    hasRoutingHints: false,
  },
  {
    id: 'greet-004',
    message: 'thanks for the help earlier',
    isZh: false,
    category: 'greeting',
    expectedOutcome: 'none',
    modelOutput: JSON.stringify({ none: true, candidates: [] }),
    expectedRankedNames: [],
    hasRoutingHints: false,
  },
  {
    id: 'greet-005',
    message: '在吗？有个问题想问',
    isZh: true,
    category: 'greeting',
    expectedOutcome: 'none',
    modelOutput: JSON.stringify({ none: true, candidates: [] }),
    expectedRankedNames: [],
    hasRoutingHints: false,
  },

  // ── 跨域 / off-domain（6 条） ──
  {
    id: 'off-001',
    message: '帮我写一个 Python 脚本',
    isZh: true,
    category: 'off-domain',
    expectedOutcome: 'none',
    modelOutput: JSON.stringify({ none: true, candidates: [] }),
    expectedRankedNames: [],
    hasRoutingHints: false,
  },
  {
    id: 'off-002',
    message: 'How do I deploy a React app to Vercel?',
    isZh: false,
    category: 'off-domain',
    expectedOutcome: 'none',
    modelOutput: JSON.stringify({ none: true, candidates: [] }),
    expectedRankedNames: [],
    hasRoutingHints: false,
  },
  {
    id: 'off-003',
    message: '推荐一部好看的电影',
    isZh: true,
    category: 'off-domain',
    expectedOutcome: 'none',
    modelOutput: JSON.stringify({ none: true, candidates: [] }),
    expectedRankedNames: [],
    hasRoutingHints: false,
  },
  {
    id: 'off-004',
    message: 'What is the capital of France?',
    isZh: false,
    category: 'off-domain',
    expectedOutcome: 'none',
    modelOutput: JSON.stringify({ none: true, candidates: [] }),
    expectedRankedNames: [],
    hasRoutingHints: false,
  },
  {
    id: 'off-005',
    message: '帮我算一下 123 乘以 456',
    isZh: true,
    category: 'off-domain',
    expectedOutcome: 'none',
    modelOutput: JSON.stringify({ none: true, candidates: [] }),
    expectedRankedNames: [],
    hasRoutingHints: false,
  },
  {
    id: 'off-006',
    message: 'translate this to Japanese for me',
    isZh: false,
    category: 'off-domain',
    expectedOutcome: 'none',
    modelOutput: JSON.stringify({ none: true, candidates: [] }),
    expectedRankedNames: [],
    hasRoutingHints: false,
  },

  // ── 文档/表格（非 PPT 类办公助手，4 条） ──
  {
    id: 'doc-001',
    message: '帮我写一份项目结题报告',
    isZh: true,
    category: 'off-domain',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'word-creator', score: 0.85, reason: 'Word 报告' },
      ],
    }),
    expectedRankedNames: ['word-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'doc-002',
    message: '生成一份含图表的销售报表',
    isZh: true,
    category: 'off-domain',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'excel-creator', score: 0.82, reason: 'Excel 图表' },
      ],
    }),
    expectedRankedNames: ['excel-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'doc-003',
    message: 'Write a formal business letter',
    isZh: false,
    category: 'off-domain',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'word-creator', score: 0.8, reason: 'Word document' },
      ],
    }),
    expectedRankedNames: ['word-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'doc-004',
    message: '做一个带公式的项目进度追踪表',
    isZh: true,
    category: 'off-domain',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'excel-creator', score: 0.84, reason: 'Excel 公式追踪' },
      ],
    }),
    expectedRankedNames: ['excel-creator'],
    hasRoutingHints: false,
  },

  // ── routingHints 前后对照（5 条） ──
  {
    id: 'hints-001',
    message: '做个PPT先看看效果再转成pptx',
    isZh: true,
    category: 'routing-hints-contrast',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-office-assistant', score: 0.88, reason: '先预览再转 pptx = 全流程' },
        { name: 'ppt-creator', score: 0.4, reason: '直出 pptx 无预览' },
      ],
    }),
    expectedRankedNames: ['ppt-office-assistant', 'ppt-creator'],
    hasRoutingHints: true,
  },
  {
    id: 'hints-002',
    message: '做个PPT先看看效果再转成pptx',
    isZh: true,
    category: 'routing-hints-contrast',
    expectedOutcome: 'candidates',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-creator', score: 0.5, reason: '通用 PPT' },
        { name: 'ppt-office-assistant', score: 0.45, reason: '全流程备选' },
      ],
    }),
    expectedRankedNames: ['ppt-creator', 'ppt-office-assistant'],
    hasRoutingHints: false,
  },
  {
    id: 'hints-003',
    message: '做一个可以在网页上打开的幻灯片',
    isZh: true,
    category: 'routing-hints-contrast',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'html-ppt-creator', score: 0.9, reason: '网页 = HTML' },
      ],
    }),
    expectedRankedNames: ['html-ppt-creator'],
    hasRoutingHints: true,
  },
  {
    id: 'hints-003b',
    message: '做一个可以在网页上打开的幻灯片',
    isZh: true,
    category: 'routing-hints-contrast',
    expectedOutcome: 'candidates',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'html-ppt-creator', score: 0.5, reason: '可能 HTML' },
        { name: 'ppt-creator', score: 0.4, reason: '可能 PPT' },
      ],
    }),
    expectedRankedNames: ['html-ppt-creator', 'ppt-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'hints-004',
    message: '做一个有平滑过渡动画的ppt',
    isZh: true,
    category: 'routing-hints-contrast',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'morph-ppt', score: 0.86, reason: '平滑过渡 = morph' },
      ],
    }),
    expectedRankedNames: ['morph-ppt'],
    hasRoutingHints: true,
  },
  {
    id: 'hints-005',
    message: '做一个有平滑过渡动画的ppt',
    isZh: true,
    category: 'routing-hints-contrast',
    expectedOutcome: 'candidates',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-creator', score: 0.5, reason: '通用 PPT' },
        { name: 'morph-ppt', score: 0.48, reason: '可能要动效' },
      ],
    }),
    expectedRankedNames: ['ppt-creator', 'morph-ppt'],
    hasRoutingHints: false,
  },

  // ── 自定义助手场景（3 条） ──
  {
    id: 'custom-001',
    message: '帮我做一份市场调研报告',
    isZh: true,
    category: 'custom-agent',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'word-creator', score: 0.75, reason: 'Word 报告' },
      ],
    }),
    expectedRankedNames: ['word-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'custom-002',
    message: '帮我分析这份财务数据',
    isZh: true,
    category: 'custom-agent',
    expectedOutcome: 'candidates',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'excel-creator', score: 0.5, reason: '可能用 Excel' },
        { name: 'word-creator', score: 0.35, reason: '可能用 Word' },
      ],
    }),
    expectedRankedNames: ['excel-creator', 'word-creator'],
    hasRoutingHints: false,
  },
  {
    id: 'custom-003',
    message: 'generate a quarterly business review document',
    isZh: false,
    category: 'custom-agent',
    expectedOutcome: 'auto',
    modelOutput: JSON.stringify({
      none: false,
      candidates: [
        { name: 'word-creator', score: 0.82, reason: 'Word document for QBR' },
      ],
    }),
    expectedRankedNames: ['word-creator'],
    hasRoutingHints: false,
  },
]

/**
 * 推理深度（effort）档位的单一口径。
 *
 * 有效值实测自运行时 CLI（2.1.227）的 `--effort`，落到请求体是 `output_config.effort`；
 * 之前桌面各处手抄的 4 档 union 缺 `xhigh`，且把 `max` 标成了 "Extra High"。
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type EffortLevel = typeof EFFORT_LEVELS[number]

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value)
}

/** 老版本持久化过 4 档、也持久化过 CLI 会静默吃掉的取值，读入时统一收敛。 */
export function normalizeEffortLevel(value: unknown, fallback: EffortLevel = 'high'): EffortLevel {
  return isEffortLevel(value) ? value : fallback
}

/**
 * 逐模型可用档位。实测：`--effort xhigh` 在 sonnet-4-6 上被降成 high，
 * 而 sonnet-4-5 / haiku 整个丢弃 effort、退回 budget_tokens 式 thinking —— 那些模型
 * 一档都不可用，给它们渲染可点档位就是装饰品。
 *
 * 未知模型名按 CLI 的口径默认全档透传，所以这里不做桌面侧钳制：引擎才是钳制的唯一真相，
 * 我们只负责不呈现引擎根本不接受的选项。
 */
const MODEL_EFFORT_LEVELS: ReadonlyArray<readonly [RegExp, ReadonlyArray<EffortLevel>]> = [
  [/haiku|sonnet-4-5|sonnet-4@|claude-3/, []],
  [/sonnet-4-6/, ['low', 'medium', 'high', 'max']],
]

export function getSupportedEffortLevels(
  model: string | undefined,
  overrides?: Record<string, EffortLevel[]>,
): ReadonlyArray<EffortLevel> {
  if (!model) return EFFORT_LEVELS
  if (overrides?.[model]) return overrides[model]
  const m = model.toLowerCase()
  for (const [pattern, levels] of MODEL_EFFORT_LEVELS) {
    if (pattern.test(m)) return levels
  }
  return EFFORT_LEVELS
}

/**
 * pi-coding-agent 的思考档位词汇。
 *
 * pi 的 `--thinking` / `set_thinking_level` 认 off|minimal|low|medium|high|xhigh，
 * 没有 max —— 传 max 会被它的枚举校验直接拒掉，所以桌面的 max 落到它这里取 xhigh。
 * thinking 开关和档位在这条引擎上是同一个参数，关掉就是 off。
 */
export function toPiThinkingLevel(enabled: boolean, level: EffortLevel): string {
  if (!enabled) return 'off'
  return level === 'max' ? 'xhigh' : level
}

/**
 * 把当前档位落回该模型可用集合，取**不高于它的最近一档**。
 *
 * 方向照抄运行时 CLI 的实测行为（sonnet-4-6 把 xhigh 降成 high）：向上会凭空造出
 * 第三种口径，界面显示的档位和引擎实际发出的就对不上了。
 * 集合为空（该模型一档都不支持）返回 null，由界面收起这个选择区。
 */
export function clampEffortLevel(
  level: EffortLevel,
  supported: ReadonlyArray<EffortLevel>,
): EffortLevel | null {
  if (supported.length === 0) return null
  if (supported.includes(level)) return level
  for (let i = EFFORT_LEVELS.indexOf(level); i >= 0; i--) {
    if (supported.includes(EFFORT_LEVELS[i])) return EFFORT_LEVELS[i]
  }
  return supported[0]
}

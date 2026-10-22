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
 * 这张表说的是 **Claude Code 那台 CLI** 对各模型 id 的处理，换个引擎就不成立：
 * pi 自己按 `model.reasoning` + `thinkingLevelMap` 决定档位，跟 Claude 的 4-5/4-6 分支
 * 无关。所以它只在 engineType 为 claude-code（含未落定，与网关默认引擎一致）时生效，
 * 见 getSupportedEffortLevels。
 *
 * 未知模型名按 CLI 的口径默认全档透传，所以这里不做桌面侧钳制：引擎才是钳制的唯一真相，
 * 我们只负责不呈现引擎根本不接受的选项。
 */
const MODEL_EFFORT_LEVELS: ReadonlyArray<readonly [RegExp, ReadonlyArray<EffortLevel>]> = [
  [/haiku|sonnet-4-5|sonnet-4@|claude-3/, []],
  [/sonnet-4-6/, ['low', 'medium', 'high', 'max']],
]

/**
 * 引擎侧 `--effort` 到底认哪几档，实测自各个二进制（探针 `--effort bogus --version`，
 * 不花凭据）。三者差的不只是集合，还有**失败模式**：
 *
 *   内部引擎 bundle 2.8.4 —— low|medium|high|max，没有 xhigh；不认的值走 commander 的
 *     argParser 抛 InvalidArgumentError，进程 exit 1，会话根本起不来。
 *   安装版 CLI 2.1.227 —— 五档全收，且不认的值只 warn 一句再回落默认。
 *   pi 1.3.0 —— `--thinking` 认 off|minimal|low|medium|high|xhigh|max。桌面的 5 档全在
 *     其中，`minimal` 却不在这张表里：pi 把它原样映射成 `reasoning_effort: minimal`，
 *     而 MaaS 这类网关对该枚举是严格校验的（实测确定性 400，见 proxy/thinkingParams.ts）。
 *     所以那两档不是"少一个选项"，加进来就是把整条请求打死。
 *
 * 所以在内部引擎上传一个它不认的档不是"降级"，是崩。EFFORT_LEVELS 是桌面的全集，
 * 呈现和下发都必须先跟这一维求交。
 */
export const BUNDLED_ENGINE_EFFORT_LEVELS: ReadonlyArray<EffortLevel> = ['low', 'medium', 'high', 'max']
export const INSTALLED_ENGINE_EFFORT_LEVELS: ReadonlyArray<EffortLevel> = EFFORT_LEVELS
export const PI_ENGINE_EFFORT_LEVELS: ReadonlyArray<EffortLevel> = EFFORT_LEVELS

/**
 * `engineSource` 缺省即 bundled —— resolveCliCommand 只在显式 'installed' 时才走安装版 CLI。
 * 未知时取保守那套：少一档只是选项变少，多一档是把会话弄死。
 * `engineType` 缺省即 claude-code —— engineGateway 的默认引擎，与 EngineSessionConfig 同口径。
 */
export function getEngineEffortLevels(
  engineSource: 'bundled' | 'installed' | undefined,
  engineType: 'claude-code' | 'pi' | undefined = 'claude-code',
): ReadonlyArray<EffortLevel> {
  if (engineType === 'pi') return PI_ENGINE_EFFORT_LEVELS
  return engineSource === 'installed' ? INSTALLED_ENGINE_EFFORT_LEVELS : BUNDLED_ENGINE_EFFORT_LEVELS
}

export function getSupportedEffortLevels(
  model: string | undefined,
  engineLevels: ReadonlyArray<EffortLevel>,
  overrides?: Record<string, EffortLevel[]>,
  engineType: 'claude-code' | 'pi' | undefined = 'claude-code',
): ReadonlyArray<EffortLevel> {
  const forModel = (() => {
    if (!model) return EFFORT_LEVELS
    if (overrides?.[model]) return overrides[model]
    // 那张表描述的是 Claude CLI 的按模型丢档位行为，换引擎就没有依据了
    if (engineType === 'pi') return EFFORT_LEVELS
    const m = model.toLowerCase()
    for (const [pattern, levels] of MODEL_EFFORT_LEVELS) {
      if (pattern.test(m)) return levels
    }
    return EFFORT_LEVELS
  })()
  return forModel.filter((level) => engineLevels.includes(level))
}

/**
 * pi-coding-agent 的思考档位词汇。
 *
 * pi 1.3.0 的 `--thinking` / `set_thinking_level` 认 off|minimal|low|medium|high|xhigh|max，
 * 桌面这 5 档与它同名一一对应（实测自 dist/cli/args.js 的 VALID_THINKING_LEVELS），
 * 所以这里只做开关合成：thinking 开关和档位在这条引擎上是同一个参数，关掉就是 off。
 * 以前这里把 max 折成 xhigh，理由是"pi 没有 max"—— 那个前提已经随版本升级失效，
 * 结果是最高档被静默降一级，界面显示的档位和引擎按的那个不是同一个。
 */
export function toPiThinkingLevel(enabled: boolean, level: EffortLevel): string {
  return enabled ? level : 'off'
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

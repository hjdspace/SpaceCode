/**
 * Goal prompt builders & marker parsing — app-side implementation of the
 * engine's `/goal` steering protocol (参考 engine/src/services/goal/prompts.ts).
 *
 * The desktop runs the engine headless (`--print --input-format stream-json`),
 * where the engine's local-jsx `/goal` command is filtered out. The app therefore
 * owns the goal lifecycle and passes steering prompts to the engine as ordinary
 * user messages. Completion/blocked signalling uses inline XML markers instead
 * of the engine's GoalTool (which is REPL-only).
 */

/** 与引擎 MAX_GOAL_TURNS 保持一致（engine/src/services/goal/goalState.ts） */
export const MAX_GOAL_TURNS = 150

/** 同一阻塞条件连续出现 3 次才允许标记 blocked（引擎 Blocked Audit 规则） */
export const BLOCKED_ATTEMPT_THRESHOLD = 3

export interface GoalSnapshot {
  objective: string
  status: string
  turnsExecuted: number
}

/** 完成审计 + 阻塞审计规则（两个 prompt 共用的指令段） */
const AUDIT_RULES = `
## Completion & Blocked Audit

When you believe the goal is fully achieved, perform a strict Completion Audit BEFORE claiming completion:
1. Derive concrete requirements from the objective and any referenced files.
2. Preserve the original scope — do not redefine success around what is already done.
3. For every explicit requirement, identify authoritative evidence (test output, file content, command result).
4. Treat tests, manifests, and verifiers as evidence only after confirming they actually cover the requirement.
5. Treat uncertain or indirect evidence as "not achieved".
6. The audit must PROVE completion, not merely fail to find remaining work.

Signalling (must be the LAST line of your final message, on its own line):
- Goal fully achieved → output exactly: <goal-complete>
- Genuinely blocked (same obstacle persisting for at least 3 consecutive turns) → output exactly: <goal-blocked>reason</goal-blocked>

"Difficult", "slow", or "partially incomplete" is NOT blocked. Do not narrow the scope of the goal — even if you cannot complete everything in one turn, maintain the full objective and make as much progress as possible.
`.trim()

/** `/goal <objective>` 设置目标后发送给引擎的首轮提示词 */
export function buildInitialGoalPrompt(objective: string): string {
  return `<goal-steering type="objective_updated">
The user has set a persistent goal for this session. Work towards it continuously across turns.

## Active Goal
${objective}

## Instructions

Start working towards the goal now. All subsequent turns will continue automatically until the goal is complete.

${AUDIT_RULES}
</goal-steering>`
}

/** 每轮结束后自动注入的续跑提示词 */
export function buildContinuationPrompt(goal: GoalSnapshot): string {
  return `<goal-steering type="continuation">
You have an active goal to work on. Continue making progress.

## Active Goal
${goal.objective}

## Status
- Continuation turns executed: ${goal.turnsExecuted} / ${MAX_GOAL_TURNS}

## Instructions

Continue working towards the goal. Do NOT narrow the scope of the goal — even if you cannot complete everything in one turn, maintain the full objective and make as much progress as possible.

${AUDIT_RULES}
</goal-steering>`
}

export interface GoalMarkers {
  complete: boolean
  blockedReason?: string
}

/**
 * 从助手最终输出中解析完成/阻塞标记。
 * 标记必须独立成行（允许前后空白），避免代码块中的普通文本误触发。
 */
export function parseGoalMarkers(text: string): GoalMarkers {
  if (!text) return { complete: false }

  const complete = /^[ \t]*<goal-complete>[ \t]*$/m.test(text)

  let blockedReason: string | undefined
  const blockedMatch = text.match(/^[ \t]*<goal-blocked>([^<]*)<\/goal-blocked>[ \t]*$/m)
  if (blockedMatch) {
    blockedReason = blockedMatch[1].trim() || undefined
  }

  return { complete, blockedReason }
}

/**
 * Goal store — app-side `/goal` 状态机。
 *
 * 桌面端引擎以 headless 模式运行，engine 的 /goal（local-jsx）被过滤，
 * 因此目标生命周期（设置/暂停/恢复/完成/阻塞/max-turns）由应用侧管理，
 * 并在每轮结束后通过 goalPrompts 的续跑提示词驱动引擎继续工作。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BLOCKED_ATTEMPT_THRESHOLD, MAX_GOAL_TURNS } from '@/lib/goalPrompts'

export type GoalStatus = 'active' | 'paused' | 'max_turns' | 'complete' | 'blocked'

export interface GoalState {
  objective: string
  status: GoalStatus
  turnsExecuted: number
  /** 连续 blocked 标记次数（不同 turn 之间累计，非 blocked 输出时清零） */
  blockedAttempts: number
  blockedReason?: string
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'spacecode_goals'

function loadFromStorage(): Record<string, GoalState> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed && typeof parsed === 'object') return parsed
    }
  } catch (e) {
    console.error('[GoalStore] Failed to load from storage:', e)
  }
  return {}
}

export const useGoalStore = defineStore('goal', () => {
  const goals = ref<Record<string, GoalState>>(loadFromStorage())

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(goals.value))
    } catch (e) {
      console.error('[GoalStore] Failed to persist:', e)
    }
  }

  function getGoal(sessionId: string): GoalState | undefined {
    return goals.value[sessionId]
  }

  /** 设置/替换目标。返回被替换的旧目标（若有且未完成）。 */
  function setGoal(sessionId: string, objective: string): GoalState | undefined {
    const previous = goals.value[sessionId]
    const now = Date.now()
    goals.value[sessionId] = {
      objective,
      status: 'active',
      turnsExecuted: 0,
      blockedAttempts: 0,
      createdAt: now,
      updatedAt: now,
    }
    persist()
    return previous?.status !== 'complete' ? previous : undefined
  }

  function clearGoal(sessionId: string): boolean {
    if (!goals.value[sessionId]) return false
    delete goals.value[sessionId]
    persist()
    return true
  }

  function pauseGoal(sessionId: string): GoalState | undefined {
    const goal = goals.value[sessionId]
    if (!goal || goal.status !== 'active') return undefined
    goal.status = 'paused'
    goal.updatedAt = Date.now()
    persist()
    return goal
  }

  function resumeGoal(sessionId: string): GoalState | undefined {
    const goal = goals.value[sessionId]
    if (!goal || goal.status !== 'paused') return undefined
    goal.status = 'active'
    goal.updatedAt = Date.now()
    persist()
    return goal
  }

  function completeGoal(sessionId: string): GoalState | undefined {
    const goal = goals.value[sessionId]
    if (!goal) return undefined
    goal.status = 'complete'
    goal.updatedAt = Date.now()
    persist()
    return goal
  }

  /** /goal continue — max_turns 后重置计数继续 */
  function continueGoal(sessionId: string): GoalState | undefined {
    const goal = goals.value[sessionId]
    if (!goal || goal.status !== 'max_turns') return undefined
    goal.status = 'active'
    goal.turnsExecuted = 0
    goal.updatedAt = Date.now()
    persist()
    return goal
  }

  /**
   * 递增续跑轮数。达到 MAX_GOAL_TURNS 时状态转为 max_turns。
   * 返回递增后的轮数。
   */
  function incrementTurns(sessionId: string): number {
    const goal = goals.value[sessionId]
    if (!goal) return 0
    goal.turnsExecuted += 1
    goal.updatedAt = Date.now()
    if (goal.status === 'active' && goal.turnsExecuted >= MAX_GOAL_TURNS) {
      goal.status = 'max_turns'
    }
    persist()
    return goal.turnsExecuted
  }

  /**
   * 记录一次 blocked 标记。连续 BLOCKED_ATTEMPT_THRESHOLD 次后状态转为 blocked。
   * 返回 true 表示本次标记后目标被置为 blocked。
   */
  function recordBlockedAttempt(sessionId: string, reason: string): boolean {
    const goal = goals.value[sessionId]
    if (!goal) return false
    goal.blockedAttempts += 1
    goal.blockedReason = reason
    goal.updatedAt = Date.now()
    if (goal.blockedAttempts >= BLOCKED_ATTEMPT_THRESHOLD) {
      goal.status = 'blocked'
      persist()
      return true
    }
    persist()
    return false
  }

  /** 非 blocked 输出的一轮 → 清零连续计数 */
  function resetBlockedAttempts(sessionId: string): void {
    const goal = goals.value[sessionId]
    if (!goal || goal.blockedAttempts === 0) return
    goal.blockedAttempts = 0
    goal.blockedReason = undefined
    goal.updatedAt = Date.now()
    persist()
  }

  const activeGoalCount = computed(
    () => Object.values(goals.value).filter(g => g.status === 'active').length
  )

  return {
    goals,
    activeGoalCount,
    getGoal,
    setGoal,
    clearGoal,
    pauseGoal,
    resumeGoal,
    completeGoal,
    continueGoal,
    incrementTurns,
    recordBlockedAttempt,
    resetBlockedAttempts,
  }
})

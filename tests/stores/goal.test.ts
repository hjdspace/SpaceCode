import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGoalStore } from '@/stores/goal'
import { MAX_GOAL_TURNS, BLOCKED_ATTEMPT_THRESHOLD } from '@/lib/goalPrompts'

describe('goal store — 状态机', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('setGoal 创建 active 目标并持久化', () => {
    const store = useGoalStore()
    const prev = store.setGoal('s1', '修复所有测试')

    expect(prev).toBeUndefined()
    const goal = store.getGoal('s1')!
    expect(goal.objective).toBe('修复所有测试')
    expect(goal.status).toBe('active')
    expect(goal.turnsExecuted).toBe(0)

    // 持久化到 localStorage
    const saved = JSON.parse(localStorage.getItem('spacecode_goals')!)
    expect(saved.s1.status).toBe('active')
  })

  it('setGoal 返回被替换的旧目标（未完成时）', () => {
    const store = useGoalStore()
    store.setGoal('s1', '旧目标')
    const prev = store.setGoal('s1', '新目标')

    expect(prev?.objective).toBe('旧目标')
    expect(store.getGoal('s1')!.objective).toBe('新目标')
  })

  it('pauseGoal / resumeGoal 状态切换', () => {
    const store = useGoalStore()
    store.setGoal('s1', '目标')

    expect(store.pauseGoal('s1')!.status).toBe('paused')
    expect(store.pauseGoal('s1')).toBeUndefined() // 已暂停，再次暂停无效

    expect(store.resumeGoal('s1')!.status).toBe('active')
    expect(store.resumeGoal('s1')).toBeUndefined() // 非 paused，恢复无效
  })

  it('completeGoal 标记完成', () => {
    const store = useGoalStore()
    store.setGoal('s1', '目标')
    expect(store.completeGoal('s1')!.status).toBe('complete')
  })

  it('incrementTurns 达到 MAX_GOAL_TURNS 时转为 max_turns', () => {
    const store = useGoalStore()
    store.setGoal('s1', '目标')

    for (let i = 1; i < MAX_GOAL_TURNS; i++) {
      store.incrementTurns('s1')
    }
    expect(store.getGoal('s1')!.status).toBe('active')

    store.incrementTurns('s1')
    expect(store.getGoal('s1')!.status).toBe('max_turns')
    expect(store.getGoal('s1')!.turnsExecuted).toBe(MAX_GOAL_TURNS)
  })

  it('continueGoal 从 max_turns 重置计数继续', () => {
    const store = useGoalStore()
    store.setGoal('s1', '目标')
    store.completeGoal('s1') // 先置为非 max_turns 验证守卫
    expect(store.continueGoal('s1')).toBeUndefined()

    const goal = store.getGoal('s1')!
    goal.status = 'max_turns'
    const resumed = store.continueGoal('s1')
    expect(resumed!.status).toBe('active')
    expect(resumed!.turnsExecuted).toBe(0)
  })

  it('recordBlockedAttempt 连续达到阈值后转为 blocked', () => {
    const store = useGoalStore()
    store.setGoal('s1', '目标')

    for (let i = 1; i < BLOCKED_ATTEMPT_THRESHOLD; i++) {
      expect(store.recordBlockedAttempt('s1', '缺依赖')).toBe(false)
      expect(store.getGoal('s1')!.status).toBe('active')
    }

    expect(store.recordBlockedAttempt('s1', '缺依赖')).toBe(true)
    const goal = store.getGoal('s1')!
    expect(goal.status).toBe('blocked')
    expect(goal.blockedReason).toBe('缺依赖')
  })

  it('resetBlockedAttempts 清零连续计数与原因', () => {
    const store = useGoalStore()
    store.setGoal('s1', '目标')
    store.recordBlockedAttempt('s1', '第一次')
    store.recordBlockedAttempt('s1', '第二次')

    store.resetBlockedAttempts('s1')
    const goal = store.getGoal('s1')!
    expect(goal.blockedAttempts).toBe(0)
    expect(goal.blockedReason).toBeUndefined()

    // 清零后需重新连续 3 次才会 blocked
    expect(store.recordBlockedAttempt('s1', '第三次')).toBe(false)
    expect(store.getGoal('s1')!.status).toBe('active')
  })

  it('clearGoal 删除目标', () => {
    const store = useGoalStore()
    store.setGoal('s1', '目标')

    expect(store.clearGoal('s1')).toBe(true)
    expect(store.getGoal('s1')).toBeUndefined()
    expect(store.clearGoal('s1')).toBe(false)
  })

  it('activeGoalCount 只统计 active 目标', () => {
    const store = useGoalStore()
    store.setGoal('s1', '目标1')
    store.setGoal('s2', '目标2')
    store.setGoal('s3', '目标3')
    store.pauseGoal('s2')
    store.completeGoal('s3')

    expect(store.activeGoalCount).toBe(1)
  })

  it('状态从 localStorage 恢复', () => {
    localStorage.setItem('spacecode_goals', JSON.stringify({
      restored: {
        objective: '恢复的目标',
        status: 'paused',
        turnsExecuted: 5,
        blockedAttempts: 0,
        createdAt: 1,
        updatedAt: 2,
      },
    }))
    setActivePinia(createPinia())

    const store = useGoalStore()
    const goal = store.getGoal('restored')!
    expect(goal.objective).toBe('恢复的目标')
    expect(goal.status).toBe('paused')
    expect(goal.turnsExecuted).toBe(5)
  })
})

import { describe, it, expect } from 'vitest'
import {
  classifyTarget,
  classifyTone,
  classifyTagClass,
  canOpenAdopt,
  canBatchAdopt,
  countConflicts,
  type ClassifyInput,
} from '@/lib/targetClassifier'
import type { AgentSkillInventoryItem } from '@/types/skillManagerV2'

// 构造一个最小的 inventory item，仅保留分类逻辑读取的字段。
function makeItem(partial: Partial<AgentSkillInventoryItem>): AgentSkillInventoryItem {
  return partial as AgentSkillInventoryItem
}

describe('targetClassifier — classifyTarget', () => {
  it('managed 短路：返回 ok 且不可导入', () => {
    const input: ClassifyInput = {
      managed: true,
      readOnly: true, // 即便同时 readOnly，managed 也优先
      centerHash: 'abc',
      itemHash: 'abc',
    }
    expect(classifyTarget(input)).toEqual({
      status: 'ok',
      canImport: false,
      managed: true,
      readOnly: false,
    })
  })

  it('readOnly 短路：返回 builtin_read_only 且不可导入', () => {
    const input: ClassifyInput = {
      managed: false,
      readOnly: true,
      centerHash: null,
      itemHash: 'abc',
    }
    expect(classifyTarget(input)).toEqual({
      status: 'builtin_read_only',
      canImport: false,
      managed: false,
      readOnly: true,
    })
  })

  it('centerHash 为 null：未入中心库，unmanaged 且可导入', () => {
    const input: ClassifyInput = {
      managed: false,
      readOnly: false,
      centerHash: null,
      itemHash: 'abc',
    }
    expect(classifyTarget(input)).toEqual({
      status: 'unmanaged',
      canImport: true,
      managed: false,
      readOnly: false,
    })
  })

  it('hash 相等：unmanaged_reusable 且可导入', () => {
    const input: ClassifyInput = {
      managed: false,
      readOnly: false,
      centerHash: 'abc',
      itemHash: 'abc',
    }
    expect(classifyTarget(input).status).toBe('unmanaged_reusable')
    expect(classifyTarget(input).canImport).toBe(true)
  })

  it('hash 不等：conflict 且不可导入', () => {
    const input: ClassifyInput = {
      managed: false,
      readOnly: false,
      centerHash: 'abc',
      itemHash: 'xyz',
    }
    const result = classifyTarget(input)
    expect(result.status).toBe('conflict')
    expect(result.canImport).toBe(false)
  })

  it('itemHash 为 null 但 centerHash 存在：视为 hash 不匹配 → conflict', () => {
    const input: ClassifyInput = {
      managed: false,
      readOnly: false,
      centerHash: 'abc',
      itemHash: null,
    }
    expect(classifyTarget(input).status).toBe('conflict')
  })

  it('边界：centerHash 与 itemHash 均为空字符串且相等 → reusable', () => {
    const input: ClassifyInput = {
      managed: false,
      readOnly: false,
      centerHash: '',
      itemHash: '',
    }
    // 空字符串非 null，进入 hash 比较分支且相等
    expect(classifyTarget(input).status).toBe('unmanaged_reusable')
  })
})

describe('targetClassifier — classifyTone / classifyTagClass', () => {
  it('status 优先于 managed：conflict / reusable / readonly 直接命中', () => {
    expect(classifyTone(makeItem({ status: 'conflict', managed: true }))).toBe('conflict')
    expect(classifyTone(makeItem({ status: 'unmanaged_reusable', managed: true }))).toBe('reusable')
    expect(classifyTone(makeItem({ status: 'builtin_read_only', managed: false }))).toBe('readonly')
  })

  it('其余情况按 managed 区分 ok / unmanaged', () => {
    expect(classifyTone(makeItem({ status: 'ok', managed: true }))).toBe('ok')
    expect(classifyTone(makeItem({ status: 'unmanaged', managed: false }))).toBe('unmanaged')
  })

  it('tag class 与 tone 同源地映射', () => {
    expect(classifyTagClass(makeItem({ status: 'conflict' }))).toBe('tag-conflict')
    expect(classifyTagClass(makeItem({ status: 'unmanaged_reusable' }))).toBe('tag-reusable')
    expect(classifyTagClass(makeItem({ status: 'builtin_read_only' }))).toBe('tag-readonly')
    expect(classifyTagClass(makeItem({ status: 'ok', managed: true }))).toBe('tag-ok')
    expect(classifyTagClass(makeItem({ status: 'unmanaged', managed: false }))).toBe('tag-unmanaged')
  })
})

describe('targetClassifier — adopt 动作', () => {
  it('canOpenAdopt：非 managed 且 (可导入 或 conflict) 才打开', () => {
    expect(canOpenAdopt(makeItem({ managed: false, canImport: true, status: 'unmanaged' }))).toBe(true)
    expect(canOpenAdopt(makeItem({ managed: false, canImport: false, status: 'conflict' }))).toBe(true)
    expect(canOpenAdopt(makeItem({ managed: false, canImport: false, status: 'builtin_read_only' }))).toBe(false)
    expect(canOpenAdopt(makeItem({ managed: true, canImport: true, status: 'ok' }))).toBe(false)
  })

  it('canBatchAdopt：仅可导入且非 conflict', () => {
    expect(canBatchAdopt(makeItem({ canImport: true, status: 'unmanaged' }))).toBe(true)
    expect(canBatchAdopt(makeItem({ canImport: true, status: 'unmanaged_reusable' }))).toBe(true)
    expect(canBatchAdopt(makeItem({ canImport: false, status: 'conflict' }))).toBe(false)
    // conflict 即使 canImport 为 true 也被排除
    expect(canBatchAdopt(makeItem({ canImport: true, status: 'conflict' }))).toBe(false)
  })
})

describe('targetClassifier — countConflicts', () => {
  it('只统计非 managed 的 conflict 项', () => {
    const items = [
      makeItem({ managed: false, status: 'conflict' }),
      makeItem({ managed: true, status: 'conflict' }), // managed 不计
      makeItem({ managed: false, status: 'unmanaged' }),
      makeItem({ managed: false, status: 'conflict' }),
    ]
    expect(countConflicts(items)).toBe(2)
  })

  it('空数组返回 0', () => {
    expect(countConflicts([])).toBe(0)
  })
})

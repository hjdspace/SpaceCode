import { describe, it, expect } from 'vitest'
import {
  detectPopoverTrigger,
  filterItems,
  resolveItemSelection,
  dispatchBadge,
  dispatchCommandChip,
  cycleIndex,
  isSubmitEnabled,
  resolveKeyAction,
  getBuiltinPopoverItems,
  type PopoverItem,
} from '@/lib/message-input-logic'
import type { CommandBadge } from '@/types'
import { BUILT_IN_COMMANDS } from '@/lib/constants/commands'

// ─── detectPopoverTrigger ────────────────────────────────────────

describe('detectPopoverTrigger — @ 文件触发', () => {
  it('光标位于 @ 后立即触发 file 模式', () => {
    const result = detectPopoverTrigger('@', 1)
    expect(result).toEqual({ mode: 'file', filter: '', triggerPos: 0 })
  })

  it('@ 后输入过滤词，filter 与 triggerPos 正确', () => {
    const result = detectPopoverTrigger('hello @foo', 10)
    expect(result).toEqual({ mode: 'file', filter: 'foo', triggerPos: 6 })
  })

  it('@ 后含空格则不再触发（@ 已闭合）', () => {
    expect(detectPopoverTrigger('@foo bar', 8)).toBeNull()
  })

  it('光标在 @ 之前不触发', () => {
    expect(detectPopoverTrigger('@foo', 0)).toBeNull()
  })
})

describe('detectPopoverTrigger — / 技能触发', () => {
  it('行首 / 触发 skill 模式', () => {
    const result = detectPopoverTrigger('/', 1)
    expect(result).toEqual({ mode: 'skill', filter: '', triggerPos: 0 })
  })

  it('空白后 / 触发 skill 模式', () => {
    const result = detectPopoverTrigger('hello /cle', 10)
    expect(result).toEqual({ mode: 'skill', filter: 'cle', triggerPos: 6 })
  })

  it('路径中的 / 不触发（无前置空白）', () => {
    // "src/app" 中间的 / 不应打开 picker
    expect(detectPopoverTrigger('src/app', 7)).toBeNull()
  })

  it('/ 后含空格则不再触发', () => {
    expect(detectPopoverTrigger('/clear now', 10)).toBeNull()
  })

  it('优先级：@ 命中时即便前方有 / 也走 file 分支', () => {
    const result = detectPopoverTrigger('/cmd @file', 10)
    expect(result?.mode).toBe('file')
  })

  it('空文本与光标 0 不触发', () => {
    expect(detectPopoverTrigger('', 0)).toBeNull()
  })
})

// ─── filterItems ────────────────────────────────────────────────

describe('filterItems — 子串过滤', () => {
  const items: PopoverItem[] = [
    { label: 'clear', value: '/clear', description: 'Clear conversation' },
    { label: 'compact', value: '/compact', description: 'Compress context' },
    { label: 'help', value: '/help', description: 'Show tips', aliases: ['h', 'assist'] },
  ]

  it('按 label 子串匹配（大小写不敏感）', () => {
    expect(filterItems(items, 'CLE').map((i) => i.label)).toEqual(['clear'])
  })

  it('按 description 匹配', () => {
    expect(filterItems(items, 'tips')).toHaveLength(1)
    expect(filterItems(items, 'tips')[0].label).toBe('help')
  })

  it('按 alias 匹配', () => {
    expect(filterItems(items, 'assist').map((i) => i.label)).toEqual(['help'])
  })

  it('空 filter 返回全部', () => {
    expect(filterItems(items, '')).toHaveLength(3)
  })

  it('无匹配返回空数组', () => {
    expect(filterItems(items, 'zzz')).toEqual([])
  })
})

// ─── resolveItemSelection ───────────────────────────────────────

describe('resolveItemSelection — 立即命令', () => {
  it('builtIn + immediate 命令返回 immediate_command', () => {
    const item: PopoverItem = {
      label: 'clear',
      value: '/clear',
      builtIn: true,
      immediate: true,
    }
    const result = resolveItemSelection(item, 'skill', 0, '/cle', 'cle')
    expect(result).toEqual({ action: 'immediate_command', commandValue: '/clear' })
  })
})

describe('resolveItemSelection — 非立即命令生成 badge', () => {
  it('skill 模式下选中命令：清空触发段并设置 badge', () => {
    const item: PopoverItem = {
      label: 'goal',
      value: '/goal',
      description: 'Set a goal',
      kind: 'sdk_command',
    }
    const result = resolveItemSelection(item, 'skill', 0, '/go', 'go')

    expect(result.action).toBe('set_badge')
    expect(result.badge).toMatchObject({
      command: '/goal',
      label: 'goal',
      description: 'Set a goal',
      kind: 'sdk_command',
    })
    expect(result.newInputValue).toBe('')
  })

  it('skill 模式下保留触发段前后的文本', () => {
    const item: PopoverItem = {
      label: 'goal',
      value: '/goal',
      kind: 'sdk_command',
    }
    // "before /go after"：triggerPos=7，filter=go，光标在 "/go" 末尾
    const result = resolveItemSelection(item, 'skill', 7, 'before /go after', 'go')
    expect(result.newInputValue).toBe('before  after')
  })

  it('缺省 kind 与 description 时落默认值', () => {
    const item: PopoverItem = { label: 'x', value: '/x' }
    const result = resolveItemSelection(item, 'skill', 0, '/', '')
    expect(result.badge).toMatchObject({ kind: 'slash_command', description: '' })
  })
})

describe('resolveItemSelection — 文件 mention', () => {
  it('file 模式下插入 @path 并保留前后文', () => {
    const item: PopoverItem = { label: 'main.ts', value: 'src/main.ts' }
    const result = resolveItemSelection(item, 'file', 5, 'edit @mai', 'mai')

    expect(result.action).toBe('insert_file_mention')
    expect(result.newInputValue).toBe('edit @src/main.ts ')
  })

  it('file 模式下光标在 @ 时只插入', () => {
    const item: PopoverItem = { label: 'a', value: 'a.ts' }
    const result = resolveItemSelection(item, 'file', 0, '@', '')
    expect(result.newInputValue).toBe('@a.ts ')
  })
})

// ─── dispatchBadge ──────────────────────────────────────────────

function makeBadge(overrides: Partial<CommandBadge> = {}): CommandBadge {
  return {
    command: '/x',
    label: 'x',
    description: '',
    kind: 'slash_command',
    source: 'builtin',
    ...overrides,
  }
}

describe('dispatchBadge — 空 badge', () => {
  it('空数组返回 userContent 原文', () => {
    const r = dispatchBadge([], 'hello')
    expect(r).toEqual({ prompt: 'hello', displayLabel: 'hello' })
  })
})

describe('dispatchBadge — 单 badge', () => {
  it('slash_command 拼接命令与用户内容', () => {
    const r = dispatchBadge(makeBadge({ command: '/review' }), 'check this')
    expect(r.prompt).toBe('/review check this')
    expect(r.displayLabel).toContain('/cmd:"x":slash_command:builtin')
    expect(r.displayLabel).toContain('check this')
  })

  it('slash_command 无用户内容时只发命令', () => {
    const r = dispatchBadge(makeBadge({ command: '/clear' }), '')
    expect(r.prompt).toBe('/clear')
    expect(r.displayLabel).toBe('/cmd:"x":slash_command:builtin')
  })

  it('agent_skill 走 slash 风格拼接', () => {
    const r = dispatchBadge(
      makeBadge({ command: '/simplify', label: 'simplify', kind: 'agent_skill' }),
      'my code',
    )
    expect(r.prompt).toBe('/simplify my code')
  })

  it('codepilot_command 展开预设提示词', () => {
    const r = dispatchBadge(
      makeBadge({ command: '/compact', kind: 'codepilot_command' }),
      'keep it short',
    )
    // 预设 prompt 已注入，且包含 user context
    expect(r.prompt).toContain('User context: keep it short')
    expect(r.prompt.length).toBeGreaterThan('keep it short'.length)
  })

  it('codepilot_command 无用户内容时直接用预设', () => {
    const r = dispatchBadge(
      makeBadge({ command: '/compact', kind: 'codepilot_command' }),
      '',
    )
    expect(r.prompt).toBeTruthy()
    expect(r.prompt).not.toContain('User context')
  })

  it('codepilot_command 缺预设时回落到命令本身', () => {
    const r = dispatchBadge(
      makeBadge({ command: '/nonexistent-preset', kind: 'codepilot_command' }),
      '',
    )
    expect(r.prompt).toBe('/nonexistent-preset')
  })

  it('mcp_tool 拼接 mcp 提示词', () => {
    const r = dispatchBadge(
      makeBadge({ label: 'search', kind: 'mcp_tool' }),
      'query',
    )
    expect(r.prompt).toContain('Use the MCP tool search')
    expect(r.prompt).toContain('query')
  })

  it('未知 kind 回落到 userContent', () => {
    const r = dispatchBadge(
      makeBadge({ kind: 'immediate' as CommandBadge['kind'], command: '/clear' }),
      'user text',
    )
    expect(r.prompt).toBe('user text')
  })

  it('缺省 kind 视为 slash_command', () => {
    const r = dispatchBadge(
      { command: '/c', label: 'c', description: '' } as CommandBadge,
      '',
    )
    expect(r.prompt).toBe('/c')
    expect(r.displayLabel).toContain(':slash_command:builtin')
  })
})

describe('dispatchBadge — 多 agent_skill 合并', () => {
  it('多个 agent_skill 拼接为一个 prompt', () => {
    const badges: CommandBadge[] = [
      makeBadge({ command: '/a', label: 'a', kind: 'agent_skill' }),
      makeBadge({ command: '/b', label: 'b', kind: 'agent_skill' }),
    ]
    const r = dispatchBadge(badges, 'do it')
    expect(r.prompt).toBe('Use the a, b skills. User context: do it')
    // displayLabel 包含两个 chip marker + userContent
    expect(r.displayLabel).toContain('/cmd:"a"')
    expect(r.displayLabel).toContain('/cmd:"b"')
    expect(r.displayLabel).toContain('do it')
  })

  it('多个 agent_skill 无用户内容时使用礼貌提示', () => {
    const badges: CommandBadge[] = [
      makeBadge({ command: '/a', label: 'a', kind: 'agent_skill' }),
      makeBadge({ command: '/b', label: 'b', kind: 'agent_skill' }),
    ]
    const r = dispatchBadge(badges, '')
    expect(r.prompt).toBe('Please use the a, b skills.')
  })

  it('多 badge 但 kind 不全是 agent_skill → 走单 badge 分支', () => {
    const badges: CommandBadge[] = [
      makeBadge({ command: '/a', label: 'a', kind: 'agent_skill' }),
      makeBadge({ command: '/b', label: 'b', kind: 'slash_command' }),
    ]
    const r = dispatchBadge(badges, 'ctx')
    // 单 badge 分支只取第一个
    expect(r.prompt).toBe('/a ctx')
  })
})

// ─── dispatchCommandChip ────────────────────────────────────────

describe('dispatchCommandChip — chip → badge 复用', () => {
  it('空 chips 直接返回 userContent', () => {
    expect(dispatchCommandChip([], 'hello')).toEqual({
      prompt: 'hello',
      displayLabel: 'hello',
    })
  })

  it('单 chip 走 dispatchBadge 分支', () => {
    const r = dispatchCommandChip(
      [{ command: '/review', label: 'review', kind: 'slash_command', source: 'builtin' }],
      'go',
    )
    expect(r.prompt).toBe('/review go')
  })
})

// ─── cycleIndex ─────────────────────────────────────────────────

describe('cycleIndex — 方向循环', () => {
  it('down 在中段 +1', () => {
    expect(cycleIndex(1, 'down', 5)).toBe(2)
  })

  it('down 到末尾回绕到 0', () => {
    expect(cycleIndex(4, 'down', 5)).toBe(0)
  })

  it('up 在中段 -1', () => {
    expect(cycleIndex(2, 'up', 5)).toBe(1)
  })

  it('up 在 0 回绕到末尾', () => {
    expect(cycleIndex(0, 'up', 5)).toBe(4)
  })

  it('length=1 时上下均回到 0', () => {
    expect(cycleIndex(0, 'down', 1)).toBe(0)
    expect(cycleIndex(0, 'up', 1)).toBe(0)
  })
})

// ─── isSubmitEnabled ────────────────────────────────────────────

describe('isSubmitEnabled — 提交按钮门控', () => {
  const base = {
    inputValue: '',
    hasBadge: false,
    hasFiles: false,
    isStreaming: false,
    disabled: false,
  }

  it('disabled 时一律 false', () => {
    expect(isSubmitEnabled({ ...base, disabled: true, inputValue: 'x' })).toBe(false)
  })

  it('isStreaming 时返回 true（充当停止按钮）', () => {
    expect(isSubmitEnabled({ ...base, isStreaming: true })).toBe(true)
  })

  it('非空输入 → true；纯空白 → false', () => {
    expect(isSubmitEnabled({ ...base, inputValue: 'hello' })).toBe(true)
    expect(isSubmitEnabled({ ...base, inputValue: '   \n\t  ' })).toBe(false)
  })

  it('有 badge → true', () => {
    expect(isSubmitEnabled({ ...base, hasBadge: true })).toBe(true)
  })

  it('有文件 → true', () => {
    expect(isSubmitEnabled({ ...base, hasFiles: true })).toBe(true)
  })

  it('空输入且无 badge / 文件 → false', () => {
    expect(isSubmitEnabled(base)).toBe(false)
  })
})

// ─── resolveKeyAction ───────────────────────────────────────────

describe('resolveKeyAction — 键盘分发', () => {
  const base = {
    popoverMode: null as 'skill' | 'file' | null,
    popoverHasItems: false,
    inputValue: '',
    hasBadge: false,
  }

  it('popover 打开时 ArrowDown/ArrowUp 触发导航', () => {
    const s = { ...base, popoverMode: 'skill' as const, popoverHasItems: true }
    expect(resolveKeyAction('ArrowDown', s)).toEqual({
      type: 'popover_navigate',
      direction: 'down',
    })
    expect(resolveKeyAction('ArrowUp', s)).toEqual({
      type: 'popover_navigate',
      direction: 'up',
    })
  })

  it('popover 打开时 Enter/Tab 触发选择', () => {
    const s = { ...base, popoverMode: 'file' as const, popoverHasItems: true }
    expect(resolveKeyAction('Enter', s)).toEqual({ type: 'popover_select' })
    expect(resolveKeyAction('Tab', s)).toEqual({ type: 'popover_select' })
  })

  it('popover 打开时 Escape 关闭 popover', () => {
    const s = { ...base, popoverMode: 'skill' as const, popoverHasItems: true }
    expect(resolveKeyAction('Escape', s)).toEqual({ type: 'close_popover' })
  })

  it('popover 打开但无项时，Enter 不再拦截（passthrough）', () => {
    const s = { ...base, popoverMode: 'skill' as const, popoverHasItems: false }
    expect(resolveKeyAction('Enter', s)).toEqual({ type: 'passthrough' })
  })

  it('无 popover 时 Escape 走 passthrough（不吞键）', () => {
    expect(resolveKeyAction('Escape', base)).toEqual({ type: 'passthrough' })
  })

  it('普通字符 passthrough', () => {
    expect(resolveKeyAction('a', base)).toEqual({ type: 'passthrough' })
  })
})

// ─── getBuiltinPopoverItems ─────────────────────────────────────

describe('getBuiltinPopoverItems — 内置命令转 popover 项', () => {
  it('数量与 BUILT_IN_COMMANDS 一致', () => {
    const items = getBuiltinPopoverItems()
    expect(items).toHaveLength(BUILT_IN_COMMANDS.length)
  })

  it('每项 value 加 / 前缀，并保留 kind/immediate/aliases', () => {
    const items = getBuiltinPopoverItems()
    const clear = items.find((i) => i.label === 'clear')!
    expect(clear.value).toBe('/clear')
    expect(clear.builtIn).toBe(true)
    expect(clear.immediate).toBe(true)
    expect(clear.aliases).toContain('reset')
  })
})

import { describe, it, expect } from 'vitest'
import {
  searchCommands,
  getGhostText,
  findMidInputSlashCommand,
} from '@/lib/commands/commandSearch'
import type { UnifiedCommand } from '@/lib/commands/types'

function makeCommand(name: string, overrides: Partial<UnifiedCommand> = {}): UnifiedCommand {
  return {
    name,
    description: '',
    source: 'builtin',
    kind: 'immediate',
    ...overrides,
  }
}

const NAMES = (results: ReturnType<typeof searchCommands>) => results.map(r => r.command.name)

describe('searchCommands — 空 query', () => {
  it('按使用频次降序返回全部可见命令', () => {
    const commands = [makeCommand('a'), makeCommand('b'), makeCommand('c')]
    const results = searchCommands('', commands, { a: 1, c: 5 })

    expect(NAMES(results)).toEqual(['c', 'a', 'b'])
  })

  it('未使用的命令 score 为 0', () => {
    const results = searchCommands('', [makeCommand('a')])
    expect(results[0].score).toBe(0)
  })

  it('过滤 isHidden 命令', () => {
    const commands = [makeCommand('visible'), makeCommand('hidden', { isHidden: true })]
    expect(NAMES(searchCommands('', commands))).toEqual(['visible'])
  })
})

describe('searchCommands — 排序优先级', () => {
  it('名称精确匹配优先于别名/前缀匹配', () => {
    const commands = [
      makeCommand('search', { aliases: ['find'] }),
      makeCommand('find'),
    ]
    const results = searchCommands('find', commands)
    expect(NAMES(results)[0]).toBe('find')
  })

  it('别名精确匹配优先于名称前缀匹配', () => {
    const commands = [
      makeCommand('finding', { aliases: ['locate'] }),
      makeCommand('other', { aliases: ['find'] }),
    ]
    const results = searchCommands('find', commands)
    expect(NAMES(results)[0]).toBe('other')
  })

  it('名称前缀匹配优先于别名前缀匹配', () => {
    const commands = [
      makeCommand('render', { aliases: ['xx'] }),
      makeCommand('alpha', { aliases: ['render-something'] }),
    ]
    const results = searchCommands('render', commands)
    expect(NAMES(results)[0]).toBe('render')
  })

  it('同等匹配质量时使用频次更高者优先', () => {
    // 两条命令仅通过别名命中，匹配质量相同，由使用频次决定顺序
    const commands = [
      makeCommand('alpha', { aliases: ['run'] }),
      makeCommand('beta', { aliases: ['run'] }),
    ]
    const results = searchCommands('run', commands, { beta: 9, alpha: 1 })
    expect(NAMES(results)).toEqual(['beta', 'alpha'])
  })

  it('同等匹配质量且频次相同时保持稳定顺序', () => {
    const commands = [
      makeCommand('alpha', { aliases: ['run'] }),
      makeCommand('beta', { aliases: ['run'] }),
    ]
    expect(NAMES(searchCommands('run', commands))).toEqual(['alpha', 'beta'])
  })

  it('模糊匹配连字符/下划线分隔的名称部件', () => {
    const commands = [
      makeCommand('project:create'),
      makeCommand('unrelated'),
    ]
    const results = searchCommands('create', commands)
    expect(NAMES(results)).toContain('project:create')
  })

  it('名称精确匹配者排在前缀匹配者之前', () => {
    const commands = [makeCommand('finder'), makeCommand('find')]
    const results = searchCommands('find', commands)
    expect(NAMES(results)).toEqual(['find', 'finder'])
  })

  it('别名精确匹配者排在别名前缀匹配者之前', () => {
    const commands = [
      makeCommand('beta', { aliases: ['runner'] }),
      makeCommand('alpha', { aliases: ['run'] }),
    ]
    const results = searchCommands('run', commands)
    expect(NAMES(results)[0]).toBe('alpha')
  })

  it('两条同为名称前缀命中时都返回（前缀裁决链平局）', () => {
    const commands = [makeCommand('find-x'), makeCommand('find-y')]
    const results = searchCommands('find', commands)
    expect(NAMES(results)).toEqual(['find-x', 'find-y'])
  })

  it('仅描述命中且其余裁决皆平局时以模糊分兜底', () => {
    const commands = [
      makeCommand('omega', { description: 'alpha 工具' }),
      makeCommand('theta', { description: 'alpha 助手' }),
    ]
    const results = searchCommands('alpha', commands)
    expect(NAMES(results)).toEqual(['omega', 'theta'])
  })
})

describe('searchCommands — 边界', () => {
  it('无匹配时返回空数组', () => {
    const commands = [makeCommand('alpha')]
    expect(searchCommands('zzzz', commands)).toEqual([])
  })

  it('空命令列表返回空数组', () => {
    expect(searchCommands('x', [])).toEqual([])
  })

  it('搜索时同样排除 isHidden 命令', () => {
    const commands = [makeCommand('hidden', { isHidden: true }), makeCommand('hidden2')]
    expect(NAMES(searchCommands('hidden', commands))).toEqual(['hidden2'])
  })

  it('返回结果携带合法 score 数值', () => {
    const results = searchCommands('alpha', [makeCommand('alpha')])
    expect(typeof results[0].score).toBe('number')
  })
})

describe('getGhostText', () => {
  it('返回后缀与完整命令名', () => {
    const commands = [makeCommand('commit')]
    expect(getGhostText('com', commands)).toEqual({
      suffix: 'mit',
      fullCommand: 'commit',
    })
  })

  it('空 query 返回 null', () => {
    expect(getGhostText('', [makeCommand('commit')])).toBeNull()
  })

  it('完整匹配时无后缀返回 null', () => {
    expect(getGhostText('commit', [makeCommand('commit')])).toBeNull()
  })

  it('无候选返回 null', () => {
    expect(getGhostText('zzz', [makeCommand('commit')])).toBeNull()
  })
})

describe('findMidInputSlashCommand', () => {
  it('识别行内 / 命令并给出原始 token 位置', () => {
    const input = '帮我看看 /rev'
    const result = findMidInputSlashCommand(input, input.length)
    expect(result).toEqual({ token: '/rev', startPos: 5, partialCommand: 'rev' })
  })

  it('行首 / 命令返回 null（由行首逻辑处理）', () => {
    expect(findMidInputSlashCommand('/review', 7)).toBeNull()
  })

  it('光标前的文本不含空格 + / 时返回 null', () => {
    expect(findMidInputSlashCommand('hello world', 5)).toBeNull()
  })

  it('仅使用光标前的内容', () => {
    const input = 'text /abc rest'
    // 光标位于 '/abc' 之后、' rest' 之前
    const result = findMidInputSlashCommand(input, 9)
    expect(result).toEqual({ token: '/abc', startPos: 5, partialCommand: 'abc' })
  })
})

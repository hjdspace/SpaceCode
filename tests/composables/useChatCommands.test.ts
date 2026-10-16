/**
 * useChatCommands 斜杠命令契约。
 *
 * resolveSlashCommand 的 kind 分派决定输入是本地立即执行（immediate）、
 * 还是以 badge 形式等待用户补充上下文；dispatchBadge 的展开格式直接决定
 * 最终发送给引擎的 prompt（如 /doctor 展开 COMMAND_PROMPTS、agent_skill
 * 包装为 "Use the X skill"）。回归这些格式会静默改变发给模型的行为。
 *
 * 使用真实 BUILT_IN_COMMANDS/COMMAND_PROMPTS 数据（勿 mock），并顺带钉住
 * 两个现状行为：immediate 命令中未进入 executeImmediateCommand switch 的
 * 成员（diff/theme/vim/keybindings/browser-use）走 'Executed /x' 兜底；
 * 命令名大小写敏感（'/HELP' 按未知命令处理）。
 */
import { describe, it, expect, vi } from 'vitest'
import { useChatCommands, type UseChatCommandsOptions } from '@/composables/useChatCommands'
import { COMMAND_PROMPTS } from '@/lib/constants/commands'

type ChatMessage = UseChatCommandsOptions['messages'][number]

function makeOptions(overrides: Partial<UseChatCommandsOptions> = {}): UseChatCommandsOptions {
  return {
    sessionId: 's1',
    messages: [],
    onClearMessages: vi.fn(),
    onOpenTerminal: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenSkills: vi.fn(),
    onOpenMcp: vi.fn(),
    onOpenRewind: vi.fn(),
    ...overrides,
  } as UseChatCommandsOptions
}

const msg = (role: 'user' | 'assistant', content: string): ChatMessage =>
  ({ role, content }) as ChatMessage

describe('useChatCommands — resolveSlashCommand 命令分派', () => {
  it('非斜杠输入返回 unknown', () => {
    const c = useChatCommands(makeOptions())

    expect(c.resolveSlashCommand('hello world')).toEqual({ type: 'unknown' })
  })

  it('未知命令作为 badge（kind: slash_command）', () => {
    const c = useChatCommands(makeOptions())

    const r = c.resolveSlashCommand('/nope 补充说明')

    expect(r.type).toBe('badge')
    expect(r.badge).toEqual({
      command: '/nope',
      label: 'nope',
      description: '',
      kind: 'slash_command',
    })
  })

  it('help 立即执行并返回帮助文本', () => {
    const c = useChatCommands(makeOptions())

    const r = c.resolveSlashCommand('/help')

    expect(r.type).toBe('immediate')
    expect(r.content).toContain('## Available Commands')
    expect(r.content).toContain('- **/help** — Show available commands and tips')
    expect(r.content).toContain('### Custom Skills')
  })

  it('clear 触发 onClearMessages 并返回清空提示', () => {
    const options = makeOptions()
    const c = useChatCommands(options)

    const r = c.resolveSlashCommand('/clear')

    expect(options.onClearMessages).toHaveBeenCalledTimes(1)
    expect(r.type).toBe('immediate')
    expect(r.content).toBe('Conversation cleared. Start a new chat!')
  })

  it.each(['reset', 'new'])('%s 作为 clear 的别名同样触发清空', (alias) => {
    const options = makeOptions()
    const c = useChatCommands(options)

    c.resolveSlashCommand(`/${alias}`)

    expect(options.onClearMessages).toHaveBeenCalledTimes(1)
  })

  it('cost 对空消息返回引导提示', () => {
    const c = useChatCommands(makeOptions())

    const r = c.resolveSlashCommand('/cost')

    expect(r.type).toBe('immediate')
    expect(r.content).toContain('No messages yet')
  })

  it('cost 统计 user/assistant token 估算与回合数', () => {
    // 1 token ≈ 4 字符：8 字符 → 2 tokens，12 字符 → 3 tokens
    const c = useChatCommands(makeOptions({
      messages: [msg('user', '12345678'), msg('assistant', '123456789012')],
    }))

    const r = c.resolveSlashCommand('/cost')

    expect(r.content).toContain('| Input tokens | 2 |')
    expect(r.content).toContain('| Output tokens | 3 |')
    expect(r.content).toContain('| **Total tokens** | **5** |')
    expect(r.content).toContain('| Turns | 1 |')
  })

  it('context 输出消息统计且无 workingDirectory 时省略该行', () => {
    const c = useChatCommands(makeOptions({
      messages: [msg('user', 'a'), msg('user', 'b'), msg('assistant', 'c')],
    }))

    const r = c.resolveSlashCommand('/context')

    expect(r.content).toContain('| Total messages | 3 |')
    expect(r.content).toContain('| User messages | 2 |')
    expect(r.content).toContain('| Assistant messages | 1 |')
    expect(r.content).not.toContain('Working directory')
  })

  it('context 带 workingDirectory 时包含该行', () => {
    const c = useChatCommands(makeOptions({
      workingDirectory: '/home/user/proj',
    }))

    const r = c.resolveSlashCommand('/context')

    expect(r.content).toContain('| Working directory | `/home/user/proj` |')
  })

  it.each([
    ['/terminal', 'onOpenTerminal', 'Terminal panel opened.'],
    ['/settings', 'onOpenSettings', 'Settings panel opened.'],
    ['/skills', 'onOpenSkills', 'Skills manager opened.'],
    ['/mcp', 'onOpenMcp', 'MCP server manager opened.'],
  ] as const)('%s 触发对应面板回调并返回提示', (input, callback, content) => {
    const options = makeOptions()
    const c = useChatCommands(options)

    const r = c.resolveSlashCommand(input)

    expect(options[callback]).toHaveBeenCalledTimes(1)
    expect(r.type).toBe('immediate')
    expect(r.content).toBe(content)
  })

  it.each(['rewind', 'checkpoint'])('%s 触发 onOpenRewind，content 走 Executed 兜底', (name) => {
    const options = makeOptions()
    const c = useChatCommands(options)

    const r = c.resolveSlashCommand(`/${name}`)

    expect(options.onOpenRewind).toHaveBeenCalledTimes(1)
    expect(r.type).toBe('immediate')
    expect(r.content).toBe(`Executed /${name}`)
  })

  it.each(['diff', 'theme', 'vim', 'keybindings', 'browser-use'])(
    'immediate 命令 %s 无 switch case 时返回 Executed 兜底',
    (name) => {
      const c = useChatCommands(makeOptions())

      const r = c.resolveSlashCommand(`/${name}`)

      expect(r.type).toBe('immediate')
      expect(r.content).toBe(`Executed /${name}`)
    },
  )

  it('命令名大小写敏感，/HELP 按未知命令处理', () => {
    const c = useChatCommands(makeOptions())

    const r = c.resolveSlashCommand('/HELP')

    expect(r.type).toBe('badge')
    expect(r.badge).toEqual({
      command: '/HELP',
      label: 'HELP',
      description: '',
      kind: 'slash_command',
    })
  })

  it('带参数的输入只取命令名部分', () => {
    const options = makeOptions()
    const c = useChatCommands(options)

    c.resolveSlashCommand('/clear extra args')

    expect(options.onClearMessages).toHaveBeenCalledTimes(1)
  })

  it('sdk_command（/compact）返回携带描述的 badge', () => {
    const c = useChatCommands(makeOptions())

    const r = c.resolveSlashCommand('/compact')

    expect(r.type).toBe('badge')
    expect(r.badge).toEqual({
      command: '/compact',
      label: 'compact',
      description: 'Compress conversation context',
      kind: 'sdk_command',
    })
  })

  it('codepilot_command（/doctor）返回 badge', () => {
    const c = useChatCommands(makeOptions())

    const r = c.resolveSlashCommand('/doctor')

    expect(r.type).toBe('badge')
    expect(r.badge).toEqual({
      command: '/doctor',
      label: 'doctor',
      description: 'Diagnose project health',
      kind: 'codepilot_command',
    })
  })
})

describe('useChatCommands — dispatchBadge prompt 展开', () => {
  it('无 activeBadge 时返回 null', () => {
    const c = useChatCommands(makeOptions())

    expect(c.dispatchBadge('hello')).toBeNull()
  })

  it('agent_skill 带用户上下文时包装为 Use the X skill', () => {
    const c = useChatCommands(makeOptions())
    c.setBadge({ command: '/commit', label: 'commit', description: '', kind: 'agent_skill' })

    expect(c.dispatchBadge('修复登录')).toEqual({
      prompt: 'Use the commit skill. User context: 修复登录',
      displayLabel: '/commit\n修复登录',
    })
  })

  it('agent_skill 无上下文时包装为 Please use the X skill', () => {
    const c = useChatCommands(makeOptions())
    c.setBadge({ command: '/commit', label: 'commit', description: '', kind: 'agent_skill' })

    expect(c.dispatchBadge('')).toEqual({
      prompt: 'Please use the commit skill.',
      displayLabel: '/commit',
    })
  })

  it('sdk_command 带上下文拼接 command，无上下文仅 command', () => {
    const c = useChatCommands(makeOptions())
    c.setBadge(c.resolveSlashCommand('/compact').badge!)

    expect(c.dispatchBadge('保留文件')).toEqual({
      prompt: '/compact 保留文件',
      displayLabel: '/compact\n保留文件',
    })
    expect(c.dispatchBadge('')).toEqual({
      prompt: '/compact',
      displayLabel: '/compact',
    })
  })

  it('slash_command badge（未知命令）同样拼接 command 与上下文', () => {
    const c = useChatCommands(makeOptions())
    c.setBadge(c.resolveSlashCommand('/mything').badge!)

    expect(c.dispatchBadge('你好')).toEqual({
      prompt: '/mything 你好',
      displayLabel: '/mything\n你好',
    })
  })

  it('codepilot_command 展开 COMMAND_PROMPTS 并追加用户上下文', () => {
    const c = useChatCommands(makeOptions())
    c.setBadge(c.resolveSlashCommand('/doctor').badge!)

    const result = c.dispatchBadge('检查依赖')!

    expect(result.prompt.startsWith(COMMAND_PROMPTS['/doctor'])).toBe(true)
    expect(result.prompt.endsWith('\n\nUser context: 检查依赖')).toBe(true)
  })

  it('codepilot_command 无 PROMPTS 条目时回退为命令本身', () => {
    const c = useChatCommands(makeOptions())
    c.setBadge({ command: '/noPrompt', label: 'noPrompt', description: '', kind: 'codepilot_command' })

    expect(c.dispatchBadge('')).toEqual({
      prompt: '/noPrompt',
      displayLabel: '/noPrompt',
    })
  })
})

describe('useChatCommands — badge 状态', () => {
  it('setBadge 后 hasActiveBadge 为 true，clearBadge 后恢复 false', () => {
    const c = useChatCommands(makeOptions())

    expect(c.hasActiveBadge.value).toBe(false)

    c.setBadge({ command: '/compact', label: 'compact', description: '', kind: 'sdk_command' })
    expect(c.hasActiveBadge.value).toBe(true)

    c.clearBadge()
    expect(c.hasActiveBadge.value).toBe(false)
    expect(c.dispatchBadge('x')).toBeNull()
  })
})

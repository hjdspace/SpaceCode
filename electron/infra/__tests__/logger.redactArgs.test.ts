// @vitest-environment node
/**
 * 启动日志的 argv 脱敏契约 —— spawn 的 argv 会被 join 成一行写进会话日志
 * （sessionProcess / PiSessionProcess 的 Starting process 行），凭据与提示词
 * 正文不能跟着进日志：
 * - --api-key 值打码（保留首尾 4 位便于对账），formatLine 兜底再拦一层；
 * - --system-prompt / 内联 --append-system-prompt 替换为长度占位；
 * - 已存在的文件路径（persona 落盘 / --system-prompt-file）保留，排查要用。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fsProbe = vi.hoisted(() => ({
  appended: [] as string[],
  existing: new Set<string>(['/tmp/SpaceCode/pi-agent-sess-1.md']),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/home/tester',
    commandLine: { hasSwitch: () => false },
    isPackaged: false,
  },
}))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => fsProbe.existing.has(String(p)),
  mkdirSync: () => {},
  appendFileSync: (_path: string, line: string) => { fsProbe.appended.push(line) },
  readdirSync: () => [],
  unlinkSync: () => {},
  statSync: () => ({ mtime: { getTime: () => Date.now() }, size: 0 }),
  readFileSync: () => '',
}))

vi.mock('fs/promises', () => ({
  readFile: async () => '',
  readdir: async () => [],
  stat: async () => ({ size: 0, mtime: new Date() }),
}))

import { initLogger, info } from '../logger'
import { redactArgsForLog } from '../redactArgs'

beforeEach(() => {
  fsProbe.appended.length = 0
})

describe('redactArgsForLog', () => {
  it('--api-key 值打码，保留首尾 4 位', () => {
    expect(redactArgsForLog(['--mode', 'rpc', '--api-key', 'probe-key-not-a-secret'])).toEqual([
      '--mode', 'rpc', '--api-key', 'prob****cret',
    ])
  })

  it('过短的 api-key 全打码', () => {
    expect(redactArgsForLog(['--api-key', 'short'])).toEqual(['--api-key', '****'])
  })

  it('--system-prompt 正文替换为长度占位', () => {
    expect(redactArgsForLog(['--system-prompt', 'You are a pirate'])).toEqual([
      '--system-prompt', '<redacted len=16>',
    ])
  })

  it('内联 --append-system-prompt 脱敏；已存在的 persona 路径保留', () => {
    expect(redactArgsForLog(['--append-system-prompt', 'respond in Chinese'])).toEqual([
      '--append-system-prompt', '<redacted len=18>',
    ])
    expect(redactArgsForLog(['--append-system-prompt', '/tmp/SpaceCode/pi-agent-sess-1.md'])).toEqual([
      '--append-system-prompt', '/tmp/SpaceCode/pi-agent-sess-1.md',
    ])
  })

  it('旗标精确匹配：--system-prompt-file 的路径不受影响', () => {
    expect(redactArgsForLog(['--system-prompt-file', '/tmp/SpaceCode/system-prompt-s1.txt'])).toEqual([
      '--system-prompt-file', '/tmp/SpaceCode/system-prompt-s1.txt',
    ])
  })

  it('--flag=value 连写形式同样处理', () => {
    expect(redactArgsForLog(['--api-key=probe-key-not-a-secret'])).toEqual(['--api-key=prob****cret'])
  })

  it('旗标后缺值时不动后面的旗标', () => {
    expect(redactArgsForLog(['--system-prompt', '--model', 'gpt'])).toEqual(['--system-prompt', '--model', 'gpt'])
  })

  it('返回拷贝，不改入参', () => {
    const args = ['--api-key', 'probe-key-not-a-secret']
    redactArgsForLog(args)
    expect(args[1]).toBe('probe-key-not-a-secret')
  })
})

describe('formatLine 兜底', () => {
  beforeEach(() => {
    initLogger()
  })

  it('任意日志行里 --api-key 的值都不回显', () => {
    info('SessionProcess', 'Starting process | args=--mode rpc --api-key probe-key-not-a-secret --model gpt | cwd=/x')
    const all = fsProbe.appended.join('')
    expect(all).not.toContain('probe-key-not-a-secret')
    expect(all).toContain('--api-key ****')
    expect(all).toContain('--model gpt')
  })

  it('redactArgsForLog 已打码的形态不再被吞，保留首尾 4 位', () => {
    info('PiSessionProcess', `Starting Pi RPC process | args=${redactArgsForLog(['--api-key', 'probe-key-not-a-secret']).join(' ')}`)
    const all = fsProbe.appended.join('')
    expect(all).not.toContain('probe-key-not-a-secret')
    expect(all).toContain('--api-key prob****cret')
  })
})

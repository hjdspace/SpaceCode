// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { aggregateLocalTokenStats } from '../tokenStatsService'

// --- Mocks ---

const osState = vi.hoisted(() => ({ home: '' }))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const patched = { ...actual, homedir: () => osState.home }
  return { ...patched, default: patched }
})

vi.mock('../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

// --- Fixtures ---

let tmpRoot = ''
let savedHome: string | undefined

function claudeHome(): string {
  return path.join(osState.home, '.claude')
}

function projectsDir(): string {
  return path.join(claudeHome(), 'projects')
}

function writeJsonl(projectSlug: string, sessionId: string, entries: unknown[]): string {
  const dir = path.join(projectsDir(), projectSlug)
  const file = path.join(dir, `${sessionId}.jsonl`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n'), 'utf8')
  return file
}

function usageEntry(
  timestamp: string,
  tokens: { input?: number; output?: number; cacheCreation?: number; cacheRead?: number },
  model?: string,
  sessionId?: string,
) {
  const inputTokens = tokens.input ?? 0
  const outputTokens = tokens.output ?? 0
  const cacheCreationInputTokens = tokens.cacheCreation ?? 0
  const cacheReadInputTokens = tokens.cacheRead ?? 0
  const totalTokens = inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens
  return {
    type: 'assistant',
    timestamp,
    sessionId,
    message: {
      role: 'assistant',
      model: model ?? 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: cacheCreationInputTokens,
        cache_read_input_tokens: cacheReadInputTokens,
      },
    },
  }
}

describe('aggregateLocalTokenStats', () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'token-stats-'))
    savedHome = process.env.HOME
    osState.home = path.join(tmpRoot, 'home')
    fs.mkdirSync(path.join(osState.home, '.claude'), { recursive: true })
    // Clear env vars that might redirect claude config
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.XDG_CONFIG_HOME
  })

  afterEach(() => {
    if (savedHome !== undefined) process.env.HOME = savedHome
    else delete process.env.HOME
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('空目录返回全零摘要和空 daily 数组', () => {
    const result = aggregateLocalTokenStats()
    expect(result.daily).toEqual([])
    expect(result.firstDate).toBeNull()
    expect(result.lastDate).toBeNull()
    expect(result.allTime.totalTokens).toBe(0)
    expect(result.today.totalTokens).toBe(0)
    expect(result.modelUsage).toEqual({})
  })

  it('单条消息：today 汇总正确', () => {
    const todayISO = new Date().toISOString()
    writeJsonl('proj1', 's1', [
      usageEntry(todayISO, { input: 100, output: 50 }),
    ])

    const result = aggregateLocalTokenStats()
    expect(result.today.totalTokens).toBe(150)
    expect(result.today.inputTokens).toBe(100)
    expect(result.today.outputTokens).toBe(50)
    expect(result.today.messageCount).toBe(1)
    expect(result.today.sessionCount).toBe(1)
    expect(result.allTime.totalTokens).toBe(150)
    expect(result.daily).toHaveLength(1)
    expect(result.firstDate).toBe(todayISO.slice(0, 10))
    expect(result.lastDate).toBe(todayISO.slice(0, 10))
  })

  it('多条消息跨多天：daily 按日期排序，allTime 累加', () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const twoDaysAgo = new Date(today)
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

    writeJsonl('proj1', 's1', [
      usageEntry(twoDaysAgo.toISOString(), { input: 10 }),
      usageEntry(yesterday.toISOString(), { input: 20 }),
      usageEntry(today.toISOString(), { input: 30 }),
    ])

    const result = aggregateLocalTokenStats()
    expect(result.daily).toHaveLength(3)
    expect(result.daily[0].date).toBe(twoDaysAgo.toISOString().slice(0, 10))
    expect(result.daily[2].date).toBe(today.toISOString().slice(0, 10))
    expect(result.allTime.totalTokens).toBe(60)
    expect(result.today.totalTokens).toBe(30)
    expect(result.yesterday.totalTokens).toBe(20)
  })

  it('yesterday 统计只取昨天的数据', () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    writeJsonl('proj1', 's1', [
      usageEntry(yesterday.toISOString(), { input: 200, output: 100 }),
      usageEntry(today.toISOString(), { input: 50 }),
    ])

    const result = aggregateLocalTokenStats()
    expect(result.yesterday.totalTokens).toBe(300)
    expect(result.yesterday.messageCount).toBe(1)
    expect(result.today.totalTokens).toBe(50)
  })

  it('last30Days 只包含最近30天', () => {
    const today = new Date()
    const oldDate = new Date(today)
    oldDate.setDate(oldDate.getDate() - 35)

    writeJsonl('proj1', 's1', [
      usageEntry(oldDate.toISOString(), { input: 1000 }),
      usageEntry(today.toISOString(), { input: 10 }),
    ])

    const result = aggregateLocalTokenStats()
    expect(result.last30Days.totalTokens).toBe(10)
    expect(result.allTime.totalTokens).toBe(1010)
  })

  it('modelUsage 按模型分组', () => {
    const ts = new Date().toISOString()
    writeJsonl('proj1', 's1', [
      usageEntry(ts, { input: 100 }, 'model-a'),
      usageEntry(ts, { input: 200 }, 'model-b'),
      usageEntry(ts, { input: 50 }, 'model-a'),
    ])

    const result = aggregateLocalTokenStats()
    expect(result.modelUsage['model-a'].totalTokens).toBe(150)
    expect(result.modelUsage['model-b'].totalTokens).toBe(200)
    expect(result.modelUsage['model-a'].messageCount).toBe(2)
  })

  it('未知模型归为 unknown', () => {
    const ts = new Date().toISOString()
    const entry = {
      type: 'assistant',
      timestamp: ts,
      message: { role: 'assistant', usage: { input_tokens: 10 } },
    }
    writeJsonl('proj1', 's1', [entry])

    const result = aggregateLocalTokenStats()
    expect(result.modelUsage['unknown']).toBeDefined()
    expect(result.modelUsage['unknown'].totalTokens).toBe(10)
  })

  it('多个 session 同一天：sessionCount 正确计数', () => {
    const ts = new Date().toISOString()
    writeJsonl('proj1', 's1', [usageEntry(ts, { input: 10 })])
    writeJsonl('proj1', 's2', [usageEntry(ts, { input: 20 })])

    const result = aggregateLocalTokenStats()
    expect(result.today.sessionCount).toBe(2)
    expect(result.today.totalTokens).toBe(30)
  })

  it('空行和损坏的 JSON 行被跳过', () => {
    const ts = new Date().toISOString()
    const dir = path.join(projectsDir(), 'proj1')
    const file = path.join(dir, 's1.jsonl')
    fs.mkdirSync(dir, { recursive: true })
    const validEntry = JSON.stringify(usageEntry(ts, { input: 10 }))
    fs.writeFileSync(file, `${validEntry}\n\n{ broken json }\n${validEntry}\n`, 'utf8')

    const result = aggregateLocalTokenStats()
    expect(result.today.totalTokens).toBe(20)
    expect(result.today.messageCount).toBe(2)
  })

  it('没有 usage 的条目被跳过', () => {
    const ts = new Date().toISOString()
    writeJsonl('proj1', 's1', [
      { type: 'user', timestamp: ts, message: { role: 'user', content: 'hello' } },
      usageEntry(ts, { input: 10 }),
    ])

    const result = aggregateLocalTokenStats()
    expect(result.today.totalTokens).toBe(10)
    expect(result.today.messageCount).toBe(1)
  })

  it('totalTokens 为 0 的条目被跳过', () => {
    const ts = new Date().toISOString()
    writeJsonl('proj1', 's1', [
      usageEntry(ts, { input: 0, output: 0 }),
      usageEntry(ts, { input: 10 }),
    ])

    const result = aggregateLocalTokenStats()
    expect(result.today.totalTokens).toBe(10)
    expect(result.today.messageCount).toBe(1)
  })

  it('无效 timestamp 被跳过', () => {
    writeJsonl('proj1', 's1', [
      { type: 'assistant', timestamp: 'not-a-date', message: { role: 'assistant', usage: { input_tokens: 10 } } },
      usageEntry(new Date().toISOString(), { input: 5 }),
    ])

    const result = aggregateLocalTokenStats()
    expect(result.allTime.totalTokens).toBe(5)
    expect(result.allTime.messageCount).toBe(1)
  })

  it('cache tokens 计入 totalTokens', () => {
    const ts = new Date().toISOString()
    writeJsonl('proj1', 's1', [
      usageEntry(ts, { input: 10, output: 5, cacheCreation: 100, cacheRead: 200 }),
    ])

    const result = aggregateLocalTokenStats()
    expect(result.today.totalTokens).toBe(315)
    expect(result.today.cacheCreationInputTokens).toBe(100)
    expect(result.today.cacheReadInputTokens).toBe(200)
  })

  it('子目录里的 jsonl 文件也被递归扫描', () => {
    const ts = new Date().toISOString()
    const deepDir = path.join(projectsDir(), 'proj1', 'subdir')
    const file = path.join(deepDir, 'deep.jsonl')
    fs.mkdirSync(deepDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(usageEntry(ts, { input: 42 })) + '\n', 'utf8')

    const result = aggregateLocalTokenStats()
    expect(result.allTime.totalTokens).toBe(42)
  })

  it('entry.usage 直接在顶层（无 message 包裹）也能解析', () => {
    const ts = new Date().toISOString()
    const entry = {
      type: 'assistant',
      timestamp: ts,
      usage: { input_tokens: 15, output_tokens: 5 },
    }
    writeJsonl('proj1', 's1', [entry])

    const result = aggregateLocalTokenStats()
    expect(result.allTime.totalTokens).toBe(20)
  })

  it('sessionId 从 entry.sessionId 字段读取', () => {
    const ts = new Date().toISOString()
    writeJsonl('proj1', 's1', [
      usageEntry(ts, { input: 10 }, undefined, 'explicit-session-id'),
    ])

    const result = aggregateLocalTokenStats()
    expect(result.today.sessionCount).toBe(1)
  })

  it('写入 stats-cache.json 缓存文件', () => {
    const ts = new Date().toISOString()
    writeJsonl('proj1', 's1', [usageEntry(ts, { input: 10 })])

    aggregateLocalTokenStats()
    const cachePath = path.join(claudeHome(), 'stats-cache.json')
    expect(fs.existsSync(cachePath)).toBe(true)
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    expect(cached.allTime.totalTokens).toBe(10)
  })

  it('daily entry 的 tokensByModel 正确分组', () => {
    const ts = new Date().toISOString()
    writeJsonl('proj1', 's1', [
      usageEntry(ts, { input: 100 }, 'model-a'),
      usageEntry(ts, { input: 50 }, 'model-b'),
    ])

    const result = aggregateLocalTokenStats()
    expect(result.daily[0].tokensByModel['model-a']).toBe(100)
    expect(result.daily[0].tokensByModel['model-b']).toBe(50)
  })

  it('sourceDir 指向 claude projects 目录', () => {
    const result = aggregateLocalTokenStats()
    expect(result.sourceDir).toBe(path.join(claudeHome(), 'projects'))
  })

  it('generatedAt 是有效的 ISO 时间戳', () => {
    const before = Date.now()
    const result = aggregateLocalTokenStats()
    const after = Date.now()
    const generatedAt = new Date(result.generatedAt).getTime()
    expect(generatedAt).toBeGreaterThanOrEqual(before)
    expect(generatedAt).toBeLessThanOrEqual(after)
  })
})

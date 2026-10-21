// @vitest-environment node
/**
 * Pi 会话文件映射表（chat sessionId → pi 自己的 jsonl 路径）。
 *
 * 这张表是 Pi 引擎接上历史的唯一凭据：pi 每次 spawn 都会新建一份会话文件，
 * 只有把路径用 `--session` 带回去，重启应用 / 驱逐重建 / 换模型重启后才不是
 * 一个空白会话。所以它必须落盘，且只在「文件还在 + 项目目录没换」时才认。
 *
 * 模块内有一层进程级缓存，每个用例先 vi.resetModules() 再动态 import，
 * 顺带覆盖「应用重启后从磁盘读回」这条真实路径。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'

const STORE_PATH = path.join('/home/u/userData', 'pi-sessions.json')
const SESSION_ID = 'bb512139-416a-4eb5-b468-4cbcd33f83e7'
const PI_FILE = '/home/u/.pi/agent/sessions/--D--AI-SpaceCode--/2026-10-18T12-55-29-647Z_abc.jsonl'
const CWD = 'D:\\AI\\SpaceCode'

const H = vi.hoisted(() => ({
  /** 虚拟磁盘上的文件内容：路径 → JSON 文本 */
  contents: new Map<string, string>(),
  /** 虚拟磁盘上存在的路径（含 pi 自己的会话文件，那张表不落在 contents 里） */
  existing: new Set<string>(),
  writes: [] as string[],
  writeError: null as Error | null,
  loggerWarn: vi.fn(),
}))

vi.mock('electron', () => ({ app: { getPath: () => '/home/u/userData' } }))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => H.existing.has(String(p)),
  readFileSync: (p: unknown) => {
    const key = String(p)
    const content = H.contents.get(key)
    if (content === undefined) throw new Error(`ENOENT: no such file, open '${key}'`)
    return content
  },
  writeFileSync: (p: unknown, data: unknown) => {
    if (H.writeError) throw H.writeError
    const key = String(p)
    H.contents.set(key, String(data))
    H.existing.add(key)
    H.writes.push(key)
  },
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(), warn: H.loggerWarn, error: vi.fn(), debug: vi.fn(),
}))

type Registry = typeof import('../piSessionRegistry')

async function freshRegistry(): Promise<Registry> {
  vi.resetModules()
  return await import('../piSessionRegistry')
}

beforeEach(() => {
  H.contents = new Map()
  H.existing = new Set([PI_FILE])
  H.writes = []
  H.writeError = null
})

describe('rememberPiSessionFile', () => {
  it('首次记录会建出映射文件，内容按会话 id 存路径与项目目录', async () => {
    const { rememberPiSessionFile } = await freshRegistry()

    rememberPiSessionFile(SESSION_ID, PI_FILE, CWD)

    expect(H.writes).toEqual([STORE_PATH])
    expect(JSON.parse(H.contents.get(STORE_PATH)!)).toEqual({
      [SESSION_ID]: { sessionFile: PI_FILE, cwd: CWD },
    })
  })

  it('同一会话换到新的 pi 会话文件时覆盖旧值', async () => {
    const { rememberPiSessionFile, findPiSessionFile } = await freshRegistry()
    const nextFile = '/home/u/.pi/agent/sessions/--D--AI-SpaceCode--/later.jsonl'
    H.existing.add(nextFile)

    rememberPiSessionFile(SESSION_ID, PI_FILE, CWD)
    rememberPiSessionFile(SESSION_ID, nextFile, CWD)

    expect(findPiSessionFile(SESSION_ID, CWD)).toBe(nextFile)
  })

  it('值没变时不重复写盘', async () => {
    const { rememberPiSessionFile } = await freshRegistry()

    rememberPiSessionFile(SESSION_ID, PI_FILE, CWD)
    rememberPiSessionFile(SESSION_ID, PI_FILE, CWD)

    expect(H.writes).toHaveLength(1)
  })

  it('侧边任务打 ephemeral 标记，后续重启调用不能把它降级成普通会话', async () => {
    const { rememberPiSessionFile, findPiSessionRecord } = await freshRegistry()

    rememberPiSessionFile(SESSION_ID, PI_FILE, CWD, { ephemeral: true })
    expect(JSON.parse(H.contents.get(STORE_PATH)!)[SESSION_ID]).toEqual({
      sessionFile: PI_FILE,
      cwd: CWD,
      ephemeral: true,
    })

    rememberPiSessionFile(SESSION_ID, PI_FILE, CWD)
    expect(H.writes).toHaveLength(1)
    expect(findPiSessionRecord(SESSION_ID)?.ephemeral).toBe(true)
  })

  it('列出全部映射时带上 SpaceCode sessionId，历史恢复才有主键', async () => {
    const { rememberPiSessionFile, listPiSessionRecords } = await freshRegistry()

    rememberPiSessionFile(SESSION_ID, PI_FILE, CWD)
    rememberPiSessionFile('another', PI_FILE, CWD, { ephemeral: true })

    expect(listPiSessionRecords()).toEqual([
      { sessionId: SESSION_ID, sessionFile: PI_FILE, cwd: CWD },
      { sessionId: 'another', sessionFile: PI_FILE, cwd: CWD, ephemeral: true },
    ])
  })

  it('写盘失败只告警，不把会话流程带崩', async () => {
    const { rememberPiSessionFile } = await freshRegistry()
    H.writeError = new Error('EDQUOT')

    expect(() => rememberPiSessionFile(SESSION_ID, PI_FILE, CWD)).not.toThrow()
    expect(H.loggerWarn).toHaveBeenCalledWith(
      'PiSessionRegistry',
      expect.stringContaining('Failed to persist session file'),
      expect.objectContaining({ message: 'EDQUOT' }),
    )
  })
})

describe('findPiSessionFile', () => {
  it('没有映射时返回 null —— 那是真·新会话', async () => {
    const { findPiSessionFile } = await freshRegistry()

    expect(findPiSessionFile(SESSION_ID, CWD)).toBeNull()
  })

  it('应用重启后从磁盘读回映射，仍能接上同一份历史', async () => {
    const first = await freshRegistry()
    first.rememberPiSessionFile(SESSION_ID, PI_FILE, CWD)

    const second = await freshRegistry()

    expect(second.findPiSessionFile(SESSION_ID, CWD)).toBe(PI_FILE)
  })

  it('会话换过项目目录时不接续：pi 会把会话文件头里的 cwd 当成运行时 cwd', async () => {
    const { rememberPiSessionFile, findPiSessionFile } = await freshRegistry()
    rememberPiSessionFile(SESSION_ID, PI_FILE, CWD)

    expect(findPiSessionFile(SESSION_ID, 'D:\\Other\\Project')).toBeNull()
  })

  it('项目目录只是写法不同（分隔符 / 盘符大小写 / 尾部分隔符）时照样认', async () => {
    const { rememberPiSessionFile, findPiSessionFile } = await freshRegistry()
    rememberPiSessionFile(SESSION_ID, PI_FILE, CWD)

    expect(findPiSessionFile(SESSION_ID, 'D:/AI/SpaceCode')).toBe(PI_FILE)
    expect(findPiSessionFile(SESSION_ID, 'd:\\ai\\spacecode')).toBe(PI_FILE)
    expect(findPiSessionFile(SESSION_ID, 'D:\\AI\\SpaceCode\\')).toBe(PI_FILE)
  })

  it('pi 的会话文件已被清掉时不接续，免得把死路径喂给 --session', async () => {
    const { rememberPiSessionFile, findPiSessionFile } = await freshRegistry()
    rememberPiSessionFile(SESSION_ID, PI_FILE, CWD)
    H.existing.delete(PI_FILE)

    expect(findPiSessionFile(SESSION_ID, CWD)).toBeNull()
  })

  it('映射文件损坏时从空表开始，不抛错', async () => {
    H.contents.set(STORE_PATH, '{not json')
    const { findPiSessionFile, rememberPiSessionFile } = await freshRegistry()

    expect(findPiSessionFile(SESSION_ID, CWD)).toBeNull()
    rememberPiSessionFile(SESSION_ID, PI_FILE, CWD)
    expect(findPiSessionFile(SESSION_ID, CWD)).toBe(PI_FILE)
  })

  it('映射文件里的畸形条目被过滤，不会把 undefined 当路径返回', async () => {
    H.contents.set(STORE_PATH, JSON.stringify({
      [SESSION_ID]: { sessionFile: 42, cwd: null },
      ghost: { sessionFile: PI_FILE },
      good: { sessionFile: PI_FILE, cwd: CWD },
    }))
    const { findPiSessionFile } = await freshRegistry()

    expect(findPiSessionFile(SESSION_ID, CWD)).toBeNull()
    expect(findPiSessionFile('ghost', CWD)).toBeNull()
    expect(findPiSessionFile('good', CWD)).toBe(PI_FILE)
  })
})

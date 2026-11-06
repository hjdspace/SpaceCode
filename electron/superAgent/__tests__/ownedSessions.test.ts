// @vitest-environment node
/**
 * 「哪些引擎会话属于 Super Agent」的清单（侧边栏可见性的事实来源）。
 *
 * 钉住三件事：
 *   - 认得出 Router（按 project.json 的 repoRoot 派生）与 Worker（按 state.json 的 ticketId 派生）；
 *   - 普通聊天不在清单里 —— 侧边栏漏一条 Super Agent 会话，就多一条假装是人发的对话；
 *   - 磁盘缺文件/坏 JSON 一律降级成空清单，不在启动路径上抛穿。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { listSuperAgentSessionTypes } from '../ownedSessions'
import { superAgentRouterEngineSessionId, superAgentWorkerEngineSessionId } from '../sessionId'

const REPO = 'D:/doc/AI/SpaceCode'
const TICKET = 'ticket-3f15d3c6-15e9-4847-8b9a-96c070f515a0'

let root: string | null = null

/** 造一个 `<userData>/super-agent/projects/<projectKey>/` 布局。 */
function projectDir(projectKey: string): string {
  const dir = join(root!, 'super-agent', 'projects', projectKey)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeProject(dir: string, repoRoot: string): void {
  writeFileSync(
    join(dir, 'project.json'),
    JSON.stringify({ schemaVersion: 2, projectKey: 'k', repoRoot, name: 'SpaceCode' }),
  )
}

function writeState(dir: string, tickets: Record<string, unknown>): void {
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ schemaVersion: 2, lastSeq: 1, state: { tickets } }))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sa-owned-'))
})

afterEach(() => {
  // Windows 上临时目录可能被占用；删不掉就留给系统清理，不影响断言。
  try {
    rmSync(root!, { recursive: true, maxRetries: 2 })
  } catch {
    /* ignore */
  }
  root = null
})

describe('listSuperAgentSessionTypes', () => {
  it('lists the router and every ticket worker of a project', () => {
    const dir = projectDir('55ebebd829d3f0dd')
    writeProject(dir, REPO)
    writeState(dir, { [TICKET]: { ticketId: TICKET }, 'ticket-2': { ticketId: 'ticket-2' } })

    const types = listSuperAgentSessionTypes(root!)
    expect(types.get(superAgentRouterEngineSessionId(REPO))).toBe('superAgent')
    expect(types.get(superAgentWorkerEngineSessionId(TICKET))).toBe('superAgentWorker')
    expect(types.get(superAgentWorkerEngineSessionId('ticket-2'))).toBe('superAgentWorker')
    expect(types.size).toBe(3)
  })

  it('leaves ordinary chat sessions out of the list', () => {
    const dir = projectDir('p1')
    writeProject(dir, REPO)
    writeState(dir, { [TICKET]: {} })

    expect(listSuperAgentSessionTypes(root!).has('some-human-session-uuid')).toBe(false)
  })

  it('covers several projects at once', () => {
    const first = projectDir('p1')
    writeProject(first, 'D:/repo/one')
    const second = projectDir('p2')
    writeProject(second, 'D:/repo/two')
    writeState(second, { 'ticket-a': {} })

    const types = listSuperAgentSessionTypes(root!)
    expect(types.get(superAgentRouterEngineSessionId('D:/repo/one'))).toBe('superAgent')
    expect(types.get(superAgentRouterEngineSessionId('D:/repo/two'))).toBe('superAgent')
    expect(types.get(superAgentWorkerEngineSessionId('ticket-a'))).toBe('superAgentWorker')
  })

  it('degrades to an empty list when nothing is on disk', () => {
    expect(listSuperAgentSessionTypes(join(root!, 'nope')).size).toBe(0)
    expect(listSuperAgentSessionTypes('').size).toBe(0)
  })

  it('skips a broken project without losing the healthy one', () => {
    const broken = projectDir('broken')
    writeFileSync(join(broken, 'project.json'), '{ not json')
    writeFileSync(join(broken, 'state.json'), 'null')

    const healthy = projectDir('healthy')
    writeProject(healthy, REPO)

    const types = listSuperAgentSessionTypes(root!)
    expect(types.get(superAgentRouterEngineSessionId(REPO))).toBe('superAgent')
    expect(types.size).toBe(1)
  })
})

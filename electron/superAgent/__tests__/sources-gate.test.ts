// @vitest-environment node
/**
 * Source Ingestor × 程序层 Gate（T16 #86）。
 *
 * 覆盖验收：候选判定全部走 Policy 准入表（纯程序，不调用模型）——
 * 无关来源直接落 disposition.filtered 原因码，不送 Router；
 * 名单/bot 产生 inferred 候选；默认准入与 T15 行为兼容（addressed 的人消息 → explicit）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createSuperAgentDomain, type SuperAgentDomain } from '../domain'
import { createSourceCursorStore } from '../sources/cursorStore'
import { createSourceQuarantine } from '../sources/quarantine'
import {
  createSourceIngestor,
  type SourceCandidate,
  type SourceIngestor,
} from '../sources/ingestor'
import type { ExternalSource, SourceEvent, SourcePollPage } from '../sources/types'

let roots: string[] = []
let ingestors: SourceIngestor[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function event(partial: Partial<SourceEvent> & { key: string }): SourceEvent {
  return {
    source: 'feishu-im',
    threadIds: ['feishu:thread:t1'],
    actor: 'feishu:user:u1',
    human: true,
    addressed: 'mention',
    channel: 'feishu:chat:c1',
    url: null,
    text: 'hello',
    at: '2026-01-01T00:00:00.000Z',
    meta: {},
    ...partial,
  }
}

function page(events: SourceEvent[]): SourcePollPage {
  return { events, nextCursor: null, hasMore: false, gap: false }
}

class FakeSource implements ExternalSource {
  private pages: SourcePollPage[]

  constructor(
    readonly id: string,
    pages: SourcePollPage[] = [],
  ) {
    this.pages = pages
  }

  appendPages(pages: SourcePollPage[]): void {
    this.pages.push(...pages)
  }

  async poll(): Promise<SourcePollPage> {
    return this.pages.shift() ?? page([])
  }
}

interface Harness {
  domain: SuperAgentDomain
  ingestor: SourceIngestor
  candidates: SourceCandidate[]
  ingest(events: SourceEvent[]): Promise<void>
}

function harness(admissions?: unknown): Harness {
  let counter = 0
  const domain = createSuperAgentDomain({
    now: () => new Date('2026-01-01T00:00:00Z'),
    newId: (kind: string) => `${kind}-${++counter}`,
  })
  if (admissions) {
    domain.setPolicy({
      acceptMode: 'observe',
      admissions: admissions as never,
    })
  }
  const candidates: SourceCandidate[] = []
  const source = new FakeSource('feishu-im')
  const ingestor = createSourceIngestor({
    domain,
    sources: [source],
    cursorStore: createSourceCursorStore(tempDir('sa-gate-')),
    quarantine: createSourceQuarantine(tempDir('sa-gate-')),
    onCandidate: (candidate) => candidates.push(candidate),
  })
  ingestors.push(ingestor)
  const ingest = async (events: SourceEvent[]) => {
    source.appendPages([page(events)])
    await ingestor.pollOnce('feishu-im')
  }
  return { domain, ingestor, candidates, ingest }
}

afterEach(() => {
  vi.useRealTimers()
  for (const ingestor of ingestors) ingestor.stop()
  ingestors = []
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('默认准入（未配置）', () => {
  it('emits an explicit candidate for addressed human triggers (T15-compatible)', async () => {
    const h = harness()
    await h.ingest([event({ key: 'e1', text: '@SuperAgent 帮我查' })])
    expect(h.candidates).toHaveLength(1)
    expect(h.candidates[0]).toMatchObject({
      strength: 'explicit',
      basis: 'addressed',
      bot: false,
    })
    expect(h.candidates[0].trigger.disposition.filtered).toBeNull()
  })
})

describe('scope 过滤', () => {
  it('records the out-of-scope reason and keeps the trigger out of eval candidacy', async () => {
    const h = harness([
      { source: 'feishu-im', channels: ['feishu:chat:c1'], allowlist: [], bots: [] },
    ])
    await h.ingest([event({ key: 'e1', channel: 'feishu:chat:c2' })])
    expect(h.candidates).toHaveLength(0)
    const trigger = h.domain.state.triggers['trigger-1']
    expect(trigger.disposition.filtered).toBe('out-of-scope')
    expect(h.domain.state.threads['feishu:thread:t1'].pendingTriggerIds).not.toContain(
      trigger.triggerId,
    )
  })
})

describe('名单与 bot 候选', () => {
  it('emits an inferred/admission candidate for allowlisted actors without @Agent', async () => {
    const h = harness([
      { source: 'feishu-im', channels: [], allowlist: ['feishu:user:u1'], bots: [] },
    ])
    await h.ingest([event({ key: 'e1', addressed: null })])
    expect(h.candidates).toHaveLength(1)
    expect(h.candidates[0]).toMatchObject({
      strength: 'inferred',
      basis: 'admission',
      bot: false,
    })
  })

  it('emits an inferred/bot candidate for bot actors (policy-driven candidacy)', async () => {
    const h = harness([
      { source: 'feishu-im', channels: [], allowlist: [], bots: ['feishu:bot:ci'] },
    ])
    await h.ingest([
      event({ key: 'e1', actor: 'feishu:bot:ci', human: false, addressed: null }),
    ])
    expect(h.candidates).toHaveLength(1)
    expect(h.candidates[0]).toMatchObject({
      strength: 'inferred',
      basis: 'bot',
      bot: true,
    })
  })

  it('still filters non-admitted actors even with a configured source entry', async () => {
    const h = harness([
      { source: 'feishu-im', channels: [], allowlist: ['feishu:user:u1'], bots: [] },
    ])
    await h.ingest([event({ key: 'e1', addressed: null, actor: 'feishu:user:u2' })])
    expect(h.candidates).toHaveLength(0)
    expect(h.domain.state.triggers['trigger-1'].disposition.filtered).toBe('not-admitted')
  })
})

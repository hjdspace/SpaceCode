// @vitest-environment node
/**
 * T24 #93：Source 接入 service 接线。
 *  - 未配置 Source 的项目行为与现状一致（不启动任何轮询）；
 *  - project.json 的 sources 字段是项目级配置的唯一事实来源，服务选项可覆盖；
 *  - 启用的 Source 在项目落地即启动，游标持久化跨重启续读；
 *  - 准入的人消息登记建单候选（不直接建单），不准入的不登记；
 *  - 轮询失败进入 health 的 source:<id> 类别；shutdown 停掉轮询。
 */
import { mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSuperAgentService, type SuperAgentService } from '../service'
import { PROJECT_FILE, projectDirOf, projectKeyOf } from '../store'
import { superAgentError } from '../errors'
import {
  FEISHU_IM_SOURCE_ID,
  type SuperAgentSourcesConfig,
} from '../sources/config'
import type { ExternalSource, SourcePollPage } from '../sources/types'

const REPO = mkdtempSync(join(tmpdir(), 'spacecode-sources-repo-'))
mkdirSync(REPO, { recursive: true })

const CONFIG: SuperAgentSourcesConfig = {
  enabled: [FEISHU_IM_SOURCE_ID],
  feishuIm: {
    botOpenId: 'ou_bot',
    chats: ['oc_chat'],
    pollIntervalMs: 10,
  },
}

const AT = '2026-01-01T00:00:00.000Z'

function eventOf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'feishu:message:m1',
    source: FEISHU_IM_SOURCE_ID,
    threadIds: ['feishu:thread:t1'],
    actor: 'feishu:user:u1',
    human: true,
    addressed: 'mention',
    channel: 'oc_chat',
    url: null,
    text: '请处理一下',
    at: AT,
    meta: {},
    ...overrides,
  }
}

function pageOf(events: unknown[], nextCursor: string | null = null): SourcePollPage {
  return { events, nextCursor, hasMore: false, gap: false }
}

/** 脚本化 Source：按页返回事件，记录每次读取的游标，可注入失败。 */
class ScriptedSource implements ExternalSource {
  readonly id = FEISHU_IM_SOURCE_ID
  readonly polls: Array<string | null> = []
  error: Error | null = null
  private pages: SourcePollPage[]

  constructor(pages: SourcePollPage[] = []) {
    this.pages = pages
  }

  async poll(cursor: string | null): Promise<SourcePollPage> {
    this.polls.push(cursor)
    if (this.error) throw this.error
    return this.pages.shift() ?? pageOf([], cursor)
  }
}

const services: SuperAgentService[] = []

function makeService(options: Parameters<typeof createSuperAgentService>[0]): SuperAgentService {
  const service = createSuperAgentService(options)
  services.push(service)
  return service
}

function makeUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'spacecode-sources-'))
}

async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition not met before timeout')
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.shutdownAll()))
})

describe('Source service wiring', () => {
  it('does not start any polling when the project has no source config', () => {
    const factory = vi.fn(() => [new ScriptedSource()])
    const service = makeService({ userDataDir: makeUserDataDir(), sourceFactory: factory })
    service.state(REPO)
    expect(factory).not.toHaveBeenCalled()
    expect(service.sources(REPO)).toEqual({
      repoRoot: REPO,
      sources: [],
      candidates: [],
      quarantine: [],
    })
  })

  it('persists the configured sources into project.json and reads them back', async () => {
    const userDataDir = makeUserDataDir()
    const first = makeService({
      userDataDir,
      sources: CONFIG,
      sourceFactory: () => [],
    })
    first.state(REPO)
    await first.shutdown(REPO)

    const projectDir = projectDirOf(userDataDir, projectKeyOf(REPO))
    const project = JSON.parse(readFileSync(join(projectDir, PROJECT_FILE), 'utf-8')) as {
      sources?: SuperAgentSourcesConfig
    }
    expect(project.sources).toEqual(CONFIG)

    // 第二个实例不传服务选项，仅凭 project.json 启动 Source。
    const source = new ScriptedSource()
    const factory = vi.fn(() => [source])
    const second = makeService({ userDataDir, sourceFactory: factory })
    second.state(REPO)
    expect(factory).toHaveBeenCalledTimes(1)
    await until(() => source.polls.length >= 1)
    expect(second.sources(REPO).sources[0]).toMatchObject({
      sourceId: FEISHU_IM_SOURCE_ID,
      running: true,
    })
    await second.shutdown(REPO)
  })

  it('registers an admitted human mention as a candidate without creating a ticket', async () => {
    const source = new ScriptedSource([pageOf([eventOf()])])
    const service = makeService({ userDataDir: makeUserDataDir(), sources: CONFIG, sourceFactory: () => [source] })
    service.state(REPO)
    await until(() => service.sources(REPO).candidates.length === 1)

    const candidate = service.sources(REPO).candidates[0]
    expect(candidate).toMatchObject({
      key: 'feishu:message:m1',
      reason: 'mention',
      strength: 'explicit',
      basis: 'addressed',
      bot: false,
      threadIds: ['feishu:thread:t1'],
      channel: 'oc_chat',
    })
    // 候选登记不等于建单：没有订阅消费时仍只有候选，不产生工单。
    expect(service.tickets(REPO).tickets).toEqual([])
  })

  it('does not register non-addressed messages that fail the program gate', async () => {
    const source = new ScriptedSource([pageOf([eventOf({ key: 'feishu:message:m2', addressed: null })])])
    const service = makeService({ userDataDir: makeUserDataDir(), sources: CONFIG, sourceFactory: () => [source] })
    service.state(REPO)
    await until(() => source.polls.length >= 2)
    expect(service.sources(REPO).candidates).toEqual([])
  })

  it('records a polling failure in the source:<id> health category', async () => {
    const source = new ScriptedSource()
    source.error = new Error('network down')
    const service = makeService({ userDataDir: makeUserDataDir(), sources: CONFIG, sourceFactory: () => [source] })
    service.state(REPO)
    await until(() =>
      service.health(REPO).items.some((item) => item.category === `source:${FEISHU_IM_SOURCE_ID}`),
    )
    const item = service.health(REPO).items.find(
      (entry) => entry.category === `source:${FEISHU_IM_SOURCE_ID}`,
    )
    expect(item).toMatchObject({ status: 'degraded', code: 'sourceReadFailed', consecutiveFailures: 1 })
  })

  it('records a source assembly failure as a configuration health item', () => {
    const service = makeService({
      userDataDir: makeUserDataDir(),
      sources: CONFIG,
      sourceFactory: () => {
        throw superAgentError('sourceCredentialsMissing', { source: FEISHU_IM_SOURCE_ID })
      },
    })
    service.state(REPO)
    const item = service.health(REPO).items.find((entry) => entry.category === 'source')
    expect(item).toMatchObject({ code: 'sourceCredentialsMissing' })
    expect(service.sources(REPO).sources).toEqual([])
  })

  it('stops polling on explicit shutdown', async () => {
    const source = new ScriptedSource()
    const service = makeService({ userDataDir: makeUserDataDir(), sources: CONFIG, sourceFactory: () => [source] })
    service.state(REPO)
    await until(() => source.polls.length >= 2)
    await service.shutdown(REPO)
    const settled = source.polls.length
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(source.polls.length).toBe(settled)
  })

  it('resumes from the persisted cursor after a restart', async () => {
    const userDataDir = makeUserDataDir()
    const firstSource = new ScriptedSource([pageOf([eventOf()], 'cursor-2')])
    const first = makeService({
      userDataDir,
      sources: CONFIG,
      sourceFactory: () => [firstSource],
    })
    first.state(REPO)
    await until(() => first.sources(REPO).sources[0]?.cursor === 'cursor-2')
    await first.shutdown(REPO)

    const secondSource = new ScriptedSource()
    const second = makeService({ userDataDir, sourceFactory: () => [secondSource] })
    second.state(REPO)
    await until(() => secondSource.polls.length >= 1)
    expect(secondSource.polls[0]).toBe('cursor-2')
    await second.shutdown(REPO)
  })
})

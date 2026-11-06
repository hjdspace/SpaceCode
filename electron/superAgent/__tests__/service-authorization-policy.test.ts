// @vitest-environment node
/**
 * Service 层授权策略（T25 #96）。
 *
 * 覆盖验收：
 *  - 默认保守：acceptMode=off、无规则、无准入表（外部候选默认不建单）；
 *  - 变更任一子项 version+1；相同策略幂等（不推进 version）；
 *  - 缺省子项保持原值；读回持久化后的规则/准入表；
 *  - 返回视图是深拷贝，调用方改不到领域状态；
 *  - 领域语义校验兜底：重名规则/非法准入 → invalidPolicy，且不落库。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentService } from '../service'

const REPO = 'D:/repo'

function makeService(): ReturnType<typeof createSuperAgentService> {
  return createSuperAgentService({ launcher: null })
}

describe('service authorization policy', () => {
  it('reads the conservative default policy', () => {
    const service = makeService()

    expect(service.authorizationPolicy(REPO)).toEqual({
      repoRoot: REPO,
      policy: { version: 1, acceptMode: 'off', rules: [], admissions: [] },
    })
  })

  it('increments version on change and stays idempotent for the same policy', async () => {
    const service = makeService()

    const first = await service.authorizationPolicySet(REPO, { acceptMode: 'observe' })
    expect(first.changed).toBe(true)
    expect(first.policy.version).toBe(2)
    expect(first.policy.acceptMode).toBe('observe')

    const again = await service.authorizationPolicySet(REPO, { acceptMode: 'observe' })
    expect(again.changed).toBe(false)
    expect(again.policy.version).toBe(2)
    expect(again.discardedEvalIds).toEqual([])
  })

  it('persists rules and admissions and keeps omitted sub-fields unchanged', async () => {
    const service = makeService()

    const first = await service.authorizationPolicySet(REPO, {
      acceptMode: 'auto',
      rules: [{ name: 'Scope', instruction: 'Only touch src/' }],
      admissions: [
        { source: 'feishu:ops', channels: ['c1'], allowlist: ['alice'], bots: ['bot-1'] },
      ],
    })
    expect(first.policy.version).toBe(2)
    expect(first.policy.rules).toEqual([{ name: 'Scope', instruction: 'Only touch src/' }])

    // 只改 acceptMode：规则与准入表保持原值
    const second = await service.authorizationPolicySet(REPO, { acceptMode: 'observe' })
    expect(second.changed).toBe(true)
    expect(second.policy.version).toBe(3)
    expect(service.authorizationPolicy(REPO).policy).toEqual({
      version: 3,
      acceptMode: 'observe',
      rules: [{ name: 'Scope', instruction: 'Only touch src/' }],
      admissions: [
        { source: 'feishu:ops', channels: ['c1'], allowlist: ['alice'], bots: ['bot-1'] },
      ],
    })
  })

  it('returns a detached copy so callers cannot mutate domain state', () => {
    const service = makeService()
    const view = service.authorizationPolicy(REPO)

    view.policy.rules.push({ name: 'x', instruction: 'y' })
    view.policy.admissions.push({ source: 's', channels: [], allowlist: [], bots: [] })

    expect(service.authorizationPolicy(REPO).policy).toEqual({
      version: 1,
      acceptMode: 'off',
      rules: [],
      admissions: [],
    })
  })

  it('rejects duplicate rule names via domain validation without persisting', async () => {
    const service = makeService()

    await expect(
      service.authorizationPolicySet(REPO, {
        rules: [
          { name: 'dup', instruction: 'a' },
          { name: 'dup', instruction: 'b' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalidPolicy' })

    expect(service.authorizationPolicy(REPO).policy.version).toBe(1)
  })

  it('rejects an admission entry without a source via domain validation', async () => {
    const service = makeService()

    await expect(
      service.authorizationPolicySet(REPO, {
        admissions: [{ source: ' ', channels: [], allowlist: [], bots: [] }],
      }),
    ).rejects.toMatchObject({ code: 'invalidPolicy' })

    expect(service.authorizationPolicy(REPO).policy.version).toBe(1)
  })
})

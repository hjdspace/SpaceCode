/**
 * Skill Manager V2 store — action / computed behaviour.
 *
 * Seam: the store reaches the backend only through `api.skillManagerV2`, so the
 * whole suite mocks `@/services/electronAPI` (same pattern as
 * `tests/stores/skillManagerStore.distribute.test.ts`). Every assertion is made
 * on observable store state or on the arguments / call counts reaching the api.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type {
  AddCenterSkillDecision,
  AddCenterSkillInput,
  AddCenterSkillPreview,
  AddCenterSkillResult,
  AdoptBatchItem,
  AdoptBatchResult,
  AdoptPreview,
  AgentDetail,
  AgentInventoryScanResult,
  AgentSkillInventoryAgent,
  AgentSummary,
  CopySyncPreview,
  CopySyncResult,
  CopyTargetDiffPreview,
  DeleteCenterSkillPreview,
  DeletePackPreview,
  DiagnosisIssue,
  DistributionPreview,
  DistributionResult,
  RemovePackFromAgentPreview,
  RemovePackFromAgentResult,
  SkillDetail,
  SkillManagerMetrics,
  SkillManagerOverview,
  SkillManagerSettings,
  SkillPackDetail,
  SkillPackSummary,
  SkillSummary,
  UnmanagedItemDto,
  UpsertPackInput,
} from '@/types/skillManagerV2'

const apiMocks = vi.hoisted(() => ({
  skillManagerV2: {
    bootstrap: vi.fn(),
    init: vi.fn(),
    getOverview: vi.fn(),
    refresh: vi.fn(),
    refreshAgentVersions: vi.fn(),
    updateSettings: vi.fn(),
    openPath: vi.fn(),
    getSkillDetail: vi.fn(),
    previewDeleteCenterSkill: vi.fn(),
    executeDeleteCenterSkill: vi.fn(),
    previewAddCenterSkill: vi.fn(),
    executeAddCenterSkill: vi.fn(),
    previewDistribute: vi.fn(),
    executeDistribute: vi.fn(),
    deleteTarget: vi.fn(),
    scanAgentInventory: vi.fn(),
    listAgentSkillInventory: vi.fn(),
    previewAdopt: vi.fn(),
    executeAdopt: vi.fn(),
    executeAdoptBatch: vi.fn(),
    getPackDetail: vi.fn(),
    upsertPack: vi.fn(),
    previewDeletePack: vi.fn(),
    deletePack: vi.fn(),
    previewApplyPack: vi.fn(),
    executeApplyPack: vi.fn(),
    previewRemovePackFromAgent: vi.fn(),
    executeRemovePackFromAgent: vi.fn(),
    runDiagnosis: vi.fn(),
    executeSafeFixes: vi.fn(),
    exportSnapshot: vi.fn(),
    getAgentDetail: vi.fn(),
    scanAgentDetail: vi.fn(),
    previewSyncCopy: vi.fn(),
    executeSyncCopy: vi.fn(),
    previewCopyTargetDiff: vi.fn(),
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: apiMocks }))

import { useSkillManagerStore } from '@/stores/skillManagerStore'

type Store = ReturnType<typeof useSkillManagerStore>
type SmMock = typeof apiMocks.skillManagerV2

/** Outside Electron the real getter yields null — `api.skillManagerV2` is absent. */
const NO_API = null as unknown as SmMock

// ── Fixtures ───────────────────────────────────────────────────────

const SETTINGS: SkillManagerSettings = {
  centerLibraryPath: 'D:/skills/center',
  defaultInstallMode: 'link',
  linkFailPolicy: 'copy',
  startupScan: true,
  showUnmanaged: false,
}

const METRICS: SkillManagerMetrics = {
  centerSkillCount: 4,
  agentTargetCount: 2,
  unmanagedCount: 1,
  diagnosisIssueCount: 1,
}

function skill(overrides: Partial<SkillSummary> & { id: string; name: string }): SkillSummary {
  return {
    description: '',
    skillType: 'prompt',
    centerPath: `D:/skills/center/${overrides.id}`,
    currentHash: 'hash-0',
    status: 'ok',
    sourceType: 'manual_center',
    agentBadges: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-02',
    ...overrides,
  }
}

const SKILL_ASK = skill({
  id: 'sk-0001',
  name: 'ask-matt',
  description: 'Ask Matt for a review',
  sourceType: 'manual_center',
  agentBadges: [{ agentId: 'codex', agentName: 'Codex', mode: 'link', status: 'ok' }],
})
const SKILL_TDD = skill({
  id: 'sk-0002',
  name: 'test-driven-development',
  description: 'Write the failing test first',
  status: 'conflict',
  sourceType: 'github',
  agentBadges: [{ agentId: 'claude', agentName: 'Claude Code', mode: 'copy', status: 'conflict' }],
})
const SKILL_REVIEW = skill({
  id: 'sk-0003',
  name: 'code-review',
  description: 'Standards and spec review',
  status: 'copy_outdated',
  sourceType: null,
})
const SKILL_PET = skill({
  id: 'sk-0004',
  name: 'hatch-pet',
  description: 'Spawn a spritesheet mascot',
  status: 'unmanaged',
  sourceType: 'archive',
  agentBadges: [{ agentId: 'codex', agentName: 'Codex', mode: 'copy', status: 'unmanaged' }],
})
const SKILLS: SkillSummary[] = [SKILL_ASK, SKILL_TDD, SKILL_REVIEW, SKILL_PET]

const AGENT_CODEX: AgentSummary = {
  id: 'codex',
  displayName: 'Codex',
  skillsDir: 'D:/codex/skills',
  configPath: 'D:/codex/config.toml',
  mcpConfigPath: null,
  pluginDir: null,
  version: '0.45.0',
  latestVersion: null,
  enabled: true,
  installed: true,
  lastScannedAt: null,
  managedSkillCount: 2,
  unmanagedCount: 1,
}
const AGENT_CLAUDE: AgentSummary = {
  ...AGENT_CODEX,
  id: 'claude',
  displayName: 'Claude Code',
  skillsDir: 'D:/claude/skills',
  version: null,
  installed: false,
}

const PACK_SUMMARY: SkillPackSummary = {
  id: 'pack-1',
  name: 'Inbox Zero',
  description: 'Mail triage pack',
  tags: ['mail'],
  memberCount: 2,
  appliedAgentCount: 1,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
}

const ISSUE: DiagnosisIssue = {
  id: 'iss-1',
  issueType: 'broken_link',
  severity: 'error',
  entityType: 'target',
  entityId: 't-1',
  title: '断链的 skill target',
  detail: 'link 指向不存在的中心库目录',
  fixKind: 'auto',
  payloadJson: '{}',
  createdAt: '2026-01-03',
  resolvedAt: null,
}
const ISSUE_MANUAL: DiagnosisIssue = { ...ISSUE, id: 'iss-2', fixKind: 'manual', severity: 'warning' }

const UNMANAGED: UnmanagedItemDto = {
  id: 'un-1',
  itemType: 'skill_dir',
  agentId: 'codex',
  path: 'D:/codex/skills/loose-dir',
  inferredSkillId: null,
  hash: null,
  reason: '不在中心库中',
  firstSeenAt: '2026-01-01',
  lastSeenAt: '2026-01-04',
}

function overview(overrides: Partial<SkillManagerOverview> = {}): SkillManagerOverview {
  return {
    metrics: { ...METRICS },
    settings: { ...SETTINGS },
    skills: SKILLS.map((s) => ({ ...s })),
    agents: [{ ...AGENT_CODEX }],
    packs: [{ ...PACK_SUMMARY }],
    issues: [{ ...ISSUE }],
    unmanaged: [{ ...UNMANAGED }],
    ...overrides,
  }
}

const SKILL_DETAIL: SkillDetail = {
  id: 'sk-0001',
  name: 'ask-matt',
  description: 'Ask Matt for a review',
  skillType: 'prompt',
  centerPath: 'D:/skills/center/sk-0001',
  currentHash: 'hash-0',
  frontmatterJson: '{"name":"ask-matt"}',
  source: null,
  targets: [],
  claims: [],
  files: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
  lastScannedAt: null,
}

const PACK_DETAIL: SkillPackDetail = {
  id: 'pack-1',
  name: 'Inbox Zero',
  description: 'Mail triage pack',
  tags: ['mail'],
  members: [],
  appliedAgents: [{ ...AGENT_CODEX }],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
}

const AGENT_DETAIL: AgentDetail = {
  id: 'codex',
  displayName: 'Codex',
  skillsDir: 'D:/codex/skills',
  configPath: 'D:/codex/config.toml',
  pluginDir: null,
  version: '0.45.0',
  lastScannedAt: null,
  skills: [],
  unmanaged: [{ ...UNMANAGED }],
  appliedPacks: [{ ...PACK_SUMMARY }],
  healthIssues: [{ ...ISSUE }],
  mcpServers: [],
  plugins: [],
}

const DISTRIBUTION_PREVIEW: DistributionPreview = {
  changes: [
    {
      skillId: 'sk-0001',
      skillName: 'ask-matt',
      agentId: 'codex',
      agentName: 'Codex',
      action: 'create',
      mode: 'link',
      reason: null,
    },
  ],
  blockers: [],
}
const DISTRIBUTION_RESULT: DistributionResult = {
  success: true,
  created: 1,
  reused: 0,
  failed: 0,
  errors: [],
}

const ADD_INPUT: AddCenterSkillInput = { sourcePath: 'D:/tmp/ask-matt', sourceType: 'local_folder' }
const ADD_DECISIONS: AddCenterSkillDecision[] = [{ skillId: 'sk-0001', resolution: 'create' }]
const ADD_PREVIEW: AddCenterSkillPreview = {
  candidates: [],
  blockers: [],
  unchangedCount: 0,
  centerPath: 'D:/skills/center',
}
const ADD_RESULT: AddCenterSkillResult = { skillIds: ['sk-0009'], updated: [], skipped: [] }

const DELETE_SKILL_PREVIEW: DeleteCenterSkillPreview = {
  skillId: 'sk-0001',
  skillName: 'ask-matt',
  affectedTargets: [],
}

const UPSERT_INPUT: UpsertPackInput = { name: 'Inbox Zero', memberSkillIds: ['sk-0001'], tags: ['mail'] }
const DELETE_PACK_PREVIEW: DeletePackPreview = {
  packId: 'pack-1',
  packName: 'Inbox Zero',
  appliedAgents: ['codex'],
  affectedTargets: [],
  removable: true,
  warnings: [],
}
const REMOVE_PREVIEW: RemovePackFromAgentPreview = {
  packId: 'pack-1',
  packName: 'Inbox Zero',
  agentId: 'codex',
  agentName: 'Codex',
  affectedTargets: [],
  willRemoveTargets: 1,
  willPreserveTargets: 0,
}
const REMOVE_RESULT: RemovePackFromAgentResult = {
  packId: 'pack-1',
  agentId: 'codex',
  removedClaims: 1,
  removedTargets: 1,
  preservedTargets: 0,
}

const ADOPT_PREVIEW: AdoptPreview = {
  agentId: 'codex',
  unmanagedId: 'un-1',
  inferredSkillId: 'loose-dir',
  centerHasSameName: false,
  centerSkillId: null,
  options: ['import_to_center'],
  conflictReason: null,
}
const ADOPT_ITEMS: AdoptBatchItem[] = [
  { agentId: 'codex', unmanagedId: 'un-1', option: 'import_to_center' },
  { agentId: 'codex', unmanagedId: 'un-2', option: 'skip' },
]
const ADOPT_BATCH_RESULT: AdoptBatchResult = {
  results: [{ unmanagedId: 'un-1', success: true, skillId: 'sk-0010', error: null }],
  successCount: 1,
  failureCount: 0,
}

const SCAN_RESULT: AgentInventoryScanResult = {
  agentId: 'codex',
  managed: [],
  unmanaged: [{ ...UNMANAGED }],
  conflicts: [],
}
const INVENTORY: AgentSkillInventoryAgent[] = [
  {
    agentId: 'codex',
    displayName: 'Codex',
    iconKey: 'codex',
    skillsDir: 'D:/codex/skills',
    installed: true,
    managedCount: 2,
    unmanagedCount: 1,
    readOnlyCount: 0,
    importableCount: 1,
    items: [],
  },
]

const COPY_PREVIEW: CopySyncPreview = {
  targetId: 't-1',
  skillId: 'sk-0001',
  targetPath: 'D:/codex/skills/ask-matt',
  sourceHash: 'hash-0',
  centerHash: 'hash-1',
  agentHash: 'hash-2',
  status: 'copy_outdated',
  suggested: 'center_over_agent',
}
const COPY_RESULT: CopySyncResult = {
  success: true,
  action: 'center_over_agent',
  message: '已同步',
  preview: COPY_PREVIEW,
}
const COPY_DIFF_PREVIEW: CopyTargetDiffPreview = {
  targetId: 't-1',
  skillId: 'sk-0001',
  targetPath: 'D:/codex/skills/ask-matt',
  centerPath: 'D:/skills/center/sk-0001',
  status: 'copy_modified',
  files: [],
}

const SAFE_FIX_RESULT = { fixedCount: 2, details: ['重建 link', '清理冲突标记'] }
const SNAPSHOT: Record<string, unknown> = { generatedAt: '2026-01-05', skills: 4 }

// ── Helpers ────────────────────────────────────────────────────────

const sm = apiMocks.skillManagerV2

/** The store's whole backend surface is this single object. */
function totalApiCalls(): number {
  return Object.values(sm).reduce((sum, fn) => sum + fn.mock.calls.length, 0)
}

/** Let every un-awaited background chain started by init/refresh settle. */
function flushBackground(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A promise a test can settle on demand, to observe state while an action is pending. */
function makeGate<T>() {
  let open: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    open = (value) => resolve(value)
  })
  return { promise, open }
}

async function withMissingApi(run: () => Promise<void>): Promise<void> {
  const saved = apiMocks.skillManagerV2
  apiMocks.skillManagerV2 = NO_API
  try {
    await run()
  } finally {
    apiMocks.skillManagerV2 = saved
  }
}

/**
 * 真实实现里 `api.skillManagerV2` 是个 getter（`electronAPI?.skillManagerV2 ?? null`），
 * 每次读取都可能变 null。这里让它在第 `survivingReads` 次读取之后消失，用来单独验证
 * 后台刷新器各自那句 `if (!sm) return` 守卫。
 */
async function withApiGoneAfterReads(survivingReads: number, run: () => Promise<void>): Promise<void> {
  const surface = apiMocks.skillManagerV2
  let reads = 0
  Object.defineProperty(apiMocks, 'skillManagerV2', {
    configurable: true,
    get() {
      reads += 1
      return reads <= survivingReads ? surface : null
    },
  })
  try {
    await run()
  } finally {
    Object.defineProperty(apiMocks, 'skillManagerV2', {
      configurable: true,
      writable: true,
      value: surface,
    })
  }
}

/** Fresh store with overview already loaded and getOverview's call count zeroed. */
async function seed(overrides: Partial<SkillManagerOverview> = {}): Promise<Store> {
  const store = useSkillManagerStore()
  sm.getOverview.mockResolvedValue(overview(overrides))
  await store.loadOverview()
  sm.getOverview.mockClear()
  return store
}

const filteredIds = (store: Store): string[] => store.filteredSkills.map((s) => s.id)

const BOOM = new Error('action boom')
const PREVIEW_BOOM = new Error('preview boom')

beforeEach(() => {
  setActivePinia(createPinia())
  Object.values(sm).forEach((fn) => fn.mockReset())
  // Sane defaults so the un-awaited background chains started by `init` never
  // reject behind a test's back with "cannot read .then of undefined".
  sm.bootstrap.mockResolvedValue({ success: true })
  sm.init.mockResolvedValue(overview())
  sm.getOverview.mockResolvedValue(overview())
  sm.refresh.mockResolvedValue(overview())
  sm.refreshAgentVersions.mockResolvedValue([{ ...AGENT_CODEX }, { ...AGENT_CLAUDE }])
  sm.listAgentSkillInventory.mockResolvedValue([{ ...INVENTORY[0] }])
})

// ── Computed ───────────────────────────────────────────────────────

describe('派生 getters 与 overview 的联动', () => {
  it('overview 为空时 getters 退化为空数组 / null', () => {
    const store = useSkillManagerStore()
    expect(store.skills).toEqual([])
    expect(store.agents).toEqual([])
    expect(store.packs).toEqual([])
    expect(store.issues).toEqual([])
    expect(store.unmanaged).toEqual([])
    expect(store.metrics).toBeNull()
  })

  it('loadOverview 后每个 getter 都指向 DTO 的对应字段', async () => {
    const store = await seed()
    expect(store.skills.map((s) => s.id)).toEqual(['sk-0001', 'sk-0002', 'sk-0003', 'sk-0004'])
    expect(store.agents.map((a) => a.id)).toEqual(['codex'])
    expect(store.packs.map((p) => p.id)).toEqual(['pack-1'])
    expect(store.issues.map((i) => i.id)).toEqual(['iss-1'])
    expect(store.unmanaged.map((u) => u.id)).toEqual(['un-1'])
    expect(store.metrics).toEqual(METRICS)
    expect(store.settings).toEqual(SETTINGS)
  })

  it('overview 变化后 getters 立即跟进', async () => {
    const store = await seed()
    sm.getOverview.mockResolvedValueOnce(
      overview({
        skills: [],
        agents: [{ ...AGENT_CLAUDE }],
        metrics: { ...METRICS, centerSkillCount: 0 },
      }),
    )
    await store.loadOverview()

    expect(store.skills).toHaveLength(0)
    expect(store.agents.map((a) => a.id)).toEqual(['claude'])
    expect(store.metrics).toEqual({ ...METRICS, centerSkillCount: 0 })
  })
})

describe('filteredSkills 过滤语义', () => {
  it('无筛选条件时返回全量且保持 DTO 顺序', async () => {
    const store = await seed()
    expect(filteredIds(store)).toEqual(['sk-0001', 'sk-0002', 'sk-0003', 'sk-0004'])
  })

  it('overview 为空时返回空数组', () => {
    const store = useSkillManagerStore()
    expect(store.filteredSkills).toEqual([])
  })

  it('搜索词大小写不敏感并命中 name', async () => {
    const store = await seed()
    store.setSearchQuery('ASK')
    expect(filteredIds(store)).toEqual(['sk-0001'])
  })

  it('搜索词命中 description 时按原顺序返回多条', async () => {
    const store = await seed()
    // 'review' 同时出现在 ask-matt 的 description 与 code-review 的 name 中
    store.setSearchQuery('review')
    expect(filteredIds(store)).toEqual(['sk-0001', 'sk-0003'])
  })

  it('搜索词命中 sourceType', async () => {
    const store = await seed()
    store.setSearchQuery('github')
    expect(filteredIds(store)).toEqual(['sk-0002'])
  })

  it('搜索词命中 agentBadges 的 agentName 并保持顺序', async () => {
    const store = await seed()
    store.setSearchQuery('codex')
    expect(filteredIds(store)).toEqual(['sk-0001', 'sk-0004'])
  })

  it('搜索不覆盖 id 字段', async () => {
    const store = await seed()
    store.setSearchQuery('sk-0003')
    expect(store.filteredSkills).toHaveLength(0)
  })

  it('sourceType 为 null 的 skill 参与搜索不抛错', async () => {
    const store = await seed()
    store.setSearchQuery('standards')
    expect(filteredIds(store)).toEqual(['sk-0003'])
  })

  it('搜索词首尾空格会被裁掉', async () => {
    const store = await seed()
    store.setSearchQuery('  CODE-REVIEW  ')
    expect(filteredIds(store)).toEqual(['sk-0003'])
  })

  it('纯空白搜索词等价于无筛选', async () => {
    const store = await seed()
    store.setSearchQuery('   ')
    expect(filteredIds(store)).toEqual(['sk-0001', 'sk-0002', 'sk-0003', 'sk-0004'])
  })

  it('status 筛选是精确匹配，清空后恢复全量', async () => {
    const store = await seed()
    store.setStatusFilter('conflict')
    expect(filteredIds(store)).toEqual(['sk-0002'])

    store.setStatusFilter('OK')
    expect(store.filteredSkills).toHaveLength(0)

    store.setStatusFilter(null)
    expect(filteredIds(store)).toEqual(['sk-0001', 'sk-0002', 'sk-0003', 'sk-0004'])
  })

  it('source 筛选为 null 表示不过滤，而不是筛 sourceType === null', async () => {
    const store = await seed()
    store.setSourceFilter('manual_center')
    expect(filteredIds(store)).toEqual(['sk-0001'])

    store.setSourceFilter(null)
    expect(filteredIds(store)).toEqual(['sk-0001', 'sk-0002', 'sk-0003', 'sk-0004'])
  })

  it('source 筛选精确命中 sourceType', async () => {
    const store = await seed()
    store.setSourceFilter('archive')
    expect(filteredIds(store)).toEqual(['sk-0004'])
  })

  it('多个筛选条件之间是「与」关系', async () => {
    const store = await seed()
    store.setSearchQuery('a')
    store.setStatusFilter('unmanaged')
    store.setSourceFilter('archive')
    expect(filteredIds(store)).toEqual(['sk-0004'])

    store.setStatusFilter('conflict')
    expect(store.filteredSkills).toHaveLength(0)
  })

  it('直接改写 filters 同样驱动 filteredSkills', async () => {
    const store = await seed()
    store.filters.searchQuery = 'mascot'
    expect(filteredIds(store)).toEqual(['sk-0004'])
  })
})

describe('筛选器 setter', () => {
  it('setTab / setViewMode 写入状态', () => {
    const store = useSkillManagerStore()
    expect(store.activeTab).toBe('library')
    expect(store.viewMode).toBe('cards')

    store.setTab('diagnostics')
    store.setViewMode('list')
    expect(store.activeTab).toBe('diagnostics')
    expect(store.viewMode).toBe('list')
  })

  it('三个筛选 setter 各自写入 filters 的对应字段', () => {
    const store = useSkillManagerStore()
    store.setSearchQuery('matt')
    store.setStatusFilter('ok')
    store.setSourceFilter('github')
    expect(store.filters).toEqual({ searchQuery: 'matt', statusFilter: 'ok', sourceFilter: 'github' })
  })

  it('resetFilters 回到默认值但保留 tab / viewMode', () => {
    const store = useSkillManagerStore()
    store.setTab('packs')
    store.setViewMode('list')
    store.setSearchQuery('matt')
    store.setStatusFilter('ok')
    store.setSourceFilter('github')

    store.resetFilters()

    expect(store.filters).toEqual({ searchQuery: '', statusFilter: null, sourceFilter: null })
    expect(store.activeTab).toBe('packs')
    expect(store.viewMode).toBe('list')
  })

  it('resetFilters 之后 filteredSkills 恢复全量', async () => {
    const store = await seed()
    store.setStatusFilter('ok')
    expect(store.filteredSkills).toHaveLength(1)

    store.resetFilters()
    expect(filteredIds(store)).toEqual(['sk-0001', 'sk-0002', 'sk-0003', 'sk-0004'])
  })
})

// ── init / loadOverview / refresh ──────────────────────────────────

describe('init', () => {
  it('按 bootstrap → init → getOverview 的顺序初始化并置位 initialized', async () => {
    const store = useSkillManagerStore()
    await store.init()
    await flushBackground()

    expect(sm.bootstrap).toHaveBeenCalledTimes(1)
    expect(sm.init).toHaveBeenCalledTimes(1)
    expect(store.overview).not.toBeNull()
    expect(store.settings).toEqual(SETTINGS)
    expect(store.initialized).toBe(true)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('sm.init() 的返回值被丢弃，overview 只来自 getOverview()', async () => {
    const store = useSkillManagerStore()
    sm.init.mockResolvedValue(overview({ skills: [] }))

    await store.init()

    expect(store.skills).toHaveLength(4)
    expect(sm.getOverview.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('initialized 之后重复调用不再发 IPC', async () => {
    const store = useSkillManagerStore()
    await store.init()
    await flushBackground()
    const before = totalApiCalls()

    await store.init()
    await flushBackground()

    expect(totalApiCalls()).toBe(before)
  })

  it('force=true 时重新走完整初始化', async () => {
    const store = useSkillManagerStore()
    await store.init()
    await flushBackground()
    sm.bootstrap.mockClear()

    await store.init(true)

    expect(sm.bootstrap).toHaveBeenCalledTimes(1)
  })

  it('api 缺失时写入固定文案并留在未初始化状态', async () => {
    await withMissingApi(async () => {
      const store = useSkillManagerStore()
      await store.init()

      expect(store.error).toBe('Skill Manager V2 API not available')
      expect(store.initialized).toBe(false)
      expect(store.loading).toBe(false)
      expect(totalApiCalls()).toBe(0)
    })
  })

  it('bootstrap 抛错时记录 message、复位 loading、不置位 initialized', async () => {
    const store = useSkillManagerStore()
    sm.bootstrap.mockRejectedValue(new Error('bootstrap failed'))

    await store.init()

    expect(store.error).toBe('bootstrap failed')
    expect(store.initialized).toBe(false)
    expect(store.loading).toBe(false)
  })

  it('非 Error 抛出时用 String() 兜底', async () => {
    const store = useSkillManagerStore()
    sm.init.mockRejectedValue('plain string')

    await store.init()

    expect(store.error).toBe('plain string')
  })

  it('loadOverview 失败被吞掉：init 仍标记 initialized', async () => {
    const store = useSkillManagerStore()
    sm.getOverview.mockRejectedValue(new Error('overview unavailable'))

    await store.init()

    expect(store.error).toBe('overview unavailable')
    expect(store.initialized).toBe(true)
    expect(store.overview).toBeNull()
    expect(store.loading).toBe(false)
  })
})

describe('loadOverview', () => {
  it('成功后写入 overview 与 DTO 内的 settings', async () => {
    const store = useSkillManagerStore()
    sm.getOverview.mockResolvedValue(
      overview({ settings: { ...SETTINGS, centerLibraryPath: 'E:/other/center' } }),
    )

    await store.loadOverview()

    expect(store.settings).toEqual({ ...SETTINGS, centerLibraryPath: 'E:/other/center' })
    expect(store.error).toBeNull()
  })

  it('失败时写入 error 且保留旧 overview', async () => {
    const store = await seed()
    sm.getOverview.mockRejectedValueOnce(new Error('ipc down'))

    await store.loadOverview()

    expect(store.error).toBe('ipc down')
    expect(store.skills).toHaveLength(4)
  })

  it('非 Error 拒绝时用 String() 兜底', async () => {
    const store = useSkillManagerStore()
    sm.getOverview.mockRejectedValue(404)

    await store.loadOverview()

    expect(store.error).toBe('404')
  })
})

describe('refresh', () => {
  it('用 refresh() 的返回值覆盖 overview 并结束 loading', async () => {
    const store = await seed()
    sm.refresh.mockResolvedValueOnce(
      overview({ skills: [SKILL_PET], metrics: { ...METRICS, centerSkillCount: 1 } }),
    )

    await store.refresh()
    await flushBackground()

    expect(store.metrics).toEqual({ ...METRICS, centerSkillCount: 1 })
    expect(store.settings).toEqual(SETTINGS)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('只补拉 agent 版本，不触发后台 inventory 全量扫描', async () => {
    const store = await seed()
    sm.refreshAgentVersions.mockResolvedValueOnce([{ ...AGENT_CODEX, version: '9.9.9' }])

    await store.refresh()
    await flushBackground()

    expect(sm.refreshAgentVersions).toHaveBeenCalledTimes(1)
    expect(sm.listAgentSkillInventory).not.toHaveBeenCalled()
    expect(store.agents.map((a) => [a.id, a.version])).toEqual([['codex', '9.9.9']])
  })

  it('失败时写入 error、复位 loading 且保留旧 overview', async () => {
    const store = await seed()
    sm.refresh.mockRejectedValueOnce(new Error('scan crashed'))

    await store.refresh()

    expect(store.error).toBe('scan crashed')
    expect(store.loading).toBe(false)
    expect(store.skills).toHaveLength(4)
    expect(sm.refreshAgentVersions).not.toHaveBeenCalled()
  })

  it('api 缺失时提前返回，不进入 loading', async () => {
    await withMissingApi(async () => {
      const store = useSkillManagerStore()
      await store.refresh()

      expect(store.loading).toBe(false)
      expect(store.error).toBeNull()
    })
  })

  it('refresh 抛出非 Error 时 error 走 String() 兜底', async () => {
    const store = await seed()
    sm.refresh.mockRejectedValue('refresh unavailable')

    await store.refresh()

    expect(store.error).toBe('refresh unavailable')
    expect(store.loading).toBe(false)
  })
})

// ── 后台刷新 ───────────────────────────────────────────────────────

describe('后台刷新（经由 init / refresh 触发）', () => {
  it('init 结束后链式重拉 overview 与 agent inventory', async () => {
    const store = useSkillManagerStore()
    await store.init()
    await flushBackground()

    expect(sm.refresh).toHaveBeenCalledTimes(1)
    expect(sm.getOverview).toHaveBeenCalledTimes(2)
    expect(sm.listAgentSkillInventory).toHaveBeenCalledTimes(1)
    expect(store.agentInventory.map((a) => a.agentId)).toEqual(['codex'])
    expect(store.agentInventoryLoading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('agent 版本探测成功后替换 overview.agents，其余字段保留', async () => {
    const store = await seed()
    sm.refresh.mockResolvedValueOnce(overview({ skills: [SKILL_ASK] }))
    sm.refreshAgentVersions.mockResolvedValueOnce([{ ...AGENT_CLAUDE }])

    await store.refresh()
    await flushBackground()

    expect(store.agents.map((a) => a.id)).toEqual(['claude'])
    expect(store.skills).toHaveLength(1)
  })

  it('版本探测失败被吞掉，不污染 error 也不改 overview', async () => {
    const store = await seed()
    sm.refreshAgentVersions.mockRejectedValueOnce(new Error('npm 超时'))

    await store.refresh()
    await flushBackground()

    expect(store.error).toBeNull()
    expect(store.agents.map((a) => a.id)).toEqual(['codex'])
  })

  it('overview 仍为 null 时版本探测结果被丢弃', async () => {
    const store = useSkillManagerStore()
    sm.getOverview.mockRejectedValue(new Error('overview unavailable'))

    await store.init()
    await flushBackground()

    expect(store.overview).toBeNull()
    expect(store.agents).toEqual([])
  })

  it('refreshAgentInventoryInBackground 的 refresh 失败被吞掉，不再重拉 overview', async () => {
    const store = useSkillManagerStore()
    sm.refresh.mockRejectedValue(new Error('scan failed'))

    await store.init()
    await flushBackground()

    expect(store.error).toBeNull()
    expect(sm.getOverview).toHaveBeenCalledTimes(1)
    expect(sm.listAgentSkillInventory).not.toHaveBeenCalled()
    expect(store.agentInventory).toEqual([])
  })

  it('后台 loadAgentInventory 失败仍会写入 error', async () => {
    const store = useSkillManagerStore()
    sm.listAgentSkillInventory.mockRejectedValue(new Error('inventory boom'))

    await store.init()
    await flushBackground()

    expect(store.error).toBe('inventory boom')
    expect(store.agentInventory).toEqual([])
  })

  it('后台链路末尾的 loadAgentInventory 成功会抹掉此前 loadOverview 写入的 error', async () => {
    const store = useSkillManagerStore()
    sm.getOverview
      .mockResolvedValueOnce(overview())
      .mockRejectedValueOnce(new Error('second pull failed'))
    sm.listAgentSkillInventory.mockResolvedValue(INVENTORY)

    await store.init()
    await flushBackground()

    // loadAgentInventory 起手就写 error = null
    expect(store.error).toBeNull()
    expect(store.agentInventory.map((a) => a.agentId)).toEqual(['codex'])
  })

  it('后台版本探测与后台全量扫描各自只跑一次（经由一次 init）', async () => {
    const store = useSkillManagerStore()
    await store.init()
    await flushBackground()

    expect(sm.refreshAgentVersions).toHaveBeenCalledTimes(1)
    expect(sm.refresh).toHaveBeenCalledTimes(1)
  })

  it('refresh 主流程结束后 api 消失时，后台版本探测跳过且不发 IPC', async () => {
    const store = await seed()

    await withApiGoneAfterReads(1, async () => {
      await store.refresh()
    })
    await flushBackground()

    expect(sm.refresh).toHaveBeenCalledTimes(1)
    expect(sm.refreshAgentVersions).not.toHaveBeenCalled()
    expect(store.overview).not.toBeNull()
    expect(store.error).toBeNull()
  })

  it('init 主流程结束后 api 消失时，后台全量扫描跳过且不发 IPC', async () => {
    const store = useSkillManagerStore()

    await withApiGoneAfterReads(3, async () => {
      await store.init()
    })
    await flushBackground()

    expect(store.initialized).toBe(true)
    expect(store.error).toBeNull()
    expect(store.loading).toBe(false)
    expect(sm.bootstrap).toHaveBeenCalledTimes(1)
    expect(sm.getOverview).toHaveBeenCalledTimes(1)
    expect(sm.refreshAgentVersions).toHaveBeenCalledTimes(1)
    expect(sm.refresh).not.toHaveBeenCalled()
    expect(sm.listAgentSkillInventory).not.toHaveBeenCalled()
  })
})

// ── 写操作 ─────────────────────────────────────────────────────────

interface WriteCase {
  label: string
  busy: string
  /**
   * 该 action 的主 api 调用名。所有 mock 都是未标注的 `vi.fn()`，形状一致，
   * 所以可以按名字取出来统一 arm / gate / fail。
   */
  primary: keyof SmMock
  /** action 还会顺带调用的其他 api，需要先给出返回值。 */
  armExtra?: () => void
  invoke: (store: Store) => Promise<unknown>
  /** 主调用被安排成的返回值 */
  armValue: unknown
  /** action 应当回传给调用方的值 */
  returned: unknown
  failureReturn: null | undefined
  assertCall: () => void
  afterSuccess?: (store: Store) => void
}

const WRITE_CASES: WriteCase[] = [
  {
    label: 'executeDeleteSkill',
    busy: 'delete-skill',
    primary: 'executeDeleteCenterSkill',
    invoke: (s) => s.executeDeleteSkill('sk-0001'),
    armValue: undefined,
    returned: undefined,
    failureReturn: undefined,
    assertCall: () => expect(sm.executeDeleteCenterSkill).toHaveBeenCalledWith('sk-0001'),
  },
  {
    label: 'executeAddCenterSkill',
    busy: 'import-skill',
    primary: 'executeAddCenterSkill',
    invoke: (s) => s.executeAddCenterSkill(ADD_INPUT, ADD_DECISIONS),
    armValue: ADD_RESULT,
    returned: ADD_RESULT,
    failureReturn: null,
    assertCall: () => expect(sm.executeAddCenterSkill).toHaveBeenCalledWith(ADD_INPUT, ADD_DECISIONS),
  },
  {
    label: 'executeDistribute',
    busy: 'distribute',
    primary: 'executeDistribute',
    invoke: (s) => s.executeDistribute(DISTRIBUTION_PREVIEW),
    armValue: DISTRIBUTION_RESULT,
    returned: DISTRIBUTION_RESULT,
    failureReturn: null,
    assertCall: () => expect(sm.executeDistribute).toHaveBeenCalledWith(DISTRIBUTION_PREVIEW),
    afterSuccess: () => {
      // 传给 IPC 的是 JSON 往返后的新对象，而不是入参本身
      const sent = sm.executeDistribute.mock.calls[0]?.[0]
      expect(sent).not.toBe(DISTRIBUTION_PREVIEW)
      expect(sent).toEqual(DISTRIBUTION_PREVIEW)
    },
  },
  {
    label: 'deleteTarget',
    busy: 'delete-target',
    primary: 'deleteTarget',
    invoke: (s) => s.deleteTarget('t-1'),
    armValue: undefined,
    returned: undefined,
    failureReturn: undefined,
    assertCall: () => expect(sm.deleteTarget).toHaveBeenCalledWith('t-1'),
  },
  {
    label: 'scanAgentInventory',
    busy: 'scan-agent',
    primary: 'scanAgentInventory',
    invoke: (s) => s.scanAgentInventory('codex'),
    armValue: SCAN_RESULT,
    returned: SCAN_RESULT,
    failureReturn: null,
    assertCall: () => expect(sm.scanAgentInventory).toHaveBeenCalledWith('codex'),
  },
  {
    label: 'executeAdopt',
    busy: 'adopt',
    primary: 'executeAdopt',
    invoke: (s) => s.executeAdopt('codex', 'un-1', 'import_to_center'),
    armValue: undefined,
    returned: undefined,
    failureReturn: undefined,
    assertCall: () =>
      expect(sm.executeAdopt).toHaveBeenCalledWith('codex', 'un-1', 'import_to_center', undefined),
  },
  {
    label: 'executeAdoptBatch',
    busy: 'adopt-batch',
    primary: 'executeAdoptBatch',
    invoke: (s) => s.executeAdoptBatch(ADOPT_ITEMS),
    armValue: ADOPT_BATCH_RESULT,
    returned: ADOPT_BATCH_RESULT,
    failureReturn: null,
    assertCall: () => expect(sm.executeAdoptBatch).toHaveBeenCalledWith(ADOPT_ITEMS),
    // 与 previewDistribute 不同，这里没有解包，入参数组原样透传给 IPC
    afterSuccess: () => expect(sm.executeAdoptBatch.mock.calls[0]?.[0]).toBe(ADOPT_ITEMS),
  },
  {
    label: 'upsertPack',
    busy: 'upsert-pack',
    primary: 'upsertPack',
    invoke: (s) => s.upsertPack(UPSERT_INPUT),
    armValue: PACK_DETAIL,
    returned: PACK_DETAIL,
    failureReturn: null,
    assertCall: () => expect(sm.upsertPack).toHaveBeenCalledWith(UPSERT_INPUT),
  },
  {
    label: 'deletePack',
    busy: 'delete-pack',
    primary: 'deletePack',
    invoke: (s) => s.deletePack('pack-1'),
    armValue: undefined,
    returned: undefined,
    failureReturn: undefined,
    assertCall: () => expect(sm.deletePack).toHaveBeenCalledWith('pack-1'),
  },
  {
    label: 'executeApplyPack',
    busy: 'apply-pack',
    primary: 'executeApplyPack',
    invoke: (s) => s.executeApplyPack('pack-1', ['codex'], 'copy'),
    armValue: DISTRIBUTION_RESULT,
    returned: DISTRIBUTION_RESULT,
    failureReturn: null,
    assertCall: () => expect(sm.executeApplyPack).toHaveBeenCalledWith('pack-1', ['codex'], 'copy'),
  },
  {
    label: 'removePackFromAgent',
    busy: 'remove-pack',
    primary: 'executeRemovePackFromAgent',
    invoke: (s) => s.removePackFromAgent('pack-1', 'codex'),
    armValue: REMOVE_RESULT,
    returned: REMOVE_RESULT,
    failureReturn: null,
    assertCall: () => expect(sm.executeRemovePackFromAgent).toHaveBeenCalledWith('pack-1', 'codex'),
  },
  {
    label: 'executeSafeFixes',
    busy: 'safe-fixes',
    primary: 'executeSafeFixes',
    armExtra: () => sm.runDiagnosis.mockResolvedValue([ISSUE_MANUAL]),
    invoke: (s) => s.executeSafeFixes(),
    armValue: SAFE_FIX_RESULT,
    returned: undefined,
    failureReturn: undefined,
    assertCall: () => {
      expect(sm.executeSafeFixes).toHaveBeenCalledTimes(1)
      expect(sm.runDiagnosis).toHaveBeenCalledTimes(1)
    },
    afterSuccess: (s) => {
      expect(s.safeFixResult).toEqual(SAFE_FIX_RESULT)
      expect(s.diagnosisIssues.map((i) => i.id)).toEqual(['iss-2'])
    },
  },
  {
    label: 'scanAgentDetail',
    busy: 'scan-agent-detail',
    primary: 'scanAgentDetail',
    invoke: (s) => s.scanAgentDetail('codex'),
    armValue: AGENT_DETAIL,
    returned: undefined,
    failureReturn: undefined,
    assertCall: () => expect(sm.scanAgentDetail).toHaveBeenCalledWith('codex'),
    afterSuccess: (s) => expect(s.selectedAgentDetail).toEqual(AGENT_DETAIL),
  },
  {
    label: 'executeSyncCopy',
    busy: 'sync-copy',
    primary: 'executeSyncCopy',
    invoke: (s) => s.executeSyncCopy('t-1', 'center_over_agent'),
    armValue: COPY_RESULT,
    returned: COPY_RESULT,
    failureReturn: null,
    assertCall: () => expect(sm.executeSyncCopy).toHaveBeenCalledWith('t-1', 'center_over_agent'),
  },
]

describe('写操作：busyAction / overview 重拉 / 返回值', () => {
  it.each(WRITE_CASES)('$label 成功后清空 busyAction 并重拉 overview', async (entry) => {
    const store = await seed()
    sm.getOverview.mockResolvedValueOnce(overview({ skills: [] }))
    sm[entry.primary].mockResolvedValue(entry.armValue)
    entry.armExtra?.()

    const returned = await entry.invoke(store)

    expect(returned).toBe(entry.returned)
    expect(store.busyAction).toBeNull()
    expect(store.error).toBeNull()
    // 第二次 getOverview 请求确实发生，且其返回值被采纳
    expect(sm.getOverview).toHaveBeenCalledTimes(1)
    expect(store.skills).toHaveLength(0)
    entry.assertCall()
    entry.afterSuccess?.(store)
  })

  it.each(WRITE_CASES)('$label 失败时 finally 仍清空 busyAction', async (entry) => {
    const store = await seed()
    sm[entry.primary].mockRejectedValue(BOOM)

    const returned = await entry.invoke(store)

    expect(returned).toBe(entry.failureReturn)
    expect(store.busyAction).toBeNull()
    expect(store.error).toBe('action boom')
    expect(sm.getOverview).not.toHaveBeenCalled()
  })

  it.each(WRITE_CASES)('$label 抛出非 Error 时 error 走 String() 兜底', async (entry) => {
    const store = await seed()
    sm[entry.primary].mockRejectedValue(`plain-${entry.label}`)

    await entry.invoke(store)

    expect(store.error).toBe(`plain-${entry.label}`)
    expect(store.busyAction).toBeNull()
    expect(sm.getOverview).not.toHaveBeenCalled()
  })

  it.each(WRITE_CASES)('$label 执行期间 busyAction 为 $busy', async (entry) => {
    const store = await seed()
    const gate = makeGate<unknown>()
    sm[entry.primary].mockImplementation(() => gate.promise as never)
    entry.armExtra?.()

    const pending = entry.invoke(store)
    expect(store.busyAction).toBe(entry.busy)

    gate.open(entry.armValue)
    await pending
    expect(store.busyAction).toBeNull()
  })

  it('executeDeleteSkill 成功后连带清空选中的 skill', async () => {
    const store = await seed()
    sm.getSkillDetail.mockResolvedValue(SKILL_DETAIL)
    await store.loadSkillDetail('sk-0001')
    expect(store.selectedSkillId).toBe('sk-0001')
    sm.executeDeleteCenterSkill.mockResolvedValue(undefined)

    await store.executeDeleteSkill('sk-0001')

    expect(store.selectedSkillId).toBeNull()
    expect(store.selectedSkillDetail).toBeNull()
  })

  it('deletePack 成功后连带清空选中的 pack detail', async () => {
    const store = await seed()
    sm.getPackDetail.mockResolvedValue(PACK_DETAIL)
    await store.loadPackDetail('pack-1')
    expect(store.selectedPackDetail).not.toBeNull()
    sm.deletePack.mockResolvedValue(undefined)

    await store.deletePack('pack-1')

    expect(store.selectedPackDetail).toBeNull()
  })

  it('executeAdopt 传入 renamedId 时透传给 IPC', async () => {
    const store = await seed()
    sm.executeAdopt.mockResolvedValue(undefined)

    await store.executeAdopt('codex', 'un-1', 'rename', 'loose-renamed')

    expect(sm.executeAdopt).toHaveBeenCalledWith('codex', 'un-1', 'rename', 'loose-renamed')
  })

  it('scanAgentInventory 传 refreshOverview=false 时不重拉 overview', async () => {
    const store = await seed()
    sm.scanAgentInventory.mockResolvedValue(SCAN_RESULT)

    const result = await store.scanAgentInventory('codex', false)

    expect(result).toBe(SCAN_RESULT)
    expect(sm.scanAgentInventory).toHaveBeenCalledWith('codex')
    expect(sm.getOverview).not.toHaveBeenCalled()
    expect(store.busyAction).toBeNull()
  })

  it('previewDistribute 解包 reactive 数组，pack/batch 系列则原样透传', async () => {
    const store = await seed()
    const skillIds = reactive(['sk-0001', 'sk-0002'])
    const agentIds = reactive(['codex'])
    sm.previewDistribute.mockResolvedValue(DISTRIBUTION_PREVIEW)

    await store.previewDistribute(skillIds, agentIds, 'link')

    const sent = sm.previewDistribute.mock.calls[0]
    expect(sent?.[0]).toEqual(['sk-0001', 'sk-0002'])
    expect(sent?.[0]).not.toBe(skillIds)
    expect(sent?.[1]).not.toBe(agentIds)
    expect(sent?.[2]).toBe('link')

    const packAgentIds = reactive(['codex'])
    sm.previewApplyPack.mockResolvedValue(DISTRIBUTION_PREVIEW)
    await store.previewApplyPack('pack-1', packAgentIds, 'link')
    expect(sm.previewApplyPack.mock.calls[0]?.[1]).toBe(packAgentIds)
  })
})

// ── 预览 / 只读操作 ────────────────────────────────────────────────

interface PreviewCase {
  label: string
  primary: keyof SmMock
  invoke: (store: Store) => Promise<unknown>
  armValue: unknown
  assertCall: () => void
}

const PREVIEW_CASES: PreviewCase[] = [
  {
    label: 'previewAddCenterSkill',
    primary: 'previewAddCenterSkill',
    invoke: (s) => s.previewAddCenterSkill(ADD_INPUT),
    armValue: ADD_PREVIEW,
    assertCall: () => expect(sm.previewAddCenterSkill).toHaveBeenCalledWith(ADD_INPUT),
  },
  {
    label: 'previewDistribute',
    primary: 'previewDistribute',
    invoke: (s) => s.previewDistribute(['sk-0001'], ['codex'], 'link'),
    armValue: DISTRIBUTION_PREVIEW,
    assertCall: () => expect(sm.previewDistribute).toHaveBeenCalledWith(['sk-0001'], ['codex'], 'link'),
  },
  {
    label: 'previewAdopt',
    primary: 'previewAdopt',
    invoke: (s) => s.previewAdopt('codex', 'un-1'),
    armValue: ADOPT_PREVIEW,
    assertCall: () => expect(sm.previewAdopt).toHaveBeenCalledWith('codex', 'un-1'),
  },
  {
    label: 'previewDeletePack',
    primary: 'previewDeletePack',
    invoke: (s) => s.previewDeletePack('pack-1'),
    armValue: DELETE_PACK_PREVIEW,
    assertCall: () => expect(sm.previewDeletePack).toHaveBeenCalledWith('pack-1'),
  },
  {
    label: 'previewApplyPack',
    primary: 'previewApplyPack',
    invoke: (s) => s.previewApplyPack('pack-1', ['codex'], 'link'),
    armValue: DISTRIBUTION_PREVIEW,
    assertCall: () => expect(sm.previewApplyPack).toHaveBeenCalledWith('pack-1', ['codex'], 'link'),
  },
  {
    label: 'previewRemovePackFromAgent',
    primary: 'previewRemovePackFromAgent',
    invoke: (s) => s.previewRemovePackFromAgent('pack-1', 'codex'),
    armValue: REMOVE_PREVIEW,
    assertCall: () => expect(sm.previewRemovePackFromAgent).toHaveBeenCalledWith('pack-1', 'codex'),
  },
  {
    label: 'previewSyncCopy',
    primary: 'previewSyncCopy',
    invoke: (s) => s.previewSyncCopy('t-1'),
    armValue: COPY_PREVIEW,
    assertCall: () => expect(sm.previewSyncCopy).toHaveBeenCalledWith('t-1'),
  },
  {
    label: 'previewCopyTargetDiff',
    primary: 'previewCopyTargetDiff',
    invoke: (s) => s.previewCopyTargetDiff('t-1'),
    armValue: COPY_DIFF_PREVIEW,
    assertCall: () => expect(sm.previewCopyTargetDiff).toHaveBeenCalledWith('t-1'),
  },
  {
    label: 'exportSnapshot',
    primary: 'exportSnapshot',
    invoke: (s) => s.exportSnapshot(),
    armValue: SNAPSHOT,
    assertCall: () => expect(sm.exportSnapshot).toHaveBeenCalledTimes(1),
  },
]

describe('预览 / 只读操作', () => {
  it.each(PREVIEW_CASES)('$label 成功时原样返回 api 结果且不重拉 overview', async (entry) => {
    const store = await seed()
    sm[entry.primary].mockResolvedValue(entry.armValue)

    const returned = await entry.invoke(store)

    expect(returned).toBe(entry.armValue)
    expect(store.error).toBeNull()
    expect(store.busyAction).toBeNull()
    expect(sm.getOverview).not.toHaveBeenCalled()
    entry.assertCall()
  })

  it.each(PREVIEW_CASES)('$label 失败时返回 null 并写入 error', async (entry) => {
    const store = await seed()
    sm[entry.primary].mockRejectedValue(PREVIEW_BOOM)

    expect(await entry.invoke(store)).toBeNull()
    expect(store.error).toBe('preview boom')
    expect(store.busyAction).toBeNull()
    expect(sm.getOverview).not.toHaveBeenCalled()
  })

  it.each(PREVIEW_CASES)('$label 抛出非 Error 时 error 走 String() 兜底', async (entry) => {
    const store = await seed()
    sm[entry.primary].mockRejectedValue(`plain-${entry.label}`)

    expect(await entry.invoke(store)).toBeNull()
    expect(store.error).toBe(`plain-${entry.label}`)
  })

  it('previewDeleteSkill 不吞异常：reject 直接冒泡且不写 error', async () => {
    const store = await seed()
    sm.previewDeleteCenterSkill.mockRejectedValue(new Error('预览失败'))

    await expect(store.previewDeleteSkill('sk-0001')).rejects.toThrow('预览失败')
    expect(store.error).toBeNull()
  })

  it('previewDeleteSkill 成功时透传 api 结果', async () => {
    const store = await seed()
    sm.previewDeleteCenterSkill.mockResolvedValue(DELETE_SKILL_PREVIEW)

    expect(await store.previewDeleteSkill('sk-0001')).toBe(DELETE_SKILL_PREVIEW)
    expect(sm.previewDeleteCenterSkill).toHaveBeenCalledWith('sk-0001')
  })

  it('openPath 不吞异常：reject 直接冒泡且不写 error', async () => {
    const store = await seed()
    sm.openPath.mockRejectedValue(new Error('explorer 不可用'))

    await expect(store.openPath('D:/skills/center')).rejects.toThrow('explorer 不可用')
    expect(store.error).toBeNull()
  })

  it('openPath 成功时把路径原样交给 IPC 且不重拉 overview', async () => {
    const store = await seed()
    sm.openPath.mockResolvedValue('ok')

    await store.openPath('D:/codex/skills')

    expect(sm.openPath).toHaveBeenCalledWith('D:/codex/skills')
    expect(sm.getOverview).not.toHaveBeenCalled()
    expect(store.error).toBeNull()
  })
})

// ── detail / loading 状态 ──────────────────────────────────────────

describe('loadSkillDetail', () => {
  it('成功时写入 selectedSkillId / selectedSkillDetail 并结束 loading', async () => {
    const store = useSkillManagerStore()
    sm.getSkillDetail.mockResolvedValue(SKILL_DETAIL)

    await store.loadSkillDetail('sk-0001')

    expect(store.selectedSkillId).toBe('sk-0001')
    expect(store.selectedSkillDetail).toEqual(SKILL_DETAIL)
    expect(store.detailLoading).toBe(false)
    expect(store.error).toBeNull()
    expect(sm.getSkillDetail).toHaveBeenCalledWith('sk-0001')
  })

  it('pending 期间 detailLoading 为 true', async () => {
    const store = useSkillManagerStore()
    const gate = makeGate<SkillDetail | null>()
    sm.getSkillDetail.mockImplementation(() => gate.promise)

    const pending = store.loadSkillDetail('sk-0001')
    expect(store.detailLoading).toBe(true)
    expect(store.selectedSkillId).toBe('sk-0001')

    gate.open(SKILL_DETAIL)
    await pending
    expect(store.detailLoading).toBe(false)
    expect(store.selectedSkillDetail).toEqual(SKILL_DETAIL)
  })

  it('失败时清空 detail、复位 loading 并写入 error', async () => {
    const store = useSkillManagerStore()
    sm.getSkillDetail.mockRejectedValue(new Error('detail ipc down'))

    await store.loadSkillDetail('sk-0001')

    expect(store.selectedSkillDetail).toBeNull()
    expect(store.detailLoading).toBe(false)
    expect(store.error).toBe('detail ipc down')
    expect(store.selectedSkillId).toBe('sk-0001')
  })

  it('api 返回 null（未找到）不算错误', async () => {
    const store = useSkillManagerStore()
    sm.getSkillDetail.mockResolvedValue(null)

    await store.loadSkillDetail('missing')

    expect(store.selectedSkillDetail).toBeNull()
    expect(store.error).toBeNull()
  })

  it('抛出非 Error 时 error 走 String() 兜底', async () => {
    const store = useSkillManagerStore()
    sm.getSkillDetail.mockRejectedValue('skill detail gone')

    await store.loadSkillDetail('sk-0001')

    expect(store.error).toBe('skill detail gone')
    expect(store.detailLoading).toBe(false)
  })

  it('不重拉 overview', async () => {
    const store = useSkillManagerStore()
    sm.getSkillDetail.mockResolvedValue(SKILL_DETAIL)

    await store.loadSkillDetail('sk-0001')

    expect(sm.getOverview).not.toHaveBeenCalled()
  })
})

describe('loadPackDetail', () => {
  it('成功时写入 selectedPackDetail 并复位 loading', async () => {
    const store = useSkillManagerStore()
    sm.getPackDetail.mockResolvedValue(PACK_DETAIL)

    await store.loadPackDetail('pack-1')

    expect(store.selectedPackDetail).toEqual(PACK_DETAIL)
    expect(store.packDetailLoading).toBe(false)
    expect(store.error).toBeNull()
    expect(sm.getOverview).not.toHaveBeenCalled()
  })

  it('pending 期间 packDetailLoading 为 true', async () => {
    const store = useSkillManagerStore()
    const gate = makeGate<SkillPackDetail | null>()
    sm.getPackDetail.mockImplementation(() => gate.promise)

    const pending = store.loadPackDetail('pack-1')
    expect(store.packDetailLoading).toBe(true)

    gate.open(PACK_DETAIL)
    await pending
    expect(store.packDetailLoading).toBe(false)
  })

  it('失败时清空 detail、复位 loading 并写入 error', async () => {
    const store = useSkillManagerStore()
    sm.getPackDetail.mockRejectedValue(new Error('pack ipc down'))

    await store.loadPackDetail('pack-1')

    expect(store.selectedPackDetail).toBeNull()
    expect(store.packDetailLoading).toBe(false)
    expect(store.error).toBe('pack ipc down')
  })

  it('抛出非 Error 时 error 走 String() 兜底', async () => {
    const store = useSkillManagerStore()
    sm.getPackDetail.mockRejectedValue('pack detail gone')

    await store.loadPackDetail('pack-1')

    expect(store.error).toBe('pack detail gone')
    expect(store.packDetailLoading).toBe(false)
  })
})

describe('loadAgentDetail / scanAgentDetail', () => {
  it('loadAgentDetail 成功写入 id 与 detail', async () => {
    const store = useSkillManagerStore()
    sm.getAgentDetail.mockResolvedValue(AGENT_DETAIL)

    await store.loadAgentDetail('codex')

    expect(store.selectedAgentId).toBe('codex')
    expect(store.selectedAgentDetail).toEqual(AGENT_DETAIL)
    expect(store.agentDetailLoading).toBe(false)
    expect(sm.getOverview).not.toHaveBeenCalled()
  })

  it('loadAgentDetail pending 期间 agentDetailLoading 为 true', async () => {
    const store = useSkillManagerStore()
    const gate = makeGate<AgentDetail | null>()
    sm.getAgentDetail.mockImplementation(() => gate.promise)

    const pending = store.loadAgentDetail('codex')
    expect(store.agentDetailLoading).toBe(true)

    gate.open(AGENT_DETAIL)
    await pending
    expect(store.agentDetailLoading).toBe(false)
  })

  it('loadAgentDetail 失败时清空 detail 但保留 selectedAgentId', async () => {
    const store = useSkillManagerStore()
    sm.getAgentDetail.mockRejectedValue(new Error('agent ipc down'))

    await store.loadAgentDetail('codex')

    expect(store.selectedAgentId).toBe('codex')
    expect(store.selectedAgentDetail).toBeNull()
    expect(store.agentDetailLoading).toBe(false)
    expect(store.error).toBe('agent ipc down')
  })

  it('loadAgentDetail 抛出非 Error 时 error 走 String() 兜底', async () => {
    const store = useSkillManagerStore()
    sm.getAgentDetail.mockRejectedValue('agent detail gone')

    await store.loadAgentDetail('codex')

    expect(store.error).toBe('agent detail gone')
    expect(store.agentDetailLoading).toBe(false)
  })

  it('scanAgentDetail 失败时保留上一次的 detail（不清空）', async () => {
    const store = useSkillManagerStore()
    sm.getAgentDetail.mockResolvedValue(AGENT_DETAIL)
    await store.loadAgentDetail('codex')

    sm.scanAgentDetail.mockRejectedValue(new Error('scan failed'))
    await store.scanAgentDetail('codex')

    expect(store.selectedAgentDetail).toEqual(AGENT_DETAIL)
    expect(store.error).toBe('scan failed')
    expect(store.busyAction).toBeNull()
    expect(sm.getOverview).not.toHaveBeenCalled()
  })

  it('scanAgentDetail 成功后重拉 overview', async () => {
    const store = useSkillManagerStore()
    sm.scanAgentDetail.mockResolvedValue(AGENT_DETAIL)
    sm.getOverview.mockResolvedValueOnce(overview({ skills: [SKILL_ASK] }))

    await store.scanAgentDetail('codex')

    expect(store.skills).toHaveLength(1)
    expect(sm.getOverview).toHaveBeenCalledTimes(1)
  })
})

describe('loadAgentInventory', () => {
  it('成功时写入 agentInventory 并原样返回', async () => {
    const store = useSkillManagerStore()
    sm.listAgentSkillInventory.mockResolvedValue(INVENTORY)

    const returned = await store.loadAgentInventory()

    expect(returned).toBe(INVENTORY)
    expect(store.agentInventory.map((a) => a.agentId)).toEqual(['codex'])
    expect(store.agentInventoryLoading).toBe(false)
    expect(sm.getOverview).not.toHaveBeenCalled()
  })

  it('pending 期间 agentInventoryLoading 为 true', async () => {
    const store = useSkillManagerStore()
    const gate = makeGate<AgentSkillInventoryAgent[]>()
    sm.listAgentSkillInventory.mockImplementation(() => gate.promise)

    const pending = store.loadAgentInventory()
    expect(store.agentInventoryLoading).toBe(true)

    gate.open(INVENTORY)
    await pending
    expect(store.agentInventoryLoading).toBe(false)
    expect(store.agentInventory.map((a) => a.agentId)).toEqual(['codex'])
  })

  it('失败时返回 null、保留旧 inventory 并写入 error', async () => {
    const store = useSkillManagerStore()
    sm.listAgentSkillInventory.mockResolvedValue(INVENTORY)
    await store.loadAgentInventory()

    sm.listAgentSkillInventory.mockRejectedValue(new Error('inventory down'))
    expect(await store.loadAgentInventory()).toBeNull()
    expect(store.error).toBe('inventory down')
    expect(store.agentInventory.map((a) => a.agentId)).toEqual(['codex'])
    expect(store.agentInventoryLoading).toBe(false)
  })

  it('抛出非 Error 时 error 走 String() 兜底', async () => {
    const store = useSkillManagerStore()
    sm.listAgentSkillInventory.mockRejectedValue('inventory gone')

    expect(await store.loadAgentInventory()).toBeNull()
    expect(store.error).toBe('inventory gone')
    expect(store.agentInventoryLoading).toBe(false)
  })
})

describe('runDiagnosis / updateSettings', () => {
  it('runDiagnosis 成功写入 issues 并重拉 overview', async () => {
    const store = useSkillManagerStore()
    sm.runDiagnosis.mockResolvedValue([ISSUE, ISSUE_MANUAL])
    sm.getOverview.mockResolvedValueOnce(overview({ issues: [ISSUE] }))

    await store.runDiagnosis()

    expect(store.diagnosisIssues.map((i) => i.id)).toEqual(['iss-1', 'iss-2'])
    expect(store.diagnosisLoading).toBe(false)
    expect(store.error).toBeNull()
    expect(sm.getOverview).toHaveBeenCalledTimes(1)
    expect(store.issues.map((i) => i.id)).toEqual(['iss-1'])
  })

  it('runDiagnosis pending 期间 diagnosisLoading 为 true', async () => {
    const store = useSkillManagerStore()
    const gate = makeGate<DiagnosisIssue[]>()
    sm.runDiagnosis.mockImplementation(() => gate.promise)

    const pending = store.runDiagnosis()
    expect(store.diagnosisLoading).toBe(true)

    gate.open([ISSUE])
    await pending
    expect(store.diagnosisLoading).toBe(false)
  })

  it('runDiagnosis 失败时保留旧 issues 并写入 error', async () => {
    const store = useSkillManagerStore()
    sm.runDiagnosis.mockResolvedValue([ISSUE])
    await store.runDiagnosis()

    sm.runDiagnosis.mockRejectedValue(new Error('diagnosis down'))
    await store.runDiagnosis()

    expect(store.diagnosisIssues.map((i) => i.id)).toEqual(['iss-1'])
    expect(store.error).toBe('diagnosis down')
    expect(store.diagnosisLoading).toBe(false)
  })

  it('runDiagnosis 抛出非 Error 时 error 走 String() 兜底', async () => {
    const store = useSkillManagerStore()
    sm.runDiagnosis.mockRejectedValue('diagnosis gone')

    await store.runDiagnosis()

    expect(store.error).toBe('diagnosis gone')
    expect(store.diagnosisLoading).toBe(false)
  })

  it('updateSettings 写入返回值后立刻被 overview 的 settings 覆盖', async () => {
    const store = useSkillManagerStore()
    sm.updateSettings.mockResolvedValue({ ...SETTINGS, centerLibraryPath: 'E:/from-settings' })
    sm.getOverview.mockResolvedValue(
      overview({ settings: { ...SETTINGS, centerLibraryPath: 'E:/from-overview' } }),
    )

    await store.updateSettings({ showUnmanaged: true })

    expect(sm.updateSettings).toHaveBeenCalledWith({ showUnmanaged: true })
    expect(store.settings).toEqual({ ...SETTINGS, centerLibraryPath: 'E:/from-overview' })
    expect(store.loading).toBe(false)
    expect(store.busyAction).toBeNull()
    expect(sm.getOverview).toHaveBeenCalledTimes(1)
  })

  it('updateSettings 失败时写入 error、settings 保持原值', async () => {
    const store = useSkillManagerStore()
    sm.updateSettings.mockRejectedValue(new Error('settings 只读'))

    await store.updateSettings({ startupScan: false })

    expect(store.settings).toBeNull()
    expect(store.error).toBe('settings 只读')
    expect(store.loading).toBe(false)
    expect(sm.getOverview).not.toHaveBeenCalled()
  })

  it('updateSettings 抛出非 Error 时 error 走 String() 兜底', async () => {
    const store = useSkillManagerStore()
    sm.updateSettings.mockRejectedValue('settings gone')

    await store.updateSettings({ startupScan: false })

    expect(store.error).toBe('settings gone')
    expect(store.loading).toBe(false)
  })
})

// ── clear 系列 ─────────────────────────────────────────────────────

describe('clear 系列', () => {
  it('clearSelectedSkill 清空 id 与 detail', async () => {
    const store = useSkillManagerStore()
    sm.getSkillDetail.mockResolvedValue(SKILL_DETAIL)
    await store.loadSkillDetail('sk-0001')

    store.clearSelectedSkill()

    expect(store.selectedSkillId).toBeNull()
    expect(store.selectedSkillDetail).toBeNull()
  })

  it('clearSelectedSkill 不影响 pack / agent 的选中态', async () => {
    const store = useSkillManagerStore()
    sm.getPackDetail.mockResolvedValue(PACK_DETAIL)
    sm.getAgentDetail.mockResolvedValue(AGENT_DETAIL)
    await store.loadPackDetail('pack-1')
    await store.loadAgentDetail('codex')

    store.clearSelectedSkill()

    expect(store.selectedPackDetail).not.toBeNull()
    expect(store.selectedAgentId).toBe('codex')
  })

  it('clearSelectedPack 只清空 detail，不重置 loading；在途响应仍会写回', async () => {
    const store = useSkillManagerStore()
    const gate = makeGate<SkillPackDetail | null>()
    sm.getPackDetail.mockImplementation(() => gate.promise)

    const pending = store.loadPackDetail('pack-1')
    store.clearSelectedPack()

    expect(store.selectedPackDetail).toBeNull()
    expect(store.packDetailLoading).toBe(true)

    gate.open(PACK_DETAIL)
    await pending
    expect(store.packDetailLoading).toBe(false)
    expect(store.selectedPackDetail).toEqual(PACK_DETAIL)
  })

  it('clearSelectedAgent 清空 id 与 detail，不重置 loading', async () => {
    const store = useSkillManagerStore()
    const gate = makeGate<AgentDetail | null>()
    sm.getAgentDetail.mockImplementation(() => gate.promise)

    const pending = store.loadAgentDetail('codex')
    store.clearSelectedAgent()

    expect(store.selectedAgentId).toBeNull()
    expect(store.agentDetailLoading).toBe(true)

    gate.open(AGENT_DETAIL)
    await pending
    expect(store.agentDetailLoading).toBe(false)
    // 清空之后迟到的响应仍会把 detail 写回来
    expect(store.selectedAgentDetail).toEqual(AGENT_DETAIL)
  })

  it('clear 系列不发送任何 IPC', () => {
    const store = useSkillManagerStore()
    const before = totalApiCalls()

    store.clearSelectedSkill()
    store.clearSelectedPack()
    store.clearSelectedAgent()

    expect(totalApiCalls()).toBe(before)
  })
})

// ── api 缺失降级 ───────────────────────────────────────────────────

interface GuardedCall {
  label: string
  invoke: (store: Store) => Promise<unknown>
  fallback: null | undefined
}

const GUARDED_CALLS: GuardedCall[] = [
  { label: 'loadOverview', invoke: (s) => s.loadOverview(), fallback: undefined },
  { label: 'refresh', invoke: (s) => s.refresh(), fallback: undefined },
  { label: 'updateSettings', invoke: (s) => s.updateSettings({ startupScan: false }), fallback: undefined },
  { label: 'openPath', invoke: (s) => s.openPath('D:/skills/center'), fallback: undefined },
  { label: 'loadSkillDetail', invoke: (s) => s.loadSkillDetail('sk-0001'), fallback: undefined },
  { label: 'previewDeleteSkill', invoke: (s) => s.previewDeleteSkill('sk-0001'), fallback: null },
  { label: 'executeDeleteSkill', invoke: (s) => s.executeDeleteSkill('sk-0001'), fallback: undefined },
  { label: 'previewAddCenterSkill', invoke: (s) => s.previewAddCenterSkill(ADD_INPUT), fallback: null },
  {
    label: 'executeAddCenterSkill',
    invoke: (s) => s.executeAddCenterSkill(ADD_INPUT, ADD_DECISIONS),
    fallback: null,
  },
  {
    label: 'previewDistribute',
    invoke: (s) => s.previewDistribute(['sk-0001'], ['codex'], 'link'),
    fallback: null,
  },
  { label: 'executeDistribute', invoke: (s) => s.executeDistribute(DISTRIBUTION_PREVIEW), fallback: null },
  { label: 'deleteTarget', invoke: (s) => s.deleteTarget('t-1'), fallback: undefined },
  { label: 'scanAgentInventory', invoke: (s) => s.scanAgentInventory('codex'), fallback: null },
  { label: 'loadAgentInventory', invoke: (s) => s.loadAgentInventory(), fallback: null },
  { label: 'previewAdopt', invoke: (s) => s.previewAdopt('codex', 'un-1'), fallback: null },
  {
    label: 'executeAdopt',
    invoke: (s) => s.executeAdopt('codex', 'un-1', 'import_to_center'),
    fallback: undefined,
  },
  { label: 'executeAdoptBatch', invoke: (s) => s.executeAdoptBatch(ADOPT_ITEMS), fallback: null },
  { label: 'loadPackDetail', invoke: (s) => s.loadPackDetail('pack-1'), fallback: undefined },
  { label: 'upsertPack', invoke: (s) => s.upsertPack(UPSERT_INPUT), fallback: null },
  { label: 'previewDeletePack', invoke: (s) => s.previewDeletePack('pack-1'), fallback: null },
  { label: 'deletePack', invoke: (s) => s.deletePack('pack-1'), fallback: undefined },
  { label: 'previewApplyPack', invoke: (s) => s.previewApplyPack('pack-1', ['codex'], 'link'), fallback: null },
  { label: 'executeApplyPack', invoke: (s) => s.executeApplyPack('pack-1', ['codex'], 'link'), fallback: null },
  {
    label: 'previewRemovePackFromAgent',
    invoke: (s) => s.previewRemovePackFromAgent('pack-1', 'codex'),
    fallback: null,
  },
  { label: 'removePackFromAgent', invoke: (s) => s.removePackFromAgent('pack-1', 'codex'), fallback: null },
  { label: 'runDiagnosis', invoke: (s) => s.runDiagnosis(), fallback: undefined },
  { label: 'executeSafeFixes', invoke: (s) => s.executeSafeFixes(), fallback: undefined },
  { label: 'exportSnapshot', invoke: (s) => s.exportSnapshot(), fallback: null },
  { label: 'loadAgentDetail', invoke: (s) => s.loadAgentDetail('codex'), fallback: undefined },
  { label: 'scanAgentDetail', invoke: (s) => s.scanAgentDetail('codex'), fallback: undefined },
  { label: 'previewSyncCopy', invoke: (s) => s.previewSyncCopy('t-1'), fallback: null },
  { label: 'executeSyncCopy', invoke: (s) => s.executeSyncCopy('t-1', 'manual'), fallback: null },
  { label: 'previewCopyTargetDiff', invoke: (s) => s.previewCopyTargetDiff('t-1'), fallback: null },
]

describe('api.skillManagerV2 缺失时的降级', () => {
  it.each(GUARDED_CALLS)('$label 提前返回且不发送任何 IPC', async (entry) => {
    await withMissingApi(async () => {
      const store = useSkillManagerStore()

      expect(await entry.invoke(store)).toBe(entry.fallback)

      expect(totalApiCalls()).toBe(0)
      expect(store.error).toBeNull()
      expect(store.overview).toBeNull()
      expect(store.busyAction).toBeNull()
      expect(store.loading).toBe(false)
      expect(store.detailLoading).toBe(false)
      expect(store.packDetailLoading).toBe(false)
      expect(store.agentDetailLoading).toBe(false)
      expect(store.diagnosisLoading).toBe(false)
      expect(store.agentInventoryLoading).toBe(false)
      expect(store.selectedSkillId).toBeNull()
      expect(store.agentInventory).toEqual([])
    })
  })
})

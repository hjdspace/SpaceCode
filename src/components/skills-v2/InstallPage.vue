<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Archive,
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  Flame,
  FolderOpen,
  GitBranch,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Star,
  TrendingUp,
  UsersRound,
  X,
} from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useSkillsStore, type MarketplaceSkill } from '@/stores/skills'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import AgentIconBadge from './AgentIconBadge.vue'
import ImportDialog from './ImportDialog.vue'
import MigrationWizard from './MigrationWizard.vue'
import type { AddCenterSkillInput, AdoptOption, AdoptPreview, UnmanagedItemDto } from '@/types/skillManagerV2'

type InstallTab = 'marketplace' | 'sync' | 'local' | 'github'
type MarketBoard = 'all' | 'trending' | 'hot'
type MarketView = 'cards' | 'list'

const { t } = useI18n()
const skillsStore = useSkillsStore()
const store = useSkillManagerStore()

const activeSubtab = ref<InstallTab>('marketplace')
const importDialog = ref<InstanceType<typeof ImportDialog> | null>(null)

const marketplaceQuery = ref('')
const marketplacePublisher = ref('')
const marketplacePage = ref(1)
const marketplaceSearching = ref(false)
const marketplaceError = ref<string | null>(null)
const marketBoard = ref<MarketBoard>('all')
const marketView = ref<MarketView>('cards')
const marketPageSize = 24
const installingSkillIds = ref(new Set<string>())
const installedSkillIds = ref(new Set<string>())
const selectedMarketSkill = ref<MarketplaceSkill | null>(null)
const marketReadme = ref('')
const marketDetailLoading = ref(false)

const syncLoading = ref(false)
const syncFilter = ref('')
const syncAgentFilter = ref('all')
const syncWizardVisible = ref(false)
const syncNotice = ref<string | null>(null)
const syncScanned = ref(false)
const syncDialogItem = ref<UnmanagedItemDto | null>(null)
const syncDialogPreview = ref<AdoptPreview | null>(null)
const syncDialogOption = ref<AdoptOption>('import_keep')
const syncDialogRenamedId = ref('')
const syncDialogLoading = ref(false)
const syncDialogBusy = ref(false)
const syncDialogError = ref<string | null>(null)

const localPath = ref('')
const localSourceType = ref<'local_folder' | 'archive'>('local_folder')
const localImportMode = ref<'copy' | 'link'>('copy')
const localDragActive = ref(false)
const localError = ref<string | null>(null)

const githubUrl = ref('')
const githubBranch = ref('main')
const githubSubPath = ref('')
const githubCloning = ref(false)
const githubError = ref<string | null>(null)
const githubClonedPath = ref<string | null>(null)
const githubImporting = ref(false)
const githubImportError = ref<string | null>(null)
const githubImportSuccess = ref(false)

const marketplaceSkills = computed(() => {
  const items = [...skillsStore.marketplaceSkills]
  const publisher = marketplacePublisher.value.trim().toLowerCase()
  const scoped = publisher
    ? items.filter((skill) => skill.source.split('/')[0]?.toLowerCase() === publisher)
    : items
  scoped.sort((a, b) => b.installs - a.installs)
  // 趋势/热门按当前数据分布的动态分位数过滤，保证与全部有明显区分
  if (marketBoard.value === 'trending' || marketBoard.value === 'hot') {
    const installsAsc = scoped.map((skill) => skill.installs).sort((a, b) => a - b)
    const threshold = installsPercentile(installsAsc, marketBoard.value === 'trending' ? 50 : 85)
    return scoped.filter((skill) => skill.installs >= threshold)
  }
  return scoped
})

function installsPercentile(sortedAsc: number[], percentile: number): number {
  if (sortedAsc.length === 0) return Number.POSITIVE_INFINITY
  const index = Math.min(sortedAsc.length - 1, Math.floor((percentile / 100) * sortedAsc.length))
  return sortedAsc[index]
}

const marketplacePageCount = computed(() => Math.max(1, Math.ceil(marketplaceSkills.value.length / marketPageSize)))
const marketplacePageSkills = computed(() => {
  const start = (marketplacePage.value - 1) * marketPageSize
  return marketplaceSkills.value.slice(start, start + marketPageSize)
})

const marketplacePageButtons = computed(() => {
  const count = marketplacePageCount.value
  const current = marketplacePage.value
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1)
  const pages: (number | '…')[] = [1]
  const rangeStart = Math.max(2, current - 1)
  const rangeEnd = Math.min(count - 1, current + 1)
  if (rangeStart > 2) pages.push('…')
  for (let page = rangeStart; page <= rangeEnd; page += 1) pages.push(page)
  if (rangeEnd < count - 1) pages.push('…')
  pages.push(count)
  return pages
})

function goToMarketplacePage(page: number | '…'): void {
  if (page === '…') return
  marketplacePage.value = Math.min(Math.max(1, page), marketplacePageCount.value)
}

const recommendedPublishers = computed(() => {
  const publishers = new Map<string, number>()
  for (const skill of skillsStore.marketplaceSkills) {
    const publisher = skill.source.split('/')[0]
    if (publisher) publishers.set(publisher, (publishers.get(publisher) ?? 0) + 1)
  }
  return [...publishers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7)
})

const syncItems = computed(() => {
  const query = syncFilter.value.trim().toLowerCase()
  return store.unmanaged.filter((item) => {
    if (syncAgentFilter.value !== 'all' && item.agentId !== syncAgentFilter.value) return false
    if (!query) return true
    return `${item.inferredSkillId ?? ''} ${item.path} ${item.reason}`.toLowerCase().includes(query)
  })
})

const syncAgentCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of store.unmanaged) {
    if (item.agentId) counts.set(item.agentId, (counts.get(item.agentId) ?? 0) + 1)
  }
  return counts
})

const syncAgents = computed(() => store.agents.filter((agent) => (syncAgentCounts.value.get(agent.id) ?? 0) > 0))
const syncConflicts = computed(() => store.unmanaged.filter((item) => item.reason.toLowerCase().includes('differs')).length)

watch([marketBoard, marketplacePublisher, marketplaceQuery], () => {
  marketplacePage.value = 1
})

const selectedMarketDescription = computed(() => {
  const frontmatter = marketReadme.value.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/)
  const description = frontmatter?.[1].match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1]
  return description || selectedMarketSkill.value?.description || ''
})

const selectedMarketPath = computed(() => {
  const skill = selectedMarketSkill.value
  return skill ? [...skill.source.split('/').filter(Boolean), skill.skillId] : []
})

watch(localPath, (value) => {
  localSourceType.value = value.trim().toLowerCase().endsWith('.zip') ? 'archive' : 'local_folder'
  if (localSourceType.value === 'archive') localImportMode.value = 'copy'
})

onMounted(() => {
  void loadMarketplace()
})

watch(activeSubtab, (tab) => {
  if (tab === 'sync' && !syncScanned.value) void scanAllAgents()
})

async function loadMarketplace(query = ''): Promise<void> {
  marketplaceSearching.value = true
  marketplaceError.value = null
  try {
    await skillsStore.searchMarketplace(query)
  } catch (e) {
    marketplaceError.value = e instanceof Error ? e.message : String(e)
  } finally {
    marketplaceSearching.value = false
  }
}

function handleMarketplaceSearch(): void {
  void loadMarketplace(marketplaceQuery.value.trim())
}

function filterPublisher(publisher: string): void {
  if (marketplacePublisher.value === publisher) {
    clearMarketplacePublisher()
    return
  }
  marketplacePublisher.value = publisher
  marketplaceQuery.value = publisher
  void loadMarketplace(publisher)
}

function clearMarketplacePublisher(): void {
  marketplacePublisher.value = ''
  marketplaceQuery.value = ''
  void loadMarketplace()
}

function marketKey(skill: MarketplaceSkill): string {
  return `${skill.source}/${skill.skillId}`
}

function isInstalling(skill: MarketplaceSkill): boolean {
  return installingSkillIds.value.has(marketKey(skill))
}

function isInstalled(skill: MarketplaceSkill): boolean {
  return Boolean(skill.isInstalled || installedSkillIds.value.has(marketKey(skill)))
}

async function handleMarketplaceInstall(skill: MarketplaceSkill): Promise<void> {
  const key = marketKey(skill)
  installingSkillIds.value.add(key)
  try {
    const result = await skillsStore.installMarketplaceSkill(skill.source, skill.skillId, true)
    if (!result.success) {
      marketplaceError.value = result.error ?? t('skillManagerV2.install.marketplaceInstallFailed')
      return
    }

    if (result.installPath) {
      const input: AddCenterSkillInput = {
        sourcePath: result.installPath,
        sourceType: 'marketplace',
        sourceUri: `skillssh:${skill.source}/${skill.skillId}`,
      }
      const preview = await store.previewAddCenterSkill(input)
      if (preview) {
        const decisions = preview.blockers.map((blocker) => ({ skillId: blocker.skillId, resolution: 'skip' as const }))
        await store.executeAddCenterSkill(input, decisions)
      }
    }
    installedSkillIds.value.add(key)
  } catch (e) {
    marketplaceError.value = e instanceof Error ? e.message : String(e)
  } finally {
    installingSkillIds.value.delete(key)
  }
}

async function openMarketDetail(skill: MarketplaceSkill): Promise<void> {
  selectedMarketSkill.value = skill
  marketReadme.value = ''
  marketDetailLoading.value = true
  try {
    const result = await skillsStore.fetchMarketplaceReadme(skill.source, skill.skillId)
    marketReadme.value = result ?? ''
  } finally {
    marketDetailLoading.value = false
  }
}

function marketGithubUrl(skill: MarketplaceSkill): string {
  const base = `https://github.com/${skill.source}`
  return skill.source.endsWith('/skills') ? `${base}/tree/main/${skill.skillId}` : base
}

function marketSourceUrl(skill: MarketplaceSkill): string {
  return `https://skills.sh/${skill.source}`
}

function marketSkillUrl(skill: MarketplaceSkill): string {
  return `https://skills.sh/${skill.source}/${skill.skillId}`
}

function marketInstallCommand(skill: MarketplaceSkill): string {
  return `npx skills add https://github.com/${skill.source} --skill ${skill.skillId}`
}

function formatInstallCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return String(value)
}

async function scanAllAgents(): Promise<void> {
  syncLoading.value = true
  syncNotice.value = null
  try {
    for (const agent of store.agents.filter((item) => item.enabled)) {
      await store.scanAgentInventory(agent.id, false)
    }
    await store.loadOverview()
    syncScanned.value = true
    syncNotice.value = t('skillManagerV2.install.syncScanned', { count: store.unmanaged.length })
  } finally {
    syncLoading.value = false
  }
}

async function openSyncAdopt(item: UnmanagedItemDto): Promise<void> {
  if (!item.agentId) return
  syncDialogItem.value = item
  syncDialogPreview.value = null
  syncDialogError.value = null
  syncDialogLoading.value = true
  try {
    const preview = await store.previewAdopt(item.agentId, item.id)
    if (!preview) {
      syncDialogError.value = store.error ?? t('skillManagerV2.install.adoptFailed')
      return
    }
    syncDialogPreview.value = preview
    syncDialogOption.value = preview.options[0] ?? 'skip'
    syncDialogRenamedId.value = `${preview.inferredSkillId}-import`
  } catch (e) {
    syncDialogError.value = e instanceof Error ? e.message : String(e)
  } finally {
    syncDialogLoading.value = false
  }
}

function closeSyncAdopt(): void {
  if (syncDialogBusy.value) return
  syncDialogItem.value = null
  syncDialogPreview.value = null
  syncDialogError.value = null
}

function adoptOptionTitle(option: AdoptOption): string {
  const keys: Record<AdoptOption, string> = {
    import_to_center: 'adoptImportKeepTitle',
    replace_with_link: 'adoptImportLinkTitle',
    replace_with_copy: 'adoptImportCopyTitle',
    import_keep: 'adoptImportKeepTitle',
    import_link: 'adoptImportLinkTitle',
    import_copy: 'adoptImportCopyTitle',
    import_cleanup: 'adoptCleanupTitle',
    center_over_agent: 'adoptCenterOverAgentTitle',
    overwrite_center: 'adoptOverwriteCenterTitle',
    rename: 'adoptRenameTitle',
    skip: 'adoptSkipTitle',
  }
  return t(`skillManagerV2.install.${keys[option]}`)
}

function adoptOptionDescription(option: AdoptOption): string {
  const keys: Record<AdoptOption, string> = {
    import_to_center: 'adoptImportKeepDesc',
    replace_with_link: 'adoptImportLinkDesc',
    replace_with_copy: 'adoptImportCopyDesc',
    import_keep: 'adoptImportKeepDesc',
    import_link: 'adoptImportLinkDesc',
    import_copy: 'adoptImportCopyDesc',
    import_cleanup: 'adoptCleanupDesc',
    center_over_agent: 'adoptCenterOverAgentDesc',
    overwrite_center: 'adoptOverwriteCenterDesc',
    rename: 'adoptRenameDesc',
    skip: 'adoptSkipDesc',
  }
  return t(`skillManagerV2.install.${keys[option]}`)
}

async function executeSyncAdopt(): Promise<void> {
  const item = syncDialogItem.value
  const preview = syncDialogPreview.value
  if (!item?.agentId || !preview || syncDialogOption.value === 'skip') {
    closeSyncAdopt()
    return
  }
  syncDialogBusy.value = true
  syncDialogError.value = null
  try {
    await store.executeAdopt(item.agentId, item.id, syncDialogOption.value, syncDialogOption.value === 'rename' ? syncDialogRenamedId.value : undefined)
    closeSyncAdopt()
  } catch (e) {
    syncDialogError.value = e instanceof Error ? e.message : String(e)
  } finally {
    syncDialogBusy.value = false
  }
}

function agentBadge(agentId: string, agentName: string): { agentId: string; agentName: string; mode: 'link'; status: 'ok' } {
  return { agentId, agentName, mode: 'link', status: 'ok' }
}

async function chooseLocalFolder(): Promise<void> {
  const result = await api.selectFolder()
  if (result.canceled || !result.filePaths[0]) return
  localPath.value = result.filePaths[0]
  localSourceType.value = 'local_folder'
  localError.value = null
}

async function chooseLocalArchive(): Promise<void> {
  const result = await api.selectFiles()
  const archivePath = result.filePaths.find((filePath) => filePath.toLowerCase().endsWith('.zip'))
  if (result.canceled) return
  if (!archivePath) {
    localError.value = t('skillManagerV2.import.previewFailed')
    return
  }
  localPath.value = archivePath
  localSourceType.value = 'archive'
  localImportMode.value = 'copy'
  localError.value = null
}

function handleLocalDrop(event: DragEvent): void {
  localDragActive.value = false
  const file = event.dataTransfer?.files[0] as (File & { path?: string }) | undefined
  if (!file?.path) return
  localPath.value = file.path
  localError.value = null
}

function previewLocalImport(): void {
  if (!localPath.value.trim()) return
  void importDialog.value?.open(localPath.value.trim(), localSourceType.value, localImportMode.value)
}

function normalizeGithubUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (!trimmed.startsWith('http') && !trimmed.startsWith('git@')) return `https://github.com/${trimmed}`
  return trimmed
}

async function handleGithubClone(): Promise<void> {
  if (!githubUrl.value.trim()) {
    githubError.value = t('skillManagerV2.install.githubUrlPlaceholder')
    return
  }
  githubCloning.value = true
  githubError.value = null
  githubClonedPath.value = null
  githubImportSuccess.value = false
  try {
    const result = await api.skillManagerV2?.cloneGitHubRepo(
      normalizeGithubUrl(githubUrl.value),
      githubBranch.value.trim() || undefined,
      githubSubPath.value.trim() || undefined,
    )
    if (result?.success && result.localPath) githubClonedPath.value = result.localPath
    else githubError.value = result?.error ?? t('skillManagerV2.install.githubCloneFailed')
  } catch (e) {
    githubError.value = e instanceof Error ? e.message : String(e)
  } finally {
    githubCloning.value = false
  }
}

async function handleGithubImport(): Promise<void> {
  if (!githubClonedPath.value) return
  githubImporting.value = true
  githubImportError.value = null
  try {
    const input: AddCenterSkillInput = {
      sourcePath: githubClonedPath.value,
      sourceType: 'github',
      sourceUri: normalizeGithubUrl(githubUrl.value),
      sourceRef: githubBranch.value.trim() || undefined,
    }
    const preview = await store.previewAddCenterSkill(input)
    if (!preview) {
      githubImportError.value = store.error ?? t('skillManagerV2.install.githubImportFailed')
      return
    }
    const decisions = preview.blockers.map((blocker) => ({ skillId: blocker.skillId, resolution: 'skip' as const }))
    const result = await store.executeAddCenterSkill(input, decisions)
    if (result) githubImportSuccess.value = true
    else githubImportError.value = store.error ?? t('skillManagerV2.install.githubImportFailed')
  } catch (e) {
    githubImportError.value = e instanceof Error ? e.message : String(e)
  } finally {
    githubImporting.value = false
  }
}

function resetGithub(): void {
  githubUrl.value = ''
  githubBranch.value = 'main'
  githubSubPath.value = ''
  githubClonedPath.value = null
  githubError.value = null
  githubImportError.value = null
  githubImportSuccess.value = false
}
</script>

<template>
  <div class="install-page">
    <nav class="install-tabs" :aria-label="t('skillManagerV2.viewTitle.install')">
      <button :class="{ active: activeSubtab === 'marketplace' }" @click="activeSubtab = 'marketplace'">
        <Star :size="17" />{{ t('skillManagerV2.install.marketplace') }}
      </button>
      <button :class="{ active: activeSubtab === 'sync' }" @click="activeSubtab = 'sync'">
        <UsersRound :size="17" />{{ t('skillManagerV2.install.sync') }}
        <span v-if="store.metrics?.unmanagedCount" class="tab-count">{{ store.metrics.unmanagedCount }}</span>
      </button>
      <button :class="{ active: activeSubtab === 'local' }" @click="activeSubtab = 'local'">
        <FolderOpen :size="17" />{{ t('skillManagerV2.install.local') }}
      </button>
      <button :class="{ active: activeSubtab === 'github' }" @click="activeSubtab = 'github'">
        <GitBranch :size="17" />{{ t('skillManagerV2.install.github') }}
      </button>
    </nav>

    <section v-if="activeSubtab === 'marketplace'" class="market-panel">
      <div class="market-toolbar">
        <div class="market-board" role="tablist">
          <button :class="{ active: marketBoard === 'all' }" @click="marketBoard = 'all'"><Star :size="14" />{{ t('skillManagerV2.install.marketplaceAll') }}</button>
          <button :class="{ active: marketBoard === 'trending' }" @click="marketBoard = 'trending'"><TrendingUp :size="14" />{{ t('skillManagerV2.install.marketplaceTrending') }}</button>
          <button :class="{ active: marketBoard === 'hot' }" @click="marketBoard = 'hot'"><Flame :size="14" />{{ t('skillManagerV2.install.marketplaceHot') }}</button>
        </div>
        <form class="market-search" @submit.prevent="handleMarketplaceSearch">
          <Search :size="16" />
          <input v-model="marketplaceQuery" :placeholder="t('skillManagerV2.install.marketplaceSearchPlaceholder')" />
        </form>
        <div class="view-toggle">
          <button :class="{ active: marketView === 'list' }" :title="t('skillManagerV2.view.list')" @click="marketView = 'list'"><List :size="16" /></button>
          <button :class="{ active: marketView === 'cards' }" :title="t('skillManagerV2.view.cards')" @click="marketView = 'cards'"><LayoutGrid :size="16" /></button>
        </div>
      </div>

      <div v-if="recommendedPublishers.length" class="publisher-row">
        <span>{{ t('skillManagerV2.install.marketplaceDetailSource') }}</span>
        <button v-for="([publisher, count]) in recommendedPublishers" :key="publisher" :class="{ active: marketplacePublisher === publisher }" @click="filterPublisher(publisher)">
          {{ publisher }} <small>{{ count }}</small>
        </button>
        <button v-if="marketplacePublisher" class="publisher-clear" :title="t('common.clear')" @click="clearMarketplacePublisher"><X :size="14" /></button>
      </div>

      <div class="market-caption">{{ t('skillManagerV2.install.marketplaceDesc') }}</div>
      <div v-if="marketplaceError" class="inline-error">{{ marketplaceError }}</div>
      <div class="market-body">
        <div v-if="marketplaceSearching" class="loading-state"><Loader2 class="spin" :size="24" />{{ t('skillManagerV2.install.marketplaceSearching') }}</div>
        <div v-else-if="marketplaceSkills.length === 0" class="empty-state">{{ t('skillManagerV2.install.marketplaceNoResults') }}</div>
        <template v-else>
          <div v-if="marketView === 'cards'" class="market-results is-cards">
            <article v-for="skill in marketplacePageSkills" :key="skill.id" class="market-card" tabindex="0" @click="openMarketDetail(skill)" @keydown.enter="openMarketDetail(skill)">
              <div class="market-card-head">
                <span class="market-glyph">{{ skill.name.slice(0, 2).toUpperCase() }}</span>
                <div class="market-card-info">
                  <h3>{{ skill.name }}</h3>
                  <p v-if="skill.description">{{ skill.description }}</p>
                </div>
              </div>
              <div class="market-card-meta">
                <span class="market-chip"><Download :size="12" />{{ formatInstallCount(skill.installs) }}</span>
                <span class="market-chip">{{ skill.source.split('/')[0] }}</span>
                <span class="market-card-actions">
                  <button v-if="isInstalled(skill)" class="skill-action installed" disabled @click.stop><Check :size="15" /></button>
                  <button v-else class="skill-action" :disabled="isInstalling(skill)" :title="t('skillManagerV2.install.marketplaceInstall')" @click.stop="handleMarketplaceInstall(skill)">
                    <Loader2 v-if="isInstalling(skill)" class="spin" :size="15" /><Plus v-else :size="17" />
                  </button>
                </span>
              </div>
            </article>
          </div>
          <div v-else class="market-results is-list">
            <article v-for="skill in marketplacePageSkills" :key="skill.id" class="market-row" tabindex="0" @click="openMarketDetail(skill)" @keydown.enter="openMarketDetail(skill)">
              <span class="market-glyph sm">{{ skill.name.slice(0, 2).toUpperCase() }}</span>
              <div class="market-row-copy">
                <strong>{{ skill.name }}</strong>
                <span>{{ skill.source }}</span>
              </div>
              <span class="install-count"><Download :size="13" />{{ formatInstallCount(skill.installs) }}</span>
              <button v-if="isInstalled(skill)" class="skill-action installed" disabled @click.stop><Check :size="15" /></button>
              <button v-else class="skill-action" :disabled="isInstalling(skill)" :title="t('skillManagerV2.install.marketplaceInstall')" @click.stop="handleMarketplaceInstall(skill)">
                <Loader2 v-if="isInstalling(skill)" class="spin" :size="15" /><Plus v-else :size="17" />
              </button>
            </article>
          </div>
          <nav v-if="marketplacePageCount > 1" class="market-pagination" :aria-label="t('skillManagerV2.install.marketplacePagination')">
            <button class="page-btn" :disabled="marketplacePage === 1" @click="goToMarketplacePage(marketplacePage - 1)">{{ t('common.previous') }}</button>
            <template v-for="(page, index) in marketplacePageButtons" :key="`${page}-${index}`">
              <span v-if="page === '…'" class="page-ellipsis">…</span>
              <button v-else class="page-btn" :class="{ active: marketplacePage === page }" @click="goToMarketplacePage(page)">{{ page }}</button>
            </template>
            <button class="page-btn" :disabled="marketplacePage === marketplacePageCount" @click="goToMarketplacePage(marketplacePage + 1)">{{ t('common.next') }}</button>
          </nav>
        </template>
      </div>
    </section>

    <section v-else-if="activeSubtab === 'sync'" class="sync-panel">
      <div class="sync-summary">
        <div>
          <strong>{{ t('skillManagerV2.install.syncTitle') }}</strong>
          <p>{{ t('skillManagerV2.install.syncDesc') }}</p>
          <span>{{ syncItems.length }} {{ t('skillManagerV2.install.syncPending') }} · {{ syncConflicts }} {{ t('skillManagerV2.status.conflict') }}</span>
        </div>
        <div class="button-row">
          <button class="btn" :disabled="syncLoading" @click="scanAllAgents"><RefreshCw :class="{ spin: syncLoading }" :size="15" />{{ t('skillManagerV2.install.syncRescan') }}</button>
          <button class="btn primary" :disabled="store.unmanaged.length === 0" @click="syncWizardVisible = true"><Check :size="15" />{{ t('skillManagerV2.install.syncOrganize', { count: store.unmanaged.length }) }}</button>
        </div>
      </div>
      <div v-if="syncNotice" class="notice">{{ syncNotice }}</div>
      <div v-if="syncAgents.length" class="agent-strip">
        <button :class="{ active: syncAgentFilter === 'all' }" @click="syncAgentFilter = 'all'"><span class="agent-glyph">Ag</span><span><strong>{{ t('skillManagerV2.actions.allAgents') }}</strong><small>{{ store.unmanaged.length }} {{ t('skillManagerV2.install.syncPendingShort') }}</small></span></button>
        <button v-for="agent in syncAgents" :key="agent.id" :class="{ active: syncAgentFilter === agent.id }" @click="syncAgentFilter = agent.id">
          <AgentIconBadge :badge="agentBadge(agent.id, agent.displayName)" :size="30" />
          <span><strong>{{ agent.displayName }}</strong><small>{{ syncAgentCounts.get(agent.id) }} {{ t('skillManagerV2.install.syncPendingShort') }}</small></span>
        </button>
      </div>
      <label class="sync-search"><Search :size="16" /><input v-model="syncFilter" :placeholder="t('skillManagerV2.install.syncSearch')" /></label>
      <div v-if="syncItems.length === 0" class="empty-state"><Check :size="28" /><strong>{{ t('skillManagerV2.install.syncEmptyTitle') }}</strong><span>{{ t('skillManagerV2.install.syncEmptyDesc') }}</span></div>
      <div v-else class="sync-grid">
        <article v-for="item in syncItems" :key="item.id">
          <div class="sync-card-head">
            <AgentIconBadge v-if="item.agentId" :badge="agentBadge(item.agentId, store.agents.find((agent) => agent.id === item.agentId)?.displayName ?? item.agentId)" :size="34" />
            <span><strong>{{ item.inferredSkillId ?? item.id }}</strong><small>{{ store.agents.find((agent) => agent.id === item.agentId)?.displayName ?? item.agentId }}</small></span>
            <button v-if="item.reason.toLowerCase().includes('differs')" class="sync-conflict-button" @click="openSyncAdopt(item)"><AlertTriangle :size="14" />{{ t('skillManagerV2.status.conflict') }}</button>
            <button v-else class="sync-adopt-button" :title="t('skillManagerV2.install.adoptConfirm')" @click="openSyncAdopt(item)"><Plus :size="18" /></button>
          </div>
          <p>{{ item.reason }}</p><code>{{ item.path }}</code>
        </article>
      </div>
    </section>

    <section v-else-if="activeSubtab === 'local'" class="form-panel local-panel">
      <header><h3>{{ t('skillManagerV2.install.localTitle') }}</h3><p>{{ t('skillManagerV2.install.localDesc') }}</p></header>
      <div class="source-options">
        <button @click="chooseLocalFolder"><FolderOpen :size="28" /><strong>{{ t('skillManagerV2.import.selectFolder') }}</strong></button>
        <button @click="chooseLocalArchive"><Archive :size="28" /><strong>ZIP</strong></button>
      </div>
      <div class="drop-zone" :class="{ active: localDragActive }" @dragenter.prevent="localDragActive = true" @dragover.prevent @dragleave.prevent="localDragActive = false" @drop.prevent="handleLocalDrop">
        <Download :size="20" /><span>{{ t('skillManagerV2.install.localDrop') }}</span>
      </div>
      <label class="field"><span>{{ t('skillManagerV2.import.selectFolder') }}</span><input v-model="localPath" :placeholder="t('skillManagerV2.import.folderPlaceholder')" /></label>
      <div v-if="localSourceType === 'local_folder'" class="mode-options">
        <label :class="{ active: localImportMode === 'copy' }"><input v-model="localImportMode" type="radio" value="copy" /><span><strong>{{ t('skillManagerV2.install.localCopyTitle') }}</strong><small>{{ t('skillManagerV2.install.localCopyDesc') }}</small></span></label>
        <label :class="{ active: localImportMode === 'link' }"><input v-model="localImportMode" type="radio" value="link" /><span><strong>{{ t('skillManagerV2.install.localLinkTitle') }}</strong><small>{{ t('skillManagerV2.install.localLinkDesc') }}</small></span></label>
      </div>
      <div v-if="localError" class="inline-error">{{ localError }}</div>
      <div class="button-row"><button class="btn primary" :disabled="!localPath.trim()" @click="previewLocalImport">{{ t('skillManagerV2.install.localPreview') }}</button></div>
    </section>

    <section v-else class="form-panel git-panel">
      <header><h3>{{ t('skillManagerV2.install.githubTitle') }}</h3><p>{{ t('skillManagerV2.install.githubDesc') }}</p></header>
      <template v-if="!githubClonedPath && !githubImportSuccess">
        <div class="git-form-box">
          <label class="field full"><span>{{ t('skillManagerV2.install.githubUrlLabel') }}</span><input v-model="githubUrl" :placeholder="t('skillManagerV2.install.githubUrlPlaceholder')" @keydown.enter="handleGithubClone" /></label>
          <label class="field"><span>{{ t('skillManagerV2.install.githubBranchLabel') }}</span><input v-model="githubBranch" :placeholder="t('skillManagerV2.install.githubBranchPlaceholder')" /></label>
          <label class="field"><span>{{ t('skillManagerV2.install.githubSubPathLabel') }}</span><input v-model="githubSubPath" :placeholder="t('skillManagerV2.install.githubSubPathPlaceholder')" /></label>
        </div>
        <div v-if="githubError" class="inline-error">{{ githubError }}</div>
        <div class="button-row"><button class="btn primary" :disabled="githubCloning || !githubUrl.trim()" @click="handleGithubClone"><Loader2 v-if="githubCloning" class="spin" :size="15" /><Search v-else :size="15" />{{ githubCloning ? t('skillManagerV2.install.githubCloning') : t('skillManagerV2.install.githubCloneBtn') }}</button></div>
      </template>
      <template v-else-if="githubClonedPath && !githubImportSuccess">
        <div class="clone-result"><Check :size="20" /><strong>{{ t('skillManagerV2.install.githubCloneSuccess') }}</strong><code>{{ githubClonedPath }}</code></div>
        <div v-if="githubImportError" class="inline-error">{{ githubImportError }}</div>
        <div class="button-row"><button class="btn primary" :disabled="githubImporting" @click="handleGithubImport">{{ githubImporting ? t('skillManagerV2.install.githubImporting') : t('skillManagerV2.install.githubImportBtn') }}</button><button class="btn" @click="resetGithub">{{ t('common.cancel') }}</button></div>
      </template>
      <div v-else class="success-state"><Check :size="30" /><strong>{{ t('skillManagerV2.install.githubImportSuccess') }}</strong><button class="btn" @click="resetGithub">{{ t('skillManagerV2.install.githubCloneBtn') }}</button></div>
    </section>

    <div v-if="selectedMarketSkill" class="detail-backdrop" @click.self="selectedMarketSkill = null">
      <aside class="market-detail">
        <header><div><strong>{{ selectedMarketSkill.name }}</strong><span>{{ selectedMarketSkill.source }}</span></div><div><button class="btn compact" @click="api.openExternal(marketGithubUrl(selectedMarketSkill))">GitHub <ExternalLink :size="13" /></button><button class="icon-button" :title="t('common.close')" @click="selectedMarketSkill = null"><X :size="20" /></button></div></header>
        <div class="detail-scroll">
          <section class="detail-hero"><span class="skill-avatar large">{{ selectedMarketSkill.name.slice(0, 2).toUpperCase() }}</span><div><small>{{ t('skillManagerV2.install.marketplaceDetailKicker') }}</small><h3>{{ selectedMarketSkill.name }}</h3><p><span>{{ selectedMarketSkill.source }}</span><span><Download :size="13" />{{ formatInstallCount(selectedMarketSkill.installs) }}</span><span v-if="isInstalled(selectedMarketSkill)" class="installed-label"><Check :size="13" />{{ t('skillManagerV2.install.marketplaceInstalled') }}</span></p></div></section>
          <section class="detail-stats"><div><span>{{ t('skillManagerV2.install.marketplaceDetailSegments') }}</span><strong>{{ selectedMarketPath.length }}</strong></div><div><span>{{ t('skillManagerV2.install.marketplaceDetailSource') }}</span><strong>{{ selectedMarketSkill.source }}</strong></div><div><span>{{ t('skillManagerV2.install.marketplaceDetailInstallCount') }}</span><strong>{{ formatInstallCount(selectedMarketSkill.installs) }}</strong></div></section>
          <section class="detail-section"><h4>{{ t('skillManagerV2.install.marketplaceDetailDescription') }}</h4><p v-if="marketDetailLoading"><Loader2 class="spin" :size="16" /></p><p v-else>{{ selectedMarketDescription || t('skillManagerV2.empty.noDescription') }}</p></section>
          <section class="detail-section"><h4>{{ t('skillManagerV2.install.marketplaceDetailPath') }}</h4><div class="breadcrumbs"><span v-for="(part, index) in selectedMarketPath" :key="`${part}-${index}`"><i v-if="index">/</i>{{ part }}</span></div></section>
          <section class="install-command"><span>{{ t('skillManagerV2.install.marketplaceDetailCommand') }}</span><code>{{ marketInstallCommand(selectedMarketSkill) }}</code></section>
          <section class="detail-section"><h4>{{ t('skillManagerV2.install.marketplaceDetailInfo') }}</h4><dl><div><dt>{{ t('skillManagerV2.install.marketplaceDetailDownload') }}</dt><dd>skillssh:{{ selectedMarketSkill.source }}/{{ selectedMarketSkill.skillId }}</dd></div><div><dt>{{ t('skillManagerV2.install.marketplaceDetailSource') }}</dt><dd>skills.sh</dd></div></dl></section>
          <div class="detail-actions"><button class="btn primary" :disabled="isInstalling(selectedMarketSkill) || isInstalled(selectedMarketSkill)" @click="handleMarketplaceInstall(selectedMarketSkill)">{{ isInstalled(selectedMarketSkill) ? t('skillManagerV2.install.marketplaceInstalled') : t('skillManagerV2.install.marketplaceInstall') }}</button><button class="btn" @click="api.openExternal(marketSourceUrl(selectedMarketSkill))">{{ t('skillManagerV2.install.marketplaceDetailSourcePage') }} <ExternalLink :size="13" /></button><button class="btn" @click="api.openExternal(marketSkillUrl(selectedMarketSkill))">{{ t('skillManagerV2.install.marketplaceDetailSkillPage') }} <ExternalLink :size="13" /></button></div>
        </div>
      </aside>
    </div>

    <ImportDialog ref="importDialog" />
    <MigrationWizard :visible="syncWizardVisible" @close="syncWizardVisible = false" @completed="syncWizardVisible = false" />

    <div v-if="syncDialogItem" class="adopt-backdrop" @click.self="closeSyncAdopt">
      <section class="adopt-dialog" role="dialog" aria-modal="true" :aria-label="t('skillManagerV2.install.adoptTitle', { skill: syncDialogItem.inferredSkillId ?? syncDialogItem.id })">
        <header class="adopt-dialog-header">
          <h2>{{ t('skillManagerV2.install.adoptTitle', { skill: syncDialogItem.inferredSkillId ?? syncDialogItem.id }) }}</h2>
          <button class="icon-button" :disabled="syncDialogBusy" :title="t('common.close')" @click="closeSyncAdopt"><X :size="20" /></button>
        </header>
        <div class="adopt-dialog-body">
          <div v-if="syncDialogLoading" class="loading-state"><Loader2 class="spin" :size="22" />{{ t('common.loading') }}</div>
          <template v-else-if="syncDialogPreview">
            <div class="adopt-summary">
              <div><span>{{ t('skillManagerV2.install.adoptSkill') }}</span><strong>{{ syncDialogPreview.inferredSkillId }}</strong></div>
              <div><span>{{ t('skillManagerV2.install.adoptCenterName') }}</span><strong>{{ syncDialogPreview.centerHasSameName ? t('skillManagerV2.install.adoptExists') : t('skillManagerV2.install.adoptNoConflict') }}</strong></div>
              <div class="adopt-summary-path"><span>{{ t('skillManagerV2.install.adoptAgentPath') }}</span><code>{{ syncDialogItem.path }}</code></div>
            </div>
            <div class="adopt-section-head"><h3>{{ t('skillManagerV2.install.adoptMethod') }}</h3><span>{{ syncDialogPreview.centerHasSameName ? t('skillManagerV2.install.adoptNeedsConflict') : t('skillManagerV2.install.adoptCanImport') }}</span></div>
            <div class="adopt-options" role="radiogroup">
              <label v-for="option in syncDialogPreview.options" :key="option" class="adopt-option" :class="{ active: syncDialogOption === option, destructive: option === 'center_over_agent' || option === 'overwrite_center' || option === 'import_link' || option === 'import_copy' || option === 'import_cleanup' }">
                <input v-model="syncDialogOption" type="radio" name="adopt-option" :value="option" />
                <span class="adopt-radio" />
                <span><strong>{{ adoptOptionTitle(option) }}</strong><small>{{ adoptOptionDescription(option) }}</small></span>
                <em v-if="option === syncDialogPreview.options[0] && option !== 'skip'">{{ t('skillManagerV2.install.adoptRecommended') }}</em>
              </label>
            </div>
            <label v-if="syncDialogOption === 'rename'" class="adopt-rename"><span>{{ t('skillManagerV2.install.adoptRenameLabel') }}</span><input v-model="syncDialogRenamedId" :placeholder="t('skillManagerV2.install.adoptRenamePlaceholder', { skill: syncDialogPreview.inferredSkillId })" /></label>
            <div v-if="syncDialogPreview.conflictReason" class="adopt-impact"><strong>{{ t('skillManagerV2.status.conflict') }}</strong><span>{{ syncDialogPreview.conflictReason }}</span></div>
          </template>
          <div v-if="syncDialogError" class="inline-error">{{ syncDialogError }}</div>
        </div>
        <footer class="adopt-dialog-footer"><button class="btn" :disabled="syncDialogBusy" @click="closeSyncAdopt">{{ t('common.cancel') }}</button><button class="btn primary" :disabled="syncDialogBusy || syncDialogLoading || (syncDialogOption === 'rename' && !syncDialogRenamedId.trim())" @click="executeSyncAdopt">{{ syncDialogOption === 'skip' ? t('skillManagerV2.install.adoptKeepUnmanaged') : t('skillManagerV2.install.adoptConfirm') }}</button></footer>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.install-page { height: 100%; min-height: 0; display: flex; flex-direction: column; padding: 0 20px; color: var(--text-primary); }
.install-tabs { flex-shrink: 0; display: flex; gap: 22px; min-height: 48px; border-bottom: 1px solid var(--border-default); background: var(--bg-primary); overflow-x: auto; }
.install-tabs button { position: relative; display: inline-flex; align-items: center; gap: 7px; padding: 0 2px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-muted); font-size: 13px; font-weight: 700; white-space: nowrap; cursor: pointer; }
.install-tabs button:hover, .install-tabs button.active { color: var(--accent-primary); }
.install-tabs button.active { border-bottom-color: var(--accent-primary); }
.tab-count { min-width: 18px; height: 18px; display: grid; place-items: center; padding: 0 5px; border-radius: 999px; background: var(--accent-primary-glow); font-size: 10px; }
.market-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; padding-top: 20px; }
.market-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
.sync-panel, .form-panel { flex: 1; min-height: 0; overflow-y: auto; padding-top: 20px; padding-bottom: 32px; }
.market-toolbar, .publisher-row, .market-caption { flex-shrink: 0; }
.market-toolbar { display: grid; grid-template-columns: auto minmax(220px, 1fr) auto; gap: 14px; align-items: center; padding: 10px 12px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }
.market-board, .view-toggle { display: flex; padding: 3px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--surface-soft); }
.market-board button, .view-toggle button { height: 28px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 0 10px; border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--text-muted); cursor: pointer; }
.market-board button.active, .view-toggle button.active { background: var(--accent-primary); color: var(--text-on-accent, white); }
.market-search, .sync-search { height: 36px; display: grid; grid-template-columns: 22px 1fr; align-items: center; padding: 0 11px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-soft); color: var(--text-muted); }
.market-search:focus-within, .sync-search:focus-within { border-color: var(--accent-primary); box-shadow: 0 0 0 3px var(--accent-primary-glow); }
.market-search input, .sync-search input { min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; }
.publisher-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding: 10px 12px; overflow-x: auto; border: 1px solid var(--border-default); border-radius: var(--radius-md); }
.publisher-row > span { flex: 0 0 auto; color: var(--text-muted); font-size: 11px; font-weight: 700; }
.publisher-row button { flex: 0 0 auto; height: 26px; padding: 0 10px; border: 1px solid var(--border-default); border-radius: 999px; background: transparent; color: var(--text-secondary); font-size: 11px; cursor: pointer; }
.publisher-row button:hover, .publisher-row button.active { border-color: var(--accent-primary); color: var(--accent-primary); background: var(--accent-primary-glow); }
.publisher-row small { color: var(--text-muted); }
.publisher-row .publisher-clear { width: 28px; display: grid; place-items: center; padding: 0; border-radius: 50%; }
.market-caption { margin: 15px 2px 10px; color: var(--text-muted); font-size: 12px; }
.market-results { flex-shrink: 0; }
.market-results.is-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.market-results.is-list { display: grid; gap: 6px; }
// ── 卡片视图（对齐技能库 slp-card 视觉语言） ──────────────────
.market-card { min-width: 0; min-height: 150px; display: flex; flex-direction: column; gap: 14px; padding: 18px; border: 1px solid var(--border-default); border-radius: 12px; background: var(--bg-elevated); cursor: pointer; transition: transform .18s, border-color .18s, box-shadow .18s; }
.market-card:hover, .market-card:focus-visible { border-color: color-mix(in srgb, var(--accent-primary) 48%, var(--border-default)); box-shadow: 0 12px 28px color-mix(in srgb, var(--accent-primary) 12%, transparent); outline: 0; transform: translateY(-2px); }
.market-card-head { min-width: 0; display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 12px; align-items: start; }
.market-glyph { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 11px; background: var(--text-primary); color: var(--bg-primary); font-size: 14px; font-weight: 800; }
.market-glyph.sm { width: 30px; height: 30px; border-radius: 8px; font-size: 10px; }
.market-card-info { min-width: 0; }
.market-card-info h3 { margin: 1px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-display); font-size: 16px; font-weight: 750; }
.market-card-info p { display: -webkit-box; margin: 7px 0 0; overflow: hidden; color: var(--text-secondary); font-size: 12px; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.market-card-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: auto; }
.market-chip { min-height: 22px; display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; border-radius: 999px; background: var(--surface-soft); color: var(--text-muted); font-size: 10px; font-weight: 700; }
.market-card-actions { margin-left: auto; display: inline-flex; }
// ── 列表视图（紧凑行） ──────────────────────────────────────
.market-row { min-width: 0; display: grid; grid-template-columns: 30px minmax(0, 1fr) auto 30px; gap: 10px; align-items: center; min-height: 58px; padding: 8px 14px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); cursor: pointer; transition: border-color 160ms ease, transform 160ms ease; }
.market-row:hover, .market-row:focus-visible { border-color: color-mix(in srgb, var(--accent-primary) 45%, var(--border-default)); outline: 0; transform: translateY(-1px); }
.market-row-copy { min-width: 0; }
.market-row-copy strong, .market-row-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.market-row-copy strong { font-size: 13px; }
.market-row-copy span { margin-top: 4px; color: var(--text-muted); font-size: 11px; }
.skill-avatar { width: 38px; height: 38px; display: grid; place-items: center; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--accent-primary) 10%, var(--surface-card)); color: var(--accent-primary); font-size: 11px; font-weight: 800; }
.skill-avatar.large { width: 54px; height: 54px; font-size: 15px; }
.install-count { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.skill-action, .icon-button { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--accent-primary); border-radius: 50%; background: var(--accent-primary); color: var(--text-on-accent, white); cursor: pointer; }
.skill-action.installed { border-color: color-mix(in srgb, var(--success) 35%, var(--border-default)); background: color-mix(in srgb, var(--success) 10%, transparent); color: var(--success); }
.skill-action:disabled { cursor: default; }
.market-pagination { position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 16px; padding: 10px 0 2px; border-top: 1px solid var(--border-default); background: var(--bg-primary); }
.page-btn { min-width: 30px; height: 30px; display: inline-grid; place-items: center; padding: 0 8px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-elevated); color: var(--text-secondary); font-size: 12px; font-weight: 700; cursor: pointer; }
.page-btn:hover:not(:disabled):not(.active) { border-color: var(--accent-primary); color: var(--accent-primary); }
.page-btn.active { border-color: var(--accent-primary); background: var(--accent-primary); color: var(--text-on-accent, white); }
.page-btn:disabled { opacity: .45; cursor: not-allowed; }
.page-ellipsis { color: var(--text-muted); font-size: 12px; }
.loading-state, .empty-state { flex: 1; min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--text-muted); font-size: 13px; }
.inline-error { margin: 12px 0; padding: 10px 12px; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--error) 9%, transparent); color: var(--error); font-size: 12px; }
.sync-panel { display: grid; gap: 12px; }
.sync-summary { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 18px; border: 1px solid color-mix(in srgb, var(--accent-primary) 22%, var(--border-default)); border-radius: var(--radius-md); background: color-mix(in srgb, var(--accent-primary) 5%, var(--bg-elevated)); }
.sync-summary strong { font-size: 17px; }
.sync-summary p { max-width: 72ch; margin: 6px 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.sync-summary span { color: var(--warning); font-size: 11px; font-weight: 600; }
.button-row { display: flex; gap: 8px; align-items: center; }
.btn { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 15px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-weight: 700; cursor: pointer; }
.btn:hover:not(:disabled) { border-color: var(--border-strong); background: var(--bg-hover); }
.btn.primary { border-color: var(--accent-primary); background: var(--accent-primary); color: var(--text-on-accent, white); }
.btn.compact { min-height: 30px; padding: 0 10px; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.notice { padding: 9px 12px; border: 1px solid color-mix(in srgb, var(--success) 25%, var(--border-default)); border-radius: var(--radius-sm); color: var(--success); font-size: 12px; }
.agent-strip { display: flex; gap: 8px; padding: 8px; overflow-x: auto; border: 1px solid var(--border-default); border-radius: var(--radius-md); }
.agent-strip > button { min-width: 150px; height: 56px; display: grid; grid-template-columns: 32px 1fr; gap: 8px; align-items: center; padding: 0 10px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text-primary); text-align: left; cursor: pointer; }
.agent-strip > button.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); }
.agent-strip strong, .agent-strip small { display: block; }
.agent-strip strong { font-size: 12px; }.agent-strip small { margin-top: 3px; color: var(--text-muted); font-size: 10px; }
.agent-glyph { width: 30px; height: 30px; display: grid; place-items: center; border-radius: var(--radius-sm); background: var(--surface-soft); color: var(--accent-primary); font-size: 11px; font-weight: 800; }
.sync-search { width: min(380px, 100%); }
.sync-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.sync-grid article { min-width: 0; padding: 14px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }
.sync-card-head { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 9px; align-items: center; }
.sync-card-head strong, .sync-card-head small { display: block; }.sync-card-head strong { font-size: 13px; }.sync-card-head small { margin-top: 3px; color: var(--text-muted); font-size: 10px; }
.sync-adopt-button { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 50%; background: var(--accent-primary); color: var(--text-on-accent, white); cursor: pointer; box-shadow: 0 8px 18px color-mix(in srgb, var(--accent-primary) 22%, transparent); }
.sync-conflict-button { min-height: 30px; display: inline-flex; align-items: center; gap: 5px; padding: 0 9px; border: 1px solid color-mix(in srgb, var(--warning) 45%, var(--border-default)); border-radius: var(--radius-md); background: color-mix(in srgb, var(--warning) 8%, var(--bg-elevated)); color: var(--warning); font-size: 11px; font-weight: 700; cursor: pointer; }
.sync-grid p { min-height: 34px; margin: 10px 0 7px; color: var(--text-muted); font-size: 11px; line-height: 1.45; }
.sync-grid code { display: block; overflow: hidden; color: var(--text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.form-panel { max-width: 900px; }
.form-panel header h3 { margin: 0; font: 700 18px/1.25 var(--font-display); }.form-panel header p { margin: 7px 0 20px; color: var(--text-muted); font-size: 13px; }
.source-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.source-options button { min-height: 132px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 13px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-soft); color: var(--text-primary); cursor: pointer; }
.source-options button:hover { border-color: var(--accent-primary); color: var(--accent-primary); }
.drop-zone { min-height: 54px; display: flex; align-items: center; justify-content: center; gap: 8px; margin: 12px 0; border: 1px dashed var(--border-default); border-radius: var(--radius-md); color: var(--text-muted); font-size: 11px; }
.drop-zone.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); color: var(--accent-primary); }
.field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }.field span { color: var(--text-secondary); font-size: 12px; font-weight: 700; }
.field input { height: 40px; padding: 0 12px; border: 1px solid var(--border-default); border-radius: var(--radius-md); outline: 0; background: var(--surface-soft); color: var(--text-primary); font: inherit; }.field input:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 3px var(--accent-primary-glow); }
.mode-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 14px 0; }
.mode-options label { min-height: 112px; display: grid; grid-template-columns: 20px 1fr; gap: 10px; align-items: start; padding: 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; }.mode-options label.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); }
.mode-options strong, .mode-options small { display: block; }.mode-options strong { font-size: 13px; }.mode-options small { margin-top: 7px; color: var(--text-muted); font-size: 11px; line-height: 1.5; }
.local-panel .button-row, .git-panel > .button-row { margin-top: 16px; }
.git-form-box { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; padding: 18px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }.git-form-box .full { grid-column: 1 / -1; }
.clone-result { display: grid; grid-template-columns: 24px 1fr; gap: 10px; align-items: center; padding: 18px; border: 1px solid color-mix(in srgb, var(--success) 25%, var(--border-default)); border-radius: var(--radius-md); color: var(--success); }.clone-result code { grid-column: 1 / -1; padding: 10px; overflow-wrap: anywhere; border-radius: var(--radius-sm); background: var(--surface-soft); color: var(--text-secondary); }
.success-state { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: var(--success); }
.detail-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; justify-content: flex-end; background: color-mix(in srgb, var(--text-primary) 35%, transparent); }
.market-detail { width: min(720px, calc(100vw - 280px)); height: 100%; display: flex; flex-direction: column; background: var(--bg-primary); box-shadow: var(--shadow-lg); }
.market-detail > header { min-height: 70px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 0 20px; border-bottom: 1px solid var(--border-default); background: var(--bg-elevated); }.market-detail > header > div { min-width: 0; }.market-detail > header strong, .market-detail > header span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.market-detail > header strong { font-size: 18px; }.market-detail > header span { margin-top: 4px; color: var(--text-muted); font-size: 12px; }.market-detail > header > div:last-child { display: flex; align-items: center; gap: 8px; }
.icon-button { border-color: transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); }.icon-button:hover { background: var(--bg-hover); color: var(--text-primary); }
.detail-scroll { padding: 20px; overflow-y: auto; }
.detail-hero { display: grid; grid-template-columns: 56px 1fr; gap: 14px; align-items: center; padding: 20px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }.detail-hero small { color: var(--text-muted); font-size: 10px; font-weight: 800; }.detail-hero h3 { margin: 5px 0 8px; font-size: 24px; }.detail-hero p { display: flex; flex-wrap: wrap; gap: 7px; margin: 0; }.detail-hero p > span { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 999px; background: var(--surface-soft); color: var(--text-secondary); font-size: 11px; }.detail-hero p > .installed-label { background: color-mix(in srgb, var(--success) 10%, transparent); color: var(--success); }
.detail-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }.detail-stats > div { min-width: 0; padding: 14px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }.detail-stats span, .detail-stats strong { display: block; }.detail-stats span { color: var(--text-muted); font-size: 11px; }.detail-stats strong { margin-top: 8px; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.detail-section { margin-top: 12px; padding: 16px 18px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }.detail-section h4 { margin: 0 0 10px; font-size: 12px; }.detail-section p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }.breadcrumbs { display: flex; flex-wrap: wrap; gap: 6px; color: var(--success); font-size: 12px; font-weight: 700; }.breadcrumbs i { margin-right: 6px; color: var(--text-muted); font-style: normal; }.install-command { margin-top: 12px; padding: 15px 18px; border-radius: var(--radius-md); background: oklch(0.22 0.02 270); color: oklch(0.92 0.01 270); }.install-command span { display: block; margin-bottom: 9px; color: oklch(0.7 0.02 270); font-size: 11px; }.install-command code { font-size: 12px; overflow-wrap: anywhere; }.detail-section dl { margin: 0; }.detail-section dl > div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px; padding: 7px 0; }.detail-section dt { color: var(--text-muted); font-size: 11px; }.detail-section dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--text-secondary); font-size: 12px; }.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.adopt-backdrop { position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center; padding: 20px; background: color-mix(in srgb, var(--text-primary) 38%, transparent); }
.adopt-dialog { width: min(760px, 100%); max-height: min(820px, 92vh); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border-default); border-radius: var(--radius-lg); background: var(--bg-primary); color: var(--text-primary); box-shadow: var(--shadow-lg); }
.adopt-dialog-header, .adopt-dialog-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 20px 24px; border-bottom: 1px solid var(--border-default); background: var(--bg-elevated); }
.adopt-dialog-header h2 { margin: 0; font: 700 24px/1.2 var(--font-display); }.adopt-dialog-body { padding: 24px; overflow-y: auto; }.adopt-dialog-footer { justify-content: flex-end; border-top: 1px solid var(--border-default); border-bottom: 0; }
.adopt-summary { display: grid; grid-template-columns: minmax(0, 1fr) 180px minmax(0, 2fr); gap: 12px; }.adopt-summary > div { min-width: 0; padding: 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-soft); }.adopt-summary span, .adopt-summary strong { display: block; }.adopt-summary span { color: var(--text-muted); font-size: 12px; }.adopt-summary strong { margin-top: 8px; font-size: 16px; }.adopt-summary code { display: block; margin-top: 8px; overflow: hidden; color: var(--text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.adopt-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 24px 0 12px; }.adopt-section-head h3 { margin: 0; font-size: 16px; }.adopt-section-head span { color: var(--text-muted); font-size: 12px; text-align: right; }.adopt-options { display: grid; gap: 10px; }.adopt-option { position: relative; min-height: 78px; display: grid; grid-template-columns: 18px 18px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 14px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; }.adopt-option:hover { background: var(--surface-soft); }.adopt-option.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); }.adopt-option.destructive.active { border-color: var(--warning); background: color-mix(in srgb, var(--warning) 8%, var(--bg-elevated)); }.adopt-option input { position: absolute; opacity: 0; pointer-events: none; }.adopt-radio { width: 18px; height: 18px; border: 2px solid var(--border-strong); border-radius: 50%; }.adopt-option.active .adopt-radio { border: 5px solid var(--accent-primary); }.adopt-option > span:nth-of-type(2) strong, .adopt-option > span:nth-of-type(2) small { display: block; }.adopt-option > span:nth-of-type(2) strong { font-size: 14px; }.adopt-option > span:nth-of-type(2) small { margin-top: 5px; color: var(--text-muted); font-size: 12px; line-height: 1.45; }.adopt-option em { padding: 4px 8px; border-radius: 999px; background: color-mix(in srgb, var(--success) 12%, transparent); color: var(--success); font-size: 11px; font-style: normal; font-weight: 700; }.adopt-rename { display: grid; gap: 7px; margin-top: 12px; color: var(--text-secondary); font-size: 12px; font-weight: 700; }.adopt-rename input { height: 38px; padding: 0 10px; border: 1px solid var(--border-default); border-radius: var(--radius-md); outline: 0; background: var(--surface-soft); color: var(--text-primary); font: inherit; }.adopt-impact { display: grid; gap: 4px; margin-top: 14px; padding: 14px 16px; border: 1px solid color-mix(in srgb, var(--warning) 32%, var(--border-default)); border-radius: var(--radius-md); background: color-mix(in srgb, var(--warning) 7%, var(--bg-elevated)); }.adopt-impact strong { color: var(--warning); font-size: 13px; }.adopt-impact span { color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.spin { animation: spin 900ms linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 900px) { .market-toolbar { grid-template-columns: 1fr auto; }.market-board { grid-column: 1 / -1; }.market-detail { width: min(720px, 92vw); }.sync-summary { align-items: stretch; flex-direction: column; } }
@media (max-width: 640px) { .install-page { padding-inline: 12px; }.market-toolbar { grid-template-columns: 1fr; }.view-toggle { justify-self: start; }.source-options, .mode-options, .git-form-box, .detail-stats, .adopt-summary { grid-template-columns: 1fr; }.git-form-box .full { grid-column: auto; }.market-detail { width: 100vw; }.detail-hero { grid-template-columns: 44px 1fr; }.button-row { align-items: stretch; flex-direction: column; }.btn { width: 100%; }.adopt-dialog-header, .adopt-dialog-body, .adopt-dialog-footer { padding-inline: 16px; }.adopt-section-head { align-items: flex-start; flex-direction: column; }.adopt-section-head span { text-align: left; }.adopt-option { grid-template-columns: 18px 18px 1fr; }.adopt-option em { grid-column: 3; justify-self: start; } }
</style>

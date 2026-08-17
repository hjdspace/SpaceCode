<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Send, Trash2, X } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { AgentBadge, FileTreeNode, SkillTarget } from '@/types/skillManagerV2'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import AgentIconBadge from './AgentIconBadge.vue'
import DistributeDialog from './DistributeDialog.vue'
import PreviewDialog from './PreviewDialog.vue'
import { SOURCE_LABEL_KEYS, STATUS_CSS_CLASSES, STATUS_LABEL_KEYS } from './skillLabels'

type DetailTab = 'overview' | 'files' | 'agents' | 'source'
type FileViewMode = 'preview' | 'source'
type FileTreeRow = { node: FileTreeNode; depth: number }

const { t } = useI18n()
const store = useSkillManagerStore()

const activeTab = ref<DetailTab>('overview')
const skillDocument = ref('')
const activeFilePath = ref<string | null>(null)
const activeFileContent = ref('')
const fileLoading = ref(false)
const fileViewMode = ref<FileViewMode>('preview')
const expandedDirectories = ref<Set<string>>(new Set())
const distributeVisible = ref(false)
const batchDeleteMode = ref(false)
const selectedTargetIds = ref<Set<string>>(new Set())
const pendingDeleteTargetIds = ref<string[]>([])
const deletingTargets = ref(false)

const visible = computed(() => store.selectedSkillId !== null)
const detail = computed(() => store.selectedSkillDetail)
const loading = computed(() => store.detailLoading)
const sourceLabel = computed(() => detail.value?.source ? t(SOURCE_LABEL_KEYS[detail.value.source.sourceType]) : '—')
const frontmatter = computed<Record<string, unknown> | null>(() => {
  if (!detail.value?.frontmatterJson) return null
  try { return JSON.parse(detail.value.frontmatterJson) as Record<string, unknown> } catch { return null }
})
const files = computed(() => flattenFiles(detail.value?.files ?? null))
const skillMdPath = computed(() => files.value.find((file) => file.name.toLowerCase() === 'skill.md')?.path ?? null)
const renderedDocument = computed(() => skillDocument.value.replace(/^---\s*[\s\S]*?\s*---\s*/, '').trim())
const renderedActiveFile = computed(() => activeFileContent.value.replace(/^---\s*[\s\S]*?\s*---\s*/, '').trim())
const canPreviewActiveFile = computed(() => /\.md$/i.test(activeFilePath.value ?? ''))
const effectiveFileViewMode = computed<FileViewMode>(() => canPreviewActiveFile.value ? fileViewMode.value : 'source')
const fileTreeRows = computed<FileTreeRow[]>(() => buildVisibleTreeRows(detail.value?.files ?? null, expandedDirectories.value))
const selectedTargetCount = computed(() => selectedTargetIds.value.size)
const allTargetsSelected = computed(() => Boolean(detail.value?.targets.length) && selectedTargetCount.value === detail.value?.targets.length)

watch(
  () => detail.value?.id,
  async (skillId) => {
    activeTab.value = 'overview'
    skillDocument.value = ''
    activeFilePath.value = null
    activeFileContent.value = ''
    fileViewMode.value = 'preview'
    batchDeleteMode.value = false
    selectedTargetIds.value = new Set()
    pendingDeleteTargetIds.value = []
    expandedDirectories.value = collectDirectoryPaths(detail.value?.files ?? null)
    if (!skillId || !skillMdPath.value) return
    const requestedPath = skillMdPath.value
    const content = await api.readFile(requestedPath)
    if (detail.value?.id !== skillId) return
    skillDocument.value = content ?? ''
    activeFilePath.value = requestedPath
    activeFileContent.value = content ?? ''
  },
)

function flattenFiles(node: FileTreeNode | null): FileTreeNode[] {
  if (!node) return []
  const result: FileTreeNode[] = []
  const visit = (current: FileTreeNode): void => {
    if (current.nodeType === 'file') result.push(current)
    current.children?.forEach(visit)
  }
  visit(node)
  return result
}

function collectDirectoryPaths(node: FileTreeNode | null): Set<string> {
  const paths = new Set<string>()
  const visit = (current: FileTreeNode): void => {
    if (current.nodeType !== 'dir') return
    paths.add(current.path)
    current.children?.forEach(visit)
  }
  if (node) visit(node)
  return paths
}

function buildVisibleTreeRows(node: FileTreeNode | null, expanded: Set<string>): FileTreeRow[] {
  if (!node) return []
  const rows: FileTreeRow[] = []
  const visit = (current: FileTreeNode, depth: number): void => {
    rows.push({ node: current, depth })
    if (current.nodeType === 'dir' && expanded.has(current.path)) {
      current.children?.forEach((child) => visit(child, depth + 1))
    }
  }
  visit(node, 0)
  return rows
}

function toggleDirectory(path: string): void {
  const next = new Set(expandedDirectories.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expandedDirectories.value = next
}

function handleClose(): void {
  distributeVisible.value = false
  store.clearSelectedSkill()
}

async function handleOpenPath(): Promise<void> {
  if (detail.value) await store.openPath(detail.value.centerPath)
}

function handleDelete(): void {
  if (store.selectedSkillId) store.busyAction = 'preview-delete'
}

async function selectFile(file: FileTreeNode): Promise<void> {
  if (file.nodeType !== 'file') return
  activeTab.value = 'files'
  activeFilePath.value = file.path
  fileViewMode.value = /\.md$/i.test(file.path) ? 'preview' : 'source'
  fileLoading.value = true
  try {
    activeFileContent.value = (await api.readFile(file.path)) ?? ''
  } finally {
    fileLoading.value = false
  }
}

function fileName(filePath: string | null): string {
  return filePath?.split(/[\\/]/).pop() ?? ''
}

function relativeFilePath(filePath: string | null): string {
  if (!filePath || !detail.value) return t('skillManagerV2.detail.chooseFile')
  const root = detail.value.centerPath.replace(/[\\/]+$/, '')
  return filePath.startsWith(root) ? filePath.slice(root.length).replace(/^[\\/]/, '') : filePath
}

async function openTarget(target: SkillTarget): Promise<void> {
  await store.openPath(target.targetPath)
}

function requestDeleteTargets(targetIds: string[]): void {
  pendingDeleteTargetIds.value = [...targetIds]
}

function cancelDeleteTargets(): void {
  if (deletingTargets.value) return
  pendingDeleteTargetIds.value = []
}

async function confirmDeleteTargets(): Promise<void> {
  const skillId = detail.value?.id
  if (!skillId || pendingDeleteTargetIds.value.length === 0) return
  deletingTargets.value = true
  try {
    for (const targetId of pendingDeleteTargetIds.value) await store.deleteTarget(targetId)
    await store.loadSkillDetail(skillId)
    pendingDeleteTargetIds.value = []
    batchDeleteMode.value = false
    selectedTargetIds.value = new Set()
  } finally {
    deletingTargets.value = false
  }
}

function toggleTargetSelection(targetId: string): void {
  const next = new Set(selectedTargetIds.value)
  if (next.has(targetId)) next.delete(targetId)
  else next.add(targetId)
  selectedTargetIds.value = next
}

function toggleAllTargets(): void {
  selectedTargetIds.value = allTargetsSelected.value
    ? new Set()
    : new Set(detail.value?.targets.map((target) => target.id) ?? [])
}

function cancelBatchDelete(): void {
  batchDeleteMode.value = false
  selectedTargetIds.value = new Set()
}

function targetClaims(targetId: string): string[] {
  const claims = detail.value?.claims.filter((claim) => claim.targetId === targetId) ?? []
  if (claims.length === 0) return [t('skillManagerV2.detail.directDistribution')]
  return claims.map((claim) => claim.claimType === 'direct'
    ? t('skillManagerV2.detail.directDistribution')
    : claim.packId
      ? t('skillManagerV2.detail.packDistributionNamed', { name: claim.packId })
      : t('skillManagerV2.detail.packDistribution'))
}

function agentBadge(agentId: string, mode: AgentBadge['mode'] = 'link', status: AgentBadge['status'] = 'ok'): AgentBadge {
  return {
    agentId,
    agentName: store.agents.find((agent) => agent.id === agentId)?.displayName ?? agentId,
    mode,
    status,
  }
}
</script>

<template>
  <Transition name="sds-fade">
    <div v-if="visible" class="sds-overlay" @click.self="handleClose">
      <Transition name="sds-slide" appear>
        <aside class="sds-panel" aria-modal="true" role="dialog">
          <div v-if="loading || !detail" class="sds-loading">
            <div class="sds-loading-head" />
            <div class="sds-loading-tabs" />
            <div class="sds-loading-body" />
          </div>

          <template v-else>
            <header class="sds-header">
              <div class="sds-title-block">
                <h2>{{ detail.name }}</h2>
                <div class="sds-tags">
                  <span class="sds-status" :class="STATUS_CSS_CLASSES['ok']">{{ t(STATUS_LABEL_KEYS.ok) }}</span>
                  <span>{{ sourceLabel }}</span>
                  <span>{{ detail.skillType }}</span>
                </div>
              </div>
              <div class="sds-actions">
                <button class="sds-btn sds-btn-primary" type="button" @click="distributeVisible = true"><Send :size="16" />{{ t('skillManagerV2.actions.distribute') }}</button>
                <button class="sds-btn" type="button" @click="handleOpenPath"><FolderOpen :size="16" />{{ t('skillManagerV2.actions.openPath') }}</button>
                <button class="sds-btn sds-btn-danger" type="button" @click="handleDelete"><Trash2 :size="16" />{{ t('skillManagerV2.actions.delete') }}</button>
                <button class="sds-icon-btn" type="button" :title="t('common.close')" @click="handleClose"><X :size="20" /></button>
              </div>
            </header>

            <nav class="sds-tabs">
              <button v-for="tab in (['overview', 'files', 'agents', 'source'] as DetailTab[])" :key="tab" type="button" :class="{ active: activeTab === tab }" @click="activeTab = tab">
                {{ t(`skillManagerV2.detail.tabs.${tab}`, { count: tab === 'agents' ? detail.targets.length : files.length }) }}
              </button>
            </nav>

            <div class="sds-body">
              <div v-if="activeTab === 'overview'" class="sds-overview">
                <main class="sds-reader">
                  <div class="sds-doc-heading">
                    <div><span>SKILL.md</span><h3>{{ t('skillManagerV2.detail.documentation') }}</h3></div>
                    <span class="sds-status" :class="STATUS_CSS_CLASSES.ok">{{ t(STATUS_LABEL_KEYS.ok) }}</span>
                  </div>
                  <div class="sds-description"><strong>{{ t('skillManagerV2.detail.description') }}</strong><p>{{ detail.description || t('skillManagerV2.empty.noDescription') }}</p></div>
                  <div class="sds-markdown-shell">
                    <MarkdownRenderer v-if="renderedDocument" :content="renderedDocument" :file-path="skillMdPath ?? undefined" />
                    <p v-else class="sds-muted">{{ t('skillManagerV2.detail.noDocument') }}</p>
                  </div>
                </main>
                <aside class="sds-aside">
                  <section><header><strong>{{ t('skillManagerV2.detail.installedAgents') }}</strong><span>{{ detail.targets.length }}</span></header><p v-if="detail.targets.length === 0" class="sds-muted">{{ t('skillManagerV2.detail.noTargets') }}</p><div v-else class="sds-agent-stack"><div v-for="target in detail.targets" :key="target.id"><AgentIconBadge :badge="agentBadge(target.agentId, target.actualMode, target.status)" :size="30" /><span><strong>{{ store.agents.find((agent) => agent.id === target.agentId)?.displayName ?? target.agentId }}</strong><small>{{ target.actualMode === 'link' ? t('skillManagerV2.settings.modeLink') : t('skillManagerV2.settings.modeCopy') }}</small></span></div></div></section>
                  <section><header><strong>{{ t('skillManagerV2.detail.information') }}</strong></header><dl><dt>{{ t('skillManagerV2.detail.source') }}</dt><dd>{{ sourceLabel }}</dd><dt>{{ t('skillManagerV2.detail.centerPath') }}</dt><dd class="selectable">{{ detail.centerPath }}</dd><dt>{{ t('skillManagerV2.detail.hash') }}</dt><dd>{{ detail.currentHash.slice(0, 16) }}</dd></dl></section>
                  <section v-if="frontmatter"><header><strong>{{ t('skillManagerV2.detail.frontmatter') }}</strong><span>{{ Object.keys(frontmatter).length }}</span></header><pre>{{ JSON.stringify(frontmatter, null, 2) }}</pre></section>
                </aside>
              </div>

              <section v-else-if="activeTab === 'files'" class="sds-file-panel">
                <header class="sds-file-panel-head">
                  <div><h3>{{ t('skillManagerV2.detail.fileBrowserTitle') }}</h3><span>{{ relativeFilePath(activeFilePath) }}</span></div>
                  <strong>{{ t('skillManagerV2.detail.fileCount', { count: files.length }) }}</strong>
                </header>
                <div class="sds-files">
                  <aside class="sds-file-tree">
                    <header><span>{{ t('skillManagerV2.detail.directory') }}</span><strong>{{ files.length }}</strong></header>
                    <div class="sds-file-tree-scroll">
                      <button
                        v-for="row in fileTreeRows"
                        :key="row.node.path"
                        type="button"
                        :class="{ active: activeFilePath === row.node.path, directory: row.node.nodeType === 'dir' }"
                        :style="{ '--tree-depth': row.depth }"
                        @click="row.node.nodeType === 'dir' ? toggleDirectory(row.node.path) : selectFile(row.node)"
                      >
                        <template v-if="row.node.nodeType === 'dir'">
                          <ChevronDown v-if="expandedDirectories.has(row.node.path)" :size="13" />
                          <ChevronRight v-else :size="13" />
                          <Folder :size="16" />
                        </template>
                        <template v-else><span class="sds-tree-spacer" /><FileText :size="15" /></template>
                        <span>{{ row.node.name }}</span>
                      </button>
                      <p v-if="fileTreeRows.length === 0" class="sds-muted">{{ t('skillManagerV2.detail.noFiles') }}</p>
                    </div>
                  </aside>
                  <main class="sds-file-view">
                    <header>
                      <div><strong>{{ fileName(activeFilePath) || t('skillManagerV2.detail.chooseFile') }}</strong><span>{{ relativeFilePath(activeFilePath) }}</span></div>
                      <div class="sds-file-mode" role="group" :aria-label="t('skillManagerV2.detail.fileViewMode')">
                        <button type="button" :class="{ active: effectiveFileViewMode === 'preview' }" :disabled="!canPreviewActiveFile" @click="fileViewMode = 'preview'">{{ t('skillManagerV2.detail.preview') }}</button>
                        <button type="button" :class="{ active: effectiveFileViewMode === 'source' }" @click="fileViewMode = 'source'">{{ t('skillManagerV2.detail.sourceCode') }}</button>
                      </div>
                    </header>
                    <div class="sds-file-content">
                      <div v-if="fileLoading" class="sds-muted">{{ t('skillManagerV2.loading') }}</div>
                      <MarkdownRenderer v-else-if="activeFileContent && effectiveFileViewMode === 'preview'" :content="renderedActiveFile" :file-path="activeFilePath ?? undefined" />
                      <pre v-else>{{ activeFileContent }}</pre>
                    </div>
                  </main>
                </div>
              </section>

              <div v-else-if="activeTab === 'agents'" class="sds-agent-section">
                <section v-if="detail.targets.length === 0" class="sds-empty-panel">{{ t('skillManagerV2.detail.noTargets') }}</section>
                <template v-else>
                  <header class="sds-agent-toolbar">
                    <template v-if="batchDeleteMode">
                      <label><input type="checkbox" :checked="allTargetsSelected" @change="toggleAllTargets" />{{ t('skillManagerV2.detail.selectAll') }}</label>
                      <span>{{ t('skillManagerV2.detail.selectedTargets', { selected: selectedTargetCount, total: detail.targets.length }) }}</span>
                      <div><button class="sds-btn" type="button" @click="cancelBatchDelete">{{ t('skillManagerV2.actions.cancel') }}</button><button class="sds-btn sds-btn-danger" type="button" :disabled="selectedTargetCount === 0" @click="requestDeleteTargets([...selectedTargetIds])">{{ t('skillManagerV2.detail.deleteDistributions', { count: selectedTargetCount }) }}</button></div>
                    </template>
                    <template v-else><span>{{ t('skillManagerV2.detail.manageTargets') }}</span><button class="sds-btn sds-btn-danger" type="button" @click="batchDeleteMode = true">{{ t('skillManagerV2.detail.batchDelete') }}</button></template>
                  </header>
                  <div class="sds-target-grid">
                    <article v-for="target in detail.targets" :key="target.id" class="sds-target-card" :class="[`mode-${target.actualMode}`, { selected: selectedTargetIds.has(target.id) }]">
                      <header>
                        <div class="sds-target-identity">
                          <input v-if="batchDeleteMode" type="checkbox" :checked="selectedTargetIds.has(target.id)" :aria-label="t('skillManagerV2.detail.selectTarget', { name: store.agents.find((agent) => agent.id === target.agentId)?.displayName ?? target.agentId })" @change="toggleTargetSelection(target.id)" />
                          <AgentIconBadge :badge="agentBadge(target.agentId, target.actualMode, target.status)" :size="42" />
                          <div><strong>{{ store.agents.find((agent) => agent.id === target.agentId)?.displayName ?? target.agentId }}</strong><span>{{ target.actualMode === 'link' ? t('skillManagerV2.settings.modeLink') : t('skillManagerV2.settings.modeCopy') }} · {{ t(STATUS_LABEL_KEYS[target.status]) }}</span></div>
                        </div>
                        <span class="sds-target-status" :class="STATUS_CSS_CLASSES[target.status]">{{ t(STATUS_LABEL_KEYS[target.status]) }}</span>
                      </header>
                      <div class="sds-target-chips"><span>{{ target.actualMode === 'link' ? t('skillManagerV2.settings.modeLink') : t('skillManagerV2.settings.modeCopy') }}</span><span v-for="claim in targetClaims(target.id)" :key="claim" class="claim">{{ claim }}</span></div>
                      <div class="sds-target-path"><span>{{ t('skillManagerV2.detail.targetDirectory') }}</span><code>{{ target.targetPath }}</code></div>
                      <footer><button class="sds-btn" type="button" @click="openTarget(target)"><FolderOpen :size="15" />{{ t('skillManagerV2.detail.open') }}</button><button class="sds-btn sds-btn-danger" type="button" :disabled="batchDeleteMode" @click="requestDeleteTargets([target.id])"><Trash2 :size="15" />{{ t('skillManagerV2.detail.deleteDistribution') }}</button></footer>
                    </article>
                  </div>
                </template>
              </div>

              <div v-else class="sds-source-grid">
                <section><span>{{ t('skillManagerV2.detail.source') }}</span><strong>{{ sourceLabel }}</strong></section>
                <section><span>{{ t('skillManagerV2.detail.centerPath') }}</span><code>{{ detail.centerPath }}</code></section>
                <section v-if="detail.source?.sourceUri"><span>URI</span><code>{{ detail.source.sourceUri }}</code></section>
                <section><span>{{ t('skillManagerV2.detail.hash') }}</span><code>{{ detail.currentHash }}</code></section>
                <section><span>{{ t('skillManagerV2.detail.updatedAt') }}</span><strong>{{ detail.updatedAt }}</strong></section>
              </div>
            </div>
          </template>
        </aside>
      </Transition>

      <DistributeDialog v-if="detail" :visible="distributeVisible" :skill-ids="[detail.id]" @close="distributeVisible = false" @distributed="distributeVisible = false" />
      <PreviewDialog
        :visible="pendingDeleteTargetIds.length > 0"
        :title="t(pendingDeleteTargetIds.length > 1 ? 'skillManagerV2.detail.deleteTargetsTitle' : 'skillManagerV2.detail.deleteTargetTitle')"
        :confirm-label="pendingDeleteTargetIds.length > 1 ? t('skillManagerV2.detail.deleteDistributions', { count: pendingDeleteTargetIds.length }) : t('skillManagerV2.detail.deleteDistribution')"
        :busy="deletingTargets"
        destructive
        @cancel="cancelDeleteTargets"
        @confirm="confirmDeleteTargets"
      >
        <p class="sds-delete-warning">{{ t(pendingDeleteTargetIds.length > 1 ? 'skillManagerV2.detail.deleteTargetsWarning' : 'skillManagerV2.detail.deleteTargetWarning', { count: pendingDeleteTargetIds.length }) }}</p>
      </PreviewDialog>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.sds-overlay { position: absolute; inset: 0; z-index: 120; display: flex; justify-content: flex-end; background: color-mix(in srgb, #0b1020 55%, transparent); backdrop-filter: blur(3px); }
.sds-panel { width: min(1180px, calc(100% - 96px)); height: 100%; display: grid; grid-template-rows: auto auto minmax(0, 1fr); overflow: hidden; border-left: 1px solid var(--border-default); background: var(--bg-primary); box-shadow: -20px 0 52px rgba(9, 15, 28, .24); }
.sds-header { min-height: 86px; display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 18px 26px; border-bottom: 1px solid var(--border-default); background: var(--bg-elevated); }
.sds-title-block { min-width: 0; }
.sds-title-block h2 { margin: 0; overflow: hidden; font-family: var(--font-display); font-size: 23px; text-overflow: ellipsis; white-space: nowrap; }
.sds-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.sds-tags > span { min-height: 22px; display: inline-flex; align-items: center; padding: 0 8px; border-radius: 999px; background: var(--surface-soft); color: var(--text-muted); font-size: 10px; font-weight: 700; }
.sds-status.status-ok { background: color-mix(in srgb, var(--success) 13%, transparent); color: var(--success); }
.sds-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.sds-btn, .sds-icon-btn { height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-weight: 700; cursor: pointer; transition: background .18s, border-color .18s, transform .18s; }
.sds-btn { padding: 0 13px; }.sds-icon-btn { width: 36px; }
.sds-btn:hover, .sds-icon-btn:hover { border-color: var(--accent-primary); background: var(--bg-hover); transform: translateY(-1px); }
.sds-btn-primary { border-color: transparent; background: var(--accent-primary); color: var(--text-on-accent, #fff); }.sds-btn-danger { border-color: color-mix(in srgb, var(--error) 35%, var(--border-default)); color: var(--error); }
.sds-tabs { height: 52px; display: flex; gap: 34px; align-items: end; padding: 0 26px; border-bottom: 1px solid var(--border-default); background: var(--bg-elevated); }
.sds-tabs button { position: relative; height: 44px; padding: 0 2px; border: 0; background: transparent; color: var(--text-muted); font-size: 12px; font-weight: 700; cursor: pointer; }
.sds-tabs button.active { color: var(--accent-primary); }.sds-tabs button.active::after { content: ''; position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; background: var(--accent-primary); }
.sds-body { min-height: 0; overflow-y: auto; padding: 24px 26px 40px; }
.sds-overview { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 22px; align-items: start; }
.sds-doc-heading { display: flex; justify-content: space-between; align-items: end; margin-bottom: 14px; }.sds-doc-heading span:first-child { color: var(--text-muted); font-size: 10px; font-weight: 700; }.sds-doc-heading h3 { margin: 3px 0 0; font-size: 20px; }
.sds-description { padding: 18px 20px; margin-bottom: 14px; border-left: 4px solid var(--warning); border-radius: var(--radius-md); background: color-mix(in srgb, var(--warning) 9%, var(--bg-elevated)); }.sds-description strong { color: var(--warning); font-size: 11px; }.sds-description p { margin: 10px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.sds-markdown-shell { min-height: 360px; padding: 36px 44px 48px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }
.sds-markdown-shell :deep(.markdown-renderer), .sds-file-content :deep(.markdown-renderer) { max-width: 760px; color: var(--text-secondary); font-family: var(--font-sans); font-size: 15px; line-height: 1.82; }
.sds-markdown-shell :deep(.md-heading), .sds-file-content :deep(.md-heading) { color: var(--text-primary); font-family: var(--font-display); font-weight: 720; letter-spacing: 0; }
.sds-markdown-shell :deep(.md-h1), .sds-file-content :deep(.md-h1) { margin: 0 0 26px; font-size: 31px; line-height: 1.2; }
.sds-markdown-shell :deep(.md-h2), .sds-file-content :deep(.md-h2) { padding-bottom: 10px; margin: 34px 0 14px; border-bottom: 1px solid var(--border-default); font-size: 22px; line-height: 1.3; }
.sds-markdown-shell :deep(.md-h3), .sds-file-content :deep(.md-h3) { margin: 26px 0 10px; font-size: 18px; }
.sds-markdown-shell :deep(.md-paragraph), .sds-file-content :deep(.md-paragraph) { margin: 12px 0; }
.sds-markdown-shell :deep(li), .sds-file-content :deep(li) { margin: 7px 0; }
.sds-markdown-shell :deep(p code), .sds-markdown-shell :deep(li code), .sds-file-content :deep(p code), .sds-file-content :deep(li code) { border: 1px solid color-mix(in srgb, var(--error) 13%, var(--border-default)); background: color-mix(in srgb, var(--error) 5%, var(--bg-primary)); color: color-mix(in srgb, var(--error) 76%, var(--text-primary)); }
.sds-aside { display: flex; flex-direction: column; gap: 14px; }.sds-aside section { padding: 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }.sds-aside header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 12px; }.sds-aside header span { color: var(--text-muted); }.sds-aside dl { margin: 0; }.sds-aside dt { margin-top: 12px; color: var(--text-muted); font-size: 10px; }.sds-aside dd { margin: 4px 0 0; overflow-wrap: anywhere; font-size: 11px; }.sds-aside pre { max-height: 220px; overflow: auto; font-size: 10px; }
.sds-agent-stack { display: flex; flex-direction: column; gap: 10px; }.sds-agent-stack > div { display: flex; align-items: center; gap: 10px; }.sds-agent-stack strong, .sds-agent-stack small { display: block; }.sds-agent-stack strong { font-size: 11px; }.sds-agent-stack small { margin-top: 2px; color: var(--text-muted); font-size: 10px; }
.sds-file-panel { overflow: hidden; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }
.sds-file-panel-head { min-height: 70px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px 20px; border-bottom: 1px solid var(--border-default); }
.sds-file-panel-head h3 { margin: 0; font-size: 15px; }.sds-file-panel-head span { display: block; margin-top: 5px; color: var(--text-muted); font-size: 10px; }.sds-file-panel-head > strong { flex-shrink: 0; padding: 5px 9px; border: 1px solid var(--border-default); border-radius: 999px; color: var(--text-secondary); font-size: 10px; }
.sds-files { height: min(650px, calc(100vh - 260px)); min-height: 480px; display: grid; grid-template-columns: 300px minmax(0, 1fr); overflow: hidden; }
.sds-file-tree { min-width: 0; display: grid; grid-template-rows: 42px minmax(0, 1fr); border-right: 1px solid var(--border-default); background: var(--surface-soft); }
.sds-file-tree > header { display: flex; align-items: center; justify-content: space-between; padding: 0 15px; border-bottom: 1px solid var(--border-default); color: var(--text-muted); font-size: 10px; font-weight: 700; }
.sds-file-tree > header strong { min-width: 22px; padding: 3px 6px; border-radius: 999px; background: var(--bg-elevated); text-align: center; }
.sds-file-tree-scroll { overflow-y: auto; padding: 10px; }
.sds-file-tree-scroll > button { width: 100%; min-height: 38px; display: flex; align-items: center; gap: 7px; padding: 6px 10px 6px calc(8px + var(--tree-depth) * 15px); border: 0; border-radius: 5px; background: transparent; color: var(--text-secondary); text-align: left; cursor: pointer; transition: background .16s, color .16s; }
.sds-file-tree-scroll > button:hover { background: var(--bg-hover); color: var(--text-primary); }.sds-file-tree-scroll > button.active { background: color-mix(in srgb, var(--accent-primary) 12%, var(--bg-elevated)); color: var(--text-primary); }.sds-file-tree-scroll > button.directory { font-weight: 650; }
.sds-file-tree-scroll > button > span:last-child { min-width: 0; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.sds-tree-spacer { width: 13px; flex: 0 0 13px; }
.sds-file-view { min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--bg-elevated); }
.sds-file-view > header { min-height: 62px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 10px 18px; border-bottom: 1px solid var(--border-default); }.sds-file-view header strong, .sds-file-view header span { display: block; }.sds-file-view header span { max-width: 520px; margin-top: 4px; overflow: hidden; color: var(--text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.sds-file-mode { display: inline-flex; flex-shrink: 0; padding: 3px; border: 1px solid var(--border-default); border-radius: 7px; background: var(--surface-soft); }.sds-file-mode button { height: 29px; padding: 0 12px; border: 0; border-radius: 5px; background: transparent; color: var(--text-muted); font-size: 10px; font-weight: 700; cursor: pointer; }.sds-file-mode button.active { background: var(--text-primary); color: var(--bg-primary); }.sds-file-mode button:disabled { opacity: .38; cursor: not-allowed; }
.sds-file-content { min-height: 0; overflow: auto; padding: 28px 32px 44px; }.sds-file-content pre { margin: 0; font-family: var(--font-mono); font-size: 11px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.sds-agent-section { display: flex; flex-direction: column; gap: 16px; }
.sds-agent-toolbar { min-height: 52px; display: flex; align-items: center; gap: 16px; padding: 8px 14px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-muted); font-size: 11px; font-weight: 650; }.sds-agent-toolbar > span:first-child, .sds-agent-toolbar > label { flex: 1; }.sds-agent-toolbar label { display: flex; align-items: center; gap: 8px; }.sds-agent-toolbar > div { display: flex; gap: 8px; margin-left: auto; }
.sds-target-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.sds-target-card { min-width: 0; display: flex; flex-direction: column; padding: 18px 18px 14px; border: 1px solid var(--border-default); border-left: 3px solid var(--accent-primary); border-radius: var(--radius-md); background: var(--bg-elevated); box-shadow: 0 10px 26px color-mix(in srgb, var(--text-primary) 5%, transparent); transition: border-color .18s, transform .18s, box-shadow .18s; }.sds-target-card:hover { transform: translateY(-1px); box-shadow: 0 14px 30px color-mix(in srgb, var(--text-primary) 8%, transparent); }.sds-target-card.mode-copy { border-left-color: var(--accent-secondary); }.sds-target-card.selected { border-color: var(--accent-primary); background: color-mix(in srgb, var(--accent-primary) 4%, var(--bg-elevated)); }
.sds-target-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }.sds-target-identity { min-width: 0; display: flex; align-items: center; gap: 11px; }.sds-target-identity > div { min-width: 0; }.sds-target-identity strong, .sds-target-identity span { display: block; }.sds-target-identity strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }.sds-target-identity span { margin-top: 4px; color: var(--text-muted); font-size: 10px; }
.sds-target-status { flex-shrink: 0; padding: 5px 8px; border-radius: 999px; background: var(--surface-soft); color: var(--text-secondary); font-size: 9px; font-weight: 750; }.sds-target-status.status-ok { background: color-mix(in srgb, var(--success) 13%, transparent); color: var(--success); }.sds-target-status.status-conflict, .sds-target-status.status-broken-link, .sds-target-status.status-missing { background: color-mix(in srgb, var(--error) 12%, transparent); color: var(--error); }.sds-target-status.status-copy-outdated, .sds-target-status.status-copy-modified, .sds-target-status.status-copy-diverged { background: color-mix(in srgb, var(--warning) 12%, transparent); color: var(--warning); }
.sds-target-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 12px; }.sds-target-chips span { padding: 4px 8px; border: 1px solid color-mix(in srgb, var(--accent-primary) 24%, var(--border-default)); border-radius: 999px; background: color-mix(in srgb, var(--accent-primary) 7%, transparent); color: var(--accent-primary); font-size: 9px; font-weight: 700; }.sds-target-chips span.claim { border-color: color-mix(in srgb, var(--success) 24%, var(--border-default)); background: color-mix(in srgb, var(--success) 7%, transparent); color: var(--success); }
.sds-target-path { min-height: 78px; padding: 12px 13px; border-radius: 6px; background: var(--surface-soft); }.sds-target-path span { display: block; margin-bottom: 8px; color: var(--text-muted); font-size: 9px; font-weight: 700; }.sds-target-path code { display: block; overflow-wrap: anywhere; color: var(--text-secondary); font-size: 10px; line-height: 1.5; }
.sds-target-card > footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 14px; margin-top: auto; }.sds-delete-warning { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.7; }
.sds-source-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }.sds-source-grid section { padding: 18px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }.sds-source-grid span, .sds-source-grid strong, .sds-source-grid code { display: block; }.sds-source-grid span { margin-bottom: 8px; color: var(--text-muted); font-size: 10px; }.sds-source-grid code { overflow-wrap: anywhere; font-size: 11px; }
.sds-muted, .sds-empty-panel { color: var(--text-muted); font-size: 12px; }.sds-empty-panel { padding: 36px; border: 1px dashed var(--border-default); border-radius: var(--radius-md); text-align: center; }
.sds-loading { height: 100%; padding: 22px; }.sds-loading-head, .sds-loading-tabs, .sds-loading-body { border-radius: var(--radius-md); background: linear-gradient(90deg, var(--bg-elevated), var(--bg-hover), var(--bg-elevated)); background-size: 200% 100%; animation: sds-shimmer 1.2s infinite; }.sds-loading-head { height: 70px; }.sds-loading-tabs { height: 42px; margin: 12px 0; }.sds-loading-body { height: calc(100% - 136px); }
.sds-fade-enter-active, .sds-fade-leave-active { transition: opacity .2s; }.sds-fade-enter-from, .sds-fade-leave-to { opacity: 0; }.sds-slide-enter-active, .sds-slide-leave-active { transition: transform .26s cubic-bezier(.2,.8,.2,1); }.sds-slide-enter-from, .sds-slide-leave-to { transform: translateX(100%); }
@keyframes sds-shimmer { to { background-position: -200% 0; } }
@media (max-width: 900px) { .sds-panel { width: calc(100% - 42px); }.sds-header { align-items: flex-start; }.sds-actions { flex-wrap: wrap; justify-content: flex-end; }.sds-overview { grid-template-columns: 1fr; }.sds-aside { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }.sds-files { grid-template-columns: 230px minmax(0, 1fr); }.sds-target-grid { grid-template-columns: 1fr; } }
@media (max-width: 620px) { .sds-panel { width: 100%; }.sds-header { flex-direction: column; }.sds-actions { width: 100%; justify-content: stretch; }.sds-actions .sds-btn { flex: 1; }.sds-tabs { gap: 18px; overflow-x: auto; }.sds-body { padding: 18px 14px 30px; }.sds-aside, .sds-source-grid { grid-template-columns: 1fr; }.sds-markdown-shell { padding: 24px 20px 34px; }.sds-files { height: auto; min-height: 0; display: flex; flex-direction: column; }.sds-file-tree { max-height: 220px; border-right: 0; border-bottom: 1px solid var(--border-default); }.sds-file-view { min-height: 420px; }.sds-file-view > header { align-items: flex-start; }.sds-file-content { padding: 24px 20px 36px; }.sds-agent-toolbar { align-items: flex-start; flex-wrap: wrap; }.sds-agent-toolbar > div { width: 100%; justify-content: flex-end; } }
</style>

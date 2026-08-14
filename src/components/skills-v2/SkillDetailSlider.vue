<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen, Send, Trash2, X } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { FileTreeNode } from '@/types/skillManagerV2'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import AgentIconBadge from './AgentIconBadge.vue'
import DistributeDialog from './DistributeDialog.vue'
import { SOURCE_LABEL_KEYS, STATUS_CSS_CLASSES, STATUS_LABEL_KEYS } from './skillLabels'

type DetailTab = 'overview' | 'files' | 'agents' | 'source'

const { t } = useI18n()
const store = useSkillManagerStore()

const activeTab = ref<DetailTab>('overview')
const skillDocument = ref('')
const activeFilePath = ref<string | null>(null)
const activeFileContent = ref('')
const fileLoading = ref(false)
const distributeVisible = ref(false)

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

watch(
  () => detail.value?.id,
  async (skillId) => {
    activeTab.value = 'overview'
    skillDocument.value = ''
    activeFilePath.value = null
    activeFileContent.value = ''
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
  activeTab.value = 'files'
  activeFilePath.value = file.path
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

function agentBadge(agentId: string): { agentId: string; agentName: string; mode: 'link'; status: 'ok' } {
  return {
    agentId,
    agentName: store.agents.find((agent) => agent.id === agentId)?.displayName ?? agentId,
    mode: 'link',
    status: 'ok',
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
                  <section><header><strong>{{ t('skillManagerV2.detail.installedAgents') }}</strong><span>{{ detail.targets.length }}</span></header><p v-if="detail.targets.length === 0" class="sds-muted">{{ t('skillManagerV2.detail.noTargets') }}</p><div v-else class="sds-agent-stack"><div v-for="target in detail.targets" :key="target.id"><AgentIconBadge :badge="agentBadge(target.agentId)" :size="30" /><span><strong>{{ store.agents.find((agent) => agent.id === target.agentId)?.displayName ?? target.agentId }}</strong><small>{{ target.actualMode === 'link' ? t('skillManagerV2.settings.modeLink') : t('skillManagerV2.settings.modeCopy') }}</small></span></div></div></section>
                  <section><header><strong>{{ t('skillManagerV2.detail.information') }}</strong></header><dl><dt>{{ t('skillManagerV2.detail.source') }}</dt><dd>{{ sourceLabel }}</dd><dt>{{ t('skillManagerV2.detail.centerPath') }}</dt><dd class="selectable">{{ detail.centerPath }}</dd><dt>{{ t('skillManagerV2.detail.hash') }}</dt><dd>{{ detail.currentHash.slice(0, 16) }}</dd></dl></section>
                  <section v-if="frontmatter"><header><strong>{{ t('skillManagerV2.detail.frontmatter') }}</strong><span>{{ Object.keys(frontmatter).length }}</span></header><pre>{{ JSON.stringify(frontmatter, null, 2) }}</pre></section>
                </aside>
              </div>

              <div v-else-if="activeTab === 'files'" class="sds-files">
                <aside class="sds-file-list"><button v-for="file in files" :key="file.path" type="button" :class="{ active: activeFilePath === file.path }" @click="selectFile(file)"><span>{{ file.name }}</span><small>{{ file.path }}</small></button></aside>
                <main class="sds-file-view"><header><strong>{{ fileName(activeFilePath) }}</strong><span>{{ activeFilePath }}</span></header><div v-if="fileLoading" class="sds-muted">{{ t('skillManagerV2.loading') }}</div><MarkdownRenderer v-else-if="activeFileContent && /\.md$/i.test(activeFilePath ?? '')" :content="activeFileContent" :file-path="activeFilePath ?? undefined" /><pre v-else>{{ activeFileContent }}</pre></main>
              </div>

              <div v-else-if="activeTab === 'agents'" class="sds-section-grid">
                <section v-if="detail.targets.length === 0" class="sds-empty-panel">{{ t('skillManagerV2.detail.noTargets') }}</section>
                <section v-for="target in detail.targets" v-else :key="target.id" class="sds-target-card"><AgentIconBadge :badge="agentBadge(target.agentId)" :size="38" /><div><strong>{{ store.agents.find((agent) => agent.id === target.agentId)?.displayName ?? target.agentId }}</strong><span>{{ target.actualMode === 'link' ? t('skillManagerV2.settings.modeLink') : t('skillManagerV2.settings.modeCopy') }} · {{ t(STATUS_LABEL_KEYS[target.status]) }}</span><code>{{ target.targetPath }}</code></div></section>
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
.sds-status.ok { background: color-mix(in srgb, var(--success) 13%, transparent); color: var(--success); }
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
.sds-markdown-shell { min-height: 360px; padding: 28px 34px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }
.sds-markdown-shell :deep(.markdown-renderer) { color: var(--text-secondary); font-size: 14px; line-height: 1.75; }.sds-markdown-shell :deep(h1) { font-size: 30px; }.sds-markdown-shell :deep(h2) { margin-top: 30px; font-size: 21px; }.sds-markdown-shell :deep(h3) { font-size: 17px; }
.sds-aside { display: flex; flex-direction: column; gap: 14px; }.sds-aside section { padding: 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }.sds-aside header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 12px; }.sds-aside header span { color: var(--text-muted); }.sds-aside dl { margin: 0; }.sds-aside dt { margin-top: 12px; color: var(--text-muted); font-size: 10px; }.sds-aside dd { margin: 4px 0 0; overflow-wrap: anywhere; font-size: 11px; }.sds-aside pre { max-height: 220px; overflow: auto; font-size: 10px; }
.sds-agent-stack { display: flex; flex-direction: column; gap: 10px; }.sds-agent-stack > div { display: flex; align-items: center; gap: 10px; }.sds-agent-stack strong, .sds-agent-stack small { display: block; }.sds-agent-stack strong { font-size: 11px; }.sds-agent-stack small { margin-top: 2px; color: var(--text-muted); font-size: 10px; }
.sds-files { min-height: 520px; display: grid; grid-template-columns: 260px minmax(0, 1fr); overflow: hidden; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }.sds-file-list { overflow-y: auto; border-right: 1px solid var(--border-default); }.sds-file-list button { width: 100%; display: block; padding: 12px 14px; border: 0; border-bottom: 1px solid var(--border-default); background: transparent; color: var(--text-primary); text-align: left; cursor: pointer; }.sds-file-list button.active { background: var(--accent-primary-glow); }.sds-file-list span, .sds-file-list small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.sds-file-list span { font-size: 12px; font-weight: 700; }.sds-file-list small { margin-top: 4px; color: var(--text-muted); font-size: 9px; }
.sds-file-view { min-width: 0; overflow: auto; padding: 22px 26px; }.sds-file-view > header { padding-bottom: 14px; margin-bottom: 18px; border-bottom: 1px solid var(--border-default); }.sds-file-view header strong, .sds-file-view header span { display: block; }.sds-file-view header span { margin-top: 4px; color: var(--text-muted); font-size: 10px; }.sds-file-view pre { white-space: pre-wrap; word-break: break-word; }
.sds-section-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }.sds-target-card { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 12px; padding: 17px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }.sds-target-card strong, .sds-target-card span, .sds-target-card code { display: block; }.sds-target-card span { margin: 4px 0 9px; color: var(--text-muted); font-size: 11px; }.sds-target-card code { overflow: hidden; color: var(--text-secondary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.sds-source-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }.sds-source-grid section { padding: 18px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }.sds-source-grid span, .sds-source-grid strong, .sds-source-grid code { display: block; }.sds-source-grid span { margin-bottom: 8px; color: var(--text-muted); font-size: 10px; }.sds-source-grid code { overflow-wrap: anywhere; font-size: 11px; }
.sds-muted, .sds-empty-panel { color: var(--text-muted); font-size: 12px; }.sds-empty-panel { padding: 36px; border: 1px dashed var(--border-default); border-radius: var(--radius-md); text-align: center; }
.sds-loading { height: 100%; padding: 22px; }.sds-loading-head, .sds-loading-tabs, .sds-loading-body { border-radius: var(--radius-md); background: linear-gradient(90deg, var(--bg-elevated), var(--bg-hover), var(--bg-elevated)); background-size: 200% 100%; animation: sds-shimmer 1.2s infinite; }.sds-loading-head { height: 70px; }.sds-loading-tabs { height: 42px; margin: 12px 0; }.sds-loading-body { height: calc(100% - 136px); }
.sds-fade-enter-active, .sds-fade-leave-active { transition: opacity .2s; }.sds-fade-enter-from, .sds-fade-leave-to { opacity: 0; }.sds-slide-enter-active, .sds-slide-leave-active { transition: transform .26s cubic-bezier(.2,.8,.2,1); }.sds-slide-enter-from, .sds-slide-leave-to { transform: translateX(100%); }
@keyframes sds-shimmer { to { background-position: -200% 0; } }
@media (max-width: 900px) { .sds-panel { width: calc(100% - 42px); }.sds-header { align-items: flex-start; }.sds-actions { flex-wrap: wrap; justify-content: flex-end; }.sds-overview { grid-template-columns: 1fr; }.sds-aside { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }.sds-files { grid-template-columns: 210px minmax(0, 1fr); } }
@media (max-width: 620px) { .sds-panel { width: 100%; }.sds-header { flex-direction: column; }.sds-actions { width: 100%; justify-content: stretch; }.sds-actions .sds-btn { flex: 1; }.sds-tabs { gap: 18px; overflow-x: auto; }.sds-body { padding: 18px 14px 30px; }.sds-aside, .sds-source-grid { grid-template-columns: 1fr; }.sds-files { display: flex; flex-direction: column; }.sds-file-list { max-height: 180px; border-right: 0; border-bottom: 1px solid var(--border-default); } }
</style>

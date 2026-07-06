<template>
  <div class="file-workspace">
    <div class="ws-toolbar">
      <button :class="{ active: viewMode === 'preview' }" @click="viewMode = 'preview'">{{ t('design.workspace.preview') }}</button>
      <button :class="{ active: viewMode === 'source' }" @click="viewMode = 'source'">{{ t('design.workspace.source') }}</button>
      <button @click="refresh">{{ t('design.workspace.refresh') }}</button>
    </div>
    <WorkspaceTabsBar :tabs="openTabs" :active-path="activeTabPath" @select="setActiveTab" @close="removeTab" />
    <div class="ws-body">
      <div v-if="!activeTabPath" class="empty-state">
        <FileText :size="32" />
        <h2>{{ t('design.emptyPreviewTitle') }}</h2>
        <p>{{ t('design.emptyPreviewHint') }}</p>
      </div>
      <DesignPreview v-else-if="viewMode === 'preview'" :html="previewHtml" :title="previewTitle" :session-id="activeSessionId || ''" />
      <div v-else class="code-viewer"><pre><code>{{ sourceCode }}</code></pre></div>
    </div>
    <div class="artifact-list">
      <div class="al-title">Artifacts</div>
      <div v-for="f in artifactFiles" :key="f.path" class="al-item" :class="{ active: activeTabPath === f.path }" @click="addTab(f)">
        <FileCode :size="14" /> <span>{{ f.name }}</span>
      </div>
    </div>
    <div v-if="activeTabPath" class="export-bar">
      <button @click="exportFile('html')">{{ t('design.export.html') }}</button>
      <button @click="exportFile('zip')">{{ t('design.export.zip') }}</button>
      <button @click="exportFile('pdf')">{{ t('design.export.pdf') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { FileText, FileCode } from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { api } from '@/services/electronAPI'
import DesignPreview from './DesignPreview.vue'
import WorkspaceTabsBar from './WorkspaceTabsBar.vue'

const { t } = useI18n()
const designStore = useDesignStore()
const { openTabs, activeTabPath, previewHtml, previewTitle, artifactFiles, activeSessionId } = storeToRefs(designStore)
const { addTab, removeTab, setActiveTab } = designStore
const viewMode = ref<'preview' | 'source'>('preview')
const sourceCode = ref('')

watch(activeTabPath, async (p) => {
  if (!p) { previewHtml.value = ''; return }
  const content = await api.readFile(p)
  previewHtml.value = content || ''
  previewTitle.value = p.split('/').pop() || 'Preview'
  sourceCode.value = content || ''
  viewMode.value = p.endsWith('.html') || p.endsWith('.htm') ? 'preview' : 'source'
})

function refresh() { if (activeTabPath.value) { /* 触发预览刷新 */ } }
async function exportFile(format: 'html' | 'zip' | 'pdf') {
  if (!activeTabPath.value) return
  api.design.exportArtifact({ filePath: activeTabPath.value, format })
}
</script>

<style scoped lang="scss">
.file-workspace { display: flex; flex-direction: column; height: 100%; background: var(--bg-primary); }
.ws-toolbar { display: flex; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--surface-border); button { background: none; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 4px 10px; font-size: 11px; cursor: pointer; &.active { background: var(--accent-primary-glow); color: var(--accent-primary); } } }
.ws-body { flex: 1; overflow: hidden; position: relative; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); text-align: center; h2 { font-size: 14px; margin: 8px 0 4px; color: var(--text-primary); } }
.code-viewer { height: 100%; overflow: auto; padding: 12px; pre { font-size: 12px; } }
.artifact-list { border-top: 1px solid var(--surface-border); padding: 8px; max-height: 200px; overflow-y: auto; background: var(--bg-secondary); }
.al-title { font-size: 11px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px; }
.al-item { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; &:hover { background: var(--surface-hover); } &.active { background: var(--accent-primary-glow); } }
.export-bar { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--surface-border); button { flex: 1; background: var(--bg-secondary); border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 6px; font-size: 11px; cursor: pointer; } }
</style>

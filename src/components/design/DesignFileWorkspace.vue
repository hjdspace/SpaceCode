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
      <DesignPreview v-else-if="viewMode === 'preview'" :html="previewHtml" :title="previewTitle" :session-id="activeSessionId || ''" :preview-url="previewResourceUrl" :reload-token="previewReloadToken" />
      <div v-else class="code-viewer"><pre><code>{{ sourceCode }}</code></pre></div>
    </div>
    <div class="artifact-list">
      <div class="al-title">Artifacts</div>
      <div v-for="f in artifactFiles" :key="f.path" class="al-item" :class="{ active: activeTabPath === f.path }" @click="addTab(f)">
        <FileCode :size="14" /> <span>{{ f.name }}</span>
      </div>
    </div>
    <div v-if="activeTabPath" class="export-bar">
      <div class="export-actions">
        <button
          v-for="fmt in exportFormats"
          :key="fmt"
          :disabled="!activeIsHtml || exporting"
          :title="activeIsHtml ? '' : t('design.export.htmlOnly')"
          @click="exportFile(fmt)"
        >{{ t(`design.export.${fmt}`) }}</button>
      </div>
      <p v-if="exportStatus" class="export-status" :class="exportStatus.kind">{{ exportStatus.text }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { FileText, FileCode } from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import DesignPreview from './DesignPreview.vue'
import WorkspaceTabsBar from './WorkspaceTabsBar.vue'

const { t } = useI18n()
const designStore = useDesignStore()
const appStore = useAppStore()
const { openTabs, activeTabPath, previewHtml, previewTitle, artifactFiles, activeSessionId, designWorkspace } = storeToRefs(designStore)
const { addTab, removeTab, setActiveTab } = designStore
const viewMode = ref<'preview' | 'source'>('preview')
const sourceCode = ref('')
/** 活动 HTML 在预览专用源上的 URL；null 表示不可用（H5 模式等），预览回退 srcdoc */
const previewResourceUrl = ref<string | null>(null)
/** 递增即强制重新导航，用于 HTML 之外的 CSS/JS 变更后重取兄弟资源 */
const previewReloadToken = ref(0)

type ExportFormat = 'html' | 'zip' | 'pdf'
const exportFormats: ExportFormat[] = ['html', 'zip', 'pdf']
const exporting = ref(false)
const exportStatus = ref<{ kind: 'working' | 'success' | 'error'; text: string } | null>(null)

/** 从完整路径中提取文件名（兼容 Windows 反斜杠与 POSIX 正斜杠） */
function basename(filepath: string): string {
  return filepath.split(/[\\/]/).pop() || filepath
}

/** 判断是否为可预览的 HTML 文件 */
function isHtmlFile(filepath: string): boolean {
  const ext = filepath.split('.').pop()?.toLowerCase()
  return ext === 'html' || ext === 'htm'
}

/** 只有 HTML 产物有可导出的形态；CSS/JS tab 上导出条整体禁用 */
const activeIsHtml = computed(() => !!activeTabPath.value && isHtmlFile(activeTabPath.value))

watch(activeTabPath, async (p) => {
  exportStatus.value = null
  if (!p) {
    previewResourceUrl.value = null
    previewHtml.value = ''
    return
  }
  const isHtml = isHtmlFile(p)
  const [content, url] = await Promise.all([
    api.readFile(p),
    isHtml ? api.preview.getFrameUrl(p) : Promise.resolve(null),
  ])
  // 连续切 tab 时慢的那次读取会晚到，不能用它覆盖已经切过去的文件
  if (activeTabPath.value !== p) return
  // URL 先于内容写入：子组件在同一批更新里拿到配套的两个值，避免用旧文件的 URL 导航新内容
  previewResourceUrl.value = url
  previewHtml.value = content || ''
  previewTitle.value = basename(p)
  sourceCode.value = content || ''
  viewMode.value = isHtml ? 'preview' : 'source'
}, { immediate: true })

// ── 文件监听：接收 Electron 主进程 chokidar 推送的文件变更事件 ──
// 监听器注册在 DesignFileWorkspace（设计模式的激活标签），而非 DesignPreview
// （条件渲染，初始无 tab 时不挂载）。面板收起时 InfoPanel 用 v-show 隐藏，
// 本组件仍在挂载状态，所以默认收起不影响这里侦测产物并弹开面板。
let disposeFileChanged: (() => void) | null = null

onMounted(() => {
  disposeFileChanged = api.design.onFileChanged(async ({ sessionId, filepath }) => {
    if (sessionId !== activeSessionId.value) return

    const filename = basename(filepath)

    // 更新产物列表（所有监听文件类型：html/css/js）
    const existing = designStore.artifactFiles.find(f => f.path === filepath)
    if (!existing) {
      designStore.artifactFiles.unshift({
        name: filename,
        path: filepath,
        updatedAt: Date.now(),
      })
      // 新 HTML 产物 = 首次有设计产出：把默认收起的右侧面板弹开。
      // 只认新文件，不认对已有文件的后续改写，避免 AI 逐段回写时反复弹。
      if (isHtmlFile(filepath)) appStore.openDesignPreview()
    } else {
      existing.updatedAt = Date.now()
    }

    // HTML 文件：自动打开 tab 并刷新预览
    if (isHtmlFile(filepath)) {
      const alreadyOpen = designStore.openTabs.some(t => t.path === filepath)
      if (!alreadyOpen) {
 // 新文件：addTab 会设置 activeTabPath，触发上方 watch 读取内容
        designStore.addTab({ name: filename, path: filepath, updatedAt: Date.now() })
      } else if (activeTabPath.value === filepath) {
        // 已打开且当前激活的文件被修改：直接刷新预览内容。
        // 不递增 reloadToken —— 内容更新由 DesignPreview 走 MessageChannel 注入；
        // 递增会强制整页导航，把"无闪烁"变成每次都重载。
        const content = await api.readFile(filepath)
        if (content !== null) {
          previewHtml.value = content
          previewTitle.value = filename
          sourceCode.value = content
        }
      }
    } else if (activeTabPath.value && isHtmlFile(activeTabPath.value)) {
      // 兄弟 CSS/JS 变更：HTML 文本没动，预览必须重新导航才会再取一次这些资源
      previewReloadToken.value++
    }
  })
})

onUnmounted(() => {
  if (disposeFileChanged) {
    disposeFileChanged()
    disposeFileChanged = null
  }
})

async function refresh() {
  if (!activeTabPath.value) return
  const content = await api.readFile(activeTabPath.value)
  if (content !== null) {
    previewHtml.value = content
    sourceCode.value = content
    previewReloadToken.value++
  }
}

async function exportFile(format: ExportFormat) {
  const filePath = activeTabPath.value
  if (!filePath || !activeIsHtml.value || exporting.value) return

  exporting.value = true
  exportStatus.value = { kind: 'working', text: t('design.export.working') }
  try {
    const result = await api.design.exportArtifact({
      filePath,
      format,
      workspaceRoot: designWorkspace.value || undefined,
    })
    if (result.ok) {
      // html 打开的是产物所在目录，zip/pdf 是新生成的文件
      exportStatus.value = {
        kind: 'success',
        text: format === 'html'
          ? t('design.export.opened', { path: result.path })
          : t('design.export.exported', { path: result.path }),
      }
    } else {
      // api 层在拿不到 preload 时回 'unsupported:' 哨兵：细节不外露，只说未支持
      exportStatus.value = {
        kind: 'error',
        text: result.error.startsWith('unsupported:')
          ? t('design.export.unavailable')
          : t('design.export.failed', { error: result.error }),
      }
    }
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped lang="scss">
.file-workspace { display: flex; flex-direction: column; height: 100%; background: var(--bg-primary); }
.ws-toolbar { display: flex; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--surface-border); button { background: none; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 4px 10px; font-size: 11px; cursor: pointer; &.active { background: var(--accent-primary-glow); color: var(--accent-primary); } } }
.ws-body { flex: 1; overflow: hidden; position: relative; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); text-align: center; h2 { font-size: 14px; margin: 8px 0 4px; color: var(--text-primary); } }
.code-viewer { height: 100%; overflow: auto; @include scrollbar-overlay; padding: 12px; pre { font-size: 12px; } }
.artifact-list { border-top: 1px solid var(--surface-border); padding: 8px; max-height: 200px; overflow-y: auto; @include scrollbar-overlay; background: var(--bg-secondary); }
.al-title { font-size: 11px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px; }
.al-item { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; &:hover { background: var(--surface-hover); } &.active { background: var(--accent-primary-glow); } }
.export-bar { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-top: 1px solid var(--surface-border); }
.export-actions { display: flex; gap: 6px; button { flex: 1; background: var(--bg-secondary); border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 6px; font-size: 11px; cursor: pointer; &:disabled { opacity: .45; cursor: not-allowed; } } }
.export-status { font-size: 11px; line-height: 1.4; color: var(--text-muted); word-break: break-all; &.success { color: var(--success); } &.error { color: var(--error); } }
</style>

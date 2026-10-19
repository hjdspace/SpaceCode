<template>
  <div class="office-preview-panel">
    <!-- Toolbar -->
    <div class="preview-toolbar">
      <div class="preview-file-info">
        <span class="file-icon">{{ fileIcon }}</span>
        <span class="file-name">{{ fileName }}</span>
      </div>
      <div class="preview-actions">
        <button
          v-for="m in availableModes"
          :key="m.id"
          class="preview-mode-btn"
          :class="{ active: currentMode === m.id }"
          @click="switchMode(m.id)"
        >
          {{ m.label }}
        </button>
        <button class="preview-action-btn" :title="t('officePreview.openExternal')" @click="openExternal">
          <ExternalLink :size="14" />
        </button>
        <button class="preview-action-btn" :title="t('officePreview.revealInFolder')" @click="revealInFolder">
          <FolderOpen :size="14" />
        </button>
      </div>
    </div>

    <!-- Preview content -->
    <div class="preview-content">
      <!-- HTML render mode -->
      <div v-if="currentMode === 'html'" class="html-viewer">
        <div v-if="loading" class="preview-loading">
          <Loader2 :size="20" class="spin-icon" />
          <span>{{ t('officePreview.rendering') }}</span>
        </div>
        <div v-else-if="errorMsg" class="preview-error">
          <div class="error-content">
            <span class="error-text">{{ errorMsg }}</span>
            <button v-if="binaryMissing && !downloading" class="download-btn" @click="handleDownload">
              <Download :size="14" />
              {{ t('officePreview.downloadBinary') }}
            </button>
            <div v-else-if="downloading" class="download-progress">
              <Loader2 :size="14" class="spin-icon" />
              <span>{{ downloadMsg }} ({{ downloadPercent }}%)</span>
            </div>
          </div>
        </div>
        <webview
          v-else-if="htmlPreviewUrl"
          ref="previewWebviewRef"
          :src="htmlPreviewUrl"
          class="preview-webview"
          partition="persist:office-preview"
          @did-finish-load="onWebviewLoad"
        />
      </div>

      <!-- Screenshot thumbnail mode -->
      <div v-else-if="currentMode === 'screenshots'" class="screenshot-viewer">
        <div v-if="loading" class="preview-loading">
          <Loader2 :size="20" class="spin-icon" />
          <span>{{ t('officePreview.generatingScreenshots') }}</span>
        </div>
        <div v-else-if="errorMsg" class="preview-error">
          <div class="error-content">
            <span class="error-text">{{ errorMsg }}</span>
            <button v-if="binaryMissing && !downloading" class="download-btn" @click="handleDownload">
              <Download :size="14" />
              {{ t('officePreview.downloadBinary') }}
            </button>
            <div v-else-if="downloading" class="download-progress">
              <Loader2 :size="14" class="spin-icon" />
              <span>{{ downloadMsg }} ({{ downloadPercent }}%)</span>
            </div>
          </div>
        </div>
        <div v-else-if="screenshotPages.length === 0" class="preview-empty">{{ t('officePreview.noScreenshots') }}</div>
        <div v-else class="screenshot-list">
          <div
            v-for="page in screenshotPages"
            :key="page.pageNumber"
            class="screenshot-item"
            @click="openFullSize(page.path)"
          >
            <div v-if="page.cropped" class="page-crop" :style="pageFrameStyle(page)">
              <img
                class="page-sheet"
                :src="page.dataUrl"
                :style="pageSheetStyle(page)"
                :alt="`Page ${page.pageNumber}`"
                loading="lazy"
                decoding="async"
              />
            </div>
            <img v-else :src="page.dataUrl" :alt="`Page ${page.pageNumber}`" loading="lazy" decoding="async" />
            <span class="page-num">{{ page.pageNumber }}</span>
          </div>
        </div>
      </div>

      <!-- Watch live mode -->
      <div v-else-if="currentMode === 'watch'" class="watch-viewer">
        <div v-if="loading" class="preview-loading">
          <Loader2 :size="20" class="spin-icon" />
          <span>{{ t('officePreview.startingWatch') }}</span>
        </div>
        <div v-else-if="errorMsg" class="preview-error">
          <div class="error-content">
            <span class="error-text">{{ errorMsg }}</span>
            <button v-if="binaryMissing && !downloading" class="download-btn" @click="handleDownload">
              <Download :size="14" />
              {{ t('officePreview.downloadBinary') }}
            </button>
            <div v-else-if="downloading" class="download-progress">
              <Loader2 :size="14" class="spin-icon" />
              <span>{{ downloadMsg }} ({{ downloadPercent }}%)</span>
            </div>
          </div>
        </div>
        <webview
          v-else-if="watchUrl"
          ref="previewWebviewRef"
          :src="watchUrl"
          class="preview-webview"
          partition="persist:office-preview"
          @did-finish-load="onWebviewLoad"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, ExternalLink, FolderOpen, Download } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'

const props = defineProps<{
  filePath: string
}>()

/**
 * officecli 把一个页区间渲染成「一张竖向拼接的长图」，主进程负责告诉我们这张图
 * 覆盖第几页到第几页、以及它的像素尺寸；这里按页把长图裁成一项一项。
 */
interface ScreenshotPage {
  /** 文档内的页码，从 1 开始 */
  pageNumber: number
  /** 该页所在长图的文件路径 */
  path: string
  /** 长图的 base64 data URL（避免 file:// CORS 问题） */
  dataUrl: string
  /** 这张长图里叠了几页；1 表示整图即该页，无需裁切 */
  bandCount: number
  /** 该页在长图中的序号，0 起 */
  bandIndex: number
  imageWidth: number
  bandHeight: number
  cropped: boolean
}

const { t } = useI18n()
const appStore = useAppStore()
const loading = ref(false)
const errorMsg = ref('')
const currentMode = ref<'html' | 'screenshots' | 'watch'>('html')
const htmlPreviewUrl = ref('')
/** 截图模式：每页一项，多页共用同一张长图的 base64（同 URL 只解码一次） */
const screenshotPages = ref<ScreenshotPage[]>([])
const watchUrl = ref('')
const watchId = ref('')
const previewWebviewRef = ref<any>(null)

/** OfficeCLI binary 缺失检测 */
const binaryMissing = computed(() =>
  errorMsg.value.toLowerCase().includes('binary not found') ||
  errorMsg.value.toLowerCase().includes('officecli not available')
)
/** 下载状态 */
const downloading = ref(false)
const downloadMsg = ref('')
const downloadPercent = ref(0)
/** downloadProgress 事件取消订阅函数 */
let downloadProgressUnsubscribe: (() => void) | null = null

/** artifacts:changed 事件取消订阅函数 */
let artifactsUnsubscribe: (() => void) | null = null
/** 防抖：文件变更后延迟重渲染 */
let rerenderDebounceTimer: ReturnType<typeof setTimeout> | null = null

/** 注入到 webview 中的 CSS，使内容铺满视口 */
const EXPAND_CSS = `
  html, body {
    margin: 0 !important;
    padding: 0 !important;
  }
  body {
    overflow: auto !important;
  }
`

const fileName = computed(() => {
  const parts = props.filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1]
})

const fileIcon = computed(() => {
  const ext = fileName.value.split('.').pop()?.toLowerCase()
  const icons: Record<string, string> = {
    pptx: '\u{1F4CA}',
    docx: '\u{1F4DD}',
    xlsx: '\u{1F4C8}',
    pdf: '\u{1F4C4}',
  }
  return icons[ext || ''] || '\u{1F4C4}'
})

const isPdfFile = computed(() => fileName.value.split('.').pop()?.toLowerCase() === 'pdf')

const availableModes = computed(() => {
  if (isPdfFile.value) {
    return [{ id: 'html' as const, label: t('officePreview.htmlMode') }]
  }
  return [
    { id: 'html' as const, label: t('officePreview.htmlMode') },
    { id: 'screenshots' as const, label: t('officePreview.screenshotsMode') },
    { id: 'watch' as const, label: t('officePreview.watchMode') },
  ]
})

/**
 * 一轮渲染的世代号，html / 截图 / watch 三种模式共用一个计数。
 * 切文件或切模式都会重启一轮，迟到的旧轮次一律不得写回状态——否则就是
 * 「标题已经是 B.xlsx、预览还是 A.xlsx」。watch 那一轮尤其不能只是丢弃结果：
 * 那个句柄没人记得，主进程的 officecli 常驻子进程就漏在那里。
 */
let renderRun = 0

async function renderHtml() {
  const run = ++renderRun
  const filePath = props.filePath
  loading.value = true
  errorMsg.value = ''
  try {
    const htmlPath = await api.officecli.viewHtml(filePath)
    if (run !== renderRun) return
    htmlPreviewUrl.value = pathToFileURL(htmlPath)
  } catch (err) {
    if (run !== renderRun) return
    errorMsg.value = extractErrorMessage(err)
    console.error('[OfficePreview] HTML render failed:', err)
  } finally {
    if (run === renderRun) loading.value = false
  }
}

/** 每块 8 页 × ~7s，12 块已近 90s；再往上只可能是主进程报回了荒谬的页数。 */
const MAX_SCREENSHOT_CHUNKS = 12

async function renderScreenshots() {
  const run = ++renderRun
  const filePath = props.filePath
  const tmpDir = `${filePath}.screenshots`
  loading.value = true
  errorMsg.value = ''
  screenshotPages.value = []
  try {
    let start = 1
    let pageCount = 1
    let chunks = 0
    // 每块的页数由主进程定，这里按返回的 end 逐块往后要，直到覆盖整个文档。
    while (start <= pageCount && chunks < MAX_SCREENSHOT_CHUNKS) {
      const sheet = await api.officecli.viewScreenshot(filePath, tmpDir, start)
      const dataUrl = await api.officecli.readImageAsDataURL(sheet.path)
      if (run !== renderRun) return
      const pages = Math.max(1, sheet.end - sheet.start + 1)
      // 尺寸读不出来就没法裁；此时整张图当一页，别让每页重复展示同一条长图。
      const sliceable = sheet.height > 0 && pages > 1
      const bandCount = sliceable ? pages : 1
      for (let index = 0; index < bandCount; index++) {
        screenshotPages.value.push({
          pageNumber: sheet.start + index,
          path: sheet.path,
          dataUrl,
          bandCount,
          bandIndex: index,
          imageWidth: sheet.width,
          bandHeight: sliceable ? sheet.height / pages : sheet.height,
          cropped: sliceable,
        })
      }
      // 首块就位就摘掉 loading，后续页边渲染边补进列表
      loading.value = false
      pageCount = sheet.pageCount
      start = Math.max(sheet.end + 1, start + 1)
      chunks += 1
    }
  } catch (err) {
    if (run !== renderRun) return
    errorMsg.value = extractErrorMessage(err)
    console.error('[OfficePreview] Screenshot render failed:', err)
  } finally {
    if (run === renderRun) loading.value = false
  }
}

/** 长图裁到该页：外框定单页比例，内图放大到整块高度后上移到对应页带 */
function pageFrameStyle(page: ScreenshotPage) {
  return { aspectRatio: `${page.imageWidth} / ${page.bandHeight}` }
}

function pageSheetStyle(page: ScreenshotPage) {
  return {
    height: `${page.bandCount * 100}%`,
    top: `${-page.bandIndex * 100}%`,
  }
}

async function startWatch() {
  const run = ++renderRun
  const filePath = props.filePath
  loading.value = true
  errorMsg.value = ''
  try {
    const handle = await api.officecli.watchStart(filePath)
    if (run !== renderRun) {
      // 这一句之前主进程已经在跑那个子进程了，而切模式/卸载的清理只认 watchId，
      // 迟到轮次若不主动 stop，句柄就永久没人回收。
      void api.officecli.watchStop(handle.id).catch(() => {})
      return
    }
    watchId.value = handle.id
    watchUrl.value = handle.url
  } catch (err) {
    if (run !== renderRun) return
    errorMsg.value = extractErrorMessage(err)
    console.error('[OfficePreview] Watch start failed:', err)
  } finally {
    if (run === renderRun) loading.value = false
  }
}

async function switchMode(mode: 'html' | 'screenshots' | 'watch') {
  // pdf 不在 officecli watch 的支持范围内：强制回退 html，
  // 防止上一个 office 文档的 watch 模式经 props.filePath 切换残留到 pdf 上。
  if (isPdfFile.value && mode !== 'html') {
    mode = 'html'
  }
  // Stop previous watch
  if (watchId.value) {
    try {
      await api.officecli.watchStop(watchId.value)
    } catch { /* ignore */ }
    watchId.value = ''
    watchUrl.value = ''
  }
  currentMode.value = mode
  if (mode === 'html') await renderHtml()
  else if (mode === 'screenshots') await renderScreenshots()
  else if (mode === 'watch') await startWatch()
}

function getLocalImageUrl(imgPath: string): string {
  return pathToFileURL(imgPath)
}

/** Cross-platform file:// URL */
function pathToFileURL(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  return 'file://' + (normalized.startsWith('/') ? '' : '/') + normalized
}

function openFullSize(imgPath: string) {
  api.openInEditor('fileExplorer', imgPath)
}

function openExternal() {
  api.artifacts.open(props.filePath)
}

/** 从 Error 或 unknown 中提取消息字符串 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** 一键下载 OfficeCLI binary */
async function handleDownload() {
  if (downloading.value) return
  downloading.value = true
  downloadMsg.value = t('officePreview.downloading')
  downloadPercent.value = 0

  // Subscribe to progress events
  downloadProgressUnsubscribe = api.officecli.onDownloadProgress((progress) => {
    downloadMsg.value = progress.message
    downloadPercent.value = progress.percent
  })

  try {
    const result = await api.officecli.download()
    if (result.success) {
      errorMsg.value = ''
      // Retry the current preview mode after successful download
      await switchMode(currentMode.value)
    } else {
      errorMsg.value = result.error || t('officePreview.downloadFailed')
    }
  } catch (err) {
    errorMsg.value = extractErrorMessage(err)
  } finally {
    downloading.value = false
    if (downloadProgressUnsubscribe) {
      downloadProgressUnsubscribe()
      downloadProgressUnsubscribe = null
    }
  }
}

function revealInFolder() {
  api.artifacts.reveal(props.filePath)
}

function onWebviewLoad() {
  loading.value = false
  injectExpandCSS()
}

/** 向 webview 注入 CSS 使内容铺满面板 */
async function injectExpandCSS() {
  const wv = previewWebviewRef.value
  if (!wv?.insertCSS) return
  try {
    await wv.insertCSS(EXPAND_CSS)
  } catch (e) {
    console.warn('[OfficePreview] CSS injection failed:', e)
  }
}

/** artifacts:changed 回调：防抖后静默重渲染 HTML 预览 */
function onArtifactsChanged() {
  // 仅 HTML 模式需要手动刷新（watch 模式自带实时刷新）
  if (currentMode.value !== 'html') return
  if (!props.filePath) return
  if (rerenderDebounceTimer) clearTimeout(rerenderDebounceTimer)
  rerenderDebounceTimer = setTimeout(async () => {
    rerenderDebounceTimer = null
    if (currentMode.value !== 'html') return
    const run = ++renderRun
    const filePath = props.filePath
    try {
      const htmlPath = await api.officecli.viewHtml(filePath)
      if (run !== renderRun) return
      htmlPreviewUrl.value = pathToFileURL(htmlPath)
    } catch (err) {
      if (run !== renderRun) return
      console.error('[OfficePreview] Re-render failed:', err)
    }
  }, 800)
}

watch(() => props.filePath, async (newPath) => {
  if (newPath) {
    await switchMode(currentMode.value)
  }
})

onMounted(async () => {
  const initialMode = appStore.officePreviewMode || 'html'
  // 订阅必须在首轮渲染之前落定：首轮要跑数秒，期间关掉面板的话，
  // 排在 await 之后注册的监听再也没有实例去摘它。
  artifactsUnsubscribe = api.artifacts.onChanged(() => {
    onArtifactsChanged()
  })
  await switchMode(initialMode)
})

onBeforeUnmount(() => {
  // 作废在飞轮次：迟到的 startWatch 会自己把句柄 stop 掉，而不是写进一个没人清理的实例。
  renderRun++
  if (watchId.value) {
    void api.officecli.watchStop(watchId.value).catch(() => {})
    watchId.value = ''
  }
  if (artifactsUnsubscribe) {
    artifactsUnsubscribe()
    artifactsUnsubscribe = null
  }
  if (downloadProgressUnsubscribe) {
    downloadProgressUnsubscribe()
    downloadProgressUnsubscribe = null
  }
  if (rerenderDebounceTimer) {
    clearTimeout(rerenderDebounceTimer)
    rerenderDebounceTimer = null
  }
})
</script>

<style lang="scss" scoped>
.office-preview-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-glass);
  flex-shrink: 0;
}

.preview-file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  .file-icon { font-size: 18px; flex-shrink: 0; }
  .file-name {
    font-size: 13px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.preview-actions {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-shrink: 0;
}

.preview-mode-btn {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--surface-border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--accent-primary);
    color: white;
    border-color: var(--accent-primary);
  }
}

.preview-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 14px;
  border: 1px solid var(--surface-border);
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--accent-primary);
    background: var(--surface-glass-hover);
  }
}

.preview-content {
  flex: 1;
  overflow: hidden;
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.html-viewer,
.watch-viewer,
.screenshot-viewer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.preview-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;

  .spin-icon {
    animation: spin 1s linear infinite;
    color: var(--accent-primary);
  }
}

.preview-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 12px;
  padding: 20px;
  text-align: center;
  word-break: break-word;

  .error-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 400px;
  }

  .error-text {
    line-height: 1.5;
  }
}

.download-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  border: 1px solid var(--accent-primary);
  background: var(--accent-primary);
  color: white;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    opacity: 0.9;
  }
}

.download-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent-primary);
  font-size: 12px;
}

.preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}

.preview-webview {
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
  border: none;
  background: white;
}

.screenshot-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  @include scrollbar-overlay;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.screenshot-item {
  position: relative;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.2s;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  img {
    width: 100%;
    height: auto;
    display: block;
  }

  // 长图裁切：外框用 aspect-ratio 占住单页比例，内图靠内联样式放大并上移
  .page-crop {
    position: relative;
    width: 100%;
    overflow: hidden;

    img {
      position: absolute;
      left: 0;
      width: 100%;
    }
  }

  .page-num {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

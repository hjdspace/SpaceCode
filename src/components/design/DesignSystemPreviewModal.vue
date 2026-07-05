<template>
  <Teleport to="body">
    <div class="ds-preview-modal-backdrop" role="dialog" aria-modal="true" @click.self="onClose">
      <div class="ds-preview-modal">
        <header class="ds-preview-modal-header">
          <div class="ds-preview-modal-title-block">
            <div class="ds-preview-modal-title">{{ system.name }}</div>
            <div class="ds-preview-modal-subtitle">
              {{ system.description || system.category }}
            </div>
          </div>

          <div class="ds-preview-modal-controls">
            <div class="ds-preview-modal-tabs" role="tablist">
              <button
                v-for="tab in tabs"
                :key="tab.id"
                type="button"
                role="tab"
                class="ds-preview-modal-tab"
                :class="{ active: activeTab === tab.id }"
                :aria-selected="activeTab === tab.id"
                @click="setActiveTab(tab.id)"
              >
                {{ tab.label }}
              </button>
            </div>
            <button
              type="button"
              class="ds-preview-modal-ghost"
              :class="{ 'is-active': sidebarOpen }"
              @click="sidebarOpen = !sidebarOpen"
            >
              DESIGN.md
            </button>
            <div class="ds-preview-modal-share-wrap" ref="shareMenuRef">
              <button type="button" class="ds-preview-modal-share" :aria-expanded="shareMenuOpen" @click="shareMenuOpen = !shareMenuOpen">
                <Share2 :size="15" />
                <span>{{ t('common.share') }}</span>
                <ChevronDown :size="14" />
              </button>
              <div v-if="shareMenuOpen" class="ds-share-popover" role="menu">
                <div class="ds-share-group-label">{{ t('design.preview.shareExportGroup') }}</div>
                <button type="button" class="ds-share-item" role="menuitem" :disabled="!activeHtml" @click="exportAsPdf">
                  <FileText :size="15" />
                  <span>{{ t('design.preview.exportPdf') }}</span>
                </button>
                <button type="button" class="ds-share-item" role="menuitem" :disabled="!activeHtml" @click="exportAsZip">
                  <FolderArchive :size="15" />
                  <span>{{ t('design.preview.exportZip') }}</span>
                </button>
                <button type="button" class="ds-share-item" role="menuitem" :disabled="!activeHtml" @click="exportAsHtml">
                  <FileCode :size="15" />
                  <span>{{ t('design.preview.exportHtml') }}</span>
                </button>
                <button type="button" class="ds-share-item" role="menuitem" :disabled="!activeHtml" @click="exportAsImage">
                  <ImageIcon :size="15" />
                  <span>{{ t('design.preview.exportImage') }}</span>
                </button>
                <div class="ds-share-divider" />
                <button type="button" class="ds-share-item" role="menuitem" :disabled="!activeHtml" @click="openInNewTab">
                  <ExternalLink :size="15" />
                  <span>{{ t('design.preview.openInNewTab') }}</span>
                </button>
              </div>
            </div>
            <button type="button" class="ds-preview-modal-close" :title="t('common.close')" @click="onClose">
              <X :size="18" />
            </button>
          </div>
        </header>

        <div class="ds-preview-modal-stage" :class="{ 'has-sidebar': sidebarOpen }">
          <div class="ds-preview-modal-iframe-wrap">
            <iframe
              v-if="activeHtml"
              ref="iframeRef"
              class="ds-preview-modal-iframe"
              :srcdoc="activeHtml"
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              :title="`${system.name} ${activeTabLabel}`"
            />
            <div v-else-if="loading" class="ds-preview-modal-empty">{{ t('common.loading') }}</div>
            <div v-else class="ds-preview-modal-empty">{{ t('design.preview.noPreview') }}</div>
          </div>

          <aside
            v-if="sidebarOpen"
            class="ds-preview-modal-sidebar"
            aria-label="DESIGN.md"
          >
            <div v-if="designMdHtml" class="ds-preview-modal-markdown" v-html="designMdHtml" />
            <div v-else-if="designMdLoading" class="ds-preview-modal-empty in-sidebar">{{ t('common.loading') }}</div>
            <div v-else class="ds-preview-modal-empty in-sidebar">{{ t('design.preview.noSpec') }}</div>
          </aside>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Share2, X, FileText, FolderArchive, FileCode, ImageIcon, ExternalLink } from 'lucide-vue-next'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '@/services/electronAPI'
import type { DesignSystemSummary } from '@/services/electronAPI'

const props = defineProps<{
  system: DesignSystemSummary
  onClose: () => void
}>()

const { t } = useI18n()
const activeTab = ref<'showcase' | 'tokens'>('showcase')
const sidebarOpen = ref(true)
const shareMenuOpen = ref(false)
const shareMenuRef = ref<HTMLElement | null>(null)
const iframeRef = ref<HTMLIFrameElement | null>(null)
const showcaseHtml = ref<string | null>(null)
const tokensHtml = ref<string | null>(null)
const designMd = ref<string | null>(null)
const loading = ref(false)
const designMdLoading = ref(false)

const tabs = computed(() => [
  { id: 'showcase' as const, label: t('design.preview.showcase') },
  { id: 'tokens' as const, label: t('design.preview.tokens') },
])

const activeTabLabel = computed(() =>
  tabs.value.find((tab) => tab.id === activeTab.value)?.label ?? ''
)

const activeHtml = computed(() => {
  if (activeTab.value === 'showcase') return showcaseHtml.value ?? ''
  return tokensHtml.value ?? ''
})

const designMdHtml = computed(() => {
  if (!designMd.value) return ''
  const rawHtml = marked(designMd.value, { gfm: true }) as string
  return DOMPurify.sanitize(rawHtml)
})

async function loadShowcase() {
  if (showcaseHtml.value !== null) return
  loading.value = true
  try {
    showcaseHtml.value = await api.design.getSystemShowcase(props.system.id)
  } finally {
    loading.value = false
  }
}

async function loadTokens() {
  if (tokensHtml.value !== null) return
  loading.value = true
  try {
    tokensHtml.value = await api.design.getSystemTokensHtml(props.system.id)
  } finally {
    loading.value = false
  }
}

async function loadDesignMd() {
  if (designMd.value !== null) return
  designMdLoading.value = true
  try {
    designMd.value = await api.design.getSystemFile(props.system.id, 'DESIGN.md')
  } finally {
    designMdLoading.value = false
  }
}

function setActiveTab(tab: 'showcase' | 'tokens') {
  activeTab.value = tab
}

watch(activeTab, (tab) => {
  if (tab === 'showcase') loadShowcase()
  if (tab === 'tokens') loadTokens()
}, { immediate: true })

watch(sidebarOpen, (open) => {
  if (open) loadDesignMd()
}, { immediate: true })

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (shareMenuOpen.value) {
      shareMenuOpen.value = false
      return
    }
    props.onClose()
  }
}

function onClose() {
  props.onClose()
}

function onSharePointer(event: MouseEvent) {
  if (shareMenuRef.value?.contains(event.target as Node)) return
  shareMenuOpen.value = false
}

function safeFilename(name: string): string {
  const slug = (name || 'artifact')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'artifact'
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function exportAsHtml() {
  if (!activeHtml.value) return
  const blob = new Blob([activeHtml.value], { type: 'text/html;charset=utf-8' })
  triggerDownload(blob, `${safeFilename(props.system.name)}.html`)
  shareMenuOpen.value = false
}

function exportAsZip() {
  if (!activeHtml.value) return
  // Simple approach: download as standalone HTML (no JSZip dependency)
  // The HTML content from design system preview is already self-contained
  const blob = new Blob([activeHtml.value], { type: 'text/html;charset=utf-8' })
  triggerDownload(blob, `${safeFilename(props.system.name)}-standalone.html`)
  shareMenuOpen.value = false
}

function exportAsPdf() {
  if (!activeHtml.value) return
  // Open in a new window and trigger print dialog
  const printWindow = window.open('', '_blank')
  if (!printWindow) return
  printWindow.document.write(activeHtml.value)
  printWindow.document.title = props.system.name
  printWindow.document.close()
  setTimeout(() => {
    printWindow.focus()
    printWindow.print()
  }, 500)
  shareMenuOpen.value = false
}

async function exportAsImage() {
  if (!activeHtml.value || !iframeRef.value) return
  try {
    const iframe = iframeRef.value
    // Try to capture the iframe content via canvas
    const canvas = document.createElement('canvas')
    const rect = iframe.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Fill white background
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Use svg foreignObject to render the HTML content as an image
    const svgData = `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${rect.width}px;height:${rect.height}px;">${activeHtml.value.replace(/<\/?html[^>]*>/gi, '').replace(/<\/?body[^>]*>/gi, '').replace(/<\/?head[^>]*>/gi, '').replace(/<!doctype[^>]*>/i, '')}</div>
      </foreignObject>
    </svg>`
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((blob) => {
        if (blob) triggerDownload(blob, `${safeFilename(props.system.name)}.png`)
      }, 'image/png')
    }
    img.onerror = () => {
      // Fallback: use html2canvas-like approach via iframe content
      // If foreignObject fails (CORS/complex CSS), download the HTML directly
      const blob = new Blob([activeHtml.value], { type: 'text/html;charset=utf-8' })
      triggerDownload(blob, `${safeFilename(props.system.name)}.html`)
    }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData)
  } catch (err) {
    console.error('Failed to export image:', err)
    // Fallback to HTML download
    const blob = new Blob([activeHtml.value], { type: 'text/html;charset=utf-8' })
    triggerDownload(blob, `${safeFilename(props.system.name)}.html`)
  }
  shareMenuOpen.value = false
}

function openInNewTab() {
  if (!activeHtml.value) return
  const blob = new Blob([activeHtml.value], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  shareMenuOpen.value = false
}

onMounted(() => {
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKey)
  document.addEventListener('mousedown', onSharePointer)
})

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('mousedown', onSharePointer)
})
</script>

<style scoped lang="scss">
.ds-preview-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(28, 27, 26, 0.42);
  backdrop-filter: blur(2px);
  z-index: 1000;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 28px;
}

.ds-preview-modal {
  width: 100%;
  max-width: 1320px;
  min-height: 0;
  background: #fff;
  border: 1px solid #d8e0eb;
  border-radius: 12px;
  box-shadow: 0 28px 80px rgba(24, 25, 31, 0.22);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ds-preview-modal-header {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px 20px;
  border-bottom: 1px solid #dfe5ee;
  background: #fff;
}

.ds-preview-modal-title-block {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ds-preview-modal-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--text-primary);
}

.ds-preview-modal-subtitle {
  max-width: 720px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ds-preview-modal-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.ds-preview-modal-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid #dfe5ee;
  border-radius: var(--radius-full);
  background: #f5f7fa;
}

.ds-preview-modal-tab {
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-muted);
  min-width: 70px;
  height: 34px;
  padding: 0 17px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.ds-preview-modal-tab:hover {
  color: var(--text-primary);
}

.ds-preview-modal-tab.active {
  background: #fff;
  color: var(--text-primary);
  box-shadow: 0 1px 4px rgba(24, 25, 31, 0.1);
}

.ds-preview-modal-ghost,
.ds-preview-modal-share {
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid #dfe5ee;
  background: #fff;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.ds-preview-modal-ghost:hover,
.ds-preview-modal-share:hover {
  background: var(--surface-soft);
  border-color: var(--surface-border-strong);
}

.ds-preview-modal-share-wrap {
  position: relative;
  display: inline-flex;
}

.ds-share-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 220px;
  padding: 6px;
  background: #fff;
  border: 1px solid #d8e0eb;
  border-radius: 12px;
  box-shadow: 0 18px 44px rgba(24, 25, 31, 0.16);
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 2px;
  animation: sharePopoverIn 130ms cubic-bezier(0.23, 1, 0.32, 1);
  transform-origin: top right;
}

.ds-share-group-label {
  padding: 8px 10px 4px;
  font-size: 11px;
  font-weight: 800;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ds-share-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.ds-share-item:hover:not(:disabled) {
  background: var(--surface-soft);
}

.ds-share-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ds-share-item svg {
  color: var(--text-muted);
  flex-shrink: 0;
}

.ds-share-divider {
  height: 1px;
  background: #e4e9f1;
  margin: 4px 6px;
}

@keyframes sharePopoverIn {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.ds-preview-modal-ghost.is-active {
  border-color: var(--accent-primary);
  color: var(--text-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 14%, transparent);
}

.ds-preview-modal-close {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.ds-preview-modal-close:hover {
  background: var(--surface-soft);
  color: var(--text-primary);
}

.ds-preview-modal-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: 1px;
  background: #dfe5ee;
}

.ds-preview-modal-iframe-wrap {
  flex: 1 1 100%;
  min-width: 0;
  position: relative;
  overflow: hidden;
  background: #fff;
  padding: 16px;
}

.ds-preview-modal-iframe-wrap::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(to right, transparent, rgba(0, 0, 0, 0.03));
  pointer-events: none;
  z-index: 1;
}

.ds-preview-modal-stage.has-sidebar .ds-preview-modal-iframe-wrap {
  flex-basis: 60%;
}

.ds-preview-modal-iframe {
  width: 100%;
  height: 100%;
  border: 1px solid #e8ecf2;
  border-radius: 8px;
  background: #fff;
}

.ds-preview-modal-sidebar {
  position: relative;
  flex: 1 1 40%;
  min-width: 340px;
  max-width: 560px;
  overflow: auto;
  background: #fff;
  padding: 36px 32px;
  animation: sidebarIn 260ms cubic-bezier(0.16, 1, 0.3, 1);
}

.ds-preview-modal-markdown {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1.65;
}

.ds-preview-modal-markdown :deep(h1),
.ds-preview-modal-markdown :deep(h2),
.ds-preview-modal-markdown :deep(h3) {
  margin: 22px 0 10px;
  font-weight: 800;
}

.ds-preview-modal-markdown :deep(h1) {
  margin-top: 0;
  color: #2563eb;
  font-size: 16px;
}
.ds-preview-modal-markdown :deep(h2) { color: #0891b2; font-size: 15px; }
.ds-preview-modal-markdown :deep(h3) { font-size: 14px; }

.ds-preview-modal-markdown :deep(p) {
  margin: 10px 0;
  color: var(--text-secondary);
}

.ds-preview-modal-markdown :deep(ul),
.ds-preview-modal-markdown :deep(ol) {
  margin: 10px 0;
  padding-left: 22px;
}

.ds-preview-modal-markdown :deep(li) {
  margin: 5px 0;
}

.ds-preview-modal-markdown :deep(code) {
  font-family: var(--font-mono);
  font-size: 12px;
  background: #eef6f8;
  color: #0f766e;
  padding: 2px 5px;
  border-radius: 5px;
}

.ds-preview-modal-markdown :deep(pre) {
  background: #f6f8fb;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}

.ds-preview-modal-markdown :deep(pre code) {
  background: transparent;
  color: inherit;
  padding: 0;
}

.ds-preview-modal-markdown :deep(blockquote) {
  margin: 14px 0;
  padding-left: 12px;
  border-left: 3px solid var(--accent-primary);
  color: var(--text-muted);
}

.ds-preview-modal-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  font-size: 14px;
  color: var(--text-muted);
  text-align: center;
}

.ds-preview-modal-empty.in-sidebar {
  position: static;
  min-height: 200px;
}

@keyframes sidebarIn {
  from {
    opacity: 0;
    transform: translateX(28px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@media (max-width: 920px) {
  .ds-preview-modal-backdrop {
    padding: 0;
  }
  .ds-preview-modal {
    max-width: none;
    border-radius: 0;
  }
  .ds-preview-modal-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .ds-preview-modal-controls {
    justify-content: flex-start;
  }
  .ds-preview-modal-sidebar {
    min-width: 280px;
  }
}
</style>

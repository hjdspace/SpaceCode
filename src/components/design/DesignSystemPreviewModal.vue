<template>
  <Teleport to="body">
    <div class="ds-preview-modal-backdrop" role="dialog" aria-modal="true" @click.self="onClose">
      <div class="ds-preview-modal">
        <header class="ds-preview-modal-header">
          <div class="ds-preview-modal-title-block">
            <div class="ds-preview-modal-title">{{ system.name }}</div>
            <div v-if="system.category" class="ds-preview-modal-subtitle">{{ system.category }}</div>
          </div>
          <div class="ds-preview-modal-tabs" role="tablist">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              role="tab"
              class="ds-preview-modal-tab"
              :class="{ active: activeTab === tab.id }"
              :aria-selected="activeTab === tab.id"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
          <div class="ds-preview-modal-actions">
            <button
              v-if="activeTab !== 'designMd'"
              type="button"
              class="ds-preview-modal-ghost"
              :class="{ 'is-active': sidebarOpen }"
              @click="sidebarOpen = !sidebarOpen"
            >
              DESIGN.md
            </button>
            <button type="button" class="ds-preview-modal-close" :title="t('common.close')" @click="onClose">
              <X :size="14" />
            </button>
          </div>
        </header>

        <div class="ds-preview-modal-stage" :class="{ 'has-sidebar': sidebarOpen && activeTab !== 'designMd' }">
          <div class="ds-preview-modal-iframe-wrap">
            <iframe
              v-if="activeHtml"
              class="ds-preview-modal-iframe"
              :srcdoc="activeHtml"
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              :title="`${system.name} ${activeTabLabel}`"
            />
            <div v-else-if="loading" class="ds-preview-modal-empty">{{ t('common.loading') }}</div>
            <div v-else class="ds-preview-modal-empty">{{ t('design.preview.noPreview') }}</div>
          </div>

          <aside
            v-if="sidebarOpen && activeTab !== 'designMd'"
            class="ds-preview-modal-sidebar"
          >
            <div v-if="designMdHtml" class="ds-preview-modal-markdown" v-html="designMdHtml" />
            <div v-else-if="designMdLoading" class="ds-preview-modal-empty">{{ t('common.loading') }}</div>
            <div v-else class="ds-preview-modal-empty">{{ t('design.preview.noSpec') }}</div>
          </aside>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '@/services/electronAPI'
import type { DesignSystemSummary } from '@/services/electronAPI'

const props = defineProps<{
  system: DesignSystemSummary
  onClose: () => void
}>()

const { t } = useI18n()
const activeTab = ref<'showcase' | 'tokens' | 'designMd'>('showcase')
const sidebarOpen = ref(true)
const showcaseHtml = ref<string | null>(null)
const tokensHtml = ref<string | null>(null)
const designMd = ref<string | null>(null)
const loading = ref(false)
const designMdLoading = ref(false)

const tabs = computed(() => [
  { id: 'showcase' as const, label: t('design.preview.showcase') },
  { id: 'tokens' as const, label: t('design.preview.tokens') },
  { id: 'designMd' as const, label: 'DESIGN.md' },
])

const activeTabLabel = computed(() =>
  tabs.value.find((tab) => tab.id === activeTab.value)?.label ?? ''
)

const activeHtml = computed(() => {
  if (activeTab.value === 'showcase') return showcaseHtml.value ?? ''
  if (activeTab.value === 'tokens') return tokensHtml.value ?? ''
  return designMdHtml.value ?? ''
})

const designMdHtml = computed(() => {
  if (!designMd.value) return ''
  const rawHtml = marked(designMd.value, { gfm: true }) as string
  return DOMPurify.sanitize(rawHtml)
})

async function loadShowcase() {
  if (showcaseHtml.value !== null) return
  loading.value = true
  showcaseHtml.value = await api.design.getSystemShowcase(props.system.id)
  loading.value = false
}

async function loadTokens() {
  if (tokensHtml.value !== null) return
  loading.value = true
  tokensHtml.value = await api.design.getSystemTokensHtml(props.system.id)
  loading.value = false
}

async function loadDesignMd() {
  if (designMd.value !== null) return
  designMdLoading.value = true
  designMd.value = await api.design.getSystemFile(props.system.id, 'DESIGN.md')
  designMdLoading.value = false
}

watch(activeTab, (tab) => {
  if (tab === 'showcase') loadShowcase()
  if (tab === 'tokens') loadTokens()
  if (tab === 'designMd') loadDesignMd()
}, { immediate: true })

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') props.onClose()
}

onMounted(() => {
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped lang="scss">
.ds-preview-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.ds-preview-modal {
  width: 100%;
  height: 100%;
  max-width: 1200px;
  max-height: 820px;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ds-preview-modal-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--bg-primary);
}

.ds-preview-modal-title-block {
  display: flex;
  flex-direction: column;
  min-width: 140px;
}

.ds-preview-modal-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.ds-preview-modal-subtitle {
  font-size: 12px;
  color: var(--text-muted);
}

.ds-preview-modal-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: center;
}

.ds-preview-modal-tab {
  padding: 5px 12px;
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
}

.ds-preview-modal-tab:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.ds-preview-modal-tab.active {
  border-color: var(--surface-border);
  background: var(--bg-primary);
  color: var(--text-primary);
}

.ds-preview-modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ds-preview-modal-ghost {
  padding: 5px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--surface-border);
  background: var(--bg-primary);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
}

.ds-preview-modal-ghost:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.ds-preview-modal-ghost.is-active {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
  background: var(--accent-primary-glow);
}

.ds-preview-modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-full);
  border: 1px solid var(--surface-border);
  background: var(--bg-primary);
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.ds-preview-modal-close:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.ds-preview-modal-stage {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.ds-preview-modal-iframe-wrap {
  flex: 1;
  min-width: 0;
  background: var(--bg-primary);
  position: relative;
}

.ds-preview-modal-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: white;
}

.ds-preview-modal-sidebar {
  width: 360px;
  border-left: 1px solid var(--surface-border);
  background: var(--bg-primary);
  overflow-y: auto;
  padding: 16px;
}

.ds-preview-modal-markdown {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
}

.ds-preview-modal-markdown :deep(h1),
.ds-preview-modal-markdown :deep(h2),
.ds-preview-modal-markdown :deep(h3) {
  margin: 16px 0 8px;
  font-weight: 600;
  color: var(--text-primary);
}

.ds-preview-modal-markdown :deep(h1) { font-size: 16px; }
.ds-preview-modal-markdown :deep(h2) { font-size: 14px; }
.ds-preview-modal-markdown :deep(h3) { font-size: 13px; }

.ds-preview-modal-markdown :deep(p) {
  margin: 8px 0;
  color: var(--text-secondary);
}

.ds-preview-modal-markdown :deep(ul),
.ds-preview-modal-markdown :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.ds-preview-modal-markdown :deep(li) {
  margin: 4px 0;
}

.ds-preview-modal-markdown :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  background: var(--bg-secondary);
  padding: 2px 4px;
  border-radius: var(--radius-sm);
}

.ds-preview-modal-markdown :deep(pre) {
  background: var(--bg-secondary);
  padding: 10px;
  border-radius: var(--radius-md);
  overflow-x: auto;
}

.ds-preview-modal-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}

.ds-preview-modal-markdown :deep(blockquote) {
  margin: 10px 0;
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
  font-size: 13px;
  color: var(--text-muted);
}

@media (max-width: 840px) {
  .ds-preview-modal {
    border-radius: 0;
    max-width: none;
    max-height: none;
  }
  .ds-preview-modal-sidebar {
    width: 280px;
  }
}
</style>

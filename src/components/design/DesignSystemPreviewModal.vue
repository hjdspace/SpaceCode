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
            <button type="button" class="ds-preview-modal-share">
              <Share2 :size="15" />
              <span>{{ t('common.share') }}</span>
              <ChevronDown :size="14" />
            </button>
            <button type="button" class="ds-preview-modal-close" :title="t('common.close')" @click="onClose">
              <X :size="18" />
            </button>
          </div>
        </header>

        <div class="ds-preview-modal-stage" :class="{ 'has-sidebar': sidebarOpen }">
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
import { ChevronDown, Share2, X } from 'lucide-vue-next'
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
  if (event.key === 'Escape') props.onClose()
}

function onClose() {
  props.onClose()
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
  background: #fff;
}

.ds-preview-modal-iframe-wrap {
  flex: 1 1 100%;
  min-width: 0;
  position: relative;
  overflow: hidden;
  background: #fff;
}

.ds-preview-modal-stage.has-sidebar .ds-preview-modal-iframe-wrap {
  flex-basis: 60%;
}

.ds-preview-modal-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.ds-preview-modal-sidebar {
  position: relative;
  flex: 1 1 40%;
  min-width: 340px;
  max-width: 560px;
  overflow: auto;
  border-left: 1px solid #dfe5ee;
  background: #fff;
  padding: 36px 28px;
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

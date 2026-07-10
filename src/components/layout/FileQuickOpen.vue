<template>
  <div v-if="appStore.showFileQuickOpen" class="quick-open-overlay" @mousedown.self="close">
    <div class="quick-open" @keydown="onKeydown" tabindex="0">
      <div class="qo-search">
        <Search :size="16" class="qo-search-icon" />
        <input
          ref="inputRef"
          v-model="query"
          class="qo-input"
          type="text"
          :placeholder="t('quickOpen.placeholder')"
        />
      </div>

      <div v-if="!hasProject" class="qo-empty">{{ t('quickOpen.noProject') }}</div>
      <div v-else-if="results.length === 0 && query" class="qo-empty">{{ t('quickOpen.noResults') }}</div>

      <ul v-else class="qo-list" ref="listRef">
        <li
          v-for="(item, index) in results"
          :key="item.path"
          class="qo-item"
          :class="{ active: index === activeIndex }"
          @mouseenter="activeIndex = index"
          @click="openItem(item)"
        >
          <FileText :size="14" class="qo-item-icon" />
          <span class="qo-name">{{ item.name }}</span>
          <span class="qo-path">{{ item.relativePath }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, FileText } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { api, type FileSearchEntry } from '@/services/electronAPI'

const { t } = useI18n()
const appStore = useAppStore()

const query = ref('')
const results = ref<FileSearchEntry[]>([])
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const hasProject = computed(() => !!(appStore.projectRoot || '').trim())

let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchSeq = 0

watch(() => appStore.showFileQuickOpen, (visible) => {
  if (visible) {
    query.value = ''
    results.value = []
    activeIndex.value = 0
    nextTick(() => inputRef.value?.focus())
  }
}, { immediate: true })

watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  const trimmed = q.trim()
  if (!trimmed || !hasProject.value) {
    results.value = []
    return
  }
  searchTimer = setTimeout(() => runSearch(trimmed), 150)
})

async function runSearch(q: string) {
  const seq = ++searchSeq
  const entries = await api.searchFiles(appStore.projectRoot, q, { maxResults: 50 })
  if (seq !== searchSeq) return
  results.value = entries.filter(e => e.isFile)
  activeIndex.value = 0
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (results.value.length) activeIndex.value = (activeIndex.value + 1) % results.value.length
    scrollToActive()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (results.value.length) activeIndex.value = (activeIndex.value - 1 + results.value.length) % results.value.length
    scrollToActive()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = results.value[activeIndex.value]
    if (item) openItem(item)
  }
}

function scrollToActive() {
  nextTick(() => {
    const el = listRef.value?.children[activeIndex.value] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function openItem(item: FileSearchEntry) {
  appStore.openFile(item.path)
  close()
}

function close() {
  appStore.showFileQuickOpen = false
}
</script>

<style lang="scss" scoped>
.quick-open-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.25);
}

.quick-open {
  width: 560px;
  max-width: calc(100vw - 32px);
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.qo-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--surface-border);
}

.qo-search-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.qo-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
}

.qo-empty {
  padding: 20px 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.qo-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  max-height: 360px;
  overflow-y: auto;
}

.qo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-secondary);

  &.active {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
}

.qo-item-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.qo-name {
  font-size: 13px;
  flex-shrink: 0;
}

.qo-path {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

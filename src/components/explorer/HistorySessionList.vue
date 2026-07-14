<template>
  <div class="history-session-list">
    <div v-if="loading" class="loading-state">
      <span>{{ t('explorer.loading') }}</span>
    </div>

    <div v-else-if="sessions.length === 0" class="empty-state">
      <span>{{ t('explorer.noHistory') }}</span>
    </div>

    <div v-else-if="searchQuery && filteredSessions.length === 0" class="empty-state">
      <span>{{ t('explorer.noMatchSearch', { query: searchQuery }) }}</span>
    </div>

    <div v-else class="session-items">
      <div
        v-for="session in displaySessions"
        :key="session.sessionId || session.id"
        class="session-item"
        @click="handleSelectSession(session)"
      >
        <div class="session-header">
          <span class="session-title">{{ session.title || getSessionTitle(session) }}</span>
          <span class="session-time">{{ formatTime(session.lastMessageTimestamp ?? session.lastMessageAt ?? session.updatedAt) }}</span>
        </div>
        <div v-if="session.firstUserMessage || session.lastMessagePreview" class="session-preview">
          {{ session.firstUserMessage || session.lastMessagePreview }}
        </div>
        <div class="session-meta">
          <span v-if="session.projectPath" class="project-path">
            {{ getProjectName(session.projectPath) }}
          </span>
        </div>
      </div>

      <!-- Load More Button -->
      <button
        v-if="canLoadMore"
        class="load-more-btn"
        :disabled="loadingMore"
        @click.stop="loadMore"
      >
        {{ loadingMore ? t('explorer.loading') : t('explorer.loadMore', { count: sessions.length - displayLimit }) }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'

const props = defineProps<{
  searchQuery?: string
}>()

const emit = defineEmits<{
  (e: 'select', session: any): void
}>()

interface SessionLite {
  id?: string
  sessionId?: string
  title?: string
  projectPath?: string
  lastMessageAt?: number
  lastMessageTimestamp?: number
  updatedAt?: number
  lastMessagePreview?: string
  firstUserMessage?: string
  metadata?: any
}

const sessions = ref<SessionLite[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const displayLimit = ref(20) // 初始显示数量
const INITIAL_LIMIT = 20
const LOAD_MORE_COUNT = 20

const { t } = useI18n()
const appStore = useAppStore()
const sessionStore = useChatSessionStore()

const filteredSessions = computed(() => {
  if (!props.searchQuery?.trim()) {
    return sessions.value
  }

  const query = props.searchQuery.toLowerCase().trim()

  return sessions.value.filter(session => {
    const title = (session.title || getSessionTitle(session)).toLowerCase()
    const projectPath = (session.projectPath || '').toLowerCase()
    const preview = ((session.firstUserMessage || session.lastMessagePreview) || '').toLowerCase()

    return title.includes(query) || projectPath.includes(query) || preview.includes(query)
  })
})

// 分页显示
const displaySessions = computed(() => {
  return filteredSessions.value.slice(0, displayLimit.value)
})

const canLoadMore = computed(() => {
  return filteredSessions.value.length > displayLimit.value
})

async function loadSessions() {
  loading.value = true
  try {
    const claudeCode = window.electronAPI?.claudeCode
    if (claudeCode) {
      let loadedSessions: SessionLite[] = []
      if (sessionStore.currentProjectRoot) {
        loadedSessions = await claudeCode.listProjectSessions(sessionStore.currentProjectRoot) as SessionLite[]
      } else {
        loadedSessions = await claudeCode.listAllSessions() as SessionLite[]
      }
      // 限制总加载数量
      sessions.value = loadedSessions.slice(0, 200)
      displayLimit.value = INITIAL_LIMIT
    }
  } catch (error) {
    console.error('Failed to load history sessions:', error)
  } finally {
    loading.value = false
  }
}

function loadMore() {
  if (loadingMore.value) return
  loadingMore.value = true

  // 使用 setTimeout 让UI有机会更新按钮状态
  setTimeout(() => {
    displayLimit.value += LOAD_MORE_COUNT
    loadingMore.value = false
  }, 50)
}

function handleSelectSession(session: SessionLite) {
  emit('select', session)
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return ''

  const now = Date.now()
  const diff = now - timestamp

  if (diff < 60000) {
    return t('explorer.justNow')
  }

  if (diff < 3600000) {
    return t('explorer.minutesAgo', { count: Math.floor(diff / 60000) })
  }

  if (diff < 86400000) {
    return t('explorer.hoursAgo', { count: Math.floor(diff / 3600000) })
  }

  if (diff < 604800000) {
    return t('explorer.daysAgo', { count: Math.floor(diff / 86400000) })
  }

  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function getProjectName(pathStr: string): string {
  return pathStr.split(/[/\\]/).pop() || pathStr
}

function getSessionTitle(session: SessionLite): string {
  if (session.metadata?.customTitle) {
    return session.metadata.customTitle
  }
  if (session.firstUserMessage) {
    const preview = session.firstUserMessage.slice(0, 60)
    return preview.length < session.firstUserMessage.length ? preview + '...' : preview
  }
  return t('explorer.sessionLabel', { id: (session.sessionId || session.id || '').slice(0, 8) })
}

onMounted(() => {
  loadSessions()
})
</script>

<style lang="scss" scoped>
.history-session-list {
  padding: 8px;
  overflow-y: auto;
  max-height: calc(75vh - 120px);
}

.loading-state,
.empty-state {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.session-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-item {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.session-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.session-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-time {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 8px;
  flex-shrink: 0;
}

.session-preview {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
}

.session-meta {
  display: flex;
  gap: 8px;
}

.project-path {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-glass);
  padding: 2px 6px;
  border-radius: 4px;
}

.load-more-btn {
  width: 100%;
  padding: 8px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    background: var(--surface-glass-hover);
    color: var(--text-secondary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>

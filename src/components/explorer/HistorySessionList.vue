<template>
  <div class="history-session-list">
    <div v-if="loading" class="loading-state">
      <span>加载中...</span>
    </div>

    <div v-else-if="sessions.length === 0" class="empty-state">
      <span>暂无历史会话</span>
    </div>

    <div v-else class="session-items">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="session-item"
        @click="handleSelectSession(session)"
      >
        <div class="session-header">
          <span class="session-title">{{ session.title }}</span>
          <span class="session-time">{{ formatTime(session.lastMessageAt || session.updatedAt) }}</span>
        </div>
        <div v-if="session.lastMessagePreview" class="session-preview">
          {{ session.lastMessagePreview }}
        </div>
        <div class="session-meta">
          <span v-if="session.projectPath" class="project-path">
            {{ getProjectName(session.projectPath) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'

const emit = defineEmits<{
  (e: 'select', session: any): void
}>()

interface SessionLite {
  id: string
  title: string
  projectPath?: string
  lastMessageAt?: number
  updatedAt: number
  lastMessagePreview?: string
}

const sessions = ref<SessionLite[]>([])
const loading = ref(false)
const appStore = useAppStore()
const chatStore = useChatStore()

async function loadSessions() {
  loading.value = true
  try {
    const claudeCode = (window as any).electronAPI?.claudeCode
    if (claudeCode) {
      let loadedSessions: SessionLite[] = []
      if (chatStore.currentProjectRoot) {
        loadedSessions = await claudeCode.listProjectSessions(chatStore.currentProjectRoot)
      } else {
        loadedSessions = await claudeCode.listAllSessions()
      }
      sessions.value = loadedSessions
    }
  } catch (error) {
    console.error('Failed to load history sessions:', error)
  } finally {
    loading.value = false
  }
}

function handleSelectSession(session: SessionLite) {
  emit('select', session)
}

function formatTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  
  // Less than 1 minute
  if (diff < 60000) {
    return '刚刚'
  }
  
  // Less than 1 hour
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`
  }
  
  // Less than 24 hours
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`
  }
  
  // Less than 7 days
  if (diff < 604800000) {
    return `${Math.floor(diff / 86400000)}天前`
  }
  
  // Format as date
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function getProjectName(path: string): string {
  return path.split('/').pop() || path
}

onMounted(() => {
  loadSessions()
})
</script>

<style lang="scss" scoped>
.history-session-list {
  padding: 8px;
  overflow-y: auto;
  max-height: 400px;
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
</style>

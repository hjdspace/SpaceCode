<template>
  <div class="mcp-manager">
    <!-- Fixed header -->
    <div class="mcp-header">
      <div class="header-content">
        <div>
          <h1 class="title">
            MCP Servers
            <span v-if="serverCount > 0" class="server-count">({{ serverCount }})</span>
          </h1>
          <p class="description">Manage Model Context Protocol servers for extending Claude's capabilities</p>
        </div>
        <button class="btn btn-primary" @click="handleAdd">
          <Plus :size="14" />
          Add Server
        </button>
      </div>
    </div>

    <!-- Scrollable content -->
    <div class="mcp-content">
      <div v-if="error" class="error-banner">
        <p>{{ error }}</p>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        <button
          class="tab-btn"
          :class="{ active: tab === 'list' }"
          @click="tab = 'list'"
        >
          <List :size="14" />
          List
        </button>
        <button
          class="tab-btn"
          :class="{ active: tab === 'json' }"
          @click="tab = 'json'"
        >
          <Code :size="14" />
          JSON
        </button>
      </div>

      <!-- List Tab -->
      <div v-if="tab === 'list'" class="tab-content">
        <div v-if="loading" class="loading-state">
          <Loader2 :size="16" class="spin" />
          <p>Loading servers...</p>
        </div>
        <McpServerList
          v-else
          :servers="servers"
          @edit="handleEdit"
          @delete="handleDelete"
          @toggle-enabled="handleToggleEnabled"
          @reconnect="handleReconnect"
        />
      </div>

      <!-- JSON Tab -->
      <div v-else class="tab-content">
        <p v-if="hasClaudeJsonServers" class="json-hint">
          Servers from ~/.claude.json are managed by Claude CLI and not shown here.
          Use the list tab to edit or delete them.
        </p>
        <ConfigEditor
          :value="jsonConfig"
          label="Server Configuration"
          @save="handleJsonSave"
        />
      </div>

      <!-- Runtime Status Section -->
      <div class="runtime-section">
        <div class="runtime-header">
          <div class="runtime-title">
            <Wifi :size="16" />
            <span>Runtime Status</span>
          </div>
          <button
            class="refresh-btn"
            @click="fetchRuntimeStatus"
            :disabled="runtimeLoading"
          >
            <Loader2 v-if="runtimeLoading" :size="12" class="spin" />
            <RefreshCw v-else :size="12" />
            Refresh
          </button>
        </div>

        <div v-if="!activeSessionId" class="runtime-empty">
          No active session
        </div>
        <div v-else-if="runtimeStatus.length === 0" class="runtime-empty">
          No runtime status available
        </div>
        <div v-else class="runtime-list">
          <div
            v-for="status in runtimeStatus"
            :key="status.name"
            class="runtime-item"
          >
            <div class="runtime-info">
              <span class="status-dot" :class="status.status" />
              <span class="server-name">{{ status.name }}</span>
            </div>
            <span class="status-badge" :class="status.status">
              {{ status.status }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Server Editor Modal -->
    <McpServerEditor
      v-model:open="editorOpen"
      :name="editingName"
      :server="editingServer"
      @save="handleSave"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  Plus, List, Code, Loader2, Wifi, RefreshCw
} from 'lucide-vue-next'
import { useMcpStore, type MCPServer } from '@/stores/mcp'
import McpServerList from './McpServerList.vue'
import McpServerEditor from './McpServerEditor.vue'
import ConfigEditor from './ConfigEditor.vue'

const mcpStore = useMcpStore()

const tab = ref<'list' | 'json'>('list')
const editorOpen = ref(false)
const editingName = ref<string | undefined>()
const editingServer = ref<MCPServer | undefined>()

const servers = computed(() => mcpStore.servers)
const serverList = computed(() => mcpStore.serverList)
const loading = computed(() => mcpStore.loading)
const runtimeLoading = computed(() => mcpStore.runtimeLoading)
const error = computed(() => mcpStore.error)
const runtimeStatus = computed(() => mcpStore.runtimeStatus)
const activeSessionId = computed(() => mcpStore.activeSessionId)
const serverCount = computed(() => mcpStore.serverCount)

const hasClaudeJsonServers = computed(() =>
  Object.values(servers.value).some(s => s._source === 'claude.json')
)

const jsonConfig = computed(() => {
  const filtered = Object.fromEntries(
    Object.entries(servers.value)
      .filter(([, v]) => v._source !== 'claude.json')
      .map(([k, v]) => {
        const { _source, id, name, ...rest } = v
        return [k, rest]
      })
  )
  return JSON.stringify(filtered, null, 2)
})

function handleAdd() {
  editingName.value = undefined
  editingServer.value = undefined
  editorOpen.value = true
}

function handleEdit(name: string, server: MCPServer) {
  editingName.value = name
  editingServer.value = server
  editorOpen.value = true
}

async function handleDelete(name: string) {
  if (!confirm(`Delete server "${name}"?`)) return
  try {
    await mcpStore.deleteServer(name)
  } catch (err) {
    console.error('Failed to delete server:', err)
    alert(err instanceof Error ? err.message : 'Failed to delete server')
  }
}

async function handleToggleEnabled(name: string, enabled: boolean) {
  try {
    await mcpStore.toggleServerEnabled(name, enabled)
  } catch (err) {
    console.error('Failed to toggle server:', err)
  }
}

async function handleSave(name: string, server: Omit<MCPServer, 'id' | 'name'>) {
  try {
    if (editingName.value && editingName.value !== name) {
      await mcpStore.updateServer(name, server, editingName.value)
    } else if (editingName.value) {
      await mcpStore.updateServer(name, server)
    } else {
      await mcpStore.addServer(name, server)
    }
    editorOpen.value = false
  } catch (err) {
    console.error('Failed to save server:', err)
    alert(err instanceof Error ? err.message : 'Failed to save server')
  }
}

async function handleJsonSave(jsonStr: string) {
  try {
    await mcpStore.saveJsonConfig(jsonStr)
  } catch (err) {
    console.error('Failed to save config:', err)
    alert(err instanceof Error ? err.message : 'Failed to save config')
  }
}

async function handleReconnect(name: string) {
  try {
    await mcpStore.reconnectServer(name)
    await mcpStore.fetchRuntimeStatus()
  } catch (err) {
    console.error('Failed to reconnect server:', err)
    alert(err instanceof Error ? err.message : 'Failed to reconnect server')
  }
}

async function fetchRuntimeStatus() {
  await mcpStore.fetchRuntimeStatus()
}

onMounted(() => {
  mcpStore.fetchServers()
  mcpStore.fetchRuntimeStatus()
})
</script>

<style lang="scss" scoped>
.mcp-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.mcp-header {
  flex-shrink: 0;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.header-content {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-right: 48px; // Make room for the close button in modal
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.server-count {
  font-size: 14px;
  font-weight: 400;
  color: var(--text-muted);
  margin-left: 8px;
}

.description {
  font-size: 13px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

.mcp-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.error-banner {
  padding: 12px 16px;
  background: rgba(220, 53, 69, 0.1);
  border-radius: 8px;
  margin-bottom: 16px;

  p {
    font-size: 13px;
    color: #dc3545;
    margin: 0;
  }
}

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }
}

.tab-content {
  margin-bottom: 24px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px;
  color: var(--text-muted);

  p {
    font-size: 13px;
    margin: 0;
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.json-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.runtime-section {
  border-top: 1px solid var(--border-color);
  padding-top: 16px;
}

.runtime-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.runtime-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);

  svg {
    color: var(--text-muted);
  }
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  border: none;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.runtime-empty {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.runtime-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.runtime-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-radius: 6px;
}

.runtime-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.connected {
    background: #10b981;
  }

  &.failed {
    background: #dc3545;
  }

  &.pending {
    background: var(--accent-primary);
  }

  &.disabled {
    background: #9ca3af;
  }

  &.needs-auth {
    background: #f59e0b;
  }
}

.server-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  text-transform: lowercase;

  &.connected {
    border-color: #10b981;
    color: #10b981;
  }

  &.failed {
    border-color: #dc3545;
    color: #dc3545;
  }

  &.pending {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  &.disabled {
    border-color: #9ca3af;
    color: #9ca3af;
  }

  &.needs-auth {
    border-color: #f59e0b;
    color: #f59e0b;
  }
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s;

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }
}
</style>

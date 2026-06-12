<template>
  <div class="mcp-manager">
    <!-- Fixed header -->
    <div class="mcp-header">
      <div class="header-content">
        <div class="header-left">
          <button class="back-btn" @click="handleClose" :title="t('mcpSettings.backToChat')">
            <ArrowLeft :size="18" />
          </button>
          <div>
            <h1 class="title">
              {{ t('mcpSettings.title') }}
              <span v-if="serverCount > 0" class="server-count">({{ serverCount }})</span>
            </h1>
            <p class="description">{{ t('mcpSettings.description') }}</p>
          </div>
        </div>
        <button class="btn btn-primary" @click="handleAdd">
          <Plus :size="14" />
          {{ t('mcpSettings.addServer') }}
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
          {{ t('mcpSettings.tabList') }}
        </button>
        <button
          class="tab-btn"
          :class="{ active: tab === 'json' }"
          @click="tab = 'json'"
        >
          <Code :size="14" />
          {{ t('mcpSettings.tabJson') }}
        </button>
      </div>

      <!-- List Tab -->
      <div v-if="tab === 'list'" class="tab-content">
        <div v-if="loading" class="loading-state">
          <Loader2 :size="16" class="spin" />
          <p>{{ t('mcpSettings.loadingServers') }}</p>
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
          {{ t('mcpSettings.jsonTabNote') }}
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
            <span>{{ t('mcpSettings.runtimeStatus') }}</span>
          </div>
          <button
            class="refresh-btn"
            @click="fetchRuntimeStatus"
            :disabled="runtimeLoading"
          >
            <Loader2 v-if="runtimeLoading" :size="12" class="spin" />
            <RefreshCw v-else :size="12" />
            {{ t('mcpSettings.refresh') }}
          </button>
        </div>

        <div v-if="!activeSessionId && !runtimeLoading && probeResultCount === 0" class="runtime-empty runtime-hint">
          <Info :size="14" />
          <div>
            <div class="runtime-hint-title">{{ t('mcpSettings.noActiveSession') }}</div>
            <div class="runtime-hint-desc">
              {{ t('mcpSettings.noActiveSessionDesc') }}
            </div>
          </div>
        </div>
        <div v-else-if="runtimeStatus.length === 0 && probeResultCount === 0" class="runtime-empty">
          {{ t('mcpSettings.noRuntimeStatus') }}
        </div>
        <div v-else class="runtime-list">
          <!-- Merge engine runtime + probe results -->
          <div
            v-for="item in mergedRuntimeItems"
            :key="item.name"
            class="runtime-item"
          >
            <button
              class="runtime-summary"
              :class="{ open: expanded[item.name] }"
              @click="toggleExpand(item.name)"
            >
              <ChevronRight :size="12" class="chev" />
              <span class="status-dot" :class="item.status" aria-hidden="true" />
              <span class="server-name">{{ item.name }}</span>
              <span v-if="item.toolCount > 0" class="tool-count">
                {{ item.toolCount }} {{ t('mcpSettings.tools') }}
              </span>
              <span class="status-badge" :class="item.status">
                {{ item.statusLabel }}
              </span>
            </button>
            <ul v-if="expanded[item.name]" class="tool-list">
              <li
                v-if="item.status === 'connected' && item.toolCount === 0"
                class="tool-empty"
              >
                {{ t('mcpSettings.noToolsReported') }}
              </li>
              <li
                v-else-if="item.status === 'failed'"
                class="tool-error"
              >
                {{ getProbeError(item.name) || t('mcpSettings.connectionFailed') }}
              </li>
              <li
                v-else-if="item.status !== 'connected' && item.status !== 'probing'"
                class="tool-empty"
              >
                {{ t('mcpSettings.toolsUnavailable') }}
              </li>
              <li
                v-for="tool in item.tools"
                :key="tool.name"
                class="tool-row"
              >
                <span class="tool-name">{{ tool.name }}</span>
                <span class="tool-desc">{{ tool.description || t('mcpSettings.noDescription') }}</span>
              </li>
            </ul>
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
import { ref, computed, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Plus, List, Code, Loader2, Wifi, RefreshCw, ArrowLeft, ChevronRight, Info
} from 'lucide-vue-next'
import { useMcpStore, type McpToolInfo, type MCPServer } from '@/stores/mcp'
import { useAppStore } from '@/stores/app'
import McpServerList from './McpServerList.vue'
import McpServerEditor from './McpServerEditor.vue'
import ConfigEditor from './ConfigEditor.vue'

const { t } = useI18n()
const mcpStore = useMcpStore()
const appStore = useAppStore()

const tab = ref<'list' | 'json'>('list')
const editorOpen = ref(false)
const editingName = ref<string | undefined>()
const editingServer = ref<MCPServer | undefined>()
const expanded = reactive<Record<string, boolean>>({})

const servers = computed(() => mcpStore.servers)
const serverList = computed(() => mcpStore.serverList)
const loading = computed(() => mcpStore.loading)
const runtimeLoading = computed(() => mcpStore.runtimeLoading)
const error = computed(() => mcpStore.error)
const runtimeStatus = computed(() => mcpStore.runtimeStatus)
const activeSessionId = computed(() => mcpStore.activeSessionId)
const serverCount = computed(() => mcpStore.serverCount)

const probeResultCount = computed(() => Object.keys(mcpStore.probeResults).length)

interface MergedRuntimeItem {
  name: string
  status: string
  statusLabel: string
  toolCount: number
  tools: McpToolInfo[]
}

const mergedRuntimeItems = computed<MergedRuntimeItem[]>(() => {
  const map = new Map<string, MergedRuntimeItem>()

  // 1) 先放 engine runtime status
  for (const s of runtimeStatus.value) {
    map.set(s.name, {
      name: s.name,
      status: s.status,
      statusLabel: s.status,
      toolCount: s.tools?.length ?? 0,
      tools: s.tools ?? [],
    })
  }

  // 2) 再用 probe 结果覆盖（probe 有 description，engine 没有）
  for (const [name, probe] of Object.entries(mcpStore.probeResults)) {
    const existing = map.get(name)
    if (probe.status === 'probing') {
      map.set(name, {
        name,
        status: 'probing',
        statusLabel: t('mcpSettings.testing'),
        toolCount: existing?.toolCount ?? 0,
        tools: existing?.tools ?? [],
      })
    } else if (probe.status === 'connected') {
      map.set(name, {
        name,
        status: 'connected',
        statusLabel: t('mcpSettings.connectedTested'),
        toolCount: probe.tools?.length ?? 0,
        tools: probe.tools ?? [],
      })
    } else {
      map.set(name, {
        name,
        status: 'failed',
        statusLabel: t('mcpSettings.failed'),
        toolCount: 0,
        tools: [],
      })
    }
  }

  return Array.from(map.values())
})

const hasClaudeJsonServers = computed(() =>
  Object.values(servers.value).some(s => s._source === 'claude.json')
)

function handleClose() {
  appStore.showMCPManager = false
}

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
  if (!confirm(t('mcpSettings.deleteConfirm', { name }))) return
  try {
    await mcpStore.deleteServer(name)
  } catch (err) {
    console.error('Failed to delete server:', err)
    alert(err instanceof Error ? err.message : t('mcpSettings.deleteFailed'))
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
    alert(err instanceof Error ? err.message : t('mcpSettings.saveFailed'))
  }
}

async function handleJsonSave(jsonStr: string) {
  try {
    await mcpStore.saveJsonConfig(jsonStr)
  } catch (err) {
    console.error('Failed to save config:', err)
    alert(err instanceof Error ? err.message : t('mcpSettings.saveConfigFailed'))
  }
}

async function handleReconnect(name: string) {
  try {
    await mcpStore.reconnectServer(name)
    await mcpStore.fetchRuntimeStatus()
  } catch (err) {
    console.error('Failed to reconnect server:', err)
    alert(err instanceof Error ? err.message : t('mcpSettings.reconnectFailed'))
  }
}

async function fetchRuntimeStatus() {
  await mcpStore.fetchRuntimeStatus()
}

function toggleExpand(name: string) {
  expanded[name] = !expanded[name]
}

function getProbeError(name: string): string | undefined {
  return mcpStore.probeResults[name]?.error
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
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-secondary);
}

.header-content {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
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
  border-radius: var(--radius-md);
  margin-bottom: 16px;

  p {
    font-size: 13px;
    color: var(--error);
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
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);

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
  border-top: 1px solid var(--border-default);
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
  font-size: var(--font-size-base);
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
  border-radius: var(--radius-xs);
  font-size: 11px;
  font-weight: 500;
  border: none;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);

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

.runtime-hint {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  text-align: left;
  padding: 14px 16px;
  background: var(--bg-secondary);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-secondary);

  svg {
    color: var(--accent-primary);
    flex-shrink: 0;
    margin-top: 1px;
  }
}

.runtime-hint-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.runtime-hint-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}

.runtime-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.runtime-item {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--border-default);
}

.runtime-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border: none;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--bg-hover);
  }

  &.open {
    border-bottom: 1px solid var(--border-default);
  }
}

.chev {
  color: var(--text-muted);
  transition: transform var(--transition-fast);
  flex-shrink: 0;

  .runtime-summary.open & {
    transform: rotate(90deg);
  }
}

.tool-count {
  font-size: 10px;
  color: var(--text-muted);
  margin-left: auto;
  padding: 1px 6px;
  background: var(--bg-primary);
  border-radius: 10px;
}

.tool-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--bg-primary);
}

.tool-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 12px 8px 32px;
  border-top: 1px solid var(--border-default);
  font-size: 12px;

  &:first-child {
    border-top: none;
  }
}

.tool-name {
  flex: 0 0 220px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-all;
}

.tool-desc {
  flex: 1;
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-empty {
  padding: 8px 12px 8px 32px;
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

.tool-error {
  padding: 8px 12px 8px 32px;
  font-size: 11px;
  color: var(--error);
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
    background: var(--error);
  }

  &.needs-auth {
    background: #f59e0b;
  }

  &.pending {
    background: var(--accent-primary);
  }

  &.disabled {
    background: #9ca3af;
  }

  &.probing {
    background: var(--accent-primary);
    animation: pulse 1.5s ease-in-out infinite;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
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
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-default);
  text-transform: lowercase;

  &.connected {
    border-color: #10b981;
    color: #10b981;
  }

  &.failed {
    border-color: var(--error);
    color: var(--error);
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
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }
}
</style>

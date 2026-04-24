<template>
  <div class="mcp-server-list">
    <div v-if="entries.length === 0" class="empty-state">
      <HardDrive :size="40" />
      <p class="empty-title">No MCP Servers</p>
      <p class="empty-desc">Add an MCP server to extend Claude's capabilities with custom tools.</p>
    </div>
    <div v-else class="server-list">
      <div
        v-for="[name, server] in entries"
        :key="name"
        class="server-card"
        :class="{ disabled: server.enabled === false, expanded: expandedServer === name }"
      >
        <div class="server-header" @click="toggleExpand(name)">
          <div class="server-toggle">
            <input
              type="checkbox"
              :checked="server.enabled !== false"
              @change="$emit('toggle-enabled', name, ($event.target as HTMLInputElement).checked)"
              @click.stop
            />
          </div>
          <div class="server-info">
            <div class="server-title-row">
              <component :is="getServerIcon(server)" :size="16" :class="['server-type-icon', getServerTypeColor(server)]" />
              <span class="server-name">{{ name }}</span>
              <span class="server-type-badge">{{ server.type || 'stdio' }}</span>
              <span v-if="getRuntimeStatus(name)" class="status-badge" :class="getRuntimeStatus(name)?.status">
                {{ getRuntimeStatusLabel(getRuntimeStatus(name)!.status) }}
              </span>
              <span v-else class="status-badge configured">Configured</span>
            </div>
            <div class="server-command">
              {{ server.url || `${server.command} ${server.args?.join(' ') || ''}` }}
            </div>
            <div v-if="getRuntimeStatus(name)?.serverInfo" class="server-version">
              {{ getRuntimeStatus(name)?.serverInfo?.name }} v{{ getRuntimeStatus(name)?.serverInfo?.version }}
            </div>
          </div>
          <div class="server-actions">
            <button
              v-if="getRuntimeStatus(name)?.status === 'failed'"
              class="action-btn"
              title="Reconnect"
              @click.stop="$emit('reconnect', name)"
            >
              <RefreshCw :size="14" />
            </button>
            <button
              class="action-btn"
              title="Edit"
              @click.stop="$emit('edit', name, server)"
            >
              <Pencil :size="14" />
            </button>
            <button
              class="action-btn danger"
              title="Delete"
              @click.stop="$emit('delete', name)"
            >
              <Trash2 :size="14" />
            </button>
            <ChevronDown
              :size="16"
              class="expand-icon"
              :class="{ rotated: expandedServer === name }"
            />
          </div>
        </div>

        <!-- Expanded Details -->
        <div v-if="expandedServer === name" class="server-details">
          <div v-if="server.args && server.args.length > 0" class="detail-section">
            <span class="detail-label">Arguments</span>
            <div class="detail-tags">
              <span v-for="(arg, i) in server.args" :key="i" class="detail-tag">{{ arg }}</span>
            </div>
          </div>
          <div v-if="Object.keys(server.env || {}).length > 0" class="detail-section">
            <span class="detail-label">Environment</span>
            <div class="detail-tags">
              <span v-for="key in Object.keys(server.env)" :key="key" class="detail-tag">{{ key }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  HardDrive, Pencil, Trash2, ChevronDown, RefreshCw,
  Wifi, Globe, Terminal
} from 'lucide-vue-next'
import { useMcpStore, type MCPServer, type McpRuntimeStatus } from '@/stores/mcp'

interface Props {
  servers: Record<string, MCPServer>
}

const props = defineProps<Props>()
defineEmits<{
  edit: [name: string, server: MCPServer]
  delete: [name: string]
  'toggle-enabled': [name: string, enabled: boolean]
  reconnect: [name: string]
}>()

const mcpStore = useMcpStore()
const expandedServer = ref<string | null>(null)

const entries = computed(() => Object.entries(props.servers))

const runtimeStatus = computed(() => mcpStore.runtimeStatus)

function toggleExpand(name: string) {
  expandedServer.value = expandedServer.value === name ? null : name
}

function getRuntimeStatus(name: string): McpRuntimeStatus | undefined {
  return runtimeStatus.value.find(s => s.name === name)
}

function getRuntimeStatusLabel(status: McpRuntimeStatus['status']): string {
  switch (status) {
    case 'connected': return 'Connected'
    case 'failed': return 'Failed'
    case 'needs-auth': return 'Auth Required'
    case 'pending': return 'Pending'
    case 'disabled': return 'Disabled'
    default: return status
  }
}

function getServerIcon(server: MCPServer) {
  const type = server.type || 'stdio'
  switch (type) {
    case 'sse': return Wifi
    case 'http': return Globe
    default: return Terminal
  }
}

function getServerTypeColor(server: MCPServer): string {
  const type = server.type || 'stdio'
  switch (type) {
    case 'sse': return 'text-primary'
    case 'http': return 'text-success'
    default: return 'text-muted'
  }
}
</script>

<style lang="scss" scoped>
.mcp-server-list {
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    color: var(--text-muted);
    text-align: center;

    svg {
      margin-bottom: 12px;
      opacity: 0.5;
    }
  }

  .empty-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    margin: 0 0 4px;
  }

  .empty-desc {
    font-size: 12px;
    margin: 0;
  }
}

.server-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.server-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
  transition: all 0.15s;

  &.disabled {
    opacity: 0.6;
  }

  &.expanded {
    border-color: var(--accent-primary);
  }
}

.server-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
  }
}

.server-toggle {
  padding-top: 2px;

  input[type="checkbox"] {
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
}

.server-info {
  flex: 1;
  min-width: 0;
}

.server-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.server-type-icon {
  flex-shrink: 0;

  &.text-primary {
    color: var(--accent-primary);
  }

  &.text-success {
    color: #10b981;
  }

  &.text-muted {
    color: var(--text-muted);
  }
}

.server-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.server-type-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
}

.status-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid;

  &.connected {
    border-color: #10b981;
    color: #10b981;
    background: rgba(16, 185, 129, 0.1);
  }

  &.failed {
    border-color: #dc3545;
    color: #dc3545;
    background: rgba(220, 53, 69, 0.1);
  }

  &.needs-auth {
    border-color: #f59e0b;
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
  }

  &.pending {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.1);
  }

  &.disabled {
    border-color: #9ca3af;
    color: #9ca3af;
    background: rgba(156, 163, 175, 0.1);
  }

  &.configured {
    border-color: var(--border-color);
    color: var(--text-muted);
  }
}

.server-command {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.server-version {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}

.server-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.danger:hover {
    background: rgba(220, 53, 69, 0.1);
    color: #dc3545;
  }
}

.expand-icon {
  color: var(--text-muted);
  transition: transform 0.2s;
  margin-left: 4px;

  &.rotated {
    transform: rotate(180deg);
  }
}

.server-details {
  padding: 12px 16px 16px 44px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-tertiary);
}

.detail-section {
  margin-bottom: 12px;

  &:last-child {
    margin-bottom: 0;
  }
}

.detail-label {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.detail-tag {
  font-size: 11px;
  padding: 3px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary);
}
</style>

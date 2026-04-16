<template>
  <div class="settings-section">
    <h2 class="section-title">MCP Servers</h2>
    
    <div class="section-content">
      <div class="servers-header">
        <span class="servers-count">{{ enabledCount }} of {{ servers.length }} enabled</span>
        <button class="btn btn-primary" @click="showAddForm = true">
          <Plus :size="14" />
          Add Server
        </button>
      </div>

      <!-- Server List -->
      <div class="servers-list">
        <div
          v-for="server in servers"
          :key="server.id"
          class="server-card"
          :class="{ disabled: !server.enabled, expanded: expandedServer === server.id }"
        >
          <div class="server-header" @click="toggleExpand(server.id)">
            <div class="server-toggle">
              <input
                type="checkbox"
                :checked="server.enabled"
                @change="toggleServer(server.id)"
                @click.stop
              />
            </div>
            <div class="server-info">
              <div class="server-name">{{ server.name }}</div>
              <div class="server-command">{{ server.command }} {{ server.args.join(' ') }}</div>
            </div>
            <div class="server-actions">
              <button class="icon-btn" @click.stop="editServer(server)" title="Edit">
                <Pencil :size="14" />
              </button>
              <button class="icon-btn danger" @click.stop="deleteServer(server.id)" title="Delete">
                <Trash2 :size="14" />
              </button>
              <ChevronDown 
                :size="16" 
                class="expand-icon"
                :class="{ rotated: expandedServer === server.id }"
              />
            </div>
          </div>
          
          <!-- Expanded Details -->
          <div v-if="expandedServer === server.id" class="server-details">
            <div class="detail-row">
              <span class="detail-label">Command:</span>
              <code class="detail-value">{{ server.command }}</code>
            </div>
            <div class="detail-row">
              <span class="detail-label">Arguments:</span>
              <code class="detail-value">{{ server.args.join(' ') }}</code>
            </div>
            <div v-if="Object.keys(server.env).length > 0" class="detail-row">
              <span class="detail-label">Environment:</span>
              <div class="env-list">
                <span v-for="(value, key) in server.env" :key="key" class="env-tag">
                  {{ key }}={{ maskValue(value) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Add/Edit Form Modal -->
      <div v-if="showAddForm" class="form-modal-overlay" @click.self="cancelForm">
        <div class="form-modal">
          <h3>{{ editingServer ? 'Edit Server' : 'Add MCP Server' }}</h3>
          
          <div class="form-group">
            <label>Server Name</label>
            <input v-model="form.name" placeholder="e.g., filesystem" class="form-input" />
          </div>
          
          <div class="form-group">
            <label>Command</label>
            <input v-model="form.command" placeholder="e.g., npx" class="form-input" />
          </div>
          
          <div class="form-group">
            <label>Arguments (space separated)</label>
            <input v-model="form.args" placeholder="-y @modelcontextprotocol/server-filesystem ." class="form-input" />
          </div>
          
          <div class="form-group">
            <label>Environment Variables (optional)</label>
            <div class="env-inputs">
              <div v-for="(env, index) in form.envList" :key="index" class="env-row">
                <input v-model="env.key" placeholder="KEY" class="form-input env-key" />
                <input v-model="env.value" placeholder="value" class="form-input env-value" />
                <button class="icon-btn danger" @click="removeEnv(index)">
                  <X :size="14" />
                </button>
              </div>
              <button class="btn btn-secondary" @click="addEnv">
                <Plus :size="14" />
                Add Variable
              </button>
            </div>
          </div>
          
          <div class="form-actions">
            <button class="btn btn-secondary" @click="cancelForm">Cancel</button>
            <button class="btn btn-primary" @click="saveServer" :disabled="!isFormValid">
              {{ editingServer ? 'Save Changes' : 'Add Server' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="servers.length === 0" class="empty-state">
        <Boxes :size="48" />
        <h4>No MCP Servers</h4>
        <p>Add an MCP server to extend Claude's capabilities with custom tools.</p>
        <button class="btn btn-primary" @click="showAddForm = true">
          <Plus :size="14" />
          Add Your First Server
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, shallowRef } from 'vue'
import { Plus, Pencil, Trash2, ChevronDown, X, Boxes } from 'lucide-vue-next'
import { debounce } from '@/utils/debounce'

const emit = defineEmits<{
  'change': []
}>()

interface MCPServer {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
}

// 使用shallowRef优化响应式性能
const servers = shallowRef<MCPServer[]>([
  {
    id: '1',
    name: 'filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    env: {},
    enabled: true
  },
  {
    id: '2',
    name: 'github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: 'ghp_xxxx' },
    enabled: false
  }
])

const showAddForm = ref(false)
const editingServer = ref<MCPServer | null>(null)
const expandedServer = ref<string | null>(null)

// 使用普通ref存储表单数据
const form = ref({
  name: '',
  command: '',
  args: '',
  envList: [] as { key: string; value: string }[]
})

// 使用computed缓存计算结果
const enabledCount = computed(() => servers.value.filter(s => s.enabled).length)

const isFormValid = computed(() => {
  return form.value.name.trim() && form.value.command.trim()
})

function toggleExpand(serverId: string) {
  expandedServer.value = expandedServer.value === serverId ? null : serverId
}

function toggleServer(serverId: string) {
  servers.value = servers.value.map(server => 
    server.id === serverId 
      ? { ...server, enabled: !server.enabled }
      : server
  )
}

function editServer(server: MCPServer) {
  editingServer.value = server
  form.value = {
    name: server.name,
    command: server.command,
    args: server.args.join(' '),
    envList: Object.entries(server.env).map(([key, value]) => ({ key, value }))
  }
  showAddForm.value = true
}

function deleteServer(serverId: string) {
  if (confirm('Are you sure you want to delete this server?')) {
    servers.value = servers.value.filter(s => s.id !== serverId)
    if (expandedServer.value === serverId) {
      expandedServer.value = null
    }
  }
}

function addEnv() {
  form.value.envList.push({ key: '', value: '' })
}

function removeEnv(index: number) {
  form.value.envList.splice(index, 1)
}

function maskValue(value: string) {
  if (value.length <= 8) return '•'.repeat(value.length)
  return value.slice(0, 4) + '••••' + value.slice(-4)
}

function cancelForm() {
  showAddForm.value = false
  editingServer.value = null
  resetForm()
}

function resetForm() {
  form.value = {
    name: '',
    command: '',
    args: '',
    envList: []
  }
}

function saveServer() {
  const env: Record<string, string> = {}
  form.value.envList.forEach(({ key, value }) => {
    if (key.trim()) env[key.trim()] = value
  })

  if (editingServer.value) {
    servers.value = servers.value.map(server => 
      server.id === editingServer.value!.id
        ? {
            ...server,
            name: form.value.name,
            command: form.value.command,
            args: form.value.args.split(' ').filter(a => a),
            env
          }
        : server
    )
  } else {
    servers.value = [
      ...servers.value,
      {
        id: crypto.randomUUID(),
        name: form.value.name,
        command: form.value.command,
        args: form.value.args.split(' ').filter(a => a),
        env,
        enabled: true
      }
    ]
  }

  cancelForm()
}

// 使用防抖触发change事件
const debouncedChange = debounce(() => {
  emit('change')
}, 100)

// Watch for changes and emit change event - 使用浅监听
watch(servers, () => {
  debouncedChange()
}, { deep: false })
</script>

<style lang="scss" scoped>
.settings-section {
  max-width: 720px;
}

.section-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 24px;
}

.section-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.servers-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.servers-count {
  font-size: 13px;
  color: var(--text-muted);
}

.servers-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.server-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s;

  &.disabled {
    opacity: 0.6;
  }

  &.expanded {
    border-color: var(--accent-primary);
  }
}

.server-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
  }
}

.server-toggle {
  input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }
}

.server-info {
  flex: 1;
  min-width: 0;
}

.server-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.server-command {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.server-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon-btn {
  @include reset-button;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--text-muted);
  transition: all 0.2s;

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
  padding: 0 16px 16px 46px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-tertiary);
}

.detail-row {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);

  &:last-child {
    border-bottom: none;
  }
}

.detail-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  min-width: 100px;
}

.detail-value {
  font-size: 12px;
  color: var(--text-primary);
  font-family: var(--font-mono);
  background: var(--bg-secondary);
  padding: 4px 8px;
  border-radius: 4px;
}

.env-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.env-tag {
  font-size: 11px;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border-radius: 4px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

.btn {
  @include reset-button;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover:not(:disabled) {
      background: var(--accent-primary-hover);
    }
  }

  &.btn-secondary {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);

    &:hover:not(:disabled) {
      background: var(--bg-hover);
      border-color: var(--accent-primary);
    }
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.form-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.form-modal {
  width: 480px;
  max-height: 80vh;
  background: var(--bg-primary);
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);

  h3 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;

  label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }
}

.form-input {
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 13px;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.1);
  }

  &::placeholder {
    color: var(--text-muted);
  }
}

.env-inputs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.env-row {
  display: flex;
  gap: 8px;

  .env-key {
    width: 120px;
  }

  .env-value {
    flex: 1;
  }
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 60px 20px;
  text-align: center;
  color: var(--text-muted);

  h4 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  p {
    font-size: 13px;
    max-width: 300px;
    margin: 0;
  }
}
</style>

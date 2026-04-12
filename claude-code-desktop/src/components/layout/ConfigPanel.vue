<template>
  <div class="config-panel">
    <div class="config-tabs">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'mcp' }"
        @click="activeTab = 'mcp'"
      >
        <Boxes :size="14" />
        MCP
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'tools' }"
        @click="activeTab = 'tools'"
      >
        <Wrench :size="14" />
        Tools
      </button>
    </div>

    <div class="config-content">
      <div v-show="activeTab === 'mcp'" class="mcp-section">
        <div class="section-header">
          <span>MCP Servers</span>
          <button class="add-btn" @click="showAddServer = true">
            <Plus :size="14" />
          </button>
        </div>
        <div class="server-list">
          <div
            v-for="server in configStore.mcpServers"
            :key="server.id"
            class="server-item"
            :class="{ disabled: !server.enabled }"
          >
            <div class="server-info">
              <input
                type="checkbox"
                :checked="server.enabled"
                @change="configStore.updateMCPServer(server.id, { enabled: !server.enabled })"
              />
              <span class="server-name">{{ server.name }}</span>
            </div>
            <div class="server-command">{{ server.command }} {{ server.args.join(' ') }}</div>
            <button class="remove-btn" @click="configStore.removeMCPServer(server.id)">
              <X :size="12" />
            </button>
          </div>
        </div>

        <div v-if="showAddServer" class="add-server-form">
          <input
            v-model="newServer.name"
            placeholder="Server name"
            class="form-input"
          />
          <input
            v-model="newServer.command"
            placeholder="Command (e.g., npx)"
            class="form-input"
          />
          <input
            v-model="newServer.args"
            placeholder="Args (e.g., -y @modelcontextprotocol/server-filesystem .)"
            class="form-input"
          />
          <div class="form-actions">
            <button class="btn btn-secondary" @click="cancelAddServer">Cancel</button>
            <button class="btn btn-primary" @click="addServer">Add</button>
          </div>
        </div>
      </div>

      <div v-show="activeTab === 'tools'" class="tools-section">
        <div class="section-header">
          <span>Tool Enable/Disable</span>
        </div>
        <div class="tool-list">
          <div
            v-for="tool in configStore.toolConfigs"
            :key="tool.name"
            class="tool-item"
            :class="{ disabled: !tool.enabled }"
            @click="configStore.toggleTool(tool.name)"
          >
            <input
              type="checkbox"
              :checked="tool.enabled"
              @change.stop="configStore.toggleTool(tool.name)"
            />
            <span class="tool-name">{{ tool.name }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useConfigStore } from '@/stores/config'
import { Boxes, Wrench, Plus, X } from 'lucide-vue-next'

const configStore = useConfigStore()

const activeTab = ref<'mcp' | 'tools'>('mcp')
const showAddServer = ref(false)
const newServer = ref({
  name: '',
  command: '',
  args: ''
})

function addServer() {
  if (!newServer.value.name || !newServer.value.command) return

  configStore.addMCPServer({
    name: newServer.value.name,
    command: newServer.value.command,
    args: newServer.value.args.split(' ').filter(a => a),
    env: {},
    enabled: true
  })

  cancelAddServer()
}

function cancelAddServer() {
  showAddServer.value = false
  newServer.value = { name: '', command: '', args: '' }
}
</script>

<style lang="scss" scoped>
.config-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
}

.config-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-color);
}

.tab-btn {
  @include reset-button;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
  transition: all 0.2s;

  &:hover {
    color: var(--text-primary);
  }

  &.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent-color);
  }
}

.config-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;

  @include scrollbar;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;

  span {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
}

.add-btn {
  @include reset-button;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition: all 0.2s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.server-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.server-item {
  padding: 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);

  &.disabled {
    opacity: 0.5;
  }
}

.server-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;

  input[type="checkbox"] {
    width: 14px;
    height: 14px;
  }

  .server-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }
}

.server-command {
  font-size: 11px;
  color: var(--text-muted);
  padding-left: 22px;
  word-break: break-all;
}

.remove-btn {
  @include reset-button;
  position: absolute;
  right: 8px;
  top: 8px;
  padding: 4px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition: all 0.2s;

  &:hover {
    background: rgba(220, 53, 69, 0.1);
    color: var(--error);
  }
}

.server-item {
  position: relative;
  padding-right: 32px;
}

.add-server-form {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-input {
  width: 100%;
  padding: 8px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 12px;

  &:focus {
    outline: none;
    border-color: var(--accent-color);
  }

  &::placeholder {
    color: var(--text-muted);
  }
}

.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}

.tool-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: var(--bg-hover);
  }

  &.disabled {
    opacity: 0.5;
  }

  input[type="checkbox"] {
    width: 14px;
    height: 14px;
  }

  .tool-name {
    font-size: 13px;
    color: var(--text-primary);
  }
}

.btn {
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &.btn-secondary {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);

    &:hover {
      background: var(--bg-hover);
    }
  }

  &.btn-primary {
    background: var(--accent-color);
    border: none;
    color: white;

    &:hover {
      opacity: 0.9;
    }
  }
}
</style>
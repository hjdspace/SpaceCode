<template>
  <div class="installed-agents">
    <div v-if="agentsStore.globalInstalled.length > 0" class="agent-group">
      <h3 class="group-title">全局 Agents</h3>
      <div class="agent-list">
        <div v-for="agent in agentsStore.globalInstalled" :key="agent.name" class="agent-row">
          <div class="agent-info">
            <Bot :size="16" class="agent-icon" />
            <span class="agent-name">{{ agent.name }}</span>
            <span class="agent-model">{{ agent.model || 'inherit' }}</span>
            <span class="agent-desc">{{ truncatedDesc(agent) }}</span>
          </div>
          <div class="agent-actions">
            <button class="btn btn-ghost" @click="handleEdit(agent)">
              <Pencil :size="14" />
            </button>
            <button class="btn btn-danger-ghost" @click="handleUninstall(agent, 'global')">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="agentsStore.projectInstalled.length > 0" class="agent-group">
      <h3 class="group-title">项目 Agents</h3>
      <div class="agent-list">
        <div v-for="agent in agentsStore.projectInstalled" :key="agent.name" class="agent-row">
          <div class="agent-info">
            <Bot :size="16" class="agent-icon" />
            <span class="agent-name">{{ agent.name }}</span>
            <span class="agent-model">{{ agent.model || 'inherit' }}</span>
            <span class="agent-desc">{{ truncatedDesc(agent) }}</span>
          </div>
          <div class="agent-actions">
            <button class="btn btn-ghost" @click="handleEdit(agent)">
              <Pencil :size="14" />
            </button>
            <button class="btn btn-danger-ghost" @click="handleUninstall(agent, 'project')">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="agentsStore.installedAgents.length === 0" class="empty-state">
      <Bot :size="32" class="empty-icon" />
      <p>{{ t('agents.noInstalledAgents') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bot, Pencil, Trash2 } from 'lucide-vue-next'
import { useAgentsStore, type AgentDef } from '@/stores/agents'
import { useAppStore } from '@/stores/app'
import { useDialog } from '@/composables/useDialog'

const { t } = useI18n()
const agentsStore = useAgentsStore()
const appStore = useAppStore()
const { showConfirm } = useDialog()

function truncatedDesc(agent: AgentDef) {
  if (!agent.description) return ''
  return agent.description.length > 60 ? agent.description.slice(0, 60) + '...' : agent.description
}

function handleEdit(agent: AgentDef) {
  if (!agent.agentPath) return
  appStore.openFile(agent.agentPath)
}

async function handleUninstall(agent: AgentDef, scope: 'global' | 'project') {
  if (!await showConfirm(t('agents.uninstallConfirm', { name: agent.name }), { variant: 'danger' })) return
  const cwd = appStore.projectRoot || undefined
  await agentsStore.uninstallAgent(agent.name, scope, cwd)
}

onMounted(() => {
  const cwd = appStore.projectRoot || undefined
  agentsStore.fetchInstalled(cwd)
})
</script>

<style lang="scss" scoped>
.installed-agents {
  padding: 16px;
  overflow-y: auto;
}

.agent-group {
  margin-bottom: 24px;
}

.group-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin: 0 0 12px;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-default);
  background: var(--bg-secondary);
}

.agent-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.agent-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.agent-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}

.agent-model {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.agent-desc {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: all 0.15s;

  &.btn-ghost {
    background: transparent;
    color: var(--text-muted);
    &:hover { background: var(--bg-hover); color: var(--text-primary); }
  }

  &.btn-danger-ghost {
    background: transparent;
    color: var(--text-muted);
    &:hover { background: rgba(239, 68, 68, 0.08); color: #ef4444; }
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px;
  color: var(--text-muted);
  font-size: 13px;
}

.empty-icon { opacity: 0.3; }
</style>

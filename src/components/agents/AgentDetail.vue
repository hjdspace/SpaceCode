<template>
  <div class="agent-detail">
    <div class="detail-header">
      <button class="back-btn" @click="$emit('back')">
        <ArrowLeft :size="16" />
      </button>
      <h3 class="detail-name">{{ agent.name }}</h3>
    </div>

    <div class="detail-body">
      <div class="detail-section">
        <span class="label">描述</span>
        <p class="value">{{ agent.description }}</p>
      </div>

      <div class="detail-row">
        <div class="detail-item">
          <span class="label">模型</span>
          <span class="value">{{ agent.model || 'inherit' }}</span>
        </div>
        <div class="detail-item">
          <span class="label">分类</span>
          <span class="value">{{ categoryLabel }}</span>
        </div>
      </div>

      <div v-if="agent.tools?.length" class="detail-section">
        <span class="label">工具</span>
        <div class="tools-list">
          <span v-for="tool in agent.tools" :key="tool" class="tool-tag">{{ tool }}</span>
        </div>
      </div>

      <div class="detail-section">
        <span class="label">Prompt 预览</span>
        <pre class="prompt-preview">{{ promptBody }}</pre>
      </div>

      <div class="install-section">
        <span class="label">安装范围</span>
        <div class="scope-options">
          <label class="scope-option" :class="{ active: scope === 'global' }">
            <input type="radio" v-model="scope" value="global" />
            <span>全局 (~/.claude/agents/)</span>
          </label>
          <label class="scope-option" :class="{ active: scope === 'project' }">
            <input type="radio" v-model="scope" value="project" />
            <span>项目 (.claude/agents/)</span>
          </label>
        </div>
        <button
          v-if="!agent.isInstalled"
          class="btn btn-primary"
          :disabled="agentsStore.installingName === agent.name"
          @click="handleInstall"
        >
          <Loader2 v-if="agentsStore.installingName === agent.name" :size="14" class="spin" />
          <Download v-else :size="14" />
          安装 Agent
        </button>
        <div v-else class="installed-info">
          <CheckCircle :size="14" />
          <span>已安装（{{ agent.installedScope === 'global' ? '全局' : '项目' }}）</span>
          <button class="btn btn-danger" @click="handleUninstall">卸载</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowLeft, Download, CheckCircle, Loader2 } from 'lucide-vue-next'
import { useAgentsStore, AGENT_CATEGORIES, type AgentDef } from '@/stores/agents'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ agent: AgentDef }>()
defineEmits<{ back: [] }>()

const agentsStore = useAgentsStore()
const appStore = useAppStore()
const scope = ref<'global' | 'project'>('project')

const categoryLabel = computed(() =>
  AGENT_CATEGORIES.find(c => c.id === props.agent.category)?.label || '通用'
)

const promptBody = computed(() => {
  const content = props.agent.content
  const fmEnd = content.indexOf('---', 4)
  if (fmEnd === -1) return content
  return content.slice(fmEnd + 3).trim()
})

async function handleInstall() {
  const cwd = appStore.projectRoot || undefined
  await agentsStore.installAgent(props.agent.name, scope.value, cwd)
}

async function handleUninstall() {
  if (!props.agent.installedScope) return
  const cwd = appStore.projectRoot || undefined
  await agentsStore.uninstallAgent(props.agent.name, props.agent.installedScope, cwd)
}
</script>

<style lang="scss" scoped>
.agent-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  &:hover { background: var(--bg-hover); color: var(--text-primary); }
}

.detail-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.detail-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-section, .detail-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-row {
  flex-direction: row;
  gap: 20px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}

.value {
  font-size: 13px;
  color: var(--text-primary);
  margin: 0;
}

.tools-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tool-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.prompt-preview {
  font-size: 12px;
  line-height: 1.5;
  padding: 12px;
  border-radius: 6px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  margin: 0;
}

.scope-options {
  display: flex;
  gap: 12px;
}

.scope-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all 0.15s;

  input { display: none; }
  &.active { border-color: var(--accent-primary); color: var(--accent-primary); }
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s;

  &.btn-primary {
    background: var(--accent-primary);
    color: white;
    &:hover { background: var(--accent-primary-hover); }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  }

  &.btn-danger {
    background: transparent;
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
    &:hover { background: rgba(239, 68, 68, 0.08); }
  }
}

.installed-info {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #10b981;
  font-size: 13px;
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

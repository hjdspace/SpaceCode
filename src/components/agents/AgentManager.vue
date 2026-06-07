<template>
  <div class="agent-manager">
    <div class="agent-header">
      <div class="header-content">
        <div class="header-left">
          <button class="close-btn" @click="handleClose" :title="t('common.close')">
            <ArrowLeft :size="18" />
          </button>
          <div>
            <h1 class="title">{{ t('agents.title') }}</h1>
            <p class="description">{{ t('agents.description') }}</p>
          </div>
        </div>
      </div>
      <div class="tab-switcher">
        <button class="tab-btn" :class="{ active: viewTab === 'library' }" @click="viewTab = 'library'">
          {{ t('agents.tabLibrary') }}
        </button>
        <button class="tab-btn" :class="{ active: viewTab === 'installed' }" @click="viewTab = 'installed'">
          {{ t('agents.tabInstalled') }}
        </button>
        <button class="tab-btn" :class="{ active: viewTab === 'workflow' }" @click="viewTab = 'workflow'">
          {{ t('agents.tabWorkflow') }}
        </button>
      </div>
    </div>

    <div class="agent-content">
      <AgentLibrary v-if="viewTab === 'library'" />
      <InstalledAgents v-else-if="viewTab === 'installed'" />
      <WorkflowEditor v-else-if="viewTab === 'workflow'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import AgentLibrary from './AgentLibrary.vue'
import InstalledAgents from './InstalledAgents.vue'
import WorkflowEditor from './WorkflowEditor.vue'

const { t } = useI18n()
const appStore = useAppStore()
const viewTab = ref<'library' | 'installed' | 'workflow'>('library')

function handleClose() {
  appStore.showAgentManager = false
}
</script>

<style lang="scss" scoped>
.agent-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.agent-header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-color);
  padding: 16px 20px 12px;
  background: var(--bg-secondary);
}

.header-content {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  &:hover { background: var(--bg-hover); color: var(--text-primary); }
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.description {
  font-size: 13px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

.tab-switcher {
  display: flex;
  align-items: center;
  background: var(--bg-tertiary);
  border-radius: 6px;
  padding: 2px;
  width: fit-content;
}

.tab-btn {
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  &:hover { color: var(--text-primary); }
  &.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
}

.agent-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>

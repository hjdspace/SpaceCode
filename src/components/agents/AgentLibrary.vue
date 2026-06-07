<template>
  <div class="agent-library">
    <div class="library-toolbar">
      <div class="search-box">
        <Search :size="14" class="search-icon" />
        <input v-model="searchQuery" :placeholder="t('agents.searchAgents')" class="search-input" />
      </div>
    </div>
    <div class="library-content">
      <div class="category-sidebar">
        <button
          v-for="cat in categoriesWithCount"
          :key="cat.id"
          class="category-btn"
          :class="{ active: agentsStore.selectedCategory === cat.id }"
          @click="agentsStore.selectCategory(cat.id)"
        >
          <component :is="getCategoryIcon(cat.icon)" :size="14" />
          <span class="cat-label">{{ cat.label }}</span>
          <span class="cat-count">{{ cat.count }}</span>
        </button>
      </div>
      <div class="agents-grid">
        <AgentCard
          v-for="agent in agentsStore.filteredAgents"
          :key="agent.name"
          :agent="agent"
          @select="selectedAgent = $event"
        />
        <div v-if="agentsStore.filteredAgents.length === 0" class="empty-state">
          <Bot :size="32" class="empty-icon" />
          <p>{{ searchQuery ? t('agents.noAgentsFound') : t('agents.noAgentsYet') }}</p>
        </div>
      </div>
    </div>
    <AgentDetail
      v-if="selectedAgent"
      :agent="selectedAgent"
      @back="selectedAgent = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, Bot, Grid3x3, Shield, Wrench, Compass, Lock } from 'lucide-vue-next'
import { useAgentsStore, AGENT_CATEGORIES, type AgentDef } from '@/stores/agents'
import { useAppStore } from '@/stores/app'
import AgentCard from './AgentCard.vue'
import AgentDetail from './AgentDetail.vue'

const { t } = useI18n()
const agentsStore = useAgentsStore()
const appStore = useAppStore()
const selectedAgent = ref<AgentDef | null>(null)
const searchQuery = computed({
  get: () => agentsStore.searchQuery,
  set: (v: string) => agentsStore.setSearchQuery(v),
})

const categoriesWithCount = computed(() =>
  AGENT_CATEGORIES.map(cat => ({
    ...cat,
    count: agentsStore.categoryStats[cat.id] || 0,
  }))
)

function getCategoryIcon(iconName: string) {
  const map: Record<string, any> = { Grid3x3, Shield, Wrench, Compass, Lock, Bot }
  return map[iconName] || Bot
}

onMounted(() => {
  const cwd = appStore.projectRoot || undefined
  agentsStore.fetchLibrary(cwd)
})
</script>

<style lang="scss" scoped>
.agent-library {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.library-toolbar {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.search-box {
  position: relative;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
}

.search-input {
  width: 100%;
  padding: 8px 10px 8px 32px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  &:focus { outline: none; border-color: var(--accent-primary); }
  &::placeholder { color: var(--text-muted); }
}

.library-content {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.category-sidebar {
  width: 160px;
  flex-shrink: 0;
  padding: 8px;
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  min-height: 0;
}

.category-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;

  &:hover { background: var(--bg-hover); }
  &.active { background: var(--accent-primary); color: white; }
}

.cat-label { flex: 1; }
.cat-count { font-size: 10px; opacity: 0.6; }

.agents-grid {
  flex: 1;
  min-height: 0;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  overflow-y: auto;
  align-content: start;
}

.empty-state {
  grid-column: 1 / -1;
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

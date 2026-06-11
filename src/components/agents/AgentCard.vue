<template>
  <div class="agent-card" :class="{ installed: agent.isInstalled }" @click="$emit('select', agent)">
    <div class="card-header">
      <div class="card-icon" :style="{ background: categoryColor + '20', color: categoryColor }">
        <Bot :size="16" />
      </div>
      <span v-if="agent.isInstalled" class="installed-badge">{{ agent.installedScope === 'global' ? '全局' : '项目' }}</span>
    </div>
    <div class="card-body">
      <h4 class="card-name">{{ agent.name }}</h4>
      <p class="card-desc">{{ truncatedDesc }}</p>
    </div>
    <div class="card-footer">
      <span v-if="agent.model" class="model-tag">{{ agent.model }}</span>
      <span class="category-tag" :style="{ color: categoryColor }">{{ categoryLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Bot } from 'lucide-vue-next'
import { AGENT_CATEGORIES, type AgentDef } from '@/stores/agents'

const props = defineProps<{ agent: AgentDef }>()
defineEmits<{ select: [agent: AgentDef] }>()

const truncatedDesc = computed(() => {
  const d = props.agent.description
  return d.length > 80 ? d.slice(0, 80) + '...' : d
})

const categoryInfo = computed(() =>
  AGENT_CATEGORIES.find(c => c.id === props.agent.category) || AGENT_CATEGORIES[AGENT_CATEGORIES.length - 1]
)
const categoryColor = computed(() => categoryInfo.value.color)
const categoryLabel = computed(() => categoryInfo.value.label)
</script>

<style lang="scss" scoped>
.agent-card {
  border-radius: 8px;
  border: 1px solid var(--border-default);
  background: var(--bg-secondary);
  padding: 14px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &:hover {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }

  &.installed {
    border-color: rgba(16, 185, 129, 0.3);
  }
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.installed-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  font-weight: 500;
}

.card-body {
  flex: 1;
}

.card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.card-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.4;
}

.card-footer {
  display: flex;
  align-items: center;
  gap: 6px;
}

.model-tag, .category-tag {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-tertiary);
}

.model-tag {
  color: var(--text-secondary);
}
</style>

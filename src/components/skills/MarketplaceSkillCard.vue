<template>
  <div
    class="marketplace-skill-card"
    :class="{ selected }"
    @click="$emit('select')"
  >
    <Zap :size="16" class="skill-icon" />
    <div class="skill-info">
      <div class="skill-header">
        <span class="skill-name">{{ skill.name }}</span>
        <span v-if="skill.isInstalled" class="installed-badge">
          <CheckCircle :size="10" />
          Installed
        </span>
      </div>
      <div class="skill-meta">
        <span class="skill-source">{{ skill.source }}</span>
        <span v-if="skill.installs > 0" class="install-count">
          <Download :size="12" />
          {{ skill.installs.toLocaleString() }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Zap, CheckCircle, Download } from 'lucide-vue-next'
import type { MarketplaceSkill } from '@/stores/skills'

interface Props {
  skill: MarketplaceSkill
  selected: boolean
}

defineProps<Props>()
defineEmits<{
  select: []
}>()
</script>

<style lang="scss" scoped>
.marketplace-skill-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--bg-hover);
  }

  &.selected {
    background: rgba(var(--accent-primary-rgb), 0.1);
  }
}

.skill-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.skill-info {
  flex: 1;
  min-width: 0;
}

.skill-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.skill-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.installed-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 500;
  border: 1px solid #10b981;
  color: #10b981;
  flex-shrink: 0;
}

.skill-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.skill-source {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.install-count {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}
</style>

<template>
  <div class="detail-section">
    <button class="section-header" @click="collapsed = !collapsed" :aria-expanded="!collapsed">
      <ChevronRight :size="12" class="section-chevron" :class="{ expanded: !collapsed }" aria-hidden="true" />
      <span class="section-title">{{ title }}</span>
    </button>
    <div v-if="!collapsed" class="section-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'

defineProps<{ title: string }>()
const collapsed = ref(false)
</script>

<style lang="scss" scoped>
.detail-section {
  margin-bottom: 12px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
  text-align: left;
  transition: color var(--transition-fast);
  &:hover { color: var(--text-secondary); }
}

.section-chevron {
  transition: transform 0.15s ease;
  &.expanded { transform: rotate(90deg); }
}

.section-title {
  flex: 1;
}

.section-content {
  margin-top: 6px;
}
</style>

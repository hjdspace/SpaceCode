<template>
  <div class="detail-section" :class="{ collapsed }">
    <button class="section-header" @click="toggle" :aria-expanded="!collapsed">
      <ChevronRight :size="11" class="section-chevron" :class="{ expanded: !collapsed }" aria-hidden="true" />
      <span class="section-title">{{ title }}</span>
      <span v-if="count !== undefined" class="section-count">{{ count }}</span>
      <span v-if="$slots.actions" class="section-actions" @click.stop>
        <slot name="actions" />
      </span>
    </button>
    <Transition name="section-slide">
      <div v-if="!collapsed" class="section-content">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'

defineProps<{
  title: string
  count?: number | string
  defaultCollapsed?: boolean
}>()

const collapsed = ref(false)

function toggle() {
  collapsed.value = !collapsed.value
}
</script>

<style lang="scss" scoped>
.detail-section {
  margin-bottom: 4px;

  &:last-child {
    margin-bottom: 0;
  }
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius-sm);
  transition: all 0.15s ease;

  &:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.03);
  }
}

.section-chevron {
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
  opacity: 0.6;
  &.expanded { transform: rotate(90deg); }
}

.section-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-count {
  font-size: 10px;
  font-weight: 500;
  padding: 0 6px;
  min-width: 18px;
  text-align: center;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 9999px;
  color: var(--text-muted);
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
}

.section-actions {
  flex-shrink: 0;
}

.section-content {
  padding: 4px 0 8px 17px;
  overflow: hidden;
}

// Transition
.section-slide-enter-active,
.section-slide-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  max-height: 2000px;
  opacity: 1;
}
.section-slide-enter-from,
.section-slide-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
</style>

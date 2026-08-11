<script setup lang="ts">
/**
 * Skill Manager V2 — Agent Icon Badge
 *
 * Shows a compact badge for an agent that has a skill installed.
 * Reference: AgentBro `src/components/skills-v2/AgentIconBadge.tsx`
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentBadge } from '@/types/skillManagerV2'
import { getAgentInitials, STATUS_CSS_CLASSES } from './skillLabels'

const props = defineProps<{
  badge: AgentBadge
}>()

const { t } = useI18n()

const initials = computed(() => getAgentInitials(props.badge.agentId))
const statusClass = computed(() => STATUS_CSS_CLASSES[props.badge.status])
const modeLabel = computed(() =>
  props.badge.mode === 'link'
    ? t('skillManagerV2.settings.modeLink')
    : t('skillManagerV2.settings.modeCopy')
)
</script>

<template>
  <span
    class="agent-icon-badge"
    :class="statusClass"
    :title="`${badge.agentName} · ${modeLabel}`"
  >
    {{ initials }}
  </span>
</template>

<style scoped lang="scss">
.agent-icon-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  background: var(--bg-badge, #333);
  color: var(--text-primary, #e0e0e0);
  cursor: help;

  &.status-ok {
    border: 1px solid var(--success-color, #4caf50);
  }
  &.status-conflict,
  &.status-copy-diverged {
    border: 1px solid var(--error-color, #f48771);
  }
  &.status-copy-outdated,
  &.status-copy-modified,
  &.status-broken-link,
  &.status-missing {
    border: 1px solid var(--warning-color, #cca700);
  }
}
</style>

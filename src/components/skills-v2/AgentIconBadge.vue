<script setup lang="ts">
/**
 * Skill Manager V2 — Agent Icon Badge
 *
 * Shows a compact circular badge for an agent that has a skill installed.
 * Color-coded by mode and status.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentBadge } from '@/types/skillManagerV2'
import { getAgentInitials, STATUS_CSS_CLASSES } from './skillLabels'
import anthropicLogo from '@/assets/logos/anthropic.svg'
import deepseekLogo from '@/assets/logos/deepseek.svg'
import doubaoLogo from '@/assets/logos/doubao.svg'
import geminiLogo from '@/assets/logos/gemini.svg'
import kimiLogo from '@/assets/logos/kimi.png'
import openaiLogo from '@/assets/logos/openai.svg'
import qwenLogo from '@/assets/logos/qwen.svg'

const props = defineProps<{
  badge: AgentBadge
  size?: number
}>()

const { t } = useI18n()

const initials = computed(() => getAgentInitials(props.badge.agentId))
const statusClass = computed(() => STATUS_CSS_CLASSES[props.badge.status])
const modeClass = computed(() => {
  // Determine visual style based on mode + status
  const s = props.badge.status
  if (s === 'ok') return props.badge.mode === 'link' ? 'link' : 'copy'
  if (s === 'conflict' || s === 'copy_diverged') return 'bad'
  if (s === 'unmanaged') return 'unmanaged'
  return 'warn'
})
const modeLabel = computed(() =>
  props.badge.mode === 'link'
    ? t('skillManagerV2.settings.modeLink')
    : t('skillManagerV2.settings.modeCopy')
)

const imageFailed = ref(false)

const agentLogo = computed(() => {
  const logos: Record<string, string> = {
    'claude-code': anthropicLogo,
    codex: openaiLogo,
    gemini: geminiLogo,
    'gemini-cli': geminiLogo,
    qwen: qwenLogo,
    kimi: kimiLogo,
    'kimi-code-cli': kimiLogo,
    doubao: doubaoLogo,
    deepseek: deepseekLogo,
  }
  return logos[props.badge.agentId] ?? null
})

const badgeSize = computed(() => `${props.size ?? 26}px`)
</script>

<template>
  <span
    class="agent-icon"
    :class="[statusClass, modeClass]"
    :title="`${badge.agentName} · ${modeLabel}`"
    :style="{ '--agent-icon-size': badgeSize }"
  >
    <img
      v-if="agentLogo && !imageFailed"
      :src="agentLogo"
      :alt="`${badge.agentName} logo`"
      @error="imageFailed = true"
    />
    <span v-else>{{ initials }}</span>
  </span>
</template>

<style scoped lang="scss">
.agent-icon {
  display: inline-grid;
  place-items: center;
  width: var(--agent-icon-size);
  height: var(--agent-icon-size);
  border: 1px solid var(--border-default);
  border-radius: 9px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 9px;
  font-weight: 800;
  cursor: help;
  transition: border-color 0.15s;

  img {
    width: 72%;
    height: 72%;
    object-fit: contain;
  }

  &.link {
    border-color: rgba(13, 148, 136, 0.25);
    background: rgba(13, 148, 136, 0.08);
    color: var(--accent-primary);
  }
  &.copy {
    border-color: rgba(99, 102, 241, 0.25);
    background: rgba(99, 102, 241, 0.08);
    color: var(--accent-secondary);
  }
  &.warn {
    border-color: rgba(217, 119, 6, 0.25);
    background: rgba(217, 119, 6, 0.08);
    color: var(--warning);
  }
  &.bad {
    border-color: rgba(220, 38, 38, 0.25);
    background: rgba(220, 38, 38, 0.08);
    color: var(--error);
  }
  &.unmanaged {
    border-color: rgba(124, 58, 237, 0.25);
    background: rgba(124, 58, 237, 0.08);
    color: var(--accent-tertiary);
  }
}
</style>

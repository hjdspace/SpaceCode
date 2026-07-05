<template>
  <svg class="template-scenario-art" viewBox="0 0 60 42" width="60" height="42" fill="none" aria-hidden="true">
    <!-- prototype -->
    <g v-if="templateId === 'prototype'">
      <rect x="6" y="7" width="48" height="28" rx="4" :stroke="ink" stroke-width="2" />
      <line x1="6" y1="15" x2="54" y2="15" :stroke="ink" stroke-width="2" />
      <circle cx="10.5" cy="11" r="1.1" :fill="ink" />
      <circle cx="14.5" cy="11" r="1.1" :fill="ink" />
      <circle cx="18.5" cy="11" r="1.1" :fill="ink" />
      <rect x="11" y="20" width="13" height="5" rx="1.5" :fill="accent" />
      <line x1="28" y1="21" x2="48" y2="21" :stroke="ink" stroke-width="2" />
      <line x1="28" y1="26" x2="42" y2="26" :stroke="ink" stroke-width="2" />
      <line x1="11" y1="30" x2="48" y2="30" :stroke="ink" stroke-width="2" />
    </g>

    <!-- wireframe -->
    <g v-else-if="templateId === 'wireframe'">
      <rect x="6" y="7" width="48" height="28" rx="4" :stroke="ink" stroke-width="2" stroke-dasharray="3.5 3" />
      <rect x="11" y="12" width="38" height="6" rx="1.5" :fill="ink" fill-opacity="0.16" />
      <rect x="11" y="22" width="16" height="9" rx="1.5" :fill="ink" fill-opacity="0.16" />
      <rect x="31" y="22" width="11" height="5" rx="1.5" :fill="accent" />
      <line x1="31" y1="30" x2="49" y2="30" :stroke="ink" stroke-width="2" />
    </g>

    <!-- mobile -->
    <g v-else-if="templateId === 'mobile'">
      <rect x="22" y="4" width="16" height="34" rx="3.5" :stroke="ink" stroke-width="2" />
      <line x1="27.5" y1="7.5" x2="32.5" y2="7.5" :stroke="ink" stroke-width="1.6" />
      <line x1="26" y1="14" x2="34" y2="14" :stroke="ink" stroke-width="2" />
      <line x1="26" y1="19" x2="34" y2="19" :stroke="ink" stroke-width="2" />
      <line x1="26" y1="24" x2="31" y2="24" :stroke="ink" stroke-width="2" />
      <rect x="26" y="29" width="8" height="4" rx="1.5" :fill="accent" />
    </g>

    <!-- deck -->
    <g v-else-if="templateId === 'deck'">
      <rect x="15" y="6" width="38" height="24" rx="3" :stroke="ink" stroke-width="2" stroke-opacity="0.45" />
      <rect x="7" y="11" width="38" height="24" rx="3" :fill="surface" :stroke="ink" stroke-width="2" />
      <rect x="11" y="15" width="14" height="5" rx="1.5" :fill="accent" />
      <line x1="11" y1="25" x2="41" y2="25" :stroke="ink" stroke-width="2" />
      <line x1="11" y1="30" x2="34" y2="30" :stroke="ink" stroke-width="2" />
    </g>

    <!-- document -->
    <g v-else-if="templateId === 'document'">
      <path :d="docOutline" :fill="surface" :stroke="ink" stroke-width="2" />
      <path d="M37 5 V11 H43" :stroke="ink" stroke-width="2" />
      <line x1="21" y1="17" x2="38" y2="17" :stroke="accent" stroke-width="2" />
      <line x1="21" y1="22" x2="39" y2="22" :stroke="ink" stroke-width="2" />
      <line x1="21" y1="27" x2="39" y2="27" :stroke="ink" stroke-width="2" />
      <line x1="21" y1="32" x2="33" y2="32" :stroke="ink" stroke-width="2" />
    </g>

    <!-- hyperframes -->
    <g v-else-if="templateId === 'hyperframes'">
      <rect x="9" y="12" width="33" height="21" rx="3" :fill="surface" :stroke="ink" stroke-width="2" stroke-opacity="0.45" />
      <rect x="18" y="8" width="33" height="21" rx="3" :fill="surface" :stroke="ink" stroke-width="2" />
      <path d="M31 13 V23 L39 18 Z" :fill="accent" />
    </g>

    <!-- live-artifact -->
    <g v-else-if="templateId === 'live-artifact'">
      <rect x="6" y="7" width="48" height="28" rx="4" :stroke="ink" stroke-width="2" />
      <line x1="14" y1="29" x2="14" y2="23" :stroke="ink" stroke-width="3" />
      <line x1="22" y1="29" x2="22" y2="18" :stroke="ink" stroke-width="3" />
      <line x1="30" y1="29" x2="30" y2="25" :stroke="ink" stroke-width="3" />
      <line x1="38" y1="29" x2="38" y2="14" :stroke="accent" stroke-width="3" />
      <line x1="46" y1="29" x2="46" y2="21" :stroke="ink" stroke-width="3" />
    </g>

    <!-- image -->
    <g v-else-if="templateId === 'image'">
      <rect x="8" y="8" width="44" height="26" rx="4" :stroke="ink" stroke-width="2" />
      <circle cx="19" cy="16" r="3" :fill="accent" />
      <path d="M11 31 L22 20 L29 26 L37 17 L49 31" :stroke="ink" stroke-width="2" />
    </g>

    <!-- video -->
    <g v-else-if="templateId === 'video'">
      <rect x="6" y="7" width="48" height="28" rx="4" :stroke="ink" stroke-width="2" />
      <path d="M26 15 V25 L35 20 Z" :fill="accent" />
      <line x1="11" y1="30" x2="49" y2="30" :stroke="ink" stroke-width="2" />
      <circle cx="22" cy="30" r="2" :fill="ink" />
    </g>

    <!-- audio -->
    <g v-else-if="templateId === 'audio'">
      <line x1="12" y1="17" x2="12" y2="25" :stroke="ink" stroke-width="3" />
      <line x1="18" y1="13" x2="18" y2="29" :stroke="ink" stroke-width="3" />
      <line x1="24" y1="9" x2="24" y2="33" :stroke="ink" stroke-width="3" />
      <line x1="30" y1="6" x2="30" y2="36" :stroke="accent" stroke-width="3" />
      <line x1="36" y1="11" x2="36" y2="31" :stroke="ink" stroke-width="3" />
      <line x1="42" y1="14" x2="42" y2="28" :stroke="ink" stroke-width="3" />
      <line x1="48" y1="17" x2="48" y2="25" :stroke="ink" stroke-width="3" />
    </g>

    <!-- unknown -->
    <g v-else>
      <circle cx="30" cy="21" r="8" :stroke="ink" stroke-width="2" />
      <text x="30" y="25" text-anchor="middle" font-size="10" :fill="ink">?</text>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ templateId: string }>()

const ink = 'var(--text-muted)'
const accent = 'var(--accent)'
const surface = 'var(--bg-panel)'

const docOutline = computed(() => 'M17 5 H37 L43 11 V37 H17 Z')
</script>

<style scoped lang="scss">
.template-scenario-art {
  display: block;
}
</style>

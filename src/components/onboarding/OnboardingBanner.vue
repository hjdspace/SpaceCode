<template>
  <div v-if="onboarding.bannerVisible" class="ob-banner">
    <AlertTriangle :size="14" />
    <b>{{ message }}</b>
    <button type="button" class="go" @click="resume">
      {{ t('onboarding.banner.go') }}
      <ChevronRight :size="12" />
    </button>
    <button type="button" class="dismiss" @click="onboarding.complete()">
      {{ t('onboarding.banner.dismiss') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, ChevronRight } from 'lucide-vue-next'
import { useOnboardingStore } from '@/stores/onboarding'

const { t } = useI18n()
const onboarding = useOnboardingStore()

const message = computed(() =>
  onboarding.modelReady
    ? t('onboarding.banner.pending')
    : t('onboarding.banner.modelPending')
)

function resume() {
  const index = onboarding.firstIncomplete
  onboarding.start()
  if (index >= 0) onboarding.jumpTo(index)
}
</script>

<style lang="scss" scoped>
.ob-banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 22px 0;
  padding: 11px 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 34%, transparent);
  font-size: var(--text-md);
  color: var(--text-primary);

  b { font-weight: var(--font-weight-semibold); }

  .go {
    margin-left: auto;
    color: var(--accent-primary);
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .dismiss {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    white-space: nowrap;

    &:hover { color: var(--text-primary); }
  }
}
</style>

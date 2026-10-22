<template>
  <div class="ob-grid ob-grid--2">
    <button
      v-for="option in LANGUAGE_OPTIONS"
      :key="option.id"
      type="button"
      class="ob-opt"
      :class="{ 'is-active': settingsStore.language === option.id }"
      @click="selectLanguage(option.id)"
    >
      <span class="flag">{{ option.flag }}</span>
      <span class="ob-opt-text">
        <span class="ob-opt-title">{{ option.name }}</span>
      </span>
      <span v-if="settingsStore.language === option.id" class="ob-opt-tag">
        <Check :size="14" :stroke-width="2.6" />
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import type { Locale } from '@/i18n'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()

const LANGUAGE_OPTIONS: ReadonlyArray<{ id: Locale; name: string; flag: string }> = [
  { id: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { id: 'en-US', name: 'English', flag: '🇺🇸' }
]

function selectLanguage(next: Locale) {
  if (settingsStore.language === next) return
  settingsStore.language = next
  void settingsStore.saveSettings()
}
</script>

<style lang="scss" scoped>
.flag {
  font-size: 21px;
  line-height: 1;
}
</style>

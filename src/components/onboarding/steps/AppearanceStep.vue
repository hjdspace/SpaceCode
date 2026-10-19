<template>
  <div class="ob-themes">
    <button
      v-for="option in THEME_OPTIONS"
      :key="option.id"
      type="button"
      class="ob-theme"
      :class="{ 'is-active': appearance.theme === option.id }"
      @click="patch({ theme: option.id })"
    >
      <span class="ob-theme-strip">
        <i v-for="color in option.swatch" :key="color" :style="{ background: color }" />
      </span>
      <span class="ob-theme-name">{{ t(option.nameKey) }}</span>
    </button>
  </div>

  <div class="ob-group-title">{{ t('appearanceSettings.accentColor') }}</div>
  <div class="ob-dots">
    <button
      v-for="color in ACCENT_COLORS"
      :key="color.id"
      type="button"
      class="ob-dot"
      :class="{ 'is-active': appearance.accentColor === color.id }"
      :title="color.id"
      :style="{ background: color.hex }"
      @click="patch({ accentColor: color.id })"
    />
  </div>

  <div class="ob-group-title">{{ t('settings.density') }} / {{ t('onboarding.appearance.fontSize') }}</div>
  <div class="ob-row">
    <div class="ob-seg">
      <button
        v-for="option in DENSITY_OPTIONS"
        :key="option.id"
        type="button"
        :class="{ 'is-active': appearance.density === option.id }"
        @click="patch({ density: option.id })"
      >
        {{ t(option.nameKey) }}
      </button>
    </div>
    <div class="ob-seg">
      <button
        v-for="size in FONT_SIZES"
        :key="size"
        type="button"
        :class="{ 'is-active': appearance.fontSize === size }"
        @click="patch({ fontSize: size })"
      >
        {{ size }}
      </button>
    </div>
  </div>

  <p class="ob-hint">{{ t('onboarding.appearance.liveHint') }}</p>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore, type AppearanceSettings } from '@/stores/settings'
import { ACCENT_COLORS, applyAppearanceNow } from '@/lib/appearanceSync'

const { t } = useI18n()
const settingsStore = useSettingsStore()

const THEME_OPTIONS: ReadonlyArray<{
  id: AppearanceSettings['theme']
  nameKey: string
  swatch: string[]
}> = [
  { id: 'system', nameKey: 'appearanceSettings.themeSystem', swatch: ['#e7e9ef', '#f0f1f5', '#ffffff'] },
  { id: 'light', nameKey: 'appearanceSettings.themeLight', swatch: ['#ffffff', '#f0f1f5', '#e7e9ef'] },
  { id: 'dark', nameKey: 'appearanceSettings.themeDark', swatch: ['#0d0d0d', '#141414', '#1f1f1f'] },
  { id: 'anthropic', nameKey: 'appearanceSettings.themeAnthropic', swatch: ['#faf9f5', '#efe9de', '#e8e0d2'] },
  { id: 'anthropic-dark', nameKey: 'appearanceSettings.themeAnthropicDark', swatch: ['#181715', '#1c1b1a', '#252320'] }
]

const DENSITY_OPTIONS: ReadonlyArray<{ id: AppearanceSettings['density']; nameKey: string }> = [
  { id: 'compact', nameKey: 'settings.densityCompact' },
  { id: 'default', nameKey: 'settings.densityDefault' },
  { id: 'comfortable', nameKey: 'settings.densityComfortable' }
]

const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20]

const appearance = computed(() => settingsStore.appearance)

function patch(partial: Partial<AppearanceSettings>) {
  settingsStore.updateAppearance(partial)
  applyAppearanceNow(settingsStore.appearance)
}
</script>

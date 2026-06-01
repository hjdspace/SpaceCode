<template>
  <div class="appearance-settings">
    <div class="s-page-header">
      <h2 class="s-page-title">{{ t('appearanceSettings.title') }}</h2>
      <p class="s-page-desc">自定义界面主题、字体和显示效果</p>
    </div>

    <div class="s-card">
      <div class="s-form-group">
        <label class="s-form-label">{{ t('settings.theme') }}</label>
        <div class="s-selection-grid" style="grid-template-columns: repeat(5, 1fr)">
          <button
            v-for="theme in themes"
            :key="theme.id"
            class="s-selection-card"
            :class="{ active: config.theme === theme.id }"
            @click="selectTheme(theme.id)"
          >
            <div class="theme-preview" :class="theme.id">
              <div class="preview-header"></div>
              <div class="preview-sidebar"></div>
              <div class="preview-content"></div>
            </div>
            <div class="theme-name">{{ theme.name }}</div>
            <span v-if="config.theme === theme.id" class="s-check-badge"><Check :size="14" /></span>
          </button>
        </div>
      </div>
    </div>

    <div class="s-card">
      <div class="s-section-header">
        <h3 class="s-section-title">{{ t('settings.font') }}</h3>
      </div>
      <div class="s-divider"></div>
      <div class="form-row">
        <div class="form-group">
          <label class="s-form-label">{{ t('settings.fontSize') }}</label>
          <select v-model="config.fontSize" class="s-form-select">
            <option v-for="size in fontSizes" :key="size" :value="size">{{ size }}px</option>
          </select>
        </div>
        <div class="form-group form-group-wide">
          <label class="s-form-label">{{ t('settings.fontFamily') }}</label>
          <select v-model="config.fontFamily" class="s-form-select">
            <option v-for="font in fontFamilies" :key="font.id" :value="font.id">{{ font.name }}</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="s-form-label">{{ t('settings.codeFontFamily') }}</label>
        <select v-model="config.codeFontFamily" class="s-form-select">
          <option v-for="font in codeFonts" :key="font.id" :value="font.id">{{ font.name }}</option>
        </select>
      </div>
    </div>

    <div class="s-card">
      <div class="s-section-header">
        <h3 class="s-section-title">{{ t('settings.density') }}</h3>
      </div>
      <div class="s-divider"></div>
      <div class="s-selection-grid" style="grid-template-columns: repeat(3, 1fr)">
        <button
          v-for="density in densities"
          :key="density.id"
          class="s-selection-card"
          :class="{ active: config.density === density.id }"
          @click="selectDensity(density.id)"
        >
          <div class="density-preview" :class="density.id">
            <div></div><div></div><div></div>
          </div>
          <span class="density-name">{{ density.name }}</span>
        </button>
      </div>
    </div>

    <div class="s-card">
      <div class="s-section-header">
        <h3 class="s-section-title">{{ t('settings.editor') }}</h3>
      </div>
      <div class="s-divider"></div>
      <div class="s-toggle-wrapper">
        <label class="s-toggle-item">
          <div class="s-toggle-info">
            <span class="s-toggle-label">{{ t('settings.showLineNumbers') }}</span>
            <span class="s-toggle-description">{{ t('settings.showLineNumbersDesc') }}</span>
          </div>
          <input type="checkbox" v-model="config.showLineNumbers" class="s-toggle-switch" />
        </label>

        <label class="s-toggle-item">
          <div class="s-toggle-info">
            <span class="s-toggle-label">{{ t('settings.wordWrap') }}</span>
            <span class="s-toggle-description">{{ t('settings.wordWrapDesc') }}</span>
          </div>
          <input type="checkbox" v-model="config.wordWrap" class="s-toggle-switch" />
        </label>

        <label class="s-toggle-item">
          <div class="s-toggle-info">
            <span class="s-toggle-label">{{ t('settings.minimap') }}</span>
            <span class="s-toggle-description">{{ t('settings.minimapDesc') }}</span>
          </div>
          <input type="checkbox" v-model="config.showMinimap" class="s-toggle-switch" />
        </label>

        <label class="s-toggle-item">
          <div class="s-toggle-info">
            <span class="s-toggle-label">{{ t('appearanceSettings.smoothScrolling') }}</span>
            <span class="s-toggle-description">{{ t('appearanceSettings.smoothScrollingDesc') }}</span>
          </div>
          <input type="checkbox" v-model="config.smoothScrolling" class="s-toggle-switch" />
        </label>
      </div>
    </div>

    <div class="s-card">
      <div class="s-section-header">
        <h3 class="s-section-title">{{ t('contextUsage.settingsSection') }}</h3>
      </div>
      <div class="s-divider"></div>
      <div class="s-toggle-wrapper">
        <label class="s-toggle-item">
          <div class="s-toggle-info">
            <span class="s-toggle-label">{{ t('contextUsage.showInHeader') }}</span>
            <span class="s-toggle-description">{{ t('contextUsage.showInHeaderDesc') }}</span>
          </div>
          <input type="checkbox" v-model="config.showContextUsage" class="s-toggle-switch" />
        </label>

        <label class="s-toggle-item">
          <div class="s-toggle-info">
            <span class="s-toggle-label">{{ t('contextUsage.showWarningBar') }}</span>
            <span class="s-toggle-description">{{ t('contextUsage.showWarningBarDesc') }}</span>
          </div>
          <input type="checkbox" v-model="config.showContextWarningBar" class="s-toggle-switch" />
        </label>
      </div>
    </div>

    <div class="s-card">
      <div class="s-section-header">
        <h3 class="s-section-title">{{ t('appearanceSettings.accentColor') }}</h3>
      </div>
      <div class="s-divider"></div>
      <div class="s-color-options">
        <button
          v-for="color in accentColors"
          :key="color.id"
          class="s-color-option"
          :class="{ active: config.accentColor === color.id }"
          :style="{ background: color.hex }"
          @click="selectAccent(color.id)"
        >
          <Check v-if="config.accentColor === color.id" :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useSettingsStore, type AppearanceSettings as AppearanceConfig } from '@/stores/settings'
import { debounce } from '@/utils/debounce'

const { t } = useI18n()
const emit = defineEmits<{
  'update:modelValue': [value: AppearanceConfig]
  'change': []
}>()

const appStore = useAppStore()
const settingsStore = useSettingsStore()

const themes = [
  { id: 'system', name: t('appearanceSettings.themeSystem') },
  { id: 'light', name: t('appearanceSettings.themeLight') },
  { id: 'dark', name: t('appearanceSettings.themeDark') },
  { id: 'anthropic', name: t('appearanceSettings.themeAnthropic') },
  { id: 'anthropic-dark', name: t('appearanceSettings.themeAnthropicDark') }
]

const fontSizes = [12, 13, 14, 15, 16, 18, 20]

const fontFamilies = [
  { id: 'system', name: t('appearanceSettings.fontSystemDefault') },
  { id: 'inter', name: 'Inter' },
  { id: 'sf-pro', name: 'SF Pro' },
  { id: 'segoe', name: 'Segoe UI' }
]

const codeFonts = [
  { id: 'jetbrains', name: 'JetBrains Mono' },
  { id: 'fira', name: 'Fira Code' },
  { id: 'cascadia', name: 'Cascadia Code' },
  { id: 'source-code', name: 'Source Code Pro' },
  { id: 'consolas', name: 'Consolas' }
]

const densities = [
  { id: 'compact', name: t('settings.densityCompact') },
  { id: 'default', name: t('settings.densityDefault') },
  { id: 'comfortable', name: t('settings.densityComfortable') }
]

const accentColors = [
  { id: 'blue', hex: '#3b82f6' },
  { id: 'purple', hex: '#8b5cf6' },
  { id: 'green', hex: '#22c55e' },
  { id: 'orange', hex: '#f97316' },
  { id: 'pink', hex: '#ec4899' },
  { id: 'cyan', hex: '#06b6d4' },
  { id: 'anthropic-orange', hex: '#d97757' },
  { id: 'anthropic-blue', hex: '#6a9bcc' },
  { id: 'anthropic-green', hex: '#788c5d' }
]

// Default config
const defaultConfig: AppearanceConfig = {
  theme: 'system',
  fontSize: 14,
  fontFamily: 'system',
  codeFontFamily: 'jetbrains',
  density: 'default',
  showLineNumbers: true,
  wordWrap: true,
  showMinimap: false,
  smoothScrolling: true,
  accentColor: 'blue',
  showContextUsage: true,
  showContextWarningBar: true,
}

function loadSavedConfig(): Partial<AppearanceConfig> {
  const storeAppearance = settingsStore.appearance
  if (storeAppearance && Object.keys(storeAppearance).length > 0) {
    return storeAppearance
  }
  try {
    const saved = localStorage.getItem('appearance_settings')
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (e) {
    console.error('[Appearance] Failed to load saved settings')
  }
  return {}
}

const savedConfig = loadSavedConfig()
const config = ref<AppearanceConfig>({
  ...defaultConfig,
  ...savedConfig
})

let _initializedFromStore = false
watch(() => settingsStore.appearance, (newAppearance) => {
  if (!_initializedFromStore && newAppearance) {
    _initializedFromStore = true
    config.value = { ...defaultConfig, ...newAppearance }
  }
}, { deep: true })

function applyTheme(theme: string) {
  let effectiveTheme = theme
  if (theme === 'system') {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.setAttribute('data-theme', effectiveTheme)
  appStore.setTheme(effectiveTheme as 'light' | 'dark' | 'anthropic' | 'anthropic-dark')
}

// Apply accent color
function applyAccentColor(colorId: string) {
  const color = accentColors.find(c => c.id === colorId)
  if (color) {
    document.documentElement.style.setProperty('--accent-primary', color.hex)
    // Convert hex to RGB for rgba usage
    const r = parseInt(color.hex.slice(1, 3), 16)
    const g = parseInt(color.hex.slice(3, 5), 16)
    const b = parseInt(color.hex.slice(5, 7), 16)
    document.documentElement.style.setProperty('--accent-primary-rgb', `${r}, ${g}, ${b}`)
  }
}

// Apply font settings
function applyFontSettings(config: AppearanceConfig) {
  document.documentElement.style.setProperty('--font-size-base', `${config.fontSize}px`)

  const fontFamilyMap: Record<string, string> = {
    'system': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'inter': '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    'sf-pro': '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
    'segoe': '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif'
  }
  document.documentElement.style.setProperty('--font-family-base', fontFamilyMap[config.fontFamily] || fontFamilyMap.system)

  const codeFontMap: Record<string, string> = {
    'jetbrains': '"JetBrains Mono", "Fira Code", monospace',
    'fira': '"Fira Code", "JetBrains Mono", monospace',
    'cascadia': '"Cascadia Code", "Fira Code", monospace',
    'source-code': '"Source Code Pro", monospace',
    'consolas': 'Consolas, Monaco, monospace'
  }
  document.documentElement.style.setProperty('--font-family-mono', codeFontMap[config.codeFontFamily] || codeFontMap.jetbrains)
}

// Apply density
function applyDensity(density: string) {
  document.documentElement.setAttribute('data-density', density)
}

// 使用防抖保存到localStorage，避免频繁写入
const debouncedSave = debounce((newConfig: AppearanceConfig) => {
  try {
    localStorage.setItem('appearance_settings', JSON.stringify(newConfig))
  } catch (e) {
    console.error('[Appearance] Failed to save settings to localStorage')
  }
  settingsStore.updateAppearance(newConfig)
}, 300)

// 批量应用样式更新
let pendingUpdates = new Set<string>()
let rafId: number | null = null

function scheduleUpdate(key: string, updateFn: () => void) {
  pendingUpdates.add(key)
  
  if (rafId) {
    cancelAnimationFrame(rafId)
  }
  
  rafId = requestAnimationFrame(() => {
    updateFn()
    pendingUpdates.clear()
    rafId = null
  })
}

// Watch for changes and apply immediately - 使用细粒度监听
watch(() => config.value.theme, (newTheme) => {
  scheduleUpdate('theme', () => applyTheme(newTheme))
}, { immediate: true })

watch(() => config.value.accentColor, (newColor) => {
  scheduleUpdate('accentColor', () => applyAccentColor(newColor))
}, { immediate: true })

watch(() => config.value.fontSize, () => {
  scheduleUpdate('fontSettings', () => applyFontSettings(config.value))
}, { immediate: true })

watch(() => config.value.fontFamily, () => {
  scheduleUpdate('fontSettings', () => applyFontSettings(config.value))
}, { immediate: true })

watch(() => config.value.codeFontFamily, () => {
  scheduleUpdate('fontSettings', () => applyFontSettings(config.value))
}, { immediate: true })

watch(() => config.value.density, (newDensity) => {
  scheduleUpdate('density', () => applyDensity(newDensity))
}, { immediate: true })

// 监听配置变化并保存/触发change事件 - 使用防抖
watch(config, (newConfig) => {
  debouncedSave(newConfig)
  emit('change')
}, { deep: true, flush: 'post' })

// 系统主题变化监听 - 使用防抖
let mediaQuery: MediaQueryList | null = null
let mediaQueryHandler: ((e: MediaQueryListEvent) => void) | null = null

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQueryHandler = debounce(() => {
    if (config.value.theme === 'system') {
      applyTheme('system')
    }
  }, 100)
  mediaQuery.addEventListener('change', mediaQueryHandler)
})

onUnmounted(() => {
  if (mediaQuery && mediaQueryHandler) {
    mediaQuery.removeEventListener('change', mediaQueryHandler)
  }
  if (rafId) {
    cancelAnimationFrame(rafId)
  }
})

function selectTheme(themeId: string) {
  config.value.theme = themeId as 'system' | 'light' | 'dark' | 'anthropic' | 'anthropic-dark'
}

function selectDensity(densityId: string) {
  config.value.density = densityId as 'compact' | 'default' | 'comfortable'
}

function selectAccent(colorId: string) {
  config.value.accentColor = colorId
}
</script>

<style lang="scss" scoped>
.appearance-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.theme-preview {
  width: 80px;
  height: 56px;
  border-radius: 8px;
  border: 1px solid var(--border-default);
  overflow: hidden;
  position: relative;

  .preview-header {
    height: 12px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }

  .preview-sidebar {
    position: absolute;
    left: 0;
    top: 12px;
    bottom: 0;
    width: 20px;
    border-right: 1px solid rgba(0, 0, 0, 0.06);
  }

  .preview-content {
    position: absolute;
    left: 20px;
    right: 0;
    top: 12px;
    bottom: 0;
  }

  &.light {
    .preview-header { background: #e7e9ef; }
    .preview-sidebar { background: #f0f1f5; }
    .preview-content { background: #ffffff; }
  }

  &.dark {
    .preview-header { background: #1f1f1f; }
    .preview-sidebar { background: #141414; }
    .preview-content { background: #0d0d0d; }
  }

  &.system {
    .preview-header {
      background: linear-gradient(to right, #e7e9ef 50%, #1f1f1f 50%);
    }
    .preview-sidebar {
      background: linear-gradient(to right, #f0f1f5 50%, #141414 50%);
    }
    .preview-content {
      background: linear-gradient(to right, #ffffff 50%, #0d0d0d 50%);
    }
  }

  &.anthropic {
    .preview-header { background: #e8e0d2; }
    .preview-sidebar { background: #efe9de; }
    .preview-content { background: #faf9f5; }
  }

  &.anthropic-dark {
    .preview-header { background: #252320; }
    .preview-sidebar { background: #1c1b1a; }
    .preview-content { background: #181715; }
  }
}

.theme-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.density-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 48px;

  div {
    height: 4px;
    background: var(--text-muted);
    border-radius: 2px;

    &:nth-child(2) {
      width: 75%;
    }

    &:nth-child(3) {
      width: 50%;
    }
  }

  &.compact {
    gap: 2px;
    div { height: 3px; }
  }

  &.comfortable {
    gap: 6px;
    div { height: 5px; }
  }
}

.density-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}
</style>

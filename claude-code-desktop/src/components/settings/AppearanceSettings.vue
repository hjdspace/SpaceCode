<template>
  <div class="settings-section">
    <h2 class="section-title">Appearance</h2>

    <div class="section-content">
      <!-- Theme Selection -->
      <div class="form-group">
        <label class="form-label">Theme</label>
        <div class="theme-options">
          <button
            v-for="theme in themes"
            :key="theme.id"
            class="theme-card"
            :class="{ active: config.theme === theme.id }"
            @click="selectTheme(theme.id)"
          >
            <div class="theme-preview" :class="theme.id">
              <div class="preview-header"></div>
              <div class="preview-sidebar"></div>
              <div class="preview-content"></div>
            </div>
            <div class="theme-name">{{ theme.name }}</div>
            <Check v-if="config.theme === theme.id" class="theme-check" :size="16" />
          </button>
        </div>
      </div>

      <!-- Font Settings -->
      <div class="divider"></div>
      <h3 class="subsection-title">Font</h3>

      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">Font Size</label>
          <select v-model="config.fontSize" class="form-select">
            <option v-for="size in fontSizes" :key="size" :value="size">{{ size }}px</option>
          </select>
        </div>

        <div class="form-group flex-2">
          <label class="form-label">Font Family</label>
          <select v-model="config.fontFamily" class="form-select">
            <option v-for="font in fontFamilies" :key="font.id" :value="font.id">{{ font.name }}</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Code Font Family</label>
        <select v-model="config.codeFontFamily" class="form-select">
          <option v-for="font in codeFonts" :key="font.id" :value="font.id">{{ font.name }}</option>
        </select>
      </div>

      <!-- UI Density -->
      <div class="divider"></div>
      <h3 class="subsection-title">Density</h3>

      <div class="density-options">
        <button
          v-for="density in densities"
          :key="density.id"
          class="density-btn"
          :class="{ active: config.density === density.id }"
          @click="selectDensity(density.id)"
        >
          <div class="density-preview" :class="density.id">
            <div></div><div></div><div></div>
          </div>
          <span>{{ density.name }}</span>
        </button>
      </div>

      <!-- Toggles -->
      <div class="divider"></div>
      <h3 class="subsection-title">Editor</h3>

      <div class="toggle-list">
        <label class="toggle-item">
          <div class="toggle-info">
            <span class="toggle-label">Show Line Numbers</span>
            <span class="toggle-desc">Display line numbers in code editor</span>
          </div>
          <input type="checkbox" v-model="config.showLineNumbers" class="toggle-switch" />
        </label>

        <label class="toggle-item">
          <div class="toggle-info">
            <span class="toggle-label">Word Wrap</span>
            <span class="toggle-desc">Wrap long lines to fit the viewport</span>
          </div>
          <input type="checkbox" v-model="config.wordWrap" class="toggle-switch" />
        </label>

        <label class="toggle-item">
          <div class="toggle-info">
            <span class="toggle-label">Minimap</span>
            <span class="toggle-desc">Show minimap in code editor</span>
          </div>
          <input type="checkbox" v-model="config.showMinimap" class="toggle-switch" />
        </label>

        <label class="toggle-item">
          <div class="toggle-info">
            <span class="toggle-label">Smooth Scrolling</span>
            <span class="toggle-desc">Enable smooth scrolling animation</span>
          </div>
          <input type="checkbox" v-model="config.smoothScrolling" class="toggle-switch" />
        </label>
      </div>

      <!-- Accent Color -->
      <div class="divider"></div>
      <h3 class="subsection-title">Accent Color</h3>

      <div class="color-options">
        <button
          v-for="color in accentColors"
          :key="color.id"
          class="color-btn"
          :class="{ active: config.accentColor === color.id }"
          :style="{ background: color.hex }"
          @click="selectAccent(color.id)"
        >
          <Check v-if="config.accentColor === color.id" :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Check } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { debounce } from '@/utils/debounce'

export interface AppearanceConfig {
  theme: 'system' | 'light' | 'dark'
  fontSize: number
  fontFamily: string
  codeFontFamily: string
  density: 'compact' | 'default' | 'comfortable'
  showLineNumbers: boolean
  wordWrap: boolean
  showMinimap: boolean
  smoothScrolling: boolean
  accentColor: string
}

const props = defineProps<{
  modelValue?: AppearanceConfig
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AppearanceConfig]
  'change': []
}>()

const appStore = useAppStore()

const themes = [
  { id: 'system', name: 'System' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' }
]

const fontSizes = [12, 13, 14, 15, 16, 18, 20]

const fontFamilies = [
  { id: 'system', name: 'System Default' },
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
  { id: 'compact', name: 'Compact' },
  { id: 'default', name: 'Default' },
  { id: 'comfortable', name: 'Comfortable' }
]

const accentColors = [
  { id: 'blue', hex: '#3b82f6' },
  { id: 'purple', hex: '#8b5cf6' },
  { id: 'green', hex: '#22c55e' },
  { id: 'orange', hex: '#f97316' },
  { id: 'pink', hex: '#ec4899' },
  { id: 'cyan', hex: '#06b6d4' }
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
  accentColor: 'blue'
}

// Load saved config from localStorage - 使用惰性初始化
function loadSavedConfig(): Partial<AppearanceConfig> {
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

// Initialize config with saved values or defaults
const savedConfig = loadSavedConfig()
const config = ref<AppearanceConfig>({
  ...defaultConfig,
  ...savedConfig,
  ...props.modelValue
})

// Sync with external modelValue if provided - 使用浅比较
watch(() => props.modelValue, (newValue) => {
  if (newValue) {
    const hasChanges = Object.keys(newValue).some(
      key => config.value[key as keyof AppearanceConfig] !== newValue[key as keyof AppearanceConfig]
    )
    if (hasChanges) {
      config.value = { ...config.value, ...newValue }
    }
  }
}, { deep: false })

// Apply theme to document
function applyTheme(theme: string) {
  let effectiveTheme = theme
  if (theme === 'system') {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.setAttribute('data-theme', effectiveTheme)
  // Also update app store theme
  appStore.theme = effectiveTheme as 'light' | 'dark'
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
    console.error('[Appearance] Failed to save settings')
  }
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
  config.value.theme = themeId as 'system' | 'light' | 'dark'
}

function selectDensity(densityId: string) {
  config.value.density = densityId as 'compact' | 'default' | 'comfortable'
}

function selectAccent(colorId: string) {
  config.value.accentColor = colorId
}
</script>

<style lang="scss" scoped>
.settings-section {
  max-width: 720px;
}

.section-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 24px;
}

.section-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.subsection-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 12px;

  &.flex-1 {
    flex: 1;
  }

  &.flex-2 {
    flex: 2;
  }
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.form-select {
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 36px;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.1);
  }
}

.divider {
  height: 1px;
  background: var(--border-color);
  margin: 8px 0;
}

.theme-options {
  display: flex;
  gap: 16px;
}

.theme-card {
  @include reset-button;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--bg-secondary);
  border: 2px solid transparent;
  border-radius: 12px;
  transition: all 0.2s;
  position: relative;

  &:hover {
    background: var(--bg-hover);
  }

  &.active {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.05);
  }
}

.theme-preview {
  width: 80px;
  height: 56px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  overflow: hidden;
  position: relative;

  .preview-header {
    height: 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
  }

  .preview-sidebar {
    position: absolute;
    left: 0;
    top: 12px;
    bottom: 0;
    width: 20px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-color);
  }

  .preview-content {
    position: absolute;
    left: 20px;
    right: 0;
    top: 12px;
    bottom: 0;
    background: var(--bg-primary);
  }

  &.light {
    .preview-header { background: #f1f5f9; }
    .preview-sidebar { background: #f8fafc; }
    .preview-content { background: #ffffff; }
  }

  &.dark {
    .preview-header { background: #1e293b; }
    .preview-sidebar { background: #0f172a; }
    .preview-content { background: #1e293b; }
  }

  &.system {
    .preview-header {
      background: linear-gradient(to right, #f1f5f9 50%, #1e293b 50%);
    }
    .preview-sidebar {
      background: linear-gradient(to right, #f8fafc 50%, #0f172a 50%);
    }
    .preview-content {
      background: linear-gradient(to right, #ffffff 50%, #1e293b 50%);
    }
  }
}

.theme-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.theme-check {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--accent-primary);
}

.density-options {
  display: flex;
  gap: 12px;
}

.density-btn {
  @include reset-button;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 24px;
  background: var(--bg-secondary);
  border: 2px solid transparent;
  border-radius: 10px;
  transition: all 0.2s;

  &:hover {
    background: var(--bg-hover);
  }

  &.active {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.05);
  }

  span {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }
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

.toggle-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toggle-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  cursor: pointer;

  &:hover .toggle-info .toggle-label {
    color: var(--text-primary);
  }
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toggle-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  transition: color 0.2s;
}

.toggle-desc {
  font-size: 13px;
  color: var(--text-muted);
}

.toggle-switch {
  appearance: none;
  width: 44px;
  height: 24px;
  background: var(--bg-tertiary);
  border-radius: 12px;
  position: relative;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid var(--border-color);

  &::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  &:checked {
    background: var(--accent-primary);
    border-color: var(--accent-primary);

    &::after {
      transform: translateX(20px);
    }
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.1);
  }
}

.color-options {
  display: flex;
  gap: 12px;
}

.color-btn {
  @include reset-button;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  transition: all 0.2s;
  border: 2px solid transparent;

  &:hover {
    transform: scale(1.1);
  }

  &.active {
    border-color: var(--text-primary);
    box-shadow: 0 0 0 2px var(--bg-primary), 0 0 0 4px var(--accent-primary);
  }
}
</style>

<template>
  <div class="settings-section">
    <!-- Masthead -->
    <div class="s-masthead">
      <div class="s-masthead-eyebrow">Settings</div>
      <h1 class="s-masthead-title">{{ $t('settings.general') }}</h1>
      <p class="s-masthead-desc">{{ $t('settings.generalDesc') }}</p>
    </div>

    <!-- Status Bar -->
    <div class="s-status-bar">
      <div class="s-status-card">
        <div class="s-status-card-label">{{ $t('settings.language') }}</div>
        <div class="s-status-card-value">
          <span class="s-status-indicator online"></span>
          {{ currentLanguageName }}
        </div>
        <div class="s-status-card-sub">{{ $t('settings.languageActive') || '已激活' }}</div>
      </div>
      <div class="s-status-card">
        <div class="s-status-card-label">Engine</div>
        <div class="s-status-card-value">
          <span class="s-status-indicator online"></span>
          {{ config.engineType === 'pi' ? 'Pi' : 'Claude Code' }}
        </div>
        <div class="s-status-card-sub">{{ engineSourceLabel }}</div>
      </div>
      <div class="s-status-card">
        <div class="s-status-card-label">{{ $t('project.settings') }}</div>
        <div class="s-status-card-value">
          <span class="s-status-indicator" :class="config.projectRoot ? 'online' : 'warning'"></span>
          {{ projectName }}
        </div>
        <div class="s-status-card-sub">{{ projectParent }}</div>
      </div>
    </div>

    <!-- Language Panel -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon lang">
            <Globe :size="14" />
          </div>
          <span class="s-panel-title">{{ $t('settings.language') }}</span>
        </div>
        <span class="s-panel-badge active">{{ $t('settings.languageActive') || '已设置' }}</span>
      </div>
      <div class="s-panel-body">
        <div class="s-lang-row" @click="showLangDropdown = !showLangDropdown">
          <div class="s-lang-row-left">
            <div class="s-lang-row-icon">
              <Globe :size="16" />
            </div>
            <div class="s-lang-row-info">
              <div class="s-lang-row-label">{{ $t('settings.language') }}</div>
              <div class="s-lang-row-sublabel">{{ $t('settings.languageDesc') }}</div>
            </div>
          </div>
          <div class="s-lang-row-right">
            <span class="s-lang-row-value">{{ currentLanguageName }}</span>
            <span class="s-chevron">›</span>
          </div>
        </div>
        <!-- Language Dropdown -->
        <div v-if="showLangDropdown" class="lang-dropdown">
          <button
            v-for="lang in languages"
            :key="lang.id"
            class="lang-dropdown-item"
            :class="{ active: currentLanguage === lang.id }"
            @click.stop="selectLanguage(lang.id)"
          >
            <span class="lang-dropdown-flag">{{ lang.flag }}</span>
            <span class="lang-dropdown-name">{{ lang.name }}</span>
            <span v-if="currentLanguage === lang.id" class="lang-dropdown-check">
              <Check :size="14" />
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Engine Panel -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon engine">
            <Zap :size="14" />
          </div>
          <span class="s-panel-title">Agent Engine</span>
        </div>
        <span class="s-panel-badge active">{{ $t('settings.engineRunning') || '运行中' }}</span>
      </div>
      <div class="s-panel-body">
        <div class="s-engine-grid">
          <div
            class="s-engine-tile"
            :class="{ active: config.engineType === 'claude-code' }"
            @click="selectEngine('claude-code')"
          >
            <span class="s-engine-tile-check"><Check :size="12" /></span>
            <div class="s-engine-tile-head">
              <div class="s-engine-tile-icon claude">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"/></svg>
              </div>
              <span class="s-engine-tile-name">Claude Code</span>
            </div>
            <div class="s-engine-tile-desc">{{ $t('settings.claudeCodeDesc') }}</div>
            <div class="s-engine-tile-status">
              <span class="s-status-indicator online"></span>
              {{ $t('settings.engineInUse') || '使用中' }} · {{ claudeCodeDesc }}
            </div>
          </div>
          <div
            class="s-engine-tile"
            :class="{ active: config.engineType === 'pi', disabled: !piAvailable && !piInstalling }"
            @click="selectEngine('pi')"
          >
            <div class="s-engine-tile-head">
              <div class="s-engine-tile-icon pi">
                <svg width="20" height="20" viewBox="0 0 800 800" fill="currentColor"><path fill-rule="evenodd" d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"/><path d="M517.36 400H634.72V634.72H517.36Z"/></svg>
              </div>
              <span class="s-engine-tile-name">Pi</span>
            </div>
            <div class="s-engine-tile-desc">{{ $t('settings.piDesc') }}</div>
            <div class="s-engine-tile-status">
              <span class="s-status-indicator" :class="piAvailable ? 'online' : 'offline'"></span>
              {{ piDesc }}
            </div>
            <button
              v-if="!piAvailable && !piInstalling && !piChecking"
              class="s-install-btn"
              @click.stop="installPiSdk"
            >
              {{ $t('settings.installPiSdk') || 'Install Pi SDK' }}
            </button>
            <div v-if="piInstalling" class="s-install-progress">
              <span class="s-spinner"></span>
              {{ $t('settings.installingPiSdk') || 'Installing...' }}
            </div>
          </div>
        </div>
        <div class="s-source-row">
          <span class="s-source-label">{{ $t('engineSource.title') || '引擎来源' }}：<strong>{{ engineSourceLabel }}</strong></span>
          <span class="s-source-value" @click="showEngineSource = !showEngineSource">{{ $t('settings.change') || '更改' }} ›</span>
        </div>
        <EngineSourceSettings v-if="showEngineSource && config.engineType === 'claude-code'" />
      </div>
    </div>

    <!-- Project Panel -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon project">
            <FolderOpen :size="14" />
          </div>
          <span class="s-panel-title">{{ $t('project.projectRoot') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="s-path-field">
          <input
            type="text"
            v-model="config.projectRoot"
            :placeholder="'D:\\Projects\\my-project'"
            class="s-path-mono"
          />
          <button class="s-path-action" @click="browseProjectRoot">
            <FolderOpen :size="14" />
            {{ $t('project.selectFolder') || '浏览' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  Check, FolderOpen, Globe, Zap
} from 'lucide-vue-next'
import EngineSourceSettings from './EngineSourceSettings.vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import { useAppStore } from '@/stores/app'
import { recordRecentProjectRoot } from '@/utils/recentProjectRoots'
import { useSettingsStore } from '@/stores/settings'
import type { EngineType } from '@/stores/settings'
import type { Locale } from '@/i18n'

const props = defineProps<{
  modelValue: {
    projectRoot: string
    engineType?: EngineType
  }
}>()

const emit = defineEmits<{
  'update:modelValue': [value: typeof props.modelValue]
  'change': []
}>()

const appStore = useAppStore()
const settingsStore = useSettingsStore()
const { t, locale } = useI18n()

const showLangDropdown = ref(false)
const showEngineSource = ref(false)

const languages = [
  { id: 'zh-CN' as Locale, name: '简体中文', flag: '🇨🇳' },
  { id: 'en-US' as Locale, name: 'English', flag: '🇺🇸' },
]

const currentLanguage = computed({
  get: () => locale.value as Locale,
  set: (val: Locale) => {
    locale.value = val
    settingsStore.language = val
    settingsStore.saveSettings()
    emit('change')
  }
})

const currentLanguageName = computed(() => {
  return languages.find(l => l.id === currentLanguage.value)?.name || 'English'
})

function selectLanguage(langId: Locale) {
  currentLanguage.value = langId
  showLangDropdown.value = false
}

const piAvailable = ref<boolean | null>(null)
const piChecking = ref(true)
const piInstalling = ref(false)
const piInstallError = ref<string | null>(null)

const claudeCodeDesc = computed(() => {
  if (settingsStore.engineSource === 'installed') {
    return 'Installed CLI'
  }
  return 'Bundled'
})

const engineSourceLabel = computed(() => {
  if (settingsStore.engineSource === 'installed') {
    return 'Installed CLI'
  }
  return 'Bundled'
})

const piDesc = computed(() => {
  if (piChecking.value) return 'Checking SDK...'
  if (piInstalling.value) return 'Installing SDK...'
  if (piInstallError.value) return piInstallError.value
  if (piAvailable.value === false) return 'SDK not installed'
  return 'Minimalist coding agent'
})

const projectName = computed(() => {
  if (!config.value.projectRoot) return '—'
  const parts = config.value.projectRoot.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || '—'
})

const projectParent = computed(() => {
  if (!config.value.projectRoot) return ''
  const parts = config.value.projectRoot.replace(/\\/g, '/').split('/')
  parts.pop()
  return parts.join('/') + '/'
})

onMounted(async () => {
  try {
    const electronAPI = window.electronAPI
    if (electronAPI?.claudeCode?.isEngineAvailable) {
      piAvailable.value = await electronAPI.claudeCode.isEngineAvailable('pi')
    } else {
      piAvailable.value = false
    }
    if (piAvailable.value === false && config.value.engineType === 'pi') {
      config.value.engineType = 'claude-code'
      settingsStore.engineType = 'claude-code'
      settingsStore.saveSettings()
    }
  } catch {
    piAvailable.value = false
    if (config.value.engineType === 'pi') {
      config.value.engineType = 'claude-code'
      settingsStore.engineType = 'claude-code'
      settingsStore.saveSettings()
    }
  } finally {
    piChecking.value = false
  }
})

async function checkPiAvailability() {
  try {
    const electronAPI = window.electronAPI
    if (electronAPI?.claudeCode?.isEngineAvailable) {
      piAvailable.value = await electronAPI.claudeCode.isEngineAvailable('pi')
    } else {
      piAvailable.value = false
    }
  } catch {
    piAvailable.value = false
  }
}

async function installPiSdk() {
  piInstalling.value = true
  piInstallError.value = null
  try {
    const electronAPI = window.electronAPI
    const result = await electronAPI?.claudeCode?.installPiSdk()
    if (result?.success) {
      // Re-check availability after installation
      await checkPiAvailability()
      if (piAvailable.value) {
        // Auto-select Pi engine after successful install
        selectEngine('pi')
      }
    } else {
      piInstallError.value = result?.error || 'Installation failed'
    }
  } catch (err) {
    piInstallError.value = String(err)
  } finally {
    piInstalling.value = false
  }
}

function selectEngine(engineId: EngineType) {
  if (engineId === 'pi' && (piAvailable.value === false || piInstalling.value)) return
  if (config.value.engineType === engineId) return

  const previousEngine = config.value.engineType
  config.value.engineType = engineId
  settingsStore.engineType = engineId
  settingsStore.saveSettings()

  try {
    const electronAPI = window.electronAPI
    const stop = electronAPI?.claudeCode?.stop
    const getActive = electronAPI?.claudeCode?.getActiveSessions
    if (stop && getActive) {
      Promise.resolve(getActive())
        .then((list: any[]) => {
          if (!Array.isArray(list)) return
          for (const s of list) {
            if (s?.sessionId) {
              Promise.resolve(stop(s.sessionId)).catch(() => {})
            }
          }
        })
        .catch(() => {})
    }
  } catch {
    // best-effort; ignored
  }

  console.info(`[GeneralSettings] engine switched: ${previousEngine} → ${engineId}`)
}

const config = computed({
  get: () => props.modelValue,
  set: (val) => {
    emit('update:modelValue', val)
    emit('change')
  }
})

onMounted(() => {
  if (appStore.projectRoot && !config.value.projectRoot) {
    config.value.projectRoot = appStore.projectRoot
  }
})

async function browseProjectRoot() {
  try {
    const result = await api.selectFolder()
    if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
      config.value.projectRoot = result.filePaths[0]
      appStore.setProjectRoot(result.filePaths[0])
      recordRecentProjectRoot(result.filePaths[0])
    }
  } catch (error) {
    console.error('Failed to browse folder:', error)
    const path = prompt('Enter project root path:', config.value.projectRoot || appStore.projectRoot || '')
    if (path) {
      config.value.projectRoot = path
      appStore.setProjectRoot(path)
      recordRecentProjectRoot(path)
    }
  }
}
</script>

<style lang="scss" scoped>

.settings-section {
  max-width: 780px;
}

/* Language Dropdown */
.lang-dropdown {
  margin-top: 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  animation: dropdownIn 0.15s ease-out;
}

@keyframes dropdownIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.lang-dropdown-item {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--text-primary);
  background: var(--bg-elevated);
  cursor: pointer;
  transition: background var(--transition-fast);
  text-align: left;
  border-bottom: 1px solid var(--border-subtle);

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--surface-soft);
  }

  &.active {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }
}

.lang-dropdown-flag {
  font-size: 20px;
  line-height: 1;
}

.lang-dropdown-name {
  flex: 1;
  font-family: var(--font-serif);
  font-weight: 600;
}

.lang-dropdown-check {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* EngineSourceSettings integration */
.s-panel-body :deep(.engine-source-settings) {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

/* Pi SDK Install Button */
.s-install-btn {
  @include reset-button;
  margin-top: 10px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: var(--accent-primary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: opacity var(--transition-fast);

  &:hover {
    opacity: 0.85;
  }

  &:active {
    opacity: 0.7;
  }
}

.s-install-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.s-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

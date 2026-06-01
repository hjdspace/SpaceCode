<template>
  <div class="settings-section">
    <div class="s-page-header">
      <h1 class="s-page-title">{{ $t('settings.general') }}</h1>
      <p class="s-page-desc">配置语言、引擎和项目根目录等基础设置</p>
    </div>

    <div class="s-card">
      <div class="s-form-group">
        <label class="s-form-label">{{ $t('settings.language') }}</label>
        <div class="s-selection-grid lang-grid">
          <button
            v-for="lang in languages"
            :key="lang.id"
            class="s-selection-card lang-card"
            :class="{ active: currentLanguage === lang.id }"
            @click="selectLanguage(lang.id)"
          >
            <span class="lang-flag">{{ lang.flag }}</span>
            <span class="lang-name">{{ lang.name }}</span>
            <span class="s-check-badge"><Check :size="14" /></span>
          </button>
        </div>
        <span class="s-form-hint">{{ $t('settings.languageDesc') }}</span>
      </div>
    </div>

    <div class="s-divider"></div>

    <div class="s-card">
      <div class="s-form-group">
        <label class="s-form-label">Agent Engine</label>
        <div class="s-selection-grid engine-grid">
          <button
            class="s-selection-card"
            :class="{ active: config.engineType === 'claude-code' }"
            @click="selectEngine('claude-code')"
          >
            <span class="s-selection-card-icon brand-icon-wrapper">
              <svg class="brand-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"/></svg>
            </span>
            <span class="s-selection-card-title">Claude Code</span>
            <span class="s-selection-card-desc">{{ claudeCodeDesc }}</span>
            <span class="s-check-badge"><Check :size="14" /></span>
          </button>
          <button
            class="s-selection-card"
            :class="{ active: config.engineType === 'pi', disabled: !piAvailable }"
            @click="selectEngine('pi')"
            :disabled="!piAvailable"
          >
            <span class="s-selection-card-icon brand-icon-wrapper">
              <svg class="brand-icon" viewBox="0 0 800 800" fill="currentColor"><path fill-rule="evenodd" d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"/><path d="M517.36 400H634.72V634.72H517.36Z"/></svg>
            </span>
            <span class="s-selection-card-title">Pi</span>
            <span class="s-selection-card-desc">{{ piDesc }}</span>
            <span class="s-check-badge"><Check :size="14" /></span>
          </button>
        </div>
        <span class="s-form-hint">Choose which agent engine to use</span>
      </div>
    </div>

    <EngineSourceSettings v-if="config.engineType === 'claude-code'" />

    <div class="s-divider"></div>

    <div class="s-card">
      <div class="s-section-header">
        <h3 class="s-section-title">{{ $t('project.settings') }}</h3>
      </div>
      <div class="s-form-group">
        <label class="s-form-label">{{ $t('project.projectRoot') }}</label>
        <div class="s-input-with-action">
          <input
            type="text"
            v-model="config.projectRoot"
            placeholder="D:\Projects\my-project"
            class="s-form-input"
          />
          <button class="s-btn-icon" @click="browseProjectRoot" :title="$t('project.selectFolder')">
            <FolderOpen :size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  Check, FolderOpen
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
    engineType: EngineType
  }
}>()

const emit = defineEmits<{
  'update:modelValue': [value: typeof props.modelValue]
  'change': []
}>()

const appStore = useAppStore()
const settingsStore = useSettingsStore()
const { t, locale } = useI18n()

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

function selectLanguage(langId: Locale) {
  currentLanguage.value = langId
}

const piAvailable = ref<boolean | null>(null)
const piChecking = ref(true)

const claudeCodeDesc = computed(() => {
  if (settingsStore.engineSource === 'installed') {
    return 'CLI installed · Use local claude binary'
  }
  return 'Bundled · Built-in engine'
})

const piDesc = computed(() => {
  if (piChecking.value) return 'Checking SDK...'
  if (piAvailable.value === false) return 'SDK not installed'
  return 'Minimalist coding agent'
})

onMounted(async () => {
  try {
    const electronAPI = (window as any).electronAPI
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

function selectEngine(engineId: EngineType) {
  if (engineId === 'pi' && piAvailable.value === false) return
  if (config.value.engineType === engineId) return

  const previousEngine = config.value.engineType
  config.value.engineType = engineId
  settingsStore.engineType = engineId
  settingsStore.saveSettings()

  // Proactively tear down live processes so the new engine can take over
  // immediately. initClaudeCodeSession will also guard against mismatched
  // engines on the next send, but doing it eagerly here frees resources and
  // prevents races where suspended processes are reused by the old engine.
  try {
    const electronAPI = (window as any).electronAPI
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
.lang-grid,
.engine-grid {
  grid-template-columns: repeat(2, 1fr);
}

.lang-card {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lang-flag {
  font-size: 24px;
  line-height: 1;
}

.lang-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.brand-icon {
  width: 22px;
  height: 22px;
}
</style>

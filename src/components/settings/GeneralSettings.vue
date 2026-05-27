<template>
  <div class="settings-section">
    <h2 class="section-title">{{ $t('settings.general') }}</h2>

    <div class="section-content">
      <!-- Language Selection -->
      <div class="form-group">
        <label class="form-label">{{ $t('settings.language') }}</label>
        <div class="language-options">
          <button
            v-for="lang in languages"
            :key="lang.id"
            class="language-card"
            :class="{ active: currentLanguage === lang.id }"
            @click="selectLanguage(lang.id)"
          >
            <span class="language-flag">{{ lang.flag }}</span>
            <span class="language-name">{{ lang.name }}</span>
            <Check v-if="currentLanguage === lang.id" class="language-check" :size="16" />
          </button>
        </div>
        <span class="form-hint">{{ $t('settings.languageDesc') }}</span>
      </div>

      <div class="divider"></div>

      <!-- Engine Selection -->
      <div class="form-group">
        <label class="form-label">Agent Engine</label>
        <div class="engine-options">
          <button
            v-for="engine in engines"
            :key="engine.id"
            class="engine-card"
            :class="{ active: config.engineType === engine.id, disabled: !engine.available }"
            @click="selectEngine(engine.id)"
            :disabled="!engine.available"
          >
            <span class="engine-name">{{ engine.name }}</span>
            <span class="engine-desc">{{ engine.desc }}</span>
            <Check v-if="config.engineType === engine.id" class="engine-check" :size="16" />
          </button>
        </div>
        <span class="form-hint">Choose which agent engine to use</span>
      </div>

      <div class="divider"></div>

      <!-- Project Settings -->
      <h3 class="subsection-title">{{ $t('project.settings') }}</h3>

      <div class="form-group">
        <label class="form-label">{{ $t('project.projectRoot') }}</label>
        <div class="input-with-action">
          <input
            type="text"
            v-model="config.projectRoot"
            placeholder="D:\Projects\my-project"
            class="form-input"
          />
          <button class="input-action-btn" @click="browseProjectRoot" :title="$t('project.selectFolder')">
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

const engines = computed(() => [
  { id: 'claude-code' as EngineType, name: 'Claude Code', desc: 'Original claude-code engine', available: true },
  { id: 'pi' as EngineType, name: 'Pi', desc: piChecking.value ? 'Checking SDK...' : (piAvailable.value === false ? 'SDK not installed' : 'pi-coding-agent engine'), available: piAvailable.value === true }
])

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
  gap: 8px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-input {
  padding: 10px 12px;
  background: var(--surface-soft);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 13px;
  transition: all 0.2s;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.1);
  }

  &::placeholder {
    color: var(--text-muted);
  }
}

.form-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.input-with-action {
  display: flex;
  gap: 8px;

  .form-input {
    flex: 1;
  }
}

.input-action-btn {
  @include reset-button;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-soft);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  color: var(--text-muted);
  transition: all 0.2s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }
}

.divider {
  height: 1px;
  background: var(--border-default);
  margin: 8px 0;
}

.language-options {
  display: flex;
  gap: 12px;
}

.language-card {
  @include reset-button;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--surface-card);
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--bg-hover);
  }

  &.active {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.05);
  }
}

.language-flag {
  font-size: 20px;
}

.language-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.language-check {
  color: var(--accent-primary);
}

.engine-options {
  display: flex;
  gap: 12px;
}

.engine-card {
  @include reset-button;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px 16px;
  background: var(--surface-card);
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  &.active {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.05);
  }

  &.disabled,
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.engine-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.engine-desc {
  font-size: 11px;
  color: var(--text-muted);
}

.engine-check {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--accent-primary);
}
</style>

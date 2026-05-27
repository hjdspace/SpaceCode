<template>
  <div class="settings-page">
    <!-- Header -->
    <div class="settings-header">
      <button class="back-btn" @click="handleBack">
        <ArrowLeft :size="16" />
        <span>{{ $t('settings.backToApp') }}</span>
      </button>
      <h1 class="settings-title">{{ $t('settings.title') }}</h1>
      <div class="header-spacer"></div>
    </div>

    <!-- Body -->
    <div class="settings-body">
      <!-- Left Navigation -->
      <nav class="settings-nav">
        <button
          v-for="item in menuItems"
          :key="item.id"
          class="nav-item"
          :class="{ active: activeTab === item.id }"
          @click="switchTab(item.id)"
        >
          <component :is="item.icon" :size="18" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <!-- Right Content -->
      <main class="settings-content">
        <div class="content-scroll">
          <KeepAlive :include="cachedTabs">
            <GeneralSettings
              v-if="activeTab === 'general'"
              v-model="settingsData"
              @change="onSettingsChange"
            />
            <ModelSettings
              v-else-if="activeTab === 'model'"
              v-model="settingsData"
              @change="onSettingsChange"
            />
            <McpSettings
              v-else-if="activeTab === 'mcp'"
              @change="onSettingsChange"
            />
            <ToolsSettings
              v-else-if="activeTab === 'tools'"
              @change="onSettingsChange"
            />
            <AppearanceSettings
              v-else-if="activeTab === 'appearance'"
              @change="onSettingsChange"
            />
            <ShortcutsSettings
              v-else-if="activeTab === 'shortcuts'"
              @change="onSettingsChange"
            />
            <TokenUsageSettings
              v-else-if="activeTab === 'token-usage'"
            />
          </KeepAlive>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, defineAsyncComponent } from 'vue'
import {
  ArrowLeft,
  Settings, Boxes, Palette, Wrench, Keyboard, Bot, BarChart3
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useSettingsStore, type AuthMethod, type OAuthAccountInfo, type EngineType } from '@/stores/settings'

// 异步加载非首屏组件，减少首屏bundle大小
const GeneralSettings = defineAsyncComponent(() => import('./GeneralSettings.vue'))
const ModelSettings = defineAsyncComponent(() => import('./ModelSettings.vue'))
const McpSettings = defineAsyncComponent(() => import('./McpSettings.vue'))
const AppearanceSettings = defineAsyncComponent(() => import('./AppearanceSettings.vue'))
const ToolsSettings = defineAsyncComponent(() => import('./ToolsSettings.vue'))
const ShortcutsSettings = defineAsyncComponent(() => import('./ShortcutsSettings.vue'))
const TokenUsageSettings = defineAsyncComponent(() => import('./TokenUsageSettings.vue'))

const appStore = useAppStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

const menuItems = computed(() => [
  { id: 'general', label: t('settings.general'), icon: Settings },
  { id: 'model', label: t('settings.modelSettings'), icon: Bot },
  { id: 'mcp', label: t('settings.mcpServers'), icon: Boxes },
  { id: 'tools', label: t('settings.tools'), icon: Wrench },
  { id: 'appearance', label: t('settings.appearance'), icon: Palette },
  { id: 'shortcuts', label: t('settings.shortcuts'), icon: Keyboard },
  { id: 'token-usage', label: 'Token 用量', icon: BarChart3 }
])

const activeTab = ref('general')

const settingsData = ref({
  authMethod: 'openai_compatible' as AuthMethod,
  anthropic: { baseUrl: '', apiKey: '' },
  openai: { baseUrl: '', apiKey: '' },
  gemini: { baseUrl: '', apiKey: '' },
  haikuModel: '',
  sonnetModel: '',
  opusModel: '',
  projectRoot: '',
  oauthAccount: null as OAuthAccountInfo | null,
  engineType: 'claude-code' as EngineType
})

// 缓存已访问的标签页，避免重复渲染
const visitedTabs = ref<Set<string>>(new Set(['general']))
const cachedTabs = computed(() => Array.from(visitedTabs.value))

// 切换标签页时记录访问历史
function switchTab(tabId: string) {
  activeTab.value = tabId
  visitedTabs.value.add(tabId)
}

// Flag to prevent watch from triggering during load
let isLoadingSettings = false

// Auto-save on any change
watch(settingsData, () => {
  if (!isLoadingSettings) {
    saveSettings()
  }
}, { deep: true })

function onSettingsChange() {
  saveSettings()
}

// Load settings when mounted
loadSettings()

function loadSettings() {
  isLoadingSettings = true

  settingsData.value = {
    authMethod: settingsStore.authMethod,
    anthropic: { ...settingsStore.anthropicConfig },
    openai: { ...settingsStore.openaiConfig },
    gemini: { ...settingsStore.geminiConfig },
    haikuModel: settingsStore.getHaikuModel() || '',
    sonnetModel: settingsStore.getSonnetModel() || '',
    opusModel: settingsStore.getOpusModel() || '',
    projectRoot: settingsStore.projectRoot || '',
    oauthAccount: settingsStore.oauthAccount,
    engineType: settingsStore.engineType
  }

  requestAnimationFrame(() => {
    isLoadingSettings = false
  })
}

function saveSettings() {
  const payload = {
    authMethod: settingsData.value.authMethod,
    anthropicConfig: {
      baseUrl: settingsData.value.anthropic.baseUrl,
      apiKey: settingsData.value.anthropic.apiKey,
      haikuModel: settingsData.value.haikuModel,
      sonnetModel: settingsData.value.sonnetModel,
      opusModel: settingsData.value.opusModel
    },
    openaiConfig: {
      baseUrl: settingsData.value.openai.baseUrl,
      apiKey: settingsData.value.openai.apiKey,
      haikuModel: settingsData.value.haikuModel,
      sonnetModel: settingsData.value.sonnetModel,
      opusModel: settingsData.value.opusModel
    },
    geminiConfig: {
      baseUrl: settingsData.value.gemini.baseUrl,
      apiKey: settingsData.value.gemini.apiKey,
      haikuModel: settingsData.value.haikuModel,
      sonnetModel: settingsData.value.sonnetModel,
      opusModel: settingsData.value.opusModel
    },
    oauthAccount: settingsData.value.oauthAccount,
    projectRoot: settingsData.value.projectRoot,
    engineType: settingsData.value.engineType
  }

  settingsStore.updateFromSettingsPanel(payload)
}

function handleBack() {
  appStore.showSettings = false
}
</script>

<style lang="scss" scoped>
.settings-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  overflow: hidden;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-primary);
  flex-shrink: 0;
}

.back-btn {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.settings-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.header-spacer {
  width: 80px;
}

.settings-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.settings-nav {
  width: 220px;
  background: var(--surface-soft);
  border-right: 1px solid var(--border-default);
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  flex-shrink: 0;
}

.nav-item {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s;
  text-align: left;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    background: rgba(var(--accent-primary-rgb), 0.1);
    color: var(--accent-primary);
  }
}

.settings-content {
  flex: 1;
  overflow: hidden;
  background: var(--bg-primary);
}

.content-scroll {
  height: 100%;
  overflow-y: auto;
  padding: 32px 40px;
  @include scrollbar;
}

// Responsive adjustments
@media (max-width: 900px) {
  .settings-nav {
    width: 180px;
  }

  .content-scroll {
    padding: 24px;
  }
}

@media (max-width: 640px) {
  .settings-body {
    flex-direction: column;
  }

  .settings-nav {
    width: 100%;
    flex-direction: row;
    padding: 8px;
    border-right: none;
    border-bottom: 1px solid var(--border-default);
    overflow-x: auto;

    .nav-item {
      white-space: nowrap;

      span {
        display: none;
      }
    }
  }
}
</style>
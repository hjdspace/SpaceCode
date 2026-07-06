<template>
  <div class="settings-page">
    <div class="settings-body">
      <aside class="settings-sidebar">
        <div class="sidebar-header">
          <div class="sidebar-logo">
            <img class="logo-icon" :src="appIcon" alt="SpaceCode" />
            <span class="logo-text">SpaceCode</span>
          </div>
        </div>

        <nav class="sidebar-nav">
          <div class="nav-group">
            <div class="nav-group-title">{{ $t('settings.title') }}</div>
            <button
              v-for="item in settingMenuItems"
              :key="item.id"
              class="nav-item"
              :class="{ active: activeTab === item.id }"
              @click="switchTab(item.id)"
            >
              <component :is="item.icon" :size="18" />
              <span>{{ item.label }}</span>
            </button>
          </div>

          <div class="nav-group">
            <div class="nav-group-title">{{ $t('appearanceSettings.title') }}</div>
            <button
              v-for="item in personalMenuItems"
              :key="item.id"
              class="nav-item"
              :class="{ active: activeTab === item.id }"
              @click="switchTab(item.id)"
            >
              <component :is="item.icon" :size="18" />
              <span>{{ item.label }}</span>
            </button>
          </div>
        </nav>

        <div class="sidebar-footer">
          <button class="back-btn" @click="handleBack">
            <ArrowLeft :size="16" />
            <span>{{ $t('settings.backToApp') }}</span>
          </button>
        </div>
      </aside>

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
            <HookSettings
              v-else-if="activeTab === 'hooks'"
            />
            <ComputerUseSettings
              v-else-if="activeTab === 'computer-use'"
            />
            <BrowserUseSettings
              v-else-if="activeTab === 'browser-use'"
            />
            <AboutSettings
              v-else-if="activeTab === 'about'"
            />
          </KeepAlive>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import {
  ArrowLeft,
  Settings, Boxes, Palette, Wrench, Keyboard, Bot, BarChart3, Zap, Monitor, Globe, Info
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useSettingsStore, type AuthSettings, type AuthMethod, type OAuthAccountInfo, type EngineType } from '@/stores/settings'
import appIcon from '@/assets/app-icon.svg'

const GeneralSettings = defineAsyncComponent(() => import('./GeneralSettings.vue'))
const ModelSettings = defineAsyncComponent(() => import('./ModelSettings.vue'))
const McpSettings = defineAsyncComponent(() => import('./McpSettings.vue'))
const AppearanceSettings = defineAsyncComponent(() => import('./AppearanceSettings.vue'))
const ToolsSettings = defineAsyncComponent(() => import('./ToolsSettings.vue'))
const ShortcutsSettings = defineAsyncComponent(() => import('./ShortcutsSettings.vue'))
const TokenUsageSettings = defineAsyncComponent(() => import('./TokenUsageSettings.vue'))
const HookSettings = defineAsyncComponent(() => import('./HookSettings.vue'))
const ComputerUseSettings = defineAsyncComponent(() => import('./ComputerUseSettings.vue'))
const BrowserUseSettings = defineAsyncComponent(() => import('./BrowserUseSettings.vue'))
const AboutSettings = defineAsyncComponent(() => import('./AboutSettings.vue'))

const appStore = useAppStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

const settingMenuItems = computed(() => [
  { id: 'general', label: t('settings.general'), icon: Settings },
  { id: 'model', label: t('settings.modelSettings'), icon: Bot },
  { id: 'mcp', label: t('settings.mcpServers'), icon: Boxes },
  { id: 'tools', label: t('settings.tools'), icon: Wrench },
  { id: 'computer-use', label: t('settings.computerUse'), icon: Monitor },
  { id: 'browser-use', label: t('settings.browserUse'), icon: Globe },
])

const personalMenuItems = computed(() => [
  { id: 'appearance', label: t('settings.appearance'), icon: Palette },
  { id: 'shortcuts', label: t('settings.shortcuts'), icon: Keyboard },
  { id: 'hooks', label: t('settings.hooks'), icon: Zap },
  { id: 'token-usage', label: 'Token 用量', icon: BarChart3 },
  { id: 'about', label: t('aboutSettings.title'), icon: Info },
])

const activeTab = ref('general')

const settingsData = ref<AuthSettings>({
  authMethod: 'openai_compatible' as AuthMethod,
  anthropicConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
  openaiConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
  geminiConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
  projectRoot: '',
  oauthAccount: null as OAuthAccountInfo | null,
  engineType: 'claude-code' as EngineType
})

const visitedTabs = ref<Set<string>>(new Set(['general']))
const cachedTabs = computed(() => Array.from(visitedTabs.value))

function switchTab(tabId: string) {
  activeTab.value = tabId
  visitedTabs.value.add(tabId)
}

// 接受来自外部（如斜杠命令 /browser-use）的标签页导航事件
const navigateHandler = (event: CustomEvent) => {
  const tab = event.detail?.tab
  if (tab && settingMenuItems.value.find(m => m.id === tab)) {
    switchTab(tab)
  }
}

onMounted(() => {
  window.addEventListener('settings-navigate', navigateHandler as EventListener)
})

onUnmounted(() => {
  window.removeEventListener('settings-navigate', navigateHandler as EventListener)
})

let isLoadingSettings = false

watch(settingsData, () => {
  if (!isLoadingSettings) {
    saveSettings()
  }
}, { deep: true })

function onSettingsChange() {
  saveSettings()
}

loadSettings()

function loadSettings() {
  isLoadingSettings = true

  // 将当前激活 provider 的模型同步到所有 provider config，保持 UI「共享模型」行为
  const haikuModel = settingsStore.getHaikuModel() || ''
  const sonnetModel = settingsStore.getSonnetModel() || ''
  const opusModel = settingsStore.getOpusModel() || ''

  settingsData.value = {
    authMethod: settingsStore.authMethod,
    anthropicConfig: { ...settingsStore.anthropicConfig, haikuModel, sonnetModel, opusModel },
    openaiConfig: { ...settingsStore.openaiConfig, haikuModel, sonnetModel, opusModel },
    geminiConfig: { ...settingsStore.geminiConfig, haikuModel, sonnetModel, opusModel },
    projectRoot: settingsStore.projectRoot || '',
    oauthAccount: settingsStore.oauthAccount,
    engineType: settingsStore.engineType
  }

  requestAnimationFrame(() => {
    isLoadingSettings = false
  })
}

function saveSettings() {
  settingsStore.updateFromSettingsPanel(settingsData.value)
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
  background: var(--bg-secondary);
  overflow: hidden;
}

.settings-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.settings-sidebar {
  width: 260px;
  background: var(--bg-elevated);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  padding: 24px 24px 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.logo-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  flex-shrink: 0;
  object-fit: contain;
}

.logo-text {
  font-family: var(--font-display);
}

.sidebar-nav {
  flex: 1;
  padding: 16px 12px;
  overflow-y: auto;
  @include scrollbar-thin;
}

.nav-group {
  margin-bottom: 8px;
}

.nav-group-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  padding: 12px 12px 8px;
}

.nav-item {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  margin-bottom: 2px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-weight: 500;
  font-size: 13.5px;
  text-align: left;
  width: 100%;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  &.active {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }

  svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--border-subtle);
}

.back-btn {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  width: 100%;
  text-align: left;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }
}

.settings-content {
  flex: 1;
  overflow: hidden;
  background: var(--bg-secondary);
}

.content-scroll {
  height: 100%;
  overflow-y: auto;
  padding: 40px 48px;
  @include scrollbar;
}

@media (max-width: 1024px) {
  .settings-sidebar {
    width: 220px;
  }

  .content-scroll {
    padding: 32px 36px;
  }
}

@media (max-width: 640px) {
  .settings-body {
    flex-direction: column;
  }

  .settings-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-subtle);
  }

  .sidebar-header {
    display: none;
  }

  .sidebar-nav {
    flex-direction: row;
    padding: 8px;
    overflow-x: auto;

    .nav-group {
      display: flex;
      gap: 4px;
      margin-bottom: 0;
    }

    .nav-group-title {
      display: none;
    }
  }

  .nav-item {
    white-space: nowrap;

    span {
      display: none;
    }
  }

  .sidebar-footer {
    display: none;
  }

  .content-scroll {
    padding: 24px 20px;
  }
}
</style>

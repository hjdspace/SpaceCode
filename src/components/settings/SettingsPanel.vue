<template>
  <div class="settings-page">
    <div class="settings-body">
      <aside class="settings-sidebar">
        <div class="sidebar-header">
          <div class="sidebar-logo">
            <div class="logo-icon">S</div>
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
  Settings, Boxes, Palette, Wrench, Keyboard, Bot, BarChart3, Zap, Monitor
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useSettingsStore, type AuthMethod, type OAuthAccountInfo, type EngineType } from '@/stores/settings'

const GeneralSettings = defineAsyncComponent(() => import('./GeneralSettings.vue'))
const ModelSettings = defineAsyncComponent(() => import('./ModelSettings.vue'))
const McpSettings = defineAsyncComponent(() => import('./McpSettings.vue'))
const AppearanceSettings = defineAsyncComponent(() => import('./AppearanceSettings.vue'))
const ToolsSettings = defineAsyncComponent(() => import('./ToolsSettings.vue'))
const ShortcutsSettings = defineAsyncComponent(() => import('./ShortcutsSettings.vue'))
const TokenUsageSettings = defineAsyncComponent(() => import('./TokenUsageSettings.vue'))
const HookSettings = defineAsyncComponent(() => import('./HookSettings.vue'))
const ComputerUseSettings = defineAsyncComponent(() => import('./ComputerUseSettings.vue'))

const appStore = useAppStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

const settingMenuItems = computed(() => [
  { id: 'general', label: t('settings.general'), icon: Settings },
  { id: 'model', label: t('settings.modelSettings'), icon: Bot },
  { id: 'mcp', label: t('settings.mcpServers'), icon: Boxes },
  { id: 'tools', label: t('settings.tools'), icon: Wrench },
  { id: 'computer-use', label: t('settings.computerUse'), icon: Monitor },
])

const personalMenuItems = computed(() => [
  { id: 'appearance', label: t('settings.appearance'), icon: Palette },
  { id: 'shortcuts', label: t('settings.shortcuts'), icon: Keyboard },
  { id: 'hooks', label: t('settings.hooks'), icon: Zap },
  { id: 'token-usage', label: 'Token 用量', icon: BarChart3 },
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

const visitedTabs = ref<Set<string>>(new Set(['general']))
const cachedTabs = computed(() => Array.from(visitedTabs.value))

function switchTab(tabId: string) {
  activeTab.value = tabId
  visitedTabs.value.add(tabId)
}

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
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-tertiary));
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 700;
  font-size: 16px;
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

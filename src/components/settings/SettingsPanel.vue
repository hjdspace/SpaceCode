<template>
  <Teleport to="body">
    <Transition name="settings-overlay">
      <div v-if="modelValue" class="settings-overlay" @click.self="handleClose">
        <Transition name="settings-container">
          <div v-if="modelValue" class="settings-container">
            <!-- Header -->
            <div class="settings-header">
              <button class="back-btn" @click="handleClose">
                <ArrowLeft :size="16" />
                <span>{{ $t('settings.backToApp') }}</span>
              </button>
              <h1 class="settings-title">{{ $t('settings.title') }}</h1>
              <button class="close-btn" @click="handleClose">
                <X :size="20" />
              </button>
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
                  <!-- 使用KeepAlive缓存已访问的标签页 -->
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
                  </KeepAlive>
                </div>
              </main>
            </div>

            <!-- Footer -->
            <div class="settings-footer">
              <div class="footer-status">
                <span v-if="hasChanges" class="unsaved-indicator">{{ $t('settings.unsavedChanges') }}</span>
              </div>
              <div class="footer-actions">
                <button class="btn btn-secondary" @click="handleClose">{{ $t('common.cancel') }}</button>
                <button class="btn btn-primary" @click="handleSave" :disabled="!hasChanges">
                  <Save :size="16" v-if="!saving" />
                  <Loader2 :size="16" class="spin" v-else />
                  {{ saving ? $t('settings.saving') : $t('settings.saveChanges') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, reactive, defineAsyncComponent } from 'vue'
import {
  ArrowLeft, X, Save, Loader2,
  Settings, Boxes, Palette, Wrench, Keyboard, Bot
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useSettingsStore, type AuthMethod, type OAuthAccountInfo, type EngineType } from '@/stores/settings'

// 异步加载非首屏组件，减少首屏bundle大小
const GeneralSettings = defineAsyncComponent(() => import('./GeneralSettings.vue'))
const ModelSettings = defineAsyncComponent(() => import('./ModelSettings.vue'))
const McpSettings = defineAsyncComponent(() => import('./McpSettings.vue'))
const AppearanceSettings = defineAsyncComponent(() => import('./AppearanceSettings.vue'))
const ToolsSettings = defineAsyncComponent(() => import('./ToolsSettings.vue'))
const ShortcutsSettings = defineAsyncComponent(() => import('./ShortcutsSettings.vue'))

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: []
}>()

const settingsStore = useSettingsStore()
const { t } = useI18n()

const menuItems = computed(() => [
  { id: 'general', label: t('settings.general'), icon: Settings },
  { id: 'model', label: t('settings.modelSettings'), icon: Bot },
  { id: 'mcp', label: t('settings.mcpServers'), icon: Boxes },
  { id: 'tools', label: t('settings.tools'), icon: Wrench },
  { id: 'appearance', label: t('settings.appearance'), icon: Palette },
  { id: 'shortcuts', label: t('settings.shortcuts'), icon: Keyboard }
])

const activeTab = ref('general')
const saving = ref(false)
const hasChanges = ref(false)

// 使用ref创建响应式对象，确保深层变更能被检测到
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

// 使用深比较监听所有嵌套属性变更
watch(settingsData, () => {
  if (!isLoadingSettings) {
    hasChanges.value = true
  }
}, { deep: true })

// Handle changes from child components (Appearance, Shortcuts, etc.)
function onSettingsChange() {
  hasChanges.value = true
}

// Load settings when panel opens
watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    loadSettings()
  } else {
    // 关闭时重置状态
    activeTab.value = 'general'
    visitedTabs.value.clear()
    visitedTabs.value.add('general')
  }
})

function loadSettings() {
  isLoadingSettings = true
  
  // 批量更新减少渲染次数
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
  
  // Reset hasChanges after loading, and re-enable the watch
  hasChanges.value = false
  
  // Use requestAnimationFrame确保DOM更新完成后再重置标志
  requestAnimationFrame(() => {
    isLoadingSettings = false
  })
}

function handleClose() {
  if (hasChanges.value) {
    const confirmed = confirm(t('settings.confirmClose'))
    if (!confirmed) return
  }
  emit('update:modelValue', false)
}

async function handleSave() {
  saving.value = true

  // Build settings payload with full ProviderConfig
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

  // Update store
  settingsStore.updateFromSettingsPanel(payload)

  // Simulate save delay
  await new Promise(r => setTimeout(r, 500))

  saving.value = false
  hasChanges.value = false
  emit('save')
  emit('update:modelValue', false)
}
</script>

<style lang="scss">
// Transition animations
.settings-overlay-enter-active,
.settings-overlay-leave-active {
  transition: opacity 0.3s ease;
}

.settings-overlay-enter-from,
.settings-overlay-leave-to {
  opacity: 0;
}

.settings-container-enter-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.settings-container-leave-active {
  transition: all 0.2s ease-in;
}

.settings-container-enter-from {
  opacity: 0;
  transform: scale(0.95) translateY(20px);
}

.settings-container-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
</style>

<style lang="scss" scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 40px;
}

.settings-container {
  width: 100%;
  max-width: 1100px;
  height: 85vh;
  max-height: 800px;
  background: var(--bg-primary);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.back-btn {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
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

.close-btn {
  @include reset-button;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--text-muted);
  transition: all 0.2s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.settings-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.settings-nav {
  width: 220px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
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

.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.footer-status {
  display: flex;
  align-items: center;
}

.unsaved-indicator {
  font-size: 13px;
  color: var(--accent-primary);
  display: flex;
  align-items: center;
  gap: 6px;

  &::before {
    content: '';
    width: 6px;
    height: 6px;
    background: var(--accent-primary);
    border-radius: 50%;
  }
}

.footer-actions {
  display: flex;
  gap: 12px;
}

.btn {
  @include reset-button;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover:not(:disabled) {
      background: var(--accent-primary-hover);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(var(--accent-primary-rgb), 0.3);
    }

    &:active:not(:disabled) {
      transform: translateY(0);
    }
  }

  &.btn-secondary {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);

    &:hover {
      background: var(--bg-hover);
      border-color: var(--accent-primary);
    }
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// Responsive adjustments
@media (max-width: 900px) {
  .settings-container {
    max-width: 100%;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
  }

  .settings-overlay {
    padding: 0;
  }

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
    border-bottom: 1px solid var(--border-color);
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

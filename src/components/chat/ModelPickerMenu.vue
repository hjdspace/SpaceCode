<template>
  <div class="model-selector" ref="modelSelectorRef">
    <button
      class="toolbar-btn model-btn"
      @click="toggleModelDropdown"
      :class="{ 'is-loading': isLoadingModels, 'has-error': modelLoadError }"
    >
      <Loader2 v-if="isLoadingModels" :size="14" class="loading-icon spin" />
      <span class="model-name">{{ selectedModelLabel }}</span>
      <span v-if="selectedMode" class="model-mode-pill">{{ t('chat.effort.' + selectedMode) }}</span>
      <ChevronDown :size="14" class="dropdown-icon" :class="{ open: showModelDropdown }" />
    </button>
    <!-- 模型下拉菜单 -->
    <Transition name="dropdown">
      <div v-if="showModelDropdown" ref="mainDropdownRef" class="model-dropdown" v-click-outside="closeModelDropdown">
        <!-- 推理深度选择区（合并到模型下拉） -->
        <div class="dropdown-section">
          <div class="dropdown-section-title">{{ t('chat.reasoning') }}</div>
          <div class="dropdown-list reasoning-list">
            <button
              v-for="mode in availableModes"
              :key="mode"
              class="dropdown-item"
              :class="{ active: selectedMode === mode }"
              @click="selectMode(mode)"
            >
              <span class="item-name">{{ t('chat.effort.' + mode) }}</span>
              <Check v-if="selectedMode === mode" :size="14" class="check-icon" />
            </button>
            <p v-if="availableModes.length === 0" class="reasoning-unavailable">{{ t('chat.effort.unavailable') }}</p>
          </div>
        </div>
        <div class="dropdown-section-divider"></div>
        <!-- 当前选中模型（点击展开二级菜单） -->
        <div class="dropdown-section">
          <button
            ref="modelTriggerRowRef"
            class="dropdown-item dropdown-item-trigger"
            :class="{ 'submenu-open': showModelSubmenu }"
            @click="toggleModelSubmenu"
            @mouseenter="showModelSubmenu = true"
            @mouseleave="onCurrentModelRowLeave"
          >
            <span class="item-name">{{ selectedModelLabel || t('model.selectModel') }}</span>
            <ChevronRight :size="14" class="check-icon" />
          </button>
        </div>
      </div>
    </Transition>
    <!-- 模型二级子菜单（Teleport 到 body，避免 container-type/overflow/z-index 问题） -->
    <Teleport to="body">
    <Transition name="dropdown">
      <div
        v-if="showModelSubmenu"
        ref="modelSubmenuRef"
        class="model-submenu"
        :style="modelSubmenuStyle"
        @mouseenter="onModelSubmenuEnter"
        @mouseleave="onModelSubmenuLeave"
        v-click-outside="closeModelSubmenu"
      >
        <div class="dropdown-header">
          <span>{{ t('auth.model') }}</span>
          <button
            v-if="canRefreshModels"
            class="refresh-btn"
            @click="refreshModels"
            :disabled="isLoadingModels"
            :title="t('chatInput.refreshModels')"
          >
            <RefreshCw :size="12" :class="{ spin: isLoadingModels }" />
          </button>
        </div>
        <div class="dropdown-list" ref="modelListRef">
          <div v-if="!hasConfiguredModels && availableModels.length === 0" class="dropdown-empty dropdown-config-prompt">
            <Settings :size="16" />
            <span>{{ t('chatInput.noModelsConfigured') }}</span>
            <button class="config-link-btn" @click="openSettingsModels">
              {{ t('chatInput.goToSettings') }}
            </button>
          </div>
          <div v-else-if="isLoadingModels && availableModels.length === 0" class="dropdown-loading">
            <Loader2 :size="16" class="spin" />
            <span>{{ t('common.loading') }}</span>
          </div>
          <div v-else-if="modelLoadError && availableModels.length === 0" class="dropdown-error">
            <AlertCircle :size="16" />
            <span>{{ modelLoadError }}</span>
            <button v-if="canRefreshModels" class="retry-btn" @click="refreshModels">
              {{ t('chatInput.retry') }}
            </button>
          </div>
          <button
            v-for="model in availableModels"
            :key="model.value"
            class="dropdown-item"
            :class="{ active: selectedModel === model.value, highlighted: highlightedModel === model.value }"
            @click="selectModel(model.value)"
            @mouseenter="highlightedModel = model.value"
          >
            <span class="item-name">{{ model.label }}</span>
            <Check v-if="selectedModel === model.value" :size="14" class="check-icon" />
          </button>
        </div>
      </div>
    </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * 模型选择器：触发按钮 + 推理深度主下拉 + 模型二级子菜单。
 *
 * 接口只有一个 prop —— useModelSelector 的实例。状态与动作本来就住在那个
 * composable 里，这个组件补的是它的外部接口一直管不到的部分：开合、键盘导航、
 * 子菜单的视口定位。
 */
import { computed, nextTick, onMounted, onUnmounted } from 'vue'
import {
  AlertCircle, Check, ChevronDown, ChevronRight, Loader2, RefreshCw,
  Settings,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { vClickOutside } from '@/components/common/vClickOutside'
import type { useModelSelector } from '@/composables/useModelSelector'

type ModelSelector = ReturnType<typeof useModelSelector>

const props = defineProps<{ selector: ModelSelector }>()

const {
  selectedModel, selectedMode, showModelDropdown, showModelSubmenu,
  highlightedModel, isLoadingModels, modelLoadError,
  modelSelectorRef, modelListRef, modelSubmenuRef,
  mainDropdownRef, modelTriggerRowRef,
  availableModes, hasConfiguredModels, availableModels, canRefreshModels, selectedModelLabel,
  selectModel, selectMode, closeModelDropdown, toggleModelDropdown,
  toggleModelSubmenu, onCurrentModelRowLeave, onModelSubmenuEnter,
  onModelSubmenuLeave, closeModelSubmenu, refreshModels, handleModelKeydown,
} = props.selector

const { t } = useI18n()
const appStore = useAppStore()

const MODEL_SUBMENU_WIDTH = 220 // min-width of .model-submenu
const MODEL_SUBMENU_GAP = 4

// 子菜单 Teleport 到 body，position: fixed 相对视口，getBoundingClientRect()
// 可以直接用。读 showModelSubmenu 是为了让每次展开都拿到新的几何值。
const modelSubmenuStyle = computed<Record<string, string>>(() => {
  if (!showModelSubmenu.value) return {}

  const mainDropdown = mainDropdownRef.value
  const triggerRow = modelTriggerRowRef.value
  const style: Record<string, string> = {}
  if (!mainDropdown || !triggerRow) return style

  const mainDropdownRect = mainDropdown.getBoundingClientRect()
  const triggerRowRect = triggerRow.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  style.position = 'fixed'
  style.bottom = `${viewportHeight - triggerRowRect.bottom}px`

  // 右侧空间不足（例如右边环境面板展开时）翻到左边，否则贴着主菜单右侧弹出。
  const spaceRight = viewportWidth - mainDropdownRect.right - MODEL_SUBMENU_GAP
  if (spaceRight >= MODEL_SUBMENU_WIDTH) {
    style.left = `${mainDropdownRect.right + MODEL_SUBMENU_GAP}px`
  } else {
    style.left = `${Math.max(MODEL_SUBMENU_GAP, mainDropdownRect.left - MODEL_SUBMENU_GAP - MODEL_SUBMENU_WIDTH)}px`
  }

  return style
})

/** Open settings panel and navigate to the Model tab */
function openSettingsModels() {
  appStore.toggleSettings()
  nextTick(() => {
    window.dispatchEvent(new CustomEvent('settings-navigate', { detail: { tab: 'model' } }))
  })
}

onMounted(() => document.addEventListener('keydown', handleModelKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleModelKeydown))
</script>

<style lang="scss" scoped>
@use "@/styles/composer-toolbar" as *;

.model-selector {
  position: relative;
  min-width: 0;
}

.model-btn {
  background: transparent;
  min-width: 0;

  .model-name {
    font-weight: 500;
    max-width: 120px;
    @include truncate;
  }

  .model-mode-pill {
    flex-shrink: 0;
    padding: 2px 8px;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-muted);
    background: var(--bg-tertiary, rgba(0, 0, 0, 0.04));
    border-radius: var(--radius-sm);
    line-height: var(--leading-normal);
  }

  .dropdown-icon {
    transition: transform 0.2s ease;

    &.open {
      transform: rotate(180deg);
    }
  }

  &.is-loading {
    .model-name {
      opacity: 0.7;
    }
  }

  &.has-error {
    color: var(--error-color, #dc2626);
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// 下拉菜单通用样式
.model-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 8px;
  min-width: 240px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  z-index: 100;
  overflow: hidden;
}

// 模型二级子菜单（Teleport 到 body，fixed 定位，自适应左右弹出）
.model-submenu {
  min-width: 220px;
  max-height: 360px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  // 被 Teleport 到 body，只能靠视口层级：必须盖过弹窗 overlay（1000），
  // 又留在确认/提示对话框（10000）之下 —— 与其余 teleported 菜单同为 9999
  z-index: 9999;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

// 触发二级子菜单的当前模型行
.dropdown-item-trigger {
  &.submenu-open {
    background: var(--surface-hover);
  }
}

.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
  font-size: var(--text-2xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--surface-border);
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background: transparent;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.dropdown-list {
  max-height: 280px;
  overflow-y: auto;
  @include scrollbar-overlay;
  padding: 4px;
}

.reasoning-list {
  max-height: none;
}

.reasoning-unavailable {
  margin: 0;
  padding: 4px 12px 6px;
  font-size: var(--text-2xs);
  color: var(--text-muted);
}

.dropdown-section {
  padding: 4px 4px 6px;
}

.dropdown-section-title {
  padding: 6px 12px 4px;
  font-size: var(--text-2xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}

.dropdown-section-divider {
  height: 1px;
  background: var(--surface-border);
  margin: 0;
}

.dropdown-loading,
.dropdown-error,
.dropdown-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  color: var(--text-muted);
  font-size: var(--text-md);
  text-align: center;
}

.dropdown-config-prompt {
  gap: 10px;
}

.config-link-btn {
  padding: 6px 16px;
  background: var(--accent-primary);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    opacity: 0.9;
  }
}

.dropdown-error {
  color: var(--error-color, #dc2626);
}

.retry-btn {
  padding: 6px 12px;
  background: var(--accent-primary);
  color: white;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 500;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--accent-primary-hover);
  }
}

.dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: var(--text-md);
  color: var(--text-primary);
  background: transparent;
  transition: all var(--transition-fast);
  text-align: left;

  &:hover,
  &.highlighted {
    background: var(--surface-hover);
  }

  &.active {
    background: rgba(var(--accent-primary-rgb), 0.1);
  }

  .item-name {
    @include truncate;
    flex: 1;
  }

  .check-icon {
    color: var(--accent-primary);
    flex-shrink: 0;
    margin-left: 8px;
  }
}

// 过渡动画
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

/* 窄面板下模型选择器自适应：缩小模型名、隐藏推理模式 pill */
@container (max-width: 520px) {
  .model-btn .model-name {
    max-width: 70px;
  }
  .model-btn .model-mode-pill {
    display: none;
  }
}
</style>

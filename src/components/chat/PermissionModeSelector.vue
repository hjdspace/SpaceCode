<template>
  <div class="permission-mode-selector" ref="selectorRef">
    <button 
      class="mode-trigger" 
      @click="toggleDropdown"
      :title="currentModeLabel"
      :class="{ active: isOpen }"
    >
      <Shield :size="16" />
      <span class="mode-text">{{ currentModeLabel }}</span>
      <ChevronDown :size="14" :class="{ 'rotate': isOpen }" />
    </button>
    
    <Transition name="dropdown">
      <div 
        v-if="isOpen" 
        class="mode-dropdown"
        v-click-outside="closeDropdown"
      >
        <div class="dropdown-header">{{ t('permission.modeSelector.title') }}</div>
        <div class="dropdown-list">
          <button 
            v-for="mode in modes" 
            :key="mode.value"
            class="mode-option"
            :class="[ 
              { active: currentMode === mode.value }, 
              `mode-${mode.value}` 
            ]"
            @click="selectMode(mode.value)"
          >
            <component :is="mode.icon" :size="18" />
            <div class="mode-info">
              <span class="mode-name">{{ mode.label }}</span>
              <span class="mode-desc">{{ mode.description }}</span>
            </div>
            <Check v-if="currentMode === mode.value" :size="16" class="check-icon" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Shield, ChevronDown, Check, Eye, Edit3, Zap } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'

const { t } = useI18n()
const chatStore = useChatStore()

const isOpen = ref(false)
const selectorRef = ref<HTMLElement>()

type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

const modes = [
  {
    value: 'default' as PermissionMode,
    label: t('permission.modeSelector.default'),
    description: t('permission.modeSelector.defaultDesc'),
    icon: Shield,
  },
  {
    value: 'plan' as PermissionMode,
    label: t('permission.modeSelector.plan'),
    description: t('permission.modeSelector.planDesc'),
    icon: Eye,
  },
  {
    value: 'acceptEdits' as PermissionMode,
    label: t('permission.modeSelector.acceptEdits'),
    description: t('permission.modeSelector.acceptEditsDesc'),
    icon: Edit3,
  },
  {
    value: 'bypassPermissions' as PermissionMode,
    label: t('permission.modeSelector.bypassPermissions'),
    description: t('permission.modeSelector.bypassPermissionsDesc'),
    icon: Zap,
  },
]

const currentMode = computed(() => chatStore.currentPermissionMode)
const currentModeLabel = computed(() => 
  modes.find(m => m.value === currentMode.value)?.label || t('permission.modeSelector.default')
)

async function selectMode(mode: PermissionMode) {
  if (mode === currentMode.value) {
    isOpen.value = false
    return
  }
  
  try {
    await chatStore.setPermissionMode(mode)
    isOpen.value = false
  } catch (error) {
    console.error('Failed to set permission mode:', error)
  }
}

function toggleDropdown() {
  isOpen.value = !isOpen.value
}

function closeDropdown() {
  isOpen.value = false
}
</script>

<style scoped>
.permission-mode-selector {
  position: relative;
  display: inline-flex;
}

.mode-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.mode-trigger:hover {
  background: var(--surface-glass-hover);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.mode-trigger.active {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
}

.mode-text {
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rotate {
  transform: rotate(180deg);
}

/* 下拉菜单样式 */
.mode-dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 280px;
  background: var(--surface-primary);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}

.dropdown-header {
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--surface-border);
}

.dropdown-list {
  padding: 8px;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.mode-option:hover {
  background: var(--surface-glass-hover);
}

.mode-option.active {
  background: rgba(59, 130, 246, 0.1);
}

.mode-option .mode-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.mode-option.active .mode-icon {
  color: var(--accent-primary);
}

.mode-info {
  flex: 1;
  min-width: 0;
}

.mode-name {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
}

.mode-desc {
  display: block;
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
  line-height: 1.3;
}

.check-icon {
  flex-shrink: 0;
  color: var(--accent-primary);
}

/* 特殊模式样式 */
.mode-bypassPermissions .mode-name {
  color: #f59e0b;
}

/* 动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>

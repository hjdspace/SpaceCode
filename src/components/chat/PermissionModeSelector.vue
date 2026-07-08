<template>
  <div class="permission-mode-selector" ref="selectorRef" @focusout="handleFocusOut">
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Shield, ChevronDown, Check, Eye, Edit3, Zap } from 'lucide-vue-next'
import { usePermissionPolicyStore } from '@/stores/chat'

const { t } = useI18n()
const policyStore = usePermissionPolicyStore()

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

const currentMode = computed(() => policyStore.currentPermissionMode)
const currentModeLabel = computed(() => 
  modes.find(m => m.value === currentMode.value)?.label || t('permission.modeSelector.default')
)

async function selectMode(mode: PermissionMode) {
  if (mode === currentMode.value) {
    isOpen.value = false
    return
  }
  
  await policyStore.setPermissionMode(mode)
  isOpen.value = false
}

function toggleDropdown() {
  isOpen.value = !isOpen.value
}

function closeDropdown() {
  isOpen.value = false
}

function handleFocusOut(e: FocusEvent) {
  if (selectorRef.value && !selectorRef.value.contains(e.relatedTarget as Node)) {
    closeDropdown()
  }
}

function handleClickOutside(e: MouseEvent) {
  if (selectorRef.value && !selectorRef.value.contains(e.target as Node)) {
    closeDropdown()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
})
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
  background: var(--surface-hover);
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

.mode-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 8px;
  min-width: 280px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  z-index: 100;
  overflow: hidden;
}

.dropdown-header {
  display: flex;
  align-items: center;
  padding: 12px 16px 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
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
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
  color: var(--text-primary);
  font-size: 13px;
}

.mode-option:hover {
  background: var(--surface-hover);
}

.mode-option.active {
  background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.1);
}

.mode-option .mode-icon {
  flex-shrink: 0;
  color: var(--text-muted);
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
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
}

.mode-desc {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
  line-height: 1.3;
}

.check-icon {
  flex-shrink: 0;
  color: var(--accent-primary);
  margin-left: 8px;
}

.mode-bypassPermissions .mode-name {
  color: #f59e0b;
}

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

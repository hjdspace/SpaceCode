<template>
  <Transition name="dropdown">
    <div v-if="visible" class="attachment-menu" v-click-outside="() => $emit('close')">
      <button class="attachment-item" @click="$emit('attachImage')">
        <Image :size="16" />
        <span>添加图片</span>
      </button>
      <button class="attachment-item" @click="$emit('attachFile')">
        <FileText :size="16" />
        <span>{{ t('chatInput.attachFiles') }}</span>
      </button>
      <button class="attachment-item" @click="$emit('attachFolder')">
        <Folder :size="16" />
        <span>{{ t('chatInput.addFolderContext') }}</span>
      </button>

      <!-- 智能体入口 - hover 触发二级菜单 -->
      <div
        class="attachment-item agent-trigger"
        @mouseenter="handleAgentTriggerEnter"
        @mouseleave="handleAgentTriggerLeave"
      >
        <Cpu :size="16" />
        <span>{{ t('chatInput.agent') }}</span>
        <span v-if="selectedAgent" class="agent-active-dot"></span>
        <ChevronRight :size="14" class="submenu-arrow" />

        <!-- 二级子菜单 -->
        <Transition name="submenu">
          <div
            v-if="showAgentSubmenu"
            class="agent-submenu"
            @mouseenter="handleAgentSubmenuEnter"
            @mouseleave="handleAgentSubmenuLeave"
          >
            <div class="submenu-header">{{ t('chatInput.agent') }}</div>
            <div class="submenu-list">
              <button
                class="submenu-item"
                :class="{ active: !selectedAgent }"
                @click="$emit('selectAgent', '')"
              >
                <span class="item-name">{{ t('chatInput.default') }}</span>
                <span class="item-desc">{{ t('chatInput.defaultAgentDesc') }}</span>
                <Check v-if="!selectedAgent" :size="14" class="check-icon" />
              </button>
              <template v-if="builtInAgents.length">
                <div class="submenu-section-label">{{ t('chatInput.builtIn') }}</div>
                <button
                  v-for="agent in builtInAgents"
                  :key="agent.agentType"
                  class="submenu-item"
                  :class="{ active: selectedAgent === agent.agentType }"
                  @click="$emit('selectAgent', agent.agentType)"
                >
                  <span class="item-name">{{ getAgentName(agent.agentType) }}</span>
                  <span class="item-desc">{{ getAgentDescription(agent.agentType, agent.description) }}</span>
                  <Check v-if="selectedAgent === agent.agentType" :size="14" class="check-icon" />
                </button>
              </template>
              <template v-if="customAgents.length">
                <div class="submenu-section-label">{{ t('chatInput.custom') }}</div>
                <button
                  v-for="agent in customAgents"
                  :key="agent.agentType"
                  class="submenu-item"
                  :class="{ active: selectedAgent === agent.agentType }"
                  @click="$emit('selectAgent', agent.agentType)"
                >
                  <span class="item-name">{{ agent.agentType }}</span>
                  <span class="item-desc">{{ agent.description }}</span>
                  <Check v-if="selectedAgent === agent.agentType" :size="14" class="check-icon" />
                </button>
              </template>
            </div>
          </div>
        </Transition>
      </div>

      <button
        v-if="showOpenProjectAction"
        type="button"
        class="attachment-item"
        @click="$emit('openProjectFolder')"
      >
        <FolderOpen :size="16" />
        <span>{{ t('chatInput.openProjectFolder') }}</span>
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { Image, FileText, Folder, Cpu, ChevronRight, Check, FolderOpen } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { vClickOutside } from '@/directives/vClickOutside'
import { getAgentName as getAgentNameLogic, getAgentDescription as getAgentDescriptionLogic } from '@/composables/useAgentSelector'
import type { AgentInfo } from '@/types'

defineProps<{
  visible: boolean
  selectedAgent: string
  builtInAgents: AgentInfo[]
  customAgents: AgentInfo[]
  showOpenProjectAction: boolean
}>()

defineEmits<{
  attachImage: []
  attachFile: []
  attachFolder: []
  selectAgent: [agentType: string]
  openProjectFolder: []
  close: []
}>()

const { t } = useI18n()

// Internal state: agent submenu hover timer
const showAgentSubmenu = ref(false)
let agentSubmenuTimer: ReturnType<typeof setTimeout> | null = null

function handleAgentTriggerEnter() {
  if (agentSubmenuTimer) {
    clearTimeout(agentSubmenuTimer)
    agentSubmenuTimer = null
  }
  showAgentSubmenu.value = true
}

function handleAgentTriggerLeave() {
  agentSubmenuTimer = setTimeout(() => {
    showAgentSubmenu.value = false
  }, 150)
}

function handleAgentSubmenuEnter() {
  if (agentSubmenuTimer) {
    clearTimeout(agentSubmenuTimer)
    agentSubmenuTimer = null
  }
  showAgentSubmenu.value = true
}

function handleAgentSubmenuLeave() {
  agentSubmenuTimer = setTimeout(() => {
    showAgentSubmenu.value = false
  }, 150)
}

onUnmounted(() => {
  if (agentSubmenuTimer) {
    clearTimeout(agentSubmenuTimer)
    agentSubmenuTimer = null
  }
})

// i18n helpers
function getAgentName(agentType: string): string {
  return getAgentNameLogic(agentType, t)
}

function getAgentDescription(agentType: string, originalDescription: string): string {
  return getAgentDescriptionLogic(agentType, originalDescription, t)
}
</script>

<style lang="scss" scoped>
.attachment-menu {
  position: absolute;
  bottom: 80px;
  left: 32px;
  min-width: 220px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  z-index: 100;
  overflow: visible;
  padding: 4px;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-hover);
  }

  svg {
    color: var(--text-secondary);
  }
}

.agent-trigger {
  position: relative;
  cursor: default;

  .submenu-arrow {
    margin-left: auto;
    color: var(--text-muted);
    flex-shrink: 0;
    transition: color var(--transition-fast);
  }

  .agent-active-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    position: absolute;
    right: 30px;
    top: 50%;
    transform: translateY(-50%);
  }

  &:hover .submenu-arrow {
    color: var(--text-primary);
  }
}

.agent-submenu {
  position: absolute;
  left: 100%;
  bottom: 0;
  margin-left: 4px;
  min-width: 200px;
  max-height: 340px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  z-index: 110;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.submenu-header {
  padding: 10px 14px 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--surface-border);
}

.submenu-list {
  overflow-y: auto;
  padding: 4px;
  max-height: 280px;
}

.submenu-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background var(--transition-fast);
  text-align: left;
  gap: 2px 8px;

  &:hover {
    background: var(--surface-hover);
  }

  &.active {
    background: rgba(var(--accent-primary-rgb), 0.1);
  }

  .item-name {
    font-weight: 500;
    flex: 1;
  }

  .item-desc {
    font-size: 11px;
    color: var(--text-muted);
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 160px;
  }

  .check-icon {
    color: var(--accent-primary);
    flex-shrink: 0;
  }
}

.submenu-section-label {
  padding: 6px 12px 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  opacity: 0.7;
}

.submenu-enter-active,
.submenu-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.submenu-enter-from,
.submenu-leave-to {
  opacity: 0;
  transform: translateX(-4px);
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>

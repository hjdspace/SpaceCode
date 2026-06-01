<template>
  <div class="tools-settings">
    <div class="s-page-header">
      <h2 class="s-page-title">{{ t('toolsSettings.title') }}</h2>
      <p class="s-page-desc">{{ t('toolsSettings.description') }}</p>
    </div>

    <div class="tool-categories">
      <div v-for="category in toolCategories" :key="category.id" class="s-card">
        <div class="category-header">
          <div class="category-icon" :style="{ background: category.color }">
            <component :is="category.icon" :size="20" />
          </div>
          <div class="category-info">
            <h3 class="category-name">{{ category.name }}</h3>
            <span class="category-count">
              {{ t('toolsSettings.enabledCount', { enabled: getEnabledCount(category.tools), total: category.tools.length }) }}
            </span>
          </div>
          <input
            type="checkbox"
            class="s-toggle-switch"
            :checked="isCategoryEnabled(category)"
            @change="toggleCategory(category)"
          />
        </div>

        <div class="tools-list">
          <div
            v-for="tool in category.tools"
            :key="tool.id"
            class="tool-item"
            :class="{ disabled: !tool.enabled, conditional: tool.availability !== 'always' }"
          >
            <label class="tool-toggle">
              <input
                type="checkbox"
                :checked="tool.enabled"
                @change="toggleTool(tool.id)"
              />
              <span class="checkmark"></span>
            </label>
            <div class="tool-info">
              <div class="tool-name-row">
                <span class="tool-name">{{ tool.name }}</span>
                <span v-if="tool.availability === 'feature-flag'" class="tool-badge feature-flag">{{ tool.featureFlag }}</span>
                <span v-else-if="tool.availability === 'env-var'" class="tool-badge env-var">{{ tool.envVar }}</span>
                <span v-else-if="tool.availability === 'runtime-check'" class="tool-badge runtime">{{ t('toolsSettings.runtime') }}</span>
              </div>
              <span class="tool-desc">{{ tool.description }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="s-divider"></div>

    <div class="s-danger-zone">
      <h3 class="s-danger-zone-title">
        <AlertTriangle :size="16" />
        {{ t('toolsSettings.dangerZone') }}
      </h3>
      <div class="s-danger-zone-item">
        <div class="danger-info">
          <span class="danger-label">{{ t('toolsSettings.resetAllLabel') }}</span>
          <span class="danger-desc">{{ t('toolsSettings.resetAllDesc') }}</span>
        </div>
        <button class="s-btn s-danger-btn" @click="resetTools">
          {{ t('toolsSettings.resetButton') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle } from 'lucide-vue-next'
import {
  Terminal, FileText, Globe, Bot, ListChecks, Zap,
  ClipboardList, Workflow, Activity, MessageSquare,
  Cpu, Settings2, GitBranch, Shield, Search, FilePlus,
  FileEdit, TextSearch, Send, Users, ListTodo, Clock,
  Timer, FileBarChart, ScanEye,
  Scissors, MessageCircleQuestion, Network, Bell,
  FileUp, GitPullRequest, RadioTower, Plug, Database,
  FileSearch, SearchCode, FileJson, MonitorDot,
  TerminalSquare, Monitor, GitPullRequestDraft, Beaker,
  GitBranchPlus, ShieldCheck, ClipboardCheck,
  CircleDot, Pencil, List, Octagon, FileOutput
} from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import { TOOL_CATEGORIES, TOOL_REGISTRY, type ToolDefinition, type ToolCategory } from '@/lib/tool-registry'
import { debounce } from '@/utils/debounce'

const { t } = useI18n()
const emit = defineEmits<{ 'change': [] }>()

const configStore = useConfigStore()

interface DisplayTool {
  id: string
  name: string
  description: string
  enabled: boolean
  availability: string
  featureFlag?: string
  envVar?: string
}

interface DisplayCategory {
  id: string
  name: string
  icon: any
  color: string
  tools: DisplayTool[]
}

const ICON_MAP: Record<string, any> = {
  Terminal, FileText, Globe, Bot, ListChecks, Zap,
  ClipboardList, Workflow, Activity, MessageSquare,
  Cpu, Settings2, GitBranch, Shield, Search, FilePlus,
  FileEdit, TextSearch, Send, Users, ListTodo, Clock,
  Timer, FileBarChart, ScanEye,
  Scissors, MessageCircleQuestion, Network, Bell,
  FileUp, GitPullRequest, RadioTower, Plug, Database,
  FileSearch, SearchCode, FileJson, MonitorDot,
  TerminalSquare, Monitor, GitPullRequestDraft, Beaker,
  GitBranchPlus, ShieldCheck, ClipboardCheck,
  CircleDot, Pencil, List, Octagon, FileOutput
}

const toolCategories = computed<DisplayCategory[]>(() => {
  return TOOL_CATEGORIES
    .map(cat => {
      const tools = TOOL_REGISTRY.filter(t => t.category === cat.id)
      return {
        ...cat,
        icon: ICON_MAP[cat.icon] || Settings2,
        tools: tools.map(t => ({
          id: t.name,
          name: t.displayName,
          description: t.description,
          enabled: configStore.isToolEnabled(t.name),
          availability: t.availability,
          featureFlag: t.featureFlag,
          envVar: t.envVar,
        }))
      }
    })
    .filter(cat => cat.tools.length > 0)
})

function getEnabledCount(tools: DisplayTool[]) {
  return tools.filter(t => t.enabled).length
}

function isCategoryEnabled(category: DisplayCategory) {
  return category.tools.every(t => t.enabled)
}

function toggleCategory(category: DisplayCategory) {
  const newValue = !isCategoryEnabled(category)
  category.tools.forEach(tool => {
    const current = configStore.toolConfigs.find(t => t.name === tool.id)
    if (current) current.enabled = newValue
  })
}

function toggleTool(toolId: string) {
  configStore.toggleTool(toolId)
}

function resetTools() {
  if (confirm(t('toolsSettings.resetConfirm'))) {
    localStorage.removeItem('tools_config')
    location.reload()
  }
}

const debouncedChange = debounce(() => { emit('change') }, 100)

watch(() => configStore.toolConfigs, () => {
  debouncedChange()
}, { deep: true })
</script>

<style lang="scss" scoped>
.tools-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.tool-categories {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.category-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--accent-primary);
  flex-shrink: 0;
}

.category-info { flex: 1; }

.category-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.category-count {
  font-size: 12px;
  color: var(--text-muted);
}

.tools-list { padding: 8px 0; }

.tool-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);

  &:hover { background: var(--bg-hover); }
  &.disabled { opacity: 0.5; }
  &.conditional { opacity: 0.85; }
}

.tool-toggle {
  position: relative;
  width: 18px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;

  input { opacity: 0; width: 0; height: 0; }

  .checkmark {
    position: absolute;
    inset: 0;
    background: var(--bg-tertiary);
    border: 2px solid var(--border-default);
    border-radius: 4px;
    transition: all var(--transition-fast);

    &::after {
      content: '';
      position: absolute;
      left: 4px;
      top: 1px;
      width: 5px;
      height: 9px;
      border: solid white;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg) scale(0);
      transition: transform var(--transition-fast);
    }
  }

  input:checked + .checkmark {
    background: var(--accent-primary);
    border-color: var(--accent-primary);

    &::after { transform: rotate(45deg) scale(1); }
  }
}

.tool-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.tool-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tool-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.tool-desc {
  font-size: 11px;
  color: var(--text-muted);
}

.tool-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;

  &.feature-flag {
    background: var(--accent-tertiary-glow);
    color: var(--accent-tertiary);
  }

  &.env-var {
    background: var(--warning-glow);
    color: var(--warning);
  }

  &.runtime {
    background: var(--accent-secondary-glow);
    color: var(--accent-secondary);
  }
}

.danger-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.danger-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.danger-desc {
  font-size: 12px;
  color: var(--text-muted);
}
</style>

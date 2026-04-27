<template>
  <div class="settings-section">
    <h2 class="section-title">Tools</h2>
    
    <div class="section-content">
      <p class="section-desc">
        Enable or disable specific tools that Claude can use. Disabled tools will not be available during conversations.
      </p>

      <!-- Tool Categories -->
      <div class="tool-categories">
        <div v-for="category in toolCategories" :key="category.id" class="category-card">
          <div class="category-header">
            <div class="category-icon" :style="{ background: category.color }">
              <component :is="category.icon" :size="20" />
            </div>
            <div class="category-info">
              <h3 class="category-name">{{ category.name }}</h3>
              <span class="category-count">
                {{ getEnabledCount(category.tools) }} of {{ category.tools.length }} enabled
              </span>
            </div>
            <label class="category-toggle">
              <input 
                type="checkbox" 
                :checked="isCategoryEnabled(category)"
                @change="toggleCategory(category)"
              />
              <span class="toggle-slider"></span>
            </label>
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
                  <span v-else-if="tool.availability === 'runtime-check'" class="tool-badge runtime">runtime</span>
                </div>
                <span class="tool-desc">{{ tool.description }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="divider"></div>
      <div class="danger-zone">
        <h3 class="danger-title">
          <AlertTriangle :size="16" />
          Danger Zone
        </h3>
        <div class="danger-item">
          <div class="danger-info">
            <span class="danger-label">Reset All Tool Settings</span>
            <span class="danger-desc">Restore default tool configuration</span>
          </div>
          <button class="btn btn-danger" @click="resetTools">
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
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
  if (confirm('Are you sure you want to reset all tool settings to defaults?')) {
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
.settings-section { max-width: 720px; }

.section-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.section-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 24px;
  line-height: 1.5;
}

.section-content { display: flex; flex-direction: column; gap: 20px; }

.tool-categories { display: flex; flex-direction: column; gap: 16px; }

.category-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}

.category-icon {
  width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px;
  color: var(--accent-primary);
  flex-shrink: 0;
}

.category-info { flex: 1; }

.category-name {
  font-size: 14px; font-weight: 600;
  color: var(--text-primary); margin: 0;
}

.category-count { font-size: 12px; color: var(--text-muted); }

.category-toggle {
  position: relative;
  width: 44px; height: 24px; cursor: pointer; flex-shrink: 0;
  input { opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute; inset: 0;
    background: var(--bg-tertiary);
    border-radius: 12px; transition: background 0.2s;
    &::after {
      content: ''; position: absolute;
      top: 2px; left: 2px;
      width: 20px; height: 20px;
      background: white; border-radius: 50%;
      transition: transform 0.2s;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
  }
  input:checked + .toggle-slider {
    background: var(--accent-primary);
    &::after { transform: translateX(20px); }
  }
}

.tools-list { padding: 8px; }

.tool-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 8px;
  transition: all 0.15s;
  &:hover { background: var(--bg-hover); }
  &.disabled { opacity: 0.5; }
  &.conditional { opacity: 0.85; }
}

.tool-toggle {
  position: relative;
  width: 18px; height: 18px;
  cursor: pointer; flex-shrink: 0;
  input { opacity: 0; width: 0; height: 0; }
  .checkmark {
    position: absolute; inset: 0;
    background: var(--bg-tertiary);
    border: 2px solid var(--border-color);
    border-radius: 4px; transition: all 0.15s;
    &::after {
      content: ''; position: absolute;
      left: 4px; top: 1px;
      width: 5px; height: 9px;
      border: solid white; border-width: 0 2px 2px 0;
      transform: rotate(45deg) scale(0);
      transition: transform 0.15s;
    }
  }
  input:checked + .checkmark {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    &::after { transform: rotate(45deg) scale(1); }
  }
}

.tool-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }

.tool-name-row {
  display: flex; align-items: center; gap: 6px;
}

.tool-name {
  font-size: 13px; font-weight: 500;
  color: var(--text-primary);
}

.tool-desc { font-size: 11px; color: var(--text-muted); }

.tool-badge {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  font-weight: 500; text-transform: uppercase;
  letter-spacing: 0.3px; flex-shrink: 0;
  &.feature-flag { background: rgba(139, 92, 246, 0.15); color: #a78bfa; }
  &.env-var { background: rgba(234, 179, 8, 0.15); color: #fbbf24; }
  &.runtime { background: rgba(14, 165, 233, 0.15); color: #38bdf8; }
}

.divider { height: 1px; background: var(--border-color); margin: 8px 0; }

.danger-zone {
  background: rgba(220, 53, 69, 0.05);
  border: 1px solid rgba(220, 53, 69, 0.2);
  border-radius: 12px; padding: 20px;
}

.danger-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 600;
  color: #dc3545; margin: 0 0 16px 0;
}

.danger-item { display: flex; align-items: center; justify-content: space-between; }

.danger-info { display: flex; flex-direction: column; gap: 4px; }

.danger-label { font-size: 13px; font-weight: 500; color: var(--text-primary); }

.danger-desc { font-size: 12px; color: var(--text-muted); }

.btn {
  @include reset-button;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-radius: 8px;
  font-size: 13px; font-weight: 500; transition: all 0.2s;
  &.btn-danger {
    background: rgba(220, 53, 69, 0.1);
    border: 1px solid rgba(220, 53, 69, 0.3);
    color: #dc3545;
    &:hover { background: rgba(220, 53, 69, 0.2); border-color: #dc3545; }
  }
}
</style>

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
              :class="{ disabled: !tool.enabled }"
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
                <span class="tool-name">{{ tool.name }}</span>
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
import { ref, computed, watch, shallowRef } from 'vue'
import {
  FileText, Search, Terminal, Globe, Database,
  GitBranch, AlertTriangle, Settings, Code
} from 'lucide-vue-next'
import { debounce } from '@/utils/debounce'

const emit = defineEmits<{
  'change': []
}>()

interface Tool {
  id: string
  name: string
  description: string
  enabled: boolean
}

interface ToolCategory {
  id: string
  name: string
  icon: any
  color: string
  tools: Tool[]
}

// 使用shallowRef优化大型数据结构
const toolCategories = shallowRef<ToolCategory[]>([
  {
    id: 'file',
    name: 'File Operations',
    icon: FileText,
    color: 'rgba(59, 130, 246, 0.1)',
    tools: [
      { id: 'read_file', name: 'Read File', description: 'Read contents of files', enabled: true },
      { id: 'write_file', name: 'Write File', description: 'Create or overwrite files', enabled: true },
      { id: 'edit_file', name: 'Edit File', description: 'Apply edits to files', enabled: true },
      { id: 'view_file', name: 'View File', description: 'View file with line numbers', enabled: true }
    ]
  },
  {
    id: 'search',
    name: 'Search & Navigation',
    icon: Search,
    color: 'rgba(139, 92, 246, 0.1)',
    tools: [
      { id: 'search_files', name: 'Search Files', description: 'Search file contents with regex', enabled: true },
      { id: 'list_files', name: 'List Files', description: 'List files and directories', enabled: true },
      { id: 'glob', name: 'Glob Search', description: 'Find files by pattern', enabled: true }
    ]
  },
  {
    id: 'terminal',
    name: 'Terminal & Execution',
    icon: Terminal,
    color: 'rgba(34, 197, 94, 0.1)',
    tools: [
      { id: 'bash', name: 'Bash', description: 'Execute bash commands', enabled: true },
      { id: 'command', name: 'Command', description: 'Run system commands', enabled: true }
    ]
  },
  {
    id: 'web',
    name: 'Web & Network',
    icon: Globe,
    color: 'rgba(249, 115, 22, 0.1)',
    tools: [
      { id: 'fetch', name: 'Fetch', description: 'Make HTTP requests', enabled: true },
      { id: 'web_search', name: 'Web Search', description: 'Search the web', enabled: false }
    ]
  },
  {
    id: 'git',
    name: 'Version Control',
    icon: GitBranch,
    color: 'rgba(236, 72, 153, 0.1)',
    tools: [
      { id: 'git_status', name: 'Git Status', description: 'Check git repository status', enabled: true },
      { id: 'git_diff', name: 'Git Diff', description: 'View git diffs', enabled: true },
      { id: 'git_log', name: 'Git Log', description: 'View commit history', enabled: true }
    ]
  },
  {
    id: 'code',
    name: 'Code Intelligence',
    icon: Code,
    color: 'rgba(6, 182, 212, 0.1)',
    tools: [
      { id: 'lsp', name: 'LSP', description: 'Language Server Protocol integration', enabled: true },
      { id: 'analyze', name: 'Code Analysis', description: 'Analyze code structure', enabled: true }
    ]
  }
])

// 使用computed缓存计算结果
const getEnabledCount = computed(() => (tools: Tool[]) => {
  return tools.filter(t => t.enabled).length
})

function isCategoryEnabled(category: ToolCategory) {
  return category.tools.every(t => t.enabled)
}

function toggleCategory(category: ToolCategory) {
  const allEnabled = isCategoryEnabled(category)
  const newValue = !allEnabled
  
  // 创建新数组触发更新
  toolCategories.value = toolCategories.value.map(cat => {
    if (cat.id === category.id) {
      return {
        ...cat,
        tools: cat.tools.map(tool => ({ ...tool, enabled: newValue }))
      }
    }
    return cat
  })
}

function toggleTool(toolId: string) {
  toolCategories.value = toolCategories.value.map(category => {
    const tool = category.tools.find(t => t.id === toolId)
    if (tool) {
      return {
        ...category,
        tools: category.tools.map(t => 
          t.id === toolId ? { ...t, enabled: !t.enabled } : t
        )
      }
    }
    return category
  })
}

function resetTools() {
  if (confirm('Are you sure you want to reset all tool settings to defaults?')) {
    toolCategories.value = toolCategories.value.map(category => ({
      ...category,
      tools: category.tools.map(tool => ({ ...tool, enabled: true }))
    }))
  }
}

// 使用防抖触发change事件
const debouncedChange = debounce(() => {
  emit('change')
}, 100)

// Watch for changes and emit change event - 使用浅监听
watch(toolCategories, () => {
  debouncedChange()
}, { deep: false })
</script>

<style lang="scss" scoped>
.settings-section {
  max-width: 720px;
}

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

.section-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.tool-categories {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

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
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--accent-primary);
}

.category-info {
  flex: 1;
}

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

.category-toggle {
  position: relative;
  width: 44px;
  height: 24px;
  cursor: pointer;

  input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    inset: 0;
    background: var(--bg-tertiary);
    border-radius: 12px;
    transition: background 0.2s;

    &::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
  }

  input:checked + .toggle-slider {
    background: var(--accent-primary);

    &::after {
      transform: translateX(20px);
    }
  }
}

.tools-list {
  padding: 8px;
}

.tool-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  transition: all 0.15s;

  &:hover {
    background: var(--bg-hover);
  }

  &.disabled {
    opacity: 0.5;
  }
}

.tool-toggle {
  position: relative;
  width: 18px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;

  input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .checkmark {
    position: absolute;
    inset: 0;
    background: var(--bg-tertiary);
    border: 2px solid var(--border-color);
    border-radius: 4px;
    transition: all 0.15s;

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
      transition: transform 0.15s;
    }
  }

  input:checked + .checkmark {
    background: var(--accent-primary);
    border-color: var(--accent-primary);

    &::after {
      transform: rotate(45deg) scale(1);
    }
  }
}

.tool-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tool-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.tool-desc {
  font-size: 12px;
  color: var(--text-muted);
}

.divider {
  height: 1px;
  background: var(--border-color);
  margin: 8px 0;
}

.danger-zone {
  background: rgba(220, 53, 69, 0.05);
  border: 1px solid rgba(220, 53, 69, 0.2);
  border-radius: 12px;
  padding: 20px;
}

.danger-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #dc3545;
  margin: 0 0 16px 0;
}

.danger-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.btn {
  @include reset-button;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;

  &.btn-danger {
    background: rgba(220, 53, 69, 0.1);
    border: 1px solid rgba(220, 53, 69, 0.3);
    color: #dc3545;

    &:hover {
      background: rgba(220, 53, 69, 0.2);
      border-color: #dc3545;
    }
  }
}
</style>

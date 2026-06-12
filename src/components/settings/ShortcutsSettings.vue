<template>
  <div class="shortcuts-settings">
    <div class="s-masthead">
      <div class="s-masthead-eyebrow">Settings</div>
      <h1 class="s-masthead-title">{{ t('shortcutsSettings.title') }}</h1>
      <p class="s-masthead-desc">{{ t('shortcutsSettings.description') }}</p>
    </div>

    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon lang"><Search :size="14" /></div>
          <span class="s-panel-title">{{ t('shortcutsSettings.title') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="s-search-box">
          <Search :size="16" />
          <input
            v-model="searchQuery"
            :placeholder="t('shortcutsSettings.searchPlaceholder')"
            class="s-search-input"
          />
        </div>
      </div>
    </div>

    <div
      v-for="category in filteredCategories"
      :key="category.id"
      class="s-panel"
    >
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon engine"><Keyboard :size="14" /></div>
          <span class="s-panel-title">{{ category.name }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div
          v-for="shortcut in category.shortcuts"
          :key="shortcut.id"
          class="shortcut-item"
          :class="{ editing: editingShortcut === shortcut.id }"
          @click="startEdit(shortcut)"
        >
          <div class="shortcut-info">
            <span class="shortcut-name">{{ shortcut.name }}</span>
            <span class="shortcut-desc">{{ shortcut.description }}</span>
          </div>
          <div class="shortcut-keys">
            <template v-if="editingShortcut === shortcut.id">
              <span class="editing-hint">{{ t('shortcutsSettings.pressKeys') }}</span>
              <button class="s-btn s-btn-secondary" @click.stop="cancelEdit">{{ t('shortcutsSettings.cancel') }}</button>
            </template>
            <template v-else>
              <kbd
                v-for="(key, index) in formatShortcut(shortcut.keys)"
                :key="index"
                class="s-kbd"
              >{{ key }}</kbd>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-if="filteredCategories.length === 0" class="s-empty-state">
      <div class="s-empty-state-icon">
        <SearchX :size="48" />
      </div>
      <h4 class="s-empty-state-title">{{ t('shortcutsSettings.noShortcutsFound') }}</h4>
      <p class="s-empty-state-description">{{ t('shortcutsSettings.tryDifferentSearch') }}</p>
    </div>

    <div class="shortcuts-footer">
      <button class="s-btn s-btn-secondary" @click="resetShortcuts">
        <RotateCcw :size="14" />
        {{ t('shortcutsSettings.resetToDefaults') }}
      </button>
    </div>

    <div v-if="editingShortcut" class="key-capture-overlay" tabindex="0" @keydown.capture.prevent="onKeyDown">
      <div class="key-capture-modal">
        <h3>{{ t('shortcutsSettings.enterNewShortcut') }}</h3>
        <p>{{ t('shortcutsSettings.pressCombination') }}</p>
        <div class="captured-keys">
          <kbd v-for="key in capturedKeys" :key="key" class="s-kbd s-kbd-lg">{{ key }}</kbd>
        </div>
        <div class="capture-actions">
          <button class="s-btn s-btn-secondary" @click="cancelEdit">{{ t('shortcutsSettings.cancel') }}</button>
          <button class="s-btn s-btn-primary" @click="saveShortcut" :disabled="capturedKeys.length === 0">
            {{ t('shortcutsSettings.save') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, SearchX, RotateCcw, Keyboard } from 'lucide-vue-next'
import { debounce } from '@/utils/debounce'
import type { Shortcut, ShortcutCategory } from '@/composables/useShortcuts'

const { t } = useI18n()

export interface ShortcutsConfig {
  categories: ShortcutCategory[]
}

const props = defineProps<{
  modelValue?: ShortcutsConfig
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ShortcutsConfig]
  'change': []
}>()

const STORAGE_KEY = 'keyboard_shortcuts'

// Default shortcuts configuration
const defaultShortcuts: ShortcutCategory[] = [
  {
    id: 'general',
    name: t('shortcutsSettings.categoryGeneral'),
    shortcuts: [
      { id: 'new_chat', name: t('shortcutsSettings.newChat'), description: t('shortcutsSettings.newChatDesc'), keys: ['Ctrl', 'N'], defaultKeys: ['Ctrl', 'N'] },
      { id: 'close_chat', name: t('shortcutsSettings.closeChat'), description: t('shortcutsSettings.closeChatDesc'), keys: ['Ctrl', 'W'], defaultKeys: ['Ctrl', 'W'] },
      { id: 'search_chats', name: t('shortcutsSettings.searchChats'), description: t('shortcutsSettings.searchChatsDesc'), keys: ['Ctrl', 'K'], defaultKeys: ['Ctrl', 'K'] },
      { id: 'settings', name: t('shortcutsSettings.settings'), description: t('shortcutsSettings.settingsDesc'), keys: ['Ctrl', ','], defaultKeys: ['Ctrl', ','] }
    ]
  },
  {
    id: 'editor',
    name: t('shortcutsSettings.categoryEditor'),
    shortcuts: [
      { id: 'send_message', name: t('shortcutsSettings.sendMessage'), description: t('shortcutsSettings.sendMessageDesc'), keys: ['Enter'], defaultKeys: ['Enter'] },
      { id: 'new_line', name: t('shortcutsSettings.newLine'), description: t('shortcutsSettings.newLineDesc'), keys: ['Shift', 'Enter'], defaultKeys: ['Shift', 'Enter'] },
      { id: 'clear_chat', name: t('shortcutsSettings.clearChat'), description: t('shortcutsSettings.clearChatDesc'), keys: ['Ctrl', 'Shift', 'K'], defaultKeys: ['Ctrl', 'Shift', 'K'] }
    ]
  },
  {
    id: 'navigation',
    name: t('shortcutsSettings.categoryNavigation'),
    shortcuts: [
      { id: 'focus_input', name: t('shortcutsSettings.focusInput'), description: t('shortcutsSettings.focusInputDesc'), keys: ['Ctrl', 'L'], defaultKeys: ['Ctrl', 'L'] },
      { id: 'toggle_sidebar', name: t('shortcutsSettings.toggleSidebar'), description: t('shortcutsSettings.toggleSidebarDesc'), keys: ['Ctrl', 'B'], defaultKeys: ['Ctrl', 'B'] },
      { id: 'next_chat', name: t('shortcutsSettings.nextChat'), description: t('shortcutsSettings.nextChatDesc'), keys: ['Ctrl', 'Tab'], defaultKeys: ['Ctrl', 'Tab'] },
      { id: 'prev_chat', name: t('shortcutsSettings.prevChat'), description: t('shortcutsSettings.prevChatDesc'), keys: ['Ctrl', 'Shift', 'Tab'], defaultKeys: ['Ctrl', 'Shift', 'Tab'] }
    ]
  },
  {
    id: 'terminal',
    name: t('shortcutsSettings.categoryTerminal'),
    shortcuts: [
      { id: 'new_terminal', name: t('shortcutsSettings.newTerminal'), description: t('shortcutsSettings.newTerminalDesc'), keys: ['Ctrl', 'Shift', '`'], defaultKeys: ['Ctrl', 'Shift', '`'] },
      { id: 'close_terminal', name: t('shortcutsSettings.closeTerminal'), description: t('shortcutsSettings.closeTerminalDesc'), keys: ['Ctrl', 'Shift', 'W'], defaultKeys: ['Ctrl', 'Shift', 'W'] },
      { id: 'clear_terminal', name: t('shortcutsSettings.clearTerminal'), description: t('shortcutsSettings.clearTerminalDesc'), keys: ['Ctrl', 'K'], defaultKeys: ['Ctrl', 'K'] }
    ]
  }
]

// 使用惰性加载，避免在组件初始化时立即读取localStorage
let savedShortcutsLoaded = false
let cachedSavedShortcuts: ShortcutCategory[] | null = null

function loadSavedShortcuts(): ShortcutCategory[] {
  if (savedShortcutsLoaded && cachedSavedShortcuts) {
    return cachedSavedShortcuts
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      // Merge saved keys with default shortcuts to handle new shortcuts
      const mergedShortcuts = defaultShortcuts.map(defaultCat => {
        const savedCat = parsed.categories?.find((c: ShortcutCategory) => c.id === defaultCat.id)
        if (savedCat) {
          return {
            ...defaultCat,
            shortcuts: defaultCat.shortcuts.map(defaultShortcut => {
              const savedShortcut = savedCat.shortcuts.find((s: Shortcut) => s.id === defaultShortcut.id)
              if (savedShortcut) {
                return { ...defaultShortcut, keys: savedShortcut.keys }
              }
              return defaultShortcut
            })
          }
        }
        return defaultCat
      })
      cachedSavedShortcuts = mergedShortcuts
      savedShortcutsLoaded = true
      return cachedSavedShortcuts
    }
  } catch (e) {
    console.error('[Shortcuts] Failed to load saved shortcuts')
  }
  
  savedShortcutsLoaded = true
  cachedSavedShortcuts = JSON.parse(JSON.stringify(defaultShortcuts))
  return cachedSavedShortcuts as ShortcutCategory[]
}

const shortcutCategories = ref<ShortcutCategory[]>(loadSavedShortcuts())
const searchQuery = ref('')
const editingShortcut = ref<string | null>(null)
const capturedKeys = ref<string[]>([])

// 使用computed缓存过滤结果
const filteredCategories = computed(() => {
  if (!searchQuery.value) return shortcutCategories.value

  const query = searchQuery.value.toLowerCase()
  return shortcutCategories.value
    .map(cat => ({
      ...cat,
      shortcuts: cat.shortcuts.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        s.keys.some(k => k.toLowerCase().includes(query))
      )
    }))
    .filter(cat => cat.shortcuts.length > 0)
})

const config = computed<ShortcutsConfig>({
  get: () => ({
    categories: shortcutCategories.value,
    ...props.modelValue
  }),
  set: (val) => {
    emit('update:modelValue', val)
  }
})

// 使用防抖保存到localStorage
const debouncedSave = debounce((newValue: ShortcutCategory[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ categories: newValue }))
    // Update config for parent component
    config.value = { categories: newValue }
    // Emit change event for parent
    emit('change')
  } catch (e) {
    console.error('[Shortcuts] Failed to save shortcuts')
  }
}, 300)

// Save to localStorage whenever shortcuts change - 使用防抖
watch(shortcutCategories, (newValue) => {
  debouncedSave(newValue)
}, { deep: true })

function formatShortcut(keys: string[]) {
  return keys
}

function startEdit(shortcut: Shortcut) {
  editingShortcut.value = shortcut.id
  capturedKeys.value = [...shortcut.keys]
}

function cancelEdit() {
  editingShortcut.value = null
  capturedKeys.value = []
}

function onKeyDown(e: KeyboardEvent) {
  const keys: string[] = []

  if (e.ctrlKey) keys.push('Ctrl')
  if (e.altKey) keys.push('Alt')
  if (e.shiftKey) keys.push('Shift')
  if (e.metaKey) keys.push('Cmd')

  const key = e.key
  if (key && !['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    keys.push(key.length === 1 ? key.toUpperCase() : key)
  }

  capturedKeys.value = keys
}

function saveShortcut() {
  if (!editingShortcut.value) return

  for (const category of shortcutCategories.value) {
    const shortcut = category.shortcuts.find(s => s.id === editingShortcut.value)
    if (shortcut) {
      shortcut.keys = [...capturedKeys.value]
      break
    }
  }

  cancelEdit()
}

function resetShortcuts() {
  if (confirm(t('shortcutsSettings.resetConfirm'))) {
    shortcutCategories.value = JSON.parse(JSON.stringify(defaultShortcuts))
  }
}

// Initialize on mount
onMounted(() => {
  // Emit initial config
  config.value = { categories: shortcutCategories.value }
})
</script>

<style lang="scss" scoped>

.shortcuts-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 780px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  cursor: pointer;
  transition: all var(--transition-fast);
  border-bottom: 1px solid var(--border-subtle);

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--bg-hover);
    margin: 0 -24px;
    padding-left: 24px;
    padding-right: 24px;
  }

  &.editing {
    background: var(--accent-primary-glow);
    margin: 0 -24px;
    padding-left: 24px;
    padding-right: 24px;
  }
}

.shortcut-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.shortcut-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.shortcut-desc {
  font-size: 12px;
  color: var(--text-muted);
}

.shortcut-keys {
  display: flex;
  align-items: center;
  gap: 6px;
}

.editing-hint {
  font-size: 13px;
  color: var(--accent-primary);
  font-style: italic;
}

.shortcuts-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

.s-kbd-lg {
  height: 32px;
  font-size: 14px;
}

.key-capture-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-heavy);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.key-capture-modal {
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  min-width: 320px;
  box-shadow: var(--shadow-xl);

  h3 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  p {
    font-size: var(--font-size-base);
    color: var(--text-muted);
    margin: 0;
  }
}

.captured-keys {
  display: flex;
  gap: 8px;
  padding: 24px;
  min-height: 80px;
  align-items: center;
  justify-content: center;
}

.capture-actions {
  display: flex;
  gap: 12px;
}
</style>

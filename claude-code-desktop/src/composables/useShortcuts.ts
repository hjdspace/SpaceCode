import { ref, onMounted, onUnmounted } from 'vue'
import type { ShortcutCategory, Shortcut } from '@/components/settings/ShortcutsSettings.vue'

export interface ShortcutHandler {
  (event: KeyboardEvent): void | boolean
}

export interface ShortcutHandlers {
  [shortcutId: string]: ShortcutHandler
}

const STORAGE_KEY = 'keyboard_shortcuts'

// Load shortcuts from localStorage
function loadShortcuts(): ShortcutCategory[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      return parsed.categories || []
    }
  } catch (e) {
    console.error('[Shortcuts] Failed to load shortcuts')
  }
  return []
}

// Normalize key for comparison
function normalizeKey(key: string): string {
  const keyMap: Record<string, string> = {
    'Control': 'Ctrl',
    'Command': 'Cmd',
    'Meta': 'Cmd',
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
    'Escape': 'Esc',
    'Delete': 'Del',
    'Backspace': 'Backspace',
    'Enter': 'Enter',
    'Tab': 'Tab',
    ' ': 'Space'
  }
  return keyMap[key] || key
}

// Match keyboard event against shortcut keys
function matchShortcut(event: KeyboardEvent, keys: string[]): boolean {
  const pressedKeys: string[] = []

  if (event.ctrlKey) pressedKeys.push('Ctrl')
  if (event.altKey) pressedKeys.push('Alt')
  if (event.shiftKey) pressedKeys.push('Shift')
  if (event.metaKey) pressedKeys.push('Cmd')

  const mainKey = normalizeKey(event.key)
  if (mainKey && !['Ctrl', 'Alt', 'Shift', 'Cmd', 'Control', 'Meta'].includes(mainKey)) {
    pressedKeys.push(mainKey.length === 1 ? mainKey.toUpperCase() : mainKey)
  }

  // Compare arrays
  if (pressedKeys.length !== keys.length) return false

  const normalizedKeys = keys.map(k => k.length === 1 ? k.toUpperCase() : k)
  const normalizedPressed = pressedKeys.map(k => k.length === 1 ? k.toUpperCase() : k)

  return normalizedKeys.every(k => normalizedPressed.includes(k)) &&
         normalizedPressed.every(k => normalizedKeys.includes(k))
}

// Check if element is an input/textarea
function isInputElement(element: EventTarget | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false
  const tagName = element.tagName.toLowerCase()
  const isContentEditable = element.isContentEditable
  const isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select'
  return isInput || isContentEditable
}

export function useShortcuts(handlers: ShortcutHandlers = {}) {
  const shortcuts = ref<ShortcutCategory[]>(loadShortcuts())
  const isEnabled = ref(true)

  // Register a handler for a specific shortcut
  function register(shortcutId: string, handler: ShortcutHandler) {
    handlers[shortcutId] = handler
  }

  // Unregister a handler
  function unregister(shortcutId: string) {
    delete handlers[shortcutId]
  }

  // Enable/disable shortcuts
  function setEnabled(enabled: boolean) {
    isEnabled.value = enabled
  }

  // Reload shortcuts from storage
  function reload() {
    shortcuts.value = loadShortcuts()
  }

  // Handle keyboard event
  function handleKeyDown(event: KeyboardEvent) {
    if (!isEnabled.value) return

    // Don't trigger shortcuts when typing in input fields (except for specific shortcuts)
    const target = event.target
    const isInInput = isInputElement(target)

    for (const category of shortcuts.value) {
      for (const shortcut of category.shortcuts) {
        if (matchShortcut(event, shortcut.keys)) {
          // Skip some shortcuts when in input (except Enter, Escape, etc.)
          if (isInInput) {
            const allowedInInput = ['send_message', 'new_line']
            if (!allowedInInput.includes(shortcut.id)) {
              continue
            }
          }

          const handler = handlers[shortcut.id]
          if (handler) {
            event.preventDefault()
            event.stopPropagation()
            handler(event)
            return
          }
        }
      }
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown, true)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown, true)
  })

  return {
    shortcuts,
    register,
    unregister,
    setEnabled,
    reload
  }
}

// Get a specific shortcut by ID
export function getShortcutById(id: string): Shortcut | undefined {
  const categories = loadShortcuts()
  for (const category of categories) {
    const shortcut = category.shortcuts.find(s => s.id === id)
    if (shortcut) return shortcut
  }
  return undefined
}

// Get shortcut display text
export function getShortcutDisplay(id: string): string {
  const shortcut = getShortcutById(id)
  if (!shortcut) return ''
  return shortcut.keys.join('+')
}

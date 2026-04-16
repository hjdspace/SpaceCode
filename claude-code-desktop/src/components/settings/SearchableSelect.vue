<template>
  <div class="searchable-select" ref="selectRef">
    <div
      class="select-trigger"
      :class="{ open: isOpen }"
      @click="toggleOpen"
    >
      <span class="selected-text">{{ selectedLabel }}</span>
      <ChevronDown :size="16" class="chevron" :class="{ open: isOpen }" />
    </div>

    <Transition name="dropdown">
      <div v-if="isOpen" class="select-dropdown">
        <div class="search-box">
          <Search :size="14" />
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            placeholder="Search models..."
            @click.stop
            @keydown.stop
          />
          <button v-if="searchQuery" class="clear-btn" @click.stop="searchQuery = ''">
            <X :size="12" />
          </button>
        </div>

        <div class="options-list" ref="optionsList">
          <div
            v-if="filteredOptions.length === 0"
            class="no-results"
          >
            No models found
          </div>
          <div
            v-for="option in filteredOptions"
            :key="option.id"
            class="option"
            :class="{ selected: modelValue === option.id, highlighted: highlightedId === option.id }"
            @click="selectOption(option.id)"
            @mouseenter="highlightedId = option.id"
          >
            <span class="option-label">{{ option.name || option.id }}</span>
            <Check v-if="modelValue === option.id" :size="14" class="check-icon" />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, shallowRef } from 'vue'
import { Search, ChevronDown, Check, X } from 'lucide-vue-next'
import { debounce } from '@/utils/debounce'

interface Option {
  id: string
  name?: string
}

const props = defineProps<{
  modelValue: string
  options: Option[]
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const isOpen = ref(false)
const searchQuery = ref('')
const highlightedId = ref<string | null>(null)
const selectRef = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const optionsList = ref<HTMLElement | null>(null)

// 使用computed缓存选中标签
const selectedLabel = computed(() => {
  if (!props.modelValue) return props.placeholder || 'Select...'
  const option = props.options.find(o => o.id === props.modelValue)
  return option?.name || option?.id || props.placeholder || 'Select...'
})

// 使用shallowRef优化大型列表
const filteredOptions = computed(() => {
  if (!searchQuery.value) return props.options
  const query = searchQuery.value.toLowerCase()
  return props.options.filter(option =>
    (option.name?.toLowerCase().includes(query) ?? false) ||
    option.id.toLowerCase().includes(query)
  )
})

function toggleOpen() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    nextTick(() => {
      searchInput.value?.focus()
      // Highlight current selection
      highlightedId.value = props.modelValue
    })
  }
}

function selectOption(id: string) {
  emit('update:modelValue', id)
  isOpen.value = false
  searchQuery.value = ''
}

// 使用防抖处理点击外部
const debouncedClickOutside = debounce((event: MouseEvent) => {
  if (selectRef.value && !selectRef.value.contains(event.target as Node)) {
    isOpen.value = false
    searchQuery.value = ''
  }
}, 10)

function handleKeydown(event: KeyboardEvent) {
  if (!isOpen.value) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      isOpen.value = true
    }
    return
  }

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      isOpen.value = false
      searchQuery.value = ''
      break
    case 'ArrowDown':
      event.preventDefault()
      navigateOptions(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      navigateOptions(-1)
      break
    case 'Enter':
      event.preventDefault()
      if (highlightedId.value) {
        selectOption(highlightedId.value)
      }
      break
  }
}

function navigateOptions(direction: number) {
  const options = filteredOptions.value
  if (options.length === 0) return

  const currentIndex = options.findIndex(o => o.id === highlightedId.value)
  let newIndex = currentIndex + direction

  if (newIndex < 0) newIndex = options.length - 1
  if (newIndex >= options.length) newIndex = 0

  highlightedId.value = options[newIndex].id

  // Scroll into view - 使用requestAnimationFrame优化
  requestAnimationFrame(() => {
    const highlightedEl = optionsList.value?.querySelector('.highlighted')
    highlightedEl?.scrollIntoView({ block: 'nearest' })
  })
}

// 使用passive事件监听器优化性能
onMounted(() => {
  document.addEventListener('click', debouncedClickOutside, { passive: true })
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', debouncedClickOutside)
  document.removeEventListener('keydown', handleKeydown)
})

// Reset highlighted when opening
watch(isOpen, (open) => {
  if (open) {
    highlightedId.value = props.modelValue
  }
})
</script>

<style lang="scss" scoped>
.searchable-select {
  position: relative;
  width: 100%;
}

.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--accent-primary);
  }

  &.open {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.1);
  }
}

.selected-text {
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  color: var(--text-muted);
  transition: transform 0.2s;

  &.open {
    transform: rotate(180deg);
  }
}

.select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  z-index: 100;
  overflow: hidden;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-muted);

  input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 13px;
    outline: none;

    &::placeholder {
      color: var(--text-muted);
    }
  }

  .clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 4px;

    &:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
  }
}

.options-list {
  max-height: 240px;
  overflow-y: auto;
}

.no-results {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover,
  &.highlighted {
    background: var(--bg-hover);
  }

  &.selected {
    background: rgba(var(--accent-primary-rgb), 0.1);
  }
}

.option-label {
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check-icon {
  color: var(--accent-primary);
  flex-shrink: 0;
}

// Dropdown animation
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>

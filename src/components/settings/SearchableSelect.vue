<template>
  <div class="searchable-select" ref="selectRef">
    <div
      class="select-trigger"
      :class="{ open: isOpen }"
      @click="toggleOpen"
      role="combobox"
      :aria-expanded="isOpen"
      :aria-haspopup="true"
      :aria-label="selectedLabel"
    >
      <span class="selected-text" :title="selectedLabel">{{ selectedLabel }}</span>
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
            :placeholder="t('model.selectModel')"
            aria-label="Search models"
            :aria-describedby="filteredOptions.length === 0 ? 'no-results' : undefined"
            @click.stop
            @keydown.stop
          />
          <button v-if="searchQuery" class="clear-btn" @click.stop="searchQuery = ''">
            <X :size="12" />
          </button>
        </div>

        <div class="options-list" ref="optionsList">
          <div
            v-if="filteredOptions.length === 0 && !searchQuery"
            id="no-results"
            class="no-results"
            role="status"
            aria-live="polite"
          >
            {{ t('auth.noModelsFound') }}
          </div>
          <div
            v-for="option in filteredOptions"
            :key="option.id"
            class="option"
            :class="{ selected: modelValue === option.id, highlighted: highlightedId === option.id }"
            @click="selectOption(option.id)"
            @mouseenter="highlightedId = option.id"
          >
            <span class="option-label" :title="option.name || option.id">{{ option.name || option.id }}</span>
            <Check v-if="modelValue === option.id" :size="14" class="check-icon" />
          </div>
          <div
            v-if="searchQuery.trim()"
            class="option custom-input-option"
            :class="{ highlighted: highlightedId === '__custom__' }"
            @click="selectCustomValue"
            @mouseenter="highlightedId = '__custom__'"
          >
            <span class="option-label">{{ t('model.useCustomModel') }}: "{{ searchQuery.trim() }}"</span>
            <Plus :size="14" class="check-icon" />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, ChevronDown, Check, X, Plus } from 'lucide-vue-next'
import { debounce } from '@/utils/debounce'

const { t } = useI18n()
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
  if (!props.modelValue) return props.placeholder || t('model.selectModel')
  const option = props.options.find(o => o.id === props.modelValue)
  return option?.name || option?.id || props.placeholder || t('model.selectModel')
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

/** Allow free-text input: use the typed search query as the model value */
function selectCustomValue() {
  const val = searchQuery.value.trim()
  if (val) {
    emit('update:modelValue', val)
    isOpen.value = false
    searchQuery.value = ''
  }
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
      if (highlightedId.value === '__custom__') {
        selectCustomValue()
      } else if (highlightedId.value) {
        selectOption(highlightedId.value)
      } else if (searchQuery.value.trim()) {
        // Allow free-text input: press Enter with no highlight to use typed value
        selectCustomValue()
      }
      break
  }
}

function navigateOptions(direction: number) {
  const options = filteredOptions.value
  const hasCustomOption = searchQuery.value.trim().length > 0
  if (options.length === 0 && !hasCustomOption) return

  // Build a combined list of IDs for navigation: filtered options + custom option
  const allIds: string[] = options.map(o => o.id)
  if (hasCustomOption) allIds.push('__custom__')

  const currentIndex = allIds.indexOf(highlightedId.value ?? '')
  let newIndex = currentIndex + direction

  if (newIndex < 0) newIndex = allIds.length - 1
  if (newIndex >= allIds.length) newIndex = 0

  highlightedId.value = allIds[newIndex]

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
  background: var(--surface-soft);
  border: 1px solid var(--border-default);
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
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  flex-shrink: 0;
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
  border: 1px solid var(--border-default);
  border-radius: 8px;
  box-shadow: var(--shadow-xl);
  z-index: 100;
  overflow: hidden;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-default);
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

.custom-input-option {
  border-top: 1px solid var(--border-default);
  font-style: italic;

  .option-label {
    color: var(--accent-primary);
  }
}

.option-label {
  flex: 1;
  min-width: 0;
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

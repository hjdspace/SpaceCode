<template>
  <Transition name="dropdown">
    <div
      v-if="visible"
      class="context-menu"
      :style="position"
      v-click-outside="() => $emit('close')"
    >
      <div class="dropdown-search-box">
        <Search :size="14" class="search-icon" />
        <input
          ref="searchInputRef"
          :value="searchQuery"
          type="text"
          :placeholder="t('chatInput.searchFiles')"
          tabindex="-1"
          @input="$emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
        />
        <button v-if="searchQuery" class="clear-btn" @click="$emit('clearSearch')">
          <X :size="12" />
        </button>
      </div>
      <div class="dropdown-section-title">{{ t('chatInput.addContext') }}</div>
      <div class="dropdown-list" ref="listRef">
        <div v-if="isLoading" class="dropdown-loading">
          <Loader2 :size="16" class="spin" />
          <span>{{ t('chatInput.searching') }}</span>
        </div>
        <div v-else-if="items.length === 0" class="dropdown-empty">
          <span>{{ t('chatInput.noMatchingFiles') }}</span>
        </div>
        <button
          v-for="item in items"
          :key="item.path"
          class="dropdown-item"
          :class="{ highlighted: highlightedItem === item.path }"
          @click="$emit('select', item)"
          @mouseenter="$emit('navigate', item.path)"
        >
          <component
            :is="item.type === 'directory' ? Folder : FileText"
            :size="16"
            class="item-icon"
            :class="{ 'is-folder': item.type === 'directory' }"
          />
          <div class="item-content">
            <span class="item-name">{{ item.name }}</span>
            <span class="item-path">{{ item.relativePath }}</span>
          </div>
        </button>
      </div>
      <div class="dropdown-section-divider"></div>
      <button class="dropdown-footer-item" @click="$emit('browseFiles')">
        <FolderOpen :size="14" class="item-icon" />
        <span>{{ t('chatInput.browseFiles') }}</span>
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Search, X, Loader2, FileText, Folder, FolderOpen } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { vClickOutside } from '@/directives/vClickOutside'
import type { ContextItem } from '@/composables/useContextMenu'

defineProps<{
  visible: boolean
  position: { top?: string; bottom?: string; left: string }
  searchQuery: string
  items: ContextItem[]
  highlightedItem: string | null
  isLoading: boolean
}>()

defineEmits<{
  select: [item: ContextItem]
  navigate: [path: string]
  close: []
  'update:searchQuery': [value: string]
  clearSearch: []
  browseFiles: []
}>()

const { t } = useI18n()

const searchInputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

defineExpose({ searchInputRef, listRef })
</script>

<style lang="scss" scoped>
.context-menu {
  position: fixed;
  width: 320px;
  max-height: 320px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.16);
  z-index: 1000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dropdown-search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--bg-secondary);

  .search-icon {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: var(--font-size-base);
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
    border-radius: var(--radius-xs);

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
  }
}

.dropdown-section-title {
  padding: 8px 16px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  background: var(--bg-secondary);
}

.dropdown-list {
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
}

.dropdown-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
}

.dropdown-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
}

.dropdown-section-divider {
  height: 1px;
  background: var(--surface-border);
  margin: 4px 0;
}

.dropdown-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 16px;
  text-align: left;
  width: 100%;
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  transition: all var(--transition-fast);

  &:hover,
  &.highlighted {
    background: var(--surface-hover);
  }

  .item-icon {
    color: var(--text-secondary);
    flex-shrink: 0;
    margin-top: 2px;

    &.is-folder {
      color: var(--accent-primary);
    }
  }

  .item-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .item-name {
    font-weight: 500;
    color: var(--text-primary);
  }

  .item-path {
    font-size: 12px;
    color: var(--text-muted);
    @include truncate;
  }
}

.dropdown-footer-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  background: transparent;
  transition: all var(--transition-fast);
  text-align: left;

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .item-icon {
    color: var(--accent-primary);
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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

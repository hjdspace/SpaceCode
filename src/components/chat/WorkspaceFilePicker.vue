<template>
  <div class="workspace-picker" data-testid="workspace-picker">
    <div class="picker-search">
      <Search :size="14" class="search-icon" />
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        data-testid="workspace-search"
        type="text"
        :placeholder="t('chatInput.searchWorkspaceFiles')"
        @keydown.esc="$emit('close')"
      />
      <button v-if="searchQuery" class="clear-btn" @click="clearSearch">
        <X :size="12" />
      </button>
    </div>

    <button v-if="canGoUp && !isSearching" data-testid="workspace-back" class="picker-row picker-back-row" @click="goUp">
      <ChevronLeft :size="14" class="row-expander" />
      <span class="row-name">{{ t('chatInput.backToParentDir') }}</span>
    </button>

    <div class="picker-list">
      <div v-if="isLoading" class="picker-status">
        <Loader2 :size="16" class="spin" />
      </div>
      <div v-else-if="visibleEntries.length === 0" class="picker-status">
        <span>{{ emptyLabel }}</span>
      </div>
      <div
        v-for="entry in visibleEntries"
        :key="entry.path"
        data-testid="workspace-row"
        class="picker-row"
        @click="handleRowClick(entry)"
      >
        <ChevronRight v-if="entry.isDirectory" :size="14" class="row-expander" />
        <span v-else class="row-expander"></span>
        <component
          :is="entry.isDirectory ? Folder : FileText"
          :size="15"
          class="row-icon"
          :class="{ 'is-folder': entry.isDirectory }"
        />
        <span class="row-name">{{ entry.name }}</span>
        <span v-if="isSearching" class="row-path">{{ entry.relativePath }}</span>
        <button
          v-if="entry.isDirectory"
          data-testid="workspace-add"
          class="row-add"
          :title="t('chatInput.addToContext')"
          @click.stop="addEntry(entry)"
        >
          <Plus :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, FileText, Folder, Loader2, Plus, Search, X } from 'lucide-vue-next'
import { useWorkspaceBrowser, type WorkspaceEntry } from '@/composables/useWorkspaceBrowser'
import { useAppStore } from '@/stores/app'

const props = defineProps<{
  rootDir: string
}>()

const emit = defineEmits<{
  add: [entry: WorkspaceEntry]
  close: []
}>()

const { t } = useI18n()
const appStore = useAppStore()
const searchInputRef = ref<HTMLInputElement | null>(null)

const {
  visibleEntries, searchQuery, isLoading, isSearching, canGoUp,
  open, enter, goUp, clearSearch,
} = useWorkspaceBrowser({
  rootDir: () => props.rootDir,
  showHiddenFiles: () => appStore.showHiddenFiles,
})

const emptyLabel = computed(() => {
  if (isSearching.value) return t('chatInput.noMatchingFiles')
  if (!props.rootDir) return t('fileTree.selectFolder')
  return t('fileTree.noFiles')
})

function addEntry(entry: WorkspaceEntry) {
  emit('add', entry)
  emit('close')
}

function handleRowClick(entry: WorkspaceEntry) {
  if (enter(entry)) return
  addEntry(entry)
}

onMounted(() => {
  open()
  nextTick(() => searchInputRef.value?.focus())
})
</script>

<style lang="scss" scoped>
.workspace-picker {
  display: flex;
  flex-direction: column;
  width: 280px;
  max-height: 340px;
  overflow: hidden;
}

.picker-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--bg-secondary);
  flex-shrink: 0;

  .search-icon {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: var(--text-md);
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

.picker-list {
  overflow-y: auto;
  @include scrollbar-overlay;
  padding: 4px;
}

.picker-status {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  color: var(--text-muted);
  font-size: var(--text-md);
  text-align: center;
  padding: 0 8px;
}

.picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-md);
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-hover);

    .row-add {
      opacity: 1;
    }
  }

  &.picker-back-row {
    color: var(--text-secondary);
    border-bottom: 1px solid var(--surface-border);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    margin-bottom: 4px;
  }

  .row-expander {
    flex-shrink: 0;
    width: 14px;
    color: var(--text-muted);
  }

  .row-icon {
    flex-shrink: 0;
    color: var(--text-secondary);

    &.is-folder {
      color: var(--accent-primary);
    }
  }

  .row-name {
    @include truncate;
    font-weight: 500;
  }

  .row-path {
    @include truncate;
    flex: 1;
    min-width: 0;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    text-align: right;
  }

  .row-add {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-left: auto;
    padding: 2px 4px;
    border: none;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--transition-fast), background var(--transition-fast);

    &:hover {
      background: var(--surface-active);
      color: var(--accent-primary);
    }
  }
}

.spin {
  animation: picker-spin 1s linear infinite;
}

@keyframes picker-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>

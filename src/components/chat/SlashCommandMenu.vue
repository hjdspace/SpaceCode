<template>
  <Transition name="dropdown">
    <div
      v-if="visible"
      class="slash-command-menu"
      :style="position"
      v-click-outside="() => $emit('close')"
    >
      <div class="dropdown-search-box">
        <Search :size="14" class="search-icon" />
        <input
          ref="searchInputRef"
          :value="searchQuery"
          type="text"
          :placeholder="t('chatInput.searchCommands')"
          tabindex="-1"
          @input="$emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
        />
        <span v-if="ghostText" class="ghost-text">{{ ghostText.suffix }}</span>
        <button v-if="searchQuery" class="clear-btn" @click="$emit('clearSearch')">
          <X :size="12" />
        </button>
      </div>
      <div class="dropdown-section-title">{{ t('chatInput.commands') }}</div>
      <div class="dropdown-list" ref="listRef">
        <div v-if="commands.length === 0" class="dropdown-empty">
          <span>{{ t('chatInput.noMatchingCommands') }}</span>
        </div>
        <button
          v-for="(cmd, idx) in commands"
          :key="cmd.name"
          class="dropdown-item"
          :class="{ highlighted: highlightedCommand === cmd.name }"
          @click="$emit('select', cmd)"
          @mouseenter="$emit('navigate', idx)"
        >
          <component :is="cmd.icon" :size="16" class="item-icon" />
          <div class="item-content">
            <span class="item-name">{{ cmd.name }}</span>
            <span class="item-description">{{ cmd.description }}</span>
          </div>
          <span v-if="cmd.kind === 'agent_skill'" class="item-badge skill">{{ t('chatInput.skillLabel') }}</span>
          <span v-else-if="cmd.kind === 'sdk_command'" class="item-badge sdk">SDK</span>
          <span v-else-if="cmd.kind === 'mcp_tool'" class="item-badge mcp">MCP</span>
        </button>
      </div>
      <div class="dropdown-section-divider"></div>
      <button class="dropdown-footer-item" @click="$emit('openSkillsManager')">
        <Zap :size="14" class="item-icon" />
        <span>{{ t('chatInput.manageSkills') }}</span>
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Search, X, Zap } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { vClickOutside } from '@/directives/vClickOutside'
import type { SlashCommand } from '@/composables/useSlashCommands'

defineProps<{
  visible: boolean
  position: { top?: string; bottom?: string; left: string }
  searchQuery: string
  ghostText: { suffix: string } | null
  commands: SlashCommand[]
  highlightedCommand: string | null
  isLoading?: boolean
}>()

defineEmits<{
  select: [cmd: SlashCommand]
  navigate: [index: number]
  close: []
  'update:searchQuery': [value: string]
  clearSearch: []
  openSkillsManager: []
}>()

const { t } = useI18n()

const searchInputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

defineExpose({ searchInputRef, listRef })
</script>

<style lang="scss" scoped>
.slash-command-menu {
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

  .ghost-text {
    color: var(--text-muted);
    font-size: var(--font-size-base);
    opacity: 0.5;
    pointer-events: none;
    white-space: nowrap;
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

  .item-description {
    font-size: 12px;
    color: var(--text-muted);
    @include truncate;
  }

  .item-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    flex-shrink: 0;

    &.skill {
      background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
      color: var(--accent-primary);
    }

    &.sdk {
      background: color-mix(in srgb, var(--text-secondary) 15%, transparent);
      color: var(--text-secondary);
    }

    &.mcp {
      background: color-mix(in srgb, #f59e0b 15%, transparent);
      color: #f59e0b;
    }
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

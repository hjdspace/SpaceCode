<template>
  <Transition name="preset-slide">
    <div v-if="visible" class="preset-dropdown">
      <div class="preset-dropdown-header">
        <span class="preset-dropdown-title">{{ $t('auth.presetProviders') }}</span>
        <button class="preset-close-btn" @click="$emit('close')">
          <X :size="14" />
        </button>
      </div>
      <div class="preset-list">
        <div
          v-for="p in presets"
          :key="p.id"
          class="preset-item"
          :class="{ selected: selectedId === p.id }"
          @click="selectPreset(p)"
        >
          <div class="provider-logo" :class="p.logoClass">
            <div v-if="p.logoType === 'svgRaw'" class="logo-svg" v-html="p.svgRaw" />
            <img v-else-if="p.logoType === 'img'" :src="p.logoSrc" class="logo-img" alt="logo" />
          </div>
          <div class="preset-item-info">
            <div class="preset-item-name">
              {{ p.name }}
              <span v-if="p.badge" class="preset-item-badge" :class="p.badgeType">
                {{ badgeLabel(p.badgeType) }}
              </span>
            </div>
            <div class="preset-item-url">{{ p.baseUrl }}</div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { ProviderPreset } from '@/lib/providerPresets'

const { t } = useI18n()

defineProps<{
  visible: boolean
  presets: ProviderPreset[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [provider: ProviderPreset]
  close: []
}>()

function selectPreset(provider: ProviderPreset) {
  emit('select', provider)
  emit('close')
}

function badgeLabel(badgeType: string | null): string {
  if (badgeType === 'recommended') return t('auth.badgeRecommended')
  if (badgeType === 'official') return t('auth.badgeOfficial')
  return ''
}
</script>

<style lang="scss" scoped>
.preset-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.preset-dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-soft);
}

.preset-dropdown-title {
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.preset-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.preset-list {
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--border-default);
    border-radius: 3px;
  }
}

.preset-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-soft);
  }

  &.selected {
    background: var(--accent-primary-glow);
  }
}

.provider-logo {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--bg-elevated);
  color: var(--text-primary);

  .logo-svg {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;

    svg {
      width: 16px;
      height: 16px;
    }
  }

  .logo-img {
    width: 18px;
    height: 18px;
    object-fit: contain;
  }
}

/* Brand colors for currentColor-based SVG icons */
:deep(.brand-anthropic) { color: #cc785c; }

.preset-item-info {
  flex: 1;
  min-width: 0;
}

.preset-item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.preset-item-badge {
  font-size: 9.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  text-transform: uppercase;
  letter-spacing: 0.03em;

  &.recommended {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }

  &.official {
    background: var(--success-glow);
    color: var(--success);
  }
}

.preset-item-url {
  font-size: 11.5px;
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Transition */
.preset-slide-enter-active,
.preset-slide-leave-active {
  transition: all var(--transition-fast);
}

.preset-slide-enter-from,
.preset-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>

<template>
  <div class="titlebar" :class="{ 'is-mac': isMac, 'is-windows': isWindows }">
    <!-- macOS: left spacer for traffic lights -->
    <div v-if="isMac" class="titlebar-traffic-lights-spacer"></div>

    <!-- Left section -->
    <div class="titlebar-left" style="-webkit-app-region: no-drag">
      <button class="sidebar-toggle" @click="appStore.toggleSidebar" :title="t('titleBar.toggleSidebar')">
        <Menu :size="16" />
      </button>
      <div class="title-wrapper">
        <span class="title">SpaceCode</span>
      </div>

      <!-- Session title (when in a session) -->
      <template v-if="chatStore.currentSession?.title && chatStore.currentSession.title !== t('common.newChat')">
        <span class="title-separator">/</span>
        <span class="session-title">{{ chatStore.currentSession.title }}</span>
      </template>
    </div>

    <!-- Center: drag region spacer -->
    <div class="titlebar-center"></div>

    <!-- Right section -->
    <div class="titlebar-right" style="-webkit-app-region: no-drag">
      <!-- Theme toggle -->
      <button class="titlebar-btn" @click="appStore.toggleTheme" :title="themeTooltip">
        <Sun v-if="appStore.isDark" :size="15" />
        <Moon v-else :size="15" />
      </button>

      <!-- Windows: spacer for system overlay controls (min/max/close ~138px) -->
      <div v-if="isWindows" class="windows-controls-spacer"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useI18n } from 'vue-i18n'
import { Menu, Sun, Moon } from 'lucide-vue-next'
import { computed } from 'vue'
import type { ThemeId } from '@/stores/app'

const appStore = useAppStore()
const chatStore = useChatStore()
const { t } = useI18n()

const THEME_LABELS: Record<ThemeId, string> = {
  light: t('titleBar.lightMode'),
  dark: t('titleBar.darkMode'),
  anthropic: t('titleBar.anthropicMode'),
  'anthropic-dark': t('titleBar.anthropicDarkMode')
}

const themeTooltip = computed(() => {
  const currentIndex = (['light', 'dark', 'anthropic', 'anthropic-dark'] as ThemeId[]).indexOf(appStore.theme)
  const nextIndex = (currentIndex + 1) % 4
  const nextTheme = (['light', 'dark', 'anthropic', 'anthropic-dark'] as ThemeId[])[nextIndex]
  return `Switch to ${THEME_LABELS[nextTheme]}`
})

const platform = typeof window !== 'undefined' && window.electronAPI?.platform
  ? window.electronAPI.platform
  : (typeof navigator !== 'undefined' ? navigator.platform : '')

const isMac = platform === 'darwin' || /^Mac/i.test(platform)
const isWindows = platform === 'win32' || /^Win/i.test(platform)
</script>

<style lang="scss" scoped>
.titlebar {
  height: 44px;
  background: var(--surface-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--surface-border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  -webkit-app-region: drag;
  position: relative;
  z-index: 100;
  user-select: none;
  flex-shrink: 0;

  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg,
      transparent 0%,
      var(--accent-primary-glow) 20%,
      var(--accent-secondary-glow) 50%,
      var(--accent-primary-glow) 80%,
      transparent 100%
    );
    opacity: 0.5;
  }

  // macOS: shift content right to avoid traffic lights
  &.is-mac {
    padding-left: 78px; // Space for close/minimize/maximize buttons
  }

  // Windows: add right padding for overlay controls
  &.is-windows {
    padding-right: 0; // Overlay controls handle their own padding
  }
}

// macOS traffic lights area spacer (when not using hiddenInset padding)
.titlebar-traffic-lights-spacer {
  display: none; // hiddenInset handles spacing automatically
}

.titlebar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;

  .sidebar-toggle {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: transparent;
    border: none;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all var(--transition-fast);

    &:hover {
      background: var(--surface-glass-hover);
      color: var(--text-primary);
      transform: scale(1.05);
    }

    &:active {
      transform: scale(0.95);
    }
  }

  .title-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .title {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 600;
    background: linear-gradient(135deg, var(--text-primary), var(--text-secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    white-space: nowrap;
  }

  .title-separator {
    color: var(--text-muted);
    font-size: 12px;
    opacity: 0.5;
    flex-shrink: 0;
  }

  .session-title {
    font-size: 13px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
}

.titlebar-center {
  flex: 1;
  min-width: 20px;
}

.titlebar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.titlebar-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: transparent;
  border: none;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--accent-secondary);
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }
}

// Windows: spacer for system overlay window controls (min/max/close)
.windows-controls-spacer {
  width: 138px;
  flex-shrink: 0;
}
</style>

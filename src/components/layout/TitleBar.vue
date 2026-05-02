<template>
  <div class="titlebar">
    <div class="titlebar-left">
      <button class="sidebar-toggle" @click="appStore.toggleSidebar">
        <Menu :size="16" />
      </button>
      <div class="title-wrapper">
        <span class="title">SpaceCode</span>
        <span class="title-badge">Desktop</span>
      </div>
    </div>
    <div class="titlebar-center"></div>
    <div class="titlebar-right">
      <button class="theme-toggle" @click="appStore.toggleTheme">
        <Sun v-if="appStore.isDark" :size="16" />
        <Moon v-else :size="16" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import { Menu, Sun, Moon } from 'lucide-vue-next'

const appStore = useAppStore()
</script>

<style lang="scss" scoped>
.titlebar {
  height: 40px;
  background: var(--surface-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--surface-border);
  @include flex-between;
  padding: 0 16px;
  -webkit-app-region: drag;
  position: relative;
  z-index: 100;
  
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
  
  button {
    -webkit-app-region: no-drag;
  }
}

.titlebar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  
  .sidebar-toggle {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    @include flex-center;
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
  }
  
  .title-badge {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    color: white;
  }
}

.titlebar-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.titlebar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  
  .theme-toggle {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    @include flex-center;
    transition: all var(--transition-fast);
    
    &:hover {
      background: var(--surface-glass-hover);
      color: var(--accent-secondary);
      transform: scale(1.05) rotate(15deg);
    }
    
    &:active {
      transform: scale(0.95);
    }
  }
}
</style>

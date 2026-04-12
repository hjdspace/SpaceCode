<template>
  <div class="session-list">
    <div
      v-for="(session, index) in sessions"
      :key="session.id"
      class="session-item"
      :class="{ active: session.id === activeId }"
      @click="$emit('select', session.id)"
    >
      <div class="session-icon">
        <MessageSquare :size="14" />
      </div>
      <span class="session-title">{{ session.title }}</span>
      <button 
        class="delete-btn" 
        @click.stop="$emit('delete', session.id)"
        title="Delete session"
      >
        <Trash2 :size="12" />
      </button>
    </div>
    
    <div v-if="sessions.length === 0" class="empty-hint">
      <div class="empty-icon">
        <Inbox :size="24" />
      </div>
      <span>No conversations yet</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Session } from '@/types'
import { MessageSquare, Trash2, Inbox } from 'lucide-vue-next'

defineProps<{
  sessions: Session[]
  activeId?: string
}>()

defineEmits<{
  select: [id: string]
  delete: [id: string]
}>()
</script>

<style lang="scss" scoped>
.session-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
  
  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 0;
    background: var(--accent-primary);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    transition: height var(--transition-fast);
  }
  
  &:hover {
    background: var(--surface-glass-hover);
    
    .delete-btn {
      opacity: 1;
    }
    
    &::before {
      height: 16px;
    }
  }
  
  &.active {
    background: var(--surface-glass-active);
    
    .session-title {
      color: var(--text-primary);
      font-weight: 500;
    }
    
    .session-icon {
      color: var(--accent-primary);
    }
    
    &::before {
      height: 24px;
      box-shadow: 0 0 8px var(--accent-primary-glow);
    }
  }
  
  .session-icon {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    background: var(--surface-glass);
    @include flex-center;
    color: var(--text-muted);
    flex-shrink: 0;
    transition: all var(--transition-fast);
  }
  
  .session-title {
    flex: 1;
    font-size: 13px;
    color: var(--text-secondary);
    @include truncate;
  }
  
  .delete-btn {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    @include flex-center;
    opacity: 0;
    transition: all var(--transition-fast);
    
    &:hover {
      color: var(--error);
      background: var(--error-glow);
    }
    
    &:active {
      transform: scale(0.9);
    }
  }
}

.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  
  .empty-icon {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-lg);
    background: var(--surface-glass);
    @include flex-center;
    color: var(--text-muted);
    margin-bottom: 12px;
  }
  
  span {
    font-size: 12px;
    color: var(--text-muted);
  }
}
</style>

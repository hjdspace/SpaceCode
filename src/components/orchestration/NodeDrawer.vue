<template>
  <div
    v-if="sessionId"
    class="node-drawer-backdrop"
    @click="onBackdropClick"
  >
    <div
    class="node-drawer"
    >
    <div class="node-drawer-body" @click.stop>
      <!-- 抽屉头部 -->
      <div class="node-drawer-header">
        <span class="node-drawer-title">{{ t('orchestration.drawerTitle') }}</span>
        <button
          class="node-drawer-close"
          :title="t('orchestration.closeDrawer')"
          @click="onClose"
        >
          <X :size="18" />
        </button>
      </div>

      <!-- 全尺寸 ChatPanel — 可正常发消息聊天 -->
      <div class="node-drawer-content">
        <ChatPanel :session-id="sessionId" />
      </div>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import ChatPanel from '@/components/layout/ChatPanel.vue'

const props = defineProps<{
  sessionId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()

function onClose() {
  emit('close')
}

function onBackdropClick() {
  emit('close')
}
</script>

<style lang="scss" scoped>
.node-drawer-backdrop {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

.node-drawer {
  width: 80%;
  height: 85%;
  max-width: 1200px;
  max-height: 800px;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary, #1a1a2e);
  border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.1));
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.node-drawer-body {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.node-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));
  background: var(--surface-glass, rgba(30, 30, 46, 0.9));
  flex-shrink: 0;
}

.node-drawer-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #e0e0e0);
}

.node-drawer-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-muted, #888);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--text-primary, #e0e0e0);
    background: var(--surface-glass-hover, rgba(255, 255, 255, 0.08));
  }
}

.node-drawer-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>

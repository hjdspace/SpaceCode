<template>
  <Transition name="drawer-slide">
    <div
      v-if="sessionId"
      class="node-drawer-backdrop"
      @click="onBackdropClick"
    >
      <div class="node-drawer" @click.stop>
        <!-- 抽屉头部 -->
        <div class="node-drawer-header">
          <div class="node-drawer-header-left">
            <span class="node-drawer-title">{{ t('orchestration.drawerTitle') }}</span>
            <!-- 节点状态徽标 -->
            <span v-if="nodeStatus" class="node-drawer-status-badge" :class="`badge-${nodeStatus}`">
              {{ t(`orchestration.status_${nodeStatus}`) }}
            </span>
            <!-- 权限徽标 -->
            <span
              v-if="hasPendingPermission"
              class="node-drawer-perm-badge"
              :title="t('orchestration.permissionPending')"
            >
              <ShieldAlert :size="14" />
            </span>
          </div>
          <div class="node-drawer-header-actions">
            <!-- 停止按钮（running 时） -->
            <button
              v-if="nodeStatus === 'running'"
              class="drawer-stop-btn"
              :title="t('orchestration.stopNode')"
              @click="$emit('stop-node')"
            >
              <SquareIcon :size="14" />
              <span>{{ t('orchestration.stopNode') }}</span>
            </button>
            <!-- 重试按钮（failed / interrupted 时） -->
            <button
              v-if="nodeStatus === 'failed' || nodeStatus === 'interrupted'"
              class="drawer-retry-btn"
              :title="t('orchestration.retryNode')"
              @click="$emit('retry-node')"
            >
              <RotateCcw :size="14" />
              <span>{{ t('orchestration.retryNode') }}</span>
            </button>
            <button
              class="node-drawer-close"
              :title="t('orchestration.closeDrawer')"
              @click="onClose"
            >
              <X :size="18" />
            </button>
          </div>
        </div>

        <!-- 全尺寸 ChatPanel — 可正常发消息聊天，查看完整流式输出 -->
        <div class="node-drawer-content">
          <ChatPanel :session-id="sessionId" :pane-tab-id="`session-${sessionId}`" />
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { X, Square as SquareIcon, RotateCcw, ShieldAlert } from 'lucide-vue-next'
import ChatPanel from '@/components/layout/ChatPanel.vue'
import type { NodeStatus } from '@/stores/orchestration/types'

defineProps<{
  sessionId: string
  /** 节点当前状态（用于在抽屉头部显示状态徽标） */
  nodeStatus?: NodeStatus
  /** 节点是否有待处理权限请求 */
  hasPendingPermission?: boolean
}>()

const emit = defineEmits<{
  close: []
  'stop-node': []
  'retry-node': []
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
  width: 90%;
  height: 90%;
  max-width: 1400px;
  max-height: 900px;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary, #1a1a2e);
  border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.1));
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
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

.node-drawer-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.node-drawer-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #e0e0e0);
}

.node-drawer-status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;

  &.badge-pending {
    color: var(--text-muted, #888);
    background: rgba(128, 128, 128, 0.15);
  }

  &.badge-running {
    color: #fff;
    background: var(--accent-primary, #6366f1);
    animation: pulse 1.5s ease-in-out infinite;
  }

  &.badge-settled {
    color: #fff;
    background: #22c55e;
  }

  &.badge-failed {
    color: #fff;
    background: var(--danger, #ef4444);
  }

  &.badge-skipped {
    color: var(--text-muted, #888);
    background: rgba(128, 128, 128, 0.2);
    text-decoration: line-through;
  }

  &.badge-interrupted {
    color: #fff;
    background: #f59e0b;
  }

  &.badge-queued {
    color: #fff;
    background: #f59e0b;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.node-drawer-perm-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 6px;
  border-radius: 4px;
  color: #f59e0b;
  background: color-mix(in srgb, #f59e0b 15%, transparent);
  animation: pulse 1.5s ease-in-out infinite;
}

.node-drawer-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drawer-stop-btn,
.drawer-retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}

.drawer-stop-btn {
  color: var(--danger, #ef4444);
  background: transparent;

  &:hover {
    background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
  }
}

.drawer-retry-btn {
  color: var(--accent-primary, #6366f1);
  background: transparent;

  &:hover {
    background: color-mix(in srgb, var(--accent-primary, #6366f1) 12%, transparent);
  }
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

// ── 过渡动画 ──
.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: opacity 0.25s ease;

  .node-drawer {
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
  }
}

.drawer-slide-enter-from,
.drawer-slide-leave-to {
  opacity: 0;

  .node-drawer {
    transform: scale(0.95) translateY(10px);
    opacity: 0;
  }
}
</style>

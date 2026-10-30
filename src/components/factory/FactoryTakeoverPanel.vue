<template>
  <div
    class="factory-overlay"
    role="dialog"
    aria-modal="true"
    :aria-label="task.title"
    data-takeover-panel
    @click.self="emit('close')"
  >
    <div class="takeover-panel">
      <header class="takeover-head">
        <span class="chip tag" data-takeover-tag>{{ t('factory.cardTakeover') }}</span>
        <div class="head-title">
          <h2 data-takeover-title>{{ task.title }}</h2>
          <p class="head-meta" data-takeover-branch>
            <GitBranch :size="11" />
            <span>{{ task.branch }}</span>
            <Folder :size="11" />
            <span>{{ task.worktree }}</span>
          </p>
        </div>
        <span class="head-spacer" />
        <span class="chip paused" data-takeover-paused>
          <Pause :size="11" />
          {{ t('factory.takeoverPanel.paused') }}
        </span>
        <button
          class="icon-btn"
          :aria-label="t('factory.takeoverPanel.close')"
          data-takeover-close
          @click="emit('close')"
        >
          <X :size="16" />
        </button>
      </header>

      <p v-if="task.goal" class="takeover-goal" data-takeover-goal>{{ task.goal }}</p>

      <!-- 接管会话就是一条普通聊天会话：历史、流式回复、工具与权限确认全部沿用现有链路。 -->
      <div class="takeover-chat">
        <ChatPanel :session-id="sessionId" compact />
      </div>

      <footer class="takeover-foot">
        <div class="foot-note">
          <p>{{ t('factory.takeoverPanel.footnote') }}</p>
          <p v-if="verifyFailed" class="warn" data-takeover-verify-failed>
            {{ t('factory.takeoverPanel.verifyFailed') }}
          </p>
        </div>
        <button class="primary-btn" :disabled="returning" data-takeover-return @click="emit('return')">
          <CornerUpLeft :size="12" />
          {{ returning ? t('factory.actions.returning') : t('factory.actions.return') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CornerUpLeft, Folder, GitBranch, Pause, X } from 'lucide-vue-next'
import type { FactoryTask } from '@/shared/factory'
import ChatPanel from '@/components/layout/ChatPanel.vue'

const props = withDefaults(
  defineProps<{
    task: FactoryTask
    /** 交回动作在途：按钮只允许一次请求。 */
    returning?: boolean
    /** 交回时重跑验证未过：任务仍是接管中，面板解释原因。 */
    verifyFailed?: boolean
  }>(),
  { returning: false, verifyFailed: false },
)

const emit = defineEmits<{
  close: []
  return: []
}>()

const { t } = useI18n()

const sessionId = computed(() => props.task.takeover?.sessionId ?? '')
</script>

<style lang="scss" scoped>
.factory-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.takeover-panel {
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  height: min(680px, 100%);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-secondary, #1a1a2e);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.takeover-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--surface-border);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;

  &.tag {
    background: var(--accent-soft, rgba(99, 102, 241, 0.16));
    color: var(--accent, #818cf8);
  }

  // 后台已暂停是面板要传达的第一件事，用中性实底而不是又一层浅色描边。
  &.paused {
    background: var(--text-primary);
    color: var(--bg-secondary, #1a1a2e);
    font-weight: 600;
  }
}

.head-title {
  min-width: 0;

  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.head-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 3px 0 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--text-muted);

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.head-spacer {
  flex: 1;
}

.icon-btn {
  display: inline-flex;
  padding: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }
}

.takeover-goal {
  flex-shrink: 0;
  margin: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--surface-border);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.takeover-chat {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.takeover-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--surface-border);
}

.foot-note {
  p {
    margin: 0;
    font-size: 11.5px;
    color: var(--text-muted);
  }

  .warn {
    margin-top: 4px;
    color: var(--warning, #f59e0b);
  }
}

.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: var(--accent, #6366f1);
  color: #fff;
  font-size: 12px;
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
}
</style>

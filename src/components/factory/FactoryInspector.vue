<template>
  <aside class="factory-inspector">
    <div v-if="!task" class="ins-empty" data-inspector-empty>
      <Layers :size="26" />
      <p>{{ t('factory.inspector.empty') }}</p>
    </div>

    <template v-else>
      <header class="ins-head">
        <div class="ins-top">
          <span v-if="task.issueNumber !== undefined" class="ins-num">#{{ task.issueNumber }}</span>
          <span v-else class="ins-num">{{ t('factory.cardLocal') }}</span>
          <span class="ins-chip" data-inspector-status>
            {{ status.params ? t(status.key, status.params) : t(status.key) }}
          </span>
        </div>

        <h2 class="ins-title" data-inspector-title>{{ task.title }}</h2>

        <div class="ins-meta">
          <div class="meta-row">
            <GitBranch :size="12" />
            <code>{{ task.branch }}</code>
          </div>
          <div class="meta-row">
            <Folder :size="12" />
            <code :class="{ pending: !task.worktree }">
              {{ task.worktree || t('factory.inspector.worktreePending') }}
            </code>
            <button
              v-if="task.worktree"
              class="reveal-btn"
              data-reveal-worktree
              :title="t('factory.inspector.revealWorktree')"
              @click="emit('reveal')"
            >
              {{ t('factory.inspector.revealWorktree') }}
            </button>
          </div>
          <div class="meta-row">
            <Cpu :size="12" />
            <code>{{ task.model || t('factory.modelUnknown') }}</code>
          </div>
        </div>

        <div class="railsteps">
          <div
            v-for="(step, index) in FACTORY_STEPS"
            :key="step"
            class="step"
            :class="visual[index]"
            :data-step="step"
          >
            <span class="sdot">
              <Check v-if="visual[index] === 'done'" :size="10" />
              <X v-else-if="visual[index] === 'blocked'" :size="10" />
            </span>
            <span class="slabel">{{ t(`factory.steps.${step}`) }}</span>
          </div>
        </div>

        <nav class="tabs">
          <button
            v-for="item in FACTORY_INSPECTOR_TABS"
            :key="item.key"
            class="itab"
            :class="{ active: item.key === tab }"
            :data-inspector-tab="item.key"
            @click="emit('select-tab', item.key)"
          >
            {{ t(item.labelKey) }}
          </button>
        </nav>
      </header>

      <div class="ins-body">
        <template v-if="tab === 'overview'">
          <section class="section">
            <h4>{{ t('factory.inspector.goal') }}</h4>
            <p class="goal">{{ task.goal || t('factory.inspector.goalEmpty') }}</p>
          </section>

          <section class="section">
            <h4>{{ t('factory.inspector.thisRun') }}</h4>
            <div class="metrics">
              <div class="metric">
                <span>{{ t('factory.inspector.changes') }}</span>
                <b>+{{ task.diff.additions }} −{{ task.diff.deletions }}</b>
              </div>
              <div class="metric">
                <span>{{ t('factory.inspector.elapsed') }}</span>
                <b>{{ formatClock(elapsedMs) }}</b>
              </div>
              <div v-if="task.usage" class="metric" data-inspector-usage>
                <span>{{ t('factory.inspector.tokens') }}</span>
                <b>↑{{ task.usage.inputTokens }} ↓{{ task.usage.outputTokens }}</b>
              </div>
            </div>
          </section>

          <section class="section">
            <h4>{{ t('factory.inspector.artifacts') }}</h4>
            <div class="kv">
              <span>{{ t('factory.inspector.branch') }}</span>
              <b>{{ task.branch }}</b>
            </div>
            <div class="kv">
              <span>{{ t('factory.inspector.worktree') }}</span>
              <b>{{ task.worktree || t('factory.inspector.worktreePending') }}</b>
            </div>
            <div class="kv">
              <span>{{ t('factory.inspector.engine') }}</span>
              <b>{{ task.model || t('factory.modelUnknown') }}</b>
            </div>
            <div class="kv">
              <span>{{ t('factory.inspector.verify') }}</span>
              <b v-if="task.tests" :class="task.tests.status === 'pass' ? 'ok' : 'bad'" data-inspector-tests>
                {{ t(`factory.tests.status.${task.tests.status}`) }}
              </b>
              <b v-else class="muted">{{ t('factory.inspector.pending') }}</b>
            </div>
            <div class="kv">
              <span>{{ t('factory.inspector.review') }}</span>
              <b
                v-if="review"
                :class="review.verdict === 'approved' ? 'ok' : 'bad'"
                data-inspector-review
              >
                {{ t(`factory.review.verdict.${review.verdict}`) }}
              </b>
              <b v-else class="muted">{{ t('factory.inspector.reviewPending') }}</b>
            </div>
          </section>

          <section v-if="timestamps.length" class="section">
            <h4>{{ t('factory.inspector.timestamps') }}</h4>
            <div v-for="entry in timestamps" :key="entry.key" class="kv">
              <span>{{ t(entry.labelKey) }}</span>
              <b>{{ formatTimestamp(entry.value) }}</b>
            </div>
          </section>
        </template>

        <template v-else-if="tab === 'events'">
          <div v-if="eventsLoading" class="ins-empty" data-events-loading>
            <Loader2 :size="20" class="spin" />
            <p>{{ t('factory.loading') }}</p>
          </div>
          <div v-else-if="eventsError" class="ins-empty" data-events-error>
            <AlertTriangle :size="20" />
            <p>{{ t('factory.events.loadFailed') }}</p>
          </div>
          <ol v-else-if="events.length" class="event-list" data-event-list>
            <li
              v-for="event in events"
              :key="event.seq"
              class="event-row"
              :class="event.level"
              :data-event-code="event.code"
            >
              <time>{{ formatTimestamp(event.at) }}</time>
              <span class="ev-text">{{ t(`factory.events.${event.code}`, event.params ?? {}) }}</span>
            </li>
          </ol>
          <div v-else class="ins-empty" data-empty="events">
            <Activity :size="22" />
            <p>{{ t('factory.empty.events') }}</p>
          </div>
        </template>

        <template v-else-if="tab === 'diff'">
          <div class="diff-summary" data-diff-summary>
            <span>{{ t('factory.inspector.changes') }}</span>
            <b>+{{ task.diff.additions }} −{{ task.diff.deletions }}</b>
          </div>
          <ul v-if="files.length" class="diff-files" data-diff-files>
            <li v-for="file in files" :key="file.path">
              <code>{{ file.path }}</code>
              <b>+{{ file.additions }} −{{ file.deletions }}</b>
            </li>
          </ul>
          <div v-else class="ins-empty" data-empty="diff">
            <FileDiff :size="22" />
            <p>{{ t('factory.empty.diff') }}</p>
          </div>
          <section v-if="commits.length" class="section">
            <h4>{{ t('factory.inspector.commits') }}</h4>
            <ul class="commit-list" data-commit-list>
              <li v-for="commit in commits" :key="commit.sha">
                <code>{{ commit.sha.slice(0, 7) }}</code>
                <span>{{ commit.message }}</span>
              </li>
            </ul>
          </section>
          <div v-else class="ins-empty commits-empty" data-empty="commits">
            <p>{{ t('factory.empty.commits') }}</p>
          </div>
        </template>

        <template v-else-if="tab === 'review'">
          <div v-if="!review" class="ins-empty" data-empty="review">
            <ShieldCheck :size="22" />
            <p>{{ t('factory.empty.review') }}</p>
          </div>
          <template v-else>
            <div class="review-head">
              <span class="verdict" :class="review.verdict" data-review-verdict>
                {{ t(`factory.review.verdict.${review.verdict}`) }}
              </span>
              <time>{{ formatTimestamp(review.at) }}</time>
            </div>
            <p v-if="review.summary" class="review-summary" data-review-summary>
              {{ review.summary }}
            </p>
            <p v-else class="review-summary muted">{{ t('factory.review.summaryEmpty') }}</p>

            <section v-if="review.raw" class="section" data-review-raw>
              <h4>{{ t('factory.review.parseFailed') }}</h4>
              <pre class="review-raw">{{ review.raw }}</pre>
            </section>

            <section class="section">
              <h4>{{ t('factory.review.comments') }}</h4>
              <ul v-if="review.comments.length" class="review-comments" data-review-comments>
                <li
                  v-for="comment in review.comments"
                  :key="comment.id"
                  class="review-comment"
                  :class="comment.severity"
                  data-review-comment
                >
                  <div class="rc-head">
                    <code v-if="comment.file">
                      {{ comment.line ? `${comment.file}:${comment.line}` : comment.file }}
                    </code>
                    <span class="sev">{{ t(`factory.review.severity.${comment.severity}`) }}</span>
                    <span class="st">{{ t(`factory.review.status.${comment.status}`) }}</span>
                  </div>
                  <p class="rc-body">{{ comment.body }}</p>
                  <div v-if="isCommentActionable(comment.status)" class="rc-actions">
                    <button
                      class="mini-btn"
                      data-comment-accept
                      :disabled="updatingComment"
                      @click="emit('comment-accept', comment.id)"
                    >
                      {{ t('factory.actions.accept') }}
                    </button>
                    <button
                      class="mini-btn"
                      data-comment-ignore
                      :disabled="updatingComment"
                      @click="emit('comment-ignore', comment.id)"
                    >
                      {{ t('factory.actions.ignore') }}
                    </button>
                    <button
                      v-if="pendingIgnoreId === comment.id"
                      class="mini-btn warn"
                      data-comment-confirm-ignore
                      :disabled="updatingComment"
                      @click="emit('comment-confirm-ignore', comment.id)"
                    >
                      {{ t('factory.actions.confirmIgnore') }}
                    </button>
                  </div>
                </li>
              </ul>
              <div v-else class="ins-empty" data-empty="review-comments">
                <p>{{ t('factory.review.commentsEmpty') }}</p>
              </div>
            </section>
          </template>
        </template>
      </div>

      <footer class="ins-actions">
        <p v-if="actionError" class="action-error" data-action-error>
          {{ actionErrorText }}
        </p>
        <div class="action-row">
          <button
            v-if="canStart"
            class="action-btn primary"
            data-task-start
            :disabled="starting"
            @click="emit('start')"
          >
            <Play :size="12" />
            {{ starting ? t('factory.actions.starting') : t('factory.actions.start') }}
          </button>
          <button
            v-if="pendingDirty"
            class="action-btn warn"
            data-task-confirm-dirty
            :disabled="starting"
            @click="emit('confirm-dirty')"
          >
            {{ t('factory.actions.confirmDirty') }}
          </button>
          <button
            v-if="task.lane === 'implementing'"
            class="action-btn danger"
            data-task-stop
            :disabled="stopping"
            @click="emit('stop')"
          >
            <Square :size="12" />
            {{ stopping ? t('factory.actions.stopping') : t('factory.actions.stop') }}
          </button>
          <button
            v-if="task.lane === 'reviewing'"
            class="action-btn primary"
            data-task-approve
            :disabled="!eligible || approving"
            :title="eligible ? '' : t('factory.review.ineligible')"
            @click="emit('approve')"
          >
            <Check :size="12" />
            {{ approving ? t('factory.actions.approving') : t('factory.actions.approve') }}
          </button>
          <button
            v-if="task.lane === 'reviewing' && review"
            class="action-btn warn"
            data-task-request-changes
            @click="emit('request-changes')"
          >
            {{ t('factory.actions.requestChanges') }}
          </button>
          <button
            v-if="canFix"
            class="action-btn"
            data-task-fix
            :disabled="fixing"
            @click="emit('fix')"
          >
            {{ fixing ? t('factory.actions.fixing') : t('factory.actions.fix') }}
          </button>
        </div>
      </footer>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Activity,
  AlertTriangle,
  Check,
  Cpu,
  FileDiff,
  Folder,
  GitBranch,
  Layers,
  Loader2,
  Play,
  ShieldCheck,
  Square,
  X,
} from 'lucide-vue-next'
import type { FactoryEvent, FactoryTask, FactoryReviewCommentStatus } from '@/shared/factory'
import { pendingComments } from '@/shared/factoryReview'
import type { FactoryActionError } from '@/stores/factory'
import {
  FACTORY_INSPECTOR_TABS,
  FACTORY_STEPS,
  formatClock,
  formatTimestamp,
  stepStates,
  taskElapsedMs,
  taskStatus,
  type FactoryInspectorTab,
  type FactoryTaskStatus,
} from '@/stores/factory/board'

const props = withDefaults(
  defineProps<{
    task: FactoryTask | null
    tab: FactoryInspectorTab
    nowMs?: number
    events?: FactoryEvent[]
    eventsLoading?: boolean
    eventsError?: string | null
    actionError?: FactoryActionError | null
    starting?: boolean
    stopping?: boolean
    pendingDirty?: boolean
    /** 批准资格：验证通过 + 审查通过 + 无未决阻塞意见。 */
    eligible?: boolean
    approving?: boolean
    fixing?: boolean
    updatingComment?: boolean
    pendingIgnoreId?: string | null
  }>(),
  {
    nowMs: () => Date.now(),
    events: () => [],
    eventsLoading: false,
    eventsError: null,
    actionError: null,
    starting: false,
    stopping: false,
    pendingDirty: false,
    eligible: false,
    approving: false,
    fixing: false,
    updatingComment: false,
    pendingIgnoreId: null,
  },
)

const emit = defineEmits<{
  'select-tab': [tab: FactoryInspectorTab]
  start: []
  stop: []
  reveal: []
  'confirm-dirty': []
  approve: []
  'request-changes': []
  fix: []
  'comment-accept': [commentId: string]
  'comment-ignore': [commentId: string]
  'comment-confirm-ignore': [commentId: string]
}>()

const { t } = useI18n()

const status = computed<FactoryTaskStatus>(() =>
  props.task ? taskStatus(props.task) : { key: '' },
)
const visual = computed(() => (props.task ? stepStates(props.task) : []))
const elapsedMs = computed(() => (props.task ? taskElapsedMs(props.task, props.nowMs) : 0))
const files = computed(() => props.task?.diff.files ?? [])
const commits = computed(() => props.task?.commits ?? [])
const review = computed(() => props.task?.review ?? null)
const pending = computed(() => pendingComments(props.task?.review))
const canFix = computed(
  () =>
    pending.value.length > 0 &&
    Boolean(props.task?.worktree) &&
    (props.task?.lane === 'blocked' || props.task?.lane === 'reviewing'),
)
const canStart = computed(() => props.task?.lane === 'queued' || props.task?.lane === 'blocked')

/** 待处理/已接受的意见还能改；已忽略与已解决不可再操作。 */
function isCommentActionable(status: FactoryReviewCommentStatus): boolean {
  return status === 'open' || status === 'accepted'
}
const actionErrorText = computed(() => {
  const err = props.actionError
  if (!err) return ''
  const params = err.detail ? { detail: err.detail } : {}
  return t(`factory.errors.${err.code}`, params)
})

const timestamps = computed(() => {
  const ts = props.task?.timestamps
  if (!ts) return []
  return (
    [
      { key: 'claimedAt', labelKey: 'factory.inspector.claimedAt', value: ts.claimedAt },
      { key: 'startedAt', labelKey: 'factory.inspector.startedAt', value: ts.startedAt },
      { key: 'endedAt', labelKey: 'factory.inspector.endedAt', value: ts.endedAt },
      { key: 'mergedAt', labelKey: 'factory.inspector.mergedAt', value: ts.mergedAt },
    ] as const
  ).filter((entry) => Boolean(entry.value))
})
</script>

<style lang="scss" scoped>
.factory-inspector {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-elevated);
}

.ins-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  padding: 24px;
  color: var(--text-disabled);
  font-size: var(--text-sm, 12px);
  text-align: center;

  p {
    margin: 0;
    max-width: 200px;
  }
}

.ins-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-bottom: 1px solid var(--surface-border);
}

.ins-top {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-2xs, 11px);
}

.ins-num {
  font-family: var(--font-mono);
  color: var(--text-muted);
}

.ins-chip {
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: var(--surface-glass);
  color: var(--text-secondary);
}

.ins-title {
  margin: 0;
  font-size: var(--text-base, 14px);
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-primary);
}

.ins-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: var(--text-muted);

  code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--text-2xs, 11px);
  }

  code.pending {
    color: var(--text-disabled);
  }
}

.railsteps {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: 1;
  font-size: var(--text-2xs, 10px);
  color: var(--text-disabled);

  .sdot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 1px solid var(--surface-border-strong);
    border-radius: 50%;
    background: var(--bg-secondary);
  }

  &.done {
    color: var(--success);

    .sdot {
      border-color: var(--success);
      background: var(--success);
      color: #fff;
    }
  }

  &.active {
    color: var(--accent-primary);

    .sdot {
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 3px var(--accent-primary-glow);
    }
  }

  &.blocked {
    color: var(--warning);

    .sdot {
      border-color: var(--warning);
      background: var(--warning);
      color: #fff;
    }
  }
}

.tabs {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-md);
  background: var(--surface-glass);
}

.itab {
  flex: 1;
  padding: 5px 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--text-2xs, 11px);
  cursor: pointer;

  &.active {
    background: var(--bg-elevated);
    color: var(--text-primary);
    box-shadow: var(--shadow-sm);
  }
}

.ins-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  @include scrollbar-overlay;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;

  h4 {
    margin: 0;
    font-size: var(--text-2xs, 11px);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
}

.goal {
  margin: 0;
  font-size: var(--text-sm, 12px);
  line-height: 1.6;
  color: var(--text-secondary);
}

.metrics {
  display: flex;
  gap: 8px;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  padding: 8px;
  border-radius: var(--radius-md);
  background: var(--surface-glass);
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);

  b {
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--text-primary);
  }
}

.kv {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);

  b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-weight: 500;
    color: var(--text-secondary);
  }

  b.muted {
    color: var(--text-disabled);
  }

  b.ok {
    color: var(--success);
  }

  b.bad {
    color: var(--warning);
  }
}

.review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  time {
    font-family: var(--font-mono);
    font-size: var(--text-2xs, 11px);
    color: var(--text-disabled);
  }
}

.verdict {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--text-2xs, 11px);
  font-weight: 600;

  &.approved {
    background: var(--surface-glass);
    color: var(--success);
  }

  &.needs_changes {
    background: var(--surface-glass);
    color: var(--warning);
  }
}

.review-summary {
  margin: 0;
  font-size: var(--text-sm, 12px);
  line-height: 1.6;
  color: var(--text-secondary);

  &.muted {
    color: var(--text-disabled);
  }
}

.review-raw {
  margin: 0;
  padding: 8px;
  border-radius: var(--radius-md);
  background: var(--surface-glass);
  font-family: var(--font-mono);
  font-size: var(--text-2xs, 11px);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}

.review-comments {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.review-comment {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px;
  border-radius: var(--radius-md);
  border-left: 2px solid var(--surface-border-strong);
  background: var(--surface-glass);

  &.blocker {
    border-left-color: var(--warning);
  }

  .rc-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-2xs, 11px);
    color: var(--text-muted);

    code {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--font-mono);
      color: var(--text-secondary);
    }

    .sev {
      flex: none;
      color: var(--text-primary);
    }

    .st {
      margin-left: auto;
      flex: none;
      color: var(--text-disabled);
    }
  }

  .rc-body {
    margin: 0;
    font-size: var(--text-2xs, 11px);
    line-height: 1.6;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }

  .rc-actions {
    display: flex;
    gap: 6px;
  }
}

.mini-btn {
  padding: 3px 8px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-2xs, 10px);
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &.warn:not(:disabled) {
    border-color: var(--warning);
    color: var(--warning);
  }
}

.reveal-btn {
  margin-left: auto;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent-primary);
  font-size: var(--text-2xs, 10px);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.event-row {
  display: flex;
  gap: 8px;
  padding: 5px 7px;
  border-radius: var(--radius-sm);
  background: var(--surface-glass);
  font-size: var(--text-2xs, 11px);
  color: var(--text-secondary);

  time {
    flex: none;
    font-family: var(--font-mono);
    color: var(--text-disabled);
  }

  &.ok {
    color: var(--success);
  }

  &.warn {
    color: var(--warning);
  }

  &.error {
    color: var(--error);
  }
}

.ev-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.diff-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 7px 9px;
  border-radius: var(--radius-md);
  background: var(--surface-glass);
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);

  b {
    font-family: var(--font-mono);
    color: var(--text-primary);
  }
}

.diff-files,
.commit-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    font-size: var(--text-2xs, 11px);
    color: var(--text-muted);
  }

  code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    color: var(--text-secondary);
  }

  b {
    flex: none;
    font-family: var(--font-mono);
    color: var(--text-secondary);
  }
}

.commit-list li span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commits-empty {
  flex: none;
  padding: 8px;
}

.ins-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--surface-border);
}

.action-row {
  display: flex;
  gap: 6px;
}

.action-error {
  margin: 0;
  font-size: var(--text-2xs, 11px);
  color: var(--error);
  overflow-wrap: anywhere;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-2xs, 11px);
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &.primary:not(:disabled) {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
  }

  &.warn:not(:disabled) {
    border-color: var(--warning);
    color: var(--warning);
  }

  &.danger:not(:disabled) {
    border-color: var(--error);
    color: var(--error);
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

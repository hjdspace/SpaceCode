<template>
  <div class="extension-dialog-card" :class="[`method-${dialog.method}`, dialog.state]">
    <!-- 已答/已过期：收成 summary-header 单行（方法图标 + 状态着色），
         留给下一轮菜单让位，同时保住「我问过什么、答了什么」的痕迹 -->
    <div v-if="dialog.state === 'resolved'" class="card-resolved">
      <div class="header-icon" :class="resolvedTone">
        <component :is="resolvedIcon" :size="14" />
      </div>
      <div class="header-text">
        <h3>{{ methodLabel }}</h3>
        <span class="resolved-text" :class="resolvedTone">{{ resolvedLabel }}</span>
      </div>
    </div>

    <template v-else>
      <div class="card-header">
        <div class="header-icon" :class="methodTone">
          <component :is="methodIcon" :size="14" />
        </div>
        <div class="header-text">
          <h3>{{ methodLabel }}</h3>
          <span class="waiting-indicator">{{ t('piExtensionDialog.card.status.waiting') }}</span>
        </div>
      </div>

      <!-- select：选项原文就是应答值，逐条回传；pi-plan-mode 的固定英文菜单在显示层本地化 -->
      <template v-if="dialog.method === 'select'">
        <div class="card-body">
          <!-- pi 会把整段提问塞进 title（runRpcConfirmation 拼的是 title + \n + 正文），
               所以这里必须保换行，不能当一行标题显示 -->
          <p class="dialog-title">{{ displayTitle }}</p>
          <p v-if="dialog.message" class="dialog-message">{{ displayMessage }}</p>
          <div class="option-list">
            <button
              v-for="(option, index) in dialog.options"
              :key="`${dialog.dialogId}-${index}`"
              class="option-btn"
              type="button"
              :disabled="submitting"
              @click="answer({ kind: 'value', value: option }, optionLabel(option))"
            >
              {{ optionLabel(option) }}
            </button>
            <template v-if="!dialog.options?.length">
              <p class="empty-options">
                {{ t('piExtensionDialog.card.status.noOptions') }}
              </p>
              <!-- 文本框兜底：引擎没给可选项，直接以文本作答 -->
              <form class="field-form" @submit.prevent="submitField">
                <textarea
                  v-model="draft"
                  class="field-input"
                  rows="2"
                  spellcheck="false"
                  :placeholder="dialog.placeholder || t('piExtensionDialog.card.placeholders.input')"
                  :disabled="submitting"
                />
                <button class="action-btn primary footer-btn primary" type="submit" :disabled="submitting || !draft.trim()">
                  {{ t('piExtensionDialog.card.actions.submit') }}
                </button>
              </form>
            </template>
          </div>
        </div>
        <div class="card-footer">
          <button class="dismiss-btn footer-btn ghost" type="button" :disabled="submitting" @click="dismiss">
            {{ t('piExtensionDialog.card.actions.dismiss') }}
          </button>
        </div>
      </template>

      <!-- confirm：两键直接答 confirmed，不走 cancelled -->
      <template v-else-if="dialog.method === 'confirm'">
        <div class="card-body">
          <p class="dialog-title">{{ dialog.title }}</p>
          <p v-if="dialog.message" class="dialog-message">{{ dialog.message }}</p>
        </div>
        <div class="card-footer">
          <button
            class="dismiss-btn footer-btn ghost"
            type="button"
            :disabled="submitting"
            @click="dismiss"
          >
            {{ t('piExtensionDialog.card.actions.dismiss') }}
          </button>
          <div class="footer-spacer" />
          <button
            class="action-btn deny footer-btn danger"
            type="button"
            :disabled="submitting"
            @click="answer({ kind: 'confirmed', confirmed: false }, t('piExtensionDialog.card.actions.denied'))"
          >
            {{ t('piExtensionDialog.card.actions.deny') }}
          </button>
          <button
            class="action-btn primary footer-btn primary"
            type="button"
            :disabled="submitting"
            @click="answer({ kind: 'confirmed', confirmed: true }, t('piExtensionDialog.card.actions.confirmed'))"
          >
            {{ t('piExtensionDialog.card.actions.confirm') }}
          </button>
        </div>
      </template>

      <!-- input / editor：正文回传，提交即应答 -->
      <form v-else class="field-form" @submit.prevent="submitField">
        <div class="card-body">
          <p class="dialog-title">{{ dialog.title }}</p>
          <p v-if="dialog.message" class="dialog-message">{{ dialog.message }}</p>
          <textarea
            v-if="dialog.method === 'editor'"
            v-model="draft"
            class="field-input field-input--multi"
            :rows="editorRows"
            spellcheck="false"
            :placeholder="t('piExtensionDialog.card.placeholders.editor')"
            :disabled="submitting"
            @keydown.meta.enter.prevent="submitField"
            @keydown.ctrl.enter.prevent="submitField"
          />
          <input
            v-else
            v-model="draft"
            class="field-input"
            type="text"
            :placeholder="dialog.placeholder || t('piExtensionDialog.card.placeholders.input')"
            :disabled="submitting"
          />
        </div>
        <div class="card-footer">
          <button
            class="dismiss-btn footer-btn ghost"
            type="button"
            :disabled="submitting"
            @click="dismiss"
          >
            {{ t('piExtensionDialog.card.actions.dismiss') }}
          </button>
          <div class="footer-spacer" />
          <button
            class="action-btn primary footer-btn primary"
            type="submit"
            :disabled="submitting || (dialog.method !== 'editor' && !draft.trim())"
          >
            {{ dialog.method === 'editor' ? t('piExtensionDialog.card.actions.save') : t('piExtensionDialog.card.actions.submit') }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Check, FileText, ListChecks, MessageCircle } from 'lucide-vue-next'
import type { ExtensionDialogAnswer } from '@/shared/channels/claudeCode'
import type { ExtensionDialog } from '@/services/extensionDialogService'
import { extensionDialogService } from '@/services/extensionDialogService'
import { useTurnStore } from '@/stores/turn'
import { matchPlanActionDialog } from '@/lib/planModeDialogMatcher'
import { localizePlanActionBlock, localizePlanActionText } from '@/lib/planActionL10n'

/**
 * pi 扩展对话框（`extension_ui_request`）。四种方法共用一张卡（header/body/footer
 * 同一基座，按钮与答题控件按方法派生）：
 * 这是引擎在等的一次提问，不是工具授权 —— 它没有 toolUseId，也就挂不上
 * PermissionRequestCard 那条按工具条目渲染的路 (#54)。
 */
const props = defineProps<{ dialog: ExtensionDialog }>()

const { t, locale } = useI18n()
const turnStore = useTurnStore()

const submitting = ref(false)
const draft = ref(props.dialog.prefill ?? '')

/**
 * pi-plan-mode 行动菜单的显示层本地化：title 是「标题 + 说明行」整段，
 * 选项与回执逐条换；应答值始终走原文（localizePlanAction* 只作用于显示）。
 * 非行动菜单帧（问卷题、confirm 等）一律原样显示。
 */
const isPlanActionMenu = computed(
  () => dialog.value.method === 'select' && matchPlanActionDialog(dialog.value),
)

const displayTitle = computed(() =>
  isPlanActionMenu.value ? localizePlanActionBlock(dialog.value.title ?? '', locale.value) : dialog.value.title,
)

const displayMessage = computed(() =>
  isPlanActionMenu.value ? localizePlanActionBlock(dialog.value.message ?? '', locale.value) : dialog.value.message,
)

function optionLabel(option: string): string {
  return isPlanActionMenu.value ? localizePlanActionText(option, locale.value) : option
}

/**
 * 状态按 id 现取，不认 props 里那份快照。
 *
 * 服务每次变更都是换对象而不是改字段（那是渲染层要看见新引用的老办法），所以父级传进来的
 * 那份会停在旧状态。父级确实会重算，但卡片一旦能自己读到实况，就不必依赖「每个父级都
 * 记得重新取一遍」这个前提 —— 多栏与 H5 各端并发时，这个前提迟早漏一次。
 */
const dialog = computed(
  () => extensionDialogService.get(props.dialog.sessionId, props.dialog.dialogId) ?? props.dialog,
)

const METHOD_ICONS = {
  select: ListChecks,
  confirm: AlertTriangle,
  input: MessageCircle,
  editor: FileText,
} as const

const methodIcon = computed(() => METHOD_ICONS[dialog.value.method])
const methodLabel = computed(() => t(`piExtensionDialog.card.methods.${dialog.value.method}`))

/** confirm 是破坏性确认，图标座用警示色；其余方法走主色 */
const methodTone = computed(() => (dialog.value.method === 'confirm' ? 'warn' : undefined))

/** 回执着色：用户答的 / 其他端答的 = ok；超时、中止、进程没了 = warn；主动关闭 = 中性 */
const resolvedTone = computed<'ok' | 'warn' | 'muted'>(() => {
  const reason = dialog.value.closedReason
  if (!reason || reason === 'answered') return 'ok'
  if (reason === 'cancelled') return 'muted'
  return 'warn'
})

const resolvedIcon = computed(() => (resolvedTone.value === 'warn' ? AlertTriangle : Check))

const editorRows = computed(() => {
  const lines = (dialog.value.prefill ?? '').split('\n').length
  return Math.min(12, Math.max(4, lines + 1))
})

const resolvedLabel = computed(() => {
  if (dialog.value.closedReason) {
    const key = `piExtensionDialog.card.closed.${dialog.value.closedReason}`
    const translated = t(key)
    return translated === key ? t('piExtensionDialog.card.closed.dismissed') : translated
  }
  return dialog.value.outcomeText || t('piExtensionDialog.card.outcome.answered')
})

/**
 * 提交一次应答。`outcome` 是留在卡片上的回执文本（用户在那个按钮上看到的原文）。
 *
 * store 会先把条目落成已答再发 IPC，失败时撤回 —— 所以这里 catch 完不用改状态，
 * 卡片自己回到 pending 让用户原地重试。吞掉异常是刻意的：引擎侧的失败原因
 * 已经在 store 的日志里，弹一次 toast 只会盖住用户正要看的下一轮菜单。
 */
async function answer(answer: ExtensionDialogAnswer, outcome: string): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  try {
    await turnStore.answerExtensionDialog(dialog.value.sessionId, dialog.value.dialogId, answer, outcome)
  } catch {
    /* store 已把卡片退回 pending */
  } finally {
    submitting.value = false
  }
}

/** 关闭 = 回 cancelled。对 select 而言扩展收到的是 undefined，
 * 而 pi-tui-kit 把 undefined 当「返回/关掉这个菜单」，不是「拒绝」 */
function dismiss(): void {
  void answer({ kind: 'cancel' }, t('piExtensionDialog.card.actions.dismissed'))
}

function submitField(): void {
  const value = draft.value
  // 空文本对 input 是「没填」，对 editor 是「清空它」—— 后者是有意义的编辑，得放行
  if (dialog.value.method !== 'editor' && !value.trim()) return
  const outcome = dialog.value.method === 'editor'
    ? t('piExtensionDialog.card.outcome.editedText')
    : value
  answer({ kind: 'value', value }, outcome)
}
</script>

<style lang="scss" scoped>
.extension-dialog-card {
  margin: 12px 0;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  overflow: hidden;
}

.extension-dialog-card.resolved {
  padding: 4px 12px;
}

// ── 家族基座：header ──
.card-header {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--surface-border);
}

.header-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-primary);
  flex-shrink: 0;

  &.warn {
    background: color-mix(in srgb, var(--warning) 14%, transparent);
    color: var(--warning);
  }

  &.ok {
    background: color-mix(in srgb, var(--success) 14%, transparent);
    color: var(--success);
  }

  &.muted {
    background: var(--surface-glass-hover);
    color: var(--text-muted);
  }
}

.header-text {
  flex: 1;
  min-width: 0;

  h3 {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 1px;
  }

  span {
    font-size: var(--text-2xs);
  }
}

.waiting-indicator {
  color: var(--warning);
  font-weight: 500;
}

// ── 回执态：单行 + 着色 ──
.card-resolved {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;

  .header-icon {
    width: 22px;
    height: 22px;
  }

  .header-text h3 {
    font-size: var(--text-sm);
  }
}

.resolved-text {
  color: var(--text-secondary);
  // 选项原文可能很长（plan-mode 的行里带说明），单行截断而不是撑破卡片
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.ok {
    color: var(--success);
  }

  &.warn {
    color: var(--warning);
  }

  &.muted {
    color: var(--text-muted);
  }
}

// ── body ──
.card-body {
  padding: 10px 12px;
  font-size: var(--text-md);
  color: var(--text-primary);
}

.dialog-title,
.dialog-message {
  margin: 0;
  // 必须保换行：pi 把多行提问整体塞进 title
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
}

.dialog-message {
  margin-top: 8px;
  color: var(--text-secondary);
}

// ── select 选项 ──
.option-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.option-btn {
  display: block;
  width: 100%;
  padding: 8px 10px;
  text-align: left;
  font-size: var(--text-md);
  font-family: inherit;
  color: var(--text-primary);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  cursor: pointer;
  white-space: pre-wrap;
  word-break: break-word;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.option-btn:hover:not(:disabled) {
  border-color: var(--accent-primary);
  background: var(--surface-glass-hover);
}

.option-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.empty-options {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

// ── footer（统一按钮层级：ghost 关闭 / danger 破坏性 / primary 主行动）──
.card-footer {
  padding: 8px 12px 10px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  border-top: 1px solid var(--surface-border);
}

.footer-spacer {
  flex: 1;
}

.footer-btn {
  padding: 5px 12px;
  border-radius: 6px;
  font-size: var(--text-sm);
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  &.ghost {
    background: var(--surface-glass);
    border-color: var(--surface-border);
    color: var(--text-secondary);

    &:hover:not(:disabled) {
      background: var(--surface-glass-hover);
      color: var(--text-primary);
    }
  }

  &.primary {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: #fff;
    font-weight: 600;

    &:hover:not(:disabled) {
      opacity: 0.9;
    }
  }

  &.danger {
    background: transparent;
    border-color: var(--border-strong);
    color: var(--text-secondary);

    &:hover:not(:disabled) {
      border-color: var(--error);
      color: var(--error);
    }
  }
}

// ── input / editor 表单 ──
.field-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field-input {
  width: 100%;
  padding: 8px 10px;
  font-size: var(--text-md);
  font-family: inherit;
  color: var(--text-primary);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  resize: vertical;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;

  &::placeholder {
    color: var(--text-muted);
  }

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 12%, transparent);
  }

  &:disabled {
    opacity: 0.5;
  }
}

.field-input--multi {
  min-height: 96px;
  line-height: 1.5;
  // 扩展给的 prefill 常是代码或计划正文，别把它折成一行
  white-space: pre;
  overflow: auto;
  @include scrollbar-overlay;
}
</style>

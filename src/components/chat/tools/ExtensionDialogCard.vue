<template>
  <div class="extension-dialog-card" :class="[`method-${dialog.method}`, dialog.state]">
    <!-- 已答/已过期：收成一行，留给下一轮菜单让位，同时保住「我问过什么、答了什么」的痕迹 -->
    <div v-if="dialog.state === 'resolved'" class="card-resolved">
      <Check :size="14" class="resolved-icon" />
      <span class="resolved-text">{{ resolvedLabel }}</span>
    </div>

    <template v-else>
      <div class="card-header">
        <div class="method-badge">
          <component :is="methodIcon" :size="15" />
          <span>{{ methodLabel }}</span>
        </div>
        <span class="waiting-indicator">{{ t('piExtensionDialog.card.status.waiting') }}</span>
      </div>

      <div class="card-body">
        <!-- pi 会把整段提问塞进 title（runRpcConfirmation 拼的是 title + \n + 正文），
             所以这里必须保换行，不能当一行标题显示 -->
        <p class="dialog-title">{{ dialog.title }}</p>
        <p v-if="dialog.message" class="dialog-message">{{ dialog.message }}</p>
      </div>

      <!-- select：选项原文就是应答值，逐条回传 -->
      <div v-if="dialog.method === 'select'" class="option-list">
        <button
          v-for="(option, index) in dialog.options"
          :key="`${dialog.dialogId}-${index}`"
          class="option-btn"
          type="button"
          :disabled="submitting"
          @click="answer({ kind: 'value', value: option }, option)"
        >
          {{ option }}
        </button>
        <p v-if="!dialog.options?.length" class="empty-options">
          {{ t('piExtensionDialog.card.status.noOptions') }}
        </p>
      </div>

      <!-- confirm：两键直接答 confirmed，不走 cancelled -->
      <div v-else-if="dialog.method === 'confirm'" class="button-row">
        <button
          class="action-btn primary"
          type="button"
          :disabled="submitting"
          @click="answer({ kind: 'confirmed', confirmed: true }, t('piExtensionDialog.card.actions.confirmed'))"
        >
          {{ t('piExtensionDialog.card.actions.confirm') }}
        </button>
        <button
          class="action-btn deny"
          type="button"
          :disabled="submitting"
          @click="answer({ kind: 'confirmed', confirmed: false }, t('piExtensionDialog.card.actions.denied'))"
        >
          {{ t('piExtensionDialog.card.actions.deny') }}
        </button>
      </div>

      <!-- input / editor：正文回传，提交即应答 -->
      <form v-else class="field-form" @submit.prevent="submitField">
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
        <div class="button-row">
          <button class="action-btn primary" type="submit" :disabled="submitting || !draft.trim()">
            {{ dialog.method === 'editor' ? t('piExtensionDialog.card.actions.save') : t('piExtensionDialog.card.actions.submit') }}
          </button>
        </div>
      </form>

      <!-- 关闭 = 回 cancelled。对 select 而言扩展收到的是 undefined，
           而 pi-tui-kit 把 undefined 当「返回/关掉这个菜单」，不是「拒绝」 -->
      <button
        class="dismiss-btn"
        type="button"
        :disabled="submitting"
        @click="answer({ kind: 'cancel' }, t('piExtensionDialog.card.actions.dismissed'))"
      >
        {{ t('piExtensionDialog.card.actions.dismiss') }}
      </button>
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

/**
 * pi 扩展对话框（`extension_ui_request`）。四种方法共用一张卡，只有答题控件不同：
 * 这是引擎在等的一次提问，不是工具授权 —— 它没有 toolUseId，也就挂不上
 * PermissionRequestCard 那条按工具条目渲染的路 (#54)。
 */
const props = defineProps<{ dialog: ExtensionDialog }>()

const { t } = useI18n()
const turnStore = useTurnStore()

const submitting = ref(false)
const draft = ref(props.dialog.prefill ?? '')

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

<style scoped lang="scss">
.extension-dialog-card {
  margin: 12px 0;
  padding: 14px 16px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  border-left: 3px solid #3b82f6;
}

.extension-dialog-card.resolved {
  padding: 8px 16px;
  border-left-color: #10b981;
  background: transparent;
}

.extension-dialog-card.method-confirm {
  border-left-color: #f59e0b;
}

.card-resolved {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.resolved-icon {
  flex: none;
  color: #10b981;
}

.resolved-text {
  // 选项原文可能很长（plan-mode 的行里带说明），单行截断而不是撑破卡片
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.method-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
}

.waiting-indicator {
  flex: none;
  font-size: var(--text-2xs);
  color: #f59e0b;
  font-weight: 500;
}

.card-body {
  margin-bottom: 12px;
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

.option-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.option-btn {
  display: block;
  width: 100%;
  padding: 9px 12px;
  text-align: left;
  font-size: var(--text-md);
  font-family: inherit;
  color: var(--text-primary);
  background: var(--surface-soft);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  cursor: pointer;
  white-space: pre-wrap;
  word-break: break-word;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.option-btn:hover:not(:disabled) {
  border-color: #3b82f6;
  background: var(--surface-glass);
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

.button-row {
  display: flex;
  gap: 8px;
}

.action-btn {
  padding: 8px 16px;
  font-size: var(--text-md);
  font-family: inherit;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid var(--surface-border);
  background: var(--surface-soft);
  color: var(--text-primary);
  cursor: pointer;
  transition: filter 0.15s ease, opacity 0.15s ease;
}

.action-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.action-btn.primary {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}

.action-btn.deny {
  background: transparent;
}

.field-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field-input {
  width: 100%;
  padding: 9px 12px;
  font-size: var(--text-md);
  font-family: inherit;
  color: var(--text-primary);
  background: var(--surface-soft);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  resize: vertical;
}

.field-input:focus {
  outline: none;
  border-color: #3b82f6;
}

.field-input--multi {
  min-height: 96px;
  line-height: 1.5;
  // 扩展给的 prefill 常是代码或计划正文，别把它折成一行
  white-space: pre;
  overflow: auto;
  @include scrollbar-overlay;
}

.dismiss-btn {
  margin-top: 10px;
  padding: 0;
  font-size: var(--text-sm);
  font-family: inherit;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
}

.dismiss-btn:hover:not(:disabled) {
  color: var(--text-secondary);
}

.dismiss-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>

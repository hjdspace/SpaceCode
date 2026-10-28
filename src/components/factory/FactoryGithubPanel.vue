<template>
  <aside class="github-panel" data-github-panel>
    <header class="panel-head">
      <h3>{{ t('factory.github.title') }}</h3>
      <span class="count">{{ issues.length }}</span>
    </header>
    <p class="hint">{{ t('factory.github.description') }}</p>

    <div class="filter-row">
      <input
        :value="label"
        data-github-label
        class="text-input"
        :placeholder="t('factory.github.labelPlaceholder')"
        @input="emit('update:label', ($event.target as HTMLInputElement).value)"
        @keydown.enter.prevent="emit('refresh')"
      />
      <button
        class="ghost-btn"
        data-github-refresh
        :disabled="loading"
        :title="t('factory.github.refresh')"
        :aria-label="t('factory.github.refresh')"
        @click="emit('refresh')"
      >
        <RefreshCw :size="13" />
      </button>
    </div>

    <p v-if="error" class="error-text" data-github-error>
      {{ t(`factory.github.errors.${error.reason}`, errorParams(error)) }}
    </p>
    <p v-if="claimError" class="error-text" data-github-claim-error>
      {{ t(`factory.github.errors.${claimError.reason}`, errorParams(claimError)) }}
    </p>

    <div v-if="loading" class="hint" data-github-loading>{{ t('factory.github.loading') }}</div>
    <div v-else-if="!issues.length" class="panel-empty" data-github-empty>
      {{ t('factory.github.empty') }}
    </div>

    <ul v-else class="issue-list">
      <li v-for="issue in issues" :key="issue.number" class="issue-item" data-github-item>
        <label class="item-main">
          <input
            v-model="selected"
            type="checkbox"
            :value="issue.number"
            :data-github-check="issue.number"
            :disabled="issue.claimed || claiming"
          />
          <span class="item-text">
            <span class="item-title">#{{ issue.number }} {{ issue.title }}</span>
            <span v-if="issue.labels.length" class="item-labels">
              {{ issue.labels.join(' · ') }}
            </span>
            <span v-if="issue.claimed" class="item-claimed">
              {{ t('factory.github.claimed') }}
            </span>
          </span>
        </label>
      </li>
    </ul>

    <footer class="panel-foot">
      <button
        class="primary-btn"
        data-github-claim
        :disabled="!selected.length || claiming"
        @click="submitClaim"
      >
        <Download :size="13" />
        {{
          claiming
            ? t('factory.github.claiming')
            : t('factory.github.claim', { count: selected.length })
        }}
      </button>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, RefreshCw } from 'lucide-vue-next'
import type { FactoryGithubIssue } from '@/shared/factory'
import type { FactoryGithubActionError } from '@/stores/factory'

const props = defineProps<{
  label: string
  issues: FactoryGithubIssue[]
  loading: boolean
  error: FactoryGithubActionError | null
  claiming: boolean
  claimError: FactoryGithubActionError | null
  runId: string | null
}>()

const emit = defineEmits<{
  'update:label': [value: string]
  refresh: []
  claim: [numbers: number[]]
}>()

const { t } = useI18n()
const selected = ref<number[]>([])

/** 领取失败/已领取的 issue 不该再保持勾选。 */
watch(
  () => props.issues,
  (issues) => {
    const selectable = new Set(issues.filter((issue) => !issue.claimed).map((issue) => issue.number))
    selected.value = selected.value.filter((number) => selectable.has(number))
  },
)

// 运行创建成功后清空勾选，避免下一次点击撞上重复领取。
watch(
  () => props.runId,
  () => {
    selected.value = []
  },
)

function errorParams(error: FactoryGithubActionError): Record<string, string> {
  const numbers = (error.failed ?? []).map((failure) => `#${failure.number}`).join(', ')
  return numbers ? { numbers } : {}
}

function submitClaim(): void {
  if (!selected.value.length || props.claiming) return
  emit('claim', [...selected.value])
}
</script>

<style lang="scss" scoped>
.github-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  height: 100%;
  padding: 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-elevated);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 6px;

  h3 {
    margin: 0;
    font-size: var(--text-base, 14px);
    font-weight: 600;
    color: var(--text-primary);
  }

  .count {
    padding: 0 6px;
    border-radius: var(--radius-full);
    background: var(--surface-glass);
    font-size: var(--text-2xs, 11px);
    color: var(--text-muted);
  }
}

.hint {
  margin: 0;
  font-size: var(--text-2xs, 11px);
  line-height: 1.5;
  color: var(--text-muted);
}

.error-text {
  margin: 0;
  font-size: var(--text-2xs, 11px);
  line-height: 1.5;
  color: var(--error);
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.text-input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-2xs, 11px);

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
  }
}

.primary-btn,
.ghost-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  font-size: var(--text-2xs, 11px);
  cursor: pointer;
}

.primary-btn {
  border: 1px solid var(--accent-primary);
  background: var(--accent-primary);
  color: #fff;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.ghost-btn {
  border: 1px solid var(--surface-border);
  background: transparent;
  color: var(--text-secondary);

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.panel-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  border: 1px dashed var(--surface-border);
  border-radius: var(--radius-md);
  color: var(--text-disabled);
  font-size: var(--text-2xs, 11px);
}

.issue-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  @include scrollbar-overlay;
}

.issue-item {
  padding: 8px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.item-main {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  cursor: pointer;

  input[type='checkbox'] {
    margin-top: 2px;
    accent-color: var(--accent-primary);

    &:disabled {
      cursor: not-allowed;
    }
  }
}

.item-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.item-title {
  font-size: var(--text-sm, 12px);
  color: var(--text-primary);
  word-break: break-word;
}

.item-labels {
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);
  word-break: break-word;
}

.item-claimed {
  font-size: var(--text-2xs, 11px);
  color: var(--warning);
}

.panel-foot {
  padding-top: 4px;
  border-top: 1px solid var(--surface-border);
}
</style>

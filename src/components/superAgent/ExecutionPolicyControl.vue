<script setup lang="ts">
/**
 * 执行策略控件（T12 #82）。
 *
 * - 串行（默认，1 worker，共享根目录）与并行（2–6，强制 per-ticket worktree）；
 * - 开启并行必须两步显式确认（confirmed 才落主进程），运行中/非 git 仓库时
 *   后端拒绝并就地显示稳定错误码文案；
 * - 检查点回退：每轮 launch 前保存的检查点 + 检查点后新增的脏文件清单，
 *   逐文件显式回退（检查点前已脏的用户改动不在此列，受后端保护）。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSuperAgentStore } from '@/stores/superAgent'

const props = defineProps<{
  repoRoot: string
}>()

const { t } = useI18n()
const store = useSuperAgentStore()

const open = ref(false)
const confirming = ref(false)
const busy = ref(false)
const errorKey = ref<string | null>(null)
const noticeKey = ref<string | null>(null)
const maxWorkers = ref(2)

const policy = computed(() => store.executionPolicy?.policy ?? null)
const checkpoint = computed(() => store.checkpointInfo)
const savedAtText = computed(() => {
  const cp = checkpoint.value?.checkpoint ?? null
  if (!cp) return null
  return t('superAgent.policy.checkpointSavedAt', {
    time: new Date(cp.savedAt).toLocaleString(),
  })
})

const modeText = computed(() => {
  const current = policy.value
  if (!current) return t('superAgent.policy.serial')
  return current.mode === 'parallel'
    ? `${t('superAgent.policy.parallel')} ×${current.maxWorkers}`
    : t('superAgent.policy.serial')
})

onMounted(() => {
  void store.loadPolicy(props.repoRoot)
  void store.loadCheckpoint(props.repoRoot)
})

function toggleOpen(): void {
  open.value = !open.value
  if (open.value) {
    errorKey.value = null
    noticeKey.value = null
    void store.loadPolicy(props.repoRoot)
    void store.loadCheckpoint(props.repoRoot)
  }
}

function beginParallelConfirm(): void {
  confirming.value = true
  errorKey.value = null
}

function cancelParallelConfirm(): void {
  confirming.value = false
}

function clampLimit(next: number): void {
  maxWorkers.value = Math.min(6, Math.max(2, Math.round(next) || 2))
}

async function applyMode(mode: 'serial' | 'parallel', confirmed = false): Promise<void> {
  busy.value = true
  errorKey.value = null
  noticeKey.value = null
  try {
    await store.setPolicy(props.repoRoot, {
      mode,
      ...(mode === 'parallel' ? { maxWorkers: maxWorkers.value, confirmed } : {}),
    })
    confirming.value = false
    noticeKey.value = t('superAgent.policy.applied', {
      mode: mode === 'parallel' ? t('superAgent.policy.parallel') : t('superAgent.policy.serial'),
    })
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
        ? (err as { code: string }).code
        : null
    errorKey.value = code ? `superAgent.errors.${code}` : 'superAgent.errors.unknown'
  } finally {
    busy.value = false
  }
}

async function rollbackFile(file: string): Promise<void> {
  busy.value = true
  errorKey.value = null
  noticeKey.value = null
  try {
    const result = await store.rollbackCheckpointFiles(props.repoRoot, [file])
    if (result.rolled.length > 0) {
      noticeKey.value = t('superAgent.policy.rollbackDone', { count: result.rolled.length })
    }
    if (result.skipped.length > 0) {
      noticeKey.value = t('superAgent.policy.rollbackSkipped', { count: result.skipped.length })
    }
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
        ? (err as { code: string }).code
        : null
    errorKey.value = code ? `superAgent.errors.${code}` : 'superAgent.errors.unknown'
  } finally {
    busy.value = false
  }
}

async function refreshCheckpoint(): Promise<void> {
  await store.loadCheckpoint(props.repoRoot)
}
</script>

<template>
  <section class="execution-policy" data-testid="execution-policy">
    <button type="button" class="chip" :class="{ active: open }" @click="toggleOpen">
      {{ modeText }}
    </button>

    <div v-if="open" class="panel">
      <h4 class="panel-title">{{ t('superAgent.policy.title') }}</h4>
      <p class="hint">
        {{
          policy?.mode === 'parallel'
            ? t('superAgent.policy.parallelHint')
            : t('superAgent.policy.serialHint')
        }}
      </p>

      <template v-if="policy?.mode === 'serial'">
        <template v-if="!confirming">
          <button
            type="button"
            class="action"
            :disabled="busy"
            data-testid="policy-begin-parallel"
            @click="beginParallelConfirm"
          >
            {{ t('superAgent.policy.switchToParallel') }}
          </button>
        </template>
        <div v-else class="confirm" data-testid="policy-confirm">
          <label class="limit">
            {{ t('superAgent.policy.maxWorkers') }}
            <input
              v-model.number="maxWorkers"
              type="number"
              min="2"
              max="6"
              data-testid="policy-max-workers"
              @change="clampLimit(maxWorkers)"
            />
          </label>
          <strong class="confirm-title">{{ t('superAgent.policy.parallelConfirmTitle') }}</strong>
          <p class="confirm-body">{{ t('superAgent.policy.parallelConfirmBody') }}</p>
          <div class="confirm-actions">
            <button
              type="button"
              class="action primary"
              :disabled="busy"
              data-testid="policy-confirm-parallel"
              @click="applyMode('parallel', true)"
            >
              {{ t('superAgent.policy.confirm') }}
            </button>
            <button type="button" class="action" :disabled="busy" @click="cancelParallelConfirm">
              {{ t('superAgent.policy.cancel') }}
            </button>
          </div>
        </div>
      </template>

      <button
        v-else
        type="button"
        class="action"
        :disabled="busy"
        data-testid="policy-back-serial"
        @click="applyMode('serial')"
      >
        {{ t('superAgent.policy.switchToSerial') }}
      </button>

      <p v-if="noticeKey" class="notice" data-testid="policy-notice">{{ noticeKey }}</p>
      <p v-if="errorKey" class="error" data-testid="policy-error">{{ t(errorKey) }}</p>

      <div class="checkpoint" data-testid="policy-checkpoint">
        <div class="checkpoint-head">
          <h4 class="panel-title">{{ t('superAgent.policy.checkpointTitle') }}</h4>
          <button
            type="button"
            class="chip"
            :disabled="busy"
            data-testid="checkpoint-refresh"
            @click="refreshCheckpoint"
          >
            {{ t('superAgent.policy.refresh') }}
          </button>
        </div>
        <p v-if="savedAtText" class="hint">{{ savedAtText }}</p>
        <p v-else class="hint">{{ t('superAgent.policy.checkpointNone') }}</p>

        <template v-if="checkpoint?.checkpoint">
          <p v-if="checkpoint.changedFiles.length" class="hint">
            {{ t('superAgent.policy.checkpointHint') }}
          </p>
          <ul v-if="checkpoint.changedFiles.length" class="file-list">
            <li v-for="file in checkpoint.changedFiles" :key="file" class="file-item">
              <span class="file-path">{{ file }}</span>
              <button
                type="button"
                class="action"
                :disabled="busy"
                :data-testid="`checkpoint-rollback-${file}`"
                @click="rollbackFile(file)"
              >
                {{ t('superAgent.policy.rollbackFile') }}
              </button>
            </li>
          </ul>
          <p v-else class="hint">{{ t('superAgent.policy.checkpointEmpty') }}</p>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.execution-policy {
  position: relative;
  display: inline-flex;
  font-size: 12px;
}

.chip {
  padding: 3px 10px;
  border: 1px solid var(--border-light);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;

  &.active {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
}

.panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 320px;
  max-height: 420px;
  overflow-y: auto;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: 0 6px 24px rgb(0 0 0 / 12%);
}

.panel-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.hint,
.notice,
.error,
.confirm-body {
  margin: 0;
  color: var(--text-muted);
}

.notice {
  color: var(--text-secondary);
}

.error {
  color: var(--text-primary);
}

.action {
  align-self: flex-start;
  padding: 4px 10px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;

  &.primary {
    border-color: var(--text-secondary);
    font-weight: 600;
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  background: var(--bg-primary);
}

.confirm-title {
  font-size: 12px;
  color: var(--text-primary);
}

.confirm-actions {
  display: flex;
  gap: 8px;
}

.limit {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);

  input {
    width: 56px;
    padding: 2px 6px;
    border: 1px solid var(--border-light);
    border-radius: 4px;
    background: var(--bg-elevated);
    color: var(--text-primary);
  }
}

.checkpoint {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border-light);
}

.checkpoint-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  background: var(--bg-primary);
}

.file-path {
  overflow: hidden;
  font-family: monospace;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

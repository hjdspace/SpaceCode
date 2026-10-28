<template>
  <aside class="backlog-panel">
    <header class="panel-head">
      <h3>{{ t('factory.backlog.title') }}</h3>
      <span class="count">{{ items.length }}</span>
    </header>
    <p class="hint">{{ t('factory.backlog.description') }}</p>

    <p v-if="error" class="error-text" data-backlog-error>
      {{ t(`factory.backlog.errors.${error}`) }}
    </p>
    <p v-if="runError" class="error-text" data-run-error>
      {{ runError.params ? t(`factory.run.errors.${runError.code}`, runError.params) : t(`factory.run.errors.${runError.code}`) }}
    </p>

    <div class="add-form">
      <input
        v-model="newTitle"
        data-backlog-title
        class="text-input"
        :placeholder="t('factory.backlog.titlePlaceholder')"
        @keydown.enter.prevent="submitCreate"
      />
      <textarea
        v-model="newGoal"
        data-backlog-goal
        class="text-input"
        rows="2"
        :placeholder="t('factory.backlog.goalPlaceholder')"
      />
      <button class="primary-btn" data-backlog-add :disabled="!newTitle.trim()" @click="submitCreate">
        <Plus :size="13" />
        {{ t('factory.backlog.add') }}
      </button>
    </div>

    <div v-if="loading" class="hint" data-backlog-loading>{{ t('factory.backlog.loading') }}</div>
    <div v-else-if="!items.length" class="panel-empty" data-backlog-empty>
      {{ t('factory.backlog.empty') }}
    </div>

    <ul v-else class="backlog-list">
      <li v-for="(item, index) in items" :key="item.id" class="backlog-item" data-backlog-item>
        <template v-if="editingId === item.id">
          <input v-model="editTitle" data-backlog-edit-title class="text-input" />
          <textarea v-model="editGoal" data-backlog-edit-goal class="text-input" rows="2" />
          <div class="row-actions">
            <button class="ghost-btn" :data-backlog-save="item.id" @click="submitEdit">
              {{ t('factory.backlog.save') }}
            </button>
            <button class="ghost-btn" @click="cancelEdit">{{ t('factory.backlog.cancel') }}</button>
          </div>
        </template>

        <template v-else>
          <label class="item-main">
            <input
              v-model="selected"
              type="checkbox"
              :value="item.id"
              :data-backlog-check="item.id"
              :disabled="claimedIds.includes(item.id)"
            />
            <span class="item-text">
              <span class="item-title">{{ item.title }}</span>
              <span v-if="item.goal" class="item-goal">{{ item.goal }}</span>
              <span v-if="claimedIds.includes(item.id)" class="item-claimed">
                {{ t('factory.backlog.claimed') }}
              </span>
            </span>
          </label>

          <div class="row-actions">
            <button
              class="icon-btn"
              :data-backlog-up="item.id"
              :disabled="index === 0"
              :title="t('factory.backlog.moveUp')"
              @click="emit('move', item.id, 'up')"
            >
              <ChevronUp :size="13" />
            </button>
            <button
              class="icon-btn"
              :data-backlog-down="item.id"
              :disabled="index === items.length - 1"
              :title="t('factory.backlog.moveDown')"
              @click="emit('move', item.id, 'down')"
            >
              <ChevronDown :size="13" />
            </button>
            <button
              class="icon-btn"
              :data-backlog-edit="item.id"
              :title="t('factory.backlog.edit')"
              @click="startEdit(item)"
            >
              <Pencil :size="13" />
            </button>
            <button
              class="icon-btn"
              :data-backlog-delete="item.id"
              :title="t('factory.backlog.delete')"
              @click="emit('remove', item.id)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
        </template>
      </li>
    </ul>

    <footer class="panel-foot">
      <button
        class="primary-btn"
        data-backlog-create-run
        :disabled="!selected.length || creating"
        @click="submitRun"
      >
        <Play :size="13" />
        {{ creating ? t('factory.backlog.creating') : t('factory.backlog.createRun', { count: selected.length }) }}
      </button>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, Pencil, Play, Plus, Trash2 } from 'lucide-vue-next'
import type { FactoryBacklogItem } from '@/shared/factory'
import type { FactoryRunError } from '@/stores/factory'

const props = defineProps<{
  items: FactoryBacklogItem[]
  loading: boolean
  error: string | null
  runError: FactoryRunError | null
  claimedIds: string[]
  creating: boolean
  runId: string | null
}>()

const emit = defineEmits<{
  create: [input: { title: string; goal: string }]
  update: [input: { id: string; title: string; goal: string }]
  remove: [id: string]
  move: [id: string, direction: 'up' | 'down']
  'create-run': [ids: string[]]
}>()

const { t } = useI18n()

const newTitle = ref('')
const newGoal = ref('')
const editingId = ref<string | null>(null)
const editTitle = ref('')
const editGoal = ref('')
const selected = ref<string[]>([])

// 待办被删除或已经领取后，勾选状态必须跟着收敛。
watch(
  () => props.items,
  (items) => {
    const ids = new Set(items.map((item) => item.id))
    selected.value = selected.value.filter((id) => ids.has(id))
  },
)

// 运行创建成功后清空勾选，避免下一次点击直接撞上「重复领取」。
watch(
  () => props.runId,
  () => {
    selected.value = []
  },
)

function submitCreate(): void {
  const title = newTitle.value.trim()
  if (!title) return
  emit('create', { title, goal: newGoal.value.trim() })
  newTitle.value = ''
  newGoal.value = ''
}

function startEdit(item: FactoryBacklogItem): void {
  editingId.value = item.id
  editTitle.value = item.title
  editGoal.value = item.goal
}

function cancelEdit(): void {
  editingId.value = null
}

function submitEdit(): void {
  if (!editingId.value) return
  const title = editTitle.value.trim()
  if (!title) return
  emit('update', { id: editingId.value, title, goal: editGoal.value.trim() })
  editingId.value = null
}

function submitRun(): void {
  if (!selected.value.length) return
  emit('create-run', [...selected.value])
}
</script>

<style lang="scss" scoped>
.backlog-panel {
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
  color: var(--error);
}

.add-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.text-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-2xs, 11px);
  resize: vertical;

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
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.35;
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

.backlog-list {
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

.backlog-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.item-main {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  flex: 1;
  min-width: 0;
  cursor: pointer;

  input[type='checkbox'] {
    margin-top: 2px;
    accent-color: var(--accent-primary);
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

.item-goal {
  font-size: var(--text-2xs, 11px);
  line-height: 1.5;
  color: var(--text-muted);
  word-break: break-word;
}

.item-claimed {
  font-size: var(--text-2xs, 11px);
  color: var(--warning);
}

.row-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.panel-foot {
  padding-top: 4px;
  border-top: 1px solid var(--surface-border);
}
</style>

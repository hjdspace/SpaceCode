<template>
  <div class="todo-due-field">
    <span v-if="disabled" class="due-static">
      <CalendarClock :size="12" />
      {{ modelValue === null ? t('todo.detail.noDue') : staticLabel }}
    </span>
    <template v-else>
      <CalendarField
        :model-value="dateValue"
        :label="dateLabel ?? t('todo.detail.date')"
        :placeholder="t('todo.detail.noDue')"
        @update:model-value="onDate"
      />
      <TimeWheelField
        v-if="dateValue"
        :model-value="timeValue"
        :label="timeLabel ?? t('todo.detail.time')"
        @update:model-value="onTime"
      />
      <button
        v-if="modelValue !== null"
        type="button"
        class="due-clear"
        :title="t('todo.detail.clearDue')"
        :aria-label="t('todo.detail.clearDue')"
        @click="emit('update:modelValue', null)"
      >
        <X :size="13" />
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarClock, X } from 'lucide-vue-next'
import CalendarField from '@/components/common/CalendarField.vue'
import TimeWheelField from '@/components/common/TimeWheelField.vue'
import { combineDateAndTime, formatDueShort, splitDueAt } from '@/utils/todoTime'

const props = defineProps<{
  /** Unix ms；null = 未设置 */
  modelValue: number | null
  dateLabel?: string
  timeLabel?: string
  /** 只读来源（macOS 只读列表）不给编辑入口 */
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()

const { t, locale } = useI18n()

const dateValue = computed(() => (props.modelValue === null ? '' : splitDueAt(props.modelValue).date))
const timeValue = computed(() => (props.modelValue === null ? '09:00' : splitDueAt(props.modelValue).time))
const staticLabel = computed(() =>
  props.modelValue === null ? '' : formatDueShort(props.modelValue, Date.now(), locale.value),
)

function onDate(date: string): void {
  if (!date) {
    emit('update:modelValue', null)
    return
  }
  emit('update:modelValue', combineDateAndTime(date, timeValue.value))
}

function onTime(time: string): void {
  // 只改时间时日期必然已选（时间字段仅在 dateValue 非空时渲染）
  emit('update:modelValue', combineDateAndTime(dateValue.value, time))
}
</script>

<style lang="scss" scoped>
.todo-due-field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.due-static {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.due-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--bg-hover);
    color: var(--error);
  }
}
</style>
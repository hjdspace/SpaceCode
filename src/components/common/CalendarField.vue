<template>
  <div class="calendar-field">
    <button
      ref="triggerRef"
      type="button"
      class="field-trigger"
      :class="{ 'field-trigger--invalid': invalid }"
      :aria-label="label"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="field-value" :class="{ 'field-value--empty': !modelValue }">
        {{ modelValue || placeholder }}
      </span>
      <Calendar :size="14" class="field-icon" />
    </button>

    <PopoverPanel :open="open" :anchor="triggerRef" :z-index="1300" @close="open = false">
      <div class="calendar">
        <div class="calendar-head">
          <button type="button" class="calendar-nav" :aria-label="t('common.prevMonth')" @click="shiftMonth(-1)">
            <ChevronLeft :size="16" />
          </button>
          <span class="calendar-title">{{ monthTitle }}</span>
          <button type="button" class="calendar-nav" :aria-label="t('common.nextMonth')" @click="shiftMonth(1)">
            <ChevronRight :size="16" />
          </button>
        </div>

        <div class="calendar-weekdays" aria-hidden="true">
          <span v-for="(w, i) in weekdayLabels" :key="i">{{ w }}</span>
        </div>

        <div class="calendar-grid">
          <button
            v-for="cell in cells"
            :key="cell.key"
            type="button"
            class="calendar-day"
            :class="{
              'is-other-month': !cell.inMonth,
              'is-today': cell.isToday,
              'is-selected': cell.isSelected,
            }"
            :disabled="cell.disabled"
            :data-date="cell.key"
            :aria-label="cell.key"
            :aria-current="cell.isSelected ? 'date' : undefined"
            @click="selectDate(cell.key)"
          >
            {{ cell.day }}
          </button>
        </div>
      </div>
    </PopoverPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import PopoverPanel from './PopoverPanel.vue'

const props = withDefaults(defineProps<{
  /** YYYY-MM-DD；空串表示未选 */
  modelValue: string
  /** 含边界的 YYYY-MM-DD。ISO 串可直接字典序比较 */
  min?: string
  max?: string
  label: string
  placeholder?: string
  invalid?: boolean
}>(), {
  min: '',
  max: '',
  placeholder: '—',
  invalid: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t, locale } = useI18n()

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function fromKey(value: string): Date | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!matched) return null
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
}

const todayKey = toKey(new Date())

/** 打开时把视图对准已选日期，没有就落在今天 */
const view = ref({ year: new Date().getFullYear(), month: new Date().getMonth() })

watch(open, (isOpen) => {
  if (!isOpen) return
  const anchorDate = fromKey(props.modelValue) || new Date()
  view.value = { year: anchorDate.getFullYear(), month: anchorDate.getMonth() }
})

const monthTitle = computed(() => {
  const { year, month } = view.value
  return new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }).format(
    new Date(year, month, 1),
  )
})

/** 周一为一周首日，与 cron 的 1-5 工作日口径一致 */
const weekdayLabels = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  // 2024-01-01 是周一
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)))
})

function isDisabled(key: string): boolean {
  if (props.min && key < props.min) return true
  if (props.max && key > props.max) return true
  return false
}

const cells = computed(() => {
  const { year, month } = view.value
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(year, month, 1 - firstWeekday + i)
    const key = toKey(date)
    return {
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: key === todayKey,
      isSelected: key === props.modelValue,
      disabled: isDisabled(key),
    }
  })
})

function shiftMonth(delta: number) {
  const { year, month } = view.value
  const next = new Date(year, month + delta, 1)
  view.value = { year: next.getFullYear(), month: next.getMonth() }
}

function selectDate(key: string) {
  emit('update:modelValue', key)
  open.value = false
}
</script>

<style lang="scss" scoped>
.field-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 148px;
  padding: 8px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-md);
  font-family: var(--font-mono);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    border-color: var(--border-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  &--invalid {
    border-color: var(--error);
  }
}

.field-value {
  flex: 1;
  text-align: left;

  &--empty {
    color: var(--text-disabled);
    font-family: inherit;
  }
}

.field-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.calendar {
  width: 264px;
  padding: 12px;
}

.calendar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.calendar-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-primary);
}

.calendar-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 4px;
  text-align: center;
  font-size: var(--text-2xs);
  color: var(--text-disabled);
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.calendar-day {
  height: 30px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  &:disabled {
    color: var(--text-disabled);
    cursor: not-allowed;
  }

  &.is-other-month {
    color: var(--text-disabled);
  }

  &.is-today {
    box-shadow: inset 0 0 0 1px var(--accent-primary);
  }

  &.is-selected {
    background: var(--accent-primary);
    color: #fff;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }
}
</style>

<template>
  <div class="time-wheel-field">
    <button
      ref="triggerRef"
      type="button"
      class="field-trigger"
      :class="{ 'field-trigger--invalid': invalid }"
      :aria-label="label"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="field-value">{{ modelValue }}</span>
      <Clock :size="14" class="field-icon" />
    </button>

    <PopoverPanel :open="open" :anchor="triggerRef" :z-index="1300" @close="open = false">
      <div class="wheel" :style="wheelVars">
        <div class="wheel-cols">
          <div
            v-for="kind in kinds"
            :key="kind"
            :ref="kind === 'hour' ? setHourCol : setMinuteCol"
            class="wheel-col"
            role="listbox"
            tabindex="0"
            :aria-label="kind === 'hour' ? t('common.hour') : t('common.minute')"
            :aria-activedescendant="`wheel-${kind}-${index[kind]}`"
            @scroll="onScroll(kind)"
            @keydown="onKeydown(kind, $event)"
          >
            <button
              v-for="n in options(kind)"
              :id="`wheel-${kind}-${n}`"
              :key="n"
              type="button"
              role="option"
              class="wheel-item"
              :class="{ 'is-selected': index[kind] === n }"
              :aria-selected="index[kind] === n"
              :data-value="n"
              @click="pick(kind, n)"
            >
              {{ pad(n) }}
            </button>
          </div>
        </div>
        <div class="wheel-footer">
          <button type="button" class="wheel-confirm" @click="open = false">
            {{ t('common.confirm') }}
          </button>
        </div>
      </div>
    </PopoverPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock } from 'lucide-vue-next'
import PopoverPanel from './PopoverPanel.vue'

type WheelKind = 'hour' | 'minute'

const props = withDefaults(defineProps<{
  /** HH:MM，两位补零 */
  modelValue: string
  label: string
  invalid?: boolean
}>(), {
  invalid: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useI18n()

/** 单项高度与可视行数共同决定吸附位：scrollTop = index * ITEM_H 即居中 */
const ITEM_H = 34
const COL_HEIGHT = 170
const COL_PADDING = (COL_HEIGHT - ITEM_H) / 2

const kinds: WheelKind[] = ['hour', 'minute']

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const hourCol = ref<HTMLElement | null>(null)
const minuteCol = ref<HTMLElement | null>(null)

const index = ref<Record<WheelKind, number>>({ hour: 9, minute: 0 })

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 滚轮几何只在这里定义一次，JS 的 scrollTop 换算与 CSS 行高共用同一组值 */
const wheelVars = {
  '--wheel-item-h': `${ITEM_H}px`,
  '--wheel-col-h': `${COL_HEIGHT}px`,
  '--wheel-col-pad': `${COL_PADDING}px`,
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, n))
}

function maxOf(kind: WheelKind): number {
  return kind === 'hour' ? 23 : 59
}

function options(kind: WheelKind): number[] {
  return Array.from({ length: maxOf(kind) + 1 }, (_, i) => i)
}

function colEl(kind: WheelKind): HTMLElement | null {
  return kind === 'hour' ? hourCol.value : minuteCol.value
}

function setHourCol(el: unknown) {
  hourCol.value = el as HTMLElement | null
}

function setMinuteCol(el: unknown) {
  minuteCol.value = el as HTMLElement | null
}

function parse(value: string): Record<WheelKind, number> {
  const matched = /^(\d{1,2}):(\d{1,2})$/.exec(value)
  return {
    hour: matched ? clamp(Number(matched[1]), 23) : 9,
    minute: matched ? clamp(Number(matched[2]), 59) : 0,
  }
}

/** 外部改值（如回填任务）要滚到新值；自己 emit 回来的同值不再滚动 */
let lastEmitted = ''

watch(() => props.modelValue, (value) => {
  index.value = parse(value)
  if (value === lastEmitted) return
  if (!open.value) return
  void nextTick(() => {
    scrollToIndex('hour', index.value.hour, false)
    scrollToIndex('minute', index.value.minute, false)
  })
})

watch(open, (isOpen) => {
  if (!isOpen) return
  index.value = parse(props.modelValue)
  void nextTick(() => {
    scrollToIndex('hour', index.value.hour, false)
    scrollToIndex('minute', index.value.minute, false)
  })
})

onMounted(() => {
  index.value = parse(props.modelValue)
})

function scrollToIndex(kind: WheelKind, i: number, smooth: boolean) {
  const el = colEl(kind)
  // jsdom 等环境没有 Element.scrollTo，缺它时只丢动画，不影响选中值
  el?.scrollTo?.({ top: i * ITEM_H, behavior: smooth ? 'smooth' : 'auto' })
}

function emitValue() {
  lastEmitted = `${pad(index.value.hour)}:${pad(index.value.minute)}`
  emit('update:modelValue', lastEmitted)
}

function commitFromScroll(kind: WheelKind) {
  const el = colEl(kind)
  if (!el) return
  const i = clamp(Math.round(el.scrollTop / ITEM_H), maxOf(kind))
  if (i !== index.value[kind]) {
    index.value = { ...index.value, [kind]: i }
    emitValue()
  }
}

/** 每列一帧只取一次值：等吸附动画结束才提交，手感就是每停一下卡一下 */
const pendingFrames = new Map<WheelKind, number>()

function onScroll(kind: WheelKind) {
  if (pendingFrames.has(kind)) return
  pendingFrames.set(kind, requestAnimationFrame(() => {
    pendingFrames.delete(kind)
    commitFromScroll(kind)
  }))
}

onBeforeUnmount(() => {
  pendingFrames.forEach((frame) => cancelAnimationFrame(frame))
  pendingFrames.clear()
})

function pick(kind: WheelKind, i: number) {
  index.value = { ...index.value, [kind]: i }
  scrollToIndex(kind, i, true)
  emitValue()
}

function onKeydown(kind: WheelKind, e: KeyboardEvent) {
  const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
  if (!step) return
  e.preventDefault()
  const next = clamp(index.value[kind] + step, maxOf(kind))
  if (next === index.value[kind]) return
  pick(kind, next)
}
</script>

<style lang="scss" scoped>
.field-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 96px;
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
}

.field-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.wheel {
  width: 188px;
  padding: 8px 0 0;
}

.wheel-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 0 8px;
}

.wheel-col {
  height: var(--wheel-col-h);
  overflow-y: auto;
  overscroll-behavior: contain;
  // mandatory 会把每次滚轮手势锁死成一格，滚动看起来是断的；proximity 保留吸附又不拦手势
  scroll-snap-type: y proximity;
  scrollbar-width: none;
  outline: none;
  // 上下各留 (可视高 - 行高)/2，让首尾项也能滚到正中
  padding: var(--wheel-col-pad) 0;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #000 32%,
    #000 68%,
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #000 32%,
    #000 68%,
    transparent 100%
  );

  &::-webkit-scrollbar {
    display: none;
  }

  &:focus-visible {
    border-radius: var(--radius-sm);
    box-shadow: inset 0 0 0 1px var(--accent-primary-glow);
  }
}

.wheel-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: var(--wheel-item-h);
  scroll-snap-align: center;
  border: none;
  border-radius: var(--radius-md);
  background: none;
  color: var(--text-disabled);
  font-size: var(--text-base);
  font-family: var(--font-mono);
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);

  &:hover {
    color: var(--text-secondary);
  }

  &.is-selected {
    background: var(--surface-card);
    color: var(--text-primary);
    font-weight: 600;
  }
}

.wheel-footer {
  display: flex;
  justify-content: flex-end;
  padding: 8px 12px;
  border-top: 1px solid var(--border-subtle);
}

.wheel-confirm {
  padding: 6px 16px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--accent-primary);
  color: #fff;
  font-size: var(--text-md);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--accent-primary-hover);
  }
}
</style>

<!-- src/pet-window/PetWindowApp.vue -->
<!-- 桌面宠物独立窗口根组件。从 cc-haha PetApp.tsx 移植为 Vue 3 组合式 API。
     负责：sprite 渲染调度（委托 PetSpriteAtlas）、任务面板、拖拽、视线跟踪、
     瞬态交互动画、鼠标穿透区域上报。状态由主应用通过 onStateUpdate 推送。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watchEffect } from 'vue'
import PetSpriteAtlas from '@/components/pets/PetSpriteAtlas.vue'
import {
  getPetAnimationDurationMs,
  quantizePetLookDirection,
  type PetAnimationState,
  type PetLookDirection,
} from '@/lib/petAnimation'
import { petStatusAnimation, type PetSessionActivity, type PetSessionStatus } from '@/lib/petSessionModel'
import {
  DEFAULT_PET_PREFERENCES,
  type BuiltinPetDescriptor,
  type PetInteractiveRegion,
  type PetMainWindowEvent,
  type PetPreferences,
  type PetSyncPayload,
  type PetWindowEvent,
} from '@/types/pet'

// ── 窗口 API（petPreload.ts 暴露的 window.petWindowAPI）──
// 现有 d.ts 声明里 onMainWindowEvent / closePet 缺失，这里用一个精确类型桥接，
// 避免使用 any。运行时对象（petPreload.ts）实际具备全部方法。

type PetWindowAPIFull = {
  getInitialState: () => Promise<unknown>
  onStateUpdate: (handler: (payload: PetSyncPayload) => void) => () => void
  emitWindowEvent: (event: PetWindowEvent) => void
  onMainWindowEvent: (handler: (event: PetMainWindowEvent) => void) => () => void
  getLocale: () => Promise<'zh-CN' | 'en-US'>
  closePet: () => Promise<void>
}

function getPetAPI(): PetWindowAPIFull {
  const api = window.petWindowAPI
  if (!api) throw new Error('window.petWindowAPI is not available')
  return api as unknown as PetWindowAPIFull
}

function emit(event: PetWindowEvent): void {
  // emitWindowEvent 在 d.ts 中声明为 (event: any) => void，PetWindowEvent 可直接传入。
  window.petWindowAPI?.emitWindowEvent(event)
}

// ── 常量（对齐 cc-haha PetApp.tsx）──

const PET_DRAG_THRESHOLD_PX = 4
const PET_LOOK_DEADZONE_PX = 12

type PanelPlacement = 'above' | 'below'
type DragDirection = 'left' | 'right'

interface PetDragGesture {
  pointerId: number
  startScreenX: number
  startScreenY: number
  directionScreenX: number
  lastScreenX: number
  lastScreenY: number
  dragStarted: boolean
}

// ── 同步状态（由主应用推送）──

const state = reactive<{
  pet: BuiltinPetDescriptor | null
  preferences: PetPreferences | null
  activities: PetSessionActivity[]
  primaryActivity: PetSessionActivity | null
  locale: 'zh-CN' | 'en-US'
}>({
  pet: null,
  preferences: null,
  activities: [],
  primaryActivity: null,
  locale: 'zh-CN',
})

// ── 本地交互状态（非同步）──

const transientState = ref<PetAnimationState | null>(null)
const dragDirection = ref<DragDirection | null>(null)
const lookDirection = ref<PetLookDirection | null | undefined>(undefined)
const isMascotDragging = ref(false)
const panelPlacement = ref<PanelPlacement>('above')

let transientTimer: ReturnType<typeof setTimeout> | null = null
let suppressClickTimer: ReturnType<typeof setTimeout> | null = null
let suppressNextMascotClick = false
let dragGesture: PetDragGesture | null = null

// ── DOM 引用 ──

const stackRef = ref<HTMLDivElement | null>(null)
const mascotRef = ref<HTMLButtonElement | null>(null)
const taskBadgeRef = ref<HTMLButtonElement | null>(null)
const activityCardRef = ref<HTMLElement | null>(null)
const panelToggleRef = ref<HTMLButtonElement | null>(null)

let unsubState: (() => void) | null = null
let unsubMain: (() => void) | null = null

// ── 计算属性 ──

const size = computed(() => state.preferences?.size ?? DEFAULT_PET_PREFERENCES.size)
const motionEnabled = computed(() => state.preferences?.motionEnabled ?? DEFAULT_PET_PREFERENCES.motionEnabled)
const showTaskPanel = computed(() => state.preferences?.showTaskPanel ?? DEFAULT_PET_PREFERENCES.showTaskPanel)
const panelCollapsed = computed(() => state.preferences?.panelCollapsed ?? DEFAULT_PET_PREFERENCES.panelCollapsed)

// 非空闲活动列表（任务面板只展示进行中的任务，对齐 cc-haha 的 filter）
const visibleActivities = computed(() =>
  state.activities.filter((activity) => activity.status !== 'idle'),
)
const activeCount = computed(() => visibleActivities.value.length)
const hasActiveTasks = computed(() => activeCount.value > 0)

// 任务面板折叠态：panelCollapsed 或 showTaskPanel 关闭时只显示角标
const isPanelCollapsed = computed(() => panelCollapsed.value || !showTaskPanel.value)
const showCard = computed(() => hasActiveTasks.value && !isPanelCollapsed.value)
const showBadge = computed(() => hasActiveTasks.value && isPanelCollapsed.value)

// 动画状态优先级（对齐 cc-haha PetApp.tsx:328-332）：
// 拖拽方向 > 瞬态交互（jumping/waving）> 任务状态 > idle
const baseAnimation = computed<PetAnimationState>(() =>
  state.primaryActivity ? petStatusAnimation(state.primaryActivity.status) : 'idle',
)
const animationState = computed<PetAnimationState>(() => {
  const dir = dragDirection.value
  if (dir === 'left' || dir === 'right') {
    return `running-${dir}`
  }
  return transientState.value ?? baseAnimation.value
})

// 仅在 idle 时把视线方向传给 sprite
const spriteLookDirection = computed<PetLookDirection | null | undefined>(() =>
  animationState.value === 'idle' ? lookDirection.value : undefined,
)

const accentColor = computed(() => state.pet?.accent ?? '#6366f1')

// ── 瞬态动画 ──

function playTransient(next: PetAnimationState, durationMs?: number): void {
  if (transientTimer) {
    clearTimeout(transientTimer)
    transientTimer = null
  }
  transientState.value = next
  const duration = durationMs ?? getPetAnimationDurationMs(next) * 3
  transientTimer = setTimeout(() => {
    transientState.value = null
    transientTimer = null
  }, duration)
}

// ── 交互区命中检测 / 鼠标穿透 ──

function interactiveElements(): (HTMLElement | null)[] {
  return [mascotRef.value, taskBadgeRef.value, activityCardRef.value, panelToggleRef.value]
}

function isInteractivePoint(x: number, y: number): boolean {
  return interactiveElements().some((element) => {
    if (!element) return false
    const rect = element.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  })
}

function releasePointerPassthrough(nextTarget: EventTarget | null): void {
  if (dragGesture) return
  const nextNode = typeof Node !== 'undefined' && nextTarget instanceof Node ? nextTarget : null
  const remainsInteractive = nextNode !== null && interactiveElements().some((element) =>
    element ? element.contains(nextNode) : false,
  )
  if (remainsInteractive) return
  lookDirection.value = undefined
  emit({ type: 'setIgnoreMouseEvents', ignore: true })
}

// ── 拖拽（Pointer Events，对齐 cc-haha PetApp.tsx:556-611）──

function onMascotPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || event.isPrimary === false || dragGesture) return
  suppressNextMascotClick = false
  if (suppressClickTimer) {
    clearTimeout(suppressClickTimer)
    suppressClickTimer = null
  }
  dragGesture = {
    pointerId: event.pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    directionScreenX: event.screenX,
    lastScreenX: event.screenX,
    lastScreenY: event.screenY,
    dragStarted: false,
  }
  emit({ type: 'setIgnoreMouseEvents', ignore: false })
  try {
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
  } catch {
    // 指针已被取消时 setPointerCapture 可能抛错，忽略。
  }
}

function onMascotPointerMove(event: PointerEvent): void {
  const gesture = dragGesture
  if (!gesture || gesture.pointerId !== event.pointerId || (event.buttons & 1) === 0) return
  gesture.lastScreenX = event.screenX
  gesture.lastScreenY = event.screenY
  if (!gesture.dragStarted) {
    const distance = Math.hypot(
      event.screenX - gesture.startScreenX,
      event.screenY - gesture.startScreenY,
    )
    if (distance < PET_DRAG_THRESHOLD_PX) return
    suppressNextMascotClick = true
    isMascotDragging.value = true
    gesture.dragStarted = true
    emit({ type: 'drag', phase: 'start', x: gesture.startScreenX, y: gesture.startScreenY })
  }
  const directionDelta = event.screenX - gesture.directionScreenX
  if (Math.abs(directionDelta) >= PET_DRAG_THRESHOLD_PX) {
    dragDirection.value = directionDelta < 0 ? 'left' : 'right'
    gesture.directionScreenX = event.screenX
  }
  emit({ type: 'drag', phase: 'move', x: event.screenX, y: event.screenY })
  event.preventDefault()
}

function finishMascotDrag(event: PointerEvent, releaseCapture: boolean): void {
  const gesture = dragGesture
  if (!gesture || gesture.pointerId !== event.pointerId) return
  const x = Number.isFinite(event.screenX) ? event.screenX : gesture.lastScreenX
  const y = Number.isFinite(event.screenY) ? event.screenY : gesture.lastScreenY
  const wasDragging = gesture.dragStarted
  dragGesture = null
  isMascotDragging.value = false
  dragDirection.value = null

  if (wasDragging) {
    event.preventDefault()
    // 拖拽结束后屏蔽紧随的 click，避免误触发 focusMain。
    suppressNextMascotClick = true
    if (suppressClickTimer) clearTimeout(suppressClickTimer)
    suppressClickTimer = setTimeout(() => {
      suppressNextMascotClick = false
      suppressClickTimer = null
    }, 0)
    emit({ type: 'drag', phase: 'end', x, y })
  }

  if (releaseCapture) {
    try {
      const target = event.currentTarget as HTMLElement
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId)
      }
    } catch {
      // 浏览器可能已先行释放捕获。
    }
  }
  if (!isInteractivePoint(event.clientX, event.clientY)) {
    lookDirection.value = undefined
    emit({ type: 'setIgnoreMouseEvents', ignore: true })
  }
}

// ── mascot 交互 ──

function onMascotMouseEnter(): void {
  emit({ type: 'setIgnoreMouseEvents', ignore: false })
  if (!dragGesture && animationState.value === 'idle') {
    playTransient('jumping')
  }
}

function onMascotMouseLeave(event: MouseEvent): void {
  releasePointerPassthrough(event.relatedTarget)
}

function onMascotClick(): void {
  if (suppressNextMascotClick) {
    suppressNextMascotClick = false
    if (suppressClickTimer) {
      clearTimeout(suppressClickTimer)
      suppressClickTimer = null
    }
    return
  }
  emit({ type: 'focusMain' })
  playTransient('waving', getPetAnimationDurationMs('waving') * 3)
}

function onMascotContextMenu(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  emit({ type: 'contextMenu' })
}

// ── stack 视线跟踪 + 穿透 ──

function onStackMouseEnter(): void {
  emit({ type: 'setIgnoreMouseEvents', ignore: false })
}

function onStackMouseMove(event: MouseEvent): void {
  if (dragGesture) return
  if (animationState.value !== 'idle') return
  const rect = mascotRef.value?.getBoundingClientRect()
  if (!rect) return
  lookDirection.value = quantizePetLookDirection(
    event.clientX - (rect.left + rect.width / 2),
    event.clientY - (rect.top + rect.height / 2),
    PET_LOOK_DEADZONE_PX,
  )
}

function onStackMouseLeave(): void {
  if (dragGesture) return
  lookDirection.value = undefined
  emit({ type: 'setIgnoreMouseEvents', ignore: true })
}

// ── 任务面板交互 ──

function onInteractiveMouseEnter(): void {
  emit({ type: 'setIgnoreMouseEvents', ignore: false })
}

function onInteractiveMouseLeave(event: MouseEvent): void {
  releasePointerPassthrough(event.relatedTarget)
}

function onBadgeClick(): void {
  emit({ type: 'preferencesChanged', preferences: { panelCollapsed: false } })
}

function onPanelToggleClick(): void {
  emit({ type: 'preferencesChanged', preferences: { panelCollapsed: true } })
}

function onSessionClick(sessionId: string): void {
  emit({ type: 'focusSession', sessionId })
}

// ── 状态文案 / 指示器 class ──
// i18n key 待补：pet.window.status.waiting / .failed / .running / .idle
// i18n key 待补：pet.window.untitledSession / .activeTasksTitle / .interact / .expandTasks / .hideTasks

function statusText(status: PetSessionStatus): string {
  switch (status) {
    case 'waiting': return '等待你处理'
    case 'failed': return '需要关注'
    case 'running': return '工作中'
    case 'idle': return '空闲'
  }
}

function statusDotClass(status: PetSessionStatus): string {
  switch (status) {
    case 'waiting': return 'is-waiting'
    case 'failed': return 'is-failed'
    case 'running': return 'is-running'
    case 'idle': return 'is-idle'
  }
}

function sessionTitle(activity: PetSessionActivity): string {
  return activity.title || '未命名会话'
}

// ── 交互区上报（ResizeObserver，对齐 cc-haha PetApp.tsx:363-409）──

function buildRegions(): PetInteractiveRegion[] {
  const regions: PetInteractiveRegion[] = []
  for (const element of interactiveElements()) {
    if (!element) continue
    const rect = element.getBoundingClientRect()
    regions.push({
      x: Math.max(0, Math.floor(rect.x)),
      y: Math.max(0, Math.floor(rect.y)),
      width: Math.max(1, Math.ceil(rect.width)),
      height: Math.max(1, Math.ceil(rect.height)),
    })
  }
  return regions
}

watchEffect((onCleanup) => {
  // 读取这些响应式依赖以触发重新上报：元素出现/消失、面板展开/翻转、尺寸或宠物变化。
  void state.activities.length
  void showCard.value
  void panelPlacement.value
  void state.preferences?.size
  void state.pet?.id

  const targets = interactiveElements().filter((el): el is HTMLElement => el !== null)
  if (targets.length === 0) return

  const updateRegions = (): void => {
    const regions = buildRegions()
    if (regions.length === 0) return
    emit({ type: 'setInteractiveRegions', regions })
  }

  updateRegions()
  const observer = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(updateRegions)
  targets.forEach((target) => observer?.observe(target))
  window.addEventListener('resize', updateRegions)

  onCleanup(() => {
    observer?.disconnect()
    window.removeEventListener('resize', updateRegions)
  })
}, { flush: 'post' })

// ── 生命周期 ──

onMounted(() => {
  const api = getPetAPI()

  api.getLocale()
    .then((locale) => {
      state.locale = locale
    })
    .catch(() => undefined)

  unsubState = api.onStateUpdate((payload: PetSyncPayload) => {
    state.pet = payload.pet
    state.preferences = payload.preferences
    state.activities = payload.activities
    state.primaryActivity = payload.primaryActivity
    state.locale = payload.locale
  })

  unsubMain = api.onMainWindowEvent((event: PetMainWindowEvent) => {
    if (event.type === 'panelPlacementChanged') {
      // 贴边翻转同步
      if (event.placement === panelPlacement.value) return
      panelPlacement.value = event.placement
    } else if (event.type === 'navigateSession') {
      // 主应用已跳转，闪烁提示一下
      playTransient('waving', getPetAnimationDurationMs('waving') * 3)
    }
    // visibilityChanged：窗口可见性由主进程管理，无需处理。
  })

  // 触发主进程推送初始状态
  api.getInitialState().catch(() => undefined)
})

onUnmounted(() => {
  unsubState?.()
  unsubMain?.()
  unsubState = null
  unsubMain = null
  if (transientTimer) {
    clearTimeout(transientTimer)
    transientTimer = null
  }
  if (suppressClickTimer) {
    clearTimeout(suppressClickTimer)
    suppressClickTimer = null
  }
  // 窗口销毁前恢复鼠标穿透，避免遗留不可点击区域
  try {
    emit({ type: 'setIgnoreMouseEvents', ignore: true })
  } catch {
    // 忽略：窗口可能已在销毁中。
  }
})
</script>

<template>
  <main
    class="pet-window-root"
    :data-expanded="showCard ? 'true' : 'false'"
    :style="{ '--pet-accent': accentColor }"
  >
    <div
      ref="stackRef"
      class="pet-window-stack"
      :data-panel-placement="panelPlacement"
      @mouseenter="onStackMouseEnter"
      @mousemove="onStackMouseMove"
      @mouseleave="onStackMouseLeave"
    >
      <div class="pet-mascot-wrap">
        <button
          v-if="state.pet"
          ref="mascotRef"
          type="button"
          class="pet-mascot-button"
          :data-dragging="isMascotDragging ? 'true' : 'false'"
          :data-drag-direction="dragDirection ?? undefined"
          aria-label="与宠物互动"
          @mouseenter="onMascotMouseEnter"
          @mouseleave="onMascotMouseLeave"
          @click="onMascotClick"
          @contextmenu="onMascotContextMenu"
          @pointerdown="onMascotPointerDown"
          @pointermove="onMascotPointerMove"
          @pointerup="finishMascotDrag($event, true)"
          @pointercancel="finishMascotDrag($event, true)"
          @lostpointercapture="finishMascotDrag($event, false)"
        >
          <PetSpriteAtlas
            :pet="state.pet"
            :state="animationState"
            :size="size"
            :motion-enabled="motionEnabled"
            :look-direction="spriteLookDirection"
          />
        </button>

        <button
          v-if="showBadge"
          ref="taskBadgeRef"
          type="button"
          class="pet-task-badge"
          :aria-label="`展开任务面板（${activeCount} 个）`"
          @mouseenter="onInteractiveMouseEnter"
          @mouseleave="onInteractiveMouseLeave"
          @click="onBadgeClick"
        >
          {{ activeCount }}
        </button>
      </div>

      <section
        v-if="showCard"
        ref="activityCardRef"
        class="pet-activity-card"
        :data-expanded="showCard ? 'true' : 'false'"
        :aria-label="`进行中的任务（${activeCount} 个）`"
        @mouseenter="onInteractiveMouseEnter"
        @mouseleave="onInteractiveMouseLeave"
      >
        <header class="pet-activity-card-header">
          <span class="pet-activity-card-title">进行中的任务</span>
          <span class="pet-activity-card-count">{{ activeCount }}</span>
        </header>

        <div class="pet-session-list" role="list">
          <div
            v-for="activity in visibleActivities"
            :key="activity.sessionId"
            role="listitem"
          >
            <button
              type="button"
              class="pet-session-row"
              :aria-label="`${sessionTitle(activity)}，${statusText(activity.status)}`"
              @click="onSessionClick(activity.sessionId)"
            >
              <span class="pet-session-copy">
                <span class="pet-session-title">{{ sessionTitle(activity) }}</span>
                <span class="pet-session-status">{{ statusText(activity.status) }}</span>
                <span v-if="activity.preview" class="pet-session-preview">{{ activity.preview }}</span>
              </span>
              <span class="pet-session-indicator" :class="statusDotClass(activity.status)" />
            </button>
          </div>
        </div>

        <button
          ref="panelToggleRef"
          type="button"
          class="pet-panel-toggle"
          :data-expanded="showCard ? 'true' : 'false'"
          aria-label="收起任务面板"
          @click="onPanelToggleClick"
          @mouseenter="onInteractiveMouseEnter"
          @mouseleave="onInteractiveMouseLeave"
        >
          <svg
            class="pet-panel-toggle-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </section>
    </div>
  </main>
</template>

<style scoped lang="scss">
.pet-window-root {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100vh;
  background: transparent;
  pointer-events: none;
  user-select: none;

  // 状态色（任务指定）
  --pet-waiting: #f59e0b;
  --pet-failed: #ef4444;
  --pet-running: #3b82f6;
  --pet-idle: #9ca3af;
  --pet-accent: #6366f1;
}

.pet-window-stack {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 0 12px 12px;
  pointer-events: none;
}

.pet-window-stack[data-panel-placement='below'] {
  justify-content: flex-start;
  padding: 12px 12px 0;
}

.pet-mascot-wrap {
  position: relative;
  order: 2;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  pointer-events: none;
}

.pet-window-stack[data-panel-placement='below'] .pet-mascot-wrap {
  order: 1;
}

.pet-mascot-button {
  position: relative;
  z-index: 10;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  margin-bottom: -2px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: grab;
  transform: scale(1);
  transform-origin: 50% 92%;
  transition: transform 160ms ease-out;
  -webkit-app-region: no-drag;
  pointer-events: auto;
  touch-action: none;
  will-change: transform;
}

.pet-mascot-button[data-dragging='true'] {
  cursor: grabbing;
  transform: scale(0.96);
}

.pet-mascot-button:focus-visible {
  outline: 3px solid rgba(255, 255, 255, 0.7);
  outline-offset: 3px;
  border-radius: 999px;
}

.pet-mascot-button::before {
  content: '';
  position: absolute;
  inset: 18% 8% 8%;
  border-radius: 50%;
  background:
    radial-gradient(circle at 35% 45%, rgba(112, 143, 255, 0.22), transparent 58%),
    radial-gradient(circle at 68% 62%, rgba(245, 151, 193, 0.16), transparent 62%);
  filter: blur(16px);
  pointer-events: none;
}

.pet-task-badge {
  position: absolute;
  z-index: 12;
  top: 8px;
  right: 2px;
  display: grid;
  min-width: 24px;
  height: 24px;
  place-items: center;
  padding: 0 6px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background: var(--pet-accent);
  box-shadow: 0 5px 14px rgba(13, 31, 48, 0.26);
  color: #fff;
  font: 650 12px/1 var(--font-body, system-ui, sans-serif);
  cursor: pointer;
  pointer-events: auto;
  -webkit-app-region: no-drag;
  transition: transform 140ms ease, background 140ms ease;
}

.pet-task-badge:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
}

.pet-task-badge:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.8);
  outline-offset: 2px;
}

.pet-activity-card {
  position: relative;
  z-index: 15;
  box-sizing: border-box;
  order: 1;
  flex: 0 0 auto;
  width: calc(100% - 32px);
  max-width: 360px;
  margin-bottom: 12px;
  padding: 6px 7px;
  overflow: visible;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 24px;
  background: rgba(24, 23, 30, 0.78);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 12px 30px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(20px) saturate(1.18);
  -webkit-backdrop-filter: blur(20px) saturate(1.18);
  pointer-events: auto;
  -webkit-app-region: no-drag;
}

.pet-window-stack[data-panel-placement='below'] .pet-activity-card {
  order: 2;
  margin-top: 12px;
  margin-bottom: 0;
}

.pet-activity-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 4px;
  color: rgba(255, 255, 255, 0.92);
}

.pet-activity-card-title {
  font: 650 12px/1.2 var(--font-body, system-ui, sans-serif);
  letter-spacing: 0.02em;
}

.pet-activity-card-count {
  display: grid;
  min-width: 18px;
  height: 18px;
  place-items: center;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--pet-accent);
  color: #fff;
  font: 650 11px/1 var(--font-body, system-ui, sans-serif);
}

.pet-session-list {
  display: flex;
  flex-direction: column;
  max-height: 160px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}

.pet-session-list::-webkit-scrollbar {
  display: none;
}

.pet-session-list > [role='listitem'] + [role='listitem'] {
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.pet-session-row {
  display: flex;
  width: 100%;
  min-height: 52px;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border: 0;
  border-radius: 17px;
  background: transparent;
  color: rgba(255, 255, 255, 0.92);
  cursor: pointer;
  text-align: left;
  transition: background 140ms ease, transform 140ms ease;
  -webkit-app-region: no-drag;
}

.pet-session-row:hover {
  background: rgba(255, 255, 255, 0.08);
}

.pet-session-row:active {
  transform: scale(0.985);
}

.pet-session-row:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.7);
  outline-offset: -2px;
}

.pet-session-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.pet-session-title,
.pet-session-status,
.pet-session-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pet-session-title {
  font: 650 13px/1.25 var(--font-body, system-ui, sans-serif);
}

.pet-session-status {
  color: rgba(236, 232, 243, 0.62);
  font: 500 11px/1.25 var(--font-body, system-ui, sans-serif);
}

.pet-session-preview {
  color: rgba(236, 232, 243, 0.48);
  font: 400 11px/1.3 var(--font-body, system-ui, sans-serif);
}

.pet-session-indicator {
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--pet-idle);
}

.pet-session-indicator.is-waiting {
  background: var(--pet-waiting);
}

.pet-session-indicator.is-failed {
  background: var(--pet-failed);
}

.pet-session-indicator.is-running {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(59, 130, 246, 0.32);
  border-top-color: var(--pet-running);
  background: transparent;
  animation: pet-status-spin 1s linear infinite;
}

.pet-panel-toggle {
  position: absolute;
  z-index: 13;
  right: 50%;
  bottom: -31px;
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: rgba(36, 39, 45, 0.82);
  color: rgba(239, 235, 246, 0.62);
  cursor: pointer;
  transform: translateX(50%);
  transition: background 140ms ease, color 140ms ease, transform 140ms ease;
  -webkit-app-region: no-drag;
}

.pet-activity-card[data-expanded='true'] .pet-panel-toggle {
  top: auto;
  transform: translateX(50%);
}

.pet-window-stack[data-panel-placement='below'] .pet-activity-card .pet-panel-toggle {
  top: -31px;
  bottom: auto;
}

.pet-window-stack[data-panel-placement='below'] .pet-panel-toggle-icon {
  transform: rotate(180deg);
}

.pet-panel-toggle:hover {
  background: rgba(255, 255, 255, 0.09);
  color: #fff;
}

.pet-panel-toggle:active {
  transform: translateX(50%) scale(0.94);
}

.pet-panel-toggle:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.7);
  outline-offset: -2px;
}

@keyframes pet-status-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

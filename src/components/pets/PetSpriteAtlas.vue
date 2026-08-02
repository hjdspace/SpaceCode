<!-- src/components/pets/PetSpriteAtlas.vue -->
<!-- 宠物精灵图集渲染器。从 cc-haha PetRenderer.tsx 移植为 Vue 3 组合式 API。
     核心机制：用 CSS background-image + 动态 background-position 切换 atlas 单帧，
     通过 requestAnimationFrame/setTimeout 帧调度循环驱动动画。 -->
<script setup lang="ts">
import { computed, onUnmounted, ref, watchEffect, type CSSProperties } from 'vue'
import {
  PET_ATLAS_V2,
  getPetAnimationPlaybackStep,
  getPetAnimationPlaybackTickAtElapsedMs,
  getPetLookFrame,
  type PetAnimationState,
  type PetAtlasFrame,
  type PetLookDirection,
} from '@/lib/petAnimation'
import type { BuiltinPetDescriptor } from '@/types/pet'

const props = defineProps<{
  pet: BuiltinPetDescriptor
  state: PetAnimationState
  size: number
  motionEnabled: boolean
  lookDirection?: PetLookDirection | null
}>()

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function getPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches
  } catch {
    return false
  }
}

const prefersReducedMotion = ref<boolean>(getPrefersReducedMotion())

let mediaQuery: MediaQueryList | null = null
const handleMediaChange = (event: MediaQueryListEvent): void => {
  prefersReducedMotion.value = event.matches
}

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  try {
    mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY)
    prefersReducedMotion.value = mediaQuery.matches
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMediaChange)
    } else {
      mediaQuery.addListener(handleMediaChange)
    }
  } catch {
    mediaQuery = null
  }
}

onUnmounted(() => {
  if (!mediaQuery) return
  if (typeof mediaQuery.removeEventListener === 'function') {
    mediaQuery.removeEventListener('change', handleMediaChange)
  } else {
    mediaQuery.removeListener(handleMediaChange)
  }
})

const effectiveMotionEnabled = computed(() => props.motionEnabled && !prefersReducedMotion.value)

// ── Dada 专属帧偏移（数值与 cc-haha PetRenderer.tsx 完全一致，请勿改动）──

const DADA_FRAME_CENTER_OFFSETS_X = {
  1: [8.5, 6.5, 7, 14, 13.5, 7, 3, -1.5],
  2: [-3.5, 3, 2.5, 3, 5, -2, -4.5, -7.5],
} as const

const DADA_FRAME_BASELINE_OFFSETS_Y = {
  1: [2, 3, 3, 0, 3, 0, 0, 0],
  2: [-6, 1, -1, 0, 0, 0, 0, 0],
} as const

type FrameOffset = Readonly<{ offsetX: number; offsetY: number }>

function getDadaFrameOffset(
  frame: PetAtlasFrame,
  size: number,
  height: number,
): FrameOffset {
  const rowOffsets = DADA_FRAME_CENTER_OFFSETS_X[
    frame.rowIndex as keyof typeof DADA_FRAME_CENTER_OFFSETS_X
  ]
  const baselineOffsets = DADA_FRAME_BASELINE_OFFSETS_Y[
    frame.rowIndex as keyof typeof DADA_FRAME_BASELINE_OFFSETS_Y
  ]
  return {
    offsetX: (rowOffsets?.[frame.columnIndex] ?? 0) * size / PET_ATLAS_V2.cellWidth,
    offsetY: (baselineOffsets?.[frame.columnIndex] ?? 0) * height / PET_ATLAS_V2.cellHeight,
  }
}

function getPetFrameOffset(
  petId: string,
  frame: PetAtlasFrame,
  size: number,
  height: number,
): FrameOffset {
  return petId === 'dada-code'
    ? getDadaFrameOffset(frame, size, height)
    : { offsetX: 0, offsetY: 0 }
}

function getAtlasBackgroundPosition(
  frame: PetAtlasFrame,
  offsetX: number,
  offsetY: number,
  size: number,
  height: number,
): string {
  return `${-frame.columnIndex * size + offsetX}px ${-frame.rowIndex * height + offsetY}px`
}

// ── 初始播放视觉（cc-haha 中 getInitialPetPlaybackVisual 的等价实现）──

type PetPlaybackPhase = 'action' | 'idle' | 'gaze'

type PetPlaybackVisual = Readonly<{
  frame: PetAtlasFrame
  motionState: PetAnimationState
  phase: PetPlaybackPhase
}>

function getInitialPetPlaybackVisual(
  requestedState: PetAnimationState,
  motionEnabled: boolean,
  lookDirection: PetLookDirection | null | undefined,
): PetPlaybackVisual {
  if (motionEnabled && requestedState === 'idle' && lookDirection !== undefined) {
    return {
      frame: getPetLookFrame(lookDirection),
      motionState: 'idle',
      phase: 'gaze',
    }
  }

  const step = getPetAnimationPlaybackStep(requestedState, 0)
  return {
    frame: step.frame,
    motionState: step.motionState,
    phase: step.phase,
  }
}

// ── 派生尺寸 / Atlas 状态 ──

const atlasUrl = computed(() => props.pet.spritesheetUrl)
const usesAtlas = computed(
  () => Number(props.pet.spriteVersionNumber) >= PET_ATLAS_V2.spriteVersionNumber,
)
const height = computed(() => props.size * PET_ATLAS_V2.cellHeight / PET_ATLAS_V2.cellWidth)

const initialPlayback = computed(() =>
  getInitialPetPlaybackVisual(props.state, effectiveMotionEnabled.value, props.lookDirection),
)

const initialFrameOffset = computed(() =>
  getPetFrameOffset(props.pet.id, initialPlayback.value.frame, props.size, height.value),
)

const spriteStyle = computed<CSSProperties>(() => {
  const s = props.size
  const h = height.value
  const frame = initialPlayback.value.frame
  const { offsetX, offsetY } = initialFrameOffset.value
  return {
    width: `${s}px`,
    height: `${h}px`,
    backgroundImage: `url(${JSON.stringify(atlasUrl.value)})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${s * PET_ATLAS_V2.columns}px ${h * PET_ATLAS_V2.rows}px`,
    backgroundPosition: getAtlasBackgroundPosition(frame, offsetX, offsetY, s, h),
    imageRendering: 'auto',
  }
})

// ── 帧调度循环（与 cc-haha usePetPlayback 对齐；通过直接操作 DOM 避免每帧重渲染）──

const stageRef = ref<HTMLDivElement | null>(null)
const spriteRef = ref<HTMLDivElement | null>(null)

watchEffect((onCleanup) => {
  const sprite = spriteRef.value
  const stage = stageRef.value
  if (!sprite || !stage) return

  const applyVisual = (visual: PetPlaybackVisual): void => {
    const { frame, motionState, phase } = visual
    sprite.dataset.petMotionState = motionState
    sprite.dataset.petMotionPhase = phase
    stage.dataset.petMotionState = motionState
    if (!usesAtlas.value) return

    const { offsetX, offsetY } = getPetFrameOffset(
      props.pet.id,
      frame,
      props.size,
      height.value,
    )
    sprite.dataset.petRow = String(frame.rowIndex)
    sprite.dataset.petColumn = String(frame.columnIndex)
    sprite.style.backgroundPosition = getAtlasBackgroundPosition(
      frame,
      offsetX,
      offsetY,
      props.size,
      height.value,
    )
  }

  const initialVisual = getInitialPetPlaybackVisual(
    props.state,
    effectiveMotionEnabled.value,
    props.lookDirection,
  )
  applyVisual(initialVisual)

  if (
    !effectiveMotionEnabled.value ||
    (props.state === 'idle' && props.lookDirection !== undefined)
  ) {
    return
  }

  const startedAt = performance.now()
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const updateFrame = (): void => {
    if (cancelled) return
    const tick = getPetAnimationPlaybackTickAtElapsedMs(
      props.state,
      Math.max(0, performance.now() - startedAt),
    )
    applyVisual({
      frame: tick.frame,
      motionState: tick.motionState,
      phase: tick.phase,
    })
    timer = setTimeout(updateFrame, Math.max(1, Math.ceil(tick.remainingDurationMs)))
  }

  updateFrame()

  onCleanup(() => {
    cancelled = true
    if (timer) clearTimeout(timer)
  })
}, { flush: 'post' })
</script>

<template>
  <div
    ref="stageRef"
    class="pet-sprite-stage"
    :data-pet-motion="effectiveMotionEnabled ? 'enabled' : 'disabled'"
    :data-pet-motion-state="initialPlayback.motionState"
    :style="{ width: size + 'px', height: height + 'px' }"
  >
    <div
      ref="spriteRef"
      class="pet-sprite"
      role="img"
      :aria-label="pet.displayName"
      :data-pet-state="state"
      :data-pet-motion-state="initialPlayback.motionState"
      :data-pet-motion-phase="initialPlayback.phase"
      :data-pet-row="usesAtlas ? initialPlayback.frame.rowIndex : undefined"
      :data-pet-column="usesAtlas ? initialPlayback.frame.columnIndex : undefined"
      :style="spriteStyle"
    />
  </div>
</template>

<style scoped lang="scss">
.pet-sprite-stage {
  flex-shrink: 0;
  position: relative;
}

.pet-sprite {
  width: 100%;
  height: 100%;
}
</style>

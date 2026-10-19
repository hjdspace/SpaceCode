import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from './settings'
import { isH5Mode } from '@/services/h5ApiClient'

export const SETTING_UP_STEPS = ['language', 'appearance', 'engine', 'model', 'workspace'] as const
export const STEP_COUNT = SETTING_UP_STEPS.length
/** 第 6 屏是「完成」回显，不算配置项，因此进度按前 5 项计。 */
export const SUMMARY_STEP = STEP_COUNT

function emptyAccepted(): boolean[] {
  return new Array(STEP_COUNT).fill(false)
}

export const useOnboardingStore = defineStore('onboarding', () => {
  const settingsStore = useSettingsStore()

  const visible = ref(false)
  const view = ref<'intro' | 'step'>('intro')
  const step = ref(0)
  /** 本次会话里按过「下一步」的项 —— 接受默认值也算过，跟原型口径一致。 */
  const accepted = ref<boolean[]>(emptyAccepted())
  const skipped = ref(false)

  let startupEvaluated = false

  const modelReady = computed(() => settingsStore.isConfigured)

  /**
   * 各项是否已定。1/2/3/5 看用户按没按过下一步（保持默认也算确认）；
   * 第 4 项（模型）看真配置 —— 没有 Key 就干不了活，按按钮不算数。
   */
  const stepDone = computed<boolean[]>(() => [
    accepted.value[0],
    accepted.value[1],
    accepted.value[2],
    modelReady.value,
    accepted.value[4]
  ])

  const doneCount = computed(() => stepDone.value.filter(Boolean).length)
  const firstIncomplete = computed(() => stepDone.value.findIndex(done => !done))
  const progressPercent = computed(() => (doneCount.value / STEP_COUNT) * 100)

  /**
   * 常驻提示条只在「用户主动跳过了引导、且确实还没配完」时出现。
   * skipped 这一项不能省：H5 端与首启动弹卡之前都不算主动跳过，不该看到这条桌面端提示。
   */
  const bannerVisible = computed(
    () => !visible.value && skipped.value && !settingsStore.hasCompletedOnboarding
  )

  function start() {
    view.value = 'intro'
    step.value = 0
    skipped.value = false
    visible.value = true
  }

  function beginSteps() {
    view.value = 'step'
    step.value = 0
  }

  function jumpTo(index: number) {
    view.value = 'step'
    step.value = index
  }

  function back() {
    if (step.value > 0) step.value -= 1
  }

  function advance() {
    if (view.value === 'intro') {
      beginSteps()
      return
    }
    if (step.value >= SUMMARY_STEP) {
      complete()
      return
    }
    accepted.value[step.value] = true
    step.value += 1
  }

  function skip() {
    visible.value = false
    skipped.value = true
    view.value = 'intro'
    step.value = 0
  }

  /** 走完 与 「不再提示」 是同一件事：把标记落盘，这个界面不再回来。 */
  function complete() {
    settingsStore.hasCompletedOnboarding = true
    skipped.value = false
    visible.value = false
    void settingsStore.saveSettings()
  }

  // 首启动判定必须等 gui-settings.json 读完：标记还在默认 false 时会误弹给所有老用户。
  watch(() => settingsStore.settingsReady, (ready) => {
    if (startupEvaluated || !ready) return
    startupEvaluated = true
    if (isH5Mode()) return
    if (!settingsStore.hasCompletedOnboarding) start()
  }, { immediate: true })

  return {
    visible,
    view,
    step,
    accepted,
    skipped,
    modelReady,
    stepDone,
    doneCount,
    firstIncomplete,
    progressPercent,
    bannerVisible,
    start,
    beginSteps,
    jumpTo,
    back,
    advance,
    skip,
    complete
  }
})

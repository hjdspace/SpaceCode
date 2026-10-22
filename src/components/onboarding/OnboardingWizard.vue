<template>
  <div class="ob-overlay" role="dialog" aria-modal="true">
    <div class="ob-card" :class="{ 'is-intro': onboarding.view === 'intro' }">
      <div
        v-if="onboarding.view === 'intro'"
        class="ob-intro-lang ob-seg"
        role="group"
        :aria-label="t('onboarding.step.language.eyebrow')"
      >
        <button
          v-for="option in INTRO_LANGUAGES"
          :key="option.id"
          type="button"
          :class="{ 'is-active': settings.language === option.id }"
          :aria-pressed="settings.language === option.id"
          @click="selectIntroLanguage(option.id)"
        >
          {{ option.label }}
        </button>
      </div>

      <OnboardingRail v-if="onboarding.view === 'step'" />

      <div class="ob-main">
        <template v-if="onboarding.view === 'intro'">
          <div class="ob-intro">
            <img class="ob-intro-mark" :src="appIcon" alt="SpaceCode" />
            <h1>{{ t('onboarding.intro.title') }}</h1>
            <p class="ob-intro-sub">{{ t('onboarding.intro.subtitle') }}</p>
            <div class="ob-prep">
              <span class="ob-prep-lead">{{ t('onboarding.intro.prep') }}</span>
              <span v-for="key in SETTING_UP_STEPS" :key="key" class="ob-prep-item">
                <i />{{ t(`onboarding.step.${key}.eyebrow`) }}
              </span>
            </div>
            <div class="ob-intro-actions">
              <button type="button" class="ob-btn ob-btn--ghost" @click="onboarding.skip()">
                {{ t('onboarding.intro.skip') }}
              </button>
              <button type="button" class="ob-btn ob-btn--primary" @click="onboarding.beginSteps()">
                {{ t('onboarding.intro.start') }}
              </button>
            </div>
            <p class="ob-hint ob-intro-hint">{{ t('onboarding.intro.skipHint') }}</p>
          </div>
        </template>

        <template v-else>
          <header class="ob-head">
            <div class="ob-head-eyebrow">{{ t(`onboarding.step.${currentKey}.eyebrow`) }}</div>
            <h1>{{ t(`onboarding.step.${currentKey}.title`) }}</h1>
            <p>{{ t(`onboarding.step.${currentKey}.desc`) }}</p>
          </header>

          <div class="ob-body">
            <component :is="stepComponent" />
          </div>

          <footer class="ob-foot">
            <span class="ob-foot-hint">{{ t(`onboarding.step.${currentKey}.hint`) }}</span>
            <div class="ob-foot-actions">
              <button
                v-if="onboarding.step > 0"
                type="button"
                class="ob-btn ob-btn--ghost ob-btn--sm"
                @click="onboarding.back()"
              >
                {{ t('onboarding.prev') }}
              </button>
              <button type="button" class="ob-btn ob-btn--primary" @click="onboarding.advance()">
                {{ isSummary ? t('onboarding.enter') : t('onboarding.next') }}
              </button>
            </div>
          </footer>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Component } from 'vue'
import type { Locale } from '@/i18n'
import { useOnboardingStore, SETTING_UP_STEPS, SUMMARY_STEP } from '@/stores/onboarding'
import { useSettingsStore } from '@/stores/settings'
import OnboardingRail from './OnboardingRail.vue'
import LanguageStep from './steps/LanguageStep.vue'
import AppearanceStep from './steps/AppearanceStep.vue'
import EngineStep from './steps/EngineStep.vue'
import ModelStep from './steps/ModelStep.vue'
import WorkspaceStep from './steps/WorkspaceStep.vue'
import SummaryStep from './steps/SummaryStep.vue'
import appIcon from '@/assets/app-icon.svg'

const { t } = useI18n()
const onboarding = useOnboardingStore()
const settings = useSettingsStore()

const INTRO_LANGUAGES: ReadonlyArray<{ id: Locale; label: string }> = [
  { id: 'zh-CN', label: '中文' },
  { id: 'en-US', label: 'EN' }
]

function selectIntroLanguage(next: Locale) {
  if (settings.language === next) return
  settings.language = next
  void settings.saveSettings()
}

const STEP_COMPONENTS: ReadonlyArray<Component> = [
  LanguageStep,
  AppearanceStep,
  EngineStep,
  ModelStep,
  WorkspaceStep,
  SummaryStep
]

const isSummary = computed(() => onboarding.step >= SUMMARY_STEP)

const currentKey = computed(() =>
  isSummary.value ? 'summary' : SETTING_UP_STEPS[onboarding.step]
)

const stepComponent = computed(() => STEP_COMPONENTS[onboarding.step] ?? SummaryStep)

function onKeydown(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement | null)?.tagName
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

  if (event.key === 'Escape') {
    event.preventDefault()
    onboarding.skip()
    return
  }
  if (event.key === 'Enter' && !typing) {
    event.preventDefault()
    onboarding.advance()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style lang="scss" scoped>
.ob-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--bg-primary) 42%, rgba(0, 0, 0, 0.45));
  backdrop-filter: blur(2px);
}

.ob-card {
  position: relative;
  width: min(880px, calc(100vw - 64px));
  height: min(580px, calc(100vh - 64px));
  display: grid;
  grid-template-columns: 212px 1fr;
  // 隐式行默认 auto，会跟着内容长高，于是超出的部分被卡片的 overflow:hidden 剪掉，
  // 里面的 .ob-body 永远等不到滚动 —— 模型这一步内容比卡片高时就是这样。
  grid-template-rows: minmax(0, 1fr);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  animation: ob-pop 340ms cubic-bezier(0.16, 1, 0.3, 1) both;

  &.is-intro {
    grid-template-columns: 1fr;
  }
}

@keyframes ob-pop {
  from { opacity: 0; transform: translateY(14px) scale(0.985); }
  to { opacity: 1; transform: none; }
}

.ob-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

// ── intro ──
.ob-intro-lang {
  position: absolute;
  top: 14px;
  right: 16px;
  z-index: 1;
}

.ob-intro {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 30px 40px;

  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-xl);
    font-weight: 700;
    letter-spacing: -0.025em;
    margin: 20px 0 0;
    color: var(--text-primary);
  }

  .ob-intro-mark {
    width: 52px;
    height: 52px;
    border-radius: var(--radius-lg);
    object-fit: contain;
    box-shadow: var(--shadow-md);
  }

  .ob-intro-sub {
    font-size: var(--text-lg);
    color: var(--text-secondary);
    margin-top: 9px;
    max-width: 46ch;
    line-height: var(--leading-relaxed);
  }
}

.ob-prep {
  display: flex;
  gap: 7px;
  margin-top: 22px;
  flex-wrap: wrap;
  justify-content: center;

  .ob-prep-lead {
    color: var(--text-muted);
    padding-left: 0;
    border: none;
    font-size: var(--text-md);
  }

  .ob-prep-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 11px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-default);
    font-size: var(--text-md);
    color: var(--text-secondary);

    i {
      width: 6px;
      height: 6px;
      border-radius: var(--radius-full);
      background: var(--accent-primary);
      opacity: 0.7;
    }
  }
}

.ob-intro-actions {
  display: flex;
  gap: 10px;
  margin-top: 26px;
}

.ob-intro-hint {
  max-width: 40ch;
}

// ── step ──
.ob-head {
  flex: none;
  padding: 22px 26px 0;

  .ob-head-eyebrow {
    font-family: var(--font-serif);
    font-size: 11px;
    font-weight: var(--font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent-primary);
    margin-bottom: 6px;
  }

  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-xl);
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0;
    line-height: var(--leading-tight);
    color: var(--text-primary);
  }

  p {
    margin: 7px 0 0;
    font-size: var(--text-md);
    color: var(--text-muted);
    line-height: var(--leading-chat);
    max-width: 56ch;
  }
}

.ob-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 26px 8px;

  &::-webkit-scrollbar { width: 10px; }
  &::-webkit-scrollbar-thumb {
    background: var(--border-strong);
    border-radius: var(--radius-full);
    border: 3px solid var(--bg-elevated);
  }
}

.ob-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 26px;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-soft);

  .ob-foot-hint {
    font-size: var(--text-2xs);
    color: var(--text-disabled);
  }

  .ob-foot-actions {
    margin-left: auto;
    display: flex;
    gap: 9px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ob-card { animation: none; }
}
</style>

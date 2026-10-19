<template>
  <aside class="rail">
    <div class="brand">
      <img class="mark" :src="appIcon" alt="SpaceCode" />
      <span class="name">{{ t('onboarding.brand') }}</span>
    </div>

    <ul class="steps">
      <li v-for="(key, index) in SETTING_UP_STEPS" :key="key">
        <button
          type="button"
          class="step"
          :class="{ current: isCurrent(index), done: onboarding.stepDone[index] }"
          @click="onboarding.jumpTo(index)"
        >
          <span class="num">
            <Check v-if="onboarding.stepDone[index] && !isCurrent(index)" :size="11" :stroke-width="3.4" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="label">{{ t(`onboarding.step.${key}.eyebrow`) }}</span>
        </button>
      </li>
    </ul>

    <div class="foot">
      <div class="count">
        <span>{{ t('onboarding.progress', { done: onboarding.doneCount, total: STEP_COUNT }) }}</span>
        <span>{{ t(`onboarding.step.${currentKey}.eyebrow`) }}</span>
      </div>
      <div class="bar"><i :style="{ width: onboarding.progressPercent + '%' }" /></div>
      <button type="button" class="later" @click="onboarding.skip()">
        {{ t('onboarding.later') }}
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'
import { useOnboardingStore, SETTING_UP_STEPS, STEP_COUNT } from '@/stores/onboarding'
import appIcon from '@/assets/app-icon.svg'

const { t } = useI18n()
const onboarding = useOnboardingStore()

const isCurrent = (index: number) => onboarding.view === 'step' && onboarding.step === index

const currentKey = computed(() => {
  const index = Math.min(onboarding.step, SETTING_UP_STEPS.length)
  return index === SETTING_UP_STEPS.length ? 'summary' : SETTING_UP_STEPS[index]
})
</script>

<style lang="scss" scoped>
.rail {
  flex: none;
  width: 212px;
  border-right: 1px solid var(--border-subtle);
  background: var(--surface-soft);
  padding: 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 4px;

  .mark {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    object-fit: contain;
    flex: none;
  }

  .name {
    font-family: var(--font-serif);
    font-size: var(--text-base);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.step {
  display: grid;
  grid-template-columns: 20px 1fr;
  gap: 9px;
  align-items: center;
  padding: 8px 6px;
  border-radius: var(--radius-sm);
  width: 100%;
  text-align: left;
  transition: background var(--transition-fast);

  &:hover { background: var(--bg-hover); }

  .num {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    border: 1.5px solid var(--border-strong);
    font-size: 10.5px;
    font-weight: var(--font-weight-semibold);
    color: var(--text-muted);
  }

  .label {
    font-size: var(--text-md);
    color: var(--text-secondary);
  }

  &.done {
    .num { background: var(--accent-primary); border-color: var(--accent-primary); color: #fff; }
    .label { color: var(--text-secondary); }
  }

  // 已完成又正停留在这一步时，"当前"要赢过"已完成" —— 所以必须排在 .done 之后。
  &.current {
    background: var(--accent-primary-glow);

    .num { border-color: var(--accent-primary); color: var(--accent-primary); }
    .label { color: var(--text-primary); font-weight: var(--font-weight-semibold); }
  }
}

.foot {
  margin-top: auto;
  display: grid;
  gap: 8px;
}

.count {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  display: flex;
  justify-content: space-between;
}

.bar {
  height: 3px;
  border-radius: var(--radius-full);
  background: var(--surface-card);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    background: var(--accent-primary);
    transition: width var(--transition-spring);
  }
}

.later {
  font-size: var(--text-md);
  color: var(--text-secondary);
  padding: 4px 2px;
  text-align: left;

  &:hover { color: var(--text-primary); }
}
</style>

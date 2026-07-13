<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePetStore } from '@/stores/pet'
import type { ReactionMode } from '@/types/pet'

const petStore = usePetStore()
const { t } = useI18n()

const settings = computed(() => petStore.config?.settings)

const reactionMode = computed<ReactionMode>({
  get: () => settings.value?.reactionMode ?? 'preset',
  set: (val) => petStore.updateSettings({ reactionMode: val })
})

const aiModel = computed({
  get: () => settings.value?.aiModel ?? 'gpt-4o-mini',
  set: (val) => petStore.updateSettings({ aiModel: val })
})

const intervalSec = computed({
  get: () => Math.round((settings.value?.reactionIntervalMs ?? 60000) / 1000),
  set: (val) => petStore.updateSettings({ reactionIntervalMs: val * 1000 })
})

const scaleDec = computed({
  get: () => settings.value?.scale ?? 1.0,
  set: (val) => petStore.updateSettings({ scale: val })
})

const muted = computed({
  get: () => settings.value?.muted ?? false,
  set: (val) => petStore.updateSettings({ muted: val })
})

const alwaysOnTop = computed({
  get: () => settings.value?.alwaysOnTopDesktop ?? true,
  set: (val) => petStore.updateSettings({ alwaysOnTopDesktop: val })
})

const clickThrough = computed({
  get: () => settings.value?.clickThrough ?? false,
  set: (val) => petStore.updateSettings({ clickThrough: val })
})
</script>

<template>
  <div class="pet-behavior-config">
    <div class="config-group">
      <label class="group-label">{{ t('petSettings.reactionMode') }}</label>
      <div class="radio-group">
        <label class="radio-label">
          <input type="radio" v-model="reactionMode" value="preset" />
          {{ t('petSettings.presetMode') }}
        </label>
        <label class="radio-label">
          <input type="radio" v-model="reactionMode" value="ai" />
          {{ t('petSettings.aiMode') }}
        </label>
      </div>
      <p class="hint" v-if="reactionMode === 'ai'">{{ t('petSettings.aiModeHint') }}</p>
    </div>

    <div class="config-group" v-if="reactionMode === 'ai'">
      <label class="group-label">{{ t('petSettings.aiModel') }}</label>
      <select v-model="aiModel" class="select-input">
        <option value="gpt-4o-mini">GPT-4o mini</option>
        <option value="gpt-4o">GPT-4o</option>
        <option value="claude-3-5-haiku">Claude 3.5 Haiku</option>
      </select>
    </div>

    <div class="config-group">
      <label class="group-label">{{ t('petSettings.reactionInterval') }}: {{ intervalSec }}s</label>
      <input type="range" v-model.number="intervalSec" min="30" max="300" step="10" class="range-input" />
    </div>

    <div class="config-group">
      <label class="group-label">{{ t('petSettings.scale') }}: {{ scaleDec.toFixed(1) }}x</label>
      <input type="range" v-model.number="scaleDec" min="0.5" max="2.0" step="0.1" class="range-input" />
    </div>

    <div class="config-group">
      <label class="checkbox-label">
        <input type="checkbox" v-model="muted" />
        {{ t('petSettings.muted') }}
      </label>
    </div>

    <template v-if="petStore.mode === 'desktop'">
      <div class="config-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="alwaysOnTop" />
          {{ t('petSettings.alwaysOnTop') }}
        </label>
      </div>
      <div class="config-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="clickThrough" />
          {{ t('petSettings.clickThrough') }}
        </label>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.pet-behavior-config {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.config-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-label {
  font-size: 13px;
  color: var(--text-secondary, #ccc);
  font-weight: 500;
}

.radio-group { display: flex; gap: 16px; }

.radio-label, .checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-primary, #fff);
  cursor: pointer;

  input { cursor: pointer; }
}

.hint {
  color: var(--text-muted, #999);
  font-size: 11px;
  margin: 0;
}

.select-input {
  padding: 6px 12px;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border-default, #444);
  border-radius: 4px;
  color: var(--text-primary, #fff);
  font-size: 13px;
  align-self: flex-start;
}

.range-input {
  width: 100%;
  max-width: 300px;
}
</style>

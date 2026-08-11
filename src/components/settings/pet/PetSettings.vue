<template>
  <div class="pet-settings">
    <h2 class="pet-title">{{ t('pet.title') }}</h2>
    <p class="pet-subtitle">{{ t('pet.subtitle') }}</p>

    <!-- 启用开关 -->
    <div class="setting-card">
      <label class="toggle-row">
        <span class="toggle-text-group">
          <span class="toggle-text">{{ t('pet.enabled') }}</span>
          <span class="toggle-hint">{{ t('pet.enabledHint') }}</span>
        </span>
        <input
          type="checkbox"
          class="toggle-switch"
          v-model="preferences.enabled"
          @change="onToggle($event, 'enabled')"
        >
      </label>
    </div>

    <!-- 宠物选择 -->
    <div class="setting-card" :class="{ disabled: !preferences.enabled }">
      <h3 class="section-title">{{ t('pet.builtin') }}</h3>
      <div class="pet-grid">
        <div
          v-for="pet in BUILTIN_PETS"
          :key="pet.id"
          class="pet-card"
          :class="{ selected: selectedPet.id === pet.id }"
          :style="{ '--pet-accent': pet.accent }"
          @click="updatePreferences({ selectedPetId: pet.id })"
        >
          <img :src="pet.imageUrl" :alt="pet.displayName" class="pet-image">
          <div class="pet-info">
            <h4 class="pet-name">{{ pet.displayName }}</h4>
            <p class="pet-desc">{{ pet.description }}</p>
          </div>
          <div class="pet-check" v-if="selectedPet.id === pet.id">✓</div>
        </div>
      </div>
    </div>

    <!-- 外观与行为 -->
    <div class="setting-card" :class="{ disabled: !preferences.enabled }">
      <h3 class="section-title">{{ t('pet.appearance') }}</h3>

      <!-- 尺寸滑块 -->
      <div class="setting-item">
        <label class="setting-label">
          <span class="setting-text">{{ t('pet.size') }}</span>
          <span class="setting-hint">{{ t('pet.sizeHint') }}</span>
        </label>
        <div class="size-control">
          <input
            type="range"
            min="96"
            max="192"
            step="8"
            v-model.number="preferences.size"
            :disabled="!preferences.enabled"
            @input="onRange"
          >
          <span class="size-value">{{ preferences.size }}px</span>
        </div>
      </div>

      <!-- 播放动画 -->
      <div class="setting-item">
        <label class="toggle-row">
          <span class="toggle-text-group">
            <span class="toggle-text">{{ t('pet.motion') }}</span>
            <span class="toggle-hint">{{ t('pet.motionHint') }}</span>
          </span>
          <input
            type="checkbox"
            class="toggle-switch"
            v-model="preferences.motionEnabled"
            :disabled="!preferences.enabled"
            @change="onToggle($event, 'motionEnabled')"
          >
        </label>
      </div>

      <!-- 显示任务区域 -->
      <div class="setting-item">
        <label class="toggle-row">
          <span class="toggle-text-group">
            <span class="toggle-text">{{ t('pet.showTaskPanel') }}</span>
            <span class="toggle-hint">{{ t('pet.showTaskPanelHint') }}</span>
          </span>
          <input
            type="checkbox"
            class="toggle-switch"
            v-model="preferences.showTaskPanel"
            :disabled="!preferences.enabled"
            @change="onToggle($event, 'showTaskPanel')"
          >
        </label>
      </div>

      <!-- 默认收起 -->
      <div class="setting-item">
        <label class="toggle-row">
          <span class="toggle-text-group">
            <span class="toggle-text">{{ t('pet.panelCollapsed') }}</span>
            <span class="toggle-hint">{{ t('pet.panelCollapsedHint') }}</span>
          </span>
          <input
            type="checkbox"
            class="toggle-switch"
            v-model="preferences.panelCollapsed"
            :disabled="!preferences.enabled || !preferences.showTaskPanel"
            @change="onToggle($event, 'panelCollapsed')"
          >
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePetStore } from '@/stores/pet'
import { BUILTIN_PETS } from '@/lib/builtinPets'
import type { PetPreferences } from '@/types/pet'

const { t } = useI18n()
const petStore = usePetStore()

const preferences = computed(() => petStore.preferences)
const selectedPet = computed(() => petStore.selectedPet)

function updatePreferences(patch: Partial<PetPreferences>): void {
  void petStore.updatePreferences(patch)
}

function onToggle(event: Event, key: keyof PetPreferences): void {
  const target = event.target as HTMLInputElement
  updatePreferences({ [key]: target.checked } as Partial<PetPreferences>)
}

function onRange(event: Event): void {
  const target = event.target as HTMLInputElement
  updatePreferences({ size: Number(target.value) })
}
</script>

<style scoped lang="scss">
.pet-settings {
  padding: 24px;
  max-width: 800px;
  margin: 0 auto;
}

.pet-title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.pet-subtitle {
  color: var(--text-secondary);
  margin-bottom: 24px;
  font-size: 14px;
}

.setting-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
  transition: opacity 0.2s;

  &.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--text-primary);
}

.pet-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.pet-card {
  border: 2px solid var(--border-subtle);
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;

  &:hover {
    border-color: var(--pet-accent);
    background: color-mix(in srgb, var(--pet-accent) 8%, transparent);
  }

  &.selected {
    border-color: var(--pet-accent);
    background: color-mix(in srgb, var(--pet-accent) 12%, transparent);
  }

  .pet-image {
    width: 64px;
    height: 64px;
    object-fit: contain;
    margin-bottom: 10px;
  }

  .pet-name {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 4px;
    color: var(--text-primary);
  }

  .pet-desc {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .pet-check {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--pet-accent);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
  }
}

.setting-item {
  padding: 14px 0;
  border-top: 1px solid var(--border-subtle);

  &:first-child {
    border-top: none;
  }
}

.setting-label {
  display: block;
  margin-bottom: 10px;
}

.setting-text {
  font-weight: 500;
  font-size: 14px;
  color: var(--text-primary);
}

.setting-hint {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.size-control {
  display: flex;
  align-items: center;
  gap: 12px;
}

input[type="range"] {
  flex: 1;
  accent-color: var(--accent-primary);
  height: 4px;
}

.size-value {
  min-width: 48px;
  text-align: right;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
}

.toggle-text-group {
  display: flex;
  flex-direction: column;
}

.toggle-text {
  font-weight: 500;
  font-size: 14px;
  color: var(--text-primary);
}

.toggle-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.toggle-switch {
  position: relative;
  width: 40px;
  height: 22px;
  appearance: none;
  -webkit-appearance: none;
  background: var(--border-strong);
  border-radius: 11px;
  outline: none;
  transition: background 0.2s;
  cursor: pointer;
  flex-shrink: 0;

  &:checked {
    background: var(--accent-primary);
  }

  &::before {
    content: '';
    position: absolute;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    top: 2px;
    left: 2px;
    background: #fff;
    transition: transform 0.2s;
  }

  &:checked::before {
    transform: translateX(18px);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

@media (max-width: 640px) {
  .pet-grid {
    grid-template-columns: 1fr;
  }
}
</style>

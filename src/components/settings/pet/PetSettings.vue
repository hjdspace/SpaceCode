<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePetStore } from '@/stores/pet'
import PetPreviewHeader from './PetPreviewHeader.vue'
import PetGallery from './PetGallery.vue'
import PetCreator from './PetCreator.vue'
import PetBehaviorConfig from './PetBehaviorConfig.vue'

const petStore = usePetStore()
const { t } = useI18n()

const tab = ref<'gallery' | 'creator' | 'behavior'>('gallery')

const activePet = computed(() => petStore.activePet)
const mode = computed(() => petStore.mode)

async function toggleMode() {
  // 阶段 4 才实现 desktop 模式切换，这里先留空
  // await petStore.setMode(mode.value === 'embedded' ? 'desktop' : 'embedded')
}

function onPetCreated() {
  tab.value = 'gallery'
}
</script>

<template>
  <div class="pet-settings">
    <PetPreviewHeader :pet="activePet" :mode="mode" @toggle-mode="toggleMode" />

    <div class="pet-tabs">
      <button :class="{ active: tab === 'gallery' }" @click="tab = 'gallery'">
        {{ t('petSettings.gallery') }}
      </button>
      <button :class="{ active: tab === 'creator' }" @click="tab = 'creator'">
        {{ t('petSettings.creator') }}
      </button>
      <button :class="{ active: tab === 'behavior' }" @click="tab = 'behavior'">
        {{ t('petSettings.behavior') }}
      </button>
    </div>

    <KeepAlive>
      <PetGallery v-if="tab === 'gallery'" @create="tab = 'creator'" />
      <PetCreator v-else-if="tab === 'creator'" @created="onPetCreated" />
      <PetBehaviorConfig v-else />
    </KeepAlive>
  </div>
</template>

<style scoped lang="scss">
.pet-settings {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.pet-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-subtle, #3a3a3a);

  button {
    padding: 8px 16px;
    background: transparent;
    border: none;
    color: var(--text-muted, #999);
    cursor: pointer;
    font-size: 13px;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;

    &:hover { color: var(--text-primary, #fff); }

    &.active {
      color: var(--accent-primary, #4FC3F7);
      border-bottom-color: var(--accent-primary, #4FC3F7);
    }
  }
}
</style>

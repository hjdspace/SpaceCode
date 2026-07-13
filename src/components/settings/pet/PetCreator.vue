<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePetStore } from '@/stores/pet'
import type { Pet } from '@/types/pet'
import { DEFAULT_PRESET_REACTIONS } from '@/lib/defaultReactions'
import PetSprite from '@/components/pets/PetSprite.vue'

const emit = defineEmits<{ created: [] }>()
const { t } = useI18n()
const petStore = usePetStore()

const form = reactive({
  name: '',
  personality: '',
  assetFile: null as File | null,
  assetPreview: '' as string,
})

const errors = reactive({ name: '', personality: '', asset: '' })

const previewPet = computed<Pet>(() => ({
  id: 'preview',
  name: form.name || t('petSettings.untitled'),
  personality: form.personality || t('petSettings.noPersonality'),
  visual: { type: 'image', path: form.assetPreview || '', frameCount: 1 },
  presetReactions: { ...DEFAULT_PRESET_REACTIONS }
}))

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  errors.asset = ''

  if (file.size > 2 * 1024 * 1024) {
    errors.asset = t('petSettings.fileTooLarge')
    return
  }

  const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml']
  if (!allowedTypes.includes(file.type)) {
    errors.asset = t('petSettings.unsupportedFormat')
    return
  }

  form.assetFile = file
  form.assetPreview = URL.createObjectURL(file)
}

function validate(): boolean {
  errors.name = (form.name.length < 1 || form.name.length > 20) ? t('petSettings.nameLength') : ''
  errors.personality = (form.personality.length < 1 || form.personality.length > 200) ? t('petSettings.personalityLength') : ''
  errors.asset = !form.assetFile ? t('petSettings.requireAsset') : ''
  return !errors.name && !errors.personality && !errors.asset
}

async function onSubmit() {
  if (!validate() || !form.assetFile) return

  const petId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const pet: Pet = {
    id: petId,
    name: form.name,
    personality: form.personality,
    visual: { type: 'image', path: '', frameCount: 1 },
    presetReactions: { ...DEFAULT_PRESET_REACTIONS },
    createdAt: Date.now()
  }

  const filePath = (form.assetFile as File & { path?: string }).path
  await petStore.addCustomPet(pet, filePath)

  form.name = ''
  form.personality = ''
  form.assetFile = null
  form.assetPreview = ''

  emit('created')
}

const canSubmit = computed(() => form.name && form.personality && form.assetFile)
</script>

<template>
  <div class="pet-creator">
    <div class="creator-form">
      <div class="form-group">
        <label>{{ t('petSettings.name') }}</label>
        <input v-model="form.name" maxlength="20" />
        <span class="error" v-if="errors.name">{{ errors.name }}</span>
      </div>

      <div class="form-group">
        <label>{{ t('petSettings.personality') }}</label>
        <textarea v-model="form.personality" maxlength="200" rows="3" />
        <span class="error" v-if="errors.personality">{{ errors.personality }}</span>
      </div>

      <div class="form-group">
        <label>{{ t('petSettings.uploadImage') }}</label>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/svg+xml" @change="onFileChange" />
        <span class="error" v-if="errors.asset">{{ errors.asset }}</span>
        <p class="hint">{{ t('petSettings.imageHint') }}</p>
      </div>

      <button class="submit-btn" :disabled="!canSubmit" @click="onSubmit">
        {{ t('petSettings.create') }}
      </button>
    </div>

    <div class="creator-preview">
      <h4>{{ t('petSettings.preview') }}</h4>
      <div class="preview-sprite">
        <PetSprite :pet="previewPet" :is-petted="false" :scale="2" />
      </div>
      <div class="preview-meta">
        <span class="name">{{ previewPet.name }}</span>
        <p class="personality">{{ previewPet.personality }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.pet-creator {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.creator-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;

  label {
    font-size: 13px;
    color: var(--text-secondary, #ccc);
    font-weight: 500;
  }

  input:not([type="file"]), textarea {
    padding: 8px 12px;
    background: var(--bg-secondary, #2a2a2a);
    border: 1px solid var(--border-default, #444);
    border-radius: 4px;
    color: var(--text-primary, #fff);
    font-size: 13px;

    &:focus {
      outline: none;
      border-color: var(--accent-primary, #4FC3F7);
    }
  }

  input[type="file"] { font-size: 12px; }

  .error { color: #e53935; font-size: 11px; }

  .hint {
    color: var(--text-muted, #999);
    font-size: 11px;
    margin: 2px 0 0;
  }
}

.submit-btn {
  padding: 10px 16px;
  background: var(--accent-primary, #4FC3F7);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  align-self: flex-start;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:hover:not(:disabled) { opacity: 0.9; }
}

.creator-preview {
  padding: 16px;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border-subtle, #3a3a3a);
  border-radius: 12px;
  text-align: center;

  h4 {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--text-secondary, #ccc);
  }

  .preview-sprite { margin-bottom: 12px; }

  .name {
    display: block;
    font-size: 14px;
    color: var(--text-primary, #fff);
    font-weight: 500;
  }

  .personality {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-muted, #999);
  }
}
</style>

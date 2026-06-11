<template>
  <div class="config-editor">
    <div class="editor-header">
      <label class="editor-label">{{ label }}</label>
      <button
        v-if="!isEditing"
        class="btn btn-sm"
        @click="startEditing"
      >
        <Pencil :size="12" />
        Edit
      </button>
    </div>

    <div v-if="isEditing" class="editor-content">
      <textarea
        v-model="editValue"
        class="config-textarea"
        rows="15"
        @keydown.ctrl.s.prevent="save"
        @keydown.meta.s.prevent="save"
      />
      <div class="editor-actions">
        <button class="btn btn-secondary" @click="cancel">Cancel</button>
        <button class="btn btn-primary" @click="save">Save</button>
      </div>
    </div>

    <div v-else class="config-preview">
      <pre><code>{{ value }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Pencil } from 'lucide-vue-next'

interface Props {
  value: string
  label?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  save: [value: string]
}>()

const isEditing = ref(false)
const editValue = ref('')

function startEditing() {
  editValue.value = props.value
  isEditing.value = true
}

function cancel() {
  isEditing.value = false
  editValue.value = ''
}

function save() {
  emit('save', editValue.value)
  isEditing.value = false
}

watch(() => props.value, (newValue) => {
  if (!isEditing.value) {
    editValue.value = newValue
  }
})
</script>

<style lang="scss" scoped>
.config-editor {
  border: 1px solid var(--border-default);
  border-radius: 8px;
  overflow: hidden;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-default);
}

.editor-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.editor-content {
  display: flex;
  flex-direction: column;
}

.config-textarea {
  width: 100%;
  padding: 12px;
  border: none;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  min-height: 200px;

  &:focus {
    outline: none;
  }
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-tertiary);
  border-top: 1px solid var(--border-default);
}

.config-preview {
  padding: 12px;
  background: var(--bg-secondary);
  overflow: auto;
  max-height: 400px;

  pre {
    margin: 0;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-all;
  }
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s;

  &.btn-sm {
    padding: 4px 10px;
    font-size: 11px;
  }

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }

  &.btn-secondary {
    background: var(--bg-secondary);
    border: 1px solid var(--border-default);
    color: var(--text-primary);

    &:hover {
      background: var(--bg-hover);
    }
  }
}
</style>

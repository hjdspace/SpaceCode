<template>
  <div class="chat-input-container">
    <div class="input-wrapper">
      <textarea
        ref="textareaRef"
        v-model="inputText"
        placeholder="Send a message..."
        rows="1"
        :disabled="disabled"
        @keydown.enter.exact.prevent="handleSend"
        @input="autoResize"
      ></textarea>
      <button
        class="send-btn"
        :disabled="!canSend || disabled"
        @click="handleSend"
      >
        <ArrowUp :size="16" />
      </button>
    </div>
    <div class="input-hint">
      Press Enter to send, Shift+Enter for new line
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowUp } from 'lucide-vue-next'

const emit = defineEmits<{
  send: [content: string]
}>()

const props = defineProps<{
  disabled?: boolean
}>()

const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const canSend = computed(() => inputText.value.trim().length > 0)

function handleSend() {
  if (!canSend.value || props.disabled) return

  emit('send', inputText.value)
  inputText.value = ''

  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
  }
}

function autoResize() {
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
    textareaRef.value.style.height = Math.min(textareaRef.value.scrollHeight, 200) + 'px'
  }
}
</script>

<style lang="scss" scoped>
.chat-input-container {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--surface-border);
  background: var(--bg-primary);
  flex-shrink: 0;
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  background: var(--bg-primary);

  textarea {
    flex: 1;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 14px;
    line-height: 1.5;
    max-height: 200px;
    padding: 0;

    &::placeholder {
      color: var(--text-muted);
    }

    &:disabled {
      opacity: 0.5;
    }
  }

  .send-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: var(--accent-primary);
    color: white;
    @include flex-center;
    flex-shrink: 0;
    transition: background 150ms ease;

    &:hover:not(:disabled) {
      background: var(--accent-primary-hover);
    }

    &:disabled {
      background: var(--bg-tertiary);
      color: var(--text-muted);
      cursor: not-allowed;
    }
  }
}

.input-hint {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  margin-top: 6px;
}
</style>

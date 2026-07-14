<!-- src/components/pets/PetReactionBubble.vue -->
<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  text: string | null
}>()

const emit = defineEmits<{ dismiss: [] }>()

const visible = computed(() => !!props.text && props.text.length > 0)
</script>

<template>
  <Transition name="bubble">
    <div v-if="visible" class="pet-bubble" @click="emit('dismiss')">
      <span class="bubble-text">{{ text }}</span>
      <div class="bubble-tail" />
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.pet-bubble {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 8px;
  padding: 8px 14px;
  background: var(--glass-bg, rgba(255, 255, 255, 0.1));
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.2));
  border-radius: var(--radius-lg, 12px);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.15));
  width: max-content;
  max-width: 380px;
  min-width: 80px;
  cursor: pointer;
  pointer-events: auto;
}

.bubble-text {
  font-size: 13px;
  color: var(--text-primary, #fff);
  line-height: 1.5;
  white-space: pre-wrap;
  /* 仅当长单词（如 URL）在一行内放不下时才强制断行，不影响正常中英文换行 */
  overflow-wrap: break-word;
}

.bubble-tail {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid var(--glass-border, rgba(255, 255, 255, 0.2));
}

.bubble-enter-active,
.bubble-leave-active {
  transition: all 0.3s ease;
}

.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>

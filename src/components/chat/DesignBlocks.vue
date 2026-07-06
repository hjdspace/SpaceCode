<template>
  <div v-if="designBlocks.length" class="design-blocks">
    <template v-for="(block, i) in designBlocks" :key="i">
      <OdCard
        v-if="block.kind === 'od-card'"
        :payload="block.payload"
        @open="$emit('openArtifact', $event)"
      />
      <QuestionForm
        v-else-if="block.kind === 'question-form'"
        :form="block.payload"
        @submit="$emit('submitForm', $event)"
      />
      <NextStepActions
        v-else-if="block.kind === 'next-steps'"
        :actions="block.actions"
        @select="$emit('selectNext', $event)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Message } from '@/types'
import { computed } from 'vue'
import { buildBlocks, type Block } from '@/utils/chat/buildBlocks'
import OdCard from '@/components/design/OdCard.vue'
import QuestionForm from '@/components/design/QuestionForm.vue'
import NextStepActions from '@/components/design/NextStepActions.vue'

/**
 * 只渲染设计模式专用的 block（od-card / question-form / next-steps）。
 *
 * 标准内容（text / thinking / tool-call / metadata / status）由
 * AgentTimeline 统一渲染，此组件作为 AgentTimeline 的补充，
 * 在 timeline 之后追加设计专用 UI。
 */

const props = defineProps<{
  messages: Message[]
}>()

const emit = defineEmits<{
  openArtifact: [path: string]
  submitForm: [answers: Record<string, unknown>]
  selectNext: [prompt: string]
}>()

// 只保留设计专用 block 类型
const DESIGN_BLOCK_KINDS = new Set(['od-card', 'question-form', 'next-steps'])

const designBlocks = computed<Block[]>(() => {
  const result: Block[] = []
  for (const msg of props.messages) {
    if (msg.role !== 'assistant') continue
    const blocks = buildBlocks(msg)
    for (const b of blocks) {
      if (DESIGN_BLOCK_KINDS.has(b.kind)) {
        result.push(b)
      }
    }
  }
  return result
})
</script>

<style lang="scss" scoped>
.design-blocks {
  margin-left: 36px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>

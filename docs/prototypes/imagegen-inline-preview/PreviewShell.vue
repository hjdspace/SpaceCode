<template>
  <div class="preview-shell">
    <header class="preview-bar">
      <span class="preview-title">生图内联预览 · 真实 AgentTimeline + ImageGenToolCard</span>
      <label>主题
        <select v-model="theme">
          <option value="dark">dark</option>
          <option value="light">light</option>
          <option value="anthropic">anthropic</option>
          <option value="anthropic-dark">anthropic-dark</option>
        </select>
      </label>
      <label>语言
        <select v-model="locale">
          <option value="zh-CN">中文</option>
          <option value="en-US">English</option>
        </select>
      </label>
      <label>宽度
        <select v-model="width">
          <option value="wide">宽 (860)</option>
          <option value="narrow">窄 (420)</option>
        </select>
      </label>
      <button type="button" @click="remountKey++">重新挂载（模拟历史重载）</button>
    </header>

    <main class="preview-chat" :class="`is-${width}`">
      <section v-for="turn in turns" :key="turn.id" class="preview-turn">
        <div class="preview-user">
          <span class="preview-user-avatar">U</span>
          <p>{{ turn.prompt }}</p>
        </div>
        <AgentTimeline
          :key="`${remountKey}-${turn.id}`"
          :messages="[turn.message]"
          :loading="false"
          session-id="preview-session"
          :turn-start-time="turn.message.timestamp"
        />
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AgentTimeline from '@/components/chat/AgentTimeline.vue'
import type { Message } from '@/types'

const { locale } = useI18n()
const theme = ref('dark')
const width = ref<'wide' | 'narrow'>('wide')
const remountKey = ref(0)

watch(theme, (value) => {
  document.documentElement.setAttribute('data-theme', value)
}, { immediate: true })

const now = Date.now()
const kittenPath = 'D:/AI/SpaceCode/outputs/imagegen/kitten.png'

function assistantMessage(id: string, content: string, toolCalls: Message['toolCalls'], events: Message['timelineEvents']): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp: now,
    toolCalls,
    timelineEvents: events,
    metadata: { model: 'agnes-3.0-flash-angel', inputTokens: 140044, outputTokens: 607, duration: 26000 },
  }
}

const turns = [
  {
    id: 'single',
    prompt: '帮我生成一张小猫咪的图片',
    message: assistantMessage(
      'a-single',
      '小猫咪生成好了：\n\n- 路径：`D:\\AI\\SpaceCode\\outputs\\imagegen\\kitten.png`\n- 尺寸：1024×1024\n- 模型：agnes-image-2.5-flash\n\n卡片里可以直接看这张图。如果想换风格，告诉我。',
      [
        { id: 'sk1', name: 'Skill', input: { skill: 'imagegen' }, status: 'completed', startTime: now - 26000, endTime: now - 25000 },
        {
          id: 'ig1',
          name: 'mcp__spacecode-imagegen__generate_image',
          input: { prompt: 'a cute kitten, soft light' },
          output: JSON.stringify({ model: 'agnes-image-2.5-flash', images: [{ path: kittenPath, size: '1024x1024', status: 'succeeded' }] }),
          status: 'completed',
          startTime: now - 25000,
          endTime: now - 1000,
        },
      ],
      [
        { id: 'tool-sk1', type: 'tool_call', timestamp: now - 25500, status: 'completed', toolCallId: 'sk1' },
        { id: 'tool-ig1', type: 'tool_call', timestamp: now - 25000, status: 'completed', toolCallId: 'ig1' },
        { id: 't-single', type: 'text', timestamp: now - 500, status: 'completed', content: '小猫咪生成好了：\n\n- 路径：`D:\\AI\\SpaceCode\\outputs\\imagegen\\kitten.png`\n- 尺寸：1024×1024\n- 模型：agnes-image-2.5-flash\n\n卡片里可以直接看这张图。如果想换风格，告诉我。' },
      ],
    ),
  },
  {
    id: 'batch',
    prompt: '同一只猫给我来三张不同构图的，再留一张失败示例',
    message: assistantMessage(
      'a-batch',
      '批量结果：两张成功、一张被安全策略拒绝，详见卡片。',
      [
        {
          id: 'ig2',
          name: 'mcp__spacecode-imagegen__generate_batch',
          input: { prompts: ['kitten wide shot', 'kitten portrait', 'kitten forbidden'] },
          output: JSON.stringify({
            model: 'agnes-image-2.5-flash',
            images: [
              { path: 'D:/AI/SpaceCode/outputs/imagegen/wide.png', size: '1536x1024', status: 'succeeded' },
              { path: 'D:/AI/SpaceCode/outputs/imagegen/tall.png', size: '1024x1536', status: 'succeeded' },
              { status: 'failed', error: 'content_policy: rejected by safety system' },
            ],
          }),
          status: 'completed',
          startTime: now - 20000,
          endTime: now - 2000,
        },
      ],
      [
        { id: 'tool-ig2', type: 'tool_call', timestamp: now - 20000, status: 'completed', toolCallId: 'ig2' },
        { id: 't-batch', type: 'text', timestamp: now - 1000, status: 'completed', content: '批量结果：两张成功、一张被安全策略拒绝，详见卡片。' },
      ],
    ),
  },
  {
    id: 'edit',
    prompt: '把第一张改成暖色调水彩风',
    message: assistantMessage(
      'a-edit',
      '改好了，暖色水彩版本见卡片。',
      [
        {
          id: 'ig3',
          name: 'mcp__spacecode-imagegen__edit_image',
          input: { prompt: 'warm watercolor style', imagePaths: [kittenPath, 'D:/AI/SpaceCode/outputs/imagegen/wide.png'] },
          output: JSON.stringify({ model: 'agnes-image-2.5-flash', referenceCount: 2, images: [{ path: 'D:/AI/SpaceCode/outputs/imagegen/wide.png', size: '1536x1024', status: 'succeeded' }] }),
          status: 'completed',
          startTime: now - 15000,
          endTime: now - 3000,
        },
      ],
      [
        { id: 'tool-ig3', type: 'tool_call', timestamp: now - 15000, status: 'completed', toolCallId: 'ig3' },
        { id: 't-edit', type: 'text', timestamp: now - 2000, status: 'completed', content: '改好了，暖色水彩版本见卡片。' },
      ],
    ),
  },
]
</script>

<style scoped lang="scss">
.preview-shell {
  min-height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.preview-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--bg-elevated);
  font-size: var(--text-sm);

  label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
  }

  select,
  button {
    padding: 4px 8px;
    border: 1px solid var(--surface-border-strong);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
  }
}

.preview-title {
  margin-right: auto;
  font-weight: var(--font-weight-semibold);
}

.preview-chat {
  margin: 0 auto;
  padding: 24px 18px 80px;

  &.is-wide { max-width: 860px; }
  &.is-narrow { max-width: 420px; }
}

.preview-turn + .preview-turn {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px dashed var(--surface-border);
}

.preview-user {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;

  p {
    margin: 0;
    padding: 8px 12px;
    border-radius: var(--radius-lg);
    background: var(--bg-tertiary);
    font-size: var(--text-md);
    line-height: var(--leading-chat);
  }
}

.preview-user-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--accent-primary);
  color: var(--bg-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
}
</style>
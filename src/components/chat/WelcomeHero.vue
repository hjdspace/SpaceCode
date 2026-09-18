<template>
  <div class="welcome-hero" data-test="welcome-hero">
    <div class="hero-eyebrow">
      <Sparkles :size="13" />
      {{ t('chat.welcomeHero.eyebrow') }}
    </div>
    <h1 class="hero-title">{{ title }}</h1>
    <p class="hero-subtitle">{{ subtitle }}</p>
    <div v-if="projectPath" class="hero-project">
      <Folder :size="14" />
      <span class="hero-project-path">{{ projectPath }}</span>
    </div>
    <div class="task-grid">
      <button
        v-for="task in tasks"
        :key="task.name"
        class="task-tile"
        data-test="task-tile"
        type="button"
        @click="emit('select', task.name)"
      >
        <span class="task-name">{{ task.name }}</span>
        <span v-if="task.description" class="task-desc">{{ task.description }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Folder, Sparkles } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

interface WelcomeTask {
  name: string
  description?: string
}

defineProps<{
  title: string
  subtitle: string
  projectPath?: string
  tasks: WelcomeTask[]
}>()

const emit = defineEmits<{
  (e: 'select', prompt: string): void
}>()

const { t } = useI18n()
</script>

<style lang="scss" scoped>
.welcome-hero {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  overflow-y: auto;
}

.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-primary);
  background: var(--accent-primary-glow);
  border-radius: var(--radius-full);
  padding: 5px 12px;
  margin-bottom: 18px;
  letter-spacing: 0.02em;
}

.hero-title {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 10px;
  letter-spacing: -0.01em;
}

.hero-subtitle {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-muted);
  margin: 0 0 26px;
  max-width: 420px;
}

.hero-project {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  font-size: 12px;
  color: var(--text-muted);
  background: var(--surface-glass);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  padding: 5px 12px;
  margin-bottom: 26px;
  font-family: var(--font-mono);
}

.hero-project :deep(svg) { color: var(--accent-primary); flex-shrink: 0; }

.hero-project-path {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  width: 100%;
  max-width: 460px;
}

.task-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: all var(--transition-normal);
  color: inherit;

  &:hover {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }
}

.task-name { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
.task-desc { font-size: 12px; line-height: 1.4; color: var(--text-muted); }

@media (max-width: 480px) {
  .task-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<template>
  <div class="session-list">
    <!-- Empty State -->
    <div v-if="projectGroups.length === 0" class="empty-state">
      <span>暂无会话</span>
    </div>

    <!-- Project Groups -->
    <div v-else class="project-groups">
      <div
        v-for="group in projectGroups"
        :key="group.workingDirectory || '__no_project'"
        class="project-group"
        :class="{ 'is-current': isCurrentProject(group) }"
      >
        <!-- Project Group Header -->
        <ProjectGroupHeader
          :working-directory="group.workingDirectory"
          :display-name="group.displayName"
          :is-collapsed="collapsedProjects.has(group.workingDirectory)"
          :is-folder-hovered="hoveredFolder === group.workingDirectory"
          :is-current="isCurrentProject(group)"
          @toggle="toggleProject(group.workingDirectory)"
          @mouseenter="hoveredFolder = group.workingDirectory"
          @mouseleave="hoveredFolder = null"
          @create-session="(e) => $emit('create-session-in-project', e, group.workingDirectory)"
          @remove-project="$emit('remove-project', group.workingDirectory)"
          @open-folder-picker="$emit('open-folder-picker')"
          @click="$emit('switch-project', group.workingDirectory)"
          :show-remove-button="showRemoveButton"
        />

        <!-- Session Items with Animated Collapse -->
        <Transition
          name="collapse"
          @enter="onEnter"
          @after-enter="onAfterEnter"
          @leave="onLeave"
        >
          <div v-show="!collapsedProjects.has(group.workingDirectory)" class="sessions-container">
            <div class="sessions-list">
              <SessionListItem
                v-for="session in getVisibleSessions(group)"
                :key="session.id"
                :session="session"
                :is-active="session.id === activeId"
                :is-hovered="hoveredSession === session.id"
                :is-deleting="deletingSession === session.id"
                :is-streaming="activeStreamingSessions?.has(session.id)"
                :needs-approval="pendingApprovalSessions?.has(session.id)"
                :process-status="session.processStatus || 'none'"
                :format-relative-time="formatRelativeTime"
                @mouseenter="hoveredSession = session.id"
                @mouseleave="hoveredSession = null"
                @select="$emit('select', session.id)"
                @delete="(e) => $emit('delete', e, session.id)"
                @rename="(newTitle) => $emit('rename', session.id, newTitle)"
                @copy-id="handleCopySessionId(session.id)"
                @split-screen="(sessionId) => $emit('split-screen', sessionId)"
              />

              <!-- Show More / Show Less Toggle -->
              <button
                v-if="shouldTruncate(group)"
                class="show-more-btn"
                @click="toggleExpanded(group.workingDirectory)"
              >
                {{ isGroupExpanded(group.workingDirectory) ? 'Show less' : `Show more (${getHiddenCount(group)})` }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Session } from '@/types'
import { MessageSquare } from 'lucide-vue-next'
import SessionListItem from './SessionListItem.vue'
import ProjectGroupHeader from './ProjectGroupHeader.vue'
import {
  groupSessionsByProject,
  formatRelativeTime,
  loadCollapsedProjects,
  saveCollapsedProjects,
  COLLAPSED_INITIALIZED_KEY
} from '@/utils/chat-list-utils'

const SESSION_TRUNCATE_LIMIT = 10

interface Props {
  sessions: Session[]
  activeId?: string
  activeStreamingSessions?: Set<string>
  pendingApprovalSessions?: Set<string>
  projects?: string[]
  currentProject?: string
  showRemoveButton?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  activeId: undefined,
  activeStreamingSessions: () => new Set(),
  pendingApprovalSessions: () => new Set(),
  projects: () => [],
  currentProject: '',
  showRemoveButton: false
})

const emit = defineEmits<{
  select: [id: string]
  delete: [e: MouseEvent, sessionId: string]
  rename: [sessionId: string, newTitle: string]
  'create-session-in-project': [e: MouseEvent, workingDirectory: string]
  'remove-project': [workingDirectory: string]
  'switch-project': [workingDirectory: string]
  'open-folder-picker': []
  'split-screen': [sessionId: string]
}>()

// State
const collapsedProjects = ref<Set<string>>(loadCollapsedProjects())
const hoveredFolder = ref<string | null>(null)
const hoveredSession = ref<string | null>(null)
const deletingSession = ref<string | null>(null)
const expandedGroups = ref<Set<string>>(new Set())

// Computed - 必须在 watch 之前定义
const projectGroups = computed(() => {
  const groups = groupSessionsByProject(props.sessions)

  // Pin current project to top
  if (props.currentProject) {
    const currentIdx = groups.findIndex(g => g.workingDirectory === props.currentProject)
    if (currentIdx > 0) {
      const [currentGroup] = groups.splice(currentIdx, 1)
      groups.unshift(currentGroup)
    }
  }

  return groups
})

// Auto-collapse: only expand the project with the most recent session activity
// 注意：这个 watch 必须在 projectGroups 计算属性之后定义
watch(() => projectGroups.value, (groups) => {
  if (groups.length <= 1) return

  // Find the project with the latest session (highest latestUpdatedAt)
  const sorted = [...groups].sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt)
  const mostRecentWd = sorted[0]?.workingDirectory

  const toCollapse = new Set(
    groups
      .filter(g => g.workingDirectory !== mostRecentWd)
      .map(g => g.workingDirectory)
  )

  // Only update if collapsed set actually changed (avoid infinite loop)
  const currentKeys = [...collapsedProjects.value].sort().join(',')
  const newKeys = [...toCollapse].sort().join(',')

  // Check if already initialized
  const initKey = COLLAPSED_INITIALIZED_KEY + '-v2'
  if (currentKeys !== newKeys && !localStorage.getItem(initKey)) {
    collapsedProjects.value = toCollapse
    saveCollapsedProjects(toCollapse)
    localStorage.setItem(initKey, '1')
  }
}, { immediate: true })

// Methods
function isCurrentProject(group: { workingDirectory: string }): boolean {
  return !!(props.currentProject && group.workingDirectory === props.currentProject)
}

function toggleProject(workingDirectory: string) {
  const next = new Set(collapsedProjects.value)
  if (next.has(workingDirectory)) {
    next.delete(workingDirectory)
  } else {
    next.add(workingDirectory)
  }
  collapsedProjects.value = next
  saveCollapsedProjects(next)
}

function shouldTruncate(group: { sessions: Session[]; workingDirectory: string }): boolean {
  return group.sessions.length > SESSION_TRUNCATE_LIMIT
}

function isGroupExpanded(workingDirectory: string): boolean {
  return expandedGroups.value.has(workingDirectory)
}

function toggleExpanded(workingDirectory: string) {
  const next = new Set(expandedGroups.value)
  if (next.has(workingDirectory)) {
    next.delete(workingDirectory)
  } else {
    next.add(workingDirectory)
  }
  expandedGroups.value = next
}

function getVisibleSessions(group: { sessions: Session[]; workingDirectory: string }): Session[] {
  if (!shouldTruncate(group)) {
    return group.sessions
  }

  if (!isGroupExpanded(group.workingDirectory)) {
    // Show truncated list + ensure active session is visible
    const truncated = group.sessions.slice(0, SESSION_TRUNCATE_LIMIT)
    const activeSession = group.sessions.find(s => s.id === props.activeId)
    if (activeSession && !truncated.includes(activeSession)) {
      truncated.push(activeSession)
    }
    return truncated
  }

  return group.sessions
}

function getHiddenCount(group: { sessions: Session[] }): number {
  return group.sessions.length - SESSION_TRUNCATE_LIMIT
}

async function handleCopySessionId(sessionId: string) {
  try {
    await navigator.clipboard.writeText(sessionId)
    // Could show toast notification here
  } catch (error) {
    console.error('Failed to copy session ID:', error)
  }
}

// Animation hooks for collapse/expand
function onEnter(el: Element) {
  const htmlEl = el as HTMLElement
  htmlEl.style.height = '0'
  htmlEl.style.opacity = '0'
  htmlEl.style.overflow = 'hidden'
}

function onAfterEnter(el: Element) {
  const htmlEl = el as HTMLElement
  htmlEl.style.height = 'auto'
  htmlEl.style.opacity = '1'
}

function onLeave(el: Element, done: () => void) {
  const htmlEl = el as HTMLElement
  htmlEl.style.height = htmlEl.scrollHeight + 'px'
  htmlEl.offsetHeight // Force reflow
  htmlEl.style.height = '0'
  htmlEl.style.opacity = '0'

  setTimeout(done, 200) // Match transition duration
}
</script>

<style lang="scss" scoped>
.session-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 8px;

  @include scrollbar-thin;
}

@mixin scrollbar-thin {
  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--surface-border);
    border-radius: 3px;

    &:hover {
      background: var(--text-muted);
    }
  }
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 16px;

  span {
    font-size: 13px;
    color: var(--text-muted);
  }
}

.project-groups {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.project-group {
  margin-top: 4px;

  &:first-child {
    margin-top: 0;
  }

  &.is-current {
    .project-group-header {
      background: var(--surface-glass-active);
    }
  }
}

.sessions-container {
  overflow: hidden;
}

.sessions-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 8px;
  margin-top: 2px;
}

.show-more-btn {
  width: 100%;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.6;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  text-align: center;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    opacity: 1;
    color: var(--text-secondary);
    background: var(--surface-glass-hover);
  }
}

// Collapse/Expand Animation
.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.2s ease-out;
}

.collapse-enter-from,
.collapse-leave-to {
  height: 0 !important;
  opacity: 0;
}
</style>

# Subagent Panel in InfoPanel — Design

**Date**: 2026-09-16
**Status**: accepted
**Reference**: PI-Desktop `SubagentPanel` / `SubagentDetail` / `WorkPanel`

## Goal

Move subagent detail display from inline expansion (`AgentToolCard` expand/collapse) to a right-side panel inside the existing `InfoPanel`, matching PI-Desktop's UX pattern. Clicking an Agent tool card opens the subagent stream in the InfoPanel; closing returns to the previous InfoPanel tab.

## Non-Goals

- Nested subagent recursion (subagent clicking another Agent tool while already viewing a subagent panel) — handled as follow-up
- Multi-subagent simultaneous viewing — out of scope for this iteration
- Teammate transcript viewing via `TeamStatusBar` — unchanged

---

## Architecture

### Component tree change

```
Before (inline expand):
  AgentTimeline
    └─ AgentToolCard
         ├─ header (click → toggleExpand)
         ├─ preview (collapsed state)
         └─ agent-details (expanded state: tool timeline + markdown result)

After (panel mode):
  AgentTimeline
    └─ AgentToolCard
         └─ header (click → appStore.openSubagentPanel)
              └─ preview (always visible, collapsed summary)

  InfoPanel (mode='subagent')
    └─ SubagentPanel
         ├─ HeroHeader [sticky]
         ├─ TaskDescription [collapsible]
         ├─ AgentTimeline [reused, messages from useSubagentTranscript]
         └─ MarkdownRenderer [reused, final result]
```

### Files changed

| File | Action | Purpose |
|------|--------|---------|
| `src/types/index.ts` | Edit | Add `'subagent'` to `InfoPanelTabType` |
| `src/stores/app.ts` | Edit | Add `subagentPanelState`, `openSubagentPanel()`, `closeSubagentPanel()` |
| `src/components/layout/InfoPanel.vue` | Edit | Add `v-else-if="mode === 'subagent'"` branch |
| `src/components/layout/SubagentPanel.vue` | **New** | Subagent detail panel component |
| `src/components/chat/tools/AgentToolCard.vue` | Edit | Remove expand/collapse, add `openSubagentPanel` on click |

### Files NOT changed

- `src/services/teamTranscriptService.ts` — data flow unchanged
- `src/composables/useSubagentTranscript.ts` — composable unchanged
- `src/components/chat/AgentTimeline.vue` — reused as-is
- `src/components/common/MarkdownRenderer.vue` — reused as-is
- `src/stores/chatSession.ts` — subagent message recording unchanged
- `src/stores/turn/` — event routing unchanged

---

## Data Flow

```
Engine IPC event (isSidechainMessage === true)
  → turn store routes to sessionStore.recordSubagentMessage()
  → session.teammateTranscripts[teammateId].push(message)
  → Vue reactivity propagates

SubagentPanel reads:
  useSubagentTranscript(toolCallId)
    → teammateIdForParentToolUse(sessionId, toolCallId)
    → session.teammateTranscripts[teammateId]  ← reactive Message[]
```

No new data paths. The panel is a pure consumer of the existing `teammateTranscripts` store.

---

## Store Design (app.ts)

```typescript
// New type
interface SubagentPanelState {
  toolCallId: string
  sessionId: string
}

// New state
subagentPanelState: SubagentPanelState | null

// New actions
openSubagentPanel(toolCallId: string) {
  // Save current tab state for restore
  this._previousTabId = this.activeInfoTabId
  this._previousPanelHome = this.panelHome
  this.subagentPanelState = {
    toolCallId,
    sessionId: this.currentSessionId
  }
}

closeSubagentPanel() {
  this.subagentPanelState = null
  // Restore previous tab
  if (this._previousTabId) {
    this.activeInfoTabId = this._previousTabId
    this.panelHome = this._previousPanelHome
  }
}

// Modified computed
infoPanelMode: if subagentPanelState !== null → 'subagent'
               else → existing logic
```

---

## SubagentPanel Component

### Props (derived from store, no direct props needed)

Reads `appStore.subagentPanelState` + `sessionStore.currentSession` internally.

### Template structure

```vue
<template>
  <div class="subagent-panel">
    <!-- Top nav bar -->
    <div class="subagent-nav">
      <button @click="appStore.closeSubagentPanel()">
        <ArrowLeft :size="14" /> Back to chat
      </button>
    </div>

    <!-- Sticky hero -->
    <div class="subagent-hero">
      <div class="hero-status">
        <span class="status-dot" :class="statusClass" />
        <span class="hero-name">{{ agentName }}</span>
        <span class="hero-type">{{ agentType }}</span>
      </div>
      <div class="hero-meta">
        <span class="hero-model">{{ modelName }}</span>
        <span class="hero-badge" :class="statusClass">{{ statusLabel }}</span>
        <span class="hero-timer">{{ formattedElapsed }}</span>
      </div>
    </div>

    <!-- Task description -->
    <details v-if="taskDescription" class="task-card" open>
      <summary>Task Description</summary>
      <MarkdownRenderer :content="taskDescription" />
    </details>

    <!-- Activity timeline -->
    <AgentTimeline
      v-if="streamMessages.length"
      :messages="streamMessages"
      :loading="isRunning"
    />

    <!-- Final result (when complete, no stream messages) -->
    <MarkdownRenderer
      v-if="!isRunning && finalOutput"
      :content="finalOutput"
    />

    <!-- Empty state -->
    <div v-if="!hasContent" class="empty-state">
      Waiting for subagent to start...
    </div>
  </div>
</template>
```

### Computed state

| Property | Source |
|----------|--------|
| `toolCall` | `sessionStore.currentSession.toolCalls[toolCallId]` or traversing messages |
| `isRunning` | `toolCall.status === 'running' \|\| 'pending'` |
| `agentType` | `toolCall.input.agentType \|\| toolCall.input.type` |
| `agentName` | `toolCall.input.agentType \|\| 'Agent'` |
| `taskDescription` | `toolCall.input.description \|\| toolCall.input.prompt \|\| toolCall.input.task` |
| `streamMessages` | `useSubagentTranscript(toolCallId).messages` |
| `finalOutput` | extracted from `toolCall.output` via `parseAgentToolOutput` + `extractAgentDisplayText` |
| `elapsed` | reactive counter, `setInterval` 1s while running |

### Reused components

| Component | Path | Usage |
|-----------|------|-------|
| `AgentTimeline` | `src/components/chat/AgentTimeline.vue` | Subagent thinking/tools/text timeline |
| `MarkdownRenderer` | `src/components/common/MarkdownRenderer.vue` | Task description + final result |

Both accept standard `Message[]` / `string` props and require zero adaptation.

---

## AgentToolCard Simplification

### Before: dual-state (collapsed / expanded)

```vue
<div class="agent-header" @click="toggleExpand">
  <!-- ... -->
</div>
<div v-if="!isExpanded" class="agent-preview">...</div>
<div v-if="isExpanded" class="agent-details">
  <!-- tool timeline + result -->
</div>
```

### After: single-state clickable card

```vue
<div class="agent-header" @click="appStore.openSubagentPanel(toolCall.id)">
  <!-- icon, label, type, task, status badge -->
</div>
<div class="agent-preview">
  <!-- output summary + recent tool calls, always visible -->
</div>
```

Removes: `isExpanded` ref, `toggleExpand()`, entire `agent-details` block, tool icon maps, `allToolCalls` / `assistantTexts` / `renderedOutput` computed (moved to SubagentPanel).

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Subagent hasn't started (pending) | Panel opens, hero shows "Starting…", empty activity area |
| Subagent running | Panel streams live, timer ticks, AgentTimeline auto-follows |
| Subagent completed | Full history visible, timer frozen at final value |
| Subagent errored | Hero shows error status, `ErrorCard` rendered if classified |
| Invalid toolCallId | "Subagent not found" message in panel |
| Switch session while panel open | `closeSubagentPanel()` called automatically |
| `Cmd/Ctrl+J` close panel | Existing close logic already handles — `closeSubagentPanel()` fires |
| Multiple Agent tools in same turn | Clicking a different one switches the panel to new subagent |
| No transcript data yet | Empty state: "Waiting for subagent to start…" |

---

## Verification

```sh
npm run build     # vue-tsc --noEmit + vite build
npm run test      # vitest all suites
```

Manual verification:
1. Trigger an Agent tool call (e.g., "search the codebase for auth logic")
2. Click the Agent tool card → InfoPanel opens with subagent detail
3. Verify streaming output appears in real time in the panel
4. Verify timer ticks while running
5. Click "Back to chat" → returns to previous InfoPanel tab
6. Verify original AgentToolCard still shows preview summary in timeline

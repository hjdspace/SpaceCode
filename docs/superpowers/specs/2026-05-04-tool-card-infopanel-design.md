# Tool Card InfoPanel Integration Design

Date: 2026-05-04

## Overview

Add clickable icons to tool cards (Edit/Write/Read/WebFetch/Grep) that open the right-side InfoPanel to display file content, inline diffs, or search results. Support accept/revert actions for Edit and Write tools.

## Architecture: Extend InfoPanel + New ToolDiffViewer

### Data Model

```ts
export interface ToolDiffData {
  type: 'edit' | 'write' | 'read' | 'webfetch' | 'grep'
  filePath: string
  originalContent: string
  modifiedContent: string
  toolCallId: string
  language: string
  displayContent?: string
  searchQuery?: string
}
```

### App Store Changes

- Add `toolDiffData` ref
- Add `showToolDiff(data: ToolDiffData)` method
- Extend `infoPanelMode` type to include `'tool-diff'`

### InfoPanel Changes

- Add `tool-diff` mode branch rendering `ToolDiffViewer`

### ToolDiffViewer Component

New component at `src/components/common/ToolDiffViewer.vue`:

- Uses `diff` library (`diffLines`) to compute inline diffs
- Renders full file content with red/green highlights for removed/added lines
- Supports accept/revert actions via `api.writeFile`
- Branch rendering by type:
  - `edit`: inline diff (red/green) + accept/revert
  - `write`: all green highlight + accept/revert
  - `read`: pure code view (no highlights)
  - `webfetch`: Markdown rendering
  - `grep`: search results with keyword highlighting

### Tool Card Changes

Each card adds an `ExternalLink` icon button in the header area:

- **EditToolCard**: Read current file, reverse-apply edit to get original, show diff
- **WriteToolCard**: Read current file as modified, get original from git or empty, show all-green
- **ReadToolCard**: Read file, show in code viewer
- **WebFetchToolCard**: Show fetched content as Markdown
- **GrepToolCard**: Show search results with keyword highlighting

### Electron API Extension

- Add `writeFile(filePath, content)` IPC handler in main process
- Add `api.writeFile` in electronAPI.ts

## Files to Modify

| File | Change Type |
|------|-------------|
| `src/stores/app.ts` | Modify: add ToolDiffData, toolDiffData, showToolDiff |
| `src/components/common/ToolDiffViewer.vue` | New: core diff rendering component |
| `src/components/layout/InfoPanel.vue` | Modify: add tool-diff mode branch |
| `src/components/chat/tools/EditToolCard.vue` | Modify: add open panel button |
| `src/components/chat/tools/WriteToolCard.vue` | Modify: add open panel button |
| `src/components/chat/tools/ReadToolCard.vue` | Modify: add open panel button |
| `src/components/chat/tools/WebFetchToolCard.vue` | Modify: add open panel button |
| `src/components/chat/tools/GrepToolCard.vue` | Modify: add open panel button |
| `src/services/electronAPI.ts` | Modify: add writeFile API |
| `electron/main.ts` | Modify: add writeFile IPC handler |
| `src/i18n/locales/zh-CN.ts` | Modify: add translation keys |
| `src/i18n/locales/en-US.ts` | Modify: add translation keys |

## Accept/Revert Logic

- **Accept**: Close panel (changes already on disk)
- **Revert (Edit)**: Write `originalContent` back to file via `api.writeFile`
- **Revert (Write)**: Write `originalContent` back; if file was new (no original), delete file
- After revert: close panel, dispatch `refresh-file-tree` event

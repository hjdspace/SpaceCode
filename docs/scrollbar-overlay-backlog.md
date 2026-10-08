# 滚动条存量迁移清单（scrollbar-overlay backlog）

> 生成方式：扫描 `src/**/*.vue` 的 `<style>` 块，取出所有 `overflow[-x|-y]: auto|scroll`
> 声明，剔除文件内已存在 `@include scrollbar*` / `::-webkit-scrollbar` / `scrollbar-width` 的文件。
> 判定口径是"该文件完全没有对滚动条做过任何处理"，即这些滚动面当前渲染的是 Windows 原生滚动条。

## 背景

仓库统一用 `src/styles/_mixins.scss` 里的 `@mixin scrollbar-overlay($size: 10px, $inset: 3px)`
（`032b7769` 引入）做滚动条样式：轨道透明，滑块靠 3px 透明描边收窄成 4px 悬浮胶囊，
颜色走 `color-mix(... var(--text-muted) ...)` 因此四套主题都可见。mixin 由
`vite.config.mts` 的 `additionalData` 全局注入，任何 `<style lang="scss">` 里直接
`@include scrollbar-overlay;` 即可，无需 import。

既有 27 处用法全部是**裸调用**（无一传参），迁移时请保持一致。

## 现状统计

- 待迁移滚动面：**110 处**，分布在 **74 个文件**
- 其中纯横向 12 处（下表标 ⚠️）
- 按区域：skill_manager 40 · chat 23 · skills 14 · settings 7 · agents 5 · design 5 · mcp 4 · work 4 · layout 3 · common 2 · cron 2 · explorer 1

## 迁移约定

1. 紧跟 `overflow` 声明后写 `@include scrollbar-overlay;`，不要手抄规则。
2. 只滚横向、且外层已有纵向滚动器的面，改成 `overflow: auto hidden` 再套 mixin ——
   否则横向滚动条占掉的高度会变成纵向溢出，画出一条滑块铺满轨道的幽灵纵向滚动条。
   这个坑在 `MarkdownViewer` / `CodeViewer` / `SessionContextTaskPanel` 的注释里都记过。
3. 标 ⚠️ 的纯横向条目**先判断再改**：行高很矮的文本条（参考 `ToolDiffViewer` 的注释
   "行高只有 22px, 任何滚动条都会吃掉文本"）应该继续隐藏滚动条而不是画 10px 轨道。
4. 恒定深色面板（`BashToolCard` / `TaskOutputToolCard` 的 `.terminal-content`，底色硬编码
   `#0d1117`）保持现有 `#30363d` 滑块，**不要**换成主题变量 —— 那里写死是对的。
5. 每批改完跑 `npm run build && npm run test`（AGENTS.md 的门禁）。

## 清单

### skill_manager/ — 40 处

| 文件 | 选择器 | 行号 | 轴 |
| --- | --- | --- | --- |
| `skill_manager/AdoptDialog.vue` | `.ad-body` | 368 | y |
| `skill_manager/AgentManagementPage.vue` | `.amp-side-body` | 727 | y |
| `skill_manager/AgentManagementPage.vue` | `.amp-tabs` | 1019 | x ⚠️ |
| `skill_manager/AgentManagementPage.vue` | `.amp-tab-content` | 1053 | y |
| `skill_manager/AgentManagementPage.vue` | `.amp-pack-list` | 1345 | y |
| `skill_manager/AgentManagementPage.vue` | `.amp-layout` | 1450 | y |
| `skill_manager/AgentSyncPanel.vue` | `.asp-agent-strip` | 1214 | x ⚠️ |
| `skill_manager/ApplyPackDialog.vue` | `.ap-body` | 332 | y |
| `skill_manager/ApplyPackDialog.vue` | `.ap-agent-list` | 481 | y |
| `skill_manager/BatchConflictDialog.vue` | `.bcd-body` | 204 | y |
| `skill_manager/BuiltinPacksPage.vue` | `.sbp-page` | 477 | y |
| `skill_manager/BuiltinPacksPage.vue` | `.sbp-modal-body` | 846 | y |
| `skill_manager/DiagnosisPage.vue` | `.dxp-page` | 194 | y |
| `skill_manager/DistributeDialog.vue` | `.dd-body` | 162 | y |
| `skill_manager/DistributeDialog.vue` | `.dd-agent-list` | 165 | y |
| `skill_manager/ImportDialog.vue` | `.import-dialog-body` | 444 | y |
| `skill_manager/InstallPage.vue` | `.install-tabs` | 521 | x ⚠️ |
| `skill_manager/InstallPage.vue` | `.market-body` | 527 | y |
| `skill_manager/InstallPage.vue` | `.sync-panel, .form-panel` | 528 | y |
| `skill_manager/InstallPage.vue` | `.publisher-row` | 538 | x ⚠️ |
| `skill_manager/InstallPage.vue` | `.agent-strip` | 593 | x ⚠️ |
| `skill_manager/InstallPage.vue` | `.detail-scroll` | 628 | y |
| `skill_manager/InstallPage.vue` | `.adopt-dialog-body` | 635 | y |
| `skill_manager/OneClickOrganizeDialog.vue` | `.oco-body` | 181 | y |
| `skill_manager/PackBuilder.vue` | `.spp-picker-list` | 381 | y |
| `skill_manager/PackBuilder.vue` | `.spp-builder-grid` | 543 | y |
| `skill_manager/PreviewDialog.vue` | `.pd-body` | 125 | y |
| `skill_manager/SkillDetailSlider.vue` | `.sds-body` | 392 | y |
| `skill_manager/SkillDetailSlider.vue` | `.sds-aside pre` | 405 | xy |
| `skill_manager/SkillDetailSlider.vue` | `.sds-file-tree-scroll` | 414 | y |
| `skill_manager/SkillDetailSlider.vue` | `.sds-file-content` | 421 | xy |
| `skill_manager/SkillDetailSlider.vue` | `.sds-tabs`（在 `@media (max-width: 620px)` 内） | 437 | x ⚠️ |
| `skill_manager/SkillLibraryPage.vue` | `.slp-page` | 237 | y |
| `skill_manager/SkillManagerShell.vue` | `.sm2-nav` | 310 | y |
| `skill_manager/SkillManagerShell.vue` | `.sm2-workspace` | 555 | y |
| `skill_manager/SkillPackPage.vue` | `.spp-pack-list` | 690 | y |
| `skill_manager/SkillPackPage.vue` | `.spp-section-content` | 1044 | y |
| `skill_manager/SkillPackPage.vue` | `.spp-modal-body` | 1279 | y |
| `skill_manager/SkillPackPage.vue` | `.spp-layout` | 1348 | y |
| `skill_manager/SkillSettingsPage.vue` | `.sst-page` | 206 | y |

### chat/ — 23 处

| 文件 | 选择器 | 行号 | 轴 |
| --- | --- | --- | --- |
| `chat/AttachmentMenu.vue` | `.submenu-list` | 260 | y |
| `chat/CodeRewindConfirmDialog.vue` | `.code-rewind-confirm-content` | 113 | y |
| `chat/CodeRewindConfirmDialog.vue` | `.file-list` | 150 | y |
| `chat/ComposerStatusBar.vue` | `.popup-body` | 406 | y |
| `chat/ContextMenu.vue` | `.dropdown-list` | 167 | y |
| `chat/ContextUsageModal.vue` | `.modal-body` | 431 | y |
| `chat/CurrentTurnChangeCard.vue` | `.popup-diff` | 652 | xy |
| `chat/FileReadToolCard.vue` | `.fr-body` | 26 | y |
| `chat/FileWriteToolCard.vue` | `pre` | 32 | y |
| `chat/SlashCommandMenu.vue` | `.dropdown-list` | 171 | y |
| `chat/TeamStatusBar.vue` | `.teammate-tabs` | 89 | x ⚠️ |
| `chat/ToolCallCard.vue` | `.code-block` | 531 | x ⚠️ |
| `chat/ToolCallCard.vue` | `.diff-lines` | 601 | xy |
| `chat/ToolCallCard.vue` | `.diff-content` | 625 | x ⚠️ |
| `chat/ToolCallList.vue` | `.detail-code` | 480, 487 | xy |
| `chat/tools/BrowserUseToolCard.vue` | `.code-block` | 192 | xy |
| `chat/tools/GlobToolCard.vue` | `.file-list` | 56 | xy |
| `chat/tools/GrepToolCard.vue` | `.search-results` | 82 | xy |
| `chat/tools/PermissionRequestCard.vue` | `.generic-info` | 386 | y |
| `chat/tools/SkillToolCard.vue` | `.code-block` | 59 | xy |
| `chat/tools/StreamingCodeBlock.vue` | `.stream-code__body` | 300 | xy |
| `chat/WelcomeHero.vue` | `.welcome-hero` | 66 | y |
| `chat/WorkspaceDiffSurface.vue` | `.workspace-diff-surface` | 150 | xy |

### skills/ — 14 处

| 文件 | 选择器 | 行号 | 轴 |
| --- | --- | --- | --- |
| `skills/CategorySidebar.vue` | `.category-sidebar` | 136 | y |
| `skills/DirectoryManager.vue` | `.modal-body` | 211 | y |
| `skills/InstallProgressDialog.vue` | `.logs-container` | 189 | y |
| `skills/LocalSkillBrowser.vue` | `.main-pane` | 360 | y |
| `skills/LocalSkillBrowser.vue` | `.local-skill-browser` | 430 | y |
| `skills/LocalSkillDetail.vue` | `.skill-detail` | 178 | y |
| `skills/LocalSkillDetail.vue` | `.preview-content` | 342 | xy |
| `skills/MarketplaceBrowser.vue` | `.results-list` | 162 | y |
| `skills/MarketplaceSkillDetail.vue` | `.detail-body` | 317 | xy |
| `skills/MarketplaceSkillDetail.vue` | `:deep(pre)` | 370 | xy |
| `skills/PackInstallDialog.vue` | `.pid-body` | 391 | y |
| `skills/SkillEditor.vue` | `.preview-content` | 425 | xy |
| `skills/SkillEditor.vue` | `:deep(pre)` | 458 | xy |
| `skills/SkillsManager.vue` | `.skills-list` | 411 | y |

### settings/ — 7 处

| 文件 | 选择器 | 行号 | 轴 |
| --- | --- | --- | --- |
| `settings/BrowserUseLiveView.vue` | `.bu-viewport` | 326 | xy |
| `settings/BuiltinHookConfigModal.vue` | `.form-modal` | 183 | y |
| `settings/HookEditModal.vue` | `.form-modal` | 192 | y |
| `settings/HookSettings.vue` | `.form-modal` | 537 | y |
| `settings/ImSettings.vue` | `.guide-content` | 1502 | y |
| `settings/ImSettings.vue` | `pre` | 1567 | x ⚠️ |
| `settings/SearchableSelect.vue` | `.options-list` | 368 | y |

### agents/ — 5 处

| 文件 | 选择器 | 行号 | 轴 |
| --- | --- | --- | --- |
| `agents/AgentDetail.vue` | `.detail-body` | 153 | y |
| `agents/AgentDetail.vue` | `.prompt-preview` | 213 | y |
| `agents/AgentLibrary.vue` | `.category-sidebar` | 132 | y |
| `agents/AgentLibrary.vue` | `.agents-grid` | 165 | y |
| `agents/InstalledAgents.vue` | `.installed-agents` | 92 | y |

### design/ — 5 处

| 文件 | 选择器 | 行号 | 轴 |
| --- | --- | --- | --- |
| `design/DesignComposer.vue` | `.mcp-server-list` | 745 | y |
| `design/DesignSystemPicker.vue` | `.ds-picker-list` | 390 | y |
| `design/DesignSystemPicker.vue` | `.ds-preview-scroll` | 458 | y |
| `design/DesignSystemPreviewModal.vue` | `.ds-preview-modal-sidebar` | 721 | xy |
| `design/DesignSystemPreviewModal.vue` | `.ds-preview-modal-markdown :deep(pre)` | 777 | x ⚠️ |

### mcp/ — 4 处

| 文件 | 选择器 | 行号 | 轴 |
| --- | --- | --- | --- |
| `mcp/ConfigEditor.vue` | `.config-preview` | 130 | xy |
| `mcp/McpManager.vue` | `.mcp-content` | 764 | y |
| `mcp/McpServerEditor.vue` | `.dialog-content` | 390 | y |
| `mcp/McpServerEditor.vue` | `.json-example` | 577 | x ⚠️ |

### work/ — 4 处

| 文件 | 选择器 | 行号 | 轴 |
| --- | --- | --- | --- |
| `work/CustomAssistantEditor.vue` | `.editor-body` | 360 | y |
| `work/WorkAssistantGallery.vue` | `.gallery-body` | 382 | y |
| `work/WorkAssistantGallery.vue` | `.hover-card` | 537 | y |
| `work/WorkAssistantPicker.vue` | `.picker-card` | 109 | y |

### layout/ — 3 处

| 文件 | 选择器 | 行号 | 轴 |
| --- | --- | --- | --- |
| `layout/ChatPanel.vue` | `.history-modal-body` | 2096 | y |
| `layout/FileQuickOpen.vue` | `.qo-list` | 176 | y |
| `layout/NoProjectHome.vue` | `.no-project-home` | 92 | y |

### common/ — 2 处

| 文件 | 选择器 | 行号 | 轴 |
| --- | --- | --- | --- |
| `common/ChangelogModal.vue` | `.changelog-body` | 173 | y |
| `common/ErrorCard.vue` | `pre` | 147, 154 | xy |

### cron/ — 2 处

| 文件 | 选择器 | 行号 | 轴 |
| --- | --- | --- | --- |
| `cron/CronRunsPanel.vue` | `.run-output` | 182 | xy |
| `cron/CronTaskList.vue` | `.cron-content` | 147 | y |

### explorer/ — 1 处

| 文件 | 选择器 | 行号 | 轴 |
| --- | --- | --- | --- |
| `explorer/HistorySessionList.vue` | `.history-session-list` | 198 | y |

## 另外两处顺手项

- `explorer/SessionList.vue:319` 与 `layout/Sidebar.vue:949` 各自重复定义了一个局部
  `@mixin scrollbar-thin`，与 `_mixins.scss` 里的全局同名 mixin 并存（遮蔽隐患）。
  两个文件其余地方已经在用 `@include scrollbar-overlay`，建议把局部定义删掉统一走全局。
- `skill_manager/DistributeDialog.vue`、`skill_manager/InstallPage.vue`、
  `skill_manager/SkillDetailSlider.vue` 的样式压成了一行（minified 风格），
  插 `@include` 前先展开对应规则，否则容易改错到相邻规则上。

## 本轮已完成（不在上表内）

`SessionContextTaskPanel`（审查面板，含用户报的横向原生条）、`SessionContextEnvPanel`、
`SessionContextGitGraphModal`、`chat/ChatContextToolbar`、`chat/tools/EditToolCard`、
`debug/TraceListPage`、`debug/TraceSessionPage`、`debug/trace/MessageBlocks`、
`debug/trace/TraceDetailPanel` —— 这 9 个文件原先是**手写** `::-webkit-scrollbar` 且滑块色写死
（`rgba(255,255,255,.06~.15)` 或 `rgba(0,0,0,.08)`），在 `[data-theme='anthropic']`
（`--bg-primary: #faf9f5`）等浅色主题下等于隐形。已统一换成 mixin。
另外 `chat/ReasoningCard.vue` 的推理文本区已在 `6b1ae546` 单独提交。

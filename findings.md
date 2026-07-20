# Findings: Model Configuration Settings UX

## Confirmed
- The project is a Vue 3 + TypeScript Electron application with scoped SCSS and Pinia.
- All UI changes must support i18n.
- The `engine/` directory is out of scope.
- `src/components/settings/SettingsPanel.vue` renders `ProfileCards.vue` for the model tab.
- `useSettingsStore().applyProfile(id)` already applies fields, saves GUI settings, and persists the active profile id.
- `ProfileCards.vue` currently uses `expandedProfileId` as both the only editor visibility gate and the card click result.
- `expandedProfileId` starts as `null`, which creates the reported empty state until a card is clicked.
- Existing component tests cover rendering, expand/collapse, apply button behavior, deletion, naming, and creation.

## To Confirm
- Exact responsive behavior after the layout change.

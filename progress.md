# Progress: Model Configuration Settings UX

## 2026-07-16
- Started the UI and interaction audit.
- Loaded the required `impeccable` and `planning-with-files` skill instructions.
- Defined success criteria and constrained the change to renderer-side settings behavior unless audit evidence requires more.
- Logged and corrected a read-only `rg` argument parsing error; no project code was affected.
- Completed the audit: the existing store action already supports immediate switching, so implementation can stay in `ProfileCards.vue` plus focused i18n/test updates.
- Updated `ProfileCards.vue`, profile translations, and component tests for the always-visible editor and immediate card switching.
- Targeted ProfileCards tests pass 8/8; full Vitest assertions pass 770/770, with four existing Node-format files misclassified as empty Vitest suites.

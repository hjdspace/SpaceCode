# Task Plan: Model Configuration Settings UX

## Goal
Improve the model configuration settings UI so configurations are visible on entry and selecting a configuration applies it immediately, while preserving explicit save semantics for edits.

## Success Criteria
- The page has useful content without requiring users to expand a collapsed section.
- The active configuration is immediately recognizable and can be changed by clicking its row/card.
- Editing configuration fields remains distinct from activating a configuration.
- New UI text is internationalized.
- Relevant tests and `npm run build` pass.

## Phases
- [completed] Phase 1: Audit the current UI, state flow, tests, and design conventions.
- [pending] Phase 2: Implement the smallest coherent UI and interaction change.
- [pending] Phase 3: Verify behavior, types, build, and responsive presentation.

## Decisions
- Treat configuration activation and configuration editing as separate user actions.
- Preserve the existing data model and Electron/API contracts unless the audit proves a change is required.
- Render the active profile editor by default; profile card selection calls the existing `applyProfile` action.
- Keep profile edits persisted through the existing `updateProfile` path; remove only the redundant activation button.

## Errors Encountered
- Initial parallel search failed because an `rg` pattern beginning with `--` was parsed as a flag. Resolution: rerun with the `--` option terminator.
- Full `vitest` run reports four pre-existing `tests/components/chat/*.test.ts` files with "No test suite found" because they use Node test format; all 770 discovered Vitest assertions passed.

# AI Coding Instructions

For every feature or bugfix:

- Identify the changed surface before coding: `desktop` (Electron main process), `frontend` (Vue/TS UI), `engine` (AI engine), `electron` (IPC/preload), `docs`, or `CI`.
- Add same-area tests with the production change when possible.
- Preserve or improve existing test coverage.
- Use unit tests for pure logic, component tests for Vue UI, and integration tests for Electron IPC flows.
- Before marking work complete, run `npm run build` to verify the build passes. For high-risk changes (session management, engine switching, proxy, native modules), also verify the desktop app starts and basic chat works.
- In the final handoff or PR description, include changed files, tests added, and known residual risk.

## Project Structure

- `src/` — Vue 3 frontend (Vite + TypeScript)
- `electron/` — Electron main process, IPC handlers, preload
- `engine/` — AI engine (Bun runtime)
- `release-notes/` — Per-version release notes for GitHub Releases

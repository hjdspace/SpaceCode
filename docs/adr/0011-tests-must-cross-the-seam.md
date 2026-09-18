# Tests must cross the module's seam

## Context

`vitest.config.ts` enumerated eleven `include` patterns, one per test directory. Two runners existed: vitest (`npm run test`) and the Node test runner (`npm run test:electron`, globbing only `tests/electron/*.test.ts`). Neither was invoked by any CI workflow.

22 test files matched no `include` pattern and were never executed by any script. On inspection, **20 of them imported nothing from the codebase**: they declared local copies of the implementation and asserted against those copies.

| File | Assertions | What it actually exercised |
| --- | --- | --- |
| `tests/services/electronAPI.test.ts` (1445 lines) | 139 | A locally defined `createApi()`. Its own header comment said so: "The test recreates the same wrapper pattern used in src/services/electronAPI.ts". Deleting `src/services/electronAPI.ts` would not have failed a single assertion. |
| `tests/services/sessionPersistence.test.ts` (1183 lines) | 93 | Nine locally defined functions (`estimateUtf16Bytes`, `compressData`, `decompressData`, `stripPersistedPayload`, `cleanupOldSessions`, `truncateLongMessages`, `stripLargeAttachmentData`, `buildStoragePayload`, `truncateText`). Eight of them already exist and are **exported** from `src/services/sessionPersistence.ts`, whose only dependencies are types and `@/utils/normalizePath` — the module was importable the whole time. |
| `tests/services/teamTranscript.test.ts` (442 lines) | 76 | Seven local copies of functions exported by `src/services/teamTranscriptService.ts`. |
| `tests/skills/localSkills.store.test.ts` | 17 | `computeCategoryStats`, `computeCategoriesWithCount`, `filterSkills` — **none of which exist anywhere in this repository**. The subject had already been deleted. |
| `tests/bug-reproduction/rewind-*.test.ts` (3 files) | 17 | Their own `createBuggyRewindSession` / `createFixedRewindSession` / `mockAPI` fixtures. They asserted against a locally written model of the bug, not against the fix. |

These files had a real cause, not laziness: `src/services/api/_context.ts` reads `window.electronAPI` at module scope, so a module that cannot be imported in a plain test cannot be exercised through its interface. Copying the pattern was the workaround — and the workaround was invisible because nothing ran the files.

## Decision

1. **A test must import the module it tests.** If a module cannot be imported in a test, fix the seam — inject the dependency, or move the module-scope read behind a getter. Do not copy the implementation into the test.
2. **Delete transcripts rather than porting them.** Porting preserves the illusion: assertions that stay green whether or not the module works.
3. **One runner, one glob.** `include` is `['tests/**/*.test.ts', 'src/**/*.test.ts', 'electron/**/__tests__/**/*.test.ts']`, with no test-file entries in `exclude`. `test:electron` is deleted.
4. **Tests run in CI** (`.github/workflows/test.yml`), on pull requests and pushes to `main`.

## Rationale

- **The interface is the test surface.** A test that crosses the module's interface fails when the module breaks. A transcript cannot, because there is no seam between it and the code under test.
- **A green transcript is worse than no test.** `src/services/teamTranscriptService.ts` has 5.4% real line coverage while its transcript carried 76 assertions. A reader concludes the module is covered and stops looking.
- **Enumerated `include` patterns are a silent-failure mechanism.** Adding `tests/foo/bar.test.ts` ran nothing and reported nothing. The rot was produced by that, plus a second runner with a narrower glob that nobody remembered — and by the absence of CI to notice either.
- **One glob makes "which tests run" answerable by reading three lines.**

## Consequences

- 26 test files deleted / 8,982 lines: 20 TypeScript transcripts, plus 6 Python tests (`tests/test_*.py`) that imported an `agent.*` package absent from this repository. `pyproject.toml` — which contained only `[tool.pytest.ini_options]` — was removed with them.
- 7 real tests (86 assertions) now run under vitest, including the 3 main-process suites previously reachable only via `test:electron`. Main-process tests declare `// @vitest-environment node`.
- `vitest.config.ts` sets `pool: 'vmThreads'` (jsdom is constructed once per worker rather than once per file: ~33s → ~13s) and `retry: 1` for tests doing genuinely slow work — cold module-graph imports, component mounts, filesystem scans — whose 5s/15s default budgets are occasionally exceeded under load.
- If the Python tests belong to a sibling project, they must be restored there. This repository has no `agent` package for them to import.
- `src/services/sessionPersistence.ts` exports eight functions whose only "coverage" was a transcript. Real coverage for them is an open item, deliberately not addressed here.
- Making the workflow a **required** status check is a branch-protection setting, not a workflow property — it still has to be enabled in the repository settings.

## Alternatives considered

- **Port the transcripts to vitest as-is.** Rejected: it converts ~525 assertions about hand-copied code into passing tests, and entrenches the pattern that produced them.
- **Convert everything to the Node test runner and drop vitest.** Rejected: ~244 Vue component tests and the suite's `vi.mock` / `vi.useFakeTimers` usage would all need rewriting — far more work than the seam is worth.
- **Keep `test:electron` and run both runners in CI.** Rejected: two globs and two assertion dialects to keep green, and `AGENTS.md`'s documented verification command (`npm run test`) already skipped 60 passing tests.

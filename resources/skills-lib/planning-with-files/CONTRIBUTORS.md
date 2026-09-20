# Contributors

Thank you to everyone who has contributed to making `planning-with-files` better!

## Project Author

- **[Ahmad Othman Ammar Adi](https://github.com/OthmanAdi)** - Original creator and maintainer

## Code Contributors

These amazing people have contributed code, documentation, or significant improvements to the project:

### Major Contributions

- **[@kaichen](https://github.com/kaichen)** - [PR #9](https://github.com/OthmanAdi/planning-with-files/pull/9)
  - Converted the repository to Claude Code plugin structure
  - Enabled marketplace installation
  - Followed official plugin standards
  - **Impact:** Made the skill accessible to the masses

- **[@fuahyo](https://github.com/fuahyo)** - [PR #12](https://github.com/OthmanAdi/planning-with-files/pull/12)
  - Added "Build a todo app" walkthrough with 4 phases
  - Created inline comments for templates (WHAT/WHY/WHEN/EXAMPLE)
  - Developed Quick Start guide with ASCII reference tables
  - Created workflow diagram showing task lifecycle
  - **Impact:** Dramatically improved beginner onboarding

- **[@lasmarois](https://github.com/lasmarois)** - [PR #33](https://github.com/OthmanAdi/planning-with-files/pull/33), [PR #37](https://github.com/OthmanAdi/planning-with-files/pull/37)
  - Created session recovery feature for context preservation after `/clear`
  - Built `session-catchup.py` script to analyze previous session JSONL files
  - Enhanced PreToolUse hook to include Read/Glob/Grep operations
  - Restructured SKILL.md for better session recovery workflow (PR #33)
  - Extended catchup scanning to all sessions, not just the most recent one (PR #37)
  - **Impact:** Solves context loss problem, enables seamless work resumption across any session

- **[@aimasteracc](https://github.com/aimasteracc)** - [PR #30](https://github.com/OthmanAdi/planning-with-files/pull/30)
  - Added Kilocode IDE support and documentation
  - Created PowerShell scripts for Windows compatibility
  - Added `.kilocode/rules/` configuration
  - Updated documentation for multi-IDE support
  - **Impact:** Windows compatibility and IDE ecosystem expansion

- **[@SaladDay](https://github.com/SaladDay)** - [PR #57](https://github.com/OthmanAdi/planning-with-files/pull/57)
  - Fixed Stop hook POSIX sh compatibility for Debian/Ubuntu
  - Replaced bashisms (`[[`, `&>`) with POSIX constructs
  - Added shell-agnostic Windows detection using `uname -s`
  - **Impact:** Fixes hook failures on systems using dash as `/bin/sh`

- **[@murphyXu](https://github.com/murphyXu)** - [PR #56](https://github.com/OthmanAdi/planning-with-files/pull/56)
  - Added Continue IDE integration (VS Code / JetBrains)
  - Created `.continue/skills/` and `.continue/prompts/` structure
  - Added Chinese language slash command prompt
  - Created `docs/continue.md` installation guide
  - **Impact:** Expands IDE support to Continue.dev ecosystem

- **[@ZWkang](https://github.com/ZWkang)** - [PR #60](https://github.com/OthmanAdi/planning-with-files/pull/60)
  - Added CodeBuddy IDE integration (Tencent Cloud AI coding assistant)
  - Created `.codebuddy/skills/` folder with full skill structure
  - Added templates, scripts, and references for CodeBuddy
  - Created `docs/codebuddy.md` installation guide
  - **Impact:** Expands IDE support to CodeBuddy ecosystem

- **[@EListenX](https://github.com/EListenX)** (Yi Chenxi) - [PR #112](https://github.com/OthmanAdi/planning-with-files/pull/112)
  - Added full Kiro Agent Skill support under `.kiro/skills/planning-with-files/`
  - Created bootstrap scripts, steering integration with `#[[file:]]` live references
  - Replaced old `.kiro/scripts/` and `.kiro/steering/` with proper Agent Skill layout
  - Updated Cursor and Mastra Code hooks, improved docs/kiro.md
  - **Impact:** Brings Kiro IDE support to production quality with native Agent Skill format

- **[@lincolnwan](https://github.com/lincolnwan)** - [PR #80](https://github.com/OthmanAdi/planning-with-files/pull/80)
  - Added native GitHub Copilot hooks integration using the early 2026 hooks system
  - Created `.github/hooks/planning-with-files.json` with full hook scripts in `.github/hooks/scripts/`
  - Full cross-platform support (bash + PowerShell) and `docs/copilot.md` installation guide
  - **Impact:** Brought total supported platforms to 15, expanding the skill to the GitHub Copilot ecosystem

- **[@ciberponk](https://github.com/ciberponk)** - [PR #77](https://github.com/OthmanAdi/planning-with-files/pull/77)
  - Added isolated `.planning/{uuid}/` plan sessions with UUID generation and PLAN_ID pinning
  - Enables parallel planning sessions in separate terminals without state collision
  - Cross-platform scripts (bash + PowerShell) with full backward compatibility for single-session users
  - **Impact:** Unlocks parallel planning workflows, shipped to experimental branch ahead of master

- **[@ttttmr](https://github.com/ttttmr)** - [PR #67](https://github.com/OthmanAdi/planning-with-files/pull/67)
  - Added Pi Agent support with full skill integration
  - **Impact:** Expands the skill to the Pi Agent ecosystem

- **[@mvanhorn](https://github.com/mvanhorn)** (Matt Van Horn) - [PR #115](https://github.com/OthmanAdi/planning-with-files/pull/115)
  - Added analytics workflow template with `--template analytics` flag on `init-session.sh` and `init-session.ps1`
  - Created `analytics_task_plan.md` with 4 analytics-specific phases (Data Discovery, Exploratory Analysis, Hypothesis Testing, Synthesis)
  - Created `analytics_findings.md` with Data Sources table, Hypothesis Log, Query Results, and Statistical Findings sections
  - Analytics-specific `progress.md` with Query Log replacing Test Results
  - **Impact:** Extends the planning pattern to data analytics workflows (addresses #103)

- **[@ebrevdo](https://github.com/ebrevdo)** (Eugene Brevdo) - [PR #124](https://github.com/OthmanAdi/planning-with-files/pull/124)
  - Rewrote `session-catchup.py` to support Codex rollout JSONL session format
  - Added `CODEX_THREAD_ID` preference, subagent/tiny session filtering, and structured `patch_apply_end` event detection
  - Updated tests and docs for the new Codex catchup behavior
  - **Impact:** Brings session recovery parity to Codex users

- **[@bailob](https://github.com/bailob)** - [PR #136](https://github.com/OthmanAdi/planning-with-files/pull/136)
  - Added Hermes adapter with project plugin, Hermes facing `planning-with-files` skill, and `/plan` plus `/plan-status` command wrappers
  - Bundled Hermes skill templates and scripts inside `.hermes/skills/planning-with-files/` and resolved them through the active profile's `HERMES_HOME`
  - Added 20 unit tests covering status parsing, reminder behavior, installation layout, and completion checks
  - **Impact:** Brings planning-with-files to the Hermes ecosystem as platform 17

### Other Contributors

- **[@Skulli485](https://github.com/Skulli485)** - [PR #171](https://github.com/OthmanAdi/planning-with-files/pull/171), [Issue #162](https://github.com/OthmanAdi/planning-with-files/issues/162)
   - Authored the first `CONTRIBUTING.md` at the repo root, covering local setup, project layout, PR submission conventions, authorship and credit policy, language variant contribution rules, and where to ask questions
   - A pre-merge follow-up commit by the maintainer removed a duplicated intro and a broken four-backtick code fence from the original diff
   - **Impact:** new contributors now land on a dedicated guide auto-surfaced by GitHub in the PR creation flow, replacing the previous inference-based onboarding from `CLAUDE.md` and prior merged PRs

- **[@carterusedulm2-maker](https://github.com/carterusedulm2-maker)** - [PR #169](https://github.com/OthmanAdi/planning-with-files/pull/169), [PR #170](https://github.com/OthmanAdi/planning-with-files/pull/170)
  - PR #169: replaced the `[[ $# -gt 0 ]]` bashism in `init-session.sh` with POSIX `[ $# -gt 0 ]` across the 8 mirrored copies (canonical, `.codebuddy`, `.codex`, `.continue`, `.factory`, `.gemini`, `.pi`, top-level `scripts/`). The script's shebang is `#!/usr/bin/env bash`, but `tests/test_init_session_slug.py` invokes it via `["sh", str(INIT_SH), ...]` which bypasses the shebang and runs under `dash` on Ubuntu, where the `[[ ]]` syntax fails before any slug-mode logic can execute
  - PR #170: documented a Topic Handoff Pattern in `docs/quickstart.md` and `docs/workflow.md` for splitting unrelated topics across `.planning/<slug>/` directories or a manual `handoffs/<topic>.md` detail layer alongside `progress.md`
  - **Impact:** the test invocation through `sh` now runs cleanly across Linux distributions with non-bash `/bin/sh`; the documentation surfaces the slug-mode and handoff convention as the recommended workflow for parallel and long-running topics

- **[@gauravvojha](https://github.com/gauravvojha)** - [PR #167](https://github.com/OthmanAdi/planning-with-files/pull/167), [Issue #166](https://github.com/OthmanAdi/planning-with-files/issues/166)
  - Reported that `test_script_permissions.py` always failed on Windows because NTFS does not preserve POSIX executable bits
  - Supplied the initial `pytest.mark.skipif(sys.platform == "win32")` patch for the two exec-bit tests
  - **Impact:** The two pre-existing Windows exec-bit failures (present since v2.34.1) now skip cleanly on Windows, keeping the test suite green across all platforms

- **[@CleanDev-Fix](https://github.com/CleanDev-Fix)** (CleanFix-Dev) - [PR #168](https://github.com/OthmanAdi/planning-with-files/pull/168), [Issue #165](https://github.com/OthmanAdi/planning-with-files/issues/165)
  - Authored `docs/attestation-locking.md`, a dedicated page documenting the `attest-plan.sh` write path, the atomic temp-rename guarantee, the optional `flock` advisory lock, platform-specific fallback behavior, and the recommended slug-mode parallel workflow
  - Wired the new page into the canonical `SKILL.md` Security Boundary section for discoverability
  - **Impact:** Users on macOS and Windows Git Bash who hit the "flock not found" code path now have a clear explanation of why attestation still works and why slug-mode is preferred for concurrent sessions

- **[@bmyury](https://github.com/bmyury)** - [Discussion #153](https://github.com/OthmanAdi/planning-with-files/discussions/153)
  - Reported that the installed skill's description field appeared garbled in Claude Code, surfacing fragments of hook command output instead of the documented description
  - Root cause: the `'---BEGIN PLAN DATA---'` and `'---END PLAN DATA---'` plan-injection delimiters embedded in hook commands collided with the `---` YAML document separator; Claude Code's skill-discovery loader split frontmatter on the literal `---` substring and truncated the description mid-string
  - **Impact:** v2.38.1 swaps the delimiter shape to `===BEGIN PLAN DATA===` / `===END PLAN DATA===` across the canonical SKILL.md, all five language variants, the `.codebuddy/.codex/.cursor` adapter mirrors, and the `clawhub-upload` bundle. Same model-side framing semantics, no collision with the YAML separator

- **[@oaabahussain](https://github.com/oaabahussain)** - [Issue #150](https://github.com/OthmanAdi/planning-with-files/issues/150), [Issue #151](https://github.com/OthmanAdi/planning-with-files/issues/151)
  - Issue #150: pointed out that the v2.36.1 BEGIN/END delimiters were a mitigation, not a guarantee, and proposed SHA-256 hash attestation so any silent edit to `task_plan.md` between user approval and hook injection trips a verifiable check
  - Issue #151: named the regression class behind v2.34.1, v2.36.0, v2.36.2, and v2.36.3 (parity-locked files updated by hand across 19 destinations) and proposed the right surgical fix: a single bumper script plus a CI parity test
  - **Impact:** v2.37.0 ships `/plan-attest`, `attest-plan.sh/.ps1`, `bump-version.py`, and two new test files that turn both report classes into things that fail the build instead of shipping silently

- **[@gavinlinasd](https://github.com/gavinlinasd)** - [PR #135](https://github.com/OthmanAdi/planning-with-files/pull/135)
  - Added ClawHub download history chart to README, tracking skill download growth over time
  - **Impact:** Visitors can now see download traction at a glance

- **[@xiaolai](https://github.com/xiaolai)** - [PR #137](https://github.com/OthmanAdi/planning-with-files/pull/137), [PR #138](https://github.com/OthmanAdi/planning-with-files/pull/138), [PR #139](https://github.com/OthmanAdi/planning-with-files/pull/139), [Issue #140](https://github.com/OthmanAdi/planning-with-files/issues/140)
  - Ran the NLPM (Natural Language Programming Manager) audit on the plugin and filed 3 targeted fix PRs plus a full audit summary issue (overall score 91/100)
  - PR #137: fixed a missing quote in the Pi variant PowerShell session-catchup invocation that caused the command to fail silently on Windows
  - PR #138: capped session-catchup output at 100 lines with a labeled prefix before injecting into model context, closing a prompt injection vector from stored session content
  - PR #139: preferred known system Python paths over unqualified PATH resolution in `session-start.sh`, `pre-tool-use.sh`, and `error-occurred.sh`
  - **Impact:** Hardened the Copilot hook scripts and the Pi variant in one coordinated audit pass

- **[@githubYiheng](https://github.com/githubYiheng)** - [Issue #146](https://github.com/OthmanAdi/planning-with-files/issues/146)
  - Reported Codex session isolation failure: any Codex session in a shared working directory received the active plan context from an unrelated session, because the hooks keyed only on `task_plan.md` presence
  - Traced the code path through `user-prompt-submit.sh`, `pre_tool_use.py`, and `stop.py`, and proposed the session attachment model as a fix direction
  - **Impact:** Led to `$PWF_SESSION_ID` + sentinel file isolation, backward-compatible upgrade path, and 5 new targeted tests

- **[@09ashishkapoor](https://github.com/09ashishkapoor)** - [Issue #147](https://github.com/OthmanAdi/planning-with-files/issues/147)
  - Filed a detailed Hermes documentation gap report: the integration worked but docs implied feature parity with hook-native platforms, leading to user confusion when stop/block behavior differed
  - Outlined the four sections needed (what works, what is not equivalent, recommended pattern, tradeoffs) with enough specificity to write from directly
  - **Impact:** `docs/hermes.md` now has an `Integration Notes` section that sets accurate expectations for Hermes adopters

- **[@shawnli1874](https://github.com/shawnli1874)** - [Issue #148](https://github.com/OthmanAdi/planning-with-files/issues/148)
  - Reported that v2.0.0 hooks broke parallel multi-task workflows by hardcoding `task_plan.md` at the project root, removing the placement flexibility that CLAUDE.md conventions had previously allowed
  - Provided a concrete reproduction with anonymized task files showing how parallel sessions contaminated each other after a few hours of work
  - Proposed the `YYYY-MM-DD-<slug>/` naming convention as a human-readable alternative to the UUID approach in `experimental/isolated-planning`
  - **Impact:** Slug-based `init-session.sh`, `set-active-plan.sh`, `resolve-plan-dir.sh`, and the full Codex hook resolver wire-up all trace back to this report

- **[@Leon-Algo](https://github.com/Leon-Algo)** - [PR #119](https://github.com/OthmanAdi/planning-with-files/pull/119), [PR #120](https://github.com/OthmanAdi/planning-with-files/pull/120), [PR #122](https://github.com/OthmanAdi/planning-with-files/pull/122)
  - Made planning scripts executable in `.codex` skill install, fixing Codex installer breakage (PR #119)
  - Added official Codex hooks.json integration with full lifecycle hooks — SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop — bringing Codex to full hook parity with other IDEs (PR #120)
  - Fixed canonical script execute bits for `check-complete.sh` and `init-session.sh` with regression test (PR #122)
  - **Impact:** Codex users now get the same automatic context injection and lifecycle automation as Claude Code and Cursor users

- **[@YSAA1](https://github.com/YSAA1)** - [PR #109](https://github.com/OthmanAdi/planning-with-files/pull/109)
  - Fixed Codex session-catchup fallback that was silently broken after the session path changes

- **[@kevinaimonster](https://github.com/kevinaimonster)** - [PR #108](https://github.com/OthmanAdi/planning-with-files/pull/108)
  - Added Simplified Chinese localization support, extending the skill to Chinese-language users

- **[@wd041216-bit](https://github.com/wd041216-bit)** - [PR #107](https://github.com/OthmanAdi/planning-with-files/pull/107)
  - Added openclaw-github-repo-commander to the Community Built section, expanding the ecosystem showcase

- **[@popey](https://github.com/popey)** - [PR #83](https://github.com/OthmanAdi/planning-with-files/pull/83)
  - Fixed `allowed-tools` YAML list (invalid per Anthropic skill spec, silently killing discoverability)
  - Fixed `metadata.version` placement and added trigger terms for better skill matching
  - Applied across the canonical SKILL.md file

- **[@jonthebeef](https://github.com/jonthebeef)** - [PR #75](https://github.com/OthmanAdi/planning-with-files/pull/75)
  - Added `/plan:status` command for quick planning progress display without reading through all planning files

- **[@codelyc](https://github.com/codelyc)** - [PR #66](https://github.com/OthmanAdi/planning-with-files/pull/66), [PR #70](https://github.com/OthmanAdi/planning-with-files/pull/70), [PR #76](https://github.com/OthmanAdi/planning-with-files/pull/76)
  - Fixed Codex skill path references and replaced CLAUDE_PLUGIN_ROOT with correct absolute paths (PR #66)
  - Fixed CodeBuddy skill path references and environment variables (PR #70)
  - Added OpenCode scripts for the planning-with-files skill (PR #76)

- **[@Guozihong](https://github.com/Guozihong)** - [PR #51](https://github.com/OthmanAdi/planning-with-files/pull/51)
  - Added `/planning-with-files:start` command, enabling skill activation without copying files manually

- **[@fahmyelraie](https://github.com/fahmyelraie)** - [PR #49](https://github.com/OthmanAdi/planning-with-files/pull/49)
  - Fixed Stop hook path resolution when CLAUDE_PLUGIN_ROOT is not set in the environment

- **[@olgasafonova](https://github.com/olgasafonova)** - [PR #46](https://github.com/OthmanAdi/planning-with-files/pull/46)
  - Added SkillCheck validation badge after running the skill through spec validation

- **[@AZLabsAI](https://github.com/AZLabsAI)** - [PR #65](https://github.com/OthmanAdi/planning-with-files/pull/65)
  - Updated OpenClaw docs to reflect the product rename from Moltbot, correcting all paths and CLI commands

- **[@raykuo998](https://github.com/raykuo998)** - [PR #88](https://github.com/OthmanAdi/planning-with-files/pull/88), [PR #86](https://github.com/OthmanAdi/planning-with-files/pull/86)
  - Fixed `check-complete.ps1` completely failing on PowerShell 5.1 due to special character parse errors in double-quoted strings; switched to single-quoted strings with concatenation across all 12 platform copies (PR #88)
  - Fixed Stop hook YAML multiline command block failing under Git Bash on Windows; collapsed 25-line OS detection to single-line implicit platform fallback chain across all 7 SKILL.md variants (PR #86)

- **[@gydx6](https://github.com/gydx6)** - [PR #79](https://github.com/OthmanAdi/planning-with-files/pull/79)
  - Fixed session-catchup false positives in all 9 skill-distributed copies
  - Added early return guards for non-planning projects
  - Thorough bug report with root cause analysis
  - **Impact:** Eliminates noise from false catchup reports

- **[@waynelee2048](https://github.com/waynelee2048)** - [PR #113](https://github.com/OthmanAdi/planning-with-files/pull/113)
  - Added Traditional Chinese (zh-TW) skill variant with fully translated SKILL.md, templates, and scripts
  - Includes localized hooks, check-complete, init-session, and session-catchup scripts

- **[@tobrun](https://github.com/tobrun)** - [PR #3](https://github.com/OthmanAdi/planning-with-files/pull/3)
  - Early directory structure improvements
  - Helped identify optimal repository layout

- **[@markocupic024](https://github.com/markocupic024)** - [PR #4](https://github.com/OthmanAdi/planning-with-files/pull/4)
  - Cursor IDE support contribution
  - Helped establish multi-IDE pattern

- **Copilot SWE Agent** - [PR #16](https://github.com/OthmanAdi/planning-with-files/pull/16)
  - Fixed template bundling in plugin.json
  - Added `assets` field to ensure templates copy to cache
  - **Impact:** Resolved template path issues

- **[@tt-a1i](https://github.com/tt-a1i)** - [PR #92](https://github.com/OthmanAdi/planning-with-files/pull/92), [PR #99](https://github.com/OthmanAdi/planning-with-files/pull/99), [PR #100](https://github.com/OthmanAdi/planning-with-files/pull/100)
  - Fixed broken Advanced Topics links in Codex SKILL.md (PR #92)
  - Fixed 5 consistency issues across docs: broken links in opencode.md and factory.md, stale `notes.md` references replaced with `findings.md` across all 16 IDE copies, OpenCode support label corrected in README, `--help` in sync-ide-folders.py no longer runs a sync (PR #99)
  - Fixed Codex session-catchup silently scanning Claude session paths; now prints an explicit fallback message when running from Codex context (PR #100)
  - **Impact:** Significant docs and tooling consistency sweep across the entire multi-IDE surface

- **[@Emin017](https://github.com/Emin017)** (Qiming Chu) - [PR #145](https://github.com/OthmanAdi/planning-with-files/pull/145)
  - Changed shebangs from `/bin/bash` to `/usr/bin/env bash` across hook scripts
  - Fixes compatibility on systems like NixOS where bash is not at `/bin/bash`

- **[@TomXPRIME](https://github.com/TomXPRIME)** - [PR #157](https://github.com/OthmanAdi/planning-with-files/pull/157), [PR #158](https://github.com/OthmanAdi/planning-with-files/pull/158)
  - PR #157: brought the `.pi` adapter up to full hook parity with Claude Code by shipping a bundled TypeScript extension under `.pi/skills/planning-with-files/extensions/planning-with-files/`
  - Mapped eight Pi lifecycle events to the same behavior the skill provides on Claude Code: `session_start` runs session catchup, `before_agent_start` injects plan context, `tool_call` adds pre-tool recitation, `tool_result` appends the post-write reminder, `agent_end` auto-continues incomplete plans with a per-session+plan limit of three, `session_before_compact` flushes the plan reminder with the active `Plan-SHA256`, `session_shutdown` clears loop timers and per-session state, `input` resets the auto-continue counter
  - Added a four-mode system (`auto`, `parity`, `cache-safe`, `notify`) with DeepSeek auto-detection from `ctx.model.provider` and `ctx.model.id`, so cache-prefix-sensitive models keep their KV-cache stable
  - Wired the existing v2.37 SHA-256 attestation gate into the Pi runtime so the same `.attestation` file locks the plan across both Claude Code and Pi
  - Registered four slash commands (`/plan-status`, `/plan-attest`, `/plan-goal`, `/plan-loop`) mirroring their Claude Code counterparts
  - Added 12 contract tests covering packaging, declared capabilities, and documentation strings; iterated through PRs #155 and #156 to land code-only and version-clean in #157
  - PR #158: closed the Pi SKILL.md sync gap after v2.39.0 shipped. Backported Rule 7 (Continue After Completion), the Security Boundary section, the expanded Scripts section covering `set-active-plan.sh`/`resolve-plan-dir.sh`/`attest-plan.sh` and the parallel task workflow, and the "Write web content to task_plan.md" anti-pattern row. Renamed the npm package from the unscoped `pi-planning-with-files` to `@tomxprime/planning-with-files`, matching the package author's npm namespace. Rewrote the install docs to point at the scoped package and to use `pi install ./.pi/skills/planning-with-files` (local path) for manual installs. Removed the redundant manual session-catchup instruction since the Pi extension handles that lifecycle event automatically
  - **Impact:** Pi adapter now ships at parity with Claude Code in both runtime behavior (PR #157) and instruction surface (PR #158). DeepSeek+Pi users get a cache-safe reminder path that does not invalidate the KV-cache prefix on every turn, and the npm publishing chain is now under the scoped namespace of the package author

- **[@DLI1996](https://github.com/DLI1996)** - [Issue #154](https://github.com/OthmanAdi/planning-with-files/issues/154)
  - Caught that `docs/codex.md` instructed users to set `codex_hooks = true` in `~/.codex/config.toml`, while OpenAI's current Codex hooks docs (developers.openai.com/codex/hooks) now make `hooks` the canonical key and `codex_hooks` a deprecated alias
  - Linked the upstream OpenAI page so the canonical key change was easy to verify
  - **Impact:** v2.39.0 swaps the docs to `hooks = true` in four sites with an alias note, so new users get the canonical key while users on older configs are not pushed to migrate

## Community Forks

These developers have created forks that extend the functionality:

- **[@RioTheGreat-ai](https://github.com/RioTheGreat-ai)** - [agentfund-skill](https://github.com/RioTheGreat-ai/agentfund-skill)
  - Crowdfunding platform for AI agents using milestone-based escrow on Base, built with planning-with-files

- **[@kmichels](https://github.com/kmichels)** - [multi-manus-planning](https://github.com/kmichels/multi-manus-planning)
  - Multi-project support
  - SessionStart git sync integration

## Issue Reporters & Testers

Thank you to everyone who reported issues, provided feedback, and helped test fixes:

- [@nazeshinjite](https://github.com/nazeshinjite) - Issue #133 (Stop hook portability failure on Windows Git Bash — two-root-cause diagnosis with full Claude output, fixed in v2.34.1)
- [@msuadOf](https://github.com/msuadOf) - Issue #93 (TMPDIR environment fix for plugin install)
- [@DorianZheng](https://github.com/DorianZheng) - Issue #84 (BoxLite sandbox integration proposal)
- [@mtuwei](https://github.com/mtuwei) - Issue #32 (Windows hook error)
- [@JianweiWangs](https://github.com/JianweiWangs) - Issue #31 (Skill activation)
- [@tingles2233](https://github.com/tingles2233) - Issue #29 (Plugin update issues)
- [@st01cs](https://github.com/st01cs) - Issue #28 (Devis fork discussion)
- [@wqh17101](https://github.com/wqh17101) - Issue #11 testing and confirmation
- [@luyanfeng](https://github.com/luyanfeng) - Issue #172 (OpenCode install/verify paths doubled the folder segment in docs/opencode.md; fixed in v2.43.0)

And many others who have starred, forked, and shared this project!

- **[@voidborne-d](https://github.com/voidborne-d)** - [PR #149](https://github.com/OthmanAdi/planning-with-files/pull/149)
  - Caught that `skills/planning-with-files/scripts/init-session.sh` was not updated when slug mode shipped in v2.36.0, meaning users installing via npx or IDE folders silently received the old script
  - Identified the same gap in the analytics template (v2.29.0) and the shebang drift from v2.35.1 across IDE mirror folders
  - Synced the canonical skill copy and all IDE mirrors using the existing `sync-ide-folders.py` tool, and added a byte-comparison regression test plus a `--verify` CI assertion to prevent recurrence
  - **Impact:** v2.36.0 headline feature (parallel plan isolation) now actually reaches users who install via the skill; regression test closes the drift class permanently

## How to Contribute

We welcome contributions! Here's how you can help:

1. **Report Issues** - Found a bug? Open an issue with details
2. **Suggest Features** - Have an idea? Share it in discussions
3. **Submit PRs** - Code improvements, documentation, examples
4. **Share** - Tell others about planning-with-files
5. **Create Forks** - Build on this work (with attribution)

See our [repository](https://github.com/OthmanAdi/planning-with-files) for more details.

## Recognition

If you've contributed and don't see your name here, please open an issue! We want to recognize everyone who helps make this project better.

---

**Total Contributors:** 44+ and growing!

*Last updated: May 26, 2026*

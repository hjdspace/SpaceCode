# ADR 0001: Skill Manager V2 Architecture

**Date:** 2026-08-10
**Status:** Accepted

## Context

SpaceCode's current Skill management is a simple file scanner (`skillsService.ts`) that reads `.claude/skills` and `.claude/commands` directories. It has no central library, no multi-agent support, no conflict detection, and no skill packs. Users manually copy Skills to each Agent directory.

AgentBro (a Tauri/Rust app) has a complete Skill Manager v2 with SQLite, symlink distribution, agent scanning, conflict resolution, skill packs, and diagnosis. The user wants these capabilities in SpaceCode.

## Decision

Reimplement AgentBro's Skill Manager v2 design in SpaceCode's tech stack:

1. **Storage:** Introduce `better-sqlite3` as the primary data store, mirroring AgentBro's schema (skills, agents, targets, claims, packs, unmanaged_items, diagnosis_issues).
2. **Center Library:** `~/.spacecode/skills` — independent from any Agent's directory.
3. **Agents:** Built-in registry for Claude Code (`~/.claude/skills`), Codex (`~/.codex/skills`), Cursor (`~/.cursor/skills`), Trae (`~/.trae/skills`). Extensible via custom entries.
4. **Distribution:** Default `link` (symlink). On Windows, if symlink creation fails (no Developer Mode / admin), auto-fallback to `copy`. Record `actualMode` in the database.
5. **Migration:** First-run guided wizard — scan all Agent directories, list unmanaged Skills, batch-adopt non-conflicting ones, resolve conflicts individually.
6. **UI:** Full-page layout (not modal) with left-side Tab navigation. Tabs: Library, Install, Packs, Agents, Diagnostics, Settings.

## Consequences

- **+** Central library eliminates "copy to every Agent" pain.
- **+** Symlink distribution means Center Library edits propagate instantly to linked Agents.
- **+** Conflict detection prevents silent overwrites of same-name Skills from different sources.
- **+** Skill Packs enable one-click apply/revoke of Skill groups.
- **+** Diagnosis engine surfaces broken links, outdated copies, unmanaged files.
- **-** New native dependency (`better-sqlite3`) requires platform-specific rebuilds.
- **-** First-run migration requires user attention (guided wizard).
- **-** Windows symlink limitations require fallback strategy.

## Alternatives Considered

1. **JSON-only storage (no SQLite):** Simpler, no native dependency, but poor query performance for 100+ Skills × 10+ Agents × 1000+ targets. Rejected for scalability.
2. **Reuse `~/.claude/skills` as center:** Avoids migration, but blurs the line between "Claude Code's directory" and "SpaceCode's managed library." Rejected for clarity.
3. **Keep modal UI:** Lower risk, but insufficient space for 6-tab layout with detail panels. Rejected for UX.

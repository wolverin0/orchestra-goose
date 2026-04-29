# Wave 7 — Per-Project Migration Checklist

> Concrete checklist for migrating each active project from the legacy CC stack to orchestra-goose. Run this checklist per project during Wave 7 (after W2-W6 stabilize). Each project should be migratable in 1-2 hours.

## Prerequisites (must hold before starting any project migration)

- [ ] Wave 1-6 deliverables in fork are functional (recipes validate, MM MCP responds, peer-pane recipe spawns successfully)
- [ ] `goosed` daemon installed via `scripts/install-goosed-service.ps1` (W4.1)
- [ ] `claude-agent-acp` adapter installed globally via npm
- [ ] Project's existing `monitoring.md` present in project root (we converted this in earlier sessions)
- [ ] Project's `vault/active_tasks.md` present (or created via /monitoring-setup recipe)
- [ ] graphify-out/GRAPH_REPORT.md exists OR project doesn't need graph context

## Per-project migration steps

### Generic — apply these to every project

```
1. Create .goose/ directory at project root
2. Run: goose run --recipe monitoring-setup
   — creates .goose/project.toml from template, ingests setup claim
3. Validate health: goose run --recipe project-doctor
   — table output: PASS/WARN/FAIL/SKIP per check
4. Run smoke test: goose run --recipe lookahead-brief --params user_task="describe this project's current task"
   — verify briefing fires + correct claims pulled
5. Edit .goose/project.toml — set monitoring.escalation_channel to project's Telegram chat ID (or "log-only")
6. Run benchmark: bash scripts/measure-lookahead-latency.sh "<project-path>"
   — record cold + warm latency, target cold <2s warm <500ms
7. Verify orchestrator extension: goose session, then ask "list active sub-agent sessions"
   — built-in orchestrator extension should respond with empty list
8. Update project's CLAUDE.md / AGENTS.md with one-line note: "Now orchestrated via orchestra-goose. See ~/.claude/plans/fuzzy-napping-bear.md."
```

## Per-project notes

### 1. wezbridge

**Special considerations:** project itself is being retired; migrate it FIRST so the fork is dogfooded against its own retirement.

- [ ] active_tasks.md already populated with current L1 work
- [ ] graphify already indexed (graphify-out/ exists)
- [ ] GitNexus likely indexed
- [ ] ⚠️ This project's wezbridge MCP server itself is the legacy infra being retired — once wezbridge migration lands, also archive the wezbridge MCP server entry in any other project's .claude/.mcp.json
- [ ] Branch: `orchestra/migrate-wezbridge`

### 2. pather

**Special considerations:** active project, mid-development.

- [ ] Confirm vault/active_tasks.md exists + reflects current state
- [ ] Run `/monitoring-setup` if monitoring.md missing
- [ ] graphify might need re-run if stale
- [ ] Branch: `orchestra/migrate-pather`

### 3. damore2

**Special considerations:** very large project (29k+ ERPNext customizations).

- [ ] Wave-execution protocol still applies (memory mm-???: per-wave plan→execute→test→audit→remediate)
- [ ] Port any damore-specific recipes (audit-related) if they exist
- [ ] Verify .goose/project.toml's scope is `project:damore2` (or whatever MM uses for the project; check MM scope listing first)
- [ ] Branch: `orchestra/migrate-damore2`

### 4. app

**Special considerations:** dashboard slowness gotcha (Node event loop blocking — see existing claim).

- [ ] Standard migration steps
- [ ] No special recipes needed
- [ ] Branch: `orchestra/migrate-app`

### 5. venezia

**Special considerations:** recently completed audits + 5 follow-up fixes (mm-bnm50a6ez era).

- [ ] active_tasks.md should be near-empty (most tasks done)
- [ ] Standard migration steps
- [ ] Branch: `orchestra/migrate-venezia`

### 6. clawtrol

**Special considerations:** audit-only workspace; no codebase per se.

- [ ] Skip if it doesn't qualify as orchestra-goose target (no real source files)
- [ ] OR: minimal config — only enable lookahead-brief + handoff recipes
- [ ] Branch: `orchestra/migrate-clawtrol`

### 7. nereidas

**Special considerations:** recent /audit run found 4 unresolved hard stops (per mm recall earlier today).

- [ ] Verify the 4 hard stops are tracked as in_progress / pending tasks in active_tasks.md
- [ ] Migration shouldn't disrupt remediation work
- [ ] Branch: `orchestra/migrate-nereidas`

## Acceptance criteria for Wave 7 closure

- [ ] All 7 projects above have completed the checklist
- [ ] 2 weeks of dogfood completed without falling back to CC for any task
- [ ] Every fallback to CC documented in `WAVE7_FALLBACK_LOG.md` (create that file at first incident)
- [ ] No `wezbridge` MCP server invoked during dogfood window (verify via process list)
- [ ] No `omniclaude` Claude pane running during dogfood window
- [ ] All open issues against the fork resolved or scheduled

## Rollback plan

If dogfood reveals a deal-breaker:

1. Each project keeps its old `monitoring.md` and `~/.claude/hooks/` config — those are NOT deleted in Wave 7. They become inactive but available.
2. Stop the goosed Windows service: `nssm stop goosed`
3. Revert `.goose/project.toml` to disable orchestra-goose if needed (single config flag).
4. Resume CC daily work with no other changes required.

## Estimated time per project

| Project | Estimated migration time |
|---|---|
| wezbridge | 2 hours (also dogfood target #1) |
| pather | 1 hour |
| damore2 | 1.5 hours (large project, more verification) |
| app | 1 hour |
| venezia | 1 hour |
| clawtrol | 30 min (might skip) |
| nereidas | 1.5 hours (audit work in flight) |

**Total: ~9 hours migration + 2 weeks dogfood window.**

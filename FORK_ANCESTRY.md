# Fork Ancestry — orchestra-goose

> Track this fork's relationship with upstream `aaif-goose/goose` so we can merge improvements without losing our customizations.

## Origin

- **Forked from:** [`aaif-goose/goose`](https://github.com/aaif-goose/goose)
- **Fork date:** 2026-04-29
- **Upstream commit at fork time:** `000d7c58de2364a6fd63fa59ed259be25612ad55` (`feat: make ollama host configurable in goose2 (#8912)`, 2026-04-29 11:16 -0700)
- **Upstream branch tracked:** `main`
- **Local branch for our work:** `main` (default)
- **Custom branch convention:** `orchestra/<feature-name>` for our patches

## Why we forked

Per `~/.claude/plans/fuzzy-napping-bear.md` (mm-2ea2 + mm-942c). Goose is the open-source AI agent substrate we're building on. We need to:

- Add private/internal MCP extensions (MemoryMaster, GitNexus, graphify) without merging upstream
- Customize default config to wire those extensions in
- Ship a custom distro with our branding for the team

## Divergence policy

What we touch (expect to maintain across upstream merges):
- `crates/goose/src/providers/declarative/` — provider configs (we add or modify)
- Default `config.yaml` baseline (our preferred extension set + provider)
- Recipes under `recipes/` (our custom orchestration)
- `CUSTOM_DISTROS.md`-derived docs at `ORCHESTRA_DISTRO.md`

What we DON'T touch (lift from upstream verbatim):
- `crates/goose/src/agents/` — core agent loop, subagent_tool, mpsc channels
- `crates/goose-server/` — goosed daemon
- `crates/goose-cli/` — CLI entrypoint
- All built-in platform extensions (chatrecall, orchestrator, tom, summon, skills, developer, analyze, todo, apps)

This means upstream maintains our hot path; we maintain only our customization surface.

## Merge cadence

- **Pull from upstream:** every 2 weeks
- **Merge strategy:** rebase if our changes are small (<5 commits); merge if larger
- **Conflict policy:** prefer upstream for files in "DON'T touch" list above; prefer ours for "What we touch" list

## Commands cheat sheet

```bash
# Sync from upstream
git fetch upstream
git checkout main
git rebase upstream/main           # if no/few local commits
# OR
git merge upstream/main --no-ff    # if many local commits

# Push our updated main to our fork
git push origin main

# Start a feature branch
git checkout -b orchestra/<name>
```

## Versioning

Our distro version = `<upstream version>-orchestra.<our-suffix>`. Example: if upstream is 1.33.1 and we tag a release, it becomes `1.33.1-orchestra.1`.

## Decision log

| Date | Event | Notes |
|---|---|---|
| 2026-04-29 | Forked from upstream commit `000d7c58` | Wave 1.1 of Goose migration plan |

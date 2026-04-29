# orchestra-goose Distribution

> Custom distribution of [goose](https://github.com/aaif-goose/goose) tailored for our multi-pane AI orchestration workflows. Drop-in replacement for the legacy `wezbridge + ~/.claude/hooks + omniclaude` stack.

## What's different from upstream goose

| Aspect | Upstream goose | orchestra-goose |
|---|---|---|
| Default provider | Anthropic API | claude-acp (piggybacks on Claude Code login — no API key needed) |
| Default extensions enabled | developer, todo, analyze, apps, skills, summon, extensionmanager, tom | + memorymaster (MCP), + gitnexus (MCP), + graphify (MCP) |
| Default recipes shipped | upstream set | + `lookahead-brief` (auto-fetch task briefing per prompt) |
| Branding | "goose" | "orchestra-goose" (CLI binary stays `goose` for compatibility) |
| Per-project config | none by convention | reads `<project>/.goose/project.toml` for orchestration setup |
| Multi-pane orchestration | via `summon` extension | + `wezbridge-compat` recipe shim during migration |

## Built-in extensions we lean on (all from upstream)

These ship with stock goose and are the foundation of our orchestration:

| Extension | Role in orchestra-goose | Replaces |
|---|---|---|
| `orchestrator` | Manage subagent sessions (list/start/send/stop) | wezbridge MCP |
| `summon` | Spawn subagents with scoped tool access | wezbridge spawn_session |
| `tom` (Top Of Mind) | Inject per-turn context via `GOOSE_MOIM_MESSAGE_TEXT` | The CC L1 hook's additionalContext path |
| `skills` | Discover skill instructions from filesystem | `~/.claude/skills/` |
| `chatrecall` | Search past sessions for context | partial overlap with MM (kept disabled by default) |

## Custom MCP extensions we add

| Extension | Source | Purpose |
|---|---|---|
| `memorymaster` | `Py Apps/memorymaster` | Persistent claims-graph memory (21 tools including query_for_task) |
| `gitnexus` | upstream repo | Code call graphs + impact analysis |
| `graphify` | upstream repo | Knowledge-graph community detection |

## Custom recipes we add

| Recipe | What it does |
|---|---|
| `lookahead-brief` | Auto-fetch task briefing (read active_tasks.md → query MM/GN/graphify → compose ≤2KB briefing → inject before user task) |
| `monitoring-setup` | Bootstrap a project for orchestra-goose orchestration (port of `/monitoring-setup` skill) |
| `project-doctor` | Health-check a project's orchestration setup (port of `/project-doctor` skill) |

## Setup quickstart

```bash
# 1. Install prebuilt CLI (or build from source)
curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash

# 2. Install claude-acp adapter (for Claude Code piggyback auth)
npm install -g @agentclientprotocol/claude-agent-acp

# 3. Configure provider (one-time)
# Append to ~/.config/goose/config.yaml:
GOOSE_PROVIDER: claude-acp
GOOSE_MODEL: default

# 4. Register MemoryMaster MCP (one-time)
# See ORCHESTRA_DISTRO_CONFIG.yaml for the full extensions block to merge in.

# 5. Try it
goose run -t "test" --no-session
```

## Per-project setup

Each project that uses orchestra-goose for orchestrated work needs:

```
<project>/
├── monitoring.md              # frontmatter: project name, watchdog, etc.
├── vault/active_tasks.md      # OmniClaude-style task pointer (read by lookahead-brief)
└── .goose/                    # (created by /monitoring-setup recipe)
    └── project.toml           # per-project config (extensions, recipes, defaults)
```

## Fork relationship

See `FORK_ANCESTRY.md` for upstream tracking + merge cadence + divergence policy.

## License

Apache 2.0 — same as upstream goose.

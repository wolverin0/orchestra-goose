# Migration Mapping — legacy stack → orchestra-goose

> Quick reference for porting legacy `~/.claude/hooks/`, wezbridge MCP, and skills to their goose-native equivalents. One-line per item. Wave numbers refer to `~/.claude/plans/fuzzy-napping-bear.md`.

## Hooks (Wave 6)

| Legacy `~/.claude/hooks/` | Goose lifecycle | Status |
|---|---|---|
| `memorymaster-recall.py` | pre-prompt hook → `lookahead-brief` recipe | done as recipe (W2.5) |
| `memorymaster-classify.py` | pre-prompt hook (call `mcp__memorymaster__classify_query`) | TODO W6 |
| `memorymaster-auto-ingest.py` | session-end hook (call `mcp__memorymaster__ingest_claim`) | TODO W6 |
| `memorymaster-precompact.py` | pre-compact hook (vacuum / WAL checkpoint) | TODO W6 |
| `memorymaster-validate-wiki.py` | post-tool-use hook on Write/Edit (validate wiki frontmatter) | TODO W6 |
| `pretool-guardrail.js` (G01-G07) | pre-tool-use hook (sudo/force-push/no-verify guards) | TODO W6 |
| `precompact-guardrail.js` | pre-compact hook (block during active orchestration) | TODO W6 |
| `decision-line-detector.js` | post-tool-use hook on Write (advance active_tasks.md) | TODO W6 |
| `gitnexus/gitnexus-hook.cjs` | pre-tool-use hook on Grep/Glob/Bash (suggest GN) | TODO W6 |
| `pre-audit-evidence-check.py` | pre-tool-use hook on Write/Edit | TODO W6 |
| `post-audit-format-check.py` | post-tool-use hook on Write | TODO W6 |

## Skills (Wave 6)

| Legacy `~/.claude/skills/` | Goose recipe | Status |
|---|---|---|
| `monitoring-setup` | `recipes/monitoring-setup.yaml` | TODO W6 |
| `project-doctor` | `recipes/project-doctor.yaml` | TODO W6 |
| `no-compact` | goose native flag (`/compact` config) | trivial W6 |
| `handoff` | `recipes/handoff.yaml` | TODO W6 |
| `clear` | goose native (`/clear`) | done by upstream |

## Wezbridge MCP tools (Wave 5)

| Legacy wezbridge MCP | Goose-native equivalent | Notes |
|---|---|---|
| `discover_sessions` | `mcp__orchestrator__list_sessions` | built-in `orchestrator` extension |
| `read_output(pane_id, lines)` | `mcp__orchestrator__view_session` | built-in |
| `send_prompt(pane_id, text)` | `mcp__orchestrator__send_message` | built-in |
| `send_key(pane_id, key)` | (no direct equivalent — goose subagents don't expose raw keystrokes) | re-architect: use orchestrator messages instead |
| `spawn_session({cwd, persona})` | `summon` extension or `goose session --recipe X --params cwd=Y` | built-in `summon` |
| `wait_for_idle` | (poll session status via orchestrator) | re-architect |
| `peer_send` (channel push) | `mcp__orchestrator__send_message` | broker pattern unnecessary; orchestrator handles routing |

## Daemons (Wave 4)

| Legacy | Goose-native | Notes |
|---|---|---|
| `omniclaude` (Claude pane polling) | `goosed` daemon + `monitor-active-tasks` scheduled recipe | NSSM Windows service install: `nssm install goosed C:\Users\<user>\.local\bin\goose.exe serve` |
| `tasks-watcher.cjs` | `read_active_tasks` MCP tool (TODO build) OR direct file read in recipes | filesystem watcher logic moves into recipe |
| `telegram-streamer.cjs` | `escalate-telegram` recipe (TODO build) | invoked by monitor recipe |
| Per-project `monitoring.md` frontmatter | `<project>/.goose/project.toml` | see distro-templates/project.toml.example |

## State files

| Legacy | New | Notes |
|---|---|---|
| `<project>/monitoring.md` | `<project>/.goose/project.toml` | TOML over YAML for goose-native parsing |
| `<project>/vault/active_tasks.md` | UNCHANGED — keeps the OmniClaude-owned format | recipes read it directly |
| `vault/_orchestrator-worker/.state.json` | retired | superseded by goose's session DB |
| `vault/_orchestrator/decisions-*.md` | retired | replaced by MM claims (event type) |
| `vault/_escalations/<id>.md` | retired | replaced by escalation recipe + Telegram |

## Provider config

| Legacy | New |
|---|---|
| `~/.claude/settings.json` env block (Anthropic API key, etc.) | goose `~/.config/goose/config.yaml` `GOOSE_PROVIDER` + the `claude-acp` adapter (no API key) |
| Claude Code OAuth (Google) | piggyback via `claude-agent-acp` npm package |

## What stays unchanged

- **MemoryMaster** repo — entire 30k LOC Python codebase preserved as-is. Only addition: `query_for_task` MCP tool (W2.2 done).
- **GitNexus** — already an MCP server (`npx -y gitnexus mcp`). No code changes needed.
- **graphify** — CLI tool that produces files. Recipes read the files directly. No MCP wrapping.
- **`monitoring.md` content** — same frontmatter, just lives at a different path (`.goose/project.toml`). Optional: keep both during transition.
- **`active_tasks.md`** — same format, same location, OmniClaude-style. OmniClaude pattern itself retires; the file lives on as the task-pointer convention.

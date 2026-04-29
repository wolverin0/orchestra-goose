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
| `pretool-guardrail.js` (G01-G07) | `recipes/guardrails.yaml` (Tier-A soft-block — see HOOKS_GAP_ANALYSIS.md) | ✅ done (soft-block) |
| `precompact-guardrail.js` | pre-compact hook (block during active orchestration) | TODO W6 |
| `decision-line-detector.js` | post-tool-use hook on Write (advance active_tasks.md) | TODO W6 |
| `gitnexus/gitnexus-hook.cjs` | pre-tool-use hook on Grep/Glob/Bash (suggest GN) | TODO W6 |
| `pre-audit-evidence-check.py` | pre-tool-use hook on Write/Edit | TODO W6 |
| `post-audit-format-check.py` | post-tool-use hook on Write | TODO W6 |

## Skills (Wave 6)

| Legacy `~/.claude/skills/` | Goose recipe | Status |
|---|---|---|
| `monitoring-setup` | `recipes/monitoring-setup.yaml` | ✅ done |
| `project-doctor` | `recipes/project-doctor.yaml` | ✅ done |
| `no-compact` | goose native flag (`/compact` config) | trivial W6 |
| `handoff` | `recipes/handoff.yaml` | ✅ done |
| `clear` | goose native (`/clear`) | ✅ done by upstream |

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
| `telegram-streamer.cjs` | `recipes/escalate-telegram.yaml` | ✅ done — invoked by monitor recipe |
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

## CRITICAL latency finding (2026-04-29 benchmark)

The lookahead-brief recipe was benchmarked end-to-end on wezbridge:

| Phase | Time |
|---|---|
| Cold (claude-acp + 2 MCP servers spawn + multi-turn LLM) | **57.2s** |
| Warm (subsequent run, MCP cached) | **47.9s** |

**This is 100-1000× slower than the Claude Code L1 hook (50-300ms).** Root causes:
1. Recipe spawns 2 stdio MCP extensions per invoke (memorymaster + gitnexus) — ~10-15s cold each
2. claude-acp adapter spawn — ~12s cold
3. Recipe is multi-turn — model reads file, calls MM, calls GN, reads graphify, composes briefing, THEN answers user task → 4-6 LLM round-trips
4. Each LLM call goes Buenos Aires → US ~200ms RTT + thinking time

**Implications:**
- ❌ Recipe-as-pre-prompt-hook is **NOT viable** for interactive sessions (47s is too slow per turn)
- ✅ Recipe-as-scheduled-job is **fine** (monitor-active-tasks every 30s tolerates 30s+ exec)
- ⚠️ Recipe-as-explicit-orchestration (user runs `/handoff`, `/project-doctor`) is **acceptable**

**Fix paths (Wave 2 follow-up):**
1. **Run goosed in always-on mode** with extensions pre-loaded — saves ~25-30s of MCP spawn cost. NSSM service install (W4.1 done) sets this up.
2. **Use `tom` (Top Of Mind) extension for context injection** — reads `GOOSE_MOIM_MESSAGE_TEXT` env var per turn, no recipe needed. Pre-compute briefing async, drop into env var, model picks it up next prompt. ZERO per-prompt overhead in the agent loop.
3. **Single-turn recipe** — bake all the protocol into one prompt with conditional logic, target ≤2 LLM calls instead of 4-6.

**Recommended (W2/W3 follow-up):** ditch the recipe-as-pre-prompt-hook approach in favor of the `tom` extension + a separate scheduled briefer that pre-computes briefings into the env file. This delivers the look-ahead UX at near-zero per-turn cost.

This is the biggest architectural finding from Wave 0/2 hands-on testing. Update Wave 2 acceptance criteria: targets need to be cold ≤5s (with goosed warm-MCPs), warm ≤500ms (tom-extension path).

---

## What stays unchanged

- **MemoryMaster** repo — entire 30k LOC Python codebase preserved as-is. Only addition: `query_for_task` MCP tool (W2.2 done).
- **GitNexus** — already an MCP server (`npx -y gitnexus mcp`). No code changes needed.
- **graphify** — CLI tool that produces files. Recipes read the files directly. No MCP wrapping.
- **`monitoring.md` content** — same frontmatter, just lives at a different path (`.goose/project.toml`). Optional: keep both during transition.
- **`active_tasks.md`** — same format, same location, OmniClaude-style. OmniClaude pattern itself retires; the file lives on as the task-pointer convention.

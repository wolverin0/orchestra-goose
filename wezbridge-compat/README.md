# wezbridge-compat

> MCP shim that exposes the legacy wezbridge tool surface and routes calls to Goose's `orchestrator` extension via the goosed daemon. Drop-in replacement so existing code (scripts, other projects' MCP configs) keeps working during the orchestra-goose migration.

## Why this exists

Wave 5 of the migration retires the `wezbridge` Node MCP server. But many projects' `.mcp.json` files reference `wezbridge` directly, and changing them all at once is risky. This shim presents the SAME tool names + signatures but routes to goosed under the hood. After Wave 7 dogfood succeeds, projects update their MCP configs to use goose's native `orchestrator` extension and this shim retires.

## Tool surface (matches legacy wezbridge exactly)

| Tool | Legacy wezbridge | Routed to goosed | Fidelity |
|---|---|---|---|
| `discover_sessions` | list panes | `GET /sessions` | full |
| `read_output` | scrollback | `GET /sessions/<id>/transcript` | full |
| `send_prompt` | type + enter | `POST /sessions/<id>/messages` | full |
| `send_key` | raw PTY key | only `enter` / `ctrl+c` mapped | partial — see below |
| `spawn_session` | new pane | `POST /sessions` | full |
| `wait_for_idle` | poll status | poll `GET /sessions/<id>` | full |

## Known fidelity gap: `send_key`

Legacy wezbridge could send arbitrary PTY keystrokes (e.g. `1`, `y`, `tab`). Goose's REST API doesn't expose raw keystrokes — sessions are message-based. The shim maps:

- `enter` → no-op (goose auto-submits on `send_prompt`)
- `ctrl+c` → `POST /sessions/<id>/interrupt`
- anything else → error with clear message

Code that depended on `send_key("1")` to navigate menus inside a TUI agent will need updating to use `send_prompt` with a full text instruction. This is documented in MIGRATION_MAPPING.md.

## Configuration

Routes to `127.0.0.1:3284` by default (goose default per `goose serve --help`). Override with env:

```bash
export GOOSED_URL=http://127.0.0.1:9999
```

## Install (during transition)

```bash
cd wezbridge-compat
npm install
```

Then in any `.mcp.json` that references the old wezbridge:

```json
{
  "mcpServers": {
    "wezbridge": {
      "command": "node",
      "args": ["G:/_OneDrive/OneDrive/Desktop/Py Apps/orchestra-goose/wezbridge-compat/index.cjs"],
      "env": { "GOOSED_URL": "http://127.0.0.1:3284" }
    }
  }
}
```

The `mcpServers.wezbridge` key stays the same so existing tool calls (`mcp__wezbridge__send_prompt`, etc.) still work — they just resolve to this shim.

## Retirement criteria

This shim is REMOVED when:
- All 7 active projects' `.mcp.json` files no longer reference `wezbridge`
- Wave 7 dogfood completes with zero usage of `mcp__wezbridge__*` tools (verify via session log scan)
- The shim has been a no-op for ≥1 week

At that point, delete `wezbridge-compat/` from the fork and the entry from any remaining MCP configs.

## Status — REWRITTEN 2026-04-29 (MCP-to-MCP delegation)

Initial version assumed goosed exposed REST. That was wrong (goosed speaks ACP-over-WebSocket). Probe of `:3284` confirmed only `/health` returns 200.

**Rewrite (current):** the shim is now an MCP-to-MCP translator. It speaks the legacy wezbridge tool names to upstream callers, and delegates to goose's built-in `orchestrator` extension by spawning `goose mcp orchestrator` as a child stdio MCP server.

The orchestrator extension's actual tools (verified by reading `crates/goose/src/agents/platform_extensions/orchestrator.rs` line 572):

- `list_sessions` (filter optional)
- `view_session` (mode: first_last | summarize)
- `start_agent` (working_directory, model_override, etc.)
- `send_message` (session_id, message)
- `interrupt_agent` (session_id)

Mapping table:

| Legacy wezbridge | → orchestrator |
|---|---|
| `discover_sessions(only_claude)` | `list_sessions()` |
| `read_output(pane_id, lines)` | `view_session(session_id, mode='first_last')` |
| `send_prompt(pane_id, text)` | `send_message(session_id, message=text)` |
| `send_key(pane_id, 'enter')` | no-op (orchestrator auto-submits on `send_message`) |
| `send_key(pane_id, 'ctrl+c')` | `interrupt_agent(session_id)` |
| `send_key(pane_id, other)` | error — raw PTY keystrokes not supported |
| `spawn_session(cwd, persona)` | `start_agent(working_directory=cwd, ...)` |
| `wait_for_idle(pane_id, timeout_ms)` | poll `list_sessions` for status='idle' |

Validated empirically: shim starts cleanly, responds to MCP `initialize` request, and successfully spawns `goose mcp orchestrator` as a child. End-to-end tool routing untested until a project actually wires the shim into its `.mcp.json` — first such test will be on wezbridge during Wave 7 dogfood.

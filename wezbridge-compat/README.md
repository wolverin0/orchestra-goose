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

## Status

**Untested at runtime.** Goose REST API endpoint shapes (`/sessions`, `/sessions/<id>/messages`, etc.) are inferred from the goose 1.33.1 README + `goose serve --help`. First real test happens when a project's MCP config is wired through this shim. Expect to discover ≥1 endpoint shape mismatch and patch in a follow-up commit.

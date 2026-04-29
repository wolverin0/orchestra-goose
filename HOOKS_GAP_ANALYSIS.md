# Hooks gap analysis — CC pattern vs Goose

> Context for Wave 6 of the migration. The CC hook system and Goose's mechanisms aren't 1:1 — this doc explains the gap so Wave 6 design isn't a literal port.

## What Claude Code provides

CC's `~/.claude/settings.json` exposes a declarative hook contract:

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [{"type": "command", "command": "python guardrail.py"}]
    }
  ],
  "PostToolUse": [...],
  "UserPromptSubmit": [...],
  "PreCompact": [...],
  "SessionStart": [...],
  "Stop": [...]
}
```

Each hook is an external command that:
- Receives JSON on stdin (tool name, args, session id, cwd)
- Can return JSON on stdout to inject `additionalContext` or modify behavior
- Can return exit code 2 to BLOCK the tool call
- Has a configurable timeout

CC dispatches these synchronously at well-defined lifecycle points.

## What Goose provides

Goose does NOT expose a `hooks:` section in config.yaml today (verified by grepping `crates/` for `hooks:` / `pre_tool` / `post_tool` etc — no matches in the 1.33.1 source).

Goose's interception points are:

| Use case | Goose mechanism |
|---|---|
| Add per-turn context | `tom` (Top Of Mind) extension — reads `GOOSE_MOIM_MESSAGE_TEXT` env var or file each turn |
| Extend system prompt for a session | Recipe `instructions:` field, or `--system <text>` flag on `goose run` |
| Block dangerous tool calls | `developer` extension's confirmation-prompt setting; or wrap in custom MCP extension that validates before delegating |
| Run something at session start | Initial recipe prompt (everything in `prompt:` runs first) |
| Run something at session end | NOT first-class. Workaround: explicit recipe that the user runs at end (handoff.yaml) |
| Recall memory per prompt | `chatrecall` built-in extension OR custom recipe pre-prompt |

## Implication for Wave 6

The legacy CC hooks port to a MIX of goose mechanisms. Below: each legacy hook → its goose equivalent + design effort.

### Memory hooks (Python)

| CC hook | Goose port | Effort |
|---|---|---|
| `memorymaster-recall.py` (UserPromptSubmit) | `lookahead-brief` recipe (already shipped) OR `tom` extension fed by a pre-script | done as recipe |
| `memorymaster-classify.py` | merge into `lookahead-brief` recipe (call `mcp__memorymaster__classify_query` inside it) | small — recipe edit |
| `memorymaster-auto-ingest.py` (Stop hook) | `handoff` recipe (user runs at end) — losing the auto-fire property | ⚠️ **degraded**: no auto-ingest. Could mitigate with a goose plugin that watches stdout. |
| `memorymaster-precompact.py` (PreCompact) | NOT directly portable. Goose handles compaction differently. | needs design |
| `memorymaster-validate-wiki.py` (PostToolUse on Write) | Goose has no PostToolUse equivalent. Workaround: a custom MCP extension that wraps Write and validates. | medium effort |

### Guardrail hooks (JS)

| CC hook | Goose port | Effort |
|---|---|---|
| `pretool-guardrail.js` G01-G07 (sudo/force-push/no-verify) | Add G01-G07 rules to a `goose-defaults.yaml` recipe's `instructions:` field. The model honors them or `developer` extension's confirmation prompt catches them. | ⚠️ **softer guarantee**: prompt-level discipline vs. hard runtime block. Workaround: build a wrapper extension that intercepts `developer.shell` tool calls — bigger lift. |
| `precompact-guardrail.js` | not portable in goose's model | needs design |
| `decision-line-detector.js` (PostToolUse) | Run as a goose `schedule` recipe every N min that scans recent files for the pattern + advances `active_tasks.md` | medium effort |

### Audit hooks (Python)

| CC hook | Goose port | Effort |
|---|---|---|
| `pre-audit-evidence-check.py` | extension wrapper around developer.write | medium |
| `post-audit-format-check.py` | `schedule` recipe that lints recent commits | medium |

### GitNexus hook

| CC hook | Goose port | Effort |
|---|---|---|
| `gitnexus/gitnexus-hook.cjs` (PreToolUse on Grep/Glob/Bash) | Recipe `instructions:` mentions GN's existence; OR build wrapper extension. | small as instructions |

## Recommendation for Wave 6

Three tiers based on porting feasibility:

**Tier A — port as recipe `instructions:`** (~70% of legacy hooks): memory recall, classify, guardrails, GitNexus suggestion, decision-line detection. Lossy but simple. Cost: 1-2 days.

**Tier B — port as scheduled recipe** (~20%): auto-ingest claims, post-audit checks, decision-line auto-advance via filesystem watcher. Different timing semantics but functional. Cost: 2-3 days.

**Tier C — needs custom MCP extension** (~10%): hard runtime blocking of dangerous shells, PostToolUse on every Write, PreCompact intervention. Goose doesn't have a native pattern; we'd build a small Rust extension that wraps `developer.shell` etc. Cost: 1 week.

**Initial Wave 6 strategy: do A + B only.** Defer C. The hard guarantee from G01-G07 hooks downgrades to soft (prompt-level) — but goose's `developer` extension already prompts before destructive shell ops, so the realistic risk delta is small.

Document the tradeoff explicitly in ORCHESTRA_DISTRO.md so users know the legacy hard-block guardrails are now soft-block prompt instructions.

## Action items

- [ ] Build `recipes/guardrails.yaml` — instructions-only recipe enumerating G01-G07 (Tier A)
- [ ] Update `lookahead-brief.yaml` instructions to ALSO mention guardrails (so they apply by default)
- [ ] Document the soft-block downgrade in ORCHESTRA_DISTRO.md
- [ ] Build `recipes/auto-ingest-claims.yaml` for scheduled invocation (Tier B)
- [ ] (Defer) Custom MCP extension for hard tool blocking (Tier C)

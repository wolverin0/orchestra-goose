#!/usr/bin/env node
/**
 * wezbridge-compat — MCP shim that exposes the legacy wezbridge tool
 * surface and routes calls to Goose's built-in `orchestrator` extension
 * via goosed's REST/WS API.
 *
 * Wave 5.5 of the orchestra-goose migration. Lets existing code (other
 * projects' .mcp.json files, automation scripts, peer-pane orchestration
 * recipes) keep calling wezbridge MCP tools unchanged during the
 * transition. Once Wave 7 dogfood completes, remove the wezbridge MCP
 * entry from clients and this shim is no longer needed.
 *
 * Tool surface (MUST match legacy wezbridge MCP exactly):
 *   - discover_sessions(only_claude=true)
 *   - read_output(pane_id, lines=100)
 *   - send_prompt(pane_id, text)
 *   - send_key(pane_id, key)
 *   - spawn_session(cwd, persona?)
 *   - wait_for_idle(pane_id, timeout_ms=30000)
 *
 * Routing:
 *   wezbridge.discover_sessions  -> goosed GET /sessions (or orchestrator extension)
 *   wezbridge.read_output         -> goosed GET /sessions/<id>/transcript
 *   wezbridge.send_prompt         -> goosed POST /sessions/<id>/messages
 *   wezbridge.send_key            -> goosed POST /sessions/<id>/messages (text only — no raw keystrokes in goose)
 *   wezbridge.spawn_session       -> goosed POST /sessions
 *   wezbridge.wait_for_idle       -> poll goosed GET /sessions/<id> until status='idle'
 *
 * GOOSED endpoint:
 *   - Default 127.0.0.1:3284 (per `goose serve --help` 2026-04-29; mm-3457)
 *   - Override via env GOOSED_URL (e.g. http://127.0.0.1:9999)
 *
 * NOTE: send_key has limited fidelity in goose. Goose subagent sessions
 * don't expose raw PTY keystrokes; we map "enter" to "submit current
 * message" semantics, "ctrl+c" to "interrupt session", and reject
 * arbitrary keys with a clear error. This is a deliberate downgrade
 * documented in MIGRATION_MAPPING.md.
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const GOOSED_URL = process.env.GOOSED_URL || "http://127.0.0.1:3284";

const TOOLS = [
  {
    name: "discover_sessions",
    description: "List active goose sessions (legacy wezbridge tool name; routed via goosed orchestrator API).",
    inputSchema: {
      type: "object",
      properties: {
        only_claude: {
          type: "boolean",
          description: "If true, only sessions whose provider is claude-acp/anthropic. Default true.",
          default: true,
        },
      },
    },
  },
  {
    name: "read_output",
    description: "Read scrollback / transcript from an active goose session.",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "Goose session id (legacy: pane_id)." },
        lines: { type: "integer", default: 100 },
      },
      required: ["pane_id"],
    },
  },
  {
    name: "send_prompt",
    description: "Send a prompt text to a session. Equivalent of typing into the pane and pressing enter.",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string" },
        text: { type: "string" },
      },
      required: ["pane_id", "text"],
    },
  },
  {
    name: "send_key",
    description: "Send a control key. Goose limited mapping: 'enter' = submit, 'ctrl+c' = interrupt. Other keys rejected with error (legacy wezbridge supported raw PTY; goose does not).",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string" },
        key: { type: "string", description: "'enter' or 'ctrl+c' only." },
      },
      required: ["pane_id", "key"],
    },
  },
  {
    name: "spawn_session",
    description: "Create a new goose session in the given cwd, optionally with a persona.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        persona: { type: "string", description: "Optional persona name; loads ~/.orchestra-goose/personas/<name>.md if present." },
      },
      required: ["cwd"],
    },
  },
  {
    name: "wait_for_idle",
    description: "Poll a session until it reports idle status, or timeout.",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string" },
        timeout_ms: { type: "integer", default: 30000 },
      },
      required: ["pane_id"],
    },
  },
];

/**
 * Wrap fetch calls to goosed with a consistent error envelope.
 */
async function goosedFetch(path, init) {
  const url = `${GOOSED_URL}${path}`;
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`goosed unreachable at ${url}: ${err.message}. Check that the goosed Windows service is Running.`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`goosed ${init?.method || "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

async function callTool(name, args) {
  switch (name) {
    case "discover_sessions": {
      const onlyClaude = args.only_claude !== false;
      const res = await goosedFetch("/sessions");
      const data = await res.json();
      const sessions = Array.isArray(data) ? data : data.sessions || [];
      const filtered = onlyClaude
        ? sessions.filter((s) => /claude|anthropic/i.test(s.provider || ""))
        : sessions;
      return { sessions: filtered };
    }

    case "read_output": {
      const { pane_id, lines = 100 } = args;
      const res = await goosedFetch(`/sessions/${encodeURIComponent(pane_id)}/transcript?limit=${lines}`);
      const data = await res.json();
      return { pane_id, output: data.transcript || data.output || "", lines };
    }

    case "send_prompt": {
      const { pane_id, text } = args;
      const res = await goosedFetch(`/sessions/${encodeURIComponent(pane_id)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: text }),
      });
      const data = await res.json();
      return { pane_id, message_id: data.id, status: "sent" };
    }

    case "send_key": {
      const { pane_id, key } = args;
      const k = String(key).toLowerCase().trim();
      if (k === "enter") {
        // goose's REST API auto-submits messages on POST, so 'enter' is a no-op idempotent.
        return { pane_id, key, status: "noop (goose auto-submits on send_prompt)" };
      }
      if (k === "ctrl+c") {
        const res = await goosedFetch(`/sessions/${encodeURIComponent(pane_id)}/interrupt`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        return { pane_id, key, status: "interrupted", ...data };
      }
      throw new Error(`send_key: only 'enter' and 'ctrl+c' supported in goose. Legacy wezbridge raw PTY keystrokes are not portable. Got: ${key}`);
    }

    case "spawn_session": {
      const { cwd, persona } = args;
      const res = await goosedFetch("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, persona: persona || "general" }),
      });
      const data = await res.json();
      return { pane_id: data.id || data.session_id, cwd, persona: persona || "general" };
    }

    case "wait_for_idle": {
      const { pane_id, timeout_ms = 30000 } = args;
      const deadline = Date.now() + timeout_ms;
      const interval = 500;
      while (Date.now() < deadline) {
        const res = await goosedFetch(`/sessions/${encodeURIComponent(pane_id)}`);
        const data = await res.json();
        if (data.status === "idle" || data.is_idle === true) {
          return { pane_id, status: "idle", elapsed_ms: timeout_ms - (deadline - Date.now()) };
        }
        await new Promise((r) => setTimeout(r, interval));
      }
      return { pane_id, status: "timeout", timeout_ms };
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

async function main() {
  const server = new Server(
    { name: "wezbridge-compat", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await callTool(name, args || {});
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `wezbridge-compat error: ${err.message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[wezbridge-compat] connected. routing to ${GOOSED_URL}\n`);
}

main().catch((err) => {
  process.stderr.write(`[wezbridge-compat] fatal: ${err.message}\n`);
  process.exit(1);
});

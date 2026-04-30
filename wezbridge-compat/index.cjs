#!/usr/bin/env node
/**
 * wezbridge-compat — MCP-to-MCP translation shim.
 *
 * Speaks the legacy wezbridge tool surface to upstream callers, and
 * delegates to goose's built-in `orchestrator` MCP extension (which
 * goose exposes via `goose mcp orchestrator` as an stdio child).
 *
 * Wave 5.5 of orchestra-goose. Lets existing code (other projects'
 * .mcp.json files) keep calling wezbridge MCP tools unchanged during
 * the transition. Once Wave 7 dogfood completes, projects update
 * their MCP configs to use mcp__orchestrator__* directly and this
 * shim retires.
 *
 * 2026-04-29 rewrite: previous version assumed goosed exposed REST,
 * which is wrong (it's ACP-over-WS). The proper integration is
 * MCP-to-MCP: this shim is itself an MCP server, and it spawns
 * `goose mcp orchestrator` as a child MCP server, then forwards
 * tool calls.
 *
 * Tool mapping:
 *   wezbridge.discover_sessions(only_claude)
 *     -> orchestrator.list_sessions(filter_type)
 *   wezbridge.read_output(pane_id, lines)
 *     -> orchestrator.view_session(session_id, mode='first_last')
 *   wezbridge.send_prompt(pane_id, text)
 *     -> orchestrator.send_message(session_id, message=text)
 *   wezbridge.send_key(pane_id, key)
 *     -> orchestrator.interrupt_agent(session_id) when key='ctrl+c';
 *        no-op when key='enter' (orchestrator auto-submits);
 *        error otherwise.
 *   wezbridge.spawn_session(cwd, persona)
 *     -> orchestrator.start_agent(working_directory=cwd, ...)
 *   wezbridge.wait_for_idle(pane_id, timeout_ms)
 *     -> poll orchestrator.list_sessions, look for status='idle'
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const GOOSE_BIN = process.env.GOOSE_BIN || `${process.env.USERPROFILE}\\.local\\bin\\goose.exe`;

const TOOLS = [
  {
    name: "discover_sessions",
    description: "Legacy wezbridge tool — routed to orchestrator.list_sessions.",
    inputSchema: {
      type: "object",
      properties: {
        only_claude: { type: "boolean", default: true },
      },
    },
  },
  {
    name: "read_output",
    description: "Legacy wezbridge tool — routed to orchestrator.view_session.",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string" },
        lines: { type: "integer", default: 100 },
      },
      required: ["pane_id"],
    },
  },
  {
    name: "send_prompt",
    description: "Legacy wezbridge tool — routed to orchestrator.send_message.",
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
    description: "Legacy wezbridge tool — limited support: 'ctrl+c' interrupts, 'enter' is no-op (orchestrator auto-submits), other keys rejected.",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string" },
        key: { type: "string" },
      },
      required: ["pane_id", "key"],
    },
  },
  {
    name: "spawn_session",
    description: "Legacy wezbridge tool — routed to orchestrator.start_agent.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        persona: { type: "string" },
      },
      required: ["cwd"],
    },
  },
  {
    name: "wait_for_idle",
    description: "Legacy wezbridge tool — polls orchestrator.list_sessions for idle status.",
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

let orchestratorClient = null;

async function ensureOrchestrator() {
  if (orchestratorClient) return orchestratorClient;
  const transport = new StdioClientTransport({
    command: GOOSE_BIN,
    args: ["mcp", "orchestrator"],
  });
  const client = new Client(
    { name: "wezbridge-compat", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  orchestratorClient = client;
  return client;
}

async function callOrch(name, args) {
  const client = await ensureOrchestrator();
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`orchestrator.${name} error: ${JSON.stringify(result.content)}`);
  }
  // result.content is array of TextContent; parse the first as JSON if possible
  const text = (result.content || []).map((c) => c.text || "").join("");
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function callTool(name, args) {
  switch (name) {
    case "discover_sessions": {
      const data = await callOrch("list_sessions", {});
      return data;
    }
    case "read_output": {
      const data = await callOrch("view_session", {
        session_id: args.pane_id,
        mode: "first_last",
      });
      return data;
    }
    case "send_prompt": {
      const data = await callOrch("send_message", {
        session_id: args.pane_id,
        message: args.text,
      });
      return data;
    }
    case "send_key": {
      const k = String(args.key || "").toLowerCase().trim();
      if (k === "enter") {
        return { pane_id: args.pane_id, status: "noop (orchestrator auto-submits)" };
      }
      if (k === "ctrl+c") {
        const data = await callOrch("interrupt_agent", { session_id: args.pane_id });
        return data;
      }
      throw new Error(`send_key: only 'enter' and 'ctrl+c' supported (got: ${args.key})`);
    }
    case "spawn_session": {
      const data = await callOrch("start_agent", {
        working_directory: args.cwd,
        ...(args.persona ? { persona: args.persona } : {}),
      });
      return data;
    }
    case "wait_for_idle": {
      const deadline = Date.now() + (args.timeout_ms || 30000);
      while (Date.now() < deadline) {
        const data = await callOrch("list_sessions", {});
        const session = (data.sessions || []).find((s) => s.id === args.pane_id);
        if (session && (session.status === "idle" || session.is_idle)) {
          return { pane_id: args.pane_id, status: "idle" };
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      return { pane_id: args.pane_id, status: "timeout" };
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

  process.on("SIGTERM", async () => {
    if (orchestratorClient) await orchestratorClient.close().catch(() => {});
    process.exit(0);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[wezbridge-compat] connected. delegating to: ${GOOSE_BIN} mcp orchestrator\n`);
}

main().catch((err) => {
  process.stderr.write(`[wezbridge-compat] fatal: ${err.message}\n`);
  process.exit(1);
});

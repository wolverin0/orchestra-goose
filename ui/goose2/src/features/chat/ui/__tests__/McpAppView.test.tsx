import type { AppRendererProps, RequestHandlerExtra } from "@mcp-ui/client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpAppView } from "../McpAppView";
import type {
  McpAppPayload,
  ToolResponseContent,
} from "@/shared/types/messages";

const mocks = vi.hoisted(() => ({
  appRendererSpy: vi.fn(),
  nestedToolResultSpy: vi.fn(),
  extMethod: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock("@mcp-ui/client", () => ({
  AppRenderer: (props: AppRendererProps) => {
    mocks.appRendererSpy(props);

    return (
      <button
        data-testid="mock-app-renderer"
        onClick={() => {
          void props
            .onCallTool?.(
              {
                name: "get-server-time",
                arguments: { timezone: "America/New_York" },
              },
              {} as RequestHandlerExtra,
            )
            .then((result) => {
              mocks.nestedToolResultSpy(result);
            });
        }}
        type="button"
      >
        call nested tool
      </button>
    );
  },
}));

vi.mock("@/shared/api/acpConnection", () => ({
  getClient: mocks.getClient,
}));

vi.mock("@/shared/api/gooseServeHost", () => ({
  getGooseServeHostInfo: vi.fn().mockResolvedValue({
    httpBaseUrl: "http://127.0.0.1:4242",
    secretKey: "test-secret",
  }),
}));

vi.mock("@/shared/theme/ThemeProvider", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

function createPayload({
  prefersBorder = true,
}: {
  prefersBorder?: boolean;
} = {}): McpAppPayload {
  return {
    sessionId: "local-session",
    gooseSessionId: null,
    toolCallId: "tool-1",
    toolCallTitle: "inspect messaging",
    source: "toolCallUpdateMeta",
    tool: {
      name: "inspect-messaging",
      extensionName: "mcpappbench_local_",
      resourceUri: "ui://inspect-messaging",
    },
    resource: {
      result: {
        contents: [
          {
            uri: "ui://inspect-messaging",
            mimeType: "text/html;profile=mcp-app",
            text: "<div>Messaging Inspector</div>",
            _meta: {
              ui: {
                prefersBorder,
              },
            },
          },
        ],
      },
    },
  };
}

function createToolResponse(): ToolResponseContent {
  return {
    type: "toolResponse",
    id: "tool-1",
    name: "inspect messaging",
    result: "Messaging Inspector loaded.",
    isError: false,
    structuredContent: {
      timestamp: "2026-04-22T18:28:48.287Z",
      joke: "Why do programmers prefer dark mode? Because light attracts bugs!",
    },
  };
}

function getLatestAppRendererProps(): AppRendererProps {
  const props = mocks.appRendererSpy.mock.calls.at(-1)?.[0] as
    | AppRendererProps
    | undefined;

  expect(props).toBeDefined();
  if (!props) {
    throw new Error("Expected AppRenderer props to be recorded");
  }
  return props;
}

describe("McpAppView nested tool calls", () => {
  beforeEach(() => {
    mocks.appRendererSpy.mockClear();
    mocks.nestedToolResultSpy.mockClear();
    mocks.extMethod.mockReset();
    mocks.getClient.mockReset();
    mocks.getClient.mockResolvedValue({
      extMethod: mocks.extMethod,
    });
  });

  it("keeps the original toolResult after nested app tool calls resolve", async () => {
    const nestedToolResult = {
      content: [{ type: "text", text: "2026-04-22T18:29:06.433Z" }],
      isError: false,
      structuredContent: {
        timestamp: "2026-04-22T18:29:06.433Z",
        timezone: "America/New_York",
        unixMs: 1776882546433,
      },
      _meta: {
        source: "nested-tool-call",
      },
    };

    mocks.extMethod.mockResolvedValue(nestedToolResult);

    render(
      <McpAppView
        payload={createPayload()}
        toolInput={{ inspector: "messaging" }}
        toolResponse={createToolResponse()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mock-app-renderer")).toBeInTheDocument();
    });

    const initialToolResult = getLatestAppRendererProps().toolResult;
    expect(initialToolResult).toEqual(
      expect.objectContaining({
        isError: false,
        structuredContent: expect.objectContaining({
          joke: "Why do programmers prefer dark mode? Because light attracts bugs!",
        }),
      }),
    );

    fireEvent.click(screen.getByTestId("mock-app-renderer"));

    await waitFor(() => {
      expect(mocks.extMethod).toHaveBeenCalledWith("_goose/tool/call", {
        sessionId: "local-session",
        name: "mcpappbench_local___get-server-time",
        arguments: { timezone: "America/New_York" },
      });
    });

    await waitFor(() => {
      expect(mocks.nestedToolResultSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          structuredContent: nestedToolResult.structuredContent,
          _meta: nestedToolResult._meta,
        }),
      );
    });

    const latestProps = getLatestAppRendererProps();
    expect(latestProps.toolInput).toEqual({ timezone: "America/New_York" });
    expect(latestProps.toolResult).toBe(initialToolResult);
    expect(latestProps.toolResult).toEqual(
      expect.objectContaining({
        structuredContent: expect.objectContaining({
          joke: "Why do programmers prefer dark mode? Because light attracts bugs!",
        }),
      }),
    );
  });

  it("only applies rounded border chrome when the app prefers a border", async () => {
    const { rerender } = render(
      <McpAppView
        payload={createPayload()}
        toolResponse={createToolResponse()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mock-app-renderer")).toBeInTheDocument();
    });

    const borderedChrome = screen.getByTestId("mcp-app-view")
      .firstElementChild as HTMLElement | null;
    expect(borderedChrome).not.toBeNull();
    expect(borderedChrome?.className).toContain("rounded-xl");
    expect(borderedChrome?.className).toContain("border");

    rerender(
      <McpAppView
        payload={createPayload({ prefersBorder: false })}
        toolResponse={createToolResponse()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mock-app-renderer")).toBeInTheDocument();
    });

    const borderlessChrome = screen.getByTestId("mcp-app-view")
      .firstElementChild as HTMLElement | null;
    expect(borderlessChrome).not.toBeNull();
    expect(borderlessChrome?.className).not.toContain("rounded-xl");
    expect(borderlessChrome?.className).not.toContain("border");
    expect(borderlessChrome?.className).not.toContain("shadow-sm");
    expect(borderlessChrome?.className).not.toContain("overflow-hidden");
  });

  it("does not install a fallback handler for non-standard app requests", async () => {
    render(
      <McpAppView
        payload={createPayload()}
        toolResponse={createToolResponse()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mock-app-renderer")).toBeInTheDocument();
    });

    expect(getLatestAppRendererProps().onFallbackRequest).toBeUndefined();
  });

  it("declares readily available host context fields", async () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 736,
        height: 240,
        top: 0,
        right: 736,
        bottom: 240,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    const matchMediaSpy = vi.fn((query: string) => ({
      matches: query === "(hover: hover)",
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = matchMediaSpy;

    try {
      render(
        <McpAppView
          payload={createPayload()}
          toolResponse={createToolResponse()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("mock-app-renderer")).toBeInTheDocument();
      });

      expect(getLatestAppRendererProps().hostContext).toEqual(
        expect.objectContaining({
          theme: "dark",
          displayMode: "inline",
          availableDisplayModes: ["inline"],
          containerDimensions: {
            width: 736,
            height: 240,
          },
          locale: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          userAgent: expect.stringMatching(/^goose2\//),
          platform: "desktop",
          deviceCapabilities: {
            touch: false,
            hover: true,
          },
          safeAreaInsets: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          },
        }),
      );
    } finally {
      window.matchMedia = originalMatchMedia;
      rectSpy.mockRestore();
    }
  });
});

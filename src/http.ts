import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface HttpServerOptions {
  /** Called once per request; share expensive state (token cache) via closure. */
  createMcpServer: () => McpServer;
  authToken: string;
  path: string;
  maxBodyBytes: number;
  onError?: (error: unknown) => void;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

const rpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

/**
 * Stateless Streamable HTTP endpoint: every POST gets a fresh MCP server and
 * transport, so the process can sit behind a load balancer without sticky sessions.
 */
export function createHttpServer(options: HttpServerOptions): Server {
  const expected = digest(options.authToken);
  const isAuthorized = (req: IncomingMessage) => {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    return match !== null && timingSafeEqual(digest(match[1].trim()), expected);
  };

  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");

    if (pathname === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
      return sendJson(res, 200, { status: "ok" });
    }
    if (pathname !== options.path) {
      return sendJson(res, 404, { error: "not found" });
    }
    if (!isAuthorized(req)) {
      return sendJson(res, 401, rpcError(-32001, "Unauthorized"), {
        "www-authenticate": 'Bearer realm="mmbiz-mcp"',
      });
    }
    if (req.method !== "POST") {
      return sendJson(res, 405, rpcError(-32000, "Method not allowed"), { allow: "POST" });
    }

    const server = options.createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: options.maxBodyBytes,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      options.onError?.(error);
      if (!res.headersSent) sendJson(res, 500, rpcError(-32603, "Internal server error"));
    }
  });
}

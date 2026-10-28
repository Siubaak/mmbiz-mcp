import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { WeChatClient } from "../src/client.js";
import { createHttpServer } from "../src/http.js";
import { createServer } from "../src/server.js";
import { TokenManager } from "../src/token.js";
import { TOKEN_ROUTE, routeFetch } from "./helpers.js";

const AUTH = "test-token-0123456789";
const BASE = "https://api.weixin.qq.com";

let running: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (running ? running.close(() => resolve()) : resolve()));
  running = undefined;
});

async function start(options: { maxBodyBytes?: number; path?: string } = {}) {
  const fake = routeFetch({
    ...TOKEN_ROUTE,
    "/cgi-bin/draft/count": () => ({ total_count: 7 }),
  });
  const tokens = new TokenManager({ appId: "wx", appSecret: "s", baseUrl: BASE, fetch: fake.fetch });
  const wechat = new WeChatClient({ baseUrl: BASE, tokens, fetch: fake.fetch });

  const server = createHttpServer({
    createMcpServer: () => createServer({ client: wechat, media: { allowLocalFiles: false } }),
    authToken: AUTH,
    path: options.path ?? "/mcp",
    maxBodyBytes: options.maxBodyBytes ?? 1024 * 1024,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  running = server;
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return { origin, url: new URL(`${origin}${options.path ?? "/mcp"}`), fake };
}

async function connect(url: URL, token: string | undefined = AUTH) {
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
  const client = new Client({ name: "http-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
};

const postRaw = (url: URL, body: string, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body,
  });

describe("HTTP transport", () => {
  it("serves tools to an authenticated Streamable HTTP client", async () => {
    const { url } = await start();
    const client = await connect(url);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("wechat_create_draft");

    const result = (await client.callTool({ name: "wechat_count_drafts", arguments: {} })) as {
      content: Array<{ text: string }>;
    };
    expect(JSON.parse(result.content[0].text)).toEqual({ total_count: 7 });
    await client.close();
  });

  it("shares the access token cache across requests and clients", async () => {
    const { url, fake } = await start();
    for (let i = 0; i < 2; i++) {
      const client = await connect(url);
      await client.callTool({ name: "wechat_count_drafts", arguments: {} });
      await client.close();
    }
    expect(fake.calls.filter((c) => c.url.pathname === "/cgi-bin/stable_token")).toHaveLength(1);
    expect(fake.calls.filter((c) => c.url.pathname === "/cgi-bin/draft/count")).toHaveLength(2);
  });

  it("rejects requests without a valid bearer token", async () => {
    const { url } = await start();
    const missing = await postRaw(url, JSON.stringify(initialize));
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toMatch(/^Bearer/);

    const wrong = await postRaw(url, JSON.stringify(initialize), { authorization: "Bearer nope" });
    expect(wrong.status).toBe(401);

    await expect(connect(url, "wrong-token-xxxxxxxx")).rejects.toThrow();
  });

  it("accepts a raw initialize request with the right token", async () => {
    const { url } = await start();
    const res = await postRaw(url, JSON.stringify(initialize), { authorization: `Bearer ${AUTH}` });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("mmbiz-mcp");
  });

  it("exposes an unauthenticated health check", async () => {
    const { origin } = await start();
    const res = await fetch(`${origin}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown paths and 405 for unsupported methods", async () => {
    const { origin, url } = await start();
    expect((await fetch(`${origin}/other`)).status).toBe(404);
    const get = await fetch(url, { headers: { authorization: `Bearer ${AUTH}` } });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  it("enforces the request body size limit", async () => {
    const { url } = await start({ maxBodyBytes: 1024 });
    const big = JSON.stringify({ ...initialize, params: { ...initialize.params, padding: "x".repeat(4096) } });
    const res = await postRaw(url, big, { authorization: `Bearer ${AUTH}` });
    expect(res.status).toBe(413);
  });

  it("serves on a custom path", async () => {
    const { url } = await start({ path: "/wechat" });
    const client = await connect(url);
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    await client.close();
  });

  it("refuses local file paths when local access is disabled", async () => {
    const { url } = await start();
    const client = await connect(url);
    const result = (await client.callTool({
      name: "wechat_upload_article_image",
      arguments: { source: "/etc/hosts" },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/不允许读取本地文件/);
    await client.close();
  });
});

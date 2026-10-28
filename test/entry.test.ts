import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "src/index.ts");
const nodeArgs = ["--import", "tsx", entry];

describe("stdio entry point", () => {
  it("serves the tool list over stdio", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: nodeArgs,
      cwd: root,
      env: { PATH: process.env.PATH ?? "", WECHAT_APP_ID: "wx_test", WECHAT_APP_SECRET: "secret" },
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("wechat_create_draft");
      expect(client.getServerVersion()?.name).toBe("mmbiz-mcp");
    } finally {
      await client.close();
    }
  }, 20_000);

  it("exits with a helpful message when credentials are missing", () => {
    const result = spawnSync(process.execPath, nodeArgs, {
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("WECHAT_APP_ID");
  }, 20_000);
});

describe("http entry point", () => {
  const baseEnv = { PATH: process.env.PATH ?? "", WECHAT_APP_ID: "wx_test", WECHAT_APP_SECRET: "secret" };
  const token = "entry-token-0123456789";

  it("starts an HTTP server and reports its url on stderr", async () => {
    const child = spawn(process.execPath, [...nodeArgs, "--http"], {
      cwd: root,
      env: { ...baseEnv, MCP_AUTH_TOKEN: token, MCP_HTTP_PORT: "0" },
    });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
          const match = /listening on (http:\/\/\S+)/.exec(stderr);
          if (match) resolve(match[1]);
        });
        child.on("exit", (code) => reject(new Error(`exited ${code}: ${stderr}`)));
      });
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      const client = new Client({ name: "entry-http", version: "1.0.0" });
      await client.connect(transport);
      expect((await client.listTools()).tools.map((t) => t.name)).toContain("wechat_create_draft");
      await client.close();
    } finally {
      child.kill();
    }
  }, 20_000);

  it("refuses to start without an auth token", () => {
    const result = spawnSync(process.execPath, nodeArgs, {
      cwd: root,
      env: { ...baseEnv, MCP_TRANSPORT: "http" },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MCP_AUTH_TOKEN");
  }, 20_000);
});

import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, loadHttpConfig, resolveTransport } from "../src/config.js";

describe("resolveTransport", () => {
  it("defaults to stdio", () => {
    expect(resolveTransport([], {})).toBe("stdio");
  });

  it("selects http via --http or MCP_TRANSPORT", () => {
    expect(resolveTransport(["--http"], {})).toBe("http");
    expect(resolveTransport([], { MCP_TRANSPORT: "http" })).toBe("http");
    expect(resolveTransport([], { MCP_TRANSPORT: " HTTP " })).toBe("http");
    expect(resolveTransport([], { MCP_TRANSPORT: "stdio" })).toBe("stdio");
  });

  it("rejects unknown transports", () => {
    expect(() => resolveTransport([], { MCP_TRANSPORT: "sse" })).toThrow(/MCP_TRANSPORT/);
  });
});

describe("loadHttpConfig", () => {
  const token = "0123456789abcdef0123";

  it("applies safe defaults", () => {
    expect(loadHttpConfig({ MCP_AUTH_TOKEN: token })).toEqual({
      host: "127.0.0.1",
      port: 3000,
      path: "/mcp",
      authToken: token,
      maxBodyBytes: 20 * 1024 * 1024,
      mediaDir: undefined,
    });
  });

  it("reads overrides", () => {
    const config = loadHttpConfig({
      MCP_AUTH_TOKEN: token,
      MCP_HTTP_HOST: "0.0.0.0",
      MCP_HTTP_PORT: "8080",
      MCP_HTTP_PATH: "/wechat",
      MCP_HTTP_MAX_BODY_MB: "5",
      MCP_MEDIA_DIR: "media",
    });
    expect(config).toMatchObject({ host: "0.0.0.0", port: 8080, path: "/wechat", maxBodyBytes: 5 * 1024 * 1024 });
    expect(config.mediaDir).toBe(path.resolve("media"));
  });

  it("accepts port 0 for an ephemeral port", () => {
    expect(loadHttpConfig({ MCP_AUTH_TOKEN: token, MCP_HTTP_PORT: "0" }).port).toBe(0);
  });

  it("requires a sufficiently long auth token", () => {
    expect(() => loadHttpConfig({})).toThrow(/MCP_AUTH_TOKEN/);
    expect(() => loadHttpConfig({ MCP_AUTH_TOKEN: "short" })).toThrow(/16/);
  });

  it("rejects invalid numbers", () => {
    expect(() => loadHttpConfig({ MCP_AUTH_TOKEN: token, MCP_HTTP_PORT: "abc" })).toThrow(/MCP_HTTP_PORT/);
    expect(() => loadHttpConfig({ MCP_AUTH_TOKEN: token, MCP_HTTP_PORT: "70000" })).toThrow(/MCP_HTTP_PORT/);
    expect(() => loadHttpConfig({ MCP_AUTH_TOKEN: token, MCP_HTTP_MAX_BODY_MB: "-1" })).toThrow(/MCP_HTTP_MAX_BODY_MB/);
  });
});

describe("loadConfig", () => {
  it("reads app id and secret from the environment", () => {
    const config = loadConfig({ WECHAT_APP_ID: "wx123", WECHAT_APP_SECRET: "secret" });
    expect(config).toEqual({
      appId: "wx123",
      appSecret: "secret",
      baseUrl: "https://api.weixin.qq.com",
    });
  });

  it("allows overriding the API base url (e.g. a whitelisted proxy) and strips trailing slashes", () => {
    const config = loadConfig({
      WECHAT_APP_ID: "wx123",
      WECHAT_APP_SECRET: "secret",
      WECHAT_API_BASE_URL: "https://proxy.example.com/wx/",
    });
    expect(config.baseUrl).toBe("https://proxy.example.com/wx");
  });

  it("trims whitespace around values", () => {
    const config = loadConfig({ WECHAT_APP_ID: " wx123 ", WECHAT_APP_SECRET: " secret\n" });
    expect(config.appId).toBe("wx123");
    expect(config.appSecret).toBe("secret");
  });

  it("throws a helpful error when credentials are missing", () => {
    expect(() => loadConfig({})).toThrow(/WECHAT_APP_ID/);
    expect(() => loadConfig({ WECHAT_APP_ID: "wx123" })).toThrow(/WECHAT_APP_SECRET/);
  });
});

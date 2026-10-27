import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

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

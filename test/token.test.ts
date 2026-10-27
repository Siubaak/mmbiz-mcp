import { describe, expect, it } from "vitest";
import { TokenManager } from "../src/token.js";
import { WeChatApiError } from "../src/errors.js";
import { mockFetch } from "./helpers.js";

const baseOptions = { appId: "wx123", appSecret: "secret", baseUrl: "https://api.weixin.qq.com" };

describe("TokenManager", () => {
  it("requests a stable access token with the app credentials", async () => {
    const { fetch, calls } = mockFetch(() => ({ access_token: "T1", expires_in: 7200 }));
    const manager = new TokenManager({ ...baseOptions, fetch });

    await expect(manager.getToken()).resolves.toBe("T1");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.href).toBe("https://api.weixin.qq.com/cgi-bin/stable_token");
    expect(calls[0].body).toEqual({
      grant_type: "client_credential",
      appid: "wx123",
      secret: "secret",
      force_refresh: false,
    });
  });

  it("caches the token until shortly before it expires", async () => {
    let now = 0;
    let n = 0;
    const { fetch, calls } = mockFetch(() => ({ access_token: `T${++n}`, expires_in: 7200 }));
    const manager = new TokenManager({ ...baseOptions, fetch, now: () => now });

    expect(await manager.getToken()).toBe("T1");
    now = 7200_000 - 301_000;
    expect(await manager.getToken()).toBe("T1");
    expect(calls).toHaveLength(1);

    // Within the 5 minute safety margin the token is refreshed.
    now = 7200_000 - 299_000;
    expect(await manager.getToken()).toBe("T2");
    expect(calls).toHaveLength(2);
  });

  it("shares a single in-flight request between concurrent callers", async () => {
    const { fetch, calls } = mockFetch(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { access_token: "T1", expires_in: 7200 };
    });
    const manager = new TokenManager({ ...baseOptions, fetch });

    const tokens = await Promise.all([manager.getToken(), manager.getToken(), manager.getToken()]);
    expect(tokens).toEqual(["T1", "T1", "T1"]);
    expect(calls).toHaveLength(1);
  });

  it("forces a refresh when asked to", async () => {
    let n = 0;
    const { fetch, calls } = mockFetch(() => ({ access_token: `T${++n}`, expires_in: 7200 }));
    const manager = new TokenManager({ ...baseOptions, fetch });

    await manager.getToken();
    expect(await manager.getToken({ forceRefresh: true })).toBe("T2");
    expect((calls[1].body as { force_refresh: boolean }).force_refresh).toBe(true);
  });

  it("raises WeChatApiError when WeChat rejects the credentials", async () => {
    const { fetch } = mockFetch(() => ({ errcode: 40125, errmsg: "invalid appsecret" }));
    const manager = new TokenManager({ ...baseOptions, fetch });

    const error = await manager.getToken().catch((e) => e);
    expect(error).toBeInstanceOf(WeChatApiError);
    expect(error.errcode).toBe(40125);
    expect(error.message).toMatch(/40125/);
  });

  it("does not cache failures", async () => {
    let n = 0;
    const { fetch } = mockFetch(() =>
      ++n === 1 ? { errcode: -1, errmsg: "system error" } : { access_token: "T2", expires_in: 7200 },
    );
    const manager = new TokenManager({ ...baseOptions, fetch });

    await expect(manager.getToken()).rejects.toThrow();
    await expect(manager.getToken()).resolves.toBe("T2");
  });
});

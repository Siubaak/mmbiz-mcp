import { describe, expect, it } from "vitest";
import { WeChatApiError, isTokenInvalidError } from "../src/errors.js";

describe("WeChatApiError", () => {
  it("includes errcode, errmsg and the api path in the message", () => {
    const error = new WeChatApiError(45009, "reach max api daily quota limit", "/cgi-bin/draft/add");
    expect(error.errcode).toBe(45009);
    expect(error.errmsg).toBe("reach max api daily quota limit");
    expect(error.message).toContain("45009");
    expect(error.message).toContain("/cgi-bin/draft/add");
  });

  it("adds a Chinese hint for well-known error codes", () => {
    const error = new WeChatApiError(40164, "invalid ip 1.2.3.4, not in whitelist");
    expect(error.hint).toMatch(/IP 白名单/);
    expect(error.message).toContain(error.hint!);
  });

  it("has no hint for unknown codes", () => {
    expect(new WeChatApiError(99999, "???").hint).toBeUndefined();
  });
});

describe("isTokenInvalidError", () => {
  it.each([40001, 40014, 42001])("treats %i as an invalid token", (code) => {
    expect(isTokenInvalidError(new WeChatApiError(code, "x"))).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isTokenInvalidError(new WeChatApiError(45009, "x"))).toBe(false);
    expect(isTokenInvalidError(new Error("boom"))).toBe(false);
  });
});

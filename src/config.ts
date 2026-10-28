import path from "node:path";

type Env = Record<string, string | undefined>;

export type Transport = "stdio" | "http";

export function resolveTransport(argv: string[] = process.argv.slice(2), env: Env = process.env): Transport {
  if (argv.includes("--http")) return "http";
  const value = env.MCP_TRANSPORT?.trim().toLowerCase();
  if (!value || value === "stdio") return "stdio";
  if (value === "http") return "http";
  throw new Error(`不支持的 MCP_TRANSPORT=${env.MCP_TRANSPORT}，可选值为 stdio 或 http`);
}

export interface HttpConfig {
  host: string;
  port: number;
  path: string;
  authToken: string;
  maxBodyBytes: number;
  /** Local media root; when unset, local file paths are rejected in HTTP mode. */
  mediaDir: string | undefined;
}

const MIN_TOKEN_LENGTH = 16;

export function loadHttpConfig(env: Env = process.env): HttpConfig {
  const authToken = env.MCP_AUTH_TOKEN?.trim();
  if (!authToken) {
    throw new Error("HTTP 模式必须设置环境变量 MCP_AUTH_TOKEN（客户端以 Authorization: Bearer <token> 访问）");
  }
  if (authToken.length < MIN_TOKEN_LENGTH) {
    throw new Error(`MCP_AUTH_TOKEN 长度至少需要 ${MIN_TOKEN_LENGTH} 个字符，可用 openssl rand -hex 32 生成`);
  }

  const portRaw = env.MCP_HTTP_PORT?.trim() || "3000";
  const port = Number(portRaw);
  if (!/^\d+$/.test(portRaw) || port > 65535) {
    throw new Error(`无效的 MCP_HTTP_PORT=${portRaw}`);
  }

  const maxBodyRaw = env.MCP_HTTP_MAX_BODY_MB?.trim() || "20";
  const maxBodyMb = Number(maxBodyRaw);
  if (!Number.isFinite(maxBodyMb) || maxBodyMb <= 0) {
    throw new Error(`无效的 MCP_HTTP_MAX_BODY_MB=${maxBodyRaw}`);
  }

  let httpPath = env.MCP_HTTP_PATH?.trim() || "/mcp";
  if (!httpPath.startsWith("/")) httpPath = `/${httpPath}`;

  const mediaDir = env.MCP_MEDIA_DIR?.trim();
  return {
    host: env.MCP_HTTP_HOST?.trim() || "127.0.0.1",
    port,
    path: httpPath,
    authToken,
    maxBodyBytes: Math.floor(maxBodyMb * 1024 * 1024),
    mediaDir: mediaDir ? path.resolve(mediaDir) : undefined,
  };
}

export interface WeChatConfig {
  appId: string;
  appSecret: string;
  baseUrl: string;
}

export const DEFAULT_BASE_URL = "https://api.weixin.qq.com";

export function loadConfig(env: Env = process.env): WeChatConfig {
  const appId = env.WECHAT_APP_ID?.trim();
  const appSecret = env.WECHAT_APP_SECRET?.trim();
  if (!appId) {
    throw new Error("缺少环境变量 WECHAT_APP_ID（公众号 AppID，可在 公众平台 > 设置与开发 > 基本配置 中获取）");
  }
  if (!appSecret) {
    throw new Error("缺少环境变量 WECHAT_APP_SECRET（公众号 AppSecret，可在 公众平台 > 设置与开发 > 基本配置 中获取）");
  }
  const baseUrl = (env.WECHAT_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { appId, appSecret, baseUrl };
}

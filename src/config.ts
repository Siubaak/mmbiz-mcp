export interface WeChatConfig {
  appId: string;
  appSecret: string;
  baseUrl: string;
}

export const DEFAULT_BASE_URL = "https://api.weixin.qq.com";

export function loadConfig(env: Record<string, string | undefined> = process.env): WeChatConfig {
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

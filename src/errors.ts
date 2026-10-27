const HINTS: Record<number, string> = {
  [-1]: "微信系统繁忙，请稍后重试",
  40001: "access_token 无效或 AppSecret 错误",
  40007: "media_id 无效，请确认素材/草稿存在且属于该公众号",
  40013: "AppID 无效，请检查 WECHAT_APP_ID",
  40125: "AppSecret 无效，请检查 WECHAT_APP_SECRET",
  40164: "调用 IP 不在公众号 IP 白名单中，请在 公众平台 > 设置与开发 > 基本配置 中添加服务器出口 IP",
  41001: "缺少 access_token",
  42001: "access_token 已过期",
  44002: "POST 数据包为空",
  45009: "接口调用已达今日上限",
  45011: "接口调用过于频繁，请稍后重试",
  48001: "公众号未获得该接口权限（如未认证），请检查账号类型与权限",
  53503: "草稿未通过发布检查，请检查内容",
  53504: "需前往公众平台官网使用草稿",
  53505: "请手动保存成功后再发表",
  89503: "此次调用需要管理员确认，请联系管理员",
};

export class WeChatApiError extends Error {
  readonly hint?: string;

  constructor(
    readonly errcode: number,
    readonly errmsg: string,
    readonly api?: string,
  ) {
    const hint = HINTS[errcode];
    const where = api ? ` (${api})` : "";
    super(`WeChat API error ${errcode}: ${errmsg}${where}${hint ? ` — ${hint}` : ""}`);
    this.name = "WeChatApiError";
    this.hint = hint;
  }
}

const TOKEN_INVALID_CODES = new Set([40001, 40014, 42001]);

export function isTokenInvalidError(error: unknown): boolean {
  return error instanceof WeChatApiError && TOKEN_INVALID_CODES.has(error.errcode);
}

/** Throws a WeChatApiError when the response payload carries a non-zero errcode. */
export function assertOk<T>(payload: T, api?: string): T {
  const p = payload as { errcode?: number; errmsg?: string } | null;
  if (p && typeof p.errcode === "number" && p.errcode !== 0) {
    throw new WeChatApiError(p.errcode, p.errmsg ?? "", api);
  }
  return payload;
}

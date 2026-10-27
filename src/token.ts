import { assertOk } from "./errors.js";

export interface TokenManagerOptions {
  appId: string;
  appSecret: string;
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Refresh this long before the token actually expires. */
  refreshMarginMs?: number;
}

interface StableTokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Uses the `stable_token` endpoint so that fetching a token here does not
 * invalidate tokens held by other services sharing the same AppID.
 */
export class TokenManager {
  private token?: string;
  private expiresAt = 0;
  private inflight?: Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly refreshMarginMs: number;

  constructor(private readonly options: TokenManagerOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.refreshMarginMs = options.refreshMarginMs ?? 300_000;
  }

  async getToken({ forceRefresh = false }: { forceRefresh?: boolean } = {}): Promise<string> {
    if (!forceRefresh && this.token && this.now() < this.expiresAt - this.refreshMarginMs) {
      return this.token;
    }
    if (!this.inflight) {
      this.inflight = this.fetchToken(forceRefresh).finally(() => {
        this.inflight = undefined;
      });
    }
    return this.inflight;
  }

  private async fetchToken(forceRefresh: boolean): Promise<string> {
    const api = "/cgi-bin/stable_token";
    const response = await this.fetchImpl(`${this.options.baseUrl}${api}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid: this.options.appId,
        secret: this.options.appSecret,
        force_refresh: forceRefresh,
      }),
    });
    const data = assertOk((await response.json()) as StableTokenResponse, api);
    this.token = data.access_token;
    this.expiresAt = this.now() + data.expires_in * 1000;
    return data.access_token;
  }
}

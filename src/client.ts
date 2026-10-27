import { assertOk, isTokenInvalidError } from "./errors.js";
import type { TokenManager } from "./token.js";

export interface UploadFile {
  data: Uint8Array;
  filename: string;
  contentType: string;
}

/** Article fields accepted by draft/add and draft/update. */
export interface DraftArticle {
  title: string;
  content: string;
  thumb_media_id: string;
  author?: string;
  digest?: string;
  content_source_url?: string;
  need_open_comment?: 0 | 1;
  only_fans_can_comment?: 0 | 1;
  pic_crop_235_1?: string;
  pic_crop_1_1?: string;
}

export interface NewsItem extends Partial<DraftArticle> {
  url?: string;
  thumb_url?: string;
  [key: string]: unknown;
}

export interface PageQuery {
  offset: number;
  count: number;
  noContent?: boolean;
}

export interface DraftPage {
  total_count: number;
  item_count: number;
  item: Array<{ media_id: string; content: { news_item: NewsItem[] }; update_time: number }>;
}

export interface PublishedPage {
  total_count: number;
  item_count: number;
  item: Array<{ article_id: string; content: { news_item: NewsItem[] }; update_time: number }>;
}

export type MaterialType = "image" | "voice" | "video" | "thumb";

export interface MaterialPage {
  total_count: number;
  item_count: number;
  item: Array<{ media_id: string; name?: string; update_time: number; url?: string; [key: string]: unknown }>;
}

export interface MaterialCount {
  voice_count: number;
  video_count: number;
  image_count: number;
  news_count: number;
}

export interface PublishStatus {
  publish_id: string;
  /** 0 成功, 1 发布中, 2 原创失败, 3 常规失败, 4 平台审核不通过, 5 成功后用户删除所有文章, 6 成功后系统封禁所有文章 */
  publish_status: number;
  article_id?: string;
  article_detail?: { count: number; item: Array<{ idx: number; article_url: string }> };
  fail_idx?: number[];
}

export interface WeChatClientOptions {
  baseUrl: string;
  tokens: Pick<TokenManager, "getToken">;
  fetch?: typeof fetch;
}

interface RequestOptions {
  query?: Record<string, string>;
  json?: unknown;
  /** Built fresh for every attempt so retries can resend the body. */
  form?: () => FormData;
}

export class WeChatClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: WeChatClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async request<T>(method: "GET" | "POST", path: string, opts: RequestOptions = {}): Promise<T> {
    try {
      return await this.send<T>(method, path, opts, await this.options.tokens.getToken());
    } catch (error) {
      if (!isTokenInvalidError(error)) throw error;
      return this.send<T>(method, path, opts, await this.options.tokens.getToken({ forceRefresh: true }));
    }
  }

  private async send<T>(method: string, path: string, opts: RequestOptions, token: string): Promise<T> {
    const url = new URL(`${this.options.baseUrl}${path}`);
    url.searchParams.set("access_token", token);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

    const init: RequestInit = { method };
    if (opts.form) {
      init.body = opts.form();
    } else if (opts.json !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(opts.json);
    }

    const response = await this.fetchImpl(url, init);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${path}: ${text.slice(0, 200)}`);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Unexpected non-JSON response from ${path}: ${text.slice(0, 200)}`);
    }
    return assertOk(payload as T, path);
  }

  private static mediaForm(file: UploadFile, extra: Record<string, string> = {}): () => FormData {
    return () => {
      const form = new FormData();
      form.append("media", new Blob([new Uint8Array(file.data)], { type: file.contentType }), file.filename);
      for (const [k, v] of Object.entries(extra)) form.append(k, v);
      return form;
    };
  }

  // ---- drafts -------------------------------------------------------------

  async addDraft(articles: DraftArticle[]): Promise<string> {
    const res = await this.request<{ media_id: string }>("POST", "/cgi-bin/draft/add", { json: { articles } });
    return res.media_id;
  }

  async getDraft(mediaId: string): Promise<NewsItem[]> {
    const res = await this.request<{ news_item: NewsItem[] }>("POST", "/cgi-bin/draft/get", {
      json: { media_id: mediaId },
    });
    return res.news_item;
  }

  async updateDraft(mediaId: string, index: number, article: DraftArticle): Promise<void> {
    await this.request("POST", "/cgi-bin/draft/update", {
      json: { media_id: mediaId, index, articles: article },
    });
  }

  async deleteDraft(mediaId: string): Promise<void> {
    await this.request("POST", "/cgi-bin/draft/delete", { json: { media_id: mediaId } });
  }

  async listDrafts({ offset, count, noContent = false }: PageQuery): Promise<DraftPage> {
    return this.request<DraftPage>("POST", "/cgi-bin/draft/batchget", {
      json: { offset, count, no_content: noContent ? 1 : 0 },
    });
  }

  async countDrafts(): Promise<number> {
    const res = await this.request<{ total_count: number }>("GET", "/cgi-bin/draft/count");
    return res.total_count;
  }

  // ---- images & materials -------------------------------------------------

  /** Uploads an image for use inside article HTML. Returns an mmbiz URL; does not count toward material quota. */
  async uploadContentImage(file: UploadFile): Promise<string> {
    const res = await this.request<{ url: string }>("POST", "/cgi-bin/media/uploadimg", {
      form: WeChatClient.mediaForm(file),
    });
    return res.url;
  }

  async addMaterial(
    type: MaterialType,
    file: UploadFile,
    videoDescription?: { title: string; introduction: string },
  ): Promise<{ media_id: string; url?: string }> {
    const extra: Record<string, string> = videoDescription ? { description: JSON.stringify(videoDescription) } : {};
    const res = await this.request<{ media_id: string; url?: string }>("POST", "/cgi-bin/material/add_material", {
      query: { type },
      form: WeChatClient.mediaForm(file, extra),
    });
    return res.url === undefined ? { media_id: res.media_id } : { media_id: res.media_id, url: res.url };
  }

  async listMaterials({ type, offset, count }: { type: "image" | "voice" | "video" | "news"; offset: number; count: number }): Promise<MaterialPage> {
    return this.request<MaterialPage>("POST", "/cgi-bin/material/batchget_material", {
      json: { type, offset, count },
    });
  }

  async countMaterials(): Promise<MaterialCount> {
    const { voice_count, video_count, image_count, news_count } = await this.request<MaterialCount>(
      "GET",
      "/cgi-bin/material/get_materialcount",
    );
    return { voice_count, video_count, image_count, news_count };
  }

  async deleteMaterial(mediaId: string): Promise<void> {
    await this.request("POST", "/cgi-bin/material/del_material", { json: { media_id: mediaId } });
  }

  // ---- publishing ---------------------------------------------------------

  async submitPublish(mediaId: string): Promise<{ publish_id: string; msg_data_id?: string }> {
    const res = await this.request<{ publish_id: string; msg_data_id?: string }>(
      "POST",
      "/cgi-bin/freepublish/submit",
      { json: { media_id: mediaId } },
    );
    return { publish_id: res.publish_id, msg_data_id: res.msg_data_id };
  }

  async getPublishStatus(publishId: string): Promise<PublishStatus> {
    const res = await this.request<PublishStatus & { errcode?: number; errmsg?: string }>(
      "POST",
      "/cgi-bin/freepublish/get",
      { json: { publish_id: publishId } },
    );
    const { errcode: _c, errmsg: _m, ...status } = res;
    return status;
  }

  async listPublished({ offset, count, noContent = false }: PageQuery): Promise<PublishedPage> {
    return this.request<PublishedPage>("POST", "/cgi-bin/freepublish/batchget", {
      json: { offset, count, no_content: noContent ? 1 : 0 },
    });
  }
}

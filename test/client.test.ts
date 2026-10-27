import { describe, expect, it } from "vitest";
import { WeChatClient } from "../src/client.js";
import { TokenManager } from "../src/token.js";
import { WeChatApiError } from "../src/errors.js";
import { PNG_1X1, TOKEN_ROUTE, routeFetch, type Responder } from "./helpers.js";

const BASE = "https://api.weixin.qq.com";

function setup(routes: Record<string, Responder>) {
  const fake = routeFetch({ ...TOKEN_ROUTE, ...routes });
  const tokens = new TokenManager({ appId: "wx", appSecret: "s", baseUrl: BASE, fetch: fake.fetch });
  const client = new WeChatClient({ baseUrl: BASE, tokens, fetch: fake.fetch });
  const apiCalls = () => fake.calls.filter((c) => c.url.pathname !== "/cgi-bin/stable_token");
  return { client, calls: fake.calls, apiCalls };
}

const image = { data: PNG_1X1, filename: "pixel.png", contentType: "image/png" };

const article = {
  title: "标题",
  content: "<p>正文</p>",
  thumb_media_id: "THUMB",
};

describe("WeChatClient request plumbing", () => {
  it("attaches the access token as a query parameter", async () => {
    const { client, apiCalls } = setup({ "/cgi-bin/draft/count": () => ({ total_count: 3 }) });
    await client.countDrafts();
    expect(apiCalls()[0].url.searchParams.get("access_token")).toBe("TOKEN");
  });

  it("refreshes the token and retries once when WeChat reports it invalid", async () => {
    let tokenN = 0;
    let attempts = 0;
    const { client, calls } = setup({
      "/cgi-bin/stable_token": () => ({ access_token: `T${++tokenN}`, expires_in: 7200 }),
      "/cgi-bin/draft/count": (call) => {
        attempts++;
        return call.url.searchParams.get("access_token") === "T1"
          ? { errcode: 40001, errmsg: "invalid credential" }
          : { total_count: 1 };
      },
    });
    await expect(client.countDrafts()).resolves.toBe(1);
    expect(attempts).toBe(2);
    expect(calls.filter((c) => c.url.pathname === "/cgi-bin/stable_token")).toHaveLength(2);
  });

  it("does not retry more than once", async () => {
    let attempts = 0;
    const { client } = setup({
      "/cgi-bin/draft/count": () => {
        attempts++;
        return { errcode: 42001, errmsg: "access_token expired" };
      },
    });
    await expect(client.countDrafts()).rejects.toBeInstanceOf(WeChatApiError);
    expect(attempts).toBe(2);
  });

  it("does not retry business errors", async () => {
    let attempts = 0;
    const { client } = setup({
      "/cgi-bin/draft/count": () => {
        attempts++;
        return { errcode: 45009, errmsg: "quota" };
      },
    });
    const error = await client.countDrafts().catch((e) => e);
    expect(error.errcode).toBe(45009);
    expect(error.api).toBe("/cgi-bin/draft/count");
    expect(attempts).toBe(1);
  });

  it("parses JSON even when WeChat responds with text/plain", async () => {
    const { client } = setup({
      "/cgi-bin/draft/count": () =>
        new Response(JSON.stringify({ total_count: 9 }), { headers: { "content-type": "text/plain" } }),
    });
    await expect(client.countDrafts()).resolves.toBe(9);
  });

  it("reports HTTP failures", async () => {
    const { client } = setup({
      "/cgi-bin/draft/count": () => new Response("bad gateway", { status: 502 }),
    });
    await expect(client.countDrafts()).rejects.toThrow(/502/);
  });
});

describe("drafts", () => {
  it("adds a draft and returns its media_id", async () => {
    const { client, apiCalls } = setup({ "/cgi-bin/draft/add": () => ({ media_id: "DRAFT1" }) });
    await expect(client.addDraft([article])).resolves.toBe("DRAFT1");
    const [call] = apiCalls();
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ articles: [article] });
  });

  it("gets a draft's articles", async () => {
    const { client, apiCalls } = setup({
      "/cgi-bin/draft/get": () => ({ news_item: [{ ...article, url: "http://mp.weixin.qq.com/s?x" }] }),
    });
    const items = await client.getDraft("DRAFT1");
    expect(items[0].title).toBe("标题");
    expect(apiCalls()[0].body).toEqual({ media_id: "DRAFT1" });
  });

  it("updates one article of a draft", async () => {
    const { client, apiCalls } = setup({ "/cgi-bin/draft/update": () => ({ errcode: 0, errmsg: "ok" }) });
    await client.updateDraft("DRAFT1", 0, article);
    expect(apiCalls()[0].body).toEqual({ media_id: "DRAFT1", index: 0, articles: article });
  });

  it("deletes a draft", async () => {
    const { client, apiCalls } = setup({ "/cgi-bin/draft/delete": () => ({ errcode: 0, errmsg: "ok" }) });
    await client.deleteDraft("DRAFT1");
    expect(apiCalls()[0].body).toEqual({ media_id: "DRAFT1" });
  });

  it("lists drafts with paging", async () => {
    const page = { total_count: 1, item_count: 1, item: [{ media_id: "D", content: { news_item: [] }, update_time: 1 }] };
    const { client, apiCalls } = setup({ "/cgi-bin/draft/batchget": () => page });
    await expect(client.listDrafts({ offset: 0, count: 10, noContent: true })).resolves.toEqual(page);
    expect(apiCalls()[0].body).toEqual({ offset: 0, count: 10, no_content: 1 });
  });

  it("counts drafts via GET", async () => {
    const { client, apiCalls } = setup({ "/cgi-bin/draft/count": () => ({ total_count: 4 }) });
    await expect(client.countDrafts()).resolves.toBe(4);
    expect(apiCalls()[0].method).toBe("GET");
  });
});

describe("images and materials", () => {
  it("uploads an in-article image as multipart `media` and returns its url", async () => {
    const { client, apiCalls } = setup({
      "/cgi-bin/media/uploadimg": () => ({ url: "http://mmbiz.qpic.cn/abc" }),
    });
    await expect(client.uploadContentImage(image)).resolves.toBe("http://mmbiz.qpic.cn/abc");

    const [call] = apiCalls();
    expect(call.method).toBe("POST");
    const form = call.body as FormData;
    const media = form.get("media") as File;
    expect(media.name).toBe("pixel.png");
    expect(media.type).toBe("image/png");
    expect(Buffer.from(await media.arrayBuffer())).toEqual(PNG_1X1);
  });

  it("adds a permanent image material", async () => {
    const { client, apiCalls } = setup({
      "/cgi-bin/material/add_material": () => ({ media_id: "M1", url: "http://mmbiz.qpic.cn/m1" }),
    });
    await expect(client.addMaterial("image", image)).resolves.toEqual({ media_id: "M1", url: "http://mmbiz.qpic.cn/m1" });
    const [call] = apiCalls();
    expect(call.url.searchParams.get("type")).toBe("image");
    expect((call.body as FormData).get("media")).toBeInstanceOf(File);
    expect((call.body as FormData).get("description")).toBeNull();
  });

  it("sends a description for video materials", async () => {
    const { client, apiCalls } = setup({ "/cgi-bin/material/add_material": () => ({ media_id: "V1" }) });
    const video = { data: Buffer.from("x"), filename: "a.mp4", contentType: "video/mp4" };
    await client.addMaterial("video", video, { title: "t", introduction: "i" });
    const form = apiCalls()[0].body as FormData;
    expect(JSON.parse(form.get("description") as string)).toEqual({ title: "t", introduction: "i" });
  });

  it("re-sends the multipart body when retrying after token refresh", async () => {
    let tokenN = 0;
    const seen: Array<File | null> = [];
    const { client } = setup({
      "/cgi-bin/stable_token": () => ({ access_token: `T${++tokenN}`, expires_in: 7200 }),
      "/cgi-bin/media/uploadimg": (call) => {
        seen.push((call.body as FormData).get("media") as File | null);
        return call.url.searchParams.get("access_token") === "T1"
          ? { errcode: 40001, errmsg: "invalid" }
          : { url: "http://mmbiz.qpic.cn/ok" };
      },
    });
    await expect(client.uploadContentImage(image)).resolves.toBe("http://mmbiz.qpic.cn/ok");
    expect(seen).toHaveLength(2);
    expect(seen.every((f) => f instanceof File)).toBe(true);
  });

  it("lists, counts and deletes materials", async () => {
    const { client, apiCalls } = setup({
      "/cgi-bin/material/batchget_material": () => ({ total_count: 0, item_count: 0, item: [] }),
      "/cgi-bin/material/get_materialcount": () => ({ voice_count: 1, video_count: 2, image_count: 3, news_count: 4 }),
      "/cgi-bin/material/del_material": () => ({ errcode: 0, errmsg: "ok" }),
    });
    await client.listMaterials({ type: "image", offset: 5, count: 20 });
    expect(await client.countMaterials()).toEqual({ voice_count: 1, video_count: 2, image_count: 3, news_count: 4 });
    await client.deleteMaterial("M1");

    const [list, count, del] = apiCalls();
    expect(list.body).toEqual({ type: "image", offset: 5, count: 20 });
    expect(count.method).toBe("GET");
    expect(del.body).toEqual({ media_id: "M1" });
  });
});

describe("publishing", () => {
  it("submits a draft for publishing", async () => {
    const { client, apiCalls } = setup({
      "/cgi-bin/freepublish/submit": () => ({ errcode: 0, errmsg: "ok", publish_id: "P1", msg_data_id: "MD1" }),
    });
    await expect(client.submitPublish("DRAFT1")).resolves.toEqual({ publish_id: "P1", msg_data_id: "MD1" });
    expect(apiCalls()[0].body).toEqual({ media_id: "DRAFT1" });
  });

  it("queries publish status", async () => {
    const status = { publish_id: "P1", publish_status: 0, article_id: "A1" };
    const { client, apiCalls } = setup({ "/cgi-bin/freepublish/get": () => status });
    await expect(client.getPublishStatus("P1")).resolves.toEqual(status);
    expect(apiCalls()[0].body).toEqual({ publish_id: "P1" });
  });

  it("lists published articles", async () => {
    const { client, apiCalls } = setup({
      "/cgi-bin/freepublish/batchget": () => ({ total_count: 0, item_count: 0, item: [] }),
    });
    await client.listPublished({ offset: 0, count: 5, noContent: false });
    expect(apiCalls()[0].body).toEqual({ offset: 0, count: 5, no_content: 0 });
  });
});

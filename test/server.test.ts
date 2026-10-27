import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { WeChatClient } from "../src/client.js";
import { createServer } from "../src/server.js";
import { TokenManager } from "../src/token.js";
import { PNG_1X1, TOKEN_ROUTE, routeFetch, type RecordedCall, type Responder } from "./helpers.js";

const BASE = "https://api.weixin.qq.com";
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mmbiz-mcp-server-"));
  await writeFile(path.join(dir, "cover.png"), PNG_1X1);
  await writeFile(path.join(dir, "inline.png"), PNG_1X1);
  await writeFile(path.join(dir, "fake.png"), "not an image");
});

async function setup(routes: Record<string, Responder> = {}) {
  const fake = routeFetch({ ...TOKEN_ROUTE, ...routes });
  const tokens = new TokenManager({ appId: "wx", appSecret: "s", baseUrl: BASE, fetch: fake.fetch });
  const wechat = new WeChatClient({ baseUrl: BASE, tokens, fetch: fake.fetch });
  const server = createServer({ client: wechat, media: { baseDir: dir, fetch: fake.fetch } });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await mcp.connect(clientTransport);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await mcp.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    const text = res.content[0]?.text ?? "";
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    return { isError: res.isError === true, text, data };
  };
  const apiCalls = (pathname: string) => fake.calls.filter((c) => c.url.pathname === pathname);
  return { mcp, call, apiCalls };
}

const mediaFile = (c: RecordedCall) => (c.body as FormData).get("media") as File;

describe("tool catalogue", () => {
  it("exposes the expected tools with descriptions", async () => {
    const { mcp } = await setup();
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "wechat_count_drafts",
        "wechat_count_materials",
        "wechat_create_draft",
        "wechat_delete_draft",
        "wechat_delete_material",
        "wechat_get_draft",
        "wechat_get_publish_status",
        "wechat_list_drafts",
        "wechat_list_materials",
        "wechat_list_published",
        "wechat_publish_draft",
        "wechat_update_draft",
        "wechat_upload_article_image",
        "wechat_upload_image_material",
      ].sort(),
    );
    for (const tool of tools) expect(tool.description, tool.name).toBeTruthy();
  });

  it("marks read-only and destructive tools with annotations", async () => {
    const { mcp } = await setup();
    const { tools } = await mcp.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.wechat_list_drafts.annotations?.readOnlyHint).toBe(true);
    expect(byName.wechat_delete_draft.annotations?.destructiveHint).toBe(true);
    expect(byName.wechat_publish_draft.annotations?.destructiveHint).toBe(true);
  });
});

describe("wechat_upload_article_image", () => {
  it("uploads a local image and returns the mmbiz url", async () => {
    const { call, apiCalls } = await setup({
      "/cgi-bin/media/uploadimg": () => ({ url: "http://mmbiz.qpic.cn/inline" }),
    });
    const res = await call("wechat_upload_article_image", { source: "inline.png" });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ url: "http://mmbiz.qpic.cn/inline" });
    expect(mediaFile(apiCalls("/cgi-bin/media/uploadimg")[0]).name).toBe("inline.png");
  });

  it("returns a tool error for invalid images without calling WeChat", async () => {
    const { call, apiCalls } = await setup({ "/cgi-bin/media/uploadimg": () => ({ url: "x" }) });
    const res = await call("wechat_upload_article_image", { source: "fake.png" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/不是有效的图片/);
    expect(apiCalls("/cgi-bin/media/uploadimg")).toHaveLength(0);
  });
});

describe("wechat_upload_image_material", () => {
  it("adds a permanent image material (default type image)", async () => {
    const { call, apiCalls } = await setup({
      "/cgi-bin/material/add_material": () => ({ media_id: "M1", url: "http://mmbiz.qpic.cn/m1" }),
    });
    const res = await call("wechat_upload_image_material", { source: "cover.png" });
    expect(res.data).toEqual({ media_id: "M1", url: "http://mmbiz.qpic.cn/m1" });
    expect(apiCalls("/cgi-bin/material/add_material")[0].url.searchParams.get("type")).toBe("image");
  });

  it("validates thumb materials as jpg", async () => {
    const { call } = await setup({ "/cgi-bin/material/add_material": () => ({ media_id: "M1" }) });
    const res = await call("wechat_upload_image_material", { source: "cover.png", type: "thumb" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/jpg/);
  });
});

describe("wechat_create_draft", () => {
  const routes = () => {
    let n = 0;
    return {
      "/cgi-bin/media/uploadimg": () => ({ url: `http://mmbiz.qpic.cn/inline${++n}` }),
      "/cgi-bin/material/add_material": () => ({ media_id: "THUMB1", url: "http://mmbiz.qpic.cn/thumb" }),
      "/cgi-bin/draft/add": () => ({ media_id: "DRAFT1" }),
    };
  };

  it("creates a draft from HTML with an existing thumb_media_id", async () => {
    const { call, apiCalls } = await setup(routes());
    const res = await call("wechat_create_draft", {
      articles: [
        {
          title: "Hello",
          content: "<p>hi</p>",
          thumb_media_id: "EXISTING",
          author: "me",
          digest: "sum",
          content_source_url: "https://example.com",
          need_open_comment: true,
          only_fans_can_comment: false,
        },
      ],
    });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ media_id: "DRAFT1", uploaded_images: [] });
    expect(apiCalls("/cgi-bin/draft/add")[0].body).toEqual({
      articles: [
        {
          title: "Hello",
          content: "<p>hi</p>",
          thumb_media_id: "EXISTING",
          author: "me",
          digest: "sum",
          content_source_url: "https://example.com",
          need_open_comment: 1,
          only_fans_can_comment: 0,
        },
      ],
    });
    expect(apiCalls("/cgi-bin/material/add_material")).toHaveLength(0);
  });

  it("renders markdown, uploads inline images and the cover image", async () => {
    const { call, apiCalls } = await setup(routes());
    const res = await call("wechat_create_draft", {
      articles: [
        {
          title: "MD",
          content: "# 标题\n\n![](inline.png)\n\n![](http://mmbiz.qpic.cn/already)",
          content_format: "markdown",
          thumb_image: "cover.png",
        },
      ],
    });
    expect(res.isError).toBe(false);
    expect(res.data.media_id).toBe("DRAFT1");
    expect(res.data.uploaded_images).toEqual([{ source: "inline.png", url: "http://mmbiz.qpic.cn/inline1" }]);
    expect(res.data.thumb_media_ids).toEqual(["THUMB1"]);

    const sent = (apiCalls("/cgi-bin/draft/add")[0].body as any).articles[0];
    expect(sent.thumb_media_id).toBe("THUMB1");
    expect(sent.content).toContain("<h1>标题</h1>");
    expect(sent.content).toContain('src="http://mmbiz.qpic.cn/inline1"');
    expect(sent.content).toContain('src="http://mmbiz.qpic.cn/already"');
    expect(apiCalls("/cgi-bin/media/uploadimg")).toHaveLength(1);
  });

  it("can skip image localisation", async () => {
    const { call, apiCalls } = await setup(routes());
    await call("wechat_create_draft", {
      articles: [{ title: "T", content: '<img src="inline.png">', thumb_media_id: "X", localize_images: false }],
    });
    expect(apiCalls("/cgi-bin/media/uploadimg")).toHaveLength(0);
    expect((apiCalls("/cgi-bin/draft/add")[0].body as any).articles[0].content).toBe('<img src="inline.png">');
  });

  it("supports multi-article drafts", async () => {
    const { call, apiCalls } = await setup(routes());
    await call("wechat_create_draft", {
      articles: [
        { title: "A", content: "a", thumb_media_id: "X" },
        { title: "B", content: "b", thumb_media_id: "Y" },
      ],
    });
    expect((apiCalls("/cgi-bin/draft/add")[0].body as any).articles.map((a: any) => a.title)).toEqual(["A", "B"]);
  });

  it("requires a cover image", async () => {
    const { call, apiCalls } = await setup(routes());
    const res = await call("wechat_create_draft", { articles: [{ title: "T", content: "c" }] });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/thumb_media_id|thumb_image/);
    expect(apiCalls("/cgi-bin/draft/add")).toHaveLength(0);
  });

  it("surfaces WeChat errors with hints", async () => {
    const { call } = await setup({
      "/cgi-bin/draft/add": () => ({ errcode: 40007, errmsg: "invalid media_id" }),
    });
    const res = await call("wechat_create_draft", { articles: [{ title: "T", content: "c", thumb_media_id: "BAD" }] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("40007");
    expect(res.text).toContain("media_id 无效");
  });
});

describe("other draft tools", () => {
  it("updates one article in a draft", async () => {
    const { call, apiCalls } = await setup({ "/cgi-bin/draft/update": () => ({ errcode: 0, errmsg: "ok" }) });
    const res = await call("wechat_update_draft", {
      media_id: "DRAFT1",
      index: 1,
      article: { title: "New", content: "**x**", content_format: "markdown", thumb_media_id: "T" },
    });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ media_id: "DRAFT1", index: 1, uploaded_images: [] });
    const body = apiCalls("/cgi-bin/draft/update")[0].body as any;
    expect(body.media_id).toBe("DRAFT1");
    expect(body.index).toBe(1);
    expect(body.articles.content).toContain("<strong>x</strong>");
  });

  it("gets, lists, counts and deletes drafts", async () => {
    const { call, apiCalls } = await setup({
      "/cgi-bin/draft/get": () => ({ news_item: [{ title: "T", content: "c" }] }),
      "/cgi-bin/draft/batchget": () => ({ total_count: 1, item_count: 1, item: [{ media_id: "D", update_time: 1, content: { news_item: [] } }] }),
      "/cgi-bin/draft/count": () => ({ total_count: 1 }),
      "/cgi-bin/draft/delete": () => ({ errcode: 0, errmsg: "ok" }),
    });

    expect((await call("wechat_get_draft", { media_id: "D" })).data).toEqual({
      media_id: "D",
      news_item: [{ title: "T", content: "c" }],
    });
    expect((await call("wechat_list_drafts", {})).data.total_count).toBe(1);
    expect(apiCalls("/cgi-bin/draft/batchget")[0].body).toEqual({ offset: 0, count: 20, no_content: 1 });
    expect((await call("wechat_count_drafts")).data).toEqual({ total_count: 1 });
    expect((await call("wechat_delete_draft", { media_id: "D" })).data).toEqual({ deleted: "D" });
  });

  it("rejects out-of-range paging before calling WeChat", async () => {
    const { call, apiCalls } = await setup({ "/cgi-bin/draft/batchget": () => ({}) });
    const res = await call("wechat_list_drafts", { count: 50 });
    expect(res.isError).toBe(true);
    expect(apiCalls("/cgi-bin/draft/batchget")).toHaveLength(0);
  });
});

describe("material tools", () => {
  it("lists, counts and deletes materials", async () => {
    const { call, apiCalls } = await setup({
      "/cgi-bin/material/batchget_material": () => ({ total_count: 0, item_count: 0, item: [] }),
      "/cgi-bin/material/get_materialcount": () => ({ voice_count: 0, video_count: 0, image_count: 2, news_count: 0 }),
      "/cgi-bin/material/del_material": () => ({ errcode: 0, errmsg: "ok" }),
    });
    await call("wechat_list_materials", { type: "image", offset: 2, count: 5 });
    expect(apiCalls("/cgi-bin/material/batchget_material")[0].body).toEqual({ type: "image", offset: 2, count: 5 });
    expect((await call("wechat_count_materials")).data.image_count).toBe(2);
    expect((await call("wechat_delete_material", { media_id: "M" })).data).toEqual({ deleted: "M" });
  });
});

describe("publishing tools", () => {
  it("publishes a draft and checks its status", async () => {
    const { call } = await setup({
      "/cgi-bin/freepublish/submit": () => ({ errcode: 0, errmsg: "ok", publish_id: "P1", msg_data_id: "MD" }),
      "/cgi-bin/freepublish/get": () => ({ publish_id: "P1", publish_status: 1 }),
      "/cgi-bin/freepublish/batchget": () => ({ total_count: 0, item_count: 0, item: [] }),
    });
    expect((await call("wechat_publish_draft", { media_id: "D" })).data).toEqual({ publish_id: "P1", msg_data_id: "MD" });
    const status = await call("wechat_get_publish_status", { publish_id: "P1" });
    expect(status.data).toEqual({ publish_id: "P1", publish_status: 1, publish_status_text: "发布中" });
    expect((await call("wechat_list_published", {})).data.total_count).toBe(0);
  });
});

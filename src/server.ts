import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { DraftArticle, WeChatClient } from "./client.js";
import { localizeImages, markdownToHtml } from "./content.js";
import { loadMedia, validateImage, type LoadMediaOptions } from "./media.js";

export interface ServerDeps {
  client: WeChatClient;
  media?: LoadMediaOptions;
}

const PUBLISH_STATUS_TEXT: Record<number, string> = {
  0: "发布成功",
  1: "发布中",
  2: "原创声明失败",
  3: "常规失败",
  4: "平台审核不通过",
  5: "成功后用户删除所有文章",
  6: "成功后系统封禁所有文章",
};

const mediaSourceDescription =
  "图片来源：本地文件路径（相对路径基于 MCP 服务的工作目录）、file:// 、http(s):// 链接，或 data:image/...;base64 URI";

const articleSchema = z.object({
  title: z.string().min(1).describe("文章标题"),
  content: z.string().min(1).describe("文章正文，HTML 或 Markdown（见 content_format）"),
  content_format: z
    .enum(["html", "markdown"])
    .default("html")
    .describe("正文格式，markdown 会先转换为 HTML"),
  thumb_media_id: z.string().optional().describe("封面图的永久素材 media_id；与 thumb_image 二选一"),
  thumb_image: z.string().optional().describe(`封面图${mediaSourceDescription}；会自动上传为永久图片素材`),
  author: z.string().optional().describe("作者"),
  digest: z.string().optional().describe("摘要（单图文时有效，不填则自动截取正文前 54 字）"),
  content_source_url: z.string().optional().describe("“阅读原文”链接"),
  need_open_comment: z.boolean().optional().describe("是否打开评论"),
  only_fans_can_comment: z.boolean().optional().describe("是否仅粉丝可评论"),
  pic_crop_235_1: z.string().optional().describe("封面裁剪为 2.35:1 的坐标，格式 X1_Y1_X2_Y2"),
  pic_crop_1_1: z.string().optional().describe("封面裁剪为 1:1 的坐标，格式 X1_Y1_X2_Y2"),
  localize_images: z
    .boolean()
    .default(true)
    .describe("是否自动把正文中非微信域名的图片上传到微信并替换链接（微信不显示外链图片）"),
});

type ArticleInput = z.infer<typeof articleSchema>;

const pageShape = {
  offset: z.number().int().min(0).default(0).describe("从第几条开始，0 为第一条"),
  count: z.number().int().min(1).max(20).default(20).describe("返回数量，1-20"),
};

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: message }] };
}

function handle<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return ok(await fn(args));
    } catch (error) {
      return fail(error);
    }
  };
}

export function createServer({ client, media = {} }: ServerDeps): McpServer {
  const server = new McpServer({ name: "mmbiz-mcp", version: "0.1.0" });

  const uploadContentImage = async (source: string) => {
    const file = await loadMedia(source, media);
    validateImage(file, "content");
    return client.uploadContentImage(file);
  };

  const uploadImageMaterial = async (source: string, type: "image" | "thumb") => {
    const file = await loadMedia(source, media);
    validateImage(file, type);
    return client.addMaterial(type, file);
  };

  const prepareArticle = async (input: ArticleInput) => {
    if (!input.thumb_media_id && !input.thumb_image) {
      throw new Error(`文章《${input.title}》缺少封面：请提供 thumb_media_id 或 thumb_image`);
    }
    let content = input.content_format === "markdown" ? markdownToHtml(input.content) : input.content;
    let uploaded: Array<{ source: string; url: string }> = [];
    if (input.localize_images) {
      ({ html: content, uploaded } = await localizeImages(content, uploadContentImage));
    }

    let thumbUploaded: string | undefined;
    let thumbMediaId = input.thumb_media_id;
    if (!thumbMediaId) {
      thumbMediaId = thumbUploaded = (await uploadImageMaterial(input.thumb_image!, "image")).media_id;
    }

    const article: DraftArticle = { title: input.title, content, thumb_media_id: thumbMediaId };
    if (input.author !== undefined) article.author = input.author;
    if (input.digest !== undefined) article.digest = input.digest;
    if (input.content_source_url !== undefined) article.content_source_url = input.content_source_url;
    if (input.need_open_comment !== undefined) article.need_open_comment = input.need_open_comment ? 1 : 0;
    if (input.only_fans_can_comment !== undefined) article.only_fans_can_comment = input.only_fans_can_comment ? 1 : 0;
    if (input.pic_crop_235_1 !== undefined) article.pic_crop_235_1 = input.pic_crop_235_1;
    if (input.pic_crop_1_1 !== undefined) article.pic_crop_1_1 = input.pic_crop_1_1;
    return { article, uploaded, thumbUploaded };
  };

  // ---- images -------------------------------------------------------------

  server.registerTool(
    "wechat_upload_article_image",
    {
      title: "上传正文图片",
      description:
        "上传文章正文内使用的图片（仅 jpg/png，≤1MB），返回可直接写入 <img src> 的微信图片 URL。不占用素材库数量限制。",
      inputSchema: { source: z.string().min(1).describe(mediaSourceDescription) },
    },
    handle(async ({ source }) => ({ url: await uploadContentImage(source) })),
  );

  server.registerTool(
    "wechat_upload_image_material",
    {
      title: "上传永久图片素材",
      description:
        "上传永久图片素材到素材库，返回 media_id（可作为草稿封面 thumb_media_id）和 url。type=image 支持 bmp/png/jpeg/jpg/gif（≤10MB）；type=thumb 仅 jpg（≤64KB）。",
      inputSchema: {
        source: z.string().min(1).describe(mediaSourceDescription),
        type: z.enum(["image", "thumb"]).default("image").describe("素材类型"),
      },
    },
    handle(async ({ source, type }) => uploadImageMaterial(source, type)),
  );

  // ---- drafts -------------------------------------------------------------

  server.registerTool(
    "wechat_create_draft",
    {
      title: "新建草稿",
      description:
        "新建图文草稿（可包含多篇文章），返回草稿 media_id。支持 Markdown 正文；默认会把正文中的本地/外链图片自动上传到微信并替换链接；封面可传已有 thumb_media_id 或图片来源 thumb_image。",
      inputSchema: { articles: z.array(articleSchema).min(1).max(8).describe("文章列表，最多 8 篇") },
    },
    handle(async ({ articles }) => {
      const prepared = [];
      for (const input of articles) prepared.push(await prepareArticle(input));
      const mediaId = await client.addDraft(prepared.map((p) => p.article));
      const thumbs = prepared.flatMap((p) => (p.thumbUploaded ? [p.thumbUploaded] : []));
      return {
        media_id: mediaId,
        uploaded_images: prepared.flatMap((p) => p.uploaded),
        ...(thumbs.length ? { thumb_media_ids: thumbs } : {}),
      };
    }),
  );

  server.registerTool(
    "wechat_update_draft",
    {
      title: "修改草稿",
      description: "整体替换草稿中指定位置（index，从 0 开始）的一篇文章。参数与新建草稿中的单篇文章一致。",
      inputSchema: {
        media_id: z.string().min(1).describe("草稿 media_id"),
        index: z.number().int().min(0).default(0).describe("要修改的文章在草稿中的位置，从 0 开始"),
        article: articleSchema,
      },
    },
    handle(async ({ media_id, index, article }) => {
      const prepared = await prepareArticle(article);
      await client.updateDraft(media_id, index, prepared.article);
      return {
        media_id,
        index,
        uploaded_images: prepared.uploaded,
        ...(prepared.thumbUploaded ? { thumb_media_id: prepared.thumbUploaded } : {}),
      };
    }),
  );

  server.registerTool(
    "wechat_get_draft",
    {
      title: "获取草稿",
      description: "获取草稿详情（包含每篇文章的标题、正文、封面、预览链接等）。",
      inputSchema: { media_id: z.string().min(1).describe("草稿 media_id") },
      annotations: { readOnlyHint: true },
    },
    handle(async ({ media_id }) => ({ media_id, news_item: await client.getDraft(media_id) })),
  );

  server.registerTool(
    "wechat_list_drafts",
    {
      title: "草稿列表",
      description: "分页获取草稿列表，按更新时间倒序。默认不返回正文内容以节省篇幅。",
      inputSchema: {
        ...pageShape,
        no_content: z.boolean().default(true).describe("为 true 时不返回文章正文 content 字段"),
      },
      annotations: { readOnlyHint: true },
    },
    handle(async ({ offset, count, no_content }) => client.listDrafts({ offset, count, noContent: no_content })),
  );

  server.registerTool(
    "wechat_count_drafts",
    {
      title: "草稿总数",
      description: "获取草稿总数。",
      annotations: { readOnlyHint: true },
    },
    handle(async () => ({ total_count: await client.countDrafts() })),
  );

  server.registerTool(
    "wechat_delete_draft",
    {
      title: "删除草稿",
      description: "删除指定草稿。此操作不可撤销。",
      inputSchema: { media_id: z.string().min(1).describe("草稿 media_id") },
      annotations: { destructiveHint: true },
    },
    handle(async ({ media_id }) => {
      await client.deleteDraft(media_id);
      return { deleted: media_id };
    }),
  );

  // ---- materials ----------------------------------------------------------

  server.registerTool(
    "wechat_list_materials",
    {
      title: "永久素材列表",
      description: "分页获取永久素材列表。",
      inputSchema: {
        type: z.enum(["image", "voice", "video", "news"]).default("image").describe("素材类型"),
        ...pageShape,
      },
      annotations: { readOnlyHint: true },
    },
    handle(async ({ type, offset, count }) => client.listMaterials({ type, offset, count })),
  );

  server.registerTool(
    "wechat_count_materials",
    {
      title: "永久素材总数",
      description: "获取各类型永久素材的数量。",
      annotations: { readOnlyHint: true },
    },
    handle(async () => client.countMaterials()),
  );

  server.registerTool(
    "wechat_delete_material",
    {
      title: "删除永久素材",
      description: "删除指定永久素材。此操作不可撤销，使用该素材的草稿封面可能失效。",
      inputSchema: { media_id: z.string().min(1).describe("素材 media_id") },
      annotations: { destructiveHint: true },
    },
    handle(async ({ media_id }) => {
      await client.deleteMaterial(media_id);
      return { deleted: media_id };
    }),
  );

  // ---- publishing ---------------------------------------------------------

  server.registerTool(
    "wechat_publish_draft",
    {
      title: "发布草稿",
      description:
        "将草稿提交发布（发布后内容对外可见，且不会推送给粉丝/不占群发次数）。发布是异步的，返回 publish_id，请用 wechat_get_publish_status 查询结果。仅在用户明确要求发布时调用。",
      inputSchema: { media_id: z.string().min(1).describe("要发布的草稿 media_id") },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    handle(async ({ media_id }) => client.submitPublish(media_id)),
  );

  server.registerTool(
    "wechat_get_publish_status",
    {
      title: "查询发布状态",
      description: "根据 publish_id 查询发布状态；成功时返回 article_id 与文章链接。",
      inputSchema: { publish_id: z.string().min(1).describe("发布任务 publish_id") },
      annotations: { readOnlyHint: true },
    },
    handle(async ({ publish_id }) => {
      const status = await client.getPublishStatus(publish_id);
      return { ...status, publish_status_text: PUBLISH_STATUS_TEXT[status.publish_status] ?? "未知状态" };
    }),
  );

  server.registerTool(
    "wechat_list_published",
    {
      title: "已发布文章列表",
      description: "分页获取已成功发布的文章列表。",
      inputSchema: {
        ...pageShape,
        no_content: z.boolean().default(true).describe("为 true 时不返回文章正文 content 字段"),
      },
      annotations: { readOnlyHint: true },
    },
    handle(async ({ offset, count, no_content }) => client.listPublished({ offset, count, noContent: no_content })),
  );

  return server;
}

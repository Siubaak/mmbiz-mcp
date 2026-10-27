import { Marked } from "marked";

const marked = new Marked({ gfm: true, breaks: false, async: false });

export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown) as string;
}

const WECHAT_IMAGE_HOST = /(^|\.)(qpic\.cn|qlogo\.cn)$/i;

/** WeChat only displays images hosted on its own CDN inside articles. */
export function isWeChatImageUrl(src: string): boolean {
  try {
    const { protocol, hostname } = new URL(src);
    return (protocol === "http:" || protocol === "https:") && WECHAT_IMAGE_HOST.test(hostname);
  } catch {
    return false;
  }
}

export interface LocalizeResult {
  html: string;
  uploaded: Array<{ source: string; url: string }>;
}

const IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi;

const decodeAttr = (v: string) =>
  v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const encodeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Uploads every `<img src>` that is not already on WeChat's CDN and rewrites
 * it to the returned mmbiz url.
 */
export async function localizeImages(
  html: string,
  upload: (source: string) => Promise<string>,
): Promise<LocalizeResult> {
  const sources = new Set<string>();
  for (const match of html.matchAll(IMG_SRC)) {
    const src = decodeAttr(match[3]);
    if (src && !isWeChatImageUrl(src)) sources.add(src);
  }

  const mapping = new Map<string, string>();
  const uploaded: LocalizeResult["uploaded"] = [];
  for (const source of sources) {
    try {
      const url = await upload(source);
      mapping.set(source, url);
      uploaded.push({ source, url });
    } catch (error) {
      throw new Error(`上传正文图片 ${source} 失败: ${(error as Error).message}`);
    }
  }

  const rewritten = html.replace(IMG_SRC, (whole, prefix: string, quote: string, raw: string) => {
    const url = mapping.get(decodeAttr(raw));
    return url ? `${prefix}${quote}${encodeAttr(url)}${quote}` : whole;
  });
  return { html: rewritten, uploaded };
}

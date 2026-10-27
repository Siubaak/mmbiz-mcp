import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UploadFile } from "./client.js";

export interface ImageType {
  ext: string;
  mime: string;
}

export function detectImageType(data: Uint8Array): ImageType | undefined {
  const b = data;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { ext: "png", mime: "image/png" };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (b.length >= 6 && String.fromCharCode(...b.subarray(0, 4)) === "GIF8") {
    return { ext: "gif", mime: "image/gif" };
  }
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) {
    return { ext: "bmp", mime: "image/bmp" };
  }
  return undefined;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  mp3: "audio/mpeg",
  amr: "audio/amr",
  wma: "audio/x-ms-wma",
  wav: "audio/wav",
  mp4: "video/mp4",
};

export interface LoadMediaOptions {
  fetch?: typeof fetch;
  /** Base directory for relative local paths. Defaults to the process cwd. */
  baseDir?: string;
}

/**
 * Loads media from a local path, `file://` url, `http(s)://` url or `data:` URI.
 */
export async function loadMedia(source: string, options: LoadMediaOptions = {}): Promise<UploadFile> {
  const trimmed = source.trim();
  if (/^data:/i.test(trimmed)) return fromDataUri(trimmed);
  if (/^https?:\/\//i.test(trimmed)) return fromUrl(trimmed, options.fetch ?? fetch);

  const filePath = /^file:\/\//i.test(trimmed)
    ? fileURLToPath(trimmed)
    : path.resolve(options.baseDir ?? process.cwd(), trimmed);
  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch (error) {
    throw new Error(`无法读取本地文件 ${filePath}: ${(error as Error).message}`);
  }
  return finalize(data, path.basename(filePath));
}

function fromDataUri(uri: string): UploadFile {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(uri);
  if (!match) throw new Error("无效的 data URI");
  const [, mime, isBase64, payload] = match;
  const data = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
  return finalize(data, "image", mime || undefined);
}

async function fromUrl(url: string, fetchImpl: typeof fetch): Promise<UploadFile> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`下载 ${url} 失败: HTTP ${response.status}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  const name = decodeURIComponent(path.posix.basename(new URL(url).pathname)) || "image";
  const headerType = response.headers.get("content-type")?.split(";")[0].trim();
  return finalize(data, name, headerType);
}

function finalize(data: Buffer, name: string, declaredMime?: string): UploadFile {
  const sniffed = detectImageType(data);
  const ext = path.extname(name).slice(1).toLowerCase();
  const filename = ext ? name : `${name}.${sniffed?.ext ?? "bin"}`;
  const contentType = sniffed?.mime ?? MIME_BY_EXT[ext] ?? declaredMime ?? "application/octet-stream";
  return { data, filename, contentType };
}

/** `content`: image inside article HTML; `image`: permanent image material; `thumb`: thumbnail material. */
export type ImagePurpose = "content" | "image" | "thumb";

const RULES: Record<ImagePurpose, { formats: string[]; maxBytes: number; label: string; sizeLabel: string }> = {
  content: { formats: ["jpg", "png"], maxBytes: 1024 * 1024, label: "jpg/png", sizeLabel: "1MB" },
  image: { formats: ["jpg", "png", "gif", "bmp"], maxBytes: 10 * 1024 * 1024, label: "bmp/png/jpeg/jpg/gif", sizeLabel: "10MB" },
  thumb: { formats: ["jpg"], maxBytes: 64 * 1024, label: "jpg", sizeLabel: "64KB" },
};

export function validateImage(file: UploadFile, purpose: ImagePurpose): void {
  const type = detectImageType(file.data);
  if (!type) {
    throw new Error(`${file.filename} 不是有效的图片（仅支持 jpg/png/gif/bmp）`);
  }
  const rule = RULES[purpose];
  if (!rule.formats.includes(type.ext)) {
    throw new Error(`${file.filename} 格式为 ${type.ext}，该用途仅支持 ${rule.label}`);
  }
  if (file.data.byteLength > rule.maxBytes) {
    const kb = Math.ceil(file.data.byteLength / 1024);
    throw new Error(`${file.filename} 大小为 ${kb}KB，超过该用途的 ${rule.sizeLabel} 上限`);
  }
}

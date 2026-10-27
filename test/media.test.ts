import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { detectImageType, loadMedia, validateImage } from "../src/media.js";
import { PNG_1X1, mockFetch } from "./helpers.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.from("GIF89a....", "latin1");
const BMP = Buffer.from("BM........", "latin1");

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mmbiz-mcp-"));
  await writeFile(path.join(dir, "cover.png"), PNG_1X1);
  await writeFile(path.join(dir, "noext"), JPEG);
});

describe("detectImageType", () => {
  it("sniffs common formats from magic bytes", () => {
    expect(detectImageType(PNG_1X1)).toEqual({ ext: "png", mime: "image/png" });
    expect(detectImageType(JPEG)).toEqual({ ext: "jpg", mime: "image/jpeg" });
    expect(detectImageType(GIF)).toEqual({ ext: "gif", mime: "image/gif" });
    expect(detectImageType(BMP)).toEqual({ ext: "bmp", mime: "image/bmp" });
    expect(detectImageType(Buffer.from("hello"))).toBeUndefined();
  });
});

describe("loadMedia", () => {
  it("reads an absolute local path", async () => {
    const file = await loadMedia(path.join(dir, "cover.png"));
    expect(file).toEqual({ data: PNG_1X1, filename: "cover.png", contentType: "image/png" });
  });

  it("resolves relative paths against baseDir and supports file:// urls", async () => {
    expect((await loadMedia("cover.png", { baseDir: dir })).filename).toBe("cover.png");
    expect((await loadMedia(`file://${path.join(dir, "cover.png")}`)).contentType).toBe("image/png");
  });

  it("uses sniffed type and adds an extension when the filename has none", async () => {
    const file = await loadMedia(path.join(dir, "noext"));
    expect(file.contentType).toBe("image/jpeg");
    expect(file.filename).toBe("noext.jpg");
  });

  it("downloads http(s) urls", async () => {
    const { fetch, calls } = mockFetch(() => new Response(PNG_1X1, { headers: { "content-type": "image/png" } }));
    const file = await loadMedia("https://example.com/img/photo.png?x=1", { fetch });
    expect(calls[0].url.href).toBe("https://example.com/img/photo.png?x=1");
    expect(file).toEqual({ data: PNG_1X1, filename: "photo.png", contentType: "image/png" });
  });

  it("gives downloaded files without a usable name a sniffed one", async () => {
    const { fetch } = mockFetch(() => new Response(JPEG));
    const file = await loadMedia("https://example.com/", { fetch });
    expect(file.filename).toBe("image.jpg");
    expect(file.contentType).toBe("image/jpeg");
  });

  it("fails clearly on download errors", async () => {
    const { fetch } = mockFetch(() => new Response("nope", { status: 404 }));
    await expect(loadMedia("https://example.com/a.png", { fetch })).rejects.toThrow(/404/);
  });

  it("decodes base64 data URIs", async () => {
    const file = await loadMedia(`data:image/png;base64,${PNG_1X1.toString("base64")}`);
    expect(file.data).toEqual(PNG_1X1);
    expect(file.contentType).toBe("image/png");
    expect(file.filename).toBe("image.png");
  });

  it("reports missing local files", async () => {
    await expect(loadMedia(path.join(dir, "missing.png"))).rejects.toThrow(/missing\.png/);
  });
});

describe("validateImage", () => {
  const png = { data: PNG_1X1, filename: "a.png", contentType: "image/png" };
  const gif = { data: GIF, filename: "a.gif", contentType: "image/gif" };
  const jpeg = { data: JPEG, filename: "a.jpg", contentType: "image/jpeg" };

  it("allows only jpg/png up to 1MB for in-article images", () => {
    expect(() => validateImage(png, "content")).not.toThrow();
    expect(() => validateImage(gif, "content")).toThrow(/jpg\/png/);
    const big = { ...png, data: Buffer.concat([PNG_1X1, Buffer.alloc(1024 * 1024)]) };
    expect(() => validateImage(big, "content")).toThrow(/1MB/);
  });

  it("allows bmp/png/jpeg/gif up to 10MB for image materials", () => {
    expect(() => validateImage(gif, "image")).not.toThrow();
    const big = { ...png, data: Buffer.concat([PNG_1X1, Buffer.alloc(10 * 1024 * 1024)]) };
    expect(() => validateImage(big, "image")).toThrow(/10MB/);
  });

  it("allows only jpg up to 64KB for thumb materials", () => {
    expect(() => validateImage(jpeg, "thumb")).not.toThrow();
    expect(() => validateImage(png, "thumb")).toThrow(/jpg/);
    const big = { ...jpeg, data: Buffer.concat([JPEG, Buffer.alloc(64 * 1024)]) };
    expect(() => validateImage(big, "thumb")).toThrow(/64KB/);
  });

  it("rejects data that is not a recognised image", () => {
    const fake = { data: Buffer.from("<html>"), filename: "a.png", contentType: "image/png" };
    expect(() => validateImage(fake, "image")).toThrow(/不是有效的图片/);
  });
});

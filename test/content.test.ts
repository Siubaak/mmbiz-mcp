import { describe, expect, it, vi } from "vitest";
import { isWeChatImageUrl, localizeImages, markdownToHtml } from "../src/content.js";

describe("markdownToHtml", () => {
  it("renders GitHub-flavoured markdown", () => {
    const html = markdownToHtml("# 标题\n\n**粗体** 和 [链接](https://example.com)\n\n- a\n- b");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<strong>粗体</strong>");
    expect(html).toContain('<a href="https://example.com">链接</a>');
    expect(html).toContain("<li>a</li>");
  });
});

describe("isWeChatImageUrl", () => {
  it.each([
    "http://mmbiz.qpic.cn/mmbiz_png/abc/0",
    "https://mmbiz.qpic.cn/sz_mmbiz_jpg/abc/0?wx_fmt=jpeg",
    "https://mmbiz.qlogo.cn/mmbiz/abc/0",
  ])("recognises %s", (url) => {
    expect(isWeChatImageUrl(url)).toBe(true);
  });

  it.each(["https://example.com/a.png", "./a.png", "data:image/png;base64,AA==", "https://qpic.cn.evil.com/x"])(
    "rejects %s",
    (url) => {
      expect(isWeChatImageUrl(url)).toBe(false);
    },
  );
});

describe("localizeImages", () => {
  it("uploads non-WeChat images and rewrites their src", async () => {
    const upload = vi.fn(async (src: string) => `http://mmbiz.qpic.cn/${src.length}`);
    const html = [
      '<p><img src="./a.png" alt="a"></p>',
      "<img alt='b' src='https://example.com/b.jpg?x=1&amp;y=2' />",
      '<img src="http://mmbiz.qpic.cn/keep">',
    ].join("");

    const result = await localizeImages(html, upload);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledWith("./a.png");
    expect(upload).toHaveBeenCalledWith("https://example.com/b.jpg?x=1&y=2");
    expect(result.html).toBe(
      [
        '<p><img src="http://mmbiz.qpic.cn/7" alt="a"></p>',
        "<img alt='b' src='http://mmbiz.qpic.cn/33' />",
        '<img src="http://mmbiz.qpic.cn/keep">',
      ].join(""),
    );
    expect(result.uploaded).toEqual([
      { source: "./a.png", url: "http://mmbiz.qpic.cn/7" },
      { source: "https://example.com/b.jpg?x=1&y=2", url: "http://mmbiz.qpic.cn/33" },
    ]);
  });

  it("uploads each distinct source only once", async () => {
    const upload = vi.fn(async () => "http://mmbiz.qpic.cn/same");
    const result = await localizeImages('<img src="a.png"><img src="a.png">', upload);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(result.html).toBe('<img src="http://mmbiz.qpic.cn/same"><img src="http://mmbiz.qpic.cn/same">');
  });

  it("leaves html without images untouched", async () => {
    const upload = vi.fn();
    const result = await localizeImages("<p>hi</p>", upload);
    expect(result).toEqual({ html: "<p>hi</p>", uploaded: [] });
    expect(upload).not.toHaveBeenCalled();
  });

  it("names the failing image when an upload fails", async () => {
    const upload = async () => {
      throw new Error("too big");
    };
    await expect(localizeImages('<img src="huge.png">', upload)).rejects.toThrow(/huge\.png.*too big/);
  });

  it("works on html produced from markdown", async () => {
    const html = markdownToHtml("![cover](images/cover.png)");
    const result = await localizeImages(html, async () => "https://mmbiz.qpic.cn/c");
    expect(result.html).toContain('src="https://mmbiz.qpic.cn/c"');
    expect(result.html).toContain('alt="cover"');
  });
});

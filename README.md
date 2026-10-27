# mmbiz-mcp

微信公众号后台管理的 [MCP](https://modelcontextprotocol.io) 服务。接入 Cursor、Claude Desktop 等支持 MCP 的 agent 后，可以直接让 agent 帮你写稿、上传图片、保存草稿、发布文章。

## 功能

| 工具 | 说明 |
| --- | --- |
| `wechat_create_draft` | 新建草稿（支持多篇、Markdown 正文、正文图片自动上传、封面自动上传） |
| `wechat_update_draft` | 修改草稿中的某一篇文章 |
| `wechat_get_draft` / `wechat_list_drafts` / `wechat_count_drafts` | 查询草稿 |
| `wechat_delete_draft` | 删除草稿 |
| `wechat_upload_article_image` | 上传正文图片（jpg/png ≤1MB），返回可用于 `<img src>` 的微信 URL |
| `wechat_upload_image_material` | 上传永久图片素材，返回 `media_id`（可作封面） |
| `wechat_list_materials` / `wechat_count_materials` / `wechat_delete_material` | 管理永久素材 |
| `wechat_publish_draft` / `wechat_get_publish_status` / `wechat_list_published` | 发布草稿并查询结果 |

几个对 agent 友好的细节：

- **图片来源灵活**：所有图片参数都支持本地路径、`file://`、`http(s)://` 链接和 `data:` URI。
- **正文图片自动转存**：微信不显示外链图片，`wechat_create_draft` / `wechat_update_draft` 默认会把正文里非微信域名的图片上传到微信并替换链接（可用 `localize_images: false` 关闭）。
- **上传前本地校验**：按微信规则检查图片格式与大小，避免浪费接口调用次数。
- **access_token 自动管理**：使用 `stable_token` 接口（不会让其他服务持有的 token 失效），自动缓存、提前刷新，遇到 token 失效自动刷新重试一次。
- **错误可读**：常见错误码附带中文提示（例如 IP 白名单、接口权限、配额）。

## 准备工作

1. 在 [微信公众平台](https://mp.weixin.qq.com) → 设置与开发 → 基本配置 中获取 **AppID** 和 **AppSecret**。
2. 在同一页面把运行本服务的机器的**出口 IP** 加入 **IP 白名单**，否则会返回 `40164`。
3. 草稿与发布接口需要公众号具备相应权限（一般需认证）。

## 安装与配置

运行需要 Node.js ≥ 20（开发与跑测试需要 ≥ 22.12）。

```bash
git clone https://github.com/Siubaak/mmbiz-mcp.git
cd mmbiz-mcp
npm install
npm run build
```

在 MCP 客户端中配置（以 Cursor 的 `~/.cursor/mcp.json` 或 Claude Desktop 的 `claude_desktop_config.json` 为例）：

```json
{
  "mcpServers": {
    "wechat-mp": {
      "command": "node",
      "args": ["/绝对路径/mmbiz-mcp/dist/index.js"],
      "env": {
        "WECHAT_APP_ID": "wx...",
        "WECHAT_APP_SECRET": "..."
      }
    }
  }
}
```

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `WECHAT_APP_ID` | 是 | 公众号 AppID |
| `WECHAT_APP_SECRET` | 是 | 公众号 AppSecret |
| `WECHAT_API_BASE_URL` | 否 | 默认 `https://api.weixin.qq.com`。若本机 IP 不固定，可指向一台已加入白名单的反向代理 |

## 使用示例

对 agent 说：

> 把 `~/blog/posts/mcp-intro.md` 保存为公众号草稿，封面用 `~/blog/images/cover.jpg`，作者写“小明”。

agent 会调用 `wechat_create_draft`：

```json
{
  "articles": [
    {
      "title": "MCP 入门",
      "content": "# MCP 入门\n\n![架构图](/Users/me/blog/images/arch.png)\n\n正文……",
      "content_format": "markdown",
      "thumb_image": "/Users/me/blog/images/cover.jpg",
      "author": "小明"
    }
  ]
}
```

返回草稿的 `media_id`，以及本次自动上传的正文图片和封面素材，之后可在公众平台“草稿箱”中预览和编辑。`wechat_publish_draft` 会让文章公开可见，只建议在明确需要时让 agent 调用。

## 开发

项目按 TDD 开发，所有微信接口在测试中以假的 `fetch` 模拟，MCP 工具通过 SDK 的内存传输端到端测试，另有一个通过 stdio 启动真实子进程的集成测试。

```bash
npm test          # 运行测试
npm run test:watch
npm run typecheck
npm run build
npm run dev       # 用 tsx 直接运行源码
```

目录结构：

```
src/
  config.ts   环境变量读取
  errors.ts   微信错误码与中文提示
  token.ts    stable access_token 缓存与刷新
  client.ts   微信 API 客户端（草稿 / 素材 / 发布）
  media.ts    图片加载（路径 / URL / data URI）与格式大小校验
  content.ts  Markdown 转 HTML、正文图片转存
  server.ts   MCP 工具定义
  index.ts    stdio 入口
test/         与 src 一一对应的测试
```

## License

MIT

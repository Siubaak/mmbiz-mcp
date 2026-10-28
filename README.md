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

支持两种接入方式：

- **stdio（本地）**：MCP 客户端在本机启动进程，可以直接使用本机图片路径。
- **HTTP（远程）**：部署在服务器上，客户端通过 URL + 令牌接入，见下文 [HTTP 接入与服务器部署](#http-接入与服务器部署)。

### stdio 本地接入

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

## HTTP 接入与服务器部署

HTTP 模式使用 MCP 的 Streamable HTTP 传输（无状态，`POST /mcp`），客户端必须携带 `Authorization: Bearer <MCP_AUTH_TOKEN>`。用 `--http` 参数或 `MCP_TRANSPORT=http` 开启。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MCP_TRANSPORT` | `stdio` | 设为 `http` 开启 HTTP 模式（等同于 `--http` 参数） |
| `MCP_AUTH_TOKEN` | 无，必填 | 访问令牌，至少 16 个字符，建议 `openssl rand -hex 32` 生成 |
| `MCP_HTTP_HOST` | `127.0.0.1` | 监听地址；Docker 镜像中为 `0.0.0.0` |
| `MCP_HTTP_PORT` | `3000` | 监听端口 |
| `MCP_HTTP_PATH` | `/mcp` | MCP 接口路径 |
| `MCP_HTTP_MAX_BODY_MB` | `20` | 请求体上限（MB），用 base64 传图时需要足够大 |
| `MCP_MEDIA_DIR` | 无 | 允许读取的服务器本地图片目录 |

另有一个不需要鉴权的健康检查接口：`GET /healthz`。

> **关于图片来源**：HTTP 模式下工具运行在服务器上，读不到你电脑上的文件。默认**禁止读取服务器本地文件**，图片请用 `http(s)` 链接或 `data:image/...;base64` 传入。设置了 `MCP_MEDIA_DIR` 时，只允许读取该目录内的文件（相对路径基于该目录，符号链接也不能逃出该目录）。

### 方式 A：Docker

```bash
git clone https://github.com/Siubaak/mmbiz-mcp.git && cd mmbiz-mcp
cp .env.example .env    # 填入 WECHAT_APP_ID / WECHAT_APP_SECRET / MCP_AUTH_TOKEN
docker compose up -d --build
curl http://127.0.0.1:3000/healthz   # {"status":"ok"}
```

### 方式 B：systemd

```bash
sudo useradd --system --home /opt/mmbiz-mcp mmbiz
sudo git clone https://github.com/Siubaak/mmbiz-mcp.git /opt/mmbiz-mcp
cd /opt/mmbiz-mcp
sudo npm ci && sudo npm run build
sudo cp .env.example .env && sudo chmod 600 .env && sudo chown mmbiz .env   # 编辑 .env 填写配置
sudo cp deploy/mmbiz-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now mmbiz-mcp
journalctl -u mmbiz-mcp -f   # 看到 listening on http://127.0.0.1:3000/mcp 即启动成功
```

### 配置 HTTPS

服务默认只监听 `127.0.0.1`，请在前面用 nginx 或 Caddy 加上 HTTPS 再对外开放，否则令牌会以明文传输。nginx 示例见 [`deploy/nginx.conf`](deploy/nginx.conf)（注意 `client_max_body_size` 要不小于 `MCP_HTTP_MAX_BODY_MB`）。

最后别忘了把**服务器出口 IP**（`curl -s https://ifconfig.me`）加入公众号 IP 白名单。

### 客户端接入

Cursor（`~/.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "wechat-mp": {
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

Claude Code：

```bash
claude mcp add --transport http wechat-mp https://mcp.example.com/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

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

项目按 TDD 开发，所有微信接口在测试中以假的 `fetch` 模拟，MCP 工具通过 SDK 的内存传输端到端测试；HTTP 模式用真实 HTTP 服务 + SDK 的 Streamable HTTP 客户端测试；另有启动真实子进程（stdio 与 HTTP 两种模式）的入口集成测试。

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
  http.ts     Streamable HTTP 服务（鉴权、健康检查、请求体限制）
  index.ts    入口，按配置选择 stdio 或 HTTP
deploy/       systemd 与 nginx 配置示例
test/         与 src 一一对应的测试
```

## License

MIT

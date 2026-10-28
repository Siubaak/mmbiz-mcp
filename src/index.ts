#!/usr/bin/env node
import type { AddressInfo } from "node:net";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WeChatClient } from "./client.js";
import { loadConfig, loadHttpConfig, resolveTransport } from "./config.js";
import { createHttpServer } from "./http.js";
import type { LoadMediaOptions } from "./media.js";
import { createServer } from "./server.js";
import { TokenManager } from "./token.js";

const log = (message: string) => console.error(`[mmbiz-mcp] ${message}`);

async function main() {
  const transport = resolveTransport();
  const config = loadConfig();
  const httpConfig = transport === "http" ? loadHttpConfig() : undefined;

  const tokens = new TokenManager(config);
  const client = new WeChatClient({ baseUrl: config.baseUrl, tokens });

  if (!httpConfig) {
    await createServer({ client }).connect(new StdioServerTransport());
    return;
  }

  const media: LoadMediaOptions = httpConfig.mediaDir
    ? { baseDir: httpConfig.mediaDir, restrictToBaseDir: true }
    : { allowLocalFiles: false };
  const server = createHttpServer({
    createMcpServer: () => createServer({ client, media }),
    authToken: httpConfig.authToken,
    path: httpConfig.path,
    maxBodyBytes: httpConfig.maxBodyBytes,
    onError: (error) => log(`request failed: ${error instanceof Error ? error.stack : error}`),
  });
  server.listen(httpConfig.port, httpConfig.host, () => {
    const { port } = server.address() as AddressInfo;
    log(`listening on http://${httpConfig.host}:${port}${httpConfig.path}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

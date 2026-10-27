#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WeChatClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { TokenManager } from "./token.js";

async function main() {
  const config = loadConfig();
  const tokens = new TokenManager(config);
  const client = new WeChatClient({ baseUrl: config.baseUrl, tokens });
  const server = createServer({ client });
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(`[mmbiz-mcp] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * fleet-mcp entry point.
 *
 *   fleet-mcp                 stdio transport (for Claude Desktop, IDEs, CLIs)
 *   fleet-mcp --http          Streamable HTTP on port 8137
 *   fleet-mcp --http --port N Streamable HTTP on a custom port
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApp } from './http.js';
import { buildServer } from './tools.js';

const DEFAULT_PORT = 8137;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--http')) {
    const portIdx = args.indexOf('--port');
    const port =
      portIdx !== -1 && args[portIdx + 1]
        ? Number(args[portIdx + 1])
        : DEFAULT_PORT;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`Invalid port: ${args[portIdx + 1]}`);
      process.exit(1);
    }
    createApp().listen(port, () => {
      console.error(`fleet-mcp listening on http://localhost:${port}/mcp`);
      console.error('Point any MCP client at that URL (HTTP transport).');
    });
    return;
  }

  // stdio: keep stdout clean for the protocol; log to stderr only.
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error('fleet-mcp running on stdio');
}

main().catch((err) => {
  console.error('fleet-mcp failed to start:', err);
  process.exit(1);
});

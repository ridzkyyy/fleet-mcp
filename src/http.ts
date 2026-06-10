/**
 * Streamable HTTP transport (stateless mode): each POST gets a fresh
 * server+transport pair, which keeps the demo deployable anywhere without
 * session affinity. CORS is open by default so browser MCP clients
 * (e.g. MCP Lab) can connect directly.
 */
import cors from 'cors';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './tools.js';

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(
    cors({
      origin: '*',
      exposedHeaders: ['Mcp-Session-Id'],
      allowedHeaders: ['Content-Type', 'mcp-session-id', 'mcp-protocol-version'],
    }),
  );
  // Chrome Private Network Access: lets HTTPS-hosted MCP clients (e.g. the
  // MCP Lab demo) reach this server on localhost after the user grants the
  // local-network permission.
  app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    next();
  });

  app.post('/mcp', async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_req: express.Request, res: express.Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed in stateless mode' },
      id: null,
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, server: 'fleet-mcp' });
  });

  return app;
}

/**
 * The only app a public tunnel ever reaches: token-gated MCP endpoints and nothing else.
 * Served on 127.0.0.1:MCP_PUBLIC_PORT so /api (file writes, token info, tunnel control) stays local-only.
 */
import { Hono } from 'hono';
import type { AppContext } from '../app-context.js';
import { getMcpServices, mountMcpEndpoints } from '../mcp/mcp-services.js';

export function createPublicMcpApp(ctx: AppContext): Hono {
  const app = new Hono();
  mountMcpEndpoints(app, getMcpServices(ctx));
  app.all('*', (c) => c.json({ error: 'Not found' }, 404));
  return app;
}

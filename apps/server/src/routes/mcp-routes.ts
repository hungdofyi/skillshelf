/**
 * MCP on the local API server + the connect-panel API.
 *  - ALL /mcp/:token and ALL /mcp (Bearer): stateless Streamable HTTP, JSON responses (quick tunnels lack SSE).
 *  - /api/mcp/*: info, tunnel start/stop, token rotation (local only — never reachable through the tunnel,
 *    which points at the MCP-only server in routes/public-mcp-app.ts).
 */
import { Hono } from 'hono';
import type { AppContext } from '../app-context.js';
import { getMcpServices, mountMcpEndpoints } from '../mcp/mcp-services.js';

export function mcpRoutes(ctx: AppContext, opts: { tunnelBinary?: string } = {}): Hono {
  const app = new Hono();
  const mcp = getMcpServices(ctx, opts);
  mountMcpEndpoints(app, mcp);

  app.get('/api/mcp/info', (c) => c.json(mcp.buildInfo()));
  app.post('/api/mcp/tunnel/start', async (c) => {
    await mcp.tunnel.start();
    return c.json(mcp.buildInfo());
  });
  app.post('/api/mcp/tunnel/stop', async (c) => {
    await mcp.tunnel.stop();
    return c.json(mcp.buildInfo());
  });
  app.post('/api/mcp/token/rotate', (c) => {
    try {
      mcp.token.rotate();
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 409);
    }
    ctx.bus.publish({ type: 'mcp', info: mcp.buildInfo() });
    return c.json(mcp.buildInfo());
  });
  return app;
}

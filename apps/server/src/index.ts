/** Server entry: `pnpm --filter @b2s/server dev` (API + MCP HTTP on PORT, default 4317). */
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createAppContext } from './app-context.js';
import { createPublicMcpApp } from './routes/public-mcp-app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const ctx = createAppContext(config);
const app = createApp(ctx);

const server = serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`skillshelf server on http://localhost:${info.port}  (library: ${config.libraryDir})`);
});

// MCP-only listener: the tunnel targets this port, so the public internet never reaches /api.
const publicMcp = serve({ fetch: createPublicMcpApp(ctx).fetch, port: config.publicMcpPort, hostname: '127.0.0.1' });

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: shutting down`);
  await ctx.shutdown();
  publicMcp.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));

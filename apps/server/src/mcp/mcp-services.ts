/**
 * MCP services shared by the local API server (port PORT) and the public MCP-only server
 * (port MCP_PUBLIC_PORT, the one the tunnel exposes). One instance per AppContext so the
 * token, search index and tunnel are the same object on both servers.
 */
import path from 'node:path';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { McpInfo } from '@b2s/shared';
import type { AppContext } from '../app-context.js';
import { MCP_TOOL_SUMMARY, createBookSkillsMcpServer } from './create-book-skills-mcp-server.js';
import { McpToken } from './mcp-token.js';
import { SearchIndex } from './search-index.js';
import { TunnelManager } from './tunnel-manager.js';

export interface McpServices {
  token: McpToken;
  tunnel: TunnelManager;
  buildInfo(): McpInfo;
  /** Handle one Streamable HTTP request (caller has already checked the token). */
  handle(req: Request): Promise<Response>;
  /** Token from `/mcp/:token` or `Authorization: Bearer`, or undefined. */
  tokenFrom(req: Request, pathToken?: string): string | undefined;
}

const cache = new WeakMap<AppContext, McpServices>();

export function getMcpServices(ctx: AppContext, opts: { tunnelBinary?: string } = {}): McpServices {
  const existing = cache.get(ctx);
  if (existing) return existing;
  const { config } = ctx;
  const token = new McpToken(config.dataDir, config.mcpToken);
  const searchIndex = new SearchIndex(ctx.books, ctx.skills, config.libraryDir, config.publicWebUrl);
  const tunnel = new TunnelManager({
    provider: config.tunnel.provider,
    ngrokDomain: config.tunnel.ngrokDomain,
    // The tunnel only ever reaches the MCP-only server, never the full API.
    port: config.publicMcpPort,
    binary: opts.tunnelBinary ?? (process.env.TUNNEL_BIN || undefined),
    onChange: () => ctx.bus.publish({ type: 'mcp', info: services.buildInfo() }),
  });
  ctx.onShutdown(async () => {
    await tunnel.stop();
  });

  const services: McpServices = {
    token,
    tunnel,
    buildInfo() {
      const t = tunnel.snapshot;
      const entry = path.join(config.repoRoot, 'apps/server/src/mcp/mcp-stdio-entry.ts');
      const tsx = path.join(config.repoRoot, 'apps/server/node_modules/.bin/tsx');
      return {
        localUrl: `http://localhost:${config.port}/mcp/${token.current}`,
        // Ends in /mcp: ChatGPT's form expects the URL to include the /mcp path; Claude.ai accepts any URL.
        publicUrl: t.publicBaseUrl ? `${t.publicBaseUrl}/${token.current}/mcp` : undefined,
        tunnel: { status: t.status, error: t.error, pid: t.pid },
        tokenPreview: token.preview,
        claudeCodeCommand: `claude mcp add --scope user skillshelf -- ${tsx} ${entry}`,
        tools: MCP_TOOL_SUMMARY,
      };
    },
    async handle(req) {
      if (req.method !== 'POST') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }), {
          status: 405,
          headers: { 'content-type': 'application/json', allow: 'POST' },
        });
      }
      // Stateless: a fresh server + transport per request, so no session state to leak or expire.
      const server = createBookSkillsMcpServer({ books: ctx.books, skills: ctx.skills, searchIndex });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      try {
        return await transport.handleRequest(req);
      } finally {
        await server.close().catch(() => undefined);
      }
    },
    tokenFrom(req, pathToken) {
      if (pathToken) return pathToken;
      const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
      return m?.[1]?.trim();
    },
  };
  cache.set(ctx, services);
  return services;
}

/** Mount the token-gated MCP endpoints: /mcp/<token>, /<token>/mcp, or /mcp + Bearer. Wrong/missing token → 404 (a 401 would trigger OAuth discovery in Claude.ai). */
export function mountMcpEndpoints(app: import('hono').Hono, mcp: McpServices): void {
  const notFound = () => new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  app.all('/mcp/:token', (c) => (mcp.token.matches(mcp.tokenFrom(c.req.raw, c.req.param('token'))) ? mcp.handle(c.req.raw) : notFound()));
  app.all('/:token/mcp', (c) => (mcp.token.matches(mcp.tokenFrom(c.req.raw, c.req.param('token'))) ? mcp.handle(c.req.raw) : notFound()));
  app.all('/mcp', (c) => (mcp.token.matches(mcp.tokenFrom(c.req.raw)) ? mcp.handle(c.req.raw) : notFound()));
}

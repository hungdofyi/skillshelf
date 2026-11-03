/** Shown in place of the access token wherever an MCP URL is displayed. */
export const MASKED_TOKEN = '••••••••';

/**
 * Hides the access token inside an MCP URL for display. The token is a path segment: `/mcp/<token>`
 * on the local URL and `/<token>/mcp` on the public tunnel URL. Copy buttons still copy the real URL,
 * so setup keeps working while the token never appears on screen (screenshots, screen shares, demos).
 */
export function maskMcpUrl(url: string): string {
  return url
    .replace(/\/mcp\/[^/?#]+/, `/mcp/${MASKED_TOKEN}`)
    .replace(/\/[^/?#]+\/mcp(?=$|[?#])/, `/${MASKED_TOKEN}/mcp`);
}

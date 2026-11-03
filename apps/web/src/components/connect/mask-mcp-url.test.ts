import { describe, expect, it } from 'vitest';
import { MASKED_TOKEN, maskMcpUrl } from './mask-mcp-url';

describe('maskMcpUrl', () => {
  it('hides the token on the local URL (/mcp/<token>)', () => {
    expect(maskMcpUrl('http://localhost:4317/mcp/abc123secret')).toBe(`http://localhost:4317/mcp/${MASKED_TOKEN}`);
  });

  it('hides the token on the public tunnel URL (/<token>/mcp)', () => {
    expect(maskMcpUrl('https://quiet-river.trycloudflare.com/abc123secret/mcp')).toBe(`https://quiet-river.trycloudflare.com/${MASKED_TOKEN}/mcp`);
  });

  it('leaves the host alone and never shows the token', () => {
    const shown = maskMcpUrl('https://quiet-river.trycloudflare.com/abc123secret/mcp');
    expect(shown).toContain('quiet-river.trycloudflare.com');
    expect(shown).not.toContain('abc123secret');
  });

  it('returns URLs without a token unchanged', () => {
    expect(maskMcpUrl('http://localhost:4317/health')).toBe('http://localhost:4317/health');
  });
});

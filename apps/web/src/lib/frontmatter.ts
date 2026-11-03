import { parse } from 'yaml';

export interface ParsedMarkdown {
  data: Record<string, unknown> | null;
  body: string;
  error?: string;
}

const FM = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Split YAML frontmatter from a Markdown document (display only; the server owns the canonical parser). */
export function parseFrontmatter(text: string): ParsedMarkdown {
  const m = FM.exec(text);
  if (!m) return { data: null, body: text };
  const body = text.slice(m[0].length);
  try {
    const data = parse(m[1] ?? '') as unknown;
    if (data && typeof data === 'object' && !Array.isArray(data)) return { data: data as Record<string, unknown>, body };
    return { data: null, body, error: 'Frontmatter is not a key/value mapping' };
  } catch (e) {
    return { data: null, body, error: e instanceof Error ? e.message.split('\n')[0] : 'Invalid YAML' };
  }
}

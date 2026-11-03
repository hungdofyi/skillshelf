/** Split "---\n<yaml>\n---\n<body>" Markdown into parsed YAML data + body. */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface ParsedMarkdown<T = Record<string, unknown>> {
  data: T;
  body: string;
  /** Present when the frontmatter block exists but is not valid YAML. */
  error?: string;
  hasFrontmatter: boolean;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter<T = Record<string, unknown>>(text: string): ParsedMarkdown<T> {
  const match = FRONTMATTER.exec(text);
  if (!match) return { data: {} as T, body: text, hasFrontmatter: false };
  const body = text.slice(match[0].length);
  try {
    const data = (parseYaml(match[1] ?? '') ?? {}) as T;
    if (typeof data !== 'object' || Array.isArray(data)) return { data: {} as T, body, hasFrontmatter: true, error: 'Frontmatter is not a YAML mapping' };
    return { data, body, hasFrontmatter: true };
  } catch (err) {
    return { data: {} as T, body, hasFrontmatter: true, error: err instanceof Error ? err.message : String(err) };
  }
}

export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(data).trimEnd()}\n---\n\n${body.replace(/^\n+/, '')}`;
}

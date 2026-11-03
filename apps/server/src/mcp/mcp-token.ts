/**
 * Secret path token that gates the public MCP endpoint. Claude.ai and ChatGPT can only reach an
 * authless server, so the unguessable token in the URL is the access control.
 * Source: MCP_TOKEN env (fixed) or <dataDir>/mcp-token (generated once, mode 0600).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MIN_FIXED_TOKEN_LENGTH = 24;

export class McpToken {
  private value: string;
  private readonly file: string;
  private readonly fixed: boolean;

  constructor(dataDir: string, fixedToken?: string) {
    this.file = path.join(dataDir, 'mcp-token');
    // The token is the only access control on the public tunnel, so a short one is not accepted.
    if (fixedToken && fixedToken.length < MIN_FIXED_TOKEN_LENGTH) {
      console.warn(`MCP_TOKEN is shorter than ${MIN_FIXED_TOKEN_LENGTH} characters and was ignored; using a generated token instead.`);
      fixedToken = undefined;
    }
    this.fixed = Boolean(fixedToken);
    this.value = fixedToken || this.loadOrCreate();
  }

  get current(): string {
    return this.value;
  }

  /** First 4 chars + ellipsis; enough to recognise the token without exposing it. */
  get preview(): string {
    return `${this.value.slice(0, 4)}…`;
  }

  /** True when env pins the token; rotating would be overwritten on restart, so it is refused. */
  get isFixed(): boolean {
    return this.fixed;
  }

  /** Constant-time comparison (length differences leak only the length, never content). */
  matches(candidate: string | undefined | null): boolean {
    if (!candidate) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.value);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  rotate(): string {
    if (this.fixed) throw new Error('MCP_TOKEN is set in the environment; unset it to rotate from the UI');
    this.value = this.generate();
    this.persist();
    return this.value;
  }

  private loadOrCreate(): string {
    if (existsSync(this.file)) {
      const existing = readFileSync(this.file, 'utf8').trim();
      if (existing.length >= 16) return existing;
    }
    const token = this.generate();
    this.value = token;
    this.persist();
    return token;
  }

  private generate(): string {
    return randomBytes(32).toString('base64url');
  }

  private persist(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${this.value}\n`, { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }
}

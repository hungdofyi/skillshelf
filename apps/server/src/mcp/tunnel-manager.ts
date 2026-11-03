/**
 * Runs one public tunnel (cloudflared quick tunnel or ngrok) in front of the local server so Claude.ai
 * and ChatGPT can reach the MCP endpoint. Parses the public URL from the tool's output.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { McpInfo } from '@b2s/shared';

export interface TunnelOptions {
  provider: 'cloudflared' | 'ngrok';
  ngrokDomain?: string;
  /** Local port to expose. */
  port: number;
  /** Override the binary (tests use a fake script). */
  binary?: string;
  /** How long to wait for the public URL before giving up. */
  startTimeoutMs?: number;
  onChange?: () => void;
}

export interface TunnelState {
  status: McpInfo['tunnel']['status'];
  error?: string;
  pid?: number;
  publicBaseUrl?: string;
}

// `api.trycloudflare.com` is cloudflared's own API host, mentioned in its error lines; never a tunnel URL.
const CLOUDFLARED_URL = /https:\/\/(?!api\.trycloudflare\.com)[a-z0-9-]+\.trycloudflare\.com/i;
const INSTALL_HINT: Record<TunnelOptions['provider'], string> = {
  cloudflared: 'cloudflared not found. Install it with: brew install cloudflared',
  ngrok: 'ngrok not found. Install it with: brew install ngrok (then run: ngrok config add-authtoken <token>)',
};

export class TunnelManager {
  private state: TunnelState = { status: 'stopped' };
  private child: ChildProcess | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly opts: TunnelOptions) {}

  get snapshot(): TunnelState {
    return { ...this.state };
  }

  /** Start the tunnel; resolves when the public URL is known or the attempt failed (check status). */
  start(): Promise<TunnelState> {
    if (this.child && (this.state.status === 'starting' || this.state.status === 'running')) {
      return this.waitSettled();
    }
    const { provider, port } = this.opts;
    const bin = this.opts.binary ?? provider;
    const args =
      provider === 'cloudflared'
        ? ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`]
        : ['http', String(port), ...(this.opts.ngrokDomain ? ['--url', this.opts.ngrokDomain] : []), '--log', 'stdout', '--log-format', 'json'];

    this.set({ status: 'starting' });
    let child: ChildProcess;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      return Promise.resolve(this.snapshot);
    }
    this.child = child;
    this.set({ status: 'starting', pid: child.pid });

    const recent: string[] = [];
    const onData = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        recent.push(line);
        if (recent.length > 20) recent.shift();
        const url = this.parseUrl(line);
        if (url && this.child === child && this.state.status === 'starting') {
          this.clearTimer();
          this.set({ status: 'running', pid: child.pid, publicBaseUrl: url });
        }
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (this.child !== child) return;
      this.clearTimer();
      this.child = undefined;
      const missing = err.code === 'ENOENT';
      this.set({ status: missing ? 'unavailable' : 'error', error: missing ? INSTALL_HINT[provider] : err.message });
    });
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.clearTimer();
      this.child = undefined;
      const tail = recent.slice(-3).join(' | ');
      this.set({ status: 'error', error: `${provider} exited (${signal ?? code})${tail ? `: ${tail}` : ''}` });
    });

    this.timer = setTimeout(() => {
      if (this.child === child && this.state.status === 'starting') {
        this.set({ status: 'error', error: `Timed out waiting for a ${provider} public URL` });
        this.kill();
      }
    }, this.opts.startTimeoutMs ?? 30_000);
    this.timer.unref?.();

    return this.waitSettled();
  }

  /** Stop the tunnel process (SIGTERM, then SIGKILL after 2s). */
  stop(): Promise<TunnelState> {
    const child = this.child;
    this.clearTimer();
    this.child = undefined;
    if (!child) {
      this.set({ status: 'stopped' });
      return Promise.resolve(this.snapshot);
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(force);
        this.set({ status: 'stopped' });
        resolve(this.snapshot);
      };
      const force = setTimeout(() => child.kill('SIGKILL'), 2000);
      force.unref?.();
      if (child.exitCode !== null || child.signalCode !== null) return done();
      child.once('exit', done);
      child.kill('SIGTERM');
    });
  }

  private kill(): void {
    const child = this.child;
    this.child = undefined;
    child?.kill('SIGTERM');
  }

  private parseUrl(line: string): string | undefined {
    if (this.opts.provider === 'cloudflared') return CLOUDFLARED_URL.exec(line)?.[0];
    try {
      const obj = JSON.parse(line) as { url?: unknown };
      if (typeof obj.url === 'string' && obj.url.startsWith('https://')) return obj.url.replace(/\/+$/, '');
    } catch {
      // Non-JSON ngrok output line.
    }
    return undefined;
  }

  /** Resolves once status leaves "starting". */
  private waitSettled(): Promise<TunnelState> {
    if (this.state.status !== 'starting') return Promise.resolve(this.snapshot);
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (this.state.status !== 'starting') {
          clearInterval(check);
          resolve(this.snapshot);
        }
      }, 50);
    });
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private set(next: TunnelState): void {
    this.state = next;
    this.opts.onChange?.();
  }
}

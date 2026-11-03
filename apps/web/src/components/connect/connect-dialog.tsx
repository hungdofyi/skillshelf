import { useState, type ReactNode } from 'react';
import { KeyRound, RotateCw, Wifi, WifiOff } from 'lucide-react';
import type { McpInfo } from '@b2s/shared';
import { useMcpAction, useMcpInfo } from '../../api/queries';
import { Dialog, ConfirmDialog } from '../ui/dialog';
import { Button } from '../ui/button';
import { ErrorState, LoadingBlock, Pill } from '../ui/misc';
import { CopyField } from './copy-field';
import { maskMcpUrl } from './mask-mcp-url';

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-ui font-semibold">{title}</h3>
        {aside}
      </div>
      <div className="flex flex-col gap-2.5 text-muted">{children}</div>
    </section>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <code className="rounded bg-hover px-1 font-mono text-caption text-fg">{children}</code>;

function tunnelProblem(t: McpInfo['tunnel']): string | null {
  if (t.status === 'unavailable') return t.error ?? 'cloudflared is not installed. Install it with: brew install cloudflared';
  if (t.status === 'error') return t.error ?? 'The tunnel stopped unexpectedly.';
  return null;
}

function TunnelControls({ info }: { info: McpInfo }) {
  const start = useMcpAction('tunnel/start');
  const stop = useMcpAction('tunnel/stop');
  const { status } = info.tunnel;
  const problem = tunnelProblem(info.tunnel);
  const running = status === 'running';
  return (
    <>
      <div className="flex items-center gap-2">
        {running ? <Pill tone="ok"><Wifi size={11} />Tunnel running</Pill> : status === 'starting' ? <Pill tone="accent">Starting tunnel…</Pill> : <Pill><WifiOff size={11} />Tunnel off</Pill>}
        <span className="flex-1" />
        {running ? (
          <Button size="sm" loading={stop.isPending} onClick={() => stop.mutate()}>Stop tunnel</Button>
        ) : (
          <Button size="sm" variant="primary" loading={start.isPending || status === 'starting'} disabled={status === 'unavailable'} onClick={() => start.mutate()}>Start tunnel</Button>
        )}
      </div>
      {problem && <p role="alert" className="rounded-md bg-danger-soft px-2.5 py-1.5 text-danger">{problem}</p>}
    </>
  );
}

function ConnectBody({ info }: { info: McpInfo }) {
  const [confirmRotate, setConfirmRotate] = useState(false);
  const rotate = useMcpAction('token/rotate');
  return (
    <div>
      <Section title="Claude Code">
        <p>Run once in a terminal. Claude Code then talks to this library over stdio. This repo also ships a <Mono>.mcp.json</Mono> that does the same inside the project folder.</p>
        <CopyField value={info.claudeCodeCommand} label="Claude Code command" />
        <p>Tools: {info.tools.map((t, i) => <span key={t.name}>{i > 0 && ', '}<Mono>{t.name}</Mono></span>)}</p>
      </Section>

      <Section title="Claude.ai" aside={<span className="text-caption text-faint">needs a public URL</span>}>
        <TunnelControls info={info} />
        {info.publicUrl ? (
          <>
            <CopyField value={info.publicUrl} display={maskMcpUrl(info.publicUrl)} label="Public MCP URL" />
            <p>In Claude.ai open <b className="font-medium text-fg">Settings, Connectors, Add custom connector</b> and paste this URL. Leave authentication empty: the secret is part of the URL.</p>
          </>
        ) : (
          <p>Start the tunnel to get a public HTTPS URL for Claude.ai.</p>
        )}
      </Section>

      <Section title="ChatGPT">
        <p>Turn on <b className="font-medium text-fg">Developer mode</b> in ChatGPT settings, then add an MCP server with the same public URL as above. Choose no authentication.</p>
        {!info.publicUrl && <p className="text-faint">Start the tunnel in the Claude.ai section first.</p>}
        <p>Local URL, for clients on this machine:</p>
        <CopyField value={info.localUrl} display={maskMcpUrl(info.localUrl)} label="Local MCP URL" />
      </Section>

      <Section title="Access token">
        <div className="flex items-center gap-2">
          <KeyRound size={14} aria-hidden />
          <Mono>{info.tokenPreview}</Mono>
          <span className="flex-1" />
          <Button size="sm" icon={<RotateCw size={13} />} onClick={() => setConfirmRotate(true)}>Rotate token</Button>
        </div>
        <p>The token is the last part of every MCP URL. Anyone with the URL can read your library, so treat it like a password.</p>
      </Section>

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title="Rotate the access token?"
        description="Existing connectors in Claude Code, Claude.ai and ChatGPT stop working until you update them with the new URL."
        confirmLabel="Rotate token"
        destructive
        loading={rotate.isPending}
        onConfirm={() => rotate.mutate(undefined, { onSuccess: () => setConfirmRotate(false) })}
      />
    </div>
  );
}

export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isPending, error } = useMcpInfo();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Connect your library" description="Serve skills and book chapters to Claude Code, Claude.ai and ChatGPT over MCP. Read-only." width="lg">
      {isPending && <LoadingBlock />}
      {error && <ErrorState error={error} title="MCP info is unavailable" />}
      {data && <ConnectBody info={data} />}
    </Dialog>
  );
}

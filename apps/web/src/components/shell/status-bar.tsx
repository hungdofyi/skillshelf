import type { ReactNode } from 'react';
import clsx from 'clsx';
import { GitBranch, ListChecks } from 'lucide-react';
import { useClaudeStatus, useFile, useJobs, useMcpInfo, useTree } from '../../api/queries';
import { useEventsConnected } from '../../api/events-provider';
import { abbreviateHome, countText, formatNumber } from '../../lib/format';
import { resolveRoute } from '../../lib/route';
import { setUi } from '../../lib/ui-store';
import { isActive, JobKindIcon, progressFraction } from '../jobs/job-bits';
import { ProgressBar } from '../ui/misc';
import { OneLine } from '../ui/one-line';

type Tone = 'ok' | 'warn' | 'danger' | 'idle';
const DOT: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', idle: 'bg-faint' };
const Dot = ({ tone }: { tone: Tone }) => <span aria-hidden className={clsx('size-1.5 shrink-0 rounded-full', DOT[tone])} />;

/** Read-only status: plain text, no button chrome, so it never pretends to be clickable. */
const Item = ({ children, title }: { children: ReactNode; title?: string }) => <span title={title} className="flex h-8 min-w-0 items-center gap-1.5 px-2">{children}</span>;
const ItemButton = ({ children, title, onClick }: { children: ReactNode; title: string; onClick: () => void }) => (
  <button type="button" title={title} onClick={onClick} className="fx flex h-8 min-w-0 items-center gap-1.5 px-2 hover:bg-hover hover:text-fg">{children}</button>
);

function TextCounts({ path }: { path: string }) {
  const { data } = useFile(path);
  if (!data || data.binary || data.content === undefined) return null;
  const { words, lines } = countText(data.content);
  return <Item><span className="tnum">{formatNumber(words)} words · {formatNumber(lines)} lines</span></Item>;
}

function JobStatus() {
  const { data: jobs } = useJobs();
  const running = jobs?.filter((j) => isActive(j.status)) ?? [];
  const job = running[0];
  const open = () => setUi({ rail: 'activity', sidebarOpen: true, jobsOpen: true, selectedJobId: job?.id ?? jobs?.[0]?.id ?? null });
  if (!job) return <ItemButton title="Open activity" onClick={open}><ListChecks size={12} aria-hidden />No running jobs</ItemButton>;
  const fraction = progressFraction(job);
  return (
    <ItemButton title={`${job.title}: open the log`} onClick={open}>
      <JobKindIcon kind={job.kind} size={12} />
      <span className="max-w-56 truncate text-fg">{job.title}</span>
      {running.length > 1 && <span className="tnum">+{running.length - 1}</span>}
      <span className="w-20"><ProgressBar value={fraction} indeterminate={fraction === undefined} /></span>
      {fraction !== undefined && <span className="tnum w-8 text-right">{Math.round(fraction * 100)}%</span>}
    </ItemButton>
  );
}

/** 32px status bar (user decision; was 24px): library, git, Claude, MCP, live updates on the left; text counts and jobs on the right. */
export function StatusBar({ path }: { path: string }) {
  const { data: tree } = useTree();
  const claude = useClaudeStatus();
  const mcp = useMcpInfo();
  const connected = useEventsConnected();
  const git = tree?.git;
  const tunnel = mcp.data?.tunnel.status;
  const route = resolveRoute(path, tree?.root);
  const c = claude.data;

  return (
    <footer className="hairline-t flex h-8 shrink-0 items-center bg-panel text-caption text-muted">
      {tree && <Item title={tree.libraryDir}><OneLine nudges={false} className="max-w-72">{abbreviateHome(tree.libraryDir)}</OneLine></Item>}
      {git?.isRepo ? (
        <Item title={git.dirty ? `${git.dirty} uncommitted change${git.dirty === 1 ? '' : 's'}` : 'Working tree clean'}>
          <GitBranch size={12} aria-hidden />{git.branch ?? 'detached'}{!!git.dirty && <span className="tnum">· {git.dirty} changed</span>}
        </Item>
      ) : tree ? <Item>Not a git repo</Item> : null}
      <Item title={c?.ready ? `claude.ai login${c.orgName ? `, ${c.orgName}` : ''}` : c?.reason}>
        <Dot tone={claude.isPending ? 'idle' : c?.ready ? 'ok' : 'danger'} />
        {claude.isPending ? 'Checking Claude' : c?.ready ? 'Claude ready' : 'Claude not ready'}
      </Item>
      <ItemButton title="Connect Claude Code, Claude.ai or ChatGPT" onClick={() => setUi({ connectOpen: true })}>
        <Dot tone={tunnel === 'running' ? 'ok' : tunnel === 'error' ? 'warn' : 'idle'} />
        {tunnel === 'running' ? 'MCP tunnel on' : tunnel === 'starting' ? 'MCP tunnel starting' : tunnel === 'error' ? 'MCP tunnel error' : 'MCP local'}
      </ItemButton>
      <Item title={connected ? 'Live updates connected' : 'Live updates are offline. Reconnecting.'}>
        <Dot tone={connected ? 'ok' : 'warn'} />{connected ? 'Live' : 'Offline'}
      </Item>
      <span className="flex-1" />
      {route.kind === 'file' && <TextCounts path={route.path} />}
      <JobStatus />
    </footer>
  );
}

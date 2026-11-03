import { Fragment, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import type { EvalArm } from '@b2s/shared';
import { useFile, useRun } from '../../api/queries';
import { navigate } from '../../lib/location-state';
import { formatTime } from '../../lib/format';
import { useUi } from '../../lib/ui-store';
import { effortLabel } from '../../components/skill/effort-select';
import { ErrorState, LoadingBlock, SectionTitle } from '../../components/ui/misc';
import { parseEvalFile } from '../skill/eval-cases-editor';
import { ArmSummary } from './arm-summary';
import { ArmDetail } from './case-detail';
import { ARM_LABEL, CaseStatusPill, RunStatusPill } from './eval-bits';

/** Eval run: per-arm summary, then cases x arms with expandable evidence. Live while the run is active. */
export function EvalRunView({ skill, runId }: { skill: string; runId: string }) {
  const { data: run, isPending, error } = useRun(skill, runId);
  const evals = useFile(`skills/${skill}/evals/evals.json`);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const inspectorOpen = useUi((s) => s.inspectorOpen);
  const prompts = useMemo(() => new Map(parseEvalFile(evals.data?.content, skill).file.evals.map((c) => [String(c.id), c.prompt])), [evals.data?.content, skill]);
  if (isPending) return <LoadingBlock />;
  if (error || !run) return <ErrorState error={error} title="Could not open this run" />;

  const active = run.status === 'running';
  const runDir = `evals/${skill}/${run.id}`;
  const caseIds = run.caseIds.length ? run.caseIds : [...new Set(run.results.map((r) => r.caseId))];
  const find = (id: string, arm: EvalArm) => run.results.find((r) => r.caseId === id && r.arm === arm);
  const done = run.results.length;
  const total = caseIds.length * run.arms.length;
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-column flex flex-col gap-8 py-8">
        <header>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-heading font-semibold tracking-[-0.015em]">Eval run</h1>
            <RunStatusPill status={run.status} />
            {active && <span className="tnum text-muted">{done} of {total} results</span>}
          </div>
          <p className="mt-1 flex flex-wrap gap-x-3 text-muted">
            <button className="fx font-medium text-accent hover:underline" onClick={() => navigate(`skills/${skill}`, { tab: 'evals' })}>{skill}</button>
            <span>Started {formatTime(run.startedAt)}</span>
            <span>{run.model}{run.effort ? `, ${effortLabel(run.effort)} effort` : ''}, judged by {run.judgeModel}{run.judgeEffort ? ` (${effortLabel(run.judgeEffort)})` : ''}</span>
          </p>
        </header>

        {/* The inspector carries the per-arm summary; with it closed, the summary sits on the page. */}
        {!inspectorOpen && <section aria-label="Summary"><ArmSummary run={run} /></section>}

        <section>
          <SectionTitle>Cases</SectionTitle>
          <div className="overflow-hidden rounded-lg shadow-raised">
            <table className="w-full border-collapse text-left">
              <thead><tr className="border-b border-line bg-panel text-caption text-muted">
                <th className="w-8" /><th className="px-3 py-1.5 font-medium">Case</th>
                {run.arms.map((a) => <th key={a} className="w-40 px-3 py-1.5 font-medium">{ARM_LABEL[a]}</th>)}
              </tr></thead>
              <tbody>
                {caseIds.map((id) => {
                  const isOpen = open.has(id);
                  return (
                    <Fragment key={id}>
                      <tr className={clsx('cursor-pointer border-b border-line hover:bg-hover', isOpen && 'bg-hover')} onClick={() => toggle(id)}>
                        <td className="pl-2"><button aria-expanded={isOpen} aria-label={`Toggle case ${id}`} className="relative flex size-6 items-center justify-center rounded text-muted before:absolute before:-inset-2" onClick={(e) => { e.stopPropagation(); toggle(id); }}><ChevronRight size={14} aria-hidden className={clsx('transition-[rotate] duration-150 ease-(--ease-move)', isOpen && 'rotate-90')} /></button></td>
                        <td className="max-w-0 px-3 py-2"><div className="truncate"><span className="mr-2 font-mono text-caption text-faint">#{id}</span>{prompts.get(id) ?? ''}</div></td>
                        {run.arms.map((a) => <td key={a} className="px-3 py-2"><div className="flex items-center gap-2"><CaseStatusPill result={find(id, a)} runActive={active} />{find(id, a) && <span className="tnum text-caption text-muted">{find(id, a)!.score.toFixed(2)}</span>}</div></td>)}
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-line bg-panel"><td colSpan={2 + run.arms.length} className="px-5 py-4">
                          <h4 className="mb-1 text-caption font-semibold text-muted">Prompt</h4>
                          <p className="mb-4 max-w-[80ch] whitespace-pre-wrap">{prompts.get(id) ?? 'Prompt not found in evals.json.'}</p>
                          <div className="flex flex-col gap-6 lg:flex-row">
                            {run.arms.map((a) => { const r = find(id, a); return r ? <ArmDetail key={a} result={r} runDir={runDir} /> : <p key={a} className="flex-1 text-muted">{ARM_LABEL[a]}: no result yet.</p>; })}
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

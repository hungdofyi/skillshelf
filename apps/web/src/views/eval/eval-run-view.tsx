import { useMemo, useState } from 'react';
import { inferShouldTrigger } from '@b2s/shared';
import { useFile, useRun } from '../../api/queries';
import { navigate } from '../../lib/location-state';
import { formatTime } from '../../lib/format';
import { useUi } from '../../lib/ui-store';
import { effortLabel } from '../../components/skill/effort-select';
import { ErrorState, LoadingBlock, SectionTitle } from '../../components/ui/misc';
import { parseEvalFile } from '../skill/eval-cases-editor';
import { RunSummary } from './run-summary';
import { MissedChecks } from './missed-checks';
import { CasesTable } from './cases-table';
import { RunStatusPill } from './eval-bits';

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Eval run, in the order a user asks: does the skill help (summary), what does it still miss, then the
 * cases with their evidence, and last the prompts the skill should leave alone. Live while the run is active.
 */
export function EvalRunView({ skill, runId }: { skill: string; runId: string }) {
  const { data: run, isPending, error } = useRun(skill, runId);
  const evals = useFile(`skills/${skill}/evals/evals.json`);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const inspectorOpen = useUi((s) => s.inspectorOpen);
  const cases = useMemo(() => parseEvalFile(evals.data?.content, skill).file.evals, [evals.data?.content, skill]);
  const prompts = useMemo(() => new Map(cases.map((c) => [String(c.id), c.prompt])), [cases]);
  if (isPending) return <LoadingBlock />;
  if (error || !run) return <ErrorState error={error} title="Could not open this run" />;

  const active = run.status === 'running';
  const runDir = `evals/${skill}/${run.id}`;
  const caseIds = run.caseIds.length ? run.caseIds : [...new Set(run.results.map((r) => r.caseId))];
  // Graded results say which cases were near-misses; evals.json covers cases that have not run yet.
  const fromResults = inferShouldTrigger(run.results);
  const isNearMiss = (id: string) => (id in fromResults ? !fromResults[id] : cases.find((c) => String(c.id) === id)?.should_trigger === false);
  const gradedIds = caseIds.filter((id) => !isNearMiss(id));
  const nearMissIds = caseIds.filter(isNearMiss);
  const done = run.results.length;
  const total = caseIds.length * run.arms.length; // near-miss cases record a skipped baseline result too
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const openCase = (id: string) => {
    setOpen((s) => new Set(s).add(id));
    requestAnimationFrame(() => document.getElementById(`case-${id}`)?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }));
  };
  const table = { run, prompts, open, onToggle: toggle, runDir };

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

        {/* The inspector carries the summary; with it closed, the summary sits on the page. */}
        {!inspectorOpen && <section aria-label="Summary"><RunSummary run={run} /></section>}

        <MissedChecks run={run} skill={skill} caseIds={caseIds} onOpenCase={openCase} />

        {gradedIds.length > 0 && (
          <section>
            <SectionTitle>Cases</SectionTitle>
            <CasesTable {...table} ids={gradedIds} />
          </section>
        )}

        {nearMissIds.length > 0 && (
          <section>
            <SectionTitle>Prompts the skill should leave alone</SectionTitle>
            <CasesTable {...table} ids={nearMissIds} nearMiss />
          </section>
        )}
      </div>
    </div>
  );
}

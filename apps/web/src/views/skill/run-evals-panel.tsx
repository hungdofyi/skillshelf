import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { Effort, EvalArm, Job } from '@b2s/shared';
import { keys, upsertJob, useClaudeStatus, useRunEval } from '../../api/queries';
import { navigate } from '../../lib/location-state';
import { openJob } from '../../lib/ui-store';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import { Checkbox, Field, Input, Select, SectionTitle } from '../../components/ui/misc';
import { EFFORT_DEFAULTS, EffortSelect } from '../../components/skill/effort-select';
import { ClaudeStatusNote } from '../../components/skill/claude-status-note';

/** The server runs at most this many claude processes per eval (it clamps higher values). */
const MAX_EVAL_CONCURRENCY = 4;

/** Arms / model / concurrency + a confirm step that spells out how many claude runs will happen. */
export function RunEvalsPanel({ skill, caseCount, blockedReason }: { skill: string; caseCount: number; blockedReason?: string }) {
  const qc = useQueryClient();
  const claude = useClaudeStatus();
  const run = useRunEval(skill);
  const [arms, setArms] = useState<EvalArm[]>(['with_skill', 'baseline']);
  const [model, setModel] = useState('sonnet');
  const [effort, setEffort] = useState<Effort>(EFFORT_DEFAULTS.eval);
  const [concurrency, setConcurrency] = useState(2);
  const [confirm, setConfirm] = useState(false);
  const toggle = (a: EvalArm, on: boolean) => setArms((cur) => (on ? [...cur, a] : cur.filter((x) => x !== a)));
  const agentRuns = caseCount * arms.length;
  const disabledReason = blockedReason ?? (!claude.data?.ready ? 'Claude is not ready.' : caseCount === 0 ? 'Add at least one case.' : arms.length === 0 ? 'Pick at least one arm.' : null);

  const start = () =>
    run.mutate({ arms, model, effort, concurrency }, {
      onSuccess: ({ job, runId }) => {
        qc.setQueryData<Job[]>(keys.jobs, (l) => upsertJob(l, job));
        setConfirm(false);
        openJob(job.id);
        navigate(`evals/${skill}/${runId}`);
      },
    });

  return (
    <section>
      <SectionTitle>Run evals</SectionTitle>
      <div className="flex flex-col gap-3 rounded-lg bg-panel p-4">
        <ClaudeStatusNote status={claude.data} loading={claude.isPending} />
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <Field label="Arms">
            <div className="flex h-8 items-center gap-4">
              <Checkbox checked={arms.includes('with_skill')} onChange={(v) => toggle('with_skill', v)}>With skill</Checkbox>
              <Checkbox checked={arms.includes('baseline')} onChange={(v) => toggle('baseline', v)}>Baseline</Checkbox>
            </div>
          </Field>
          <Field label="Model" htmlFor="eval-model"><Select id="eval-model" value={model} onChange={(e) => setModel(e.target.value)}><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option></Select></Field>
          <Field label="Concurrency" htmlFor="eval-conc"><Input id="eval-conc" type="number" min={1} max={MAX_EVAL_CONCURRENCY} value={concurrency} className="w-20" onChange={(e) => setConcurrency(Math.max(1, Math.min(MAX_EVAL_CONCURRENCY, Number(e.target.value) || 1)))} /></Field>
          <EffortSelect id="eval-effort" value={effort} onChange={setEffort} />
          <Button className="mt-[22px]" variant="primary" icon={<FlaskConical size={14} />} disabled={!!disabledReason} title={disabledReason ?? undefined} onClick={() => setConfirm(true)}>Run evals</Button>
        </div>
        {disabledReason && <p className="text-caption text-faint">{disabledReason}</p>}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Run evals?"
        description={<>This starts <b className="tnum text-fg">{agentRuns}</b> Claude run{agentRuns === 1 ? '' : 's'} ({caseCount} case{caseCount === 1 ? '' : 's'} × {arms.length} arm{arms.length === 1 ? '' : 's'}) plus a judge run for each (always at Low effort so grading stays comparable), on your claude.ai subscription. It can take several minutes and counts against your usage limits.</>}
        confirmLabel={`Start ${agentRuns} runs`}
        loading={run.isPending}
        onConfirm={start}
      />
    </section>
  );
}

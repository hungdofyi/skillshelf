import { useState } from 'react';
import { PenLine } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { Job, SkillSummary } from '@b2s/shared';
import { keys, upsertJob, useClaudeStatus, useReviseSkill, useRuns } from '../../api/queries';
import { openJob } from '../../lib/ui-store';
import { formatTime, formatPercent } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Field, Select, Textarea } from '../../components/ui/misc';
import { ClaudeStatusNote } from '../../components/skill/claude-status-note';
import { shortcutLabels } from '../../lib/use-global-shortcuts';

export function ReviseTab({ skill }: { skill: SkillSummary }) {
  const qc = useQueryClient();
  const claude = useClaudeStatus();
  const runs = useRuns(skill.name);
  const revise = useReviseSkill(skill.name);
  const [feedback, setFeedback] = useState('');
  const [runId, setRunId] = useState('');
  const [model, setModel] = useState('sonnet');
  const canSubmit = !!claude.data?.ready && (!!feedback.trim() || !!runId) && !revise.isPending;
  const submit = () =>
    revise.mutate({ feedback: feedback.trim(), model, ...(runId ? { evalRunId: runId } : {}) }, {
      onSuccess: ({ job }) => { qc.setQueryData<Job[]>(keys.jobs, (l) => upsertJob(l, job)); setFeedback(''); openJob(job.id); },
    });
  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-6"><div className="flex max-w-2xl flex-col gap-4">
      <p className="text-muted">Tell Claude what to change. It edits SKILL.md and references in place, and keeps a backup of the previous version.</p>
      <ClaudeStatusNote status={claude.data} loading={claude.isPending} />
      <Field label="Feedback" htmlFor="revise-feedback" hint="Be specific: what went wrong, what you expected instead.">
         <Textarea id="revise-feedback" rows={6} value={feedback} onChange={(e) => setFeedback(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) { e.preventDefault(); submit(); } }} placeholder="The skill skips the activation metrics step. It should always ask for the funnel definition first." />
      </Field>
      <Field label="Include failures from an eval run (optional)" htmlFor="revise-run">
        <Select id="revise-run" value={runId} onChange={(e) => setRunId(e.target.value)}>
          <option value="">None</option>
          {runs.data?.map((r) => <option key={r.id} value={r.id}>{r.id} · {formatTime(r.startedAt)}{r.summary.with_skill ? ` · ${formatPercent(r.summary.with_skill.passRate)} pass` : ''}</option>)}
        </Select>
      </Field>
      <div className="flex items-end justify-between gap-4">
        <Field label="Model" htmlFor="revise-model"><Select id="revise-model" value={model} onChange={(e) => setModel(e.target.value)}><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option></Select></Field>
        <Button variant="primary" icon={<PenLine size={14} />} disabled={!canSubmit} loading={revise.isPending} onClick={submit} title={`Revise skill (${shortcutLabels.mod}Enter)`}>Revise skill</Button>
      </div>
    </div></div>
  );
}

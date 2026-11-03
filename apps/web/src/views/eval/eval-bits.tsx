import type { EvalArm, EvalCaseArmResult, EvalRun } from '@b2s/shared';
import { Pill, Spinner } from '../../components/ui/misc';

export const ARM_LABEL: Record<EvalArm, string> = { with_skill: 'With skill', baseline: 'Baseline' };

export function RunStatusPill({ status }: { status: EvalRun['status'] }) {
  if (status === 'running') return <Pill tone="accent"><Spinner size={10} className="text-accent" />Running</Pill>;
  if (status === 'succeeded') return <Pill tone="ok">Complete</Pill>;
  if (status === 'failed') return <Pill tone="danger">Failed</Pill>;
  return <Pill>Cancelled</Pill>;
}

export function CaseStatusPill({ result, runActive }: { result?: EvalCaseArmResult; runActive: boolean }) {
  if (!result) return runActive ? <Pill tone="accent"><Spinner size={10} className="text-accent" />Pending</Pill> : <Pill>Not run</Pill>;
  switch (result.status) {
    case 'passed': return <Pill tone="ok">Passed</Pill>;
    case 'failed': return <Pill tone="danger">Failed</Pill>;
    case 'error': return <Pill tone="warn">Error</Pill>;
    case 'skipped': return <Pill>Skipped</Pill>;
  }
}

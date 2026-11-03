import clsx from 'clsx';
import type { EvalArm, EvalRun } from '@b2s/shared';
import { formatDuration, formatPercent } from '../../lib/format';
import { ARM_LABEL } from './eval-bits';

function Metric({ label, value }: { label: string; value: string }) {
  return <div><div className="tnum text-title font-medium">{value}</div><div className="text-caption text-muted">{label}</div></div>;
}

/**
 * One card per arm with the pass-rate delta on the with-skill card. Side by side on the page,
 * `stacked` in the inspector. The header row has a fixed height so both cards' numbers line up.
 */
export function ArmSummary({ run, stacked }: { run: EvalRun; stacked?: boolean }) {
  const arms = run.arms.filter((a) => run.summary[a]);
  const delta = run.summary.with_skill && run.summary.baseline ? run.summary.with_skill.passRate - run.summary.baseline.passRate : null;
  if (!arms.length) return <p className="text-muted">No results yet.</p>;
  return (
    <div className={clsx('grid gap-3', !stacked && arms.length > 1 && 'sm:grid-cols-2')}>
      {arms.map((a: EvalArm) => {
        const s = run.summary[a]!;
        return (
          <div key={a} className={clsx('rounded-lg bg-raised shadow-raised', stacked ? 'p-3' : 'p-4')}>
            <div className="flex h-5 items-center justify-between gap-2">
              <h3 className="text-caption font-semibold text-muted">{ARM_LABEL[a]}</h3>
              {a === 'with_skill' && delta !== null && (
                <span className={clsx('tnum inline-flex h-5 items-center rounded-full px-2 text-micro font-medium', delta > 0 ? 'bg-ok-soft text-ok' : delta < 0 ? 'bg-danger-soft text-danger' : 'bg-hover text-muted')} title="Pass-rate difference vs baseline">
                  {delta > 0 ? '+' : ''}{Math.round(delta * 100)} pts vs baseline
                </span>
              )}
            </div>
            <div className={clsx('tnum mt-2 font-semibold leading-none tracking-[-0.02em]', stacked ? 'text-heading' : 'text-display')}>{formatPercent(s.passRate)}</div>
            <div className="mt-1 text-caption text-muted">pass rate · {s.cases} case{s.cases === 1 ? '' : 's'}</div>
            <div className={clsx('flex flex-wrap gap-x-6 gap-y-2', stacked ? 'mt-3' : 'mt-4')}>
              <Metric label="mean score" value={s.meanScore.toFixed(2)} />
              {s.triggerAccuracy !== undefined && <Metric label="trigger accuracy" value={formatPercent(s.triggerAccuracy)} />}
              {s.meanDurationMs !== undefined && <Metric label="mean duration" value={formatDuration(s.meanDurationMs)} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

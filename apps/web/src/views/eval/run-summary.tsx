import clsx from 'clsx';
import type { EvalRun, Tally } from '@b2s/shared';
import { tallyText } from './eval-bits';

function Metric({ label, value }: { label: string; value: Tally }) {
  return <div><div className="tnum text-title font-medium">{tallyText(value)}</div><div className="text-caption text-muted">{label}</div></div>;
}

/**
 * The run's answer to "does the skill help?": cases where the skill's answer scored higher than the
 * baseline's, then checks passed in each arm, then whether the skill was used only when it should be.
 * Strict pass rate and timings live in the inspector's run details. `stacked` is the inspector variant.
 */
export function RunSummary({ run, stacked }: { run: EvalRun; stacked?: boolean }) {
  const s = run.summary.with_skill;
  const b = run.summary.baseline;
  if (!s && !b) return <p className="text-muted">No results yet.</p>;
  const v = s?.vsBaseline;
  const compared = v ? v.better + v.tied + v.worse : 0;
  const big = clsx('tnum mt-2 font-semibold leading-none tracking-[-0.02em]', stacked ? 'text-heading' : 'text-display');
  return (
    <div className={clsx('rounded-lg bg-raised shadow-raised', stacked ? 'p-3' : 'p-4')}>
      {v && compared > 0 ? (
        <>
          <h3 className="text-caption font-semibold text-muted">With the skill vs without</h3>
          <div className={big}>{v.better}/{compared}</div>
          <div className="mt-1 text-caption text-muted">cases better with the skill<br />{v.tied} the same · {v.worse} worse</div>
        </>
      ) : s?.checks.total ? (
        <>
          <h3 className="text-caption font-semibold text-muted">With skill</h3>
          <div className={big}>{tallyText(s.checks)}</div>
          <div className="mt-1 text-caption text-muted">checks passed</div>
        </>
      ) : (
        <p className="text-muted">No graded cases yet.</p>
      )}
      <div className={clsx(stacked ? 'mt-3 grid grid-cols-2 gap-x-4 gap-y-3' : 'mt-4 flex flex-wrap gap-x-6 gap-y-2')}>
        {!!(compared && s?.checks.total) && <Metric label="checks with skill" value={s!.checks} />}
        {!!b?.checks.total && <Metric label="checks without" value={b.checks} />}
        {!!s?.usedWhenNeeded?.total && <Metric label="used when needed" value={s.usedWhenNeeded} />}
        {!!s?.skippedWhenNotNeeded?.total && <Metric label="left alone when not needed" value={s.skippedWhenNotNeeded} />}
      </div>
    </div>
  );
}

import { useRuns } from '../../api/queries';
import { navigate } from '../../lib/location-state';
import { formatPercent, formatTime } from '../../lib/format';
import { Pill, SectionTitle } from '../../components/ui/misc';
import { RunStatusPill } from '../eval/eval-bits';

export function RunsHistory({ skill }: { skill: string }) {
  const { data, isPending, error } = useRuns(skill);
  return (
    <section>
      <SectionTitle>Run history</SectionTitle>
      {isPending && <p className="text-muted">Loading runs…</p>}
      {error && <p className="text-danger">{error.message}</p>}
      {data?.length === 0 && <p className="text-muted">No runs yet. Results from each eval run are kept here.</p>}
      {!!data?.length && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg shadow-raised">
          {data.map((r) => (
            <li key={r.id}>
              <button onClick={() => navigate(`evals/${skill}/${r.id}`)} className="fx flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover">
                <span className="font-mono text-caption">{r.id}</span>
                <RunStatusPill status={r.status} />
                <span className="text-muted">{formatTime(r.startedAt)}</span>
                <span className="flex-1" />
                {r.arms.map((a) => r.summary[a] && <Pill key={a} tone={a === 'with_skill' ? 'accent' : 'neutral'}>{a === 'with_skill' ? 'With skill' : 'Baseline'} <span className="tnum">{formatPercent(r.summary[a]!.passRate)}</span></Pill>)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

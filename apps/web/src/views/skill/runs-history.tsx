import { useRuns } from '../../api/queries';
import { navigate } from '../../lib/location-state';
import { formatTime } from '../../lib/format';
import { Pill, SectionTitle } from '../../components/ui/misc';
import { RunStatusPill, runHeadline, tallyText } from '../eval/eval-bits';

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
                {runHeadline(r.summary) && <Pill tone="accent"><span className="tnum">{runHeadline(r.summary)}</span></Pill>}
                {r.summary.with_skill?.vsBaseline && !!r.summary.with_skill.checks.total && <Pill><span className="tnum">{tallyText(r.summary.with_skill.checks)}</span> checks</Pill>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { LintIssue, LintLevel, SkillSummary } from '@b2s/shared';
import { navigate } from '../../lib/location-state';
import { SectionTitle } from '../../components/ui/misc';
import { OneLine } from '../../components/ui/one-line';
import { useUi } from '../../lib/ui-store';

const LEVELS: Array<{ level: LintLevel; label: string; cls: string; Icon: typeof Info }> = [
  { level: 'error', label: 'Errors', cls: 'text-danger', Icon: AlertCircle },
  { level: 'warning', label: 'Warnings', cls: 'text-warn', Icon: AlertTriangle },
  { level: 'info', label: 'Notes', cls: 'text-muted', Icon: Info },
];

export function LintList({ skill }: { skill: SkillSummary }) {
  if (!skill.lint.length) {
    return <p className="flex items-center gap-1.5 text-muted"><CheckCircle2 size={14} className="text-ok" aria-hidden />No lint issues.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {LEVELS.map(({ level, label, cls, Icon }) => {
        const issues: LintIssue[] = skill.lint.filter((i) => i.level === level);
        if (!issues.length) return null;
        return (
          <div key={level}>
            <h4 className={`mb-1 text-caption font-medium ${cls}`}>{label} ({issues.length})</h4>
            <ul className="flex flex-col">
              {issues.map((i, n) => (
                <li key={`${i.code}-${n}`} className="flex items-start gap-2 py-1">
                  <Icon size={14} className={`mt-0.5 shrink-0 ${cls}`} aria-hidden />
                  <span className="min-w-0 flex-1 break-words">
                    {i.message} <span className="font-mono text-micro text-faint">{i.code}</span>
                    {i.file && <> <button className="fx font-mono text-caption text-accent hover:underline" onClick={() => navigate(`${skill.path}/${i.file}`)}>{i.file}</button></>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function InstallList({ skill }: { skill: SkillSummary }) {
  return skill.installs?.length ? (
    <ul className="flex flex-col gap-1.5">
      {skill.installs.map((i) => (
        <li key={i.linkPath} className="min-w-0">
          <div className="text-muted">{i.target === 'user' ? 'Claude Code, all projects' : 'One project'}</div>
          <OneLine className="font-mono text-caption">{i.linkPath}</OneLine>
        </li>
      ))}
    </ul>
  ) : <p className="text-muted">Not installed anywhere yet. Install it from the Test tab.</p>;
}

/** Files of the skill. Lint and installs live in the inspector, and come back here while it is closed. */
export function OverviewTab({ skill }: { skill: SkillSummary }) {
  const inspectorOpen = useUi((s) => s.inspectorOpen);
  return (
    <div className="page-column flex flex-col gap-8 py-6">
      {!inspectorOpen && <section><SectionTitle>Lint</SectionTitle><LintList skill={skill} /></section>}
      <section>
        <SectionTitle aside={<span className="tnum text-caption text-muted">SKILL.md body {skill.bodyLines} lines · {skill.evalCount} eval cases</span>}>Files</SectionTitle>
        <ul className="divide-y divide-line overflow-hidden rounded-lg shadow-raised">
          {skill.files.map((f) => (
            <li key={f}><button onClick={() => navigate(`${skill.path}/${f}`)} className="block w-full truncate px-3 py-2 text-left font-mono text-caption hover:bg-hover">{f}</button></li>
          ))}
        </ul>
      </section>
      {!inspectorOpen && <section><SectionTitle>Installed</SectionTitle><InstallList skill={skill} /></section>}
    </div>
  );
}

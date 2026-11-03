import clsx from 'clsx';
import { Download, FlaskConical, PenLine, PlugZap } from 'lucide-react';
import { SKILL_DESCRIPTION_MAX } from '@b2s/shared';
import { useSkill } from '../../api/queries';
import { navigate } from '../../lib/location-state';
import { InstallList, LintList } from '../../views/skill/overview-tab';
import { PassRates } from '../../views/skill/skill-header';
import { effortLabel } from '../skill/effort-select';
import { Button } from '../ui/button';
import { InspectorFacts, InspectorNote, InspectorSection } from './inspector-section';

/** Skill: what to do next, the full description, latest pass rates, lint, installs and provenance. */
export function SkillInspector({ name }: { name: string }) {
  const { data: skill, isPending } = useSkill(name);
  if (isPending) return <InspectorNote>Loading…</InspectorNote>;
  if (!skill) return <InspectorNote>This skill could not be read.</InspectorNote>;
  const meta = skill.frontmatter.metadata ?? {};
  const len = skill.description.length;
  const over = len > SKILL_DESCRIPTION_MAX;
  const action = 'w-full justify-start';

  return (
    <>
      <div className="grid gap-1 px-3 pb-1 pt-3">
        <Button variant="ghost" className={action} icon={<FlaskConical size={14} />} onClick={() => navigate(skill.path, { tab: 'evals' })}>Run evals</Button>
        <Button variant="ghost" className={action} icon={<PlugZap size={14} />} onClick={() => navigate(skill.path, { tab: 'test' })}>Install or connect</Button>
        <Button variant="ghost" className={action} icon={<PenLine size={14} />} onClick={() => navigate(skill.path, { tab: 'revise' })}>Revise with feedback</Button>
        <a href={`/api/skills/${encodeURIComponent(skill.name)}/export`} download className="fx flex h-8 items-center gap-2 rounded-md px-3 font-medium text-muted hover:bg-hover hover:text-fg">
          <Download size={14} aria-hidden />Export .zip for Claude.ai
        </a>
      </div>
      <InspectorSection title="Latest eval">
        <PassRates rates={skill.latestRun?.passRate ?? {}} runId={skill.latestRun?.id} skill={skill.name} />
      </InspectorSection>
      <InspectorSection title="Description" aside={<span className={clsx('tnum text-caption', over ? 'font-medium text-danger' : 'text-muted')}>{len} / {SKILL_DESCRIPTION_MAX}</span>}>
        <p className="text-pretty break-words">{skill.description || <span className="text-muted">No description yet.</span>}</p>
      </InspectorSection>
      <InspectorSection title="Lint"><LintList skill={skill} /></InspectorSection>
      <InspectorSection title="Installed"><InstallList skill={skill} /></InspectorSection>
      {(meta.source || meta.goal || meta.model || meta.effort) && (
        <InspectorSection title="Made from">
          <InspectorFacts items={[
            ...(meta.source ? ([['Source', meta.source]] as Array<[string, string]>) : []),
            ...(meta.goal ? ([['Goal', meta.goal]] as Array<[string, string]>) : []),
            ...(meta.model ? ([['Model', meta.model]] as Array<[string, string]>) : []),
            ...(meta.effort ? ([['Effort', effortLabel(meta.effort)]] as Array<[string, string]>) : []),
          ]} />
        </InspectorSection>
      )}
    </>
  );
}

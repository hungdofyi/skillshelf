import { FileText, FlaskConical, FolderTree, ListChecks, PenLine, PlayCircle } from 'lucide-react';
import { useSkill } from '../../api/queries';
import { setTab, useLocationState } from '../../lib/location-state';
import { FileEditor } from '../../components/editor/file-editor';
import { ErrorState, LoadingBlock } from '../../components/ui/misc';
import { Tab, TabList, TabPanel, Tabs } from '../../components/ui/tabs';
import { SkillHeader } from './skill-header';
import { OverviewTab } from './overview-tab';
import { ReferencesTab } from './references-tab';
import { EvalsTab } from './evals-tab';
import { TestTab } from './test-tab';
import { ReviseTab } from './revise-tab';

const TABS = ['overview', 'skill-md', 'references', 'evals', 'test', 'revise'] as const;
type TabId = (typeof TABS)[number];

export function SkillView({ name, isSkillMd }: { name: string; isSkillMd: boolean }) {
  const { data: skill, isPending, error } = useSkill(name);
  const { tab } = useLocationState();
  if (isPending) return <LoadingBlock />;
  if (error || !skill) return <ErrorState error={error} title="Could not open this skill" />;
  const active: TabId = (TABS as readonly string[]).includes(tab ?? '') ? (tab as TabId) : isSkillMd ? 'skill-md' : 'overview';
  const errors = skill.lint.filter((i) => i.level === 'error').length;
  const icon = (I: typeof FileText) => <I size={13} aria-hidden />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SkillHeader skill={skill} />
      <Tabs value={active} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="hairline-b shrink-0"><div className="page-column"><TabList className="-mx-2">
          <Tab value="overview">{icon(ListChecks)}Overview{errors > 0 && <span className="tnum inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger-soft px-1.5 text-micro text-danger" aria-label={`${errors} lint errors`}>{errors}</span>}</Tab>
          <Tab value="skill-md">{icon(FileText)}SKILL.md</Tab>
          <Tab value="references" count={skill.files.filter((f) => f.startsWith('references/')).length}>{icon(FolderTree)}References</Tab>
          <Tab value="evals" count={skill.evalCount}>{icon(FlaskConical)}Evals</Tab>
          <Tab value="test">{icon(PlayCircle)}Test</Tab>
          <Tab value="revise">{icon(PenLine)}Revise</Tab>
        </TabList></div></div>
        <TabPanel value="overview"><OverviewTab skill={skill} /></TabPanel>
        <TabPanel value="skill-md" className="overflow-hidden"><FileEditor key={skill.path} path={`${skill.path}/SKILL.md`} kind="markdown" toolbarInColumn /></TabPanel>
        <TabPanel value="references" className="overflow-hidden"><ReferencesTab skill={skill} /></TabPanel>
        <TabPanel value="evals"><EvalsTab skill={skill} /></TabPanel>
        <TabPanel value="test"><TestTab skill={skill} /></TabPanel>
        <TabPanel value="revise"><ReviseTab skill={skill} /></TabPanel>
      </Tabs>
    </div>
  );
}

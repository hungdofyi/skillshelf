import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Plug } from 'lucide-react';
import type { SkillSummary } from '@b2s/shared';
import { keys, useInstallSkill, useMcpInfo, useUninstallSkill } from '../../api/queries';
import { setUi } from '../../lib/ui-store';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Input, SectionTitle } from '../../components/ui/misc';
import { CopyField } from '../../components/connect/copy-field';
import { OneLine } from '../../components/ui/one-line';

/** Where to strip a project link down to its project folder: <project>/.claude/skills/<name>. */
const projectDirOf = (linkPath: string) => linkPath.replace(/\/\.claude\/skills\/[^/]+\/?$/, '');

export function TestTab({ skill }: { skill: SkillSummary }) {
  const qc = useQueryClient();
  const install = useInstallSkill(skill.name);
  const uninstall = useUninstallSkill(skill.name);
  const mcp = useMcpInfo();
  const [projectDir, setProjectDir] = useState('');
  const userInstall = skill.installs?.find((i) => i.target === 'user');
  const projectInstalls = skill.installs?.filter((i) => i.target === 'project') ?? [];
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.skill(skill.name) });
  const hasLoadSkill = mcp.data?.tools.some((t) => t.name === 'load_skill') ?? true;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-8 py-6">
      <section>
        <SectionTitle>Claude Code</SectionTitle>
        <div className="flex flex-col gap-3 rounded-lg bg-raised p-4 shadow-raised">
          <Checkbox checked={!!userInstall} disabled={install.isPending || uninstall.isPending} onChange={(on) => on
            ? install.mutate({ target: 'user' }, { onSuccess: (r) => { refresh(); toast.success('Installed for Claude Code', { description: r.linkPath }); } })
            : uninstall.mutate({ target: 'user' }, { onSuccess: () => { refresh(); toast.success('Removed link'); } })}>
            Install to <span className="font-mono text-caption">~/.claude/skills</span>
          </Checkbox>
          {userInstall && <OneLine className="font-mono text-caption text-muted">{userInstall.linkPath}</OneLine>}
          <p className="text-caption text-faint">A symlink, so edits here are live in Claude Code. Start a new session to pick the skill up.</p>
          <div className="border-t border-line pt-3">
            <Field label="Install into a project" htmlFor="project-dir" hint="Absolute path to the project folder. The skill is linked under .claude/skills.">
              {/* A form so Enter in the path field installs, like the button. */}
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!projectDir.trim().startsWith('/') || install.isPending) return;
                  install.mutate({ target: 'project', projectDir: projectDir.trim() }, { onSuccess: () => { refresh(); setProjectDir(''); toast.success('Installed in project'); } });
                }}
              >
                <Input id="project-dir" value={projectDir} className="font-mono" placeholder="/Users/you/code/my-app" spellCheck={false} autoComplete="off" onChange={(e) => setProjectDir(e.target.value)} />
                <Button type="submit" disabled={!projectDir.trim().startsWith('/')} loading={install.isPending}>Install</Button>
              </form>
            </Field>
            {projectInstalls.map((p) => (
              <div key={p.linkPath} className="mt-2 flex items-center gap-2">
                <OneLine className="flex-1 font-mono text-caption text-muted">{p.linkPath}</OneLine>
                <Button size="sm" variant="ghost" onClick={() => uninstall.mutate({ target: 'project', projectDir: projectDirOf(p.linkPath) }, { onSuccess: refresh })}>Remove</Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>Claude.ai</SectionTitle>
        <div className="flex items-center gap-3 rounded-lg bg-raised p-4 shadow-raised">
          <p className="flex-1 text-muted">Download a .zip and upload it in Claude.ai under Settings, Capabilities, Skills. Evals are left out of the archive.</p>
          <a href={`/api/skills/${encodeURIComponent(skill.name)}/export`} download className="fx press inline-flex h-8 shrink-0 items-center gap-2 rounded-md bg-raised px-3 font-medium shadow-raised hover:bg-raised-hover"><Download size={14} aria-hidden />Export .zip</a>
        </div>
      </section>

      <section>
        <SectionTitle>Over MCP</SectionTitle>
        <div className="flex flex-col gap-3 rounded-lg bg-raised p-4 shadow-raised">
          <p className="text-muted">{hasLoadSkill ? 'Any connected client can load this skill on demand by asking for it, or you can be explicit:' : 'Connect a client first, then ask it to load the skill:'}</p>
          <CopyField value={`Use the load_skill tool with name "${skill.name}" and follow it.`} label="Prompt for MCP clients" />
          <Button className="self-start" icon={<Plug size={14} />} onClick={() => setUi({ connectOpen: true })}>Open connect panel</Button>
        </div>
      </section>
    </div>
  );
}

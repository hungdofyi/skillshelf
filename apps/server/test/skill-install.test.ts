import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportSkillZip } from '../src/skills/skill-export.js';
import { installSkill, listInstalls, uninstallSkill } from '../src/skills/skill-install.js';

function setup() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'b2s-install-')));
  const skillDir = path.join(root, 'library/skills/demo');
  mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  mkdirSync(path.join(skillDir, 'evals'), { recursive: true });
  writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: Use when x\n---\nbody');
  writeFileSync(path.join(skillDir, 'references/a.md'), '# a');
  writeFileSync(path.join(skillDir, 'evals/evals.json'), '{}');
  const home = path.join(root, 'home');
  mkdirSync(home);
  return { root, skillDir, dataDir: path.join(root, 'data'), env: { HOME: home } as NodeJS.ProcessEnv };
}

describe('skill install', () => {
  it('symlinks into the user skills dir (HOME, then CLAUDE_CONFIG_DIR) and tracks it', () => {
    const t = setup();
    const res = installSkill({ ...t, name: 'demo', target: 'user' });
    expect(res.linkPath).toBe(path.join(t.env.HOME!, '.claude/skills/demo'));
    expect(lstatSync(res.linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(res.linkPath)).toBe(t.skillDir);
    expect(listInstalls(t.dataDir, 'demo', t.skillDir)).toEqual([{ target: 'user', linkPath: res.linkPath }]);
    // idempotent
    expect(installSkill({ ...t, name: 'demo', target: 'user' }).linkPath).toBe(res.linkPath);

    const cfg = path.join(t.root, 'cfg');
    expect(installSkill({ ...t, name: 'demo', target: 'user', env: { ...t.env, CLAUDE_CONFIG_DIR: cfg } }).linkPath).toBe(path.join(cfg, 'skills/demo'));
  });

  it('installs into a project, validating the directory', () => {
    const t = setup();
    const project = path.join(t.root, 'proj');
    expect(() => installSkill({ ...t, name: 'demo', target: 'project', projectDir: project })).toThrow(/does not exist/);
    expect(() => installSkill({ ...t, name: 'demo', target: 'project', projectDir: 'rel' })).toThrow(/absolute/);
    expect(() => installSkill({ ...t, name: 'demo', target: 'project' })).toThrow(/absolute/);
    mkdirSync(project);
    expect(installSkill({ ...t, name: 'demo', target: 'project', projectDir: project }).linkPath).toBe(path.join(project, '.claude/skills/demo'));
  });

  it('refuses to overwrite something that is not our symlink, and uninstall removes only our link', () => {
    const t = setup();
    const foreign = path.join(t.env.HOME!, '.claude/skills/demo');
    mkdirSync(foreign, { recursive: true });
    expect(() => installSkill({ ...t, name: 'demo', target: 'user' })).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => uninstallSkill({ ...t, name: 'demo', target: 'user' })).toThrow(/not installed/);
    expect(lstatSync(foreign).isDirectory()).toBe(true);

    const t2 = setup();
    const { linkPath } = installSkill({ ...t2, name: 'demo', target: 'user' });
    expect(uninstallSkill({ ...t2, name: 'demo', target: 'user' })).toEqual([linkPath]);
    expect(() => lstatSync(linkPath)).toThrow();
    expect(listInstalls(t2.dataDir, 'demo', t2.skillDir)).toEqual([]);
  });

  it('prunes tracked installs whose link is gone', () => {
    const t = setup();
    const { linkPath } = installSkill({ ...t, name: 'demo', target: 'user' });
    uninstallSkill({ ...t, name: 'demo', target: 'user' });
    installSkill({ ...t, name: 'demo', target: 'user' });
    // simulate the user deleting the link by hand
    rmSync(linkPath);
    expect(listInstalls(t.dataDir, 'demo', t.skillDir)).toEqual([]);
  });
});

describe('skill export', () => {
  it('zips under <name>/ without evals/', () => {
    const t = setup();
    const files = unzipSync(exportSkillZip(t.skillDir, 'demo'));
    expect(Object.keys(files).sort()).toEqual(['demo/SKILL.md', 'demo/references/a.md']);
    expect(Buffer.from(files['demo/references/a.md']!).toString()).toBe('# a');
  });
});

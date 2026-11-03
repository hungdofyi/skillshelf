import { describe, expect, it } from 'vitest';
import { lintSkill, type SkillLintInput } from '../src/skills/skill-lint.js';

const good: SkillLintInput = {
  folderName: 'demo',
  hasFrontmatter: true,
  frontmatter: { name: 'demo', description: 'Audits things. Use when the user asks for an audit.' },
  body: '# Demo\n\n- [A](references/a.md)\n',
  files: ['SKILL.md', 'references/a.md', 'evals/evals.json'],
  evalsJson: JSON.stringify({ skill_name: 'demo', evals: [1, 2, 3].map((id) => ({ id, prompt: 'p', expectations: ['e'] })) }),
};
const codes = (input: Partial<SkillLintInput>) => lintSkill({ ...good, ...input }).map((i) => `${i.level}:${i.code}`);

describe('lintSkill', () => {
  it('accepts a good skill', () => expect(codes({})).toEqual([]));
  it('flags name problems', () => {
    expect(codes({ frontmatter: { ...good.frontmatter, name: 'my-claude-skill' } })).toEqual(expect.arrayContaining(['error:name-reserved', 'error:name-folder-mismatch']));
    expect(codes({ frontmatter: { ...good.frontmatter, name: 'Bad_Name' } })).toContain('error:name-format');
  });
  it('flags description problems', () => {
    expect(codes({ frontmatter: { name: 'demo', description: 'x'.repeat(1025) } })).toContain('error:description-too-long');
    expect(codes({ frontmatter: { name: 'demo', description: 'Use <b>this</b> when' } })).toContain('error:description-xml');
    expect(codes({ frontmatter: { name: 'demo', description: 'Audits things' } })).toContain('warning:description-no-trigger');
  });
  it('flags broken links and orphan references', () => {
    expect(codes({ body: '# D\n[x](references/missing.md)' })).toEqual(expect.arrayContaining(['error:link-broken', 'warning:reference-orphan']));
  });
  it('flags bad evals', () => {
    expect(codes({ evalsJson: '{oops' })).toContain('error:evals-json');
    expect(codes({ evalsJson: JSON.stringify({ evals: [{ id: 1, prompt: '', expectations: [] }, { id: 1, prompt: 'p', expectations: ['e'] }] }) })).toEqual(expect.arrayContaining(['error:eval-prompt', 'error:eval-ids']));
    expect(codes({ evalsJson: undefined })).toContain('info:evals-missing');
  });
  it('requires frontmatter and a body', () => {
    expect(codes({ hasFrontmatter: false, frontmatter: {} })).toEqual(expect.arrayContaining(['error:frontmatter-missing', 'error:name-missing', 'error:description-missing']));
    expect(codes({ body: '  \n' })).toContain('error:body-empty');
  });
});

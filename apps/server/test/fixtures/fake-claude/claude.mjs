#!/usr/bin/env node
// Fake `claude` CLI for tests. Never talks to any network. Behaviour is driven by env vars:
//   FAKE_CLAUDE_AUTH      claude.ai (default) | api-key | logged-out
//   FAKE_CLAUDE_LOG       file; one JSON line {argv,cwd,envKeys,prompt} appended per print-mode call
//   FAKE_CLAUDE_GENERATE  ok (default) | bad-first (broken link, fixed by the lint pass) | always-bad | none
//   FAKE_CLAUDE_SLEEP_MS  wait this long after the init event (cancel tests)
//   FAKE_CLAUDE_JUDGE     garbage = judge returns unparsable text
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const env = process.env;
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');

if (argv[0] === '--version') {
  console.log('2.1.317 (Claude Code)');
  process.exit(0);
}
if (argv[0] === 'auth' && argv[1] === 'status') {
  const mode = env.FAKE_CLAUDE_AUTH ?? 'claude.ai';
  if (mode === 'logged-out') {
    console.log(JSON.stringify({ loggedIn: false }));
    process.exit(1);
  }
  console.log(JSON.stringify({ loggedIn: true, authMethod: mode, email: 'test@example.com', orgName: 'Test Org' }));
  process.exit(0);
}

const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;

if (env.FAKE_CLAUDE_LOG) {
  appendFileSync(env.FAKE_CLAUDE_LOG, JSON.stringify({ argv, cwd: process.cwd(), envKeys: Object.keys(env), prompt }) + '\n');
}

const sid = 'fake-session';
emit({ type: 'system', subtype: 'init', session_id: sid, model: flag('--model') });
if (env.FAKE_CLAUDE_SLEEP_MS) await new Promise((r) => setTimeout(r, Number(env.FAKE_CLAUDE_SLEEP_MS)));

const tool = (name, input) => emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const say = (text) => emit({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
// Never resolves: flushes the result line, then exits.
const finish = (text, extra = {}) =>
  new Promise(() => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 3, duration_ms: 42, session_id: sid, ...extra });
    process.stdout.write(line + '\n', () => process.exit(0));
  });
const write = (rel, content) => {
  mkdirSync(path.dirname(rel), { recursive: true });
  writeFileSync(rel, content);
  tool('Write', { file_path: path.resolve(rel), content });
};

const title = prompt.split('\n')[0];
const outDir = /(?:Output|Skill) directory: (skills\/[a-z0-9-]+)\//.exec(prompt)?.[1];

const skillMd = (name, link) => `---
name: ${name}
description: Audits things. Use when the user asks to audit things.
---

# ${name}

Do the audit.

## References

- [Topic](${link}): when auditing
`;

if (title.startsWith('# Generate a skill')) {
  const name = path.basename(outDir);
  const mode = env.FAKE_CLAUDE_GENERATE ?? 'ok';
  tool('Read', { file_path: path.resolve('books/demo/book.json') });
  if (mode === 'none') await finish('did nothing');
  write(`${outDir}/SKILL.md`, skillMd(name, mode === 'ok' ? 'references/topic.md' : 'references/missing.md'));
  write(`${outDir}/references/topic.md`, '# Topic\n\nSome content.\n');
  write(
    `${outDir}/evals/evals.json`,
    JSON.stringify({
      skill_name: 'wrong-name',
      evals: [
        { id: 1, prompt: 'Audit my flow', expectations: ['Mentions a thing', 'Mentions another'] },
        { id: 2, prompt: 'Audit my other flow', expectations: ['Mentions a third thing'] },
        { id: 3, prompt: 'OFFTOPIC what is a flow', expectations: [], should_trigger: false },
      ],
    }),
  );
  await finish('Generated.');
}
if (title.startsWith('# Fix lint errors')) {
  const name = path.basename(outDir);
  if ((env.FAKE_CLAUDE_GENERATE ?? 'ok') === 'bad-first') write(`${outDir}/SKILL.md`, skillMd(name, 'references/topic.md'));
  await finish('Fixed.');
}
if (title.startsWith('# Revise an existing skill')) {
  const file = `${outDir}/SKILL.md`;
  tool('Read', { file_path: path.resolve(file) });
  write(file, readFileSync(file, 'utf8') + '\nRevised according to feedback.\n');
  await finish('Revised.');
}
if (title.startsWith('# Grade an answer')) {
  if (env.FAKE_CLAUDE_JUDGE === 'garbage') await finish('I refuse to output JSON');
  const expectations = JSON.parse(/<expectations>\s*([\s\S]*?)\s*<\/expectations>/.exec(prompt)[1]);
  const answer = /<answer>\n([\s\S]*?)\n<\/answer>/.exec(prompt)[1];
  const skilled = answer.includes('USED_SKILL');
  const verdict = {
    expectations: expectations.map((text) => ({ text, passed: skilled && !text.includes('[always-fail]'), evidence: skilled ? 'USED_SKILL' : 'not found' })),
    summary: 'fake verdict',
  };
  await finish(JSON.stringify(verdict), { structured_output: verdict });
}

// Agent mode (eval): trigger the skill when one is installed in the sandbox and the prompt is on-topic.
const skillsDir = path.resolve('.claude/skills');
const installed = existsSync(skillsDir) ? readdirSync(skillsDir) : [];
let usedSkill = false;
if (installed.length && !prompt.includes('OFFTOPIC')) {
  tool('Skill', { skill: installed[0] });
  usedSkill = true;
}
if (prompt.includes('WRITEFILE')) write('report.md', '# Report\nproduced file\n');
say('thinking');
await finish(`Answer to: ${prompt.slice(0, 30)}${usedSkill ? ' USED_SKILL' : ''}`);

/** Did the agent use a skill? Looks at the tool calls recorded during a run. */
import type { ClaudeToolUse } from './stream-json-parser.js';

/** True if the skill name appears as a whole token (names are kebab-case, so "-" is part of a token). */
function mentionsName(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9-])${escaped}($|[^a-z0-9-])`, 'i').test(text);
}

export function detectSkillTrigger(toolUses: ClaudeToolUse[], skillName: string): boolean {
  return toolUses.some((use) => {
    if (use.name === 'Skill') return mentionsName(JSON.stringify(use.input), skillName);
    if (use.name === 'Read') {
      const file = typeof use.input.file_path === 'string' ? use.input.file_path : '';
      return file.replace(/\\/g, '/').includes(`.claude/skills/${skillName}/`);
    }
    return false;
  });
}

# Fix lint errors in a skill

The skill in `{{output_dir}}` failed the automatic checks below. Fix **only** what is needed to clear every error. Do not improve, restructure or extend anything else, and keep the content otherwise byte-identical.

Skill name: `{{skill_name}}`
Skill directory: {{output_dir}}

## Errors

{{lint_errors}}

## How to fix common codes

- `frontmatter-missing` / `frontmatter-invalid`: `SKILL.md` must start with `---`, valid YAML, then `---`. Quote or use a folded scalar (`description: >-`) for values containing colons or quotes.
- `name-*`: `name` must be lowercase letters, digits and single hyphens, at most 64 characters, must not contain "anthropic" or "claude", and must equal the folder name `{{skill_name}}`.
- `description-missing`, `description-too-long`, `description-xml`: the description is required, at most 1024 characters, third person, no angle-bracket tags. Shorten by cutting examples, not the "when to use" clause.
- `body-empty`: the body after the frontmatter must contain the skill instructions.
- `link-broken`: a Markdown link in `SKILL.md` points at a file that does not exist. Either create the missing file with real content from the context of the skill, or correct the path to the file that does exist (use `Glob` on `{{output_dir}}**/*`). Prefer correcting the path.
- `metadata-shape`: `metadata` must be a flat map of string keys to string values.
- `evals-json`, `evals-shape`, `eval-prompt`, `eval-ids`: `evals/evals.json` must be valid JSON of the form `{ "skill_name": "{{skill_name}}", "evals": [ { "id": 1, "prompt": "...", "expectations": ["..."] } ] }` with unique ids and a non-empty prompt per case. Repair the syntax or the shape; keep every case's wording.
- `compatibility-too-long`: shorten to 500 characters or fewer.

## Rules

- Write only inside `{{output_dir}}`. Use only `Read`, `Glob`, `Grep`, `Write`, `Edit`.
- Read each affected file before editing it. After the edits, re-read the changed parts to confirm the errors above are gone.
- Final message: one line per fix.

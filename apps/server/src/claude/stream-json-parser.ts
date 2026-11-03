/**
 * Incremental parser for `claude -p --output-format stream-json --verbose` lines.
 *
 * Line shapes used (others are ignored):
 *  {"type":"system","subtype":"init","model":...,"tools":[...],"session_id":...}
 *  {"type":"assistant","message":{"content":[{"type":"text","text":...},{"type":"tool_use","name":...,"input":{...}}]}}
 *  {"type":"user","message":{"content":[{"type":"tool_result","is_error":bool,"content":...}]}}
 *  {"type":"result","is_error":bool,"result":"...","num_turns":n,"duration_ms":n,"session_id":...,"structured_output":{...}}
 */
import path from 'node:path';

export interface ClaudeToolUse {
  name: string;
  input: Record<string, unknown>;
}

/** Compact event for job logs. */
export interface ClaudeEvent {
  kind: 'init' | 'text' | 'tool' | 'tool-error' | 'result';
  message: string;
  data?: Record<string, unknown>;
}

export interface ParserState {
  finished: boolean;
  text: string;
  structured?: unknown;
  isError: boolean;
  numTurns: number;
  durationMs: number;
  sessionId?: string;
  toolUses: ClaudeToolUse[];
}

/** Loose view of one CLI JSON line; every field is validated where it is read. */
interface RawMessage {
  type?: string;
  subtype?: string;
  model?: unknown;
  session_id?: unknown;
  message?: { content?: unknown };
  is_error?: unknown;
  result?: unknown;
  num_turns?: unknown;
  duration_ms?: unknown;
  structured_output?: unknown;
}

const TEXT_EXCERPT = 240;

function excerpt(text: string, max = TEXT_EXCERPT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** "Read books/x/markdown/03-y.md", "Write skills/z/SKILL.md", "Skill onboarding-audit". Paths are made cwd-relative. */
export function summarizeToolUse(use: ClaudeToolUse, cwd?: string): string {
  const input = use.input;
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined);
  const rel = (p: string) => {
    if (cwd && path.isAbsolute(p)) {
      const r = path.relative(cwd, p);
      if (r && !r.startsWith('..')) return r.split(path.sep).join('/');
    }
    return p;
  };
  const file = str('file_path') ?? str('path');
  switch (use.name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return `${use.name} ${file ? rel(file) : ''}`.trim();
    case 'Glob':
      return `Glob ${str('pattern') ?? ''}`.trim();
    case 'Grep':
      return `Grep ${excerpt(str('pattern') ?? '', 80)}`.trim();
    case 'Skill':
      return `Skill ${str('skill') ?? str('command') ?? str('name') ?? ''}`.trim();
    default:
      return use.name;
  }
}

export class StreamJsonParser {
  private s: ParserState = { finished: false, text: '', isError: false, numTurns: 0, durationMs: 0, toolUses: [] };
  /** Text of the last assistant message; fallback when the result event carries no text. */
  private lastAssistantText = '';

  constructor(private readonly cwd?: string) {}

  state(): ParserState {
    return { ...this.s, text: this.s.text || this.lastAssistantText };
  }

  /** Feed one raw line; returns the log events it produced. */
  push(line: string): ClaudeEvent[] {
    let msg: RawMessage;
    try {
      msg = JSON.parse(line) as RawMessage;
    } catch {
      return [];
    }
    if (typeof msg !== 'object' || msg === null) return [];
    const events: ClaudeEvent[] = [];
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          if (typeof msg.session_id === 'string') this.s.sessionId = msg.session_id;
          events.push({ kind: 'init', message: `Claude session started${msg.model ? ` (${String(msg.model)})` : ''}` });
        }
        break;
      case 'assistant': {
        const blocks: unknown[] = Array.isArray(msg.message?.content) ? msg.message.content : [];
        const texts: string[] = [];
        for (const raw of blocks) {
          const block = raw as { type?: string; text?: string; name?: string; input?: Record<string, unknown> };
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            texts.push(block.text);
            events.push({ kind: 'text', message: excerpt(block.text) });
          } else if (block.type === 'tool_use' && typeof block.name === 'string') {
            const use: ClaudeToolUse = { name: block.name, input: block.input ?? {} };
            this.s.toolUses.push(use);
            events.push({ kind: 'tool', message: summarizeToolUse(use, this.cwd), data: { tool: use.name } });
          }
        }
        if (texts.length) this.lastAssistantText = texts.join('\n');
        break;
      }
      case 'user': {
        const blocks: unknown[] = Array.isArray(msg.message?.content) ? msg.message.content : [];
        for (const raw of blocks) {
          const block = raw as { type?: string; is_error?: boolean; content?: unknown };
          if (block.type === 'tool_result' && block.is_error) {
            const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
            events.push({ kind: 'tool-error', message: `Tool error: ${excerpt(text, 200)}` });
          }
        }
        break;
      }
      case 'result':
        this.s.finished = true;
        this.s.isError = msg.is_error === true || (typeof msg.subtype === 'string' && msg.subtype.startsWith('error'));
        this.s.text = typeof msg.result === 'string' ? msg.result : '';
        this.s.numTurns = typeof msg.num_turns === 'number' ? msg.num_turns : 0;
        this.s.durationMs = typeof msg.duration_ms === 'number' ? msg.duration_ms : 0;
        if (typeof msg.session_id === 'string') this.s.sessionId = msg.session_id;
        if (msg.structured_output !== undefined) this.s.structured = msg.structured_output;
        events.push({ kind: 'result', message: this.s.isError ? `Claude finished with an error after ${this.s.numTurns} turns` : `Claude finished in ${this.s.numTurns} turns` });
        break;
      default:
        break;
    }
    return events;
  }
}

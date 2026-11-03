/**
 * HTTP contract between apps/server (Hono, port 4317) and apps/web.
 * All paths in requests/responses are POSIX paths relative to LIBRARY_DIR
 * unless a field says otherwise. The server rejects paths that escape LIBRARY_DIR.
 *
 *  GET    /api/health                         -> { ok: true, libraryDir: string }
 *  GET    /api/tree                           -> TreeResponse
 *  GET    /api/file?path=                     -> FileResponse
 *  GET    /api/raw?path=                      -> raw bytes with content-type (PDF/image preview)
 *  PUT    /api/file                           <- WriteFileRequest     -> FileResponse
 *  POST   /api/file/rename                    <- RenameRequest        -> { ok: true }
 *  DELETE /api/file?path=                     -> { ok: true }          (moves to .data/trash)
 *  POST   /api/folder                         <- { path }             -> { ok: true }
 *  GET    /api/events                         -> text/event-stream of ServerEvent
 *
 *  GET    /api/books                          -> BookSummary[]
 *  GET    /api/books/:slug                    -> BookSummary
 *  POST   /api/books/import                   multipart: file (pdf|epub), slug?  -> { book: BookSummary, job: Job }
 *  POST   /api/books/:slug/convert            <- ConvertRequest       -> { job: Job }
 *  POST   /api/books/:slug/summarize          <- SummarizeBookRequest -> { job: Job, path: string }
 *
 *  GET    /api/skills                         -> SkillSummary[]
 *  GET    /api/skills/:name                   -> SkillSummary
 *  POST   /api/skills/generate                <- GenerateSkillRequest -> { job: Job }
 *  POST   /api/skills/:name/revise            <- ReviseSkillRequest   -> { job: Job }
 *  POST   /api/skills/:name/install           <- InstallSkillRequest  -> InstallSkillResponse
 *  DELETE /api/skills/:name/install?target=   -> { ok: true }          (removes the symlink only)
 *  GET    /api/skills/:name/export            -> application/zip of the skill folder (for claude.ai upload)
 *
 *  GET    /api/evals/:skill/runs              -> EvalRun[] (newest first, results omitted)
 *  GET    /api/evals/:skill/runs/:runId       -> EvalRun
 *  POST   /api/evals/:skill/run               <- RunEvalRequest       -> { job: Job, runId: string }
 *
 *  GET    /api/jobs                           -> Job[] (newest first)
 *  GET    /api/jobs/:id                       -> Job
 *  GET    /api/jobs/:id/log                   -> JobLogLine[]
 *  POST   /api/jobs/:id/cancel                -> { ok: true }
 *
 *  GET    /api/claude/status                  -> ClaudeStatus
 *  GET    /api/mcp/info                       -> McpInfo
 *  POST   /api/mcp/tunnel/start               -> McpInfo
 *  POST   /api/mcp/tunnel/stop                -> McpInfo
 *  POST   /api/mcp/token/rotate               -> McpInfo
 *
 *  ALL    /mcp/:token  and  /:token/mcp       MCP Streamable HTTP endpoint (token in path; publicUrl uses /<token>/mcp)
 *         The public tunnel targets a separate MCP-only listener (MCP_PUBLIC_PORT, default PORT+1); /api is local-only.
 *  ALL    /mcp                                MCP endpoint with `Authorization: Bearer <token>`
 */

import type { BookSummary, BookSummaryFile, EvalArm, SkillSummary } from './library-types.js';

export type GitFileStatus = 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed' | 'ignored';

export interface TreeNode {
  name: string;
  /** Relative to LIBRARY_DIR; "" for the root. */
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
  size?: number;
  mtimeMs?: number;
  git?: GitFileStatus;
  /** Server hint so the UI can pick a view without re-deriving it. */
  kind?: 'book' | 'skill' | 'eval-run' | 'skill-file' | 'book-chapter' | 'markdown' | 'json' | 'binary' | 'other';
}

export interface TreeResponse {
  root: TreeNode;
  libraryDir: string;
  git: { isRepo: boolean; branch?: string; dirty?: number };
}

export interface FileResponse {
  path: string;
  /** UTF-8 text; absent for binary files. */
  content?: string;
  binary: boolean;
  size: number;
  mtimeMs: number;
}

export interface WriteFileRequest {
  path: string;
  content: string;
  /** Optimistic concurrency: reject with 409 when the file changed since this mtime. */
  expectedMtimeMs?: number;
  /** Create a new file only: reject with 409 when the path already exists (used by "New file"). */
  createOnly?: boolean;
}

export interface RenameRequest {
  from: string;
  to: string;
}

export interface ConvertRequest {
  ocr?: 'auto' | 'off' | 'force';
  images?: boolean;
}

export interface GenerateSkillRequest {
  /** One or more book slugs to draw from. */
  books: string[];
  /** What the skill should do, e.g. "Audit the onboarding flow of a SaaS app". */
  goal: string;
  /** kebab-case skill name; suggested from the goal when omitted. */
  name?: string;
  /** Optional extra guidance: audience, output format, tone. */
  notes?: string;
  /** Limit to these chapter indexes per book slug; all chapters when omitted. */
  chapters?: Record<string, number[]>;
  model?: string;
  /** Reasoning effort. Default high. */
  effort?: Effort;
  /** Also write evals/evals.json. Default true. */
  withEvals?: boolean;
}

/** Claude Code `--effort` level: how much reasoning a run spends. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export type SummaryLength = 'brief' | 'standard' | 'detailed';
export type SummaryStructure = 'chapters' | 'ideas' | 'both';

export interface SummarizeBookRequest {
  /** brief = 2-3 sentences per chapter; standard = a short paragraph + 3-5 key ideas; detailed = several paragraphs + ideas + examples. Default standard. */
  length?: SummaryLength;
  /** chapters = chapter-by-chapter guide; ideas = key ideas across the book; both. Default both. */
  structure?: SummaryStructure;
  /** Optional reader context (max 500 chars); adds per-chapter relevance and a suggested reading path. */
  focus?: string;
  /** Chapter indexes to cover; all when omitted. */
  chapters?: number[];
  model?: string;
  /** Reasoning effort. Default medium. */
  effort?: Effort;
}

export interface ReviseSkillRequest {
  feedback: string;
  /** Include failed cases from this eval run as context for the revision. */
  evalRunId?: string;
  model?: string;
  /** Reasoning effort. Default high. */
  effort?: Effort;
}

export type InstallTarget = 'user' | 'project';

export interface InstallSkillRequest {
  target: InstallTarget;
  /** Absolute project path; required when target = "project". */
  projectDir?: string;
}

export interface InstallSkillResponse {
  /** Absolute path of the symlink that was created. */
  linkPath: string;
  target: InstallTarget;
}

export interface RunEvalRequest {
  arms?: EvalArm[];
  /** Run only these case ids; all when omitted. */
  caseIds?: Array<string | number>;
  model?: string;
  judgeModel?: string;
  /** Effort of the agent arms. Default medium. The judge always runs at low. */
  effort?: Effort;
  /** Parallel claude runs. Default 2. */
  concurrency?: number;
}

export type JobKind = 'convert' | 'generate' | 'revise' | 'eval' | 'summarize';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  title: string;
  /** Library path the job works on, e.g. "books/onboarding" or "skills/onboarding-audit". */
  target: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: { current: number; total: number; label?: string };
  error?: string;
  /** Kind-specific result, e.g. { runId } for eval, { skill } for generate, { path } for summarize. */
  result?: Record<string, unknown>;
}

export interface JobLogLine {
  ts: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  /** Structured detail, e.g. a tool call summary from a claude stream-json event. */
  data?: Record<string, unknown>;
}

export type ServerEvent =
  | { type: 'fs'; event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; path: string }
  | { type: 'job'; job: Job }
  | { type: 'job-log'; jobId: string; line: JobLogLine }
  | { type: 'mcp'; info: McpInfo };

export interface ClaudeStatus {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  /** Runs are allowed only when this is "claude.ai" (subscription login, no API billing). */
  authMethod?: string;
  email?: string;
  orgName?: string;
  /** True when the child env still had ANTHROPIC_* after stripping (should never happen). */
  apiKeyLeak: boolean;
  ready: boolean;
  reason?: string;
}

export interface McpInfo {
  /** Local Streamable HTTP URL including the token path segment. */
  localUrl: string;
  /** Public URL via cloudflared quick tunnel, when running. */
  publicUrl?: string;
  tunnel: { status: 'stopped' | 'starting' | 'running' | 'error' | 'unavailable'; error?: string; pid?: number };
  tokenPreview: string;
  /** Shell command that registers the stdio server with Claude Code. */
  claudeCodeCommand: string;
  tools: Array<{ name: string; description: string }>;
}

export type { BookSummary, BookSummaryFile, SkillSummary };

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookSummary, ClaudeStatus, ConvertRequest, EvalRun, FileResponse, GenerateSkillRequest, InstallSkillRequest,
  InstallSkillResponse, Job, JobLogLine, McpInfo, ReviseSkillRequest, RunEvalRequest, SkillSummary, TreeResponse,
  SummarizeBookRequest, WriteFileRequest,
} from '@b2s/shared';
import { api, qs } from './client';

/** Query keys in one place so the event provider can invalidate precisely. */
export const keys = {
  tree: ['tree'] as const,
  file: (path: string) => ['file', path] as const,
  books: ['books'] as const,
  book: (slug: string) => ['book', slug] as const,
  skills: ['skills'] as const,
  skill: (name: string) => ['skill', name] as const,
  runs: (skill: string) => ['runs', skill] as const,
  run: (skill: string, id: string) => ['run', skill, id] as const,
  jobs: ['jobs'] as const,
  jobLog: (id: string) => ['job-log', id] as const,
  claude: ['claude'] as const,
  mcp: ['mcp'] as const,
};

export const useTree = () => useQuery({ queryKey: keys.tree, queryFn: () => api<TreeResponse>('/api/tree'), placeholderData: keepPreviousData });
// keepPreviousData: switching files shows the current file until the next arrives (no spinner flash);
// editors check `isPlaceholderData` so nothing is edited against the wrong path.
export const useFile = (path: string | null) =>
  useQuery({ queryKey: keys.file(path ?? ''), queryFn: () => api<FileResponse>(`/api/file?${qs({ path: path! })}`), enabled: !!path, retry: false, placeholderData: keepPreviousData });
export const useBooks = () => useQuery({ queryKey: keys.books, queryFn: () => api<BookSummary[]>('/api/books') });
export const useBook = (slug: string | null) =>
  useQuery({ queryKey: keys.book(slug ?? ''), queryFn: () => api<BookSummary>(`/api/books/${encodeURIComponent(slug!)}`), enabled: !!slug, retry: false });
export const useSkill = (name: string | null) =>
  useQuery({ queryKey: keys.skill(name ?? ''), queryFn: () => api<SkillSummary>(`/api/skills/${encodeURIComponent(name!)}`), enabled: !!name, retry: false });
export const useRuns = (skill: string | null) =>
  useQuery({ queryKey: keys.runs(skill ?? ''), queryFn: () => api<EvalRun[]>(`/api/evals/${encodeURIComponent(skill!)}/runs`), enabled: !!skill });
export const useRun = (skill: string | null, id: string | null) =>
  useQuery({
    queryKey: keys.run(skill ?? '', id ?? ''),
    queryFn: () => api<EvalRun>(`/api/evals/${encodeURIComponent(skill!)}/runs/${encodeURIComponent(id!)}`),
    enabled: !!skill && !!id,
    retry: false,
    // Fallback to SSE-driven invalidation while a run is live.
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 5000 : false),
  });
export const useJobs = () => useQuery({ queryKey: keys.jobs, queryFn: () => api<Job[]>('/api/jobs') });
export const useJobLog = (id: string | null) =>
  useQuery({ queryKey: keys.jobLog(id ?? ''), queryFn: () => api<JobLogLine[]>(`/api/jobs/${encodeURIComponent(id!)}/log`), enabled: !!id, staleTime: Infinity });
export const useClaudeStatus = () => useQuery({ queryKey: keys.claude, queryFn: () => api<ClaudeStatus>('/api/claude/status'), staleTime: 30_000, refetchInterval: 60_000 });
export const useMcpInfo = () => useQuery({ queryKey: keys.mcp, queryFn: () => api<McpInfo>('/api/mcp/info') });

/** Insert or replace a job in the cached list (newest first). */
export function upsertJob(list: Job[] | undefined, job: Job): Job[] {
  const current = list ?? [];
  const i = current.findIndex((j) => j.id === job.id);
  if (i < 0) return [job, ...current];
  const next = current.slice();
  next[i] = job;
  return next;
}

// ---- mutations (errors surface through the QueryClient's MutationCache toast) ----

export function useWriteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: WriteFileRequest) => api<FileResponse>('/api/file', { method: 'PUT', json: req }),
    meta: { silent: true }, // callers handle 409 themselves
    onSuccess: (file) => qc.setQueryData(keys.file(file.path), file),
  });
}

export const useGenerateSkill = () =>
  useMutation({ mutationFn: (req: GenerateSkillRequest) => api<{ job: Job }>('/api/skills/generate', { method: 'POST', json: req }) });
export const useSummarizeBook = (slug: string) =>
  useMutation({ mutationFn: (req: SummarizeBookRequest) => api<{ job: Job; path: string }>(`/api/books/${encodeURIComponent(slug)}/summarize`, { method: 'POST', json: req }) });
export const useReviseSkill = (name: string) =>
  useMutation({ mutationFn: (req: ReviseSkillRequest) => api<{ job: Job }>(`/api/skills/${encodeURIComponent(name)}/revise`, { method: 'POST', json: req }) });
export const useConvertBook = (slug: string) =>
  useMutation({ mutationFn: (req: ConvertRequest) => api<{ job: Job }>(`/api/books/${encodeURIComponent(slug)}/convert`, { method: 'POST', json: req }) });
export const useRunEval = (skill: string) =>
  useMutation({ mutationFn: (req: RunEvalRequest) => api<{ job: Job; runId: string }>(`/api/evals/${encodeURIComponent(skill)}/run`, { method: 'POST', json: req }) });
export const useInstallSkill = (name: string) =>
  useMutation({ mutationFn: (req: InstallSkillRequest) => api<InstallSkillResponse>(`/api/skills/${encodeURIComponent(name)}/install`, { method: 'POST', json: req }) });
export const useUninstallSkill = (name: string) =>
  useMutation({
    mutationFn: (v: { target: 'user' | 'project'; projectDir?: string }) =>
      api<{ ok: true }>(`/api/skills/${encodeURIComponent(name)}/install?${qs({ target: v.target, projectDir: v.projectDir })}`, { method: 'DELETE' }),
  });
export const useCancelJob = () =>
  useMutation({ mutationFn: (id: string) => api<{ ok: true }>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }) });

export function useMcpAction(action: 'tunnel/start' | 'tunnel/stop' | 'token/rotate') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<McpInfo>(`/api/mcp/${action}`, { method: 'POST' }),
    onSuccess: (info) => qc.setQueryData(keys.mcp, info),
  });
}

export const useSkills = () => useQuery({ queryKey: keys.skills, queryFn: () => api<SkillSummary[]>('/api/skills') });

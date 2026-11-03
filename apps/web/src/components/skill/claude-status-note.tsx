import { CheckCircle2, XCircle } from 'lucide-react';
import type { ClaudeStatus } from '@b2s/shared';

/** One-line readiness of the headless Claude login, with the reason when blocked. */
export function ClaudeStatusNote({ status, loading }: { status?: ClaudeStatus; loading: boolean }) {
  if (loading || !status) return <p className="text-muted">Checking Claude login…</p>;
  return status.ready ? (
    <p className="flex items-center gap-1.5 text-muted"><CheckCircle2 size={14} className="text-ok" aria-hidden />Runs on your claude.ai login{status.email ? ` (${status.email})` : ''}. No API billing.</p>
  ) : (
    <p role="alert" className="flex items-start gap-1.5 text-danger"><XCircle size={14} className="mt-0.5 shrink-0" aria-hidden />{status.reason ?? 'Claude is not ready. Run `claude auth login` with your claude.ai account.'}</p>
  );
}

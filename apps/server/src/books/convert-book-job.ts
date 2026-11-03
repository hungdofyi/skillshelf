/**
 * Convert job: runs the converter CLI on books/<slug>/source/<file> and streams its
 * JSON-line ConverterEvents into the job log/progress.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { ConvertRequest, ConverterEvent, Job } from '@b2s/shared';
import type { AppContext } from '../app-context.js';
import { HttpError } from '../http-error.js';
import type { JobContext } from '../jobs/job-manager.js';

export const CONVERTER_MISSING_MESSAGE = 'Converter not installed: run `pnpm bootstrap`';

const STAGES = ['open', 'extract', 'ocr', 'split', 'write'] as const;

export type OcrMode = NonNullable<ConvertRequest['ocr']>;

export function parseConvertRequest(body: unknown): Required<ConvertRequest> {
  const b = (body && typeof body === 'object' ? body : {}) as ConvertRequest;
  const ocr = b.ocr ?? 'auto';
  if (ocr !== 'auto' && ocr !== 'off' && ocr !== 'force') throw new HttpError(400, 'ocr must be auto, off or force');
  if (b.images !== undefined && typeof b.images !== 'boolean') throw new HttpError(400, 'images must be a boolean');
  return { ocr, images: b.images ?? false };
}

/** Queue a convert job for an existing book folder that already has a source file. */
export function startConvertJob(ctx: AppContext, slug: string, opts: Required<ConvertRequest>): Job {
  const book = ctx.books.get(slug);
  const target = `books/${slug}`;
  if (!book.sourceFile) throw new HttpError(409, `Book "${slug}" has no source file`);
  if (ctx.jobs.isBusy(target)) throw new HttpError(409, `Book "${slug}" is already being converted`);
  const bookDir = ctx.books.bookDir(slug);
  const source = path.join(ctx.config.libraryDir, book.sourceFile);
  return ctx.jobs.create({ kind: 'convert', title: `Convert ${slug}`, target }, (jc) => runConverter(ctx, jc, { bookDir, source, ...opts }));
}

interface RunArgs extends Required<ConvertRequest> {
  bookDir: string;
  source: string;
}

async function runConverter(ctx: AppContext, jc: JobContext, args: RunArgs): Promise<Record<string, unknown>> {
  const [cmd, ...prefix] = ctx.config.converterCommand;
  if (!cmd) throw new Error(CONVERTER_MISSING_MESSAGE);
  const argv = [...prefix, args.source, '--out', args.bookDir, '--json', '--ocr', args.ocr, ...(args.images ? ['--images'] : [])];
  const marker = path.join(args.bookDir, '.convert-failed');

  try {
    const result = await spawnConverter(cmd, argv, ctx.config.repoRoot, jc);
    rmSync(marker, { force: true });
    return result;
  } catch (err) {
    if (!jc.signal.aborted && existsSync(args.bookDir)) {
      writeFileSync(marker, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

function spawnConverter(cmd: string, argv: string[], cwd: string, jc: JobContext): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd, signal: jc.signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let manifest: string | undefined;
    let errorMessage: string | undefined;
    const stderrTail: string[] = [];

    createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.trim()) return;
      let ev: ConverterEvent;
      try {
        ev = JSON.parse(line) as ConverterEvent;
      } catch {
        jc.log(line, { level: 'debug' });
        return;
      }
      switch (ev?.type) {
        case 'progress': {
          const total = ev.total ?? STAGES.length;
          const current = ev.total !== undefined ? (ev.current ?? 0) : STAGES.indexOf(ev.stage) + 1;
          jc.progress(current, total, ev.message ?? ev.stage);
          jc.log(ev.message ?? `${ev.stage} ${current}/${total}`, { level: 'debug', data: { stage: ev.stage } });
          break;
        }
        case 'warning':
          jc.log(ev.message, { level: 'warn' });
          break;
        case 'done':
          manifest = ev.manifest;
          jc.log('Conversion finished');
          break;
        case 'error':
          errorMessage = ev.message;
          break;
        default:
          jc.log(line, { level: 'debug' });
      }
    });
    createInterface({ input: child.stderr }).on('line', (line) => {
      if (!line.trim()) return;
      stderrTail.push(line);
      if (stderrTail.length > 20) stderrTail.shift();
      jc.log(line, { level: 'info' });
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (jc.signal.aborted) return reject(new Error('Cancelled'));
      reject(new Error(err.code === 'ENOENT' ? CONVERTER_MISSING_MESSAGE : `Failed to start converter: ${err.message}`));
    });
    child.on('close', (code, signal) => {
      if (jc.signal.aborted) return reject(new Error('Cancelled'));
      if (errorMessage) return reject(new Error(errorMessage));
      if (code !== 0) {
        const tail = stderrTail.slice(-5).join('\n');
        const hint = /failed to spawn|no such file|not found/i.test(tail) ? `${CONVERTER_MISSING_MESSAGE}\n` : '';
        return reject(new Error(`${hint}Converter exited with ${signal ?? `code ${code}`}${tail ? `\n${tail}` : ''}`));
      }
      if (!manifest) return reject(new Error('Converter exited without reporting a manifest'));
      resolve({ manifest });
    });
  });
}

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { BookSummary, Job } from '@b2s/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { json, makeTestApp, waitJob, type TestApp } from './fixtures/make-test-app.js';

let t: TestApp;
beforeEach(() => (t = makeTestApp()));
afterEach(() => t.cleanup());

const PDF = Buffer.from('%PDF-1.4\n% fake pdf body\n');
/** Minimal stored-zip header: PK\3\4, 26 header bytes, "mimetype", content. */
function epubBytes(mime = 'application/epub+zip'): Buffer {
  const head = Buffer.alloc(30);
  head.write('PK\x03\x04', 0, 'latin1');
  return Buffer.concat([head, Buffer.from('mimetype'), Buffer.from(mime), Buffer.alloc(40)]);
}

/** Like macOS `zip`: the local header carries a 28-byte extra field between name and content. */
function epubBytesWithExtraField(): Buffer {
  const head = Buffer.alloc(30);
  head.write('PK\x03\x04', 0, 'latin1');
  head.writeUInt16LE(8, 26);
  head.writeUInt16LE(28, 28);
  return Buffer.concat([head, Buffer.from('mimetype'), Buffer.alloc(28, 0x55), Buffer.from('application/epub+zip'), Buffer.alloc(40)]);
}

function upload(name: string, bytes: Buffer, slug?: string): Promise<Response> {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], name));
  if (slug) form.set('slug', slug);
  return Promise.resolve(t.app.request('/api/books/import', { method: 'POST', body: form }));
}

describe('book routes', () => {
  it('imports a PDF, stores the source and runs the convert job', async () => {
    const res = await upload('My Great Book.pdf', PDF);
    expect(res.status).toBe(200);
    const { book, job } = (await res.json()) as { book: BookSummary; job: Job };
    expect(book.slug).toBe('my-great-book');
    expect(book.sourceFile).toBe('books/my-great-book/source/My-Great-Book.pdf');
    expect(job.kind).toBe('convert');
    expect(job.target).toBe('books/my-great-book');
    const done = await waitJob(t, job.id);
    expect(done.status).toBe('succeeded');
    const after = (await (await t.app.request('/api/books/my-great-book')).json()) as BookSummary;
    expect(after.status).toBe('converted');
    expect(((await (await t.app.request('/api/books')).json()) as BookSummary[]).map((b) => b.slug)).toEqual(['my-great-book']);
  });

  it('imports an EPUB with a custom slug and de-dupes slugs', async () => {
    const a = (await (await upload('x.epub', epubBytes(), 'Same Slug')).json()) as { book: BookSummary; job: Job };
    const b = (await (await upload('y.epub', epubBytes(), 'Same Slug')).json()) as { book: BookSummary; job: Job };
    const c = (await (await upload('z.epub', epubBytes(), 'Same Slug')).json()) as { book: BookSummary; job: Job };
    expect([a.book.slug, b.book.slug, c.book.slug]).toEqual(['same-slug', 'same-slug-2', 'same-slug-3']);
    await Promise.all([a, b, c].map((r) => waitJob(t, r.job.id)));
  });

  it('keeps a long book title whole in the folder name instead of cutting it mid-word', async () => {
    const title = 'product-led-onboarding-how-to-turn-new-users-into-lifelong-customers-and-advocates';
    const r = (await (await upload('long.epub', epubBytes(), title)).json()) as { book: BookSummary; job: Job };
    expect(r.book.slug).toBe(title);
    await waitJob(t, r.job.id);
  });

  it('accepts an EPUB whose mimetype entry has an extra field', async () => {
    expect((await upload('mac.epub', epubBytesWithExtraField())).status).toBe(200);
  });

  it('rejects bad magic bytes, wrong extension, missing file', async () => {
    expect((await upload('fake.pdf', Buffer.from('not a pdf at all'))).status).toBe(400);
    expect((await upload('fake.epub', Buffer.from('PK\x03\x04 but wrong'))).status).toBe(400);
    expect((await upload('fake.epub', epubBytes('text/plain'))).status).toBe(400);
    expect((await upload('book.txt', PDF)).status).toBe(400);
    expect((await upload('empty.pdf', Buffer.alloc(0))).status).toBe(400);
    const none = await t.app.request('/api/books/import', { method: 'POST', body: new FormData() });
    expect(none.status).toBe(400);
    expect(existsSync(path.join(t.libraryDir, 'books')) ? readdirSync(path.join(t.libraryDir, 'books')) : []).toEqual([]);
  });

  it('re-converts via /convert, validates options and returns 409 while busy', async () => {
    const { job } = (await (await upload('slow-book.pdf', PDF)).json()) as { job: Job };
    // slow converter keeps the job running
    const busy = await t.app.request('/api/books/slow-book/convert', json({}));
    expect(busy.status).toBe(409);
    t.ctx.jobs.cancel(job.id);
    await waitJob(t, job.id);

    expect((await t.app.request('/api/books/slow-book/convert', json({ ocr: 'bogus' }))).status).toBe(400);
    expect((await t.app.request('/api/books/nope/convert', json({}))).status).toBe(404);
  });
});

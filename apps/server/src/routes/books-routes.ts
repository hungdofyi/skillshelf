import { rmSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppContext } from '../app-context.js';
import { startConvertJob, parseConvertRequest } from '../books/convert-book-job.js';
import { MAX_BOOK_BYTES, detectBookFormat, sanitizeFileName, storeSource, uniqueSlug } from '../books/import-book.js';
import { HttpError } from '../http-error.js';

export function booksRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  app.get('/api/books', (c) => c.json(ctx.books.list()));
  app.get('/api/books/:slug', (c) => c.json(ctx.books.get(c.req.param('slug'))));

  app.post(
    '/api/books/import',
    bodyLimit({
      maxSize: MAX_BOOK_BYTES + 1024 * 1024,
      onError: (c) => c.json({ error: 'Upload is larger than 300 MB' }, 413),
    }),
    async (c) => {
      let form: Record<string, string | File | (string | File)[]>;
      try {
        form = await c.req.parseBody();
      } catch {
        throw new HttpError(400, 'Expected multipart/form-data with a "file" field');
      }
      const file = form.file;
      if (!(file instanceof File)) throw new HttpError(400, 'Missing "file" field');
      const format = await detectBookFormat(file);
      const rawSlug = typeof form.slug === 'string' && form.slug.trim() ? form.slug : path.basename(file.name, path.extname(file.name));
      const slug = uniqueSlug(ctx.books.booksDir, rawSlug);
      const bookDir = ctx.books.bookDir(slug);
      await storeSource(bookDir, sanitizeFileName(file.name, format), file);
      try {
        const job = startConvertJob(ctx, slug, { ocr: 'auto', images: false });
        return c.json({ book: ctx.books.get(slug), job });
      } catch (err) {
        rmSync(bookDir, { recursive: true, force: true });
        throw err;
      }
    },
  );

  app.post('/api/books/:slug/convert', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const job = startConvertJob(ctx, c.req.param('slug'), parseConvertRequest(body));
    return c.json({ job });
  });

  return app;
}

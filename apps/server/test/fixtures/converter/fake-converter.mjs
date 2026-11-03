// Fake converter following the ConverterEvent contract. Behaviour is chosen by the source file name:
//   *fail*  -> emits an error event, exit 1
//   *slow*  -> emits progress then hangs until killed
//   *crash* -> prints garbage + stderr, exit 3, no events
//   else    -> progress, warning, writes book.json, done
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [source, ...rest] = process.argv.slice(2);
const out = rest[rest.indexOf('--out') + 1];
const emit = (ev) => console.log(JSON.stringify(ev));
const name = path.basename(source);

emit({ type: 'progress', stage: 'open', message: 'opening' });
console.log('not json line');
console.log(JSON.stringify({ type: 'progress', stage: 'open', message: `argv ${rest.join(' ')}` }));
if (name.includes('slow')) {
  emit({ type: 'progress', stage: 'extract', current: 1, total: 10 });
  setInterval(() => {}, 1000);
} else if (name.includes('fail')) {
  emit({ type: 'error', message: 'boom: cannot parse' });
  process.exit(1);
} else if (name.includes('crash')) {
  console.error('uv: Failed to spawn: book-convert');
  process.exit(3);
} else {
  emit({ type: 'progress', stage: 'extract', current: 2, total: 4 });
  emit({ type: 'warning', message: 'low text density' });
  mkdirSync(path.join(out, 'markdown'), { recursive: true });
  writeFileSync(path.join(out, 'markdown', '01-intro.md'), '# Intro\n');
  writeFileSync(
    path.join(out, 'book.json'),
    JSON.stringify({
      schemaVersion: 1, slug: path.basename(out), title: 'Fake', authors: [],
      source: { file: `source/${name}`, format: 'pdf', sha256: 'x', bytes: 1 },
      converter: { engine: 'fake', version: '0', ocrPages: 0, convertedAt: new Date().toISOString() },
      chapters: [{ index: 0, title: 'Intro', file: 'markdown/01-intro.md', level: 1, words: 1 }],
      stats: { words: 1, warnings: [] },
    }),
  );
  emit({ type: 'done', manifest: 'book.json' });
}

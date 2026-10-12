/**
 * Incremental JSONL reader: parses only the bytes appended since the last call,
 * in chunks, so a huge session file never becomes one giant string.
 */
import fs from 'fs';

const CHUNK = 1 << 20;

/**
 * cache: Map<file, entry>; make(): per-file state fields; onLine(entry, line) per complete line.
 * A file that shrank is treated as rewritten and its state is rebuilt from scratch.
 */
export function tailFile(cache, file, make, onLine) {
  const size = fs.statSync(file).size;
  let c = cache.get(file);
  if (!c || size < c.size) { c = { size: 0, rest: Buffer.alloc(0), ...make() }; cache.set(file, c); }
  if (size === c.size) return c;

  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    let pos = c.size;
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos);
      if (n <= 0) break;
      pos += n;
      const data = Buffer.concat([c.rest, buf.subarray(0, n)]);
      const nl = data.lastIndexOf(10);
      if (nl < 0) { c.rest = data; continue; }
      for (const line of data.subarray(0, nl).toString('utf8').split('\n')) if (line) onLine(c, line);
      c.rest = Buffer.from(data.subarray(nl + 1));
    }
    c.size = pos;
  } finally { fs.closeSync(fd); }
  return c;
}

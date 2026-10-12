// Static file server for the built site (./dist).
// Uses only Node core modules, so it runs anywhere - including sandboxes that
// restrict child processes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'dist');
const PORT = Number(process.env.PORT || 5199);

/**
 * WHERE THE APP'S OWN DATA IS STORED.
 *
 * The library's transcribed numbers and the "is this even a buff" marks used to live
 * only in `localStorage`, which means clearing a browser cache destroyed hours of
 * hand-typed work with no way to get it back. A browser cannot write to disk, so the
 * page cannot fix that on its own -- this endpoint is the other half.
 *
 * It is a FILE, not a database, and deliberately so: it can be read, diffed, backed
 * up and put under version control like anything else in the project.
 *
 * OUTSIDE `dist/`, which the build DELETES and rewrites on every run. Data stored
 * there would be wiped by `node build.mjs`.
 */
const DATA_DIR = path.join(HERE, 'data', 'config');
const DATA_FILE = path.join(DATA_DIR, 'buff-library.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

if (!fs.existsSync(ROOT)) {
  console.error('dist/ not found - run `npm run build` first');
  process.exit(1);
}

/** How large a body the write endpoint will accept. */
const MAX_BODY = 32 * 1024 * 1024;

/**
 * Read a request body, with a cap.
 *
 * The cap matters even on a localhost tool: without it a runaway client can exhaust
 * memory, and this process is also serving the page being edited.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        // Stop reading, but do not destroy the socket before the reply is sent.
        req.pause();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Write the data file ATOMICALLY.
 *
 * Straight to the target would leave a truncated file if the process died mid-write,
 * and a truncated JSON file is worse than an old one: every reader would fail to
 * parse it and the data would look lost. So it is written beside the target and
 * renamed over it, which is atomic on the same filesystem.
 */
function writeDataFile(text) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

http
  .createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      // A malformed percent-escape throws from decodeURIComponent, which would
      // otherwise take the whole server down for one bad request.
      res.writeHead(400).end('bad request');
      return;
    }
    if (urlPath === '/') urlPath = '/index.html';

    /**
     * THE DATA ENDPOINT.
     *
     *   GET  /api/data  -> the stored file, or `{}` when there is none yet
     *   PUT  /api/data  -> replace it
     *
     * A `PUT` rather than a patch: the page holds the whole document in memory and
     * writes all of it, so a merge here would have to guess at deletions -- removing
     * a mark is exactly the case a naive merge gets wrong.
     *
     * A `POST` is accepted as a synonym, and only because `navigator.sendBeacon` --
     * the one request a browser finishes during unload -- cannot send anything else.
     * Refusing it would drop the last edit of any session closed mid-save.
     */
    if (urlPath === '/api/data') {
      if (req.method === 'GET') {
        let body = '{}';
        try {
          if (fs.existsSync(DATA_FILE)) body = fs.readFileSync(DATA_FILE, 'utf8');
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e.message || e) }));
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        res.end(body);
        return;
      }

      if (req.method === 'PUT' || req.method === 'POST') {
        readBody(req).then((text) => {
          // Reject anything that is not valid JSON BEFORE it reaches the disk. The
          // file is the only copy once the page trusts it, so a malformed body must
          // not be allowed to replace a good one.
          try {
            JSON.parse(text);
          } catch {
            res.writeHead(400, { 'Content-Type': MIME['.json'] });
            res.end(JSON.stringify({ error: 'body is not JSON' }));
            return;
          }
          try {
            writeDataFile(text);
          } catch (e) {
            res.writeHead(500, { 'Content-Type': MIME['.json'] });
            res.end(JSON.stringify({ error: String(e.message || e) }));
            return;
          }
          res.writeHead(200, { 'Content-Type': MIME['.json'] });
          res.end(JSON.stringify({ ok: true, bytes: Buffer.byteLength(text, 'utf8') }));
        }).catch((e) => {
          res.writeHead(e.message === 'body too large' ? 413 : 400);
          res.end(String(e.message || e));
        });
        return;
      }

      res.writeHead(405).end('GET or PUT');
      return;
    }

    // The app uses hash routing, but fall back to index.html for safety.
    let full = path.join(ROOT, urlPath);
    try {
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        full = path.join(ROOT, 'index.html');
      }
    } catch {
      full = path.join(ROOT, 'index.html');
    }

    // Prevent escaping the served root.
    if (!full.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });

    // The stream needs its OWN error handler.
    //
    // This server dies whenever `build.mjs` runs, and the reason is a race: the
    // build DELETES dist/ before writing it, so a request that passes the
    // `existsSync` check above can find the file gone by the time the stream
    // opens. An unhandled 'error' event on a ReadStream is thrown, and one
    // unhandled throw kills the process -- the server simply vanishes mid-review.
    //
    // A response already in flight cannot be retried here, so the stream is just
    // ended; the next request gets the rebuilt file.
    const stream = fs.createReadStream(full);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(404);
      res.end();
    });
    stream.pipe(res);
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`Planner: http://127.0.0.1:${PORT}/planner.html`);
    console.log(`Chars  : http://127.0.0.1:${PORT}/chars.html`);
  })
  // A port clash should say so rather than throwing a stack trace.
  .on('error', (e) => {
    console.error(e.code === 'EADDRINUSE'
      ? `port ${PORT} is already in use -- another server is running`
      : e.message);
    process.exit(1);
  });

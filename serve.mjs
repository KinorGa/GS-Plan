// Static file server for the built site (./dist).
// Uses only Node core modules, so it runs anywhere - including sandboxes that
// restrict child processes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The two rules the page also needs: what a Base URL means, and what the key's
// variable is called when nobody names one. Imported rather than copied, so
// `/api/vision` and a direct call cannot disagree about either. That module has no
// imports of its own, which is what lets a Node server load it at all.
import { chatCompletionsUrl, DEFAULT_KEY_ENV } from './src/lib/vision-client.js';

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

/**
 * The NAME of the environment variable that holds the key.
 *
 * The body names it; the body never carries the key. Anything that could not be an
 * environment variable is refused rather than looked up, so a request cannot ask
 * this server to read some other thing out of its own environment and forward it.
 */
function keyEnvName(keyEnv) {
  const name = String(keyEnv || '').trim() || DEFAULT_KEY_ENV;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`环境变量名不合法：${name}`);
  return name;
}

/**
 * Whether this process can see the key: the whole of `GET /api/vision`.
 *
 * Presence only, never the value. The point of the name-not-the-key change is that
 * the secret stops travelling through things that can leak it, and sending it back
 * down an HTTP response would undo exactly that.
 */
function probeKeyEnv(keyEnv) {
  const name = keyEnvName(keyEnv);
  return { ok: true, keyEnv: name, keyPresent: !!process.env[name] };
}

/**
 * Forward ONE image to a vision model and return its text.
 *
 * WHY THIS ENDPOINT EXISTS AT ALL. OpenAI-compatible endpoints do not answer a
 * browser's preflight -- a key in a page is a key anyone can lift -- so a direct
 * `fetch` from the app never reaches the model. The request has to leave from a
 * process that is not a page, and this server already is one.
 *
 * THE PROVIDER IS THE USER'S, so this is a relay and not an integration: any
 * `/chat/completions` works, including a local model that no hosted service could
 * reach. The key comes from THIS process's environment, under the name the page
 * gave (`USTC_API_KEY` by default), and is neither written to `data/` nor logged.
 *
 * A MISSING VARIABLE IS NOT AN ERROR. The page always names one, and a local model
 * needs none -- so an unset variable means "send no `Authorization` header", and
 * the reason is printed in this terminal, which is where the variable should have
 * been set. A hosted provider then answers `401` in its own words, as before.
 *
 * The request body is the OpenAI vision format: one user message holding a text
 * part and an image part. `temperature: 0` because reading a screenshot has one
 * right answer. The timeout is generous -- a slow local model on a 1600px
 * screenshot is minutes, not seconds.
 */
async function relayVision({ baseUrl, keyEnv, model, image, prompt }) {
  if (!model) throw new Error('model is required');
  if (!image) throw new Error('image is required');
  const url = chatCompletionsUrl(baseUrl);
  const name = keyEnvName(keyEnv);
  const key = process.env[name] || '';
  if (!key) {
    console.warn(`[vision] 环境变量 ${name} 没读到：本次不带 Authorization 头`
      + '（本地模型不需要 Key；托管接口请在启动本服务的终端里设置它，然后重启）');
  }

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: String(prompt || '') },
            { type: 'image_url', image_url: { url: String(image) } },
          ],
        }],
      }),
      signal: AbortSignal.timeout(180000),
    });
  } catch (e) {
    // A DNS/TLS/timeout failure. Named here rather than left to the page, which
    // can only say "the relay failed".
    throw new Error(`cannot reach ${url}: ${e.message || e}`);
  }

  const raw = await upstream.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch { /* the messages below report `raw` */ }

  if (!upstream.ok) {
    const detail = payload?.error?.message || payload?.error
      || raw.slice(0, 300) || upstream.statusText;
    throw new Error(`${upstream.status} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }

  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('the reply had no choices[0].message.content');
  return { text, model: payload?.model || model };
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

    /**
     * THE VISION RELAY. See `relayVision` above for why the hop is needed.
     *
     *   GET  /api/vision?keyEnv=USTC_API_KEY -> { ok, keyEnv, keyPresent }
     *   POST /api/vision  { baseUrl, keyEnv, model, image, prompt } -> { text }
     *
     * The GET is the panel asking about its own setup -- "can you see the
     * variable?" -- before a screenshot is sent, so that a forgotten `$env:` shows
     * up as a line in the form instead of as a 401 from three hops away.
     *
     * The upstream's status is passed through as 502 rather than as its own code:
     * a 401 from the model is not a 401 from THIS server, and a page that saw one
     * might reasonably try to authenticate against it. The message carries the
     * upstream's own wording, which is the part worth reading.
     */
    if (urlPath === '/api/vision') {
      if (req.method === 'GET') {
        let probe;
        try {
          probe = probeKeyEnv(new URL(req.url, 'http://x').searchParams.get('keyEnv'));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': MIME['.json'] });
          res.end(JSON.stringify({ error: String(e?.message || e) }));
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(probe));
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end('GET or POST');
        return;
      }
      readBody(req).then(async (body) => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': MIME['.json'] });
          res.end(JSON.stringify({ error: 'body is not JSON' }));
          return;
        }
        try {
          const out = await relayVision(parsed);
          res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(out));
        } catch (e) {
          res.writeHead(502, { 'Content-Type': MIME['.json'] });
          res.end(JSON.stringify({ error: String(e?.message || e) }));
        }
      }).catch((e) => {
        res.writeHead(e.message === 'body too large' ? 413 : 400);
        res.end(String(e.message || e));
      });
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

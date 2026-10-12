// Fetch a URL, preferring a DIRECT https connection and falling back to a SOCKS5
// proxy.
//
// WHY THIS EXISTS
//   The game's stat tables live on GitLab, and this sandbox blocks direct
//   sockets: `fetch`/`https` fail with a DNS or connect error. The machine's VPN
//   exposes a SOCKS5 proxy (127.0.0.1:10808 by default), so the same request is
//   retried through it by hand -- Node has no socks-proxy-agent installed.
//
//   Direct is tried FIRST because the proxy is a property of one machine, not of
//   the task: on a normal connection the script must work with nothing extra
//   configured. `STATS_PROXY=host:port` overrides the address, and
//   `STATS_PROXY=` (empty) disables the fallback entirely.
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';

const DEFAULT_PROXY = '127.0.0.1:10808';

const proxyAddress = () => {
  const raw = process.env.STATS_PROXY ?? DEFAULT_PROXY;
  if (!raw) return null;
  const [host, port] = raw.split(':');
  return { host, port: Number(port) || 10808 };
};

const UA = 'gs-plan-stats/1.0';

/* --------------------------------------------------------------- direct */

function httpsGet(rawUrl, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      rawUrl,
      { headers: { 'user-agent': UA, accept: 'application/json,*/*', 'accept-encoding': 'gzip, deflate' } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = decompress(Buffer.concat(chunks), res.headers['content-encoding']);
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
            resolve(httpsGet(new URL(res.headers.location, rawUrl).href, redirects - 1));
            return;
          }
          resolve({ status: res.statusCode, headers: res.headers, buf: body, text: body.toString('utf8') });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

/* ---------------------------------------------------------------- socks */

function socksConnect(destHost, destPort, proxy) {
  return new Promise((resolve, reject) => {
    const s = net.connect(proxy.port, proxy.host);
    let step = 0;
    s.once('error', reject);
    s.on('data', function onData(d) {
      if (step === 0) {
        if (d[0] !== 5 || d[1] !== 0) return reject(new Error('socks auth refused'));
        const h = Buffer.from(destHost);
        s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([destPort >> 8, destPort & 255])]));
        step = 1;
      } else if (step === 1) {
        if (d[1] !== 0) return reject(new Error('socks connect failed code=' + d[1]));
        s.removeListener('data', onData);
        resolve(s);
      }
    });
    s.write(Buffer.from([5, 1, 0]));
  });
}

function dechunk(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf('\r\n', i);
    if (nl < 0) break;
    const size = parseInt(buf.slice(i, nl).toString('latin1'), 16);
    if (!Number.isFinite(size) || size === 0) break;
    out.push(buf.slice(nl + 2, nl + 2 + size));
    i = nl + 2 + size + 2;
  }
  return Buffer.concat(out);
}

async function socksGet(rawUrl, proxy, redirects = 5) {
  const u = new URL(rawUrl);
  const raw = await socksConnect(u.hostname, u.port ? Number(u.port) : 443, proxy);
  const socket = tls.connect({ socket: raw, servername: u.hostname });
  await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
  socket.write(
    `GET ${u.pathname + u.search} HTTP/1.1\r\nHost: ${u.hostname}\r\nUser-Agent: ${UA}\r\n` +
      `Accept: application/json,*/*\r\nAccept-Encoding: gzip, deflate\r\nConnection: close\r\n\r\n`
  );
  const chunks = [];
  socket.on('data', (c) => chunks.push(c));
  await new Promise((res, rej) => { socket.once('end', res); socket.once('error', rej); });

  const buf = Buffer.concat(chunks);
  const sep = buf.indexOf('\r\n\r\n');
  const [statusLine, ...headers] = buf.slice(0, sep).toString('latin1').split('\r\n');
  const h = {};
  for (const line of headers) {
    const i = line.indexOf(':');
    if (i > 0) h[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  let payload = buf.slice(sep + 4);
  if ((h['transfer-encoding'] || '').toLowerCase().includes('chunked')) payload = dechunk(payload);
  const body = decompress(payload, h['content-encoding']);
  const status = Number(statusLine.split(' ')[1]);
  if (status >= 300 && status < 400 && h.location && redirects > 0) {
    return socksGet(new URL(h.location, rawUrl).href, proxy, redirects - 1);
  }
  return { status, headers: h, buf: body, text: body.toString('utf8') };
}

/* ------------------------------------------------------------ decompress */

function decompress(buf, enc) {
  const e = (enc || '').toLowerCase();
  const attempts = [];
  if (e.includes('br')) attempts.push(() => zlib.brotliDecompressSync(buf));
  if (e.includes('gzip')) attempts.push(() => zlib.gunzipSync(buf));
  if (e.includes('deflate')) attempts.push(() => zlib.inflateSync(buf), () => zlib.inflateRawSync(buf));
  // Sniff the magic bytes too: a proxy may rewrite or drop Content-Encoding.
  attempts.push(
    () => zlib.brotliDecompressSync(buf),
    () => zlib.gunzipSync(buf),
    () => zlib.inflateSync(buf),
    () => zlib.inflateRawSync(buf)
  );
  for (const f of attempts) {
    try { const out = f(); if (out && out.length) return out; } catch { /* try the next one */ }
  }
  return buf;
}

/**
 * GET a URL. Direct first; through the SOCKS proxy if direct fails.
 *
 * `viaProxy` on the result says which one answered, so a caller can report that
 * the machine is on a fallback path rather than silently taking 10x longer.
 */
export async function get(url) {
  try {
    const r = await httpsGet(url);
    return { ...r, viaProxy: false };
  } catch (directErr) {
    const proxy = proxyAddress();
    if (!proxy) throw directErr;
    const r = await socksGet(url, proxy);
    return { ...r, viaProxy: true };
  }
}

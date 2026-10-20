// The browser half of the configuration file boundary.
//
// The C# service owns normalisation when it is present. The Node development
// server does not implement these routes, so the same request falls back to the
// local JS implementation rather than turning file transfer into a hard
// dependency on the desktop host.

import { coreAvailable } from './core-client';
import { buildConfigFile, parseConfigFile } from './config-file';

const EXPORT_URL = '/api/config/export';
const IMPORT_URL = '/api/config/import';

const timeoutSignal = (ms) => (
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
);

async function post(url, body) {
  return fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: timeoutSignal(60000),
  });
}

/** Export the whole configuration, using the C# boundary when available. */
export async function exportConfigText(args) {
  if (await coreAvailable()) {
    try {
      const response = await post(EXPORT_URL, args);
      if (response.ok) return response.text();
    } catch {
      // A host without the route, or a stopped service: the in-browser writer
      // is still the complete fallback.
    }
  }
  return buildConfigFile(args);
}

/**
 * Parse a configuration or legacy team document.
 *
 * A 400 is a real answer, not an outage: the C# parser has named what is wrong
 * with the file, so that message is surfaced rather than silently retried with
 * a second implementation that might disagree.
 */
export async function parseConfigText(text) {
  if (await coreAvailable()) {
    let response;
    try {
      response = await post(IMPORT_URL, { text });
    } catch {
      return parseConfigFile(text);
    }
    if (response.ok) return response.json();
    if (response.status === 400) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || '配置文件解析失败');
    }
  }
  return parseConfigFile(text);
}

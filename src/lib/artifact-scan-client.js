// The artifact scan has two implementations: the C# service (the importer that
// reads the shared artifact catalogue) and the browser module. The model reply
// is already text, so this boundary sends that text rather than a re-parsed
// object. A 4xx is the model's answer being unreadable and is surfaced as-is;
// a missing or broken service falls back to the synchronous JS path.

import { coreAvailable } from './core-client';

const SCAN_URL = '/api/artifact/scan';
const TIMEOUT_MS = 15_000;

const timeoutSignal = (ms) => (
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
);

/**
 * Map a model reply to the review rows the scan panel edits.
 *
 * @param {string} reply
 * @param {{ lang?: string, list?: object[], sets?: object }} [fallback]
 *   The catalogue the browser already has, used only when the service is
 *   absent. Passing it never changes the C# result: that side loads its own.
 */
export async function scanArtifactReply(reply, { lang = 'chs', list = [], sets = {} } = {}) {
  if (await coreAvailable()) {
    try {
      return await postReply(reply, lang);
    } catch (error) {
      if (error?.fatal) throw error;
    }
  }
  const { buildScanRows, parseScanResponse } = await import('./artifact-scan');
  return buildScanRows(parseScanResponse(reply), { list, sets });
}

async function postReply(reply, lang) {
  let response;
  try {
    response = await fetch(SCAN_URL + '?lang=' + encodeURIComponent(lang), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ reply }),
      signal: timeoutSignal(TIMEOUT_MS),
    });
  } catch (cause) {
    const error = new Error('artifact scan service is unreachable: ' + (cause?.message || cause));
    error.cause = cause;
    throw error;
  }

  if (response.status === 404 || response.status === 405) {
    throw new Error('artifact scan service is unavailable (HTTP ' + response.status + ')');
  }

  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try { payload = await response.json(); } catch { payload = null; }
  }

  if (!response.ok) {
    const error = new Error(payload?.error || ('artifact scan failed (HTTP ' + response.status + ')'));
    error.status = response.status;
    error.fatal = response.status >= 400 && response.status < 500;
    throw error;
  }
  if (!Array.isArray(payload?.rows)) {
    throw new Error('artifact scan service returned an unexpected response');
  }
  return payload.rows;
}

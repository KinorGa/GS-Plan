// The gcsim import has two implementations: the C# service (one request, the
// same importer the CLI uses) and the JS module (fallback when the app is
// served by the plain Node dev server). This adapter picks the service when it
// is there, but never hides a 400 from it: a malformed sample is a user error
// the JS retry would repeat with the same outcome.

import { coreAvailable } from './core-client';

const IMPORT_URL = '/api/gcsim/import';
const TIMEOUT_MS = 30_000;

const timeoutSignal = (ms) => (
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
);

export async function importGcsimSample(buffer, lang = 'chs') {
  if (await coreAvailable()) {
    try {
      return await postSample(buffer, lang);
    } catch (error) {
      if (error?.fatal) throw error;
      // 404/405/network/5xx: the service is not usable for this file, so use
      // the in-browser importer rather than failing an import that can work.
    }
  }
  const { importGcsimSample: importInBrowser } = await import('./gcsim-sample');
  return importInBrowser(buffer, lang);
}

async function postSample(buffer, lang) {
  let response;
  try {
    response = await fetch(IMPORT_URL + '?lang=' + encodeURIComponent(lang), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/octet-stream',
        Accept: 'application/json',
      },
      body: buffer,
      signal: timeoutSignal(TIMEOUT_MS),
    });
  } catch (cause) {
    const error = new Error('gcsim import service is unreachable: ' + (cause?.message || cause));
    error.cause = cause;
    throw error;
  }

  if (response.status === 404 || response.status === 405) {
    throw new Error('gcsim import service is unavailable (HTTP ' + response.status + ')');
  }

  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = new Error(payload?.error || ('gcsim import failed (HTTP ' + response.status + ')'));
    error.status = response.status;
    error.fatal = response.status >= 400 && response.status < 500;
    throw error;
  }
  if (!payload?.doc || !payload?.report) {
    throw new Error('gcsim import service returned an unexpected response');
  }
  return payload;
}

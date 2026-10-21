// Browser boundary for the artifact summary. The C# service owns the sum and
// the set-count rules; the JS result is only the synchronous first paint and
// the fallback for the plain Node server.

import { useEffect, useMemo, useState } from 'react';
import { coreAvailable, stableRequestKey } from './core-client';

const SUMMARY_URL = '/api/core/artifact-summary';
const TIMEOUT_MS = 10_000;

const timeoutSignal = (ms) => (
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
);

async function postSummary(build) {
  const response = await fetch(SUMMARY_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ build: build || {} }),
    signal: timeoutSignal(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return null;
  return response.json();
}

/**
 * Upgrade an artifact summary to the C# result when the service is present.
 * The fallback has the same shape: totals, counts and bonuses.
 */
export function useArtifactSummary(build, fallback) {
  const key = useMemo(() => stableRequestKey(build || {}), [build]);
  const [remote, setRemote] = useState(null);

  useEffect(() => {
    let alive = true;
    coreAvailable()
      .then((ok) => (ok ? postSummary(build) : null))
      .then((result) => {
        if (alive && result) setRemote({ key, result });
      })
      .catch(() => {
        // The JS summary is already on screen; a failed remote read is a
        // fallback, not an error banner.
      });
    return () => { alive = false; };
  }, [key]);

  return remote?.key === key ? remote.result : fallback;
}

// Browser boundary for evaluating a merged damage polynomial.
//
// C# owns the arithmetic: panel -> A/H/D/M/U/P/G/C/R/E, the never/crit/expected
// totals, and each CRIT-Rate-buff group's delta/contribution. The caller keeps
// its synchronous JS result only as the first paint and Node-server fallback.

import { useEffect, useMemo, useState } from 'react';
import { coreAvailable, stableRequestKey } from './core-client';

const EVALUATE_URL = '/api/core/merged-evaluate';
const TIMEOUT_MS = 15_000;

const timeoutSignal = (ms) => (
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
);

async function postEvaluation(expr, panel) {
  const response = await fetch(EVALUATE_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ expr, panel }),
    signal: timeoutSignal(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return null;
  return response.json();
}

/**
 * Upgrade a local polynomial evaluation to the C# result when available.
 * The fallback has the same shape: variables, never/crit/avg and groups.
 */
export function useMergedEvaluation(expr, panel, fallback) {
  const request = useMemo(
    () => (expr && panel ? { expr, panel } : null),
    [expr, panel]
  );
  const key = useMemo(
    () => (request ? stableRequestKey(request) : null),
    [request]
  );
  const [remote, setRemote] = useState(null);

  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    coreAvailable()
      .then((ok) => (ok ? postEvaluation(expr, panel) : null))
      .then((result) => {
        if (alive && result) setRemote({ key, result });
      })
      .catch(() => {
        // The synchronous evaluation is already on screen; a failed remote
        // read is a fallback, not an error banner.
      });
    return () => { alive = false; };
  }, [key]);

  return remote?.key === key ? remote.result : fallback;
}

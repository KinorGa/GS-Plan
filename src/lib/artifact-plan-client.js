// Browser boundary for the artifact optimiser's planning half.
//
// The C# planner owns piece shape, feeding-substat selection, implied hits and
// the structured request. This module only packages UI state and falls back to
// the synchronous JS planner when the service is absent.

import { coreAvailable } from './core-client';

const PLAN_URL = '/api/optimize/artifact/plan';
const TIMEOUT_MS = 10_000;

const timeoutSignal = (ms) => (
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
);

/** The body of POST /api/optimize/artifact/plan. */
export function artifactPlanRequest({
  expr,
  build,
  basePanel,
  currentPanel = null,
  pieces = null,
  mode = 'auto',
  upgrades = 5,
  lines = 4,
  maxPerLine = 6,
  hitScale = 0.8,
  rarity = 5,
}) {
  return {
    expr,
    build: build || {},
    basePanel,
    currentPanel,
    pieces,
    mode,
    upgrades,
    lines,
    maxPerLine,
    hitScale,
    rarity,
  };
}

/**
 * Ask C# for the optimiser plan. A missing route, network error or 5xx returns
 * null so the caller can use the JS fallback; a 4xx is a real request error.
 */
export async function planArtifactOptimize(request) {
  if (!(await coreAvailable())) return null;

  let response;
  try {
    response = await fetch(PLAN_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(request),
      signal: timeoutSignal(TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (response.status === 404 || response.status === 405 || response.status >= 500) {
    return null;
  }

  const type = response.headers.get('content-type') || '';
  let payload = null;
  if (type.includes('application/json')) {
    try { payload = await response.json(); } catch { payload = null; }
  }

  if (!response.ok) {
    const error = new Error(payload?.error || ('artifact plan failed (HTTP ' + response.status + ')'));
    error.status = response.status;
    error.fatal = true;
    throw error;
  }
  return payload;
}

// Browser adapter for the C# core.
//
// THE UI IS SYNCHRONOUS BY DESIGN. A row must have a number on its first paint,
// even when the C# service is absent (the ordinary Node dev server) or the
// detail data is still loading. So every hook returns the JS result immediately
// and upgrades to the C# result only after it arrives. Identical requests made in
// one commit are coalesced into one batch request, and the last results are
// cached so switching crit modes back and forth does not repost the same panel.
//
// MODE:
//   auto (default)  use C# when /api/core/meta identifies the service
//   core            same probe, but makes the intent explicit
//   js              never contact the core (set localStorage gsplan.core = 'js')

import { useEffect, useMemo, useState } from 'react';
import { computeDamage } from './damage';

const META_URL = '/api/core/meta';
const DAMAGE_BATCH_URL = '/api/core/damage-batch';
const PANEL_BATCH_URL = '/api/core/derive-panel-batch';
const AXIS_URL = '/api/core/axis';
const PREFERENCE_KEY = 'gsplan.core';
const CACHE_LIMIT = 512;

let availability = null;
let scheduled = false;
const damageCache = new Map();
const panelCache = new Map();
const axisCache = new Map();
const pendingDamage = new Map();
const pendingPanels = new Map();
const pendingAxes = new Map();
let damageQueue = [];
let panelQueue = [];
let axisQueue = [];

const readPreference = () => {
  try {
    const value = globalThis.localStorage?.getItem(PREFERENCE_KEY);
    return value === 'core' || value === 'js' ? value : 'auto';
  } catch {
    return 'auto';
  }
};

const timeoutSignal = (ms) => (
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
);

/** The current adapter mode: `auto`, `core` or `js`. */
export const getCoreMode = readPreference;

/** Set the adapter mode. `auto` is the default and removes the stored override. */
export function setCoreMode(mode) {
  try {
    if (mode === 'core' || mode === 'js') globalThis.localStorage?.setItem(PREFERENCE_KEY, mode);
    else globalThis.localStorage?.removeItem(PREFERENCE_KEY);
  } catch {
    // Private mode / disabled storage must not break the calculator.
  }
  availability = null;
}

/** Forget capability and result caches, e.g. after starting the C# server. */
export function invalidateCoreClient() {
  availability = null;
  damageCache.clear();
  panelCache.clear();
  axisCache.clear();
}

/** Whether the current page is served by a core-capable service. */
export function coreAvailable() {
  if (readPreference() === 'js') return Promise.resolve(false);
  if (availability) return availability;
  availability = fetch(META_URL, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: timeoutSignal(5000),
  })
    .then(async (response) => {
      if (!response.ok) return false;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return false;
      const meta = await response.json();
      return meta?.service === 'gs-plan-core';
    })
    .catch(() => false);
  return availability;
}

/** A key whose property order cannot make equal requests look different. */
export function stableRequestKey(value) {
  const stable = (v) => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v).sort().map((key) => [key, stable(v[key])])
      );
    }
    return v;
  };
  return JSON.stringify(stable(value));
}

const remember = (cache, key, value) => {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return value;
};

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: timeoutSignal(15000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    flushDamage();
    flushPanels();
    flushAxes();
  });
}

function enqueue(kind, request, key) {
  const cache = kind === 'damage' ? damageCache : kind === 'panel' ? panelCache : axisCache;
  const pending = kind === 'damage' ? pendingDamage : kind === 'panel' ? pendingPanels : pendingAxes;
  const queue = kind === 'damage' ? damageQueue : kind === 'panel' ? panelQueue : axisQueue;

  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (pending.has(key)) return pending.get(key);

  const promise = new Promise((resolve, reject) => {
    queue.push({ key, request, resolve, reject });
  });
  pending.set(key, promise);
  schedule();
  return promise;
}

async function flushAxes() {
  const batch = axisQueue;
  axisQueue = [];
  if (!batch.length) return;
  await Promise.all(batch.map(async (item) => {
    try {
      const result = await postJson(AXIS_URL, item.request);
      remember(axisCache, item.key, result);
      pendingAxes.delete(item.key);
      item.resolve(result);
    } catch (error) {
      pendingAxes.delete(item.key);
      item.reject(error);
    }
  }));
}

async function flushDamage() {
  const batch = damageQueue;
  damageQueue = [];
  if (!batch.length) return;
  try {
    const payload = await postJson(DAMAGE_BATCH_URL, {
      requests: batch.map((item) => item.request),
    });
    if (!Array.isArray(payload?.results) || payload.results.length !== batch.length) {
      throw new Error('damage batch returned the wrong result count');
    }
    batch.forEach((item, index) => {
      const result = remember(damageCache, item.key, payload.results[index]);
      pendingDamage.delete(item.key);
      item.resolve(result);
    });
  } catch (error) {
    batch.forEach((item) => {
      pendingDamage.delete(item.key);
      item.reject(error);
    });
  }
}

async function flushPanels() {
  const batch = panelQueue;
  panelQueue = [];
  if (!batch.length) return;
  try {
    const payload = await postJson(PANEL_BATCH_URL, {
      requests: batch.map((item) => item.request),
    });
    if (!Array.isArray(payload?.results) || payload.results.length !== batch.length) {
      throw new Error('panel batch returned the wrong result count');
    }
    batch.forEach((item, index) => {
      const result = remember(panelCache, item.key, payload.results[index]);
      pendingPanels.delete(item.key);
      item.resolve(result);
    });
  } catch (error) {
    batch.forEach((item) => {
      pendingPanels.delete(item.key);
      item.reject(error);
    });
  }
}

function useRemoteCore(kind, request, fallback) {
  const key = useMemo(
    () => (request ? stableRequestKey(request) : null),
    [request]
  );
  const [remote, setRemote] = useState(null);

  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    coreAvailable().then((ok) => {
      if (!alive || !ok) return;
      return enqueue(kind, request, key).then((result) => {
        if (alive) setRemote({ key, result });
      });
    }).catch(() => {
      // A failed core request is a fallback state, not an error banner: the JS
      // result is already on screen and the next input change retries naturally.
    });
    return () => { alive = false; };
  }, [kind, key]);

  return remote?.key === key ? remote.result : fallback;
}

/**
 * Compute one damage request through C# when available, with the JS result as
 * the synchronous fallback. `request` has the same shape as the endpoint body.
 */
export function useCoreDamage(request) {
  const fallback = useMemo(
    () => (request ? computeDamage(request.stats, request) : null),
    [request]
  );
  return useRemoteCore('damage', request, fallback);
}

/**
 * Upgrade a locally derived panel to the C# result when available. The caller
 * keeps ownership of the synchronous JS derivation because it owns the compact
 * stat catalogue used by that fallback.
 */
export function useCoreDerivedPanel(request, fallback) {
  return useRemoteCore('panel', request, fallback);
}

/**
 * Upgrade a whole-axis JS result to the C# result when available. `byId` is a
 * Map in the JS contract, so the endpoint's object is adapted exactly once.
 */
export function useCoreAxis(request, fallback) {
  const remote = useRemoteCore('axis', request, null);
  return useMemo(() => {
    if (!remote) return fallback;
    return {
      ...remote,
      byId: remote.byId instanceof Map
        ? remote.byId
        : new Map(Object.entries(remote.byId || {})),
    };
  }, [remote, fallback]);
}

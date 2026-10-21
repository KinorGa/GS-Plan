// Browser boundary for the legal-substat table. C# enumerates the totals and
// their tier decompositions; this hook only caches and upgrades the JS fallback.

import { useEffect, useState } from 'react';
import { coreAvailable } from './core-client';

const TABLE_URL = '/api/core/substat-rolls';
const TIMEOUT_MS = 10_000;
const CACHE_LIMIT = 8;

const tableCache = new Map();
const pendingTables = new Map();

const timeoutSignal = (ms) => (
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
);

async function fetchTable(rarity) {
  const response = await fetch(TABLE_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ rarity }),
    signal: timeoutSignal(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return null;
  const payload = await response.json();
  return payload?.stats ? payload : null;
}

function loadTable(rarity) {
  if (tableCache.has(rarity)) return Promise.resolve(tableCache.get(rarity));
  if (pendingTables.has(rarity)) return pendingTables.get(rarity);

  const promise = coreAvailable()
    .then((ok) => (ok ? fetchTable(rarity) : null))
    .catch(() => null)
    .then((table) => {
      pendingTables.delete(rarity);
      if (table) {
        tableCache.set(rarity, table);
        if (tableCache.size > CACHE_LIMIT) tableCache.delete(tableCache.keys().next().value);
      }
      return table;
    });
  pendingTables.set(rarity, promise);
  return promise;
}

/** Upgrade the legal-value table for one rarity to the C# result when present. */
export function useSubstatTable(rarity) {
  const [remote, setRemote] = useState(() => tableCache.get(rarity) || null);

  useEffect(() => {
    let alive = true;
    loadTable(rarity).then((table) => {
      if (alive && table) setRemote(table);
    });
    return () => { alive = false; };
  }, [rarity]);

  return remote?.rarity === rarity ? remote : null;
}

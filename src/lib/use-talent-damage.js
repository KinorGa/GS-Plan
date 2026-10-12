// Load the CURATED talent-damage table.
//
// WHY THIS IS A HOOK AND NOT A MODULE-LEVEL FETCH
//
// `buildSources` is called during render. A fetch started inside it cannot
// re-render the component that needed the data, so the first paint would quietly
// lose every constellation row and nothing would ever ask again -- the failure
// would be a missing menu item, which is exactly the kind of silent wrongness the
// rest of this file's siblings go out of their way to avoid.
//
// So it is loaded into state like `charData` is, and the cache below means the
// ~350KB file is fetched once for the whole session rather than per card. Every
// caller shares the same promise.
import { useEffect, useState } from 'react';
import { TALENT_DAMAGE_FILE } from '../char-sources';

let cached = null;
let inflight = null;

function load() {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch(TALENT_DAMAGE_FILE)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((j) => {
      // A MISSING FILE IS NOT AN ERROR. It means no constellation is offered as a
      // source; the three active talents never consult it, so the card still works.
      cached = j && j.characters ? j : { characters: {} };
      inflight = null;
      return cached;
    });
  return inflight;
}

export function useTalentDamage() {
  const [table, setTable] = useState(cached);

  useEffect(() => {
    if (cached) {
      setTable(cached);
      return undefined;
    }
    let alive = true;
    load().then((t) => { if (alive) setTable(t); });
    return () => { alive = false; };
  }, []);

  return table;
}

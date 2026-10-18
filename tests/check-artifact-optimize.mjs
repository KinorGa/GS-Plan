// The artifact optimiser's problem/CSV translation, and the binary behind it.
//
// Three claims, checked separately because they can fail separately:
//
//   1. 'buildProblem' writes the format 'main.cpp' reads, and 'parseResult' reads
//      back what it writes -- including the fixed 16-wide coefficient vector, where
//      a missing key must be an explicit 0 rather than a shift.
//   2. The binary SEARCHES THE RIGHT SPACE. A small problem small enough to
//      enumerate in this file, by hand, is enumerated both ways and the two sets of
//      outcomes are compared. This is where the shape of a piece is pinned down:
//      four lines, one roll minimum on each, a per-line cap, and a substat that
//      cannot repeat on one piece. The first version of the optimiser failed
//      exactly here -- it could leave lines empty.
//   3. The binary AGREES with the expression it was handed: every row it returns
//      re-evaluates to the damage the engine's own numbers give at that panel. This
//      is the part that catches a monomial put in the wrong slot, which is
//      invisible in a round trip.
//
// The second and third need a built binary and the downloaded dataset; the file
// says so LOUDLY when either is absent rather than passing quietly.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + '  ' + x); } };

const {
  buildProblem, parseResult, coeffVector, MONO_ORDER, pieceSpec, importPieces,
  defaultPieces, stripSubstats, emMattersIn,
} = await import('../src/lib/artifact-optimize.js');

/* -------------------------------------------------------------- 1. translation */

// 'never' has only the constant and 'crit' a constant plus a CRIT-DMG term, so a
// mis-slotted coefficient lands in a term that is NOT zero here.
const expr = {
  coeffs: {
    never: { 1: 5 },
    crit: { 1: 10, C: 2 },
    avgGroups: [{ crBuff: 20, delta: { 1: 1, C: 1 } }],
  },
};
const panel = {
  atk: 800, atkPct: 50, flatAtk: 300, critRate: 5, critDmg: 50,
  anemoDmg: 0, pyroDmg: 0, dmgBonus: 0,
};
const pieces = [
  pieceSpec({ slotKey: 'flower', mainStat: 'hp', upgrades: 5 }),
  pieceSpec({
    slotKey: 'plume', mainStat: 'atk', upgrades: 4, lines: 4, maxPerLine: 6,
    allows: [
      { key: 'atkPct', state: 2 }, { key: 'critRate', state: 1 },
      { key: 'critDmg', state: 0 }, { key: 'em', state: 1 }, { key: 'hp', state: 1 },
    ],
  }),
];
const problem = buildProblem({
  expr, panel, ref: { A: 1500, C: 200, R: 60 }, pieces, hitScale: 0.85,
});
const hasLine = (prefix) => problem.split('\n').some((l) => l.startsWith(prefix));

ok('the panel is written', problem.split('\n')[1] === 'panel 800 50 300 5 50 0 0 0 0 0 0 0 0 0 0',
  problem.split('\n')[1]);
ok('every substat is declared, so the columns never move', problem.split('\n').filter((l) => l.startsWith('hit ')).length === 10);
ok('each piece states its shape', hasLine('piece flower 4 9 6') && hasLine('piece plume 4 8 6'));
ok('a disabled substat is simply left out', !hasLine('allow plume critDmg'));
ok('a required substat is state 2', hasLine('allow plume atkPct 2'));
ok('an optional substat is state 1', hasLine('allow plume critRate 1'));
ok('the main stat is never allowed on its own piece', !hasLine('allow plume atk '));
ok('the coefficient vectors are 40 wide', problem.split('\n').filter((l) => l.startsWith('coeff never '))[0].trim().split(/\s+/).length === MONO_ORDER.length + 2);
ok('the average groups carry their crit-rate buff', hasLine('group 20 '));
ok('the comparison row is written last', hasLine('ref 1500 0 0 0 200 60 0'));

// Every key of MONO_ORDER that is present must land at ITS OWN index.
const probe = {}; MONO_ORDER.forEach((k, i) => { probe[k] = i + 1; });
const probeVec = coeffVector(probe);
ok('coeffVector keeps MONO_ORDER positional', probeVec.every((v, i) => v === i + 1));
ok('a missing key is an explicit 0', coeffVector({ 1: 1 })[4] === 0);

// The order the C++ declares is the order this module writes. Read it from the
// comment rather than trusting a copy.
const cpp = fs.readFileSync(path.join('native', 'optimize', 'main.cpp'), 'utf8');
const declaredBlock = cpp.match(/\/\/\s+1 U P G C[\s\S]*?\/\/\s+M[^\n]*/);
const declared = declaredBlock && declaredBlock[0]
  .split(/\r?\n/)
  .map((line) => line.replace(/^\s*\/\/\s*/, '').trim())
  .join(' ');
ok('main.cpp declares the same monomial order',
  !!declared && declared.split(/\s+/).join(',') === MONO_ORDER.join(','),
  declared || 'no order line found');

const csv = [
  'critRate,critDmg,total,A,C,R,E,dmg_never,dmg_crit,dmg_avg,is_current',
  '3,1,4,1234.5,150.25,41.5,120,100,200,180.5,0',
  ',,,1700,120,40,200,1000,2000,1800,1',
].join('\n');
const parsed = parseResult(csv);
ok('the header names the substats and stops before the roll total',
  parsed.stats.join(',') === 'critRate,critDmg', parsed.stats.join(','));
ok('a row reads its roll counts by name', parsed.rows[0].hits.critDmg === 1);
ok('the roll total is read from its own column, not summed', parsed.rows[0].total === 4);
ok('the damage columns are read', parsed.rows[0].A === 1234.5 && parsed.rows[0].avg === 180.5);
ok('the EM panel column is read', parsed.rows[0].E === 120 && parsed.rows[1].E === 200);
ok('the current-build row is flagged', parsed.rows[1].isCurrent === true);
ok('the current-build row reports no rolls (it is not an allocation)', parsed.rows[1].hasHits === false);
ok('a search row reports rolls', parsed.rows[0].hasHits === true);
// A CSV without the total column still reads, by summing -- the format grew this
// column, and a caller holding an older file must not see a phantom substat.
const legacy = parseResult(['critRate,critDmg,A,C,R,dmg_never,dmg_crit,dmg_avg,is_current', '2,1,100,50,5,1,2,1.5,0'].join('\n'));
ok('a header without the roll total still reads', legacy.stats.join(',') === 'critRate,critDmg' && legacy.rows[0].total === 3);
ok('a header without an EM column still reads', legacy.rows[0].E === 0);

const EXE = path.join('native', 'optimize', 'optimize.exe');
const DATA = path.join('public', 'data');
if (!fs.existsSync(EXE)) {
  console.log('SKIP  the binary checks (needs ' + EXE + ')');
} else {
  /* ------------------------------------- 2. the shape, against a hand enumeration */

  /**
   * Every set of 'lines' distinct keys from 'allowed' that contains 'required'.
   */
  function lineSets(allowed, required, lines) {
    const out = [];
    const rec = (start, chosen) => {
      if (chosen.length === lines) {
        if (required.every((r) => chosen.includes(r))) out.push(chosen.slice());
        return;
      }
      for (let i = start; i < allowed.length; i += 1) {
        chosen.push(allowed[i]); rec(i + 1, chosen); chosen.pop();
      }
    };
    rec(0, []);
    return out;
  }

  /** Every way to give 'lines' lines 'rolls' rolls, each between 1 and 'max'. */
  function distributions(lines, rolls, max) {
    const out = [];
    const cur = new Array(lines).fill(1);
    const rec = (i, left) => {
      if (i === lines - 1) {
        if (left >= 1 && left <= max) { cur[i] = left; out.push(cur.slice()); }
        return;
      }
      for (let v = 1; v <= max && v <= left; v += 1) { cur[i] = v; rec(i + 1, left - v); }
    };
    rec(0, rolls);
    return out;
  }

  // Two pieces, two lines each, three rolls each, at most two per line. Small
  // enough to enumerate by hand, and every rule of the shape is exercised: the
  // second piece MUST carry atkPct, and 'em' feeds nothing.
  const SMALL = {
    values: { atkPct: 10, critRate: 5, em: 7 },
    pieces: [
      { slot: 'a', lines: 2, rolls: 3, max: 2, allowed: ['atkPct', 'critRate', 'em'], required: [] },
      { slot: 'b', lines: 2, rolls: 3, max: 2, allowed: ['atkPct', 'critRate', 'em'], required: ['atkPct'] },
    ],
  };
  const smallText = (() => {
    const lines = ['panel 100 0 0 0 0 0 0 0'];
    for (const k of Object.keys(SMALL.values)) lines.push('hit ' + k + ' ' + SMALL.values[k]);
    for (const pc of SMALL.pieces) lines.push('piece ' + pc.slot + ' ' + pc.lines + ' ' + pc.rolls + ' ' + pc.max);
    for (const pc of SMALL.pieces) {
      for (const k of pc.allowed) lines.push('allow ' + pc.slot + ' ' + k + ' ' + (pc.required.includes(k) ? 2 : 1));
    }
    // f = A, and only A: every fixture difference is visible in the panel.
    lines.push('coeff never ' + coeffVector({ A: 1 }).join(' '));
    lines.push('coeff crit ' + coeffVector({ A: 1 }).join(' '));
    return lines.join('\n') + '\n';
  })();

  /** What the same rules say the outcomes are, enumerated here. */
  function smallExpected() {
    const perPiece = SMALL.pieces.map((pc) => {
      const out = [];
      for (const set of lineSets(pc.allowed, pc.required, pc.lines)) {
        for (const dist of distributions(pc.lines, pc.rolls, pc.max)) {
          const rolls = {};
          set.forEach((k, i) => { rolls[k] = (rolls[k] || 0) + dist[i]; });
          out.push(rolls);
        }
      }
      return out;
    });
    const keys = new Set();
    for (const a of perPiece[0]) {
      for (const b of perPiece[1]) {
        let atkPct = 0, critRate = 0;
        for (const rolls of [a, b]) {
          for (const [k, v] of Object.entries(rolls)) {
            if (k === 'atkPct') atkPct += v * SMALL.values.atkPct;
            if (k === 'critRate') critRate += v * SMALL.values.critRate;
          }
        }
        const A = 100 * (1 + atkPct / 100);
        keys.add(A.toFixed(4) + '|0.0000|' + critRate.toFixed(4));
      }
    }
    return keys;
  }

  const tmp = (name) => path.join(process.env.TEMP || '.', 'gsplan-check-' + process.pid + '-' + name + '.txt');
  const smallPath = tmp('small');
  fs.writeFileSync(smallPath, smallText);
  const smallOut = execFileSync(EXE, [smallPath], { encoding: 'utf8', maxBuffer: 1 << 30 });
  fs.rmSync(smallPath, { force: true });
  const smallRes = parseResult(smallOut);
  const gotKeys = new Set(smallRes.rows
    .filter((r) => !r.isCurrent)
    .map((r) => r.A.toFixed(4) + '|' + r.C.toFixed(4) + '|' + r.R.toFixed(4)));
  const wantKeys = smallExpected();
  const missing = [...wantKeys].filter((k) => !gotKeys.has(k));
  const extra = [...gotKeys].filter((k) => !wantKeys.has(k));
  ok('the small search finds exactly the allocations the rules allow',
    gotKeys.size === wantKeys.size && !missing.length && !extra.length,
    'want ' + wantKeys.size + ', got ' + gotKeys.size + ', missing ' + missing.slice(0, 3) + ', extra ' + extra.slice(0, 3));
  ok('every small outcome spends all six rolls',
    smallRes.rows.every((r) => r.isCurrent || r.total === 6));
  ok('the required substat is never skipped',
    smallRes.rows.every((r) => r.isCurrent || r.hits.atkPct >= 1));
  ok('no line takes more than the cap',
    smallRes.rows.every((r) => r.isCurrent || Object.values(r.hits).every((v) => v <= 4)),
    JSON.stringify(smallRes.rows[0] && smallRes.rows[0].hits));

  // A piece that cannot fill its lines is a problem, not a result.
  const badPath = tmp('bad');
  fs.writeFileSync(badPath, smallText.replace('piece a 2 3 2', 'piece a 4 3 2'));
  let rejected = '';
  try { execFileSync(EXE, [badPath], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { rejected = String(e.stderr || e.message); }
  fs.rmSync(badPath, { force: true });
  ok('a piece with more lines than rolls is refused', /lines/.test(rejected), rejected.slice(0, 120));

  /* --------------------------------------------- 3. against the real expression */

  if (!fs.existsSync(path.join(DATA, 'stats-compact.json'))) {
    console.log('SKIP  the expression check (needs ' + DATA + ')');
  } else {
    const CFG = path.join('data', '法布杜C2尼C2.json');
    if (!fs.existsSync(CFG)) {
      console.log('SKIP  the expression check (needs ' + CFG + ')');
    } else {
      const read = (p) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));
      const {
        damageAt, mergedExpression, panelOf, totalAtkOf, variablesOf, selfCheck,
      } = await import('../src/lib/merged-expression.js');
      const { unpackAxes } = await import('../src/lib/axes-pool.js');
      const { activeArtifacts } = await import('../src/lib/artifact-sets.js');
      const { computeAxis } = await import('../src/lib/axis-compute.js');

      const catalogue = {
        chars: read('charlist.json'),
        weapons: read('weaponlist.json'),
        stats: read('stats-compact.json'),
      };
      const talentDamage = read('talent-damage.json');
      const cfg = unpackAxes(JSON.parse(fs.readFileSync(CFG, 'utf8')));
      const team = cfg.team.units.map((u) => {
        const c = catalogue.chars[u.char.id];
        return {
          id: u.char.id, element: c?.element, level: u.char.level ?? 90,
          constellation: u.char.constellation ?? 0, talents: u.char.talents || null,
          weaponId: u.weapon?.id ?? null, artifacts: activeArtifacts(u),
          detail: JSON.parse(fs.readFileSync(path.join(DATA, 'char', 'chs', u.char.id + '.json'), 'utf8')),
        };
      });
      const entries = cfg.axes[0].entries;
      const charId = team[0].id;
      const expr2 = mergedExpression({ entries, team, catalogue, talentDamage, charId });
      const build = team[0].artifacts;
      const base = panelOf(team, catalogue, charId, stripSubstats(build));
      const cur = panelOf(team, catalogue, charId);

      ok('the baseline panel has no substats',
        base.critRate < cur.critRate && base.critDmg < cur.critDmg,
        base.critRate + '/' + base.critDmg + ' vs ' + cur.critRate + '/' + cur.critDmg);

      // The comparison row IS the worn panel, at ANY roll scale: the scale models
      // hypothetical candidate rolls, not the build the user actually wears.
      const ref = variablesOf(cur);
      ok('the comparison panel is the worn panel',
        Math.abs(ref.A - totalAtkOf(cur)) < 1e-9
        && Math.abs(ref.C - cur.critDmg) < 1e-9
        && Math.abs(ref.R - cur.critRate) < 1e-9,
        JSON.stringify(ref) + ' vs ' + totalAtkOf(cur) + '/' + cur.critDmg + '/' + cur.critRate);

      /** Clone rows while forcing a damage type / reaction / panel edit on this char. */
      const forced = (list, { element, reactionKey, over = {}, critMode } = {}) => {
        const patch = (e) => {
          if (e.kind === 'segment') {
            return { ...e, children: (e.children || []).map(patch) };
          }
          if (e.charId !== charId) return e;
          const out = {
            ...e,
            statOverrides: { ...(e.statOverrides || {}), ...over },
          };
          if (element) out.element = element;
          if (reactionKey) out.reactionKey = reactionKey;
          if (critMode) out.critMode = critMode;
          if (Array.isArray(e.children)) {
            out.children = e.children.map((c) => ({
              ...c,
              ...(element ? { element } : {}),
              ...(critMode ? { critMode } : {}),
              statOverrides: { ...(c.statOverrides || {}), ...over },
            }));
          }
          return out;
        };
        return list.map(patch);
      };
      const totalForChar = (list) => {
        const ax = computeAxis(list, team, catalogue, talentDamage);
        let sum = 0;
        const visit = (e) => {
          if (e.kind === 'segment') return (e.children || []).forEach(visit);
          if (e.charId === charId) sum += ax.byId.get(e.id)?.total || 0;
        };
        list.forEach(visit);
        return sum;
      };
      const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));

      // A loop is a CONTAINER. Its members used to be invisible to the merge, so a
      // rotated axis produced an expression of zero.
      const loopEntries = [{
        id: 'loop-regression', kind: 'segment', charId: 'none', name: 'loop',
        children: entries,
      }];
      const exprLoop = mergedExpression({
        entries: loopEntries, team, catalogue, talentDamage, charId,
      });
      const flatAt = damageAt(expr2, variablesOf(expr2.base));
      const loopAt = damageAt(exprLoop, variablesOf(expr2.base));
      ok('a loop contributes its members to the merge',
        exprLoop && exprLoop.entries === expr2.entries && exprLoop.parts === expr2.parts,
        exprLoop && exprLoop.entries + '/' + exprLoop.parts + ' vs ' + expr2.entries + '/' + expr2.parts);
      ok('a loop has the same damage as the flat axis',
        Math.abs(loopAt.never - flatAt.never) <= 1e-7 * Math.max(1, Math.abs(flatAt.never))
        && Math.abs(loopAt.crit - flatAt.crit) <= 1e-7 * Math.max(1, Math.abs(flatAt.crit))
        && Math.abs(loopAt.avg - flatAt.avg) <= 1e-7 * Math.max(1, Math.abs(flatAt.avg)));

      // Non-Anemo/Pyro elemental DMG and Physical have their own panel fields.
      // Missing any of them made the expression understate every such hit.
      const cryoRows = forced(entries, { element: 'Cryo', over: { cryoDmg: 50 }, critMode: 'avg' });
      const exprCryo = mergedExpression({
        entries: cryoRows, team, catalogue, talentDamage, charId,
      });
      const cryoAt = damageAt(exprCryo, variablesOf(exprCryo.base));
      ok('a Cryo goblet is part of the expression',
        rel(cryoAt.avg, totalForChar(cryoRows)) < 1e-9,
        cryoAt.avg + ' vs ' + totalForChar(cryoRows));

      const physRows = forced(entries, { element: 'Physical', over: { physBonus: 50 }, critMode: 'avg' });
      const exprPhys = mergedExpression({
        entries: physRows, team, catalogue, talentDamage, charId,
      });
      const physAt = damageAt(exprPhys, variablesOf(exprPhys.base));
      ok('a Physical goblet is part of the expression',
        rel(physAt.avg, totalForChar(physRows)) < 1e-9,
        physAt.avg + ' vs ' + totalForChar(physRows));

      // Deterministic random panels used by every selfCheck below.
      const seeded = () => {
        let state = 0x9e3779b9;
        return () => {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          return state / 4294967296;
        };
      };

      // HP / DEF / EM scaling must produce the SAME algebra, not a product with
      // ATK. selfCheck compares each against computeAxis on random panels, which
      // includes the raw HP%/flat HP and DEF%/flat DEF inputs those symbols read.
      const withBasis = (list, basis) => list.map((e) => {
        const here = e.charId === charId;
        const out = here ? { ...e, scalingBasis: basis } : e;
        if (Array.isArray(e.children)) {
          out.children = e.children.map((c) => (
            here ? { ...c, scalingBasis: basis } : c
          ));
        }
        return out;
      });
      let exprHp = null;
      let hpRows = null;
      for (const basis of ['hp', 'def', 'em']) {
        const rows = withBasis(entries, basis);
        const exprBasis = mergedExpression({ entries: rows, team, catalogue, talentDamage, charId });
        ok('the merge records ' + basis + ' as a coefficient source',
          exprBasis?.scalingBases?.includes(basis), JSON.stringify(exprBasis?.scalingBases));
        const worst = selfCheck(exprBasis, {
          entries: rows, team, catalogue, talentDamage, samples: 3, rng: seeded(),
        });
        ok('selfCheck agrees with ' + basis + ' scaling',
          Math.max(worst.never, worst.crit, worst.avg) < 1e-9, JSON.stringify(worst));
        if (basis === 'hp') { exprHp = exprBasis; hpRows = rows; }
      }

      // Amplifying reactions depend on EM rationally. The expression carries the
      // polynomial part separately and must match at MORE THAN the baseline EM.
      const ampRows = forced(entries, { reactionKey: 'vaporize', critMode: 'avg' });
      const exprAmp = mergedExpression({
        entries: ampRows, team, catalogue, talentDamage, charId,
      });
      ok('an amplifying reaction produces EM coefficients', exprAmp.hasAmp === true);
      for (const target of [exprAmp.base.em || 0, (exprAmp.base.em || 0) + 400]) {
        const engineRows = forced(entries, { reactionKey: 'vaporize', over: { em: target }, critMode: 'avg' });
        const v = { ...variablesOf(exprAmp.base), E: target };
        const got = damageAt(exprAmp, v).avg;
        const want = totalForChar(engineRows);
        ok('the reaction expression matches the engine at EM=' + target,
          rel(got, want) < 1e-9, got + ' vs ' + want);
      }

      const loopWorst = selfCheck(exprLoop, {
        entries: loopEntries, team, catalogue, talentDamage, samples: 4, rng: seeded(),
      });
      ok('selfCheck agrees on a loop axis',
        Math.max(loopWorst.never, loopWorst.crit, loopWorst.avg) < 1e-9,
        JSON.stringify(loopWorst));
      const ampWorst = selfCheck(exprAmp, {
        entries: ampRows, team, catalogue, talentDamage, samples: 4, rng: seeded(),
      });
      ok('selfCheck agrees with amplifying reactions',
        Math.max(ampWorst.never, ampWorst.crit, ampWorst.avg) < 1e-9,
        JSON.stringify(ampWorst));

      // The C++ side carries amplifying reactions as `em(E + buff) x polynomial`.
      // A small one-piece problem is enough to prove that EM reaches the search and
      // that every returned row still evaluates to the same expression.
      const ampPiece = pieceSpec({
        slotKey: 'flower', mainStat: 'hp', upgrades: 0, lines: 2, maxPerLine: 2,
        allows: [
          { key: 'em', state: 1 }, { key: 'critRate', state: 1 },
          { key: 'critDmg', state: 1 }, { key: 'atkPct', state: 1 },
        ],
      });
      const ampPath = tmp('amp');
      fs.writeFileSync(ampPath, buildProblem({
        expr: exprAmp, panel: base, pieces: [ampPiece], hitScale: 1,
      }));
      const ampOut = execFileSync(EXE, [ampPath], { encoding: 'utf8', maxBuffer: 1 << 30 });
      fs.rmSync(ampPath, { force: true });
      const ampRes = parseResult(ampOut);
      let ampWorstBinary = 0;
      for (const row of ampRes.rows.filter((r) => r.hasHits)) {
        const want = damageAt(exprAmp, {
          A: row.A, H: row.H, D: row.D, M: row.M, C: row.C, R: row.R, E: row.E,
          U: base.anemoDmg, P: base.pyroDmg, G: base.dmgBonus,
        });
        ampWorstBinary = Math.max(ampWorstBinary, rel(row.avg, want.avg));
      }
      ok('the binary carries EM through amplifying reactions', ampWorstBinary < 1e-8,
        'worst rel ' + ampWorstBinary.toExponential(2));
      ok('an EM roll produces a distinct outcome',
        new Set(ampRes.rows.filter((r) => r.hasHits).map((r) => r.E.toFixed(3))).size > 1);

      // Transformative reactions are a SEPARATE additive hit. They must reach
      // the merged expression, selfCheck and the binary, and EM must be a search
      // dimension even when no talent scales from it.
      // REF: docs/REACTIONS.md#transformative
      const rxRows = forced(entries, { reactionKey: 'overloaded', critMode: 'avg' });
      const exprRx = mergedExpression({
        entries: rxRows, team, catalogue, talentDamage, charId,
      });
      ok('a transformative reaction produces rx groups',
        exprRx?.hasTransformative === true && exprRx.coeffs.transformative.length > 0);
      ok('transformative reaction makes EM a feeding substat',
        emMattersIn(exprRx) === true);
      const rxWorst = selfCheck(exprRx, {
        entries: rxRows, team, catalogue, talentDamage, samples: 3, rng: seeded(),
      });
      ok('selfCheck agrees with transformative reactions',
        Math.max(rxWorst.never, rxWorst.crit, rxWorst.avg) < 1e-9,
        JSON.stringify(rxWorst));

      const rxPiece = pieceSpec({
        slotKey: 'flower', mainStat: 'hp', upgrades: 0, lines: 2, maxPerLine: 2,
        allows: [
          { key: 'em', state: 1 }, { key: 'critRate', state: 1 },
          { key: 'critDmg', state: 1 }, { key: 'atkPct', state: 1 },
        ],
      });
      const rxPath = tmp('transformative');
      fs.writeFileSync(rxPath, buildProblem({
        expr: exprRx, panel: base, pieces: [rxPiece], hitScale: 1,
      }));
      const rxOut = execFileSync(EXE, [rxPath], { encoding: 'utf8', maxBuffer: 1 << 30 });
      fs.rmSync(rxPath, { force: true });
      const rxRes = parseResult(rxOut);
      let rxWorstBinary = 0;
      for (const row of rxRes.rows.filter((r) => r.hasHits)) {
        const want = damageAt(exprRx, {
          A: row.A, H: row.H, D: row.D, M: row.M, C: row.C, R: row.R, E: row.E,
          U: base.anemoDmg, P: base.pyroDmg, G: base.dmgBonus,
        });
        rxWorstBinary = Math.max(rxWorstBinary, rel(row.avg, want.avg));
      }
      ok('the binary carries transformative reaction add-ons', rxWorstBinary < 1e-8,
        'worst rel ' + rxWorstBinary.toExponential(2));
      ok('an EM roll changes a transformative-reaction outcome',
        new Set(rxRes.rows.filter((r) => r.hasHits).map((r) => r.E.toFixed(3))).size > 1);

      // HP scaling is a SEARCH DIMENSION: HP%/flat HP must reach the native
      // evaluator, and every returned row must still equal the merged expression.
      const hpPiece = pieceSpec({
        slotKey: 'flower', mainStat: 'atk', upgrades: 0, lines: 2, maxPerLine: 2,
        allows: [
          { key: 'hpPct', state: 1 }, { key: 'hp', state: 1 },
          { key: 'critRate', state: 1 }, { key: 'critDmg', state: 1 },
        ],
      });
      const hpPath = tmp('hp-scaling');
      fs.writeFileSync(hpPath, buildProblem({
        expr: exprHp, panel: base, pieces: [hpPiece], hitScale: 1,
      }));
      const hpOut = execFileSync(EXE, [hpPath], { encoding: 'utf8', maxBuffer: 1 << 30 });
      fs.rmSync(hpPath, { force: true });
      const hpRes = parseResult(hpOut);
      let hpWorst = 0;
      for (const row of hpRes.rows.filter((r) => r.hasHits)) {
        const want = damageAt(exprHp, {
          A: row.A, H: row.H, D: row.D, M: row.M, C: row.C, R: row.R, E: row.E,
          U: base.anemoDmg, P: base.pyroDmg, G: base.dmgBonus,
        });
        hpWorst = Math.max(hpWorst, rel(row.avg, want.avg));
      }
      ok('the binary carries HP scaling through the polynomial', hpWorst < 1e-8,
        'worst rel ' + hpWorst.toExponential(2));
      ok('an HP roll produces a distinct outcome',
        new Set(hpRes.rows.filter((r) => r.hasHits).map((r) => r.H.toFixed(3))).size > 1);
      ok('the HP expression and HP rows are available', !!exprHp && !!hpRows);

      const run = (piecesSpec, name) => {
        const text = buildProblem({ expr: expr2, panel: base, ref, pieces: piecesSpec, hitScale: 1 });
        const file = tmp(name);
        fs.writeFileSync(file, text);
        const out = execFileSync(EXE, [file], { encoding: 'utf8', maxBuffer: 1 << 30 });
        fs.rmSync(file, { force: true });
        return parseResult(out);
      };

      const imported = importPieces(build);
      const res = run(imported, 'import');

      const refRow = res.rows.find((r) => r.isCurrent);
      ok('the reference row is present', !!refRow);
      if (refRow) {
        const V = {
          A: ref.A, H: ref.H, D: ref.D, M: ref.M, C: ref.C, R: ref.R, E: ref.E,
          U: base.anemoDmg, P: base.pyroDmg, G: base.dmgBonus,
        };
        const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));
        const want = damageAt(expr2, V);
        ok('the reference row reproduces the current build',
          rel(refRow.never, want.never) < 1e-9 && rel(refRow.crit, want.crit) < 1e-9 && rel(refRow.avg, want.avg) < 1e-9,
          refRow.avg + ' vs ' + want.avg);
      }

      // EVERY row, against the expression the binary was handed. This is the check
      // that a monomial in the wrong slot would fail.
      let worst = 0;
      const seenKeys = new Set();
      for (const row of res.rows) {
        if (!row.hasHits) continue;
        const V = {
          A: row.A, H: row.H, D: row.D, M: row.M, C: row.C, R: row.R, E: row.E,
          U: base.anemoDmg, P: base.pyroDmg, G: base.dmgBonus,
        };
        const want = damageAt(expr2, V);
        for (const [got, expected] of [
          [row.never, want.never],
          [row.crit, want.crit],
          [row.avg, want.avg],
        ]) worst = Math.max(worst, Math.abs(got - expected) / Math.max(1, Math.abs(expected)));
        seenKeys.add(row.A.toFixed(3) + '|' + row.C.toFixed(3) + '|' + row.R.toFixed(3));
      }
      ok('every returned row re-evaluates to the expression', worst < 1e-9, 'worst rel ' + worst.toExponential(2));
      ok('the row set is deduplicated on the panel', seenKeys.size === res.rows.filter((r) => r.hasHits).length,
        seenKeys.size + ' vs ' + res.rows.length);
      const searched = res.rows.filter((r) => !r.isCurrent);
      ok('the searched rows are sorted by expected damage',
        searched.every((r, i) => i === 0 || searched[i - 1].avg >= r.avg));

      // THE SHAPE, on the real build: five pieces of nine rolls each, so every
      // outcome spends 45 -- a search that could leave lines empty would produce
      // totals all over the place.
      ok('every imported outcome spends 45 rolls',
        searched.every((r) => r.total === 45),
        JSON.stringify(searched.filter((r) => r.total !== 45).slice(0, 2).map((r) => r.total)));

      // A substat pinned onto N pieces has to appear at least N times, because each
      // of those pieces spends at least one roll on it. This is the constraint the
      // budget version of the problem did not have.
      const mustCount = {};
      for (const pc of imported) {
        for (const a of pc.allows) if (a.state >= 2) mustCount[a.key] = (mustCount[a.key] || 0) + 1;
      }
      const violates = searched.filter((r) =>
        Object.entries(mustCount).some(([k, n]) => (r.hits[k] || 0) < n));
      ok('every piece can still hold the substats it was pinned to',
        violates.length === 0,
        JSON.stringify({ mustCount, example: violates[0] && violates[0].hits }));

      // The guarantee the whole import exists for: the worn allocation is inside the
      // search space, so the best outcome cannot come out worse than the build on
      // the screen.
      const best = searched[0];
      ok('the best outcome is not worse than the current build',
        best && refRow && best.avg >= refRow.avg - 1e-9,
        best && refRow ? best.avg + ' vs ' + refRow.avg : 'no rows');

      // And the free search is wider: it may move a line, the import may not.
      const free = run(defaultPieces(build), 'free');
      const freeSearched = free.rows.filter((r) => !r.isCurrent);
      ok('freeing the lines finds at least as many outcomes',
        freeSearched.length >= searched.length,
        freeSearched.length + ' vs ' + searched.length);
      ok('freeing the lines is never worse',
        freeSearched[0] && best && freeSearched[0].avg >= best.avg - 1e-9,
        freeSearched[0] && freeSearched[0].avg + ' vs ' + best.avg);
    }
  }
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

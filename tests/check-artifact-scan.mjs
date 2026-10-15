// Artifact scan: the mapping from what a screenshot SAYS to what the app STORES.
//
// WHY THIS CHECK EXISTS AT ALL, GIVEN A MODEL DOES THE READING
//   The reading is the model's job and is not pinned down here. The MAPPING is
//   this repo's, and every part of it can be wrong in a way that looks fine:
//   `生命值+239` and `生命值+4.7%` are the same three characters, so the flat and
//   the percentage differ only by evidence the code has to find; and a substat
//   total printed by the game is ROUNDED (`19` is the exact 19.45), so a check
//   that rejects the printed figure rejects the real artifact. Those two rules
//   are what the cases below are about.
//
// The four screenshots they come from are exercised end-to-end in
// `check-artifact-scan-screen.mjs`, against the real 66-set catalogue. THIS file
// needs no dataset, so it runs on a fresh clone.
import {
  applyScanRows, buildScanRows, displayOf, matchDisplayed, matchSetByName, matchSlot,
  parseScanResponse, resolveMainStat, resolveSubstat, statCandidates,
} from '../src/lib/artifact-scan.js';
import { SUB_COUNT } from '../src/lib/artifact-model.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + '  ' + x); } };

/* A tiny catalogue: enough for the matching rules, and NOT a copy of the real
   one -- the real names are the other check's business. */
const sets = {
  10001: {
    id: '10001',
    chsName: '行者之心',
    enName: 'Resolution of Sojourner',
    qualityType: 'QUALITY_PURPLE',
    pieces: { flower: { name: '故人之心' }, circlet: { name: '感别之冠' } },
  },
  10002: {
    id: '10002',
    chsName: '勇士之心',
    enName: 'Brave Heart',
    qualityType: 'QUALITY_ORANGE',
    pieces: { flower: { name: '勇士的骄傲' } },
  },
};
const list = Object.values(sets);

/* ------------------------------------------------------- 1. slot from text */

ok('生之花 is the flower', matchSlot('生之花') === 'flower');
ok('空之杯 is the goblet', matchSlot('空之杯') === 'goblet');
ok('the enhance screen\'s "时之沙 / 授予你的年华" is the sands', matchSlot('时之沙 / 授予你的年华') === 'sands');
ok('a bare 冠 is the circlet', matchSlot('冠') === 'circlet');
ok('nonsense has no slot', matchSlot('这是我随手写的') === null);

/* ------------------------------------------------- 2. name -> stat key */

const keys = (n) => statCandidates(n).join(',');
ok('生命值 offers flat then percent', keys('生命值') === 'hp,hpPct', keys('生命值'));
ok('生命值% leads with percent', keys('生命值%') === 'hpPct,hp', keys('生命值%'));
ok('攻击力加成 is ATK%', keys('攻击力加成') === 'atkPct,atk', keys('攻击力加成'));
ok('元素充能效率 is ER, not EM', keys('元素充能效率') === 'er', keys('元素充能效率'));
ok('元素精通 is EM', keys('元素精通') === 'em', keys('元素精通'));
ok('水元素伤害加成 is the hydro goblet stat', keys('水元素伤害加成') === 'hydroDmg', keys('水元素伤害加成'));
ok('暴击伤害 is CRIT DMG', keys('暴击伤害') === 'critDmg', keys('暴击伤害'));
ok('物理伤害加成 is the physical bonus', keys('物理伤害加成') === 'physBonus', keys('物理伤害加成'));
ok('the 待激活 marker is not part of the name', keys('攻击力（待激活）') === 'atk,atkPct', keys('攻击力（待激活）'));

/* ------------------------------------------------- 3. which one the value says */

let r = resolveSubstat('生命值', 239, 5);
ok('+239 HP is the FLAT stat', r.key === 'hp' && !r.ambiguous, `${r.key} ${r.ambiguous}`);
r = resolveSubstat('生命值', 4.7, 5);
ok('+4.7% HP is the PERCENT stat', r.key === 'hpPct' && !r.ambiguous, `${r.key} ${r.ambiguous}`);
r = resolveSubstat('防御力', 19, 5);
ok('a flat DEF roll is the FLAT stat', r.key === 'def', r.key);
r = resolveSubstat('防御力', 12.4, 5);
ok('a DEF% roll is the PERCENT stat', r.key === 'defPct', r.key);
r = resolveSubstat('攻击力', 5, 5);
ok('a value that fits neither is reported as ambiguous', r.ambiguous === true, String(r.ambiguous));
ok('an unknown name has no key', resolveSubstat('幸运值', 1, 5).key === null);

/* ------------------------------------------------- 4. the SLOT settles a main stat */

ok('攻击力 on a Sands can only be ATK%', resolveMainStat('攻击力', 'sands').key === 'atkPct');
ok('攻击力 on a Plume can only be flat', resolveMainStat('攻击力', 'plume').key === 'atk');
ok('生命值 on a Flower can only be flat', resolveMainStat('生命值', 'flower').key === 'hp');
ok('生命值% on a Circlet is HP%', resolveMainStat('生命值%', 'circlet').key === 'hpPct');
ok('a main stat outside its slot is still returned, to be flagged', resolveMainStat('水元素伤害加成', 'flower').key === 'hydroDmg');

/* ------------------------------------------------- 5. the game's ROUNDED display */

ok('a percentage keeps one decimal', displayOf('er', 5.18) === 5.2);
ok('a flat is a whole number', displayOf('atk', 19.45) === 19);
ok('元素精通+21 is the exact 20.979', displayOf('em', 20.979) === 21, String(displayOf('em', 20.979)));
ok('a printed 19 matches the exact 19.45', matchDisplayed('atk', 5, 19)?.value === 19.45, String(matchDisplayed('atk', 5, 19)?.value));
ok('a printed 3.1 matches the exact 3.112', matchDisplayed('critRate', 5, 3.1)?.value === 3.112, String(matchDisplayed('critRate', 5, 3.1)?.value));
ok('a figure the game cannot show matches nothing', matchDisplayed('atk', 5, 19.7) === null);
// The rarity has to reach this call -- it comes from the matched set -- and the
// two ways it shows: the same printed figure is a DIFFERENT exact total on a
// 4-star piece, and a 4-star flat ATK can never print 19 at all (its reachable
// totals are 7..10, 14..20, ... so 19 is one of the gaps).
ok('the same printed 3.1 is 3.11 on a 4-star piece', matchDisplayed('critRate', 4, 3.1)?.value === 3.11, String(matchDisplayed('critRate', 4, 3.1)?.value));
ok('a 4-star flat ATK cannot print 19', matchDisplayed('atk', 4, 19) === null);

/* ------------------------------------------------- 6. set names */

ok('an exact name matches', matchSetByName('行者之心', list).set?.id === '10001');
ok('the set name with its suffix still matches', matchSetByName('行者之心套装', list).set?.id === '10001');
ok('the green header "行者之心: (4)" still matches', matchSetByName('行者之心: (4)', list).set?.id === '10001');
ok('a bracketed piece count still matches', matchSetByName('行者之心（2件套）', list).set?.id === '10001');
ok('the English name matches', matchSetByName('Brave Heart', list).set?.id === '10002');
ok('a wrong name matches nothing', matchSetByName('不存在的套装', list).set === null);
ok('a clipped name is a fuzzy match', matchSetByName('勇士', list).match === 'fuzzy', matchSetByName('勇士', list).match);

/* ------------------------------------------------- 7. a reply becomes rows */

const reply = {
  pieces: [{
    pieceName: '故人之心',
    set: '行者之心',
    slot: '生之花',
    level: 20,
    main: { name: '生命值', value: 4780 },
    subs: [{ name: '暴击率', value: 3.1 }, { name: '生命值', value: 239 }],
  }],
};
const rows = buildScanRows(reply, { list, sets });
ok('one piece is one row', rows.length === 1);
ok('the set resolved by name', rows[0].setId === '10001' && rows[0].setBy === 'set');
ok('the slot resolved', rows[0].slotKey === 'flower');
ok('the main stat is the flower\'s flat HP', rows[0].mainStat === 'hp');
ok('a +20 flower reads as no problem', rows[0].issues.length === 0, rows[0].issues.join(' | '));
ok('the substat rows are padded to four', rows[0].subStats.length === SUB_COUNT);
ok('the second substat is the flat HP', rows[0].subStats[1].key === 'hp');
ok('the raw words are kept beside the mapping', rows[0].subStats[0].raw === '暴击率');

// The piece name alone identifies the set -- the enhance screen shows no set name.
const byPiece = buildScanRows({ pieces: [{ pieceName: '感别之冠', slot: '理之冠', level: 0, main: { name: '暴击率', value: 4.7 } }] }, { list, sets });
ok('a piece name alone resolves the set', byPiece[0].setId === '10001' && byPiece[0].setBy === 'piece');

// A main stat whose number disagrees with its level is flagged, not accepted.
const wrong = buildScanRows({ pieces: [{ set: '行者之心', slot: '生之花', level: 0, main: { name: '生命值', value: 4780 } }] }, { list, sets });
ok('a main stat that contradicts its level is flagged', wrong[0].issues.some((i) => i.includes('主词条数值')), wrong[0].issues.join(' | '));

// An unknown set and an unknown stat are reported rather than guessed.
const unknown = buildScanRows({ pieces: [{ set: '还没出的套装', slot: '生之花', level: 0, main: { name: '幸运值', value: 1 } }] }, { list, sets });
ok('an unknown set is reported', unknown[0].setId === null && unknown[0].issues.some((i) => i.includes('套装没认出')), unknown[0].issues.join(' | '));
ok('an unknown main stat is reported', unknown[0].mainStat === null && unknown[0].issues.some((i) => i.includes('主词条没认出')));
ok('a row with no main stat is not ticked for applying', unknown[0].include === false);

/* ------------------------------------------------- 8. a reply is read tolerantly */

const fenced = '好的，识别结果如下：\n```json\n{"pieces":[{"slot":"生之花"}]}\n```\n需要我再核对吗？';
ok('a fenced reply with a preamble parses', parseScanResponse(fenced).pieces.length === 1);
ok('a bare array parses', parseScanResponse('[{"slot":"生之花"}]').pieces.length === 1);
let threw = false;
try { parseScanResponse('抱歉，我看不清这张图。'); } catch { threw = true; }
ok('prose is an error, not an empty result', threw);
threw = false;
try { parseScanResponse('{"result":[]}'); } catch { threw = true; }
ok('a reply with no pieces array is an error', threw);

/* ------------------------------------------------- 9. applying rows to a build */

const before = {
  flower: { setId: '10002', mainStat: 'hp', level: 20, subStats: [{ key: 'critRate', value: 3.1 }, null, null, null] },
  plume: { setId: '10002', mainStat: 'atk', level: 20, subStats: [null, null, null, null] },
};
const applied = applyScanRows(before, rows);
ok('the scanned slot is replaced', applied.build.flower.setId === '10001');
ok('the untouched slot is left alone', applied.build.plume.setId === '10002');
ok('the applied piece keeps four substat rows', applied.build.flower.subStats.length === SUB_COUNT);
ok('an unticked row is not applied', applyScanRows(before, [{ ...rows[0], include: false }]).applied.length === 0);

// Two rows on one slot: the first wins and the second is reported, not silently
// overwriting the first.
const twice = applyScanRows(before, [
  { ...rows[0], slotKey: 'flower', setId: '10001' },
  { ...rows[0], id: 'scan-1', slotKey: 'flower', setId: '10002' },
]);
ok('a second row on the same slot is ignored', twice.build.flower.setId === '10001' && twice.ignored.length === 1);

// The stored substat is the EXACT total behind the printed figure.
const snapped = applyScanRows(before, buildScanRows({
  pieces: [{ set: '勇士之心', slot: '生之花', level: 20, main: { name: '生命值', value: 4780 }, subs: [{ name: '攻击力', value: 19 }] }],
}, { list, sets }));
ok('the printed 19 is stored as the exact 19.45', snapped.build.flower.subStats[0].value === 19.45, String(snapped.build.flower.subStats[0].value));

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

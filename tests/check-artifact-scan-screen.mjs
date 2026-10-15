// Artifact scan against the REAL catalogue: four screenshots, end to end.
//
// WHAT THIS PINS DOWN THAT THE PURE CHECK CANNOT
//   The other check runs on a fixture catalogue of two invented sets, so it
//   cannot tell whether `晨星与月的晓歌` is really a set, whether `献与月的酹祭`
//   is really its goblet, or whether the four set names below are distinct enough
//   to be told apart by the matcher. Those are all facts about the 66 sets the app
//   ships, so this check reads THE REAL catalogue -- off disk, from `public/data`,
//   because a check that needed the dev server could not run in CI.
//
// THE REPLIES ARE TRANSCRIBED, THE MODEL IS NOT CALLED
//   Each `reply` is the JSON a vision model returned for one real screenshot of
//   the game, and each `main`/`subs` below is what that screenshot actually
//   shows. Running the model here would need a key and a network, and would test
//   the model rather than this app; what is worth pinning down is that a correct
//   reading lands as the right piece. The screenshots, in the order below:
//
//     1. 详情弹窗  献与月的酹祭  晨星与月的晓歌 空之杯  +0 水元素伤害加成 7.0%
//     2. 强化界面  授予你的年华  血红之证 时之沙      +8 攻击力 22.8%
//     3. 角色面板  授予你的年华  血红之证 时之沙      +0 攻击力 7.0%
//     4. 详情放大  风花的箴铭    风起之日 生之花      +0 生命值 717
//
//   Screenshot 2 is the interesting one: the enhance screen shows NO set name at
//   all, only `时之沙 / 授予你的年华`, so the set can only come from the piece
//   name. Screenshot 4 carries a 待激活 substat, which is still part of the piece.
import fs from 'node:fs';
import { indexArtifacts } from '../src/lib/artifact-catalogue.js';
import { applyScanRows, buildScanRows, parseScanResponse } from '../src/lib/artifact-scan.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + '  ' + x); } };

/* ------------------------------------------------------- the real catalogue */

const DATA = new URL('../public/data/', import.meta.url);

/** `{ sets, list }` from the two files `npm run fetch` puts in `public/data`. */
function loadCatalogue() {
  const indexFile = new URL('artifactlist.json', DATA);
  if (!fs.existsSync(indexFile)) return null;
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const details = {};
  for (const id of Object.keys(index)) {
    const file = new URL(`artifact/chs/${id}.json`, DATA);
    details[id] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  }
  return indexArtifacts(index, details);
}

const catalogue = loadCatalogue();
if (!catalogue) {
  console.log('SKIP  public/data/artifactlist.json is not in the repo (run: npm run fetch)');
  process.exit(0);
}
console.log(`using the real catalogue: ${catalogue.list.length} sets\n`);

/* ---------------------------------------------------------------- the screens */

const SCREENS = [
  {
    name: '详情弹窗 · 献与月的酹祭',
    reply: '{"pieces":[{"pieceName":"献与月的酹祭","set":"晨星与月的晓歌","slot":"空之杯","level":0,'
      + '"main":{"name":"水元素伤害加成","value":7.0},'
      + '"subs":[{"name":"暴击率","value":3.5},{"name":"防御力","value":5.8},'
      + '{"name":"暴击伤害","value":7.8},{"name":"生命值","value":239}]}]}',
    expect: {
      slotKey: 'goblet', setId: '15043', setBy: 'set', level: 0,
      mainStat: 'hydroDmg', mainValue: 7.0,
      subs: [['critRate', 3.501], ['defPct', 5.832], ['critDmg', 7.77], ['hp', 239]],
    },
  },
  {
    // No set name on screen: the piece name is the only route to 血红之证.
    name: '强化界面 · 授予你的年华 +8',
    reply: '{"pieces":[{"pieceName":"授予你的年华","slot":"时之沙","level":8,'
      + '"main":{"name":"攻击力","value":22.8},'
      + '"subs":[{"name":"暴击率","value":3.1},{"name":"暴击伤害","value":5.4},'
      + '{"name":"防御力","value":12.4},{"name":"元素精通","value":21}]}]}',
    expect: {
      slotKey: 'sands', setId: '15047', setBy: 'piece', level: 8,
      // The panel prints `攻击力` with the % on the other side of the panel, and
      // a Sands cannot roll flat ATK, so the slot is what makes this ATK%.
      mainStat: 'atkPct', mainValue: 22.8,
      subs: [['critRate', 3.112], ['critDmg', 5.439], ['defPct', 12.393], ['em', 20.979]],
    },
  },
  {
    name: '角色面板 · 授予你的年华 +0',
    reply: '{"pieces":[{"pieceName":"授予你的年华","set":"血红之证","slot":"时之沙","level":0,'
      + '"main":{"name":"攻击力","value":7.0},'
      + '"subs":[{"name":"暴击率","value":3.1},{"name":"暴击伤害","value":7.0},'
      + '{"name":"攻击力","value":19},{"name":"防御力","value":19}]}]}',
    expect: {
      slotKey: 'sands', setId: '15047', setBy: 'set', level: 0,
      mainStat: 'atkPct', mainValue: 7.0,
      // `攻击力+19` is the flat stat, `防御力+19` the flat DEF: both are the
      // game's ROUNDED print of a four-decimal total, and neither could be the
      // percentage version of its stat.
      subs: [['critRate', 3.112], ['critDmg', 6.993], ['atk', 19.45], ['def', 18.52]],
    },
  },
  {
    // The 4th substat reads `攻击力+4.7%（待激活）`: a marker on the name, and a
    // percentage whose only evidence is the number.
    name: '详情放大 · 风花的箴铭',
    reply: '{"pieces":[{"pieceName":"风花的箴铭","set":"风起之日: (5)","slot":"生之花","level":0,'
      + '"main":{"name":"生命值","value":717},'
      + '"subs":[{"name":"暴击率","value":3.5},{"name":"暴击伤害","value":6.2},'
      + '{"name":"防御力","value":23},{"name":"攻击力（待激活）","value":4.7}]}]}',
    expect: {
      slotKey: 'flower', setId: '15044', setBy: 'set', level: 0,
      mainStat: 'hp', mainValue: 717,
      subs: [['critRate', 3.501], ['critDmg', 6.216], ['def', 23.15], ['atkPct', 4.664]],
    },
  },
];

for (const screen of SCREENS) {
  const { expect: want } = screen;
  const rows = buildScanRows(parseScanResponse(screen.reply), catalogue);

  ok(`${screen.name}: one piece`, rows.length === 1, String(rows.length));
  if (rows.length !== 1) continue;
  const row = rows[0];

  ok(`${screen.name}: ${want.slotKey}`, row.slotKey === want.slotKey, String(row.slotKey));
  ok(`${screen.name}: set ${want.setId} by ${want.setBy}`, row.setId === want.setId && row.setBy === want.setBy, `${row.setId}/${row.setBy}`);
  ok(`${screen.name}: +${want.level}`, row.level === want.level, String(row.level));
  ok(`${screen.name}: main ${want.mainStat}`, row.mainStat === want.mainStat, String(row.mainStat));
  // The curve agreeing with the printed number is the strongest single signal the
  // scan is right: a level or a stat that was read wrong moves this number.
  ok(`${screen.name}: the level curve agrees with ${want.mainValue}`, row.mainExpected === want.mainValue, `${row.mainExpected} vs ${want.mainValue}`);

  want.subs.forEach(([key, value], i) => {
    const got = row.subStats[i];
    ok(`${screen.name}: sub${i + 1} ${key} = ${value}`, got?.key === key && got?.value === value, `${got?.key}/${got?.value}`);
  });

  ok(`${screen.name}: nothing left to doubt`, row.issues.length === 0, row.issues.join(' | '));
  ok(`${screen.name}: ticked for applying`, row.include === true);

  console.log(`      -> ${row.slotKey} · ${catalogue.sets[row.setId]?.chsName} · ${row.mainStat} `
    + `${row.mainValue} · ${row.subStats.filter((s) => s.key).map((s) => `${s.key}:${s.value}`).join(', ')}\n`);
}

/* --------------------------------------------- a screenshot with several pieces */

// A bag screenshot carries more than one artifact, and the reply for it is more
// than one object. Two of the pieces above, side by side, in one image.
const bag = parseScanResponse('```json\n{"pieces":['
  + '{"pieceName":"风花的箴铭","set":"风起之日","slot":"生之花","level":0,"main":{"name":"生命值","value":717},"subs":[]},'
  + '{"pieceName":"授予你的年华","set":"血红之证","slot":"时之沙","level":0,"main":{"name":"攻击力","value":7.0},"subs":[]}'
  + ']}\n```');
const bagRows = buildScanRows(bag, catalogue);
ok('a two-piece screenshot is two rows', bagRows.length === 2);
ok('the two rows claim two different slots', bagRows[0].slotKey !== bagRows[1].slotKey);

const merged = applyScanRows({}, bagRows);
ok('both slots land in the build', merged.build.flower?.setId === '15044' && merged.build.sands?.setId === '15047');
ok('nothing else in the build is touched', Object.keys(merged.build).length === 2, Object.keys(merged.build).join(','));

// A slot the reply did not mention keeps whatever it already had.
const kept = applyScanRows({ circlet: { setId: '15044', mainStat: 'critRate', level: 20, subStats: [null, null, null, null] } }, bagRows);
ok('an unmentioned slot is left alone', kept.build.circlet?.setId === '15044');

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
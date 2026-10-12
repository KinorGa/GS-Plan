import fs from 'node:fs';
import { derivePanel } from '../src/lib/stat-derive.js';
const j=(p)=>JSON.parse(fs.readFileSync(new URL('../'+p, import.meta.url),'utf8'));
const stats=j('public/data/stats-compact.json');
const cfg=j('data/法布尼-ft.json');
const units=(cfg.team||cfg).units || [];
console.log('units:', units.length);
const u=units[0];
console.log('unit char:', JSON.stringify(u.char), 'weapon:', JSON.stringify(u.weapon));
const id=u.char.id;
const detail=j(`public/data/char/chs/${id}.json`);
const catalogue=j('public/data/weaponlist.json');
const wid=u.weapon?.id;
const weapon=wid?{ id:wid, ...catalogue[wid] }:null;
// artifacts: active config's slots
const art = u.artifacts?.sets?.find(s=>s.id===u.artifacts.active)?.slots || {};
for (const [label, st] of [['公式', stats], ['本地四舍五入', null]]) {
  const d=derivePanel({ charId:id, detail, level:u.char.level, element:detail.info.element, weaponId:wid, weapon, artifacts:art, stats:st });
  const v=d.values;
  console.log(`${label}: hp=${v.hp.toFixed(4)} atk=${v.atk.toFixed(4)} def=${v.def.toFixed(4)} em=${v.em} cr=${v.critRate} cd=${v.critDmg} er=${v.er}`);
  console.log(`   总攻击 = hp?  白值+武器 = ${(v.atk).toFixed(4)}; precise=${d.precise}; notes=${JSON.stringify(d.notes)}`);
}

import fs from 'node:fs';
import { derivePanel } from '../src/lib/stat-derive.js';
const j=(p)=>JSON.parse(fs.readFileSync(new URL('../'+p, import.meta.url),'utf8'));
const stats=j('public/data/stats-compact.json');
const detail=j('public/data/char/chs/10000128.json');
const weapon=null;

const withStats=derivePanel({ charId:'10000128', detail, level:95, element:'Anemo', weaponId:null, weapon, artifacts:{}, stats });
const without=derivePanel({ charId:'10000128', detail, level:95, element:'Anemo', weaponId:null, weapon, artifacts:{}, stats:null });
console.log('精确:', withStats.base.atk, ' precise=', withStats.precise);
console.log('回退:', without.base.atk, ' precise=', without.precise);

// 砂糖（Anemo% 突破）以前会被丢掉
const s=j('public/data/char/chs/10000343.json');
const sd=derivePanel({ charId:'10000343', detail:s, level:90, element:'Anemo', weaponId:null, weapon:null, artifacts:{}, stats });
console.log('砂糖 anemoDmg:', sd.values.anemoDmg, ' notes:', JSON.stringify(sd.notes));
const sdOld=derivePanel({ charId:'10000343', detail:s, level:90, element:'Anemo', weaponId:null, weapon:null, artifacts:{}, stats:null });
console.log('砂糖(回退) anemoDmg:', sdOld.values.anemoDmg, ' notes:', JSON.stringify(sdOld.notes));

// 一个 EM 突破角色
const em=j('public/data/char/chs/10000043.json');
const ed=derivePanel({ charId:'10000043', detail:em, level:90, element:'Anemo', weaponId:null, weapon:null, artifacts:{}, stats });
console.log('砂糖ID? em:', ed.values.em, 'notes:', JSON.stringify(ed.notes));

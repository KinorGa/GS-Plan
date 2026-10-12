import fs from 'node:fs';
import { derivePanel } from '../src/lib/stat-derive.js';
const j=(p)=>JSON.parse(fs.readFileSync(new URL('../'+p, import.meta.url),'utf8'));
const stats=j('public/data/stats-compact.json');
const charlist=j('public/data/charlist.json');
const find=(n)=>Object.entries(charlist).find(([,c])=>c.chsName===n)?.[0];
for(const name of ['砂糖','莫娜','琴','米提亚']){
  const id=find(name); if(!id){console.log(name,'未找到');continue;}
  const detail=j(`public/data/char/chs/${id}.json`);
  const a=derivePanel({ charId:id, detail, level:90, element:'Anemo', weaponId:null, weapon:null, artifacts:{}, stats });
  const b=derivePanel({ charId:id, detail, level:90, element:'Anemo', weaponId:null, weapon:null, artifacts:{}, stats:null });
  console.log(`${name}(${id}) precise=${a.precise}`);
  console.log(`   公式: em=${a.values.em} er=${a.values.er} anemoDmg=${a.values.anemoDmg} heal=${a.values.healBonus} notes=${JSON.stringify(a.notes)}`);
  console.log(`   回退: em=${b.values.em} er=${b.values.er} anemoDmg=${b.values.anemoDmg} heal=${b.values.healBonus} notes=${JSON.stringify(b.notes)}`);
}

import fs from 'node:fs';
import { derivePanel } from '../src/lib/stat-derive.js';
import { charStatsAt } from '../src/lib/stat-tables.js';
const j=(p)=>JSON.parse(fs.readFileSync(new URL('../'+p, import.meta.url),'utf8'));
const stats=j('public/data/stats-compact.json');
for(const [id,name] of [['10000122','奈芙尔'],['10000119','劳玛']]){
  console.log(name, "innate:", JSON.stringify(stats.chars[id].innate));
  const detail=j(`public/data/char/chs/${id}.json`);
  const localRow=detail.info.attributes.find(r=>r.level===90);
  const d=derivePanel({ charId:id, detail, level:90, element:'Dendro', weaponId:null, weapon:null, artifacts:{}, stats });
  console.log("  本地 L90:", JSON.stringify(localRow));
  console.log("  公式 L90: em="+d.values.em, "critDmg="+d.values.critDmg, "notes="+JSON.stringify(d.notes));
}

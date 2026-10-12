// Final check of the generated factor table against the published tables.
import fs from "node:fs";
import { charStatsAt, weaponMaxLevel, weaponStatsAt } from "../src/lib/stat-tables.js";
const j=(p)=>JSON.parse(fs.readFileSync(new URL("../"+p,import.meta.url),"utf8"));
const stats=j("public/data/stats-compact.json");
const charlist=j("public/data/charlist.json");
const wl=j("public/data/weaponlist.json");

let n=0, bad=0, worst=0, wi=null, covered=0, fallback=[], ascBad=[];
for(const id of Object.keys(charlist)){
  let local; try{ local=j(`public/data/char/chs/${id}.json`);}catch{continue;}
  if(!charStatsAt(stats,id,1)){ fallback.push(`${id} ${local.info.name}`); continue; }
  covered++;
  for(const row of local.info.attributes){
    const s=charStatsAt(stats, id, row.level);
    for(const k of ['hp','atk','def']){
      const d=Math.abs(Math.round(s[k])-row[k]); n++;
      if(d>worst){worst=d;wi=`${id} ${local.info.name} L${row.level} ${k} 公式=${s[k].toFixed(3)} 本地=${row[k]}`;}
      if(d>0) bad++;
    }
    for(const {name,value} of s.extras){
      const key=Object.keys(row).find(k=>k===name || k.replace('%','')===name.replace('Bonus%','').replace(' DMG','').replace('%',''));
      if(key && Math.abs(Number(row[key])-value)>1e-6)
        ascBad.push(`${id} ${local.info.name} L${row.level} ${name}: 公式=${value} 本地=${key}=${row[key]}`);
    }
  }
}
console.log(`角色: ${covered}/${Object.keys(charlist).length} 个有因子; ${n} 个数值比较, 四舍五入后不符 ${bad}, 最大偏差 ${worst}`);
console.log("  最大偏差样本:", wi);
console.log(`  无因子(走本地表): ${fallback.length} -> ${fallback.slice(0,6).join(', ')}${fallback.length>6?' …':''}`);

let wn=0,wbad=0,ww=0,wwi=null;
for(const id of Object.keys(wl)){
  const w=wl[id]; const maxLv=weaponMaxLevel(stats,id); const s=weaponStatsAt(stats,id,maxLv??90);
  if(!s){wbad++;continue;}
  const d=Math.abs(Math.round(s.atk)-(w.ascensionStats?.atk??0)); wn++;
  if(d>ww){ww=d;wwi=`${id} ${w.chsName} L${s.maxLevel} 公式=${s.atk.toFixed(3)} 本地=${w.ascensionStats?.atk}`;}
  if(d>0) wbad++;
}
console.log(`\n武器: ${wn} 把, 四舍五入后不符 ${wbad}, 最大偏差 ${ww}`);
console.log("  最大偏差样本:", wwi);
console.log("  (已知: 本地表对 1★/2★ 那 10 把是错的, Fandom 显示 185/243, 公式与之相符)");

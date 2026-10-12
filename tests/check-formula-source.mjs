import fs from "node:fs";
const j = (p) => JSON.parse(fs.readFileSync(new URL("./" + p, import.meta.url), "utf8"));
const VAL = "GGKIEIJLCJJ";
const avatar = j("_avatar.json");
const curves = j("_avatarcurve.json");
const promote = j("_promote.json");
const wexc = j("_WeaponExcelConfigData.json");
const wcurve = j("_WeaponCurveExcelConfigData.json");
const wprom = j("_WeaponPromoteExcelConfigData.json");

const curveVal = (tbl, curveType, lvl) => {
  const row = tbl.find((r) => r.level === lvl);
  return row.curveInfos.find((c) => c.type === curveType)[VAL];
};
const phaseFor = (lvl) => (lvl >= 80 ? 6 : lvl >= 70 ? 5 : lvl >= 60 ? 4 : lvl >= 50 ? 3 : lvl >= 40 ? 2 : lvl >= 20 ? 1 : 0);
const addOf = (rows, phase, propType) =>
  rows[phase].addProps.find((p) => p.propType === propType)?.[VAL] ?? 0;

const farga = avatar.find((a) => a.id === 10000128);
const fProm = promote.filter((p) => p.avatarPromoteId === 128);
const atkCurve = farga.propGrowCurves.find((p) => p.type === "FIGHT_PROP_BASE_ATTACK").growCurve;
console.log("法尔伽  attackBase=" + farga.attackBase + "  curve=" + atkCurve);
for (const lvl of [90, 95, 100]) {
  const c = curveVal(curves, atkCurve, lvl);
  const add = addOf(fProm, phaseFor(lvl), "FIGHT_PROP_BASE_ATTACK");
  console.log(`  L${lvl}: ${farga.attackBase} * ${c} + ${add} = ${(farga.attackBase * c + add).toFixed(4)}`);
}

const wolf = wexc.find((w) => w.id === 12515);
const wProm = wprom.filter((p) => p.weaponPromoteId === wolf.weaponPromoteId);
console.log("\n狼的武功歌  main=" + wolf.weaponProp[0].propType + " init=" + wolf.weaponProp[0].initValue + " curve=" + wolf.weaponProp[0].type);
for (const lvl of [1, 90]) {
  const c = curveVal(wcurve, wolf.weaponProp[0].type, lvl);
  const add = addOf(wProm, 6, "FIGHT_PROP_BASE_ATTACK");
  console.log(`  L${lvl}: ${wolf.weaponProp[0].initValue} * ${c} + ${add} = ${(wolf.weaponProp[0].initValue * c + add).toFixed(6)}`);
}
const sub = wolf.weaponProp[1];
const c90 = curveVal(wcurve, sub.type, 90);
console.log(`  substat ${sub.propType} L90: ${sub.initValue} * ${c90} = ${(sub.initValue * c90 * 100).toFixed(4)}%`);

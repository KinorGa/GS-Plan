// Authoritative 5-star artifact main-stat curves, transcribed from the
// reference table. Values are the +0..+20 rows for a 5-star artifact.
//
// Kept as a standalone data file so the table can be reviewed, diffed and
// replaced without touching component or model code.

/** Percentage stats, each with its OWN curve. */
export const PCT_CURVES = {
  // Health % / Attack % share a curve.
  hpPct: [7.0, 9.0, 11.0, 12.9, 14.9, 16.9, 18.9, 20.9, 22.8, 24.8,
          26.8, 28.8, 30.8, 32.8, 34.7, 36.7, 38.7, 40.7, 42.7, 44.6, 46.6],
  atkPct: [7.0, 9.0, 11.0, 12.9, 14.9, 16.9, 18.9, 20.9, 22.8, 24.8,
           26.8, 28.8, 30.8, 32.8, 34.7, 36.7, 38.7, 40.7, 42.7, 44.6, 46.6],
  // Defense % runs higher than HP%/ATK%.
  defPct: [8.7, 11.2, 13.7, 16.2, 18.6, 21.1, 23.6, 26.1, 28.6, 31.0,
           33.5, 36.0, 38.5, 40.9, 43.4, 45.9, 48.4, 50.8, 53.3, 55.8, 58.3],
  er: [7.8, 10.0, 12.2, 14.4, 16.6, 18.8, 21.0, 23.2, 25.4, 27.6,
       29.8, 32.0, 34.2, 36.4, 38.6, 40.8, 43.0, 45.2, 47.4, 49.6, 51.8],
  // Elemental DMG bonus shares the HP%/ATK% curve.
  dmgBonus: [7.0, 9.0, 11.0, 12.9, 14.9, 16.9, 18.9, 20.9, 22.8, 24.8,
             26.8, 28.8, 30.8, 32.8, 34.7, 36.7, 38.7, 40.7, 42.7, 44.6, 46.6],
  // Physical DMG shares the Defense% curve: 8.7 -> 58.3, NOT the elemental line.
  //
  // This was briefly "corrected" to 7.0 -> 46.6 on the assumption that both
  // goblet damage bonuses must scale alike. They do not, and the reference
  // tables say so plainly: in the 5-star table the seven element rows all read
  // 7.0 -> 46.6 while Physical reads 8.7 -> 58.3, cell for cell identical to
  // Defense%. In the 4-star table the same split holds (elements 6.3 -> 34.8,
  // Physical 7.9 -> 43.5).
  physBonus: [8.7, 11.2, 13.7, 16.2, 18.6, 21.1, 23.6, 26.1, 28.6, 31.0,
              33.5, 36.0, 38.5, 40.9, 43.4, 45.9, 48.4, 50.8, 53.3, 55.8, 58.3],
  critRate: [4.7, 6.0, 7.3, 8.6, 9.9, 11.3, 12.6, 13.9, 15.2, 16.5,
             17.9, 19.2, 20.5, 21.8, 23.2, 24.5, 25.8, 27.1, 28.4, 29.8, 31.1],
  critDmg: [9.3, 12.0, 14.6, 17.3, 19.9, 22.5, 25.2, 27.8, 30.5, 33.1,
            35.7, 38.4, 41.0, 43.7, 46.3, 49.0, 51.6, 54.2, 56.9, 59.5, 62.2],
  healBonus: [5.4, 6.9, 8.4, 10.0, 11.5, 13.0, 14.5, 16.1, 17.6, 19.1,
              20.6, 22.1, 23.7, 25.2, 26.7, 28.2, 29.8, 31.3, 32.8, 34.3, 35.9],
};

/** Flat stats. */
export const FLAT_CURVES = {
  hp: [717, 920, 1123, 1326, 1530, 1733, 1936, 2139, 2342, 2545,
       2749, 2952, 3155, 3358, 3561, 3764, 3968, 4171, 4374, 4577, 4780],
  atk: [47, 60, 73, 86, 100, 113, 126, 139, 152, 166,
        179, 192, 205, 218, 232, 245, 258, 271, 284, 298, 311],
  em: [28, 35.9, 43.8, 51.8, 59.7, 67.6, 75.5, 83.5, 91.4, 99.3,
       107.2, 115.2, 123.1, 131, 138.9, 146.9, 154.8, 162.7, 170.6, 178.6, 186.5],
};

/** Which curve each main stat uses. */
export const CURVE_FOR = {
  hp: { kind: 'flat', key: 'hp' },
  atk: { kind: 'flat', key: 'atk' },
  def: { kind: 'flat', key: 'def' },   // no DEF main stat exists; see MAIN_STATS
  em: { kind: 'flat', key: 'em' },
  hpPct: { kind: 'pct', key: 'hpPct' },
  atkPct: { kind: 'pct', key: 'atkPct' },
  defPct: { kind: 'pct', key: 'defPct' },
  er: { kind: 'pct', key: 'er' },
  dmgBonus: { kind: 'pct', key: 'dmgBonus' },
  physBonus: { kind: 'pct', key: 'physBonus' },
  critRate: { kind: 'pct', key: 'critRate' },
  critDmg: { kind: 'pct', key: 'critDmg' },
  healBonus: { kind: 'pct', key: 'healBonus' },
};

/**
 * A main stat's value at artifact level 0..20, or null when unknown.
 *
 * The per-element goblet keys (`pyroDmg` .. `dendroDmg`) all resolve to the
 * shared elemental curve. They are matched by shape rather than enumerated in
 * `CURVE_FOR`, so this file does not carry a second copy of the element list
 * that `DMG_ELEMENTS` in `artifact-model.js` already owns.
 *
 * The shape test is anchored on a leading lowercase letter and an explicit
 * `crit` exclusion, because `critDmg` also ends in `Dmg`:
 *
 *   pyroDmg     element   -> elemental curve
 *   critDmg     NOT an element, and has its own row in CURVE_FOR
 *   dmgBonus    NOT matched, has its own row
 *   physBonus   NOT matched, has its own row
 *
 * `critDmg` is listed in CURVE_FOR so it would resolve correctly either way,
 * but matching it here would be a latent bug the moment that row moved.
 */
export function curveValue(stat, level) {
  const spec = CURVE_FOR[stat] || (isElementDmgKey(stat) ? CURVE_FOR.dmgBonus : null);
  if (!spec) return null;
  const table = spec.kind === 'flat' ? FLAT_CURVES : PCT_CURVES;
  const row = table[spec.key];
  if (!row) return null;
  const lv = Math.max(0, Math.min(20, Math.round(Number(level) || 0)));
  return row[lv] ?? null;
}

/** `<element>Dmg` for a real element, excluding `critDmg`. */
const ELEMENT_DMG_RE = /^(?!crit)[a-z]+Dmg$/;
export const isElementDmgKey = (stat) => ELEMENT_DMG_RE.test(String(stat));

// The eight damage types: the seven elements, plus Physical.
//
// WHY THIS MODULE EXISTS
//   The damage-type vocabulary is no longer a local detail of one component. It
//   is needed to build the panel's per-element fields, to derive the matching
//   buff keys, and to pick which enemy-resistance field a hit reads. Before this
//   the list lived in three places at once:
//
//     game.js           ELEMENTS, keyed 'Cryo'..'Dendro'   (display: icon, tint)
//     artifact-model.js DMG_ELEMENTS, keyed 'pyro'..'dendro' (lowercase, no Physical)
//     DamageCard.jsx    ELEMENT_FOR_ICON, a third copy
//
//   The artifact list deliberately excluded Physical -- a goblet's DMG bonus is
//   per ELEMENT and `physBonus` is its own panel field -- but using it as the
//   definition of "every damage type" is exactly how a Physical case gets missed.
//   Both spellings are produced here, so a consumer takes the one it needs rather
//   than re-deriving it, and a new element is one line.
//
// Physical is NOT an element. It has no reaction, no goblet DMG bonus and no
// ascension stat, which is why it is a separate list rather than the eighth entry
// of `ELEMENT_KEYS` wherever "element" is the question being asked.

/**
 * The seven elements, lowercased, in the order the game lists them.
 *
 * This is the spelling used inside composite keys (`pyroDmg`, `enemyResPyro`)
 * and by `artifact-model.js`; the capitalised form is for display and for the
 * `element` field on a character record.
 */
export const ELEMENT_KEYS = ['pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo', 'dendro'];

/** The eight damage types a hit can carry: the seven elements plus Physical. */
export const DAMAGE_TYPES = [...ELEMENT_KEYS, 'physical'];

/**
 * A composite key's suffix per damage type.
 *
 * The panel's elemental DMG fields lowercase the element (`pyroDmg`) while the
 * resistance fields capitalise it (`enemyResPyro`) -- that inconsistency is in
 * the stored field names themselves and is preserved here rather than papered
 * over, because renaming a stored field is what silently orphans saved data.
 */
export const KEY_SUFFIX = {
  ...Object.fromEntries(ELEMENT_KEYS.map((e) => [e, capitalise(e)])),
  physical: 'Physical',
};

/**
 * A damage type's Chinese one-character name, for building a field label.
 *
 * Lives here, beside the type list, because the panel's fields, the buff-key
 * table and the label table all need it. Each of those previously grew its own
 * copy -- which is precisely how `Physical` ends up missing from one of them.
 */
export const TYPE_ZH = {
  pyro: '火', hydro: '水', cryo: '冰', electro: '雷',
  anemo: '风', geo: '岩', dendro: '草', physical: '物理',
};

/** `<type>`'s Chinese name, e.g. `typeZh('cryo')` -> `冰`. */
export const typeZh = (t) => TYPE_ZH[t] || t;

/**
 * The damage-type suffix for a hit's `element` field.
 *
 * `element` arrives as the character record spells it -- 'Cryo', 'Physical' --
 * or as an artifact key spells it -- 'cryo'. Anything unrecognised returns
 * `null` rather than a best guess, so the caller can decide whether that is a
 * neutral hit or a defect; silently answering 'Physical' is how a mistyped
 * element turns into a plausible wrong number.
 */
export function damageTypeSuffix(element) {
  const k = String(element ?? '').toLowerCase();
  return DAMAGE_TYPES.includes(k) ? KEY_SUFFIX[k] : null;
}

function capitalise(s) {
  return s[0].toUpperCase() + s.slice(1);
}

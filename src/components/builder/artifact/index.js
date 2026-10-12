// The artifact equipment row.
//
// One folder per concern, so a change to the set picker does not mean reading
// the substat editor:
//
//   ArtifactRow       the panel: five slots, the catalogue, the bonus chips
//   PieceSlot         one slot: piece icon, set name, main stat, level, subs
//   MainStatControl   the derived main-stat readout and its picker
//   SubstatsControl   the four substat rows
//   StatGlyph         a stat's glyph, and the popover that picks one
//   SetPicker         the modal grid of every set
//   BonusChips        the derived 2-piece / 4-piece readout
//
// The domain side is `lib/artifact` (see that barrel), which splits further
// into the rules, the presentation metadata and the catalogue loader.

export { default as ArtifactRow } from './ArtifactRow';
export { default as PieceSlot } from './PieceSlot';
export { default as SetPicker } from './SetPicker';
export { default as BonusChips } from './BonusChips';
export { StatGlyph, StatMenu } from './StatGlyph';
export { default as MainStatControl } from './MainStatControl';
export { default as SubstatsControl } from './SubstatsControl';

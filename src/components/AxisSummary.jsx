// The axis footer: where the damage comes from, by character and by element.
//
// WHY A FOOTER AND NOT A CHART. The question a rotation is built to answer is
// "who is doing the work, and of what kind" -- a 9-row axis listing individual
// hits does not say whether the plan is 80% one character or split evenly, and
// that is the thing you change a rotation to fix. A share bar answers it in one
// glance and costs a single row.
//
// SOURCED FROM EACH ENTRY'S OWN STORED SUMMARY. `summary.perHit`, `summary.hits`
// and `summary.element` are the same values the collapsed row displays, so the
// footer cannot disagree with the rows above it. Nothing is recomputed here: a
// second implementation of the damage formula is exactly how the row and the card
// drifted apart before.
//
// MULTI-PART ROWS ARE COUNTED PER PART, using each part's own element and figure.
// The two halves of 法尔伽's 二段伤害 are 风 and 冰, so counting the row once under
// one element would attribute the whole hit to a damage type half of it never had.
// That is also why the element share is not derived from the character's element.

import { useState } from 'react';
import { avatarImg, elementOf, talentIconImg } from '../game';
import { ElementGlyph, damageTypeLabel } from './ElementGlyph';

/**
 * @param {Array}  entries  The axis's entries -- read only for their NAMES and
 *                          source labels, never for their numbers.
 * @param {object} axis     The result of `computeAxis`. THIS is where every figure
 *                          comes from: it is derived from the data on demand, so it
 *                          cannot be stale and cannot depend on which cards happen
 *                          to have mounted.
 * @param {object} team     Team units, for a character's display name and portrait.
 * @param {Function} L      i18n picker.
 */
export default function AxisSummary({ entries, axis, team, L }) {
  // Which slice is being pointed at, so the chart and the legend can highlight
  // together. NAMESPACED BY CHART: a bare key collided across the two, so hovering
  // an Anemo legend row dimmed every slice of the CHARACTER chart too (the key
  // matched nothing there) and emptied its centre. `char:10000128` cannot collide
  // with `el:Anemo`.
  const [hover, setHover] = useState(null);

  /**
   * One row per PART, taken from the COMPUTED axis.
   *
   * WHY NOT FROM THE ENTRY. The numbers used to be read off each entry's stored
   * `summary` and each child's cached `figure`. Those are written only while a card
   * is mounted, so an axis nobody had expanded reported almost nothing, and the
   * total grew as rows were opened -- the same file gave 443,081, then 597,979,
   * then 608,978. `axis` is computed from the data every render instead, so the
   * total is a function of the axis and nothing else.
   *
   * A PART WITH NO COMPUTED RESULT IS SKIPPED, not counted as zero: a row whose
   * character has not loaded has no number yet, and saying so is honest. `axis`
   * records how many entries it could compute for that reason.
   */
  const parts = [];

  /**
   * One row, plus everything inside it when it is a LOOP.
   *
   * A loop is a container, so its members must be counted INDIVIDUALLY -- each keeps
   * its own character, element and source, which is the only reason the breakdown is
   * useful. Adding the loop's own sum as one lump would put seventeen rows under one
   * character and one element label.
   *
   * A compound row's parts are taken from `r.parts`, which `computeAxis` produced;
   * a loop's members come from `r.children`, each of which is itself a computed
   * entry. The two are different shapes on purpose: parts belong to one row, members
   * ARE rows.
   */
  const walk = (e, r) => {
    const s = e.summary || {};
    const srcLabel = s.sourceLabel || null;
    const source = {
      key: s.sourceKey || 'unknown',
      kind: srcLabel?.kind || null,
      icon: srcLabel?.icon || null,
      name: srcLabel?.chs || null,
      nameEn: srcLabel?.en || null,
      // The universal 附伤 rows carry no icon FILE: their mark is the damage
      // type's glyph, which the legend draws itself. `iconKind` is what says so.
      iconKind: srcLabel?.iconKind || null,
      element: srcLabel?.element || null,
    };

    if (e.kind === 'segment') {
      (e.children || []).forEach((c, i) => {
        const cr = r?.children?.[i];
        if (cr) walk(c, cr);
      });
      return;
    }

    for (const p of r.parts || []) {
      // `total` already includes `hits` -- `computeDamage` returns it that way --
      // so a part that hits twice contributes twice. Reading `perHit` here was the
      // other half of the old bug: 苍噬's two `x2` parts were counted once each.
      if (!Number.isFinite(p.total) || !p.total) continue;
      parts.push({
        charId: e.charId,
        element: p.element || null,
        amount: p.total,
        source,
      });
    }
  };

  for (const e of entries || []) {
    const r = axis?.byId?.get(e.id);
    if (!r) continue;
    walk(e, r);
  }

  const total = parts.reduce((n, p) => n + (p.amount || 0), 0);
  // Nothing recorded yet: an empty chart claiming 0% would read as "this rotation
  // does no damage" rather than "nothing has been entered".
  if (!total) return null;

  const byChar = new Map();
  const byElement = new Map();
  const bySource = new Map();
  for (const p of parts) {
    byChar.set(p.charId, (byChar.get(p.charId) || 0) + p.amount);
    const el = p.element || 'unknown';
    byElement.set(el, (byElement.get(el) || 0) + p.amount);
    // Keyed by the source KEY, with the label kept beside it so the chart can name
    // and draw it without a second lookup.
    const k = p.source.key;
    const cur = bySource.get(k);
    bySource.set(k, {
      amount: (cur?.amount || 0) + p.amount,
      info: cur?.info || p.source,
    });
  }

  // `team` is `useTeamChoices`'s flat shape: `{ id, unitId, chsName, enName }`.
  // Neither `u.char.chsName` nor `u.id` alone covers it -- the entry stores the
  // CHARACTER id, which is `id` here and `unitId` on the unit.
  const unitOf = (id) => (team || []).find((x) => x.id === id || x.unitId === id) || null;
  const nameOf = (id) => {
    const u = unitOf(id);
    return u?.chsName || u?.enName || L({ chs: '未选择角色', en: 'No character' });
  };
  // The damage type's OWN label, from the shared table. Hand-rolling it produced
  // "Physical元素" -- Physical is a damage type, not an element.
  const elName = (el) => {
    if (el === 'unknown') return L({ chs: '未指定', en: 'unset' });
    const label = damageTypeLabel(el);
    if (!label) return el;
    return el === 'Physical'
      ? L({ chs: '物理伤害', en: 'Physical' })
      : L({ chs: `${L(label)}元素`, en: `${L(label)}` });
  };

  /**
   * Turn a `key -> amount` map into chart rows.
   *
   * `base` is the denominator the percentages are taken against, and it is passed
   * IN rather than closed over: a per-character block's shares are of that
   * CHARACTER, not of the axis, so a shared `total` here would make every block's
   * rings sum to the wrong thing.
   */
  const rowsOfOf = (map, labelOf, glyphOf, ns, colorOf, base) =>
    [...map.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v], i) => ({
        // The namespaced key is what hover is tracked by; `raw` is the underlying
        // value (a character id or a damage type) for anything that needs it.
        key: `${ns}:${k}`,
        raw: k,
        label: labelOf(k),
        glyph: glyphOf(k),
        amount: v,
        pct: base > 0 ? (v / base) * 100 : 0,
        // A stable colour per slice by POSITION, so the donut and the legend
        // agree without having to match on the key. `colorOf` overrides it where
        // the data has a colour of its own -- see the element chart.
        slot: i,
        color: colorOf?.(k) || null,
      }));

  const rowsOf = (map, labelOf, glyphOf, ns, colorOf) =>
    rowsOfOf(map, labelOf, glyphOf, ns, colorOf, total);

  const charRows = rowsOf(byChar, nameOf, (id) => {
    const u = unitOf(id);
    return u ? <img src={avatarImg(u.id)} alt="" className="h-[18px] w-[18px] rounded object-cover" /> : null;
  }, 'char');

  /**
   * THE ELEMENT CHART USES EACH ELEMENT'S OWN COLOUR.
   *
   * An arbitrary palette made 风 and 冰 two nearly-identical ambers -- measured, a
   * 53.7%/46.3% split drew as a single blob. The element colours are already the
   * ones shown on every damage card and glyph in the app, so the reader recognises
   * them without a legend, and no two of them are close.
   *
   * Physical has no element colour (it is a damage type), so it falls back to the
   * ramp -- and reads as neutral, which is what it is.
   */
  const elRows = rowsOf(byElement, elName,
    (el) => (el === 'unknown' ? null : <ElementGlyph element={el} size={16} />),
    'el',
    (el) => (el && el !== 'unknown' && el !== 'Physical' ? elementOf(el).color : null));

  /**
   * THE PER-CHARACTER BREAKDOWN.
   *
   * A team total answers "who carries this rotation"; it does not answer "what is
   * this character actually contributing" -- a 88% contributor and a 12% one can
   * have completely different shapes, and the small one's shape is what you change
   * when you want the plan to stop being one character's. So each character gets
   * its own pair of rings over ITS OWN parts, and the shares within a block sum to
   * 100% of that character rather than of the axis.
   *
   * Built from the same `parts` list the team layer uses, filtered by `charId`, so
   * a block cannot disagree with the total above it.
   */
  const charBlocks = [...byChar.keys()]
    .sort((a, b) => (byChar.get(b) || 0) - (byChar.get(a) || 0))
    .map((charId) => {
      const mine = parts.filter((p) => p.charId === charId);
      const mineTotal = mine.reduce((n, p) => n + p.amount, 0);
      const elMap = new Map();
      const srcMap = new Map();
      for (const p of mine) {
        const el = p.element || 'unknown';
        elMap.set(el, (elMap.get(el) || 0) + p.amount);
        const k = p.source.key;
        const cur = srcMap.get(k);
        srcMap.set(k, { amount: (cur?.amount || 0) + p.amount, info: cur?.info || p.source });
      }
      return {
        charId,
        name: nameOf(charId),
        unit: unitOf(charId),
        total: mineTotal,
        // Shares are OF THIS CHARACTER, so each block's rings read independently.
        elRows: rowsOfOf(elMap, elName,
          (el) => (el === 'unknown' ? null : <ElementGlyph element={el} size={16} />),
          `el${charId}`,
          (el) => (el && el !== 'unknown' && el !== 'Physical' ? elementOf(el).color : null),
          mineTotal),
        srcRows: rowsOfOf(
          new Map([...srcMap.entries()].map(([k, v]) => [k, v.amount])),
          (k) => srcMap.get(k)?.info?.name || k,
          (k) => {
            const info = srcMap.get(k)?.info;
            if (info?.iconKind === 'element') return <ElementGlyph element={info.element} size={16} />;
            if (!info?.icon) return null;
            return (
              <img
                src={talentIconImg(info.icon)}
                alt=""
                className="h-[18px] w-[18px] rounded object-cover"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            );
          },
          `src${charId}`,
          null,
          mineTotal,
        ),
      };
    });

  return (
    <div data-axis-summary className="mt-3 flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0a0a0a] p-4">

      {/* ---------------------------------------------- 1. the whole axis */}
      <div className="flex flex-wrap items-center gap-6">
        <Donut
          rows={charRows}
          total={total}
          hover={hover}
          onHover={setHover}
          title={L({ chs: '角色占比', en: 'By character' })}
          tone="teal"
          size={156}
          L={L}
        />
        <Donut
          rows={elRows}
          total={total}
          hover={hover}
          onHover={setHover}
          title={L({ chs: '元素占比', en: 'By element' })}
          tone="amber"
          size={156}
          L={L}
        />

        {/* THE LEGENDS, side by side with their charts so a slice is never hunted
            for. Hovering either the slice or its legend row highlights both. */}
        {/* THE LEGENDS TAKE THEIR OWN ROW ON A NARROW SCREEN. Beside two 156px
            rings, the `flex-1` column was left ~110px wide -- narrower than one
            legend row's own fixed parts -- so the labels and figures spilled past
            the page edge. `basis-full` wraps them onto a full-width line below
            `sm`, where two legends fit side by side again (`basis-0 grow`). */}
        <div className="flex min-w-0 basis-full flex-wrap gap-x-8 gap-y-3 sm:basis-0 sm:grow">
          <Legend
            title={L({ chs: '角色', en: 'Characters' })}
            rows={charRows}
            hover={hover}
            onHover={setHover}
            tone="teal"
            L={L}
          />
          <Legend
            title={L({ chs: '元素', en: 'Elements' })}
            rows={elRows}
            hover={hover}
            onHover={setHover}
            tone="amber"
            L={L}
          />
        </div>

        <div className="flex shrink-0 flex-col items-end">
          <span className="text-[10px] uppercase tracking-wider text-white/35">
            {L({ chs: '本轴总伤害', en: 'Axis total' })}
          </span>
          <span className="text-[24px] font-bold leading-tight tabular-nums text-white">
            {Math.round(total).toLocaleString('en-US')}
          </span>
        </div>
      </div>

      {/* ------------------------------------ 2. each character's own shape */}
      {/*
        ALWAYS SHOWN, not gated on the team size.
        
        The first version rendered this only when there were two or more
        characters, on the reasoning that a single character's block would restate
        the team rings. That reasoning was wrong for the most common case: a
        single-character rotation still has a SOURCE split -- 战技 / 爆发 / 普攻 /
        命座 / 天赋 -- which the team layer never shows and which is the whole point
        of the breakdown. The gate hid exactly the interesting half.
        
        What a single-character block drops instead is the ELEMENT ring, because
        that one genuinely does restate the team ring above it. The source ring is
        kept because nothing else carries it.
      */}
      <div className="flex flex-col gap-3 border-t border-white/10 pt-3">
        <span className="text-[10px] uppercase tracking-wider text-white/25">
          {charBlocks.length > 1
            ? L({ chs: '各角色明细', en: 'Per character' })
            : L({ chs: '伤害来源明细', en: 'By source' })}
        </span>
        {charBlocks.map((b) => (
          <div
            key={b.charId}
            data-char-block={b.charId}
            className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-white/[0.07] bg-white/[0.015] p-3"
          >
            {/* Who, and how much of the axis they are. */}
            <div className="flex w-[132px] shrink-0 items-center gap-2">
              {b.unit && (
                <img src={avatarImg(b.unit.id)} alt="" className="h-7 w-7 rounded object-cover" />
              )}
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[12px] font-medium text-white">{b.name}</span>
                <span className="text-[10px] tabular-nums text-white/40">
                  {Math.round(b.total).toLocaleString('en-US')}
                  <span className="ml-1 text-white/25">
                    {((b.total / total) * 100).toFixed(1)}%
                  </span>
                </span>
              </span>
            </div>

            {/* The per-ring title is now BLANK in a character block: the legend
                beside each ring is already headed 元素 / 伤害来源, and the ring's
                centre shows its leading icon, so a third label above every ring was
                the clutter rather than the clarity. The team layer keeps its titles,
                where the rings stand alone without a legend header of their own. */}
            {b.elRows.length > 1 && (
              <Donut
                rows={b.elRows}
                total={b.total}
                hover={hover}
                onHover={setHover}
                title=""
                tone="amber"
                size={112}
                L={L}
              />
            )}
            <Donut
              rows={b.srcRows}
              total={b.total}
              hover={hover}
              onHover={setHover}
              title=""
              tone="violet"
              size={112}
              L={L}
            />

            {/* Same wrap rule as the team legends above: a per-character block
                fits two 84px rings plus the name column eagerly, which leaves the
                compact legend too little room and spills its figures past the page
                edge. Full width below `sm`, side by side above it. */}
            <div className="flex min-w-0 basis-full flex-wrap gap-x-6 gap-y-2 sm:basis-0 sm:grow">
              {b.elRows.length > 1 && (
                <Legend
                  title={L({ chs: '元素', en: 'Element' })}
                  rows={b.elRows}
                  hover={hover}
                  onHover={setHover}
                  tone="amber"
                  L={L}
                  compact
                />
              )}
              <Legend
                title={L({ chs: '伤害来源', en: 'Source' })}
                rows={b.srcRows}
                hover={hover}
                onHover={setHover}
                tone="violet"
                L={L}
                compact
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Slice colours, by position.
 *
 * THE FIRST VERSION'S RAMPS WERE TOO CLOSE TOGETHER. `amber` began
 * `#f0b429, #e08b2a` -- two yellow-oranges -- so a 53.7% / 46.3% split drew as one
 * blob and the chart conveyed nothing. A categorical palette has to be separable at
 * a glance and at 16px, so these alternate hue rather than shade.
 *
 * The character ramp starts with the app's teal because that is the accent a
 * single-character axis already uses everywhere else.
 */
const RAMP = {
  teal: ['#7fd4c1', '#8fa6ff', '#f0b429', '#e0729a', '#9ae06a', '#c08fff'],
  // The element chart rarely uses this: an element's own colour is used when the
  // data names one, which is far more legible than an arbitrary hue. This is the
  // fallback for 物理/未指定 and for more slices than the element table covers.
  amber: ['#f0b429', '#8fa6ff', '#e0729a', '#7fd4c1', '#c08fff', '#9ae06a'],
  // A third ramp for the source chart, which sits beside the character one and
  // must not read as the same series.
  violet: ['#c08fff', '#7fd4c1', '#f0b429', '#8fa6ff', '#e0729a', '#9ae06a'],
};

/**
 * The dark plate a slice's own glyph sits on, in px -- a CEILING, not a size.
 *
 * The glyphs are drawn at 16px everywhere in the app (the legend here, the damage
 * cards, the source picker), so the plate exists to hold one of those and has no
 * reason to grow past it: at 0.17 * size the team rings' marks went to 26px when
 * the rings were enlarged, and a fixed 16px icon on a 26px disc read as a smudge
 * floating in a blob rather than as a labelled slice. The per-slice cap below
 * still shrinks a mark on a thin arc; this one only stops it growing.
 */
const MARK_PLATE = 20;

/**
 * A donut chart, drawn as SVG arcs.
 *
 * SVG rather than a chart library: every dependency here has to survive being
 * served from a static export, and a 40px arc is four lines of trigonometry.
 *
 * `stroke-dasharray` on a circle is the whole trick -- each slice is the same
 * circle with a different dash offset, so no path maths is needed and the joins
 * land exactly.
 */
function Donut({ rows, total, hover, onHover, title, tone, size = 120, L }) {
  const stroke = size * 0.16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const colors = RAMP[tone];
  let offset = 0;
  // Resolved ONCE rather than three times per render, and outside JSX so the
  // `hover` key is matched against a real row before being read.
  const hovered = rows.find((x) => x.key === hover) || null;
  /**
   * Dim only when the hover belongs to THIS chart.
   *
   * A shared `hover` across both charts meant pointing at an element faded every
   * character slice too -- the key matched nothing there, and "no match" was
   * treated as "not this one". Two related charts side by side should not react to
   * each other: each answers its own question.
   *
   * The namespace makes that decidable: `char:` keys belong to the character chart,
   * `el:` to the element chart, so a chart can tell "not mine" from "not hovered".
   */
  const myNS = rows.length ? String(rows[0].key).split(':')[0] : null;
  const hoverIsMine = hover && myNS && hover.startsWith(`${myNS}:`);

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      {/* An empty `title` renders no line at all, rather than an empty one that
          would shift the ring up relative to its neighbours. */}
      {title ? (
        <span className="text-[10px] uppercase tracking-wider text-white/35">{title}</span>
      ) : null}
      {/* The centre figure is overlaid rather than laid out beside the chart: a
          negative margin depended on the label's own height and moved whenever the
          text wrapped. */}
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {/* The track, so a single 100% slice still reads as a proportion. */}
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
          {rows.map((row) => {
            const len = (row.pct / 100) * c;
            const el = (
              <circle
                key={row.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={row.color || colors[row.slot % colors.length]}
                strokeWidth={hover === row.key ? stroke * 1.35 : stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                // A hovered slice brightens and thickens rather than moving, so the
                // chart does not jump under the pointer.
                opacity={hoverIsMine && hover !== row.key ? 0.35 : 1}
                className="cursor-pointer transition-[opacity,stroke-width] duration-150"
                onMouseEnter={() => onHover(row.key)}
                onMouseLeave={() => onHover(null)}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        {/*
          EACH SLICE'S OWN ICON, SITTING ON ITS OWN ARC.
          
          The centre used to carry the leading slice's glyph, which said nothing
          about the rest of the ring -- you could see the art was dominated by one
          thing but not what the other slices were. A mark at each arc's MIDPOINT
          labels every slice in place, so the ring reads without consulting the
          legend, and it is the same glyph the legend row and the source picker
          draw.
          
          THE ICON IS HIDDEN WHEN ITS SLICE IS TOO THIN to hold one: at 12px a
          label wider than its arc overlaps its neighbours and turns the ring into
          noise. Below that threshold the slice keeps its colour and its legend row,
          which is where a small share belongs anyway.
        */}
        {rows.map((row) => {
          // Angles are measured from 12 o'clock, matching the svg's -rotate-90.
          // `startPct` is where this slice begins; its midpoint is half its span on.
          const startPct = rows
            .slice(0, row.slot)
            .reduce((n, x) => n + x.pct, 0);
          const midPct = startPct + row.pct / 2;
          // A LONE SLICE PUTS ITS ICON AT 12 O'CLOCK. With one slice covering the
          // whole ring, the arc's midpoint is 6 o'clock -- an arbitrary place that
          // reads as a marker on the bottom of the circle rather than as a label
          // for it. The top is where the eye starts.
          const angle = rows.length === 1
            ? -Math.PI / 2
            : (midPct / 100) * 2 * Math.PI - Math.PI / 2;
          /**
           * THE ICON IS CAPPED BY ITS ARC'S OWN LENGTH, not by a fraction of the
           * ring. `(pct/100) * c` is the arc's length in px, and the glyph must fit
           * inside it or it overhangs its neighbours -- measured on the 84px ring
           * the panel started with, a 12.8% slice gave a 14px icon on a 34px arc,
           * and the two smallest slices' marks visibly overlapped their neighbours.
           *
           * The 0.62 factor leaves a gap between adjacent marks, and MARK_PLATE
           * keeps a mark from outgrowing the glyph it holds. See above.
           */
          const arcLen = (row.pct / 100) * c;
          const iconSize = Math.min(size * 0.17, arcLen * 0.62, MARK_PLATE);
          // Below ~9px the glyph is illegible and the mark is just a smudge on the
          // arc, so a thin slice gets none and is read from its legend row.
          const fits = iconSize >= 9;
          return (
            <span
              key={`onarc-${row.key}`}
              className="pointer-events-none absolute flex items-center justify-center rounded-full transition-opacity duration-150"
              style={{
                width: iconSize,
                height: iconSize,
                left: size / 2 + Math.cos(angle) * r - iconSize / 2,
                top: size / 2 + Math.sin(angle) * r - iconSize / 2,
                opacity: !fits ? 0 : (hoverIsMine && hover !== row.key ? 0.3 : 1),
                // A dark disc behind the mark: the glyphs are white silhouettes, so
                // sitting one straight on a coloured arc washes it out -- and the
                // arc's colour is the thing the ring is communicating, so the icon
                // must not be given a tinted plate that muddies it.
                backgroundColor: '#0a0a0a',
              }}
            >
              {row.glyph}
            </span>
          );
        })}
        {/* THE CENTRE IS EMPTY, except while hovering: the ring's job is to show
            the split, and a figure parked in the middle competed with the arcs for
            the same glance. Hovering is where the precise number belongs. */}
        {hovered && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[15px] font-bold leading-none tabular-nums text-white">
              {hovered.pct.toFixed(1)}%
            </span>
            <span className="mt-0.5 max-w-[74px] truncate text-[9px] text-white/55">
              {hovered.label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** One titled legend: chip, glyph, name, bar, percentage and amount. */
function Legend({ title, rows, hover, onHover, tone, L, compact = false }) {
  const ramp = RAMP[tone];
  // Same rule as the donut: react only to a hover this legend owns, so pointing at
  // an element does not grey the character list beside it.
  const myNS = rows.length ? String(rows[0].key).split(':')[0] : null;
  const hoverIsMine = hover && myNS && hover.startsWith(`${myNS}:`);
  return (
    <div className={`flex w-full min-w-0 flex-col gap-1.5 sm:w-auto sm:flex-1 ${compact ? 'sm:min-w-[190px]' : 'sm:min-w-[260px]'}`}>
      <span className="text-[10px] uppercase tracking-wider text-white/25">{title}</span>
      {rows.map((r) => {
        const on = hover === r.key;
        const dim = hoverIsMine && !on;
        /**
         * EACH ROW'S OWN SLICE COLOUR, from the same `row.color || ramp[slot]` the
         * donut uses. Every bar was drawn in `ramp[0]`, so a two-character split
         * showed two identical bars beside a ring that was correctly two colours --
         * the legend disagreed with the chart it was explaining.
         */
        const color = r.color || ramp[r.slot % ramp.length];
        return (
          <div
            key={r.key}
            data-summary-row={r.key}
            onMouseEnter={() => onHover(r.key)}
            onMouseLeave={() => onHover(null)}
            className={`flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors ${
              on ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
            }`}
          >
            <span
              className="h-[9px] w-[9px] shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
              {r.glyph}
            </span>
            <span className="w-[64px] shrink-0 truncate text-[11px] text-white/70 sm:w-[80px]" title={r.label}>
              {r.label}
            </span>
            {/* The bar is the quick read; the numbers beside it are the precise one.
                Both, because a bar alone cannot be compared across rows to a percent
                and a percentage alone does not show relative size at a glance. */}
            <span className="h-[6px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <span
                className="block h-full rounded-full transition-[width] duration-150"
                style={{ width: `${r.pct}%`, backgroundColor: color, opacity: on ? 1 : dim ? 0.4 : 0.8 }}
              />
            </span>
            <span className="w-[44px] shrink-0 text-right text-[11px] font-medium tabular-nums text-white/85">
              {r.pct.toFixed(1)}%
            </span>
            <span className="w-[52px] shrink-0 text-right text-[10px] tabular-nums text-white/35 sm:w-[62px]">
              {Math.round(r.amount).toLocaleString('en-US')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// A dialog that sets ONE value across EVERY entry on the axis.
//
// WHY THIS EXISTS
//   The per-entry panel is deliberately per-entry: crit mode, the enemy's level
//   and its resistances are all editable on each card, and most of the time that
//   is what you want -- one part of a row fished for a crit, another not. But
//   when you switch the enemy you are modelling, or decide the whole rotation
//   should be read as a crit, doing it card by card is both slow and easy to get
//   half-done. This is the "do it once" control.
//
// WHY THE FIELDS ARE A SUBSET, NOT THE WHOLE PANEL
//   Only the fields that are the SAME for every hit are offered. Attack, crit
//   rate, DMG bonus and the like are per-character and per-artifact -- they are
//   DERIVED from who is hitting and what they wear, so a single value across the
//   axis would be meaningless. What is left is the ENEMY and the READOUT MODE:
//   things that describe the situation the whole rotation is measured in.
//
//   RES SHRED IS NOT ONE OF THEM, even though it lives in the same group on the
//   card. See the filter below.
//
// WHY EVERY ROW IS OPT-IN
//   Applying all of them at once would clobber the parts a user had intentionally
//   set differently -- the very thing per-entry editing is for. So each row is a
//   checkbox plus a value, and only the ticked rows move. A row is TICKED THE
//   MOMENT IT IS EDITED, which is the one gesture everyone makes anyway.
//
// RECOVERY
//   Apply is one step and it is reversible: the caller snapshots the axis before
//   it runs and offers the snapshot back through the toolbar. The dialog itself
//   does not undo -- it does not own the entries.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { STAT_DEFS } from '../DamageCard';
import { iconImg, ICON_WHITE } from '../game';

const CRIT_MODES = [
  { k: 'never', chs: '不计暴击', en: 'No Crit' },
  { k: 'avg', chs: '期望', en: 'Expected' },
  { k: 'crit', chs: '必定暴击', en: 'Crit' },
];

export default function BulkStatsDialog({ open, entryCount = 0, onCancel, onApply, L }) {
  // Which rows are ticked, and the number typed beside each. Kept TOGETHER in one
  // object so a single reset clears both and neither can lag the other.
  const [enabled, setEnabled] = useState(() => ({}));
  const [values, setValues] = useState(() => ({}));
  const [critMode, setCritMode] = useState(null);

  // A FRESH DIALOG EACH TIME IT OPENS. Reopening after an apply must not carry
  // the last value as though it were still pending, and a stale tick would make
  // the next Apply touch a field the user never opened this round.
  useEffect(() => {
    if (!open) return;
    setEnabled({});
    setValues({});
    setCritMode(null);
  }, [open]);

  // The fields, labelled once. STAT_DEFS carries both languages.
  //
  // RES SHRED IS EXCLUDED. Those fields are something the PLAYER grants -- a set
  // bonus, a shield -- and several sources add together; they belong to the buff
  // layer, not to the enemy you are modelling. The enemy itself has ONE
  // resistance per element, so `enemyRes*` is the whole of what this dialog is
  // for. Offering `resShred` here would put a player-granted number under a
  // heading that says "the enemy", which is the kind of misfiling that ends in a
  // number nobody can explain.
  const fields = useMemo(
    () => STAT_DEFS.filter((d) => d.group === 'enemy' && !d.key.startsWith('resShred')),
    []
  );

  const enabledCount = Object.keys(enabled).filter((k) => enabled[k]).length
    + (critMode ? 1 : 0);

  const setValue = (key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    // EDITING TICKS THE ROW. Typing a number for a box that stays unticked would
    // make the most natural gesture -- type, then Apply -- silently do nothing.
    setEnabled((e) => ({ ...e, [key]: true }));
  };

  const toggle = (key) => setEnabled((e) => ({ ...e, [key]: !e[key] }));

  const apply = () => {
    const stats = {};
    for (const d of fields) {
      if (enabled[d.key]) {
        // A TICKED ROW WITH NOTHING TYPED falls back to the field's own default,
        // so "make everything 0% RES" needs no typing.
        stats[d.key] = values[d.key] ?? d.def;
      }
    }
    onApply?.({ critMode, stats });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      data-dialog
      data-bulk-dialog
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel?.()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={L({ chs: '统一设置', en: 'Bulk settings' })}
        className="flex max-h-[86vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f13]/95 shadow-2xl shadow-black/80 backdrop-blur-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/5 p-4 pb-3">
          <div>
            <h2 className="text-sm font-bold text-white" data-dialog-title>
              {L({ chs: '统一设置', en: 'Bulk settings' })}
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-white/45">
              {L({
                chs: '勾选的项会写入本轴的所有条目（含循环成员与多段分段），并覆盖它们各自的自定义值。',
                en: 'Ticked fields are written to every entry on this axis (including loop members and multi-part children), overriding their own values.',
              })}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="shrink-0 rounded-md px-2 py-0.5 text-white/30 transition-colors hover:text-white/80"
            title={L({ chs: '关闭', en: 'Close' })}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5 hover:[&::-webkit-scrollbar-thumb]:bg-white/20">

          {/* Crit mode, which is a choice rather than a number. */}
          <div className="mb-4">
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-white/30">
              {L({ chs: '暴击模式', en: 'Crit mode' })}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {CRIT_MODES.map((o) => (
                <button
                  key={o.k}
                  data-bulk-crit={o.k}
                  onClick={() => setCritMode(critMode === o.k ? null : o.k)}
                  className={
                    'rounded-lg border px-2.5 py-1 text-[11px] transition-colors '
                    + (critMode === o.k
                      ? 'border-primary/60 bg-primary/20 text-white'
                      : 'border-white/10 text-white/50 hover:text-white')
                  }
                >
                  {L(o)}
                </button>
              ))}
              {critMode && (
                <span className="text-[10px] text-[#7fd4c1]">
                  {L({ chs: '将应用于全部', en: 'applies to all' })}
                </span>
              )}
            </div>
          </div>

          {/* The enemy group, straight from the card's own table. */}
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-white/30">
            {L({ chs: '敌方 / 其他', en: 'Enemy & Other' })}
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {fields.map((d) => {
              const on = !!enabled[d.key];
              return (
                <div
                  key={d.key}
                  data-bulk-field={d.key}
                  className={
                    'rounded-lg border px-2 py-1.5 transition-colors '
                    + (on ? 'border-[#7fd4c1]/40 bg-[#7fd4c1]/[0.06]' : 'border-white/10 bg-white/[0.02]')
                  }
                >
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(d.key)}
                      className="h-3 w-3 shrink-0 accent-[#7fd4c1]"
                    />
                    {d.icon && (
                      <img src={iconImg(d.icon)} alt="" className="h-2.5 w-2.5 shrink-0" style={{ filter: ICON_WHITE }} />
                    )}
                    <span className="min-w-0 truncate text-[10px] text-white/60" title={L(d)}>
                      {L(d)}
                    </span>
                  </label>
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      type="number"
                      data-bulk-input={d.key}
                      value={values[d.key] ?? d.def}
                      onChange={(e) => setValue(d.key, Number(e.target.value) || 0)}
                      className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-right text-[12px] font-semibold tabular-nums text-white outline-none focus:border-[#7fd4c1]/50"
                    />
                    {d.suffix && <span className="shrink-0 text-[10px] text-white/35">{d.suffix}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/5 p-4 pt-3">
          <span className="text-[11px] text-white/35">
            {entryCount > 0
              ? L({ chs: '将写入 ' + entryCount + ' 个条目', en: 'Applies to ' + entryCount + ' entries' })
              : L({ chs: '本轴还没有条目', en: 'This axis has no entries yet' })}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-medium text-white/60 transition-colors hover:border-white/30 hover:text-white"
            >
              {L({ chs: '取消', en: 'Cancel' })}
            </button>
            <button
              data-bulk-apply
              disabled={!enabledCount}
              onClick={apply}
              className={
                'rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors '
                + (enabledCount
                  ? 'border-[#7fd4c1]/50 bg-[#7fd4c1]/15 text-[#7fd4c1] hover:bg-[#7fd4c1]/25'
                  : 'cursor-not-allowed border-white/10 text-white/25')
              }
            >
              {L({ chs: '应用', en: 'Apply' })}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
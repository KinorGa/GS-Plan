// A free-text note on one entry.
//
// WHY AN ENTRY CAN HOLD ONE. A rotation carries reasoning that is not arithmetic:
// "crit-fished", "only while X's shield is up", "measured on 12-1". None of that
// belongs in a stat field, and all of it is worth having the next time the file is
// opened. So it lives on the entry, beside the buffs and the overrides, and
// round-trips with the save.
//
// ON EVERY HIT, not on the rows that hold hits. The smallest unit is the thing a
// person annotates -- one stage of one skill, one half of a compound row -- so an
// ordinary entry, a loop's member and a compound row's part all carry their own.
// A note on a LOOP would be a note on a container, which is a different (and
// unasked-for) feature.
//
// ONE CLICK OPENS IT, and the control is ALWAYS THERE. A note box that appears
// only once a note exists cannot be found by the person who has none, which is
// exactly the person who needs to write the first one.

import { useEffect, useRef, useState } from 'react';

export default function EntryNote({ value, onChange, L, variant = 'row' }) {
  const text = value || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const ref = useRef(null);

  // Grow to fit what is typed: a textarea that scrolls its own content hides the
  // line the user is on, and `rows={1}` alone would clip the second one.
  const grow = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    // The caret goes to the END rather than selecting the lot: re-opening a note
    // to append to it is the common case, and replacing it is not.
    el.setSelectionRange(el.value.length, el.value.length);
    grow(el);
  }, [editing]);

  // `next !== text` so a blur that follows an Enter does not write twice -- and,
  // more importantly, so re-opening and closing a note cannot change it.
  const commit = () => {
    const next = draft.trim();
    if (next !== text) onChange?.(next);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(text);
    setEditing(false);
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        data-entry-note-input
        value={draft}
        rows={1}
        onChange={(e) => { setDraft(e.target.value); grow(e.target); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          // Enter saves, Shift+Enter breaks the line. A note is usually one
          // thought; a list of them is the exception, and it is the one that gets
          // the modifier.
          else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
        }}
        onBlur={commit}
        placeholder={L({
          chs: '笔记：回车保存，Shift+回车换行，Esc 取消',
          en: 'Note: Enter saves, Shift+Enter adds a line, Esc cancels',
        })}
        className="min-w-0 w-full resize-none rounded-md border border-[#7fd4c1]/40 bg-black/40 px-2 py-1 text-[11px] leading-snug text-white outline-none placeholder:text-white/25"
      />
    );
  }

  const empty = !text;

  return (
    <button
      type="button"
      data-entry-note={empty ? 'empty' : 'set'}
      onClick={() => { setDraft(text); setEditing(true); }}
      title={text || L({ chs: '给这条记录记点笔记', en: 'Add a note to this row' })}
      className={
        variant === 'card'
          ? 'block w-full rounded-md border border-dashed border-white/10 bg-white/[0.02] px-2 py-1 text-left text-[11px] leading-snug text-white/25 transition-colors hover:border-white/25 hover:bg-white/[0.05] hover:text-white/60'
          : 'block min-w-0 flex-1 truncate rounded-md border border-dashed border-white/10 px-2 py-0.5 text-left text-[11px] leading-snug text-white/25 transition-colors hover:border-white/25 hover:bg-white/[0.05] hover:text-white/60'
      }
    >
      {empty ? (
        // The box keeps its dashed outline even when empty, so the control is
        // findable on a row nobody has written on yet -- which is every row to
        // start with.
        <span className="text-white/25">
          ＋ {L({ chs: '笔记', en: 'Note' })}
        </span>
      ) : (
        <span className={variant === 'card' ? 'whitespace-pre-wrap text-white/60' : 'text-white/55'}>
          {text}
        </span>
      )}
    </button>
  );
}

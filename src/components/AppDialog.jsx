// A small in-app dialog: confirm an action, or ask for one line of text.
//
// WHY NOT `window.confirm` / `window.prompt`
//   They were used first because they need no machinery and are impossible to get
//   wrong. But they render as OS chrome in a light theme on top of a dark app, and
//   a native prompt cannot say what it is asking or label its buttons. Renaming an
//   axis looked like a browser error box.
//
//   A native `confirm` also BLOCKS the whole page, which is why the earlier tests
//   had to attach dialog handlers; this one is ordinary React state.
//
// PORTALLED AND VIEWPORT-FIXED
//   The same reason the picker menus are: an overlay inside a component with
//   `overflow-hidden` or `backdrop-filter` (the artifact panel is both) would be
//   clipped or trapped. Portalling to the body removes the question.
//
// ONE COMPONENT, TWO SHAPES
//   With `input` it behaves as a prompt and returns the typed string; without it
//   it is a confirmation. Both need the same overlay, focus trap and Escape
//   handling, so splitting them would duplicate all of it.
//
// The caller owns `open` and clears it in `onConfirm` / `onCancel`. The dialog
// deliberately does NOT close itself: the caller usually has a follow-up (apply
// the rename, run the delete) and closing first would make that ordering unclear.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * @param {boolean}  open
 * @param {string}   title
 * @param {React.ReactNode} [body]        Extra content above the field/buttons.
 * @param {object}   [input]              `{ defaultValue, placeholder, maxLength }`.
 *                                        Present means "ask for text".
 * @param {string}   confirmLabel
 * @param {string}   cancelLabel
 * @param {'default'|'danger'} [tone]
 * @param {Function} onConfirm            Receives the typed string when `input` is set.
 * @param {Function} onCancel
 */
export default function AppDialog({
  open,
  title,
  body,
  input,
  confirmLabel = '确定',
  cancelLabel = '取消',
  tone = 'default',
  onConfirm,
  onCancel,
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  // Reset to the caller's default each time it OPENS, not on every render: a
  // rename dialog reopened for a different axis must not carry the previous
  // axis's name, and typing must not fight a default that keeps re-applying.
  useEffect(() => {
    if (open) setValue(input?.defaultValue ?? '');
  }, [open, input?.defaultValue]);

  /**
   * Focus, and put the caret at the END of the existing text.
   *
   * THIS USED TO BE `select()`, which highlighted the whole name -- "renaming
   * starts by typing over the old name". That is right for a name you intend to
   * replace entirely, and wrong for the far more common case of fixing one
   * character: the highlight is easy to miss, so the first keystroke silently
   * wiped the name instead of editing it, and the field looked like it could only
   * ever be replaced. Putting the caret at the end makes both work -- appending
   * and backspacing are immediate, and Ctrl+A still selects everything for a full
   * replacement.
   *
   * The END rather than index 0 for the same reason: `setSelectionRange(0,0)` also
   * counts as "not selected", but it would type the new text BEFORE the old name,
   * which is a stranger starting point than simply continuing it.
   */
  useEffect(() => {
    if (!open || !input) return;
    const t = setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }, 0);
    return () => clearTimeout(t);
  }, [open, input]);

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
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      // `mousedown` rather than `click`: a drag that starts inside the panel and
      // ends on the overlay would otherwise close it, discarding a typed name.
      onMouseDown={(e) => e.target === e.currentTarget && onCancel?.()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[380px] rounded-2xl border border-white/10 bg-[#0f0f13]/95 p-4 shadow-2xl shadow-black/80 backdrop-blur-xl"
      >
        <h2 className="text-sm font-bold text-white" data-dialog-title>{title}</h2>

        {body && <div className="mt-2 text-[11px] leading-relaxed text-white/50">{body}</div>}

        {input && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onConfirm?.(value);
            }}
          >
            <input
              ref={inputRef}
              data-dialog-input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={input.placeholder}
              maxLength={input.maxLength}
              className="mt-3 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-[12px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-[#7fd4c1]/50"
            />
            {/* The form is submitted by Enter, so the buttons do not need to be
                inside it -- but they live in it anyway so the default button
                behaviour applies. */}
            <div className="mt-4 flex justify-end gap-2">
              <DialogButton onClick={onCancel}>{cancelLabel}</DialogButton>
              <DialogButton submit tone={tone}>{confirmLabel}</DialogButton>
            </div>
          </form>
        )}

        {!input && (
          <div className="mt-4 flex justify-end gap-2">
            <DialogButton onClick={onCancel}>{cancelLabel}</DialogButton>
            <DialogButton onClick={onConfirm} tone={tone}>{confirmLabel}</DialogButton>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function DialogButton({ children, onClick, submit, tone }) {
  const style = tone === 'danger'
    ? 'border-red-400/30 bg-red-500/10 text-red-300 hover:border-red-400/60 hover:bg-red-500/20'
    : 'border-white/10 text-white/60 hover:border-white/30 hover:text-white';

  return (
    <button
      type={submit ? 'submit' : 'button'}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors ${style}`}
    >
      {children}
    </button>
  );
}
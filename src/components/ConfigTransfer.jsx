// Import and export the WHOLE configuration: the team plus every damage axis.
//
// WHY IT MOVED OUT OF THE TEAM PANEL
//   This used to export the team alone. A team with no rotation is half a plan,
//   and the axis had no way out of the browser at all -- so sharing a setup, or
//   keeping a backup, silently dropped the part that takes longest to build.
//
//   The row still sits in the same place on screen (the panel it lived in has no
//   visual box of its own), but it is now owned by the page that knows about both
//   documents rather than by the component that knows about one.
//
// WHY A FILE RATHER THAN SOMETHING CLEVERER
//   A configuration is a small, self-contained document. A file is the one format
//   that survives a browser change, a machine change and a year, and it needs no
//   server. It is also the format a damage calculator or a spreadsheet can read.
//
// WHY THE DOWNLOAD GOES THROUGH A BLOB
//   The app is a static page with no backend, so the file is built in the browser
//   from the serialised document. `URL.createObjectURL` is revoked immediately
//   after the click: leaving it alive leaks the whole document for the life of
//   the page.
//
// WHY IMPORT PARSES BEFORE IT ASKS
//   The file is fully parsed and validated FIRST, so a wrong file reports why
//   before anything is confirmed, and confirming cannot then fail halfway. The
//   confirmation states what will be replaced, because the import overwrites the
//   team and every axis and that is not recoverable.

import { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useTeam } from '../lib/team-context';
import { buildConfigFile, configFilename, describeImport, parseConfigFile } from '../lib/config-file';
import AppDialog from './AppDialog';

/**
 * @param {object}   axes           The live axes state: `{ version, axes, activeId }`.
 * @param {Function} onReplaceAxes  Called with a parsed `{ axes, activeId }` on import.
 * @param {Function} onClearAxes    Called to reset the axes to a single blank one.
 */
export default function ConfigTransfer({ axes, onReplaceAxes, onClearAxes }) {
  const { L } = useI18n();
  const { units, replaceTeam } = useTeam();
  const fileRef = useRef(null);
  const [status, setStatus] = useState(null); // { kind: 'ok' | 'error', text }
  // The parsed file waiting on confirmation. Held rather than re-read, so the
  // dialog can describe it and confirming cannot fail after the fact.
  const [pendingImport, setPendingImport] = useState(null);
  const [clearing, setClearing] = useState(false);

  const axisCount = axes?.axes?.length || 0;
  const entryCount = (axes?.axes || []).reduce((n, a) => n + (a.entries?.length || 0), 0);

  const download = () => {
    const text = buildConfigFile({
      team: { units },
      axes: axes?.axes,
      activeId: axes?.activeId,
    });
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = configFilename();
    a.click();
    // Revoked on the next tick: revoking synchronously can cancel the download in
    // some browsers before it has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);

    setStatus({
      kind: 'ok',
      text: L({
        chs: `已导出 ${units.length} 个角色、${axisCount} 个轴共 ${entryCount} 个条目`,
        en: `Exported ${units.length} units, ${axisCount} axes, ${entryCount} entries`,
      }),
    });
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    // Reset the input's value so choosing the SAME file twice still fires a
    // change event -- otherwise a failed import cannot be retried.
    e.target.value = '';
    if (!file) return;

    let parsed;
    try {
      parsed = parseConfigFile(await file.text());
    } catch (err) {
      setStatus({ kind: 'error', text: err.message });
      return;
    }

    // Parsed and validated FIRST, so this dialog can state exactly what will be
    // replaced and confirming cannot then fail halfway.
    setPendingImport(parsed);
  };

  const confirmImport = () => {
    const parsed = pendingImport;
    setPendingImport(null);
    if (!parsed) return;

    replaceTeam(parsed.team);
    // `axes: null` means the file was team-only, so the existing axes stand.
    if (parsed.axes) onReplaceAxes({ axes: parsed.axes, activeId: parsed.activeId });

    setStatus({
      kind: 'ok',
      text: L({ chs: '导入成功', en: 'Imported' }),
      detail: describeImport(parsed),
    });
  };

  const clearAll = () => setClearing(true);

  const confirmClear = () => {
    setClearing(false);
    replaceTeam({ units: [] });
    onClearAxes();
    setStatus({ kind: 'ok', text: L({ chs: '已清空全部配置', en: 'Cleared everything' }) });
  };

  const empty = !units.length && !entryCount;

  /**
   * What the pending import will bring, or null when no file is waiting.
   *
   * Named rather than `d` because it is referenced inside JSX.
   */
  const pendingDetails = pendingImport ? describeImport(pendingImport) : null;

  return (
    <div data-config-transfer className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
      <span className="text-[10px] uppercase tracking-wider text-white/25">
        {L({ chs: '配置数据', en: 'Configuration' })}
      </span>

      <TransferButton onClick={download} disabled={empty} data-export>
        {L({ chs: '导出 JSON', en: 'Export JSON' })}
      </TransferButton>

      <TransferButton onClick={() => fileRef.current?.click()} data-import>
        {L({ chs: '导入 JSON', en: 'Import JSON' })}
      </TransferButton>

      <TransferButton onClick={clearAll} disabled={empty} tone="danger" data-clear>
        {L({ chs: '清空全部', en: 'Clear all' })}
      </TransferButton>

      {/* The label carries the scope, because a button reading "导出" next to a
          team used to mean the team and now means the whole page. */}
      <span className="text-[10px] text-white/25">
        {L({ chs: '（队伍 + 全部伤害轴）', en: '(team + all axes)' })}
      </span>

      {/* A file input is the only way to open the OS picker, and it cannot be
          styled, so it is hidden and driven by the button above. */}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={onFile}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />

      {status && (
        <span
          className={`text-[10px] ${status.kind === 'error' ? 'text-red-400' : 'text-[#7fd4c1]'}`}
          data-transfer-status={status.kind}
        >
          {status.kind === 'error'
            ? `${L({ chs: '导入失败', en: 'Import failed' })}: ${status.text}`
            : status.text}
        </span>
      )}

      <AppDialog
        open={!!pendingImport}
        title={L({ chs: '导入配置', en: 'Import configuration' })}
        // `pendingDetails && (...)` is REQUIRED, not defensive.
        //
        // JSX evaluates every prop eagerly, so `body={...pendingDetails.axes...}`
        // ran even while the dialog was closed and `pendingDetails` was null --
        // and the whole page crashed with "Cannot read properties of null
        // (reading 'axes')" on first render. A component returning null for
        // `!open` does not protect its props.
        body={pendingDetails && (
          <div className="flex flex-col gap-2.5">
            {/* Two labelled rows rather than a sentence each. The first version
                printed both as the same sentence with the same numbers when the
                file matched what was already loaded, so it was impossible to tell
                which line was the current state and which was the file. */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-white/30">
                {L({ chs: '当前（将被替换）', en: 'Current (will be replaced)' })}
              </span>
              <span className="text-white/45" data-current-summary>
                {L({
                  chs: `队伍 ${units.length} 个角色 · ${axisCount} 个轴 · ${entryCount} 个条目`,
                  en: `${units.length} units · ${axisCount} axes · ${entryCount} entries`,
                })}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[#7fd4c1]/60">
                {L({ chs: '文件', en: 'File' })}
              </span>
              <span className="text-[#7fd4c1]" data-file-summary>
                {pendingDetails.axes === null
                  ? L({
                    chs: `只有队伍数据（旧格式）：${pendingDetails.units} 个角色 —— 轴将保持不变`,
                    en: `Team only (older format): ${pendingDetails.units} units -- axes are left alone`,
                  })
                  : L({
                    chs: `队伍 ${pendingDetails.units} 个角色 · ${pendingDetails.axes} 个轴 · ${pendingDetails.entries} 个条目`,
                    en: `${pendingDetails.units} units · ${pendingDetails.axes} axes · ${pendingDetails.entries} entries`,
                  })}
              </span>
            </div>
          </div>
        )}
        confirmLabel={L({ chs: '导入', en: 'Import' })}
        tone="danger"
        onConfirm={confirmImport}
        onCancel={() => {
          setPendingImport(null);
          setStatus({ kind: 'ok', text: L({ chs: '已取消导入', en: 'Import cancelled' }) });
        }}
      />

      <AppDialog
        open={clearing}
        title={L({ chs: '清空全部配置', en: 'Clear everything' })}
        tone="danger"
        body={L({
          chs: `队伍 ${units.length} 个角色、${axisCount} 个轴共 ${entryCount} 个条目都会被删除。此操作不可撤销，且没有回收站。`,
          en: `${units.length} units and ${axisCount} axes (${entryCount} entries) will be deleted. This cannot be undone and there is no undo.`,
        })}
        confirmLabel={L({ chs: '清空', en: 'Clear' })}
        onConfirm={confirmClear}
        onCancel={() => setClearing(false)}
      />
    </div>
  );
}

function TransferButton({ children, onClick, disabled, tone, ...rest }) {
  const color =
    tone === 'danger'
      ? 'border-white/10 text-white/40 hover:border-red-400/40 hover:text-red-300'
      : 'border-white/10 text-white/55 hover:border-white/30 hover:text-white';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-30 ${color}`}
      {...rest}
    >
      {children}
    </button>
  );
}
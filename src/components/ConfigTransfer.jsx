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
import { configFilename, describeImport } from '../lib/config-file';
import { exportConfigText, parseConfigText } from '../lib/config-client';
import AppDialog from './AppDialog';
/**
 * The two kinds of file 导入 accepts.
 *
 * They are not interchangeable, which is why the choice is visible rather than a
 * hidden preference: a configuration is JSON, and a gcsim sample is usually a
 * `.gz` that is not JSON at all until it is decompressed. One shared `accept`
 * would either hide the file the user is holding or offer one that cannot work.
 */
const IMPORT_MODES = [
  { id: 'json', label: { chs: 'JSON', en: 'JSON' }, accept: 'application/json,.json' },
  { id: 'gcsim', label: { chs: 'gcsim', en: 'gcsim' }, accept: '.gz,.json' },
];

/**
 * @param {object}   axes           The live axes state: `{ version, axes, activeId }`.
 * @param {Function} onReplaceAxes  Called with a parsed `{ axes, activeId }` on import.
 * @param {Function} onClearAxes    Called to reset the axes to a single blank one.
 */
export default function ConfigTransfer({ axes, onReplaceAxes, onClearAxes }) {
  const { L, lang } = useI18n();
  const { units, replaceTeam } = useTeam();
  const fileRef = useRef(null);
  const [status, setStatus] = useState(null); // { kind: 'ok' | 'error', text }
  // The parsed file waiting on confirmation. Held rather than re-read, so the
  // dialog can describe it and confirming cannot fail after the fact.
  const [pendingImport, setPendingImport] = useState(null);
  const [clearing, setClearing] = useState(false);
  /**
   * Which kind of file 导入 is about to ask for.
   *
   * Kept next to the button rather than buried in a setting, because the mode
   * decides what the picker will even show.
   */
  const [mode, setMode] = useState('json');
  /**
   * A gcsim import is not instant: it decompresses the run and loads the
   * dataset. Without this the button looks dead for the second it takes.
   */
  const [busy, setBusy] = useState(false);
  const axisCount = axes?.axes?.length || 0;
  const entryCount = (axes?.axes || []).reduce((n, a) => n + (a.entries?.length || 0), 0);

  const download = async () => {
    setBusy(true);
    let text;
    try {
      text = await exportConfigText({
        team: { units },
        axes: axes?.axes,
        activeId: axes?.activeId,
      });
    } catch (err) {
      setStatus({ kind: 'error', text: err.message });
      return;
    } finally {
      setBusy(false);
    }
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

  /**
   * A gcsim sample -> the same `parsed` shape `parseConfigFile` returns, plus the
   * importer's own report.
   *
   * THE IMPORTER IS LOADED ON DEMAND. It is the whole gcsim half of the
   * import -- a thousand lines plus the mapping table -- and someone who never
   * imports a simulation should not pay for it on first paint.
   *
   * `report` rides along on the parsed object so the confirmation dialog can say
   * what the import LOST before anything is replaced: an unmapped hit is a row
   * the rotation will not have, and that is not something to discover later.
   */
  const parseGcsim = async (file) => {
    const { importGcsimSample } = await import('../lib/gcsim-sample');
    const { doc, report } = await importGcsimSample(await file.arrayBuffer(), lang);
    return {
      team: doc.team,
      axes: doc.axes,
      activeId: doc.activeId,
      teamOnly: false,
      gcsim: report,
    };
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    // Reset the input's value so choosing the SAME file twice still fires a
    // change event -- otherwise a failed import cannot be retried.
    e.target.value = '';
    if (!file) return;

    let parsed;
    setBusy(true);
    try {
      parsed = mode === 'gcsim'
        ? await parseGcsim(file)
        : await parseConfigText(await file.text());
    } catch (err) {
      setStatus({ kind: 'error', text: err.message });
      return;
    } finally {
      setBusy(false);
    }

    // Parsed and validated FIRST, so this dialog can state exactly what will be
    // replaced and confirming cannot then fail halfway. A gcsim import is the
    // same promise: everything that can fail has already run.
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
  const modeSpec = IMPORT_MODES.find((m) => m.id === mode) || IMPORT_MODES[0];
  /**
   * The importer's report, as far as the dialog is concerned.
   *
   * NOT its whole table -- the CLI prints that. What has to be true BEFORE the
   * user confirms is whether anything was lost, so this is the counts and the
   * names of the hits that were not written, plus the buff notes that mean the
   * mapping table is missing an entry. `buff-inactive` is deliberately excluded:
   * "the condition was not met, so this hit did not get the card" is the log
   * being read correctly, not a problem.
   */
  const gcsim = pendingImport?.gcsim || null;
  const unmappedNames = gcsim
    ? [...new Set(gcsim.byAbility.filter((r) => !r.mapped && !r.ignored).map((r) => r.ability))]
    : [];
  const PROBLEM_NOTES = new Set(['buff-status-unknown', 'buff-line-unknown', 'buff-source-missing', 'buff-value-drift']);
  const problemCount = gcsim
    ? (gcsim.buffs?.notes || []).filter((n) => PROBLEM_NOTES.has(n.kind)).length
    : 0;
  return (
    <div data-config-transfer className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
      <span className="text-[10px] uppercase tracking-wider text-white/25">
        {L({ chs: '配置数据', en: 'Configuration' })}
      </span>

      <TransferButton onClick={download} disabled={empty || busy} data-export>
        {L({ chs: '导出 JSON', en: 'Export JSON' })}
      </TransferButton>

      <TransferButton onClick={() => fileRef.current?.click()} disabled={busy} data-import>
        {busy ? L({ chs: '解析中…', en: 'Reading…' }) : L({ chs: '导入', en: 'Import' })}
      </TransferButton>

      {/* WHICH KIND OF FILE, beside the button it changes. `data-selected` is a
          string rather than a boolean so a probe can read the state off the DOM
          the way it reads every other toggle in this app. */}
      <div className="flex overflow-hidden rounded-lg border border-white/10 text-[11px]" data-import-mode>
        {IMPORT_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            data-import-mode-option={m.id}
            data-selected={mode === m.id ? 'true' : 'false'}
            className={'px-2.5 py-1 transition-colors ' + (mode === m.id ? 'bg-white/10 text-white' : 'text-white/35 hover:text-white/70')}
          >
            {L(m.label)}
          </button>
        ))}
      </div>
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
        accept={modeSpec.accept}
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
            {/* WHAT THE IMPORT LOST, before anything is replaced. Only the gcsim
                path has a report: a configuration says what it holds by being
                read, but a simulation log has to be told apart from the rows
                that were written out of it. */}
            {gcsim && (
              <div className="flex flex-col gap-1 border-t border-white/5 pt-2">
                <span className="text-[10px] uppercase tracking-wider text-white/30">
                  {L({ chs: 'gcsim 导入报告', en: 'gcsim import report' })}
                </span>
                <span className="text-white/45" data-gcsim-summary>
                  {L({
                    chs: 'damage 事件 ' + gcsim.damageEvents + ' · 写入 ' + gcsim.entries + ' 条目 · 映射 ' + gcsim.mappedHits + ' 击 · 忽略反应 ' + gcsim.ignoredHits + ' · 未映射 ' + gcsim.unmappedHits,
                    en: gcsim.damageEvents + ' damage events -> ' + gcsim.entries + ' entries · ' + gcsim.mappedHits + ' mapped · ' + gcsim.ignoredHits + ' reactions ignored · ' + gcsim.unmappedHits + ' unmapped',
                  })}
                </span>
                {unmappedNames.length > 0 && (
                  <span className="text-amber-300/80" data-gcsim-unmapped>
                    {L({ chs: '未映射的命中不会写进轴：', en: 'Unmapped hits are not written: ' })}
                    {unmappedNames.join('、')}
                  </span>
                )}
                {problemCount > 0 && (
                  <span className="text-amber-300/80" data-gcsim-notes>
                    {L({
                      chs: '增益表里有 ' + problemCount + ' 处对不上（状态未收录 / 来源缺失），这些卡没挂上。',
                      en: problemCount + ' buff notes did not resolve (unknown status or missing source); those cards were not attached.',
                    })}
                  </span>
                )}
              </div>
            )}
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

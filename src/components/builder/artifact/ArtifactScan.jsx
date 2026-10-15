// The scan panel: a screenshot in, a verified build out.
//
// WHERE IT SITS
//   The artifact row's last child, in the empty width to the right of the stat
//   totals -- the space that exists because five 178px slots and a 168px summary
//   do not fill the panel. It is a CONTROL and not a decoration: the row is where
//   a build is entered, and twenty-five numbers typed off a screenshot is the
//   slowest way to enter one.
//
// THE MODEL READS, THE USER DECIDES
//   Nothing the model says is applied on its own. Each recognized piece is shown
//   with WHAT WAS SAID beside WHAT IT MAPPED TO, a doubtful mapping says so in
//   the row, and it lands in the build only when it is ticked and 应用 is pressed.
//
//   The main stat is checked against the LEVEL CURVE while the user looks at it:
//   `+8 攻击力 22.8%` and `+0 攻击力 22.8%` cannot both be right, and only the
//   curve can say which one the picture shows. That check costs nothing and
//   catches the two mistakes that ruin a build quietly -- a level read as another
//   level, and a percentage read as a flat.
//
// THE SLOTS IT DOES NOT MENTION ARE LEFT ALONE
//   Scanning one artifact out of a screenshot is a normal way to use this, so
//   `applyScanRows` writes only the ticked slots (see artifact-scan.js). Undoing
//   is the row's own ✕ per slot, which was already there.
//
// THE KEY IS NOT IN THIS PAGE
//   The endpoint's key is an environment variable on the SERVER (`USTC_API_KEY`
//   unless the form says otherwise) and this panel only names it, so importing a
//   screenshot cannot leak a key that was never here. `probeKeyEnv` asks the relay
//   whether it can see the variable and the answer is printed under the fields:
//   the failure that prevents is the confusing one, a forgotten `$env:` that would
//   otherwise surface as a 401 from a provider three hops away.
//
// THE IMAGE IS SHRUNK BEFORE IT IS SENT
//   A full-screen 2560x1600 PNG is several megabytes and the text is legible at a
//   third of that; `shrink` re-encodes to a 1600px JPEG, which is a few hundred
//   kilobytes. It is the difference between a request that feels instant and one
//   that sits there uploading.

import { useCallback, useEffect, useRef, useState } from 'react';
import { artifactIconImg, qualityOf } from '../../../game';
import { useI18n } from '../../../i18n';
import {
  MAIN_STATS, SLOT_LABEL, SUB_STATS, formatStat, pieceIcon, statMeta,
} from '../../../lib/artifact';
import {
  SCAN_PROMPT, applyScanRows, buildScanRows, matchDisplayed, parseScanResponse,
} from '../../../lib/artifact-scan';
import { hasVisionConfig, loadVisionConfig, saveVisionConfig } from '../../../lib/vision-config';
import { probeKeyEnv, recognizeArtifacts } from '../../../lib/vision-client';
import { NumberStepper, PickerModal } from '../controls';
import { StatGlyph, StatMenu } from './StatGlyph';
import SetPicker from './SetPicker';

/** Longest side of what is sent. See the header. */
const MAX_SIDE = 1600;

/** A file as a data URL, re-encoded small enough to upload. */
async function readImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('这张图解码失败'));
    el.src = dataUrl;
  });

  const scale = Math.max(img.width, img.height) / MAX_SIDE;
  // Already small: re-encoding it would only lose quality.
  if (scale <= 1) return dataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width / scale);
  canvas.height = Math.round(img.height / scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Roughly how much a data URL will cost to upload. */
const kBOf = (dataUrl) =>
  `${Math.round((String(dataUrl).length - String(dataUrl).indexOf(',') - 1) * 0.75 / 1024)} KB`;

/* ==================================================================== panel */

/**
 * @param {object}   build    The ACTIVE build of the slot row's container.
 * @param {object}   sets     setId -> set, from the catalogue.
 * @param {object[]} list     The catalogue in display order, for set matching.
 * @param {Function} onApply  Called with a whole new build.
 */
export default function ArtifactScan({ build, sets, list, onApply }) {
  const { L } = useI18n();
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(loadVisionConfig);
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState(null);
  const [reply, setReply] = useState(null);
  const [showReply, setShowReply] = useState(false);
  const [dragging, setDragging] = useState(false);
  // A stat menu or a set picker inside the dialog counts as "busy dismissing":
  // Escape must close THAT first, not the whole dialog.
  const [innerOpen, setInnerOpen] = useState(false);
  const fileRef = useRef(null);

  const ready = hasVisionConfig(config);

  // What the relay says about the key's variable: the one part of the setup this
  // page cannot find out by itself. `null` while unknown, or with no relay at all.
  const [keyEnvState, setKeyEnvState] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    probeKeyEnv(config.keyEnv).then((state) => { if (live) setKeyEnvState(state); });
    return () => { live = false; };
  }, [open, config.keyEnv]);

  const remember = (patch) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveVisionConfig(next);
  };

  const takeFile = useCallback(async (file) => {
    if (!file) return;
    setError(null);
    setRows(null);
    setReply(null);
    try {
      setImage({ dataUrl: await readImage(file), name: file.name || 'screenshot' });
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // A screenshot arrives by Ctrl+V far more often than through a file dialog, so
  // the paste is listened for on the whole document while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e) => {
      const file = [...(e.clipboardData?.items || [])]
        .find((item) => item.type.startsWith('image/'))
        ?.getAsFile();
      if (!file) return;   // a text paste into an input stays a text paste
      e.preventDefault();
      takeFile(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open, takeFile]);

  const run = async () => {
    if (!image || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const { text, via } = await recognizeArtifacts({
        config, image: image.dataUrl, prompt: SCAN_PROMPT,
      });
      setReply({ text, via });
      const parsed = parseScanResponse(text);
      const built = buildScanRows(parsed, { list, sets });
      if (!built.length) {
        setError(L({ chs: '这张图里没识别到圣遗物', en: 'No artifacts were found in that image' }));
        setRows(null);
      } else {
        setRows(built);
      }
    } catch (e) {
      setError(e.message);
      setRows(null);
    } finally {
      setBusy(false);
    }
  };

  const patchRow = useCallback((id, patch) => {
    setRows((cur) => (cur || []).map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const ticked = (rows || []).filter((row) => row.include && row.slotKey);
  // Two ticked rows on one slot: the later one would overwrite the earlier one
  // without a word, so it is named here and skipped on apply.
  const clash = ticked.some((row, i) => ticked.findIndex((o) => o.slotKey === row.slotKey) !== i);

  const apply = () => {
    onApply(applyScanRows(build, rows || []).build);
    setOpen(false);
  };

  return (
    <>
      <div
        data-artifact-scan
        className="flex w-[124px] shrink-0 flex-col self-stretch rounded-xl border border-dashed border-white/[0.09] bg-white/[0.015] p-2"
      >
        <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-white/30">
          {L({ chs: '识图', en: 'Scan' })}
        </p>
        <button
          type="button"
          data-scan-open
          onClick={() => setOpen(true)}
          className="group/scan flex flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] transition-colors hover:border-white/25 hover:bg-white/[0.05]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/40 transition-colors group-hover/scan:text-white/80">
            <ImageGlyph />
          </span>
          <span className="text-[10px] font-medium text-white/55 transition-colors group-hover/scan:text-white/85">
            {L({ chs: '导入截图', en: 'Import screenshot' })}
          </span>
        </button>
        <p className="mt-1.5 text-center text-[8.5px] leading-[1.6] text-white/25">
          {ready
            ? L({ chs: '识别 → 校对 → 应用', en: 'Read, check, apply' })
            : L({ chs: '还没填 API 地址', en: 'No API endpoint yet' })}
        </p>
      </div>

      <PickerModal
        open={open}
        // Escape closes the inner menu first: see `innerOpen`.
        onClose={() => { if (!innerOpen) setOpen(false); }}
        title={L({ chs: '识图导入圣遗物', en: 'Scan artifacts from a screenshot' })}
        maxWidth="max-w-[1180px]"
        controls={(
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <ScanField
                value={config.baseUrl}
                onChange={(v) => remember({ baseUrl: v })}
                placeholder="https://api.openai.com/v1"
                label={L({ chs: '接口地址 Base URL', en: 'Base URL' })}
                width="w-[280px]"
              />
              <ScanField
                value={config.keyEnv}
                onChange={(v) => remember({ keyEnv: v })}
                placeholder={L({ chs: 'USTC_API_KEY（本地模型可留空）', en: 'USTC_API_KEY (blank for a local model)' })}
                label={L({ chs: 'Key 环境变量名', en: 'Key env variable' })}
                width="w-[220px]"
              />
              <ScanField
                value={config.model}
                onChange={(v) => remember({ model: v })}
                placeholder="gpt-4o-mini"
                label={L({ chs: '模型 Model ID', en: 'Model ID' })}
                width="w-[180px]"
              />
              <button
                type="button"
                data-scan-run
                onClick={run}
                disabled={busy || !image || !ready}
                className="ml-auto rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-[12px] font-bold text-emerald-200 transition-colors hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-white/25"
              >
                {busy
                  ? L({ chs: '识别中…', en: 'Reading…' })
                  : L({ chs: '识别', en: 'Read image' })}
              </button>
            </div>
            <p
              data-scan-env={keyEnvState ? (keyEnvState.present ? 'set' : 'missing') : 'unknown'}
              className={`text-[10px] leading-relaxed ${keyEnvState && !keyEnvState.present
                ? 'text-amber-300/80'
                : 'text-white/30'}`}
            >
              {L(keyEnvHint(keyEnvState))}
            </p>
          </div>
        )}
      >
        {/* ------------------------------------------------------- the image */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            takeFile(e.dataTransfer?.files?.[0]);
          }}
          className={`rounded-2xl border border-dashed p-3 transition-colors ${
            dragging ? 'border-emerald-400/60 bg-emerald-400/[0.06]' : 'border-white/12 bg-white/[0.02]'
          }`}
        >
          {!image ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5 py-6"
            >
              <ImageGlyph size={22} />
              <span className="text-[12px] font-medium text-white/60">
                {L({ chs: '点击选择截图，或直接 Ctrl+V 粘贴 / 拖进来', en: 'Click to choose a screenshot, or paste with Ctrl+V' })}
              </span>
              <span className="text-[10px] text-white/30">
                {L({ chs: '详情弹窗、强化界面、角色面板都可以', en: 'A detail panel, the enhance screen, a character sheet' })}
              </span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <img
                src={image.dataUrl}
                alt={image.name}
                className="max-h-[168px] max-w-[420px] rounded-lg border border-white/10 object-contain"
              />
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-white/50">
                  {image.name} · {kBOf(image.dataUrl)}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-white/60 hover:border-white/35 hover:text-white"
                  >
                    {L({ chs: '换一张', en: 'Replace' })}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setImage(null); setRows(null); setReply(null); setError(null); }}
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-white/60 hover:border-white/35 hover:text-white"
                  >
                    {L({ chs: '移除', en: 'Remove' })}
                  </button>
                </div>
              </div>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              takeFile(e.target.files?.[0]);
              e.target.value = '';   // so picking the same file twice fires again
            }}
          />
        </div>

        {!ready && (
          <p className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[11px] text-amber-200/90">
            {L({
              chs: '先填写 Base URL 和 Model ID，识别按钮才会可用。',
              en: 'Fill in the Base URL and the Model ID first; the button stays disabled until then.',
            })}
          </p>
        )}

        {error && (
          <p data-scan-error className="mt-3 whitespace-pre-wrap rounded-xl border border-red-400/25 bg-red-400/[0.07] px-3 py-2 text-[11px] leading-relaxed text-red-200">
            {error}
          </p>
        )}

        {/* ------------------------------------------------------ the review */}
        {rows && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/45">
                {L({ chs: '校对', en: 'Check' })}
              </p>
              <span className="text-[11px] text-white/30">
                {L({
                  chs: `识别到 ${rows.length} 件；勾选的部位会被写入，其它部位保持不动`,
                  en: `${rows.length} piece(s); only ticked slots are written`,
                })}
              </span>
              {reply?.via === 'direct' && (
                <span className="text-[10px] text-amber-200/70">
                  {L({ chs: '（直连模型）', en: '(called the model directly)' })}
                </span>
              )}
            </div>

            {rows.map((row) => (
              <ScanPiece
                key={row.id}
                row={row}
                sets={sets}
                list={list}
                L={L}
                onChange={(patch) => patchRow(row.id, patch)}
                onInnerOpen={setInnerOpen}
              />
            ))}

            {clash && (
              <p className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[11px] text-amber-200/90">
                {L({
                  chs: '有两个勾选的圣遗物落在同一个部位；应用时后面的会被跳过，请先取消其中一个。',
                  en: 'Two ticked pieces land on the same slot; the later one is skipped, so untick it first.',
                })}
              </p>
            )}

            {reply && (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
                <button
                  type="button"
                  onClick={() => setShowReply((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-white/40 hover:text-white/75"
                >
                  <span>{showReply ? '▾' : '▸'}</span>
                  {L({ chs: '模型原始返回', en: 'Raw model reply' })}
                </button>
                {showReply && (
                  <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-all border-t border-white/[0.08] px-3 py-2 text-[10px] leading-relaxed text-white/45">
                    {reply.text}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------- the apply */}
        {rows && (
          <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 flex items-center gap-3 border-t border-white/10 bg-[#0f0f13]/95 px-4 py-3 backdrop-blur">
            <span className="text-[11px] text-white/45">
              {L({ chs: `将写入 ${ticked.length} 个部位`, en: `Will write ${ticked.length} slot(s)` })}
            </span>
            <button
              type="button"
              data-scan-apply
              onClick={apply}
              disabled={!ticked.length}
              className="ml-auto rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-4 py-1.5 text-[12px] font-bold text-emerald-200 transition-colors hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-white/25"
            >
              {L({ chs: '应用到当前圣遗物', en: 'Apply to this build' })}
            </button>
          </div>
        )}
      </PickerModal>
    </>
  );
}

/* ==================================================================== pieces */

/** One recognized artifact, with what was said beside what it mapped to. */
function ScanPiece({ row, sets, list, L, onChange, onInnerOpen }) {
  // Which popover this row has open: 'set', 'main', a substat index, or nothing.
  const [openMenu, setOpenMenu] = useState(null);
  const anchors = useRef({});

  const setMenu = (what) => {
    setOpenMenu(what);
    onInnerOpen(what != null);
  };
  // Every state change that can leave a menu behind must also clear the parent's
  // flag, or Escape would stop closing the dialog for the rest of the session.
  useEffect(() => () => onInnerOpen(false), [onInnerOpen]);

  const set = row.setId ? sets?.[row.setId] : null;
  const icon = pieceIcon(sets, row.setId, row.slotKey);
  const rq = qualityOf(set?.qualityType);
  const mainMeta = row.mainStat ? statMeta(row.mainStat) : null;
  const mainPool = row.slotKey ? MAIN_STATS[row.slotKey] || [] : [];

  const setSub = (index, next) => {
    const subStats = row.subStats.map((s, i) => (i === index ? next : s));
    onChange({ subStats });
  };

  /** Typing keeps the printed figure in `typed` and stores the exact roll. */
  const retype = (index, text) => {
    const sub = row.subStats[index];
    const exact = sub.key ? matchDisplayed(sub.key, row.rarity, text) : null;
    setSub(index, {
      ...sub,
      typed: text,
      value: exact?.value ?? text,
      exact: exact?.value ?? null,
      legal: sub.key ? !!exact : null,
    });
  };

  /** Picking a stat: the value stays, but its legality and the exact roll move. */
  const repick = (index, key) => {
    const sub = row.subStats[index];
    const exact = key ? matchDisplayed(key, row.rarity, sub.typed) : null;
    setSub(index, {
      ...sub,
      key,
      value: exact?.value ?? sub.typed,
      exact: exact?.value ?? null,
      legal: key ? !!exact : null,
      ambiguous: false,
    });
  };

  return (
    <div
      data-scan-piece={row.slotKey || 'unknown'}
      className="relative flex flex-col gap-2 rounded-2xl border p-2.5"
      style={{
        borderColor: row.issues.length ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.10)',
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      {/* ---------------------------------------------------------- the head */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5" title={L({ chs: '勾选后才会写入', en: 'Tick to write it' })}>
          <input
            type="checkbox"
            data-scan-include
            checked={row.include}
            onChange={(e) => onChange({ include: e.target.checked })}
            className="h-3.5 w-3.5 accent-emerald-400"
          />
        </label>

        {icon && (
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
            style={{
              borderColor: set ? `${rq.color}66` : 'rgba(255,255,255,0.10)',
              background: set ? `radial-gradient(80% 70% at 50% 30%, ${rq.color}22 0%, rgba(0,0,0,0.5) 70%)` : 'rgba(0,0,0,0.3)',
            }}
          >
            <img src={artifactIconImg(icon)} alt="" className="h-8 w-8 object-contain" />
          </span>
        )}

        {/* The slot. A select rather than a label because the slot is the one
            field a screenshot cannot be ambiguous about -- if it IS wrong, the
            piece is in the wrong column and nothing else about the row means
            anything. */}
        <select
          data-scan-slot
          value={row.slotKey || ''}
          onChange={(e) => onChange({ slotKey: e.target.value || null })}
          className="cursor-pointer rounded-md border border-white/12 bg-white/[0.03] px-1.5 py-1 text-[11px] font-semibold text-white outline-none hover:border-white/30"
        >
          {!row.slotKey && <option value="" className="bg-[#141418]">未识别部位</option>}
          {Object.keys(SLOT_LABEL).map((key) => (
            <option key={key} value={key} className="bg-[#141418] text-white">
              {L(SLOT_LABEL[key])}
            </option>
          ))}
        </select>

        <button
          type="button"
          ref={(el) => { anchors.current.set = el; }}
          onClick={() => setMenu('set')}
          data-scan-set
          title={L({ chs: '更换套装', en: 'Change the set' })}
          className={`rounded-md border px-2 py-1 text-[11px] transition-colors hover:border-white/35 ${
            row.setId ? 'border-white/12 text-white' : 'border-amber-400/40 text-amber-200/90'
          }`}
        >
          {row.setId
            ? L({ chs: set?.chsName || '', en: set?.enName || '' })
            : L({ chs: '选择套装', en: 'Choose a set' })}
        </button>

        <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-white/30">
          {L({ chs: '等级', en: 'Lv' })}
        </span>
        <NumberStepper
          value={row.level}
          min={0}
          max={20}
          step={4}
          width="w-6"
          tint="#c9a6ff"
          onChange={(level) => onChange({ level })}
          label={L({ chs: '圣遗物等级', en: 'Artifact level' })}
        />

        {/* What the model actually said, so the mapping can be checked by eye. */}
        {(row.setRaw || row.pieceRaw) && (
          <span className="ml-auto max-w-[280px] truncate text-[10px] text-white/25" title={`${row.pieceRaw} ${row.setRaw}`}>
            {L({ chs: '图上', en: 'read as' })}: {[row.pieceRaw, row.setRaw].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>

      {/* ---------------------------------------------------------- the stats */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.03] px-2 py-1">
          <button
            type="button"
            ref={(el) => { anchors.current.main = el; }}
            onClick={() => setMenu('main')}
            data-scan-main
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            {row.mainStat && <StatGlyph stat={row.mainStat} size={15} />}
            <span className={`min-w-0 flex-1 truncate text-[11px] ${row.mainStat ? 'text-white' : 'text-amber-200/90'}`}>
              {row.mainStat ? L(mainMeta) : `主词条未识别${row.mainRaw ? `（${row.mainRaw}）` : ''}`}
            </span>
            <span className="shrink-0 text-[9px] text-white/25">{L({ chs: '主词条', en: 'Main' })}</span>
          </button>

          <span className="shrink-0 text-[12px] font-bold tabular-nums text-white">
            {row.mainValue == null ? '—' : formatStat(row.mainValue)}
          </span>
          {mainMeta?.suffix && <span className="shrink-0 text-[10px] text-white/40">{mainMeta.suffix}</span>}

          {/* The level curve's own answer for this stat at this level. */}
          {row.mainExpected != null && (
            <span
              title={L({
                chs: `按 +${row.level} 的曲线应为 ${row.mainExpected}`,
                en: `The +${row.level} curve gives ${row.mainExpected}`,
              })}
              className={`shrink-0 text-[10px] ${
                row.mainValue != null && Math.abs(row.mainValue - row.mainExpected) < 1e-9
                  ? 'text-emerald-300/80' : 'text-amber-300/90'
              }`}
            >
              {row.mainValue != null && Math.abs(row.mainValue - row.mainExpected) < 1e-9
                ? '✓' : `曲线 ${row.mainExpected}`}
            </span>
          )}
        </div>

        {row.subStats.map((sub, i) => {
          const meta = sub.key ? statMeta(sub.key) : null;
          return (
            <div
              key={i}
              data-scan-sub={i}
              className="flex items-center gap-2 rounded-lg border border-white/[0.09] px-2 py-[3px]"
            >
              <button
                type="button"
                ref={(el) => { anchors.current[i] = el; }}
                onClick={() => setMenu(i)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                {sub.key
                  ? <StatGlyph stat={sub.key} size={13} />
                  : <span className="w-[13px] shrink-0 text-center text-[10px] text-white/25">?</span>}
                <span className={`min-w-0 flex-1 truncate text-[10px] ${sub.key ? 'text-white/75' : 'text-white/30'}`}>
                  {sub.key ? L(meta) : (sub.raw ? `未识别（${sub.raw}）` : L({ chs: '无', en: 'empty' }))}
                </span>
              </button>

              {sub.raw && (
                <input
                  value={sub.typed ?? ''}
                  onChange={(e) => retype(i, e.target.value)}
                  inputMode="decimal"
                  data-scan-sub-value={i}
                  className="w-16 shrink-0 rounded-md border border-white/10 bg-black/30 px-1.5 py-[2px] text-right text-[11px] tabular-nums text-white outline-none focus:border-white/35"
                />
              )}
              {meta?.suffix && <span className="shrink-0 text-[10px] text-white/40">{meta.suffix}</span>}

              {sub.key && sub.legal === false && (
                <span className="shrink-0 text-[10px] text-amber-300/90" title={L({ chs: '不是该词条的合法强化值', en: 'Not a legal roll for this stat' })}>⚠</span>
              )}
              {sub.exact != null && String(sub.typed) !== String(sub.exact) && (
                <span className="shrink-0 text-[10px] text-white/25" title={L({ chs: '实际存的是精确值', en: 'The exact total is what gets stored' })}>
                  →{sub.exact}
                </span>
              )}

              {sub.raw && (
                <button
                  type="button"
                  onClick={() => setSub(i, { key: null, value: null, typed: '', raw: '', exact: null, legal: null, ambiguous: false })}
                  className="shrink-0 rounded px-0.5 text-[10px] leading-none text-white/20 hover:text-white/70"
                  title={L({ chs: '清空这一条', en: 'Clear this substat' })}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>

      {row.issues.length > 0 && (
        <p className="flex flex-wrap gap-x-2 text-[10px] leading-relaxed text-amber-200/80">
          {row.issues.map((issue) => <span key={issue}>⚠ {issue}</span>)}
        </p>
      )}

      {/* -------------------------------------------------------- the popovers */}
      {openMenu === 'set' && (
        <SetPicker
          open
          onClose={() => setMenu(null)}
          value={row.setId}
          onPick={(setId) => { onChange({ setId, setMatch: 'exact', setBy: 'user' }); setMenu(null); }}
        />
      )}

      {openMenu === 'main' && (
        <StatMenu
          anchor={anchors.current.main}
          options={mainPool}
          value={row.mainStat}
          onClose={() => setMenu(null)}
          onPick={(key) => {
            onChange({
              mainStat: key,
              mainExpected: null,   // recomputed on apply; the row no longer claims to know
            });
            setMenu(null);
          }}
        />
      )}

      {typeof openMenu === 'number' && (
        <StatMenu
          anchor={anchors.current[openMenu]}
          options={SUB_STATS.filter((s) => s !== row.mainStat)}
          value={row.subStats[openMenu]?.key}
          onClose={() => setMenu(null)}
          onPick={(key) => { repick(openMenu, key); setMenu(null); }}
        />
      )}
    </div>
  );
}

/* ==================================================================== inputs */

/**
 * What to say about the key, given what the relay answered.
 *
 * Three states and not two: "the server said no" and "there is no server to ask"
 * want different advice, and the second one is the local-model case, where no key
 * is needed at all. The key's VALUE is never part of this -- the panel does not
 * have it and cannot get it.
 */
function keyEnvHint(state) {
  if (!state) {
    return {
      chs: '这里填的是环境变量名：识别时由本地服务从它自己的环境里读取（默认 USTC_API_KEY）。',
      en: 'This field names an environment variable; the local server reads the value from its own environment.',
    };
  }
  if (state.present) {
    return {
      chs: `服务端已读到环境变量 ${state.keyEnv}；它不经过这个页面。`,
      en: `The server can see ${state.keyEnv}; the value never passes through this page.`,
    };
  }
  return {
    chs: `服务端没读到环境变量 ${state.keyEnv}：在启动 npm run dev 的终端里设置它，然后重启服务。`
      + '（本地模型不需要 Key，这条可以忽略。）',
    en: `The server cannot see ${state.keyEnv}: set it in the terminal running npm run dev, then restart.`
      + ' (A local model needs no key, so this can be ignored.)',
  };
}

/** One endpoint field: a tiny caption over a small input. */
function ScanField({ value, onChange, placeholder, label, width }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-white/35">{label}</span>
      <input
        value={value}
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${width} rounded-lg border border-white/12 bg-black/30 px-2 py-1.5 text-[11px] text-white outline-none placeholder:text-white/20 focus:border-white/35`}
      />
    </label>
  );
}

/** The panel's mark: a framed picture, drawn rather than an emoji. */
function ImageGlyph({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" />
      <path d="M2.5 11.5 6 8.5l2.5 2 2-1.5 3 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

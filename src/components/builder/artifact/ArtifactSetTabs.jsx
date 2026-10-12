// The tab strip above the artifact row: one tab per configuration.
//
// SELECTING IS USING. A click on a tab makes that configuration the active one,
// and `ArtifactRow` below immediately renders ITS five slots. There is no
// "apply" button and no separate save step -- the same reason the axis picker is
// a select and not a form.
//
// WHY A TAB STRIP AND NOT A DROPDOWN. The whole point of several configurations
// is COMPARING them, and a comparison needs to see that the others exist without
// opening anything. A dropdown would hide the count of builds behind a click and
// make "how many do I have" a question you answer by opening it.
//
// NAMING IS OPTIONAL. An unnamed configuration reads as `配置 N`, which is the
// axis's own convention (`轴 1`, `轴 2`), so the feature works before anyone
// bothers to name anything and the name is a convenience rather than a gate.

import { useState } from 'react';
import AppDialog from '../../AppDialog';
import { useI18n } from '../../../i18n';
import {
  addArtifactSet, removeArtifactSet, renameArtifactSet, setActiveArtifactSet,
} from '../../../lib/artifact-sets';

/**
 * @param {object}   artifacts  `{ active, sets }` -- the unit's container.
 * @param {Function} onChange   Receives the next container.
 */
export default function ArtifactSetTabs({ artifacts, onChange }) {
  const { L } = useI18n();
  const [renaming, setRenaming] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const sets = artifacts?.sets || [];
  const active = artifacts?.active;
  const label = (s, i) => s.name || L({ chs: `配置 ${i + 1}`, en: `Build ${i + 1}` });

  return (
    <div data-artifact-tabs className="relative flex flex-wrap items-center gap-1.5">
      {sets.map((s, i) => {
        const on = s.id === active;
        return (
          <div
            key={s.id}
            data-artifact-tab={s.id}
            data-active={on ? 'true' : 'false'}
            className={`group/tab flex items-center gap-1 rounded-lg border px-2 py-1 transition-colors ${
              on
                ? 'border-[#7fd4c1]/50 bg-[#7fd4c1]/10 text-[#7fd4c1]'
                : 'border-white/10 text-white/50 hover:border-white/25 hover:text-white/80'
            }`}
          >
            <button
              type="button"
              onClick={() => onChange(setActiveArtifactSet(artifacts, s.id))}
              onDoubleClick={() => setRenaming(s.id)}
              title={L({ chs: '双击重命名', en: 'Double-click to rename' })}
              className="max-w-[140px] truncate text-[11px] font-medium"
            >
              {label(s, i)}
            </button>
            {/* The rename affordance, because double-click is not discoverable on
                its own and a name you cannot find how to change is worse than an
                unnamed one. */}
            <button
              type="button"
              onClick={() => setRenaming(s.id)}
              title={L({ chs: '重命名', en: 'Rename' })}
              className="shrink-0 text-[10px] text-white/25 transition-colors hover:text-white/70"
            >
              ✎
            </button>
            {/* The last configuration cannot be removed -- a unit always has a
                build -- so the control is hidden rather than offered-and-refused. */}
            {sets.length > 1 && (
              <button
                type="button"
                onClick={() => setDeleting(s.id)}
                title={L({ chs: '删除该配置', en: 'Delete this build' })}
                className="shrink-0 text-[10px] text-white/25 transition-colors hover:text-red-300"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}

      <button
        type="button"
        data-add-artifact-set
        onClick={() => onChange(addArtifactSet(artifacts))}
        title={L({ chs: '新建一套圣遗物配置', en: 'Add an artifact build' })}
        className="rounded-lg border border-dashed border-white/20 px-2 py-1 text-[11px] text-white/40 transition-colors hover:border-[#7fd4c1]/50 hover:text-[#7fd4c1]"
      >
        + {L({ chs: '新配置', en: 'New build' })}
      </button>

      <AppDialog
        open={!!renaming}
        title={L({ chs: '重命名配置', en: 'Rename build' })}
        body={L({ chs: '留空则恢复为默认名称（配置 1、配置 2…）。', en: 'Leave blank to use the default name (Build 1, Build 2…).' })}
        input={{
          defaultValue: sets.find((s) => s.id === renaming)?.name || '',
          placeholder: L({ chs: '配置名称', en: 'Build name' }),
          maxLength: 40,
        }}
        confirmLabel={L({ chs: '保存', en: 'Save' })}
        onConfirm={(value) => { onChange(renameArtifactSet(artifacts, renaming, value)); setRenaming(null); }}
        onCancel={() => setRenaming(null)}
      />

      <AppDialog
        open={!!deleting}
        title={L({ chs: '删除配置', en: 'Delete build' })}
        tone="danger"
        body={L({
          chs: `「${sets.find((s) => s.id === deleting) ? label(sets.find((s) => s.id === deleting), sets.findIndex((s) => s.id === deleting)) : ''}」的五个圣遗物都会被删除，此操作不可撤销。`,
          en: 'All five artifacts in this build will be deleted. This cannot be undone.',
        })}
        confirmLabel={L({ chs: '删除', en: 'Delete' })}
        onConfirm={() => { onChange(removeArtifactSet(artifacts, deleting)); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

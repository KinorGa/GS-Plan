# 代码地图（开发者向）

这份文档是**给我自己日后改代码用的**，不是用户教程。用户教程见 `README.md`。

README 只讲规划器（`planner.html`）；这份文档讲**整个仓库里都有什么、各自负责什么、改动时必须守住哪些不变量**。
仓库里除规划器外的页面都是「往里填数据的维护页」，它们是工具，但代码结构仍然值得记一笔。

---

## 1. 页面与构建入口

`build.mjs` 用 Rollup JS API（非 Vite，原因见 README「为什么不用 Vite」）把 5 个入口打进 `dist/`。
`dist/` 里每个 `*.html` 都已注入指向对应 hash 文件的 `<script type="module">`。

| 入口文件 | 产物 | 干什么 |
| --- | --- | --- |
| `src/planner-main.jsx` | `index.html` + `planner.html` | **配队增益规划器**（产品本体）。`index.html` 与 `planner.html` 是同一个文档：服务器根 `/` 直接落在产品上 |
| `src/main.jsx` | `chars.html` | 复刻主站：角色列表 + 角色详情。`HashRouter`：`/char`、`/char/:id`。**不是主页** |
| `src/buffs-main.jsx` | `buffs.html` | **增益库编辑器**（`BuffEditor`）：人工审核 2000+ 增益来源 |
| `src/audit-main.jsx` | `audit.html` | **伤害源审核页**：审核 `talent-damage.json` 的草稿 |
| `src/stats-main.jsx` | `stats.html` | **数值来源页**：逐等级列出角色/武器数值，与目录的展示值对照 |

> 页面分三类：**产品**（`planner`，主页 `/`）、**浏览**（`chars`，复刻主站的角色列表/详情）、**数据维护工具**（`buffs`/`audit`/`stats`，为规划器准备数据）。
> 早先的测试/预览页（`card`/`damage`/`damage-standalone`/`buff`/`artifact`）已随产品化清理移除，组件本身仍可复用。

---

## 2. 数据流（改任何数值前先读这一节）

```
生成期（脚本，落盘到 public/data/）
  scripts/fetch-lunaris.mjs  → char/、artifact/、*list.json、talent-damage.json 草稿
  scripts/fetch-stats.mjs    → 上游 Excel/表
  scripts/build-stats.mjs    → stats-compact.json（成长曲线 + 突破值因子表）
  scripts/audit-talent-damage.mjs → 辅助生成 talent-damage.json 草稿

运行期（浏览器）
  角色选择 + 武器 + 圣遗物配置
        │
        ├─ src/char-sources.js       把天赋表 → DamageCard 的 sources
        │
        ├─ src/lib/stat-derive.js    由 角色白值(公式) + 武器(公式) + 圣遗物词条
        │                            → 数值面板 panel（DERIVED_KEYS）
        │      └─ 读 src/lib/stat-tables.js → stats-compact.json
        │
        ├─ src/lib/buff-formula.js   增益公式：符号表 = panel，闭作用域求值
        │
        └─ src/lib/axis-compute.js   整条轴一次推导：computeAxis / computeEntry / panelForEntry
                 │   折叠每条条目的增益（buff-model）后调用 ↓
                 └─ src/lib/damage.js  computeDamage：防御区/抗性区/暴击/增幅
```

**只有这一条链路**：`axis-compute` 是唯一把「轴」变成数字的地方，组件只负责显示它的返回值。

---

## 3. 目录职责

### `src/`（根）

- `DamageCard.jsx` — **自包含、可复用**的单段伤害卡。导出 `ODETTE_CHAR`、`reactionByKey`、`STAT_DEFS`、`defaultStats`、default 组件。内部所有文案靠 `L()`，`useI18n` 在 Provider 外返回中文兜底，所以能脱离 Provider 单独挂载（历史上有 `damage-standalone.html` 佐证，该页已随预览页移除，约束不变）。
- `char-sources.js` — 把 `/data/char/chs/{id}.json` 的天赋 `multipliers`（取 Lv.10）转成 `DamageCard` 需要的 `sources`。
- `i18n.jsx` — 中英文案 + Context；`useI18n` 在 Provider 外返回中文兜底（这是 `DamageCard` 能独立运行的前提）。
- `richtext.js` — 富文本（上游文案里的颜色/图标标记）解析。
- `game.js` — 图片 URL 拼装（`avatarImg`/`weaponIconImg`/`talentIconImg` 等）。

### `src/components/`

- **轴（伤害轴）**
  - `DamageEntry.jsx` — 轴上最小单位「一条条目」：折叠行 + 展开卡 + 拖放接收。导出 `tint`。
  - `EntryGroup.jsx` — 多段伤害与循环容器；负责子段、`patchEntry`/`setChild`、折叠时的子笔记汇总（`collectNotes`/`ChildNotes`）。
  - `EntryNote.jsx` — 条目/子段上的笔记框（点进编辑，Enter 存 / Shift+Enter 换行 / Esc 取消 / 失焦存）。
  - `AxisSummary.jsx` — 轴底部按角色/元素/来源的占比统计。
  - `BulkStatsDialog.jsx` — 统一设置弹窗（把某字段一次性应用到所有条目，可回复旧值）。
- **增益**
  - `BuffCard.jsx` — 「一个来源 = 一张卡」。导出 `SOURCE_KINDS`/`sourceKindOf`/`BUFF_KEYS`/`buffKeyOf`/`formatBuffValue`。
  - `BuffPool.jsx` — 左侧增益池。
  - `BuffEditor.jsx` — 增益库编辑器主体（`buffs.html`）。
  - `buff-model.js` — 纯函数：`foldDrops`/`foldZoneDrops`/`customZoneMultiplier`/`mergeStats`/`zoneFactor`/`STAT_META`/`DRAG_MIME`。
- **队伍与通用 UI**
  - `TeamPanel.jsx` — 队伍面板（角色行 + 选中单位的圣遗物），**规划器直接嵌它**。
  - `ConfigTransfer.jsx` — 配置导入/导出。
  - `AppDialog.jsx` — 通用弹窗。
  - `Layout.jsx` — 复刻主站的框架（`chars.html` 用）。
- **元素**
  - `ElementGlyph.jsx` — 导出 `DAMAGE_TYPE_OPTIONS`/`damageTypeLabel`/`ElementGlyph`/`ElementPicker`。
- **原站复现**
  - `CharacterArt.jsx`、`CharacterCard.jsx` — 复刻原站的立绘与卡片外观（含 hover 动画）。

### `src/components/builder/`

- `UnitCard.jsx` — 单位（角色+武器）配置卡。
- `WeaponPicker.jsx` — 武器选择。
- `controls.jsx` — 共用小控件。
- `builder/artifact/`：
  - `index.js` — 装备行总入口。
  - `ArtifactRow.jsx` / `PieceSlot.jsx` — 部位槽与整行。
  - `ArtifactSetTabs.jsx` — **多套圣遗物配置**的切换页签。
  - `ArtifactTotals.jsx` — 词条合计。
  - `ArtifactScan.jsx` — **识图导入**：截图 → 一次模型请求 → 逐件校对 → 勾选后写入当前配置。
    面板挂在行最右端（词条合计之后那块空宽度），校对弹窗用 `PickerModal`。
  - `BonusChips.jsx` / `MainStatControl.jsx` / `SetPicker.jsx` / `StatGlyph.jsx` — 套装/主词条/图标。
  - `SubstatsControl.jsx` / `SubstatValue.jsx` — 副词条编辑；合法取值来自 `lib/substat-rolls.js`。

### `src/lib/`（全部是逻辑，不含 JSX，除非注明）

- **数值/公式**
  - `stat-derive.js` — 由角色/武器/圣遗物推导 panel（`DERIVED_KEYS`）。
  - `stat-meta.js`、`stat-tables.js` — 字段元数据；读 `stats-compact.json` 的因子表。
  - `buff-formula.js` — 增益公式引擎：符号表、递归下降解析、求值、`$` 补全（`scopeForUnit`）。**不用 `eval`**。
  - `axis-compute.js` — `computeAxis`/`computeEntry`/`panelForEntry`，整条轴的唯一推导入口。
  - `damage.js` — `computeDamage`/`dmgBonusFor`/`resMultiplier`/`enemyResKey`/`resShredKey`。
  - `bulk-apply.js` — 统一设置的批量应用与回复。
- **结构/存储**
  - `axes-store.js` — 多条命名轴 + 激活轴，`repairEntries`/`repairChildren`（`...e`/`...c` 原样保留未知字段，如 `note`），`AXES_VERSION`。
  - `rotation-segment.js` — 循环容器：合并/展开/扁平化（`Segment.flatten`）。
  - `team-model.js`、`team-context.jsx` — 队伍模型与 Context（写 `lunaris-team`）。
  - `artifact-model.js`/`artifact-curves.js`/`artifact-sets.js`/`artifact-catalogue.js`/`artifact-meta.js`/`artifact.js` — 圣遗物模型、词条曲线、套装、目录、元数据。
  - `substat-rolls.js` — 副词条合法取值（高精度，按强化次数 N 分组）。
  - `elements.js` — `DAMAGE_TYPES`/`KEY_SUFFIX`。
- **识图（截图 → 圣遗物）**
  - `artifact-scan.js` — 纯函数：提示词、模型返回的容错解析，以及**「图上的字 → 本项目的 key」**的映射
    （部位 / 词条 / 套装）。模型只被要求抄写屏幕上的原文（`攻击力 7.0%`），翻译在这里做，
    所以有一张表可以被测试读、也能被用户在校对表里逐行核对。两条最容易写错的规则写在文件头：
    副词条**按游戏显示值**比较合法性（`攻击力+19` 其实是 19.45），主词条的固定值/百分比**由部位判定**
    （详情面板自己的标题行不写 `%`）。
  - `vision-client.js` — 一次请求：先走本项目 `/api/vision` 转发（OpenAI 兼容接口不给浏览器 CORS），
    没有转发时直连模型（本地模型可以，且不带 Key）。请求体里只有**环境变量名**，密钥从头到尾不在页面上；
    `probeKeyEnv` 问转发服务「读得到这个变量吗」，面板把答案印在输入框下面。**自身没有 import**，
    因为 `serve.mjs` 也引它（共享 URL 规则与默认变量名 `USTC_API_KEY`）。
  - `vision-config.js` — Base URL / **Key 环境变量名** / Model 的 localStorage 读写；浏览器里没有密钥
    （旧版存下的 `key` 不再被读取），Key 也不进仓库、不进 `data/`。
- **增益数据**
  - `buff-library.js`、`buff-flags.js`、`buff-instances.js`、`buff-sources.js`、`pool-view.js`。
- **剪贴板**
  - `entry-clipboard.js`（`ENTRY_MIME`/`entriesToJson`/`entriesToText`/`parseEntriesJson`）、`buff-clipboard.js`。
- **文件读写**
  - `data-file.js` — `buffs.html` 的磁盘文件（File System Access API），退化时只用 localStorage。
  - `config-file.js`（`CONFIG_KIND='lunaris-config'`、`CONFIG_VERSION`）、`json-cache.js`。
  - `gcsim-import.js` — gcsim 日志 -> `lunaris-config`，**纯函数**：日志/对照表/目录/角色详情/天赋表都是参数。
    命令行（`scripts/gcsim-import.mjs`）跑它；规划器优先走 C# 的同名导入器，接口不可用时退回它，见 `docs/GCSIM.md`。
  - `gcsim-sample.js` — 页面侧接线：解压 `.gz`/zlib、复用规划器已有的目录与详情缓存、调 `gcsim-import.js`。
  - `gcsim-client.js` — 页面到 C# `/api/gcsim/import` 的边界：4xx 原样报错，404/405/网络/5xx 退回上面的浏览器实现。
  - `axes-pool.js` — **文件边界上的去重**：把整份配置里重复的*描述符*收进 `pools`，行里只留
    `sourceRef` / `buffRefs` / `summary.sourceLabelRef`。池的键是**整个对象**，所以
    `atkPct=25` 和 `atkPct=18` 是两条增益（按 key 去重会把它们并成一条，静悄悄地算错伤害）。
    只在导出/导入、localStorage、导入器输出上用；内存里仍是内联形状。
- **Hooks**
  - `use-fit-scale.js`、`use-review-data.js`、`use-talent-damage.js`、`use-team-sources.js`。

### `src/pages/`

- `CharList.jsx`、`CharDetail.jsx` — 主站的角色列表与详情。

### `public/data/`（运行时只读，除了 `config/`）

> **哪些进 git**：只有本项目自己产出/审核的文件进版本库。
> `img/`、`data/char/`、`data/artifact/` 和三个 `*list.json` 是 `npm run fetch` 下载的第三方内容，已被 gitignore；
> 新克隆跑一次 `npm run fetch` 就补齐（增量、可续传，见 `scripts/fetch-lunaris.mjs`）。仓库因此只有 ~3 MB，而不是 ~135 MB。

- `charlist.json`、`weaponlist.json`、`artifactlist.json` — 目录（**下载**）。
- `talent-damage.json` — 伤害源（**入库**；`audit.html` 审核后回写）。
- `stats-compact.json` — 成长曲线 + 突破值因子表（**入库**；数值高精度的来源）。
- `char/`、`artifact/` — 逐条详情（**下载**）。
- `config/` — 用户导出（`!data/config/**` 是 gitignore 的例外）。

### `scripts/`

- `fetch-lunaris.mjs` / `fetch-stats.mjs` / `build-stats.mjs` — 拉取与打包（见 `docs/FETCHING.md`、`docs/STATS.md`）。
- `audit-talent-damage.mjs` — `talent-damage.json` 草稿辅助。

---

## 4. 改代码时必须守住的不变量

1. **数字只由 `axis-compute` 推导一次，绝不缓存。** 折叠行、展开卡、底部统计都调同一个函数——历史上三次 bug 都是「一处算、另一处读陈旧副本」。`lib/damage.js` 也被抽成纯函数，`DamageCard` 与轴共用同一实现。
2. **公式作用域是封闭的。** `$总攻击力` 读的是**折叠任何增益之前**的 panel，所以「攻击力 15%」这类增益不可能自引用。见 `buff-formula.js` 头注释。
3. **子段不共享父/兄弟的任何东西。** 循环成员的 `patchEntry`/`setChild` 要能命中多层嵌套；粘贴时要逐层重新发 id（否则一次编辑命中所有卡）。
4. **未知字段必须原样保留。** `repairEntries`/`repairChildren` 用展开运算符，所以 `note` 等新字段不用改 store 就能落盘。
5. **`DamageCard` 必须自包含。** 它在无 `I18nProvider`、无 props 时靠 `L()` 与中文兜底独立渲染（规划器里很多地方只挂一张卡片）。一旦长出对环境的硬依赖，这些挂载点会最先崩。
6. **固定尺寸卡片靠 `use-fit-scale` 等比缩放，不改宽度。** `DamageCard` 是固有 `1320x470` 的面板；塞进窄列时用 `transform: scale()` 整体缩小（`use-fit-scale`），改 `max-width` 只会挤压四列内容而不是缩小。
7. **池化只发生在文件边界，而且解池必须 clone。** `axes-pool.js` 的 `packAxes`/`unpackAxes` 只在导出、导入、localStorage 和导入器输出上跑；`unpackAxes` 交回来的每个 `source`/`buff` 都是**独立副本**。少了这一步，「两行值相同」就变成「两行是同一行」——UI 是就地改 drops 的，改一行会跟着动另一行。同理：池的键是整个对象，值不同就是不同的增益。

---

## 5. 复用指南

- `DamageCard`：传 `char`/`characterId`/`charName`、`sources`、`statDefs`、`injectedTotals`（已折叠好的面板总量）、`injectedBuffs`（外部增益实例）、`onSummary`、`className`。不传则用奥黛塔默认值。
- `BuffCard`：传 `source`（`{ kind, ... }`）、`onBuffsChange`、`onSourceChange` 等。一个 `source` 对应一张卡，卡里 `buffs` 是 1..n 行 `{ key, value, tag }`。
- 拖放用 `buff-model.js` 的 `DRAG_MIME` 作为 MIME 常量。

---

## 6. 维护页各自产出什么

| 页面 | 读取 | 回写 |
| --- | --- | --- |
| `buffs.html`（`BuffEditor`） | 目录 + `lunaris-buff-library` / `lunaris-buff-flags` | 优先写磁盘 `buffs` 文件（File System Access），退化时只写 localStorage |
| `audit.html`（`use-review-data`） | `/data/talent-damage.json`、`/data/charlist.json` | 审核结果回写 `talent-damage.json` |
| `stats.html`（`catalogue` + `stat-tables`） | `stats-compact.json` + 目录展示值 | 只读，用来人工核对两边差异 |

localStorage key 一览：`lunaris-axes`（轴，旧 `lunaris-rotation` 会自动迁移）、`lunaris-team`、`lunaris-buff-library`、`lunaris-buff-flags`、`lunaris-buff-instances`、`lunaris-buff-pool-view`。

---

## 7. 检查脚本（`tests/`，入库）

39 个 `check-*.mjs`（25 纯函数 + 14 浏览器）。它们原本在 `scratch/`（不入库），现在连同最小 fixture 一起提交了，
跑法与各脚本的职责见 [tests/README.md](../tests/README.md)：

```bash
npm test               # 纯函数检查：resolver hook 负责补 .js / .jsx 扩展名
npm run test:browser   # 浏览器检查：Playwright 驱动本机 Chrome（先 npm run dev）
```

单独跑某一个：`node --import ./tests/register-jsx-run.mjs tests/check-derive.mjs`。
依赖链里有 `.jsx`（如 `axis-compute` → `DamageCard`）时必须用 `register-jsx-run`，纯函数用 `register` 即可。

常用：`check-derive`、`check-buff-formula`、`check-artifact-totals`、`check-consistency`、
`check-entry-note`、`check-child-notes`。一次性的排查脚本（`repro-*`、`smoke-*`、`shots-*`）仍然
只留在不入库的 `scratch/`。

---

## 8. 原站复现的坑

- **卡片动画**：实测值写死在 `CharacterCard.jsx`/`CharacterArt.jsx`，改动前先截图对照原站。
- **命名 group**：Tailwind 的 `group`/`group-hover` 不能嵌套同名，父卡 hover 会连带触发子卡样式。
- **`useI18n` 兜底**：任何可独立运行的组件都必须能在 Provider 外拿到中文，否则单独挂载的卡片会崩。
- **构建产物**：`builder.html` 已删除，规划器就是那个页面；不要再加回。


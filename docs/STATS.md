# 面板数值是怎么算出来的

伤害轴上的每一个数字，最终都建立在「角色的白值 + 武器白值 + 圣遗物」之上。本文说明这些白值从
哪里来、为什么不是直接读数据集、以及以后出了新角色怎么增量更新。

页面入口：**配队页右上角的 `数值来源`**（`/stats.html`），可以按角色/武器逐级查看，并与数据集里
四舍五入后的展示值逐行对照。

## 一、结论：公式

```
白值 = base × curve(等级) + 突破值(阶)
```

- `base`（角色是 `hpBase/attackBase/defenseBase`，武器是 `initValue`）**每个角色/武器私有**，
  而且就是 1 级的值——因为曲线在 1 级恒等于 1（`GROW_CURVE_*` 表第 1 行全是 1）。
- `curve(等级)` **与角色无关**，是一张共享的等级形状表。角色只用 4 条
  （`HP_S4 / ATTACK_S4 / HP_S5 / ATTACK_S5`，注意**防御没有自己的曲线，复用的是同档 HP 曲线**），
  武器有 18 条（其中 4 条目前没有被任何武器引用）。
- `突破值(阶)` **是角色/武器私有的**，按突破阶给，且表里存的是**该阶的总值**（直接加，不累加）。

补充两条容易踩的点：

- **曲线名不代表属性。** 天铁尖兵（`15503`）的元素充能副属性走的是 `GROW_CURVE_CRITICAL_301`，
  所以曲线必须按实体的字段读，不能从名字猜。
- **武器突破表里所有非白值条目都是无数值的占位符**，所以武器的副属性就是 `初值 × 曲线`，
  没有突破加成；角色则相反，突破表里带真正的属性值。

## 二、数据来源

| 表 | 内容 |
| --- | --- |
| `AvatarExcelConfigData` | 角色 `hpBase/attackBase/defenseBase`、`propGrowCurves`、`elementMastery` |
| `AvatarCurveExcelConfigData` | 4 条角色成长曲线 × 100 级 |
| `AvatarPromoteExcelConfigData` | 角色突破加成，按 `avatarPromoteId`，每 id 固定 7 阶 |
| `WeaponExcelConfigData` | 武器主/副属性的 `initValue` 与曲线名 |
| `WeaponCurveExcelConfigData` | 18 条武器成长曲线 × 100 级 |
| `WeaponPromoteExcelConfigData` | 武器突破加成（只有白值有值），每 id 7 阶、低星 5 阶 |

解包来源是 **`Dimbreath/AnimeGameData2`** 的 `ExcelBinOutput/`（GitLab）。这不是「某个网站的数字」：
社区网站（wiki / honeyhunter / ambr）显示的也是同一批游戏配置表，只是各自又做了一次舍入。

Genshin Optimizer（`frzyc/genshin-optimizer`）用的是同一套合成方式，可对照：

- `libs/gi/formula/src/data/char/util.ts:197` — `ownBuff.base[key].add(prod(base, allStatics('static')[curve]))`，随后按阶 `subscript(ascension, values)`
- `libs/gi/formula/src/data/weapon/util.ts:16` — 武器同构
- `libs/gi/formula/src/data/common/index.ts:53` — `expCurve` 用 `subscript(own.char.lvl, v)` 按等级取曲线值

## 三、为什么要自己算：三层精度

| 层级 | 法尔伽 L95 攻击 | 说明 |
| --- | --- | --- |
| 游戏内部 | 约 `392.4743…` | 客户端浮点 |
| 解包 Excel | `27.4645 × 10.184 + 112.77585 = 392.4743` | GitLab 版**截到 4 位小数** |
| 数据集展示表 | `392` | `public/data/char/chs/*.json` 只存整数 |
| 武器同理 | 狼的武功歌 L90 `608` vs `608.0746` | `weaponlist.json` 存整数 |

法尔伽 L95 + 狼的武功歌 L90 的白值：公式 `1000.5489`，旧路径 `1000`。差 0.55，会被攻击力百分比
放大。所以 `derivePanel` 现在优先走公式，数据集里的展示表只作为**回退**（例如配置表里没有的角色）。

对照验证（`scratch/check-stat-tables.mjs`）：

- 角色：136/139 个有因子，37536 个逐级数值里**只有 2 处**四舍五入后与展示表不一致，且都落在 `.5`
  边界上（4 位小数截断决定了最后一位）；无因子的 2 个（米提亚、瓦列里）走回退。
- 武器：256 把里 10 把不一致，**都是本地表错**——无锋剑/银剑等 1★2★ 十把，Fandom 显示
  `23 - 185` / `33 - 243`，与公式一致，而 `weaponlist.json` 写的是 171 / 242。

## 四、文件与代码

```
stats-src/*.json                   下载的原始 Excel（gitignore，约 2.8 MB）
public/data/stats-compact.json     打包后的因子表（提交，约 247 KB）
scripts/fetch-stats.mjs            增量下载原始表
scripts/build-stats.mjs            打包 + 打印与现有文件的差异
src/lib/stat-tables.js             纯函数读取因子（charStatsAt / weaponStatsAt）
src/lib/stat-derive.js             面板推导：优先公式，缺失时回退
src/stats-main.jsx                 /stats.html 查看与对照页
```

`stats-compact.json` 只存**因子**，不存 100 级的结果，所以体积可控：

```
charCurve / weaponCurve    曲线名 -> 100 个数（共享，只存一份）
charPromote / weaponPromote 突破表 id -> 每阶 { 属性: 值 }
chars                      角色 id -> { promote, base, curve, innate?, maxLevel }
weapons                    武器 id -> { promote, maxLevel, main:{prop,base,curve}, sub? }
```

## 五、增量更新（出了新角色怎么办）

```bash
npm run stats:update     # = stats:fetch + stats:build
npm run stats:check      # 只看上游变了什么，不下载
npm run stats:build      # 只用本地 stats-src/ 重新打包
```

- `stats:fetch` 用清单（`stats-src/.manifest.json`）记录每个文件的 sha256，**上游没变就不重新下载**，
  所以再次运行只要几秒；下载先落 `.part` 再改名，中断不会留下半个 JSON。
- `stats:build` 是 `stats-src/` 的纯函数，重新生成 `stats-compact.json`，并打印**差异报告**：
  新增/删除的角色与武器、以及因子发生变化的条目。新角色出现时，这里会直接列出来。
- 因为角色/武器是按 id 索引的，新增角色不需要改任何代码，配队页与 `/stats.html` 自动就能用。
- 网络：优先直连，失败时回退 SOCKS5（默认 `127.0.0.1:10808`，用 `STATS_PROXY=host:port` 覆盖）。

## 六、已知限制

- 解包 Excel 本身截到 4 位小数，所以绝对精度到此为止；想要更高得换未截断的源。
- **武器等级没有建模**：模型里只有角色等级，武器一律按它的封顶等级算（低星 70，其余 90），
  与旧行为一致。要支持 1 级武器需要往 `team-model` 里加字段。
- 米提亚（`10000136`）、瓦列里（`10000137`）不在角色配置表里，走本地四舍五入表。
- `stats-src/` 没有提交，所以新机器上必须先 `npm run stats:fetch` 才能 `stats:build`。

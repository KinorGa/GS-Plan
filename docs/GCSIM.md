# 从 gcsim 导入伤害轴

[gcsim](https://github.com/genshinsim/gcsim) 是第三方的伤害模拟器。它导出的一次运行里，
`logs` 记着**每一击**：哪一招、什么元素、有没有暴击、打了多少（这份样本是 617 个 `damage` 事件）。
这里做的就是把这些事件翻成本项目伤害轴上的一条条条目，产物和「导出/导入」用的是同一个
`lunaris-config` JSON——所以规划器本来就有入口，不用加界面。

**样本是自足的**：除了伤害日志，`character_details` 里还带着每个队员的等级、命座、天赋等级、
武器和圣遗物**套装**。所以不需要再去读 config.txt——队伍和轴都从这一个文件来。

```bash
npm run gcsim:import                    # 读 scratch/_gcsim_serve_sample.json，写 data/gcsim-config.json
node scripts/gcsim-import.mjs --help    # 见脚本头部：--sample / --config / --out / --abilities / --team / --report
```

产物在规划器右上角「导入」选进去即可。

## 为什么需要一张对照表

gcsim 用自己的内部 ability 名（`Azure Devour`、`Sturm und Drang Normal 1`），本地数据里没有这个名字，
对不上就不知道该落到哪个来源的哪一行，只能人工对照，于是有了 `public/data/gcsim-abilities.json`。

- `abilities`：每个角色的每个 ability → `{ source, stage }`。**stage 写中文行名，不写行下标**——
  行名是人能核对的，下标会随着天赋表增删一行整体漂移，而且漂移后不报错、只是悄悄指错行。
- `characters` / `weapons` / `sets`：只写推不出来的特例。gcsim 名基本等于英文名去掉标点再小写
  （`gestofthemightywolf` = "Gest of the Mighty Wolf"），所以角色、武器、套装大多用不着写；
  真正推不出的是别名，例如 gcsim 的 `risingwinds` 其实是「A Day Carved From Rising Winds」。

## 脚本做什么

- 按帧顺序扫描 `damage` 事件，把**连续的同一 ability 合并成一条**，单击数 = 连续次数；
- 这一段的 `critMode` 由它是否**全暴击 / 全不暴击**决定，混在一起就是平均（`avg`）；
- 每条带一个 note，例如 `gcsim：2 击 · 单击 5,955.52 · 合计 11,911.04 · 暴击混合`。
  这个数是 gcsim 真跑出来的，摆在条目里可以直接和旁边的本地面板数对照；
- 队伍全部取自样本的 `character_details`：角色、武器、等级、命座，以及**天赋等级**——注意存的是
  最终等级（把 C3/C5 的 +3 算进去），因为本地存的就是最终值，不这么做会读到错误的一列；
- 圣遗物只带**套装**（4 件套填 4 个部位），部位词条留空。

## 脚本不做什么（以及为什么）

导进来的条目**不会**自动等于 gcsim 的伤害，这一版只重建轴的**结构**，没有重建**数值**：

- **圣遗物词条数值不写入。** 样本的 `character_details.stats` 是一串按属性类型排的聚合数，
  而模型存的是五个部位各自的合法词条。把聚合值硬拆回词条，会造出一套从没存在过、也不合法的圣遗物——
  一条错误的数值比一个空缺更糟（见 `docs/DEV.md` 的不变量）。
- **gcsim 的增益栈不重建。** 它是逐帧生效的（圣遗物套装、武器、天赋被动……）。

所以现在这版：轴是对的、行是对的（来源、段、击数、暴击模式都对），note 里的 gcsim 数字也在，
差的只是面板那一截。**面板对齐（词条 + 增益）是下一步。**

### 已知对不上的倍率

varka 的狂飙突进 / 苍噬在 gcsim 里多带了一层被动倍率（后算约为 ×2.2），所以这些行的
`mult` 和 gcsim 的 `talent` 不会相等——行本身是对的，差的是那层被动，同样归到面板/增益对齐。

## 明细（report）

脚本把每个 ability 的映射结果打到 stderr，分四种：`ok` / `忽略(反应)` / `未映射` / `行名过时!`。

这份样本 617 击的结果：**404 映射到行上**，**102 是扩散反应**（`swirl-pyro`，由附着触发、
不属于任何角色的天赋行），**111 是命座/天赋的独立伤害**（Varka C2、Banehunter A1/C4）。
后两者**没有静默丢掉**，而是列出来：它们要先补进 `public/data/talent-damage.json` 才能落到行上。

## 维护

- **新角色**：gcsim 名推不出本地 id 时脚本会直接报错，并说清在 `characters` 里补哪一条；
- **新 ability**：会出现在「未映射」里，照 `abilities` 的格式补一条即可；
- **行名打错**：会显示「行名过时!」，不会悄悄指到别的行；
- **换了导出文件**：`--sample` 指过去就行，什么都不用改。

测试：`tests/check-gcsim-import.mjs`（用一份两击的合成样本跑全部分支，不依赖 5 MB 的导出文件）。
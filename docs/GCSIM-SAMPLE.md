# gcsim 导出文件的格式

这份文档记录 gcsim 一次运行导出的 JSON 长什么样，用来在改动导入器（`scripts/gcsim-import.mjs`）
和它的对照表（`public/data/gcsim-abilities.json`）时不用每次重新反推。字段名、嵌套形状都以
实际导出为准。

样本：`D:\CPT\tmp\export\serve_sample.json.gz`（其实是 zlib 流，`zlib.inflateSync` 解，不是 gzip）。

## 顶层结构

```jsonc
{
  "config": "# options ...",          // 这次运行的 gcsim 脚本原文（含注释）
  "initial_character": "nicole",
  "character_details": [ /* 每名队员一项 */ ],
  "target_details":   [ /* 敌人，通常 1 项 */ ],
  "seed": "13475168686552621639",
  "logs": [ /* 上万条事件，见下 */ ]
}
```

### character_details[i]

队员的**完整 build**，导入器的队伍部分全部从这里来，不需要读 `config`。

```jsonc
{
  "name": "varka", "element": "anemo",
  "level": 95, "max_level": 100,
  "cons": 6,                                   // 命座
  "weapon": { "name": "gestofthemightywolf", "refine": 1, "level": 90, "max_level": 90 },
  "talents": { "attack": 10, "skill": 10, "burst": 10 },  // 已是最终等级（C3/C5 的 +3 已算入）
  "sets": { "adaycarvedfromrisingwinds": 4 },  // 套装名 -> 件数
  "stats": [ /* 26 个数字，见下 */ ]
}
```

`stats` 是这次运行喂给 gcsim 的 `add stats` 聚合值，按固定的 26 位顺序排列。导入器的
`GS_STAT` 就是这张顺序表；每个非零项在圣遗物里写成一条「总值」词条（不拆卷数）。
样本里 varka 的 `stats` 为：

```
[ 0, 0.109, 18.5, 4780, 0, 357.7, 1.288, 0.065, 102.6, 0.397, 1.492,
  0, 0.3, 0, 0, 0, 0.466, 0, 0, 0, 0, 0.1, 0, 0, 0, 0 ]
```

顺序（前 10 位最能对上 `add stats` 行）：

| 位 | 含义 | 位 | 含义 |
| :-: | :-- | :-: | :-- |
| 1 | def% | 9 | cr（暴击率） |
| 2 | def | 10 | cd（暴击伤害） |
| 3 | hp | 11 | heal（受治疗加成） |
| 4 | hp% | 12 | pyro%（火伤） |
| 5 | atk | 13 | 其它元素伤害% …… |
| 6 | atk% | 16 | anemo% |
| 7 | er（元素充能） | 21 | dmg%（通用伤害加成） |
| 8 | em（元素精通） | 22 | …… |

> 注意 CD/CR 等存的是**小数**（`1.492` = 149.2%），不是百分数。

### target_details[0]

```jsonc
{ "level": 110, "resist": { "anemo": 0.1, "cryo": 0.1, ..., "physical": 0.1 },
  "position": { "r": 1 }, "particle_element": "none", "modified": true }
```

## logs：18 种事件

`logs` 是**按帧排序**的事件流，每条形如
`{ "frame": 10, "ended": 10, "event": "<类型>", "char_index": 2, "logs": {...} }`。
样本里各类型的条数：

| 事件 | 条数 | 事件 | 条数 |
| :-- | :-: | :-- | :-: |
| status | 4891 | damage | 617 |
| hitlag | 1772 | calc | 617 |
| icd | 1211 | element | 243 |
| snapshot | 481 | action | 198 |
| cooldown | 272 | energy | 189 |
| weapon | 152 | debug | 140 |
| pre_damage_mods | 102 | character | 89 |
| sim | 25 | artifact | 22 |
| shield | 11 | | |

导入器消费 `damage`（翻成轴上的条目）和它同帧的 `calc`（取这一击真用的倍率 `talent`）。

### damage 事件

`logs` 里混着两类键，导入器用 `HIT_KEYS` 区分：

```jsonc
{
  "frame": 529, "char_index": 0, "event": "damage",
  "logs": {
    // —— 关于「这一击」本身（HIT_KEYS，不是状态）——
    "abil": "Sturm und Drang Normal 0",   // gcsim 内部招式名，靠映射表落到本地来源/行
    "ele": "pyro", "crit": true, "attack-tag": 1,
    "damage": 148541.924548966,
    "amp": "", "cata": "", "source_frame": 510, "target": 1,
    "pre_damage_mods": [ /* 见下，嵌套的 per-hit 伤害加成 */ ],

    // —— 这一击身上生效的**状态**：键 = 状态名，值 = 字符串数组 ——
    "varka-a1-pyro":    [ "status: added", "expiry_frame: -1", "pyro%: 0.25" ],
    "varka-c4-pyro":    [ "status: added", "expiry_frame: 1089", "pyro%: 0.20" ],
    "pyro-res":         [ "status: added", "expiry_frame: -1", "atk%: 0.25" ],
    "grace-of-kenosis": [ "status: added", "expiry_frame": 1209, "atk: 527.49" ],
    "lost-prayer":      [ "status: rejected", "reason: conditions not met" ]   // 没生效
  }
}
```

状态值数组的第一段通常是 `status: added|rejected` 和 `expiry_frame: N`，之后是**它加的属性行**，
如 `pyro%: 0.25`、`atk: 527.49`、`cd: 0.80`、`cr: 0.20`、`dmg%: 0.30`、`ele: pyro`、`amount: -0.4`。
数值是**小数**（`0.25` = 25%），导入器按 `LINE_STAT` 的 `pct` 标记决定要不要 ×100。

`status: rejected` + `reason: ...` 表示这个状态**没有生效**（四风原典、图莱杜拉的回忆），
不能挂卡。

### 四种「状态」形态

1. **普通状态**（绝大多数）：直接是 `[行, 行, ...]`，数值就在行里。
2. **`resist_mods`**：和 `pre_damage_mods` 同一种「名字 + 行」嵌套形状，装的是减抗。**日志里带数值**
   （`amount` 是小数，`ele` 说是哪种抗性），导入器直接读，不在对照表里写死：

   ```jsonc
   "resist_mods": [
     "vvpyro",       [ "status: added", "ele: pyro", "amount: -0.4" ],
     "durin-a1-pyro",[ "status: added", "ele: pyro", "amount: -0.35" ]
   ]
   ```
3. **`pre_damage_mods`**：和 `resist_mods` 同一种「名字 + 行」嵌套形状，装的是**逐击的
   伤害加成**（不是抗性）：

   ```jsonc
   "pre_damage_mods": [
     "varka-a4",           [ "status: added", "expiry_frame: -1",  "dmg%: 0.22" ],
     "prune-tolling-rally",[ "status: added", "expiry_frame: 666", "dmg%: 0.25" ]
   ]
   ```

   导入器把它拆开后交给和普通状态同一条路径（`absorb`），所以每一击的 `dmg%` 都进到该行的
   「通用伤害加成」里。
4. **`def_mods`**：同样的嵌套形状，装的是**减防**（`amount: -0.3`，不带 `ele`——减防对
   所有命中生效，不分元素）。读法和 `resist_mods` 一样，`amount` 直读日志。注意这是敌方的
   debuff（杜林 C6 的 30%），和 calc 事件里攻击方的 `ignore_def`（无视防御）是两个因子，
   在防御乘区里**相乘**。

### calc 事件 —— 数值核对的金矿

**每一次 `damage` 都有一条同帧、同 `char_index`、同 `abil` 的 `calc` 事件**，`logs` 里是这一击
算到最后用到的**每一个中间量**。这是核对本地伤害模型最直接的对照物。

```jsonc
{
  "frame": 10, "char_index": 2, "event": "calc",
  "logs": {
    "abil": "Revelation: Uncreated Light",
    "damage": 6029.715459607385,     // 最终一击伤害
    "is_crit": false,
    // 面板
    "talent": 2.4912,                // 这一击用的倍率（已含天赋等级、命座等）
    "base_atk": 950.0996846, "flat_atk": 933.49395510706, "atk_per": 2.274,
    "base_hp": 10409.02, "hp_per": 0.128, "flat_hp": 5947, "use_hp": false,
    "base_def": 562.58, "def_per": 0.066, "flat_def": 58, "use_def": false,
    "cr": 0.524768, "cd": 0.5, "em": 0, "char_lvl": 90,
    // 乘区
    "total_scaling": 4044.12032248746, // = base_atk*(1+atk_per)+flat_atk（这一击的攻击力总值）
    "base_dmg": 10074.712547380761,    // = total_scaling * talent
    "bonus_dmg": 0.4,                  // 总伤害加成 = 元素伤害% + 通用 dmg%
    "ele_per": 0.4,                    // 其中元素伤害加成那部分
    "flat_dmg": 0, "elevation_bonus": 0,
    "def_mod": 0.475,                  // 防御乘区
    "res": 0.1, "res_mod": 0.9,        // 抗性 / 抗性乘区
    "react_mult": 0, "melt_vape": false, "reaction_type": "",
    "dmg_if_crit": 9044.573189411078,  // 若暴击
    "avg_crit_dmg": 7611.816320761009, // 期望（= cr 加权）
    "pre_crit_dmg": 6029.715459607385, // 暴击前
    "damage_grp_mult": 1, "amp_mult_total": 0,
    "def_adj": 0, "ignore_def": 0, "catalyzed": false,
    "target": 1, "target_lvl": 110, "src_frame": 1
  }
}
```

完整公式链（对当前样本 `tmp/serve_sample.json.gz` 全部 625 个 damage 事件逐条验证过，分毫不差）：

```
damage = (total_scaling × talent + flat_dmg) × (1 + bonus_dmg) × res_mod × def_mod × critMult
total_scaling = base_atk × (1 + atk_per) + flat_atk
def_mod = (100 + 角色等级) / ( (100 + 角色等级) + (100 + 敌人等级) × (1 - 减防) × (1 - 无视防御) )
critMult = is_crit ? 1 + cd : 1
```

两个坑，都踩过：

- **增伤区是 `bonus_dmg`，不是 `ele_per`。** `ele_per` 只有元素伤害加成那部分，通用 dmg%
  （杜林 C4 的 0.40）不在里面；拿 `ele_per` 验算会有 392/625 对不上。
- **`flat_dmg` 和 `ignore_def` 只出现在 calc 事件里**，damage 事件的状态列表完全看不到——
  见下一节。

这也是核对本项目 `src/lib/damage.js` 的天然断言点：`base_atk / flat_atk / atk_per / cr / cd /
bonus_dmg / def_mod / res_mod / talent / flat_dmg / ignore_def` 每一项都能和本地面板逐项对上。

#### calc 独有的两个因子：`flat_dmg` 与 `ignore_def`

damage 事件的状态列表记得住大多数增益，但有两笔钱**只**写在 calc 事件上，任何状态名都不提：

- **`flat_dmg`（附加伤害值）**：加在倍率乘区之后、增伤区之前的一笔定值。样本里它有三个来源：
  尼可 C4 先导之佑（尼可攻击力的 70%）、尼可 p4（奥迹造影 +300% 尼可攻击力，且 C4/C1 对
  奥迹造影不生效）、杜林 C1 轮变启迪（杜林攻击力的 60%，只给队友）。注意尼可 C4 对
  **每个角色各自**随她的爆发周期开关——同一轮里法尔伽有 C4+C1、仅 C1、仅 C4 三种命中；
  杜林自己的 `flat_dmg` 则恒等于 C4 的量（他吃不到自己的 C1）。
- **`ignore_def`（无视防御）**：防御乘区里 `(1 - 无视防御)` 那个因子。样本里 0.4 = 尼可 C6
  （全队），杜林自己爆发期间 0.7 = 尼可 C6 + 杜林 C6（只加他自己），他早期爆发还有单独的
  0.3。注意它和 `def_mods` 里的**减防**（杜林 C6 的 30%，敌方 debuff）是两个东西：
  减防进 `(1 - 减防)`，无视防御进 `(1 - 无视防御)`，两者**相乘**，不相加。

导入器怎么把它们变回来源卡，见 [GCSIM.md](./GCSIM.md) 的「calc 独有的两个因子」。

## 已知缺口（截至当前）

没有。之前记在这里的都已修复：

- ~~`pre_damage_mods` 被跳过~~：现在拆开走普通状态那条路径，逐击的 `dmg%` 进到行里；
- ~~多段招式并成一行、只算第 0 段~~：现在按一次施放（`logs.source_frame`）归组，施放内**每一击**
  都是一段，拆成父子条目，每段带自己的 `scaling`（相同数值的几击不合并成 `×2`）；
- ~~`def_mods`（减防）不认识~~：现在和 `resist_mods` 同一条路径拆开，`amount` 直读日志；
- ~~`flat_dmg` / `ignore_def` 完全丢失~~：这两个因子只在 calc 事件上（见上节），丢失时
  每行只剩 gcsim 的 42%~53%。现在伤害模型有 `flatDmg` 字段，导入器把它们拆回来源卡
  （[GCSIM.md](./GCSIM.md) 的「calc 独有的两个因子」），全部 411 行与 gcsim 的偏差 ≤0.2%。
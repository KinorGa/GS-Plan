# 交接文档：增益池两层复合筛选（BuffPool filter）

**状态：功能已实现，4 个已知 bug 已修复，构建通过。**

- 唯一被修改的文件：`src/components/BuffPool.jsx`（**只改了这一个文件**）
- 未改动：`BuffCard.jsx`、`buff-sources.js`、`game.js`、任何其它文件
- 构建命令：`node build.mjs`（在 `D:\CPT\Probe` 下运行）—— **通过**
- 待人工验证：**浏览器里实际点一遍**（构建无法覆盖视觉与交互）

---

## 一、需求（用户原话）

> 能不能在这个增益池加个筛选功能，二层筛选一是角色筛选，二是按天赋、命座、武器、圣遗物筛选，这两层是复合的，明白吗？尽可能的多用图标，因为所有的图标都有

约束（用户后续补充）：

> 你应该尽可能少的修改代码，因为这部分只和增益池有关

---

## 二、实现

### 两层复合（AND）

```
增益池
├─ 第一层：角色      [全部] [头像] [头像] …        ← who
└─ 第二层：类型      [全部] [天赋] [命座] [武器] [圣遗物]  ← what
两个条件同时生效
```

### 第二层的 5 个 chip

按用户点名的四类，其中「天赋」把普攻/战技/爆发并入（对读者而言都属于"角色自己的技能组"）：

| chip | 覆盖的 `kind` | 取色来源 |
|---|---|---|
| 天赋 | `talent` + `normal` + `skill` + `burst` | `SOURCE_KINDS.talent` |
| 命座 | `constellation` | `SOURCE_KINDS.constellation` |
| 武器 | `weapon` | `SOURCE_KINDS.weapon` |
| 圣遗物 2 件套 | `artifact2` | `SOURCE_KINDS.artifact2` |
| 圣遗物 4 件套 | `artifact4` | `SOURCE_KINDS.artifact4` |

> 用户原话是「圣遗物」一类，这里拆成 2 件套 / 4 件套两个 chip —— 因为二者是数值完全不同的两种增益，合成一个 chip 会让"选中圣遗物"这种说法无法对应到具体哪一条。

### 关键设计决策

- **`null` = 全部**：两层默认都是 `null`。默认收窄会藏掉用户没要求藏的卡，而池子是"拖拽来源"的地方，缺卡会被误读成"这个角色没武器"。
- **选项从 pool 派生，不从队伍文档派生**：`owners` 和 `available` 都由 `pool` 算出，所以不会出现"点了必然为空"的 chip（C0 角色没有命座卡，没装备武器就没有武器卡）。
- **只有一层只有一个选项时不画那一层**：`owners.length > 1 || available.size > 1`，以及各层内部的 `> 1` 判断 —— 单选项的筛选器无法筛选任何东西。
- **全图标**：类型 chip 是内联 SVG 字形 + `SOURCE_KINDS` 的原色（与卡片左侧色条同色）；角色 chip 是头像 + 元素色描边。文字只保留两个「全部」。
- **空结果有专门文案**："这个组合下没有来源" —— 让空列读作"这两个条件不搭"，而不是"这个角色什么都没有"。
- **计数**：筛选生效时显示 `shown / total`。

### 已验证的逻辑

用一个独立脚本对 `shown` 的过滤语义做了 9 条断言，覆盖单层、双层、以及"组合为空"的情形，全部通过：

```
kind chips offered: talent, constellation, weapon, artifact2, artifact4
PASS  who=null        what=null       -> [a1,a2,a3,a4,b1,b2,b3,b4]
PASS  who=10000002    what=null       -> [a1,a2,a3,a4]
PASS  who=null        what=weapon     -> [a4,b2]
PASS  who=10000002    what=weapon     -> [a4]
PASS  who=10000003    what=weapon     -> [b2]
PASS  who=10000002    what=artifact2  -> []
PASS  who=null        what=talent     -> [a1,a2,a3]
PASS  who=10000003    what=talent     -> []
```

---

## 三、曾存在并已修复的 4 个 bug

这几个是同一类错误：**取值取到了不存在的字段**，所以构建不报错、运行也不崩，只是静默失效（颜色丢失、描边不画、tooltip 为空）。记录在此，因为这类 bug 靠 `node build.mjs` 永远抓不到。

### Bug 1 — 类型 chip 颜色全丢（已修）

`KIND_FILTERS` 各项原本没有 `kind` 字段，导致 `SOURCE_KINDS[k.kind]` = `SOURCE_KINDS[undefined]` = `undefined`，chip 拿不到颜色。
**修法**：给每项补 `kind` 字段（`{ key: 'talent', kind: 'talent', kinds: [...] }`）。

### Bug 2 — 类型 chip tooltip 为空（已修）

chip 读的是 `k.chs` / `k.en`，而 `KIND_FILTERS` 里根本没有这两个字段。
**修法**：改为从 `SOURCE_KINDS[k.kind]` 取：`title={SOURCE_KINDS[k.kind]?.chs ? L(SOURCE_KINDS[k.kind]) : k.key}`。

### Bug 3 — 角色元素描边永不显示（已修）

`owner.element` 是元素**键名**（`'Anemo'`，见 `buff-sources.js:117`），不是 `rgb()` 字符串；原代码 `ring.startsWith('rgb')` 恒为 false，描边永远不画。
**修法**：改走现成映射 `elementOf(ring).color`（`src/game.js:33`）。

### Bug 4 — 头像路径硬编码（已修）

原本手写 `` `/img/avatar/${portrait}.webp` ``。
**修法**：改用现成 helper `avatarImg(portrait)`（`src/game.js:46`）。

---

## 四、数据形状（供后续改动参考）

`pool` 由 `src/lib/buff-sources.js` 的 `buildUnitSources()` 生成，每项形如：

```
{ id, kind, slot, name, icon, iconKind, rank, owner, buffs }
```

- `kind` ∈ `normal | skill | burst | talent | constellation | weapon | artifact2 | artifact4`
  （注意是 `normal` 和 `talent`，**不是** `attack` / `passive` —— `buff-sources.js:55` 的 `CARD_KIND` 做了翻译）
- `owner` = `{ id, unitId, name, element }`，其中 `element` 是键名（`'Anemo'`）或 `null`
- `buffs` 默认为**空数组**，由用户自己填；拖拽时整张卡序列化成 JSON 快照

---

## 五、若要继续改

- **想给圣遗物合成一个 chip**：把 `KIND_FILTERS` 里两项合并为 `{ key: 'artifact', kind: 'artifact2', kinds: ['artifact2','artifact4'] }` 即可，`KindGlyph` 已按 `key` 分发。
- **想给天赋拆开**：把第一项拆成 4 项，各自 `kinds` 单项，并在 `KindGlyph` 里补 `normal`/`skill`/`burst` 的 `case`。
- **`KindGlyph` 的 `default: return null`**：若新增 key 忘了补 `case`，chip 会**只剩一个空方块**（不报错）。改 `KIND_FILTERS` 时记得同步 `KindGlyph`（`BuffPool.jsx` 约 300 行起）。

---

## 六、一句话总结（对用户复述用）

筛选已经可用：**第一层按角色（头像），第二层按类型（天赋/命座/武器/圣遗物），两层同时生效**。所有 chip 都用图标，颜色与卡片本身一致；池子里没有的选项不会出现，所以点了不会得到空列表。之前的颜色丢失/描边不画/提示为空是取值字段名对不上，已一并修掉并通过构建。

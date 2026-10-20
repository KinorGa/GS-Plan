using GsPlan.Core.Damage;

namespace GsPlan.Core.Axis;

/// <summary>The card's default panel and the bridge into <see cref="DamageStats"/>.</summary>
public static class AxisPanelStats
{
    public static readonly (string Key, string Symbol)[] PanelSymbols =
    [
        ("hp", "生命值"),
        ("atk", "攻击力"),
        ("def", "防御力"),
        ("flatHp", "固定生命值"),
        ("flatAtk", "固定攻击力"),
        ("flatDef", "固定防御力"),
        ("hpPct", "生命值加成"),
        ("atkPct", "攻击力加成"),
        ("defPct", "防御力加成"),
        ("em", "元素精通"),
        ("critRate", "暴击率"),
        ("critDmg", "暴击伤害"),
        ("er", "元素充能效率"),
        ("pyroDmg", "火元素伤害"),
        ("hydroDmg", "水元素伤害"),
        ("cryoDmg", "冰元素伤害"),
        ("electroDmg", "雷元素伤害"),
        ("anemoDmg", "风元素伤害"),
        ("geoDmg", "岩元素伤害"),
        ("dendroDmg", "草元素伤害"),
        ("dmgBonus", "通用伤害加成"),
        ("physBonus", "物理伤害加成"),
        ("healBonus", "治疗加成"),
    ];

    public static Dictionary<string, double> DefaultStats()
    {
        var stats = new Dictionary<string, double>(StringComparer.Ordinal)
        {
            ["hp"] = 12981,
            ["atk"] = 335,
            ["def"] = 787,
            ["flatHp"] = 0,
            ["flatAtk"] = 0,
            ["flatDef"] = 0,
            ["hpPct"] = 0,
            ["atkPct"] = 0,
            ["defPct"] = 0,
            ["em"] = 0,
            ["critRate"] = 5,
            ["critDmg"] = 50,
            ["er"] = 100,
            ["pyroDmg"] = 0,
            ["hydroDmg"] = 0,
            ["cryoDmg"] = 0,
            ["electroDmg"] = 0,
            ["anemoDmg"] = 0,
            ["geoDmg"] = 0,
            ["dendroDmg"] = 0,
            ["dmgBonus"] = 0,
            ["physBonus"] = 0,
            ["reactionBonus"] = 0,
            ["flatDmg"] = 0,
            ["defShred"] = 0,
            ["defIgnore"] = 0,
            ["enemyLevel"] = 100,
            ["talentBonus"] = 0,
            ["resShred"] = 0,
        };
        foreach (var suffix in new[]
        {
            "Pyro", "Hydro", "Cryo", "Electro", "Anemo", "Geo", "Dendro", "Physical",
        })
        {
            stats["resShred" + suffix] = 0;
            stats["enemyRes" + suffix] = 10;
        }
        return stats;
    }

    public static DamageStats ToDamageStats(IReadOnlyDictionary<string, double> panel) => new()
    {
        Hp = Get(panel, "hp"),
        Atk = Get(panel, "atk"),
        Def = Get(panel, "def"),
        HpPct = Get(panel, "hpPct"),
        AtkPct = Get(panel, "atkPct"),
        DefPct = Get(panel, "defPct"),
        FlatHp = Get(panel, "flatHp"),
        FlatAtk = Get(panel, "flatAtk"),
        FlatDef = Get(panel, "flatDef"),
        Em = Get(panel, "em"),
        CritRate = Get(panel, "critRate"),
        CritDmg = Get(panel, "critDmg"),
        Er = Get(panel, "er"),
        DmgBonus = Get(panel, "dmgBonus"),
        PhysBonus = Get(panel, "physBonus"),
        PyroDmg = Get(panel, "pyroDmg"),
        HydroDmg = Get(panel, "hydroDmg"),
        CryoDmg = Get(panel, "cryoDmg"),
        ElectroDmg = Get(panel, "electroDmg"),
        AnemoDmg = Get(panel, "anemoDmg"),
        GeoDmg = Get(panel, "geoDmg"),
        DendroDmg = Get(panel, "dendroDmg"),
        ReactionBonus = Get(panel, "reactionBonus"),
        DefShred = Get(panel, "defShred"),
        DefIgnore = Get(panel, "defIgnore"),
        EnemyLevel = Get(panel, "enemyLevel"),
        TalentBonus = Get(panel, "talentBonus"),
        FlatDmg = Get(panel, "flatDmg"),
        ResShred = Get(panel, "resShred"),
        EnemyResPyro = Get(panel, "enemyResPyro"),
        EnemyResHydro = Get(panel, "enemyResHydro"),
        EnemyResCryo = Get(panel, "enemyResCryo"),
        EnemyResElectro = Get(panel, "enemyResElectro"),
        EnemyResAnemo = Get(panel, "enemyResAnemo"),
        EnemyResGeo = Get(panel, "enemyResGeo"),
        EnemyResDendro = Get(panel, "enemyResDendro"),
        EnemyResPhysical = Get(panel, "enemyResPhysical"),
        ResShredPyro = Get(panel, "resShredPyro"),
        ResShredHydro = Get(panel, "resShredHydro"),
        ResShredCryo = Get(panel, "resShredCryo"),
        ResShredElectro = Get(panel, "resShredElectro"),
        ResShredAnemo = Get(panel, "resShredAnemo"),
        ResShredGeo = Get(panel, "resShredGeo"),
        ResShredDendro = Get(panel, "resShredDendro"),
        ResShredPhysical = Get(panel, "resShredPhysical"),
    };

    private static double Get(IReadOnlyDictionary<string, double> panel, string key)
        => panel.TryGetValue(key, out var value) ? value : 0;
}

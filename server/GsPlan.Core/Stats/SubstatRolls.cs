namespace GsPlan.Core.Stats;

/// <summary>
/// Exact substat roll units, copied from <c>src/lib/substat-rolls.js</c>.
/// A roll is one of four tiers, so the top tier is <c>unit * 10</c>.
/// </summary>
public static class SubstatRolls
{
    public const int DefaultRarity = 5;
    public const double DefaultHitScale = 0.8;

    private static readonly Dictionary<int, Dictionary<string, double>> Units = new()
    {
        [5] = new(StringComparer.Ordinal)
        {
            ["hp"] = 29.875, ["atk"] = 1.945, ["def"] = 2.315,
            ["hpPct"] = 0.583, ["atkPct"] = 0.583, ["defPct"] = 0.729,
            ["em"] = 2.331, ["er"] = 0.648, ["critRate"] = 0.389, ["critDmg"] = 0.777,
        },
        [4] = new(StringComparer.Ordinal)
        {
            ["hp"] = 23.9, ["atk"] = 1.556, ["def"] = 1.852,
            ["hpPct"] = 0.466, ["atkPct"] = 0.466, ["defPct"] = 0.583,
            ["em"] = 1.865, ["er"] = 0.518, ["critRate"] = 0.311, ["critDmg"] = 0.622,
        },
        [3] = new(StringComparer.Ordinal)
        {
            ["hp"] = 14.34, ["atk"] = 0.934, ["def"] = 1.111,
            ["hpPct"] = 0.35, ["atkPct"] = 0.35, ["defPct"] = 0.437,
            ["em"] = 1.399, ["er"] = 0.389, ["critRate"] = 0.233, ["critDmg"] = 0.466,
        },
    };

    /// <summary>One roll's value: the top tier multiplied by the assumed scale.</summary>
    public static double HitValueOf(
        string key,
        double scale = DefaultHitScale,
        int rarity = DefaultRarity)
    {
        if (!Units.TryGetValue(rarity, out var units) || !units.TryGetValue(key, out var unit))
        {
            return 0;
        }
        return unit * 10 * scale;
    }
}

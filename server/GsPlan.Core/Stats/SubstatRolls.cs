namespace GsPlan.Core.Stats;

/// <summary>
/// Exact substat roll units, copied from <c>src/lib/substat-rolls.js</c>.
/// A roll is one of four tiers, so the top tier is <c>unit * 10</c>.
/// </summary>
public static class SubstatRolls
{
    public const int DefaultRarity = 5;
    public const double DefaultHitScale = 0.8;

    private static readonly Dictionary<int, int> MaxRolls = new()
    {
        [1] = 1, [2] = 3, [3] = 2, [4] = 4, [5] = 6,
    };

    private static readonly object LegalGate = new();
    private static readonly Dictionary<(int Rarity, string Key), double[]?> LegalCache = new();

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

    /// <summary>
    /// Every total a substat can show, ascending. Mirrors
    /// <c>legalTotals()</c> in <c>src/lib/substat-rolls.js</c>: a total is
    /// <c>unit * sum(tiers)</c>, with each tier in <c>{7,8,9,10}</c>, repeated
    /// up to the rarity's roll cap.
    /// </summary>
    public static IReadOnlyList<double>? LegalValues(string? key, int rarity = DefaultRarity)
    {
        if (string.IsNullOrEmpty(key)) return null;
        lock (LegalGate)
        {
            if (LegalCache.TryGetValue((rarity, key), out var cached)) return cached;
            if (!Units.TryGetValue(rarity, out var units) || !units.TryGetValue(key, out var unit))
            {
                LegalCache[(rarity, key)] = null;
                return null;
            }
            var values = new HashSet<double>();
            var tiers = new List<int>();
            var maxRolls = MaxRolls.GetValueOrDefault(rarity, 6);
            for (var rolls = 1; rolls <= maxRolls; rolls++)
            {
                Walk(0, rolls, tiers, unit, values);
            }
            var list = values.OrderBy(value => value).ToArray();
            LegalCache[(rarity, key)] = list;
            return list;
        }
    }

    private static void Walk(
        int start,
        int left,
        List<int> tiers,
        double unit,
        HashSet<double> values)
    {
        if (left == 0)
        {
            var sum = tiers.Sum(tier => tier);
            values.Add(Math.Floor(unit * sum * 1000 + 0.5) / 1000);
            return;
        }
        for (var tier = start; tier <= 3; tier++)
        {
            tiers.Add(7 + tier);
            Walk(tier, left - 1, tiers, unit, values);
            tiers.RemoveAt(tiers.Count - 1);
        }
    }
}

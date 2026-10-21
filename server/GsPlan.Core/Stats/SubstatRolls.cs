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
    private static readonly Dictionary<(int Rarity, string Key), IReadOnlyList<SubstatRollTotal>?> TotalCache = new();

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
        => Totals(key, rarity)?.Select(total => total.Value).ToArray();

    /// <summary>Every stat key the game can roll at this rarity, in table order.</summary>
    public static IReadOnlyList<string> KeysFor(int rarity = DefaultRarity)
        => Units.TryGetValue(rarity, out var units) ? units.Keys.ToArray() : [];

    /// <summary>
    /// Every reachable total and its exact tier decompositions, ascending.
    /// This is the shared implementation behind both the editor picker and the
    /// screenshot validator.
    /// </summary>
    public static IReadOnlyList<SubstatRollTotal>? Totals(string? key, int rarity = DefaultRarity)
    {
        if (string.IsNullOrEmpty(key)) return null;
        lock (LegalGate)
        {
            if (TotalCache.TryGetValue((rarity, key), out var cached)) return cached;
            if (!Units.TryGetValue(rarity, out var units) || !units.TryGetValue(key, out var unit))
            {
                TotalCache[(rarity, key)] = null;
                return null;
            }
            var maxRolls = MaxRolls.GetValueOrDefault(rarity, 6);
            var totals = BuildTotals(unit, maxRolls);
            TotalCache[(rarity, key)] = totals;
            return totals;
        }
    }

    /// <summary>The exact value of each of the four tiers, low tier first.</summary>
    public static IReadOnlyList<double>? TierValues(string? key, int rarity = DefaultRarity)
        => Units.TryGetValue(rarity, out var units) && !string.IsNullOrEmpty(key)
            && units.TryGetValue(key, out var unit)
            ? Enumerable.Range(0, 4).Select(tier => Round3(unit * (7 + tier))).ToArray()
            : null;

    public static int MaxRollsFor(int rarity = DefaultRarity)
        => MaxRolls.GetValueOrDefault(rarity, 6);

    private static IReadOnlyList<SubstatRollTotal> BuildTotals(double unit, int maxRolls)
    {
        var byM = new SortedDictionary<int, SubstatRollTotal>();
        var tiers = new List<int>();
        for (var rolls = 1; rolls <= maxRolls; rolls++)
        {
            WalkTotals(0, rolls, rolls, tiers, unit, byM);
        }
        return byM.Values.ToArray();
    }

    private static void WalkTotals(
        int start,
        int left,
        int totalRolls,
        List<int> tiers,
        double unit,
        SortedDictionary<int, SubstatRollTotal> byM)
    {
        if (left == 0)
        {
            var multiplier = tiers.Sum(tier => tier + 7);
            if (!byM.TryGetValue(multiplier, out var total))
            {
                total = new SubstatRollTotal
                {
                    M = multiplier,
                    Value = Round3(unit * multiplier),
                };
                byM[multiplier] = total;
            }
            total.Entries.Add(new SubstatRollWay
            {
                N = totalRolls,
                Tiers = tiers.Select(tier => tier + 1).ToList(),
            });
            return;
        }
        for (var tier = start; tier <= 3; tier++)
        {
            tiers.Add(tier);
            WalkTotals(tier, left - 1, totalRolls, tiers, unit, byM);
            tiers.RemoveAt(tiers.Count - 1);
        }
    }

    private static double Round3(double value)
        => Math.Floor(value * 1000 + 0.5) / 1000;
}

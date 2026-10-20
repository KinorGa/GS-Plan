using System.Text.Json;

namespace GsPlan.Core.Axis;

/// <summary>
/// Shared buff vocabulary from <c>src/components/buff-model.js</c>: which panel
/// field a buff feeds, which keys are neutral, and how custom zones compose.
/// </summary>
public static class BuffModel
{
    private static readonly Dictionary<string, string> KeyToStat = BuildKeyToStat();

    private static readonly HashSet<string> NeutralKeys = new(StringComparer.Ordinal)
    {
        "speed", "shieldStrength", "cdReduction", "staminaCost", "healBonus",
    };

    private static readonly HashSet<string> RawMultiplierKeys = new(StringComparer.Ordinal)
    {
        "aPower", "multZone",
    };

    private static readonly HashSet<string> ProductZoneKeys = new(StringComparer.Ordinal)
    {
        "multZone",
    };

    public static bool TryMapStat(string? key, out string stat)
    {
        stat = string.Empty;
        return key is not null && KeyToStat.TryGetValue(key, out stat!);
    }

    /// <summary>Fold every panel-shaped buff, each against its own owner scope.</summary>
    public static Dictionary<string, double> FoldDrops(
        IEnumerable<AxisDrop>? drops,
        Func<AxisDrop, IReadOnlyDictionary<string, double>?> scopeForOwner)
    {
        var totals = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var drop in drops ?? [])
        {
            var scope = scopeForOwner(drop);
            foreach (var buff in drop.Buffs ?? [])
            {
                if (!TryMapStat(buff.Key, out var stat)) continue;
                var value = FormulaEvaluator.NumericValue(buff.Value, scope);
                if (value == 0 || double.IsNaN(value)) continue;
                totals[stat] = totals.GetValueOrDefault(stat) + value;
            }
        }
        return totals;
    }

    /// <summary>Split custom zones into the coefficient factor and the final factor.</summary>
    public static (double Mult, double Zone) SplitZoneFactors(
        IEnumerable<AxisDrop>? drops,
        Func<AxisDrop, IReadOnlyDictionary<string, double>?> scopeForOwner)
    {
        var zones = FoldZoneDrops(drops, scopeForOwner);
        var multiplier = 1d;
        var rest = new List<CustomZone>();
        foreach (var zone in zones)
        {
            if (ProductZoneKeys.Contains(zone.Name)) multiplier *= zone.Value;
            else rest.Add(zone);
        }
        return (multiplier, CustomZoneMultiplier(rest));
    }

    private static List<CustomZone> FoldZoneDrops(
        IEnumerable<AxisDrop>? drops,
        Func<AxisDrop, IReadOnlyDictionary<string, double>?> scopeForOwner)
    {
        var byName = new Dictionary<string, CustomZone>(StringComparer.Ordinal);
        foreach (var drop in drops ?? [])
        {
            var scope = scopeForOwner(drop);
            foreach (var zone in FoldCustomZones(drop.Buffs, scope))
            {
                if (!byName.TryGetValue(zone.Name, out var current))
                {
                    byName[zone.Name] = zone;
                    continue;
                }
                if (ProductZoneKeys.Contains(zone.Name))
                {
                    current.Value *= zone.Value;
                    current.Count += zone.Count;
                }
                else
                {
                    current.Value += zone.Value;
                    current.Count += zone.Count;
                }
            }
        }
        return byName.Values.ToList();
    }

    private static List<CustomZone> FoldCustomZones(
        IEnumerable<AxisBuff>? buffs,
        IReadOnlyDictionary<string, double>? scope)
    {
        var byName = new Dictionary<string, CustomZone>(StringComparer.Ordinal);
        foreach (var buff in buffs ?? [])
        {
            var name = (buff.Key ?? string.Empty).Trim();
            if (name.Length == 0 || KeyToStat.ContainsKey(name) || NeutralKeys.Contains(name)) continue;
            var value = FormulaEvaluator.NumericValue(buff.Value, scope);
            if (value == 0 || double.IsNaN(value)) continue;
            var raw = RawMultiplierKeys.Contains(name);
            if (!byName.TryGetValue(name, out var current))
            {
                current = new CustomZone(name, value, 1, raw);
                byName[name] = current;
                continue;
            }
            current.Value = ProductZoneKeys.Contains(name) && current.Count > 0
                ? current.Value * value
                : current.Value + value;
            current.Count++;
        }
        return byName.Values.OrderBy(zone => zone.Name, StringComparer.Ordinal).ToList();
    }

    private static double CustomZoneMultiplier(IEnumerable<CustomZone> zones)
    {
        var raw = 1d;
        var percentage = 0d;
        foreach (var zone in zones)
        {
            if (zone.Raw) raw *= zone.Value;
            else percentage += zone.Value;
        }
        return (1 + percentage / 100) * raw;
    }

    private static Dictionary<string, string> BuildKeyToStat()
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["atk"] = "flatAtk",
            ["atkPct"] = "atkPct",
            ["hp"] = "flatHp",
            ["hpPct"] = "hpPct",
            ["def"] = "flatDef",
            ["defPct"] = "defPct",
            ["flatDmg"] = "flatDmg",
            ["em"] = "em",
            ["critRate"] = "critRate",
            ["critDmg"] = "critDmg",
            ["er"] = "er",
            ["dmgBonus"] = "dmgBonus",
            ["physBonus"] = "physBonus",
            ["reactionBonus"] = "reactionBonus",
            ["pyroDmg"] = "pyroDmg",
            ["hydroDmg"] = "hydroDmg",
            ["cryoDmg"] = "cryoDmg",
            ["electroDmg"] = "electroDmg",
            ["anemoDmg"] = "anemoDmg",
            ["geoDmg"] = "geoDmg",
            ["dendroDmg"] = "dendroDmg",
            ["resShred"] = "resShred",
            ["defShred"] = "defShred",
            ["defIgnore"] = "defIgnore",
            ["normalDmg"] = "dmgBonus",
            ["chargedDmg"] = "dmgBonus",
            ["plungeDmg"] = "dmgBonus",
            ["skillDmg"] = "dmgBonus",
            ["burstDmg"] = "dmgBonus",
            ["healBonus"] = "healBonus",
        };
        foreach (var suffix in new[]
        {
            "Pyro", "Hydro", "Cryo", "Electro", "Anemo", "Geo", "Dendro", "Physical",
        })
        {
            map[$"resShred{suffix}"] = $"resShred{suffix}";
        }
        return map;
    }

    private sealed class CustomZone(string name, double value, int count, bool raw)
    {
        public string Name { get; init; } = name;
        public double Value { get; set; } = value;
        public int Count { get; set; } = count;
        public bool Raw { get; init; } = raw;
    }
}

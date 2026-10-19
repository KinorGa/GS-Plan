using System.Text.RegularExpressions;

namespace GsPlan.Core.Stats;

/// <summary>
/// Authoritative 5-star artifact main-stat curves, copied from
/// <c>src/lib/artifact-curves.js</c>. Levels are +0..+20.
/// </summary>
public static partial class ArtifactCurves
{
    private static readonly Dictionary<string, double[]> PctCurves = new(StringComparer.Ordinal)
    {
        ["hpPct"] = [7.0, 9.0, 11.0, 12.9, 14.9, 16.9, 18.9, 20.9, 22.8, 24.8,
                     26.8, 28.8, 30.8, 32.8, 34.7, 36.7, 38.7, 40.7, 42.7, 44.6, 46.6],
        ["atkPct"] = [7.0, 9.0, 11.0, 12.9, 14.9, 16.9, 18.9, 20.9, 22.8, 24.8,
                      26.8, 28.8, 30.8, 32.8, 34.7, 36.7, 38.7, 40.7, 42.7, 44.6, 46.6],
        ["defPct"] = [8.7, 11.2, 13.7, 16.2, 18.6, 21.1, 23.6, 26.1, 28.6, 31.0,
                      33.5, 36.0, 38.5, 40.9, 43.4, 45.9, 48.4, 50.8, 53.3, 55.8, 58.3],
        ["er"] = [7.8, 10.0, 12.2, 14.4, 16.6, 18.8, 21.0, 23.2, 25.4, 27.6,
                  29.8, 32.0, 34.2, 36.4, 38.6, 40.8, 43.0, 45.2, 47.4, 49.6, 51.8],
        ["dmgBonus"] = [7.0, 9.0, 11.0, 12.9, 14.9, 16.9, 18.9, 20.9, 22.8, 24.8,
                        26.8, 28.8, 30.8, 32.8, 34.7, 36.7, 38.7, 40.7, 42.7, 44.6, 46.6],
        ["physBonus"] = [8.7, 11.2, 13.7, 16.2, 18.6, 21.1, 23.6, 26.1, 28.6, 31.0,
                         33.5, 36.0, 38.5, 40.9, 43.4, 45.9, 48.4, 50.8, 53.3, 55.8, 58.3],
        ["critRate"] = [4.7, 6.0, 7.3, 8.6, 9.9, 11.3, 12.6, 13.9, 15.2, 16.5,
                        17.9, 19.2, 20.5, 21.8, 23.2, 24.5, 25.8, 27.1, 28.4, 29.8, 31.1],
        ["critDmg"] = [9.3, 12.0, 14.6, 17.3, 19.9, 22.5, 25.2, 27.8, 30.5, 33.1,
                       35.7, 38.4, 41.0, 43.7, 46.3, 49.0, 51.6, 54.2, 56.9, 59.5, 62.2],
        ["healBonus"] = [5.4, 6.9, 8.4, 10.0, 11.5, 13.0, 14.5, 16.1, 17.6, 19.1,
                         20.6, 22.1, 23.7, 25.2, 26.7, 28.2, 29.8, 31.3, 32.8, 34.3, 35.9],
    };

    private static readonly Dictionary<string, double[]> FlatCurves = new(StringComparer.Ordinal)
    {
        ["hp"] = [717, 920, 1123, 1326, 1530, 1733, 1936, 2139, 2342, 2545,
                  2749, 2952, 3155, 3358, 3561, 3764, 3968, 4171, 4374, 4577, 4780],
        ["atk"] = [47, 60, 73, 86, 100, 113, 126, 139, 152, 166,
                   179, 192, 205, 218, 232, 245, 258, 271, 284, 298, 311],
        ["em"] = [28, 35.9, 43.8, 51.8, 59.7, 67.6, 75.5, 83.5, 91.4, 99.3,
                  107.2, 115.2, 123.1, 131, 138.9, 146.9, 154.8, 162.7, 170.6, 178.6, 186.5],
    };

    private static readonly Dictionary<string, (string Table, string Key)> CurveFor = new(StringComparer.Ordinal)
    {
        ["hp"] = ("flat", "hp"),
        ["atk"] = ("flat", "atk"),
        ["def"] = ("flat", "def"),
        ["em"] = ("flat", "em"),
        ["hpPct"] = ("pct", "hpPct"),
        ["atkPct"] = ("pct", "atkPct"),
        ["defPct"] = ("pct", "defPct"),
        ["er"] = ("pct", "er"),
        ["dmgBonus"] = ("pct", "dmgBonus"),
        ["physBonus"] = ("pct", "physBonus"),
        ["critRate"] = ("pct", "critRate"),
        ["critDmg"] = ("pct", "critDmg"),
        ["healBonus"] = ("pct", "healBonus"),
    };

    public static double? CurveValue(string? stat, double? level)
    {
        if (stat is null) return null;
        if (!CurveFor.TryGetValue(stat, out var spec))
        {
            if (!IsElementDmgKey(stat)) return null;
            spec = CurveFor["dmgBonus"];
        }

        var table = spec.Table == "flat" ? FlatCurves : PctCurves;
        if (!table.TryGetValue(spec.Key, out var row)) return null;
        var raw = level is null || double.IsNaN(level.Value) || level.Value == 0 ? 0 : level.Value;
        var lv = Math.Max(0, Math.Min(20, (int)Math.Floor(raw + 0.5)));
        return lv < row.Length ? row[lv] : null;
    }

    public static bool IsElementDmgKey(string? stat)
        => stat is not null && ElementDmgPattern().IsMatch(stat);

    [GeneratedRegex("^(?!crit)[a-z]+Dmg$", RegexOptions.CultureInvariant)]
    private static partial Regex ElementDmgPattern();
}

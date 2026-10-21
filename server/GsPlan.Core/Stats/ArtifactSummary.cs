using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace GsPlan.Core.Stats;

/// <summary>
/// Pure artifact rules shared by the summary panel and the optimiser plan.
/// Mirrors <c>src/lib/artifact-model.js</c>; no UI labels or catalogue data live
/// here, only game rules and the values they produce.
/// </summary>
public static partial class ArtifactSummary
{
    public const int SubCount = 4;
    public const int LevelMax = 20;

    public static readonly string[] SlotKeys = ArtifactModel.SlotKeys;
    public static readonly string[] SubStats = ArtifactModel.SubStatOrder;
    public static readonly string[] DmgElements = ArtifactModel.DmgElements;

    public static readonly string[] TotalOrder =
    [
        "hp", "atk", "def",
        "hpPct", "atkPct", "defPct",
        "em", "er", "critRate", "critDmg", "healBonus",
        .. DmgElements.Select(element => element + "Dmg"),
        "physBonus",
    ];

    public static ArtifactSummaryResult Compute(
        IReadOnlyDictionary<string, ArtifactPiece>? build)
    {
        var totals = new Dictionary<string, double>(StringComparer.Ordinal);
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        var bonuses = new List<ArtifactSetBonus>();

        void Bump(string? key, double? value)
        {
            if (string.IsNullOrEmpty(key) || value is null || !double.IsFinite(value.Value) || value.Value == 0) return;
            totals[key] = totals.GetValueOrDefault(key) + value.Value;
        }

        foreach (var slot in SlotKeys)
        {
            if (build is null || !build.TryGetValue(slot, out var piece) || piece is null) continue;

            if (!string.IsNullOrEmpty(piece.SetId))
            {
                counts[piece.SetId] = counts.GetValueOrDefault(piece.SetId) + 1;
            }

            if (!string.IsNullOrEmpty(piece.MainStat))
            {
                Bump(
                    piece.MainStat,
                    ArtifactCurves.CurveValue(piece.MainStat, piece.Level ?? LevelMax));
            }

            foreach (var sub in piece.SubStats ?? [])
            {
                if (sub is null || string.IsNullOrEmpty(sub.Key)) continue;
                Bump(sub.Key, SubValue(sub));
            }
        }

        foreach (var (setId, count) in counts)
        {
            if (count >= 2) bonuses.Add(new ArtifactSetBonus { SetId = setId, Pieces = 2 });
            if (count >= 4) bonuses.Add(new ArtifactSetBonus { SetId = setId, Pieces = 4 });
        }

        return new ArtifactSummaryResult
        {
            Totals = totals,
            Counts = counts,
            Bonuses = bonuses,
        };
    }

    /// <summary>
    /// A substat input as JS's <c>subValue</c> reads it. A partial string is
    /// preserved as null rather than silently becoming zero.
    /// </summary>
    public static double? SubValue(ArtifactSubStat? sub)
    {
        if (sub is null) return null;
        return ParseDisplayValue(sub.Value);
    }

    public static double? ParseDisplayValue(JsonElement value)
    {
        var text = value.ValueKind switch
        {
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.String => value.GetString() ?? string.Empty,
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null or JsonValueKind.Undefined => string.Empty,
            _ => value.GetRawText(),
        };

        var cleaned = NonNumericCharacters().Replace(text, string.Empty);
        var match = FloatPrefix().Match(cleaned);
        if (!match.Success) return null;
        return double.TryParse(match.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    public static bool HasWornSubstats(IReadOnlyDictionary<string, ArtifactPiece>? build)
        => SlotKeys.Any(slot =>
            build is not null
            && build.TryGetValue(slot, out var piece)
            && (piece.SubStats ?? []).Any(sub => sub is not null && !string.IsNullOrEmpty(sub.Key)));

    [GeneratedRegex("[^0-9.+-]", RegexOptions.CultureInvariant)]
    private static partial Regex NonNumericCharacters();

    [GeneratedRegex("^[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)", RegexOptions.CultureInvariant)]
    private static partial Regex FloatPrefix();
}

public sealed class ArtifactSummaryResult
{
    public Dictionary<string, double> Totals { get; init; } = new(StringComparer.Ordinal);
    public Dictionary<string, int> Counts { get; init; } = new(StringComparer.Ordinal);
    public List<ArtifactSetBonus> Bonuses { get; init; } = [];
}

public sealed class ArtifactSetBonus
{
    public string SetId { get; init; } = string.Empty;
    public int Pieces { get; init; }
}

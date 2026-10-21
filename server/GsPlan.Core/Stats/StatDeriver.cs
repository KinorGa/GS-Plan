using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace GsPlan.Core.Stats;

/// <summary>
/// Derives the stat panel from character + weapon + artifacts. Ported from
/// <c>src/lib/stat-derive.js</c>; the compact factor tables are preferred and the
/// rounded per-level detail rows are the fallback.
/// </summary>
public static partial class StatDeriver
{
    public const double BaseCritRate = 5;
    public const double BaseCritDmg = 50;
    public const double BaseEr = 100;

    public static readonly string[] DerivedKeys =
    [
        "hp", "atk", "def",
        "flatHp", "flatAtk", "flatDef",
        "hpPct", "atkPct", "defPct",
        "em", "critRate", "critDmg", "er",
        "pyroDmg", "hydroDmg", "cryoDmg", "electroDmg", "anemoDmg", "geoDmg", "dendroDmg",
        "dmgBonus", "physBonus",
        "healBonus",
    ];

    public static string NormaliseAscensionName(string? name)
    {
        var key = (name ?? string.Empty).Trim();
        switch (key)
        {
            case "EM": return "Elemental Mastery";
            case "ER": return "Energy Recharge%";
            case "Healing%": return "Healing Bonus%";
            case "Physical%": return "Physical DMG Bonus%";
        }

        var match = ShortElementPercent().Match(key);
        return match.Success ? $"{match.Groups[1].Value} DMG Bonus%" : key;
    }

    public static string? AscensionKeyToPanel(string? name)
    {
        var key = NormaliseAscensionName(name);
        switch (key)
        {
            case "CRIT DMG%": return "critDmg";
            case "CRIT Rate%": return "critRate";
            case "ATK%": return "atkPct";
            case "HP%": return "hpPct";
            case "DEF%": return "defPct";
            case "Elemental Mastery": return "em";
            case "Energy Recharge%": return "er";
            case "Physical DMG Bonus%": return "physBonus";
            case "Healing Bonus%": return "healBonus";
        }

        var match = ElementDmgBonus().Match(key);
        if (!match.Success) return null;
        var panelKey = match.Groups[1].Value.ToLowerInvariant() + "Dmg";
        return ArtifactModel.ElementOfDmgKey.Contains(panelKey) ? panelKey : null;
    }

    public static CharacterBaseStats? CharBaseAtLevel(JsonElement? detail, double level)
    {
        if (detail is not { ValueKind: JsonValueKind.Object } detailValue) return null;
        if (!detailValue.TryGetProperty("info", out var info) || info.ValueKind != JsonValueKind.Object) return null;
        if (!info.TryGetProperty("attributes", out var attributes) || attributes.ValueKind != JsonValueKind.Array) return null;
        if (attributes.GetArrayLength() == 0) return null;

        JsonElement? exact = null;
        JsonElement? lower = null;
        var lowerLevel = double.NegativeInfinity;
        foreach (var row in attributes.EnumerateArray())
        {
            var rowLevel = GetNumber(row, "level");
            if (rowLevel == level)
            {
                exact = row;
                break;
            }
            if (rowLevel <= level && (lower is null || rowLevel > lowerLevel))
            {
                lower = row;
                lowerLevel = rowLevel;
            }
        }

        var selected = exact ?? lower ?? attributes[0];
        var extras = new List<NamedValue>();
        foreach (var property in selected.EnumerateObject())
        {
            if (property.Name is "level" or "ascension" or "hp" or "atk" or "def") continue;
            extras.Add(new NamedValue { Name = property.Name, Value = JsNumberOrZero(property.Value) });
        }

        return new CharacterBaseStats
        {
            Level = GetNumber(selected, "level"),
            Hp = GetNumber(selected, "hp"),
            Atk = GetNumber(selected, "atk"),
            Def = GetNumber(selected, "def"),
            AscensionName = extras.Count > 0 ? extras[0].Name : null,
            AscensionValue = extras.Count > 0 ? extras[0].Value : 0,
            Innate = null,
            Extras = extras,
        };
    }

    public static DerivedPanel DerivePanel(DerivePanelInput input, StatsCompact? stats)
    {
        ArgumentNullException.ThrowIfNull(input);
        var values = DerivedKeys.ToDictionary(key => key, _ => 0d, StringComparer.Ordinal);
        var notes = new List<PanelNote>();

        var derived = input.CharId is not null && input.UseStats && stats is not null
            ? StatTables.CharStatsAt(stats, input.CharId, input.Level)
            : null;
        var character = derived ?? CharBaseAtLevel(input.Detail, input.Level);
        var precise = derived is not null;
        if (character is null)
        {
            notes.Add(new PanelNote { Kind = "no-stat-table" });
            return new DerivedPanel { Values = values, Notes = notes, Base = null, Precise = false };
        }
        if (!precise && input.CharId is not null && input.UseStats && stats is not null)
        {
            notes.Add(new PanelNote { Kind = "stat-fallback" });
        }

        var weaponStats = input.WeaponId is not null && input.UseStats && stats is not null
            ? StatTables.WeaponStatsAt(
                stats,
                input.WeaponId,
                StatTables.WeaponMaxLevel(stats, input.WeaponId) ?? 90)
            : null;
        var weaponAtk = weaponStats?.Atk ?? FallbackWeaponStat(input.Weapon, "atk");
        values["hp"] = character.Hp;
        values["atk"] = character.Atk + weaponAtk;
        values["def"] = character.Def;

        var extras = character.Extras.Count > 0
            ? character.Extras
            : character.AscensionName is not null
                ? [new NamedValue { Name = character.AscensionName, Value = character.AscensionValue }]
                : [];
        foreach (var extra in extras)
        {
            var panelKey = AscensionKeyToPanel(extra.Name);
            if (panelKey is not null && extra.Value != 0)
            {
                values[panelKey] += extra.Value;
            }
            else if (extra.Value != 0 && panelKey is null)
            {
                notes.Add(new PanelNote { Kind = "ascension-unmapped", Name = extra.Name });
            }
        }

        if (weaponStats is not null)
        {
            if (!string.IsNullOrEmpty(weaponStats.SubName) && weaponStats.SubValue != 0)
            {
                var panelKey = AscensionKeyToPanel(weaponStats.SubName);
                if (panelKey is not null) values[panelKey] += weaponStats.SubValue;
                else notes.Add(new PanelNote { Kind = "weapon-stat-unmapped", Name = weaponStats.SubName });
            }
        }
        else
        {
            foreach (var (name, raw) in FallbackWeaponStats(input.Weapon))
            {
                if (name == "atk") continue;
                var panelKey = AscensionKeyToPanel(name);
                var value = JsNumberOrZero(raw);
                if (panelKey is not null && value != 0) values[panelKey] += value;
                else if (value != 0) notes.Add(new PanelNote { Kind = "weapon-stat-unmapped", Name = name });
            }
        }

        var artifacts = ArtifactTotals(input.Artifacts);
        foreach (var (key, value) in artifacts.Flat)
        {
            values[key] = values.GetValueOrDefault(key) + value;
        }
        foreach (var (key, value) in artifacts.Pct)
        {
            values[key] = values.GetValueOrDefault(key) + value;
        }
        notes.AddRange(artifacts.Notes);

        values["critRate"] += BaseCritRate;
        values["critDmg"] += BaseCritDmg;
        values["er"] += BaseEr;

        return new DerivedPanel
        {
            Values = values,
            Notes = notes,
            Base = character,
            Precise = precise,
        };
    }

    public static ArtifactTotalsResult ArtifactTotals(Dictionary<string, ArtifactPiece>? artifacts)
    {
        var result = new ArtifactTotalsResult();

        void Add(string? panelKey, double? value)
        {
            if (string.IsNullOrEmpty(panelKey) || value is null) return;
            var number = value.Value;
            if (number == 0 || double.IsNaN(number)) return;
            var bucket = panelKey.StartsWith("flat", StringComparison.Ordinal)
                ? result.Flat
                : result.Pct;
            bucket[panelKey] = bucket.GetValueOrDefault(panelKey) + number;
        }

        foreach (var slot in ArtifactModel.SlotKeys)
        {
            if (artifacts is null || !artifacts.TryGetValue(slot, out var piece) || piece is null) continue;

            if (!string.IsNullOrEmpty(piece.MainStat))
            {
                Add(
                    ArtifactKeyToPanel(piece.MainStat),
                    ArtifactCurves.CurveValue(piece.MainStat, piece.Level ?? ArtifactModel.ArtifactLevelMax));
            }

            foreach (var sub in piece.SubStats ?? [])
            {
                if (sub is null || string.IsNullOrEmpty(sub.Key)) continue;
                var value = ParseSubstatValue(sub.Value);
                if (double.IsFinite(value)) Add(ArtifactKeyToPanel(sub.Key), value);
            }
        }

        return result;
    }

    public static string? ArtifactKeyToPanel(string? key)
    {
        switch (key)
        {
            case "hp": return "flatHp";
            case "atk": return "flatAtk";
            case "def": return "flatDef";
            case "healBonus": return "healBonus";
            case "physBonus": return "physBonus";
        }

        if (key is not null && ArtifactModel.ElementOfDmgKey.Contains(key)) return key;
        if (key is not null && ArtifactModel.SubStats.Contains(key)) return key;
        return null;
    }

    private static double ParseSubstatValue(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number) return value.GetDouble();
        var text = value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? string.Empty,
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null or JsonValueKind.Undefined => string.Empty,
            _ => value.GetRawText(),
        };
        var cleaned = NonNumericCharacters().Replace(text, string.Empty);
        var match = FloatPrefix().Match(cleaned);
        if (!match.Success) return double.NaN;
        return double.TryParse(match.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : double.NaN;
    }

    private static double FallbackWeaponStat(JsonElement? weapon, string name)
    {
        if (weapon is not { ValueKind: JsonValueKind.Object } weaponValue
            || !weaponValue.TryGetProperty("ascensionStats", out var stats)
            || stats.ValueKind != JsonValueKind.Object
            || !stats.TryGetProperty(name, out var value))
        {
            return 0;
        }
        return JsNumberOrZero(value);
    }

    private static List<KeyValuePair<string, JsonElement>> FallbackWeaponStats(JsonElement? weapon)
    {
        if (weapon is not { ValueKind: JsonValueKind.Object } weaponValue
            || !weaponValue.TryGetProperty("ascensionStats", out var stats)
            || stats.ValueKind != JsonValueKind.Object)
        {
            return [];
        }
        return stats.EnumerateObject()
            .Select(property => new KeyValuePair<string, JsonElement>(property.Name, property.Value))
            .ToList();
    }

    private static double GetNumber(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value)
            ? JsNumberOrZero(value)
            : 0;

    private static double JsNumberOrZero(JsonElement value)
    {
        var number = JsNumber(value);
        return double.IsNaN(number) ? 0 : number;
    }

    private static double JsNumber(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Number => value.GetDouble(),
        JsonValueKind.String => ParseJavaScriptNumber(value.GetString()),
        JsonValueKind.True => 1,
        JsonValueKind.False => 0,
        JsonValueKind.Null => 0,
        _ => double.NaN,
    };

    private static double ParseJavaScriptNumber(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return 0;
        return double.TryParse(text.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : double.NaN;
    }

    [GeneratedRegex("^(Anemo|Geo|Electro|Dendro|Hydro|Pyro|Cryo)%$", RegexOptions.CultureInvariant)]
    private static partial Regex ShortElementPercent();

    [GeneratedRegex("^([A-Za-z]+) DMG Bonus%$", RegexOptions.CultureInvariant)]
    private static partial Regex ElementDmgBonus();

    [GeneratedRegex("[^0-9.+-]", RegexOptions.CultureInvariant)]
    private static partial Regex NonNumericCharacters();

    [GeneratedRegex("^[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)", RegexOptions.CultureInvariant)]
    private static partial Regex FloatPrefix();
}

public sealed class ArtifactTotalsResult
{
    public Dictionary<string, double> Flat { get; } = new(StringComparer.Ordinal);
    public Dictionary<string, double> Pct { get; } = new(StringComparer.Ordinal);
    public List<PanelNote> Notes { get; } = [];
}

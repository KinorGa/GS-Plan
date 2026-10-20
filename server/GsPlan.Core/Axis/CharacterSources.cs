using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace GsPlan.Core.Axis;

public sealed class DamageSource
{
    public string Key { get; init; } = string.Empty;
    public string Kind { get; init; } = string.Empty;
    public string? Element { get; init; }
    public List<DamageStageData> Stages { get; init; } = [];
}

public sealed class DamageStageData
{
    public double Mult { get; init; }
    public double Hits { get; init; }
    public string? Basis { get; init; }
    public List<DamageMultiplierPart>? Parts { get; init; }
}

public sealed class DamageMultiplierPart
{
    public double Mult { get; init; }
    public double Hits { get; init; }
    public int PartIndex { get; init; }
}

/// <summary>
/// Builds the talent-source table from a character detail file. Ported from
/// <c>src/char-sources.js</c>, including its deliberate data quirks.
/// </summary>
public static partial class CharacterSources
{
    private static readonly (string Key, string Kind)[] SkillOrder =
    [
        ("normalattack", "normal"),
        ("elementalskill", "skill"),
        ("elementalburst", "burst"),
    ];

    private static readonly string[] FlatDamageTypes =
        ["Pyro", "Hydro", "Cryo", "Electro", "Anemo", "Geo", "Dendro", "Physical"];

    public static List<DamageSource> BuildSources(
        JsonElement detail,
        string? element,
        JsonElement? talentDamage,
        string? charId,
        IReadOnlyDictionary<string, int>? talentLevels)
    {
        if (detail.ValueKind != JsonValueKind.Object
            || !detail.TryGetProperty("skills", out var skills)
            || skills.ValueKind != JsonValueKind.Object)
        {
            return [];
        }

        var sources = BuildActiveSources(detail, skills, element, talentLevels);
        sources.AddRange(BuildTalentDamageSources(detail, element, talentDamage, charId));
        sources.AddRange(FlatDamageSources());
        return sources;
    }

    private static List<DamageSource> BuildActiveSources(
        JsonElement detail,
        JsonElement skills,
        string? element,
        IReadOnlyDictionary<string, int>? talentLevels)
    {
        var sources = new List<DamageSource>();
        foreach (var (key, kind) in SkillOrder)
        {
            if (!skills.TryGetProperty(key, out var skill)
                || skill.ValueKind != JsonValueKind.Object
                || !skill.TryGetProperty("multipliers", out var multipliers)
                || multipliers.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var level = talentLevels is not null && talentLevels.TryGetValue(kind, out var configured)
                ? configured
                : 10;
            var stages = new List<DamageStageData>();
            foreach (var property in multipliers.EnumerateObject())
            {
                var raw = MultiplierAt(property.Value, level);
                var terms = ParseMultiplierParts(raw);
                if (terms.Count == 0) continue;

                var namedHits = terms.Count == 1 && NamedThreeHit().IsMatch(property.Name) ? 2 : 1;
                var hits = namedHits * terms[0].Hits;

                var expanded = terms.Count == 1
                    ? Enumerable.Range(0, hits).Select(_ => (Mult: terms[0].Mult, Hits: 1d)).ToList()
                    : terms.SelectMany(term => Enumerable.Range(0, term.Hits)
                        .Select(_ => (Mult: term.Mult, Hits: 1d))).ToList();

                stages.Add(new DamageStageData
                {
                    Mult = terms[0].Mult,
                    Hits = hits,
                    Parts = expanded.Count > 1
                        ? expanded.Select((part, index) => new DamageMultiplierPart
                        {
                            Mult = part.Mult,
                            Hits = part.Hits,
                            PartIndex = index,
                        }).ToList()
                        : null,
                });
            }

            if (stages.Count == 0) continue;
            sources.Add(new DamageSource
            {
                Key = key,
                Kind = kind,
                Element = kind == "normal" ? NormalAttackElement(detail, element) : element,
                Stages = stages,
            });
        }
        return sources;
    }

    private static IEnumerable<DamageSource> BuildTalentDamageSources(
        JsonElement detail,
        string? element,
        JsonElement? talentDamage,
        string? charId)
    {
        if (talentDamage is not { ValueKind: JsonValueKind.Object } table
            || string.IsNullOrEmpty(charId)
            || !table.TryGetProperty("characters", out var characters)
            || characters.ValueKind != JsonValueKind.Object
            || !characters.TryGetProperty(charId, out var entries)
            || entries.ValueKind != JsonValueKind.Object)
        {
            yield break;
        }

        detail.TryGetProperty("constellations", out var constellations);
        detail.TryGetProperty("passives", out var passives);
        foreach (var property in entries.EnumerateObject().OrderBy(item => item.Name, StringComparer.Ordinal))
        {
            var entry = property.Value;
            if (entry.ValueKind != JsonValueKind.Object
                || !entry.TryGetProperty("damage", out var damage)
                || damage.ValueKind != JsonValueKind.True)
            {
                continue;
            }

            if (!entry.TryGetProperty("mult", out var multElement)
                || !TryJavaScriptNumber(multElement, out var mult)
                || !double.IsFinite(mult)
                || mult <= 0)
            {
                continue;
            }

            var slot = ParseSlot(property.Name);
            var sourceData = slot.Kind == "constellation"
                ? constellations.ValueKind == JsonValueKind.Object && constellations.TryGetProperty(slot.ConstKey!, out var constellation)
                    ? constellation
                    : default
                : passives.ValueKind == JsonValueKind.Object && passives.TryGetProperty(property.Name, out var passive)
                    ? passive
                    : default;

            var configuredElement = entry.TryGetProperty("element", out var elementValue)
                && elementValue.ValueKind == JsonValueKind.String
                ? elementValue.GetString()
                : null;
            var basis = entry.TryGetProperty("basis", out var basisValue)
                && basisValue.ValueKind == JsonValueKind.String
                ? basisValue.GetString()
                : null;
            var hits = entry.TryGetProperty("hits", out var hitsValue)
                && hitsValue.ValueKind == JsonValueKind.Number
                && hitsValue.TryGetDouble(out var hitNumber)
                && double.IsFinite(hitNumber)
                && hitNumber > 0
                && Math.Truncate(hitNumber) == hitNumber
                ? hitNumber
                : 1;

            _ = sourceData; // Names/icons are display-only and not needed by the formula.
            yield return new DamageSource
            {
                Key = property.Name,
                Kind = slot.Kind,
                Element = FirstNonEmpty(configuredElement, element),
                Stages =
                [
                    new DamageStageData
                    {
                        Mult = mult,
                        Hits = hits,
                        Basis = string.IsNullOrEmpty(basis) ? null : basis,
                        Parts = null,
                    },
                ],
            };
        }
    }

    private static IEnumerable<DamageSource> FlatDamageSources()
    {
        foreach (var type in FlatDamageTypes)
        {
            yield return new DamageSource
            {
                Key = "flatdmg-" + type.ToLowerInvariant(),
                Kind = "flat",
                Element = type,
                Stages =
                [
                    new DamageStageData { Mult = 1, Hits = 1, Parts = null },
                ],
            };
        }
    }

    private static string? NormalAttackElement(JsonElement detail, string? element)
    {
        var weapon = detail.ValueKind == JsonValueKind.Object
            && detail.TryGetProperty("info", out var info)
            && info.ValueKind == JsonValueKind.Object
            && info.TryGetProperty("weaponType", out var infoWeapon)
            && infoWeapon.ValueKind == JsonValueKind.String
                ? infoWeapon.GetString()
                : detail.ValueKind == JsonValueKind.Object
                    && detail.TryGetProperty("weaponType", out var rootWeapon)
                    && rootWeapon.ValueKind == JsonValueKind.String
                        ? rootWeapon.GetString()
                        : null;
        if (weapon == "WEAPON_CATALYST") return element;

        var text = string.Join(' ', new[]
        {
            SkillDescription(detail, "normalattack"),
            SkillDescription(detail, "elementalskill"),
        }.Where(value => !string.IsNullOrEmpty(value)));
        return InfusingTalents().IsMatch(text) ? element : "Physical";
    }

    private static string? SkillDescription(JsonElement detail, string skillKey)
    {
        if (detail.ValueKind != JsonValueKind.Object
            || !detail.TryGetProperty("skills", out var skills)
            || skills.ValueKind != JsonValueKind.Object
            || !skills.TryGetProperty(skillKey, out var skill)
            || skill.ValueKind != JsonValueKind.Object
            || !skill.TryGetProperty("description", out var description)
            || description.ValueKind != JsonValueKind.String)
        {
            return null;
        }
        return description.GetString();
    }

    private static string? MultiplierAt(JsonElement values, int level)
    {
        if (values.ValueKind != JsonValueKind.Array)
        {
            return values.ValueKind == JsonValueKind.String ? values.GetString() : null;
        }
        var count = values.GetArrayLength();
        if (count == 0) return null;
        var index = Math.Min(Math.Max(level, 1), count) - 1;
        var selected = values[index];
        return selected.ValueKind == JsonValueKind.String ? selected.GetString() : null;
    }

    private static List<(double Mult, int Hits)> ParseMultiplierParts(string? raw)
    {
        var parts = new List<(double Mult, int Hits)>();
        foreach (var term in (raw ?? string.Empty).Split('+'))
        {
            var match = MultiplierTerm().Match(term);
            if (!match.Success) continue;
            if (!double.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var percent))
            {
                continue;
            }
            var mult = percent / 100;
            if (mult == 0 || !double.IsFinite(mult)) continue;
            var hits = 1;
            if (match.Groups[2].Success
                && int.TryParse(match.Groups[2].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedHits))
            {
                hits = Math.Max(1, parsedHits);
            }
            parts.Add((mult, hits));
        }
        return parts;
    }

    private static (string Kind, string? ConstKey) ParseSlot(string slot)
    {
        var match = ConstellationSlot().Match(slot);
        return match.Success
            ? ("constellation", "const" + match.Groups[1].Value)
            : ("passive", null);
    }

    private static bool TryJavaScriptNumber(JsonElement value, out double number)
    {
        number = double.NaN;
        switch (value.ValueKind)
        {
            case JsonValueKind.Number:
                return value.TryGetDouble(out number);
            case JsonValueKind.String:
                return double.TryParse(
                    (value.GetString() ?? string.Empty).Trim(),
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out number);
            case JsonValueKind.True:
                number = 1;
                return true;
            case JsonValueKind.False:
            case JsonValueKind.Null:
                number = 0;
                return true;
            default:
                return false;
        }
    }

    private static string? FirstNonEmpty(string? first, string? second)
        => !string.IsNullOrEmpty(first) ? first : !string.IsNullOrEmpty(second) ? second : null;

    [GeneratedRegex("三段|3", RegexOptions.CultureInvariant)]
    private static partial Regex NamedThreeHit();

    [GeneratedRegex("彼岸蝶舞|诺艾尔|护心铠|千岩牢固|破魔|Ley Line|神里流·霰步|冰华|焰硝|赤团开时|Elemental Infusion", RegexOptions.CultureInvariant)]
    private static partial Regex InfusingTalents();

    [GeneratedRegex("(-?\\d+(?:\\.\\d+)?)\\s*%\\s*(?:\\*\\s*(\\d+))?", RegexOptions.CultureInvariant)]
    private static partial Regex MultiplierTerm();

    [GeneratedRegex("^const([1-9])$", RegexOptions.CultureInvariant)]
    private static partial Regex ConstellationSlot();
}

using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GsPlan.Core.Gcsim;

public sealed class GcsimCatalogues
{
    public required JsonElement Characters { get; init; }
    public required JsonElement Weapons { get; init; }
    public required JsonElement Artifacts { get; init; }
}

public sealed class GcsimImportException : Exception
{
    public GcsimImportException(string message) : base(message)
    {
    }
}

/// <summary>
/// JavaScript-shaped helpers shared by the gcsim port. The importer was written
/// against JSON's own coercions, so the port keeps those rules explicit rather
/// than inheriting C#'s stricter conversions by accident.
/// </summary>
public static class GcsimSupport
{
    public static bool Truthy(JsonElement? value)
    {
        if (value is null) return false;
        return value.Value.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => false,
            JsonValueKind.False => false,
            JsonValueKind.True => true,
            JsonValueKind.Number => value.Value.TryGetDouble(out var number) && number != 0 && !double.IsNaN(number),
            JsonValueKind.String => !string.IsNullOrEmpty(value.Value.GetString()),
            _ => true,
        };
    }

    public static double Number(JsonElement? value)
    {
        if (value is null) return double.NaN;
        switch (value.Value.ValueKind)
        {
            case JsonValueKind.Number:
                return value.Value.TryGetDouble(out var number) ? number : double.NaN;
            case JsonValueKind.String:
                var text = (value.Value.GetString() ?? string.Empty).Trim();
                if (text.Length == 0) return 0;
                return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
                    ? parsed
                    : double.NaN;
            case JsonValueKind.True:
                return 1;
            case JsonValueKind.False:
            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
                return 0;
            default:
                return double.NaN;
        }
    }

    public static double Number(JsonNode? value) => Number(Element(value));

    public static JsonElement? Element(JsonNode? node)
    {
        if (node is null) return null;
        using var document = JsonDocument.Parse(node.ToJsonString());
        return document.RootElement.Clone();
    }

    public static double NumberOrZero(JsonElement? value)
    {
        var number = Number(value);
        return double.IsFinite(number) ? number : 0;
    }

    public static string? Text(JsonElement? value)
        => value is { ValueKind: JsonValueKind.String } ? value.Value.GetString() : null;

    public static string TemplateText(JsonElement? value)
    {
        if (value is null) return "undefined";
        return value.Value.ValueKind switch
        {
            JsonValueKind.String => value.Value.GetString() ?? string.Empty,
            JsonValueKind.Number => value.Value.TryGetDouble(out var number)
                ? NumberText(number)
                : value.Value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null or JsonValueKind.Undefined => "null",
            _ => value.Value.GetRawText(),
        };
    }

    public static string NumberText(double number)
        => number.ToString("R", CultureInfo.InvariantCulture);

    public static double Round6(double number)
    {
        if (!double.IsFinite(number)) return number;
        return Math.Floor(number * 1e6 + 0.5) / 1e6;
    }

    public static double JsRound(double number)
        => Math.Floor(number + 0.5);

    public static string Capitalise(string? value)
        => string.IsNullOrEmpty(value) ? string.Empty : char.ToUpperInvariant(value[0]) + value[1..];

    public static string NormaliseName(string? value)
    {
        var text = (value ?? string.Empty).ToLowerInvariant();
        var chars = new char[text.Length];
        var length = 0;
        foreach (var ch in text)
        {
            if ((ch is >= 'a' and <= 'z') || (ch is >= '0' and <= '9')) chars[length++] = ch;
        }
        return new string(chars, 0, length);
    }

    public static string? ResolveByName(string? name, JsonElement? catalogue, JsonElement? overrides = null)
    {
        if (overrides is { ValueKind: JsonValueKind.Object } overrideObject
            && !string.IsNullOrEmpty(name)
            && overrideObject.TryGetProperty(name, out var overrideValue)
            && Truthy(overrideValue))
        {
            return StringValue(overrideValue);
        }

        var target = NormaliseName(name);
        if (target.Length == 0) return null;
        if (catalogue is not { ValueKind: JsonValueKind.Object } table) return null;
        foreach (var property in table.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.Object
                && property.Value.TryGetProperty("enName", out var enName)
                && NormaliseName(Text(enName)) == target)
            {
                return property.Name;
            }
        }
        return null;
    }

    public static string StringValue(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? string.Empty,
            JsonValueKind.Number => value.TryGetDouble(out var number) ? NumberText(number) : value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null => "null",
            _ => value.GetRawText(),
        };
    }

    public static string? CatalogueId(string id, JsonElement entry)
    {
        if (entry.ValueKind == JsonValueKind.Object
            && entry.TryGetProperty("setId", out var setId)
            && setId.ValueKind != JsonValueKind.Null
            && setId.ValueKind != JsonValueKind.Undefined)
        {
            return StringValue(setId);
        }
        return id;
    }

    public static JsonElement? Property(JsonElement? value, string name)
        => value is { ValueKind: JsonValueKind.Object } objectValue
            && objectValue.TryGetProperty(name, out var property)
                ? property
                : null;

    public static JsonObject? AsObject(JsonElement? value)
    {
        if (value is not { ValueKind: JsonValueKind.Object } objectValue) return null;
        var result = new JsonObject();
        foreach (var property in objectValue.EnumerateObject())
        {
            result[property.Name] = JsonNode.Parse(property.Value.GetRawText());
        }
        return result;
    }

    public static JsonArray? AsArray(JsonElement? value)
    {
        if (value is not { ValueKind: JsonValueKind.Array } arrayValue) return null;
        var result = new JsonArray();
        foreach (var item in arrayValue.EnumerateArray())
        {
            result.Add(JsonNode.Parse(item.GetRawText()));
        }
        return result;
    }

    public static JsonNode? CloneNode(JsonElement? value)
        => value is null ? null : JsonNode.Parse(value.Value.GetRawText());

    public static JsonObject JsonObjectOf(params (string Key, JsonNode? Value)[] values)
    {
        var result = new JsonObject();
        foreach (var (key, value) in values) result[key] = value;
        return result;
    }

    public static JsonNode? NumberNode(double value)
        => double.IsFinite(value) ? JsonValue.Create(value) : null;
}

/// <summary>
/// The identity half of <c>src/lib/buff-sources.js</c>: the source keys gcsim's
/// status table addresses, with the same names, icons and owner as the planner's
/// own pool. Values are deliberately not copied from the library; the log is the
/// only source of the numbers a hit carried.
/// </summary>
public static class GcsimSourceIndex
{
    private static readonly (string Kind, string Field, string CardKind, string Chs, string En, string Icon)[] Skills =
    [
        ("attack", "normalattack", "normal", "普通攻击", "Normal Attack", "Skill_A_04"),
        ("skill", "elementalskill", "skill", "元素战技", "Elemental Skill", "Skill_E_04"),
        ("burst", "elementalburst", "burst", "元素爆发", "Elemental Burst", "Skill_S_04"),
    ];

    public static Dictionary<string, JsonObject> Build(
        JsonObject team,
        GcsimCatalogues catalogues,
        IReadOnlyDictionary<string, JsonElement> charData,
        IReadOnlyDictionary<string, JsonElement> setBonuses)
    {
        var result = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        var setMap = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var (id, bonuses) in setBonuses) setMap[id] = bonuses;

        if (team["units"] is not JsonArray units) return result;
        foreach (var unitNode in units)
        {
            if (unitNode is not JsonObject unit) continue;
            var charId = unit["char"]?["id"]?.GetValue<string>();
            if (string.IsNullOrEmpty(charId)) continue;
            charData.TryGetValue(charId, out var detail);
            var charEntry = TryProperty(catalogues.Characters, charId);
            var owner = Owner(charId, unit["id"]?.GetValue<string>(), charEntry);
            var add = (string kind, string? icon, string? iconKind, string rank, string? chs, string? en, string libKey) =>
            {
                if (result.ContainsKey(libKey)) return;
                var name = new JsonObject
                {
                    ["chs"] = chs,
                    ["en"] = en,
                };
                result[libKey] = new JsonObject
                {
                    ["kind"] = kind,
                    ["icon"] = icon,
                    ["iconKind"] = iconKind,
                    ["rank"] = rank,
                    ["name"] = name,
                    ["owner"] = owner.DeepClone(),
                    ["libKey"] = libKey,
                };
            };

            var talents = unit["char"]?["talents"];
            foreach (var skill in Skills)
            {
                var skillNode = detail.ValueKind == JsonValueKind.Object
                    && detail.TryGetProperty("skills", out var skills)
                    && skills.ValueKind == JsonValueKind.Object
                    && skills.TryGetProperty(skill.Field, out var row)
                        ? row
                        : (JsonElement?)null;
                var name = GcsimSupport.Text(GcsimSupport.Property(skillNode, "name"));
                var icon = GcsimSupport.Text(GcsimSupport.Property(skillNode, "icon")) ?? skill.Icon;
                var levelKey = skill.Kind == "attack" ? "normal" : skill.Kind;
                var level = talents?[levelKey] is JsonValue levelValue && levelValue.TryGetValue<double>(out var number)
                    ? GcsimSupport.NumberText(number)
                    : "1";
                add(
                    skill.CardKind,
                    icon,
                    "skill",
                    "Lv" + level,
                    string.IsNullOrEmpty(name) ? skill.Chs : name,
                    string.IsNullOrEmpty(name) ? skill.En : name,
                    $"talent:{charId}:{skill.CardKind}");
            }

            if (detail.ValueKind == JsonValueKind.Object
                && detail.TryGetProperty("passives", out var passives)
                && passives.ValueKind == JsonValueKind.Object)
            {
                foreach (var passive in passives.EnumerateObject().OrderBy(item => item.Name, StringComparer.Ordinal))
                {
                    if (!GcsimSupport.Truthy(passive.Value)) continue;
                    var name = GcsimSupport.Text(GcsimSupport.Property(passive.Value, "name"));
                    var icon = GcsimSupport.Text(GcsimSupport.Property(passive.Value, "icon"));
                    add(
                        "talent",
                        icon,
                        "talent",
                        string.Empty,
                        string.IsNullOrEmpty(name) ? $"固有天赋 {passive.Name}" : name,
                        string.IsNullOrEmpty(name) ? $"Passive {passive.Name}" : name,
                        $"talent:{charId}:{passive.Name}");
                }
            }

            var unlocked = Math.Max(0, Math.Min(6, (int)Math.Truncate(GcsimSupport.Number(unit["char"]?["constellation"]))));
            if (detail.ValueKind == JsonValueKind.Object
                && detail.TryGetProperty("constellations", out var constellations)
                && constellations.ValueKind == JsonValueKind.Object)
            {
                for (var n = 1; n <= unlocked; n++)
                {
                    var key = "const" + n;
                    if (!constellations.TryGetProperty(key, out var constellation)
                        || !GcsimSupport.Truthy(constellation))
                    {
                        continue;
                    }
                    var name = GcsimSupport.Text(GcsimSupport.Property(constellation, "name"));
                    var icon = GcsimSupport.Text(GcsimSupport.Property(constellation, "icon"));
                    add(
                        "constellation",
                        icon,
                        "talent",
                        "C" + n,
                        string.IsNullOrEmpty(name) ? $"命之座 {n}" : name,
                        string.IsNullOrEmpty(name) ? $"Constellation {n}" : name,
                        $"constellation:{charId}:c{n}");
                }
            }

            var weaponId = unit["weapon"]?["id"]?.GetValue<string>();
            if (!string.IsNullOrEmpty(weaponId))
            {
                var weapon = TryProperty(catalogues.Weapons, weaponId);
                var refine = Math.Max(1, Math.Min(5, (int)GcsimSupport.JsRound(GcsimSupport.Number(unit["weapon"]?["refine"]) is var r && double.IsFinite(r) ? r : 1)));
                add(
                    "weapon",
                    GcsimSupport.Text(GcsimSupport.Property(weapon, "weaponIcon")),
                    "weapon",
                    "R" + refine,
                    GcsimSupport.Text(GcsimSupport.Property(weapon, "chsName")),
                    GcsimSupport.Text(GcsimSupport.Property(weapon, "enName")),
                    $"weapon:{weaponId}:r{refine}");
            }

            var equipped = ActiveSlots(unit);
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            var order = new List<string>();
            foreach (var slot in Core.Stats.ArtifactModel.SlotKeys)
            {
                var setId = equipped?[slot]?["setId"]?.GetValue<string>();
                if (string.IsNullOrEmpty(setId)) continue;
                if (!counts.ContainsKey(setId))
                {
                    counts[setId] = 0;
                    order.Add(setId);
                }
                counts[setId] += 1;
            }
            foreach (var setId in order)
            {
                if (!setMap.TryGetValue(setId, out var bonuses)) continue;
                var meta = TryProperty(catalogues.Artifacts, setId);
                if (meta is null) continue;
                var chsName = GcsimSupport.Text(GcsimSupport.Property(meta, "chsName"));
                var enName = GcsimSupport.Text(GcsimSupport.Property(meta, "enName"));
                var setIcon = GcsimSupport.Text(GcsimSupport.Property(meta, "setIcon"));
                foreach (var pieces in new[] { 2, 4 })
                {
                    if (counts[setId] < pieces) continue;
                    add(
                        "artifact" + pieces,
                        setIcon,
                        "artifact",
                        pieces + "pc",
                        $"{chsName} · {pieces}件套",
                        $"{enName} {pieces}-Pc",
                        $"artifact:{setId}:{pieces}");
                }
            }
        }
        return result;
    }

    private static JsonObject Owner(string charId, string? unitId, JsonElement? charEntry)
    {
        var chsName = GcsimSupport.Text(GcsimSupport.Property(charEntry, "chsName"));
        var enName = GcsimSupport.Text(GcsimSupport.Property(charEntry, "enName"));
        return new JsonObject
        {
            ["id"] = charId,
            ["unitId"] = unitId,
            ["name"] = !string.IsNullOrEmpty(chsName) && !string.IsNullOrEmpty(enName)
                ? $"{chsName} / {enName}"
                : charId,
            ["element"] = GcsimSupport.Text(GcsimSupport.Property(charEntry, "element")),
        };
    }

    private static JsonObject? ActiveSlots(JsonObject unit)
    {
        var artifacts = unit["artifacts"] as JsonObject;
        if (artifacts?["sets"] is JsonArray sets && sets.Count > 0)
        {
            var active = artifacts["active"]?.GetValue<string>();
            var found = sets.FirstOrDefault(set => set is JsonObject obj
                && obj["id"]?.GetValue<string>() == active) as JsonObject
                ?? sets[0] as JsonObject;
            return found?["slots"] as JsonObject;
        }
        return artifacts;
    }

    private static JsonElement? TryProperty(JsonElement table, string id)
        => table.ValueKind == JsonValueKind.Object && table.TryGetProperty(id, out var entry)
            ? entry
            : null;
}

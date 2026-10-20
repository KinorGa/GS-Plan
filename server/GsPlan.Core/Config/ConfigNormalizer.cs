using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GsPlan.Core.Config;

/// <summary>
/// The rules a configuration document is repaired through before or after it
/// crosses the file boundary. This is the C# counterpart of team-model.js,
/// axes-store.js, artifact-sets.js and the normalising half of config-file.js.
/// </summary>
public static class ConfigNormalizer
{
    public const int TeamVersion = 1;
    public const int AxesVersion = 2;

    private static readonly string[] SlotKeys = ["flower", "plume", "sands", "goblet", "circlet"];
    private static readonly string[] DamageTypes = ["pyro", "hydro", "cryo", "electro", "anemo", "geo", "dendro", "physical"];
    private static readonly Dictionary<string, string> ScalingBasis = new(StringComparer.Ordinal)
    {
        ["atk"] = "atk", ["attack"] = "atk", ["攻击力"] = "atk",
        ["hp"] = "hp", ["health"] = "hp", ["生命值"] = "hp",
        ["def"] = "def", ["defense"] = "def", ["防御力"] = "def",
        ["em"] = "em", ["mastery"] = "em", ["元素精通"] = "em",
    };

    private static readonly JsonSerializerOptions CompactJson = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static JsonObject NormalizeTeam(JsonNode? raw)
    {
        var source = raw as JsonObject;
        var team = CopyObject(source);
        var units = new JsonArray();

        if (source?["units"] is JsonArray rawUnits)
        {
            for (var i = 0; i < rawUnits.Count; i++)
            {
                units.Add(NormalizeUnit(rawUnits[i], i));
            }
        }

        team["version"] = TeamVersion;
        team["units"] = units;
        return team;
    }

    private static JsonObject NormalizeUnit(JsonNode? raw, int index)
    {
        var unit = BlankUnit();
        if (raw is JsonObject source) CopyInto(unit, source);

        var rawUnit = raw as JsonObject;
        unit["id"] = Truthy(rawUnit?["id"]) ? Clone(rawUnit!["id"]) : $"u{index + 1}";
        unit["char"] = NormalizeCharacter(rawUnit?["char"]);
        unit["weapon"] = NormalizeWeapon(rawUnit?["weapon"]);
        unit["artifacts"] = NormalizeArtifacts(rawUnit?["artifacts"]);
        return unit;
    }

    private static JsonObject BlankUnit() => new()
    {
        ["id"] = null,
        ["char"] = new JsonObject
        {
            ["id"] = null,
            ["level"] = 90,
            ["constellation"] = 0,
            ["talents"] = new JsonObject { ["normal"] = 1, ["skill"] = 1, ["burst"] = 1 },
        },
        ["weapon"] = new JsonObject { ["id"] = null, ["refine"] = 1 },
        ["artifacts"] = BlankArtifacts(),
    };

    private static JsonObject NormalizeCharacter(JsonNode? raw)
    {
        var character = new JsonObject
        {
            ["id"] = null,
            ["level"] = 90,
            ["constellation"] = 0,
            ["talents"] = new JsonObject { ["normal"] = 1, ["skill"] = 1, ["burst"] = 1 },
        };
        if (raw is JsonObject source) CopyInto(character, source);

        var input = raw as JsonObject;
        character["level"] = Clamp(input?["level"], 90, 1, 100);
        character["constellation"] = Clamp(input?["constellation"], 0, 0, 6);

        var talents = new JsonObject { ["normal"] = 1, ["skill"] = 1, ["burst"] = 1 };
        if (input?["talents"] is JsonObject rawTalents) CopyInto(talents, rawTalents);
        talents["normal"] = Clamp(input?["talents"]?["normal"], 1, 1, 15);
        talents["skill"] = Clamp(input?["talents"]?["skill"], 1, 1, 15);
        talents["burst"] = Clamp(input?["talents"]?["burst"], 1, 1, 15);
        character["talents"] = talents;
        return character;
    }

    private static JsonObject NormalizeWeapon(JsonNode? raw)
    {
        var weapon = new JsonObject { ["id"] = null, ["refine"] = 1 };
        if (raw is JsonObject source) CopyInto(weapon, source);
        return weapon;
    }

    public static JsonObject NormalizeArtifacts(JsonNode? raw)
    {
        var source = raw as JsonObject;
        var sets = new JsonArray();

        if (source?["sets"] is JsonArray rawSets && rawSets.Count > 0)
        {
            for (var i = 0; i < rawSets.Count; i++)
            {
                var entry = rawSets[i] as JsonObject;
                var id = entry?["id"] is JsonValue idValue
                    && idValue.TryGetValue<string>(out var text) && !string.IsNullOrEmpty(text)
                    ? text
                    : $"a{i + 1}";
                var name = entry?["name"] is JsonValue nameValue
                    && nameValue.TryGetValue<string>(out var nameText)
                    ? nameText
                    : null;
                sets.Add(new JsonObject
                {
                    ["id"] = id,
                    ["name"] = name,
                    ["slots"] = NormalizeSlots(entry?["slots"]),
                });
            }
        }
        else if (LooksLikeBuild(source))
        {
            var name = source?["name"] is JsonValue nameValue
                && nameValue.TryGetValue<string>(out var nameText)
                ? nameText
                : null;
            sets.Add(new JsonObject
            {
                ["id"] = "a1",
                ["name"] = name,
                ["slots"] = NormalizeSlots(source),
            });
        }
        else
        {
            sets.Add(new JsonObject { ["id"] = "a1", ["name"] = null, ["slots"] = BlankSet() });
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in sets)
        {
            var set = (JsonObject)node!;
            var baseId = (string)set["id"]!;
            var id = baseId;
            var suffix = 1;
            while (!seen.Add(id)) id = $"{baseId}-{suffix++}";
            set["id"] = id;
        }

        var active = source?["active"] is JsonValue activeValue
            && activeValue.TryGetValue<string>(out var activeText)
            && seen.Contains(activeText)
            ? activeText
            : (string)sets[0]!["id"]!;

        return new JsonObject { ["active"] = active, ["sets"] = sets };
    }

    private static bool LooksLikeBuild(JsonObject? raw) =>
        raw is not null && SlotKeys.Any(raw.ContainsKey);

    private static JsonObject NormalizeSlots(JsonNode? raw)
    {
        var slots = BlankSet();
        var source = raw as JsonObject;
        foreach (var key in SlotKeys)
        {
            if (source?[key] is JsonObject piece)
            {
                var merged = BlankPiece();
                CopyInto(merged, piece);
                slots[key] = merged;
            }
        }
        return slots;
    }

    private static JsonObject BlankSet()
    {
        var set = new JsonObject();
        foreach (var key in SlotKeys) set[key] = BlankPiece();
        return set;
    }

    private static JsonObject BlankPiece() => new()
    {
        ["setId"] = null,
        ["mainStat"] = null,
        ["level"] = 0,
        ["subStats"] = new JsonArray(null, null, null, null),
    };

    private static JsonObject BlankArtifacts() => new()
    {
        ["active"] = "a1",
        ["sets"] = new JsonArray(new JsonObject { ["id"] = "a1", ["name"] = null, ["slots"] = BlankSet() }),
    };

    public static JsonObject NormalizeAxes(JsonNode? raw)
    {
        var axes = new JsonArray();
        JsonNode? activeId = null;

        if (raw is JsonArray list)
        {
            axes.Add(new JsonObject
            {
                ["id"] = "ax1",
                ["name"] = "",
                ["entries"] = RepairEntries(list),
            });
        }
        else if (raw is JsonObject state)
        {
            if (state["axes"] is JsonArray axisList)
            {
                for (var i = 0; i < axisList.Count; i++) axes.Add(RepairAxis(axisList[i], i));
            }
            else if (state["entries"] is JsonArray entries)
            {
                axes.Add(new JsonObject
                {
                    ["id"] = "ax1",
                    ["name"] = "",
                    ["entries"] = RepairEntries(entries),
                });
            }
            activeId = Truthy(state["activeId"]) ? Clone(state["activeId"]) : null;
        }

        if (axes.Count == 0)
        {
            axes.Add(new JsonObject { ["id"] = "ax1", ["name"] = "", ["entries"] = new JsonArray() });
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var processed = new JsonArray();
        foreach (var node in axes)
        {
            var axis = (JsonObject)node!.DeepClone();
            var id = (string)axis["id"]!;
            if (string.IsNullOrEmpty(id) || seen.Contains(id))
            {
                id = NextAxisId(processed);
                axis["id"] = id;
            }
            seen.Add(id);
            processed.Add(axis);
        }

        var activeText = activeId is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
        if (activeText is null || !seen.Contains(activeText)) activeText = (string)processed[0]!["id"]!;

        return new JsonObject
        {
            ["version"] = AxesVersion,
            ["axes"] = processed,
            ["activeId"] = activeText,
        };
    }

    private static JsonObject RepairAxis(JsonNode? raw, int index)
    {
        var axis = raw is JsonObject source ? CopyObject(source) : new JsonObject();
        var input = raw as JsonObject;
        axis["id"] = Truthy(input?["id"]) ? JsString(input!["id"]) : $"ax{index + 1}";
        axis["name"] = input?["name"] is JsonValue value && value.TryGetValue<string>(out var name) ? name : "";
        axis["entries"] = RepairEntries(input?["entries"] as JsonArray);
        return axis;
    }

    private static JsonArray RepairEntries(JsonArray? list, int depth = 0)
    {
        var entries = new JsonArray();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        if (list is null) return entries;

        foreach (var node in list)
        {
            if (node is not JsonObject entry) continue;
            var id = JsString(Truthy(entry["id"]) ? entry["id"] : null);
            if (string.IsNullOrEmpty(id) || seen.Contains(id)) id = NextEntryId(entries);
            seen.Add(id);

            if (JsString(entry["kind"]) == "segment" && depth > 0)
            {
                var flattened = RepairEntries(entry["children"] as JsonArray, depth);
                foreach (var child in flattened.ToList())
                {
                    flattened.Remove(child);
                    entries.Add(child);
                }
                continue;
            }

            if (JsString(entry["kind"]) == "segment")
            {
                var segmentChildren = RepairEntries(entry["children"] as JsonArray, depth + 1);
                if (segmentChildren.Count == 0) continue;
                entries.Add(new JsonObject
                {
                    ["id"] = id,
                    ["kind"] = "segment",
                    ["name"] = JsString(Truthy(entry["name"]) ? entry["name"] : null),
                    ["children"] = segmentChildren,
                    ["expanded"] = false,
                });
                continue;
            }

            var repaired = CopyObject(entry);
            repaired["id"] = id;
            repaired["charId"] = Truthy(entry["charId"]) ? Clone(entry["charId"]) : "none";
            if (entry.ContainsKey("scalingBasis") && entry["scalingBasis"] is not null)
            {
                repaired["scalingBasis"] = NormalizeScalingBasis(entry["scalingBasis"]);
            }

            var drops = new JsonArray();
            if (entry["drops"] is JsonArray rawDrops)
            {
                foreach (var drop in rawDrops)
                {
                    if (drop is JsonObject dropObject && Truthy(dropObject["source"])) drops.Add(Clone(dropObject));
                }
            }
            repaired["drops"] = drops;
            repaired["statOverrides"] = RepairOverrides(entry["statOverrides"]);
            repaired["summary"] = Truthy(entry["summary"]) ? Clone(entry["summary"]) : null;

            var children = RepairChildren(entry["children"] as JsonArray);
            if (children is not null) repaired["children"] = children;
            repaired["expanded"] = false;
            entries.Add(repaired);
        }
        return entries;
    }

    private static JsonArray? RepairChildren(JsonArray? list)
    {
        if (list is null || list.Count == 0) return null;
        var seen = new HashSet<long>();
        var children = new List<(double Part, JsonObject Node)>();

        foreach (var node in list)
        {
            if (node is not JsonObject child) continue;
            var number = JsNumber(child["partIndex"]);
            if (!double.IsFinite(number) || Math.Floor(number) != number || number < 0) continue;
            var part = (long)number;
            if (!seen.Add(part)) continue;

            var repaired = CopyObject(child);
            repaired["id"] = Truthy(child["id"]) ? JsString(child["id"]) : $"p{part}";
            repaired["partIndex"] = part;
            if (child.ContainsKey("scalingBasis") && child["scalingBasis"] is not null)
            {
                repaired["scalingBasis"] = NormalizeScalingBasis(child["scalingBasis"]);
            }
            repaired["element"] = Truthy(child["element"]) ? Clone(child["element"]) : null;

            var drops = new JsonArray();
            if (child["drops"] is JsonArray rawDrops)
            {
                foreach (var drop in rawDrops)
                {
                    if (drop is JsonObject dropObject && Truthy(dropObject["source"])) drops.Add(Clone(dropObject));
                }
            }
            repaired["drops"] = drops;
            repaired["statOverrides"] = RepairOverrides(child["statOverrides"]);
            repaired["expanded"] = false;
            children.Add((number, repaired));
        }

        if (children.Count == 0) return null;
        children.Sort((a, b) => a.Part.CompareTo(b.Part));
        var output = new JsonArray();
        foreach (var child in children) output.Add(child.Node);
        return output;
    }

    private static JsonNode RepairOverrides(JsonNode? raw)
    {
        if (raw is not JsonObject source || !source.ContainsKey("enemyRes"))
        {
            return Truthy(raw) ? Clone(raw)! : new JsonObject();
        }

        var overrides = new JsonObject();
        foreach (var pair in source)
        {
            if (pair.Key != "enemyRes") overrides[pair.Key] = Clone(pair.Value);
        }

        var legacy = JsNumber(source["enemyRes"]);
        if (double.IsFinite(legacy))
        {
            foreach (var type in DamageTypes)
            {
                var key = $"enemyRes{char.ToUpperInvariant(type[0])}{type[1..]}";
                if (!overrides.ContainsKey(key)) overrides[key] = legacy;
            }
        }
        return overrides;
    }

    private static string NextAxisId(JsonArray axes) => $"ax{NextSuffix(axes, "ax") + 1}";

    private static string NextEntryId(JsonArray entries) => $"e{NextSuffix(entries, "e") + 1}";

    private static int NextSuffix(JsonArray list, string prefix)
    {
        var highest = 0;
        foreach (var node in list)
        {
            var id = node is JsonObject item ? JsString(item["id"]) : "";
            var raw = id.StartsWith(prefix, StringComparison.Ordinal) ? id[prefix.Length..] : id;
            if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
                && double.IsFinite(number) && number > highest)
            {
                highest = (int)number;
            }
        }
        return highest;
    }

    private static string NormalizeScalingBasis(JsonNode? value)
    {
        if (value is not JsonValue node || !node.TryGetValue<string>(out var text)) return "atk";
        var trimmed = text.Trim();
        if (ScalingBasis.TryGetValue(trimmed.ToLowerInvariant(), out var lower)) return lower;
        return ScalingBasis.TryGetValue(trimmed, out var exact) ? exact : "atk";
    }

    private static int Clamp(JsonNode? value, int fallback, int min, int max)
    {
        var number = JsNumber(value);
        if (!double.IsFinite(number)) return fallback;
        return Math.Min(max, Math.Max(min, (int)Math.Floor(number + 0.5)));
    }

    public static string JsString(JsonNode? node)
    {
        if (node is null) return "null";
        if (node is JsonArray array) return string.Join(",", array.Select(JsString));
        if (node is JsonObject) return "[object Object]";
        if (node is JsonValue value)
        {
            if (value.TryGetValue<string>(out var text)) return text;
            if (value.TryGetValue<bool>(out var flag)) return flag ? "true" : "false";
        }
        return node.ToJsonString(CompactJson);
    }

    public static double JsNumber(JsonNode? node)
    {
        if (node is null) return 0;
        if (node is JsonValue value)
        {
            if (value.TryGetValue<double>(out var number)) return number;
            if (value.TryGetValue<bool>(out var flag)) return flag ? 1 : 0;
            if (value.TryGetValue<string>(out var text))
            {
                var trimmed = text.Trim();
                if (trimmed.Length == 0) return 0;
                if (double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)) return parsed;
            }
        }
        return double.NaN;
    }

    public static bool Truthy(JsonNode? node)
    {
        if (node is null) return false;
        if (node is JsonArray or JsonObject) return true;
        if (node is JsonValue value)
        {
            if (value.TryGetValue<bool>(out var flag)) return flag;
            if (value.TryGetValue<string>(out var text)) return text.Length > 0;
            if (value.TryGetValue<double>(out var number)) return number != 0 && !double.IsNaN(number);
        }
        return true;
    }

    public static JsonNode? Clone(JsonNode? node) => node?.DeepClone();

    public static JsonObject CopyObject(JsonObject? source)
    {
        var output = new JsonObject();
        if (source is not null) CopyInto(output, source);
        return output;
    }

    public static void CopyInto(JsonObject target, JsonObject source)
    {
        foreach (var pair in source) target[pair.Key] = Clone(pair.Value);
    }
}

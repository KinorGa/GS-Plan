using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using GsPlan.Core.Stats;

namespace GsPlan.Core.Artifacts;

/// <summary>
/// A model reply that cannot be read as artifacts. Mirrors the errors thrown by
/// <c>parseScanResponse</c> in <c>src/lib/artifact-scan.js</c>.
/// </summary>
public sealed class ArtifactScanException(string message) : Exception(message);

/// <summary>One artifact set as the scan matcher needs it.</summary>
public sealed class ArtifactSetInfo
{
    public required string Id { get; init; }
    public required string ChsName { get; init; }
    public required string EnName { get; init; }
    public required string QualityType { get; init; }
    public required string SetIcon { get; init; }
    public required Dictionary<string, string> Pieces { get; init; }
}

public sealed record ArtifactScanCatalogue(
    IReadOnlyList<ArtifactSetInfo> List,
    IReadOnlyDictionary<string, ArtifactSetInfo> ById);

/// <summary>
/// The pure half of screenshot recognition: the model returns words, this class
/// maps them to the artifact keys the planner stores. Ported from
/// <c>src/lib/artifact-scan.js</c> so a server can produce the same review rows
/// as the browser fallback.
/// </summary>
public static partial class ArtifactScan
{
    private const int SubCount = 4;

    private static readonly string[][] SlotAliases =
    [
        ["生之花", "flower", "花"],
        ["死之羽", "plume", "羽"],
        ["时之沙", "sands", "沙"],
        ["空之杯", "goblet", "杯"],
        ["理之冠", "circlet", "冠"],
    ];

    private static readonly Dictionary<string, string[]> MainStats = new(StringComparer.Ordinal)
    {
        ["flower"] = ["hp"],
        ["plume"] = ["atk"],
        ["sands"] = ["hpPct", "atkPct", "defPct", "em", "er"],
        ["goblet"] =
        [
            "hpPct", "atkPct", "defPct", "em",
            "pyroDmg", "hydroDmg", "cryoDmg", "electroDmg", "anemoDmg", "geoDmg", "dendroDmg",
            "physBonus",
        ],
        ["circlet"] = ["hpPct", "atkPct", "defPct", "em", "critRate", "critDmg", "healBonus"],
    };

    private static readonly HashSet<string> PercentStats = new(StringComparer.Ordinal)
    {
        "hpPct", "atkPct", "defPct", "er", "critRate", "critDmg", "healBonus",
        "dmgBonus", "physBonus", "pyroDmg", "hydroDmg", "cryoDmg", "electroDmg",
        "anemoDmg", "geoDmg", "dendroDmg",
    };

    private static readonly Dictionary<string, string> ElementChars = new(StringComparer.Ordinal)
    {
        ["pyro"] = "火", ["hydro"] = "水", ["cryo"] = "冰", ["electro"] = "雷",
        ["anemo"] = "风", ["geo"] = "岩", ["dendro"] = "草",
    };

    private static readonly IReadOnlyList<(string Alias, string Key)> StatAliases = BuildStatAliases();

    /// <summary>Read the set index and whatever per-set detail files are available.</summary>
    public static ArtifactScanCatalogue BuildCatalogue(
        JsonElement index,
        Func<string, JsonElement?> detailOf)
    {
        var byId = new Dictionary<string, ArtifactSetInfo>(StringComparer.Ordinal);
        if (index.ValueKind != JsonValueKind.Object) return new ArtifactScanCatalogue([], byId);

        foreach (var property in index.EnumerateObject())
        {
            var meta = property.Value;
            var pieces = new Dictionary<string, string>(StringComparer.Ordinal);
            var detail = detailOf(property.Name);
            if (detail is { ValueKind: JsonValueKind.Object }
                && Property(detail, "info") is { ValueKind: JsonValueKind.Object } info
                && Property(info, "pieces") is { ValueKind: JsonValueKind.Object } pieceObject)
            {
                foreach (var piece in pieceObject.EnumerateObject())
                {
                    var name = Text(Property(piece.Value, "name"));
                    if (name.Length > 0) pieces[piece.Name] = name;
                }
            }

            byId[property.Name] = new ArtifactSetInfo
            {
                Id = property.Name,
                ChsName = Text(Property(meta, "chsName")),
                EnName = Text(Property(meta, "enName")),
                QualityType = Text(Property(meta, "qualityType")),
                SetIcon = Text(Property(meta, "setIcon")),
                Pieces = pieces,
            };
        }

        var list = byId.Values
            .Where(set => !IsPlaceholder(set))
            .OrderBy(set => set.QualityType == "QUALITY_ORANGE" ? 0 : 1)
            .ThenBy(set => set.EnName, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        return new ArtifactScanCatalogue(list, byId);
    }

    /// <summary>The JSON array in a model reply, tolerant of fences and prose.</summary>
    public static JsonElement ParseResponse(string? reply)
    {
        var source = reply ?? string.Empty;
        var fenced = FenceRegex().Match(source);
        if (fenced.Success) source = fenced.Groups[1].Value;
        var start = source.IndexOfAny(['{', '[']);
        if (start < 0) throw new ArtifactScanException("模型返回里找不到 JSON");
        var close = source[start] == '{' ? '}' : ']';
        var end = source.LastIndexOf(close);
        if (end <= start) throw new ArtifactScanException("模型返回里找不到 JSON");
        var json = source[start..(end + 1)];

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(json);
        }
        catch (JsonException ex)
        {
            throw new ArtifactScanException($"模型返回的 JSON 解析失败：{ex.Message}");
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.Array) return root.Clone();
            if (root.ValueKind == JsonValueKind.Object)
            {
                foreach (var name in new[] { "pieces", "artifacts", "items" })
                {
                    if (Property(root, name) is { } pieces
                        && pieces.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined)
                    {
                        if (pieces.ValueKind != JsonValueKind.Array)
                        {
                            throw new ArtifactScanException("模型返回里没有 pieces 数组");
                        }
                        return pieces.Clone();
                    }
                }
            }
        }
        throw new ArtifactScanException("模型返回里没有 pieces 数组");
    }

    /// <summary>Map a parsed <c>pieces</c> array to the review rows the panel edits.</summary>
    public static List<JsonObject> BuildRows(
        JsonElement pieces,
        ArtifactScanCatalogue catalogue)
    {
        var rows = new List<JsonObject>();
        if (pieces.ValueKind != JsonValueKind.Array) return rows;
        var index = 0;
        foreach (var raw in pieces.EnumerateArray())
        {
            rows.Add(ScanRow(raw, index, catalogue.List));
            index += 1;
        }
        return rows;
    }

    public static string? MatchSlot(string? raw)
    {
        var normalized = Normalize(raw);
        if (normalized.Length == 0) return null;
        for (var i = 0; i < ArtifactModel.SlotKeys.Length; i++)
        {
            var aliases = SlotAliases[i].OrderByDescending(alias => alias.Length);
            if (aliases.Any(alias => normalized.Contains(alias, StringComparison.Ordinal)))
            {
                return ArtifactModel.SlotKeys[i];
            }
        }
        return null;
    }

    public static List<string> StatCandidates(string? rawName)
    {
        var name = Normalize(StripMarkers(rawName));
        if (name.Length == 0) return [];
        var hit = StatAliases.FirstOrDefault(alias => name.Contains(alias.Alias, StringComparison.Ordinal));
        if (hit.Key is null) return [];
        if (hit.Key is "hp" or "atk" or "def")
        {
            var percent = hit.Key + "Pct";
            return HasPercent(rawName) ? [percent, hit.Key] : [hit.Key, percent];
        }
        return [hit.Key];
    }

    public static bool IsPercentStat(string? key) => key is not null && PercentStats.Contains(key);

    public static double? DisplayOf(string? key, double? value)
    {
        if (value is null || double.IsNaN(value.Value)) return null;
        return IsPercentStat(key)
            ? Math.Floor(value.Value * 10 + 0.5) / 10
            : Math.Floor(value.Value + 0.5);
    }

    public static double? MatchDisplayed(string? key, int rarity, double? value)
    {
        var shown = DisplayOf(key, value);
        if (shown is null || value is null) return null;
        var legal = SubstatRolls.LegalValues(key, rarity);
        if (legal is null) return null;
        double? best = null;
        foreach (var candidate in legal)
        {
            if (Math.Abs(DisplayOf(key, candidate)!.Value - shown.Value) > 1e-9) continue;
            if (best is null || Math.Abs(candidate - value.Value) < Math.Abs(best.Value - value.Value))
            {
                best = candidate;
            }
        }
        return best;
    }

    public static bool IsLegalDisplay(string? key, int rarity, double? value)
        => MatchDisplayed(key, rarity, value) is not null;

    public static (string? Key, bool Ambiguous) ResolveMainStat(string? rawName, string? slotKey)
    {
        var keys = StatCandidates(rawName);
        if (keys.Count == 0) return (null, false);
        if (keys.Count == 1) return (keys[0], false);
        var pool = slotKey is not null ? MainStats.GetValueOrDefault(slotKey) ?? [] : [];
        var allowed = keys.Where(key => pool.Contains(key, StringComparer.Ordinal)).ToArray();
        if (allowed.Length >= 1) return (allowed[0], false);
        return (keys[0], true);
    }

    public static (string? Key, bool Ambiguous) ResolveSubstat(
        string? rawName,
        double? value,
        int rarity = SubstatRolls.DefaultRarity)
    {
        var keys = StatCandidates(rawName);
        if (keys.Count == 0) return (null, false);
        if (keys.Count == 1) return (keys[0], false);
        var legal = keys.FirstOrDefault(key => IsLegalDisplay(key, rarity, value));
        if (legal is not null) return (legal, false);
        return (keys[0], true);
    }

    public static (ArtifactSetInfo? Set, string Match) MatchSetByName(
        string? raw,
        IReadOnlyList<ArtifactSetInfo> list)
    {
        var needle = StripSetWords(raw);
        if (needle.Length == 0) return (null, "none");
        var named = list.Select(set => (
            Set: set,
            Names: new[] { StripSetWords(set.ChsName), StripSetWords(set.EnName) }
                .Where(name => name.Length > 0).ToArray()
        )).ToArray();

        var exact = named.FirstOrDefault(item => item.Names.Contains(needle, StringComparer.Ordinal));
        if (exact.Set is not null) return (exact.Set, "exact");

        var partial = named.Where(item => item.Names.Any(name =>
            name.Contains(needle, StringComparison.Ordinal)
            || needle.Contains(name, StringComparison.Ordinal))).ToArray();
        if (partial.Length == 1) return (partial[0].Set, "fuzzy");

        ArtifactSetInfo? best = null;
        var score = 0d;
        foreach (var item in named)
        {
            foreach (var name in item.Names)
            {
                var distance = Similarity(needle, name);
                if (distance > score)
                {
                    score = distance;
                    best = item.Set;
                }
            }
        }
        return score >= 0.6 ? (best, "fuzzy") : (null, "none");
    }

    public static (ArtifactSetInfo? Set, string Match) MatchSetByPiece(
        string? pieceName,
        IReadOnlyList<ArtifactSetInfo> list,
        string? slotKey = null)
    {
        var needle = Normalize(pieceName);
        if (needle.Length == 0) return (null, "none");
        var slots = slotKey is not null ? [slotKey] : ArtifactModel.SlotKeys;
        string[] NamesOf(ArtifactSetInfo set) => slots
            .Select(slot => set.Pieces.GetValueOrDefault(slot))
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => Normalize(name))
            .ToArray();

        var exact = list.FirstOrDefault(set => NamesOf(set).Contains(needle, StringComparer.Ordinal));
        if (exact is not null) return (exact, "exact");
        var loose = list.FirstOrDefault(set => NamesOf(set).Any(name =>
            name.Contains(needle, StringComparison.Ordinal)
            || needle.Contains(name, StringComparison.Ordinal)));
        return loose is not null ? (loose, "fuzzy") : (null, "none");
    }

    public static (ArtifactSetInfo? Set, string Match, string? By) ResolveSet(
        string? setRaw,
        string? pieceRaw,
        string? slotKey,
        IReadOnlyList<ArtifactSetInfo> list)
    {
        var byName = MatchSetByName(setRaw, list);
        if (byName.Set is not null) return (byName.Set, byName.Match, "set");
        var byPiece = MatchSetByPiece(pieceRaw, list, slotKey);
        if (byPiece.Set is not null) return (byPiece.Set, byPiece.Match, "piece");
        return (null, "none", null);
    }

    private static JsonObject ScanRow(
        JsonElement raw,
        int index,
        IReadOnlyList<ArtifactSetInfo> list)
    {
        var slotRaw = Text(Property(raw, "slot") ?? Property(raw, "position") ?? Property(raw, "part"));
        var slotKey = MatchSlot(slotRaw);
        var setRaw = Text(Property(raw, "set") ?? Property(raw, "setName"));
        var pieceRaw = Text(Property(raw, "pieceName") ?? Property(raw, "piece") ?? Property(raw, "name"));
        var level = NormLevel(Property(raw, "level") ?? Property(raw, "lv")) ?? 0;

        var main = Property(raw, "main");
        var mainRaw = Text(Property(main, "name") ?? Property(main, "key") ?? Property(raw, "mainStat"));
        var mainValue = Number(Property(main, "value") ?? Property(raw, "mainValue"));

        var (set, setMatch, setBy) = ResolveSet(setRaw, pieceRaw, slotKey, list);
        var rarity = RarityOf(set?.QualityType);
        var (mainStat, mainAmbiguous) = ResolveMainStat(mainRaw, slotKey);
        var mainExpected = mainStat is not null ? ArtifactModel.MainStatValue(mainStat, level) : null;

        JsonElement? said = null;
        foreach (var name in new[] { "subs", "subStats", "substats" })
        {
            if (Property(raw, name) is { ValueKind: JsonValueKind.Array } array)
            {
                said = array;
                break;
            }
        }

        var subStats = new List<JsonObject>();
        var saidLength = said is { ValueKind: JsonValueKind.Array } ? said.Value.GetArrayLength() : 0;
        for (var i = 0; i < Math.Min(SubCount, saidLength); i++)
        {
            var sub = said!.Value[i];
            var name = Text(Property(sub, "name") ?? Property(sub, "key"));
            var value = Number(Property(sub, "value"));
            var (key, ambiguous) = ResolveSubstat(name, value, rarity);
            var exact = key is not null ? MatchDisplayed(key, rarity, value) : null;
            subStats.Add(new JsonObject
            {
                ["key"] = key,
                ["value"] = exact ?? value,
                ["typed"] = value is null ? string.Empty : FormatNumber(value.Value),
                ["raw"] = name,
                ["exact"] = exact,
                ["legal"] = key is null ? null : exact is not null,
                ["ambiguous"] = ambiguous,
            });
        }
        while (subStats.Count < SubCount)
        {
            subStats.Add(new JsonObject
            {
                ["key"] = null,
                ["value"] = null,
                ["typed"] = string.Empty,
                ["raw"] = string.Empty,
                ["exact"] = null,
                ["legal"] = null,
                ["ambiguous"] = false,
            });
        }

        var issues = new List<string>();
        if (slotKey is null)
        {
            issues.Add(slotRaw.Length > 0 ? $"部位没认出（“{slotRaw}”）" : "没读到部位");
        }
        if (set is null)
        {
            issues.Add(setRaw.Length > 0 || pieceRaw.Length > 0
                ? $"套装没认出（“{(setRaw.Length > 0 ? setRaw : pieceRaw)}”）"
                : "没读到套装");
        }
        if (mainStat is null) issues.Add("主词条没认出");
        else if (slotKey is not null
            && !(MainStats.GetValueOrDefault(slotKey) ?? []).Contains(mainStat, StringComparer.Ordinal))
        {
            issues.Add("主词条不属于这个部位");
        }
        if (mainStat is not null && mainValue is not null && mainExpected is not null
            && Math.Abs(DisplayOf(mainStat, mainValue)!.Value - mainExpected.Value) > 1e-9)
        {
            issues.Add($"主词条数值和等级对不上（图上 {FormatNumber(mainValue.Value)}，+{level} 应为 {FormatNumber(mainExpected.Value)}）");
        }
        if (mainAmbiguous) issues.Add("主词条有歧义（固定值 / 百分比）");
        if (subStats.Any(sub => NodeText(sub["raw"]).Length > 0 && sub["key"] is null))
        {
            issues.Add("有副词条没认出词条名");
        }
        if (subStats.Any(sub => sub["key"] is not null && TryBool(sub["legal"], out var legal) && !legal))
        {
            issues.Add("有副词条不是合法强化值");
        }
        if (subStats.Any(sub => TryBool(sub["ambiguous"], out var ambiguous) && ambiguous
            && NodeText(sub["raw"]).Length > 0))
        {
            issues.Add("有副词条词条名有歧义（按数值推断）");
        }

        var issuesNode = new JsonArray();
        foreach (var issue in issues) issuesNode.Add(issue);
        var subNode = new JsonArray();
        foreach (var sub in subStats) subNode.Add(sub);
        return new JsonObject
        {
            ["id"] = $"scan-{index}",
            ["include"] = slotKey is not null && mainStat is not null,
            ["slotKey"] = slotKey,
            ["slotRaw"] = slotRaw,
            ["setId"] = set?.Id,
            ["setMatch"] = setMatch,
            ["setBy"] = setBy,
            ["setRaw"] = setRaw,
            ["pieceRaw"] = pieceRaw,
            ["rarity"] = rarity,
            ["level"] = level,
            ["mainStat"] = mainStat,
            ["mainRaw"] = mainRaw,
            ["mainValue"] = mainValue,
            ["mainExpected"] = mainExpected,
            ["subStats"] = subNode,
            ["issues"] = issuesNode,
        };
    }

    private static int RarityOf(string? qualityType) => qualityType switch
    {
        "QUALITY_ORANGE" => 5,
        "QUALITY_PURPLE" => 4,
        "QUALITY_BLUE" => 3,
        "QUALITY_GREEN" => 2,
        _ => SubstatRolls.DefaultRarity,
    };

    private static double? NormLevel(JsonElement? value)
    {
        var number = Number(value);
        if (number is null) return null;
        return Math.Max(0, Math.Min(20, Math.Floor(number.Value + 0.5)));
    }

    private static string Normalize(string? value) => PunctuationRegex().Replace(
        WhitespaceRegex().Replace(Text(value), string.Empty),
        string.Empty).ToLowerInvariant();

    private static string StripMarkers(string? value)
        => MarkerRegex().Replace(Text(value), string.Empty).Trim();

    private static string StripSetWords(string? value) => DigitsRegex().Replace(
        SetWordsRegex().Replace(
            BracketedRegex().Replace(Normalize(value), string.Empty),
            string.Empty),
        string.Empty);

    private static bool HasPercent(string? raw)
        => raw is not null && PercentRegex().IsMatch(Text(raw));

    private static bool IsPlaceholder(ArtifactSetInfo set)
        => set.SetIcon.Length == 0
            || PlaceholderNameRegex().IsMatch(set.EnName.Trim())
            || PlaceholderNameRegex().IsMatch(set.ChsName.Trim());

    private static double Similarity(string a, string b)
    {
        if (a.Length == 0 || b.Length == 0) return 0;
        if (a == b) return 1;
        if (a.Length < 2 || b.Length < 2)
        {
            return b.Contains(a, StringComparison.Ordinal) || a.Contains(b, StringComparison.Ordinal) ? 0.5 : 0;
        }
        var gramsA = Bigrams(a);
        var gramsB = Bigrams(b);
        var shared = 0;
        var total = 0;
        foreach (var (gram, count) in gramsA)
        {
            total += count;
            shared += Math.Min(count, gramsB.GetValueOrDefault(gram));
        }
        foreach (var count in gramsB.Values) total += count;
        return total == 0 ? 0 : 2d * shared / total;
    }

    private static Dictionary<string, int> Bigrams(string value)
    {
        var grams = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < value.Length - 1; i++)
        {
            var gram = value.Substring(i, 2);
            grams[gram] = grams.GetValueOrDefault(gram) + 1;
        }
        return grams;
    }

    private static IReadOnlyList<(string Alias, string Key)> BuildStatAliases()
    {
        var rows = new List<(string Alias, string Key)>
        {
            ("元素充能效率", "er"), ("元素充能", "er"), ("充能效率", "er"), ("充能", "er"),
            ("元素精通", "em"), ("精通", "em"),
            ("暴击伤害", "critDmg"), ("暴击率", "critRate"),
            ("治疗加成", "healBonus"), ("治疗", "healBonus"),
            ("物理伤害加成", "physBonus"), ("物理伤害", "physBonus"), ("物伤", "physBonus"), ("物理", "physBonus"),
        };
        foreach (var (key, zh) in ElementChars)
        {
            rows.Add(($"{zh}元素伤害加成", $"{key}Dmg"));
            rows.Add(($"{zh}元素伤害", $"{key}Dmg"));
            rows.Add(($"{zh}元素", $"{key}Dmg"));
            rows.Add(($"{zh}伤", $"{key}Dmg"));
        }
        rows.Add(("伤害加成", "dmgBonus"));
        rows.Add(("生命值", "hp"));
        rows.Add(("攻击力", "atk"));
        rows.Add(("防御力", "def"));
        rows.Add(("生命", "hp"));
        rows.Add(("攻击", "atk"));
        rows.Add(("防御", "def"));
        rows.Add(("energyrecharge", "er"));
        rows.Add(("elementalmastery", "em"));
        rows.Add(("critrate", "critRate"));
        rows.Add(("critdmg", "critDmg"));
        rows.Add(("healingbonus", "healBonus"));
        rows.Add(("physicaldmgbonus", "physBonus"));
        rows.Add(("physical", "physBonus"));
        rows.Add(("alldmgbonus", "dmgBonus"));
        foreach (var key in ElementChars.Keys) rows.Add(($"{key}dmg", $"{key}Dmg"));
        rows.Add(("hp", "hp"));
        rows.Add(("atk", "atk"));
        rows.Add(("def", "def"));
        return rows.Select((row, index) => (row, index))
            .OrderByDescending(item => item.row.Alias.Length)
            .ThenBy(item => item.index)
            .Select(item => item.row)
            .ToArray();
    }

    private static JsonElement? Property(JsonElement? element, string name)
    {
        if (element is not { ValueKind: JsonValueKind.Object } value) return null;
        return value.TryGetProperty(name, out var property) ? property : null;
    }

    private static string Text(JsonElement? element)
    {
        if (element is null) return string.Empty;
        return element.Value.ValueKind switch
        {
            JsonValueKind.String => element.Value.GetString() ?? string.Empty,
            JsonValueKind.Number => element.Value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => string.Empty,
        };
    }

    private static string Text(string? value) => value ?? string.Empty;

    private static string NodeText(JsonNode? node)
        => node is JsonValue value && value.TryGetValue<string>(out var text) ? text : string.Empty;

    private static bool TryBool(JsonNode? node, out bool value)
    {
        value = false;
        return node is JsonValue json && json.TryGetValue<bool>(out value);
    }

    private static double? Number(JsonElement? element)
    {
        if (element is null) return null;
        if (element.Value.ValueKind == JsonValueKind.Number
            && element.Value.TryGetDouble(out var number)
            && double.IsFinite(number))
        {
            return number;
        }
        var cleaned = NumberCharsRegex().Replace(Text(element).Trim(), string.Empty);
        var match = LeadingNumberRegex().Match(cleaned);
        if (!match.Success) return null;
        return double.TryParse(match.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            && double.IsFinite(parsed)
            ? parsed
            : null;
    }

    private static string FormatNumber(double value)
        => value.ToString(CultureInfo.InvariantCulture);

    [GeneratedRegex("```(?:json)?\\s*([\\s\\S]*?)```", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex FenceRegex();

    [GeneratedRegex("[\\s\\u3000]", RegexOptions.CultureInvariant)]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex("[「」『』《》<>～~!！?？、，,。.·:：;；'\"`]", RegexOptions.CultureInvariant)]
    private static partial Regex PunctuationRegex();

    [GeneratedRegex("[（(【\\[]\\s*(待激活|未激活|新|已锁定|锁定)\\s*[）)】\\]]", RegexOptions.CultureInvariant)]
    private static partial Regex MarkerRegex();

    [GeneratedRegex("[%％]|加成|百分比", RegexOptions.CultureInvariant)]
    private static partial Regex PercentRegex();

    [GeneratedRegex("[（(【\\[][^）)】\\]]*[）)】\\]]", RegexOptions.CultureInvariant)]
    private static partial Regex BracketedRegex();

    [GeneratedRegex("(套装|件套|效果|setbonus|set)", RegexOptions.CultureInvariant)]
    private static partial Regex SetWordsRegex();

    [GeneratedRegex("[0-9]", RegexOptions.CultureInvariant)]
    private static partial Regex DigitsRegex();

    [GeneratedRegex("^\\?+$", RegexOptions.CultureInvariant)]
    private static partial Regex PlaceholderNameRegex();

    [GeneratedRegex("[^0-9.+-]", RegexOptions.CultureInvariant)]
    private static partial Regex NumberCharsRegex();

    [GeneratedRegex("^[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)", RegexOptions.CultureInvariant)]
    private static partial Regex LeadingNumberRegex();
}

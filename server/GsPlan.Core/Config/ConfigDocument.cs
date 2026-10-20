using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GsPlan.Core.Config;

/// <summary>
/// Export and import of a whole configuration: one team plus every damage axis.
/// The file shape is the contract shared with src/lib/config-file.js.
/// </summary>
public static class ConfigDocument
{
    public const string Kind = "lunaris-config";
    public const int Version = 2;

    private static readonly JsonSerializerOptions FileJson = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static JsonObject Build(JsonNode? team, JsonNode? axes, JsonNode? activeId)
    {
        var normalizedTeam = ConfigNormalizer.NormalizeTeam(team);
        var axisState = new JsonObject
        {
            ["axes"] = ConfigNormalizer.Clone(axes),
            ["activeId"] = ConfigNormalizer.Clone(activeId),
        };
        var normalizedAxes = ConfigNormalizer.NormalizeAxes(axisState);
        var packed = AxesPool.Pack(normalizedAxes);

        var document = new JsonObject
        {
            ["kind"] = Kind,
            ["version"] = Version,
            ["team"] = normalizedTeam,
        };
        if (packed["pools"] is JsonObject pools) document["pools"] = pools.DeepClone();
        document["axes"] = packed["axes"]?.DeepClone() ?? new JsonArray();
        document["activeId"] = packed["activeId"]?.DeepClone();
        return document;
    }

    public static string BuildText(JsonNode? team, JsonNode? axes, JsonNode? activeId) =>
        Build(team, axes, activeId).ToJsonString(FileJson).Replace("\r\n", "\n", StringComparison.Ordinal);

    /// <summary>
    /// Parse a config or legacy bare-team document. Throws
    /// <see cref="ConfigDocumentException"/> with a message the import dialog can
    /// display directly.
    /// </summary>
    public static JsonObject Parse(string text)
    {
        JsonNode? raw;
        try
        {
            raw = JsonNode.Parse(text);
        }
        catch (JsonException ex)
        {
            throw new ConfigDocumentException($"不是合法的 JSON：{ex.Message}");
        }

        if (raw is not JsonObject root)
        {
            throw new ConfigDocumentException("顶层必须是一个对象");
        }

        if (ConfigNormalizer.Truthy(root["kind"])
            && !(root["kind"] is JsonValue kindValue
                && kindValue.TryGetValue<string>(out var kind)
                && kind == Kind))
        {
            throw new ConfigDocumentException($"这是「{ConfigNormalizer.JsString(root["kind"])}」文件，不是配置文件");
        }

        if (!ConfigNormalizer.Truthy(root["kind"]) && root["units"] is JsonArray)
        {
            return new JsonObject
            {
                ["team"] = ConfigNormalizer.NormalizeTeam(root),
                ["axes"] = null,
                ["activeId"] = null,
                ["teamOnly"] = true,
            };
        }

        if (!ConfigNormalizer.Truthy(root["team"]) && !ConfigNormalizer.Truthy(root["axes"]))
        {
            if (ConfigNormalizer.Truthy(root["entries"]) && root["entries"] is not JsonArray)
            {
                throw new ConfigDocumentException(
                    "这看起来是增益库文件（entries 是来源到增益的映射表），不是配置文件；配置文件应包含 team 和 axes");
            }
            throw new ConfigDocumentException("既没有 team 也没有 axes，不像配置文件");
        }

        var team = ConfigNormalizer.NormalizeTeam(root["team"]);
        var unpacked = AxesPool.Unpack(new JsonObject
        {
            ["axes"] = ConfigNormalizer.Clone(root["axes"]),
            ["activeId"] = ConfigNormalizer.Clone(root["activeId"]),
            ["pools"] = ConfigNormalizer.Clone(root["pools"]),
        });
        var axes = ConfigNormalizer.NormalizeAxes(unpacked);

        return new JsonObject
        {
            ["team"] = team,
            ["axes"] = axes["axes"]?.DeepClone() ?? new JsonArray(),
            ["activeId"] = axes["activeId"]?.DeepClone(),
            ["teamOnly"] = false,
        };
    }

    public static JsonObject Describe(JsonObject parsed)
    {
        var team = parsed["team"] as JsonObject;
        var units = team?["units"] as JsonArray ?? new JsonArray();
        var characters = 0;
        foreach (var unitNode in units)
        {
            if (unitNode is JsonObject unit
                && unit["char"] is JsonObject character
                && ConfigNormalizer.Truthy(character["id"]))
            {
                characters += 1;
            }
        }

        var result = new JsonObject { ["units"] = units.Count, ["chars"] = characters };
        if (ConfigNormalizer.Truthy(parsed["teamOnly"])) return result;

        var axes = parsed["axes"] as JsonArray ?? new JsonArray();
        var entries = 0;
        foreach (var axisNode in axes)
        {
            if (axisNode is JsonObject axis && axis["entries"] is JsonArray list) entries += list.Count;
        }
        result["axes"] = axes.Count;
        result["entries"] = entries;
        return result;
    }
}

public sealed class ConfigDocumentException(string message) : Exception(message);

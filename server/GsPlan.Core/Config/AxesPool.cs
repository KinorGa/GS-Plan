using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GsPlan.Core.Config;

/// <summary>
/// The file-boundary pool for repeated axis descriptors. In memory a drop keeps
/// its own source and buffs; only the file replaces them with indices.
/// </summary>
public static class AxesPool
{
    private static readonly JsonSerializerOptions KeyJson = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static JsonObject Pack(JsonNode? state)
    {
        var sources = new List<JsonNode?>();
        var buffs = new List<JsonNode?>();
        var labels = new List<JsonNode?>();
        var sourceIndex = new Dictionary<string, int>(StringComparer.Ordinal);
        var buffIndex = new Dictionary<string, int>(StringComparer.Ordinal);
        var labelIndex = new Dictionary<string, int>(StringComparer.Ordinal);

        JsonObject PackDrop(JsonObject drop)
        {
            var output = new JsonObject();
            foreach (var pair in drop)
            {
                if (pair.Key == "source")
                {
                    output["sourceRef"] = Intern(sources, sourceIndex, pair.Value);
                }
                else if (pair.Key == "buffs")
                {
                    var refs = new JsonArray();
                    if (pair.Value is JsonArray list)
                    {
                        foreach (var buff in list) refs.Add(Intern(buffs, buffIndex, buff));
                    }
                    output["buffRefs"] = refs;
                }
                else
                {
                    output[pair.Key] = ConfigNormalizer.Clone(pair.Value);
                }
            }
            return output;
        }

        JsonObject PackSummary(JsonObject summary)
        {
            var output = new JsonObject();
            foreach (var pair in summary)
            {
                if (pair.Key == "sourceLabel") output["sourceLabelRef"] = Intern(labels, labelIndex, pair.Value);
                else output[pair.Key] = ConfigNormalizer.Clone(pair.Value);
            }
            return output;
        }

        JsonObject PackEntry(JsonObject entry)
        {
            var output = ConfigNormalizer.CopyObject(entry);
            if (entry["drops"] is JsonArray drops)
            {
                var packed = new JsonArray();
                foreach (var drop in drops)
                {
                    packed.Add(drop is JsonObject item ? PackDrop(item) : ConfigNormalizer.Clone(drop));
                }
                output["drops"] = packed;
            }
            if (entry["summary"] is JsonObject summary) output["summary"] = PackSummary(summary);
            if (entry["children"] is JsonArray children)
            {
                var packed = new JsonArray();
                foreach (var child in children)
                {
                    packed.Add(child is JsonObject item ? PackEntry(item) : ConfigNormalizer.Clone(child));
                }
                output["children"] = packed;
            }
            return output;
        }

        var outputState = new JsonObject();
        var stateObject = state as JsonObject;
        if (stateObject is not null)
        {
            foreach (var pair in stateObject)
            {
                if (pair.Key == "pools") continue;
                if (pair.Key != "axes")
                {
                    outputState[pair.Key] = ConfigNormalizer.Clone(pair.Value);
                    continue;
                }

                var packedAxes = new JsonArray();
                if (pair.Value is JsonArray axes)
                {
                    foreach (var axisNode in axes)
                    {
                        if (axisNode is not JsonObject axis)
                        {
                            packedAxes.Add(ConfigNormalizer.Clone(axisNode));
                            continue;
                        }
                        var packed = ConfigNormalizer.CopyObject(axis);
                        if (axis["entries"] is JsonArray entries)
                        {
                            var packedEntries = new JsonArray();
                            foreach (var entry in entries)
                            {
                                packedEntries.Add(entry is JsonObject item
                                    ? PackEntry(item)
                                    : ConfigNormalizer.Clone(entry));
                            }
                            packed["entries"] = packedEntries;
                        }
                        packedAxes.Add(packed);
                    }
                }
                outputState["axes"] = packedAxes;
            }
        }

        if (sources.Count > 0 || buffs.Count > 0 || labels.Count > 0)
        {
            var pools = new JsonObject();
            if (sources.Count > 0) pools["sources"] = ToArray(sources);
            if (buffs.Count > 0) pools["buffs"] = ToArray(buffs);
            if (labels.Count > 0) pools["sourceLabels"] = ToArray(labels);
            outputState["pools"] = pools;
        }
        return outputState;
    }

    public static JsonNode? Unpack(JsonNode? state)
    {
        if (state is not JsonObject root || root["pools"] is not JsonObject pools)
        {
            return ConfigNormalizer.Clone(state);
        }

        var sources = pools["sources"] as JsonArray ?? new JsonArray();
        var buffs = pools["buffs"] as JsonArray ?? new JsonArray();
        var labels = pools["sourceLabels"] as JsonArray ?? new JsonArray();

        JsonNode? Deref(JsonArray list, JsonNode? reference)
        {
            var index = ConfigNormalizer.JsNumber(reference);
            if (!double.IsFinite(index) || Math.Floor(index) != index || index < 0 || index >= list.Count) return null;
            return ConfigNormalizer.Clone(list[(int)index]);
        }

        JsonObject UnpackDrop(JsonObject drop)
        {
            var output = new JsonObject();
            foreach (var pair in drop)
            {
                if (pair.Key == "sourceRef")
                {
                    var source = Deref(sources, pair.Value);
                    if (ConfigNormalizer.Truthy(source)) output["source"] = source;
                }
                else if (pair.Key == "buffRefs")
                {
                    var list = new JsonArray();
                    if (pair.Value is JsonArray refs)
                    {
                        foreach (var reference in refs)
                        {
                            var buff = Deref(buffs, reference);
                            if (ConfigNormalizer.Truthy(buff)) list.Add(buff);
                        }
                    }
                    output["buffs"] = list;
                }
                else
                {
                    output[pair.Key] = ConfigNormalizer.Clone(pair.Value);
                }
            }
            return output;
        }

        JsonObject UnpackSummary(JsonObject summary)
        {
            var output = new JsonObject();
            foreach (var pair in summary)
            {
                if (pair.Key == "sourceLabelRef")
                {
                    var label = Deref(labels, pair.Value);
                    if (ConfigNormalizer.Truthy(label)) output["sourceLabel"] = label;
                }
                else
                {
                    output[pair.Key] = ConfigNormalizer.Clone(pair.Value);
                }
            }
            return output;
        }

        JsonObject UnpackEntry(JsonObject entry)
        {
            var output = ConfigNormalizer.CopyObject(entry);
            if (entry["drops"] is JsonArray drops)
            {
                var list = new JsonArray();
                foreach (var drop in drops) list.Add(drop is JsonObject item ? UnpackDrop(item) : ConfigNormalizer.Clone(drop));
                output["drops"] = list;
            }
            if (entry["summary"] is JsonObject summary) output["summary"] = UnpackSummary(summary);
            if (entry["children"] is JsonArray children)
            {
                var list = new JsonArray();
                foreach (var child in children) list.Add(child is JsonObject item ? UnpackEntry(item) : ConfigNormalizer.Clone(child));
                output["children"] = list;
            }
            return output;
        }

        var outputState = new JsonObject();
        foreach (var pair in root)
        {
            if (pair.Key == "pools") continue;
            if (pair.Key != "axes")
            {
                outputState[pair.Key] = ConfigNormalizer.Clone(pair.Value);
                continue;
            }

            var axes = new JsonArray();
            if (pair.Value is JsonArray list)
            {
                foreach (var axisNode in list)
                {
                    if (axisNode is not JsonObject axis)
                    {
                        axes.Add(ConfigNormalizer.Clone(axisNode));
                        continue;
                    }
                    var unpacked = ConfigNormalizer.CopyObject(axis);
                    if (axis["entries"] is JsonArray entries)
                    {
                        var expanded = new JsonArray();
                        foreach (var entry in entries)
                        {
                            expanded.Add(entry is JsonObject item ? UnpackEntry(item) : ConfigNormalizer.Clone(entry));
                        }
                        unpacked["entries"] = expanded;
                    }
                    axes.Add(unpacked);
                }
            }
            outputState["axes"] = axes;
        }
        return outputState;
    }

    private static int Intern(List<JsonNode?> pool, Dictionary<string, int> index, JsonNode? value)
    {
        var key = value?.ToJsonString(KeyJson) ?? "null";
        if (index.TryGetValue(key, out var found)) return found;
        var at = pool.Count;
        pool.Add(ConfigNormalizer.Clone(value));
        index[key] = at;
        return at;
    }

    private static JsonArray ToArray(IEnumerable<JsonNode?> nodes)
    {
        var array = new JsonArray();
        foreach (var node in nodes) array.Add(ConfigNormalizer.Clone(node));
        return array;
    }
}

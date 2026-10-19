namespace GsPlan.Core.Damage;

public static class Elements
{
    public static readonly string[] ElementKeys =
        ["pyro", "hydro", "cryo", "electro", "anemo", "geo", "dendro"];

    public static readonly string[] DamageTypes = [.. ElementKeys, "physical"];

    private static readonly Dictionary<string, string> KeySuffix = new(StringComparer.Ordinal)
    {
        ["pyro"] = "Pyro",
        ["hydro"] = "Hydro",
        ["cryo"] = "Cryo",
        ["electro"] = "Electro",
        ["anemo"] = "Anemo",
        ["geo"] = "Geo",
        ["dendro"] = "Dendro",
        ["physical"] = "Physical",
    };

    /// <summary>
    /// The capitalised suffix used by composite field names, or null for an
    /// unrecognised damage type. Null is deliberate: guessing Physical would turn
    /// a mistyped element into a plausible wrong number.
    /// </summary>
    public static string? DamageTypeSuffix(string? element)
    {
        var key = (element ?? string.Empty).ToLowerInvariant();
        return KeySuffix.TryGetValue(key, out var suffix) ? suffix : null;
    }
}
